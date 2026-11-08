import { installProcessErrorHandlers } from "./process-handlers.ts";
import { Temporal } from "./temporal.ts";
import { MqttClient } from "./mqtt-client.ts";
import { logError, logInfo } from "./logger.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { HttpServer } from "./http-server.ts";
import { CONTROL_PATHS } from "./device-topics.ts";
import { DeviceTelemetry } from "./device-telemetry.ts";
import { systemClock } from "./lisbon-clock.ts";
import {
  POWER_CONTROL_ENABLED,
  FORECAST_SOLAR_API_KEY,
  VICTRON_API_KEY,
  VICTRON_INSTALLATION_ID,
} from "./constants.ts";
import { SolarForecasts } from "./solar-forecasts/solar-forecasts.ts";
import { LoadOmieTask } from "./tasks/load-omie-task.ts";
import { scheduler } from "./task-scheduler.ts";
import { SetSocLimitTask } from "./tasks/set-soc-limit-task.ts";
import { globals, events, WallboxLocation } from "./globals.ts";
import { flushPersistentStorage } from "./persistent-storage.ts";
import { AutomaticChargingCycle } from "./power-controller/automatic-charging-cycle.ts";
import { DYNAMIC_POWER_INTERVAL } from "./power-controller/power-constants.ts";
import { setupWallSwitchHandler } from "./charge-mode/wall-switch-handler.ts";
import { restorePersistedChargeSettings } from "./charge-mode/charge-mode-switcher.ts";
import { getVehicleSoc, loadVehicleSoc } from "./bmw-cardata/bmw-cardata.ts";
import { METRICS } from "./prometheus/metrics.ts";

const AWAKE_MQTT_INTERVAL = Temporal.Duration.from({ seconds: 30 });

class HomeAutomationApp {
  private mqttClient: MqttClient;
  private metrics: PrometheusMetrics;
  private httpServer: HttpServer;
  private chargingCycle: AutomaticChargingCycle;
  private forecasts: SolarForecasts;
  private telemetry: DeviceTelemetry;

  constructor() {
    this.metrics = new PrometheusMetrics();
    this.telemetry = new DeviceTelemetry({
      clock: systemClock,
      metrics: this.metrics,
      currentUpdated: (location, value) => {
        const event =
          location === WallboxLocation.Inside
            ? events.wallboxCurrentInsideUpdated
            : events.wallboxCurrentOutsideUpdated;
        void event.emit(value);
      },
      wallSwitchUpdated: (payload) => events.wallSwitchUpdated.emit(payload),
    });
    this.mqttClient = new MqttClient(this.metrics, () =>
      this.telemetry.invalidate(),
    );
    this.chargingCycle = new AutomaticChargingCycle({
      telemetry: () => this.telemetry.snapshot(),
      modes: () => globals.wallboxChargeMode,
      preference: () => globals.preferredWallboxLocation,
      insideVehicleSoc: getVehicleSoc,
      clock: systemClock,
      publisher: this.mqttClient,
      enabled: POWER_CONTROL_ENABLED,
    });
    this.forecasts = new SolarForecasts({
      forecastSolarApiKey: FORECAST_SOLAR_API_KEY,
      victronApiKey: VICTRON_API_KEY,
      victronInstallationId: VICTRON_INSTALLATION_ID,
      fetch,
      clock: systemClock,
      metrics: this.metrics,
      logError,
    });
    this.httpServer = new HttpServer(
      this.metrics,
      () => this.chargingCycle.getBatteryDischargeStatus(),
      (at) => this.forecasts.display(at),
      this.telemetry,
    );
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
      await this.httpServer.start();

      setupWallSwitchHandler(this.mqttClient, this.metrics);
      await this.telemetry.subscribe(this.mqttClient);
      this.setupScheduledTasks();

      await logInfo("✅ Home Automation System started successfully");
      this.setupGracefulShutdown();
    } catch (error) {
      await logError(
        `❌ Failed to start Home Automation System: ${String(error)}`,
      );
      process.exit(1);
    }
  }

  private setupScheduledTasks() {
    const { BMW_CARDATA_CLIENT_ID, BMW_CARDATA_VIN, BMW_CARDATA_CONTAINER_ID } =
      process.env;
    const bmwClientId = BMW_CARDATA_CLIENT_ID?.trim();
    const bmwVin = BMW_CARDATA_VIN?.trim();
    const bmwContainerId = BMW_CARDATA_CONTAINER_ID?.trim();
    if (bmwClientId && bmwVin && bmwContainerId) {
      let loadingBmwSoc = false;
      scheduler.cron("Load BMW i3 SOC", "5,35 * * * *", async () => {
        if (loadingBmwSoc) return;
        loadingBmwSoc = true;
        try {
          const value = await loadVehicleSoc(
            bmwClientId,
            bmwVin,
            bmwContainerId,
          );
          if (value) {
            this.metrics.setGauge(METRICS.GAUGES.BMW_I3_SOC, value.percent);
            this.metrics.setGauge(
              METRICS.GAUGES.BMW_I3_SOC_TIMESTAMP,
              value.observedAt.epochMilliseconds / 1000,
            );
          }
        } finally {
          loadingBmwSoc = false;
        }
      });
      void scheduler.triggerTask("Load BMW i3 SOC");
    }

    scheduler.interval("Awake MQTT", AWAKE_MQTT_INTERVAL, () => {
      return this.telemetry.refresh(this.mqttClient);
    });

    scheduler.interval("Dynamic power", DYNAMIC_POWER_INTERVAL, () => {
      return this.chargingCycle.tick();
    });

    scheduler.cron("Load forecast solar", "0 * * * *", () => {
      return this.forecasts.refresh();
    });

    void this.forecasts.refresh().catch((error) => {
      logError(`Error refreshing solar forecasts: ${error}`);
    });

    const loadOmieTask = new LoadOmieTask(this.metrics);
    scheduler.cron("Load omie", "0 * * * *", () => {
      return loadOmieTask.execute();
    });

    const setSocLimitTask = new SetSocLimitTask(
      this.mqttClient,
      systemClock,
      () => this.telemetry.value(CONTROL_PATHS.batterySOC),
      (date, at) => this.forecasts.forMinimumSoc(date, at),
    );
    scheduler.cron("Setup Min SOC", "* * * * *", () => setSocLimitTask.tick());
  }

  private async loadPersistedSettings(): Promise<void> {
    try {
      await restorePersistedChargeSettings(this.metrics);
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
        process.exit(0);
      } catch (error) {
        await logError(`❌ Error during shutdown: ${String(error)}`);
        process.exit(1);
      }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

// Log uncaught exceptions and unhandled rejections
process.on("SIGUSR1", async () => {
  await logError("Received SIGUSR1 - possible manual or system stop.");
});
process.on("SIGUSR2", async () => {
  await logError("Received SIGUSR2 - possible manual or system stop.");
});

installProcessErrorHandlers();

const app = new HomeAutomationApp();
await app.start();
