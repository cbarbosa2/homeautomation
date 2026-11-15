import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { LoadOmieTask } from "./load-omie-task.ts";
import { globals } from "../globals.ts";
import { Temporal } from "../temporal.ts";
import type { PriceFetch } from "../omie/omie-proxy.ts";

function marketFile(day: string, price = 100) {
  return [
    "MARGINALPDBC;",
    ...Array.from(
      { length: 96 },
      (_, i) => `2026;11;${day};${i + 1};${price};999;`,
    ),
    "*",
  ].join("\n");
}

test("task retains prices on failed/partial refreshes, retries, and rolls Lisbon dates independent of host timezone", async () => {
  let now = Temporal.Instant.from("2026-11-15T14:00:00Z");
  let failed = false;
  let requests = 0;
  const gauges = new Map<string, number>();
  const fetcher: PriceFetch = async (url) => {
    requests++;
    if (failed) return new Response("<html>unavailable</html>");
    if (url.includes("file-access-list")) return new Response("");
    return new Response(marketFile(url.includes("20261115") ? "15" : "16"));
  };
  const task = new LoadOmieTask(
    {
      setGauge: (_metric, value, labels) => {
        const { day, hour } = labels ?? {};
        gauges.set(`${day}/${hour}`, value);
      },
    },
    () => now,
    fetcher,
  );
  await task.execute();
  equal(globals.omieEntries.length, 47);
  equal(globals.omieEntries.at(-1)?.date.toString(), "2026-11-16T22:00:00");
  ok(Number.isNaN(gauges.get("tomorrow/23")));
  const initial = JSON.stringify(globals.omieEntries);
  failed = true;
  await task.execute();
  equal(JSON.stringify(globals.omieEntries), initial);
  const before = requests;
  now = now.add({ minutes: 5 });
  await task.execute(false);
  equal(requests, before); // Complete expected horizon permits hourly refreshes.
  now = now.add({ hours: 10 });
  await task.execute(false);
  equal(globals.omieEntries.length, 23);
  equal(globals.omieEntries[0]?.date.toString(), "2026-11-16T00:00:00");
  equal(gauges.get("today/00"), 17);
  ok(Number.isNaN(gauges.get("today/23")));
  const retryRequests = requests;
  now = now.add({ minutes: 5 });
  await task.execute(false);
  equal(requests, retryRequests); // The unpublished final hour alone does not cause fast polling.
  now = now.add({ hours: 12 });
  await task.execute(false);
  const afterNoon = requests;
  now = now.add({ minutes: 5 });
  await task.execute(false);
  ok(requests > afterNoon); // Missing publication after noon retries every five minutes.
});

test("overlapping startup, manual and scheduled refreshes share one request sequence", async () => {
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const task = new LoadOmieTask(
    { setGauge() {} },
    () => Temporal.Instant.from("2026-11-15T14:00:00Z"),
    async (url) => {
      requests++;
      if (url.includes("file-access-list")) {
        await blocked;
        return new Response("");
      }
      return new Response(marketFile(url.includes("20261115") ? "15" : "16"));
    },
  );
  const first = task.execute();
  equal(task.execute(), first);
  equal(task.execute(false), first);
  release?.();
  await first;
  equal(requests, 3);
});

test("missing tomorrow publication retries every five minutes after Madrid noon", async () => {
  let now = Temporal.Instant.from("2026-11-15T12:00:00Z");
  let requests = 0;
  const task = new LoadOmieTask(
    { setGauge() {} },
    () => now,
    async (url) => {
      requests++;
      if (url.includes("file-access-list")) return new Response("");
      if (url.includes("20261115")) return new Response(marketFile("15"));
      return new Response("not published", { status: 404 });
    },
  );
  await task.execute(false);
  const previous = requests;
  now = now.add({ minutes: 4 });
  await task.execute(false);
  equal(requests, previous);
  now = now.add({ minutes: 1 });
  await task.execute(false);
  ok(requests > previous);
});
