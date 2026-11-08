import { test } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { BatteryCellTelemetry } from "./battery-cell-telemetry.ts";
import {
  BATTERY_CELL_PATHS,
  CONTROL_PATHS,
  REFRESH_PATHS,
} from "./device-topics.ts";
import { ControlTelemetry } from "./control-telemetry.ts";
import { VICTRON_PORTAL_ID } from "./constants.ts";
import { HttpServer } from "./http-server.ts";
import { PrometheusMetrics } from "./prometheus/prometheus.ts";
import { DeviceTelemetry } from "./device-telemetry.ts";
import { unknownDischargeStatus } from "./power-controller/battery-support-controller.ts";
import { Temporal } from "./temporal.ts";

const emptyReadings = {
  minCellVoltage: null,
  maxCellVoltage: null,
  minVoltagePackName: null,
  maxVoltagePackName: null,
  minCellVoltageAt: null,
  maxCellVoltageAt: null,
};

test("rolling extremes preserve their captured packs and use the latest equal observation", () => {
  let now = Temporal.Instant.from("2026-11-07T12:00:00Z");
  const start = now;
  const telemetry = new BatteryCellTelemetry(() => now);
  deepStrictEqual(telemetry.snapshot(), emptyReadings);
  telemetry.record(BATTERY_CELL_PATHS.minVoltagePackName, "Pack-03#");
  telemetry.record(BATTERY_CELL_PATHS.maxVoltagePackName, "Pack-07#");
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, 3.1);
  telemetry.record(BATTERY_CELL_PATHS.maxCellVoltage, 3.5);
  now = now.add({ seconds: 30 });
  telemetry.record(BATTERY_CELL_PATHS.minVoltagePackName, "Pack-04#");
  telemetry.record(BATTERY_CELL_PATHS.maxVoltagePackName, "Pack-08#");
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, 3.2);
  telemetry.record(BATTERY_CELL_PATHS.maxCellVoltage, 3.4);
  deepStrictEqual(telemetry.snapshot(), {
    minCellVoltage: 3.1,
    maxCellVoltage: 3.5,
    minVoltagePackName: "Pack-03#",
    maxVoltagePackName: "Pack-07#",
    minCellVoltageAt: start.toString(),
    maxCellVoltageAt: start.toString(),
  });
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, 3.1);
  telemetry.record(BATTERY_CELL_PATHS.maxCellVoltage, 3.5);
  deepStrictEqual(telemetry.snapshot(), {
    minCellVoltage: 3.1,
    maxCellVoltage: 3.5,
    minVoltagePackName: "Pack-04#",
    maxVoltagePackName: "Pack-08#",
    minCellVoltageAt: now.toString(),
    maxCellVoltageAt: now.toString(),
  });
});

test("samples expire independently at the rolling 12-hour boundary even without new messages", () => {
  let now = Temporal.Instant.from("2026-11-07T12:00:00Z");
  const start = now;
  const telemetry = new BatteryCellTelemetry(() => now);
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, 3.1);
  now = now.add({ hours: 1 });
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, 3.2);
  telemetry.record(BATTERY_CELL_PATHS.maxCellVoltage, 3.5);
  now = start.add({ hours: 12 });
  equal(telemetry.snapshot().minCellVoltage, 3.1);
  now = now.add({ nanoseconds: 1 });
  equal(telemetry.snapshot().minCellVoltage, 3.2);
  equal(telemetry.snapshot().maxCellVoltage, 3.5);
  now = start.add({ hours: 13, nanoseconds: 1 });
  deepStrictEqual(telemetry.snapshot(), emptyReadings);
  deepStrictEqual(
    new BatteryCellTelemetry(() => now).snapshot(),
    emptyReadings,
  );
});

