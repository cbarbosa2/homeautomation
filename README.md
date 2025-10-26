# Home Automation System

A background service for home automation built with Deno, featuring MQTT communication, HTTP API calls, and Prometheus metrics.

## Features

- 🔄 Auto-reload during development
- 📡 MQTT client for device communication
- 🌐 HTTP client for API integration
- 📊 Prometheus metrics export
- 🏠 Background service operation
- 🔧 Environment-based configuration

## Quick Start

1. **Setup environment**:

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

2. **Development mode** (with auto-reload):

   ```bash
   deno task dev
   ```

3. **Production mode**:
   ```bash
   deno task start
   ```

## Installation and Management

Inside the bee.local server

### Install the service

```
sudo cp homeautomation.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable homeautomation
sudo systemctl start homeautomation
```

### Check status

```
sudo systemctl status homeautomation
```

#### View logs

```
sudo journalctl -u homeautomation -f
```

### Stop/start/restart

```
sudo systemctl stop homeautomation
sudo systemctl start homeautomation
sudo systemctl restart homeautomation
```

### Disable auto-start

```
sudo systemctl disable homeautomation
```

## Configuration

### Environment Variables

- `MQTT_BROKER_URL`: MQTT broker connection string (default: mqtt://localhost:1883)
- `HTTP_TIMEOUT`: HTTP request timeout in milliseconds (default: 30000)
- `PROMETHEUS_PORT`: Prometheus metrics server port (default: 1881)

## Deploy changes

Make sure you first commit and push your changes to Git then run the `deploy.sh` file.

But if you just want to do a quick test you may skip Git and run `deploy-dev.sh` which will
copy your local files directly to the server.

NOTE: Make sure you have passwordless sudo configured. If not configure like this:

```
ssh carlos@bee.local
sudo visudo
```

Add the line: `carlos ALL=(ALL) NOPASSWD: /bin/systemctl`

## Usage Examples

### MQTT Operations

```typescript
// Publishing to MQTT
await mqttClient.publish("home/lights/living-room", "on");
await mqttClient.publishJson("home/sensors/temperature", {
  value: 22.5,
  unit: "C",
});

// Subscribing to topics
await mqttClient.subscribe("home/sensors/+");
```

### HTTP Requests

```typescript
// GET request
const response = await httpClient.get("https://api.weather.com/current");

// POST with JSON data
await httpClient.post("https://api.home.local/devices", {
  device: "light",
  action: "toggle",
});
```

### Custom Metrics

```typescript
// Increment counters
metrics.incrementCounter("device_actions_total", {
  device: "light",
  action: "on",
});

// Set gauge values
metrics.setGauge("temperature_celsius", 22.5, { location: "living_room" });

// Record timing
const endTimer = metrics.startTimer("operation_duration_seconds");
// ... perform operation
endTimer();
```

## Monitoring

- **Task Dashboard**: `http://localhost:1881/` (local) / `http://bee.local:1881/` (server)
- **Health check**: `http://localhost:1881/health` (local) / `http://bee.local:1881/health` (server)
- **Metrics endpoint**: `http://localhost:1881/metrics` (local) / `http://bee.local:1881/metrics` (server)

### Task Dashboard

The task dashboard provides a web interface to view and manage scheduled tasks:

- View all scheduled tasks (cron and interval-based)
- See task schedules at a glance
- Manually trigger any task with a single click
- Real-time feedback on task execution status

Access the dashboard at `http://localhost:1881/` during development or `http://bee.local:1881/` on the server.

### Default Metrics

- `automation_cycles_total`: Total automation cycles
- `mqtt_messages_received_total`: MQTT messages received
- `mqtt_messages_sent_total`: MQTT messages sent
- `http_requests_total`: HTTP requests made
- `errors_total`: Total errors by type
- `mqtt_connection_status`: MQTT connection status
- Plus standard Node.js metrics (memory, CPU, etc.)

## Project Structure

```
src/
├── main.ts          # Application entry point
├── mqtt.ts          # MQTT client implementation
├── http.ts          # HTTP client implementation
└── prometheus.ts    # Prometheus metrics
```

## Development

The application runs with auto-reload in development mode. Any changes to TypeScript files will automatically restart the application.

## Graceful Shutdown

The application handles SIGINT and SIGTERM signals for graceful shutdown, ensuring:

- MQTT connections are properly closed
- Prometheus server is stopped
- All resources are cleaned up
