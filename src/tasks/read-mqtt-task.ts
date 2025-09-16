import { globals } from "../globals.ts";
import { MqttClient } from "../mqtt.ts";

export class ReadMqttTask {
  private mqttClient: MqttClient;

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;
  }

  subscribeTopics(): void {
    this.mqttClient.subscribeWithHandler(
      "N/102c6b9cfab9/system/0/Batteries",
      (_, data) => {
        const batteryData = data as { value: Array<{ soc: number }> };
        globals.batterySOC = batteryData.value[0]!.soc;
      }
    );
  }
}
