import { events, globals } from "../globals.ts";
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
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/battery/512/System/MaxCellVoltage",
      METRICS.GAUGES.ESS_BATTERY_MAX_CELL_VOLTAGE
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/battery/512/System/MinCellVoltage",
      METRICS.GAUGES.ESS_BATTERY_MIN_CELL_VOLTAGE
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/battery/512/Dc/0/Current",
      METRICS.GAUGES.ESS_BATTERY_CURRENT
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/battery/512/Dc/0/Power",
      METRICS.GAUGES.ESS_BATTERY_POWER,
      (value) => {
        globals.batteryPower = value ?? 0;
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/battery/512/Dc/0/Voltage",
      METRICS.GAUGES.ESS_BATTERY_VOLTAGE
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/battery/512/Dc/0/Temperature",
      METRICS.GAUGES.ESS_BATTERY_TEMPERATURE
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/battery/512/Soc",
      METRICS.GAUGES.ESS_BATTERY_SOC,
      (value) => {
        globals.batterySOC = value ?? 0;
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/system/0/Ac/Grid/L1/Power",
      METRICS.GAUGES.ESS_GRID_POWER,
      (value) => {
        globals.gridPower = value ?? 0;
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/system/0/Ac/Consumption/L1/Power",
      METRICS.GAUGES.ESS_CONSUMPTION_POWER
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit",
      METRICS.GAUGES.ESS_BATTERY_MIN_SOC,
      (value) => {
        globals.batteryMinSOC = value ?? 0;
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/system/0/Ac/PvOnGrid/L1/Power",
      METRICS.GAUGES.ESS_PV_INVERTER_POWER
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/system/0/Dc/Pv/Power",
      METRICS.GAUGES.ESS_PV_CHARGER_POWER
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/evcharger/40/Ac/Power",
      METRICS.GAUGES.ESS_WALLBOX_INSIDE_POWER,
      (value) => {
        globals.wallboxPowerInside = value ?? 0;
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/evcharger/41/Ac/Power",
      METRICS.GAUGES.ESS_WALLBOX_OUTSIDE_POWER,
      (value) => {
        globals.wallboxPowerOutside = value ?? 0;
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/evcharger/40/Status",
      METRICS.GAUGES.ESS_WALLBOX_INSIDE_STATUS,
      (value) => {
        globals.wallboxStatusInside = value ?? 0;
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/evcharger/41/Status",
      METRICS.GAUGES.ESS_WALLBOX_OUTSIDE_STATUS,
      (value) => {
        globals.wallboxStatusOutside = value ?? 0;
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/evcharger/40/SetCurrent",
      METRICS.GAUGES.ESS_WALLBOX_INSIDE_CURRENT,
      (value) => {
        globals.wallboxCurrentInside = value ?? 0;
        events.wallboxCurrentInsideUpdated.emit(value ?? 0);
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/evcharger/41/SetCurrent",
      METRICS.GAUGES.ESS_WALLBOX_OUTSIDE_CURRENT,
      (value) => {
        globals.wallboxCurrentOutside = value ?? 0;
        events.wallboxCurrentOutsideUpdated.emit(value ?? 0);
      }
    );
    this.subscribeAndAssignToGauge(
      "N/102c6b9cfab9/temperature/24/Temperature",
      METRICS.GAUGES.ESS_SHED_TEMPERATURE
    );
    this.mqttClient.subscribeWithHandler(
      "shellyplusi4-083af2013a04/events/rpc",
      (_, data) => {
        events.wallSwitchUpdated.emit(
          data as {
            params: { events: { id: number; event: string }[] };
          }
        );
      }
    );
  }

  private subscribeAndAssignToGauge(
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
