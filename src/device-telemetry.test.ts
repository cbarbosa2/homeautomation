import { test } from "node:test";
import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { DeviceTelemetry } from "./device-telemetry.ts";
import { CONTROL_PATHS as P, wallboxPath } from "./device-topics.ts";
import { VICTRON_PORTAL_ID } from "./constants.ts";
import { globals, WallboxLocation as L } from "./globals.ts";
import { Temporal } from "./temporal.ts";
import { recordingTelemetry } from "./device-telemetry-fixture.test.ts";

const controlPaths = [
  "system/0/Ac/Grid/L1/Power",
  "battery/512/Soc",
  "battery/512/Dc/0/Power",
  "settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit",
  "settings/0/Settings/CGwacs/MaxChargePower",
  "system/0/Ac/PvOnGrid/L1/Power",
  "system/0/Dc/Pv/Power",
  ...[40, 41].flatMap((id) =>
    ["Ac/Power", "Status", "SetCurrent", "StartStop"].map(
      (field) => `evcharger/${id}/${field}`,
    ),
  ),
];
const cellPaths = [
  "MinCellVoltage",
  "MaxCellVoltage",
  "MinVoltageCellId",
  "MaxVoltageCellId",
].map((field) => `battery/512/System/${field}`);
const metricOnlyPaths = [
  "battery/512/Dc/0/Current",
  "battery/512/Dc/0/Voltage",
  "battery/512/Dc/0/Temperature",
  "system/0/Ac/Consumption/L1/Power",
  "temperature/24/Temperature",
  "evcharger/40/Current",
  "evcharger/41/Current",
];
const shelly = "shellyplusi4-083af2013a04/events/rpc";

test("all notification routes, raw gauges, repeated gestures and ordered explicit reads share ingestion", async () => {
  const at = Temporal.Instant.from("2026-11-08T12:00Z");
  const handlers = new Map<string, (topic: string, payload: unknown) => void>();
  const gauges = new Map<string, number>();
  const gestures: [L, number][] = [];
  const switches: unknown[] = [];
  const telemetry = new DeviceTelemetry({
    clock: () => at,
    metrics: {
      setGauge: (metric, value) => {
        gauges.set(metric.name, value);
      },
    },
    currentUpdated: (location, value) => {
      gestures.push([location, value]);
    },
    wallSwitchUpdated: (payload) => {
      switches.push(payload);
    },
  });
  await telemetry.subscribe({
    subscribeWithHandler: async (topic, handler) => {
      ok(!handlers.has(topic));
      handlers.set(topic, handler);
    },
  });
  const expected = [...controlPaths, ...cellPaths, ...metricOnlyPaths].map(
    (path) => `N/${VICTRON_PORTAL_ID}/${path}`,
  );
  deepStrictEqual([...handlers.keys()].sort(), [...expected, shelly].sort());
  const gaugeRoutes = new Map([
    ["system/0/Ac/Grid/L1/Power", "ess_grid_power"],
    ["battery/512/Soc", "ess_battery_soc"],
    ["battery/512/Dc/0/Power", "ess_battery_power"],
    [
      "settings/0/Settings/CGwacs/BatteryLife/MinimumSocLimit",
      "ess_battery_min_soc",
    ],
    [
      "settings/0/Settings/CGwacs/MaxChargePower",
      "ess_battery_max_charge_power",
    ],
    ["system/0/Ac/PvOnGrid/L1/Power", "ess_pv_inverter_power"],
    ["system/0/Dc/Pv/Power", "ess_pv_charger_power"],
    ["evcharger/40/Ac/Power", "ess_wallbox_inside_power"],
    ["evcharger/41/Ac/Power", "ess_wallbox_outside_power"],
    ["evcharger/40/Status", "ess_wallbox_inside_status"],
    ["evcharger/41/Status", "ess_wallbox_outside_status"],
    ["evcharger/40/SetCurrent", "ess_wallbox_inside_set_current"],
    ["evcharger/41/SetCurrent", "ess_wallbox_outside_set_current"],
    ["evcharger/40/Current", "ess_wallbox_inside_current"],
    ["evcharger/41/Current", "ess_wallbox_outside_current"],
    ["battery/512/System/MinCellVoltage", "ess_battery_min_cell_voltage"],
    ["battery/512/System/MaxCellVoltage", "ess_battery_max_cell_voltage"],
    ["battery/512/Dc/0/Current", "ess_battery_current"],
    ["battery/512/Dc/0/Voltage", "ess_battery_voltage"],
    ["battery/512/Dc/0/Temperature", "ess_battery_temperature"],
    ["system/0/Ac/Consumption/L1/Power", "ess_consumption_power"],
    ["temperature/24/Temperature", "ess_shed_temperature"],
  ]);
  let numeric = 0;
  for (const [path, gauge] of gaugeRoutes) {
    const topic = `N/${VICTRON_PORTAL_ID}/${path}`;
    const handler = handlers.get(topic);
    ok(handler);
    handler(topic, { value: ++numeric });
    equal(gauges.get(gauge), numeric, path);
  }
  equal(gauges.size, gaugeRoutes.size);
  for (const path of [
    "evcharger/40/StartStop",
    "evcharger/41/StartStop",
    ...cellPaths.slice(2),
  ]) {
    const topic = `N/${VICTRON_PORTAL_ID}/${path}`;
    const handler = handlers.get(topic);
    ok(handler);
    handler(topic, { value: 1 });
  }
  equal(gauges.size, gaugeRoutes.size);
  const send = (path: string, payload: unknown) => {
    const topic = `N/${VICTRON_PORTAL_ID}/${path}`;
    const handler = handlers.get(topic);
    ok(handler);
    handler(topic, payload);
  };
  send(P.batterySOC, { value: 101 });
  equal(telemetry.value(P.batterySOC), undefined);
  equal(gauges.get("ess_battery_soc"), 101);
  for (const payload of [null, {}, { value: "72" }, { value: Infinity }]) {
    send(P.batterySOC, payload);
    equal(telemetry.value(P.batterySOC), undefined);
    equal(gauges.get("ess_battery_soc"), 0);
  }
  gestures.length = 0;
  for (const value of [6, 6, -1, NaN])
    send(wallboxPath(L.Inside, "SetCurrent"), { value });
  deepStrictEqual(gestures, [
    [L.Inside, 6],
    [L.Inside, 6],
    [L.Inside, -1],
    [L.Inside, 0],
  ]);
  const payload = {
    params: {
      events: [
        { id: 0, event: "single_push" },
        { id: 1, event: "double_push" },
      ],
    },
  };
  const switchHandler = handlers.get(shelly);
  ok(switchHandler);
  switchHandler(shelly, payload);
  equal(switches[0], payload);
  const reads: string[] = [];
  await telemetry.refresh({
    publish: async (topic, message) => {
      equal(message, "");
      reads.push(topic);
    },
  });
  deepStrictEqual(
    reads,
    ["keepalive", ...controlPaths, ...cellPaths].map(
      (path) => `R/${VICTRON_PORTAL_ID}/${path}`,
    ),
  );
  await rejects(
    telemetry.refresh({
      publish: async () => {
        throw new Error("publish failed");
      },
    }),
    /publish failed/,
  );
});

