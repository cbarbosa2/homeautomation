import { VICTRON_PORTAL_ID } from "./constants.ts";
import { Clock, systemClock } from "./lisbon-clock.ts";
import { Temporal } from "./temporal.ts";
import { globals, WallboxLocation as L, WallboxStatus } from "./globals.ts";
import { finite } from "./power-controller/dynamic-power-calculator.ts";

export const CONTROL_PATHS = {
  gridPower: "system/0/Ac/Grid/L1/Power",
  batterySOC: "battery/512/Soc",
  batteryPower: "battery/512/Dc/0/Power",
  batteryMinSOC: "settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit",
  batteryMaxChargePower: "settings/0/Settings/CGwacs/MaxChargePower",
  pvInverterPower: "system/0/Ac/PvOnGrid/L1/Power",
  pvChargerPower: "system/0/Dc/Pv/Power",
};
export function wallboxPath(location: L, field: string): string {
  return `evcharger/${location === L.Inside ? 40 : 41}/${field}`;
}
export const REFRESH_PATHS = [
  ...Object.values(CONTROL_PATHS),
  ...[L.Inside, L.Outside].flatMap((l) =>
    ["Ac/Power", "Status", "SetCurrent", "StartStop"].map((f) =>
      wallboxPath(l, f)
    )
  ),
];

/** Validity belongs to each reading; a keepalive is not a measurement. */
export class ControlTelemetry {
  private readings = new Map<string, { value: number; at: Temporal.Instant }>();
  private previousStatus = new Map<L, number>();
  private starts = new Map<L, Temporal.Instant>();
  constructor(private now: Clock = systemClock) {}

  record(topic: string, payload: unknown): void {
    const path = topic.replace(`N/${VICTRON_PORTAL_ID}/`, "");
    if (!REFRESH_PATHS.includes(path)) return;
    const rawValue =
      payload !== null && typeof payload === "object" && "value" in payload
        ? payload.value
        : undefined;
    if (
      !finite(rawValue) ||
      ((path.endsWith("Soc") || path.endsWith("SocLimit")) &&
        (rawValue < 0 || rawValue > 100)) ||
      (path.endsWith("Status") &&
        (![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24]
          .includes(rawValue))) ||
      (path.endsWith("StartStop") && rawValue !== 0 && rawValue !== 1) ||
      ((path.includes("evcharger/") &&
        (path.endsWith("Ac/Power") || path.endsWith("SetCurrent"))) &&
        rawValue < 0) ||
      ((path === CONTROL_PATHS.pvInverterPower ||
        path === CONTROL_PATHS.pvChargerPower) && rawValue < 0)
    ) {
      this.readings.delete(path);
      return;
    }
    const value: number = rawValue;
    this.readings.set(path, { value, at: this.now() });
    for (const l of [L.Inside, L.Outside]) {
      if (path !== wallboxPath(l, "Status")) continue;
      if (
        value === WallboxStatus.Charging && this.previousStatus.get(l) !== value
      ) {
        // Both charging on first observation have indistinguishable start order.
        this.starts.set(
          l,
          this.previousStatus.has(l)
            ? this.now()
            : Temporal.Instant.fromEpochMilliseconds(0),
        );
      }
      this.previousStatus.set(l, value);
    }
  }
  invalidate(): void {
    this.readings.clear();
  }
  value(path: string): number | undefined {
    const reading = this.readings.get(path);
    const now = this.now();
    return reading && Temporal.Instant.compare(now, reading.at) >= 0 &&
        Temporal.Instant.compare(now, reading.at.add({ seconds: 60 })) <= 0
      ? reading.value
      : undefined;
  }
  snapshot() {
    const map = (field: string) =>
      new Map([L.Inside, L.Outside].flatMap((l) => {
        const value = this.value(wallboxPath(l, field));
        return value === undefined ? [] : [[l, value] as const];
      }));
    return {
      ...globals,
      telemetryValid: REFRESH_PATHS.every((path) =>
        this.value(path) !== undefined
      ),
      gridPower: this.value(CONTROL_PATHS.gridPower),
      batterySOC: this.value(CONTROL_PATHS.batterySOC),
      batteryPower: this.value(CONTROL_PATHS.batteryPower),
      batteryMinSOC: this.value(CONTROL_PATHS.batteryMinSOC),
      batteryMaxChargePower: this.value(CONTROL_PATHS.batteryMaxChargePower),
      pvInverterPower: this.value(CONTROL_PATHS.pvInverterPower),
      pvChargerPower: this.value(CONTROL_PATHS.pvChargerPower),
      wallboxPower: map("Ac/Power"),
      wallboxVictronStatus: map("Status"),
      wallboxSetCurrent: map("SetCurrent"),
      wallboxStartStop: map("StartStop"),
      chargingStartedAt: new Map(this.starts),
      observedAt: new Map(
        [...this.readings].filter(([path]) => this.value(path) !== undefined)
          .map(([path, r]) => [path, r.at]),
      ),
    };
  }
}
export const controlTelemetry = new ControlTelemetry();
