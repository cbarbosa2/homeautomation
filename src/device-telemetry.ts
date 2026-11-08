import { BatteryCellTelemetry } from "./battery-cell-telemetry.ts";
import { ControlTelemetry } from "./control-telemetry.ts";
import { VICTRON_PORTAL_ID } from "./constants.ts";
import {
  DEVICE_TOPICS,
  EXPLICIT_READ_PATHS,
  SHELLY_TOPIC,
} from "./device-topics.ts";
import type { WallboxLocation } from "./globals.ts";
import type { Clock } from "./lisbon-clock.ts";
import type { MqttClient } from "./mqtt-client.ts";
import type { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { finite } from "./utils/index.ts";

export type WallSwitchNotification = {
  params: { events: { id: number; event: string }[] };
};

interface Dependencies {
  clock: Clock;
  metrics: Pick<PrometheusMetrics, "setGauge">;
  currentUpdated: (location: WallboxLocation, value: number) => void;
  wallSwitchUpdated: (payload: WallSwitchNotification) => void;
}

/** Owns notification interpretation and its independent control, history and gauge projections. */
export class DeviceTelemetry {
  private readonly control: ControlTelemetry;
  private readonly cells: BatteryCellTelemetry;

  constructor(private readonly dependencies: Dependencies) {
    this.control = new ControlTelemetry(dependencies.clock);
    this.cells = new BatteryCellTelemetry(dependencies.clock);
  }

  async subscribe(
    mqtt: Pick<MqttClient, "subscribeWithHandler">,
  ): Promise<void> {
    const subscriptions = DEVICE_TOPICS.map((definition) =>
      // Promise callbacks also capture synchronous adapter failures without abandoning other subscriptions.
      Promise.resolve().then(() =>
        mqtt.subscribeWithHandler(
          `N/${VICTRON_PORTAL_ID}/${definition.path}`,
          (_, payload) => {
            const value =
              payload !== null &&
              typeof payload === "object" &&
              "value" in payload
                ? payload.value
                : undefined;

            if (definition.control) this.control.record(definition.path, value);
            if (definition.cell) this.cells.record(definition.path, value);

            const numeric = finite(value) ? value : 0;
            if (definition.gauge)
              this.dependencies.metrics.setGauge(definition.gauge, numeric);
            if (definition.gesture !== undefined)
              this.dependencies.currentUpdated(definition.gesture, numeric);
          },
        ),
      ),
    );
    subscriptions.push(
      Promise.resolve().then(() =>
        mqtt.subscribeWithHandler(SHELLY_TOPIC, (_, payload) =>
          this.dependencies.wallSwitchUpdated(
            payload as WallSwitchNotification,
          ),
        ),
      ),
    );
    await Promise.all(subscriptions);
  }

  async refresh(mqtt: Pick<MqttClient, "publish">): Promise<void> {
    await mqtt.publish(`R/${VICTRON_PORTAL_ID}/keepalive`, "");
    for (const path of EXPLICIT_READ_PATHS) {
      await mqtt.publish(`R/${VICTRON_PORTAL_ID}/${path}`, "");
    }
  }

  snapshot() {
    return this.control.snapshot();
  }

  value(path: string) {
    return this.control.value(path);
  }

  cellHistory() {
    return this.cells.snapshot();
  }

  invalidate(): void {
    this.control.invalidate();
    this.cells.invalidate();
  }
}
