import type { Clock } from "../lisbon-clock.ts";
import { Temporal } from "../temporal.ts";
import { CONTROL_PATHS as P, wallboxPath } from "../device-topics.ts";
import { WallboxChargeMode, WallboxLocation as L } from "../globals.ts";
import {
  MAX_AMPS_PER_LOCATION,
  MAX_BATTERY_DISCHARGE_POWER,
} from "./power-constants.ts";
import { SYSTEM_VOLTAGE } from "../utils/index.ts";
import {
  batteryDischargeAvailable,
  chargeModePolicy,
  validTelemetry,
} from "./charge-mode-policy.ts";
import { isCharging } from "./wallbox-policy.ts";
import {
  effectivePolicies,
  powerResources,
  priorityOrder,
  type InputState,
  type CalculatedTargetResults,
} from "./dynamic-power-calculator.ts";
import type { SystemState, CommandBuilder } from "./command-builder.ts";

const RESPONSE_WINDOW = Temporal.Duration.from({ seconds: 30 });
const RETRY_DELAY = Temporal.Duration.from({ minutes: 15 });

type State = InputState & SystemState;

export interface BatteryDischargeStatus {
  state: "available" | "blocked" | "unknown";
  reason: string;
}

export function unknownDischargeStatus(): BatteryDischargeStatus {
  return {
    state: "unknown",
    reason: "Battery support has not been evaluated yet.",
  };
}

/** SOC grants availability; fresh battery and grid feedback regulate EV demand. */
export class BatterySupportController {
  private lastObservation: Temporal.Instant | undefined;
  private signature = "";
  private startup:
    | { location: L; since: Temporal.Instant | undefined }
    | undefined;
  private response: { since: Temporal.Instant; increment: number } | undefined;
  private batteryLocations: L[] = [];
  private commands = new Map<L, { watts: number; since: Temporal.Instant }>();
  private retryAfter = new Map<L, Temporal.Instant>();
  private modes = new Map<L, WallboxChargeMode>();
  private powerStopCandidates = new Set<L>();
  private noDischargeSince = new Map<L, Temporal.Instant>();
  private failureStops = new Set<L>();
  private allowance = 0;
  private evaluatedAt: Temporal.Instant | undefined;
  private dischargeStatus = unknownDischargeStatus();

  constructor(private clock: Clock) {}

  getDischargeStatus(telemetryValid: boolean): BatteryDischargeStatus {
    const now = this.clock();
    if (!telemetryValid)
      return {
        state: "unknown",
        reason: "Control telemetry is unavailable or stale.",
      };
    if (this.evaluatedAt === undefined) return unknownDischargeStatus();
    if (
      Temporal.Instant.compare(now, this.evaluatedAt) < 0 ||
      Temporal.Instant.compare(now, this.evaluatedAt.add({ seconds: 60 })) > 0
    )
      return { state: "unknown", reason: "Controller status is stale." };

    return { ...this.dischargeStatus };
  }

  private statusFor(state: State): BatteryDischargeStatus {
    if (!validTelemetry(state))
      return {
        state: "unknown",
        reason: "Control telemetry is unavailable or stale.",
      };
    if (!batteryDischargeAvailable(state))
      return {
        state: "blocked",
        reason:
          "Battery support requires SOC strictly above minimum SOC + 4 percentage points.",
      };

    return {
      state: "available",
      reason:
        "SOC is above minimum SOC + 4 percentage points; discharge is assumed available. Charging remains subject to mode and power limits.",
    };
  }

  allowanceFor(state: State, builder: CommandBuilder): number {
    this.powerStopCandidates.clear();
    for (const [l, mode] of state.wallboxChargeMode) {
      const changed = this.modes.has(l) && this.modes.get(l) !== mode;
      if (changed) {
        this.retryAfter.delete(l);
        this.noDischargeSince.delete(l);
      }
      this.modes.set(l, mode);
      const deadline = this.retryAfter.get(l);
      if (deadline && Temporal.Instant.compare(this.clock(), deadline) >= 0)
        this.retryAfter.delete(l);
      if (
        !changed &&
        !this.retryAfter.has(l) &&
        validTelemetry(state) &&
        chargeModePolicy(state, l).supply === "battery" &&
        (this.commands.get(l)?.watts ?? state.wallboxPower.get(l) ?? 0) > 0
      )
        this.powerStopCandidates.add(l);
    }
    this.updateDischargeWatchdog(state);
    const allowance = this.calculateAllowance(
      {
        ...state,
        batterySupportBlockedLocations: this.retryBlockedLocations(),
        batterySupportFailedLocations: this.failedLocations(),
      },
      builder,
    );
    this.dischargeStatus = this.statusFor(state);
    this.evaluatedAt = this.clock();
    return allowance;
  }

  retryBlockedLocations(): ReadonlySet<L> {
    return new Set(this.retryAfter.keys());
  }

