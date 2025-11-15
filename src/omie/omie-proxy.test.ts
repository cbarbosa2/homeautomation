import { assertEquals } from "jsr:@std/assert";
import { parseOmieResponse } from "./omie-proxy.ts";
import { Temporal } from "../temporal.ts";

// Test data that simulates OMIE CSV format
const sampleOmieData = `OMIE - Mercado de electricidad;Fecha Emisión :14/11/2025 - 13:10;;15/11/2025;Precios y volúmenes del mercado diario;;;;

Fecha;Periodo;Precio marginal en el sistema español (EUR/MWh);Precio marginal en el sistema portugués (EUR/MWh);Potencia total de compra sistema español (MW);Potencia total de venta sistema español (MW);Potencia total de compra sistema portugués (MW);Potencia total de venta sistema portugués (MW);Potencia total de compra del mercado Ibérico (MW);Potencia total de venta del mercado Ibérico (MW);Potencia total con bilaterales del mercado Ibérico (MW);
15/11/2025;1;31,5;31,5;19027,4;18635,4;5871,2;5267,6;24898,6;23903;32041,3;
15/11/2025;2;22,2;22,2;19169,4;18705,1;5815;5135,8;24984,4;23840,9;32084;
15/11/2025;3;21,14;21,14;19176,8;18792,7;5690,7;5147,1;24867,5;23939,8;31888,1;
15/11/2025;4;17,11;17,11;19663,3;18877,4;5753,6;5110,4;25416,9;23987,8;32365,6;
15/11/2025;5;23,04;23,04;21027,1;21638,8;5371,5;5147,9;26398,6;26786,7;30466,2;
15/11/2025;6;19,1;19,1;21601,9;21532;5297,3;5138,6;26899,2;26670,6;30967,6;
15/11/2025;7;19,51;19,51;21002,3;21443,4;5198,8;5136,5;26201,1;26579,9;30263,2;
15/11/2025;8;17,37;17,37;21267,8;21369,7;5134,2;5092;26402;26461,7;30439,5;
15/11/2025;41;33;33;22732,7;25116,9;5453;5281,7;28185,7;30398,6;33088,9;
15/11/2025;42;21,8;21,8;23643,1;25465;5613;5155,7;29256,1;30620,7;34230;
15/11/2025;43;23,98;23,98;23557,6;25784,9;5659,9;5112,6;29217,5;30897,5;34242,4;
15/11/2025;44;18,49;18,49;24375,7;26040,6;5701,8;5132,5;30077,5;31173,1;35142,5;`;

Deno.test("parseOmieResponse should parse OMIE data correctly", () => {
  const startOfToday = new Temporal.PlainDateTime(2025, 11, 14, 0, 0, 0);

  const result = parseOmieResponse(sampleOmieData, startOfToday);

  // Should have 3 entries
  assertEquals(result.length, 3);

  // Check first entry (period 1 = hour 0, offset -1 = hour 23 of previous day)
  // But since we're filtering >= startOfToday, this should be the first valid entry
  const firstEntry = result[0]!;
  assertEquals(firstEntry.date.year, 2025);
  assertEquals(firstEntry.date.month, 11);
  assertEquals(firstEntry.date.day, 14); // Previous day due to -1 hour offset
  assertEquals(firstEntry.date.hour, 23); // Period 1 becomes hour 0, then -1 = 23

  // Check that price has been processed through the formula
  // Original price was 22.98, should be transformed
  // ((22.98 + 0.4 + 0.2893 + 1) * 1.16 + TAR_NIGHT * 10) * 1.23
  // TAR_NIGHT = 1.57 for hour 0 (night tariff)
  const expectedRawPrice =
    ((22.98 + 0.4 + 0.2893 + 1) * 1.16 + 1.57 * 10) * 1.23;
  const expectedPrice = Math.round(expectedRawPrice / 10);
  assertEquals(firstEntry.price, expectedPrice);

  // Check last entry
  const lastEntry = result[result.length - 1]!;
  assertEquals(lastEntry.date.hour, 9);

  // Verify entries are sorted by date
  for (let i = 1; i < result.length; i++) {
    const comparison = Temporal.PlainDateTime.compare(
      result[i - 1]!.date,
      result[i]!.date
    );
    assertEquals(comparison <= 0, true, "Entries should be sorted by date");
  }
});

Deno.test("parseOmieResponse should filter entries before startOfToday", () => {
  const response = `15/11/2025;1;31,5;31,5;19027,4;18635,4;5871,2;5267,6;24898,6;23903;32041,3;
16/11/2025;5;25,0;25,0;19027,4;18635,4;5871,2;5267,6;24898,6;23903;32041,3;`;

  // Set startOfToday to 16/11/2025, so 15/11/2025 entries should be filtered out
  const startOfToday = new Temporal.PlainDateTime(2025, 11, 16, 0, 0, 0);

  const result = parseOmieResponse(response, startOfToday);

  // Should only have 1 entry (the 16/11/2025 one)
  assertEquals(result.length, 1);
  assertEquals(result[0]!.date.day, 16);
});
