import { globals, logGlobals, OmieEntry } from "../globals.ts";
import { PrometheusMetrics, METRICS } from "../prometheus.ts";
import { HourlyTask } from "./hourly-task.ts";
import { fetchOmie, parseOmieResponse } from "./omie-proxy.ts";

export class LoadOmieTask extends HourlyTask {
  private metrics: PrometheusMetrics;

  constructor(metrics: PrometheusMetrics) {
    super();
    this.metrics = metrics;
  }

  protected async execute(): Promise<void> {
    const omieEntries = parseOmieResponse(
      await fetchOmie(),
      this.getStartOfToday()
    );
    globals.omieEntries = omieEntries;

    this.setMetrics(omieEntries);

    logGlobals();
  }

  private setMetrics(entries: OmieEntry[]) {
    const startOfToday = this.getStartOfToday();
    const startOfTomorrow = this.getStartOfTomorrow();

    [startOfToday, startOfTomorrow].forEach((day) => {
      Array.from({ length: 24 }, (_, i) => i).forEach((hour) => {
        const entryDate = day.with({ hour: hour });

        const entry = entries.find((value) => value.date.equals(entryDate)) || {
          price: 0,
          date: entryDate,
        };

        const dayStr =
          Temporal.PlainDateTime.compare(entry.date, startOfTomorrow) < 0
            ? "today"
            : "tomorrow";
        const hourStr = String(entry.date.hour).padStart(2, "0");

        this.metrics.setGauge(METRICS.GAUGES.ESS_OMIE_PRICE, entry.price, {
          day: dayStr,
          hour: hourStr,
        });
      });
    });
  }

  private getStartOfToday(): Temporal.PlainDateTime {
    const now = Temporal.Now.plainDateTimeISO();
    return now.with({
      hour: 0,
      minute: 0,
      second: 0,
      microsecond: 0,
      millisecond: 0,
      nanosecond: 0,
    });
  }

  private getStartOfTomorrow(): Temporal.PlainDateTime {
    return this.getStartOfToday().add({ days: 1 });
  }
}
