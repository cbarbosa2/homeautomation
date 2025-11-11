// logger.ts
// Simple file logger with daily rotation for Deno

const LOG_TO_FILE =
  (Deno.env.get("LOG_TO_FILE") ?? "true").toLowerCase() === "true";

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

async function writeLog(level: string, message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;
  if (LOG_TO_FILE) {
    await ensureLogDir();
    const filePath = getLogFilePath();
    await Deno.writeTextFile(filePath, line, { append: true });
  } else {
    if (level === "ERROR") {
      console.error(line);
    } else if (level === "WARN") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export async function log(message: string) {
  await writeLog("INFO", message);
}

export async function warn(message: string) {
  await writeLog("WARN", message);
}

export async function error(message: string) {
  await writeLog("ERROR", message);
}
