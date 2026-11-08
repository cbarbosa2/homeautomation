import { test } from "node:test";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects as assertRejects,
  match,
} from "node:assert/strict";
import { Temporal } from "../temporal.ts";
import { ControlTelemetry } from "../control-telemetry.ts";
import {
  CONTROL_PATHS as P,
  REFRESH_PATHS,
  wallboxPath,
} from "../device-topics.ts";
import {
  WallboxChargeMode as Mode,
  WallboxLocation as L,
  WallboxStatus as S,
} from "../globals.ts";
import { AutomaticChargingCycle } from "./automatic-charging-cycle.ts";

interface Write {
  path: string;
  value: unknown;
}

const inside = (field: string) => wallboxPath(L.Inside, field);
const outside = (field: string) => wallboxPath(L.Outside, field);
const has = (writes: Write[], path: string, value: number) =>
  writes.some((w) => w.path === path && w.value === value);

function installation(enabled = true, startupCharging = false) {
  let now = Temporal.Instant.from("2026-09-27T12:00:00Z");
  let insideVehicleSoc:
    | { percent: number; observedAt: Temporal.Instant; source: string }
    | undefined;
  const telemetry = new ControlTelemetry(() => now);
  const values = new Map<string, number>(REFRESH_PATHS.map((p) => [p, 0]));
  values.set(P.batterySOC, 50);
  values.set(P.batteryMinSOC, 20);
  for (const l of [L.Inside, L.Outside]) {
    values.set(
      wallboxPath(l, "Status"),
      startupCharging ? S.Charging : S.Connected,
    );
    values.set(wallboxPath(l, "SetCurrent"), 10);
  }
  const refresh = () => {
    for (const [path, value] of values) telemetry.record(path, value);
  };
  refresh();
  const modes = new Map([
    [L.Inside, Mode.Max],
    [L.Outside, Mode.Max],
  ]);
  const writes: Write[] = [];
  let onPublish: (write: Write) => Promise<void> = () => Promise.resolve();
  let reads = 0;
  let preference = L.Inside;
  const dependencies = {
    telemetry: () => {
      reads++;
      return telemetry.snapshot();
    },
    modes: () => modes,
    preference: () => preference,
    insideVehicleSoc: () => insideVehicleSoc,
    clock: () => now,
    enabled,
    publisher: {
      publishJson: async (topic: string, data: Record<string, unknown>) => {
        const { value } = data;
        const write = {
          path: topic.split("/").slice(2).join("/"),
          value,
        };
        writes.push(write);
        await onPublish(write);
      },
    },
  };
  let cycle = new AutomaticChargingCycle(dependencies);
  const tick = async () => {
    const start = writes.length;
    await cycle.tick();
    return writes.slice(start);
  };
  const advance = (duration = Temporal.Duration.from({ seconds: 1 })) => {
    now = now.add(duration);
  };
  return {
    telemetry,
    values,
    modes,
    writes,
    refresh,
    tick,
    advance,
    readCount: () => reads,
    dischargeStatus: () => cycle.getBatteryDischargeStatus(),
    prefer: (location: L) => {
      preference = location;
    },
    setTime: (value: string) => {
      now = Temporal.Instant.from(value);
    },
    setInsideVehicleSoc: (percent: number | undefined, ageMinutes = 0) => {
      insideVehicleSoc =
        percent === undefined
          ? undefined
          : {
              percent,
              observedAt: now.subtract({ minutes: ageMinutes }),
              source: "test",
            };
    },
    onPublish: (callback: typeof onPublish) => {
      onPublish = callback;
    },
    enable: () => {
      dependencies.enabled = true;
    },
    restart: () => {
      cycle = new AutomaticChargingCycle(dependencies);
    },
    settle: async () => {
      let result: Write[] = [];
      for (let i = 0; i < 16; i++) {
        advance();
        refresh();
        result = await tick();
      }
      return result;
    },
  };
}

test("cycle stops the inside BMW at 80% and ignores unavailable readings", async () => {
  const h = installation();
  h.modes.set(L.Inside, Mode.Night);
  h.modes.set(L.Outside, Mode.Sun);
  h.setTime("2026-09-27T21:00:00Z");
  h.refresh();
  assert(has(await h.tick(), inside("StartStop"), 1));
  h.setInsideVehicleSoc(80);
  assert(has(await h.tick(), inside("StartStop"), 0));
  h.setInsideVehicleSoc(undefined);
  assert(has(await h.settle(), inside("StartStop"), 1));
  h.setInsideVehicleSoc(80, 91);
  assert(!has(await h.tick(), inside("StartStop"), 0));
});

