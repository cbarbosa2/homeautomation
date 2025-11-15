import { POWER_CONTROL_ENABLED } from "../constants.ts";
import { logInfo } from "../logger.ts";
import { MqttClient } from "../mqtt-client.ts";
import { PowerCommand } from "./command-builder.ts";

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
    case "InsideAmps":
      return `${BASE}evcharger/40/SetCurrent`;
    case "OutsideAmps":
      return `${BASE}evcharger/41/SetCurrent`;
    case "InsideStartStop":
      return `${BASE}evcharger/40/StartStop`;
    case "OutsideStartStop":
      return `${BASE}evcharger/41/StartStop`;
    case "BatteryMaxChargePower":
      return `${BASE}settings/0/Settings/CGwacs/MaxChargePower`;
    default:
      return undefined;
  }
}
