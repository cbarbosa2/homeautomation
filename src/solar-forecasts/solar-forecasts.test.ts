import { test } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { SolarForecasts } from "./solar-forecasts.ts";
import { Temporal } from "../temporal.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";
import { METRICS } from "../prometheus/metrics.ts";

function fixture() {
  let now = Temporal.Instant.from("2026-10-24T23:30:00Z");
  let solar: unknown = {
    result: {
      "2026-10-27": 3200,
      "2026-10-25": 0,
      "2026-10-26": -1,
      "2026-10-28": "invalid",
      "2026-02-30": 1,
    },
  };
  let victron: unknown = {
    records: {
      vrm_pv_charger_yield_fc: [
        [Temporal.Instant.from("2026-10-26T00:00:00Z").epochMilliseconds, 2000],
        [Temporal.Instant.from("2026-10-24T23:00:00Z").epochMilliseconds, 0],
        [Temporal.Instant.from("2026-10-27T00:00:00Z").epochMilliseconds, null],
        [0, -1],
        [1e20, 1000],
      ],
    },
  };
  const requests: { url: URL; init: RequestInit | undefined }[] = [];
  const metrics = new Map<string, number>();
  const errors: string[] = [];
  let metricFails = false;
  const forecasts = new SolarForecasts({
    forecastSolarApiKey: "test-solar",
    victronApiKey: "test-victron",
    victronInstallationId: "123456",
    clock: () => now,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push({ url, init });
      const value = url.hostname === "api.forecast.solar" ? solar : victron;
      if (value instanceof Error) throw value;
      // Avoid JSON's conversion of NaN/Infinity in validation tests.
      return { ok: true, json: async () => value } as Response;
    },
    metrics: {
      setGauge: (_, value, labels) => {
        if (metricFails) throw new Error("metric sink failed");
        const { source, day } = labels ?? {};
        metrics.set(`${source}:${day}`, value);
      },
    },
    logError: (message) => errors.push(message),
  });
  return {
    forecasts,
    requests,
    metrics,
    errors,
    get now() {
      return now;
    },
    set now(value: Temporal.Instant) {
      now = value;
    },
    set solar(value: unknown) {
      solar = value;
    },
    set victron(value: unknown) {
      victron = value;
    },
    set metricFails(value: boolean) {
      metricFails = value;
    },
  };
}

test("dated projections validate providers while keeping positional metric compatibility", async () => {
  const f = fixture();
  equal(f.requests.length, 0);
  await f.forecasts.refresh();
  deepStrictEqual(
    f.requests.map(({ url }) => url.hostname),
    ["api.forecast.solar", "vrmapi.victronenergy.com"],
  );
  equal(
    f.requests[0]?.url.pathname,
    "/test-solar/estimate/watthours/day/41.081591/-8.643748/13/12/8.2",
  );
  equal(
    new Headers(f.requests[1]?.init?.headers).get("X-Authorization"),
    "Token test-victron",
  );
  deepStrictEqual(
    f.forecasts
      .display(f.now)
      .days.map((day) => [
        day.date.toString(),
        day.forecastSolarWh,
        day.victronWh,
      ]),
    [
      ["2026-10-25", 0, 0],
      ["2026-10-26", null, 3000],
      ["2026-10-27", 3200, null],
      ["2026-10-28", null, null],
    ],
  );
  deepStrictEqual(
    [...f.metrics],
    [
      ["solarForecast:0", 0],
      ["solarForecast:1", 0],
      ["solarForecast:2", 3200],
      ["solarForecast:3", 0],
      ["victron:0", 3000],
      ["victron:1", 0],
      ["victron:2", 0],
      ["victron:3", -2],
      ["victron:4", 1500],
    ],
  );
  const display = f.forecasts.display(f.now);
  const firstDay = display.days[0];
  ok(firstDay);
  firstDay.forecastSolarWh = 999;
  display.days.pop();
  equal(f.forecasts.display(f.now).days[0]?.forecastSolarWh, 0);
  equal(f.forecasts.display(f.now).days.length, 4);
  const calls = f.requests.length;
  f.forecasts.forMinimumSoc(Temporal.PlainDate.from("2026-10-25"), f.now);
  equal(f.requests.length, calls);
});

test("control lookup selects only Forecast.Solar by calendar date and inclusive six-hour freshness", async () => {
  const f = fixture();
  await f.forecasts.refresh();
  const date = Temporal.PlainDate.from("2026-10-25");
  equal(f.forecasts.forMinimumSoc(date.withCalendar("gregory"), f.now), 0);
  equal(f.forecasts.forMinimumSoc(date.add({ days: 1 }), f.now), undefined);
  equal(
    f.forecasts.forMinimumSoc(date, f.now.subtract({ nanoseconds: 1 })),
    undefined,
  );
  equal(f.forecasts.forMinimumSoc(date, f.now.add({ hours: 6 })), 0);
  equal(
    f.forecasts.forMinimumSoc(date, f.now.add({ hours: 6, nanoseconds: 1 })),
    undefined,
  );
  equal(
    f.forecasts.display(f.now.add({ hours: 7 })).days[0]?.forecastSolarWh,
    0,
  );
});

