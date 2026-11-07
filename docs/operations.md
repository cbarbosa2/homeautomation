# Configuration and monitoring

## Configuration

Use [.env.example](../.env.example) as the configuration template; [constants.ts](../src/constants.ts) defines application defaults.

The service and BMW setup use Node's native environment loader to read `.env` from the working directory. Existing process environment variables take precedence. A missing file is allowed during loading; other loading errors stop startup. BMW setup still requires a writable `.env` to save its results.

| Variable | Purpose |
| --- | --- |
| `MQTT_BROKER_URL` | MQTT broker URL. |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | MQTT credentials. |
| `MQTT_CLIENT_ID` | Base client identifier; a timestamp is appended. |
| `HTTP_PORT` | HTTP server port; defaults to 1881. |
| `POWER_CONTROL_ENABLED` | Set to `true` to publish generated wallbox and battery power commands; otherwise those commands are logged only. Scheduled minimum-SOC updates are separate and still publish. |
| `FORECAST_SOLAR_API_KEY`, `VICTRON_API_KEY` | Solar forecast API credentials. |
| `VICTRON_PORTAL_ID` | Required Victron portal ID used in MQTT topics; a single topic segment without wildcards. |
| `VICTRON_INSTALLATION_ID` | Required positive decimal VRM installation ID used for forecast API requests. |
| `JSONBIN_ID` | Remote storage identifier for persisted charge modes and charger preference. |
| `JSONBIN_ACCESS_KEY` | JSONBin access key with Bins Read and Update permissions. |
| `JSONBIN_MASTER_KEY` | JSONBin master key; preferred for writes to disable versioning on public bins. Reads prefer the access key. |
| `BMW_CARDATA_CLIENT_ID` | Owner API client ID from the BMW CarData portal. Optional until BMW setup is complete. |
| `BMW_CARDATA_VIN`, `BMW_CARDATA_CONTAINER_ID` | Filled by `npm run bmw:setup` after owner authorization; enable startup and half-hourly vehicle SOC reads. |

`HTTP_TIMEOUT` remains in the configuration but is not used by current request code. Logging settings are listed in `.env.example`.

Store both Victron identifiers in the ignored `.env` file, never in tracked source or documentation. They have no defaults; missing or invalid values stop startup before network connections. The portal ID and numeric installation ID are separate values. On `bee.local`, configuration lives in `/home/carlos/homeautomation/.env`; keep it owned by `carlos` with mode `0600`. Configure both identifiers before deploying code that requires them. Environment changes take effect on the next service start.

## BMW CarData setup

Set `BMW_CARDATA_CLIENT_ID` in the ignored `.env` file and subscribe that client to **CarData API** in the BMW customer portal. Run `npm run bmw:setup` from the repository root. Open the verification URL printed by the command and authorize the device using the displayed code. The setup command selects the only PRIMARY vehicle on the account, creates or reuses a container for `vehicle.drivetrain.electricEngine.charging.level`, `vehicle.powertrain.electric.battery.stateOfCharge.displayed`, and `vehicle.drivetrain.batteryManagement.header`, saves the VIN and container ID in `.env`, and stores rotating tokens in the ignored `.bmw-cardata-tokens.json` file. If there is more than one PRIMARY vehicle, set `BMW_CARDATA_VIN` in `.env` before rerunning setup. Keep both files private with mode `0600`.

