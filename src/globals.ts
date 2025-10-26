export const globals: {
  // holds the value in kWh per day, index 0 is current day, index 1 is tomorrow, plus index 2 and 3
  solarForecastNextDays: number[];
  victronNextDays: number[];
  omieEntries: OmieEntry[];
  gridPower: number;
  batteryMinSOC: number;
  batterySOC: number;
  batteryPower: number;
  wallboxPowerInside: number;
  wallboxStatusInside: number;
  wallboxPowerOutside: number;
  wallboxStatusOutside: number;
} = {
  solarForecastNextDays: [],
  victronNextDays: [],
  omieEntries: [],
  gridPower: -1,
  batteryMinSOC: 0,
  batterySOC: 0,
  batteryPower: 0,
  wallboxPowerInside: -1,
  wallboxStatusInside: -1,
  wallboxPowerOutside: -1,
  wallboxStatusOutside: -1,
};

export function logGlobals() {
  console.log(`Globals=${JSON.stringify(globals)}`);
}

export interface OmieEntry {
  date: Temporal.PlainDateTime;
  // in cents per kwh
  price: number;
}
