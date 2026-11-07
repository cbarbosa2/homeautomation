import { globals, WallboxChargeMode, WallboxLocation } from "../globals.ts";
import {
  loadPersistentStorage,
  savePersistentStorage,
} from "../persistent-storage.ts";
import { METRICS } from "../prometheus/metrics.ts";
import type { PrometheusMetrics } from "../prometheus/prometheus.ts";
import { logError, logInfo, logWarn } from "../logger.ts";

export async function setChargeMode(
  metrics: PrometheusMetrics,
  location: WallboxLocation,
  mode: WallboxChargeMode,
  persistSetting: boolean = true,
): Promise<void> {
  if (
    typeof mode !== "number" ||
    !Object.values(WallboxChargeMode).includes(mode)
  ) {
    logWarn(`Mode ${mode} is not a valid WallboxChargeMode`);
    return;
  }

  const gauge =
    location === WallboxLocation.Inside
      ? METRICS.GAUGES.ESS_WALLBOX_INSIDE_CHARGE_MODE
      : METRICS.GAUGES.ESS_WALLBOX_OUTSIDE_CHARGE_MODE;
  globals.wallboxChargeMode.set(location, mode);
  metrics.setGauge(gauge, mode);

  logInfo(
    `set mode ${WallboxChargeMode[mode]}(${mode}) in gauge ${gauge.name}`,
  );

  if (persistSetting) {
    globals.preferredWallboxLocation = location;

    await savePersistentStorage({
      preferredWallboxLocation: globals.preferredWallboxLocation,
      inside:
        globals.wallboxChargeMode.get(WallboxLocation.Inside) ??
        WallboxChargeMode.SunOnly,
      outside:
        globals.wallboxChargeMode.get(WallboxLocation.Outside) ??
        WallboxChargeMode.SunOnly,
    }).catch((error) => {
      logError(`❌ Failed to save persistent storage: ${String(error)}`);
      throw new Error(
        "Mode and priority applied, but could not be saved. Both may revert after restart.",
      );
    });
  }
}

/** Restore settings without treating load order as a new user selection. */
export async function restorePersistedChargeSettings(
  metrics: PrometheusMetrics,
): Promise<void> {
  const data = await loadPersistentStorage();
  globals.preferredWallboxLocation =
    data.preferredWallboxLocation === WallboxLocation.Outside
      ? WallboxLocation.Outside
      : WallboxLocation.Inside;

  if (data.inside != null) {
    await setChargeMode(metrics, WallboxLocation.Inside, data.inside, false);
  }
  if (data.outside != null) {
    await setChargeMode(metrics, WallboxLocation.Outside, data.outside, false);
  }
}
