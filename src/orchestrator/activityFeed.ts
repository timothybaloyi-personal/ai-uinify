import { ActivityEvent } from "./types";

export type ActivityListener = (event: ActivityEvent) => Promise<void> | void;

export class UnifiedActivityFeed {
  private readonly listeners = new Set<ActivityListener>();
  private readonly buffer: ActivityEvent[] = [];

  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async publish(event: ActivityEvent): Promise<void> {
    this.buffer.push(event);

    await Promise.all([...this.listeners].map((listener) => listener(event)));
  }

  snapshot(): ActivityEvent[] {
    return [...this.buffer];
  }
}
