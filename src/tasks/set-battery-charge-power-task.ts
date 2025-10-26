import { MqttClient } from "../mqtt-client.ts";

export class SetBatteryChargePowerTask {
  private mqttClient: MqttClient;
  private readonly topic =
    "W/102c6b9cfab9/settings/0/Settings/CGwacs/MaxChargePower";

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;
  }

  public executeInEarlyEvening(): Promise<void> {
    return this.publishValue(500);
  }

  public executeInLateEvening(): Promise<void> {
    return this.publishValue(2000);
  }

  public executeInMorning(): Promise<void> {
    return this.publishValue(2000);
  }

  private async publishValue(value: number): Promise<void> {
    await this.mqttClient.publish(this.topic, JSON.stringify({ value: value }));
  }
}
