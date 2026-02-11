import { DispatchEnvelope, ProviderAdapter } from "./types";

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class MockProviderAdapter implements ProviderAdapter {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  async dispatch(
    envelope: DispatchEnvelope,
    hooks: {
      onUpdate: (partial: string) => Promise<void> | void;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    const words = envelope.content.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];

    for (const word of words) {
      if (hooks.signal?.aborted) {
        throw new Error(`Dispatch aborted: ${envelope.dispatch_id}`);
      }

      chunks.push(word);
      await hooks.onUpdate(`[${this.name}] ${chunks.join(" ")}`);
      await wait(40);
    }

    return `[${this.name}] completed response for: ${envelope.content}`;
  }
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): ProviderAdapter {
    const adapter = this.adapters.get(name);

    if (!adapter) {
      throw new Error(`No ProviderAdapter registered for ${name}`);
    }

    return adapter;
  }
}
