import { assertEquals } from "jsr:@std/assert";
import { parseOmieResponse } from "./omie-proxy.ts";
import { Temporal } from "../temporal.ts";

// Test data that simulates OMIE CSV format
const sampleOmieData = `OMIE - Mercado de electricidad;Fecha Emisión :14/09/2025 - 13:56;;15/09/2025;Precios y volúmenes del mercado diario;;;;

Fecha;Periodo;Precio marginal en el sistema español (EUR/MWh);Precio marginal en el sistema portugués (EUR/MWh);Energía total de compra sistema español (MWh);Energía total de venta sistema español (MWh);Energía total de compra sistema portugués (MWh);Energía total de venta sistema portugués (MWh);Energía total de compra del mercado Ibérico (MWh);Energía total de venta del mercado Ibérico (MWh);Energía total con bilaterales del mercado Ibérico (MWh);
15/09/2025;1;97,03;97,03;15675,5;13466,3;5073,6;4982,8;20749,1;18449,1;28727,3;
15/09/2025;2;94,95;94,95;15168,5;13586,6;4816;4097,9;19984,5;17684,5;27035,5;
15/09/2025;3;90;90;14622,3;13443;4577;3456,3;19199,3;16899,3;25920,9;
15/09/2025;4;89;89;14570,5;13295,9;4400,3;3374,9;18970,8;16670,8;25524,2;
15/09/2025;5;87,82;87,82;14544,1;13319;4328,5;3253,6;18872,6;16572,6;25328,9;
15/09/2025;6;94,17;94,17;14111,8;12637;4309,1;3483,9;18420,9;16120,9;25587,5;
15/09/2025;7;97,33;97,33;15722,2;13155,3;4406;4672,9;20128,2;17828,2;28095,4;
15/09/2025;8;120,83;120,83;17850,6;13679;4833,6;6705,2;22684,2;20384,2;31161,5;`;

Deno.test("parseOmie should parse OMIE data correctly", () => {
  const entries = parseOmieResponse(
    sampleOmieData,
    new Temporal.PlainDateTime(2025, 9, 15)
  );

  // the first entry is discarded because it's in the previous day
  assertEquals(entries.length, 7);

  // Check first entry
  const firstEntry = entries[0]!;
  assertEquals(firstEntry.date.day, 15);
  assertEquals(firstEntry.date.month, 9);
  assertEquals(firstEntry.date.year, 2025);
  assertEquals(firstEntry.date.hour, 0);

  assertEquals(firstEntry.price, 16);
});

// Deno.test("parseOmie should handle time zone conversion correctly", () => {
//   // Hour 01 should become hour 23 of previous day (01 - 2 = -1)
//   const data = "01/01/2025;01;01;45.67;0;0;0;0;0";
//   const entries = parseOmieResponse(data);

//   if (entries.length > 0) {
//     const entry = entries[0]!;
//     assertEquals(entry.date.hour, 23);
//     assertEquals(entry.date.day, 31); // Should be previous day
//     assertEquals(entry.date.month, 12); // Should be previous month
//     assertEquals(entry.date.year, 2024); // Should be previous year
//   }
// });

// Deno.test("parseOmie should apply correct tariffs", () => {
//   const nightData = "01/01/2025;24;01;45.67;0;0;0;0;0"; // Hour 22 after conversion
//   const dayData = "01/01/2025;12;01;45.67;0;0;0;0;0"; // Hour 10 after conversion

//   const nightEntries = parseOmieResponse(nightData);
//   const dayEntries = parseOmieResponse(dayData);

//   // Night entry should have lower total price due to lower tariff
//   // but we need to account for the formula complexity
//   assertEquals(nightEntries.length > 0, true);
//   assertEquals(dayEntries.length > 0, true);
// });
