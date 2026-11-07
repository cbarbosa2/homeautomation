import { POWER_CONTROL_ENABLED } from "../constants.ts";
import { events, WallboxChargeMode, WallboxLocation } from "../globals.ts";
import type { MqttClient } from "../mqtt-client.ts";
import {
  CommandType,
  runCommands,
} from "../power-controller/power-controller.ts";
import type { PrometheusMetrics } from "../prometheus/prometheus.ts";
import { setChargeMode } from "./charge-mode-switcher.ts";

const mapIdAndPushesToChargeMode = new Map([
  ["0_1", WallboxChargeMode.Reserve],
  ["0_2", WallboxChargeMode.Sun],
  ["0_3", WallboxChargeMode.Manual],
  ["1_1", WallboxChargeMode.Battery],
  ["1_2", WallboxChargeMode.Night],
  ["1_3", WallboxChargeMode.Max],
  ["2_1", WallboxChargeMode.Battery],
  ["2_2", WallboxChargeMode.Night],
  ["2_3", WallboxChargeMode.Max],
  ["3_1", WallboxChargeMode.Reserve],
  ["3_2", WallboxChargeMode.Sun],
  ["3_3", WallboxChargeMode.Manual],
]);

const AMPS_FORCING_MANUAL_MODE = 6;

export function setupWallSwitchHandler(
  mqttClient: MqttClient,
  metrics: PrometheusMetrics,
  publicationEnabled = POWER_CONTROL_ENABLED,
): void {
  events.wallSwitchUpdated.subscribe((payload) => {
    return handleWallSwitch(metrics, payload);
  });
  events.wallboxCurrentInsideUpdated.subscribe(async (payload) => {
    if (Number(payload) === AMPS_FORCING_MANUAL_MODE) {
      const saved = setChargeMode(
        metrics,
        WallboxLocation.Inside,
        WallboxChargeMode.Manual,
      );
      await Promise.all([
        saved,
        setWallboxOutOfManualCurrent(
          mqttClient,
          CommandType.InsideCurrent,
          publicationEnabled,
        ),
      ]);
    }
  });
  events.wallboxCurrentOutsideUpdated.subscribe(async (payload) => {
    if (Number(payload) === AMPS_FORCING_MANUAL_MODE) {
      const saved = setChargeMode(
        metrics,
        WallboxLocation.Outside,
        WallboxChargeMode.Manual,
      );
      await Promise.all([
        saved,
        setWallboxOutOfManualCurrent(
          mqttClient,
          CommandType.OutsideCurrent,
          publicationEnabled,
        ),
      ]);
    }
  });
}

function setWallboxOutOfManualCurrent(
  mqttClient: MqttClient,
  commandType: CommandType,
  publicationEnabled: boolean,
) {
  return runCommands(
    [
      {
        type: commandType,
        value: AMPS_FORCING_MANUAL_MODE + 1,
      },
    ],
    mqttClient,
    publicationEnabled,
    // This explicit user gesture resets the setting after selecting Manual.
    () => undefined,
  );
}

async function handleWallSwitch(
  metrics: PrometheusMetrics,
  payload: {
    params: { events: { id: number; event: string }[] };
  },
) {
  const { id, event } = payload.params.events[0] as {
    id: number;
    event: string;
  };

  let pushes: number;
  if (String(event) === "single_push") {
    pushes = 1;
  } else if (String(event) === "double_push") {
    pushes = 2;
  } else if (String(event) === "triple_push") {
    pushes = 3;
  } else {
    return;
  }

  const mode = mapIdAndPushesToChargeMode.get(`${id}_${pushes}`);

  if (mode != null) {
    const location = [0, 1].includes(Number(id))
      ? WallboxLocation.Inside
      : WallboxLocation.Outside;
    await setChargeMode(metrics, location, mode);
  }
}
