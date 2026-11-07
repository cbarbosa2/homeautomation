import { test } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import cron from "node-cron";
import { TaskScheduler } from "./task-scheduler.ts";
import { Temporal } from "./temporal.ts";

// Date and numeric milliseconds here are the external cron/timer boundaries.
test("cron runs in UTC, skips overlapping schedules and destroys stopped jobs", async (context) => {
  context.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: Temporal.Instant.from("2026-07-01T12:59:59Z").epochMilliseconds,
  });
  const scheduler = new TaskScheduler();
  const blocked = Promise.withResolvers<void>();
  let calls = 0;
  try {
    scheduler.cron("UTC job", "* * * * *", async () => {
      calls++;
      await blocked.promise;
    });
    const job = [...cron.getTasks().values()].find(
      (item) => item.name === "UTC job",
    );
    ok(job);
    equal(calls, 0);
    context.mock.timers.tick(1000);
    await setImmediate();
    equal(calls, 1);
    context.mock.timers.tick(60000);
    await setImmediate();
    equal(calls, 1);
    blocked.resolve();
    await setImmediate();
    context.mock.timers.tick(60000);
    await setImmediate();
    equal(calls, 2);
    equal(scheduler.stop("UTC job"), true);
    equal(job.getStatus(), "destroyed");
    context.mock.timers.tick(60000);
    await setImmediate();
    equal(calls, 2);
    equal(scheduler.stop("UTC job"), false);

    scheduler.cron("UTC hour", "0 13 * * *", () => {});
    const hourly = [...cron.getTasks().values()].find(
      (item) => item.name === "UTC hour",
    );
    ok(hourly);
    equal(
      hourly.match(
        new Date(
          Temporal.Instant.from("2026-07-02T13:00:00Z").epochMilliseconds,
        ),
      ),
      true,
    );
    equal(
      hourly.match(
        new Date(
          Temporal.Instant.from("2026-07-02T12:00:00Z").epochMilliseconds,
        ),
      ),
      false,
    );
    scheduler.terminateAll();
    equal(hourly.getStatus(), "destroyed");
    deepStrictEqual(scheduler.getAllTaskInfo(), []);
  } finally {
    blocked.resolve();
    scheduler.terminateAll();
    context.mock.timers.reset();
  }
});

test("intervals run immediately, skip busy runs, support manual triggers and stop", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const scheduler = new TaskScheduler();
  const blocked = Promise.withResolvers<void>();
  let calls = 0;
  try {
    scheduler.interval(
      "interval",
      Temporal.Duration.from({ seconds: 1 }),
      async () => {
        calls++;
        await blocked.promise;
      },
    );
    equal(calls, 1);
    context.mock.timers.tick(3000);
    await setImmediate();
    equal(calls, 1);
    blocked.resolve();
    await setImmediate();
    context.mock.timers.tick(1000);
    await setImmediate();
    equal(calls, 2);
    equal(await scheduler.triggerTask("interval"), true);
    equal(calls, 3);
    equal(await scheduler.triggerTask("missing"), false);
    scheduler.terminateAll();
    context.mock.timers.tick(3000);
    equal(calls, 3);
  } finally {
    blocked.resolve();
    scheduler.terminateAll();
    context.mock.timers.reset();
  }
});
