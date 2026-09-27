import { Temporal } from "./temporal.ts";
import { logError, logInfo } from "./logger.ts";

export interface TaskInfo {
  name: string;
  type: "cron" | "interval";
  schedule: string;
  handler: () => void | Promise<void>;
  intervalId?: number;
}

export class TaskScheduler {
  private scheduledTasks = new Map<string, TaskInfo>();

  /**
   * Schedule a task using cron expression
   * @param name - Unique name for the task
   * @param cronExpression - Standard cron expression (e.g., "0 8 * * *" for 8 AM daily)
   * @param handler - Function to execute
   */
  cron(
    name: string,
    cronExpression: string,
    handler: () => Promise<void> | void,
  ): void {
    logInfo(`⏰ Scheduling task "${name}" with cron: ${cronExpression}`);

    const cronHandler = async () => {
      try {
        logInfo(`🔄 Executing scheduled task: ${name}`);
        await handler();
        logInfo(`✅ Completed scheduled task: ${name}`);
      } catch (error) {
        logError(`❌ Error in scheduled task "${name}":`, error);
      }
    };

    Deno.cron(name, cronExpression, cronHandler);
    this.scheduledTasks.set(name, {
      name,
      type: "cron",
      schedule: cronExpression,
      handler: cronHandler,
    });
  }

  /**
   * Schedule a task to run at the given interval
   * @param name - Unique name for the task
   * @param duration - Time between executions
   * @param handler - Function to execute
   */
  interval(
    name: string,
    duration: Temporal.Duration,
    handler: () => Promise<void> | void,
  ): void {
    logInfo(
      `⏰ Scheduling task "${name}" every ${duration.total("seconds")} seconds`,
    );

    let running = false;
    const intervalHandler = async () => {
      if (running) return;
      running = true;
      try {
        logInfo(`🔄 Executing scheduled task: ${name}`);
        await handler();
        logInfo(`✅ Completed scheduled task: ${name}`);
      } catch (error) {
        logError(`❌ Error in scheduled task "${name}":`, error);
      } finally {
        running = false;
      }
    };

    // Execute immediately
    intervalHandler();

    // Then schedule recurring
    const intervalId = setInterval(
      intervalHandler,
      duration.total("milliseconds"),
    );
    this.scheduledTasks.set(name, {
      name,
      type: "interval",
      schedule: `Every ${duration.total("seconds")}s`,
      handler: intervalHandler,
      intervalId,
    });
  }

  /**
   * Get all task information
   */
  getAllTaskInfo(): TaskInfo[] {
    return Array.from(this.scheduledTasks.values());
  }

  /**
   * Manually trigger a task by name
   */
  async triggerTask(name: string): Promise<boolean> {
    const task = this.scheduledTasks.get(name);
    if (task) {
      logInfo(`🔄 Manually triggering task: ${name}`);
      try {
        await task.handler();
        logInfo(`✅ Manually triggered task completed: ${name}`);
        return true;
      } catch (error) {
        logError(`❌ Error manually triggering task "${name}":`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * Stop a scheduled task
   * @param name - Name of the task to stop
   */
  stop(name: string): boolean {
    const task = this.scheduledTasks.get(name);
    if (task && task.type === "interval" && task.intervalId) {
      clearInterval(task.intervalId);
      this.scheduledTasks.delete(name);
      logInfo(`🛑 Stopped scheduled task: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Terminate all scheduled tasks
   */
  terminateAll(): void {
    logInfo("🛑 Terminating all scheduled tasks...");
    for (const [name, task] of this.scheduledTasks.entries()) {
      if (task.type === "interval" && task.intervalId) {
        clearInterval(task.intervalId);
        logInfo(`🛑 Stopped interval task: ${name}`);
      } else if (task.type === "cron") {
        logInfo(`🛑 Stopped cron task: ${name}`);
      }
    }
    this.scheduledTasks.clear();
    logInfo("✅ All scheduled tasks terminated");
  }
}

// Export a singleton instance
export const scheduler = new TaskScheduler();
