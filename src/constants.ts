import { Temporal } from "./temporal.ts";
import { systemClock } from "./lisbon-clock.ts";
import { readVictronConfig } from "./victron-config.ts";

const victron = readVictronConfig((name) => process.env[name]);
export const VICTRON_PORTAL_ID = victron.portalId;

export const VICTRON_INSTALLATION_ID = victron.installationId;

// MQTT Configuration
export const MQTT_BROKER_URL =
  process.env["MQTT_BROKER_URL"] || "mqtt://localhost:1883";
export const MQTT_USERNAME = process.env["MQTT_USERNAME"] || "";

export const MQTT_PASSWORD = process.env["MQTT_PASSWORD"] || "";
export const MQTT_CLIENT_ID =
  (process.env["MQTT_CLIENT_ID"] || `homeautomation`) +
  `-${systemClock().epochMilliseconds}`;

// HTTP Configuration
export const HTTP_TIMEOUT = Temporal.Duration.from({
  milliseconds: parseInt(process.env["HTTP_TIMEOUT"] || "30000"),
});
export const HTTP_PORT = parseInt(process.env["HTTP_PORT"] || "1881");

export const POWER_CONTROL_ENABLED =
  process.env["POWER_CONTROL_ENABLED"] === "true";

export const FORECAST_SOLAR_API_KEY =
  process.env["FORECAST_SOLAR_API_KEY"] || "";

export const VICTRON_API_KEY = process.env["VICTRON_API_KEY"] || "";

export const JSONBIN_ID = process.env["JSONBIN_ID"] || "";
