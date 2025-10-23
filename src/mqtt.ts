import mqtt from "mqtt";
import type { MqttClient as MqttClientType } from "mqtt";
import {
  MQTT_BROKER_URL,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_CLIENT_ID,
} from "./constants.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";

export class MqttClient {
  private client: MqttClientType | null = null;
  private isConnected = false;
  private topicHandlers = new Map<
    string,
    (topic: string, data: unknown) => void
  >();
  private metrics: PrometheusMetrics;

  constructor(metrics: PrometheusMetrics) {
    this.metrics = metrics;
  }

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
          this.metrics.recordMqttConnection(true);
          resolve();
        });

        this.client.on("error", (error) => {
          console.error("❌ MQTT connection error:", error);
          reject(error);
        });

        this.client.on("offline", () => {
          console.warn("⚠️ MQTT client offline");
          this.isConnected = false;
          this.metrics.recordMqttConnection(false);
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

  async publish(
    topic: string,
    message: string,
    retain = false,
    log = false
  ): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error("MQTT client not connected");
    }

    return new Promise((resolve, reject) => {
      this.client!.publish(topic, message, { retain }, (error) => {
        if (error) {
          console.error(`❌ Failed to publish to ${topic}:`, error);
          reject(error);
        } else {
          this.metrics.recordMqttMessage("sent");
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
    // Check for exact topic match first
    const exactHandler = this.topicHandlers.get(topic);
    if (exactHandler) {
      this.metrics.recordMqttMessage("received");
      exactHandler(topic, data);
      return;
    }

    // Check for wildcard matches
    for (const [pattern, handler] of this.topicHandlers) {
      if (this.matchesTopic(pattern, topic)) {
        this.metrics.recordMqttMessage("received");
        handler(topic, data);
        return;
      }
    }

    // Default behavior if no handler found
    console.log(`🔄 No handler for topic ${topic}:`, data);
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  async publishJson(
    topic: string,
    data: Record<string, unknown>,
    retain = false
  ): Promise<void> {
    const message = JSON.stringify(data);
    await this.publish(topic, message, retain);
  }

  /**
   * Add a handler for a specific topic or topic pattern
   * @param topicPattern - Topic string or pattern with wildcards (+ for single level, # for multi-level)
   * @param handler - Function to handle messages for this topic
   */
  addTopicHandler(
    topicPattern: string,
    handler: (topic: string, data: unknown) => void
  ): void {
    this.topicHandlers.set(topicPattern, handler);
    console.log(`📋 Added handler for topic pattern: ${topicPattern}`);
  }

  /**
   * Remove a handler for a specific topic pattern
   * @param topicPattern - Topic pattern to remove handler for
   */
  removeTopicHandler(topicPattern: string): boolean {
    const removed = this.topicHandlers.delete(topicPattern);
    if (removed) {
      console.log(`🗑️ Removed handler for topic pattern: ${topicPattern}`);
    }
    return removed;
  }

  /**
   * Subscribe to a topic and add a handler in one call
   * @param topic - Topic to subscribe to
   * @param handler - Handler function
   */
  async subscribeWithHandler(
    topic: string,
    handler: (topic: string, data: unknown) => void
  ): Promise<void> {
    this.addTopicHandler(topic, handler);
    await this.subscribe(topic);
  }

  /**
   * Check if a topic pattern matches an actual topic
   * Supports MQTT wildcards: + (single level) and # (multi-level)
   */
  private matchesTopic(pattern: string, topic: string): boolean {
    // Convert MQTT wildcards to regex
    const regexPattern = pattern
      .replace(/\+/g, "[^/]+") // + matches any single level
      .replace(/\#/g, ".*"); // # matches any number of levels

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(topic);
  }
}
