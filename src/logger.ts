// logger.ts
// Simple file logger with daily rotation for Deno

import { LOG_TO_FILE } from "./constants.ts";

const LOG_DIR = "./logs";
const LOG_PREFIX = "homeautomation";

function getLogFilePath(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${LOG_DIR}/${LOG_PREFIX}-${yyyy}-${mm}-${dd}.log`;
}

async function ensureLogDir() {
  try {
    await Deno.mkdir(LOG_DIR, { recursive: true });
  } catch (_) {}
}

async function writeLog(level: string, ...args: unknown[]) {
  if (LOG_TO_FILE) {
    const timestamp = new Date().toISOString();
    const message = args
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    const line = `[${timestamp}] [${level}] ${message}\n`;

    await ensureLogDir();
    const filePath = getLogFilePath();
    await Deno.writeTextFile(filePath, line, { append: true });
  } else {
    if (level === "ERROR") {
      console.error(...args);
    } else if (level === "WARN") {
      console.warn(...args);
    } else {
      console.log(...args);
    }
  }
}

export async function logInfo(...args: unknown[]) {
  await writeLog("INFO", ...args);
}

export async function logWarn(...args: unknown[]) {
  await writeLog("WARN", ...args);
}

export async function logError(...args: unknown[]) {
  await writeLog("ERROR", ...args);
}
