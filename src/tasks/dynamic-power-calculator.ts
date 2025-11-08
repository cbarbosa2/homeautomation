import {
  DETECT_SUN_MIN_PV_POWER,
  MAX_AMPS_PER_LOCATION,
  MAX_BATTERY_CHARGE_POWER,
  MAX_GRID_CURRENT,
  MIN_BATTERY_CHARGE_POWER,
  TARGET_AMPS_MAX_INCREASE,
} from "../constants.ts";
import {
  WallboxChargeMode,
  WallboxLocation,
  WallboxStatus,
} from "../globals.ts";
import { ampsToPower, powerToAmps } from "../utils.ts";
import { TARGET_AMPS_MIN_START } from "./power-controller.ts";

export interface CalculatedTargetResults {
  insideWallboxAmps: number | undefined;
  outsideWallboxAmps: number | undefined;
  batteryChargePower: number | undefined;
  newPrimaryWallboxLocation: WallboxLocation | undefined;
}

export interface InputState {
  primaryWallboxLocation: WallboxLocation | undefined;
  gridPower: number | undefined;
  batteryMinSOC: number | undefined;
  batterySOC: number | undefined;
  batteryPower: number | undefined;
  pvInverterPower: number | undefined;
  wallboxPower: Map<WallboxLocation, number>;
  wallboxVictronStatus: Map<WallboxLocation, WallboxStatus>;
  wallboxChargeMode: Map<WallboxLocation, WallboxChargeMode>;
  hourOfDay: number;
}

export function calculateTargetAmpsAndPriority(
  state: InputState
): CalculatedTargetResults {
  const primaryWallboxLocation =
    state.primaryWallboxLocation ?? WallboxLocation.Inside;

  const secondaryWallboxLocation =
    primaryWallboxLocation == WallboxLocation.Inside
      ? WallboxLocation.Outside
      : WallboxLocation.Inside;

  const primaryWallboxTargetValues = calculateWallboxTargetValues(
    state,
    primaryWallboxLocation,
    0
  );

  const primaryTargetAmps =
    primaryWallboxTargetValues.amps != undefined
      ? coerceTargetAmps(
          primaryWallboxLocation,
          powerToAmps(state.wallboxPower.get(primaryWallboxLocation) ?? 0),
          primaryWallboxTargetValues.amps
        )
      : undefined;

  let consumptionAmpsIncrease = Math.max(
    0,
    (primaryTargetAmps ?? 0) -
      powerToAmps(state.wallboxPower.get(primaryWallboxLocation) ?? 0)
  );

  const secondaryWallboxTargetValues = calculateWallboxTargetValues(
    state,
    secondaryWallboxLocation,
    consumptionAmpsIncrease
  );

  const secondaryTargetAmps =
    secondaryWallboxTargetValues.amps != undefined
      ? coerceTargetAmps(
          secondaryWallboxLocation,
          powerToAmps(state.wallboxPower.get(secondaryWallboxLocation) ?? 0),
          secondaryWallboxTargetValues.amps
        )
      : undefined;

  consumptionAmpsIncrease = Math.max(
    0,
    consumptionAmpsIncrease +
      (secondaryTargetAmps ?? 0) -
      powerToAmps(state.wallboxPower.get(secondaryWallboxLocation) ?? 0)
  );

  const batteryChargePower = calculateBatteryChargePower(
    state,
    consumptionAmpsIncrease
  );

  return {
    insideWallboxAmps:
      primaryWallboxLocation == WallboxLocation.Inside
        ? primaryTargetAmps
        : secondaryTargetAmps,
    outsideWallboxAmps:
      primaryWallboxLocation == WallboxLocation.Outside
        ? primaryTargetAmps
        : secondaryTargetAmps,
    batteryChargePower: batteryChargePower,
    // change primary wallbox to other one if first concedes and second doesn't
    newPrimaryWallboxLocation:
      primaryWallboxTargetValues.concedePriority == true &&
      secondaryWallboxTargetValues.concedePriority == false
        ? secondaryWallboxLocation
        : undefined,
  };
}

