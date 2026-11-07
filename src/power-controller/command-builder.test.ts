import { test } from "node:test";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { Temporal } from "../temporal.ts";
import { WallboxLocation, WallboxStatus } from "../globals.ts";
import { CONTROL_PATHS } from "../control-telemetry.ts";
import { type CalculatedTargetResults } from "./dynamic-power-calculator.ts";
import { CommandBuilder, type SystemState } from "./command-builder.ts";
import { CommandType, type PowerCommand } from "./power-controller.ts";

function createSystemState(overrides?: Partial<SystemState>): SystemState {
  return {
    batteryMaxChargePower: undefined,
    wallboxPower: new Map(),
    wallboxVictronStatus: new Map([
      [WallboxLocation.Inside, WallboxStatus.Charging],
      [WallboxLocation.Outside, WallboxStatus.Charging],
    ]),
    ...overrides,
  };
}

function createTargets(
  overrides?: Partial<CalculatedTargetResults>,
): CalculatedTargetResults {
  return {
    insideWallboxAmps: undefined,
    outsideWallboxAmps: undefined,
    batteryChargePower: undefined,
    priorityDecision: { kind: "retain" },
    ...overrides,
  };
}

test("CommandBuilder should create wallbox current commands", () => {
  const builder = new CommandBuilder();
  const state = createSystemState({
    wallboxPower: new Map([[WallboxLocation.Inside, 2300]]), // ~10 amps
  });
  const targets = createTargets({
    insideWallboxAmps: 15,
  });

  const commands = builder.createCommandsFromPowerSettings(state, targets);

  assertEquals(commands.length, 1);
  assertEquals(commands[0]!.type, CommandType.InsideCurrent);
  assertEquals(commands[0]!.value, 15);
});

test("CommandBuilder should create start/stop commands", () => {
  const builder = new CommandBuilder();
  const state = createSystemState({
    wallboxVictronStatus: new Map([
      [WallboxLocation.Inside, WallboxStatus.Connected],
    ]),
  });
  const targets = createTargets({
    insideWallboxAmps: 10, // Minimum start threshold
  });

  const commands = builder.createCommandsFromPowerSettings(state, targets);

  assertEquals(commands.length, 2);
  const startStopCommand = commands.find(
    (cmd) => cmd.type === CommandType.InsideStartStop,
  );
  const currentCommand = commands.find(
    (cmd) => cmd.type === CommandType.InsideCurrent,
  );

  assertEquals(startStopCommand?.value, 1); // Start
  assertEquals(currentCommand?.value, 10);
});

test("CommandBuilder should create stop commands for low target amps", () => {
  const builder = new CommandBuilder();
  const state = createSystemState({
    wallboxPower: new Map([[WallboxLocation.Inside, 1380]]), // ~6 amps
  });
  const targets = createTargets({
    insideWallboxAmps: 2, // Below continuation threshold (7)
  });

  const commands = builder.createCommandsFromPowerSettings(state, targets);

  assertEquals(commands.length, 1);
  const startStopCommand = commands.find(
    (cmd) => cmd.type === CommandType.InsideStartStop,
  );
  const currentCommand = commands.find(
    (cmd) => cmd.type === CommandType.InsideCurrent,
  );

  assertEquals(startStopCommand?.value, 0); // Stop
  assertEquals(currentCommand, undefined); // Stop without raising the current limit
});

test("CommandBuilder should create battery commands when power changes", () => {
  const builder = new CommandBuilder();
  const state = createSystemState({
    batteryMaxChargePower: 1000,
  });
  const targets = createTargets({
    batteryChargePower: 1500,
  });

  const commands = builder.createCommandsFromPowerSettings(state, targets);

  assertEquals(commands.length, 1);
  assertEquals(commands[0]!.type, CommandType.BatteryMaxChargePower);
  assertEquals(commands[0]!.value, 1500);
});

test("CommandBuilder should not create battery commands when power is unchanged", () => {
  const builder = new CommandBuilder();
  const state = createSystemState({
    batteryMaxChargePower: 1000,
  });
  const targets = createTargets({
    batteryChargePower: 1000, // Same as current
  });

  const commands = builder.createCommandsFromPowerSettings(state, targets);

  assertEquals(commands.length, 0);
});

