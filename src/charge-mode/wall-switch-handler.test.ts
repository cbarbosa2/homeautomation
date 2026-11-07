import { test } from "node:test";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  events,
  globals,
  WallboxChargeMode as Mode,
  WallboxLocation as L,
} from "../globals.ts";
import { MqttClient } from "../mqtt-client.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";
import { setupWallSwitchHandler } from "./wall-switch-handler.ts";

test("repeated physical selections and Manual triggers persist preference", async () => {
  const originalFetch = globalThis.fetch;
  const originalModes = globals.wallboxChargeMode;
  const originalPreference = globals.preferredWallboxLocation;
  const metrics = new PrometheusMetrics();
  const mqtt = new MqttClient(metrics);
  mqtt.publishJson = async () => {
    throw new Error("Unexpected hardware command");
  };
  const writes: { preferredWallboxLocation: L }[] = [];
  globalThis.fetch = async (_input, init) => {
    writes.push(JSON.parse(String(init?.body)));
    return Response.json({});
  };
  globals.wallboxChargeMode = new Map([
    [L.Inside, Mode.On],
    [L.Outside, Mode.On],
  ]);
  setupWallSwitchHandler(mqtt, metrics);
  try {
    for (const [id, location] of [
      [2, L.Outside],
      [1, L.Inside],
      [2, L.Outside],
      [2, L.Outside],
    ] as const) {
      await events.wallSwitchUpdated.emit({
        params: { events: [{ id, event: "double_push" }] },
      });
      assertEquals(globals.preferredWallboxLocation, location);
      assertEquals(writes.at(-1)?.preferredWallboxLocation, location);
    }
    await events.wallboxCurrentInsideUpdated.emit(6);
    assertEquals(globals.wallboxChargeMode.get(L.Inside), Mode.Manual);
    assertEquals(globals.preferredWallboxLocation, L.Inside);
    await events.wallboxCurrentOutsideUpdated.emit(6);
    assertEquals(globals.wallboxChargeMode.get(L.Outside), Mode.Manual);
    assertEquals(globals.preferredWallboxLocation, L.Outside);
    assertEquals(
      writes.map((write) => write.preferredWallboxLocation),
      [L.Outside, L.Inside, L.Outside, L.Outside, L.Inside, L.Outside],
    );
  } finally {
    globalThis.fetch = originalFetch;
    globals.wallboxChargeMode = originalModes;
    globals.preferredWallboxLocation = originalPreference;
    metrics.getRegister().clear();
  }
});
