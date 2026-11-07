import { test } from "node:test";
import { Temporal } from "../temporal.ts";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  WallboxChargeMode as Mode,
  WallboxLocation as L,
  WallboxStatus as S,
} from "../globals.ts";
import {
  calculatePowerTargets,
  type InputState,
} from "./dynamic-power-calculator.ts";

export function state(): InputState {
  return {
    preferredWallboxLocation: L.Inside,
    gridPower: 0,
    batteryMinSOC: 20,
    batterySOC: 50,
    batteryPower: 0,
    pvInverterPower: 0,
    pvChargerPower: 0,
    wallboxPower: new Map([
      [L.Inside, 0],
      [L.Outside, 0],
    ]),
    wallboxVictronStatus: new Map([
      [L.Inside, S.Connected],
      [L.Outside, S.Connected],
    ]),
    wallboxChargeMode: new Map([
      [L.Inside, Mode.Max],
      [L.Outside, Mode.Max],
    ]),
    timeOfDay: Temporal.PlainTime.from("12:00"),
  };
}

test("one grid budget gives Inside 20 A and battery the unusable start remainder", () => {
  const result = calculatePowerTargets(state());
  assertEquals(result.insideWallboxAmps, 20);
  assertEquals(result.outsideWallboxAmps, 0);
  assertEquals(result.batteryChargePower, 1920);
});

import { CommandBuilder } from "./command-builder.ts";
import { CommandType } from "./power-controller.ts";
test("an active charger stops even when measured power is zero", () => {
  const input = state();
  input.wallboxChargeMode.set(L.Inside, Mode.Sun);
  input.wallboxVictronStatus.set(L.Inside, S.Charging);
  const commands = new CommandBuilder().createCommandsFromPowerSettings(
    {
      ...input,
      batteryMaxChargePower: 0,
    },
    calculatePowerTargets(input),
  );
  assertEquals(
    commands.some(
      (c) => c.type === CommandType.InsideStartStop && c.value === 0,
    ),
    true,
  );
});

test("grid-funded battery charging is not solar surplus", () => {
  const input = state();
  input.wallboxChargeMode = new Map([
    [L.Inside, Mode.Sun],
    [L.Outside, Mode.Sun],
  ]);
  input.gridPower = 4000;
  input.batteryPower = 4000;
  input.pvInverterPower = 1000;
  assertEquals(calculatePowerTargets(input).insideWallboxAmps, 0);
});
test("DC solar is shared once, without an inverter-only gate", () => {
  const input = state();
  input.wallboxChargeMode = new Map([
    [L.Inside, Mode.Sun],
    [L.Outside, Mode.Sun],
  ]);
  input.batteryPower = 6000;
  input.pvChargerPower = 6000;
  const result = calculatePowerTargets(input);
  assertEquals([result.insideWallboxAmps, result.outsideWallboxAmps], [20, 0]);
});
test("a grid spike fully curtails battery charging even above minimum SOC", () => {
  const input = state();
  input.gridPower = 8000;
  assertEquals(calculatePowerTargets(input).batteryChargePower, 0);
});
test("fractional headroom rounds down and start hysteresis applies before allocation", () => {
  const input = state();
  input.gridPower = 4500;
  assertEquals(calculatePowerTargets(input).insideWallboxAmps, 0);
  input.wallboxVictronStatus.set(L.Inside, S.Charging);
  assertEquals(calculatePowerTargets(input).insideWallboxAmps, 9);
  input.gridPower = 5040;
  assertEquals(calculatePowerTargets(input).insideWallboxAmps, 7);
  input.gridPower = 5041;
  assertEquals(calculatePowerTargets(input).insideWallboxAmps, 0);
});
test("fallback is one 12 A budget with evidence required for solar modes", () => {
  const input = state();
  input.gridPower = undefined;
  let result = calculatePowerTargets(input);
  assertEquals(
    [
      result.insideWallboxAmps,
      result.outsideWallboxAmps,
      result.batteryChargePower,
    ],
    [12, 0, 0],
  );
  input.wallboxChargeMode.set(L.Inside, Mode.Sun);
  result = calculatePowerTargets(input);
  assertEquals([result.insideWallboxAmps, result.outsideWallboxAmps], [0, 12]);
});
test("Manual consumption stays in the grid baseline", () => {
  const input = state();
  input.gridPower = 4800;
  input.wallboxPower.set(L.Inside, 4800);
  input.wallboxChargeMode.set(L.Inside, Mode.Manual);
  const result = calculatePowerTargets(input);
  assertEquals(
    [
      result.insideWallboxAmps,
      result.outsideWallboxAmps,
      result.batteryChargePower,
    ],
    [undefined, 0, 1920],
  );
});
test("preference determines allocation for both normal and conservative budgets", () => {
  for (const telemetryValid of [true, false]) {
    const input = state();
    input.telemetryValid = telemetryValid;
    input.preferredWallboxLocation = L.Outside;
    assertEquals(
      calculatePowerTargets(input).outsideWallboxAmps,
      telemetryValid ? 28 : 12,
    );
    assertEquals(calculatePowerTargets(input).insideWallboxAmps, 0);
    input.preferredWallboxLocation = L.Inside;
    assertEquals(
      calculatePowerTargets(input).insideWallboxAmps,
      telemetryValid ? 20 : 12,
    );
  }
});

