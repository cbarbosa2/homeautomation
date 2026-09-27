import { WallboxLocation } from "../globals.ts";
import { SYSTEM_VOLTAGE } from "../utils.ts";

export const DYNAMIC_POWER_INTERVAL_SECONDS = 1;
export const MAX_GRID_AMPS = 28;
export const MIN_BATTERY_CHARGE_POWER = 0;
export const BATTERY_SOC_HIGH = 95;
export const MAX_BATTERY_CHARGE_POWER = MAX_GRID_AMPS * SYSTEM_VOLTAGE;
export const MAX_AMPS_PER_LOCATION = new Map([
  [WallboxLocation.Inside, 20],
  [WallboxLocation.Outside, 32],
]);
export const WALLBOX_MIN_CHARGE_AMPS = 7;
export const WALLBOX_MIN_START_AMPS = 10;