test("cycle stops a pending start before telemetry arrives", async () => {
  const h = installation();
  assert(has(await h.tick(), inside("StartStop"), 1));
  h.modes.set(L.Inside, Mode.Sun);
  const writes = await h.tick();
  assert(has(writes, inside("StartStop"), 0));
  assert(has(writes, P.batteryMaxChargePower, 0));
});

test("cycle reserves capacity until both settings and measured power confirm reduction", async () => {
  const h = installation();
  await h.tick();
  h.modes.set(L.Inside, Mode.Sun);
  for (let i = 0; i < 20; i++) {
    h.advance();
    assert(!has(await h.tick(), outside("StartStop"), 1));
  }
  // A setting echo alone cannot release capacity.
  h.advance();
  for (const field of ["SetCurrent", "StartStop"]) {
    h.telemetry.record(inside(field), 0);
  }
  assert(!has(await h.tick(), outside("StartStop"), 1));
  h.advance();
  h.refresh();
  const writes = await h.tick();
  assert(has(writes, outside("SetCurrent"), 28));
  assert(has(writes, outside("StartStop"), 1));
});

test("cycle retains selected preference through power pauses and cycle recreation", async () => {
  const h = installation();
  h.prefer(L.Outside);
  h.values.set(outside("Status"), S.Charging);
  h.advance();
  h.refresh();
  h.advance();
  h.values.set(inside("Status"), S.Charging);
  h.refresh();
  assert(has(await h.tick(), outside("SetCurrent"), 28));
  // Pause both without releasing eligibility, then observe Inside restart first.
  h.values.set(P.gridPower, 6720);
  h.values.set(inside("Status"), S.Connected);
  h.values.set(outside("Status"), S.Connected);
  h.advance();
  h.refresh();
  await h.tick();
  h.advance();
  h.values.set(inside("Status"), S.Charging);
  h.refresh();
  h.advance();
  h.values.set(outside("Status"), S.Charging);
  h.refresh();
  h.values.set(P.gridPower, 0);
  assert(has(await h.settle(), outside("SetCurrent"), 28));
  h.restart();
  assert(has(await h.tick(), outside("SetCurrent"), 28));
});

test("cycle responds to a new preference and regains it after disconnect", async () => {
  const h = installation(true, true);
  await h.tick();
  h.prefer(L.Outside);
  const reductions = await h.tick();
  assert(has(reductions, inside("StartStop"), 0));
  assert(has(await h.settle(), outside("SetCurrent"), 28));
  h.values.set(outside("Status"), S.Disconnected);
  assert(has(await h.settle(), inside("SetCurrent"), 20));
  h.values.set(outside("Status"), S.Charging);
  assert(has(await h.settle(), outside("SetCurrent"), 28));
});

test("cycle uses default Inside preference at startup", async () => {
  const h = installation(true, true);
  const writes = await h.tick();
  assert(has(writes, inside("SetCurrent"), 20));
  assert(has(writes, outside("SetCurrent"), 8));
});

test("cycle allocates to the other charger while the preferred charger is ineligible", async () => {
  for (const reason of ["manual", "full", "disconnected", "fault", "mode"]) {
    const h = installation();
    h.values.set(outside("Status"), S.Charging);
    h.advance();
    h.refresh();
    h.prefer(L.Outside);
    assert(has(await h.tick(), outside("SetCurrent"), 28), reason);
    if (reason === "manual") h.modes.set(L.Outside, Mode.Manual);
    if (reason === "mode") h.modes.set(L.Outside, Mode.Sun);
    if (reason === "full") h.values.set(outside("Status"), S.Charged);
    if (reason === "disconnected") {
      h.values.set(outside("Status"), S.Disconnected);
    }
    if (reason === "fault") h.values.set(outside("Status"), 8);
    assert(has(await h.settle(), inside("SetCurrent"), 20), reason);
  }
});