test("CommandBuilder should limit history to maximum size", () => {
  const builder = new CommandBuilder();
  const state = createSystemState();

  builder.createCommandsFromPowerSettings(
    state,
    createTargets({ insideWallboxAmps: 10 }),
  );
  for (let i = 0; i < 14; i++) {
    const commands = builder.createCommandsFromPowerSettings(
      state,
      createTargets({ insideWallboxAmps: 20 }),
    );
    assertEquals(commands[0]!.value, 10);
  }
  const commands = builder.createCommandsFromPowerSettings(
    state,
    createTargets({ insideWallboxAmps: 20 }),
  );
  assertEquals(commands[0]!.value, 20);
});

test("CommandBuilder should handle both wallbox locations independently", () => {
  const builder = new CommandBuilder();
  const state = createSystemState();

  const targets = createTargets({
    insideWallboxAmps: 15,
    outsideWallboxAmps: 8,
  });

  const commands = builder.createCommandsFromPowerSettings(state, targets);

  assertEquals(commands.length, 2);
  const insideCommand = commands.find(
    (cmd) => cmd.type === CommandType.InsideCurrent,
  );
  const outsideCommand = commands.find(
    (cmd) => cmd.type === CommandType.OutsideCurrent,
  );

  assertEquals(insideCommand?.value, 15);
  assertEquals(outsideCommand?.value, 8);
});

test("CommandBuilder should not create commands when target equals current", () => {
  const builder = new CommandBuilder();
  const state = createSystemState({
    wallboxPower: new Map([[WallboxLocation.Inside, 2300]]),
    wallboxSetCurrent: new Map([[WallboxLocation.Inside, 10]]),
  });
  const targets = createTargets({
    insideWallboxAmps: 10, // Same as current
  });

  const commands = builder.createCommandsFromPowerSettings(state, targets);

  assertEquals(commands.length, 0);
});

test("Manual transition clears populated command history", () => {
  const builder = new CommandBuilder();
  const state = createSystemState();
  builder.createCommandsFromPowerSettings(
    state,
    createTargets({ insideWallboxAmps: 20 }),
  );
  assertEquals(
    builder.createCommandsFromPowerSettings(state, createTargets()),
    [],
  );
});

test("battery reduction releases capacity despite changing targets and staggered telemetry", () => {
  let now = Temporal.Instant.from("2026-11-07T10:00:00Z");
  const builder = new CommandBuilder(() => now);
  const observedAt = new Map([
    [CONTROL_PATHS.batteryMaxChargePower, now],
    [CONTROL_PATHS.batteryPower, now],
  ]);
  const state = createSystemState({
    batteryMaxChargePower: 6720,
    batteryPower: 0,
    wallboxVictronStatus: new Map([
      [WallboxLocation.Inside, WallboxStatus.Disconnected],
      [WallboxLocation.Outside, WallboxStatus.WaitingForStart],
    ]),
    wallboxPower: new Map([
      [WallboxLocation.Inside, 0],
      [WallboxLocation.Outside, 0],
    ]),
    wallboxSetCurrent: new Map([
      [WallboxLocation.Inside, 19],
      [WallboxLocation.Outside, 7],
    ]),
    wallboxStartStop: new Map([
      [WallboxLocation.Inside, 0],
      [WallboxLocation.Outside, 0],
    ]),
    observedAt,
  });
  const targets = createTargets({
    insideWallboxAmps: 0,
    outsideWallboxAmps: 30,
    batteryChargePower: 200,
    sharedBudgetWatts: 7200,
  });

  builder.createCommandsFromPowerSettings(state, targets);
  let commands: PowerCommand[] = [];
  for (let second = 1; second <= 47; second++) {
    now = now.add({ seconds: 1 });
    targets.batteryChargePower = 200 + (second % 2);
    if (second === 30) {
      state.batteryMaxChargePower = 200;
      observedAt.set(CONTROL_PATHS.batteryMaxChargePower, now);
    }
    if (second === 31) {
      state.batteryPower = 720;
      observedAt.set(CONTROL_PATHS.batteryPower, now);
    }
    commands = builder.createCommandsFromPowerSettings(state, targets);
  }

  assert(
    commands.some(
      (command) =>
        command.type === CommandType.OutsideCurrent && command.value >= 10,
    ),
  );
  assert(
    commands.some(
      (command) =>
        command.type === CommandType.OutsideStartStop && command.value === 1,
    ),
  );
});
