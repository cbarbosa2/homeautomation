import { WallboxLocation } from "../globals.ts";

export const MAX_GRID_CURRENT = 28;
export const DETECT_SUN_MIN_PV_POWER = 200;
export const MIN_BATTERY_CHARGE_POWER = 200;
export const MAX_BATTERY_CHARGE_POWER = 6900;
export const MAX_AMPS_PER_LOCATION = new Map([
  [WallboxLocation.Inside, 18],
  [WallboxLocation.Outside, 32],
]);
