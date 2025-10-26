import {
  events,
  globals,
  WallboxChargeMode,
  WallboxLocation,
} from "../globals.ts";
import { METRICS } from "../prometheus/metrics.ts";
import { PrometheusMetrics } from "../prometheus/prometheus.ts";

const mapIdAndPushesToChargeMode = new Map([
  ["0_1", WallboxChargeMode.ESSOnly],
  ["0_2", WallboxChargeMode.SunOnly],
  ["0_3", WallboxChargeMode.Off],
  ["1_1", WallboxChargeMode.Night],
  ["1_2", WallboxChargeMode.On],
  ["1_3", WallboxChargeMode.Manual],
  ["2_1", WallboxChargeMode.Night],
  ["2_2", WallboxChargeMode.On],
  ["2_3", WallboxChargeMode.Manual],
  ["3_1", WallboxChargeMode.ESSOnly],
  ["3_2", WallboxChargeMode.SunOnly],
  ["3_3", WallboxChargeMode.Off],
]);

export class ChargeModeSwitcher {
  private metrics: PrometheusMetrics;

  constructor(metrics: PrometheusMetrics) {
    this.metrics = metrics;
  }

  setupHandlers(): void {
    events.wallSwitchUpdated.subscribe((payload) => {
      this.handleWallSwitch(payload);
    });
    events.wallboxCurrentInsideUpdated.subscribe((payload) => {
      if (payload == 6) {
        this.setChargeMode(true, 6);
      }
    });
    events.wallboxCurrentOutsideUpdated.subscribe((payload) => {
      if (payload == 6) {
        this.setChargeMode(false, 6);
      }
    });
  }

  private handleWallSwitch(payload: {
    params: { events: { id: number; event: string }[] };
  }) {
    const id = payload.params.events[0]!.id;
    const event = payload.params.events[0]!.event;

    let pushes;
    if (event == "single_push") {
      pushes = 1;
    } else if (event == "double_push") {
      pushes = 2;
    } else if (event == "triple_push") {
      pushes = 3;
    } else {
      return;
    }

    const mode = mapIdAndPushesToChargeMode.get(id + "_" + pushes);

    if (mode != undefined) {
      const inside = id == 0 || id == 1;
      this.setChargeMode(inside, mode);
    }
  }

  private setChargeMode(inside: boolean, mode: number) {
    if (!Object.values(WallboxChargeMode).includes(mode)) {
      console.warn(`Mode ${mode} is not a valid WallboxChargeMode`);
      return;
    }

    let gauge;
    if (inside) {
      globals.wallboxChargeMode.set(WallboxLocation.Inside, mode);
      gauge = METRICS.GAUGES.ESS_WALLBOX_INSIDE_CHARGE_MODE;
    } else {
      globals.wallboxChargeMode.set(WallboxLocation.Outside, mode);
      gauge = METRICS.GAUGES.ESS_WALLBOX_OUTSIDE_CHARGE_MODE;
    }
    this.metrics.setGauge(gauge, mode);

    console.log(`set mode ${WallboxChargeMode[mode]} in gauge ${gauge.name}`);
  }
}
