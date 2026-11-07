import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { HTTP_PORT } from "./constants.ts";
import { logError, logInfo } from "./logger.ts";
import { scheduler } from "./task-scheduler.ts";
import { globals, WallboxChargeMode, WallboxLocation } from "./globals.ts";
import type { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { setChargeMode } from "./charge-mode/charge-mode-switcher.ts";
import { getVehicleSoc } from "./bmw-cardata/bmw-cardata.ts";
import { CONTROL_PATHS, controlTelemetry } from "./control-telemetry.ts";

export class HttpServer {
  private server: Server | null = null;
  private metrics: PrometheusMetrics;
  private readonly buildTimestamp: string;

  constructor(metrics: PrometheusMetrics) {
    this.metrics = metrics;
    this.buildTimestamp = this.readBuildTimestamp();
  }

  private readBuildTimestamp(): string {
    try {
      return readFileSync("./build-timestamp.txt", "utf8").trim();
    } catch {
      return "unknown";
    }
  }

  async start(port = HTTP_PORT): Promise<number> {
    const handler = async (request: Request): Promise<Response> => {
      const url = new URL(request.url);

      // Metrics endpoint
      if (url.pathname === "/metrics") {
        return await this.handleMetrics();
      }

      // Health check endpoint
      if (url.pathname === "/health") {
        return this.handleHealth();
      }

      // Task dashboard
      if (url.pathname === "/") {
        return await this.handleTaskDashboard();
      }

      // Task API endpoints
      if (url.pathname === "/api/tasks") {
        return this.handleGetTasks();
      }

      if (url.pathname === "/api/battery" && request.method === "GET") {
        return Response.json(
          {
            soc: controlTelemetry.value(CONTROL_PATHS.batterySOC) ?? null,
            minSoc: controlTelemetry.value(CONTROL_PATHS.batteryMinSOC) ?? null,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (url.pathname === "/api/bmw-soc" && request.method === "GET") {
        const value = getVehicleSoc();
        return Response.json(
          value
            ? {
                percent: value.percent,
                observedAt: value.observedAt.toString(),
                source: value.source,
              }
            : null,
        );
      }

      if (url.pathname === "/api/trigger" && request.method === "POST") {
        return await this.handleTriggerTask(request);
      }

      // Wallbox charge mode API endpoints
      if (
        url.pathname === "/api/wallbox-charge-mode" &&
        request.method === "GET"
      ) {
        return this.handleGetWallboxChargeMode();
      }
      if (
        url.pathname === "/api/wallbox-charge-mode" &&
        request.method === "POST"
      ) {
        return await this.handleSetWallboxChargeMode(request);
      }

      return new Response("Not Found", { status: 404 });
    };

    logInfo(`🌐 HTTP server starting on port ${port}`);
    await new Promise<void>((resolve, reject) => {
      const server = createServer(
        getRequestListener(handler, { overrideGlobalObjects: false }),
      );
      this.server = server;
      const onError = (error: Error) => {
        this.server = null;
        reject(error);
      };
      server.once("error", onError);
      server.once("listening", () => {
        server.removeListener("error", onError);
        resolve();
      });
      server.listen(port);
    });
    const address = this.server?.address();
    if (!address || typeof address === "string") {
      throw new Error("HTTP server has no TCP address");
    }
    logInfo(
      `📊 Metrics available at: http://localhost:${address.port}/metrics`,
    );
    logInfo(`📋 Task dashboard at: http://localhost:${address.port}/`);
    return address.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.closeAllConnections();
        logInfo("🌐 HTTP server force stopped");
      }, 5000);
      server.close((error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      });
    });
    logInfo("🌐 HTTP server stopped");
  }

  private async handleMetrics(): Promise<Response> {
    const metrics = await this.metrics.getRegister().metrics();
    return new Response(metrics, {
      headers: { "Content-Type": this.metrics.getRegister().contentType },
    });
  }

  private handleHealth(): Response {
    return new Response("OK", { status: 200 });
  }

  private async handleTaskDashboard(): Promise<Response> {
    try {
      let html = await readFile("./static/index.html", "utf8");
      html = html.replace("__BUILD_TIMESTAMP__", this.buildTimestamp);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      logError(`Failed to read index.html: ${String(error)}`);
      return new Response("Dashboard not found", { status: 500 });
    }
  }

  private handleGetTasks(): Response {
    const tasks = scheduler.getAllTaskInfo();
    const taskData = tasks.map((task) => ({
      name: task.name,
      type: task.type,
      schedule: task.schedule,
    }));
    return new Response(JSON.stringify(taskData), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleTriggerTask(request: Request): Promise<Response> {
    try {
      const body = await request.json();
      const taskName = body.taskName;
      if (!taskName) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing taskName" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const success = await scheduler.triggerTask(taskName);
      return new Response(JSON.stringify({ success }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: String(error) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  private handleGetWallboxChargeMode(): Response {
    // Return current modes and the preference restored at startup.
    const inside =
      globals.wallboxChargeMode.get(WallboxLocation.Inside) ??
      WallboxChargeMode.Off;
    const outside =
      globals.wallboxChargeMode.get(WallboxLocation.Outside) ??
      WallboxChargeMode.Off;
    return Response.json(
      {
        Inside: inside,
        Outside: outside,
        preferredLocation:
          globals.preferredWallboxLocation === WallboxLocation.Outside
            ? "Outside"
            : "Inside",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  private async handleSetWallboxChargeMode(
    request: Request,
  ): Promise<Response> {
    try {
      const body = await request.json();
      const locationStr = body.location;
      const value = Number(body.value);
      let location: WallboxLocation | undefined;
      if (locationStr === "Inside") location = WallboxLocation.Inside;
      else if (locationStr === "Outside") location = WallboxLocation.Outside;
      if (
        location === undefined ||
        !Object.values(WallboxChargeMode).includes(value)
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid location or value",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      await setChargeMode(this.metrics, location, value);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: String(error) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }
}