test("source failures retain independent snapshots and empty successes replace them", async () => {
  const f = fixture();
  await f.forecasts.refresh();
  const first = f.now;
  f.now = f.now.add({ hours: 1 });
  f.solar = new Error("offline");
  f.victron = { records: { vrm_pv_charger_yield_fc: [] } };
  await f.forecasts.refresh();
  equal(f.forecasts.display(f.now).updatedAt.forecastSolar, first);
  equal(f.forecasts.display(f.now).updatedAt.victron, f.now);
  equal(f.forecasts.display(f.now).days[0]?.victronWh, null);
  ok(f.metrics.has("victron:4"), "shorter refresh retains old metric series");
  f.solar = { result: {} };
  f.victron = new Error("offline");
  await f.forecasts.refresh();
  equal(f.forecasts.display(f.now).days[0]?.forecastSolarWh, null);
  equal(f.errors.length, 2);
});

test("malformed source shapes retain state atomically and metric failures retain accepted data", async () => {
  const f = fixture();
  await f.forecasts.refresh();
  const first = f.forecasts.display(f.now);
  for (const value of [null, [], { result: null }, { result: [] }]) {
    f.solar = value;
    f.victron = { records: { vrm_pv_charger_yield_fc: [null] } };
    await f.forecasts.refresh();
    deepStrictEqual(f.forecasts.display(f.now), first);
  }
  f.now = f.now.add({ minutes: 1 });
  f.solar = { result: { "2026-10-25": 10 } };
  f.victron = {
    records: {
      vrm_pv_charger_yield_fc: [
        [Temporal.Instant.from("2026-10-25T12:00:00Z").epochMilliseconds, 4],
      ],
    },
  };
  f.metricFails = true;
  await f.forecasts.refresh();
  equal(f.forecasts.display(f.now).days[0]?.forecastSolarWh, 10);
  equal(f.forecasts.display(f.now).days[0]?.victronWh, 6);
  deepStrictEqual(f.forecasts.display(f.now).updatedAt, {
    forecastSolar: f.now,
    victron: f.now,
  });
});

test("nonfinite provider readings are unavailable; legacy metric coercion remains observable", async () => {
  const f = fixture();
  f.solar = { result: { "2026-10-25": NaN, "2026-10-26": Infinity } };
  const stamp = f.now.epochMilliseconds;
  f.victron = {
    records: {
      vrm_pv_charger_yield_fc: [
        [stamp, "2"],
        [stamp, undefined],
        [stamp, NaN],
        [stamp, Infinity],
        [stamp, 2],
        [stamp, 3],
      ],
    },
  };
  await f.forecasts.refresh();
  equal(f.forecasts.display(f.now).days[0]?.forecastSolarWh, null);
  equal(f.forecasts.display(f.now).days[0]?.victronWh, 4);
  equal(f.metrics.get("victron:0"), 3);
  ok(Number.isNaN(f.metrics.get("victron:1")));
  equal(f.metrics.get("victron:3"), Infinity);
});

test("production metric adapter accepts legacy NaN and keeps old positional series", async () => {
  const metrics = new PrometheusMetrics();
  try {
    metrics.setGauge(METRICS.GAUGES.ESS_SOLAR_FORECAST, NaN, {
      source: "victron",
      day: "4",
    });
    metrics.setGauge(METRICS.GAUGES.ESS_SOLAR_FORECAST, 0, {
      source: "victron",
      day: "0",
    });
    const text = await metrics.getRegister().metrics();
    ok(
      text.includes('source="victron",day="4"} Nan') ||
        /source="victron",day="4".*NaN/i.test(text),
    );
  } finally {
    metrics.getRegister().clear();
  }
});

test("display dates and query spans follow Lisbon midnight and calendar days across DST", async () => {
  const f = fixture();
  for (const [instant, date, hours] of [
    ["2026-03-28T12:00:00Z", "2026-03-28", 95],
    ["2026-10-24T12:00:00Z", "2026-10-24", 97],
    ["2026-07-01T23:30:00Z", "2026-07-02", 96],
    ["2026-11-07T23:30:00Z", "2026-11-07", 96],
  ] as const) {
    f.now = Temporal.Instant.from(instant);
    await f.forecasts.refresh();
    equal(f.forecasts.display(f.now).days[0]?.date.toString(), date);
    const request = f.requests.at(-1);
    ok(request);
    const query = request.url.searchParams;
    equal(
      (Number(query.get("end")) - Number(query.get("start"))) / 3600,
      hours,
    );
  }
});

test("overlapping refresh callers share completion; handled failure permits the next refresh", async () => {
  const gate = Promise.withResolvers<Response>();
  const calls: string[] = [];
  let fail = false;
  const forecasts = new SolarForecasts({
    forecastSolarApiKey: "",
    victronApiKey: "",
    victronInstallationId: "1",
    clock: () => Temporal.Instant.from("2026-01-01T00:00:00Z"),
    fetch: async (input) => {
      calls.push(String(input));
      if (fail) throw new Error("offline");
      return calls.length === 1
        ? gate.promise
        : Response.json({ records: { vrm_pv_charger_yield_fc: [] } });
    },
    metrics: { setGauge: () => {} },
    logError: () => {},
  });
  const startup = forecasts.refresh();
  const manual = forecasts.refresh();
  const hourly = forecasts.refresh();
  equal(startup, manual);
  equal(manual, hourly);
  equal(calls.length, 1);
  let complete = false;
  void manual.then(() => {
    complete = true;
  });
  await Promise.resolve();
  equal(complete, false);
  gate.resolve(Response.json({ result: {} }));
  await Promise.all([startup, manual, hourly]);
  equal(calls.length, 2);
  fail = true;
  await forecasts.refresh();
  await forecasts.refresh();
  equal(calls.length, 6);
});
