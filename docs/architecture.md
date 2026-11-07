# Architecture

The application runs as a Node.js background service compiled from TypeScript, combining MQTT device communication, scheduled automation, external API requests, and an HTTP dashboard with Prometheus metrics.

## Runtime and build

The service runs compiled ESM JavaScript on Node.js 26.13 or newer in the 26.x line. npm installs the lockfile's dependencies; `tsc` checks all source, setup scripts, and tests before emitting production code to `dist/`. Development uses `tsc-watch` with the production configuration. Tests are compiled separately to `.test-dist/` and run with Node's test runner. See [development](development.md) for commands and compiler conventions.

Node's native `process.loadEnvFile()` loads configuration before application imports. Filesystem access and process signals use Node APIs; dates and times use Node's native Temporal through the shared `src/temporal.ts` module. The dashboard remains a static HTML file served by the application. The service runs from the repository root so assets, build timestamps, environment files, and BMW tokens resolve consistently.

## Application lifecycle

[bootstrap.ts](../src/bootstrap.ts) loads `.env` before importing [main.ts](../src/main.ts). `HomeAutomationApp` loads persisted charge modes, connects MQTT, awaits successful HTTP binding, and registers scheduled tasks and wall-switch handlers. SIGINT and SIGTERM stop scheduling, disconnect MQTT, shut down HTTP (forcing remaining connections closed after five seconds), and drain persistence writes. Fatal process exceptions and unhandled rejections are logged and exit unsuccessfully so systemd can restart the service.

[task-scheduler.ts](../src/task-scheduler.ts) manages intervals and cron jobs. Dynamic power control runs every second; forecast and price updates use cron schedules defined in `main.ts`. A UTC minute cron calls the SOC task, which evaluates Lisbon time and holds evening retries in memory. Cron expressions are evaluated in UTC by `node-cron`, with overlapping scheduled runs skipped. Interval tasks execute immediately and do not overlap while awaiting work. Stopping a task destroys its cron handle or clears its interval.

## Components

- **MQTT:** [mqtt-client.ts](../src/mqtt-client.ts) uses the npm `mqtt` package, reconnects every five seconds, publishes strings or JSON, and parses incoming JSON with a text fallback. It records connection status and message counts.
- **Device state:** [mqtt-to-prometheus-task.ts](../src/tasks/mqtt-to-prometheus-task.ts) maps telemetry into [globals.ts](../src/globals.ts) and metrics. [control-telemetry.ts](../src/control-telemetry.ts) independently validates and timestamps control readings, exposes fresh snapshots, and tracks observed charging starts.
- **Power control:** [automatic-charging-cycle.ts](../src/power-controller/automatic-charging-cycle.ts) owns the complete automatic charging cycle, wallbox priority, and one persistent command builder. Scheduling calls its asynchronous `tick()`; overlapping triggers are skipped. Construction supplies telemetry and current-mode readers, a Temporal clock, an MQTT publisher, and the publication-enabled setting. Internally, [dynamic-power-calculator.ts](../src/power-controller/dynamic-power-calculator.ts) calculates allocation and priority, [command-builder.ts](../src/power-controller/command-builder.ts) smooths increases and reserves unacknowledged allocations, and [power-controller.ts](../src/power-controller/power-controller.ts) publishes reductions before increases while rechecking live Manual mode. Priority resets with each cycle instance and is no longer global state.
- **Charge modes:** [charge-mode-switcher.ts](../src/charge-mode/charge-mode-switcher.ts) updates modes and persists them through [persistent-storage.ts](../src/persistent-storage.ts). Modes can change through the HTTP API or wall switches.
- **External APIs:** [load-forecast-task.ts](../src/tasks/load-forecast-task.ts) stores daily values in [solar-forecasts.ts](../src/solar-forecasts/solar-forecasts.ts). The forecast task, [omie-proxy.ts](../src/omie/omie-proxy.ts), [bmw-cardata.ts](../src/bmw-cardata/bmw-cardata.ts), and persistent storage use `fetch` directly. BMW CarData OAuth tokens are refreshed and stored in an ignored local file; a startup task and half-hourly cron read the vehicle SOC for display, metrics, and the inside wallbox's 80% cutoff in Sun Only, ESS Only, and Night modes. There is no shared HTTP client implementing timeout/retry policies.
- **Battery target:** [set-soc-limit-task.ts](../src/tasks/set-soc-limit-task.ts) calculates the evening minimum SOC and resets it in the morning.
- **Logging:** [logger.ts](../src/logger.ts) writes to the console and optionally to Logflare through LogLayer; systemd captures console output in the journal.
- **HTTP and metrics:** [http-server.ts](../src/http-server.ts) uses Node HTTP with the Fetch-compatible `@hono/node-server` adapter for the dashboard, control APIs, health, and metrics. [prometheus.ts](../src/prometheus/prometheus.ts) manages the `prom-client` registry; [metrics.ts](../src/prometheus/metrics.ts) defines application metrics.

See [automation-rules.md](automation-rules.md) for intended automation behavior and [operations.md](operations.md) for configuration and monitoring.

## Automatic charging cycle verification

[Control integration tests](../src/power-controller/control-integration.test.ts) call the same `tick()` as production, using real allocation and command-building logic with controlled telemetry, a Temporal clock, and recording or failing publication adapters. They cover priority across ticks, stale-reading recovery, delayed device confirmation, Lisbon night transitions, mid-publication mode changes, failures, disabled publication, and skipped overlapping triggers. Focused policy and command-builder tests retain their distinct algorithm coverage.

Priority and reservations advance before publication and are not rolled back on failure. A failed publication rejects the tick and aborts all remaining commands; a later tick can run. Disabled publication still advances priority, smoothing, and reservations while logging commands. Fresh device settings and measured power, rather than transport success, release reserved capacity. Minimum SOC scheduling, physical-switch handling, telemetry ingestion, and shutdown behavior remain separate; shutdown does not drain an in-flight cycle.
