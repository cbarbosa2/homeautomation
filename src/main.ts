import { MqttClient } from "./mqtt-client.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { HttpServer } from "./http-server.ts";
import { MqttAwakeTask } from "./tasks/mqtt-awake-task.ts";
import { LoadForecastTask } from "./tasks/load-forecast-task.ts";
import { LoadOmieTask } from "./tasks/load-omie-task.ts";
import { scheduler } from "./task-scheduler.ts";
import { MqttToPrometheusTask } from "./tasks/mqtt-to-prometheus-task.ts";
import { SetSocLimitTask } from "./tasks/set-soc-limit-task.ts";

class HomeAutomationApp {
  private mqttClient: MqttClient;
  private metrics: PrometheusMetrics;
  private httpServer: HttpServer;
  private isRunning = false;

  constructor() {
    this.metrics = new PrometheusMetrics();
    this.mqttClient = new MqttClient(this.metrics);
    this.httpServer = new HttpServer(this.metrics.getRegister());
  }

  async start(): Promise<void> {
    try {
      console.log("🏠 Starting Home Automation System...");

      await this.mqttClient.connect();
      this.httpServer.start();

      const mqttAwakeTask = new MqttAwakeTask(this.mqttClient);
      scheduler.interval("Awake MQTT", 30, () => {
        mqttAwakeTask.execute();
      });

      const loadForecastTask = new LoadForecastTask(this.metrics);
      scheduler.cron(
        "Load forecast solar",
        "0 * * * *",
        loadForecastTask.execute
      );

      const loadOmieTask = new LoadOmieTask(this.metrics);
      scheduler.cron("Load omie", "0 * * * *", loadOmieTask.execute);

      const readMqttTask = new MqttToPrometheusTask(
        this.mqttClient,
        this.metrics
      );
      readMqttTask.subscribeTopics();

      const setSocLimitTask = new SetSocLimitTask(this.mqttClient);
      scheduler.cron(
        "Set SOC limit in morning",
        "0 8 * * *",
        setSocLimitTask.executeInMorning
      );
      scheduler.cron(
        "Set SOC limit in evening",
        "1 22 * * *",
        setSocLimitTask.executeInEvening
      );

      this.isRunning = true;
      console.log("✅ Home Automation System started successfully");
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
    this.metrics.incrementCounter("AUTOMATION_CYCLES");
  }

  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      console.log("🛑 Shutting down Home Automation System...");
      this.isRunning = false;

      try {
        await this.mqttClient.disconnect();
        await this.httpServer.stop();
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
