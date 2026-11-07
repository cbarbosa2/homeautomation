import { SolarForecasts } from "./solar-forecasts/solar-forecasts.ts";
import { EventEmitter } from "./event-emitter.ts";
import type { Temporal } from "./temporal.ts";

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
  Manual = 1,
  Sun = 2,
  Reserve = 3,
  Battery = 4,
  Night = 5,
  Max = 6,
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
  solarForecastByDate: SolarForecasts;
  // Display-only values in Wh; control uses the dated forecast map.
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
  wallboxPower: Map<WallboxLocation, number>; // power in watts
  wallboxCurrent: Map<WallboxLocation, number>; // current in amps
  wallboxVictronStatus: Map<WallboxLocation, WallboxStatus>;
  wallboxSetCurrent: Map<WallboxLocation, number>; // target current in amps
  wallboxChargeMode: Map<WallboxLocation, WallboxChargeMode>;
  preferredWallboxLocation: WallboxLocation;
}

/**
 * Most values are read from MQTT, but not all.
 */
export const globals: GlobalState = {
  solarForecastByDate: new SolarForecasts(),
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
  wallboxCurrent: new Map(),
  wallboxVictronStatus: new Map(),
  wallboxSetCurrent: new Map(),
  preferredWallboxLocation: WallboxLocation.Inside,
  wallboxChargeMode: new Map([
    [WallboxLocation.Inside, WallboxChargeMode.Sun],
    [WallboxLocation.Outside, WallboxChargeMode.Sun],
  ]),
};

export interface OmieEntry {
  date: Temporal.PlainDateTime;
  // in cents per kwh
  price: number;
}
