import { VICTRON_PORTAL_ID } from "../constants.ts";
import { globals } from "../globals.ts";
import { SolarForecasts } from "../solar-forecasts.ts";
import { CONTROL_PATHS, controlTelemetry } from "../control-telemetry.ts";
import {
  Clock,
  lisbonTime,
  systemClock,
  timeUntilMorning,
} from "../lisbon-clock.ts";
import { MqttClient } from "../mqtt-client.ts";
import { Temporal } from "../temporal.ts";
import { finite } from "../power-controller/dynamic-power-calculator.ts";

export function calculateEveningSOC(
  soc: number,
  forecastKwh: number,
  instant: Temporal.Instant,
): number {
  const today = lisbonTime(instant);
  const floor = today.month < 3 || today.month > 10 ||
      (today.month === 10 && today.day >= 15)
    ? 30
    : 10;
  const energy = forecastKwh * 0.95;
  const lower = floor - 100 * (energy - 15) / 40;
  const upper = 85 - 100 * (energy - 2) / 40;
  return Math.max(
    floor,
    Math.min(
      Math.max(soc - 2 * timeUntilMorning(instant).total("hours"), lower),
      upper,
      85,
    ),
  );
}
interface EveningInputs {
  soc: number | undefined;
  forecast: SolarForecasts;
}
export class SetSocLimitTask {
  private readonly topic =
    `W/${VICTRON_PORTAL_ID}/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit`;
  private lastMinute: Temporal.Instant;
  private pending:
    | {
      eveningDate: Temporal.PlainDate;
      targetDate: Temporal.PlainDate;
      retryAt: Temporal.Instant;
    }
    | undefined;
  constructor(
    private mqttClient: Pick<MqttClient, "publishJson">,
    private clock: Clock = systemClock,
    private inputs: () => EveningInputs = () => ({
      soc: controlTelemetry.value(CONTROL_PATHS.batterySOC),
      forecast: globals.solarForecastByDate,
    }),
  ) {
    // The constructor does not run missed actions, even within a scheduled minute.
    this.lastMinute = clock().round({
      smallestUnit: "minute",
      roundingMode: "floor",
    });
  }
  public executeInMorning(): Promise<void> {
    return this.mqttClient.publishJson(this.topic, { value: 5 });
  }
  public async executeInEvening(
    targetDate = lisbonTime(this.clock()).toPlainDate().add({ days: 1 }),
  ): Promise<boolean> {
    const now = this.clock();
    const { soc, forecast } = this.inputs();
    const estimate = forecast.get(targetDate);
    if (
      !finite(soc) || soc < 0 || soc > 100 || !estimate ||
      !finite(estimate.wattHours) || estimate.wattHours < 0 ||
      !(estimate.fetchedAt instanceof Temporal.Instant) ||
      Temporal.Instant.compare(now, estimate.fetchedAt) < 0 ||
      Temporal.Instant.compare(now, estimate.fetchedAt.add({ hours: 6 })) > 0
    ) return false;
    await this.mqttClient.publishJson(this.topic, {
      value: calculateEveningSOC(soc, estimate.wattHours / 1000, now),
    });
    return true;
  }
  /** Called each UTC minute; all decisions are made using Lisbon civil time. */
  public async tick(): Promise<void> {
    const instant = this.clock();
    const minute = instant.round({
      smallestUnit: "minute",
      roundingMode: "floor",
    });
    if (Temporal.Instant.compare(minute, this.lastMinute) <= 0) return;
    this.lastMinute = minute;
    const now = lisbonTime(instant);
    const date = now.toPlainDate();
    if (!this.pending?.eveningDate.equals(date)) this.pending = undefined;
    if (now.hour === 8 && now.minute === 0) await this.executeInMorning();
    if (now.hour === 22 && now.minute === 1) {
      this.pending = {
        eveningDate: date,
        targetDate: now.toPlainDate().add({ days: 1 }),
        retryAt: instant,
      };
    }
    if (
      this.pending &&
      Temporal.Instant.compare(instant, this.pending.retryAt) >= 0
    ) {
      this.pending.retryAt = instant.add({ minutes: 5 });
      if (await this.executeInEvening(this.pending.targetDate)) {
        this.pending = undefined;
      }
    }
  }
}
