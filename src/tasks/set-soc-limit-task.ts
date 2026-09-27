import { globals, SolarForecast } from "../globals.ts";
import { CONTROL_PATHS, controlTelemetry } from "../control-telemetry.ts";
import {
  Clock,
  hoursUntilMorning,
  lisbonTime,
  systemClock,
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
    Math.min(Math.max(soc - 2 * hoursUntilMorning(instant), lower), upper, 85),
  );
}
interface EveningInputs {
  soc: number | undefined;
  forecast: Map<string, SolarForecast>;
}
export class SetSocLimitTask {
  private readonly topic =
    "W/102c6b9cfab9/settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit";
  private lastMinute: number;
  private pending:
    | { eveningDate: string; targetDate: string; retryAt: number }
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
    this.lastMinute = Math.floor(clock().epochMilliseconds / 60_000);
  }
  public executeInMorning(): Promise<void> {
    return this.mqttClient.publishJson(this.topic, { value: 5 });
  }
  public async executeInEvening(
    targetDate = lisbonTime(this.clock()).toPlainDate().add({ days: 1 })
      .toString(),
  ): Promise<boolean> {
    const now = this.clock();
    const { soc, forecast } = this.inputs();
    const estimate = forecast.get(targetDate);
    if (
      !finite(soc) || soc < 0 || soc > 100 || !estimate ||
      !finite(estimate.wattHours) || estimate.wattHours < 0 ||
      !finite(estimate.fetchedAt) ||
      now.epochMilliseconds < estimate.fetchedAt ||
      now.epochMilliseconds - estimate.fetchedAt > 6 * 3_600_000
    ) return false;
    await this.mqttClient.publishJson(this.topic, {
      value: calculateEveningSOC(soc, estimate.wattHours / 1000, now),
    });
    return true;
  }
  /** Called each UTC minute; all decisions are made using Lisbon civil time. */
  public async tick(): Promise<void> {
    const instant = this.clock();
    const minute = Math.floor(instant.epochMilliseconds / 60_000);
    if (minute <= this.lastMinute) return;
    this.lastMinute = minute;
    const now = lisbonTime(instant);
    const date = now.toPlainDate().toString();
    if (this.pending?.eveningDate !== date) this.pending = undefined;
    if (now.hour === 8 && now.minute === 0) await this.executeInMorning();
    if (now.hour === 22 && now.minute === 1) {
      this.pending = {
        eveningDate: date,
        targetDate: now.toPlainDate().add({ days: 1 }).toString(),
        retryAt: instant.epochMilliseconds,
      };
    }
    if (this.pending && instant.epochMilliseconds >= this.pending.retryAt) {
      this.pending.retryAt = instant.epochMilliseconds + 5 * 60_000;
      if (await this.executeInEvening(this.pending.targetDate)) {
        this.pending = undefined;
      }
    }
  }
}
