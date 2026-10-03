import { Temporal } from "../temporal.ts";
import { systemClock } from "../lisbon-clock.ts";

export const BMW_SOC_DESCRIPTORS = [
  "vehicle.drivetrain.electricEngine.charging.level",
  "vehicle.powertrain.electric.battery.stateOfCharge.displayed",
  "vehicle.drivetrain.batteryManagement.header",
] as const;
export const BMW_API_BASE = "https://api-cardata.bmwgroup.com";
export const BMW_TOKEN_URL = "https://customer.bmwgroup.com/gcdm/oauth/token";
export const BMW_TOKEN_FILE = ".bmw-cardata-tokens.json";

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface VehicleSoc {
  percent: number;
  observedAt: Temporal.Instant;
  source: string;
}

let vehicleSoc: VehicleSoc | undefined;

export function getVehicleSoc(): VehicleSoc | undefined {
  return vehicleSoc;
}

export function setVehicleSoc(value: VehicleSoc): void {
  vehicleSoc = value;
}

export async function saveBmwTokens(
  response: { access_token: string; refresh_token: string; expires_in: number },
): Promise<void> {
  if (
    !response.access_token || !response.refresh_token ||
    !Number.isFinite(response.expires_in)
  ) {
    throw new Error("BMW token response is incomplete");
  }
  const tokens: StoredTokens = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: systemClock().add({ seconds: response.expires_in }).toString(),
  };
  const temp = `${BMW_TOKEN_FILE}.tmp`;
  await Deno.writeTextFile(temp, JSON.stringify(tokens), { mode: 0o600 });
  await Deno.chmod(temp, 0o600);
  await Deno.rename(temp, BMW_TOKEN_FILE);
}

export async function bmwAccessToken(clientId: string): Promise<string> {
  const tokens = JSON.parse(
    await Deno.readTextFile(BMW_TOKEN_FILE),
  ) as StoredTokens;
  if (
    Temporal.Instant.compare(
      Temporal.Instant.from(tokens.expiresAt),
      systemClock().add({ minutes: 5 }),
    ) > 0
  ) return tokens.accessToken;

  const response = await fetch(BMW_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: clientId,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`BMW token refresh failed: ${response.status}`);
  }
  const renewed = await response.json();
  await saveBmwTokens(renewed);
  return renewed.access_token;
}

export async function bmwApi(
  clientId: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await bmwAccessToken(clientId)}`);
  headers.set("x-version", "v1");
  headers.set("Accept", "application/json");
  const response = await fetch(`${BMW_API_BASE}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`BMW CarData request failed: ${response.status}`);
  }
  const body = await response.text();
  return body ? JSON.parse(body) : undefined;
}

export function parseVehicleSoc(payload: unknown): VehicleSoc | undefined {
  if (
    !payload || typeof payload !== "object" || !("telematicData" in payload)
  ) {
    throw new Error("BMW CarData response has no telematicData");
  }
  const data = payload.telematicData;
  if (!data || typeof data !== "object") return undefined;
  let newest: VehicleSoc | undefined;
  for (const source of BMW_SOC_DESCRIPTORS) {
    const entry = (data as Record<string, unknown>)[source];
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    if (value["value"] == null || typeof value["timestamp"] !== "string") {
      continue;
    }
    const percent = Number(value["value"]);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    let observedAt: Temporal.Instant;
    try {
      observedAt = Temporal.Instant.from(value["timestamp"]);
    } catch {
      continue;
    }
    if (
      !newest || Temporal.Instant.compare(observedAt, newest.observedAt) > 0
    ) {
      newest = { percent, observedAt, source };
    }
  }
  return newest;
}

export async function loadVehicleSoc(
  clientId: string,
  vin: string,
  containerId: string,
): Promise<VehicleSoc | undefined> {
  const path = `/customers/vehicles/${
    encodeURIComponent(vin)
  }/telematicData?containerId=${encodeURIComponent(containerId)}`;
  const value = parseVehicleSoc(await bmwApi(clientId, path));
  if (value) setVehicleSoc(value);
  return value;
}
