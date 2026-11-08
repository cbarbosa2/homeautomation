import { Temporal } from "../temporal.ts";
import { WallboxChargeMode as Mode, WallboxLocation as L } from "../globals.ts";
import { finite } from "../utils/index.ts";
import { canCharge } from "./wallbox-policy.ts";
import type { InputState } from "./dynamic-power-calculator.ts";

export type Supply =
  | "manual"
  | "stopped"
  | "solar"
  | "battery"
  | "unrestricted";

export interface ModePolicy {
  supply: Supply;
  reason: string;
}

export function validTelemetry(state: InputState): boolean {
  return (
    state.telemetryValid !== false &&
    [
      state.gridPower,
      state.batteryPower,
      state.batterySOC,
      state.batteryMinSOC,
      state.pvInverterPower,
      state.pvChargerPower,
      ...[L.Inside, L.Outside].flatMap((l) => [
        state.wallboxPower.get(l),
        state.wallboxVictronStatus.get(l),
      ]),
    ].every(finite)
  );
}

/** SOC is the sole discharge-availability assumption. */
export function batteryDischargeAvailable(state: InputState): boolean {
  return (
    finite(state.batterySOC) &&
    finite(state.batteryMinSOC) &&
    state.batterySOC > state.batteryMinSOC + 4
  );
}

/** Resolve preference and eligibility independently of available watts. */
export function chargeModePolicy(state: InputState, location: L): ModePolicy {
  const mode = state.wallboxChargeMode.get(location) ?? Mode.Sun;
  const result = (supply: Supply, reason: string): ModePolicy => ({
    supply,
    reason,
  });
  if (mode === Mode.Manual) return result("manual", "manual");
  if (!canCharge(state.wallboxVictronStatus.get(location)))
    return result("stopped", "device");
  if (
    location === L.Inside &&
    mode !== Mode.Max &&
    finite(state.insideVehicleSOC) &&
    state.insideVehicleSOC >= 80
  )
    return result("stopped", "bmw-limit");

  const night =
    Temporal.PlainTime.compare(state.timeOfDay, "22:00") >= 0 ||
    Temporal.PlainTime.compare(state.timeOfDay, "08:00") < 0;
  if (mode === Mode.Max || (mode === Mode.Night && night))
    return result("unrestricted", "maximum");
  if (!validTelemetry(state)) return result("stopped", "telemetry");
  const soc = state.batterySOC as number;
  const min = state.batteryMinSOC as number;
  if (
    (mode === Mode.Battery || (mode === Mode.Reserve && night)) &&
    soc < min &&
    (state.batteryPower as number) > 0
  )
    return result("stopped", "charging-below-minimum");
  const dischargeAvailable = batteryDischargeAvailable(state);
  if (soc > 95 && mode !== Mode.Battery && dischargeAvailable)
    return result("battery", "full-battery");
  if (mode === Mode.Battery)
    return result(
      dischargeAvailable ? "battery" : "solar",
      dischargeAvailable ? "battery" : "discharge-floor",
    );
  let remaining = state.remainingNight ?? state.timeOfDay.until("08:00");
  if (remaining.sign < 0) remaining = remaining.add({ hours: 24 });
  if (
    mode === Mode.Reserve &&
    night &&
    dischargeAvailable &&
    soc > min + 2 * Math.ceil(remaining.total("hours"))
  )
    return result("battery", "reserve-available");
  return result(soc > min + 1 ? "solar" : "stopped", "solar-eligibility");
}