  failedLocations(): ReadonlySet<L> {
    return new Set(this.failureStops);
  }

  private usesDischargeTarget(state: State, location: L): boolean {
    const mode = state.wallboxChargeMode.get(location);
    return (
      mode === WallboxChargeMode.Battery || mode === WallboxChargeMode.Reserve
    );
  }

  private updateDischargeWatchdog(state: State): void {
    this.failureStops.clear();
    const gridAt = state.observedAt?.get(P.gridPower);
    const batteryAt = state.observedAt?.get(P.batteryPower);
    if (!validTelemetry(state) || !gridAt || !batteryAt) {
      return;
    }
    const observed =
      Temporal.Instant.compare(gridAt, batteryAt) < 0 ? gridAt : batteryAt;
    for (const l of state.wallboxChargeMode.keys()) {
      const active =
        (this.commands.get(l)?.watts ?? state.wallboxPower.get(l) ?? 0) > 0;
      if (
        !this.usesDischargeTarget(state, l) ||
        chargeModePolicy(state, l).supply !== "battery" ||
        !active ||
        (state.batteryPower as number) < 0
      ) {
        this.noDischargeSince.delete(l);
        continue;
      }
      if (!this.noDischargeSince.has(l) && (state.gridPower as number) <= 1000)
        continue;
      const since = this.noDischargeSince.get(l) ?? observed;
      this.noDischargeSince.set(l, since);
      if (
        Temporal.Instant.compare(observed, since.add(RESPONSE_WINDOW)) > 0 &&
        (state.gridPower as number) > 1000
      )
        this.failureStops.add(l);
    }
  }

