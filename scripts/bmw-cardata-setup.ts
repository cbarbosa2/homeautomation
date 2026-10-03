import { load } from "@std/dotenv";
import {
  BMW_SOC_DESCRIPTORS,
  BMW_TOKEN_URL,
  bmwApi,
  saveBmwTokens,
} from "../src/bmw-cardata/bmw-cardata.ts";

await load({ export: true });
const clientId = Deno.env.get("BMW_CARDATA_CLIENT_ID")?.trim();
if (!clientId) throw new Error("Set BMW_CARDATA_CLIENT_ID in .env first");

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
}

const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
const challenge = base64url(
  new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    ),
  ),
);
const deviceResponse = await fetch(
  "https://customer.bmwgroup.com/gcdm/oauth/device/code",
  {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      response_type: "device_code",
      scope: "authenticate_user openid cardata:api:read",
      code_challenge: challenge,
      code_challenge_method: "S256",
    }),
    signal: AbortSignal.timeout(30000),
  },
);
if (!deviceResponse.ok) {
  throw new Error(`BMW device authorization failed: ${deviceResponse.status}`);
}
const device = await deviceResponse.json() as {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
};
console.log(
  `Open ${device.verification_uri} and enter code ${device.user_code}`,
);
console.log("Waiting for BMW authorization...");

let interval = Math.max(device.interval || 5, 5);
const deadline = performance.now() + device.expires_in * 1000;
let tokens:
  | { access_token: string; refresh_token: string; expires_in: number }
  | undefined;
while (performance.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  const response = await fetch(BMW_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: device.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  if (response.ok) {
    tokens = body;
    break;
  }
  if (body.error === "slow_down") interval += 5;
  else if (body.error !== "authorization_pending") {
    throw new Error(
      `BMW authorization failed: ${body.error ?? response.status}`,
    );
  }
}
if (!tokens) throw new Error("BMW authorization expired; run setup again");
await saveBmwTokens(tokens);

const mappings = await bmwApi(clientId, "/customers/vehicles/mappings");
const mapped = Array.isArray(mappings)
  ? mappings
  : mappings && typeof mappings === "object" && "vehicles" in mappings
  ? mappings.vehicles
  : [mappings];
const primary = (mapped as { vin: string; mappingType: string }[]).filter((
  item,
) => item?.mappingType === "PRIMARY");
const configuredVin = Deno.env.get("BMW_CARDATA_VIN")?.trim();
const vin = configuredVin ||
  (primary.length === 1 ? primary[0].vin : undefined);
if (!vin || !primary.some((item) => item.vin === vin)) {
  throw new Error(
    "Could not select a primary vehicle. Set BMW_CARDATA_VIN in .env and rerun setup.",
  );
}

const name = "Home automation i3 SOC";
const listing = await bmwApi(clientId, "/customers/containers") as {
  containers?: { containerId: string; name: string; state: string }[];
};
let containerId = listing.containers?.find((item) =>
  item.name === name && item.state === "ACTIVE"
)?.containerId;
if (!containerId) {
  const created = await bmwApi(clientId, "/customers/containers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      purpose: "Display BMW i3 SOC in home automation",
      technicalDescriptors: BMW_SOC_DESCRIPTORS,
    }),
  }) as { containerId: string };
  containerId = created.containerId;
}
if (!containerId) throw new Error("BMW did not return a container ID");

let env = await Deno.readTextFile(".env");
for (
  const [key, value] of Object.entries({
    BMW_CARDATA_VIN: vin,
    BMW_CARDATA_CONTAINER_ID: containerId,
  })
) {
  const lines = env.split("\n").filter((line) => !line.startsWith(`${key}=`));
  env = `${lines.join("\n").trimEnd()}\n${key}=${value}\n`;
}
await Deno.writeTextFile(".env", env, { mode: 0o600 });
await Deno.chmod(".env", 0o600);
console.log("BMW CarData setup complete. Restart the home automation service.");
