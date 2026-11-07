import { test } from "node:test";
import {
  deepStrictEqual as assertEquals,
  rejects as assertRejects,
} from "node:assert/strict";
import { HttpServer } from "../http-server.ts";
import { globals, WallboxChargeMode, WallboxLocation } from "../globals.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";
import {
  setChargeMode,
  restorePersistedChargeSettings,
} from "./charge-mode-switcher.ts";

test("API reports persistence failure and later saved modes restore after reset", async () => {
  const originalFetch = globalThis.fetch;
  const originalModes = new Map(globals.wallboxChargeMode);
  const originalPreference = globals.preferredWallboxLocation;
  globals.preferredWallboxLocation = WallboxLocation.Outside;
  const metrics = new PrometheusMetrics();
  const server = new HttpServer(metrics);
  const request = () =>
    new Request("http://localhost/api/wallbox-charge-mode", {
      method: "POST",
      body: JSON.stringify({ location: "Inside", value: WallboxChargeMode.On }),
    });
  try {
    globalThis.fetch = () =>
      Promise.resolve(new Response(null, { status: 403 }));
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript permits private test access only with bracket notation.
    const failure = await server["handleSetWallboxChargeMode"](request());
    assertEquals(failure.status, 500);
    const error = await failure.json();
    assertEquals(error.success, false);
    assertEquals(error.error.includes("may revert after restart"), true);
    assertEquals(
      globals.wallboxChargeMode.get(WallboxLocation.Inside),
      WallboxChargeMode.On,
    );

    assertEquals(globals.preferredWallboxLocation, WallboxLocation.Inside);

    let saved = {
      inside: 6,
      outside: 4,
      preferredWallboxLocation: WallboxLocation.Outside,
    };
    globalThis.fetch = (_input, init) => {
      if (init?.method === "PUT") saved = JSON.parse(String(init.body));
      return Promise.resolve(Response.json(saved));
    };
    // biome-ignore lint/complexity/useLiteralKeys: TypeScript permits private test access only with bracket notation.
    const success = await server["handleSetWallboxChargeMode"](request());
    assertEquals(await success.json(), { success: true });
    await setChargeMode(metrics, WallboxLocation.Outside, WallboxChargeMode.On);
    globals.wallboxChargeMode.clear();
    globals.preferredWallboxLocation = WallboxLocation.Inside;
    await restorePersistedChargeSettings(metrics);
    assertEquals(globals.preferredWallboxLocation, WallboxLocation.Outside);
    assertEquals(
      globals.wallboxChargeMode.get(WallboxLocation.Inside),
      WallboxChargeMode.On,
    );
    assertEquals(
      globals.wallboxChargeMode.get(WallboxLocation.Outside),
      WallboxChargeMode.On,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globals.wallboxChargeMode = originalModes;
    globals.preferredWallboxLocation = originalPreference;
    metrics.getRegister().clear();
  }
});

test("mode commands save ordered snapshots and same-mode commands claim preference", async () => {
  const originalFetch = globalThis.fetch;
  const originalModes = globals.wallboxChargeMode;
  const originalPreference = globals.preferredWallboxLocation;
  const metrics = new PrometheusMetrics();
  const writes: unknown[] = [];
  globals.wallboxChargeMode = new Map([
    [WallboxLocation.Inside, WallboxChargeMode.On],
    [WallboxLocation.Outside, WallboxChargeMode.On],
  ]);
  globalThis.fetch = async (_input, init) => {
    writes.push(JSON.parse(String(init?.body)));
    return Response.json({});
  };
  try {
    const first = setChargeMode(
      metrics,
      WallboxLocation.Outside,
      WallboxChargeMode.On,
    );
    const second = setChargeMode(
      metrics,
      WallboxLocation.Inside,
      WallboxChargeMode.On,
    );
    const third = setChargeMode(
      metrics,
      WallboxLocation.Outside,
      WallboxChargeMode.On,
    );
    assertEquals(globals.preferredWallboxLocation, WallboxLocation.Outside);
    await Promise.all([first, second, third]);
    assertEquals(
      writes,
      [1, 0, 1].map((preferredWallboxLocation) => ({
        inside: WallboxChargeMode.On,
        outside: WallboxChargeMode.On,
        preferredWallboxLocation,
      })),
    );
    const server = new HttpServer(metrics);
    for (const location of ["Inside", "Outside", "Outside"]) {
      // biome-ignore lint/complexity/useLiteralKeys: TypeScript permits private test access only with bracket notation.
      const result = await server["handleSetWallboxChargeMode"](
        new Request("http://localhost/api/wallbox-charge-mode", {
          method: "POST",
          body: JSON.stringify({ location, value: WallboxChargeMode.On }),
        }),
      );
      assertEquals(result.status, 200);
      assertEquals(
        globals.preferredWallboxLocation,
        location === "Inside"
          ? WallboxLocation.Inside
          : WallboxLocation.Outside,
      );
    }
    const count = writes.length;
    const invalidMode: number = 999;
    await setChargeMode(metrics, WallboxLocation.Inside, invalidMode);
    assertEquals(writes.length, count);
    assertEquals(globals.preferredWallboxLocation, WallboxLocation.Outside);
  } finally {
    globalThis.fetch = originalFetch;
    globals.wallboxChargeMode = originalModes;
    globals.preferredWallboxLocation = originalPreference;
    metrics.getRegister().clear();
  }
});

test("restoration preserves saved preference and defaults legacy or invalid preferences", async () => {
  const originalFetch = globalThis.fetch;
  const originalModes = globals.wallboxChargeMode;
  const originalPreference = globals.preferredWallboxLocation;
  const metrics = new PrometheusMetrics();
  try {
    for (const preference of [
      WallboxLocation.Outside,
      WallboxLocation.Inside,
      undefined,
      null,
      "Outside",
      42,
    ]) {
      globals.wallboxChargeMode = new Map();
      globals.preferredWallboxLocation = WallboxLocation.Outside;
      globalThis.fetch = async (_input, init) => {
        assertEquals(init?.method, "GET");
        return Response.json({
          inside: WallboxChargeMode.On,
          outside: WallboxChargeMode.Night,
          preferredWallboxLocation: preference,
        });
      };
      await restorePersistedChargeSettings(metrics);
      assertEquals(
        globals.preferredWallboxLocation,
        preference === WallboxLocation.Outside
          ? WallboxLocation.Outside
          : WallboxLocation.Inside,
      );
      assertEquals(
        [...globals.wallboxChargeMode],
        [
          [WallboxLocation.Inside, WallboxChargeMode.On],
          [WallboxLocation.Outside, WallboxChargeMode.Night],
        ],
      );
    }
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assertRejects(() => restorePersistedChargeSettings(metrics));
    assertEquals(globals.preferredWallboxLocation, WallboxLocation.Inside);
  } finally {
    globalThis.fetch = originalFetch;
    globals.wallboxChargeMode = originalModes;
    globals.preferredWallboxLocation = originalPreference;
    metrics.getRegister().clear();
  }
});
