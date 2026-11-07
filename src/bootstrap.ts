import { config } from "dotenv";

config({ quiet: true });

// Use dynamic import so the env is loaded before `main.ts` is evaluated.
await import("./main.ts");