test("ingestion expires old samples and invalid messages preserve historical observations", () => {
  let now = Temporal.Instant.from("2026-11-07T12:00:00Z");
  const telemetry = new BatteryCellTelemetry(() => now);
  for (const field of ["minCellVoltage", "maxCellVoltage"] as const) {
    telemetry.record(BATTERY_CELL_PATHS[field], 0);
    for (const value of [-1, null, NaN, Infinity, "3.2", {}, undefined]) {
      telemetry.record(BATTERY_CELL_PATHS[field], value);
      equal(telemetry.snapshot()[field], 0);
    }
  }
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, null);
  telemetry.record(BATTERY_CELL_PATHS.maxCellVoltage, {});
  telemetry.record("unrelated/topic", 9);
  equal(telemetry.snapshot().minCellVoltage, 0);
  equal(telemetry.snapshot().maxCellVoltage, 0);
  now = now.add({ hours: 12, nanoseconds: 1 });
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, 3.2);
  equal(telemetry.snapshot().minCellVoltage, 3.2);
  equal(telemetry.snapshot().maxCellVoltage, null);
});

test("pack freshness is evaluated at capture and later updates never relabel samples", () => {
  for (const kind of ["min", "max"] as const) {
    let now = Temporal.Instant.from("2026-11-07T12:00:00Z");
    const telemetry = new BatteryCellTelemetry(() => now);
    const packPath = BATTERY_CELL_PATHS[`${kind}VoltagePackName`];
    const voltagePath = BATTERY_CELL_PATHS[`${kind}CellVoltage`];
    const packField = `${kind}VoltagePackName` as const;
    telemetry.record(packPath, "Pack-03#");
    now = now.add({ seconds: 60 });
    telemetry.record(voltagePath, 3.2);
    equal(telemetry.snapshot()[packField], "Pack-03#");
    now = now.add({ nanoseconds: 1 });
    telemetry.record(voltagePath, 3.2);
    equal(telemetry.snapshot()[packField], null);
    telemetry.record(packPath, "Pack-04#");
    equal(telemetry.snapshot()[packField], null);
    telemetry.record(voltagePath, 3.2);
    equal(telemetry.snapshot()[packField], "Pack-04#");
    for (const value of [null, "", "  ", 3, {}, undefined]) {
      telemetry.record(packPath, "Pack-03#");
      telemetry.record(packPath, value);
      telemetry.record(voltagePath, 3.2);
      equal(telemetry.snapshot()[packField], null);
    }
  }
});

test("disconnect retains history but clears packs for readings after reconnect", () => {
  let now = Temporal.Instant.from("2026-11-07T12:00:00Z");
  const telemetry = new BatteryCellTelemetry(() => now);
  telemetry.record(BATTERY_CELL_PATHS.minVoltagePackName, "Pack-03#");
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, 3.2);
  const previous = telemetry.snapshot();
  telemetry.invalidate();
  deepStrictEqual(telemetry.snapshot(), previous);
  now = now.add({ seconds: 1 });
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, 3.2);
  equal(telemetry.snapshot().minVoltagePackName, null);
  telemetry.record(BATTERY_CELL_PATHS.minVoltagePackName, "Pack-04#");
  equal(telemetry.snapshot().minVoltagePackName, null);
  now = now.add({ seconds: 1 });
  telemetry.record(BATTERY_CELL_PATHS.minCellVoltage, 3.2);
  equal(telemetry.snapshot().minVoltagePackName, "Pack-04#");
  now = now.subtract({ seconds: 3 });
  deepStrictEqual(telemetry.snapshot(), emptyReadings);
});

test("cell display readings are excluded from required control telemetry", () => {
  const telemetry = new ControlTelemetry();
  for (const path of REFRESH_PATHS) {
    telemetry.record(path, path.endsWith("Status") ? 1 : 0);
  }
  equal(telemetry.snapshot().telemetryValid, true);
  for (const path of Object.values(BATTERY_CELL_PATHS)) {
    ok(!REFRESH_PATHS.includes(path));
    telemetry.record(path, null);
  }
  equal(telemetry.snapshot().telemetryValid, true);
  equal(telemetry.value(CONTROL_PATHS.batterySOC), 0);
});