function calculateBatteryChargePower(
  state: InputState,
  consumptionAmpsIncrease: number
): number | undefined {
  if (state.batterySOC == undefined || state.batteryMinSOC == undefined) {
    return undefined;
  }

  const target =
    state.batterySOC >= state.batteryMinSOC - 1
      ? 0
      : (state.batteryPower ?? 0) +
        ampsToPower(MAX_GRID_CURRENT) -
        ampsToPower(consumptionAmpsIncrease) -
        (state.gridPower !== undefined
          ? state.gridPower
          : ampsToPower(MAX_GRID_CURRENT));

  return Math.min(
    MAX_BATTERY_CHARGE_POWER,
    Math.max(MIN_BATTERY_CHARGE_POWER, Math.round(target))
  );
}

function coerceTargetAmps(
  location: WallboxLocation,
  existingAmps: number,
  newAmps: number
): number {
  return Math.min(
    Math.max(0, newAmps),
    Math.max(TARGET_AMPS_MIN_START, existingAmps + TARGET_AMPS_MAX_INCREASE),
    MAX_AMPS_PER_LOCATION.get(location) ?? 0
  );
}

function calculateWallboxTargetValues(
  state: InputState,
  location: WallboxLocation,
  consumptionAmpsIncrease: number
): WallboxTarget {
  const target = modeToTarget(state, location);

  if (target == WallboxChargeTarget.NoAction) {
    return {
      amps: undefined,
      concedePriority: true,
    };
  }

  const status = state.wallboxVictronStatus.get(location);
  const canCharge =
    status != WallboxStatus.Disconnected &&
    status != WallboxStatus.Charged &&
    status != WallboxStatus.ChargingLimit &&
    status != WallboxStatus.StopCharging;

  if (canCharge) {
    if (target == WallboxChargeTarget.MaximumPossible) {
      return {
        amps:
          powerToAmps(state.wallboxPower.get(location) ?? 0) +
          powerToAmps(state.batteryPower ?? 0) +
          MAX_GRID_CURRENT -
          consumptionAmpsIncrease -
          (state.gridPower !== undefined
            ? powerToAmps(state.gridPower)
            : MAX_GRID_CURRENT),
        concedePriority: false,
      };
    } else if (
      target == WallboxChargeTarget.ExcessSun &&
      state.batterySOC != undefined &&
      state.batteryMinSOC != undefined &&
      state.batterySOC > state.batteryMinSOC + 1 &&
      state.pvInverterPower != undefined &&
      state.pvInverterPower > DETECT_SUN_MIN_PV_POWER
    ) {
      return {
        amps:
          powerToAmps(state.wallboxPower.get(location) ?? 0) +
          (state.batteryPower ? powerToAmps(state.batteryPower) : 0) +
          (state.batterySOC >= 95 ? 8 : 0) -
          consumptionAmpsIncrease,
        concedePriority: false,
      };
    }
  }

  return {
    amps: 0,
    concedePriority: true,
  };
}

function modeToTarget(
  state: InputState,
  location: WallboxLocation
): WallboxChargeTarget {
  const isOffPeak = getIsOffPeak(state.hourOfDay);

  switch (state.wallboxChargeMode.get(location) ?? WallboxChargeMode.SunOnly) {
    case WallboxChargeMode.On:
      return WallboxChargeTarget.MaximumPossible;
    case WallboxChargeMode.Night:
      return isOffPeak
        ? WallboxChargeTarget.MaximumPossible
        : WallboxChargeTarget.ExcessSun;
    case WallboxChargeMode.ESSOnly: {
      const socMargin = 2 * ((24 + 8 - state.hourOfDay) % 24);
      if (
        isOffPeak &&
        state.batterySOC != undefined &&
        state.batteryMinSOC != undefined &&
        state.batterySOC > state.batteryMinSOC + socMargin
      ) {
        return WallboxChargeTarget.MaximumPossible;
      } else {
        return WallboxChargeTarget.ExcessSun;
      }
    }
    case WallboxChargeMode.SunOnly:
      return WallboxChargeTarget.ExcessSun;
    case WallboxChargeMode.Off:
      return WallboxChargeTarget.Zero;
    default:
      return WallboxChargeTarget.NoAction;
  }
}

function getIsOffPeak(hourOfDay: number): boolean {
  return hourOfDay < 8 || hourOfDay >= 22;
}

interface WallboxTarget {
  amps: number | undefined;
  concedePriority: boolean;
}

enum WallboxChargeTarget {
  NoAction,
  MaximumPossible,
  ExcessSun,
  Zero,
}
