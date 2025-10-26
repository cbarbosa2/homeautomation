# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Deno-based home automation system that runs as a background service. The application integrates three core components:

- **MQTT Client** (`src/mqtt.ts`) - Handles device communication via MQTT protocol
- **HTTP Client** (`src/http.ts`) - Makes API calls to external services with retry logic
- **Prometheus Metrics** (`src/prometheus.ts`) - Exports metrics and provides health endpoints

## Development Commands

```bash
# Development with auto-reload
deno task dev

# Production mode
deno task start

# Type checking (Deno has built-in TypeScript support)
deno check src/*.ts
```

**Note:** The development and production tasks include `--allow-read=.` to ensure the `.env` file can be loaded from the project directory.

## Environment Setup

Before running the application:

```bash
cp .env.example .env
# Edit .env with your MQTT broker details and other configuration
```

## Architecture

### Main Application Flow

The `HomeAutomationApp` class (`src/main.ts`) orchestrates the three core services:

1. Loads environment variables from `.env`
2. Connects MQTT client and starts Prometheus server
3. Runs a main loop every 5 seconds calling `processAutomationTasks()`
4. Handles graceful shutdown on SIGINT/SIGTERM

### Core Services

**MQTT Client** (`src/mqtt.ts`):

- Uses npm mqtt package (v5.10+) for reliable connectivity
- Auto-reconnects with 5-second intervals
- Handles both string and JSON message publishing
- Processes incoming messages with automatic JSON parsing fallback
- Connection status tracking for metrics

**HTTP Client** (`src/http.ts`):

- Configurable timeout and retry logic (3 retries by default)
- Automatic JSON/text response parsing based on Content-Type
- Only retries on 5xx, 429, or 408 status codes
- Built-in health check functionality

**Prometheus Metrics** (`src/prometheus.ts`):

- Uses Deno's built-in HTTP server (`Deno.serve`)
- Serves metrics on `/metrics` endpoint (default port 1881)
- Health check available at `/health`
- Pre-configured counters, gauges, and histograms for automation cycles, MQTT messages, HTTP requests, and errors

## Key Configuration

Environment variables (see `.env.example`):

- `MQTT_BROKER_URL`: MQTT broker connection string
- `MQTT_USERNAME`/`MQTT_PASSWORD`: MQTT credentials
- `HTTP_TIMEOUT`: HTTP request timeout in milliseconds
- `HTTP_PORT`: HTTP server port

## Monitoring

- Metrics: `http://localhost:1881/metrics`
- Health: `http://localhost:1881/health`

Default metrics include automation cycles, MQTT message counts, HTTP request stats, error counts, and connection status.
