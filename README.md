# Home Automation System

A background service for home automation built with Deno, featuring MQTT communication, HTTP API calls, and Prometheus metrics.

## Features

- 🔄 Auto-reload during development
- 📡 MQTT client for device communication
- 🌐 HTTP client for API integration
- 📊 Prometheus metrics export
- 🏠 Background service operation
- 🔧 Environment-based configuration
- Logging in Logflare.app

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

In service:

```
sudo journalctl -u homeautomation -f
```

In cloud access https://logflare.app/sources/37017 with email me@carlosb.com

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
- `HTTP_PORT`: HTTP / Prometheus metrics server port (default: 1881)

## Deploy changes

Make sure you first commit and push your changes to Git then run the `deploy-git.sh` file.

But if you just want to do a quick test you may skip Git and run `deploy-local.sh` which will
copy your local files directly to the server.

NOTE: Make sure you have passwordless sudo configured. If not configure like this:

```
ssh carlos@bee.local
sudo visudo
```

Add the line: `carlos ALL=(ALL) NOPASSWD: /bin/systemctl`

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

## Development

The application runs with auto-reload in development mode. Any changes to TypeScript files will automatically restart the application.

## Graceful Shutdown

The application handles SIGINT and SIGTERM signals for graceful shutdown, ensuring:

- MQTT connections are properly closed
- Prometheus server is stopped
- All resources are cleaned up

## Testing

Unit tests are provided for core logic, including the dynamic power calculation:

- Function: `calculateTargetAmpsAndPriority` (see `src/tasks/dynamic-power-calculator.test.ts`)
- Run all tests:

  ```bash
  deno test src/tasks/dynamic-power-calculator.test.ts --allow-read --allow-env --allow-write
  ```

Tests use [@std/assert](https://jsr.io/@std/assert) for assertions. You can add more tests for other modules as needed.
