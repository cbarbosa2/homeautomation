export const globals: {
  // holds the value in kWh per day, index 0 is current day, index 1 is tomorrow, plus index 2 and 3
  solarForecastNextDays: number[];
  victronNextDays: number[];
  omieEntries: OmieEntry[];
  batterySOC: number;
} = {
  solarForecastNextDays: [],
  victronNextDays: [],
  omieEntries: [],
  batterySOC: 0,
};

export function logGlobals() {
  console.log(`Globals=${JSON.stringify(globals)}`);
}

export interface OmieEntry {
  date: Temporal.PlainDateTime;
  // in cents per kwh
  price: number;
}
