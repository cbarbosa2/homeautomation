import { VICTRON_PORTAL_ID } from "./constants.ts";
import { type Clock, systemClock } from "./lisbon-clock.ts";
import { Temporal } from "./temporal.ts";

export const BATTERY_CELL_PATHS = {
  minCellVoltage: "battery/512/System/MinCellVoltage",
  maxCellVoltage: "battery/512/System/MaxCellVoltage",
  minVoltagePackName: "battery/512/System/MinVoltageCellId",
  maxVoltagePackName: "battery/512/System/MaxVoltageCellId",
};

type VoltageSample = {
  voltage: number;
  packName: string | null;
  at: Temporal.Instant;
};

export class BatteryCellTelemetry {
  private packs = new Map<string, { value: string; at: Temporal.Instant }>();
  private minimums: VoltageSample[] = [];
  private maximums: VoltageSample[] = [];

  constructor(private now: Clock = systemClock) {}

  record(topic: string, payload: unknown): void {
    const path = topic.replace(`N/${VICTRON_PORTAL_ID}/`, "");
    if (!Object.values(BATTERY_CELL_PATHS).includes(path)) return;
    const now = this.now();
    this.prune(now);
    const value =
      payload !== null && typeof payload === "object" && "value" in payload
        ? payload.value
        : undefined;

    if (path.endsWith("CellId")) {
      if (typeof value === "string" && value.trim().length > 0) {
        this.packs.set(path, { value, at: now });
      } else {
        this.packs.delete(path);
      }
      return;
    }

    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      return;

    const isMinimum = path === BATTERY_CELL_PATHS.minCellVoltage;
    const pack = this.packs.get(
      isMinimum
        ? BATTERY_CELL_PATHS.minVoltagePackName
        : BATTERY_CELL_PATHS.maxVoltagePackName,
    );
    const packName =
      pack &&
      Temporal.Instant.compare(now, pack.at) >= 0 &&
      Temporal.Instant.compare(now, pack.at.add({ seconds: 60 })) <= 0
        ? pack.value
        : null;
    const samples = isMinimum ? this.minimums : this.maximums;
    samples.push({ voltage: value, packName, at: now });
  }

  invalidate(): void {
    // Historical observations remain valid through a broker disconnect.
    this.packs.clear();
  }

  private prune(now: Temporal.Instant): void {
    const cutoff = now.subtract({ hours: 12 });
    this.minimums = this.minimums.filter(
      (sample) => Temporal.Instant.compare(sample.at, cutoff) >= 0,
    );
    this.maximums = this.maximums.filter(
      (sample) => Temporal.Instant.compare(sample.at, cutoff) >= 0,
    );
  }

  private extreme(
    samples: VoltageSample[],
    minimum: boolean,
    now: Temporal.Instant,
  ): VoltageSample | null {
    let result: VoltageSample | null = null;
    for (const sample of samples) {
      if (Temporal.Instant.compare(sample.at, now) > 0) continue;
      if (
        result === null ||
        (minimum
          ? sample.voltage < result.voltage
          : sample.voltage > result.voltage) ||
        (sample.voltage === result.voltage &&
          Temporal.Instant.compare(sample.at, result.at) >= 0)
      ) {
        result = sample;
      }
    }
    return result;
  }

  snapshot() {
    const now = this.now();
    this.prune(now);
    const minimum = this.extreme(this.minimums, true, now);
    const maximum = this.extreme(this.maximums, false, now);

    return {
      minCellVoltage: minimum?.voltage ?? null,
      maxCellVoltage: maximum?.voltage ?? null,
      minVoltagePackName: minimum?.packName ?? null,
      maxVoltagePackName: maximum?.packName ?? null,
      minCellVoltageAt: minimum?.at.toString() ?? null,
      maxCellVoltageAt: maximum?.at.toString() ?? null,
    };
  }
}

export const batteryCellTelemetry = new BatteryCellTelemetry();
