import { assertEquals } from "@std/assert";
import {
  WallboxChargeMode as Mode,
  WallboxLocation as L,
  WallboxStatus as S,
} from "../globals.ts";
import {
  calculateTargetAmpsAndPriority,
  InputState,
} from "./dynamic-power-calculator.ts";

export function state(): InputState {
  return {
    primaryWallboxLocation: undefined,
    gridPower: 0,
    batteryMinSOC: 20,
    batterySOC: 50,
    batteryPower: 0,
    pvInverterPower: 0,
    pvChargerPower: 0,
    wallboxPower: new Map([[L.Inside, 0], [L.Outside, 0]]),
    wallboxVictronStatus: new Map([[L.Inside, S.Connected], [
      L.Outside,
      S.Connected,
    ]]),
    wallboxChargeMode: new Map([[L.Inside, Mode.On], [L.Outside, Mode.On]]),
    hourOfDay: 12,
  };
}

Deno.test("one grid budget gives Inside 20 A and battery the unusable start remainder", () => {
  const result = calculateTargetAmpsAndPriority(state());
  assertEquals(result.insideWallboxAmps, 20);
  assertEquals(result.outsideWallboxAmps, 0);
  assertEquals(result.batteryChargePower, 1920);
});

import { CommandBuilder } from "./command-builder.ts";
import { CommandType } from "./power-controller.ts";
Deno.test("an active charger stops even when measured power is zero", () => {
  const input = state();
  input.wallboxChargeMode.set(L.Inside, Mode.Off);
  input.wallboxVictronStatus.set(L.Inside, S.Charging);
  const commands = new CommandBuilder().createCommandsFromPowerSettings({
    ...input,
    batteryMaxChargePower: 0,
  }, calculateTargetAmpsAndPriority(input));
  assertEquals(
    commands.some((c) =>
      c.type === CommandType.InsideStartStop && c.value === 0
    ),
    true,
  );
});

