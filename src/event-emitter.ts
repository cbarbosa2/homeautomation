import { logError } from "./logger.ts";

type EventHandler<T> = (value: T) => void | Promise<void>;

export class EventEmitter<T> {
  private handlers: EventHandler<T>[] = [];

  subscribe(handler: EventHandler<T>): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index > -1) this.handlers.splice(index, 1);
    };
  }

  async emit(value: T): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(value);
      } catch (error) {
        logError("Event handler error:", error);
      }
    }
  }
}
