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
    handler: () => Promise<void> | void
  ): void {
    console.log(`⏰ Scheduling task "${name}" with cron: ${cronExpression}`);

    const cronHandler = async () => {
      try {
        console.log(`🔄 Executing scheduled task: ${name}`);
        await handler();
        console.log(`✅ Completed scheduled task: ${name}`);
      } catch (error) {
        console.error(`❌ Error in scheduled task "${name}":`, error);
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
   * Schedule a task to run at intervals based on seconds
   * @param name - Unique name for the task
   * @param intervalSeconds - Interval in seconds
   * @param handler - Function to execute
   */
  interval(
    name: string,
    intervalSeconds: number,
    handler: () => Promise<void> | void
  ): void {
    console.log(
      `⏰ Scheduling task "${name}" every ${intervalSeconds} seconds`
    );

    const intervalHandler = async () => {
      try {
        console.log(`🔄 Executing scheduled task: ${name}`);
        await handler();
        console.log(`✅ Completed scheduled task: ${name}`);
      } catch (error) {
        console.error(`❌ Error in scheduled task "${name}":`, error);
      }
    };

    // Execute immediately
    intervalHandler();

    // Then schedule recurring
    const intervalId = setInterval(intervalHandler, intervalSeconds * 1000);
    this.scheduledTasks.set(name, {
      name,
      type: "interval",
      schedule: `Every ${intervalSeconds}s`,
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
      console.log(`🔄 Manually triggering task: ${name}`);
      try {
        await task.handler();
        console.log(`✅ Manually triggered task completed: ${name}`);
        return true;
      } catch (error) {
        console.error(`❌ Error manually triggering task "${name}":`, error);
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
      console.log(`🛑 Stopped scheduled task: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Terminate all scheduled tasks
   */
  terminateAll(): void {
    console.log("🛑 Terminating all scheduled tasks...");
    for (const [name, task] of this.scheduledTasks.entries()) {
      if (task.type === "interval" && task.intervalId) {
        clearInterval(task.intervalId);
        console.log(`🛑 Stopped interval task: ${name}`);
      } else if (task.type === "cron") {
        console.log(`🛑 Stopped cron task: ${name}`);
      }
    }
    this.scheduledTasks.clear();
    console.log("✅ All scheduled tasks terminated");
  }
}

// Export a singleton instance
export const scheduler = new TaskScheduler();
