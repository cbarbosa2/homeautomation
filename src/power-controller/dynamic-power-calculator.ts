import type { Temporal } from "../temporal.ts";
import { wallboxAmps } from "./wallbox-policy.ts";
import {
  WallboxChargeMode as Mode,
  WallboxLocation as Location,
  type WallboxStatus as Status,
} from "../globals.ts";
import { SYSTEM_VOLTAGE } from "../utils/index.ts";
import { MAX_BATTERY_CHARGE_POWER, MAX_GRID_AMPS } from "./power-constants.ts";

import {
  chargeModePolicy,
  validTelemetry,
  type ModePolicy,
} from "./charge-mode-policy.ts";

export const LOCATIONS = [Location.Inside, Location.Outside];

export interface SupplyConstraint {
  locations: Location[];
  watts: number;
}

export interface CalculatedTargetResults {
  insideWallboxAmps: number | undefined;
  outsideWallboxAmps: number | undefined;
  batteryChargePower: number | undefined;
  sharedBudgetWatts?: number;
  supplyConstraints?: SupplyConstraint[];
  unrestrictedLocations?: Location[];
}

export interface InputState {
  telemetryValid?: boolean;
  batterySupportWatts?: number;
  batterySupportBlockedLocations?: ReadonlySet<Location>;
  batterySupportFailedLocations?: ReadonlySet<Location>;
  insideVehicleSOC?: number | undefined;
  preferredWallboxLocation: Location;
  gridPower: number | undefined;
  batteryMinSOC: number | undefined;
  batterySOC: number | undefined;
  batteryPower: number | undefined;
  pvInverterPower: number | undefined;
  pvChargerPower?: number | undefined;
  wallboxPower: Map<Location, number>;
  wallboxVictronStatus: Map<Location, Status>;
  wallboxChargeMode: Map<Location, Mode>;
  timeOfDay: Temporal.PlainTime;
  remainingNight?: Temporal.Duration;
}

/** Energy balance counts Manual consumption as household load. */
export function powerResources(state: InputState) {
  const automatic = LOCATIONS.filter(
    (l) => state.wallboxChargeMode.get(l) !== Mode.Manual,
  );
  const measured = automatic.reduce(
    (sum, l) => sum + Math.max(0, state.wallboxPower.get(l) ?? 0),
    0,
  );
  const valid = validTelemetry(state);
  return {
    automatic,
    measured,
    installation: valid
      ? Math.max(
          0,
          MAX_GRID_AMPS * SYSTEM_VOLTAGE -
            (state.gridPower as number) +
            measured +
            Math.max(0, state.batteryPower as number),
        )
      : 12 * SYSTEM_VOLTAGE,
    solar: valid
      ? Math.max(
          0,
          Math.min(
            (state.pvInverterPower as number) +
              (state.pvChargerPower as number),
            measured +
              (state.batteryPower as number) -
              (state.gridPower as number),
          ),
        )
      : 0,
  };
}

export function priorityOrder(state: InputState): Location[] {
  return state.preferredWallboxLocation === Location.Outside
    ? [Location.Outside, Location.Inside]
    : LOCATIONS;
}

/** Assess unrestricted intent before limited requests, independent of preference. */
export function effectivePolicies(
  state: InputState,
): Map<Location, ModePolicy> {
  const policies = new Map(
    LOCATIONS.map((l) => [l, chargeModePolicy(state, l)]),
  );
  // A retry delay restricts battery support, but genuine solar remains usable.
  for (const [l, policy] of policies) {
    if (
      policy.supply === "battery" &&
      state.batterySupportFailedLocations?.has(l)
    ) {
      policies.set(l, { supply: "stopped", reason: "no-discharge" });
      continue;
    }
    if (
      policy.supply === "battery" &&
      state.batterySupportBlockedLocations?.has(l)
    )
      policies.set(l, { supply: "solar", reason: "battery-retry" });
  }
  const resources = powerResources(state);
  let remaining = resources.installation;
  let unrestricted = 0;
  for (const l of priorityOrder(state)) {
    if (policies.get(l)?.supply !== "unrestricted") continue;
    const watts =
      wallboxAmps(l, state.wallboxVictronStatus.get(l), remaining) *
      SYSTEM_VOLTAGE;
    unrestricted += watts;
    remaining -= watts;
  }
  const projectedImport =
    (state.gridPower ?? Infinity) -
    resources.measured +
    unrestricted +
    Math.max(0, state.batteryPower ?? 0);
  for (const [l, policy] of policies) {
    if (
      unrestricted > 0 &&
      (policy.supply === "solar" ||
        (policy.supply === "battery" &&
          state.wallboxChargeMode.get(l) !== Mode.Battery &&
          state.wallboxChargeMode.get(l) !== Mode.Reserve)) &&
      projectedImport > (policy.supply === "solar" ? 0 : 99)
    )
      policies.set(l, { supply: "stopped", reason: "unrestricted-import" });
  }
  return policies;
}

/** Allocate each watt once, keeping installation and source constraints distinct. */
export function calculatePowerTargets(
  state: InputState,
): CalculatedTargetResults {
  const resources = powerResources(state);
  const policies = effectivePolicies(state);
  const solarLocations = LOCATIONS.filter(
    (l) => policies.get(l)?.supply === "solar",
  );
  const batteryActive = LOCATIONS.some(
    (l) => policies.get(l)?.supply === "battery",
  );
  const support = batteryActive
    ? Math.max(resources.solar, state.batterySupportWatts ?? 0)
    : resources.solar;
  let remaining = resources.installation;
  let remainingSolar = resources.solar;
  let remainingSupport = support;
  const targets = new Map<Location, number | undefined>();
  for (const l of priorityOrder(state)) {
    const supply = policies.get(l)?.supply;
    if (supply === "manual") {
      targets.set(l, undefined);
      continue;
    }
    const available =
      supply === "unrestricted"
        ? remaining
        : supply === "solar"
          ? Math.min(remaining, remainingSolar, remainingSupport)
          : supply === "battery"
            ? Math.min(remaining, remainingSupport)
            : 0;
    const amps = wallboxAmps(l, state.wallboxVictronStatus.get(l), available);
    const watts = amps * SYSTEM_VOLTAGE;
    targets.set(l, amps);
    remaining -= watts;
    remainingSolar = Math.max(0, remainingSolar - watts);
    remainingSupport = Math.max(0, remainingSupport - watts);
  }
  const constraints: SupplyConstraint[] = [];
  if (solarLocations.length)
    constraints.push({ locations: solarLocations, watts: resources.solar });
  if (batteryActive)
    constraints.push({ locations: resources.automatic, watts: support });
  // Include outstanding consumption of other sources when reserving limited supply.
  if (!batteryActive && solarLocations.length)
    constraints.push({
      locations: resources.automatic,
      watts: resources.solar,
    });
  return {
    insideWallboxAmps: targets.get(Location.Inside),
    outsideWallboxAmps: targets.get(Location.Outside),
    batteryChargePower:
      batteryActive && (state.batterySupportWatts ?? 0) > 0
        ? 0
        : Math.floor(Math.min(MAX_BATTERY_CHARGE_POWER, remaining)),
    sharedBudgetWatts: resources.installation,
    supplyConstraints: constraints,
    unrestrictedLocations: LOCATIONS.filter(
      (l) => policies.get(l)?.supply === "unrestricted",
    ),
  };
}
