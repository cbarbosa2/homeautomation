import { load } from "@std/dotenv";
await load({ export: true });

// Use dynamic import so the env is loaded before `main.ts` is evaluated.
await import("./main.ts");
