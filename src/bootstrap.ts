import { loadEnv } from "./load-env.ts";

loadEnv();

// Use dynamic import so the env is loaded before `main.ts` is evaluated.
await import("./main.ts");
