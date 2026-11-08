import { test } from "node:test";
import { equal, deepStrictEqual } from "node:assert/strict";
import { Temporal } from "../temporal.ts";
import {
  WallboxChargeMode as M,
  WallboxLocation as L,
  WallboxStatus as S,
} from "../globals.ts";
import { chargeModePolicy } from "./charge-mode-policy.ts";
import {
  calculatePowerTargets,
  type InputState,
} from "./dynamic-power-calculator.ts";

function state(mode: M, time = "12:00"): InputState {
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
      [L.Inside, mode],
      [L.Outside, M.Manual],
    ]),
    timeOfDay: Temporal.PlainTime.from(time),
  };
}

test("six numeric modes and day/night policy matrix", () => {
  deepStrictEqual(
    [M.Manual, M.Sun, M.Reserve, M.Battery, M.Night, M.Max],
    [1, 2, 3, 4, 5, 6],
  );
  for (const [mode, day, night] of [
    [M.Manual, "manual", "manual"],
    [M.Sun, "solar", "solar"],
    [M.Reserve, "solar", "battery"],
    [M.Battery, "battery", "battery"],
    [M.Night, "solar", "unrestricted"],
    [M.Max, "unrestricted", "unrestricted"],
  ] as const) {
    for (const [time, expected] of [
      ["08:00", day],
      ["21:59:59", day],
      ["22:00", night],
      ["07:59:59", night],
    ] as const)
      equal(
        chargeModePolicy(state(mode, time), L.Inside).supply,
        expected,
        `${mode} ${time}`,
      );
  }
});

test("full battery is strictly above 95 and cannot bypass Manual, BMW, device or missing telemetry", () => {
  for (const mode of [M.Sun, M.Reserve, M.Night]) {
    const s = state(mode);
    for (const soc of [94.99, 95, 95.01]) {
      s.batterySOC = soc;
      equal(
        chargeModePolicy(s, L.Inside).supply,
        soc > 95 ? "battery" : "solar",
      );
    }
    s.insideVehicleSOC = 80;
    equal(chargeModePolicy(s, L.Inside).reason, "bmw-limit");
    s.insideVehicleSOC = undefined;
    s.telemetryValid = false;
    equal(chargeModePolicy(s, L.Inside).supply, "stopped");
    s.telemetryValid = true;
    s.wallboxVictronStatus.set(L.Inside, S.Charged);
    equal(chargeModePolicy(s, L.Inside).supply, "stopped");
  }
  const s = state(M.Manual);
  s.batterySOC = 100;
  equal(chargeModePolicy(s, L.Inside).supply, "manual");
});

test("Reserve margin, full-SOC override and below-minimum battery charging", () => {
  const s = state(M.Reserve, "23:01");
  s.remainingNight = Temporal.Duration.from({ hours: 8, minutes: 59 });
  s.batterySOC = 38;
  equal(chargeModePolicy(s, L.Inside).supply, "solar");
  s.batterySOC = 38.01;
  equal(chargeModePolicy(s, L.Inside).supply, "battery");
  s.batteryMinSOC = 85;
  s.batterySOC = 95.01;
  equal(chargeModePolicy(s, L.Inside).reason, "full-battery");
  for (const mode of [M.Reserve, M.Battery]) {
    s.wallboxChargeMode.set(L.Inside, mode);
    s.batterySOC = 19;
    s.batteryMinSOC = 20;
    s.batteryPower = 3000;
    equal(chargeModePolicy(s, L.Inside).reason, "charging-below-minimum");
  }
});

test("Battery floor allows only genuine solar without Sun's SOC guard", () => {
  const s = state(M.Battery);
  s.batterySOC = 20;
  s.gridPower = -2400;
  s.pvChargerPower = 2400;
  equal(calculatePowerTargets(s).insideWallboxAmps, 10);
  s.gridPower = -2399;
  equal(calculatePowerTargets(s).insideWallboxAmps, 0);
  s.wallboxChargeMode.set(L.Inside, M.Sun);
  equal(calculatePowerTargets(s).insideWallboxAmps, 0);
});

test("mixed unrestricted intent pauses constrained priority without oscillation", () => {
  for (const mode of [M.Sun, M.Battery, M.Reserve]) {
    const s = state(mode);
    s.batterySOC = 99;
    s.batterySupportWatts = 6720;
    s.wallboxChargeMode.set(L.Outside, M.Max);
    for (const power of [0, 6720]) {
      s.wallboxPower.set(L.Outside, power);
      s.gridPower = power;
      const target = calculatePowerTargets(s);
      equal(target.insideWallboxAmps, 0);
      equal(target.outsideWallboxAmps, 28);
    }
  }
});

test("missing readings pause every limited policy and preserve unrestricted fallback", () => {
  for (const mode of [M.Manual, M.Sun, M.Reserve, M.Battery, M.Night, M.Max]) {
    for (const time of ["12:00", "23:00"]) {
      const s = state(mode, time);
      s.telemetryValid = false;
      const expected =
        mode === M.Manual
          ? "manual"
          : mode === M.Max || (mode === M.Night && time === "23:00")
            ? "unrestricted"
            : "stopped";
      equal(chargeModePolicy(s, L.Inside).supply, expected);
      if (expected === "unrestricted")
        equal(calculatePowerTargets(s).insideWallboxAmps, 12);
    }
  }
});

test("four-point discharge margin applies to Battery, Reserve and the full-SOC exception", () => {
  for (const mode of [M.Battery, M.Reserve, M.Sun, M.Night]) {
    const s = state(mode, mode === M.Reserve ? "07:59" : "12:00");
    s.batteryMinSOC = 92;
    for (const soc of [95.99, 96, 96.01]) {
      s.batterySOC = soc;
      equal(
        chargeModePolicy(s, L.Inside).supply,
        soc > 96 ? "battery" : "solar",
      );
    }
  }
  const s = state(M.Battery);
  for (const soc of [20, 23.99, 24, 24.01]) {
    s.batterySOC = soc;
    equal(chargeModePolicy(s, L.Inside).supply, soc > 24 ? "battery" : "solar");
  }
});

test("a waiting wallbox cannot use another wallbox's battery allowance", () => {
  const s = state(M.Battery);
  s.wallboxChargeMode.set(L.Outside, M.Battery);
  s.batterySupportWatts = 6720;
  s.batterySupportBlockedLocations = new Set([L.Inside]);
  let targets = calculatePowerTargets(s);
  equal(targets.insideWallboxAmps, 0);
  equal(targets.outsideWallboxAmps, 28);
  s.pvChargerPower = 2400;
  s.gridPower = -2400;
  targets = calculatePowerTargets(s);
  equal(targets.insideWallboxAmps, 10);
  equal(targets.outsideWallboxAmps, 18);
  deepStrictEqual(targets.supplyConstraints?.[0], {
    locations: [L.Inside],
    watts: 2400,
  });
});
