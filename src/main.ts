import { Temporal } from "./temporal.ts";
import { MqttClient } from "./mqtt-client.ts";
import { logError, logInfo } from "./logger.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { HttpServer } from "./http-server.ts";
import { controlTelemetry } from "./control-telemetry.ts";
import { systemClock } from "./lisbon-clock.ts";
import { POWER_CONTROL_ENABLED } from "./constants.ts";
import { MqttAwakeTask } from "./tasks/mqtt-awake-task.ts";
import { LoadForecastTask } from "./tasks/load-forecast-task.ts";
import { LoadOmieTask } from "./tasks/load-omie-task.ts";
import { scheduler } from "./task-scheduler.ts";
import { MqttToPrometheusTask } from "./tasks/mqtt-to-prometheus-task.ts";
import { SetSocLimitTask } from "./tasks/set-soc-limit-task.ts";
import { globals, WallboxLocation } from "./globals.ts";
import {
  flushPersistentStorage,
  loadPersistentStorage,
} from "./persistent-storage.ts";
import { AutomaticChargingCycle } from "./power-controller/automatic-charging-cycle.ts";
import { DYNAMIC_POWER_INTERVAL } from "./power-controller/power-constants.ts";
import { setupWallSwitchHandler } from "./charge-mode/wall-switch-handler.ts";
import { setChargeMode } from "./charge-mode/charge-mode-switcher.ts";

const AWAKE_MQTT_INTERVAL = Temporal.Duration.from({ seconds: 30 });

class HomeAutomationApp {
  private mqttClient: MqttClient;
  private metrics: PrometheusMetrics;
  private httpServer: HttpServer;

  constructor() {
    this.metrics = new PrometheusMetrics();
    this.mqttClient = new MqttClient(this.metrics);
    this.httpServer = new HttpServer(this.metrics);
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

      await this.loadPersistedSettings();
      await this.mqttClient.connect();
      this.httpServer.start();

      this.setupScheduledTasks();

      setupWallSwitchHandler(this.mqttClient, this.metrics);

      await logInfo("✅ Home Automation System started successfully");
      this.setupGracefulShutdown();
    } catch (error) {
      await logError(
        `❌ Failed to start Home Automation System: ${String(error)}`,
      );
      Deno.exit(1);
    }
  }

  private setupScheduledTasks() {
    const readMqttTask = new MqttToPrometheusTask(
      this.mqttClient,
      this.metrics,
    );
    readMqttTask.subscribeTopics();

    const mqttAwakeTask = new MqttAwakeTask(this.mqttClient);
    scheduler.interval("Awake MQTT", AWAKE_MQTT_INTERVAL, () => {
      return mqttAwakeTask.execute();
    });

    const chargingCycle = new AutomaticChargingCycle({
      telemetry: () => controlTelemetry.snapshot(),
      modes: () => globals.wallboxChargeMode,
      clock: systemClock,
      publisher: this.mqttClient,
      enabled: POWER_CONTROL_ENABLED,
    });
    scheduler.interval("Dynamic power", DYNAMIC_POWER_INTERVAL, () => {
      return chargingCycle.tick();
    });

    const loadForecastTask = new LoadForecastTask(this.metrics);
    scheduler.cron("Load forecast solar", "0 * * * *", () => {
      return loadForecastTask.execute();
    });

    const loadOmieTask = new LoadOmieTask(this.metrics);
    scheduler.cron("Load omie", "0 * * * *", () => {
      return loadOmieTask.execute();
    });

    const setSocLimitTask = new SetSocLimitTask(this.mqttClient);
    scheduler.cron(
      "Lisbon SOC schedule",
      "* * * * *",
      () => setSocLimitTask.tick(),
    );
  }

  private async loadPersistedSettings(): Promise<void> {
    try {
      const data = await loadPersistentStorage();
      if (data.inside != undefined) {
        await setChargeMode(
          this.metrics,
          WallboxLocation.Inside,
          data.inside,
          false,
        );
      }
      if (data.outside != undefined) {
        await setChargeMode(
          this.metrics,
          WallboxLocation.Outside,
          data.outside,
          false,
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
        await flushPersistentStorage();
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

const app = new HomeAutomationApp();
await app.start();
