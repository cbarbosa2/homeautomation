// Functions to load and save persistent storage using jsonbin.io

import { JSONBIN_ID } from "./constants.ts";

const BIN_BASE_URL = "https://api.jsonbin.io/v3/b/";

interface StorageValueResponse {
  inside: number | undefined;
  outside: number | undefined;
}

interface StorageValueRequest {
  inside: number;
  outside: number;
}

/**
 * Loads the persistent JSON value from jsonbin.io
 * @returns {Promise<any>} The parsed JSON value
 */
export async function loadPersistentStorage(): Promise<StorageValueResponse> {
  const response = await fetch(
    BIN_BASE_URL + JSONBIN_ID + "/latest?meta=false",
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
  if (!response.ok) throw new Error(`Failed to load: ${response.status}`);
  return await response.json();
}

/**
 * Saves the given value to persistent storage in jsonbin.io
 * @param {any} value The value to save
 * @returns {Promise<void>}
 */
export async function savePersistentStorage(
  value: StorageValueRequest
): Promise<void> {
  const response = await fetch(BIN_BASE_URL + JSONBIN_ID, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`Failed to save: ${response.status}`);
}
