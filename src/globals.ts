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

export enum WallboxLocation {
  Inside,
  Outside,
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
  wallboxPower: Map<WallboxLocation, number>;
  wallboxStatus: Map<WallboxLocation, number>;
  wallboxCurrent: Map<WallboxLocation, number>;
  wallboxChargeMode: Map<WallboxLocation, WallboxChargeMode>;
} = {
  solarForecastNextDays: [],
  victronNextDays: [],
  omieEntries: [],
  gridPower: -1,
  batteryMinSOC: 0,
  batterySOC: 0,
  batteryPower: 0,
  wallboxPower: new Map(),
  wallboxStatus: new Map(),
  wallboxCurrent: new Map(),
  wallboxChargeMode: new Map([
    [WallboxLocation.Inside, WallboxChargeMode.SunOnly],
    [WallboxLocation.Outside, WallboxChargeMode.SunOnly],
  ]),
};

export interface OmieEntry {
  date: Temporal.PlainDateTime;
  // in cents per kwh
  price: number;
}
