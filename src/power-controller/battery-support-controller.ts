import type { Clock } from "../lisbon-clock.ts";
import { Temporal } from "../temporal.ts";
import { CONTROL_PATHS as P, wallboxPath } from "../control-telemetry.ts";
import type { WallboxLocation as L } from "../globals.ts";
import { MAX_AMPS_PER_LOCATION } from "./power-constants.ts";
import { SYSTEM_VOLTAGE } from "../utils/index.ts";
import { validTelemetry } from "./charge-mode-policy.ts";
import {
  effectivePolicies,
  powerResources,
  priorityOrder,
  type InputState,
} from "./dynamic-power-calculator.ts";
import type { SystemState, CommandBuilder } from "./command-builder.ts";

const RESPONSE_WINDOW = Temporal.Duration.from({ seconds: 15 });

type State = InputState & SystemState;

export interface BatteryDischargeStatus {
  state: "confirmed" | "checking" | "blocked" | "unknown";
  reason: string;
}

export function unknownDischargeStatus(): BatteryDischargeStatus {
  return { state: "unknown", reason: "Discharge has not been checked yet." };
}

/** Shared discharge discovery. SOC permits an attempt, never proves capacity. */
export class BatterySupportController {
  private failure: { soc: number; minimum: number } | undefined;
  private highImportSince: Temporal.Instant | undefined;
  private lastObservation: Temporal.Instant | undefined;
  private signature = "";
  private confirmed = false;
  private attempt: { location: L; since: Temporal.Instant } | undefined;
  private response: { since: Temporal.Instant; increment: number } | undefined;
  private batteryLocations: L[] = [];
  private commands = new Map<L, { watts: number; since: Temporal.Instant }>();
  private allowance = 0;
  private dischargeCeiling:
    | { watts: number; soc: number; minimum: number }
    | undefined;

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
    if ((state.batterySOC as number) <= (state.batteryMinSOC as number))
      return {
        state: "blocked",
        reason: "Battery SOC is at or below the minimum.",
      };
    if (this.failure)
      return {
        state: "blocked",
        reason:
          "Discharge attempt failed. Retry after SOC rises one percentage point from the failed attempt or minimum SOC changes.",
      };
    if (
      ![...effectivePolicies(state).values()].some(
        (p) => p.supply === "battery",
      )
    )
      return {
        state: "unknown",
        reason: "No eligible wallbox currently requests battery support.",
      };
    if (this.confirmed)
      return {
        state: "confirmed",
        reason: "The controller has observed the battery discharging.",
      };
    if (this.attempt)
      return {
        state: "checking",
        reason: "Waiting for the battery to respond to a discharge attempt.",
      };

