import { test } from "node:test";
import { equal, match } from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const [source, message] of [
  ["Promise.reject(new Error('fatal-test'))", "Unhandled promise rejection"],
  [
    "setImmediate(() => { throw new Error('fatal-test'); })",
    "Uncaught exception",
  ],
] as const) {
  test(`fatal process error logs and exits: ${message}`, () => {
    const module = new URL("./process-handlers.js", import.meta.url).href;
    const env = { ...process.env };
    for (const key of ["LOGLAYER_SOURCE_ID", "LOGLAYER_API_KEY"])
      delete env[key];
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      const { installProcessErrorHandlers } = await import(${JSON.stringify(
        module,
      )});
      installProcessErrorHandlers();
      ${source};
    `,
      ],
      { env, encoding: "utf8", timeout: 10000 },
    );
    equal(child.status, 1);
    match(child.stderr, new RegExp(message));
    match(child.stderr, /fatal-test/);
  });
}
