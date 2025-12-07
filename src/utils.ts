export function powerToAmps(power: number) {
  return Math.round(power / SYSTEM_VOLTAGE);
}

export function ampsToPower(amps: number) {
  return Math.round(amps * SYSTEM_VOLTAGE);
}

export const SYSTEM_VOLTAGE = 240;
