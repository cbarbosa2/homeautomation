import { EventEmitter } from "./event-emitter.ts";

/**
 * These values are read from MQTT and trigger the respective event
 */
export const events = {
  wallboxCurrentInsideUpdated: new EventEmitter<number>(),
  wallboxCurrentOutsideUpdated: new EventEmitter<number>(),
  wallSwitchUpdated: new EventEmitter<{
    params: { events: { id: number; event: string }[] };
  }>(),
};

export enum WallboxChargeMode {
  Off = 1,
  SunOnly = 2,
  ESSOnly = 3,
  Night = 4,
  On = 5,
  Manual = 6,
}

/**
 * Most values are read from MQTT, but not all.
 */
export const globals: {
  // holds the value in kWh per day, index 0 is current day, index 1 is tomorrow, plus index 2 and 3
  solarForecastNextDays: number[];
  victronNextDays: number[];
  omieEntries: OmieEntry[];
  gridPower: number;
  batteryMinSOC: number;
  batterySOC: number;
  batteryPower: number;
  wallboxPowerInside: number;
  wallboxStatusInside: number;
  wallboxCurrentInside: number;
  wallboxPowerOutside: number;
  wallboxStatusOutside: number;
  wallboxCurrentOutside: number;
  wallboxChargeModeInside: WallboxChargeMode;
  wallboxChargeModeOutside: WallboxChargeMode;
} = {
  solarForecastNextDays: [],
  victronNextDays: [],
  omieEntries: [],
  gridPower: -1,
  batteryMinSOC: 0,
  batterySOC: 0,
  batteryPower: 0,
  wallboxPowerInside: -1,
  wallboxStatusInside: -1,
  wallboxCurrentInside: -1,
  wallboxPowerOutside: -1,
  wallboxStatusOutside: -1,
  wallboxCurrentOutside: -1,
  wallboxChargeModeInside: WallboxChargeMode.SunOnly,
  wallboxChargeModeOutside: WallboxChargeMode.SunOnly,
};

export function logGlobals() {
  console.log(`Globals=${JSON.stringify(globals)}`);
}

export interface OmieEntry {
  date: Temporal.PlainDateTime;
  // in cents per kwh
  price: number;
}
