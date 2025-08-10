import mqtt from "mqtt";
import type { MqttClient as MqttClientType } from "mqtt";
import { MQTT_BROKER_URL, MQTT_USERNAME, MQTT_PASSWORD, MQTT_CLIENT_ID } from "./constants.ts";

export class MqttClient {
  private client: MqttClientType | null = null;
  private isConnected = false;

  async connect(): Promise<void> {
    console.log(`🔌 Connecting to MQTT broker: ${MQTT_BROKER_URL}`);

    return new Promise((resolve, reject) => {
      try {
        this.client = mqtt.connect(MQTT_BROKER_URL, {
          clientId: MQTT_CLIENT_ID,
          username: MQTT_USERNAME,
          password: MQTT_PASSWORD,
          reconnectPeriod: 5000,
          connectTimeout: 30000,
        });

        this.client.on("connect", () => {
          console.log("✅ Connected to MQTT broker");
          this.isConnected = true;
          resolve();
        });

        this.client.on("error", (error) => {
          console.error("❌ MQTT connection error:", error);
          reject(error);
        });

        this.client.on("offline", () => {
          console.warn("⚠️ MQTT client offline");
          this.isConnected = false;
        });

        this.client.on("reconnect", () => {
          console.log("🔄 Reconnecting to MQTT broker...");
        });

        this.client.on("message", (topic, message) => {
          this.handleMessage(topic, message.toString());
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      return new Promise((resolve) => {
        this.client!.end(false, {}, () => {
          console.log("📤 Disconnected from MQTT broker");
          this.isConnected = false;
          resolve();
        });
      });
    }
  }

  async subscribe(topic: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error("MQTT client not connected");
    }

    return new Promise((resolve, reject) => {
      this.client!.subscribe(topic, (error) => {
        if (error) {
          console.error(`❌ Failed to subscribe to ${topic}:`, error);
          reject(error);
        } else {
          console.log(`📥 Subscribed to topic: ${topic}`);
          resolve();
        }
      });
    });
  }

  async publish(topic: string, message: string, retain = false, log = false): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error("MQTT client not connected");
    }

    return new Promise((resolve, reject) => {
      this.client!.publish(topic, message, { retain }, (error) => {
        if (error) {
          console.error(`❌ Failed to publish to ${topic}:`, error);
          reject(error);
        } else {
          if (log) {
            console.log(`📤 Published to ${topic}: ${message}`);
          }
          resolve();
        }
      });
    });
  }

  private handleMessage(topic: string, message: string): void {
    console.log(`📨 Received message on ${topic}: ${message}`);
    
    try {
      const data = JSON.parse(message);
      this.processMessage(topic, data);
    } catch {
      this.processMessage(topic, message);
    }
  }

  private processMessage(topic: string, data: unknown): void {
    console.log(`🔄 Processing message from ${topic}:`, data);
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  async publishJson(topic: string, data: Record<string, unknown>, retain = false): Promise<void> {
    const message = JSON.stringify(data);
    await this.publish(topic, message, retain);
  }
}