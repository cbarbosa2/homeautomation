import { assertEquals } from "@std/assert";
import { HttpServer } from "../http-server.ts";
import { globals, WallboxChargeMode, WallboxLocation } from "../globals.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";
import { loadPersistentStorage } from "../persistent-storage.ts";
import { setChargeMode } from "./charge-mode-switcher.ts";

Deno.test("API reports persistence failure and later saved modes restore after reset", async () => {
  const originalFetch = globalThis.fetch;
  const originalModes = new Map(globals.wallboxChargeMode);
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
    const failure = await server["handleSetWallboxChargeMode"](request());
    assertEquals(failure.status, 500);
    const error = await failure.json();
    assertEquals(error.success, false);
    assertEquals(error.error.includes("may revert after restart"), true);
    assertEquals(
      globals.wallboxChargeMode.get(WallboxLocation.Inside),
      WallboxChargeMode.On,
    );

    let saved = { inside: 6, outside: 4 };
    globalThis.fetch = (_input, init) => {
      if (init?.method === "PUT") saved = JSON.parse(String(init.body));
      return Promise.resolve(Response.json(saved));
    };
    const success = await server["handleSetWallboxChargeMode"](request());
    assertEquals(await success.json(), { success: true });
    globals.wallboxChargeMode.clear();
    const restored = await loadPersistentStorage();
    await setChargeMode(
      metrics,
      WallboxLocation.Inside,
      restored.inside!,
      false,
    );
    await setChargeMode(
      metrics,
      WallboxLocation.Outside,
      restored.outside!,
      false,
    );
    assertEquals(
      globals.wallboxChargeMode.get(WallboxLocation.Inside),
      WallboxChargeMode.On,
    );
    assertEquals(
      globals.wallboxChargeMode.get(WallboxLocation.Outside),
      originalModes.get(WallboxLocation.Outside),
    );
  } finally {
    globalThis.fetch = originalFetch;
    globals.wallboxChargeMode = originalModes;
    metrics.getRegister().clear();
  }
});
