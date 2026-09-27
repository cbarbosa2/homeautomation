import { events, WallboxChargeMode, WallboxLocation } from "../globals.ts";
import { MqttClient } from "../mqtt-client.ts";
import {
  CommandType,
  runCommands,
} from "../power-controller/power-controller.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";
import { setChargeMode } from "./charge-mode-switcher.ts";

const mapIdAndPushesToChargeMode = new Map([
  ["0_1", WallboxChargeMode.ESSOnly],
  ["0_2", WallboxChargeMode.SunOnly],
  ["0_3", WallboxChargeMode.Off],
  ["1_1", WallboxChargeMode.Night],
  ["1_2", WallboxChargeMode.On],
  ["1_3", WallboxChargeMode.Manual],
  ["2_1", WallboxChargeMode.Night],
  ["2_2", WallboxChargeMode.On],
  ["2_3", WallboxChargeMode.Manual],
  ["3_1", WallboxChargeMode.ESSOnly],
  ["3_2", WallboxChargeMode.SunOnly],
  ["3_3", WallboxChargeMode.Off],
]);

const AMPS_FORCING_MANUAL_MODE = 6;

export function setupWallSwitchHandler(
  mqttClient: MqttClient,
  metrics: PrometheusMetrics,
): void {
  events.wallSwitchUpdated.subscribe((payload) => {
    return handleWallSwitch(metrics, payload);
  });
  events.wallboxCurrentInsideUpdated.subscribe(async (payload) => {
    if (payload == AMPS_FORCING_MANUAL_MODE) {
      const saved = setChargeMode(
        metrics,
        WallboxLocation.Inside,
        WallboxChargeMode.Manual,
      );
      setWallboxOutOfManualCurrent(mqttClient, CommandType.InsideCurrent);
      await saved;
    }
  });
  events.wallboxCurrentOutsideUpdated.subscribe(async (payload) => {
    if (payload == AMPS_FORCING_MANUAL_MODE) {
      const saved = setChargeMode(
        metrics,
        WallboxLocation.Outside,
        WallboxChargeMode.Manual,
      );
      setWallboxOutOfManualCurrent(mqttClient, CommandType.OutsideCurrent);
      await saved;
    }
  });
}

function setWallboxOutOfManualCurrent(
  mqttClient: MqttClient,
  commandType: CommandType,
) {
  runCommands(
    [
      {
        type: commandType,
        value: AMPS_FORCING_MANUAL_MODE + 1,
      },
    ],
    mqttClient,
  );
}

async function handleWallSwitch(
  metrics: PrometheusMetrics,
  payload: {
    params: { events: { id: number; event: string }[] };
  },
) {
  const id = payload.params.events[0]!.id;
  const event = payload.params.events[0]!.event;

  let pushes;
  if (event == "single_push") {
    pushes = 1;
  } else if (event == "double_push") {
    pushes = 2;
  } else if (event == "triple_push") {
    pushes = 3;
  } else {
    return;
  }

  const mode = mapIdAndPushesToChargeMode.get(id + "_" + pushes);

  if (mode != undefined) {
    const location = id == 0 || id == 1
      ? WallboxLocation.Inside
      : WallboxLocation.Outside;
    await setChargeMode(metrics, location, mode);
  }
}
