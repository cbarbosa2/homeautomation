import { OmieEntry } from "./tasks/omie-parse.ts";

export const globals: {
  // holds the value in kWh per day, index 0 is current day, index 1 is tomorrow, plus index 2 and 3
  solarForecastNextDays: number[];
  victronNextDays: number[];
  omieEntries: OmieEntry[];
} = {
  solarForecastNextDays: [],
  victronNextDays: [],
  omieEntries: [],
};

export function logGlobals() {
  console.log(`Globals=${JSON.stringify(globals)}`);
}