Restart the service after setup. It reads the three SOC fields on startup and every half hour at minutes 05 and 35, selecting the valid value with the most recent BMW timestamp. It exposes the SOC at `/api/bmw-soc`, in the dashboard, and as `bmw_i3_soc` with `bmw_i3_soc_timestamp_seconds`. The timestamp is essential because vehicle updates can lag behind API polling. An SOC reading no more than 90 minutes old stops the inside wallbox at 80% in Sun Only, ESS Only, and Night modes. Missing or older readings allow charging under the usual mode rules. On and Manual are unaffected. If the refresh token expires after prolonged downtime, rerun setup to authorize again. See the [BMW CarData integration guide](https://bmw-cardata.bmwgroup.com/customer/public/api-documentation).

Run setup on each host where the service will read BMW data. The deployment scripts do not transfer `.env` or `.bmw-cardata-tokens.json`; on `bee.local`, set the client ID in `/home/carlos/homeautomation/.env` and run `npm run bmw:setup` from `/home/carlos/homeautomation`. The setup script is not part of normal service startup.

## Monitoring

With the default port:

- Dashboard: <http://localhost:1881/>
- Home battery readings: <http://localhost:1881/api/battery>
- Prometheus metrics: <http://localhost:1881/metrics>
- Health: <http://localhost:1881/health>

The health endpoint returns `OK`; it does not verify MQTT connectivity or external services. Metrics include process metrics, MQTT message counts and connection status, errors, and device/energy telemetry. Definitions are in [metrics.ts](../src/prometheus/metrics.ts); registration is in [prometheus.ts](../src/prometheus/prometheus.ts).

The Home Energy dashboard displays current home battery SOC and minimum SOC,
wallbox mode controls, BMW SOC, and a compact list of scheduled jobs. Job cron
expressions are shown in UTC. `GET /api/battery` returns
`{ "soc": 72, "minSoc": 30 }` from validated control telemetry, with each value
independently `null` when missing, invalid, disconnected, or more than 60 seconds
old. The response is not cached. The dashboard polls battery readings every ten
seconds after the preceding request completes and shows unavailable values on
refresh failure. These values are read-only; wallbox mode and priority changes
still require pressing Set.

## Automation telemetry and timing

Control readings are refreshed every 30 seconds using explicit empty MQTT reads
on `R/<VICTRON_PORTAL_ID>/<path>`. The exact list is in
[control-telemetry.ts](../src/control-telemetry.ts): grid power, battery power/SOC,
minimum SOC and maximum charge power, both PV sources, and each wallbox's power,
status, SetCurrent and StartStop. Keepalive does not renew these timestamps.
Missing, malformed, nonfinite, or more than 60-second-old readings are unavailable.
Missing PV inverter power counts as zero at any hour, since the inverter may not
report when sunlight is insufficient. A broker disconnect invalidates all control
readings immediately. Allocation uses
one 12 A budget until required readings return, with wallboxes ahead of battery.
Mode conditions still apply and Manual loads are never controlled.

Automatic increases reserve capacity until fresh device settings and measured
power confirm reductions. This includes pending starts and battery limits;
charging can remain paused while acknowledgements are unavailable. Reductions
bypass smoothing; wallbox increases use the minimum target over 15 control ticks.
The single-phase power model uses the existing installation convention of 240 V,
rounding current and battery limits down. Grid measurements include Manual loads.
Solar availability is bounded by total AC/DC PV and the energy balance
`automatic wallbox power + signed battery power - grid import`, so grid-funded
battery charging is not reused as solar surplus.

SOC actions run at Lisbon 22:01 and 08:00, including DST. The evening job requires
fresh battery SOC and tomorrow's date-specific Forecast.Solar result (Wh, fetched
within six hours). Missing inputs retain the existing target and retry every five
minutes until Lisbon midnight. Restarting discards retries and does not catch up
missed actions. Forecast fetching remains hourly.

### Device protocol assumptions

