import { MentionParser } from "./MentionParser";
import { AdapterRegistry } from "./adapters";
import {
  ActivityEvent,
  DispatchEnvelope,
  DispatchResponse,
  DispatchState,
  DispatchStore,
  ProviderRegistry,
} from "./types";

const randomId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class DispatchCoordinator {
  private readonly parser: MentionParser;

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly store: DispatchStore,
    private readonly onActivity: (event: ActivityEvent) => Promise<void> | void,
  ) {
    this.parser = new MentionParser(providers);
  }

  async dispatch(composedPrompt: string, conversationId = randomId()): Promise<DispatchState> {
    const parsed = this.parser.parse(composedPrompt);

    const envelopes: DispatchEnvelope[] = parsed.map((message) => {
      const provider = this.providers[message.alias];
      if (!provider) {
        throw new Error(`Unknown provider alias: ${message.alias}`);
      }

      return {
        conversation_id: conversationId,
        dispatch_id: randomId(),
        provider_alias: message.alias,
        provider_name: provider.providerName,
        target: provider.target,
        adapter_name: provider.transportAdapter,
        content: message.content,
        policy: provider.policy,
        created_at: new Date().toISOString(),
      };
    });

    const initialResponses: DispatchResponse[] = envelopes.map((envelope) => ({
      dispatch_id: envelope.dispatch_id,
      provider_alias: envelope.provider_alias,
      status: "pending",
      updated_at: new Date().toISOString(),
    }));

    const initialState: DispatchState = {
      conversation_id: conversationId,
      input: composedPrompt,
      created_at: new Date().toISOString(),
      envelopes,
      responses: initialResponses,
      status: "in_flight",
    };

    await this.store.save(initialState);

    await Promise.all(
      envelopes.map(async (envelope) => {
        await this.emit("dispatch.created", envelope, { content: envelope.content });
        const adapter = this.adapterRegistry.get(envelope.adapter_name);

        await this.emit("dispatch.started", envelope, { adapter: adapter.name });

        await this.store.updateResponse(conversationId, {
          dispatch_id: envelope.dispatch_id,
          provider_alias: envelope.provider_alias,
          status: "in_flight",
          updated_at: new Date().toISOString(),
        });

        try {
          const output = await this.runWithRetry(envelope, async () =>
            adapter.dispatch(envelope, {
              onUpdate: async (partial: string) => {
                await this.emit("dispatch.update", envelope, { partial });
              },
            }),
          );

          const completed: DispatchResponse = {
            dispatch_id: envelope.dispatch_id,
            provider_alias: envelope.provider_alias,
            status: "completed",
            output,
            updated_at: new Date().toISOString(),
          };

          await this.store.updateResponse(conversationId, completed);
          await this.emit("dispatch.completed", envelope, { output });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failed: DispatchResponse = {
            dispatch_id: envelope.dispatch_id,
            provider_alias: envelope.provider_alias,
            status: "failed",
            error: message,
            updated_at: new Date().toISOString(),
          };

          await this.store.updateResponse(conversationId, failed, "partial_failure");
          await this.emit("dispatch.failed", envelope, { error: message });
        }
      }),
    );

    const finalState = await this.store.load(conversationId);

    if (!finalState) {
      throw new Error(`Conversation state missing for ${conversationId}`);
    }

    const allCompleted = finalState.responses.every(
      (response) => response.status === "completed",
    );

    finalState.status = allCompleted ? "completed" : "partial_failure";
    await this.store.save(finalState);

    return finalState;
  }

  async recoverInFlightTasks(): Promise<DispatchState[]> {
    return this.store.listInFlight();
  }

  private async runWithRetry<T>(
    envelope: DispatchEnvelope,
    action: () => Promise<T>,
  ): Promise<T> {
    const retries = envelope.policy.retry.retries;

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= retries) {
      try {
        const timeoutPromise = new Promise<T>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Dispatch timeout after ${envelope.policy.timeoutMs}ms`)),
            envelope.policy.timeoutMs,
          );
        });

        return await Promise.race([action(), timeoutPromise]);
      } catch (error) {
        lastError = error;
        attempt += 1;

        if (attempt > retries) {
          break;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, envelope.policy.retry.backoffMs * attempt),
        );
      }
    }

    throw lastError;
  }

  private async emit(
    type: ActivityEvent["type"],
    envelope: DispatchEnvelope,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.onActivity({
      type,
      conversation_id: envelope.conversation_id,
      dispatch_id: envelope.dispatch_id,
      provider_alias: envelope.provider_alias,
      timestamp: new Date().toISOString(),
      payload,
    });
  }
}