test("cycle uses one conservative budget and recovers after fresh readings", async () => {
  const h = installation();
  // Only grid is stale; charger status remains valid so On remains eligible.
  h.telemetry.record(P.gridPower, null);
  let writes = await h.tick();
  assert(has(writes, inside("SetCurrent"), 12));
  assert(!has(writes, outside("StartStop"), 1));
  assert(
    !writes.some(
      (w) => w.path === P.batteryMaxChargePower && Number(w.value) > 0,
    ),
  );
  assert(has(await h.settle(), inside("SetCurrent"), 20));
  h.advance(Temporal.Duration.from({ seconds: 61 }));
  writes = await h.tick();
  assert(has(writes, inside("StartStop"), 0));
  assert(!has(writes, outside("StartStop"), 1));
  // Fresh confirmation releases the old wallbox reservation after full staleness.
  assert(has(await h.settle(), inside("SetCurrent"), 20));
});

test("cycle treats missing PV inverter power as zero", async () => {
  const night = installation();
  night.setTime("2026-09-27T21:00:00Z"); // 22:00 in Lisbon
  night.modes.set(L.Inside, Mode.Night);
  night.modes.set(L.Outside, Mode.Sun);
  night.values.delete(P.pvInverterPower);
  night.refresh();
  assert(has(await night.tick(), inside("SetCurrent"), 20));

  const day = installation();
  day.values.delete(P.pvInverterPower);
  day.telemetry.record(P.pvInverterPower, null);
  day.modes.set(L.Outside, Mode.Sun);
  assert(has(await day.tick(), inside("SetCurrent"), 20));

  const missingGrid = installation();
  missingGrid.modes.set(L.Outside, Mode.Sun);
  missingGrid.telemetry.record(P.gridPower, null);
  assert(has(await missingGrid.tick(), inside("SetCurrent"), 12));
});

test("conservative allocation still enforces solar eligibility and funds battery last", async () => {
  const h = installation();
  h.modes.set(L.Inside, Mode.Sun);
  h.modes.set(L.Outside, Mode.Sun);
  h.telemetry.record(P.gridPower, null);
  const writes = await h.tick();
  assert(!has(writes, inside("StartStop"), 1));
  assert(has(writes, P.batteryMaxChargePower, 2880));
});

test("cycle publishes reductions before increases", async () => {
  const h = installation();
  h.values.set(P.batteryMaxChargePower, 2400);
  h.refresh();
  const writes = await h.tick();
  assertEquals(writes[0], { path: P.batteryMaxChargePower, value: 1920 });
  assert(has(writes.slice(1), inside("StartStop"), 1));
});

test("cycle checks live Manual mode during publication using its injected reader", async () => {
  const h = installation();
  h.onPublish(() => {
    h.modes.set(L.Inside, Mode.Manual);
    return Promise.resolve();
  });
  const writes = await h.tick();
  assert(has(writes, inside("SetCurrent"), 20));
  assert(!has(writes, inside("StartStop"), 1));
});

test("cycle cancels obsolete increases when a limited mode is selected during publication", async () => {
  const h = installation();
  h.onPublish(() => {
    h.modes.set(L.Inside, Mode.Sun);
    return Promise.resolve();
  });
  assert(!has(await h.tick(), inside("StartStop"), 1));
  assert(has(await h.tick(), inside("StartStop"), 0));
});

test("failed cycle aborts publication, retains reservations, and permits recovery", async () => {
  const h = installation();
  h.onPublish(() => Promise.reject(new Error("offline")));
  await assertRejects(
    h.tick,
    (error: unknown) =>
      error instanceof Error && error.message.includes("offline"),
  );
  assertEquals(h.writes.length, 1);
  h.onPublish(() => Promise.resolve());
  h.modes.set(L.Inside, Mode.Sun);
  // Failure must not roll back the pending start reservation.
  assert(has(await h.tick(), inside("StartStop"), 0));
  for (let i = 0; i < 16; i++) {
    h.advance();
    assert(!has(await h.tick(), outside("StartStop"), 1));
  }
  h.advance();
  h.refresh();
  assert(has(await h.tick(), outside("SetCurrent"), 28));
});

test("failed reduction also aborts remaining reductions", async () => {
  const h = installation(true, true);
  h.modes.set(L.Inside, Mode.Sun);
  h.modes.set(L.Outside, Mode.Sun);
  h.onPublish(() => Promise.reject(new Error("offline")));
  await assertRejects(
    h.tick,
    (error: unknown) =>
      error instanceof Error && error.message.includes("offline"),
  );
  assertEquals(h.writes, [{ path: inside("StartStop"), value: 0 }]);
});