test("fresh control evidence recovers per reading and snapshots exclude settings and retain source timestamps", async () => {
  let now = Temporal.Instant.from("2026-11-08T12:00Z");
  const { telemetry, record } = await recordingTelemetry(() => now);
  const fill = () => {
    for (const path of controlPaths) {
      if (path !== P.pvInverterPower) record(path, { value: 0 });
    }
  };
  fill();
  const snapshot = telemetry.snapshot();
  equal(snapshot.telemetryValid, true);
  equal(snapshot.pvInverterPower, 0);
  equal(snapshot.observedAt.get(P.gridPower)?.toString(), now.toString());
  const preference = globals.preferredWallboxLocation;
  try {
    globals.preferredWallboxLocation = L.Outside;
    deepStrictEqual(telemetry.snapshot(), snapshot);
    ok(!("preferredWallboxLocation" in snapshot));
    ok(!("omieEntries" in snapshot));
  } finally {
    globals.preferredWallboxLocation = preference;
  }
  snapshot.wallboxPower.clear();
  equal(telemetry.snapshot().wallboxPower.size, 2);
  now = now.add({ seconds: 60 });
  equal(telemetry.snapshot().telemetryValid, true);
  await telemetry.refresh({ publish: async () => {} });
  equal(
    telemetry.snapshot().observedAt.get(P.gridPower)?.toString(),
    now.subtract({ seconds: 60 }).toString(),
  );
  now = now.add({ nanoseconds: 1 });
  equal(telemetry.snapshot().telemetryValid, false);
  fill();
  equal(telemetry.snapshot().telemetryValid, true);
  telemetry.invalidate();
  telemetry.invalidate();
  equal(telemetry.snapshot().telemetryValid, false);
  record(P.batterySOC, { value: 40 });
  equal(telemetry.value(P.batterySOC), 40);
  equal(telemetry.value(P.gridPower), undefined);
  equal(telemetry.snapshot().telemetryValid, false);
  fill();
  equal(telemetry.snapshot().telemetryValid, true);
  for (const [path, invalid] of [
    [P.batteryMinSOC, 101],
    [P.pvChargerPower, -1],
    [wallboxPath(L.Inside, "Status"), 15],
    [wallboxPath(L.Outside, "StartStop"), 2],
  ] as const) {
    record(path, { value: invalid });
    equal(telemetry.value(path), undefined);
  }
  record(P.batteryPower, { value: -300 });
  record(P.batteryMaxChargePower, { value: -1 });
  equal(telemetry.value(P.batteryPower), -300);
  equal(telemetry.value(P.batteryMaxChargePower), -1);
});

test("disconnect retains gauges and history while clearing even fresh pack associations", async () => {
  let now = Temporal.Instant.from("2026-11-08T12:00Z");
  const gauges = new Map<string, number>();
  const { telemetry, record } = await recordingTelemetry(() => now, {
    setGauge: (metric, value) => {
      gauges.set(metric.name, value);
    },
  });
  const pack = "battery/512/System/MinVoltageCellId";
  const voltage = "battery/512/System/MinCellVoltage";
  record(pack, { value: " Pack-03# " });
  record(voltage, { value: 3.2 });
  const history = telemetry.cellHistory();
  equal(history.minVoltagePackName, " Pack-03# ");
  telemetry.invalidate();
  deepStrictEqual(telemetry.cellHistory(), history);
  equal(gauges.get("ess_battery_min_cell_voltage"), 3.2);
  now = now.add({ seconds: 1 });
  record(voltage, { value: 3.1 });
  equal(telemetry.cellHistory().minVoltagePackName, null);
  equal(telemetry.cellHistory().minCellVoltageAt, now.toString());
  record(voltage, { value: -1 });
  equal(telemetry.cellHistory().minCellVoltage, 3.1);
  equal(gauges.get("ess_battery_min_cell_voltage"), -1);
});
