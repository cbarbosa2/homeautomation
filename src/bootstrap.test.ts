import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

for (const withFile of [true, false]) {
  test(`bootstrap loads environment before application import (file=${withFile})`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "homeautomation-env-"));
    try {
      if (withFile) {
        await writeFile(
          join(directory, ".env"),
          "MIGRATION_FILE=loaded\nMIGRATION_OVERRIDE=file\n",
        );
      }
      const bootstrap = new URL("./bootstrap.js", import.meta.url).href;
      const main = new URL("./main.js", import.meta.url).href;
      const source = `console.log(JSON.stringify([process.env.MIGRATION_FILE ?? null, process.env.MIGRATION_OVERRIDE]));`;
      const code = `
        import { registerHooks } from 'node:module';
        registerHooks({ load(url, context, next) {
          if (url === ${JSON.stringify(
            main,
          )}) return { format: 'module', source: ${JSON.stringify(
            source,
          )}, shortCircuit: true };
          return next(url, context);
        }});
        await import(${JSON.stringify(bootstrap)});
      `;
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        MIGRATION_OVERRIDE: "existing",
      };
      const migrationFileKey = "MIGRATION_FILE";
      delete env[migrationFileKey];
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", code],
        { cwd: directory, env, encoding: "utf8", timeout: 10000 },
      );
      equal(child.status, 0, child.stderr);
      deepStrictEqual(JSON.parse(child.stdout), [
        withFile ? "loaded" : null,
        "existing",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
