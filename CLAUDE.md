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

The `HomeAutomationApp` class orchestrates the core services:

1. Connects MQTT client and starts Prometheus server
2. Runs a main loop every 5 seconds calling `processAutomationTasks()`
3. Handles graceful shutdown on SIGINT/SIGTERM

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

## Data Models & Schema

This section documents the core data structures so you don't need to read through source files to understand the schema.

### Enums

**`WallboxChargeMode`** (`src/globals.ts`) — charge strategy for each EV wallbox:

| Value | Name | Meaning |
|-------|------|---------|
| 1 | `Off` | No charging |
| 2 | `SunOnly` | Charge only from excess solar |
| 3 | `ESSOnly` | Charge only from battery (off-peak) |
| 4 | `Night` | Charge during night/off-peak hours |
| 5 | `On` | Always charge at maximum |
| 6 | `Manual` | Manual mode (controlled externally) |

**`WallboxStatus`** (`src/globals.ts`) — real-time wallbox state reported by Victron:

| Value | Name |
|-------|------|
| 0 | `Disconnected` |
| 1 | `Connected` |
| 2 | `Charging` |
| 3 | `Charged` |
| 4 | `WaitingForSun` |
| 5 | `WaitingForRFID` |
| 6 | `WaitingForStart` |
| 7 | `LowSOC` |
| 20 | `ChargingLimit` |
| 21 | `StartCharging` |
| 22 | `SwitchingTo3Phase` |
| 23 | `SwitchingTo1Phase` |
| 24 | `StopCharging` |

**`WallboxLocation`** (`src/globals.ts`):

| Value | Name |
|-------|------|
| 0 | `Inside` |
| 1 | `Outside` |

**`CommandType`** (`src/power-controller/power-controller.ts`):

- `InsideCurrent` — set inside wallbox charging current
- `InsideStartStop` — start/stop inside wallbox
- `OutsideCurrent` — set outside wallbox charging current
- `OutsideStartStop` — start/stop outside wallbox
- `BatteryMaxChargePower` — set battery maximum charge power

### Interfaces

**`GlobalState`** (`src/globals.ts`) — main in-memory application state:

```typescript
{
  primaryWallboxLocation: WallboxLocation | undefined,
  solarForecastNextDays: number[],        // kWh/day; index 0=today, 1=tomorrow, ...
  victronNextDays: number[],              // kWh/day from Victron VRM forecast
  omieEntries: OmieEntry[],              // electricity spot prices
  gridPower: number | undefined,          // watts (positive = import)
  batteryMinSOC: number | undefined,      // %
  batterySOC: number | undefined,         // %
  batteryPower: number | undefined,       // watts
  batteryMaxChargePower: number | undefined, // watts
  pvInverterPower: number | undefined,    // watts
  pvChargerPower: number | undefined,     // watts
  wallboxPower: Map<WallboxLocation, number>,              // watts
  wallboxCurrent: Map<WallboxLocation, number>,            // amps (measured)
  wallboxVictronStatus: Map<WallboxLocation, WallboxStatus>,
  wallboxSetCurrent: Map<WallboxLocation, number>,         // amps (target)
  wallboxChargeMode: Map<WallboxLocation, WallboxChargeMode>,
}
```

**`OmieEntry`** (`src/globals.ts`) — OMIE electricity spot price entry:

```typescript
{ date: Temporal.PlainDateTime, price: number }  // price in cents/kWh
```

**`StorageValue`** (`src/persistent-storage.ts`) — persisted wallbox charge modes:

```typescript
{ inside: number, outside: number }  // values are WallboxChargeMode integers
```

**`CalculatedTargetResults`** (`src/power-controller/dynamic-power-calculator.ts`):

```typescript
{
  insideWallboxAmps: number | undefined,
  outsideWallboxAmps: number | undefined,
  batteryChargePower: number | undefined,
  newPrimaryWallboxLocation: WallboxLocation | undefined,
}
```

**`InputState`** (`src/power-controller/dynamic-power-calculator.ts`) — snapshot fed to the power calculator:

```typescript
{
  primaryWallboxLocation: WallboxLocation | undefined,
  gridPower: number | undefined,
  batteryMinSOC: number | undefined,
  batterySOC: number | undefined,
  batteryPower: number | undefined,
  pvInverterPower: number | undefined,
  wallboxPower: Map<WallboxLocation, number>,
  wallboxVictronStatus: Map<WallboxLocation, WallboxStatus>,
  wallboxChargeMode: Map<WallboxLocation, WallboxChargeMode>,
  hourOfDay: number,
}
```

### Persistent Storage (jsonbin.io)

URL: `https://api.jsonbin.io/v3/b/{JSONBIN_ID}`

Stores wallbox charge mode preferences across restarts:

