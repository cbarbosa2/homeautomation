import { MqttClient } from "./mqtt.ts";
import { HttpClient } from "./http.ts";
import { PrometheusMetrics, METRICS } from "./prometheus.ts";
import { MqttAwake } from "./tasks/mqttAwake.ts";

class HomeAutomationApp {
  private mqttClient: MqttClient;
  private httpClient: HttpClient;
  private metrics: PrometheusMetrics;
  private mqttAwake: MqttAwake;
  private isRunning = false;

  constructor() {
    this.mqttClient = new MqttClient();
    this.httpClient = new HttpClient();
    this.metrics = new PrometheusMetrics();
    this.mqttAwake = new MqttAwake(this.mqttClient);
  }

  async start(): Promise<void> {
    try {
      console.log("🏠 Starting Home Automation System...");
      
      await this.mqttClient.connect();
      await this.metrics.start();

      this.isRunning = true;
      console.log("✅ Home Automation System started successfully");
      
      this.mqttAwake.start();
      this.setupGracefulShutdown();
      await this.runMainLoop();
      
    } catch (error) {
      console.error("❌ Failed to start Home Automation System:", error);
      Deno.exit(1);
    }
  }

  private async runMainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.processAutomationTasks();
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        console.error("Error in main loop:", error);
        this.metrics.incrementErrorCounter("main_loop_error");
      }
    }
  }

  private processAutomationTasks(): void {
    this.metrics.incrementCounter(METRICS.COUNTERS.AUTOMATION_CYCLES);
  }

  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      console.log("🛑 Shutting down Home Automation System...");
      this.isRunning = false;
      
      // Stop MQTT awake service
      this.mqttAwake.stop();
      
      try {
        await this.mqttClient.disconnect();
        await this.metrics.stop();
        console.log("✅ Shutdown complete");
        Deno.exit(0);
      } catch (error) {
        console.error("❌ Error during shutdown:", error);
        Deno.exit(1);
      }
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);
  }
}

if (import.meta.main) {
  const app = new HomeAutomationApp();
  await app.start();
}