Deno.test("grid-funded battery charging is not solar surplus", () => {
  const input = state();
  input.wallboxChargeMode = new Map([[L.Inside, Mode.SunOnly], [
    L.Outside,
    Mode.SunOnly,
  ]]);
  input.gridPower = 4000;
  input.batteryPower = 4000;
  input.pvInverterPower = 1000;
  assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 0);
});
Deno.test("DC solar is shared once, without an inverter-only gate", () => {
  const input = state();
  input.wallboxChargeMode = new Map([[L.Inside, Mode.SunOnly], [
    L.Outside,
    Mode.SunOnly,
  ]]);
  input.batteryPower = 6000;
  input.pvChargerPower = 6000;
  const result = calculateTargetAmpsAndPriority(input);
  assertEquals([result.insideWallboxAmps, result.outsideWallboxAmps], [20, 0]);
});
Deno.test("a grid spike fully curtails battery charging even above minimum SOC", () => {
  const input = state();
  input.gridPower = 8000;
  assertEquals(calculateTargetAmpsAndPriority(input).batteryChargePower, 0);
});
Deno.test("fractional headroom rounds down and start hysteresis applies before allocation", () => {
  const input = state();
  input.gridPower = 4500;
  assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 0);
  input.wallboxVictronStatus.set(L.Inside, S.Charging);
  assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 9);
  input.gridPower = 5040;
  assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 7);
  input.gridPower = 5041;
  assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 0);
});
Deno.test("fallback is one 12 A budget with evidence required for solar modes", () => {
  const input = state();
  input.gridPower = undefined;
  let result = calculateTargetAmpsAndPriority(input);
  assertEquals([
    result.insideWallboxAmps,
    result.outsideWallboxAmps,
    result.batteryChargePower,
  ], [12, 0, 0]);
  input.wallboxChargeMode.set(L.Inside, Mode.SunOnly);
  result = calculateTargetAmpsAndPriority(input);
  assertEquals([result.insideWallboxAmps, result.outsideWallboxAmps], [0, 12]);
});
Deno.test("Manual consumption stays in the grid baseline", () => {
  const input = state();
  input.gridPower = 4800;
  input.wallboxPower.set(L.Inside, 4800);
  input.wallboxChargeMode.set(L.Inside, Mode.Manual);
  const result = calculateTargetAmpsAndPriority(input);
  assertEquals([
    result.insideWallboxAmps,
    result.outsideWallboxAmps,
    result.batteryChargePower,
  ], [undefined, 0, 1920]);
});
Deno.test("first observed start owns priority, with Inside winning indistinguishable starts", () => {
  const input = state();
  input.wallboxVictronStatus = new Map([[L.Inside, S.Charging], [
    L.Outside,
    S.Charging,
  ]]);
  input.chargingStartedAt = new Map([[L.Inside, 20], [L.Outside, 10]]);
  assertEquals(
    calculateTargetAmpsAndPriority(input).priorityDecision,
    { kind: "set", location: L.Outside },
  );
  input.chargingStartedAt.set(L.Inside, 10);
  assertEquals(
    calculateTargetAmpsAndPriority(input).priorityDecision,
    { kind: "set", location: L.Inside },
  );
});
Deno.test("priority releases on full, disconnect, blocking and unknown statuses", () => {
  for (const status of [S.Charged, S.Disconnected, 8, 14, 999, undefined]) {
    const input = state();
    input.primaryWallboxLocation = L.Inside;
    if (status === undefined) input.wallboxVictronStatus.delete(L.Inside);
    else input.wallboxVictronStatus.set(L.Inside, status);
    assertEquals(
      calculateTargetAmpsAndPriority(input).priorityDecision,
      { kind: "set", location: L.Outside },
    );
  }
});
Deno.test("Off/Manual and mode ineligibility transfer priority, power pauses retain it", () => {
  for (const mode of [Mode.Off, Mode.Manual, Mode.SunOnly]) {
    const input = state();
    input.primaryWallboxLocation = L.Inside;
    input.wallboxChargeMode.set(L.Inside, mode);
    input.batterySOC = 20;
    assertEquals(
      calculateTargetAmpsAndPriority(input).priorityDecision,
      { kind: "set", location: L.Outside },
    );
  }
  const input = state();
  input.primaryWallboxLocation = L.Outside;
  input.gridPower = 9000;
  assertEquals(calculateTargetAmpsAndPriority(input).priorityDecision, {
    kind: "retain",
  });
  input.wallboxChargeMode = new Map([[L.Inside, Mode.Off], [
    L.Outside,
    Mode.Off,
  ]]);
  assertEquals(calculateTargetAmpsAndPriority(input).priorityDecision, {
    kind: "clear",
  });
});
Deno.test("mode SOC boundaries and night boundaries follow strict documented margins", () => {
  for (const mode of [Mode.SunOnly, Mode.ESSOnly, Mode.Night]) {
    const input = state();
    input.wallboxChargeMode.set(L.Inside, mode);
    input.pvChargerPower = 4800;
    input.batteryPower = 4800;
    input.batterySOC = 21;
    assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 0);
    input.batterySOC = 21.01;
    assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 20);
    input.batteryPower = 0;
    input.pvChargerPower = 0;
    input.batterySOC = 95;
    assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 20);
    input.batterySOC = 94.99;
    assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 0);
  }
  const input = state();
  input.wallboxChargeMode.set(L.Inside, Mode.ESSOnly);
  input.hourOfDay = 23.5;
  input.remainingNightHours = 9;
  input.batterySOC = 38;
  assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 0);
  input.batterySOC = 38.01;
  assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 20);
  input.wallboxChargeMode.set(L.Inside, Mode.Night);
  for (const [hour, amps] of [[21.99, 0], [22, 20], [7.99, 20], [8, 0]]) {
    input.hourOfDay = hour!;
    assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, amps);
  }
});

Deno.test("a charger still starting needs 10 A rather than the continuation threshold", () => {
  const input = state();
  input.gridPower = 4560; // 9 A available
  input.wallboxVictronStatus.set(L.Inside, S.StartCharging);
  assertEquals(calculateTargetAmpsAndPriority(input).insideWallboxAmps, 0);
});
