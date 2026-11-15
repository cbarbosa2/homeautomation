import { globals } from "../globals.ts";
import type { PrometheusMetrics } from "../prometheus/prometheus.ts";
import {
  fetchPriceQuarters,
  hourlyPrices,
  dayQuarters,
  type PriceFetch,
  type PriceQuarter,
} from "../omie/omie-proxy.ts";
import { METRICS } from "../prometheus/metrics.ts";
import { lisbonTime, systemClock, type Clock } from "../lisbon-clock.ts";
import { Temporal } from "../temporal.ts";

export class LoadOmieTask {
  private quarters = new Map<string, PriceQuarter>();
  private inFlight: Promise<void> | undefined;
  private nextRefresh: Temporal.Instant | undefined;

  constructor(
    private readonly metrics: Pick<PrometheusMetrics, "setGauge">,
    private readonly clock: Clock = systemClock,
    private readonly fetcher: PriceFetch = fetch,
  ) {}

  execute(force = true): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const now = this.clock();
    if (
      !force &&
      this.nextRefresh &&
      Temporal.Instant.compare(now, this.nextRefresh) < 0
    )
      return Promise.resolve();
    this.inFlight = this.refresh(now).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async refresh(now: Temporal.Instant): Promise<void> {
    const today = lisbonTime(now).toPlainDate();
    const fetched = await fetchPriceQuarters(today, this.fetcher);
    for (const quarter of fetched)
      this.quarters.set(quarter.instant.toString(), quarter);

    // Re-read the clock after I/O so a refresh spanning midnight projects the new dates.
    const current = this.clock();
    const date = lisbonTime(current).toPlainDate();
    const end = date
      .add({ days: 2 })
      .toZonedDateTime("Europe/Lisbon")
      .toInstant();
    const start = date.toZonedDateTime("Europe/Lisbon").toInstant();
    for (const [key, quarter] of this.quarters) {
      if (
        Temporal.Instant.compare(quarter.instant, start) < 0 ||
        Temporal.Instant.compare(quarter.instant, end) >= 0
      )
        this.quarters.delete(key);
    }
    globals.omieEntries = hourlyPrices([...this.quarters.values()], date);
    for (const [index, day] of [date, date.add({ days: 1 })].entries()) {
      for (let hour = 0; hour < 24; hour++) {
        const entry = globals.omieEntries.find((entry) =>
          entry.date.equals(day.toPlainDateTime({ hour })),
        );
        this.metrics.setGauge(
          METRICS.GAUGES.ESS_OMIE_PRICE,
          entry?.price ?? Number.NaN,
          {
            day: index === 0 ? "today" : "tomorrow",
            hour: String(hour).padStart(2, "0"),
          },
        );
      }
    }

    const complete = (day: Temporal.PlainDate, before?: Temporal.Instant) =>
      dayQuarters(day, "Europe/Lisbon")
        .filter(
          (time) =>
            !before || Temporal.Instant.compare(time.toInstant(), before) < 0,
        )
        .every((time) => this.quarters.has(time.toInstant().toString()));
    // Tomorrow's last Lisbon hour belongs to a still-unpublished market day.
    const horizon = date
      .add({ days: 2 })
      .toZonedDateTime("Europe/Madrid")
      .toInstant();
    // Before publication, today's final Lisbon hour is outside the known horizon too.
    const todayHorizon = date
      .add({ days: 1 })
      .toZonedDateTime("Europe/Madrid")
      .toInstant();
    const todayMissing = !complete(date, todayHorizon);
    const tomorrowMissing = !complete(date.add({ days: 1 }), horizon);
    const awaitingPublication =
      current.toZonedDateTimeISO("Europe/Madrid").hour >= 12 && tomorrowMissing;
    this.nextRefresh = current.add({
      minutes: todayMissing || awaitingPublication ? 5 : 60,
    });
    // Always project the new Lisbon dates shortly after midnight.
    const midnight = date
      .add({ days: 1 })
      .toZonedDateTime("Europe/Lisbon")
      .toInstant();
    if (Temporal.Instant.compare(this.nextRefresh, midnight) > 0)
      this.nextRefresh = midnight;
  }
}
