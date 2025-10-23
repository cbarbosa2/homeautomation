import { globals } from "../globals.ts";
import { MqttClient } from "../mqtt.ts";
import { METRICS } from "../prometheus/metrics.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";

export class ReadMqttTask {
  private metrics: PrometheusMetrics;
  private mqttClient: MqttClient;

  constructor(mqttClient: MqttClient, metrics: PrometheusMetrics) {
    this.mqttClient = mqttClient;
    this.metrics = metrics;
  }

  subscribeTopics(): void {
    this.mqttClient.subscribeWithHandler(
      "N/102c6b9cfab9/system/0/Batteries",
      (_, data) => {
        const batteryData = data as { value: Array<{ soc: number }> };
        globals.batterySOC = batteryData.value[0]!.soc;
      }
    );

    this.mqttClient.subscribeWithHandler(
      "N/102c6b9cfab9/battery/512/System/MaxCellVoltage",
      (_, data) => {
        const payload = data as { value: number };
        this.metrics.setGauge(
          METRICS.GAUGES.ESS_BATTERY_MAX_CELL_VOLTAGE,
          payload.value
        );
      }
    );
  }
}
