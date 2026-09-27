import { Temporal } from "./temporal.ts";
export type Clock = () => Temporal.Instant;
export const systemClock: Clock = () => Temporal.Now.instant();
export function lisbonTime(instant: Temporal.Instant) {
  return instant.toZonedDateTimeISO("Europe/Lisbon");
}
export function timeUntilMorning(instant: Temporal.Instant): Temporal.Duration {
  const local = lisbonTime(instant);
  let morning = local.with({
    hour: 8,
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });
  if (Temporal.ZonedDateTime.compare(morning, local) <= 0) {
    morning = morning.add({ days: 1 });
  }
  return instant.until(morning.toInstant()).round({
    largestUnit: "hours",
    smallestUnit: "hours",
    roundingMode: "ceil",
  });
}
