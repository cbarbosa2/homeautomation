import { globals, WallboxChargeMode, WallboxLocation } from "../globals.ts";
import { savePersistentStorage } from "../persistent-storage.ts";
import { METRICS } from "../prometheus/metrics.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";
import { logInfo, logWarn, logError } from "../logger.ts";

export function setChargeMode(
  metrics: PrometheusMetrics,
  location: WallboxLocation,
  mode: WallboxChargeMode,
  persistSetting: boolean = true
): void {
  if (!Object.values(WallboxChargeMode).includes(mode)) {
    logWarn(`Mode ${mode} is not a valid WallboxChargeMode`);
    return;
  }

  let gauge;
  if (location == WallboxLocation.Inside) {
    gauge = METRICS.GAUGES.ESS_WALLBOX_INSIDE_CHARGE_MODE;
  } else {
    gauge = METRICS.GAUGES.ESS_WALLBOX_OUTSIDE_CHARGE_MODE;
  }
  globals.wallboxChargeMode.set(location, mode);
  metrics.setGauge(gauge, mode);

  logInfo(
    `set mode ${WallboxChargeMode[mode]}(${mode}) in gauge ${gauge.name}`
  );

  if (persistSetting) {
    savePersistentStorage({
      inside:
        globals.wallboxChargeMode.get(WallboxLocation.Inside) ??
        WallboxChargeMode.SunOnly,
      outside:
        globals.wallboxChargeMode.get(WallboxLocation.Outside) ??
        WallboxChargeMode.SunOnly,
    }).catch((error) => {
      logError(`❌ Failed to save persistent storage: ${String(error)}`);
    });
  }
}
