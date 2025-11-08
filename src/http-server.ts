import { HTTP_PORT } from "./constants.ts";
import { scheduler } from "./task-scheduler.ts";
import { globals, WallboxLocation, WallboxChargeMode } from "./globals.ts";
import { ChargeModeSwitcher } from "./tasks/charge-mode-switcher.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";

export class HttpServer {
  private server: Deno.HttpServer | null = null;
  private metrics: PrometheusMetrics;

  constructor(metrics: PrometheusMetrics) {
    this.metrics = metrics;
  }

  start(): void {
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

    console.log(`🌐 HTTP server starting on port ${HTTP_PORT}`);
    this.server = Deno.serve({ port: HTTP_PORT }, handler);
    console.log(
      `📊 Metrics available at: http://localhost:${HTTP_PORT}/metrics`
    );
    console.log(`📋 Task dashboard at: http://localhost:${HTTP_PORT}/`);
  }

  async stop(): Promise<void> {
    if (this.server) {
      try {
        // Force shutdown after 5 seconds
        const shutdownPromise = this.server.shutdown();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Shutdown timeout")), 5000)
        );

        await Promise.race([shutdownPromise, timeoutPromise]);
        console.log("🌐 HTTP server stopped");
      } catch (_) {
        console.log("🌐 HTTP server force stopped");
        // Force exit if graceful shutdown fails
      }
    }
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
      const html = await Deno.readTextFile("./static/index.html");
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      console.error("Failed to read index.html:", error);
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
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const success = await scheduler.triggerTask(taskName);
      return new Response(JSON.stringify({ success }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: String(error) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  private handleGetWallboxChargeMode(): Response {
    // Return current charge mode for inside and outside
    const inside =
      globals.wallboxChargeMode.get(WallboxLocation.Inside) ??
      WallboxChargeMode.Off;
    const outside =
      globals.wallboxChargeMode.get(WallboxLocation.Outside) ??
      WallboxChargeMode.Off;
    return new Response(JSON.stringify({ Inside: inside, Outside: outside }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleSetWallboxChargeMode(
    request: Request
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
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      new ChargeModeSwitcher(this.metrics).setChargeMode(location, value);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: String(error) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }
}
