import { assertEquals } from "@std/assert";
import {
  calculateTargetAmpsAndPriority,
  InputState,
} from "./dynamic-power-calculator.ts";
import {
  WallboxChargeMode,
  WallboxLocation,
  WallboxStatus,
} from "../globals.ts";
import {
  MAX_BATTERY_CHARGE_POWER,
  MIN_BATTERY_CHARGE_POWER,
} from "./power-constants.ts";

function createDefaultState(): InputState {
  return {
    primaryWallboxLocation: WallboxLocation.Inside,
    gridPower: 0,
    batteryMinSOC: 20,
    batterySOC: 50,
    batteryPower: 0,
    pvInverterPower: 1000,
    wallboxPower: new Map([
      [WallboxLocation.Inside, 0],
      [WallboxLocation.Outside, 0],
    ]),
    wallboxVictronStatus: new Map([
      [WallboxLocation.Inside, WallboxStatus.Connected],
      [WallboxLocation.Outside, WallboxStatus.Connected],
    ]),
    wallboxChargeMode: new Map([
      [WallboxLocation.Inside, WallboxChargeMode.SunOnly],
      [WallboxLocation.Outside, WallboxChargeMode.SunOnly],
    ]),
    hourOfDay: 12,
  };
}

Deno.test("calculateTargetAmpsAndPriority basic SunOnly", () => {
  const state = createDefaultState();
  const result = calculateTargetAmpsAndPriority(state);
  assertEquals(typeof result.insideWallboxAmps, "number");
  assertEquals(typeof result.outsideWallboxAmps, "number");
  assertEquals(typeof result.batteryChargePower, "number");
  assertEquals(result.newPrimaryWallboxLocation, undefined);
});

Deno.test("calculateTargetAmpsAndPriority Off disables charging", () => {
  const state = createDefaultState();
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Off);
  const result = calculateTargetAmpsAndPriority(state);
  assertEquals(result.insideWallboxAmps, 0);
});

Deno.test("calculateTargetAmpsAndPriority Night mode off-peak", () => {
  const state = createDefaultState();
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Night);
  state.hourOfDay = 23;
  const result = calculateTargetAmpsAndPriority(state);
  assertEquals(typeof result.insideWallboxAmps, "number");
});

Deno.test("calculateTargetAmpsAndPriority changes primary wallbox", () => {
  const state = createDefaultState();
  // Simulate concedePriority for inside, not for outside
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Off);
  state.wallboxChargeMode.set(WallboxLocation.Outside, WallboxChargeMode.On);
  const result = calculateTargetAmpsAndPriority(state);
  assertEquals(result.newPrimaryWallboxLocation, WallboxLocation.Outside);
});

Deno.test("batteryChargePower with moderate grid power", () => {
  const state = {
    ...createDefaultState(),
    gridPower: 2000,
    batteryMinSOC: 55,
    hourOfDay: 23,
  };
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Off);
  state.wallboxChargeMode.set(WallboxLocation.Outside, WallboxChargeMode.Off);

  const result = calculateTargetAmpsAndPriority(state);
  assertEquals(result.batteryChargePower, 4720);
});

Deno.test("batteryChargePower with no grid power", () => {
  const state = {
    ...createDefaultState(),
    gridPower: 0,
    batteryMinSOC: 55,
    hourOfDay: 23,
  };
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Off);
  state.wallboxChargeMode.set(WallboxLocation.Outside, WallboxChargeMode.Off);

  assertEquals(
    calculateTargetAmpsAndPriority(state).batteryChargePower,
    MAX_BATTERY_CHARGE_POWER
  );
});

Deno.test("batteryChargePower with high grid power", () => {
  const state = {
    ...createDefaultState(),
    gridPower: 7000,
    batteryMinSOC: 55,
    hourOfDay: 23,
  };
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Off);
  state.wallboxChargeMode.set(WallboxLocation.Outside, WallboxChargeMode.Off);

  assertEquals(
    calculateTargetAmpsAndPriority(state).batteryChargePower,
    MIN_BATTERY_CHARGE_POWER
  );
});

Deno.test("batteryChargePower with car charging", () => {
  const state = {
    ...createDefaultState(),
    gridPower: 18 * 240,
    hourOfDay: 23,
    batterySOC: 5,
  };
  state.wallboxPower.set(WallboxLocation.Inside, 18 * 240);
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.On);
  state.wallboxChargeMode.set(WallboxLocation.Outside, WallboxChargeMode.Off);

  const result = calculateTargetAmpsAndPriority(state);
  assertEquals(result.insideWallboxAmps, 18);
  assertEquals(result.batteryChargePower, MAX_BATTERY_CHARGE_POWER - 18 * 240);
});

Deno.test("wallbox amps with excess battery power", () => {
  const state = createDefaultState();
  state.batteryPower = 4000;
  state.pvInverterPower = 1000;
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Manual);
  assertEquals(calculateTargetAmpsAndPriority(state).outsideWallboxAmps, 17);
});

Deno.test("wallbox amps when already charging with high power", () => {
  const state = createDefaultState();
  state.batteryPower = 4000;
  state.pvInverterPower = 1000;
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Manual);
  state.wallboxPower.set(WallboxLocation.Outside, 3500);
  assertEquals(calculateTargetAmpsAndPriority(state).outsideWallboxAmps, 32);
});

Deno.test("wallbox amps when no PV power available", () => {
  const state = createDefaultState();
  state.batteryPower = 4000;
  state.pvInverterPower = 0;
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Manual);
  assertEquals(calculateTargetAmpsAndPriority(state).outsideWallboxAmps, 0);
});

Deno.test("wallbox amps with battery almost full gets 8A bump", () => {
  const state = createDefaultState();
  state.batteryPower = 0;
  state.pvInverterPower = 1000;
  state.batterySOC = 99;
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Manual);
  state.wallboxPower.set(WallboxLocation.Outside, 3500);
  assertEquals(calculateTargetAmpsAndPriority(state).outsideWallboxAmps, 23);
});

Deno.test("wallbox amps when battery not full and not charging", () => {
  const state = createDefaultState();
  state.batteryPower = 0;
  state.pvInverterPower = 1000;
  state.batterySOC = 90;
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.Manual);
  state.wallboxPower.set(WallboxLocation.Outside, 0);
  assertEquals(calculateTargetAmpsAndPriority(state).outsideWallboxAmps, 0);
});

Deno.test("wallbox amps when on", () => {
  const state = createDefaultState();
  state.pvInverterPower = undefined;
  state.wallboxChargeMode.set(WallboxLocation.Inside, WallboxChargeMode.On);
  state.wallboxVictronStatus.set(
    WallboxLocation.Inside,
    WallboxStatus.Connected
  );
  state.hourOfDay = 20;
  // set maximum amps for inside wallbox
  assertEquals(calculateTargetAmpsAndPriority(state).insideWallboxAmps, 18);
});
