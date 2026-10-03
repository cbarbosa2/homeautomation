import { Temporal } from "../temporal.ts";

export interface SolarForecast {
  wattHours: number;
  fetchedAt: Temporal.Instant;
}

/** Forecasts keyed by ISO calendar date, independent of object identity. */
export class SolarForecasts {
  private readonly forecasts = new Map<string, SolarForecast>();

  constructor(
    entries: Iterable<readonly [Temporal.PlainDate, SolarForecast]> = [],
  ) {
    for (const [date, forecast] of entries) this.set(date, forecast);
  }

  get(date: Temporal.PlainDate): SolarForecast | undefined {
    return this.forecasts.get(date.withCalendar("iso8601").toString());
  }

  set(date: Temporal.PlainDate, forecast: SolarForecast): void {
    this.forecasts.set(date.withCalendar("iso8601").toString(), forecast);
  }
}
