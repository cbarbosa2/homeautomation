import { type Clock, systemClock } from "../lisbon-clock.ts";
import { Temporal } from "../temporal.ts";
import { isCharging, wallboxAmps } from "./wallbox-policy.ts";
import {
  WallboxChargeMode as Mode,
  WallboxLocation as L,
  WallboxStatus,
} from "../globals.ts";
import { CONTROL_PATHS, wallboxPath } from "../device-topics.ts";
import { SYSTEM_VOLTAGE } from "../utils/index.ts";
import {
  type CalculatedTargetResults,
  LOCATIONS,
} from "./dynamic-power-calculator.ts";
import {
  MAX_AMPS_PER_LOCATION,
  MAX_BATTERY_CHARGE_POWER,
  WALLBOX_MIN_START_AMPS,
} from "./power-constants.ts";
import { CommandType, type PowerCommand } from "./power-controller.ts";

export interface SystemState {
  batteryMaxChargePower: number | undefined;
  batteryPower?: number | undefined;
  wallboxPower: Map<L, number>;
  wallboxVictronStatus: Map<L, WallboxStatus>;
  wallboxChargeMode?: Map<L, Mode>;
  wallboxSetCurrent?: Map<L, number>;
  wallboxStartStop?: Map<L, number>;
  observedAt?: Map<string, Temporal.Instant>;
}

type Device = L | "battery";
interface Reservation {
  watts: number;
  target: number;
  since: Temporal.Instant | undefined;
  pendingPeak: number;
}

/** Reductions are immediate. Increases wait for smoothing and device feedback. */
export class CommandBuilder {
  private history = new Map<L, number[]>();
  private modes = new Map<L, Mode>();
  private reservations = new Map<Device, Reservation>();
  constructor(private now: Clock = systemClock) {}

  public commitments(): Map<
    L,
    { watts: number; target: number; since: Temporal.Instant | undefined }
  > {
    return new Map(
      LOCATIONS.flatMap((l) => {
        const reservation = this.reservations.get(l);
        return reservation ? [[l, { ...reservation }] as const] : [];
      }),
    );
  }

  public createCommandsFromPowerSettings(
    state: SystemState,
    targets: CalculatedTargetResults,
  ): PowerCommand[] {
    const desired = new Map<Device, number>();
    for (const l of LOCATIONS) {
      const mode = state.wallboxChargeMode?.get(l);
      if (mode !== this.modes.get(l)) this.history.delete(l);
      if (mode !== undefined) this.modes.set(l, mode);
      if (this.reservations.has(l)) this.refreshReservation(l, state);
    }
    for (const l of LOCATIONS) {
      const target =
        l === L.Inside ? targets.insideWallboxAmps : targets.outsideWallboxAmps;
      if (
        state.wallboxChargeMode?.get(l) === Mode.Manual ||
        target === undefined
      ) {
        this.history.delete(l);
        continue;
      }
      const history = this.history.get(l) ?? [];
      history.push(Math.max(0, Math.floor(target)));
      if (history.length > 15) history.shift();
      this.history.set(l, history);
      const amps = wallboxAmps(
        l,
        state.wallboxVictronStatus.get(l),
        Math.min(...history) * SYSTEM_VOLTAGE,
      );
      desired.set(l, amps * SYSTEM_VOLTAGE);
    }
    if (targets.batteryChargePower !== undefined) {
      desired.set(
        "battery",
        Math.max(0, Math.floor(targets.batteryChargePower)),
      );
    }

    // Reserve outstanding commands, including starts which have not drawn power
    // yet. A reduction frees capacity only after fresh settings AND power agree.
    for (const device of desired.keys()) this.refreshReservation(device, state);
    const reductions: PowerCommand[] = [];
    const increases: PowerCommand[] = [];
    for (const [device, wanted] of desired) {
      const reservation = this.reservations.get(device) as Reservation;
      const others = [...this.reservations].reduce(
        (sum, [d, r]) =>
          sum +
          (d === device
            ? 0
            : Math.max(
                0,
                r.watts -
                  (d !== "battery" &&
                  state.wallboxChargeMode?.get(d) === Mode.Manual
                    ? (state.wallboxPower.get(d) ?? 0)
                    : 0),
              )),
        0,
      );
      const headroom = Math.max(
        0,
        (targets.sharedBudgetWatts ?? Infinity) - others,
      );
      let watts = Math.min(wanted, headroom);
      if (device !== "battery") {
        for (const constraint of targets.supplyConstraints ?? []) {
          // Unrestricted requests still count against limited EVs' reservations,
          // but are bounded themselves only by installation headroom.
          if (targets.unrestrictedLocations?.includes(device)) continue;
          if (!constraint.locations.includes(device)) continue;
          const committed = constraint.locations.reduce(
            (sum, l) =>
              sum + (l === device ? 0 : (this.reservations.get(l)?.watts ?? 0)),
            0,
          );
          watts = Math.min(watts, Math.max(0, constraint.watts - committed));
        }
      }
      if (device !== "battery") {
        const amps = wallboxAmps(
          device,
          state.wallboxVictronStatus.get(device),
          watts,
        );
        watts = amps * SYSTEM_VOLTAGE;
      } else watts = Math.floor(watts);
      const destination = watts <= reservation.watts ? reductions : increases;
      if (device === "battery") {
        if (
          watts !== state.batteryMaxChargePower ||
          watts !== reservation.target
        ) {
          destination.push({
            type: CommandType.BatteryMaxChargePower,
            value: watts,
          });
        }
      } else {
        const currentType =
          device === L.Inside
            ? CommandType.InsideCurrent
            : CommandType.OutsideCurrent;
        const switchType =
          device === L.Inside
            ? CommandType.InsideStartStop
            : CommandType.OutsideStartStop;
        if (watts === 0) {
          // Intent is sufficient to stop; missing power is not evidence of idle.
          if (
            reservation.target > 0 ||
            state.wallboxStartStop?.get(device) !== 0 ||
            state.wallboxVictronStatus.get(device) ===
              WallboxStatus.StartCharging ||
            isCharging(state.wallboxVictronStatus.get(device))
          ) {
            destination.push({ type: switchType, value: 0 });
          }
        } else {
          const amps = watts / SYSTEM_VOLTAGE;
          if (
            watts !== reservation.target ||
            state.wallboxSetCurrent?.get(device) !== amps
          )
            destination.push({ type: currentType, value: amps });
          if (
            !isCharging(state.wallboxVictronStatus.get(device)) &&
            amps >= WALLBOX_MIN_START_AMPS
          )
            destination.push({ type: switchType, value: 1 });
        }
      }
      if (watts !== reservation.target) {
        // Keep the first reduction timestamp while targets fluctuate. Device
        // settings and measured power can be refreshed on different ticks.
        if (reservation.target >= reservation.watts) {
          reservation.since = this.now();
          reservation.pendingPeak = watts;
        } else {
          reservation.pendingPeak = Math.max(reservation.pendingPeak, watts);
        }
        reservation.target = watts;
      }
      reservation.watts = Math.max(reservation.watts, watts);
    }
    return [...reductions, ...increases];
  }

