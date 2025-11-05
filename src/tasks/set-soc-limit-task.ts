import { globals } from "../globals.ts";
import { MqttClient } from "../mqtt-client.ts";
import { Temporal } from "../temporal.ts";

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
    const calcResults = this.calculateEveningValue();
    console.log("Evening SOC results: " + JSON.stringify(calcResults));
    return this.publishValue(calcResults.value);
  }

  private async publishValue(value: number): Promise<void> {
    await this.mqttClient.publishJson(this.topic, { value: value });
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
    const minSOCPercent = this.isWinterSeason() ? 30 : 5;
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

  private isWinterSeason(): boolean {
    const today = Temporal.Now.plainDateISO();
    const startSeason = Temporal.PlainDate.from({
      year: today.year,
      month: 10,
      day: 15,
    });
    const endSeason = Temporal.PlainDate.from({
      year: today.year,
      month: 3,
      day: 1,
    });

    // Check if today is between November 1st and March 1st
    const isAfterStart = Temporal.PlainDate.compare(today, startSeason) >= 0;
    const isBeforeEnd = Temporal.PlainDate.compare(today, endSeason) < 0;
    return isAfterStart || isBeforeEnd;
  }
}
