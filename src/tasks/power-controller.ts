import {
  POWER_CONTROL_ENABLED,
  TARGET_AMPS_MIN_START,
  TARGET_AMPS_MIN_STOP,
} from "../constants.ts";
import { WallboxLocation, WallboxStatus } from "../globals.ts";
import { logInfo } from "../logger.ts";
import { MqttClient } from "../mqtt-client.ts";
import { powerToAmps } from "../utils.ts";
import { CalculatedTargetResults } from "./dynamic-power-calculator.ts";

export interface SystemState {
  batteryMaxChargePower: number | undefined;
  wallboxPower: Map<WallboxLocation, number>;
  wallboxVictronStatus: Map<WallboxLocation, WallboxStatus>;
}

export class PowerController {
  private mqttClient: MqttClient;

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;
  }

  pushPowerSettings(state: SystemState, targets: CalculatedTargetResults) {
    const insideWallboxPower = state.wallboxPower.get(WallboxLocation.Inside);

    this.setWallboxAmps(
      WallboxLocation.Inside,
      targets.insideWallboxAmps,
      insideWallboxPower == undefined
        ? undefined
        : powerToAmps(insideWallboxPower),
      state.wallboxVictronStatus.get(WallboxLocation.Inside)
    );

    const outsideWallboxPower = state.wallboxPower.get(WallboxLocation.Outside);

    this.setWallboxAmps(
      WallboxLocation.Outside,
      targets.outsideWallboxAmps,
      outsideWallboxPower == undefined
        ? undefined
        : powerToAmps(outsideWallboxPower),
      state.wallboxVictronStatus.get(WallboxLocation.Outside)
    );

    if (
      targets.batteryChargePower != undefined &&
      targets.batteryChargePower != state.batteryMaxChargePower
    ) {
      this.publishBatteryMaxChargePower(targets.batteryChargePower);
    }
  }

  private setWallboxAmps(
    location: WallboxLocation,
    targetAmps: number | undefined,
    currentAmps: number | undefined,
    chargerStatus: WallboxStatus | undefined
  ) {
    if (targetAmps == undefined || targetAmps == currentAmps) return;

    let newStartStop;
    let newCurrent;

    if (targetAmps < TARGET_AMPS_MIN_STOP) {
      // turn off
      if ((currentAmps ?? 0) > 0) {
        // stop
        newStartStop = 0;
        // set min current
        newCurrent = TARGET_AMPS_MIN_START;
      }
    } else {
      // status: Connected, Waiting for start
      if (
        (chargerStatus == WallboxStatus.Connected ||
          chargerStatus == WallboxStatus.WaitingForStart) &&
        targetAmps >= TARGET_AMPS_MIN_START
      ) {
        // start
        newStartStop = 1;
      }

      // adjust current
      newCurrent = targetAmps;
    }

    this.publishWallboxCurrent(location, newCurrent);
    this.publishWallboxStartStop(location, newStartStop);
  }

  private publishWallboxCurrent(
    location: WallboxLocation,
    current: number | undefined
  ) {
    if (current != undefined) {
      logInfo(`Current of ${WallboxLocation[location]} Wallbox -> ${current}`);
      const topic =
        location == WallboxLocation.Inside
          ? "W/102c6b9cfab9/evcharger/40/SetCurrent"
          : "W/102c6b9cfab9/evcharger/41/SetCurrent";
      if (POWER_CONTROL_ENABLED) {
        this.mqttClient.publishJson(topic, { value: current });
      }
    }
  }

  private publishWallboxStartStop(
    location: WallboxLocation,
    startStop: number | undefined
  ) {
    if (startStop != undefined) {
      logInfo(
        `Start/stop of ${WallboxLocation[location]} Wallbox -> ${startStop}`
      );
      const topic =
        location == WallboxLocation.Inside
          ? "W/102c6b9cfab9/evcharger/40/StartStop"
          : "W/102c6b9cfab9/evcharger/41/StartStop";
      if (POWER_CONTROL_ENABLED) {
        this.mqttClient.publishJson(topic, { value: startStop });
      }
    }
  }

  private publishBatteryMaxChargePower(power: number) {
    logInfo(`Battery max charge power -> ${power}`);
    const topic = "W/102c6b9cfab9/settings/0/Settings/CGwacs/MaxChargePower";
    if (POWER_CONTROL_ENABLED) {
      this.mqttClient.publishJson(topic, { value: power });
    }
  }
}
