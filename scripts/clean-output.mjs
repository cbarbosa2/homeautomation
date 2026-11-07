import { rmSync } from "node:fs";

const directory = process.argv[2];
if (!["dist", ".test-dist"].includes(directory)) {
  throw new Error("Expected dist or .test-dist");
}
rmSync(directory, { recursive: true, force: true });
