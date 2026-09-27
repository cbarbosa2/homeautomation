import { assertEquals } from "@std/assert";
import { Temporal } from "./temporal.ts";
import {
  CONTROL_PATHS,
  ControlTelemetry,
  wallboxPath,
} from "./control-telemetry.ts";
import { WallboxLocation as L, WallboxStatus as S } from "./globals.ts";

Deno.test("telemetry freshness includes exactly 60 seconds and rejects future readings", () => {
  let now = Temporal.Instant.from("2026-09-27T12:00:00Z");
  const recordedAt = now;
  const telemetry = new ControlTelemetry(() => now);
  telemetry.record(CONTROL_PATHS.gridPower, { value: 100 });
  now = recordedAt.add({ seconds: 60 });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), 100);
  now = now.add({ nanoseconds: 1 });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
  now = recordedAt.subtract({ nanoseconds: 1 });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
});
Deno.test("telemetry preserves actual start order and startup ties", () => {
  let now = Temporal.Instant.from("2026-09-27T12:00:00Z");
  const telemetry = new ControlTelemetry(() => now);
  for (const l of [L.Inside, L.Outside]) {
    telemetry.record(wallboxPath(l, "Status"), { value: S.Connected });
  }
  telemetry.record(wallboxPath(L.Outside, "Status"), { value: S.Charging });
  now = now.add({ seconds: 1 });
  telemetry.record(wallboxPath(L.Inside, "Status"), { value: S.Charging });
  const starts = telemetry.snapshot().chargingStartedAt;
  assertEquals(
    Temporal.Instant.compare(starts.get(L.Outside)!, starts.get(L.Inside)!),
    -1,
  );
  const startup = new ControlTelemetry();
  for (const l of [L.Outside, L.Inside]) {
    startup.record(wallboxPath(l, "Status"), { value: S.Charging });
  }
  assertEquals(
    [...startup.snapshot().chargingStartedAt.values()].map((at) =>
      at.toString()
    ),
    ["1970-01-01T00:00:00Z", "1970-01-01T00:00:00Z"],
  );
});

Deno.test("invalid control readings and disconnect invalidate values", () => {
  const telemetry = new ControlTelemetry();
  for (const value of [null, NaN, Infinity, "0", {}, undefined]) {
    telemetry.record(CONTROL_PATHS.gridPower, { value: 100 });
    telemetry.record(CONTROL_PATHS.gridPower, { value });
    assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
  }
  telemetry.record(CONTROL_PATHS.gridPower, { value: 100 });
  telemetry.invalidate();
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
});
