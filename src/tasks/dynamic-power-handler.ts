import {
  GlobalState,
  WallboxChargeMode,
  WallboxLocation,
  WallboxStatus,
} from "../globals.ts";

interface CalculatedTargetResults {
  insideCurrent: number | undefined;
  outsideCurrent: number | undefined;
  newPrimaryWallboxLocation: WallboxLocation | undefined;
}

interface WallboxTarget {
  current: number | undefined;
  concedePriority: boolean;
}

export function calculateTargetCurrentsAndPriority(
  state: GlobalState,
  hourOfDay: number
): CalculatedTargetResults {
  const primaryWallboxLocation =
    state.primaryWallboxLocation ?? WallboxLocation.Inside;

  const secondaryWallboxLocation =
    primaryWallboxLocation == WallboxLocation.Inside
      ? WallboxLocation.Outside
      : WallboxLocation.Inside;

  const primaryWallboxTarget = calculateWallboxTarget(
    state,
    primaryWallboxLocation,
    0,
    hourOfDay
  );

  const primaryTargetCurrent =
    primaryWallboxTarget.current != undefined
      ? coerceTargetCurrent(
          primaryWallboxTarget.current,
          primaryWallboxLocation
        )
      : undefined;

  const consumptionCurrentIncrease =
    (primaryTargetCurrent ?? 0) -
    powerToAmps(state.wallboxPower.get(primaryWallboxLocation) ?? 0);

  const secondaryWallboxTarget = calculateWallboxTarget(
    state,
    secondaryWallboxLocation,
    consumptionCurrentIncrease,
    hourOfDay
  );

  const secondaryTargetCurrent =
    secondaryWallboxTarget.current != undefined
      ? coerceTargetCurrent(
          secondaryWallboxTarget.current,
          secondaryWallboxLocation
        )
      : undefined;

  return {
    insideCurrent:
      primaryWallboxLocation == WallboxLocation.Inside
        ? primaryTargetCurrent
        : secondaryTargetCurrent,
    outsideCurrent:
      primaryWallboxLocation == WallboxLocation.Outside
        ? primaryTargetCurrent
        : secondaryTargetCurrent,
    // change primary wallbox to other one if first concedes and second doesn't
    newPrimaryWallboxLocation:
      primaryWallboxTarget.concedePriority == true &&
      secondaryWallboxTarget.concedePriority == false
        ? secondaryWallboxLocation
        : undefined,
  };
}

function coerceTargetCurrent(value: number, location: WallboxLocation): number {
  return Math.min(Math.max(0, value), MAX_AMPS_PER_LOCATION.get(location) ?? 0);
}

function calculateWallboxTarget(
  state: GlobalState,
  location: WallboxLocation,
  consumptionCurrentIncrease: number,
  hourOfDay: number
): WallboxTarget {
  const target = modeToTarget(state, location, hourOfDay);

  if (target == WallboxChargeTarget.NoAction) {
    return {
      current: undefined,
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
        current:
          powerToAmps(state.wallboxPower.get(location) ?? 0) +
          powerToAmps(state.batteryPower ?? 0) +
          MAX_GRID_CURRENT -
          consumptionCurrentIncrease -
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
        current:
          powerToAmps(state.wallboxPower.get(location) ?? 0) +
          (state.batteryPower ? powerToAmps(state.batteryPower) : 0) +
          (state.batterySOC >= 95 ? 8 : 0) -
          consumptionCurrentIncrease,
        concedePriority: false,
      };
    }
  }

  return {
    current: 0,
    concedePriority: true,
  };
}

function modeToTarget(
  state: GlobalState,
  location: WallboxLocation,
  hourOfDay: number
): WallboxChargeTarget {
  const isOffPeak = hourOfDay < 8 || hourOfDay >= 22;

  switch (state.wallboxChargeMode.get(location) ?? WallboxChargeMode.SunOnly) {
    case WallboxChargeMode.On:
      return WallboxChargeTarget.MaximumPossible;
    case WallboxChargeMode.Night:
      return isOffPeak
        ? WallboxChargeTarget.MaximumPossible
        : WallboxChargeTarget.ExcessSun;
    case WallboxChargeMode.ESSOnly: {
      const socMargin = 2 * ((24 + 8 - hourOfDay) % 24);
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

function powerToAmps(power: number) {
  return Math.round(power / 240);
}

const MAX_GRID_CURRENT = 28;
const DETECT_SUN_MIN_PV_POWER = 200;
const MAX_AMPS_PER_LOCATION = new Map([
  [WallboxLocation.Inside, 18],
  [WallboxLocation.Outside, 24],
]);

enum WallboxChargeTarget {
  NoAction,
  MaximumPossible,
  ExcessSun,
  Zero,
}
