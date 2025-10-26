export interface MetricInfo {
  name: string;
  title: string;
  description: string;
  labels?: readonly string[] | undefined;
}

export const METRICS = {
  COUNTERS: {
    MQTT_MESSAGES_RECEIVED: {
      name: "mqtt_messages_received_total",
      title: "MQTT Messages Received",
      description: "Total MQTT messages received",
    },
    MQTT_MESSAGES_SENT: {
      name: "mqtt_messages_sent_total",
      title: "MQTT Messages Sent",
      description: "Total MQTT messages sent",
    },
    HTTP_REQUESTS: {
      name: "http_requests_total",
      title: "HTTP Requests",
      description: "Total HTTP requests made",
      labels: ["method", "status"],
    },
    ERRORS: {
      name: "errors_total",
      title: "Errors",
      description: "Total errors encountered",
      labels: ["type"],
    },
  },
  GAUGES: {
    MQTT_CONNECTION_STATUS: {
      name: "mqtt_connection_status",
      title: "MQTT Connection Status",
      description: "MQTT connection status (1=connected, 0=disconnected)",
    },
    ACTIVE_DEVICES: {
      name: "active_devices",
      title: "Active Devices",
      description: "Number of active devices",
    },
    ESS_SOLAR_FORECAST: {
      name: "ess_solar_forecast",
      title: "Solar Forecast",
      description: "Solar forecast in watt-hours",
      labels: ["day", "source"],
    },
    ESS_OMIE_PRICE: {
      name: "ess_omie_price",
      title: "Omie Price",
      description: "Omie price in cents",
      labels: ["day", "hour"],
    },
    ESS_BATTERY_MAX_CELL_VOLTAGE: {
      name: "ess_battery_max_cell_voltage",
      title: "Battery Max Cell Voltage",
      description: "Maximum battery cell voltage in volts",
    },
    ESS_BATTERY_MIN_CELL_VOLTAGE: {
      name: "ess_battery_min_cell_voltage",
      title: "Battery Min Cell Voltage",
      description: "Minimum battery cell voltage in volts",
    },
    ESS_BATTERY_CURRENT: {
      name: "ess_battery_current",
      title: "Battery Current",
      description: "Battery current in amperes",
    },
    ESS_BATTERY_POWER: {
      name: "ess_battery_power",
      title: "Battery Power",
      description: "Battery power in watts",
    },
    ESS_BATTERY_VOLTAGE: {
      name: "ess_battery_voltage",
      title: "Battery Voltage",
      description: "Battery voltage in volts",
    },
    ESS_BATTERY_TEMPERATURE: {
      name: "ess_battery_temperature",
      title: "Battery Temperature",
      description: "Battery temperature in celsius",
    },
    ESS_BATTERY_SOC: {
      name: "ess_battery_soc",
      title: "Battery State of Charge",
      description: "Battery state of charge as percentage",
    },
    ESS_GRID_POWER: {
      name: "ess_grid_power",
      title: "Grid Power",
      description: "Grid power in watts (positive=consuming, negative=feeding)",
    },
    ESS_CONSUMPTION_POWER: {
      name: "ess_consumption_power",
      title: "Consumption Power",
      description: "Total consumption power in watts",
    },
    ESS_BATTERY_MIN_SOC: {
      name: "ess_battery_min_soc",
      title: "Battery Min SOC",
      description: "Minimum battery state of charge threshold as percentage",
    },
    ESS_PV_INVERTER_POWER: {
      name: "ess_pv_inverter_power",
      title: "PV Inverter Power",
      description: "PV inverter power in watts",
    },
    ESS_PV_CHARGER_POWER: {
      name: "ess_pv_charger_power",
      title: "PV Charger Power",
      description: "PV charger power in watts",
    },
    ESS_WALLBOX_INSIDE_POWER: {
      name: "ess_wallbox_inside_power",
      title: "Inside Wallbox Power",
      description: "Inside wallbox power in watts",
    },
    ESS_WALLBOX_OUTSIDE_POWER: {
      name: "ess_wallbox_outside_power",
      title: "Outside Wallbox Power",
      description: "Outside wallbox power in watts",
    },
    // status of wallboxes
    ESS_WALLBOX_INSIDE_STATUS: {
      name: "ess_wallbox_inside_status",
      title: "Inside Victron Wallbox Status",
      description: "Inside victron wallbox status",
    },
    ESS_WALLBOX_OUTSIDE_STATUS: {
      name: "ess_wallbox_outside_status",
      title: "Outside Victron Wallbox Status",
      description: "Outside victron wallbox status",
    },
    ESS_WALLBOX_INSIDE_CURRENT: {
      name: "ess_wallbox_inside_current",
      title: "Inside Wallbox Current",
      description: "Inside wallbox current (A)",
    },
    ESS_WALLBOX_OUTSIDE_CURRENT: {
      name: "ess_wallbox_outside_current",
      title: "Outside Wallbox Current",
      description: "Outside wallbox current (A)",
    },
    ESS_WALLBOX_INSIDE_CHARGE_MODE: {
      name: "ess_wallbox_inside_charge_mode",
      title: "Inside Wallbox Charge Mode",
      description: "Inside wallbox charge mode (1..6)",
    },
    ESS_WALLBOX_OUTSIDE_CHARGE_MODE: {
      name: "ess_wallbox_outside_charge_mode",
      title: "Outside Wallbox Charge Mode",
      description: "Outside wallbox charge mode (1..6)",
    },
    ESS_SHED_TEMPERATURE: {
      name: "ess_shed_temperature",
      title: "Shed Temperature",
      description: "Shed temperature in celsius",
    },
  },
  HISTOGRAMS: {},
} as const;
