import { FORECAST_SOLAR_API_KEY, VICTRON_API_KEY } from "../constants.ts";
import { globals } from "../globals.ts";
import { METRICS } from "../prometheus/metrics.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";

export class LoadForecastTask {
  private readonly forecastSolarApiUrl = `https://api.forecast.solar/${FORECAST_SOLAR_API_KEY}/estimate/watthours/day/41.081591/-8.643748/13/12/8.2`;
  private readonly victronApiUrl = `https://vrmapi.victronenergy.com/v2/installations/176724/stats?type=custom&attributeCodes[]=vrm_pv_charger_yield_fc&interval=days`;
  private metrics: PrometheusMetrics;

  constructor(metrics: PrometheusMetrics) {
    this.metrics = metrics;

    this.execute();
  }

  public async execute(): Promise<void> {
    const forecastSolarValues = await this.fetchSolarForecast();
    this.setMetrics(forecastSolarValues, "solarForecast");
    globals.solarForecastNextDays = forecastSolarValues;

    const victronValues = await this.fetchVictron();
    this.setMetrics(victronValues, "victron");
    globals.victronNextDays = victronValues;
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
    try {
      const response = await fetch(this.forecastSolarApiUrl);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const jsonResponse = (await response.json()) as SolarForecastResponse;

      const today = new Date();

      const indexes = Array.from({ length: 4 }, (_, i) => i);

      return indexes.map((index) => {
        const day = new Date();
        day.setDate(today.getDate() + index);
        return jsonResponse.result[day.toISOString().substring(0, 10)] || 0;
      });
    } catch (error) {
      console.error("Error fetching solar forecast:", error);
      throw error;
    }
  }

  private async fetchVictron(): Promise<number[]> {
    try {
      const headers = {
        "X-Authorization": `Token ${VICTRON_API_KEY}`,
      };

      const midnightOfToday = new Date(
        new Date().setHours(0, 0, 0, 0)
      ).valueOf();
      const midnightOfDayAfterWeek = new Date(
        new Date().setHours(95, 0, 0, 0)
      ).valueOf();

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
    } catch (error) {
      console.error("Error fetching solar forecast:", error);
      throw error;
    }
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
