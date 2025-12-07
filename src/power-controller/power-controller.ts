import { POWER_CONTROL_ENABLED } from "../constants.ts";
import { logInfo } from "../logger.ts";
import { MqttClient } from "../mqtt-client.ts";

export enum CommandType {
  InsideCurrent = "InsideCurrent",
  InsideStartStop = "InsideStartStop",
  OutsideCurrent = "OutsideCurrent",
  OutsideStartStop = "OutsideStartStop",
  BatteryMaxChargePower = "BatteryMaxChargePower",
}

export interface PowerCommand {
  type: CommandType;
  value: number;
}

/**
 * PowerController executes power control commands by publishing MQTT messages to Victron devices.
 *
 * This module translates PowerCommand objects into MQTT topics and messages that control:
 * - Wallbox charging current (amps) for inside and outside locations
 * - Wallbox start/stop commands to enable/disable charging
 * - Battery maximum charge power settings
 *
 * Commands can be simulated (logged without execution) when POWER_CONTROL_ENABLED is false,
 * useful for testing and development without affecting actual hardware.
 */
export function runCommands(commands: PowerCommand[], mqttClient: MqttClient) {
  for (const command of commands) {
    const topic = getTopic(command);
    if (topic && POWER_CONTROL_ENABLED) {
      logInfo("Running command: " + JSON.stringify(command));
      mqttClient.publishJson(topic, { value: command.value });
    } else {
      logInfo("Simulating (disabled) command: " + JSON.stringify(command));
    }
  }
}

function getTopic(command: PowerCommand): string | undefined {
  const BASE = "W/102c6b9cfab9/";
  switch (command.type) {
    case CommandType.InsideCurrent:
      return `${BASE}evcharger/40/SetCurrent`;
    case CommandType.OutsideCurrent:
      return `${BASE}evcharger/41/SetCurrent`;
    case CommandType.InsideStartStop:
      return `${BASE}evcharger/40/StartStop`;
    case CommandType.OutsideStartStop:
      return `${BASE}evcharger/41/StartStop`;
    case CommandType.BatteryMaxChargePower:
      return `${BASE}settings/0/Settings/CGwacs/MaxChargePower`;
    default:
      return undefined;
  }
}