  private calculateAllowance(state: State, builder: CommandBuilder): number {
    const policies = effectivePolicies(state);
    const eligible = priorityOrder(state).filter(
      (l) => policies.get(l)?.supply === "battery",
    );
    this.batteryLocations = eligible;
    // Retry transitions must not reset the other wallbox's regulation intent.
    const ordinaryPolicies = effectivePolicies({
      ...state,
      batterySupportBlockedLocations: new Set(),
      batterySupportFailedLocations: new Set(),
    });
    const signature = JSON.stringify(
      [...state.wallboxChargeMode, ...ordinaryPolicies].map(([l, p]) => [l, p]),
    );
    if (!validTelemetry(state) || signature !== this.signature) {
      this.startup = undefined;
      this.response = undefined;
      this.lastObservation = undefined;
      this.allowance = 0;
      this.signature = signature;
    }
    if (!validTelemetry(state)) return 0;
    if (!batteryDischargeAvailable(state) || !eligible.length) return 0;

    const observations = [P.gridPower, P.batteryPower].map((p) =>
      state.observedAt?.get(p),
    );
    if (observations.some((at) => at === undefined)) return 0;
    const observed = observations.reduce((earliest, at) =>
      Temporal.Instant.compare(
        at as Temporal.Instant,
        earliest as Temporal.Instant,
      ) < 0
        ? at
        : earliest,
    ) as Temporal.Instant;
    const fresh =
      this.lastObservation === undefined ||
      Temporal.Instant.compare(observed, this.lastObservation) > 0;
    if (!fresh) return this.allowance;
    this.lastObservation = observed;
    const resources = powerResources(state);
    const dischargeTarget = eligible.some((l) =>
      this.usesDischargeTarget(state, l),
    );
    const target =
      [...policies.values()].some((p) => p.supply === "solar") &&
      resources.solar >= 7 * SYSTEM_VOLTAGE
        ? 0
        : dischargeTarget &&
            !eligible.some((l) => !this.usesDischargeTarget(state, l))
          ? undefined
          : 99;
    // Battery power is signed: positive charging is divertible solar, while
    // negative discharge is capacity already used by the house and the EVs.
    const capacity = dischargeTarget
      ? Math.max(
          0,
          resources.measured +
            (state.batteryPower as number) +
            MAX_BATTERY_DISCHARGE_POWER,
        )
      : Infinity;
    this.allowance = Math.min(this.allowance, capacity);
    const commitments = builder.commitments();
    const committed = resources.automatic.reduce(
      (sum, l) =>
        sum +
        Math.max(
          state.wallboxPower.get(l) ?? 0,
          commitments.get(l)?.watts ?? 0,
        ),
      0,
    );
    const demand = eligible.some(
      (l) =>
        (this.commands.get(l)?.watts ?? 0) > 0 ||
        (state.wallboxPower.get(l) ?? 0) > 0,
    );
    const commandConfirmed = (l: L): boolean => {
      const command = this.commands.get(l);
      if (!command || command.watts <= 0) return false;
      return (
        ["Ac/Power", "SetCurrent", "StartStop"].every((field) => {
          const at = state.observedAt?.get(wallboxPath(l, field));
          return (
            at !== undefined && Temporal.Instant.compare(at, command.since) > 0
          );
        }) &&
        state.wallboxStartStop?.get(l) === 1 &&
        state.wallboxSetCurrent?.get(l) === command.watts / SYSTEM_VOLTAGE &&
        isCharging(state.wallboxVictronStatus.get(l)) &&
        (state.wallboxPower.get(l) ?? 0) > 0
      );
    };
    // A solar allocation or outstanding reservation may have prevented the
    // startup. Re-evaluate it against the now-confirmed total load.
    if (this.startup && this.commands.get(this.startup.location)?.watts === 0)
      this.startup = undefined;

    // A startup may briefly import while the inverter responds. No repeated
    // telemetry or failed publication authorizes another step during this window.
    if (
      this.startup &&
      (this.startup.since === undefined ||
        Temporal.Instant.compare(
          observed,
          this.startup.since.add(RESPONSE_WINDOW),
        ) <= 0)
    )
      return this.allowance;

    // A small initial car load is not evidence that the inverter has responded
    // to the full requested load. Always retain the entire startup window.
    if (
      this.startup &&
      commandConfirmed(this.startup.location) &&
      (target === undefined || (state.gridPower as number) <= target)
    )
      this.startup = undefined;

    if (this.response) {
      const responding =
        Temporal.Instant.compare(
          observed,
          this.response.since.add(RESPONSE_WINDOW),
        ) <= 0;
      if (
        responding &&
        target !== undefined &&
        (state.gridPower as number) > target &&
        (state.gridPower as number) <= target + this.response.increment
      )
        return this.allowance;
      // Keep the response window through low-import samples: settings may be
      // echoed before the vehicle draws its newly requested current.
      if (!responding) this.response = undefined;
    }
    if (
      target !== undefined &&
      (state.gridPower as number) > target &&
      demand
    ) {
      const balanced = Math.max(
        0,
        resources.measured + target - (state.gridPower as number),
      );
      this.allowance = Math.min(this.allowance, balanced);
      return this.allowance;
    }
    if (
      dischargeTarget &&
      (state.batteryPower as number) <= -MAX_BATTERY_DISCHARGE_POWER
    )
      return this.allowance;
    if (this.startup) return this.allowance;
    // Household and Manual import cannot be corrected by starting an EV.
    if (
      target !== undefined &&
      (state.gridPower as number) - resources.measured > target
    ) {
      this.allowance = 0;
      return 0;
    }
    const pending = [...this.commands].some(
      ([l, c]) => c.watts > 0 && !commandConfirmed(l),
    );
    // Keep unconfirmed reduction peaks reserved. Confirmed current settings can
    // draw less than nominal 240 V watts without blocking subsequent increases.
    const pendingReduction = [...commitments].some(
      ([l, c]) => c.watts > Math.max(state.wallboxPower.get(l) ?? 0, c.target),
    );
    if (pending || pendingReduction) return this.allowance;
    const candidate = eligible.find(
      (l) =>
        (state.wallboxPower.get(l) ?? 0) <
        (MAX_AMPS_PER_LOCATION.get(l) as number) * SYSTEM_VOLTAGE,
    );
    if (candidate === undefined) return this.allowance;
    const location =
      !isCharging(state.wallboxVictronStatus.get(candidate)) ||
      (state.wallboxPower.get(candidate) ?? 0) <= 0
        ? candidate
        : undefined;
    const increment =
      location !== undefined ? 10 * SYSTEM_VOLTAGE : SYSTEM_VOLTAGE;
    // Add one amp to the reserved current, not voltage-dependent measured watts.
    const next = Math.min(
      resources.installation,
      capacity,
      committed + increment,
    );
    if (next - committed < increment) return this.allowance;
    if (location !== undefined) {
      this.startup = { location, since: undefined };
    }
    this.allowance = next;
    return this.allowance;
  }

  recordCommands(
    builder: CommandBuilder,
    targets: CalculatedTargetResults,
  ): void {
    for (const [l, commitment] of builder.commitments()) {
      const target =
        l === L.Inside ? targets.insideWallboxAmps : targets.outsideWallboxAmps;
      // Reservation and smoothing waits must not turn a positive allocation
      // into a failed attempt. Record genuine stop intent once, even if sending fails.
      if (
        target === 0 &&
        commitment.target === 0 &&
        this.powerStopCandidates.has(l)
      ) {
        this.retryAfter.set(l, this.clock().add(RETRY_DELAY));
        this.powerStopCandidates.delete(l);
      }

      if (
        this.startup?.location === l &&
        this.startup.since === undefined &&
        commitment.target > 0
      )
        this.startup.since = this.clock();

      if (this.commands.get(l)?.watts !== commitment.target) {
        const previous = this.commands.get(l)?.watts ?? 0;
        if (
          this.batteryLocations.includes(l) &&
          previous > 0 &&
          commitment.target > previous
        )
          this.response = {
            since: this.clock(),
            increment: commitment.target - previous,
          };
        this.commands.set(l, { watts: commitment.target, since: this.clock() });
      }
    }
  }
}