test("busy triggers are skipped without reading telemetry or queuing work", async () => {
  const h = installation();
  const gate = Promise.withResolvers<void>();
  h.onPublish(() => gate.promise);
  const pending = h.tick();
  await h.tick();
  await h.tick();
  assertEquals(h.readCount(), 1);
  gate.resolve();
  await pending;
  assertEquals(h.readCount(), 1);
  await h.tick();
  assertEquals(h.readCount(), 2);
});

test("disabled publication still advances reservations and smoothing", async () => {
  const h = installation(false);
  await h.tick();
  assertEquals(h.writes, []);
  h.enable();
  h.modes.set(L.Inside, Mode.Sun);
  assert(has(await h.tick(), inside("StartStop"), 0));
  assert(!has(h.writes, outside("StartStop"), 1));
  h.advance();
  h.refresh();
  // Outside's earlier zero target still participates in its smoothing history.
  assert(!has(await h.tick(), outside("StartStop"), 1));
  assert(has(await h.settle(), outside("StartStop"), 1));
});

test("disabled publication preserves selected preference", async () => {
  const h = installation(false);
  h.prefer(L.Outside);
  h.values.set(outside("Status"), S.Charging);
  h.refresh();
  await h.tick();
  h.values.set(outside("Status"), S.Connected);
  h.values.set(inside("Status"), S.Charging);
  h.enable();
  assert(has(await h.settle(), outside("SetCurrent"), 28));
});

test("cycle uses Lisbon night boundaries in summer and winter", async () => {
  for (const [evening, morning] of [
    ["2026-09-27T21:00:00Z", "2026-09-28T07:00:00Z"],
    ["2026-12-01T22:00:00Z", "2026-12-02T08:00:00Z"],
  ] as const) {
    const h = installation();
    h.modes.set(L.Inside, Mode.Night);
    h.modes.set(L.Outside, Mode.Sun);
    h.setTime(evening);
    h.refresh();
    assert(has(await h.tick(), inside("StartStop"), 1));
    h.setTime(morning);
    h.refresh();
    assert(has(await h.tick(), inside("StartStop"), 0));
  }
});

test("cycle supplies rounded remaining Lisbon night hours to Reserve", async () => {
  for (const [soc, starts] of [
    [38, false],
    [39, true],
  ] as const) {
    const h = installation();
    h.modes.set(L.Inside, Mode.Reserve);
    h.modes.set(L.Outside, Mode.Sun);
    h.values.set(P.batterySOC, soc);
    h.setTime("2026-09-27T22:00:00Z");
    h.refresh(); // Lisbon 23:00: nine hours left.
    assertEquals(has(await h.tick(), inside("StartStop"), 1), starts);
  }
});

test("cycle stops a starting charger below 10 A even before StartStop acknowledgment", async () => {
  const h = installation();
  h.values.set(inside("Status"), S.StartCharging);
  h.values.set(P.gridPower, 4560);
  h.refresh();
  assert(has(await h.tick(), inside("StartStop"), 0));
});

/** A deterministic installation: commands change settings, then the next sample
 * reports the physical load and the inverter's bounded discharge response. */
