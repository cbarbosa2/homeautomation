import { OmieEntry } from "../globals.ts";

const OMIE_API_URL = `https://www.omie.es/sites/default/files/dados/NUEVA_SECCION/INT_PBC_EV_H_ACUM.TXT`;
const TAR_NIGHT = 1.57;
const TAR_DAY = 8.6;

export async function fetchOmie(): Promise<string> {
  try {
    const response = await fetch(OMIE_API_URL);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    console.error("Error fetching/parsing OMIE:", error);
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

  entries.sort(function (a, b) {
    return Temporal.PlainDateTime.compare(a.date, b.date);
  });

  entries.forEach(function (entry) {
    let tarCents = 0;
    if (entry.date.hour >= 22 || entry.date.hour < 8) {
      tarCents = TAR_NIGHT;
    } else {
      tarCents = TAR_DAY;
    }
    // ((OMIE + CGS + TSE + k) x (1+FP) + TAR) x IVA
    const formulaResult =
      ((entry.price + 0.4 + 0.2893 + 1) * 1.16 + tarCents * 10) * 1.23;
    // convert to cents per kWh
    entry.price = Math.round(formulaResult / 10);
  });

  console.log(JSON.stringify(entries));
  return entries;
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
    .toPlainDateTime({ hour: parseInt(parts[1]!) - 1 })
    // offset spain to portugal
    .add({ hours: -1 });

  return {
    date: dateTime,
    price: parseFloat(parts[3]!.replace(",", ".")),
  };
}
