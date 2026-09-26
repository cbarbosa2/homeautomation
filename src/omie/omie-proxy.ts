import { OmieEntry } from "../globals.ts";
import { logError } from "../logger.ts";
import { Temporal } from "../temporal.ts";

const OMIE_API_URL = `https://www.omie.es/sites/default/files/dados/NUEVA_SECCION/INT_PBC_EV_H_ACUM.TXT`;
const TAR_NIGHT = 0.0158; // EUR/kWh, 22:00–08:00
const TAR_DAY = 0.0835; // EUR/kWh, 08:00–22:00

export async function fetchOmie(): Promise<string> {
  try {
    const response = await fetch(OMIE_API_URL);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    logError("Error fetching/parsing OMIE:", error);
    throw error;
  }
}

export function parseOmieResponse(
  response: string,
  startOfToday: Temporal.PlainDateTime
): OmieEntry[] {
  const entries: OmieEntry[] = [];
  const lines = response.split("\n");

  for (const line of lines) {
    const parsedLine = parseLine(line);
    if (
      parsedLine &&
      Temporal.PlainDateTime.compare(parsedLine.date, startOfToday) >= 0
    ) {
      entries.push(parsedLine);
    }
  }

  const averagedEntries = createAveragedEntries(entries);

  averagedEntries.sort(function (a, b) {
    return Temporal.PlainDateTime.compare(a.date, b.date);
  });

  const resultEntries = averagedEntries.map((entry) => {
    const tar = entry.date.hour >= 22 || entry.date.hour < 8
      ? TAR_NIGHT
      : TAR_DAY;

    // Convert OMIE from EUR/MWh to EUR/kWh before applying the formula.
    const omie = entry.price / 1000;
    const formulaResult = (omie * 1.16 + 0.314 + tar) * 1.06;

    // convert to cents per kWh
    return { date: entry.date, price: Math.round(formulaResult * 100) };
  });

  return resultEntries;
}

function createAveragedEntries(entries: OmieEntry[]): OmieEntry[] {
  const averagedEntries: OmieEntry[] = [];
  const dateTimeGroups = new Map<string, OmieEntry[]>();

  // Group entries by full PlainDateTime
  entries.forEach((entry) => {
    const dateTimeKey = entry.date.toString();
    if (!dateTimeGroups.has(dateTimeKey)) {
      dateTimeGroups.set(dateTimeKey, []);
    }
    dateTimeGroups.get(dateTimeKey)!.push(entry);
  });

  // Calculate average price for each date-time group
  dateTimeGroups.forEach((groupEntries) => {
    const averagePrice =
      groupEntries.reduce((sum, entry) => sum + entry.price, 0) /
      groupEntries.length;
    averagedEntries.push({
      date: groupEntries[0]!.date,
      price: averagePrice,
    });
  });

  return averagedEntries;
}

function parseDate(input: string): Temporal.PlainDate | undefined {
  const parts: string[] = input.split("/");
  try {
    if (parts.length == 3) {
      return new Temporal.PlainDate(
        parseInt(parts[2]!),
        parseInt(parts[1]!),
        parseInt(parts[0]!)
      );
    }
  } catch (_ex) {
    // ignore
  }
  return undefined;
}

function parseLine(line: string): OmieEntry | undefined {
  const parts: string[] = line.split(";");
  if (parts.length < 4) return undefined;

  const date = parseDate(parts[0]!);
  if (!date) return undefined;

  const dateTime = date
    .toPlainDateTime({ hour: Math.floor((parseInt(parts[1]!) - 1) / 4) })
    // offset spain to portugal
    .add({ hours: -1 });

  return {
    date: dateTime,
    price: parseFloat(parts[3]!.replace(",", ".")),
  };
}
