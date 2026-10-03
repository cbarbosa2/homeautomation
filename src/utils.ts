export function powerToAmps(power: number) {
  return Math.round(power / SYSTEM_VOLTAGE);
}

export function ampsToPower(amps: number) {
  return Math.round(amps * SYSTEM_VOLTAGE);
}

export const SYSTEM_VOLTAGE = 240;

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