    return { state: "unknown", reason: "Waiting for a discharge check." };
  }

  allowanceFor(state: State, builder: CommandBuilder): number {
    const allowance = this.calculateAllowance(state, builder);
    this.dischargeStatus = this.statusFor(state);
    this.evaluatedAt = this.clock();
    return allowance;
  }

  private calculateAllowance(state: State, builder: CommandBuilder): number {
    const policies = effectivePolicies(state);
    const eligible = priorityOrder(state).filter(
      (l) => policies.get(l)?.supply === "battery",
    );
    this.batteryLocations = eligible;
    const signature = JSON.stringify(
      [...state.wallboxChargeMode, ...policies].map(([l, p]) => [l, p]),
    );
    if (!validTelemetry(state) || signature !== this.signature) {
      this.confirmed = false;
      this.attempt = undefined;
      this.response = undefined;
      this.lastObservation = undefined;
      this.highImportSince = undefined;
      this.allowance = 0;
      this.dischargeCeiling = undefined;
      this.signature = signature;
    }
    if (!validTelemetry(state)) return 0;
    const soc = state.batterySOC as number;
    const minimum = state.batteryMinSOC as number;
    if (
      this.dischargeCeiling &&
      (minimum !== this.dischargeCeiling.minimum ||
        soc >= this.dischargeCeiling.soc + 1)
    )
      this.dischargeCeiling = undefined;
    if (
      this.failure &&
      (minimum !== this.failure.minimum || soc >= this.failure.soc + 1)
    ) {
      this.failure = undefined;
      this.confirmed = false;
    }
    if (this.failure || soc <= minimum || !eligible.length) return 0;

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
    const target =
      [...policies.values()].some((p) => p.supply === "solar") &&
      resources.solar >= 7 * SYSTEM_VOLTAGE
        ? 0
        : 99;
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
    const discharging = (state.batteryPower as number) < 0;
    if (discharging) {
      this.confirmed = true;
      this.highImportSince = undefined;
    } else if (demand && (state.gridPower as number) > 200) {
      this.highImportSince ??= observed;
      if (
        Temporal.Instant.compare(
          observed,
          this.highImportSince.add(RESPONSE_WINDOW),
        ) > 0
      ) {
        this.failure = { soc, minimum };
        this.confirmed = false;
        this.attempt = undefined;
        this.allowance = 0;
        return 0;
      }
    } else this.highImportSince = undefined;

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
        (state.wallboxPower.get(l) ?? 0) >= command.watts - SYSTEM_VOLTAGE / 2
      );
    };
    if (
      this.attempt &&
      this.confirmed &&
      commandConfirmed(this.attempt.location) &&
      (state.gridPower as number) <= target
    )
      this.attempt = undefined;

    // A solar allocation or outstanding reservation may have prevented the
    // intended startup. Re-evaluate it against the now-confirmed total load.
    if (this.attempt && this.commands.get(this.attempt.location)?.watts === 0)
      this.attempt = undefined;

    // A startup may briefly import while the inverter responds. No repeated
    // telemetry or failed publication authorizes another step during this window.
    if (
      this.attempt &&
      ((!this.confirmed && this.highImportSince !== undefined) ||
        Temporal.Instant.compare(
          observed,
          this.attempt.since.add(RESPONSE_WINDOW),
        ) <= 0)
    )
      return this.allowance;
    if (this.response) {
      const responding =
        Temporal.Instant.compare(
          observed,
          this.response.since.add(RESPONSE_WINDOW),
        ) <= 0;
      if (
        responding &&
        (state.gridPower as number) > target &&
        (state.gridPower as number) <= target + this.response.increment
      )
        return this.allowance;
      this.response = undefined;
    }
    const balanced = Math.max(
      0,
      resources.measured + target - (state.gridPower as number),
    );
    if ((state.gridPower as number) > target && demand) {
      if (discharging)
        this.dischargeCeiling = {
          watts: -(state.batteryPower as number),
          soc,
          minimum,
        };
      this.allowance = Math.min(this.allowance, balanced);
      return this.allowance;
    }
    if (this.attempt) return this.allowance;
    // Household and Manual import cannot be corrected by starting an EV.
    if ((state.gridPower as number) - resources.measured > target) {
      this.allowance = 0;
      return 0;
    }
    const pending = [...this.commands].some(
      ([l, c]) => c.watts > 0 && !commandConfirmed(l),
    );
    if (pending || committed > resources.measured + SYSTEM_VOLTAGE / 2)
      return this.allowance;
    const candidate = eligible.find(
      (l) =>
        (state.wallboxPower.get(l) ?? 0) <
        (MAX_AMPS_PER_LOCATION.get(l) as number) * SYSTEM_VOLTAGE,
    );
    if (candidate === undefined) return this.allowance;
    const location =
      (state.wallboxPower.get(candidate) ?? 0) < 7 * SYSTEM_VOLTAGE
        ? candidate
        : undefined;
    const increment =
      location !== undefined ? 10 * SYSTEM_VOLTAGE : SYSTEM_VOLTAGE;
    if (!this.confirmed && location === undefined) {
      // An existing load after restart still needs a bounded discovery attempt.
      this.attempt = { location: eligible[0] as L, since: this.clock() };
      this.allowance = resources.measured;
      return this.allowance;
    }
    // After reaching the inverter's observed limit, retain that ceiling while
    // adapting it to household/PV changes. This avoids a permanent sawtooth of
    // import excursions. A higher measured discharge or SOC recovery reopens it.
    if (
      this.dischargeCeiling &&
      -(state.batteryPower as number) > this.dischargeCeiling.watts
    )
      this.dischargeCeiling.watts = -(state.batteryPower as number);
    const baseline =
      (state.gridPower as number) -
      resources.measured -
      (state.batteryPower as number);
    const ceiling = this.dischargeCeiling
      ? this.dischargeCeiling.watts + target - baseline
      : Infinity;
    const next = Math.min(
      resources.installation,
      resources.measured + increment,
      ceiling,
    );
    if (next - committed < increment) return this.allowance;
    if (location !== undefined) {
      this.confirmed = false;
      this.attempt = { location, since: this.clock() };
    }
    this.allowance = next;
    return this.allowance;
  }

  recordCommands(builder: CommandBuilder): void {
    for (const [l, commitment] of builder.commitments()) {
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