test("MQTT cell readings reach the battery API without rounding or changing voltage metrics", async (context) => {
  let now = Temporal.Instant.from("2026-11-07T12:00:00Z");
  context.mock.method(Temporal.Now, "instant", () => now);
  const handlers = new Map<string, (topic: string, payload: unknown) => void>();
  const gaugeValues: number[] = [];
  const telemetry = new DeviceTelemetry({
    clock: () => now,
    metrics: {
      setGauge: (_, value) => {
        gaugeValues.push(value);
      },
    },
    currentUpdated: () => {},
    wallSwitchUpdated: () => {},
  });
  await telemetry.subscribe({
    subscribeWithHandler: async (topic, handler) => {
      ok(!handlers.has(topic), `Duplicate subscription: ${topic}`);
      handlers.set(topic, handler);
    },
  });
  const send = (path: string, value: unknown) => {
    const topic = `N/${VICTRON_PORTAL_ID}/${path}`;
    const handler = handlers.get(topic);
    ok(handler, `Missing subscription: ${topic}`);
    handler(topic, { value });
  };
  const metrics = new PrometheusMetrics();
  const server = new HttpServer(
    metrics,
    unknownDischargeStatus,
    undefined,
    telemetry,
  );
  const port = await server.start(0);
  const read = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/battery`);
    equal(response.headers.get("cache-control"), "no-store");
    const {
      minCellVoltage,
      maxCellVoltage,
      minVoltagePackName,
      maxVoltagePackName,
      minCellVoltageAt,
      maxCellVoltageAt,
    } = await response.json();
    return {
      minCellVoltage,
      maxCellVoltage,
      minVoltagePackName,
      maxVoltagePackName,
      minCellVoltageAt,
      maxCellVoltageAt,
    };
  };
  telemetry.invalidate();
  try {
    deepStrictEqual(await read(), emptyReadings);
    send(BATTERY_CELL_PATHS.minVoltagePackName, "Pack-03#");
    send(BATTERY_CELL_PATHS.maxVoltagePackName, "Pack-07#");
    send(BATTERY_CELL_PATHS.minCellVoltage, 3.276);
    send(BATTERY_CELL_PATHS.maxCellVoltage, 3.3);
    deepStrictEqual(await read(), {
      minCellVoltage: 3.276,
      maxCellVoltage: 3.3,
      minVoltagePackName: "Pack-03#",
      maxVoltagePackName: "Pack-07#",
      minCellVoltageAt: now.toString(),
      maxCellVoltageAt: now.toString(),
    });
    deepStrictEqual(gaugeValues, [3.276, 3.3]);
    send(BATTERY_CELL_PATHS.minVoltagePackName, null);
    equal((await read()).minVoltagePackName, "Pack-03#");
    equal((await read()).minCellVoltage, 3.276);
    now = now.add({ seconds: 61 });
    equal((await read()).minCellVoltage, 3.276);
    send(BATTERY_CELL_PATHS.minCellVoltage, 3.2);
    send(BATTERY_CELL_PATHS.maxCellVoltage, 3.25);
    telemetry.invalidate();
    equal((await read()).minCellVoltage, 3.2);
    equal((await read()).minVoltagePackName, null);
    equal((await read()).minCellVoltageAt, now.toString());
    equal((await read()).maxCellVoltage, 3.3);
    deepStrictEqual(gaugeValues, [3.276, 3.3, 3.2, 3.25]);
    now = now.add({ hours: 12, nanoseconds: 1 });
    deepStrictEqual(await read(), emptyReadings);
  } finally {
    now = now.add({ hours: 13 });
    telemetry.cellHistory();
    telemetry.invalidate();
    await server.stop();
    metrics.getRegister().clear();
  }
});
