import { FORECAST_SOLAR_API_KEY } from "../constants.ts";
import { globals, logGlobals } from "../globals.ts";
import { PrometheusMetrics, METRICS } from "../prometheus.ts";

export class LoadForecastTask {
  private forecastInterval: number | null = null;
  private readonly apiUrl = `https://api.forecast.solar/${FORECAST_SOLAR_API_KEY}/estimate/watthours/day/41.081591/-8.643748/13/12/8.2`;
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
    const response = await this.fetchForecast();

    const today = new Date();

    const indexes = Array.from({ length: 4 }, (_, i) => i);

    const values = indexes.map((index) => {
      const day = new Date();
      day.setDate(today.getDate() + index);
      return response.result[day.toISOString().substring(0, 10)] || 0;
    });

    values.forEach((value, index) => {
      this.metrics.setGauge(METRICS.GAUGES.ESS_SOLAR_FORECAST, value, {
        day: index.toString(),
        source: "solarForecast",
      });
    });

    globals.forecastNextDays = values;

    logGlobals();
  }

  private async fetchForecast(): Promise<ForecastResponse> {
    try {
      const response = await fetch(this.apiUrl);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return (await response.json()) as ForecastResponse;
    } catch (error) {
      console.error("Error fetching solar forecast:", error);
      throw error;
    }
  }
}

interface ForecastResponse {
  result: { [day: string]: number };
}
