import { FORECAST_SOLAR_API_KEY, VICTRON_API_KEY } from "../constants.ts";
import { globals, logGlobals } from "../globals.ts";
import { PrometheusMetrics, METRICS } from "../prometheus.ts";

export class LoadForecastTask {
  private forecastInterval: number | null = null;
  private readonly forecastSolarApiUrl = `https://api.forecast.solar/${FORECAST_SOLAR_API_KEY}/estimate/watthours/day/41.081591/-8.643748/13/12/8.2`;
  private readonly victronApiUrl = `https://vrmapi.victronenergy.com/v2/installations/176724/stats?type=custom&attributeCodes[]=vrm_pv_charger_yield_fc&interval=days`;
  private metrics: PrometheusMetrics;

  constructor(metrics: PrometheusMetrics) {
    this.metrics = metrics;
  }

  start(): void {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);

    const timeToNextHour = nextHour.getTime() - now.getTime();

    // Fetch immediately on startup
    this.loadForecast();

    // Schedule to run at the next hour
    setTimeout(() => {
      this.loadForecast();

      // Then run every hour
      this.forecastInterval = setInterval(() => {
        this.loadForecast();
      }, 60 * 60 * 1000); // 1 hour in milliseconds
    }, timeToNextHour);
  }

  stop(): void {
    if (this.forecastInterval) {
      clearInterval(this.forecastInterval);
      this.forecastInterval = null;
    }
  }

  private async loadForecast(): Promise<void> {
    const forecastSolarValues = await this.fetchSolarForecast();
    this.setMetrics(forecastSolarValues, "solarForecast");
    globals.solarForecastNextDays = forecastSolarValues;

    const victronValues = await this.fetchVictron();
    this.setMetrics(victronValues, "victron");
    globals.victronNextDays = victronValues;

    logGlobals();
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
