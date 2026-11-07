import { test } from "node:test";
import { deepStrictEqual, equal, match, rejects } from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";
import { HttpServer } from "./http-server.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { scheduler } from "./task-scheduler.ts";

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
    equal((await dashboard.text()).includes("__BUILD_TIMESTAMP__"), false);
    const telemetry = await fetch(`${base}/metrics`);
    equal(telemetry.status, 200);
    match(await telemetry.text(), /mqtt_connection_status/);
    deepStrictEqual(await (await fetch(`${base}/api/tasks`)).json(), []);
    deepStrictEqual(await (await fetch(`${base}/api/bmw-soc`)).json(), null);
    const modes = await fetch(`${base}/api/wallbox-charge-mode`);
    equal(modes.status, 200);
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
