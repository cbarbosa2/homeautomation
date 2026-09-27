import {
  WallboxLocation as Location,
  WallboxStatus as Status,
} from "../globals.ts";
import { SYSTEM_VOLTAGE } from "../utils.ts";
import {
  MAX_AMPS_PER_LOCATION,
  WALLBOX_MIN_CHARGE_AMPS,
  WALLBOX_MIN_START_AMPS,
} from "./power-constants.ts";

export function canCharge(status: Status | undefined): boolean {
  return status === Status.Connected || status === Status.Charging ||
    status === Status.WaitingForStart || status === Status.StartCharging ||
    status === Status.WaitingForSun || status === Status.LowSOC ||
    status === Status.StopCharging || status === Status.ChargingLimit ||
    status === Status.SwitchingTo1Phase || status === Status.SwitchingTo3Phase;
}
export function isCharging(status: Status | undefined): boolean {
  return status === Status.Charging ||
    status === Status.SwitchingTo1Phase || status === Status.SwitchingTo3Phase;
}

/** Whole amps only; insufficient start power must not reserve any budget. */
export function wallboxAmps(
  location: Location,
  status: Status | undefined,
  watts: number,
): number {
  if (!canCharge(status) || !Number.isFinite(watts)) return 0;
  const amps = Math.min(
    MAX_AMPS_PER_LOCATION.get(location)!,
    Math.floor(watts / SYSTEM_VOLTAGE),
  );
  return amps <
      (isCharging(status) ? WALLBOX_MIN_CHARGE_AMPS : WALLBOX_MIN_START_AMPS)
    ? 0
    : amps;
}
