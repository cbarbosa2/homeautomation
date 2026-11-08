import { test } from "node:test";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { Temporal } from "./temporal.ts";
import { ControlTelemetry } from "./control-telemetry.ts";
import { CONTROL_PATHS } from "./device-topics.ts";

test("telemetry freshness includes exactly 60 seconds and rejects future readings", () => {
  let now = Temporal.Instant.from("2026-09-27T12:00:00Z");
  const recordedAt = now;
  const telemetry = new ControlTelemetry(() => now);
  telemetry.record(CONTROL_PATHS.gridPower, 100);
  now = recordedAt.add({ seconds: 60 });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), 100);
  now = now.add({ nanoseconds: 1 });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
  now = recordedAt.subtract({ nanoseconds: 1 });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
});

test("invalid control readings and disconnect invalidate values", () => {
  const telemetry = new ControlTelemetry();
  for (const value of [null, NaN, Infinity, "0", {}, undefined]) {
    telemetry.record(CONTROL_PATHS.gridPower, 100);
    telemetry.record(CONTROL_PATHS.gridPower, value);
    assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
  }
  telemetry.record(CONTROL_PATHS.gridPower, 100);
  telemetry.invalidate();
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), undefined);
});
