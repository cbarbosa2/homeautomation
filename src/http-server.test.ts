import { test } from "node:test";
import { deepStrictEqual, equal, match, rejects } from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";
import { HttpServer } from "./http-server.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { scheduler } from "./task-scheduler.ts";
import { CONTROL_PATHS, controlTelemetry } from "./control-telemetry.ts";
import {
  unknownDischargeStatus,
  type BatteryDischargeStatus,
} from "./power-controller/battery-support-controller.ts";
import { Temporal } from "./temporal.ts";

// Exercise the real TCP adapter without starting MQTT or scheduled automation.
test("Node HTTP adapter preserves dashboard, APIs, metrics and request bodies", async () => {
  const metrics = new PrometheusMetrics();
  const server = new HttpServer(metrics);
  const originalRequest = globalThis.Request;
  const originalResponse = globalThis.Response;
  const port = await server.start(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    equal(globalThis.Request, originalRequest);
    equal(globalThis.Response, originalResponse);
    equal(await (await fetch(`${base}/health`)).text(), "OK");
    const dashboard = await fetch(`${base}/`);
    equal(dashboard.status, 200);
    match(dashboard.headers.get("content-type") ?? "", /text\/html/);
    const html = await dashboard.text();
    equal(html.includes("__BUILD_TIMESTAMP__"), false);
    for (const location of ["inside", "outside"]) {
      match(
        html,
        new RegExp(
          `<select id="${location}-mode"[^>]*><option value="1">Manual</option><option value="2">Sun</option><option value="3">Reserve</option><option value="4">Battery</option><option value="5">Night</option><option value="6">Max</option></select>`,
        ),
      );
    }
    const telemetry = await fetch(`${base}/metrics`);
    equal(telemetry.status, 200);
    match(await telemetry.text(), /mqtt_connection_status/);
    deepStrictEqual(await (await fetch(`${base}/api/tasks`)).json(), []);
    deepStrictEqual(await (await fetch(`${base}/api/bmw-soc`)).json(), null);
    const modes = await fetch(`${base}/api/wallbox-charge-mode`);
    equal(modes.status, 200);
    equal(modes.headers.get("cache-control"), "no-store");
    deepStrictEqual(await modes.json(), {
      Inside: 2,
      Outside: 2,
      preferredLocation: "Inside",
    });
    let calls = 0;
    scheduler.cron("HTTP test task", "0 0 1 1 *", () => {
      calls++;
    });
    const trigger = await fetch(`${base}/api/trigger`, {
      method: "POST",
      body: JSON.stringify({ taskName: "HTTP test task" }),
    });
    deepStrictEqual(await trigger.json(), { success: true });
    equal(calls, 1);
    const invalid = await fetch(`${base}/api/wallbox-charge-mode`, {
      method: "POST",
      body: JSON.stringify({ location: "invalid", value: 5 }),
    });
    equal(invalid.status, 400);
    const malformed = await fetch(`${base}/api/trigger`, {
      method: "POST",
      body: "{",
    });
    equal(malformed.status, 500);
    equal((await fetch(`${base}/missing`)).status, 404);
  } finally {
    scheduler.terminateAll();
    await server.stop();
    metrics.getRegister().clear();
  }
});

