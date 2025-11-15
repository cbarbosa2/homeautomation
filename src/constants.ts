import { load } from "@std/dotenv";
import { WallboxLocation } from "./globals.ts";

// Load environment variables from .env file
await load({ export: true });

// MQTT Configuration
export const MQTT_BROKER_URL =
  Deno.env.get("MQTT_BROKER_URL") || "mqtt://localhost:1883";
export const MQTT_USERNAME = Deno.env.get("MQTT_USERNAME") || "";
export const MQTT_PASSWORD = Deno.env.get("MQTT_PASSWORD") || "";
export const MQTT_CLIENT_ID =
  (Deno.env.get("MQTT_CLIENT_ID") || `homeautomation`) + `-${Date.now()}`;

// HTTP Configuration
export const HTTP_TIMEOUT = parseInt(Deno.env.get("HTTP_TIMEOUT") || "30000");
export const HTTP_PORT = parseInt(Deno.env.get("HTTP_PORT") || "1881");

export const POWER_CONTROL_ENABLED =
  Deno.env.get("POWER_CONTROL_ENABLED") === "true";

export const FORECAST_SOLAR_API_KEY =
  Deno.env.get("FORECAST_SOLAR_API_KEY") || "";

export const VICTRON_API_KEY = Deno.env.get("VICTRON_API_KEY") || "";

export const JSONBIN_ID = Deno.env.get("JSONBIN_ID") || "";

export const LOG_TO_FILE = Deno.env.get("LOG_TO_FILE") === "true";

export const MAX_GRID_CURRENT = 27;
export const DETECT_SUN_MIN_PV_POWER = 200;
export const MIN_BATTERY_CHARGE_POWER = 200;
export const MAX_BATTERY_CHARGE_POWER = 5000;
export const MAX_AMPS_PER_LOCATION = new Map([
  [WallboxLocation.Inside, 18],
  [WallboxLocation.Outside, 24],
]);

export const TARGET_AMPS_MIN_STOP = 7;
export const TARGET_AMPS_MIN_START = 8;
