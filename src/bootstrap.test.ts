import { test } from "node:test";
import { deepStrictEqual, equal, match } from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
          'MIGRATION_FILE=loaded\nMIGRATION_OVERRIDE=file\nMIGRATION_QUOTED="value # kept"\nMIGRATION_MULTILINE="first\nsecond"\n',
        );
      }

      const bootstrap = new URL("./bootstrap.js", import.meta.url).href;
      const main = new URL("./main.js", import.meta.url).href;
      const source = `console.log(JSON.stringify([process.env.MIGRATION_FILE ?? null, process.env.MIGRATION_OVERRIDE, process.env.MIGRATION_QUOTED ?? null, process.env.MIGRATION_MULTILINE ?? null]));`;
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
      const { PATH } = process.env;
      const env: NodeJS.ProcessEnv = {
        PATH,
        MIGRATION_OVERRIDE: "existing",
      };
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", code],
        { cwd: directory, env, encoding: "utf8", timeout: 10000 },
      );

      equal(child.status, 0, child.stderr);
      deepStrictEqual(JSON.parse(child.stdout), [
        withFile ? "loaded" : null,
        "existing",
        withFile ? "value # kept" : null,
        withFile ? "first\nsecond" : null,
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("bootstrap stops before importing the application when .env cannot be read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "homeautomation-env-error-"));

  try {
    await mkdir(join(directory, ".env"));
    const bootstrap = new URL("./bootstrap.js", import.meta.url).href;
    const main = new URL("./main.js", import.meta.url).href;
    const code = `
      import { registerHooks } from 'node:module';
      registerHooks({ load(url, context, next) {
        if (url === ${JSON.stringify(main)}) {
          console.log('application imported');
          return { format: 'module', source: '', shortCircuit: true };
        }
        return next(url, context);
      }});
      try {
        await import(${JSON.stringify(bootstrap)});
        console.log('unexpected success');
      } catch (error) {
        console.log(error.code);
      }
    `;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code],
      { cwd: directory, encoding: "utf8", timeout: 10000 },
    );

    equal(child.status, 0, child.stderr);
    // Node can report either error for a directory, depending on the platform.
    match(child.stdout.trim(), /^(EISDIR|ERR_INVALID_ARG_TYPE)$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
