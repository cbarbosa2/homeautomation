import { test } from "node:test";
import { deepStrictEqual as equal, throws, ok } from "node:assert/strict";
import {
  parseOmieDay,
  parseRenDay,
  hourlyPrices,
  fetchPriceQuarters,
  type PriceFetch,
} from "./omie-proxy.ts";
import { Temporal } from "../temporal.ts";

function file(
  date: string,
  count = 96,
  pt: (index: number) => number = () => 100,
) {
  const [year, month, day] = date.split("-");
  return [
    "MARGINALPDBC;",
    ...Array.from(
      { length: count },
      (_, index) => `${year};${month};${day};${index + 1};${pt(index)};999;`,
    ),
    "*",
  ].join("\n");
}

const date = Temporal.PlainDate.from("2026-11-16");

function ren(count = 92) {
  return {
    xAxis: {
      categories: Array.from(
        { length: count },
        (_, i) =>
          `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
      ),
      max: "2026-11-16T22:45:00",
    },
    series: [
      { name: "ES", data: Array(count).fill(999) },
      { name: "PT", data: Array(count).fill(100) },
    ],
  };
}

test("OMIE selects Portuguese prices, validates entire day and retains zero/negative prices", () => {
  const quarters = parseOmieDay(
    file(date.toString(), 96, (i) => (i === 0 ? -10 : 0)),
    date,
  );
  equal(quarters.length, 96);
  equal(quarters[0]?.price, -10);
  equal(quarters[1]?.price, 0);
  equal(quarters[0]?.instant.toString(), "2026-11-15T23:00:00Z");
  for (const invalid of [
    "<html>Service unavailable</html>",
    file(date.toString(), 95),
    file("2026-11-15"),
    file(date.toString()).replace(";2;100;", ";1;100;"),
    file(date.toString()).replace(";100;", ";NaN;"),
    file(date.toString()).replace(";100;", ";;"),
    file(date.toString()).replace("*", ""),
  ])
    throws(() => parseOmieDay(invalid, date));
});

test("Madrid periods follow elapsed time on both DST days; Lisbon repeated hour averages eight quarters", () => {
  for (const [day, count, missingHour] of [
    ["2026-03-29", 92, 1],
    ["2026-10-25", 100, undefined],
  ] as const) {
    const d = Temporal.PlainDate.from(day);
    const quarters = parseOmieDay(
      file(day, count, (i) => (i < 12 ? 0 : 200)),
      d,
    );
    equal(quarters.length, count);
    const entries = hourlyPrices(quarters, d);
    if (missingHour !== undefined)
      ok(!entries.some((entry) => entry.date.hour === missingHour));
    else {
      const hour = entries.find((entry) => entry.date.hour === 1);
      // Madrid periods 9–16 cover both Lisbon occurrences of 01:00.
      equal(hour?.price, 17);
      equal(entries.find((entry) => entry.date.hour === 2)?.price, 30);
    }
    equal(entries.at(-1)?.date.hour, 22);
    equal(entries.length, count === 92 ? 22 : 23);
    throws(() => parseOmieDay(file(day, 96), d));
  }
});

test("hourly tariff boundaries and unpublished Lisbon final hour", () => {
  const quarters = parseOmieDay(file(date.toString()), date);
  const entries = hourlyPrices(quarters, date);
  for (const [hour, expected] of [
    [0, 17],
    [7, 17],
    [8, 24],
    [21, 24],
    [22, 17],
  ]) {
    equal(entries.find((entry) => entry.date.hour === hour)?.price, expected);
  }
  ok(!entries.some((entry) => entry.date.hour === 23));
  // A partial hour must never be priced using only its available quarters.
  equal(
    hourlyPrices(
      quarters.filter((_, i) => i !== 4),
      date,
    ).some((entry) => entry.date.hour === 0),
    false,
  );
});

test("REN accepts verified Lisbon prefixes, rejects wrong dates, incomplete hours and invalid PT prices", () => {
  const parsed = parseRenDay(ren(), date);
  equal(parsed.length, 92);
  equal(parsed[0]?.instant.toString(), "2026-11-16T00:00:00Z");
  equal(parsed.at(-1)?.instant.toString(), "2026-11-16T22:45:00Z");
  equal(parsed[0]?.price, 100);
  for (const input of [
    null,
    {},
    ren(91),
    { ...ren(), xAxis: { ...ren().xAxis, max: "2026-11-15T22:45:00" } },
    { ...ren(), series: [{ name: "PT", data: Array(92).fill(null) }] },
    { ...ren(), series: [{ name: "ES", data: Array(92).fill(100) }] },
    {
      ...ren(),
      xAxis: { ...ren().xAxis, categories: Array(92).fill("00:00") },
    },
  ])
    throws(() => parseRenDay(input, date));
});

test("source fetching selects latest discovered version and avoids REN when direct days validate", async () => {
  const urls: string[] = [];
  const fetcher: PriceFetch = async (url, init) => {
    urls.push(url);
    ok(init?.signal);
    if (url.includes("file-access-list"))
      return new Response("marginalpdbc_20261116.1 marginalpdbc_20261116.2");
    const d = url.includes("20261116") ? "2026-11-16" : "2026-11-17";
    return new Response(file(d));
  };
  const quarters = await fetchPriceQuarters(date, fetcher);
  equal(quarters.length, 192);
  equal(urls.length, 3);
  ok(urls.some((url) => url.includes("marginalpdbc_20261116.2")));
  ok(urls.every((url) => !url.includes("ren.pt")));
});

test("listing failure still tries direct files; malformed primary invokes REN, direct PT values win", async () => {
  const fetcher: PriceFetch = async (url) => {
    if (url.includes("file-access-list")) throw new Error("timeout");
    if (url.includes("20261116.1"))
      return new Response(file("2026-11-16", 96, () => 50));
    if (url.includes("20261117.1"))
      return new Response("<html>Not published</html>");
    if (url.includes("date=2026-11-16")) return Response.json(ren());
    return new Response("Unavailable", { status: 503 });
  };
  const result = await fetchPriceQuarters(date, fetcher);
  equal(result.length, 96);
  equal(
    result.find(
      (quarter) => quarter.instant.toString() === "2026-11-16T00:00:00Z",
    )?.price,
    50,
  );
});

test("both failed sources yield no replacement prices", async () => {
  const result = await fetchPriceQuarters(
    date,
    async () => new Response("not found", { status: 404 }),
  );
  equal(result, []);
});

test("REN recovers missing market files using Lisbon dates without inventing the final hour", async () => {
  const result = await fetchPriceQuarters(date, async (url) => {
    if (url.includes("omie.es"))
      return new Response("not published", { status: 404 });
    const data = ren();
    data.xAxis.max = url.includes("2026-11-17")
      ? "2026-11-17T22:45:00"
      : "2026-11-16T22:45:00";
    return Response.json(data);
  });
  equal(result.length, 184);
  equal(hourlyPrices(result, date).length, 46);
  equal(hourlyPrices(result, date)[0]?.date.toString(), "2026-11-16T00:00:00");
});

test("REN DST labels must follow the actual Lisbon timeline", () => {
  for (const [day, count] of [
    ["2026-03-29", 92],
    ["2026-10-25", 100],
  ] as const) {
    const categories: string[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const repeats = hour === 1 ? (count === 92 ? 0 : 2) : 1;
      for (let repeat = 0; repeat < repeats; repeat++) {
        for (const minute of ["00", "15", "30", "45"])
          categories.push(`${String(hour).padStart(2, "0")}:${minute}`);
      }
    }
    const result = parseRenDay(
      {
        xAxis: { categories, max: `${day}T23:45:00` },
        series: [
          {
            name: "PT",
            data: Array.from({ length: count }, (_, i) => (i === 0 ? -10 : 0)),
          },
        ],
      },
      Temporal.PlainDate.from(day),
    );
    equal(result.length, count);
    equal(result[0]?.price, -10);
    equal(result[1]?.price, 0);
  }
});
