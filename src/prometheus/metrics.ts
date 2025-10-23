export interface MetricInfo {
  name: string;
  title: string;
  description: string;
  labels?: readonly string[] | undefined;
}

export const METRICS = {
  COUNTERS: {
    AUTOMATION_CYCLES: {
      name: "automation_cycles_total",
      title: "Automation Cycles",
      description: "Total number of automation cycles",
    },
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
    ESS_CAR_CHARGE_INSIDE_POWER: {
      name: "ess_car_charge_inside_power",
      title: "Inside Car Charge Power",
      description: "Inside car charging power in watts",
    },
    ESS_CAR_CHARGE_OUTSIDE_POWER: {
      name: "ess_car_charge_outside_power",
      title: "Outside Car Charge Power",
      description: "Outside car charging power in watts",
    },
    ESS_SHED_TEMPERATURE: {
      name: "ess_shed_temperature",
      title: "Shed Temperature",
      description: "Shed temperature in celsius",
    },
  },
  HISTOGRAMS: {
    HTTP_REQUEST_DURATION: {
      name: "http_request_duration_seconds",
      title: "HTTP Request Duration",
      description: "HTTP request duration in seconds",
    },
    AUTOMATION_CYCLE_DURATION: {
      name: "automation_cycle_duration_seconds",
      title: "Automation Cycle Duration",
      description: "Automation cycle duration in seconds",
    },
  },
} as const;
