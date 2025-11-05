export function powerToAmps(power: number) {
  return Math.round(power / 240);
}

export function ampsToPower(amps: number) {
  return Math.round(amps * 240);
}