function batteryInstallation(
  capacity = 4000,
  both = false,
  responsePerSecond = Infinity,
) {
  const h = installation();
  h.modes.set(L.Inside, Mode.Battery);
  h.modes.set(L.Outside, both ? Mode.Battery : Mode.Manual);
  let household = 0;
  let solar = 0;
  let dischargeCapacity = capacity;
  let previousDischarge = 0;
  const samples: { inside: number; outside: number; grid: number }[] = [];
  h.onPublish(async ({ path, value }) => {
    h.values.set(path, Number(value));
  });
  const sample = () => {
    let load = household;
    for (const l of [L.Inside, L.Outside]) {
      const active = h.values.get(wallboxPath(l, "StartStop")) === 1;
      const power = active
        ? (h.values.get(wallboxPath(l, "SetCurrent")) ?? 0) * 240
        : 0;
      h.values.set(wallboxPath(l, "Status"), active ? S.Charging : S.Connected);
      h.values.set(wallboxPath(l, "Ac/Power"), power);
      load += power;
    }
    const discharge = Math.min(
      dischargeCapacity,
      previousDischarge + responsePerSecond,
      Math.max(0, load - solar),
    );
    previousDischarge = discharge;
    h.values.set(P.batteryPower, -discharge);
    h.values.set(P.pvChargerPower, solar);
    h.values.set(P.gridPower, load - solar - discharge);
    samples.push({
      inside: h.values.get(inside("Ac/Power")) ?? 0,
      outside: h.values.get(outside("Ac/Power")) ?? 0,
      grid: load - solar - discharge,
    });
    h.refresh();
  };
  const step = async (seconds = 1) => {
    h.advance(Temporal.Duration.from({ seconds }));
    sample();
    return h.tick();
  };
  return {
    ...h,
    sample,
    samples,
    step,
    run: async (ticks: number) => {
      for (let i = 0; i < ticks; i++) await step();
    },
    household: (watts: number) => {
      household = watts;
    },
    solar: (watts: number) => {
      solar = watts;
    },
    capacity: (watts: number) => {
      dischargeCapacity = watts;
    },
  };
}

test("battery starts from idle, ramps in whole amps and converges below 100 W import", async () => {
  const h = batteryInstallation(3500);
  assert(has(await h.tick(), inside("SetCurrent"), 10));
  await h.run(240);
  const tail = h.samples.slice(-30);
  assert(
    tail.every((s) => s.inside >= 7 * 240 && s.grid < 100),
    JSON.stringify(tail),
  );
  assert(tail.some((s) => s.inside >= 14 * 240));
  // No single fresh response permits an increase larger than one amp.
  for (let i = 1; i < h.samples.length; i++) {
    const previous = h.samples[i - 1];
    const current = h.samples[i];
    assert(previous && current);
    const before = previous.inside;
    const after = current.inside;
    if (before > 0 && after > before) assert(after - before <= 240);
  }
  h.household(1200);
  await h.run(20);
  assert(h.samples.slice(-10).every((s) => s.grid < 100 && s.inside <= 2400));
});

test("failed discharge discovery blocks both EVs until the recorded SOC baseline rises by one point", async () => {
  const h = batteryInstallation(0, true);
  assert(has(await h.tick(), inside("SetCurrent"), 10));
  await h.run(16); // first high reading at second 1: exactly 15 seconds is allowed
  assertEquals(h.values.get(inside("StartStop")), 1);
  await h.step();
  assertEquals(h.values.get(inside("StartStop")), 0);
  const failedAt = h.writes.length;
  h.prefer(L.Outside);
  h.modes.set(L.Inside, Mode.Max);
  h.modes.set(L.Inside, Mode.Battery);
  await h.run(90);
  assert(
    !h.writes
      .slice(failedAt)
      .some((w) => w.path.endsWith("StartStop") && w.value === 1),
  );
  h.values.set(P.batterySOC, 50.99);
  await h.run(20);
  assert(
    !h.writes
      .slice(failedAt)
      .some((w) => w.path.endsWith("StartStop") && w.value === 1),
  );
  // Stale recovery and elapsed time must preserve the failure baseline.
  h.advance(Temporal.Duration.from({ seconds: 61 }));
  await h.tick();
  await h.run(20);
  assert(
    !h.writes
      .slice(failedAt)
      .some((w) => w.path.endsWith("StartStop") && w.value === 1),
  );
  h.values.set(P.batterySOC, 51);
  await h.run(20);
  assert(
    h.writes
      .slice(failedAt)
      .some((w) => w.path === outside("StartStop") && w.value === 1),
  );
  // The SOC increase allowed an attempt, not proof of discharge.
  await h.run(40);
  const secondFailure = h.writes.length;
  await h.run(40);
  assert(
    !h.writes
      .slice(secondFailure)
      .some((w) => w.path.endsWith("StartStop") && w.value === 1),
  );
});

test("minimum-SOC change releases failed discovery but never allows a probe at the floor", async () => {
  const h = batteryInstallation(0);
  await h.tick();
  await h.run(20);
  const failure = h.writes.length;
  h.values.set(P.batteryMinSOC, 50);
  await h.run(20);
  assert(
    !h.writes
      .slice(failure)
      .some((w) => w.path === inside("StartStop") && w.value === 1),
  );
  h.values.set(P.batteryMinSOC, 49);
  await h.run(20);
  assert(
    h.writes
      .slice(failure)
      .some((w) => w.path === inside("StartStop") && w.value === 1),
  );
});

