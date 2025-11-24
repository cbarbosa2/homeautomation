// src/logger.ts
// Explicit LogLayer integration with Logflare transport.
// Falls back to console when LogLayer credentials are not available.
import { LogLayer } from "loglayer";
import { LogflareTransport } from "@loglayer/transport-logflare";
import { serializeError } from "serialize-error";

export const LOGLAYER_SOURCE_ID = Deno.env.get("LOGLAYER_SOURCE_ID");
export const LOGLAYER_API_KEY = Deno.env.get("LOGLAYER_API_KEY");

// Determine a host identifier synchronously. Prefer explicit env `HOST_ID`,
// then `HOSTNAME`, then `/etc/hostname`, else fall back to 'unknown-host'.
function detectHostId(): string {
  const fromEnv =
    Deno.env.get("HOST_ID") || Deno.env.get("HOSTNAME") || Deno.env.get("HOST");
  if (fromEnv) return fromEnv;
  try {
    const hostname = Deno.readTextFileSync("/etc/hostname");
    if (hostname) return hostname.trim();
  } catch {
    // ignore
  }
  return "unknown-host";
}

const HOST_ID = detectHostId();

type LogLike = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  withMetadata: (metadata: Record<string, unknown>) => LogLike;
};

let logger: LogLike | undefined;

if (LOGLAYER_SOURCE_ID && LOGLAYER_API_KEY) {
  try {
    logger = new LogLayer({
      errorSerializer: serializeError,
      transport: new LogflareTransport({
        sourceId: LOGLAYER_SOURCE_ID,
        apiKey: LOGLAYER_API_KEY,
        onError: (err: unknown) => {
          console.error("Failed to send logs to Logflare:", err);
        },
        onDebug: () => {
          // console.log("Log entry being sent to Logflare:", entry);
        },
      }),
    }) as unknown as LogLike;
  } catch (e) {
    console.error("Failed to initialize LogLayer transport:", e);
    logger = undefined;
  }
}

export function logInfo(...args: unknown[]): void {
  log("info", ...args);
}

export function logWarn(...args: unknown[]): void {
  log("warn", ...args);
}

export function logError(...args: unknown[]): void {
  log("error", ...args);
}

function log(level: "info" | "warn" | "error", ...args: unknown[]): void {
  const payload = makePayload(args);
  if (
    logger &&
    typeof logger.withMetadata === "function" &&
    typeof logger[level] === "function"
  ) {
    try {
      logger.withMetadata({ host: HOST_ID })[level](payload);
    } catch (e) {
      console.error(`LogLayer.${level} failed:`, e);
    }
  }
  console[level](...args);
}

function makePayload(args: unknown[]): unknown {
  if (args.length === 0) return undefined;
  if (args.length === 1) return args[0];
  const [first, second, ...rest] = args;
  if (typeof first === "string") {
    if (typeof second === "object" && second !== null && rest.length === 0) {
      return {
        message: first,
        ...(second as Record<string, unknown>),
      };
    }
    return { message: first, meta: [second, ...rest] };
  }
  return { ...args };
}
