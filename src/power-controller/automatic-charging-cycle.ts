import { WallboxChargeMode, WallboxLocation } from "../globals.ts";
import { Clock, lisbonTime, timeUntilMorning } from "../lisbon-clock.ts";
import { MqttClient } from "../mqtt-client.ts";
import { CommandBuilder, SystemState } from "./command-builder.ts";
import {
  calculateTargetAmpsAndPriority,
  InputState,
} from "./dynamic-power-calculator.ts";
import { runCommands } from "./power-controller.ts";

type Readings = Omit<
  InputState & SystemState,
  | "primaryWallboxLocation"
  | "wallboxChargeMode"
  | "timeOfDay"
  | "remainingNight"
>;

interface Dependencies {
  telemetry: () => Readings;
  modes: () => Map<WallboxLocation, WallboxChargeMode>;
  clock: Clock;
  publisher: Pick<MqttClient, "publishJson">;
  enabled: boolean;
}

/** Owns one automatic charging cycle and its state across successive ticks. */
export class AutomaticChargingCycle {
  private primary: WallboxLocation | undefined;
  private readonly builder: CommandBuilder;
  private running = false;

  constructor(private readonly dependencies: Dependencies) {
    this.builder = new CommandBuilder(dependencies.clock);
  }

  /** Busy triggers are skipped, not queued. Publication failures reach the caller. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { telemetry, modes, clock, publisher, enabled } = this.dependencies;
      const now = clock();
      const state = {
        ...telemetry(),
        primaryWallboxLocation: this.primary,
        wallboxChargeMode: modes(),
        timeOfDay: lisbonTime(now).toPlainTime(),
        remainingNight: timeUntilMorning(now),
      };
      const targets = calculateTargetAmpsAndPriority(state);
      if (targets.priorityDecision.kind === "clear") {
        this.primary = undefined;
      } else if (targets.priorityDecision.kind === "set") {
        this.primary = targets.priorityDecision.location;
      }
      // Preserve intent even if publication fails or is disabled. Capacity is
      // released by fresh device confirmation, not by transport success.
      const commands = this.builder.createCommandsFromPowerSettings(
        state,
        targets,
      );
      await runCommands(
        commands,
        publisher,
        enabled,
        (location) => modes().get(location),
      );
    } finally {
      this.running = false;
    }
  }
}
