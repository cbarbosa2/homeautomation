import { SolarForecasts } from "../solar-forecasts.ts";
import { Temporal } from "../temporal.ts";
import { lisbonTime, systemClock } from "../lisbon-clock.ts";
import {
  FORECAST_SOLAR_API_KEY,
  VICTRON_API_KEY,
  VICTRON_INSTALLATION_ID,
} from "../constants.ts";
import { globals } from "../globals.ts";
import { logError } from "../logger.ts";
import { METRICS } from "../prometheus/metrics.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";

export class LoadForecastTask {
  private readonly forecastSolarApiUrl =
    `https://api.forecast.solar/${FORECAST_SOLAR_API_KEY}/estimate/watthours/day/41.081591/-8.643748/13/12/8.2`;
  private readonly victronApiUrl =
    `https://vrmapi.victronenergy.com/v2/installations/${VICTRON_INSTALLATION_ID}/stats?type=custom&attributeCodes[]=vrm_pv_charger_yield_fc&interval=days`;
  private metrics: Pick<PrometheusMetrics, "setGauge">;

  constructor(metrics: Pick<PrometheusMetrics, "setGauge">) {
    this.metrics = metrics;

    this.execute();
  }

  public async execute(): Promise<void> {
    try {
      const forecastSolarValues = await this.fetchSolarForecast();
      this.setMetrics(forecastSolarValues, "solarForecast");
      globals.solarForecastNextDays = forecastSolarValues;
    } catch (error) {
      logError(`Error fetching solar forecast: ${error}`);
    }

    try {
      const victronValues = await this.fetchVictron();
      this.setMetrics(victronValues, "victron");
      globals.victronNextDays = victronValues;
    } catch (error) {
      logError(`Error fetching Victron data: ${error}`);
    }
  }

  private setMetrics(values: number[], source: string) {
    values.forEach((value, index) => {
      this.metrics.setGauge(METRICS.GAUGES.ESS_SOLAR_FORECAST, value, {
        day: index.toString(),
        source: source,
      });
    });
  }

  private async fetchSolarForecast(): Promise<number[]> {
    const response = await fetch(this.forecastSolarApiUrl);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const jsonResponse = (await response.json()) as SolarForecastResponse;

    const now = systemClock();
    const today = lisbonTime(now).toPlainDate();
    const entries = Object.entries(jsonResponse.result).filter((
      [date, value],
    ) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof value === "number" &&
      Number.isFinite(value) && value >= 0
    );
    globals.solarForecastByDate = new SolarForecasts(
      entries.map((
        [date, wattHours],
      ) => [Temporal.PlainDate.from(date), { wattHours, fetchedAt: now }]),
    );
    return Array.from(
      { length: 4 },
      (_, index) =>
        globals.solarForecastByDate.get(today.add({ days: index }))
          ?.wattHours ?? 0,
    );
  }

  private async fetchVictron(): Promise<number[]> {
    const headers = {
      "X-Authorization": `Token ${VICTRON_API_KEY}`,
    };

    const midnight = lisbonTime(systemClock()).startOfDay();
    const midnightOfToday = midnight.epochMilliseconds;
    const midnightOfDayAfterWeek = midnight.add({ days: 4 }).epochMilliseconds;

    const start = Math.floor(midnightOfToday / 1000);
    const end = Math.floor(midnightOfDayAfterWeek / 1000);

    const apiUrl = `${this.victronApiUrl}&start=${start}&end=${end}`;

    const response = await fetch(apiUrl, {
      headers: headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const jsonResponse = (await response.json()) as VictronResponse;

    // add 50% more to account for Inverter as that would require an additional HTTP call, not worth it
    return jsonResponse.records.vrm_pv_charger_yield_fc.map((value) =>
      Math.floor(value[1]! * 1.5)
    );
  }
}

interface SolarForecastResponse {
  result: { [day: string]: number };
}

// global.set("solarForecast", values);
interface VictronResponse {
  records: {
    vrm_pv_charger_yield_fc: number[][];
  };
}
