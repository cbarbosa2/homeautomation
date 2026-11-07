import { Temporal } from "./temporal.ts";
import { systemClock } from "./lisbon-clock.ts";
import { readVictronConfig } from "./victron-config.ts";

// Keep native decimal/hexadecimal detection for integer inputs.
const AUTO_DETECT_RADIX = 0;

const victron = readVictronConfig((name) => process.env[name]);

export const VICTRON_PORTAL_ID = victron.portalId;

export const VICTRON_INSTALLATION_ID = victron.installationId;

const {
  MQTT_BROKER_URL: mqttBrokerUrl,
  MQTT_USERNAME: mqttUsername,
  MQTT_PASSWORD: mqttPassword,
  MQTT_CLIENT_ID: mqttClientId,
  HTTP_TIMEOUT: httpTimeout,
  HTTP_PORT: httpPort,
  POWER_CONTROL_ENABLED: powerControlEnabled,
  FORECAST_SOLAR_API_KEY: forecastSolarApiKey,
  VICTRON_API_KEY: victronApiKey,
  JSONBIN_ID: jsonbinId,
} = process.env;

// MQTT Configuration
export const MQTT_BROKER_URL = mqttBrokerUrl || "mqtt://localhost:1883";

export const MQTT_USERNAME = mqttUsername || "";

export const MQTT_PASSWORD = mqttPassword || "";

export const MQTT_CLIENT_ID = `${mqttClientId || "homeautomation"}-${systemClock().epochMilliseconds}`;

// HTTP Configuration
export const HTTP_TIMEOUT = Temporal.Duration.from({
  milliseconds: parseInt(httpTimeout || "30000", AUTO_DETECT_RADIX),
});

export const HTTP_PORT = parseInt(httpPort || "1881", AUTO_DETECT_RADIX);

export const POWER_CONTROL_ENABLED = powerControlEnabled === "true";

export const FORECAST_SOLAR_API_KEY = forecastSolarApiKey || "";

export const VICTRON_API_KEY = victronApiKey || "";

export const JSONBIN_ID = jsonbinId || "";
