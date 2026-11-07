import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["--test", ".test-dist/src/**/*.test.js"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      VICTRON_PORTAL_ID: "test-portal",
      VICTRON_INSTALLATION_ID: "123456",
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
