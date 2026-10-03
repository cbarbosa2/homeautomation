import { assertEquals } from "@std/assert";
import { SetSocLimitTask } from "./set-soc-limit-task.ts";
import { Temporal } from "../temporal.ts";

Deno.test("Lisbon summer evening uses a real zero forecast and current SOC", async () => {
  let now = Temporal.Instant.from("2026-07-01T21:00:00Z");
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: (_, data) => {
        values.push(data["value"]);
        return Promise.resolve();
      },
    },
    () => now,
    () => ({
      soc: 0,
      forecast: new SolarForecasts([[Temporal.PlainDate.from("2026-07-02"), {
        wattHours: 0,
        fetchedAt: now,
      }]]),
    }),
  );
  now = now.add({ minutes: 1 });
  await task.tick();
  assertEquals(values, [47.5]);
});

import { assertRejects } from "@std/assert";
import { calculateEveningSOC } from "./set-soc-limit-task.ts";
import { timeUntilMorning } from "../lisbon-clock.ts";
import { SolarForecasts } from "../solar-forecasts/solar-forecasts.ts";

Deno.test("hours to Lisbon morning round up actual elapsed time across DST", () => {
  for (
    const [time, hours] of [
      ["2026-03-28T22:01:00Z", 9],
      ["2026-10-24T21:01:00Z", 11],
      ["2026-07-01T22:30:00Z", 9],
      ["2026-01-01T23:30:00Z", 9],
      ["2026-01-02T07:59:00Z", 1],
    ] as const
  ) {
    assertEquals(
      timeUntilMorning(Temporal.Instant.from(time)).toString(),
      Temporal.Duration.from({ hours }).toString(),
    );
  }
});
Deno.test("SOC examples enforce seasonal floors, efficiency, consumption and ceiling", () => {
  for (
    const [time, soc, kwh, expected] of [
      ["2026-10-14T21:01:00Z", 0, 100, 10],
      ["2026-10-15T21:01:00Z", 0, 100, 30],
      ["2026-02-28T22:01:00Z", 0, 100, 30],
      ["2026-03-01T22:01:00Z", 0, 100, 10],
      ["2026-01-01T22:01:00Z", 0, 0, 67.5],
      ["2026-07-01T21:01:00Z", 100, 0, 80],
      ["2026-07-01T21:01:00Z", 100, 20, 42.5],
      ["2026-07-01T06:59:00Z", 100, 0, 85],
    ] as const
  ) {
    assertEquals(
      calculateEveningSOC(soc, kwh, Temporal.Instant.from(time)),
      expected,
    );
  }
});
Deno.test("missing evening inputs retry every five minutes with current SOC and fixed forecast date", async () => {
  let now = Temporal.Instant.from("2026-01-01T22:00:00Z");
  let soc: number | undefined = undefined;
  const forecast = new SolarForecasts();
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: (_, d) => {
        values.push(d["value"]);
        return Promise.resolve();
      },
    },
    () => now,
    () => ({ soc, forecast }),
  );
  now = now.add({ minutes: 1 });
  await task.tick();
  assertEquals(values, []);
  soc = 90;
  forecast.set(Temporal.PlainDate.from("2026-01-02"), {
    wattHours: 0,
    fetchedAt: now,
  });
  now = now.add({ minutes: 4 });
  await task.tick();
  assertEquals(values, []);
  now = now.add({ minutes: 1 });
  await task.tick();
  assertEquals(values, [70]);
  now = now.add({ minutes: 5 });
  await task.tick();
  assertEquals(values, [70]);
});
Deno.test("forecasts expire after six hours, accept zero and select tomorrow by date", async () => {
  const now = Temporal.Instant.from("2026-07-31T21:01:00Z");
  const forecast = new SolarForecasts([[Temporal.PlainDate.from("2026-07-31"), {
    wattHours: 0,
    fetchedAt: now,
  }]]);
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: (_, d) => {
        values.push(d["value"]);
        return Promise.resolve();
      },
    },
    () => now,
    () => ({ soc: 0, forecast }),
  );
  assertEquals(await task.executeInEvening(), false);
  forecast.set(Temporal.PlainDate.from("2026-08-01"), {
    wattHours: 0,
    fetchedAt: now.add({ nanoseconds: 1 }),
  });
  assertEquals(await task.executeInEvening(), false);
  forecast.set(Temporal.PlainDate.from("2026-08-01"), {
    wattHours: 0,
    fetchedAt: now.subtract({ hours: 6, milliseconds: 1 }),
  });
  assertEquals(await task.executeInEvening(), false);
  forecast.set(Temporal.PlainDate.from("2026-08-01"), {
    wattHours: 0,
    fetchedAt: now.subtract({ hours: 6 }),
  });
  assertEquals(await task.executeInEvening(), true);
  assertEquals(values, [47.5]);
});
Deno.test("retries stop at midnight and the running service resets at Lisbon 08:00", async () => {
  let now = Temporal.Instant.from("2026-07-01T21:00:00Z");
  let soc: number | undefined = undefined;
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: (_, d) => {
        values.push(d["value"]);
        return Promise.resolve();
      },
    },
    () => now,
    () => ({
      soc,
      forecast: new SolarForecasts([[Temporal.PlainDate.from("2026-07-02"), {
        wattHours: 0,
        fetchedAt: now,
      }]]),
    }),
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
Deno.test("restart does not catch up evening or morning actions or resume retries", async () => {
  for (
    const start of [
      "2026-01-01T22:01:30Z",
      "2026-01-01T22:06:00Z",
      "2026-01-02T08:00:30Z",
    ]
  ) {
    let now = Temporal.Instant.from(start);
    const values: unknown[] = [];
    const task = new SetSocLimitTask(
      {
        publishJson: (_, d) => {
          values.push(d["value"]);
          return Promise.resolve();
        },
      },
      () => now,
      () => ({
        soc: 50,
        forecast: new SolarForecasts([[Temporal.PlainDate.from("2026-01-02"), {
          wattHours: 0,
          fetchedAt: now,
        }]]),
      }),
    );
    await task.tick();
    now = now.add({ minutes: 5 });
    await task.tick();
    assertEquals(values, []);
  }
});
Deno.test("winter schedule awaits publication failure and retries the evening job", async () => {
  let now = Temporal.Instant.from("2026-01-01T22:00:00Z");
  let fail = true;
  const values: unknown[] = [];
  const task = new SetSocLimitTask(
    {
      publishJson: (_, d) => {
        if (fail) return Promise.reject(new Error("publish failed"));
        values.push(d["value"]);
        return Promise.resolve();
      },
    },
    () => now,
    () => ({
      soc: 0,
      forecast: new SolarForecasts([[Temporal.PlainDate.from("2026-01-02"), {
        wattHours: 0,
        fetchedAt: now,
      }]]),
    }),
  );
  now = now.add({ minutes: 1 });
  await assertRejects(() => task.tick(), Error, "publish failed");
  fail = false;
  now = now.add({ minutes: 5 });
  await task.tick();
  assertEquals(values, [67.5]);
  now = Temporal.Instant.from("2026-01-02T08:00:00Z");
  await task.tick();
  assertEquals(values, [67.5, 5]);
});

Deno.test("SOC schedule ignores repeated minutes and a backward clock", async () => {
  let now = Temporal.Instant.from("2026-01-02T07:59:59Z");
  const values: unknown[] = [];
  const task = new SetSocLimitTask({
    publishJson: (_, data) => {
      values.push(data["value"]);
      return Promise.resolve();
    },
  }, () => now);
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
