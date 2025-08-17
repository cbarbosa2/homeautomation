import { MqttClient } from "../mqtt.ts";

export class MqttAwakeTask {
  private mqttClient: MqttClient;
  private awakeInterval: number | null = null;
  private readonly topic = "R/102c6b9cfab9/system/0/Serial";
  private readonly intervalMs = 30000; // 30 seconds

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;
  }

  start(): void {
    this.awakeInterval = setInterval(() => {
      this.sendAwakeMessage();
    }, this.intervalMs);
    
    // Send initial message immediately
    this.sendAwakeMessage();
  }

  stop(): void {
    if (this.awakeInterval) {
      clearInterval(this.awakeInterval);
      this.awakeInterval = null;
    }
  }

  private async sendAwakeMessage(): Promise<void> {
      await this.mqttClient.publish(this.topic, "1234567890");
  }
}