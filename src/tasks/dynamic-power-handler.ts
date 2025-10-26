import { globals, WallboxChargeMode, WallboxLocation } from "../globals.ts";
import { MqttClient } from "../mqtt-client.ts";

export class DynamicPowerHandler {
  private mqttClient: MqttClient;

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;
  }

  execute() {
    const wallboxLocation = this.pickWallbox();
    const wallboxParams = this.readWallboxParams(wallboxLocation);
    const outputParams = this.calcOutputParams(wallboxParams);

    console.log(`wallbox location: ${WallboxLocation[wallboxLocation]}`);
    console.log(`wallbox params: ${JSON.stringify(wallboxParams)}`);
    console.log(`output params: ${JSON.stringify(outputParams)}`);

    if (outputParams.current != undefined) {
      console.log(
        `(bogus) Current of ${WallboxLocation[wallboxLocation]} to ${outputParams.current}`
      );
      // const topic =
      //   wallboxLocation == WallboxLocation.Inside
      //     ? "W/102c6b9cfab9/evcharger/40/SetCurrent"
      //     : "W/102c6b9cfab9/evcharger/41/SetCurrent";
      // this.mqttClient.publish(
      //   topic,
      //   JSON.stringify({ value: outputParams.current })
      // );
    }

    if (outputParams.startStop != undefined) {
      console.log(
        `(bogus) Start/stop of ${WallboxLocation[wallboxLocation]}: ${outputParams.startStop}`
      );
      // const topic =
      //   wallboxLocation == WallboxLocation.Inside
      //     ? "W/102c6b9cfab9/evcharger/40/StartStop"
      //     : "W/102c6b9cfab9/evcharger/41/StartStop";
      // this.mqttClient.publish(
      //   topic,
      //   JSON.stringify({ value: outputParams.current })
      // );
    }
  }

  private readWallboxParams(location: WallboxLocation): WallboxParams {
    return {
      mode:
        globals.wallboxChargeMode.get(location) ?? WallboxChargeMode.SunOnly,
      chargingPower: globals.wallboxPower.get(location) ?? -1,
      chargerStatus: globals.wallboxStatus.get(location) ?? -1,
      soc: globals.batterySOC,
      minSoc: globals.batteryMinSOC,
      batteryPower: globals.batteryPower,
      maxAmps: location == WallboxLocation.Inside ? 18 : 24,
    };
  }

  private pickWallbox(): WallboxLocation {
    const periodSecs = 15;
    if (Math.floor(Date.now() / (periodSecs * 1000)) % 2 == 1) {
      return WallboxLocation.Inside;
    } else {
      return WallboxLocation.Outside;
    }
  }

  private calcOutputParams(params: WallboxParams) {
    const TARGET_AMPS_MIN = 7;
    const TARGET_AMPS_NORMAL = 12;

    const mode = params.mode;
    const chargingPower = params.chargingPower;
    const chargerStatus = params.chargerStatus;
    const soc = params.soc;
    const minSoc = params.minSoc;
    const batteryPower = params.batteryPower;
    const targetAmpsMax = params.maxAmps || 18;
    const hours = Temporal.Now.plainDateTimeISO().hour;
    const evening = hours < 8 || hours >= 22;

    function powerToAmps(power: number) {
      return Math.min(targetAmpsMax, Math.round(power / 240));
    }

    function calcAmpsWhenDayOnly() {
      if (soc < minSoc + 5) {
        return 0;
      }
      let targetBatteryCharge = 0;
      if (soc > 95) {
        targetBatteryCharge = -2000;
      }
      const targetPower = chargingPower + batteryPower - targetBatteryCharge;
      return powerToAmps(targetPower);
    }

    // targetAmps < 7 -> turned off, 7..18 -> charges at this current
    function generateOutput(
      targetAmps: number | undefined,
      chargingAmps: number,
      chargerStatus: number
    ): OutputParams {
      const result: OutputParams = {
        current: undefined,
        startStop: undefined,
      };

      if (targetAmps == undefined || targetAmps == chargingAmps) return result;

      let newStartStop;
      let newCurrent;

      if (targetAmps < TARGET_AMPS_MIN) {
        // turn off
        if (chargingAmps > 0) {
          // stop
          newStartStop = 0;
          // set min current
          newCurrent = TARGET_AMPS_MIN;
        }
      } else {
        // status: Connected, Waiting for start
        if ((chargerStatus == 1 || chargerStatus == 6) && targetAmps >= 8) {
          // start
          newStartStop = 1;
          newCurrent = TARGET_AMPS_NORMAL;
        }

        // adjust current
        newCurrent = targetAmps;
      }

      result.current = newCurrent;
      result.startStop = newStartStop;

      return result;
    }

    let targetAmps = undefined;

    if (Object.values(WallboxChargeMode).includes(mode)) {
      if (mode == WallboxChargeMode.Off) {
        targetAmps = 0;
        // on
      } else if (mode == WallboxChargeMode.On) {
        targetAmps = TARGET_AMPS_NORMAL;
      } else {
        if (!evening) {
          targetAmps = calcAmpsWhenDayOnly();
        } else {
          if (mode == WallboxChargeMode.SunOnly) {
            targetAmps = 0;
          } else if (mode == WallboxChargeMode.ESSOnly) {
            const eveningSocMargin = 2 * ((24 + 8 - hours) % 24);
            if (soc > minSoc + eveningSocMargin) {
              targetAmps = TARGET_AMPS_NORMAL;
            } else {
              targetAmps = 0;
            }
          } else if (mode == WallboxChargeMode.Night) {
            targetAmps = TARGET_AMPS_NORMAL;
          }
        }
      }
    }

    return generateOutput(
      targetAmps,
      powerToAmps(chargingPower),
      chargerStatus
    );
  }
}

interface WallboxParams {
  mode: WallboxChargeMode;
  chargingPower: number;
  chargerStatus: number;
  soc: number;
  minSoc: number;
  batteryPower: number;
  maxAmps: number;
}

interface OutputParams {
  current: number | undefined;
  startStop: number | undefined;
}
