import { Temporal } from "../temporal.ts";
import { type Clock, lisbonTime } from "../lisbon-clock.ts";
import { METRICS } from "../prometheus/metrics.ts";
import type { PrometheusMetrics } from "../prometheus/prometheus.ts";

interface Snapshot {
  values: Map<string, number>;
  fetchedAt: Temporal.Instant;
}

export interface ForecastDisplay {
  updatedAt: {
    forecastSolar: Temporal.Instant | null;
    victron: Temporal.Instant | null;
  };
  days: {
    date: Temporal.PlainDate;
    forecastSolarWh: number | null;
    victronWh: number | null;
  }[];
}

interface Dependencies {
  forecastSolarApiKey: string;
  victronApiKey: string;
  victronInstallationId: string;
  fetch: typeof fetch;
  clock: Clock;
  metrics: Pick<PrometheusMetrics, "setGauge">;
  logError: (message: string) => unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid forecast response object");
  }
  return value as Record<string, unknown>;
}

function validEnergy(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Owns provider refresh, dated evidence and the control/display projections. */
export class SolarForecasts {
  private forecastSolar: Snapshot | undefined;
  private victron: Snapshot | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(private readonly dependencies: Dependencies) {}

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;

    const refresh = this.refreshProviders().finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = refresh;
    return refresh;
  }

  forMinimumSoc(
    date: Temporal.PlainDate,
    at: Temporal.Instant,
  ): number | undefined {
    const snapshot = this.forecastSolar;
    if (
      !snapshot ||
      Temporal.Instant.compare(at, snapshot.fetchedAt) < 0 ||
      Temporal.Instant.compare(at, snapshot.fetchedAt.add({ hours: 6 })) > 0
    )
      return undefined;

    return snapshot.values.get(date.withCalendar("iso8601").toString());
  }

  display(at: Temporal.Instant): ForecastDisplay {
    const today = lisbonTime(at).toPlainDate();
    return {
      updatedAt: {
        forecastSolar: this.forecastSolar?.fetchedAt ?? null,
        victron: this.victron?.fetchedAt ?? null,
      },
      days: Array.from({ length: 4 }, (_, index) => {
        const date = today.add({ days: index });
        return {
          date,
          forecastSolarWh:
            this.forecastSolar?.values.get(date.toString()) ?? null,
          victronWh: this.victron?.values.get(date.toString()) ?? null,
        };
      }),
    };
  }

  private async refreshProviders(): Promise<void> {
    try {
      await this.refreshSolar();
    } catch (error) {
      this.dependencies.logError(`Error fetching solar forecast: ${error}`);
    }

    try {
      await this.refreshVictron();
    } catch (error) {
      this.dependencies.logError(`Error fetching Victron data: ${error}`);
    }
  }

  private publishMetrics(values: number[], source: string): void {
    values.forEach((value, index) => {
      this.dependencies.metrics.setGauge(
        METRICS.GAUGES.ESS_SOLAR_FORECAST,
        value,
        {
          day: index.toString(),
          source,
        },
      );
    });
  }

  private async refreshSolar(): Promise<void> {
    const response = await this.dependencies.fetch(
      `https://api.forecast.solar/${this.dependencies.forecastSolarApiKey}/estimate/watthours/day/41.081591/-8.643748/13/12/8.2`,
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const { result: rawResult } = object(await response.json());
    const result = object(rawResult);
    const values = new Map<string, number>();
    for (const [date, energy] of Object.entries(result)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !validEnergy(energy)) continue;

      try {
        values.set(Temporal.PlainDate.from(date).toString(), energy);
      } catch {
        // One impossible calendar date must not discard other usable dates.
      }
    }

    const fetchedAt = this.dependencies.clock();
    this.forecastSolar = { values, fetchedAt };
    const today = lisbonTime(fetchedAt).toPlainDate();
    this.publishMetrics(
      Array.from(
        { length: 4 },
        (_, index) => values.get(today.add({ days: index }).toString()) ?? 0,
      ),
      "solarForecast",
    );
  }

  private async refreshVictron(): Promise<void> {
    const midnight = lisbonTime(this.dependencies.clock()).startOfDay();
    const start = Math.floor(midnight.epochMilliseconds / 1000);
    const end = Math.floor(midnight.add({ days: 4 }).epochMilliseconds / 1000);
    const response = await this.dependencies.fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${this.dependencies.victronInstallationId}/stats?type=custom&attributeCodes[]=vrm_pv_charger_yield_fc&interval=days&start=${start}&end=${end}`,
      {
        headers: {
          "X-Authorization": `Token ${this.dependencies.victronApiKey}`,
        },
      },
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const { records: rawRecords } = object(await response.json());
    const { vrm_pv_charger_yield_fc: records } = object(rawRecords);
    if (!Array.isArray(records) || !records.every(Array.isArray)) {
      throw new Error("Invalid Victron forecast records");
    }

    const values = new Map<string, number>();
    for (const record of records) {
      const [timestamp, energy] = record;
      if (
        typeof timestamp !== "number" ||
        !Number.isSafeInteger(timestamp) ||
        !validEnergy(energy)
      )
        continue;

      try {
        const date = lisbonTime(
          Temporal.Instant.fromEpochMilliseconds(timestamp),
        ).toPlainDate();
        const adjusted = Math.floor(energy * 1.5);
        if (Number.isFinite(adjusted)) values.set(date.toString(), adjusted);
      } catch {
        // Invalid timestamps cannot shift later records into their position.
      }
    }

    this.victron = { values, fetchedAt: this.dependencies.clock() };

    // Monitoring compatibility: provider-order indices and JS numeric coercion.
    // This deliberately differs from the validated dated display projection.
    const legacyMetricValues = records.map((record) =>
      Math.floor((record[1] as number) * 1.5),
    );
    this.publishMetrics(legacyMetricValues, "victron");
  }
}
