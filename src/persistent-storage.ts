// Functions to load and save persistent storage using jsonbin.io

import type { WallboxLocation } from "./globals.ts";
import { JSONBIN_ID } from "./constants.ts";

function storageHeaders(write = false): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  const { JSONBIN_ACCESS_KEY: accessKey, JSONBIN_MASTER_KEY: masterKey } =
    process.env;
  if (write) headers.set("X-Bin-Versioning", "false");
  if (write && masterKey) headers.set("X-Master-Key", masterKey);
  else if (accessKey) headers.set("X-Access-Key", accessKey);
  else if (masterKey) headers.set("X-Master-Key", masterKey);
  return headers;
}

let pendingSave: Promise<void> = Promise.resolve();

export function flushPersistentStorage(): Promise<void> {
  return pendingSave;
}

const BIN_BASE_URL = "https://api.jsonbin.io/v3/b/";

interface StorageValueResponse {
  preferredWallboxLocation?: unknown;
  inside: number | undefined;
  outside: number | undefined;
}

interface StorageValueRequest {
  preferredWallboxLocation: WallboxLocation;
  inside: number;
  outside: number;
}

/**
 * Loads the persistent JSON value from jsonbin.io
 * @returns {Promise<any>} The parsed JSON value
 */
export async function loadPersistentStorage(): Promise<StorageValueResponse> {
  const response = await fetch(
    `${BIN_BASE_URL}${JSONBIN_ID}/latest?meta=false`,
    {
      method: "GET",
      headers: storageHeaders(),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error(`Failed to load: ${response.status}`);
  return await response.json();
}

/**
 * Saves the given value to persistent storage in jsonbin.io
 * @param {any} value The value to save
 * @returns {Promise<void>}
 */
export function savePersistentStorage(
  value: StorageValueRequest,
): Promise<void> {
  const body = JSON.stringify(value);
  const save = pendingSave.then(async () => {
    const response = await fetch(BIN_BASE_URL + JSONBIN_ID, {
      method: "PUT",
      headers: storageHeaders(true),
      signal: AbortSignal.timeout(30000),
      body,
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Failed to save: ${response.status}`);
  });
  // Keep later writes running after a failure; return the rejection to its caller.
  pendingSave = save.catch(() => {});
  return save;
}
