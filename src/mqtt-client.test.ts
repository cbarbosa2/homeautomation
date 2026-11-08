import { test } from "node:test";
import { equal, match } from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("MQTT close and offline call the injected unavailable callback with existing connection metrics", () => {
  const mqttPackage = import.meta.resolve("mqtt");
  const clientModule = new URL("./mqtt-client.js", import.meta.url).href;
  const adapter = `import { EventEmitter } from 'node:events';
    export const client = new EventEmitter();
    export default { connect() { queueMicrotask(() => client.emit('connect')); return client; } };`;
  const code = `
    import { registerHooks } from 'node:module';
    import { deepStrictEqual, equal } from 'node:assert/strict';
    registerHooks({ load(url, context, next) {
      if (url === ${JSON.stringify(mqttPackage)}) return {format:'module',source:${JSON.stringify(adapter)},shortCircuit:true};
      return next(url, context);
    }});
    const { MqttClient } = await import(${JSON.stringify(clientModule)});
    const { client } = await import('mqtt');
    const connections = [];
    let unavailable = 0;
    const transport = new MqttClient({recordMqttConnection: value => connections.push(value)}, () => unavailable++);
    await transport.connect();
    equal(transport.getConnectionStatus(), true);
    client.emit('close');
    equal(transport.getConnectionStatus(), false);
    equal(unavailable, 1);
    deepStrictEqual(connections, [true]);
    client.emit('offline');
    client.emit('offline');
    equal(unavailable, 3);
    deepStrictEqual(connections, [true, false, false]);
    console.log('TRANSPORT_INVALIDATION_VERIFIED');
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    { env: process.env, encoding: "utf8", timeout: 5000 },
  );
  equal(child.status, 0, child.stdout + child.stderr);
  match(child.stdout, /TRANSPORT_INVALIDATION_VERIFIED/);
});
