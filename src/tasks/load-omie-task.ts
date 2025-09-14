import { globals, logGlobals } from "../globals.ts";
import { PrometheusMetrics, METRICS } from "../prometheus.ts";
import { HourlyTask } from "./hourly-task.ts";
import {
  fetchOmieEntries,
  getStartOfToday,
  getStartOfTomorrow,
  OmieEntry,
} from "./omie-proxy.ts";

export class LoadOmieTask extends HourlyTask {
  private metrics: PrometheusMetrics;

  constructor(metrics: PrometheusMetrics) {
    super();
    this.metrics = metrics;
  }

  protected async execute(): Promise<void> {
    const omieEntries = await fetchOmieEntries();
    globals.omieEntries = omieEntries;

    this.setMetrics(omieEntries);

    logGlobals();
  }

  private setMetrics(entries: OmieEntry[]) {
    const startOfToday = getStartOfToday();
    const startOfTomorrow = getStartOfTomorrow();

    [startOfToday, startOfTomorrow].forEach((day) => {
      Array.from({ length: 24 }, (_, i) => i).forEach((hour) => {
        const entryDate = day.with({ hour: hour });

        const entry = entries.find((value) => value.date.equals(entryDate)) || {
          price: 0,
          date: entryDate,
        };

        this.metrics.setGauge(
          METRICS.GAUGES.ESS_OMIE_PRICE,
          // in cents per kwh
          Math.round(entry.price / 10),
          {
            day: entry.date < startOfTomorrow ? "today" : "tomorrow",
            hour: String(entry.date.hour).padStart(2, "0"),
          }
        );
      });
    });
  }
}
