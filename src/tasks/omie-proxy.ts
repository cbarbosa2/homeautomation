const OMIE_API_URL = `https://www.omie.es/sites/default/files/dados/NUEVA_SECCION/INT_PBC_EV_H_ACUM.TXT`;
const TAR_NIGHT = 1.57;
const TAR_DAY = 8.6;

export interface OmieEntry {
  date: Temporal.PlainDateTime;
  price: number;
}

export async function fetchOmieEntries(): Promise<OmieEntry[]> {
  try {
    const response = await fetch(OMIE_API_URL);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return parseOmie(await response.text());
  } catch (error) {
    console.error("Error fetching/parsing OMIE:", error);
    throw error;
  }
}

function parseOmie(response: string): OmieEntry[] {
  const entries: OmieEntry[] = [];
  const lines = response.split("\n");

  const startOfToday = getStartOfToday();

  for (const line in lines) {
    const parsedLine = parseLine(line);
    if (parsedLine && parsedLine.date >= startOfToday) {
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
    entry.price =
      ((entry.price + 0.4 + 0.2893 + 1) * 1.16 + tarCents * 10) * 1.23;
  });

  return entries;
}

function parseDate(input: string): Temporal.PlainDate | undefined {
  const parts: string[] = input.split("/");
  try {
    if (parts.length == 3) {
      return new Temporal.PlainDate(
        parseInt(parts[2]!),
        parseInt(parts[1]!) - 1,
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

  const dateTime = date.toPlainDateTime({ hour: parseInt(parts[1]!) - 2 });

  return { date: dateTime, price: parseFloat(parts[3]!.replace(",", ".")) };
}

export function getStartOfToday(): Temporal.PlainDateTime {
  const now = Temporal.Now.plainDateTimeISO();
  return now.with({
    hour: 0,
    minute: 0,
    second: 0,
    microsecond: 0,
    millisecond: 0,
    nanosecond: 0,
  });
}

export function getStartOfTomorrow(): Temporal.PlainDateTime {
  return getStartOfToday().add({ days: 1 });
}
