import { type Clock, systemClock } from "./lisbon-clock.ts";
import { Temporal } from "./temporal.ts";
import { WallboxLocation as L, type WallboxStatus } from "./globals.ts";
import {
  CONTROL_PATHS,
  CONTROL_TOPICS,
  wallboxPath,
  validControlValue,
} from "./device-topics.ts";

export interface ControlSnapshot {
  gridPower: number | undefined;
  batterySOC: number | undefined;
  batteryPower: number | undefined;
  batteryMinSOC: number | undefined;
  batteryMaxChargePower: number | undefined;
  pvInverterPower: number;
  pvChargerPower: number | undefined;
  wallboxPower: Map<L, number>;
  wallboxVictronStatus: Map<L, WallboxStatus>;
  wallboxSetCurrent: Map<L, number>;
  wallboxStartStop: Map<L, number>;
  telemetryValid: boolean;
  observedAt: Map<string, Temporal.Instant>;
}

/** Validity belongs to each reading; a keepalive is not a measurement. */
export class ControlTelemetry {
  private readings = new Map<string, { value: number; at: Temporal.Instant }>();

  constructor(private now: Clock = systemClock) {}

  record(path: string, value: unknown): void {
    const topic = CONTROL_TOPICS.find((topic) => topic.path === path);
    if (!topic?.control) return;

    if (!validControlValue(topic.control, value)) {
      this.readings.delete(path);
      return;
    }

    this.readings.set(path, { value, at: this.now() });
  }

  invalidate(): void {
    this.readings.clear();
  }

  value(path: string): number | undefined {
    const reading = this.readings.get(path);
    const now = this.now();
    return reading &&
      Temporal.Instant.compare(now, reading.at) >= 0 &&
      Temporal.Instant.compare(now, reading.at.add({ seconds: 60 })) <= 0
      ? reading.value
      : undefined;
  }

  snapshot(): ControlSnapshot {
    const pvInverterPower = this.value(CONTROL_PATHS.pvInverterPower);
    const map = (field: string) =>
      new Map(
        [L.Inside, L.Outside].flatMap((l) => {
          const value = this.value(wallboxPath(l, field));
          return value === undefined ? [] : [[l, value] as const];
        }),
      );

    return {
      telemetryValid: CONTROL_TOPICS.every(
        (topic) => topic.optional || this.value(topic.path) !== undefined,
      ),
      gridPower: this.value(CONTROL_PATHS.gridPower),
      batterySOC: this.value(CONTROL_PATHS.batterySOC),
      batteryPower: this.value(CONTROL_PATHS.batteryPower),
      batteryMinSOC: this.value(CONTROL_PATHS.batteryMinSOC),
      batteryMaxChargePower: this.value(CONTROL_PATHS.batteryMaxChargePower),
      pvInverterPower: pvInverterPower ?? 0,
      pvChargerPower: this.value(CONTROL_PATHS.pvChargerPower),
      wallboxPower: map("Ac/Power"),
      wallboxVictronStatus: map("Status"),
      wallboxSetCurrent: map("SetCurrent"),
      wallboxStartStop: map("StartStop"),
      observedAt: new Map(
        [...this.readings]
          .filter(([path]) => this.value(path) !== undefined)
          .map(([path, r]) => [path, r.at]),
      ),
    };
  }
}
