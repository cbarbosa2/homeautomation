import { assertEquals } from "@std/assert";
import { BMW_SOC_DESCRIPTORS, parseVehicleSoc } from "./bmw-cardata.ts";

Deno.test("BMW SOC selects the reading with the latest BMW timestamp", () => {
  const value = parseVehicleSoc({
    telematicData: {
      [BMW_SOC_DESCRIPTORS[0]]: {
        value: "53",
        timestamp: "2026-09-30T20:55:13Z",
      },
      [BMW_SOC_DESCRIPTORS[1]]: {
        value: "53.3",
        timestamp: "2026-09-30T19:36:53Z",
      },
      [BMW_SOC_DESCRIPTORS[2]]: {
        value: "52",
        timestamp: "2026-09-30T18:00:00Z",
      },
    },
  });
  assertEquals(value?.percent, 53);
  assertEquals(value?.observedAt.toString(), "2026-09-30T20:55:13Z");
  assertEquals(value?.source, BMW_SOC_DESCRIPTORS[0]);
});

Deno.test("BMW SOC accepts zero and skips unavailable or invalid readings", () => {
  const value = parseVehicleSoc({
    telematicData: {
      [BMW_SOC_DESCRIPTORS[0]]: {
        value: "101",
        timestamp: "2026-09-30T20:00:00Z",
      },
      [BMW_SOC_DESCRIPTORS[1]]: { value: null, timestamp: null },
      [BMW_SOC_DESCRIPTORS[2]]: {
        value: "0",
        timestamp: "2026-09-30T19:00:00Z",
      },
    },
  });
  assertEquals(value?.percent, 0);
  assertEquals(value?.source, BMW_SOC_DESCRIPTORS[2]);
  assertEquals(parseVehicleSoc({ telematicData: {} }), undefined);
});
