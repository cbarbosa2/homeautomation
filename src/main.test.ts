import { test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`application drains persistence and exits cleanly on ${signal}`, {
    timeout: 10000,
  }, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "homeautomation-lifecycle-"),
    );
    const bootstrap = new URL("./bootstrap.js", import.meta.url).href;
    const mqtt = new URL("./mqtt-client.js", import.meta.url).href;
    const storage = new URL("./persistent-storage.js", import.meta.url).href;
    const adapter = `export class MqttClient {
      async connect() { console.log('MQTT_CONNECTED'); }
      async disconnect() { console.log('MQTT_DISCONNECTED'); }
      async subscribeWithHandler() {}
      async publish(topic) {
        if (!topic.startsWith('R/test-portal/')) throw new Error('Unexpected MQTT write');
      }
    }`;
    const code = `
      import { registerHooks } from 'node:module';
      registerHooks({ load(url, context, next) {
        if (url === ${JSON.stringify(mqtt)}) return { format: 'module', source: ${JSON.stringify(adapter)}, shortCircuit: true };
        return next(url, context);
      }});
      globalThis.fetch = async (input, init) => {
        const url = new URL(input);
        if (url.hostname === 'www.omie.es') return new Response('');
        if (url.hostname === 'api.forecast.solar') return Response.json({ result: {} });
        if (url.hostname === 'vrmapi.victronenergy.com') return Response.json({ records: { vrm_pv_charger_yield_fc: [] } });
        if (!String(input).startsWith('https://api.jsonbin.io/v3/b/')) throw new Error('Unexpected network request');
        if (init?.method === 'PUT') {
          await new Promise(resolve => setTimeout(resolve, 200));
          console.log('SAVE_FINISHED');
        }
        return Response.json({ inside: 2, outside: 2 });
      };
      await import(${JSON.stringify(bootstrap)});
      const { savePersistentStorage } = await import(${JSON.stringify(storage)});
      void savePersistentStorage({ inside: 2, outside: 2 });
      console.log('TEST_READY');
    `;
    const { PATH } = process.env;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      cwd: directory,
      env: {
        PATH,
        VICTRON_PORTAL_ID: "test-portal",
        VICTRON_INSTALLATION_ID: "123456",
        HTTP_PORT: "0",
        POWER_CONTROL_ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    const ready = Promise.withResolvers<void>();
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("TEST_READY")) ready.resolve();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    // Bound readiness independently so a failed startup cannot hang the test.
    const timeout = setTimeout(
      () => ready.reject(new Error(`Startup timed out: ${output}\n${errors}`)),
      5000,
    );
    try {
      await Promise.race([
        ready.promise,
        exited.then(() => {
          throw new Error(`Early exit: ${output}\n${errors}`);
        }),
      ]);
      child.kill(signal);
      const [exitCode, exitSignal] = await exited;
      equal(exitCode, 0, errors);
      equal(exitSignal, null);
      match(output, /MQTT_CONNECTED/);
      match(output, /MQTT_DISCONNECTED/);
      match(output, /All scheduled tasks terminated/);
      match(output, /HTTP server stopped/);
      match(output, /Shutdown complete/);
      const savedAt = output.indexOf("SAVE_FINISHED");
      ok(savedAt > output.indexOf("Shutting down Home Automation"));
      ok(savedAt < output.indexOf("Shutdown complete"));
      equal(errors, "");
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("forecast startup remains nonblocking and manual/scheduled overlaps share its refresh", {
  timeout: 10000,
}, async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "homeautomation-forecast-lifecycle-"),
  );
  const bootstrap = new URL("./bootstrap.js", import.meta.url).href;
  const mqtt = new URL("./mqtt-client.js", import.meta.url).href;
  const scheduler = new URL("./task-scheduler.js", import.meta.url).href;
  const adapter = `export class MqttClient {
    async connect() {}
    async disconnect() {}
    async subscribeWithHandler() {}
    async publish(topic) { if (!topic.startsWith('R/test-portal/')) throw new Error('Unexpected write'); }
  }`;
  const code = `
    import { registerHooks } from 'node:module';
    import { equal } from 'node:assert/strict';
    registerHooks({ load(url, context, next) {
      if (url === ${JSON.stringify(mqtt)}) return { format:'module', source:${JSON.stringify(adapter)}, shortCircuit:true };
      return next(url, context);
    }});
    const gate = Promise.withResolvers();
    let solar = 0;
    let victron = 0;
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.hostname === 'api.forecast.solar') {
        solar++;
        if (solar === 1) await gate.promise;
        return Response.json({result:{}});
      }
      if (url.hostname === 'vrmapi.victronenergy.com') {
        victron++;
        return Response.json({records:{vrm_pv_charger_yield_fc:[]}});
      }
      if (url.hostname === 'www.omie.es') return new Response('');
      if (url.hostname === 'api.jsonbin.io') return Response.json({inside:2,outside:2});
      throw new Error('Unexpected fetch');
    };
    await import(${JSON.stringify(bootstrap)});
    equal(solar, 1);
    equal(victron, 0);
    const { scheduler } = await import(${JSON.stringify(scheduler)});
    const manual = scheduler.triggerTask('Load forecast solar');
    const scheduled = scheduler.getAllTaskInfo().find(task => task.name === 'Load forecast solar').handler();
    equal(solar, 1);
    gate.resolve();
    await Promise.all([manual, scheduled]);
    equal(solar, 1);
    equal(victron, 1);
    await scheduler.triggerTask('Load forecast solar');
    equal(solar, 2);
    equal(victron, 2);
    console.log('FORECAST_LIFECYCLE_VERIFIED');
    process.kill(process.pid, 'SIGTERM');
  `;
  const { PATH } = process.env;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    cwd: directory,
    env: {
      PATH,
      VICTRON_PORTAL_ID: "test-portal",
      VICTRON_INSTALLATION_ID: "123456",
      HTTP_PORT: "0",
      POWER_CONTROL_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 7000);
  try {
    const [code, signal] = await exited;
    equal(code, 0, output + errors);
    equal(signal, null);
    match(output, /FORECAST_LIFECYCLE_VERIFIED/);
    equal(errors, "");
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