test("two battery EVs share discovery and the 100 W allowance", async () => {
  const h = batteryInstallation(6400, true);
  h.values.set(inside("SetCurrent"), 7);
  h.values.set(inside("StartStop"), 1);
  h.sample();
  await h.tick();
  await h.run(250);
  assert(
    h.samples
      .slice(-20)
      .every((s) => s.inside + s.outside < 6500 && s.grid < 100),
    JSON.stringify(h.samples.slice(-20)),
  );
  assert(h.samples.every((s) => s.grid <= 28 * 240));
});

test("unchanged telemetry cannot grow a probe or fabricate a failure interval", async () => {
  const h = batteryInstallation(0);
  await h.tick();
  await h.step();
  const first = h.writes.length;
  for (let i = 0; i < 40; i++) {
    h.advance();
    await h.tick();
  }
  assert(
    !h.writes
      .slice(first)
      .some((w) => w.path === inside("SetCurrent") && Number(w.value) > 10),
  );
  assert(
    !h.writes
      .slice(first)
      .some((w) => w.path === inside("StartStop") && w.value === 0),
  );
  // Fresh evidence spanning the failed interval now ends it.
  await h.step();
  assertEquals(h.values.get(inside("StartStop")), 0);
});

test("any fresh discharge establishes availability but grants no unused capacity", async () => {
  const h = batteryInstallation(1);
  await h.tick();
  await h.run(17);
  assertEquals(h.values.get(inside("StartStop")), 0);
  const stopped = h.writes.length;
  await h.run(40);
  assert(
    !h.writes
      .slice(stopped)
      .some((w) => w.path === inside("StartStop") && w.value === 1),
  );
  // Household demand and PV are unchanged: the observed 1 W is not a rating.
});

test("200 W is not a failed-discharge interval and a fresh interruption resets the interval", async () => {
  const h = batteryInstallation(0);
  await h.tick();
  await h.step();
  await h.step(10);
  h.telemetry.record(P.gridPower, 200);
  h.advance();
  h.telemetry.record(P.batteryPower, 0);
  h.telemetry.record(P.gridPower, 200);
  await h.tick();
  // Return to high import; the preceding ten seconds cannot count.
  await h.step();
  await h.step(10);
  assertEquals(h.values.get(inside("StartStop")), 1);
  await h.step(6);
  assertEquals(h.values.get(inside("StartStop")), 0);
});

test("battery probes require SOC strictly above minimum, including after stale recovery", async () => {
  for (const soc of [19, 20]) {
    const h = batteryInstallation(5000);
    h.values.set(P.batterySOC, soc);
    h.refresh();
    await h.tick();
    await h.run(30);
    assert(
      !h.writes.some((w) => w.path === inside("StartStop") && w.value === 1),
    );
    h.advance(Temporal.Duration.from({ seconds: 61 }));
    await h.tick();
    await h.run(20);
    assert(
      !h.writes.some((w) => w.path === inside("StartStop") && w.value === 1),
    );
    h.values.set(P.batterySOC, 20.01);
    await h.run(20);
    assert(
      h.writes.some((w) => w.path === inside("StartStop") && w.value === 1),
    );
  }
});

test("full-SOC exception remains battery-limited and BMW freshness takes precedence", async () => {
  const h = batteryInstallation(3500);
  h.modes.set(L.Inside, Mode.Sun);
  h.values.set(P.batterySOC, 95);
  h.refresh();
  assert(!has(await h.tick(), inside("StartStop"), 1));
  h.values.set(P.batterySOC, 95.01);
  h.setInsideVehicleSoc(80);
  h.refresh();
  assert(!has(await h.tick(), inside("StartStop"), 1));
  h.setInsideVehicleSoc(80, 91);
  await h.run(200);
  assert(
    h.samples.slice(-20).every((s) => s.grid < 100 && s.inside >= 7 * 240),
  );
  h.values.set(P.batterySOC, 95);
  await h.step();
  assertEquals(h.values.get(inside("StartStop")), 0);
});

