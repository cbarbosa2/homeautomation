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
| `JSONBIN_ID` | Remote storage identifier for persisted charge modes. |

`HTTP_TIMEOUT` remains in the configuration but is not used by current request code. Logging settings are listed in `.env.example`.

## Monitoring

With the default port:

- Dashboard: <http://localhost:1881/>
- Prometheus metrics: <http://localhost:1881/metrics>
- Health: <http://localhost:1881/health>

The health endpoint returns `OK`; it does not verify MQTT connectivity or external services. Metrics include process metrics, MQTT message counts and connection status, errors, and device/energy telemetry. Definitions are in [metrics.ts](../src/prometheus/metrics.ts); registration is in [prometheus.ts](../src/prometheus/prometheus.ts).
