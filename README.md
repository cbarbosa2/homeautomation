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

## Configuration

### Environment Variables

- `MQTT_BROKER_URL`: MQTT broker connection string (default: mqtt://localhost:1883)
- `MQTT_USERNAME`: MQTT username (optional)
- `MQTT_PASSWORD`: MQTT password (optional)
- `MQTT_CLIENT_ID`: MQTT client identifier (default: auto-generated)
- `HTTP_TIMEOUT`: HTTP request timeout in milliseconds (default: 30000)
- `PROMETHEUS_PORT`: Prometheus metrics server port (default: 9090)

## Usage Examples

### MQTT Operations

```typescript
// Publishing to MQTT
await mqttClient.publish("home/lights/living-room", "on");
await mqttClient.publishJson("home/sensors/temperature", { value: 22.5, unit: "C" });

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
  action: "toggle"
});
```

### Custom Metrics

```typescript
// Increment counters
metrics.incrementCounter("device_actions_total", { device: "light", action: "on" });

// Set gauge values
metrics.setGauge("temperature_celsius", 22.5, { location: "living_room" });

// Record timing
const endTimer = metrics.startTimer("operation_duration_seconds");
// ... perform operation
endTimer();
```

## Monitoring

- **Health check**: `http://localhost:9090/health`
- **Metrics endpoint**: `http://localhost:9090/metrics`

### Default Metrics

- `homeautomation_automation_cycles_total`: Total automation cycles
- `homeautomation_mqtt_messages_received_total`: MQTT messages received
- `homeautomation_mqtt_messages_sent_total`: MQTT messages sent
- `homeautomation_http_requests_total`: HTTP requests made
- `homeautomation_errors_total`: Total errors by type
- `homeautomation_mqtt_connection_status`: MQTT connection status
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