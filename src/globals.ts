export const globals: {
  // holds the value in kWh per day, index 0 is current day, index 1 is tomorrow, plus index 2 and 3
  forecastNextDays: number[];
} = {
  forecastNextDays: [],
};

export function logGlobals() {
  console.log(`Globals=${JSON.stringify(globals)}`);
}
