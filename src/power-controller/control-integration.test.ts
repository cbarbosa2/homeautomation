import { assert, assertEquals, assertRejects } from "@std/assert";
import { Temporal } from "../temporal.ts";
import {
  CONTROL_PATHS as P,
  ControlTelemetry,
  REFRESH_PATHS,
  wallboxPath,
} from "../control-telemetry.ts";
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
    for (const [path, value] of values) telemetry.record(path, { value });
  };
  refresh();
  const modes = new Map([[L.Inside, Mode.On], [L.Outside, Mode.On]]);
  const writes: Write[] = [];
  let onPublish: (write: Write) => Promise<void> = () => Promise.resolve();
  let reads = 0;
  const dependencies = {
    telemetry: () => {
      reads++;
      return telemetry.snapshot();
    },
    modes: () => modes,
    clock: () => now,
    enabled,
    publisher: {
      publishJson: async (topic: string, data: Record<string, unknown>) => {
        const write = {
          path: topic.split("/").slice(2).join("/"),
          value: data["value"],
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
    setTime: (value: string) => {
      now = Temporal.Instant.from(value);
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

Deno.test("cycle stops a pending start before telemetry arrives", async () => {
  const h = installation();
  assert(has(await h.tick(), inside("StartStop"), 1));
  h.modes.set(L.Inside, Mode.Off);
  const writes = await h.tick();
  assert(has(writes, inside("StartStop"), 0));
  assert(has(writes, P.batteryMaxChargePower, 0));
});

Deno.test("cycle reserves capacity until both settings and measured power confirm reduction", async () => {
  const h = installation();
  await h.tick();
  h.modes.set(L.Inside, Mode.Off);
  for (let i = 0; i < 20; i++) {
    h.advance();
    assert(!has(await h.tick(), outside("StartStop"), 1));
  }
  // A setting echo alone cannot release capacity.
  h.advance();
  for (const field of ["SetCurrent", "StartStop"]) {
    h.telemetry.record(inside(field), { value: 0 });
  }
  assert(!has(await h.tick(), outside("StartStop"), 1));
  h.advance();
  h.refresh();
  const writes = await h.tick();
  assert(has(writes, outside("SetCurrent"), 28));
  assert(has(writes, outside("StartStop"), 1));
});

Deno.test("cycle retains first-start priority through power pauses and resets it on restart", async () => {
  const h = installation();
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
  assert(has(await h.tick(), inside("SetCurrent"), 20));
});

Deno.test("cycle gives Inside the startup tie", async () => {
  const h = installation(true, true);
  const writes = await h.tick();
  assert(has(writes, inside("SetCurrent"), 20));
  assert(has(writes, outside("SetCurrent"), 8));
});

Deno.test("cycle transfers priority when the first charger becomes ineligible", async () => {
  for (
    const reason of ["off", "manual", "full", "disconnected", "fault", "mode"]
  ) {
    const h = installation();
    h.values.set(outside("Status"), S.Charging);
    h.advance();
    h.refresh();
    assert(has(await h.tick(), outside("SetCurrent"), 28), reason);
    if (reason === "off") h.modes.set(L.Outside, Mode.Off);
    if (reason === "manual") h.modes.set(L.Outside, Mode.Manual);
    if (reason === "mode") h.modes.set(L.Outside, Mode.SunOnly);
    if (reason === "full") h.values.set(outside("Status"), S.Charged);
    if (reason === "disconnected") {
      h.values.set(outside("Status"), S.Disconnected);
    }
    if (reason === "fault") h.values.set(outside("Status"), 8);
    assert(has(await h.settle(), inside("SetCurrent"), 20), reason);
  }
});

Deno.test("cycle uses one conservative budget and recovers after fresh readings", async () => {
  const h = installation();
  // Only grid is stale; charger status remains valid so On remains eligible.
  h.telemetry.record(P.gridPower, { value: null });
  let writes = await h.tick();
  assert(has(writes, inside("SetCurrent"), 12));
  assert(!has(writes, outside("StartStop"), 1));
  assert(
    !writes.some((w) =>
      w.path === P.batteryMaxChargePower && Number(w.value) > 0
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

Deno.test("cycle treats missing PV inverter power as zero", async () => {
  const night = installation();
  night.setTime("2026-09-27T21:00:00Z"); // 22:00 in Lisbon
  night.modes.set(L.Inside, Mode.Night);
  night.modes.set(L.Outside, Mode.Off);
  night.values.delete(P.pvInverterPower);
  night.refresh();
  assert(has(await night.tick(), inside("SetCurrent"), 20));

  const day = installation();
  day.values.delete(P.pvInverterPower);
  day.telemetry.record(P.pvInverterPower, { value: null });
  day.modes.set(L.Outside, Mode.Off);
  assert(has(await day.tick(), inside("SetCurrent"), 20));

  const missingGrid = installation();
  missingGrid.modes.set(L.Outside, Mode.Off);
  missingGrid.telemetry.record(P.gridPower, { value: null });
  assert(has(await missingGrid.tick(), inside("SetCurrent"), 12));
});

Deno.test("conservative allocation still enforces solar eligibility and funds battery last", async () => {
  const h = installation();
  h.modes.set(L.Inside, Mode.SunOnly);
  h.modes.set(L.Outside, Mode.Off);
  h.telemetry.record(P.gridPower, { value: null });
  const writes = await h.tick();
  assert(!has(writes, inside("StartStop"), 1));
  assert(has(writes, P.batteryMaxChargePower, 2880));
});

Deno.test("cycle publishes reductions before increases", async () => {
  const h = installation();
  h.values.set(P.batteryMaxChargePower, 2400);
  h.refresh();
  const writes = await h.tick();
  assertEquals(writes[0], { path: P.batteryMaxChargePower, value: 1920 });
  assert(has(writes.slice(1), inside("StartStop"), 1));
});

Deno.test("cycle checks live Manual mode during publication using its injected reader", async () => {
  const h = installation();
  h.onPublish(() => {
    h.modes.set(L.Inside, Mode.Manual);
    return Promise.resolve();
  });
  const writes = await h.tick();
  assert(has(writes, inside("SetCurrent"), 20));
  assert(!has(writes, inside("StartStop"), 1));
});

Deno.test("cycle preserves built commands for non-Manual mode changes during publication", async () => {
  const h = installation();
  h.onPublish(() => {
    h.modes.set(L.Inside, Mode.Off);
    return Promise.resolve();
  });
  assert(has(await h.tick(), inside("StartStop"), 1));
  assert(has(await h.tick(), inside("StartStop"), 0));
});

Deno.test("failed cycle aborts publication, retains reservations, and permits recovery", async () => {
  const h = installation();
  h.onPublish(() => Promise.reject(new Error("offline")));
  await assertRejects(h.tick, Error, "offline");
  assertEquals(h.writes.length, 1);
  h.onPublish(() => Promise.resolve());
  h.modes.set(L.Inside, Mode.Off);
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

Deno.test("failed reduction also aborts remaining reductions", async () => {
  const h = installation(true, true);
  h.modes.set(L.Inside, Mode.Off);
  h.modes.set(L.Outside, Mode.Off);
  h.onPublish(() => Promise.reject(new Error("offline")));
  await assertRejects(h.tick, Error, "offline");
  assertEquals(h.writes, [{ path: inside("StartStop"), value: 0 }]);
});

Deno.test("busy triggers are skipped without reading telemetry or queuing work", async () => {
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

Deno.test("disabled publication still advances reservations and smoothing", async () => {
  const h = installation(false);
  await h.tick();
  assertEquals(h.writes, []);
  h.enable();
  h.modes.set(L.Inside, Mode.Off);
  assert(has(await h.tick(), inside("StartStop"), 0));
  assert(!has(h.writes, outside("StartStop"), 1));
  h.advance();
  h.refresh();
  // Outside's earlier zero target still participates in its smoothing history.
  assert(!has(await h.tick(), outside("StartStop"), 1));
  assert(has(await h.settle(), outside("StartStop"), 1));
});

Deno.test("disabled publication still commits priority", async () => {
  const h = installation(false);
  h.values.set(outside("Status"), S.Charging);
  h.refresh();
  await h.tick();
  h.values.set(outside("Status"), S.Connected);
  h.values.set(inside("Status"), S.Charging);
  h.enable();
  assert(has(await h.settle(), outside("SetCurrent"), 28));
});

Deno.test("cycle uses Lisbon night boundaries in summer and winter", async () => {
  for (
    const [evening, morning] of [
      ["2026-09-27T21:00:00Z", "2026-09-28T07:00:00Z"],
      ["2026-12-01T22:00:00Z", "2026-12-02T08:00:00Z"],
    ]
  ) {
    const h = installation();
    h.modes.set(L.Inside, Mode.Night);
    h.modes.set(L.Outside, Mode.Off);
    h.setTime(evening);
    h.refresh();
    assert(has(await h.tick(), inside("StartStop"), 1));
    h.setTime(morning);
    h.refresh();
    assert(has(await h.tick(), inside("StartStop"), 0));
  }
});

Deno.test("cycle supplies rounded remaining Lisbon night hours to ESS Only", async () => {
  for (const [soc, starts] of [[38, false], [39, true]] as const) {
    const h = installation();
    h.modes.set(L.Inside, Mode.ESSOnly);
    h.modes.set(L.Outside, Mode.Off);
    h.values.set(P.batterySOC, soc);
    h.setTime("2026-09-27T22:00:00Z");
    h.refresh(); // Lisbon 23:00: nine hours left.
    assertEquals(has(await h.tick(), inside("StartStop"), 1), starts);
  }
});

Deno.test("cycle stops a starting charger below 10 A even before StartStop acknowledgment", async () => {
  const h = installation();
  h.values.set(inside("Status"), S.StartCharging);
  h.values.set(P.gridPower, 4560);
  h.refresh();
  assert(has(await h.tick(), inside("StartStop"), 0));
});
