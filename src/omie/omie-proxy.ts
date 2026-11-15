import type { OmieEntry } from "../globals.ts";
import { logInfo, logWarn } from "../logger.ts";
import { Temporal } from "../temporal.ts";

export interface PriceQuarter {
  instant: Temporal.Instant;
  price: number; // Portuguese wholesale price, EUR/MWh.
}

export type PriceFetch = (url: string, init?: RequestInit) => Promise<Response>;

export function dayQuarters(date: Temporal.PlainDate, timeZone: string) {
  const start = date.toZonedDateTime(timeZone);
  const end = start.add({ days: 1 });
  const quarters: Temporal.ZonedDateTime[] = [];

  for (
    let time = start;
    Temporal.ZonedDateTime.compare(time, end) < 0;
    time = time.add({ minutes: 15 })
  ) {
    quarters.push(time);
  }

  return quarters;
}

/** Accept a complete market day atomically, including its DST-adjusted length. */
export function parseOmieDay(
  text: string,
  date: Temporal.PlainDate,
): PriceQuarter[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim());
  const times = dayQuarters(date, "Europe/Madrid");
  if (
    lines[0] !== "MARGINALPDBC;" ||
    lines.at(-1) !== "*" ||
    lines.length !== times.length + 2
  ) {
    throw new Error(`Invalid or incomplete OMIE file for ${date}`);
  }

  return times.map((time, index) => {
    const fields = lines[index + 1]?.split(";");
    const price = fields?.[4]?.trim().replace(",", ".");
    if (
      fields?.length !== 7 ||
      fields[6] !== "" ||
      Number(fields[0]) !== date.year ||
      Number(fields[1]) !== date.month ||
      Number(fields[2]) !== date.day ||
      Number(fields[3]) !== index + 1 ||
      !price ||
      !Number.isFinite(Number(price))
    ) {
      throw new Error(`Invalid OMIE period ${index + 1} for ${date}`);
    }
    return { instant: time.toInstant(), price: Number(price) };
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** REN provides a Lisbon-day prefix; unpublished final hours may be absent. */
export function parseRenDay(
  value: unknown,
  date: Temporal.PlainDate,
): PriceQuarter[] {
  if (!record(value)) throw new Error("Invalid REN response");
  const { xAxis, series } = value;
  if (!record(xAxis) || !Array.isArray(series))
    throw new Error("Invalid REN response");
  const { categories, max } = xAxis;
  const pt: unknown = series.find((entry: unknown) => {
    if (!record(entry)) return false;
    const { name } = entry;
    return name === "PT";
  });
  if (!record(pt)) throw new Error("Missing REN Portuguese prices");
  const { data } = pt;
  if (!Array.isArray(data) || !Array.isArray(categories))
    throw new Error("Missing REN Portuguese prices");
  const prices: unknown[] = data;
  const times = dayQuarters(date, "Europe/Lisbon");
  if (
    !prices.length ||
    prices.length % 4 !== 0 ||
    prices.length > times.length ||
    categories.length !== prices.length
  ) {
    throw new Error("Incomplete REN hourly prices");
  }

  const result = prices.map((price, index) => {
    const time = times[index];
    if (
      !time ||
      categories[index] !==
        time.toPlainTime().toString({ smallestUnit: "minute" }) ||
      typeof price !== "number" ||
      !Number.isFinite(price)
    ) {
      throw new Error(`Invalid REN period ${index + 1}`);
    }
    return { instant: time.toInstant(), price };
  });
  const last = times[prices.length - 1];
  if (
    !last ||
    max !== last.toPlainDateTime().toString({ smallestUnit: "second" })
  ) {
    throw new Error("REN response date or coverage mismatch");
  }
  return result;
}

async function request(url: string, fetcher: PriceFetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok)
    throw new Error(`Price request failed: HTTP ${response.status}`);
  return response;
}

/** Discover corrected file versions; direct version 1 remains usable if listing fails. */
async function versions(fetcher: PriceFetch): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  try {
    const response = await request(
      "https://www.omie.es/es/file-access-list?realdir=marginalpdbc",
      fetcher,
    );
    const text = await response.text();
    for (const match of text.matchAll(/marginalpdbc_(\d{8})\.(\d+)/g)) {
      const date = match[1];
      const version = Number(match[2]);
      if (
        date &&
        Number.isSafeInteger(version) &&
        version > (result.get(date) ?? 0)
      )
        result.set(date, version);
    }
  } catch (error) {
    logWarn(
      "OMIE version listing unavailable; trying date files directly",
      error,
    );
  }
  return result;
}