  private refreshReservation(device: Device, state: SystemState): void {
    const isBattery = device === "battery";
    const measured = Math.max(
      0,
      isBattery
        ? (state.batteryPower ?? 0)
        : (state.wallboxPower.get(device) ?? 0),
    );
    const setting = isBattery
      ? state.batteryMaxChargePower
      : state.wallboxStartStop?.get(device) === 0
        ? 0
        : state.wallboxSetCurrent?.get(device);
    const configured =
      setting === undefined || setting < 0
        ? isBattery
          ? MAX_BATTERY_CHARGE_POWER
          : (MAX_AMPS_PER_LOCATION.get(device) as number) * SYSTEM_VOLTAGE
        : setting * (isBattery ? 1 : SYSTEM_VOLTAGE);
    const old = this.reservations.get(device);
    const paths = isBattery
      ? [CONTROL_PATHS.batteryMaxChargePower, CONTROL_PATHS.batteryPower]
      : [
          wallboxPath(device, "Ac/Power"),
          wallboxPath(device, "SetCurrent"),
          wallboxPath(device, "StartStop"),
        ];
    const fresh = paths.every((p) => {
      const observedAt = state.observedAt?.get(p);
      return (
        observedAt !== undefined &&
        (old?.since === undefined ||
          Temporal.Instant.compare(observedAt, old.since) > 0)
      );
    });
    if (!old) {
      // Without telemetry metadata (pure callers), retain measured consumption.
      const watts = Math.max(
        measured,
        state.observedAt || setting !== undefined ? configured : 0,
      );
      this.reservations.set(device, {
        watts,
        target: watts,
        since: undefined,
        pendingPeak: watts,
      });
    } else if (
      fresh &&
      device !== "battery" &&
      state.wallboxChargeMode?.get(device) === Mode.Manual
    ) {
      old.watts = Math.max(configured, measured);
      old.target = configured;
      old.pendingPeak = configured;
    } else if (
      fresh &&
      old.target < old.watts &&
      configured < old.watts &&
      measured < old.watts
    ) {
      old.watts = Math.max(configured, measured, old.pendingPeak);
      // The historical peak has now been covered by fresh device feedback.
      // Retain it for this observation, then require another fresh confirmation
      // before releasing the remaining capacity to the latest target.
      old.pendingPeak = old.target;
      old.since = this.now();
    } else {
      old.watts = Math.max(
        old.watts,
        measured,
        setting === undefined ? 0 : configured,
      );
    }
  }
}