```json
{ "inside": 2, "outside": 2 }
```

Values are `WallboxChargeMode` integers. Loaded on startup; updated whenever charge mode changes.

### MQTT Topics

All Victron topics share the device serial prefix `102c6b9cfab9`.
- **Read** (subscribe): `N/102c6b9cfab9/<path>`
- **Write** (publish): `W/102c6b9cfab9/<path>`

All payloads are JSON `{ "value": <number> }` unless noted otherwise.

#### Battery (`battery/512/...`)

| Topic path | Direction | Meaning |
|-----------|-----------|---------|
| `battery/512/Dc/0/Power` | R | Battery power (W) → `globals.batteryPower` |
| `battery/512/Soc` | R | State of charge (%) → `globals.batterySOC` |
| `battery/512/Dc/0/Current` | R | Current (A) |
| `battery/512/Dc/0/Voltage` | R | Voltage (V) |
| `battery/512/Dc/0/Temperature` | R | Temperature (°C) |
| `battery/512/System/MaxCellVoltage` | R | Max cell voltage (V) |
| `battery/512/System/MinCellVoltage` | R | Min cell voltage (V) |

#### Settings (`settings/0/Settings/CGwacs/...`)

| Topic path | Direction | Meaning |
|-----------|-----------|---------|
| `settings/0/Settings/CGwacs/MaxChargePower` | R/W | Battery max charge power (W) → `globals.batteryMaxChargePower` |
| `settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit` | R/W | Min SOC limit (%) → `globals.batteryMinSOC` |

#### Grid & PV (`system/0/...`)

| Topic path | Direction | Meaning |
|-----------|-----------|---------|
| `system/0/Ac/Grid/L1/Power` | R | Grid power (W) → `globals.gridPower` |
| `system/0/Ac/Consumption/L1/Power` | R | Total consumption (W) |
| `system/0/Ac/PvOnGrid/L1/Power` | R | PV inverter power (W) → `globals.pvInverterPower` |
| `system/0/Dc/Pv/Power` | R | PV charger power (W) → `globals.pvChargerPower` |

#### EV Chargers (Wallboxes)

Inside wallbox ID = **40**, Outside wallbox ID = **41**.

| Topic path | Direction | Meaning |
|-----------|-----------|---------|
| `evcharger/{id}/Ac/Power` | R | Wallbox power (W) |
| `evcharger/{id}/Status` | R | `WallboxStatus` value |
| `evcharger/{id}/Current` | R | Measured current (A) |
| `evcharger/{id}/SetCurrent` | R/W | Target current (A) |
| `evcharger/{id}/StartStop` | W | 1 = start, 0 = stop |

#### Other Devices

| Topic | Meaning |
|-------|---------|
| `N/102c6b9cfab9/temperature/24/Temperature` | Shed temperature (°C) |
| `shellyplusi4-083af2013a04/events/rpc` | Wall switch button events |
| `R/102c6b9cfab9/system/0/Serial` | Keep-alive / wake message |

Wall switch payload: `{ params: { events: [{ id: number, event: string }] } }`
- Button IDs 0–1 → Inside wallbox; IDs 2–3 → Outside wallbox
- Event strings: `single_push`, `double_push`, `triple_push` (maps to `WallboxChargeMode`)

### Event System

Internal events defined in `src/globals.ts`:

| Event | Payload | Triggered when |
|-------|---------|---------------|
| `wallboxCurrentInsideUpdated` | `number` (amps) | Inside wallbox `SetCurrent` MQTT message received |
| `wallboxCurrentOutsideUpdated` | `number` (amps) | Outside wallbox `SetCurrent` MQTT message received |
| `wallSwitchUpdated` | `{ params: { events: [{ id, event }] } }` | Shelly wall switch RPC event received |

### Power Control Constants (`src/power-controller/power-constants.ts`)

| Constant | Value | Meaning |
|----------|-------|---------|
| `MAX_GRID_AMPS` | 28 A | Maximum grid import current |
| `BATTERY_FULL_BUMP_AMPS` | 8 A | Extra wallbox amps allowed when battery > 95% SOC |
| `DETECT_SUN_MIN_PV_POWER` | 200 W | Minimum PV power to consider "sun available" |
| `MIN_BATTERY_CHARGE_POWER` | 200 W | Minimum battery charge power |
| `MAX_BATTERY_CHARGE_POWER` | 6720 W | Maximum battery charge power (28 A × 240 V) |
| `MAX_AMPS_PER_LOCATION` | Inside=18 A, Outside=32 A | Per-wallbox maximum current |
| `WALLBOX_MIN_CHARGE_AMPS` | 7 A | Minimum current to start/maintain wallbox charging |
| `SYSTEM_VOLTAGE` | 240 V | Nominal AC system voltage (used for W↔A conversion) |
