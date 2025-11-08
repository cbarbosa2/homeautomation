import { EventEmitter } from "./event-emitter.ts";
import { Temporal } from "./temporal.ts";

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

export enum WallboxStatus {
  Disconnected = 0,
  Connected = 1,
  Charging = 2,
  Charged = 3,
  WaitingForSun = 4,
  WaitingForRFID = 5,
  WaitingForStart = 6,
  LowSOC = 7,
  ChargingLimit = 20,
  StartCharging = 21,
  SwitchingTo3Phase = 22,
  SwitchingTo1Phase = 23,
  StopCharging = 24,
}

export enum WallboxLocation {
  Inside,
  Outside,
}

export interface GlobalState {
  primaryWallboxLocation: WallboxLocation | undefined;
  // holds the value in kWh per day, index 0 is current day, index 1 is tomorrow, plus index 2 and 3
  solarForecastNextDays: number[];
  victronNextDays: number[];
  omieEntries: OmieEntry[];
  gridPower: number | undefined;
  batteryMinSOC: number | undefined;
  batterySOC: number | undefined;
  batteryPower: number | undefined;
  batteryMaxChargePower: number | undefined;
  pvInverterPower: number | undefined;
  pvChargerPower: number | undefined;
  wallboxPower: Map<WallboxLocation, number>;
  wallboxVictronStatus: Map<WallboxLocation, WallboxStatus>;
  wallboxSetCurrent: Map<WallboxLocation, number>;
  wallboxChargeMode: Map<WallboxLocation, WallboxChargeMode>;
}

/**
 * Most values are read from MQTT, but not all.
 */
export const globals: GlobalState = {
  primaryWallboxLocation: undefined,
  solarForecastNextDays: [],
  victronNextDays: [],
  omieEntries: [],
  gridPower: undefined,
  batteryMinSOC: undefined,
  batterySOC: undefined,
  batteryPower: undefined,
  batteryMaxChargePower: undefined,
  pvInverterPower: undefined,
  pvChargerPower: undefined,
  wallboxPower: new Map(),
  wallboxVictronStatus: new Map(),
  wallboxSetCurrent: new Map(),
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
