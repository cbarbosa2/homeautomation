import { WallboxLocation } from "../globals.ts";
import { SYSTEM_VOLTAGE } from "../utils.ts";

export const MAX_GRID_CURRENT = 28;
export const BATTERY_FULL_BUMP_CURRENT = 8;
export const DETECT_SUN_MIN_PV_POWER = 200;
export const MIN_BATTERY_CHARGE_POWER = 200;
export const MAX_BATTERY_CHARGE_POWER = MAX_GRID_CURRENT * SYSTEM_VOLTAGE;
export const MAX_AMPS_PER_LOCATION = new Map([
  [WallboxLocation.Inside, 18],
  [WallboxLocation.Outside, 32],
]);
