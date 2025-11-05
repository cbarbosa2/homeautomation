import { MqttClient } from "./mqtt-client.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { HttpServer } from "./http-server.ts";
import { Temporal } from "./temporal.ts";
import { MqttAwakeTask } from "./tasks/mqtt-awake-task.ts";
import { LoadForecastTask } from "./tasks/load-forecast-task.ts";
import { LoadOmieTask } from "./tasks/load-omie-task.ts";
import { scheduler } from "./task-scheduler.ts";
import { MqttToPrometheusTask } from "./tasks/mqtt-to-prometheus-task.ts";
import { SetSocLimitTask } from "./tasks/set-soc-limit-task.ts";
import { SetBatteryChargePowerTask } from "./tasks/set-battery-charge-power-task.ts";
import { ChargeModeSwitcher } from "./tasks/charge-mode-switcher.ts";
import {
  calculateTargetAmpsAndPriority,
} from "./tasks/dynamic-power-handler.ts";
import { globals, WallboxChargeMode, WallboxLocation } from "./globals.ts";

class HomeAutomationApp {
  private mqttClient: MqttClient;
  private metrics: PrometheusMetrics;
  private httpServer: HttpServer;

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

      this.setupScheduledTasks();

      new ChargeModeSwitcher(this.metrics).setupHandlers();

      console.log("✅ Home Automation System started successfully");
      this.setupGracefulShutdown();
    } catch (error) {
      console.error("❌ Failed to start Home Automation System:", error);
      Deno.exit(1);
    }
  }

  private setupScheduledTasks() {
    const mqttAwakeTask = new MqttAwakeTask(this.mqttClient);
    scheduler.interval("Awake MQTT", 30, () => {
      mqttAwakeTask.execute();
    });

    // const dynamicPowerHandler = new DynamicPowerHandler(this.mqttClient);
    scheduler.interval("Dynamic power", 5, () => {
      // dynamicPowerHandler.execute();
      const result = calculateTargetAmpsAndPriority(
        {
          ...globals,
          hourOfDay: Temporal.Now.plainDateTimeISO().hour,
          wallboxChargeMode: new Map([
            [WallboxLocation.Inside, WallboxChargeMode.Night],
            [WallboxLocation.Outside, WallboxChargeMode.Manual],
          ]),
        }
      );
      globals.primaryWallboxLocation =
        result.newPrimaryWallboxLocation ?? globals.primaryWallboxLocation;
      console.log(`Dynamic power ${JSON.stringify(result)}`);
    });

    const loadForecastTask = new LoadForecastTask(this.metrics);
    scheduler.cron(
      "Load forecast solar",
      "0 * * * *",
      loadForecastTask.execute
    );

    const loadOmieTask = new LoadOmieTask(this.metrics);
    scheduler.cron("Load omie", "0 * * * *", () => {
      loadOmieTask.execute();
    });

    const readMqttTask = new MqttToPrometheusTask(
      this.mqttClient,
      this.metrics
    );
    readMqttTask.subscribeTopics();

    const setSocLimitTask = new SetSocLimitTask(this.mqttClient);
    scheduler.cron("Set SOC limit in morning", "0 8 * * *", () => {
      setSocLimitTask.executeInMorning();
    });
    scheduler.cron("Set SOC limit in evening", "1 22 * * *", () => {
      setSocLimitTask.executeInEvening();
    });

    const setBatteryChargePowerTask = new SetBatteryChargePowerTask(
      this.mqttClient
    );
    scheduler.cron("Set Battery Charge Power in morning", "0 8 * * *", () => {
      setBatteryChargePowerTask.executeInMorning();
    });
    scheduler.cron(
      "Set Battery Charge Power in early evening",
      "0 22 * * *",
      () => {
        setBatteryChargePowerTask.executeInEarlyEvening();
      }
    );
    scheduler.cron(
      "Set Battery Charge Power in late evening",
      "0 3 * * *",
      () => {
        setBatteryChargePowerTask.executeInLateEvening();
      }
    );
  }

  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      console.log("🛑 Shutting down Home Automation System...");

      try {
        scheduler.terminateAll();
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
