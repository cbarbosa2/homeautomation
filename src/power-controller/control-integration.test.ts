import { Temporal } from "../temporal.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CONTROL_PATHS,
  ControlTelemetry,
  REFRESH_PATHS,
  VICTRON_PORTAL_ID,
  wallboxPath,
} from "../control-telemetry.ts";
import {
  globals,
  WallboxChargeMode as Mode,
  WallboxLocation as L,
  WallboxStatus as S,
} from "../globals.ts";
import { CommandBuilder } from "./command-builder.ts";
import { calculateTargetAmpsAndPriority } from "./dynamic-power-calculator.ts";
import { CommandType, PowerCommand, runCommands } from "./power-controller.ts";

function installation() {
  let now = Temporal.Instant.from("2026-09-27T12:00:00Z");
  const telemetry = new ControlTelemetry(() => now);
  const record = (path: string, value: unknown) =>
    telemetry.record(`N/${VICTRON_PORTAL_ID}/${path}`, { value });
  const values = new Map<string, number>(REFRESH_PATHS.map((p) => [p, 0]));
  values.set(CONTROL_PATHS.batterySOC, 50);
  values.set(CONTROL_PATHS.batteryMinSOC, 20);
  for (const l of [L.Inside, L.Outside]) {
    values.set(wallboxPath(l, "Status"), S.Connected);
    values.set(wallboxPath(l, "SetCurrent"), 10);
  }
  const refresh = () => {
    for (const [p, v] of values) record(p, v);
  };
  refresh();
  const modes = new Map([[L.Inside, Mode.On], [L.Outside, Mode.On]]);
  const builder = new CommandBuilder(() => now);
  const input = () => ({
    ...telemetry.snapshot(),
    wallboxChargeMode: modes,
    timeOfDay: Temporal.PlainTime.from("12:00"),
  });
  const tick = () =>
    builder.createCommandsFromPowerSettings(
      input(),
      calculateTargetAmpsAndPriority(input()),
    );
  return {
    telemetry,
    record,
    values,
    refresh,
    modes,
    input,
    tick,
    advance: (duration = Temporal.Duration.from({ seconds: 1 })) => {
      now = now.add(duration);
    },
  };
}
Deno.test("pending start is explicitly stopped before its telemetry arrives", () => {
  const h = installation();
  assert(
    h.tick().some((c) =>
      c.type === CommandType.InsideStartStop && c.value === 1
    ),
  );
  h.modes.set(L.Inside, Mode.Off);
  const commands = h.tick();
  assert(
    commands.some((c) =>
      c.type === CommandType.InsideStartStop && c.value === 0
    ),
  );
  assert(
    commands.some((c) =>
      c.type === CommandType.BatteryMaxChargePower && c.value === 0
    ),
  );
});
Deno.test("released capacity waits for fresh device confirmation before transfer", async () => {
  const h = installation();
  const output: { topic: string; value: unknown }[] = [];
  const publish = async (commands: PowerCommand[]) =>
    await runCommands(commands, {
      publishJson: (topic, data) => {
        output.push({ topic, value: data["value"] });
        return Promise.resolve();
      },
    }, true);
  await publish(h.tick());
  h.modes.set(L.Inside, Mode.Off);
  for (let i = 0; i < 20; i++) {
    h.advance();
    const commands = h.tick();
    assert(
      !commands.some((c) =>
        c.type === CommandType.OutsideStartStop && c.value === 1
      ),
    );
    await publish(commands);
  }
  h.advance();
  h.refresh();
  await publish(h.tick());
  assert(
    output.some((c) =>
      c.topic.endsWith("evcharger/41/SetCurrent") && c.value === 28
    ),
  );
  assert(
    output.some((c) =>
      c.topic.endsWith("evcharger/41/StartStop") && c.value === 1
    ),
  );
});
Deno.test("stale, invalid, disconnected and recovered readings change shared allocation", () => {
  const h = installation();
  assertEquals(calculateTargetAmpsAndPriority(h.input()).insideWallboxAmps, 20);
  h.advance(Temporal.Duration.from({ seconds: 60, milliseconds: 1 }));
  assertEquals(
    calculateTargetAmpsAndPriority(h.input()).batteryChargePower,
    2880,
  );
  h.refresh();
  h.record(CONTROL_PATHS.gridPower, null);
  assertEquals(calculateTargetAmpsAndPriority(h.input()).insideWallboxAmps, 12);
  for (const invalid of [NaN, Infinity, "0", {}, undefined]) {
    h.record(CONTROL_PATHS.gridPower, invalid);
    assertEquals(h.telemetry.value(CONTROL_PATHS.gridPower), undefined);
  }
  h.refresh();
  assertEquals(calculateTargetAmpsAndPriority(h.input()).insideWallboxAmps, 20);
  h.telemetry.invalidate();
  assertEquals(h.telemetry.value(CONTROL_PATHS.gridPower), undefined);
});
Deno.test("telemetry freshness includes exactly 60 seconds and rejects future readings", () => {
  let now = Temporal.Instant.from("2026-09-27T12:00:00Z");
  const recordedAt = now;
  const telemetry = new ControlTelemetry(() => now);
  telemetry.record(CONTROL_PATHS.gridPower, { value: 100 });
  now = recordedAt.add({ seconds: 60 });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), 100);
  now = now.add({ nanoseconds: 1 });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
  now = recordedAt.subtract({ nanoseconds: 1 });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
});
Deno.test("telemetry preserves actual start order and startup ties", () => {
  const h = installation();
  h.advance();
  h.record(wallboxPath(L.Outside, "Status"), S.Charging);
  h.advance();
  h.record(wallboxPath(L.Inside, "Status"), S.Charging);
  assertEquals(
    calculateTargetAmpsAndPriority(h.input()).priorityDecision,
    { kind: "set", location: L.Outside },
  );
  const startup = new ControlTelemetry();
  startup.record(wallboxPath(L.Outside, "Status"), { value: S.Charging });
  startup.record(wallboxPath(L.Inside, "Status"), { value: S.Charging });
  assertEquals(
    [...startup.snapshot().chargingStartedAt.values()].map((at) =>
      at.toString()
    ),
    ["1970-01-01T00:00:00Z", "1970-01-01T00:00:00Z"],
  );
});
Deno.test("Manual gate is checked again during asynchronous publication", async () => {
  const previous = globals.wallboxChargeMode.get(L.Inside)!;
  const published: string[] = [];
  try {
    globals.wallboxChargeMode.set(L.Inside, Mode.On);
    await runCommands([{ type: CommandType.BatteryMaxChargePower, value: 0 }, {
      type: CommandType.InsideCurrent,
      value: 20,
    }], {
      publishJson: (topic) => {
        published.push(topic);
        globals.wallboxChargeMode.set(L.Inside, Mode.Manual);
        return Promise.resolve();
      },
    }, true);
    assertEquals(published.length, 1);
  } finally {
    globals.wallboxChargeMode.set(L.Inside, previous);
  }
});
Deno.test("MQTT failure aborts later increases and is observable", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      runCommands([{ type: CommandType.BatteryMaxChargePower, value: 0 }, {
        type: CommandType.InsideCurrent,
        value: 20,
      }], {
        publishJson: () => {
          calls++;
          return Promise.reject(new Error("offline"));
        },
      }, true),
    Error,
    "offline",
  );
  assertEquals(calls, 1);
});

Deno.test("a starting charger is stopped below 10 A even if StartStop still reports zero", () => {
  const h = installation();
  h.record(wallboxPath(L.Inside, "Status"), S.StartCharging);
  h.record(CONTROL_PATHS.gridPower, 4560);
  const commands = h.tick();
  assert(
    commands.some((c) =>
      c.type === CommandType.InsideStartStop && c.value === 0
    ),
  );
});
