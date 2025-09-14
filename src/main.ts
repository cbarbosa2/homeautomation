import { MqttClient } from "./mqtt.ts";
import { PrometheusMetrics, METRICS } from "./prometheus.ts";
import { MqttAwakeTask } from "./tasks/mqtt-awake-task.ts";
import { LoadForecastTask } from "./tasks/load-forecast-task.ts";
import { LoadOmieTask } from "./tasks/load-omie-task.ts";

class HomeAutomationApp {
  private mqttClient: MqttClient;
  private metrics: PrometheusMetrics;
  private mqttAwakeTask: MqttAwakeTask;
  private loadForecastTask: LoadForecastTask;
  private loadOmieTask: LoadOmieTask;
  private isRunning = false;

  constructor() {
    this.mqttClient = new MqttClient();
    this.metrics = new PrometheusMetrics();
    this.mqttAwakeTask = new MqttAwakeTask(this.mqttClient);
    this.loadForecastTask = new LoadForecastTask(this.metrics);
    this.loadOmieTask = new LoadOmieTask(this.metrics);
  }

  async start(): Promise<void> {
    try {
      console.log("🏠 Starting Home Automation System...");

      await this.mqttClient.connect();
      await this.metrics.start();

      this.isRunning = true;
      console.log("✅ Home Automation System started successfully");

      this.mqttAwakeTask.start();
      this.loadForecastTask.start();
      this.loadOmieTask.start();
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
        await new Promise((resolve) => setTimeout(resolve, 5000));
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

      try {
        // Stop tasks
        this.mqttAwakeTask.stop();
        this.loadForecastTask.stop();
        this.loadOmieTask.stop();

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