[Victron's MQTT protocol](https://github.com/victronenergy/dbus-flashmq/blob/master/README.md)
documents explicit reads for static settings.
[EV charger status definitions](https://github.com/victronenergy/node-red-contrib-victron/blob/master/src/services/services.json)
identify 8–14 as faults. Unknown/reserved states and RFID waiting cannot authorize
charging. Connected/waiting, low-SOC and power/phase transition states may retain
eligibility. Full and disconnected
vehicles cannot charge but retain their saved preference, regaining priority when
eligible.

The existing battery output is `Settings/CGwacs/MaxChargePower`, in watts;
zero is a bounded limit (the unrestricted setting is -1), as represented in
[Victron's settings schema](https://github.com/victronenergy/venus-docker/blob/master/settings.xml).
Victron's device definitions mark this legacy control as unused with DVCC enabled.
DVCC is disabled on this installation (confirmed by the operator), so this control
applies. A received
settings echo alone is not evidence of physical curtailment. No live hardware
commands are part of automated validation.

Charge-mode commands apply immediately and give that charger priority, even when
the mode is unchanged. Dashboard dropdowns prepare a selection; press Set to apply
it and claim priority. The dashboard reports success only after JSONBin confirms
both modes and preference were saved; failures show that mode and priority may
revert after restart. On each page load, a Priority badge identifies the preferred
charger using `GET /api/wallbox-charge-mode`, which returns `Inside` and `Outside`
mode values plus `preferredLocation` (`"Inside"` or `"Outside"`). This response is
not cached. The badge is refreshed after Set attempts, including failed saves,
because runtime priority may already have changed. This refresh does not alter
pending dropdown selections. Priority indicates preference when eligible, even
if that charger is currently disconnected, Off, or Manual.
The saved `preferredWallboxLocation` uses numeric locations
(0 Inside, 1 Outside); absent or invalid preference defaults to Inside. Startup
restoration does not change preference based on mode-loading order.
Physical switch save failures are logged. Writes are serialized and pending writes
are drained during graceful shutdown. Requests time out after 30 seconds.
Configure a JSONBin credential in the service's `.env` before restarting; the bin
ID alone does not authorize writes. See the [JSONBin update API](https://jsonbin.io/api-reference/bins/update).

Settings writes send `X-Bin-Versioning: false` to avoid exhausting bin versions.
Public bins require the master key to honor this header. Configure
`JSONBIN_MASTER_KEY` for public bins; existing history is not deleted.

## Node.js rollout and rollback

The Linux service uses Node.js 26.13 or newer in the 26.x line, with compiled ESM at `dist/src/bootstrap.js`. npm and development dependencies are needed when building on the host; systemd executes the compiled JavaScript directly. Upgrading a developer machine's Node installation does not update `bee.local`.

For a host still running the former Deno service, perform the one-time cutover below with permission to install packages and replace/reload the systemd unit. Deployment scripts do not perform that cutover automatically.

1. Install Node.js 26.13 or newer in the 26.x LTS line and npm using your host's trusted package source or the official [Node distributions](https://nodejs.org/en/download). The service requires `/usr/bin/node`; verify `/usr/bin/node --version`, `node --version`, and `npm --version` as `carlos`. If Node is installed elsewhere, change `ExecStart` and both deployment scripts together. A shell-only version manager does not configure systemd.
2. Record the running Git revision, or back up the source tree for a local-copy deployment. Back up `/etc/systemd/system/homeautomation.service` and retain Deno for rollback. Preserve the host's `.env` and rotating BMW token files with ownership `carlos` and mode `0600`; do not replace them with local copies or restore old rotating tokens during rollback.
3. On the local machine, run `npm ci`, `npm run analyze`, and `npm run build`. On the host, stop the service before replacing its source/dependencies. Transfer or check out the migration, then run `npm ci` and `npm run build` as `carlos` from `/home/carlos/homeautomation`. Both commands must succeed before startup. Builds require development dependencies, so do not use `npm ci --omit=dev` for this workflow.
4. Copy the updated unit with `sudo cp homeautomation.service /etc/systemd/system/`, run `sudo systemctl daemon-reload`, and start with `sudo systemctl start homeautomation`. Its working directory and filesystem protection remain the same; Node runs the precompiled entrypoint without npm or compiler access at service startup.
5. Check `systemctl status homeautomation`, `journalctl -u homeautomation`, `/health`, the dashboard, and `/metrics` on the configured HTTP port. Confirm MQTT connection status and telemetry freshness. A successful health response only checks HTTP. Do not run a second instance against the same installation during verification.

Subsequent deployment scripts require the migrated systemd unit before stopping the service. They validate locally, check both remote Node binaries, stop the service, update source, install locked dependencies, build remotely, and start only after success. The local-copy script preserves the existing build timestamp; Git deployment refreshes it. Failure after stopping leaves the service stopped for operator recovery.

For rollback, stop the service, restore the recorded source revision/tree and the backed-up systemd unit, reload systemd, and start with the former Deno runtime. Keep current `.env` and BMW tokens: their formats and locations are unchanged. Verify the journal, HTTP endpoints, MQTT connection, and telemetry again. If a build fails during ordinary Node deployment, restore the previous Node revision, rerun `npm ci` and `npm run build`, then start; never restart against a partially built output directory.
