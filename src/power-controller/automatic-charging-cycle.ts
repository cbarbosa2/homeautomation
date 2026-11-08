import { WallboxChargeMode, type WallboxLocation } from "../globals.ts";
import type { VehicleSoc } from "../bmw-cardata/bmw-cardata.ts";
import { type Clock, lisbonTime, timeUntilMorning } from "../lisbon-clock.ts";
import type { MqttClient } from "../mqtt-client.ts";
import { CommandBuilder, type SystemState } from "./command-builder.ts";
import {
  calculatePowerTargets,
  type InputState,
} from "./dynamic-power-calculator.ts";
import { runCommands } from "./power-controller.ts";
import { Temporal } from "../temporal.ts";

import { BatterySupportController } from "./battery-support-controller.ts";

const VEHICLE_SOC_MAX_AGE = Temporal.Duration.from({ minutes: 90 });

type Readings = Omit<
  InputState & SystemState,
  | "preferredWallboxLocation"
  | "wallboxChargeMode"
  | "timeOfDay"
  | "remainingNight"
>;

interface Dependencies {
  telemetry: () => Readings;
  modes: () => Map<WallboxLocation, WallboxChargeMode>;
  preference: () => WallboxLocation;
  insideVehicleSoc?: () => VehicleSoc | undefined;
  clock: Clock;
  publisher: Pick<MqttClient, "publishJson">;
  enabled: boolean;
}

/** Owns one automatic charging cycle and its state across successive ticks. */
export class AutomaticChargingCycle {
  private readonly builder: CommandBuilder;
  private readonly support: BatterySupportController;
  private running = false;

  constructor(private readonly dependencies: Dependencies) {
    this.builder = new CommandBuilder(dependencies.clock);
    this.support = new BatterySupportController(dependencies.clock);
  }

  getBatteryDischargeStatus() {
    return this.support.getDischargeStatus(
      this.dependencies.telemetry().telemetryValid !== false,
    );
  }

  /** Busy triggers are skipped, not queued. Publication failures reach the caller. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { telemetry, modes, insideVehicleSoc, clock, publisher, enabled } =
        this.dependencies;
      const now = clock();
      const insideVehicleReading = insideVehicleSoc?.();
      const insideVehicleSOC =
        insideVehicleReading &&
        Temporal.Instant.compare(insideVehicleReading.observedAt, now) <= 0 &&
        Temporal.Instant.compare(
          insideVehicleReading.observedAt.add(VEHICLE_SOC_MAX_AGE),
          now,
        ) >= 0
          ? insideVehicleReading.percent
          : undefined;
      const state = {
        ...telemetry(),
        insideVehicleSOC,
        preferredWallboxLocation: this.dependencies.preference(),
        wallboxChargeMode: new Map(modes()),
        timeOfDay: lisbonTime(now).toPlainTime(),
        remainingNight: timeUntilMorning(now),
      };
      const batterySupportWatts = this.support.allowanceFor(
        state,
        this.builder,
      );
      const targets = calculatePowerTargets({
        ...state,
        batterySupportWatts,
        batterySupportBlockedLocations: this.support.retryBlockedLocations(),
        batterySupportFailedLocations: this.support.failedLocations(),
      });

      // Preserve intent even if publication fails or is disabled. Capacity is
      // released by fresh device confirmation, not by transport success.
      const commands = this.builder.createCommandsFromPowerSettings(
        state,
        targets,
      );
      this.support.recordCommands(this.builder, targets);
      await runCommands(commands, publisher, enabled, (location) =>
        modes().get(location) === state.wallboxChargeMode.get(location)
          ? modes().get(location)
          : WallboxChargeMode.Manual,
      );
    } finally {
      this.running = false;
    }
  }
}
