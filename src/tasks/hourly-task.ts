export abstract class HourlyTask {
  private interval: number | null = null;

  start(): void {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);

    const timeToNextHour = nextHour.getTime() - now.getTime();

    // Execute immediately on startup
    this.execute();

    // Schedule to run at the next hour
    setTimeout(() => {
      this.execute();

      // Then run every hour
      this.interval = setInterval(() => {
        this.execute();
      }, 60 * 60 * 1000); // 1 hour in milliseconds
    }, timeToNextHour);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  protected abstract execute(): Promise<void>;
}