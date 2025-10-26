import { load } from "@std/dotenv";

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

// HTTP / Prometheus Configuration
export const HTTP_PORT = parseInt(Deno.env.get("HTTP_PORT") || "1881");

export const FORECAST_SOLAR_API_KEY =
  Deno.env.get("FORECAST_SOLAR_API_KEY") || "";

export const VICTRON_API_KEY = Deno.env.get("VICTRON_API_KEY") || "";