test("preferred charger resumes allocation after temporary ineligibility", () => {
  for (const status of [S.Charged, S.Disconnected, 8, 14, undefined]) {
    const input = state();
    input.preferredWallboxLocation = L.Outside;
    if (status === undefined) input.wallboxVictronStatus.delete(L.Outside);
    else input.wallboxVictronStatus.set(L.Outside, status);
    assertEquals(
      calculatePowerTargets(input).insideWallboxAmps,
      status === undefined ? 12 : 20,
    );
    input.wallboxVictronStatus.set(L.Outside, S.Connected);
    assertEquals(calculatePowerTargets(input).outsideWallboxAmps, 28);
  }
  for (const mode of [Mode.Reserve, Mode.Manual, Mode.Sun]) {
    const input = state();
    input.preferredWallboxLocation = L.Outside;
    input.wallboxChargeMode.set(L.Outside, mode);
    input.batterySOC = 20;
    assertEquals(calculatePowerTargets(input).insideWallboxAmps, 20);
    input.wallboxChargeMode.set(L.Outside, Mode.Max);
    assertEquals(calculatePowerTargets(input).outsideWallboxAmps, 28);
  }
});

test("mode SOC boundaries and night boundaries follow strict documented margins", () => {
  for (const mode of [Mode.Sun, Mode.Reserve, Mode.Night]) {
    const input = state();
    input.wallboxChargeMode.set(L.Inside, mode);
    input.wallboxChargeMode.set(L.Outside, Mode.Manual);
    input.pvChargerPower = 4800;
    input.batteryPower = 4800;
    input.batterySOC = 21;
    assertEquals(calculatePowerTargets(input).insideWallboxAmps, 0);
    input.batterySOC = 21.01;
    assertEquals(calculatePowerTargets(input).insideWallboxAmps, 20);
    input.batteryPower = 0;
    input.pvChargerPower = 0;
    input.batterySOC = 95;
    assertEquals(calculatePowerTargets(input).insideWallboxAmps, 0);
    input.batterySOC = 95.01;
    input.batterySupportWatts = 2400;
    assertEquals(calculatePowerTargets(input).insideWallboxAmps, 10);
    input.batterySOC = 94.99;
    assertEquals(calculatePowerTargets(input).insideWallboxAmps, 0);
  }
  const input = state();
  input.wallboxChargeMode.set(L.Inside, Mode.Reserve);
  input.wallboxChargeMode.set(L.Outside, Mode.Manual);
  input.batterySupportWatts = 4800;
  input.timeOfDay = Temporal.PlainTime.from("23:30");
  input.remainingNight = Temporal.Duration.from({ hours: 9 });
  input.batterySOC = 38;
  assertEquals(calculatePowerTargets(input).insideWallboxAmps, 0);
  input.batterySOC = 38.01;
  assertEquals(calculatePowerTargets(input).insideWallboxAmps, 20);
  input.wallboxChargeMode.set(L.Inside, Mode.Night);
  for (const [hour, amps] of [
    ["21:59:24", 0],
    ["22:00", 20],
    ["07:59:24", 20],
    ["08:00", 0],
  ] as const) {
    input.timeOfDay = Temporal.PlainTime.from(hour);
    assertEquals(calculatePowerTargets(input).insideWallboxAmps, amps);
  }
});

test("a charger still starting needs 10 A rather than the continuation threshold", () => {
  const input = state();
  input.gridPower = 4560; // 9 A available
  input.wallboxVictronStatus.set(L.Inside, S.StartCharging);
  assertEquals(calculatePowerTargets(input).insideWallboxAmps, 0);
});
