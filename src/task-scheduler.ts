import cron, { type ScheduledTask } from "node-cron";
import { Temporal } from "./temporal.ts";
import { logError, logInfo } from "./logger.ts";

export interface TaskInfo {
  name: string;
  type: "cron" | "interval";
  schedule: string;
  handler: () => void | Promise<void>;
  intervalId?: ReturnType<typeof setInterval>;
}

export class TaskScheduler {
  private scheduledTasks = new Map<string, TaskInfo>();
  private cronTasks = new Map<string, ScheduledTask>();

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

    this.stop(name);
    this.cronTasks.set(
      name,
      cron.schedule(cronExpression, cronHandler, {
        name,
        timezone: "UTC",
        noOverlap: true,
      }),
    );
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

    this.stop(name);

    // Execute immediately
    void intervalHandler();

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
    if (!task) return false;
    if (task.intervalId) clearInterval(task.intervalId);
    this.cronTasks.get(name)?.destroy();
    this.cronTasks.delete(name);
    this.scheduledTasks.delete(name);
    logInfo(`🛑 Stopped scheduled task: ${name}`);
    return true;
  }

  /**
   * Terminate all scheduled tasks
   */
  terminateAll(): void {
    logInfo("🛑 Terminating all scheduled tasks...");
    for (const name of this.scheduledTasks.keys()) {
      this.stop(name);
    }
    logInfo("✅ All scheduled tasks terminated");
  }
}

// Export a singleton instance
export const scheduler = new TaskScheduler();
