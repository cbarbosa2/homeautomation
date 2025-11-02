import { WallboxLocation, WallboxStatus } from "../globals.ts";
import { MqttClient } from "../mqtt-client.ts";

export class DynamicPowerHandler {
  private mqttClient: MqttClient;

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;
  }

  setWallboxCurrent(
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
        `(bogus) Current of ${WallboxLocation[location]} to ${current}`
      );
      const topic =
        location == WallboxLocation.Inside
          ? "W/102c6b9cfab9/evcharger/40/SetCurrent"
          : "W/102c6b9cfab9/evcharger/41/SetCurrent";
      this.mqttClient.publishJson(topic, { value: current });
    }
  }

  private publishWallboxStartStop(
    location: WallboxLocation,
    startStop: number | undefined
  ) {
    if (startStop != undefined) {
      console.log(
        `(bogus) Start/stop of ${WallboxLocation[location]}: ${startStop}`
      );
      const topic =
        location == WallboxLocation.Inside
          ? "W/102c6b9cfab9/evcharger/40/StartStop"
          : "W/102c6b9cfab9/evcharger/41/StartStop";
      this.mqttClient.publishJson(topic, { value: startStop });
    }
  }
}

const TARGET_AMPS_MIN_STOP = 7;
const TARGET_AMPS_MIN_START = 8;
