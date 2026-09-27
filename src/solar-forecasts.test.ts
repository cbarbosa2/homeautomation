import { assertEquals, assertStrictEquals } from "@std/assert";
import { SolarForecasts } from "./solar-forecasts.ts";
import { Temporal } from "./temporal.ts";

Deno.test("forecasts use calendar dates rather than date object identity", () => {
  const date = Temporal.PlainDate.from("2026-09-27");
  const forecast = {
    wattHours: 1000,
    fetchedAt: Temporal.Instant.from("2026-09-26T12:00:00Z"),
  };
  const forecasts = new SolarForecasts([[date, forecast]]);
  assertStrictEquals(
    forecasts.get(Temporal.PlainDate.from("2026-09-27")),
    forecast,
  );
  assertEquals(forecasts.get(date.add({ days: 1 })), undefined);

  const updated = { ...forecast, wattHours: 0 };
  forecasts.set(Temporal.PlainDate.from("2026-09-27"), updated);
  assertStrictEquals(forecasts.get(date), updated);
  assertStrictEquals(forecasts.get(date.withCalendar("gregory")), updated);
});
