import { test } from "node:test";
import {
  deepStrictEqual as assertEquals,
  rejects as assertRejects,
} from "node:assert/strict";
import { SetSocLimitTask, calculateEveningSOC } from "./set-soc-limit-task.ts";
import { Temporal } from "../temporal.ts";
import { timeUntilMorning } from "../lisbon-clock.ts";
import { SolarForecasts } from "../solar-forecasts/solar-forecasts.ts";

test("hours to Lisbon morning round up actual elapsed time across DST", () => {
  for (const [time, hours] of [
    ["2026-03-28T22:01:00Z", 9],
    ["2026-10-24T21:01:00Z", 11],
    ["2026-07-01T22:30:00Z", 9],
    ["2026-01-01T23:30:00Z", 9],
    ["2026-01-02T07:59:00Z", 1],
  ] as const) {
    assertEquals(
      timeUntilMorning(Temporal.Instant.from(time)).toString(),
      Temporal.Duration.from({ hours }).toString(),
    );
  }
});

test("SOC examples enforce seasonal floors, efficiency, consumption and ceiling", () => {
  for (const [time, soc, kwh, expected] of [
    ["2026-10-14T21:01:00Z", 0, 100, 10],
    ["2026-10-15T21:01:00Z", 0, 100, 30],
    ["2026-02-28T22:01:00Z", 0, 100, 30],
    ["2026-03-01T22:01:00Z", 0, 100, 10],
    ["2026-01-01T22:01:00Z", 0, 0, 67.5],
    ["2026-07-01T21:01:00Z", 100, 0, 80],
    ["2026-07-01T21:01:00Z", 100, 20, 42.5],
    ["2026-07-01T06:59:00Z", 100, 0, 85],
  ] as const) {
    assertEquals(
      calculateEveningSOC(soc, kwh, Temporal.Instant.from(time)),
      expected,
    );
  }
});

test("real forecast evidence rejects wrong dates, future/stale data and accepts fresh zero on retry", async () => {
  let now = Temporal.Instant.from("2026-07-31T15:00:00Z");
  let target = "2026-07-31";
  let solarFails = false;
  const forecasts = new SolarForecasts({
    forecastSolarApiKey: "",
    victronApiKey: "",
    victronInstallationId: "1",
    clock: () => now,
    fetch: async (input) => {
      if (String(input).includes("api.forecast.solar")) {
        if (solarFails) throw new Error("offline");
        return Response.json({ result: { [target]: 0 } });
      }
      return Response.json({
        records: { vrm_pv_charger_yield_fc: [[now.epochMilliseconds, 5000]] },
      });
    },
    metrics: { setGauge: () => {} },
    logError: () => {},
  });
  await forecasts.refresh();
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: async (_, data) => {
        const { value } = data;
        values.push(value);
      },
    },
    () => now,
    () => 0,
    (date, at) => forecasts.forMinimumSoc(date, at),
  );
  now = Temporal.Instant.from("2026-07-31T21:00:00Z");
  assertEquals(await task.executeInEvening(), false);
  target = "2026-08-01";
  await forecasts.refresh();
  now = now.subtract({ nanoseconds: 1 });
  assertEquals(await task.executeInEvening(), false);
  now = now.add({ hours: 6, nanoseconds: 1 });
  assertEquals(
    await task.executeInEvening(Temporal.PlainDate.from(target)),
    true,
  );
  now = now.add({ nanoseconds: 1 });
  assertEquals(
    await task.executeInEvening(Temporal.PlainDate.from(target)),
    false,
  );
  values.length = 0;

  now = Temporal.Instant.from("2026-08-01T21:00:00Z");
  const retryTask = new SetSocLimitTask(
    {
      publishJson: async (_, data) => {
        const { value } = data;
        values.push(value);
      },
    },
    () => now,
    () => 0,
    (date, at) => forecasts.forMinimumSoc(date, at),
  );
  now = now.add({ minutes: 1 });
  await retryTask.tick();
  assertEquals(values, []);
  target = "2026-08-02";
  await forecasts.refresh();
  solarFails = true;
  await forecasts.refresh();
  now = now.add({ minutes: 5 });
  await retryTask.tick();
  assertEquals(values, [47.5]);
});

