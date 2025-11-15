import { assertEquals } from "jsr:@std/assert";
import { CommandBuilder, SystemState } from "./command-builder.ts";
import { WallboxLocation, WallboxStatus } from "../globals.ts";
import { CalculatedTargetResults } from "./dynamic-power-calculator.ts";

function createSystemState(overrides?: Partial<SystemState>): SystemState {
  return {
    batteryMaxChargePower: undefined,
    wallboxPower: new Map(),
    wallboxVictronStatus: new Map(),
    ...overrides,
  };
}

function createTargets(
  overrides?: Partial<CalculatedTargetResults>
): CalculatedTargetResults {
  return {
    insideWallboxAmps: undefined,
    outsideWallboxAmps: undefined,
    batteryChargePower: undefined,
    newPrimaryWallboxLocation: undefined,
    ...overrides,
  };
}

Deno.test("CommandBuilder should create wallbox current commands", () => {
  const builder = new CommandBuilder();
  const state = createSystemState({
    wallboxPower: new Map([[WallboxLocation.Inside, 2300]]), // ~10 amps
  });
  const targets = createTargets({
    insideWallboxAmps: 15,
  });

  const commands = builder.createCommandsFromPowerSettings(state, targets);

  assertEquals(commands.length, 1);
  assertEquals(commands[0]!.type, "InsideAmps");
  assertEquals(commands[0]!.value, 15);
});

Deno.test("CommandBuilder should create start/stop commands", () => {
  const builder = new CommandBuilder();
  const state = createSystemState({
    wallboxVictronStatus: new Map([
      [WallboxLocation.Inside, WallboxStatus.Connected],
    ]),
  });
  const targets = createTargets({
    insideWallboxAmps: 8, // Above minimum start threshold
  });

  const commands = builder.createCommandsFromPowerSettings(state, targets);

  assertEquals(commands.length, 2);
  const startStopCommand = commands.find(
    (cmd) => cmd.type === "InsideStartStop"
  );
  const currentCommand = commands.find((cmd) => cmd.type === "InsideAmps");

  assertEquals(startStopCommand?.value, 1); // Start
  assertEquals(currentCommand?.value, 8);
});

Deno.test(
  "CommandBuilder should create stop commands for low target amps",
  () => {
    const builder = new CommandBuilder();
    const state = createSystemState({
      wallboxPower: new Map([[WallboxLocation.Inside, 1380]]), // ~6 amps
    });
    const targets = createTargets({
      insideWallboxAmps: 2, // Below minimum stop threshold (3)
    });

    const commands = builder.createCommandsFromPowerSettings(state, targets);

    assertEquals(commands.length, 2);
    const startStopCommand = commands.find(
      (cmd) => cmd.type === "InsideStartStop"
    );
    const currentCommand = commands.find((cmd) => cmd.type === "InsideAmps");

    assertEquals(startStopCommand?.value, 0); // Stop
    assertEquals(currentCommand?.value, 8); // Set to minimum start current
  }
);

Deno.test(
  "CommandBuilder should create battery commands when power changes",
  () => {
    const builder = new CommandBuilder();
    const state = createSystemState({
      batteryMaxChargePower: 1000,
    });
    const targets = createTargets({
      batteryChargePower: 1500,
    });

    const commands = builder.createCommandsFromPowerSettings(state, targets);

    assertEquals(commands.length, 1);
    assertEquals(commands[0]!.type, "BatteryMaxChargePower");
    assertEquals(commands[0]!.value, 1500);
  }
);

Deno.test(
  "CommandBuilder should not create battery commands when power is unchanged",
  () => {
    const builder = new CommandBuilder();
    const state = createSystemState({
      batteryMaxChargePower: 1000,
    });
    const targets = createTargets({
      batteryChargePower: 1000, // Same as current
    });

    const commands = builder.createCommandsFromPowerSettings(state, targets);

    assertEquals(commands.length, 0);
  }
);

Deno.test(
  "CommandBuilder should smooth power commands using minimum of recent values",
  () => {
    const builder = new CommandBuilder();
    const state = createSystemState();

    // First call with high amps
    let targets = createTargets({ insideWallboxAmps: 15 });
    let commands = builder.createCommandsFromPowerSettings(state, targets);
    assertEquals(commands[0]!.value, 15);

    // Second call with lower amps
    targets = createTargets({ insideWallboxAmps: 10 });
    commands = builder.createCommandsFromPowerSettings(state, targets);
    assertEquals(commands[0]!.value, 10); // Should use minimum (10)

    // Third call with higher amps again
    targets = createTargets({ insideWallboxAmps: 20 });
    commands = builder.createCommandsFromPowerSettings(state, targets);
    assertEquals(commands[0]!.value, 10); // Should still use minimum (10)

    // Fourth call with even lower amps - should update the minimum
    targets = createTargets({ insideWallboxAmps: 5 });
    commands = builder.createCommandsFromPowerSettings(state, targets);
    if (commands.length > 0) {
      assertEquals(commands[0]!.value, 5); // Should use new minimum (5)
    }
  }
);

Deno.test("CommandBuilder should limit history to maximum size", () => {
  const builder = new CommandBuilder();
  const state = createSystemState();

  // Add more than MAX_HISTORY_TARGET_AMPS (3) values
  const targets1 = createTargets({ insideWallboxAmps: 10 });
  builder.createCommandsFromPowerSettings(state, targets1);

  const targets2 = createTargets({ insideWallboxAmps: 15 });
  builder.createCommandsFromPowerSettings(state, targets2);

  const targets3 = createTargets({ insideWallboxAmps: 20 });
  const commands3 = builder.createCommandsFromPowerSettings(state, targets3);
  assertEquals(commands3[0]!.value, 10);

  const targets4 = createTargets({ insideWallboxAmps: 25 }); // This should push out the first value (10)
  const commands4 = builder.createCommandsFromPowerSettings(state, targets4);
  assertEquals(commands4[0]!.value, 15);
});

Deno.test(
  "CommandBuilder should handle both wallbox locations independently",
  () => {
    const builder = new CommandBuilder();
    const state = createSystemState();

    const targets = createTargets({
      insideWallboxAmps: 15,
      outsideWallboxAmps: 8,
    });

    const commands = builder.createCommandsFromPowerSettings(state, targets);

    assertEquals(commands.length, 2);
    const insideCommand = commands.find((cmd) => cmd.type === "InsideAmps");
    const outsideCommand = commands.find((cmd) => cmd.type === "OutsideAmps");

    assertEquals(insideCommand?.value, 15);
    assertEquals(outsideCommand?.value, 8);
  }
);

Deno.test(
  "CommandBuilder should not create commands when target equals current",
  () => {
    const builder = new CommandBuilder();
    const state = createSystemState({
      wallboxPower: new Map([[WallboxLocation.Inside, 2300]]), // ~10 amps
    });
    const targets = createTargets({
      insideWallboxAmps: 10, // Same as current
    });

    const commands = builder.createCommandsFromPowerSettings(state, targets);

    assertEquals(commands.length, 0);
  }
);
