import { BATTERY_CELL_PATHS } from "./battery-cell-telemetry.ts";
import { test } from "node:test";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { VICTRON_INSTALLATION_ID, VICTRON_PORTAL_ID } from "./constants.ts";
import {
  CONTROL_PATHS,
  ControlTelemetry,
  REFRESH_PATHS,
} from "./control-telemetry.ts";
import { globals, WallboxChargeMode, WallboxLocation } from "./globals.ts";
import { MqttAwakeTask } from "./tasks/mqtt-awake-task.ts";
import { MqttToPrometheusTask } from "./tasks/mqtt-to-prometheus-task.ts";
import { SetSocLimitTask } from "./tasks/set-soc-limit-task.ts";
import { SolarForecasts } from "./solar-forecasts/solar-forecasts.ts";
import { Temporal } from "./temporal.ts";
import {
  CommandType,
  runCommands,
} from "./power-controller/power-controller.ts";

test("configured portal ID routes telemetry, subscriptions, refreshes and commands", async () => {
  const subscriptions: string[] = [];
  new MqttToPrometheusTask(
    {
      subscribeWithHandler: (topic) => {
        subscriptions.push(topic);
        return Promise.resolve();
      },
    },
    { setGauge: () => {} },
  ).subscribeTopics();
  const victronTopics = subscriptions.filter((topic) => topic.startsWith("N/"));
  assert(victronTopics.length > 0);
  assert(
    victronTopics.every((topic) => topic.startsWith(`N/${VICTRON_PORTAL_ID}/`)),
  );

  const telemetry = new ControlTelemetry();
  telemetry.record(`N/${VICTRON_PORTAL_ID}/${CONTROL_PATHS.gridPower}`, {
    value: 100,
  });
  assertEquals(telemetry.value(CONTROL_PATHS.gridPower), 100);

  const reads: string[] = [];
  await new MqttAwakeTask({
    publish: (topic) => {
      reads.push(topic);
      return Promise.resolve();
    },
  }).execute();
  assertEquals(
    reads,
    ["keepalive", ...REFRESH_PATHS, ...Object.values(BATTERY_CELL_PATHS)].map(
      (path) => `R/${VICTRON_PORTAL_ID}/${path}`,
    ),
  );

  const writes: string[] = [];
  const mqtt = {
    publishJson: (topic: string) => {
      writes.push(topic);
      return Promise.resolve();
    },
  };
  const previousModes = new Map(globals.wallboxChargeMode);
  try {
    globals.wallboxChargeMode.set(
      WallboxLocation.Inside,
      WallboxChargeMode.Max,
    );
    globals.wallboxChargeMode.set(
      WallboxLocation.Outside,
      WallboxChargeMode.Max,
    );
    await runCommands(
      Object.values(CommandType).map((type) => ({ type, value: 0 })),
      mqtt,
      true,
    );
    await new SetSocLimitTask(mqtt).executeInMorning();
    assertEquals(writes.length, 6);
    assert(
      writes.every((topic) => topic.startsWith(`W/${VICTRON_PORTAL_ID}/`)),
    );
    assert(
      writes.includes(
        `W/${VICTRON_PORTAL_ID}/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit`,
      ),
    );
  } finally {
    globals.wallboxChargeMode = previousModes;
  }
});

test("forecast request uses the configured installation ID", async () => {
  const requested: URL[] = [];
  const forecasts = new SolarForecasts({
    forecastSolarApiKey: "",
    victronApiKey: "",
    victronInstallationId: VICTRON_INSTALLATION_ID,
    clock: () => Temporal.Instant.from("2026-01-01T00:00:00Z"),
    fetch: async (input) => {
      requested.push(new URL(input instanceof Request ? input.url : input));
      return Response.json(
        requested.length === 1
          ? { result: {} }
          : { records: { vrm_pv_charger_yield_fc: [] } },
      );
    },
    metrics: { setGauge: () => {} },
    logError: () => {},
  });
  await forecasts.refresh();
  assertEquals(requested.length, 2);
  assert(requested[1]);
  assertEquals(requested[1].origin, "https://vrmapi.victronenergy.com");
  assertEquals(
    requested[1].pathname,
    `/v2/installations/${VICTRON_INSTALLATION_ID}/stats`,
  );
});
