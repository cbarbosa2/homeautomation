import { DeviceTelemetry } from "./device-telemetry.ts";
import { VICTRON_PORTAL_ID } from "./constants.ts";
import { systemClock, type Clock } from "./lisbon-clock.ts";
import type { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { ok } from "node:assert/strict";

export async function recordingTelemetry(
  clock: Clock = systemClock,
  metrics: Pick<PrometheusMetrics, "setGauge"> = { setGauge: () => {} },
) {
  const handlers = new Map<string, (topic: string, payload: unknown) => void>();
  const telemetry = new DeviceTelemetry({
    clock,
    metrics,
    currentUpdated: () => {},
    wallSwitchUpdated: () => {},
  });
  await telemetry.subscribe({
    subscribeWithHandler: async (topic, handler) => {
      handlers.set(topic, handler);
    },
  });
  return {
    telemetry,
    record(path: string, payload: unknown) {
      const topic = `N/${VICTRON_PORTAL_ID}/${path}`;
      const handler = handlers.get(topic);
      ok(handler, `Missing subscription: ${topic}`);
      handler(topic, payload);
    },
    value: (path: string) => telemetry.value(path),
    invalidate: () => telemetry.invalidate(),
    cellHistory: () => telemetry.cellHistory(),
  };
}
