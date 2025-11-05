import { WallboxLocation, WallboxStatus } from "../globals.ts";
import { MqttClient } from "../mqtt-client.ts";
import { powerToAmps } from "../utils.ts";
import { CalculatedTargetResults } from "./dynamic-power-calculator.ts";

export interface InputState {
  wallboxPower: Map<WallboxLocation, number>;
  wallboxVictronStatus: Map<WallboxLocation, WallboxStatus>;
}

export class PowerPublisher {
  private mqttClient: MqttClient;

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;
  }

  pushPowerSettings(state: InputState, targets: CalculatedTargetResults) {
    const powerInsideWallbox = state.wallboxPower.get(WallboxLocation.Inside);

    this.setWallboxAmps(
      WallboxLocation.Inside,
      targets.insideWallboxAmps,
      powerInsideWallbox == undefined
        ? undefined
        : powerToAmps(powerInsideWallbox),
      state.wallboxVictronStatus.get(WallboxLocation.Inside)
    );

    const powerOutsideWallbox = state.wallboxPower.get(WallboxLocation.Outside);

    this.setWallboxAmps(
      WallboxLocation.Outside,
      targets.outsideWallboxAmps,
      powerOutsideWallbox == undefined
        ? undefined
        : powerToAmps(powerOutsideWallbox),
      state.wallboxVictronStatus.get(WallboxLocation.Outside)
    );

    this.publishBatteryChargePower(targets.batteryChargePower);
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
      console.log(
        `Current of ${WallboxLocation[location]} Wallbox -> ${current}`
      );
      const topic =
        location == WallboxLocation.Inside
          ? "W/102c6b9cfab9/evcharger/40/SetCurrent"
          : "W/102c6b9cfab9/evcharger/41/SetCurrent";
      // this.mqttClient.publishJson(topic, { value: current });
    }
  }

  private publishWallboxStartStop(
    location: WallboxLocation,
    startStop: number | undefined
  ) {
    if (startStop != undefined) {
      console.log(
        `Start/stop of ${WallboxLocation[location]} Wallbox -> ${startStop}`
      );
      const topic =
        location == WallboxLocation.Inside
          ? "W/102c6b9cfab9/evcharger/40/StartStop"
          : "W/102c6b9cfab9/evcharger/41/StartStop";
      // this.mqttClient.publishJson(topic, { value: startStop });
    }
  }

  private publishBatteryChargePower(power: number | undefined) {
    if (power != undefined) {
      console.log(`Battery charge power -> ${power}`);
      const topic = "W/102c6b9cfab9/settings/0/Settings/CGwacs/MaxChargePower";
      // this.mqttClient.publishJson(topic, { value: power });
    }
  }
}

const TARGET_AMPS_MIN_STOP = 7;
export const TARGET_AMPS_MIN_START = 8;
