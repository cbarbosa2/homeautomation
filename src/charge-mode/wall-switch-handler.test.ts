import { DeviceTelemetry } from "../device-telemetry.ts";
import { systemClock } from "../lisbon-clock.ts";
import { VICTRON_PORTAL_ID } from "../constants.ts";
import { wallboxPath } from "../device-topics.ts";
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
  const mqtt = new MqttClient(metrics, () => {});
  const commands: { topic: string; value: unknown }[] = [];
  mqtt.publishJson = async (topic, payload) => {
    const { value } = payload;
    commands.push({ topic, value });
  };
  const writes: { preferredWallboxLocation: L }[] = [];
  globalThis.fetch = async (_input, init) => {
    writes.push(JSON.parse(String(init?.body)));
    return Response.json({});
  };
  globals.wallboxChargeMode = new Map([
    [L.Inside, Mode.Max],
    [L.Outside, Mode.Max],
  ]);
  setupWallSwitchHandler(mqtt, metrics, true);
  let pendingEvent = Promise.resolve();
  const handlers = new Map<string, (topic: string, payload: unknown) => void>();
  const telemetry = new DeviceTelemetry({
    clock: systemClock,
    metrics,
    currentUpdated: (location, value) => {
      pendingEvent = (
        location === L.Inside
          ? events.wallboxCurrentInsideUpdated
          : events.wallboxCurrentOutsideUpdated
      ).emit(value);
    },
    wallSwitchUpdated: (payload) => {
      pendingEvent = events.wallSwitchUpdated.emit(payload);
    },
  });
  await telemetry.subscribe({
    subscribeWithHandler: async (topic, handler) => {
      handlers.set(topic, handler);
    },
  });
  const currentGesture = async (location: L) => {
    const topic = `N/${VICTRON_PORTAL_ID}/${wallboxPath(location, "SetCurrent")}`;
    const handler = handlers.get(topic);
    if (!handler) throw new Error("Missing current subscription");
    handler(topic, { value: 6 });
    await pendingEvent;
  };
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
    await currentGesture(L.Inside);
    assertEquals(globals.wallboxChargeMode.get(L.Inside), Mode.Manual);
    assertEquals(globals.preferredWallboxLocation, L.Inside);
    await currentGesture(L.Outside);
    assertEquals(globals.wallboxChargeMode.get(L.Outside), Mode.Manual);
    assertEquals(globals.preferredWallboxLocation, L.Outside);
    assertEquals(
      commands.map(({ topic, value }) => ({
        path: topic.split("/").slice(2).join("/"),
        value,
      })),
      [
        { path: "evcharger/40/SetCurrent", value: 7 },
        { path: "evcharger/41/SetCurrent", value: 7 },
      ],
    );
    assertEquals(
      writes.map((write) => write.preferredWallboxLocation),
      [L.Outside, L.Inside, L.Outside, L.Outside, L.Inside, L.Outside],
    );
    for (const [id, location, modes] of [
      [0, L.Inside, [Mode.Reserve, Mode.Sun, Mode.Manual]],
      [1, L.Inside, [Mode.Battery, Mode.Night, Mode.Max]],
      [2, L.Outside, [Mode.Battery, Mode.Night, Mode.Max]],
      [3, L.Outside, [Mode.Reserve, Mode.Sun, Mode.Manual]],
    ] as const) {
      for (const [index, event] of [
        "single_push",
        "double_push",
        "triple_push",
      ].entries()) {
        await events.wallSwitchUpdated.emit({
          params: { events: [{ id, event }] },
        });
        assertEquals(globals.wallboxChargeMode.get(location), modes[index]);
        assertEquals(globals.preferredWallboxLocation, location);
        assertEquals(writes.at(-1)?.preferredWallboxLocation, location);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    globals.wallboxChargeMode = originalModes;
    globals.preferredWallboxLocation = originalPreference;
    metrics.getRegister().clear();
  }
});
