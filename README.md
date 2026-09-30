# Home Automation System

A Deno service controlling a home battery and two EV wallboxes through MQTT. It allocates charging power, schedules battery SOC targets in Europe/Lisbon time, fetches solar forecasts and electricity prices, and exposes a dashboard and Prometheus metrics.

## Documentation

- [Automation rules](docs/automation-rules.md): charging modes, priority, battery targets, and grid protection.
- [Architecture](docs/architecture.md): components, scheduling, and application lifecycle.
- [Development](docs/development.md): commands, tests, and Temporal conventions.
- [Operations](docs/operations.md): configuration, [BMW CarData setup](docs/operations.md#bmw-cardata-setup), monitoring, and device assumptions.

## Quick Start

Install Deno and clone this repository. Run commands from the repository root so the application can find `.env` and `static/`.

1. Create the local configuration if you do not already have one:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

2. Edit `.env` for your installation. Set the MQTT connection, API credentials, persistence settings, and both required Victron identifiers:

   - `VICTRON_PORTAL_ID`: the portal ID used in MQTT topics.
   - `VICTRON_INSTALLATION_ID`: the numeric VRM installation ID used for forecasts.

   Neither identifier has a default; missing or invalid values prevent startup. Keep actual identifiers and credentials in the ignored `.env` file. See [configuration](docs/operations.md#configuration) for the complete reference. Leave the optional Logflare credentials unset if you only want console logs.

   The example enables `POWER_CONTROL_ENABLED`. Setting it to `false` logs automatic wallbox and battery-power commands instead of publishing them. Scheduled minimum-SOC updates still publish, so this is not a complete simulation mode.

3. Start development mode with automatic reload:

   ```bash
   deno task dev
   ```

   For operation without file watching:

   ```bash
   deno task start
   ```

To show BMW i3 SOC, complete the optional [BMW CarData setup](docs/operations.md#bmw-cardata-setup) on the host running the service before starting it.

## Development and Tests

```bash
deno task check  # Type-check and run tests
deno task lint   # Lint source files
deno task fmt    # Format source files
deno task test   # Run tests only
```

Tests cover power allocation, command reservations, telemetry freshness, forecast lookup, Lisbon scheduling and DST, configuration, and API parsing. The test task supplies synthetic Victron identifiers; a private `.env` is not required.

Power-control tests live in [src/power-controller/](src/power-controller/), including [dynamic-power-calculator.test.ts](src/power-controller/dynamic-power-calculator.test.ts). See [development](docs/development.md) for direct test invocation and date/time conventions.

## Server Installation and Management

The supplied service and deployment scripts target `carlos@bee.local`, with the repository at `/home/carlos/homeautomation`. The [systemd unit](homeautomation.service) runs as user/group `carlos` and expects Deno at `/usr/bin/deno`. Adjust those paths and the deployment scripts for another host.

Before installing the service, make sure the repository, Deno, and the server's own `.env` are in place. The configuration file should be owned by `carlos` with mode `0600`; configure both Victron identifiers before starting the service.

On the server:

```bash
cd /home/carlos/homeautomation
sudo cp homeautomation.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homeautomation
```

Manage the service with:

```bash
sudo systemctl status homeautomation
sudo journalctl -u homeautomation -f
sudo systemctl stop homeautomation
sudo systemctl start homeautomation
sudo systemctl restart homeautomation
```

To disable automatic startup and stop the running service:

```bash
sudo systemctl disable --now homeautomation
```

Logs go to the console and, under systemd, the journal. Set `LOGLAYER_SOURCE_ID` and `LOGLAYER_API_KEY` to also send logs to your configured Logflare source; `HOST_ID` identifies the host in those logs.

## Deploy Changes

Run deployment commands from the local repository root. They require Deno locally, SSH access to `carlos@bee.local`, and noninteractive sudo permission for the service commands. Git deployment requires Git and a checkout on the server; local deployment requires rsync on both machines.

First validate the changes:

```bash
deno task check
deno task lint
```

For Git deployment, commit and push to `main`, then run:

```bash
bash deploy-git.sh
```

This stops the server's service, pulls `origin/main`, writes a build timestamp, starts the service, and displays its status.

To copy the local working tree, including uncommitted changes:

```bash
bash deploy-local.sh
```

This stops the service, copies files with rsync, and starts it again. It excludes dotfiles, logs, `node_modules`, and deployment scripts. It does not refresh the build timestamp.

Both scripts type-check locally before deployment. Neither transfers your local `.env` or BMW CarData token file. To enable BMW SOC on the server, follow [BMW CarData setup](docs/operations.md#bmw-cardata-setup) on `bee.local` after the code is deployed. Update `/home/carlos/homeautomation/.env` separately before deploying changes that require new configuration. After deployment, check the service status and journal; a script's completion message alone does not establish application health.

For noninteractive deployment, configure sudo on the server with `sudo visudo`. Confirm the systemctl path using `command -v systemctl`; for `/usr/bin/systemctl`, a rule limited to the commands used by these scripts is:

```sudoers
carlos ALL=(root) NOPASSWD: /usr/bin/systemctl stop homeautomation, /usr/bin/systemctl start homeautomation, /usr/bin/systemctl status homeautomation
```

## Monitoring

With the default `HTTP_PORT=1881`:

| Endpoint | Local | Server |
| --- | --- | --- |
| Dashboard | `http://localhost:1881/` | `http://bee.local:1881/` |
| Health | `http://localhost:1881/health` | `http://bee.local:1881/health` |
| Prometheus metrics | `http://localhost:1881/metrics` | `http://bee.local:1881/metrics` |

The dashboard lists scheduled tasks, lets you trigger them, and lets you change each wallbox's charging mode. Task buttons report the result of manual triggers; they do not provide continuous execution monitoring. Triggering the SOC schedule runs its current-time checks rather than forcing an evening or morning adjustment.

The health endpoint returns `OK` when HTTP is responding. It does not check MQTT connectivity or external services. See [operations](docs/operations.md#monitoring) for metrics and telemetry behavior.

## Shutdown

On SIGINT or SIGTERM, the service stops interval scheduling, disconnects MQTT, requests HTTP server shutdown, and exits. Pending SOC retries are held in memory and are discarded on restart.