test("failed probing still permits Battery's zero-import solar fallback", async () => {
  const h = batteryInstallation(0);
  await h.tick();
  await h.run(20);
  h.solar(3000);
  await h.run(30);
  assert(h.samples.slice(-10).every((s) => s.inside >= 2400 && s.grid <= 0));
  h.solar(0);
  await h.run(30);
  assertEquals(h.values.get(inside("StartStop")), 0);
});

test("a failed battery probe publish does not permit another EV or a larger probe", async () => {
  const h = installation();
  h.modes.set(L.Inside, Mode.Battery);
  h.modes.set(L.Outside, Mode.Battery);
  h.onPublish(async () => {
    throw new Error("offline");
  });
  await assertRejects(h.tick);
  h.onPublish(async () => {});
  await h.settle();
  assert(
    !h.writes.some((w) => w.path === outside("StartStop") && w.value === 1),
  );
  assert(
    !h.writes.some(
      (w) => w.path === inside("SetCurrent") && Number(w.value) > 10,
    ),
  );
});

test("solar and battery modes share power while the solar EV keeps a zero-import target", async () => {
  const h = batteryInstallation(3500, true);
  h.modes.set(L.Outside, Mode.Sun);
  h.prefer(L.Outside);
  h.solar(6000);
  h.sample();
  await h.tick();
  await h.run(250);
  assert(
    h.samples
      .slice(-20)
      .every((s) => s.grid <= 0 && s.inside >= 2400 && s.outside === 6000),
    JSON.stringify(h.samples.slice(-20)),
  );
  h.household(1200);
  await h.run(40);
  assert(h.samples.slice(-20).every((s) => s.grid <= 0));
});

test("household and Manual import above the limited target pause an automatic EV", async () => {
  for (const manual of [false, true]) {
    const h = installation();
    h.modes.set(L.Inside, Mode.Battery);
    h.modes.set(L.Outside, Mode.Manual);
    h.values.set(P.gridPower, 500);
    h.values.set(outside("Ac/Power"), manual ? 500 : 0);
    h.refresh();
    await h.tick();
    await h.settle();
    assert(
      !h.writes.some((w) => w.path === inside("StartStop") && w.value === 1),
    );
    assert(!h.writes.some((w) => w.path.startsWith("evcharger/41/")));
  }
});

test("gradual inverter response completes a bounded startup before ramping further", async () => {
  const h = batteryInstallation(3500, false, 300);
  await h.tick();
  await h.run(8);
  assertEquals(h.values.get(inside("StartStop")), 1);
  assert(h.samples.slice(0, 7).every((s) => s.inside === 2400));
  await h.run(240);
  assert(h.samples.slice(-20).every((s) => s.inside >= 3360 && s.grid < 100));
});

test("loss of previously working discharge stops charging and blocks repeated restart attempts", async () => {
  const h = batteryInstallation(3500);
  await h.tick();
  await h.run(200);
  h.capacity(0);
  await h.run(80);
  assertEquals(h.values.get(inside("StartStop")), 0);
  const stopped = h.writes.length;
  await h.run(60);
  assert(
    !h.writes
      .slice(stopped)
      .some((w) => w.path === inside("StartStop") && w.value === 1),
  );
});

test("dashboard discharge status follows discovery, telemetry recovery and mode resets", async () => {
  const h = batteryInstallation();
  assertEquals(h.dischargeStatus().state, "unknown");
  await h.tick();
  assertEquals(h.dischargeStatus().state, "checking");
  await h.step();
  assertEquals(h.dischargeStatus().state, "confirmed");

  h.telemetry.invalidate();
  assertEquals(h.dischargeStatus().state, "unknown");
  await h.tick();
  h.refresh();
  assertEquals(h.dischargeStatus().state, "unknown");
  await h.step();
  // Stopping for stale telemetry retains reservations and restart smoothing.
  await h.run(20);
  assertEquals(h.dischargeStatus().state, "confirmed");

  h.modes.set(L.Inside, Mode.Manual);
  await h.step();
  assertEquals(h.dischargeStatus().state, "unknown");
  match(h.dischargeStatus().reason, /No eligible wallbox/);
  h.restart();
  assertEquals(h.dischargeStatus().state, "unknown");
});

