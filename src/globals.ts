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
  omieEntries: OmieEntry[];
  wallboxChargeMode: Map<WallboxLocation, WallboxChargeMode>;
  preferredWallboxLocation: WallboxLocation;
}

/**
 * Application settings and electricity prices.
 */
export const globals: GlobalState = {
  omieEntries: [],
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
