import { MqttClient } from "./mqtt-client.ts";
import { logInfo, logError } from "./logger.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { HttpServer } from "./http-server.ts";
import { Temporal } from "./temporal.ts";
import { MqttAwakeTask } from "./tasks/mqtt-awake-task.ts";
import { LoadForecastTask } from "./tasks/load-forecast-task.ts";
import { LoadOmieTask } from "./tasks/load-omie-task.ts";
import { scheduler } from "./task-scheduler.ts";
import { MqttToPrometheusTask } from "./tasks/mqtt-to-prometheus-task.ts";
import { SetSocLimitTask } from "./tasks/set-soc-limit-task.ts";
import { ChargeModeSwitcher } from "./tasks/charge-mode-switcher.ts";
import { calculateTargetAmpsAndPriority } from "./tasks/dynamic-power-calculator.ts";
import { globals, WallboxLocation } from "./globals.ts";
import { PowerController } from "./tasks/power-controller.ts";
import { loadPersistentStorage } from "./persistent-storage.ts";

const AWAKE_MQTT_INTERVAL_SECONDS = 30;
const DYNAMIC_POWER_INTERVAL_SECONDS = 5;

class HomeAutomationApp {
  private mqttClient: MqttClient;
  private metrics: PrometheusMetrics;
  private httpServer: HttpServer;

  constructor() {
    this.metrics = new PrometheusMetrics();
    this.mqttClient = new MqttClient(this.metrics);
    this.httpServer = new HttpServer(this.metrics);
    this.loadPersistedSettings();
  }

  async start(): Promise<void> {
    try {
      await logInfo(`
    __  ______  __  _________   ___   __  ____________  __  ______  ______________  _   __
   / / / / __ \\/  |/  / ____/  /   | / / / /_  __/ __ \\/  |/  /   |/_  __/  _/ __ \\/ | / /
  / /_/ / / / / /|_/ / __/    / /| |/ / / / / / / / / / /|_/ / /| | / /  / // / / /  |/ / 
 / __  / /_/ / /  / / /___   / ___ / /_/ / / / / /_/ / /  / / ___ |/ / _/ // /_/ / /|  /  
/_/ /_/\\____/_/  /_/_____/  /_/  |_\\____/ /_/  \\____/_/  /_/_/  |_/_/ /___/\\____/_/ |_/   
`);

      await this.mqttClient.connect();
      this.httpServer.start();

      this.setupScheduledTasks();

      new ChargeModeSwitcher(this.metrics).setupHandlers();

      await logInfo("✅ Home Automation System started successfully");
      this.setupGracefulShutdown();
    } catch (error) {
      await logError(
        `❌ Failed to start Home Automation System: ${String(error)}`
      );
      Deno.exit(1);
    }
  }

  private setupScheduledTasks() {
    const mqttAwakeTask = new MqttAwakeTask(this.mqttClient);
    scheduler.interval("Awake MQTT", AWAKE_MQTT_INTERVAL_SECONDS, () => {
      mqttAwakeTask.execute();
    });

    const powerPublisher = new PowerController(this.mqttClient);
    scheduler.interval("Dynamic power", DYNAMIC_POWER_INTERVAL_SECONDS, () => {
      const inputState = {
        ...globals,
        hourOfDay: Temporal.Now.plainDateTimeISO().hour,
      };

      const result = calculateTargetAmpsAndPriority(inputState);

      globals.primaryWallboxLocation =
        result.newPrimaryWallboxLocation ?? globals.primaryWallboxLocation;

      powerPublisher.applyPowerSettings(globals, result);
    });

    const loadForecastTask = new LoadForecastTask(this.metrics);
    scheduler.cron("Load forecast solar", "0 * * * *", () => {
      loadForecastTask.execute();
    });

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
  }

  private async loadPersistedSettings(): Promise<void> {
    try {
      const data = await loadPersistentStorage();
      if (data.inside != undefined) {
        new ChargeModeSwitcher(this.metrics).setChargeMode(
          WallboxLocation.Inside,
          data.inside,
          false
        );
      }
      if (data.outside != undefined) {
        new ChargeModeSwitcher(this.metrics).setChargeMode(
          WallboxLocation.Outside,
          data.outside,
          false
        );
      }
      await logInfo("💾 Persistent storage loaded successfully");
    } catch (error) {
      await logError(`❌ Failed to load persistent storage: ${String(error)}`);
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      await logInfo("🛑 Shutting down Home Automation System...");

      try {
        scheduler.terminateAll();
        await this.mqttClient.disconnect();
        await this.httpServer.stop();
        await logInfo("✅ Shutdown complete");
        Deno.exit(0);
      } catch (error) {
        await logError(`❌ Error during shutdown: ${String(error)}`);
        Deno.exit(1);
      }
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);
  }
}

// Log uncaught exceptions and unhandled rejections
Deno.addSignalListener("SIGUSR1", async () => {
  await logError("Received SIGUSR1 - possible manual or system stop.");
});
Deno.addSignalListener("SIGUSR2", async () => {
  await logError("Received SIGUSR2 - possible manual or system stop.");
});

addEventListener("unhandledrejection", async (event) => {
  await logError(`Unhandled promise rejection: ${String(event.reason)}`);
});

addEventListener("error", async (event) => {
  await logError(`Uncaught exception: ${String(event.error)}`);
});

if (import.meta.main) {
  const app = new HomeAutomationApp();
  await app.start();
}
