import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Child working directories keep real tokens and .env completely isolated.
test("BMW tokens replace atomically, remain private and reload on Node", async () => {
  const directory = await mkdtemp(join(tmpdir(), "homeautomation-bmw-"));
  try {
    const module = new URL("./bmw-cardata.js", import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      const { saveBmwTokens, bmwAccessToken } = await import(${JSON.stringify(
        module,
      )});
      await saveBmwTokens({ access_token: 'old', refresh_token: 'old-refresh', expires_in: 3600 });
      await saveBmwTokens({ access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600 });
      console.log(await bmwAccessToken('test-client'));
    `,
      ],
      { cwd: directory, encoding: "utf8", timeout: 10000 },
    );
    equal(child.status, 0, child.stderr);
    equal(child.stdout.trim(), "new");
    const filename = join(directory, ".bmw-cardata-tokens.json");
    const tokens = JSON.parse(await readFile(filename, "utf8"));
    equal(tokens.refreshToken, "new-refresh");
    equal((await stat(filename)).mode & 0o777, 0o600);
    deepStrictEqual(await readdir(directory), [".bmw-cardata-tokens.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compiled BMW setup updates its host's .env and private token file using stubbed APIs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "homeautomation-setup-"));
  try {
    await writeFile(
      join(directory, ".env"),
      "BMW_CARDATA_CLIENT_ID=test-client\nBMW_CARDATA_VIN=TESTVIN\nBMW_CARDATA_CONTAINER_ID=old\nUNRELATED=keep\n",
    );
    const script = new URL(
      "../../scripts/bmw-cardata-setup.js",
      import.meta.url,
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      const timeout = globalThis.setTimeout;
      globalThis.setTimeout = (callback) => timeout(callback, 0);
      globalThis.fetch = async (input) => {
        const url = new URL(input);
        if (url.href === 'https://customer.bmwgroup.com/gcdm/oauth/device/code') return Response.json({ device_code: 'test-device', user_code: 'test-code', verification_uri: 'https://example.com', interval: 5, expires_in: 600 });
        if (url.href === 'https://customer.bmwgroup.com/gcdm/oauth/token') return Response.json({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600 });
        if (url.href === 'https://api-cardata.bmwgroup.com/customers/vehicles/mappings') return Response.json([{ vin: 'TESTVIN', mappingType: 'PRIMARY' }]);
        if (url.href === 'https://api-cardata.bmwgroup.com/customers/containers') return Response.json({ containers: [{ name: 'Home automation i3 SOC', state: 'ACTIVE', containerId: 'new-container' }] });
        throw new Error('Unexpected network request: ' + url.href);
      };
      await import(${JSON.stringify(script)});
    `,
      ],
      {
        cwd: directory,
        env: { PATH: process.env["PATH"] },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    equal(child.status, 0, child.stderr);
    const env = await readFile(join(directory, ".env"), "utf8");
    equal(env.includes("UNRELATED=keep"), true);
    equal(env.includes("BMW_CARDATA_CONTAINER_ID=new-container"), true);
    equal(env.split("BMW_CARDATA_VIN=").length, 2);
    equal((await stat(join(directory, ".env"))).mode & 0o777, 0o600);
    equal(
      (await stat(join(directory, ".bmw-cardata-tokens.json"))).mode & 0o777,
      0o600,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
