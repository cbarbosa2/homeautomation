import { canCharge, wallboxAmps } from "./wallbox-policy.ts";
import {
  WallboxChargeMode as Mode,
  WallboxLocation as Location,
  WallboxStatus as Status,
} from "../globals.ts";
import { SYSTEM_VOLTAGE } from "../utils.ts";
import { MAX_BATTERY_CHARGE_POWER, MAX_GRID_AMPS } from "./power-constants.ts";

export const LOCATIONS = [Location.Inside, Location.Outside];
export type PriorityDecision = { kind: "retain" } | { kind: "clear" } | {
  kind: "set";
  location: Location;
};
export interface CalculatedTargetResults {
  insideWallboxAmps: number | undefined;
  outsideWallboxAmps: number | undefined;
  batteryChargePower: number | undefined;
  priorityDecision: PriorityDecision;
  sharedBudgetWatts?: number;
}
export interface InputState {
  telemetryValid?: boolean;
  primaryWallboxLocation: Location | undefined;
  gridPower: number | undefined;
  batteryMinSOC: number | undefined;
  batterySOC: number | undefined;
  batteryPower: number | undefined;
  pvInverterPower: number | undefined;
  pvChargerPower?: number | undefined;
  wallboxPower: Map<Location, number>;
  wallboxVictronStatus: Map<Location, Status>;
  wallboxChargeMode: Map<Location, Mode>;
  chargingStartedAt?: Map<Location, number>;
  hourOfDay: number;
  remainingNightHours?: number;
}
export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
/** Allocate each watt once. Missing inputs never provide evidence for a mode. */
export function calculateTargetAmpsAndPriority(
  state: InputState,
): CalculatedTargetResults {
  const automatic = LOCATIONS.filter((l) =>
    state.wallboxChargeMode.get(l) !== Mode.Manual
  );
  const measured = automatic.reduce(
    (sum, l) => sum + Math.max(0, state.wallboxPower.get(l) ?? 0),
    0,
  );
  const valid = state.telemetryValid !== false &&
    [
      state.gridPower,
      state.batteryPower,
      state.batterySOC,
      state.batteryMinSOC,
      state.pvInverterPower,
      state.pvChargerPower,
      ...LOCATIONS.map((l) => state.wallboxPower.get(l)),
      ...LOCATIONS.map((l) => state.wallboxVictronStatus.get(l)),
    ].every(finite);
  const budget = valid
    ? Math.max(
      0,
      MAX_GRID_AMPS * SYSTEM_VOLTAGE - state.gridPower! + measured +
        Math.max(0, state.batteryPower!),
    )
    : 12 * SYSTEM_VOLTAGE;
  // Energy balance includes both PV sources. Subtract grid-funded charging and
  // battery discharge; Manual consumption remains in the household baseline.
  const solar = valid
    ? Math.max(
      0,
      Math.min(
        state.pvInverterPower! + state.pvChargerPower!,
        measured + state.batteryPower! - state.gridPower!,
      ),
    )
    : 0;
  const requests = new Map(LOCATIONS.map((l) => [l, request(state, l)]));
  let primary = state.primaryWallboxLocation;
  const eligible = (l: Location) =>
    requests.get(l) !== "off" && requests.get(l) !== "manual";
  if (primary !== undefined && !eligible(primary)) {
    primary = LOCATIONS.find((l) => eligible(l));
  }
  if (primary === undefined) {
    const started = LOCATIONS.filter((l) =>
      eligible(l) && state.wallboxVictronStatus.get(l) === Status.Charging
    );
    started.sort((a, b) =>
      (state.chargingStartedAt?.get(a) ?? 0) -
      (state.chargingStartedAt?.get(b) ?? 0)
    );
    primary = started[0];
  }
  const order = primary === Location.Outside
    ? [Location.Outside, Location.Inside]
    : LOCATIONS;
  let remaining = budget;
  let remainingSolar = solar;
  const targets = new Map<Location, number | undefined>();
  for (const l of order) {
    const modeRequest = requests.get(l);
    if (modeRequest === "manual") {
      targets.set(l, undefined);
      continue;
    }
    const available = modeRequest === "off"
      ? 0
      : modeRequest === "solar"
      ? Math.min(remaining, remainingSolar)
      : remaining;
    const amps = wallboxAmps(l, state.wallboxVictronStatus.get(l), available);
    targets.set(l, amps);
    remaining -= amps * SYSTEM_VOLTAGE;
    remainingSolar = Math.max(0, remainingSolar - amps * SYSTEM_VOLTAGE);
  }
  return {
    insideWallboxAmps: targets.get(Location.Inside),
    outsideWallboxAmps: targets.get(Location.Outside),
    batteryChargePower: Math.floor(
      Math.min(MAX_BATTERY_CHARGE_POWER, remaining),
    ),
    sharedBudgetWatts: budget,
    priorityDecision: primary === state.primaryWallboxLocation
      ? { kind: "retain" }
      : primary === undefined
      ? { kind: "clear" }
      : { kind: "set", location: primary },
  };
}
function request(
  state: InputState,
  location: Location,
): "maximum" | "solar" | "off" | "manual" {
  const mode = state.wallboxChargeMode.get(location) ?? Mode.SunOnly;
  if (mode === Mode.Manual) return "manual";
  if (
    mode === Mode.Off || !canCharge(state.wallboxVictronStatus.get(location))
  ) return "off";
  const night = state.hourOfDay >= 22 || state.hourOfDay < 8;
  const soc = state.batterySOC;
  const min = state.batteryMinSOC;
  const hours = state.remainingNightHours ??
    Math.ceil((32 - state.hourOfDay) % 24);
  if (
    mode === Mode.On || (finite(soc) && soc >= 95) ||
    (mode === Mode.Night && night) ||
    (mode === Mode.ESSOnly && night && finite(soc) && finite(min) &&
      soc > min + 2 * hours)
  ) return "maximum";
  return finite(soc) && finite(min) && soc > min + 1 ? "solar" : "off";
}