export async function fetchPriceQuarters(
  today: Temporal.PlainDate,
  fetcher: PriceFetch = fetch,
): Promise<PriceQuarter[]> {
  const dates = [today, today.add({ days: 1 })];
  const availableVersions = await versions(fetcher);
  const primary = await Promise.allSettled(
    dates.map(async (date) => {
      const key = date.toString().replaceAll("-", "");
      const version = availableVersions.get(key) ?? 1;
      const url = `https://www.omie.es/en/file-download?parents%5B0%5D=marginalpdbc&filename=marginalpdbc_${key}.${version}`;
      const response = await request(url, fetcher);
      const quarters = parseOmieDay(await response.text(), date);
      logInfo(
        `Electricity prices: OMIE ${date} version ${version}, ${quarters.length} quarters`,
      );
      return quarters;
    }),
  );
  const omie: PriceQuarter[] = [];
  for (const result of primary) {
    if (result.status === "fulfilled") omie.push(...result.value);
    else logWarn("OMIE date prices unavailable", result.reason);
  }
  if (primary.every((result) => result.status === "fulfilled")) return omie;

  // REN uses Lisbon dates, so request both to recover cross-midnight coverage.
  const fallback = await Promise.allSettled(
    dates.map(async (date) => {
      const url = `https://servicebus.ren.pt/datahubapi/electricity/ElectricityMarketPricesDaily?culture=pt-PT&date=${date}`;
      const response = await request(url, fetcher);
      const quarters = parseRenDay(await response.json(), date);
      logInfo(`Electricity prices: REN ${date}, ${quarters.length} quarters`);
      return quarters;
    }),
  );
  const merged = new Map<string, PriceQuarter>();
  for (const result of fallback) {
    if (result.status === "fulfilled") {
      for (const quarter of result.value)
        merged.set(quarter.instant.toString(), quarter);
    } else
      logWarn(
        "REN date prices unavailable; retaining previous prices",
        result.reason,
      );
  }

  // Prefer direct OMIE values when both sources cover the same instant.
  for (const quarter of omie) merged.set(quarter.instant.toString(), quarter);
  return [...merged.values()];
}

/** The fixed 24-hour dashboard averages both occurrences of a repeated Lisbon hour. */
export function hourlyPrices(
  quarters: PriceQuarter[],
  today: Temporal.PlainDate,
): OmieEntry[] {
  const prices = new Map(
    quarters.map((quarter) => [quarter.instant.toString(), quarter.price]),
  );
  const entries: OmieEntry[] = [];
  for (const date of [today, today.add({ days: 1 })]) {
    const groups = new Map<number, Temporal.ZonedDateTime[]>();
    for (const time of dayQuarters(date, "Europe/Lisbon")) {
      const group = groups.get(time.hour) ?? [];
      group.push(time);
      groups.set(time.hour, group);
    }

    for (const [hour, times] of groups) {
      const values = times.map((time) =>
        prices.get(time.toInstant().toString()),
      );
      if (!values.every((price): price is number => price !== undefined))
        continue;
      const average =
        values.reduce((sum, price) => sum + price, 0) / values.length;
      const tariff = hour >= 22 || hour < 8 ? 0.0158 : 0.0835;
      entries.push({
        date: date.toPlainDateTime({ hour }),
        price: Math.round(
          ((average / 1000) * 1.16 + 0.0314 + tariff) * 1.06 * 100,
        ),
      });
    }
  }
  return entries.sort((a, b) => Temporal.PlainDateTime.compare(a.date, b.date));
}
