import { WallboxLocation as L } from "./globals.ts";
import { type MetricInfo, METRICS } from "./prometheus/metrics.ts";
import { finite } from "./utils/index.ts";

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

export const BATTERY_CELL_PATHS = {
  minCellVoltage: "battery/512/System/MinCellVoltage",
  maxCellVoltage: "battery/512/System/MaxCellVoltage",
  minVoltagePackName: "battery/512/System/MinVoltageCellId",
  maxVoltagePackName: "battery/512/System/MaxVoltageCellId",
};

type ControlPolicy = "signed" | "percent" | "nonnegative" | "status" | "switch";

type DeviceTopic = {
  path: string;
  control?: ControlPolicy;
  optional?: boolean;
  gauge?: MetricInfo;
  cell?: boolean;
  gesture?: L;
};

const G = METRICS.GAUGES;

export const DEVICE_TOPICS: readonly DeviceTopic[] = [
  { path: CONTROL_PATHS.gridPower, control: "signed", gauge: G.ESS_GRID_POWER },
  {
    path: CONTROL_PATHS.batterySOC,
    control: "percent",
    gauge: G.ESS_BATTERY_SOC,
  },
  {
    path: CONTROL_PATHS.batteryPower,
    control: "signed",
    gauge: G.ESS_BATTERY_POWER,
  },
  {
    path: CONTROL_PATHS.batteryMinSOC,
    control: "percent",
    gauge: G.ESS_BATTERY_MIN_SOC,
  },
  {
    path: CONTROL_PATHS.batteryMaxChargePower,
    control: "signed",
    gauge: G.ESS_BATTERY_MAX_CHARGE_POWER,
  },
  {
    path: CONTROL_PATHS.pvInverterPower,
    control: "nonnegative",
    optional: true,
    gauge: G.ESS_PV_INVERTER_POWER,
  },
  {
    path: CONTROL_PATHS.pvChargerPower,
    control: "nonnegative",
    gauge: G.ESS_PV_CHARGER_POWER,
  },
  ...[L.Inside, L.Outside].flatMap((location): DeviceTopic[] => {
    const inside = location === L.Inside;
    return [
      {
        path: wallboxPath(location, "Ac/Power"),
        control: "nonnegative",
        gauge: inside
          ? G.ESS_WALLBOX_INSIDE_POWER
          : G.ESS_WALLBOX_OUTSIDE_POWER,
      },
      {
        path: wallboxPath(location, "Status"),
        control: "status",
        gauge: inside
          ? G.ESS_WALLBOX_INSIDE_STATUS
          : G.ESS_WALLBOX_OUTSIDE_STATUS,
      },
      {
        path: wallboxPath(location, "SetCurrent"),
        control: "nonnegative",
        gauge: inside
          ? G.ESS_WALLBOX_INSIDE_SET_CURRENT
          : G.ESS_WALLBOX_OUTSIDE_SET_CURRENT,
        gesture: location,
      },
      { path: wallboxPath(location, "StartStop"), control: "switch" },
      {
        path: wallboxPath(location, "Current"),
        gauge: inside
          ? G.ESS_WALLBOX_INSIDE_CURRENT
          : G.ESS_WALLBOX_OUTSIDE_CURRENT,
      },
    ];
  }),
  {
    path: BATTERY_CELL_PATHS.minCellVoltage,
    cell: true,
    gauge: G.ESS_BATTERY_MIN_CELL_VOLTAGE,
  },
  {
    path: BATTERY_CELL_PATHS.maxCellVoltage,
    cell: true,
    gauge: G.ESS_BATTERY_MAX_CELL_VOLTAGE,
  },
  { path: BATTERY_CELL_PATHS.minVoltagePackName, cell: true },
  { path: BATTERY_CELL_PATHS.maxVoltagePackName, cell: true },
  { path: "battery/512/Dc/0/Current", gauge: G.ESS_BATTERY_CURRENT },
  { path: "battery/512/Dc/0/Voltage", gauge: G.ESS_BATTERY_VOLTAGE },
  { path: "battery/512/Dc/0/Temperature", gauge: G.ESS_BATTERY_TEMPERATURE },
  { path: "system/0/Ac/Consumption/L1/Power", gauge: G.ESS_CONSUMPTION_POWER },
  { path: "temperature/24/Temperature", gauge: G.ESS_SHED_TEMPERATURE },
];

export const CONTROL_TOPICS = DEVICE_TOPICS.filter(
  (topic) => topic.control !== undefined,
);

export const REFRESH_PATHS = CONTROL_TOPICS.map((topic) => topic.path);

export const EXPLICIT_READ_PATHS = DEVICE_TOPICS.filter(
  (topic) => topic.control || topic.cell,
).map((topic) => topic.path);

export const SHELLY_TOPIC = "shellyplusi4-083af2013a04/events/rpc";

export function validControlValue(
  policy: ControlPolicy,
  value: unknown,
): value is number {
  if (!finite(value)) return false;
  switch (policy) {
    case "signed":
      return true;
    case "percent":
      return value >= 0 && value <= 100;
    case "nonnegative":
      return value >= 0;
    case "switch":
      return value === 0 || value === 1;
    case "status":
      return [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24,
      ].includes(value);
  }
}
