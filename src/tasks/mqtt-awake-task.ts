import { randomInt } from "node:crypto";
import { MqttClient } from "../mqtt-client.ts";

export class MqttAwakeTask {
  private mqttClient: MqttClient;
  private readonly topic = "R/102c6b9cfab9/system/0/Serial";

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;

    this.execute();
  }

  public async execute(): Promise<void> {
    await this.mqttClient.publish(this.topic, randomInt(10000000).toString());
  }
}