test("battery API exposes fresh SOC independently and clears invalid, expired and disconnected readings", async (context) => {
  let now = Temporal.Instant.from("2026-11-07T12:00:00Z");
  context.mock.method(Temporal.Now, "instant", () => now);
  const metrics = new PrometheusMetrics();
  const server = new HttpServer(metrics);
  const port = await server.start(0);
  const url = `http://127.0.0.1:${port}/api/battery`;
  const read = async () => {
    const response = await fetch(url);
    equal(response.status, 200);
    equal(response.headers.get("cache-control"), "no-store");
    const { discharge, ...readings } = await response.json();
    deepStrictEqual(discharge, {
      state: "unknown",
      reason: "Discharge has not been checked yet.",
    });
    return readings;
  };
  controlTelemetry.invalidate();

  try {
    deepStrictEqual(await read(), { soc: null, minSoc: null });
    controlTelemetry.record(CONTROL_PATHS.batterySOC, { value: 72.5 });
    deepStrictEqual(await read(), { soc: 72.5, minSoc: null });
    controlTelemetry.record(CONTROL_PATHS.batteryMinSOC, { value: 30 });
    deepStrictEqual(await read(), { soc: 72.5, minSoc: 30 });
    controlTelemetry.record(CONTROL_PATHS.batterySOC, { value: 0 });
    controlTelemetry.record(CONTROL_PATHS.batteryMinSOC, { value: 0 });
    deepStrictEqual(await read(), { soc: 0, minSoc: 0 });

    for (const invalid of [-1, 101, NaN, Infinity, "72", null]) {
      controlTelemetry.record(CONTROL_PATHS.batterySOC, { value: invalid });
      deepStrictEqual(await read(), { soc: null, minSoc: 0 });
    }
    controlTelemetry.record(CONTROL_PATHS.batterySOC, { value: 100 });
    controlTelemetry.record(CONTROL_PATHS.batteryMinSOC, { value: 101 });
    deepStrictEqual(await read(), { soc: 100, minSoc: null });
    controlTelemetry.record(CONTROL_PATHS.batteryMinSOC, { value: 30 });

    now = now.add({ seconds: 60 });
    deepStrictEqual(await read(), { soc: 100, minSoc: 30 });
    now = now.add({ nanoseconds: 1 });
    deepStrictEqual(await read(), { soc: null, minSoc: null });
    controlTelemetry.record(CONTROL_PATHS.batteryMinSOC, { value: 5 });
    deepStrictEqual(await read(), { soc: null, minSoc: 5 });

    controlTelemetry.record(CONTROL_PATHS.batterySOC, { value: 80 });
    controlTelemetry.invalidate();
    deepStrictEqual(await read(), { soc: null, minSoc: null });
    equal((await fetch(url, { method: "POST" })).status, 404);
  } finally {
    controlTelemetry.invalidate();
    await server.stop();
    metrics.getRegister().clear();
  }
});

test("HTTP bind failures reject startup", async () => {
  const metrics = new PrometheusMetrics();
  const first = new HttpServer(metrics);
  const second = new HttpServer(metrics);
  const port = await first.start(0);
  try {
    await rejects(() => second.start(port), { code: "EADDRINUSE" });
  } finally {
    await second.stop();
    await first.stop();
    metrics.getRegister().clear();
  }
});

test("HTTP shutdown closes a stalled connection at its deadline", async (context) => {
  const metrics = new PrometheusMetrics();
  const server = new HttpServer(metrics);
  const port = await server.start(0);
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => {});
  try {
    await once(socket, "connect");
    socket.write(
      "POST /api/trigger HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{",
    );
    // Let the real HTTP parser enter request-body handling before controlling timers.
    await new Promise((resolve) => setTimeout(resolve, 20));
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const stopped = server.stop();
    context.mock.timers.tick(5000);
    await stopped;
    await server.stop();
  } finally {
    context.mock.timers.reset();
    socket.destroy();
    await server.stop();
    metrics.getRegister().clear();
  }
});

test("battery API reads live controller discharge status on every request", async () => {
  let discharge: BatteryDischargeStatus = unknownDischargeStatus();
  const metrics = new PrometheusMetrics();
  const server = new HttpServer(metrics, () => discharge);
  const port = await server.start(0);
  try {
    for (const state of [
      "unknown",
      "checking",
      "confirmed",
      "blocked",
      "unknown",
    ] as const) {
      discharge = { state, reason: `Controller reports ${state}.` };
      const response = await fetch(`http://127.0.0.1:${port}/api/battery`);
      equal(response.headers.get("cache-control"), "no-store");
      deepStrictEqual((await response.json()).discharge, discharge);
    }
  } finally {
    await server.stop();
    metrics.getRegister().clear();
  }
});
