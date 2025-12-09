import {
  BATTERY_FULL_BUMP_AMPS,
  DETECT_SUN_MIN_PV_POWER,
  MAX_AMPS_PER_LOCATION,
  MAX_BATTERY_CHARGE_POWER,
  MAX_GRID_AMPS,
  MIN_BATTERY_CHARGE_POWER,
  WALLBOX_MIN_CHARGE_AMPS,
} from "./power-constants.ts";
import {
  WallboxChargeMode,
  WallboxLocation,
  WallboxStatus,
} from "../globals.ts";
import { ampsToPower, powerToAmps } from "../utils.ts";

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

/**
 * DynamicPowerCalculator determines optimal power allocation across wallboxes and battery.
 *
 * This module calculates target charging currents (amps) for wallboxes and battery charge power
 * based on system state and configured charge modes. Key features:
 *
 * - Prioritizes one wallbox over another to avoid exceeding grid limits
 * - Respects different charge modes (On, Night, ESSOnly, SunOnly, Off, Manual)
 * - Maximizes use of excess solar power for charging
 * - Prevents grid overload by limiting total consumption to MAX_GRID_AMPS
 * - Adjusts battery charge power to optimize energy storage
 * - Handles priority switching when the primary wallbox concedes to the secondary
 *
 * The calculator considers real-time data including grid power, battery state, PV production,
 * and wallbox status to make intelligent power distribution decisions.
 */
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
          // powerToAmps(state.wallboxPower.get(primaryWallboxLocation) ?? 0),
          primaryWallboxTargetValues.amps
        )
      : undefined;

  // calculate how much the consumption will increase/decrease with the primary wallbox,
  // we need to account for that when calculating the secondary wallbox.
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
          // powerToAmps(state.wallboxPower.get(secondaryWallboxLocation) ?? 0),
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
    state.gridPower == undefined
      ? MIN_BATTERY_CHARGE_POWER
      : state.batterySOC >= state.batteryMinSOC
      ? MAX_BATTERY_CHARGE_POWER
      : (state.batteryPower ?? 0) +
        ampsToPower(MAX_GRID_AMPS - consumptionAmpsIncrease) -
        state.gridPower;

  return Math.min(
    MAX_BATTERY_CHARGE_POWER,
    Math.max(MIN_BATTERY_CHARGE_POWER, Math.round(target))
  );
}

function coerceTargetAmps(location: WallboxLocation, newAmps: number): number {
  if (newAmps < WALLBOX_MIN_CHARGE_AMPS) {
    return 0;
  } else {
    return Math.min(newAmps, MAX_AMPS_PER_LOCATION.get(location) ?? 0);
  }
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
          MAX_GRID_AMPS -
          consumptionAmpsIncrease -
          (state.gridPower !== undefined
            ? powerToAmps(state.gridPower)
            : MAX_GRID_AMPS),
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
          (state.batterySOC >= 95 ? BATTERY_FULL_BUMP_AMPS : 0) -
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
