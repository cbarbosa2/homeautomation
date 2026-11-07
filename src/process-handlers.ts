import { logError } from "./logger.ts";

/** Fatal process errors must exit so the service manager can restart safely. */
export function installProcessErrorHandlers(): void {
  process.on("unhandledRejection", (reason: unknown) => {
    logError(`Unhandled promise rejection: ${String(reason)}`);
    process.exit(1);
  });

  process.on("uncaughtException", (error: Error) => {
    logError(`Uncaught exception: ${String(error)}`);
    process.exit(1);
  });
}
