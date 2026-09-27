# Configuration and monitoring

## Configuration

Use [.env.example](../.env.example) as the configuration template; [constants.ts](../src/constants.ts) defines application defaults.

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
| `JSONBIN_ID` | Remote storage identifier for persisted charge modes. |
| `JSONBIN_ACCESS_KEY` | JSONBin access key with Bins Read and Update permissions. |
| `JSONBIN_MASTER_KEY` | JSONBin master key; preferred for writes to disable versioning on public bins. Reads prefer the access key. |

`HTTP_TIMEOUT` remains in the configuration but is not used by current request code. Logging settings are listed in `.env.example`.

Store both Victron identifiers in the ignored `.env` file, never in tracked source or documentation. They have no defaults; missing or invalid values stop startup before network connections. The portal ID and numeric installation ID are separate values. On `bee.local`, configuration lives in `/home/carlos/homeautomation/.env`; keep it owned by `carlos` with mode `0600`. Configure both identifiers before deploying code that requires them. Environment changes take effect on the next service start.

## Monitoring

With the default port:

- Dashboard: <http://localhost:1881/>
- Prometheus metrics: <http://localhost:1881/metrics>
- Health: <http://localhost:1881/health>

The health endpoint returns `OK`; it does not verify MQTT connectivity or external services. Metrics include process metrics, MQTT message counts and connection status, errors, and device/energy telemetry. Definitions are in [metrics.ts](../src/prometheus/metrics.ts); registration is in [prometheus.ts](../src/prometheus/prometheus.ts).

## Automation telemetry and timing

Control readings are refreshed every 30 seconds using explicit empty MQTT reads
on `R/<VICTRON_PORTAL_ID>/<path>`. The exact list is in
[control-telemetry.ts](../src/control-telemetry.ts): grid power, battery power/SOC,
minimum SOC and maximum charge power, both PV sources, and each wallbox's power,
status, SetCurrent and StartStop. Keepalive does not renew these timestamps.
Missing, malformed, nonfinite, or more than 60-second-old readings are unavailable;
a broker disconnect invalidates all control readings immediately. Allocation uses
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
eligibility; charging status supplies start history. Full and disconnected
vehicles release priority.

The existing battery output is `Settings/CGwacs/MaxChargePower`, in watts;
zero is a bounded limit (the unrestricted setting is -1), as represented in
[Victron's settings schema](https://github.com/victronenergy/venus-docker/blob/master/settings.xml).
Victron's device definitions mark this legacy control as unused with DVCC enabled.
DVCC is disabled on this installation (confirmed by the operator), so this control
applies. A received
settings echo alone is not evidence of physical curtailment. No live hardware
commands are part of automated validation.

Charge-mode changes apply immediately. The dashboard reports success only after
JSONBin confirms the save; failures show that the mode may revert after restart.
Physical switch save failures are logged. Writes are serialized and pending writes
are drained during graceful shutdown. Requests time out after 30 seconds.
Configure a JSONBin credential in the service's `.env` before restarting; the bin
ID alone does not authorize writes. See the [JSONBin update API](https://jsonbin.io/api-reference/bins/update).

Settings writes send `X-Bin-Versioning: false` to avoid exhausting bin versions.
Public bins require the master key to honor this header. Configure
`JSONBIN_MASTER_KEY` for public bins; existing history is not deleted.
