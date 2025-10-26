import { globals } from "../globals.ts";
import { MqttClient } from "../mqtt-client.ts";
import { MetricInfo, METRICS } from "../prometheus/metrics.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";

export class MqttToPrometheusTask {
  private metrics: PrometheusMetrics;
  private mqttClient: MqttClient;

  constructor(mqttClient: MqttClient, metrics: PrometheusMetrics) {
    this.mqttClient = mqttClient;
    this.metrics = metrics;
  }

  subscribeTopics(): void {
    this.subscribeToGauge(
      "N/102c6b9cfab9/battery/512/System/MaxCellVoltage",
      METRICS.GAUGES.ESS_BATTERY_MAX_CELL_VOLTAGE
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/battery/512/System/MinCellVoltage",
      METRICS.GAUGES.ESS_BATTERY_MIN_CELL_VOLTAGE
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/battery/512/Dc/0/Current",
      METRICS.GAUGES.ESS_BATTERY_CURRENT
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/battery/512/Dc/0/Power",
      METRICS.GAUGES.ESS_BATTERY_POWER
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/battery/512/Dc/0/Voltage",
      METRICS.GAUGES.ESS_BATTERY_VOLTAGE
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/battery/512/Dc/0/Temperature",
      METRICS.GAUGES.ESS_BATTERY_TEMPERATURE
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/battery/512/Soc",
      METRICS.GAUGES.ESS_BATTERY_SOC,
      (soc) => {
        globals.batterySOC = soc ?? 0;
      }
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/system/0/Ac/Grid/L1/Power",
      METRICS.GAUGES.ESS_GRID_POWER
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/system/0/Ac/Consumption/L1/Power",
      METRICS.GAUGES.ESS_CONSUMPTION_POWER
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit",
      METRICS.GAUGES.ESS_BATTERY_MIN_SOC
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/system/0/Ac/PvOnGrid/L1/Power",
      METRICS.GAUGES.ESS_PV_INVERTER_POWER
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/system/0/Dc/Pv/Power",
      METRICS.GAUGES.ESS_PV_CHARGER_POWER
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/evcharger/40/Ac/Power",
      METRICS.GAUGES.ESS_CAR_CHARGE_INSIDE_POWER
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/evcharger/41/Ac/Power",
      METRICS.GAUGES.ESS_CAR_CHARGE_OUTSIDE_POWER
    );
    this.subscribeToGauge(
      "N/102c6b9cfab9/temperature/24/Temperature",
      METRICS.GAUGES.ESS_SHED_TEMPERATURE
    );
  }

  private subscribeToGauge(
    topic: string,
    gaugeInfo: MetricInfo,
    handler?: (payloadValue: number | undefined) => void
  ): void {
    this.mqttClient.subscribeWithHandler(topic, (_, data) => {
      const payload = data as { value: number | undefined };
      this.metrics.setGauge(gaugeInfo, payload.value ?? 0);
      if (handler) {
        handler(payload.value);
      }
    });
  }
}