test("dashboard discharge status retains failed discovery until retry conditions change", async () => {
  const h = batteryInstallation(0);
  await h.tick();
  assertEquals(h.dischargeStatus().state, "checking");
  await h.run(40);
  assertEquals(h.dischargeStatus().state, "blocked");
  match(h.dischargeStatus().reason, /attempt failed/);
  h.values.set(P.batterySOC, 50.99);
  await h.step();
  assertEquals(h.dischargeStatus().state, "blocked");
  h.values.set(P.batterySOC, 51);
  await h.step();
  assertEquals(h.dischargeStatus().state, "checking");
  // Retry publication waits for the preceding stop and increase smoothing.
  await h.run(40);
  assertEquals(h.dischargeStatus().state, "blocked");
  h.values.set(P.batteryMinSOC, 51);
  await h.step();
  assertEquals(h.dischargeStatus().state, "blocked");
  match(h.dischargeStatus().reason, /at or below/);
  h.values.set(P.batteryMinSOC, 50);
  await h.step();
  assertEquals(h.dischargeStatus().state, "checking");
});

test("dashboard discharge status expires even while device telemetry is refreshed", async () => {
  const h = batteryInstallation();
  await h.tick();
  await h.step();
  assertEquals(h.dischargeStatus().state, "confirmed");
  h.advance(Temporal.Duration.from({ seconds: 60 }));
  h.refresh();
  assertEquals(h.dischargeStatus().state, "confirmed");
  h.advance(Temporal.Duration.from({ nanoseconds: 1 }));
  h.refresh();
  assertEquals(h.dischargeStatus().state, "unknown");
  match(h.dischargeStatus().reason, /status is stale/);
});

test("registered ingestion feeds fallback, recovery and original observation times into the charging cycle", async () => {
  let now = Temporal.Instant.from("2026-11-08T12:00Z");
  const { recordingTelemetry } = await import(
    "../device-telemetry-fixture.test.ts"
  );
  const { telemetry, record } = await recordingTelemetry(() => now);
  const values = new Map<string, number>(
    REFRESH_PATHS.map((path) => [path, 0]),
  );
  values.delete(P.pvInverterPower);
  values.set(P.batterySOC, 50);
  values.set(P.batteryMinSOC, 20);
  values.set(inside("Status"), S.Connected);
  values.set(outside("Status"), S.Connected);
  const refresh = () => {
    for (const [path, value] of values) record(path, { value });
  };
  refresh();
  const modes = new Map([
    [L.Inside, Mode.Max],
    [L.Outside, Mode.Sun],
  ]);
  const writes: Write[] = [];
  const cycle = new AutomaticChargingCycle({
    telemetry: () => telemetry.snapshot(),
    modes: () => modes,
    preference: () => L.Inside,
    clock: () => now,
    enabled: true,
    publisher: {
      publishJson: async (topic, data) => {
        const path = topic.split("/").slice(2).join("/");
        const { value } = data;
        writes.push({ path, value });
        values.set(path, Number(value));
      },
    },
  });
  record(P.gridPower, { value: null });
  await cycle.tick();
  assert(has(writes, inside("SetCurrent"), 12));
  writes.length = 0;
  for (let tick = 0; tick < 20; tick++) {
    now = now.add({ seconds: 1 });
    refresh();
    await cycle.tick();
  }
  assert(has(writes, inside("SetCurrent"), 20));
  assertEquals(telemetry.snapshot().pvInverterPower, 0);
  const observedAt = telemetry.snapshot().observedAt;
  now = now.add({ seconds: 1 });
  await cycle.tick();
  assertEquals(telemetry.snapshot().observedAt, observedAt);
  telemetry.invalidate();
  writes.length = 0;
  await cycle.tick();
  assert(has(writes, inside("StartStop"), 0));
  assertEquals(telemetry.snapshot().telemetryValid, false);
  // Fresh measured/settings feedback releases the previous allocation.
  values.set(inside("Ac/Power"), 0);
  writes.length = 0;
  for (let tick = 0; tick < 20; tick++) {
    now = now.add({ seconds: 1 });
    refresh();
    await cycle.tick();
  }
  assertEquals(telemetry.snapshot().telemetryValid, true);
  assert(has(writes, inside("SetCurrent"), 20));
  now = now.add({ seconds: 61 });
  assertEquals(telemetry.snapshot().telemetryValid, false);
  writes.length = 0;
  await cycle.tick();
  assert(has(writes, inside("StartStop"), 0));
});