test("missing evening inputs retry every five minutes with current SOC and fixed forecast date", async () => {
  let now = Temporal.Instant.from("2026-01-01T22:00:00Z");
  let soc: number | undefined;
  let forecast: number | undefined;
  const dates: string[] = [];
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: async (_, data) => {
        const { value } = data;
        values.push(value);
      },
    },
    () => now,
    () => soc,
    (date) => {
      dates.push(date.toString());
      return forecast;
    },
  );
  now = now.add({ minutes: 1 });
  await task.tick();
  assertEquals(values, []);
  soc = 90;
  forecast = 0;
  now = now.add({ minutes: 4 });
  await task.tick();
  assertEquals(values, []);
  now = now.add({ minutes: 1 });
  await task.tick();
  assertEquals(values, [70]);
  now = now.add({ minutes: 5 });
  await task.tick();
  assertEquals(values, [70]);
  assertEquals(dates, ["2026-01-02", "2026-01-02"]);
});

test("retries stop at midnight and the running service resets at Lisbon 08:00", async () => {
  let now = Temporal.Instant.from("2026-07-01T21:00:00Z");
  let soc: number | undefined;
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: async (_, data) => {
        const { value } = data;
        values.push(value);
      },
    },
    () => now,
    () => soc,
    () => 0,
  );
  now = now.add({ minutes: 1 });
  await task.tick();
  now = Temporal.Instant.from("2026-07-01T23:00:00Z");
  soc = 50;
  await task.tick();
  assertEquals(values, []);
  now = Temporal.Instant.from("2026-07-02T07:00:00Z");
  await task.tick();
  assertEquals(values, [5]);
});

test("restart does not catch up evening or morning actions or resume retries", async () => {
  for (const start of [
    "2026-01-01T22:01:30Z",
    "2026-01-01T22:06:00Z",
    "2026-01-02T08:00:30Z",
  ]) {
    let now = Temporal.Instant.from(start);
    const values: unknown[] = [];
    const task = new SetSocLimitTask(
      {
        publishJson: async (_, data) => {
          const { value } = data;
          values.push(value);
        },
      },
      () => now,
      () => 50,
      () => 0,
    );
    await task.tick();
    now = now.add({ minutes: 5 });
    await task.tick();
    assertEquals(values, []);
  }
});

test("winter schedule awaits publication failure and retries the evening job", async () => {
  let now = Temporal.Instant.from("2026-01-01T22:00:00Z");
  let fail = true;
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: async (_, data) => {
        if (fail) throw new Error("publish failed");
        const { value } = data;
        values.push(value);
      },
    },
    () => now,
    () => 0,
    () => 0,
  );
  now = now.add({ minutes: 1 });
  await assertRejects(() => task.tick(), /publish failed/);
  fail = false;
  now = now.add({ minutes: 5 });
  await task.tick();
  assertEquals(values, [67.5]);
  now = Temporal.Instant.from("2026-01-02T08:00:00Z");
  await task.tick();
  assertEquals(values, [67.5, 5]);
});

test("SOC schedule ignores repeated minutes and a backward clock", async () => {
  let now = Temporal.Instant.from("2026-01-02T07:59:59Z");
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: async (_, data) => {
        const { value } = data;
        values.push(value);
      },
    },
    () => now,
    () => undefined,
  );
  now = now.add({ seconds: 1 });
  await task.tick();
  now = now.add({ seconds: 30 });
  await task.tick();
  now = now.subtract({ minutes: 1 });
  await task.tick();
  now = now.add({ minutes: 1 });
  await task.tick();
  assertEquals(values, [5]);
});

test("evening lookup derives its default date and evidence instant from one clock reading", async () => {
  let calls = 0;
  const now = Temporal.Instant.from("2026-07-31T22:59:59.999999999Z");
  let observed: unknown;
  const task = new SetSocLimitTask(
    { publishJson: async () => {} },
    () => {
      calls++;
      return now;
    },
    () => 0,
    (date, at) => {
      observed = [date.toString(), at.toString()];
      return 0;
    },
  );
  calls = 0;
  await task.executeInEvening();
  assertEquals(calls, 1);
  assertEquals(observed, ["2026-08-01", now.toString()]);
});
