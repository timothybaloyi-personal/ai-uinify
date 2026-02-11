import { DispatchResponse, DispatchState, DispatchStore } from "./types";

const KEY_PREFIX = "orchestrator.dispatch";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  length: number;
}

class InMemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  get length(): number {
    return this.data.size;
  }
}

export class LocalDispatchStore implements DispatchStore {
  private readonly storage: StorageLike;

  constructor(storage?: StorageLike) {
    this.storage = storage ?? this.resolveStorage();
  }

  async save(state: DispatchState): Promise<void> {
    this.storage.setItem(this.key(state.conversation_id), JSON.stringify(state));
  }

  async load(conversationId: string): Promise<DispatchState | null> {
    const payload = this.storage.getItem(this.key(conversationId));
    return payload ? (JSON.parse(payload) as DispatchState) : null;
  }

  async listInFlight(): Promise<DispatchState[]> {
    const results: DispatchState[] = [];

    for (let index = 0; index < this.storage.length; index += 1) {
      const storageKey = this.storage.key(index);
      if (!storageKey?.startsWith(KEY_PREFIX)) {
        continue;
      }

      const payload = this.storage.getItem(storageKey);
      if (!payload) {
        continue;
      }

      const state = JSON.parse(payload) as DispatchState;
      if (state.status === "pending" || state.status === "in_flight") {
        results.push(state);
      }
    }

    return results;
  }

  async updateResponse(
    conversationId: string,
    response: DispatchResponse,
    aggregateStatus?: DispatchState["status"],
  ): Promise<void> {
    const state = await this.load(conversationId);
    if (!state) {
      return;
    }

    const updatedResponses = state.responses.filter(
      (existing) => existing.dispatch_id !== response.dispatch_id,
    );
    updatedResponses.push(response);

    await this.save({
      ...state,
      responses: updatedResponses,
      status: aggregateStatus ?? state.status,
    });
  }

  private key(conversationId: string): string {
    return `${KEY_PREFIX}:${conversationId}`;
  }

  private resolveStorage(): StorageLike {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      return globalThis.localStorage as StorageLike;
    }

    return new InMemoryStorage();
  }
}
