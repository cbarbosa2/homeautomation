import { test } from "node:test";
import { ok, deepStrictEqual, equal } from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { LoadForecastTask } from "./load-forecast-task.ts";
import { globals } from "../globals.ts";
import { Temporal } from "../temporal.ts";

// Only mocked providers are used; this task never publishes hardware commands.
test("forecast display preserves dates, gaps, zero and independent last successful updates", async (context) => {
  let now = Temporal.Instant.from("2026-10-24T23:30:00Z");
  context.mock.method(Temporal.Now, "instant", () => now);
  const previousDisplay = globals.solarForecastDisplay;
  const previousForecast = globals.solarForecastByDate;
  const previousSolar = globals.solarForecastNextDays;
  const previousVictron = globals.victronNextDays;
  globals.solarForecastDisplay = { forecastSolar: null, victron: null };
  let solarFails = false;
  let victronFails = false;
  const timestamp = (iso: string) =>
    Temporal.Instant.from(iso).epochMilliseconds;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === "api.forecast.solar") {
        if (solarFails) throw new Error("Solar offline");
        return Response.json({
          result: {
            "2026-10-27": 3200,
            "2026-10-25": 0,
            "2026-10-26": -1,
            "2026-10-28": "invalid",
          },
        });
      }
      if (victronFails) throw new Error("Victron offline");
      // Lisbon is UTC+1 at the first timestamp and UTC+0 after the DST transition.
      return Response.json({
        records: {
          vrm_pv_charger_yield_fc: [
            [timestamp("2026-10-26T00:00:00Z"), 2000],
            [timestamp("2026-10-24T23:00:00Z"), 0],
            [timestamp("2026-10-27T00:00:00Z"), null],
            [timestamp("2026-10-28T00:00:00Z"), -1],
            [1e20, 1000],
          ],
        },
      });
    },
  );

  try {
    const task = new LoadForecastTask({ setGauge: () => {} });
    await setImmediate();
    ok(globals.solarForecastDisplay.forecastSolar);
    ok(globals.solarForecastDisplay.victron);
    deepStrictEqual(
      [...globals.solarForecastDisplay.forecastSolar.values],
      [
        ["2026-10-27", 3200],
        ["2026-10-25", 0],
      ],
    );
    deepStrictEqual(
      [...globals.solarForecastDisplay.victron.values],
      [
        ["2026-10-26", 3000],
        ["2026-10-25", 0],
      ],
    );
    const solarSnapshot = globals.solarForecastDisplay.forecastSolar;
    solarFails = true;
    now = now.add({ hours: 1 });
    await task.execute();
    equal(globals.solarForecastDisplay.forecastSolar, solarSnapshot);
    equal(
      globals.solarForecastDisplay.victron?.fetchedAt.toString(),
      now.toString(),
    );
    const victronSnapshot = globals.solarForecastDisplay.victron;
    solarFails = false;
    victronFails = true;
    now = now.add({ hours: 1 });
    await task.execute();
    equal(globals.solarForecastDisplay.victron, victronSnapshot);
    equal(
      globals.solarForecastDisplay.forecastSolar?.fetchedAt.toString(),
      now.toString(),
    );
  } finally {
    globals.solarForecastDisplay = previousDisplay;
    globals.solarForecastByDate = previousForecast;
    globals.solarForecastNextDays = previousSolar;
    globals.victronNextDays = previousVictron;
  }
});
