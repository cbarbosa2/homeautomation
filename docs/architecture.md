# Architecture

The application runs as a Deno background service, combining MQTT device communication, scheduled automation, external API requests, and an HTTP dashboard with Prometheus metrics.

## Application lifecycle

[bootstrap.ts](../src/bootstrap.ts) loads `.env` before importing [main.ts](../src/main.ts). `HomeAutomationApp` loads persisted charge modes, connects MQTT, starts the HTTP server, and registers scheduled tasks and wall-switch handlers. SIGINT and SIGTERM stop scheduling, disconnect MQTT, and shut down HTTP.

[task-scheduler.ts](../src/task-scheduler.ts) manages intervals and cron jobs. Dynamic power control runs every second; forecast and price updates use cron schedules defined in `main.ts`. A UTC minute cron calls the SOC task, which evaluates Lisbon time and holds evening retries in memory. Interval tasks do not overlap while awaiting work.

## Components

- **MQTT:** [mqtt-client.ts](../src/mqtt-client.ts) uses the npm `mqtt` package, reconnects every five seconds, publishes strings or JSON, and parses incoming JSON with a text fallback. It records connection status and message counts.
- **Device state:** [mqtt-to-prometheus-task.ts](../src/tasks/mqtt-to-prometheus-task.ts) maps telemetry into [globals.ts](../src/globals.ts) and metrics. [control-telemetry.ts](../src/control-telemetry.ts) independently validates and timestamps control readings, exposes fresh snapshots, and tracks observed charging starts.
- **Power control:** [dynamic-power-calculator.ts](../src/power-controller/dynamic-power-calculator.ts) calculates wallbox and battery targets and priority. [command-builder.ts](../src/power-controller/command-builder.ts) smooths increases, reserves unacknowledged allocations, and creates reductions before increases; [power-controller.ts](../src/power-controller/power-controller.ts) publishes them over MQTT.
- **Charge modes:** [charge-mode-switcher.ts](../src/charge-mode/charge-mode-switcher.ts) updates modes and persists them through [persistent-storage.ts](../src/persistent-storage.ts). Modes can change through the HTTP API or wall switches.
- **External APIs:** [load-forecast-task.ts](../src/tasks/load-forecast-task.ts), [omie-proxy.ts](../src/omie/omie-proxy.ts), and persistent storage use `fetch` directly. There is no shared HTTP client implementing timeout/retry policies.
- **Battery target:** [set-soc-limit-task.ts](../src/tasks/set-soc-limit-task.ts) calculates the evening minimum SOC and resets it in the morning.
- **HTTP and metrics:** [http-server.ts](../src/http-server.ts) uses `Deno.serve` for the dashboard, control APIs, health, and metrics. [prometheus.ts](../src/prometheus/prometheus.ts) manages the `prom-client` registry; [metrics.ts](../src/prometheus/metrics.ts) defines application metrics.

See [automation-rules.md](automation-rules.md) for intended automation behavior and [operations.md](operations.md) for configuration and monitoring.
