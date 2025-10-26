import { globals } from "../globals.ts";
import { MqttClient } from "../mqtt-client.ts";

export class SetSocLimitTask {
  private mqttClient: MqttClient;
  private readonly topic =
    "W/102c6b9cfab9/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit";

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;
  }

  public executeInMorning(): Promise<void> {
    return this.publishValue(5);
  }

  public executeInEvening(): Promise<void> {
    return this.publishValue(this.calculateEveningValue().value);
  }

  private async publishValue(value: number): Promise<void> {
    await this.mqttClient.publish(this.topic, JSON.stringify({ value: value }));
  }

  private calculateEveningValue(): {
    value: number;
    tomorrowChargeKwh: number;
    rangeMax: number;
    rangeMin: number;
    currentSOC: number;
  } {
    const chargeEfficiency = 0.95;
    const minDaylightConsumptionKwh = 2;
    const maxDaylightConsumptionKwh = 15;
    // in summer use 8, winter do 30
    const minSOCPercent = 30;
    const maxSOCPercent = 85;
    const batteryCapacityKwh = 40;

    const tomorrowChargeKwh =
      ((globals.solarForecastNextDays[1] || 1) * chargeEfficiency) / 1000;

    const rangeMax =
      maxSOCPercent -
      (100 * (tomorrowChargeKwh - minDaylightConsumptionKwh)) /
        batteryCapacityKwh;
    const rangeMin =
      minSOCPercent -
      (100 * (tomorrowChargeKwh - maxDaylightConsumptionKwh)) /
        batteryCapacityKwh;

    const eveningSocMargin = 2 * ((24 + 8 - new Date().getHours()) % 24);
    const currentSOC = globals.batterySOC || 10;

    const targetSOC = Math.max(
      Math.min(
        Math.max(currentSOC - eveningSocMargin, rangeMin),
        rangeMax,
        maxSOCPercent
      ),
      minSOCPercent
    );

    return {
      value: targetSOC,
      tomorrowChargeKwh,
      rangeMax,
      rangeMin,
      currentSOC,
    };
  }
}
