import { Clock, systemClock } from "../lisbon-clock.ts";
import { Temporal } from "../temporal.ts";
import { isCharging, wallboxAmps } from "./wallbox-policy.ts";
import {
  WallboxChargeMode as Mode,
  WallboxLocation as L,
  WallboxStatus,
} from "../globals.ts";
import { CONTROL_PATHS, wallboxPath } from "../control-telemetry.ts";
import { SYSTEM_VOLTAGE } from "../utils.ts";
import {
  CalculatedTargetResults,
  LOCATIONS,
} from "./dynamic-power-calculator.ts";
import {
  MAX_AMPS_PER_LOCATION,
  MAX_BATTERY_CHARGE_POWER,
  WALLBOX_MIN_START_AMPS,
} from "./power-constants.ts";
import { CommandType, PowerCommand } from "./power-controller.ts";

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
}

/** Reductions are immediate. Increases wait for smoothing and device feedback. */
export class CommandBuilder {
  private history = new Map<L, number[]>();
  private reservations = new Map<Device, Reservation>();
  constructor(private now: Clock = systemClock) {}

  public createCommandsFromPowerSettings(
    state: SystemState,
    targets: CalculatedTargetResults,
  ): PowerCommand[] {
    const desired = new Map<Device, number>();
    for (const l of LOCATIONS) {
      const target = l === L.Inside
        ? targets.insideWallboxAmps
        : targets.outsideWallboxAmps;
      if (
        state.wallboxChargeMode?.get(l) === Mode.Manual || target === undefined
      ) {
        this.history.delete(l);
        this.reservations.delete(l);
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
      const reservation = this.reservations.get(device)!;
      const others = [...this.reservations].reduce(
        (sum, [d, r]) => sum + (d === device ? 0 : r.watts),
        0,
      );
      const headroom = Math.max(
        0,
        (targets.sharedBudgetWatts ?? Infinity) - others,
      );
      let watts = Math.min(wanted, headroom);
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
          watts !== state.batteryMaxChargePower || watts !== reservation.target
        ) {
          destination.push({
            type: CommandType.BatteryMaxChargePower,
            value: watts,
          });
        }
      } else {
        const currentType = device === L.Inside
          ? CommandType.InsideCurrent
          : CommandType.OutsideCurrent;
        const switchType = device === L.Inside
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
          ) destination.push({ type: currentType, value: amps });
          if (
            !isCharging(state.wallboxVictronStatus.get(device)) &&
            amps >= WALLBOX_MIN_START_AMPS
          ) destination.push({ type: switchType, value: 1 });
        }
      }
      if (watts !== reservation.target) {
        reservation.target = watts;
        reservation.since = this.now();
      }
      reservation.watts = Math.max(reservation.watts, watts);
    }
    return [...reductions, ...increases];
  }

  private refreshReservation(device: Device, state: SystemState): void {
    const isBattery = device === "battery";
    const measured = Math.max(
      0,
      isBattery ? state.batteryPower ?? 0 : state.wallboxPower.get(device) ?? 0,
    );
    const setting = isBattery
      ? state.batteryMaxChargePower
      : state.wallboxStartStop?.get(device) === 0
      ? 0
      : state.wallboxSetCurrent?.get(device);
    const configured = setting === undefined || setting < 0
      ? (isBattery
        ? MAX_BATTERY_CHARGE_POWER
        : MAX_AMPS_PER_LOCATION.get(device)! * SYSTEM_VOLTAGE)
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
      return observedAt !== undefined &&
        (old?.since === undefined ||
          Temporal.Instant.compare(observedAt, old.since) > 0);
    });
    if (!old) {
      // Without telemetry metadata (pure callers), retain measured consumption.
      const watts = Math.max(
        measured,
        (state.observedAt || setting !== undefined) ? configured : 0,
      );
      this.reservations.set(device, { watts, target: watts, since: undefined });
    } else if (fresh && configured <= old.target && measured <= old.target) {
      old.watts = Math.max(configured, measured);
    } else {
      old.watts = Math.max(
        old.watts,
        measured,
        setting === undefined ? 0 : configured,
      );
    }
  }
}
