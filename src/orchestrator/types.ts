export type MentionAlias = string;

export interface RetryPolicy {
  retries: number;
  backoffMs: number;
}

export interface ProviderPolicy {
  timeoutMs: number;
  retry: RetryPolicy;
}

export interface ProviderTarget {
  tabId: number;
  sessionId: string;
}

export interface ProviderConfig {
  providerName: string;
  aliases: MentionAlias[];
  transportAdapter: string;
  target: ProviderTarget;
  policy: ProviderPolicy;
}

export type ProviderRegistry = Record<MentionAlias, ProviderConfig>;

export interface ParsedMentionMessage {
  alias: MentionAlias;
  content: string;
}

export interface DispatchEnvelope {
  conversation_id: string;
  dispatch_id: string;
  provider_alias: MentionAlias;
  provider_name: string;
  target: ProviderTarget;
  adapter_name: string;
  content: string;
  policy: ProviderPolicy;
  created_at: string;
}

export interface DispatchResponse {
  dispatch_id: string;
  provider_alias: MentionAlias;
  status: "pending" | "in_flight" | "completed" | "failed";
  output?: string;
  error?: string;
  updated_at: string;
}

export interface ActivityEvent {
  type:
    | "dispatch.created"
    | "dispatch.started"
    | "dispatch.update"
    | "dispatch.completed"
    | "dispatch.failed";
  conversation_id: string;
  dispatch_id: string;
  provider_alias: MentionAlias;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly name: string;
  dispatch(
    envelope: DispatchEnvelope,
    hooks: {
      onUpdate: (partial: string) => Promise<void> | void;
      signal?: AbortSignal;
    },
  ): Promise<string>;
}

export interface DispatchState {
  conversation_id: string;
  input: string;
  created_at: string;
  envelopes: DispatchEnvelope[];
  responses: DispatchResponse[];
  status: "pending" | "in_flight" | "completed" | "partial_failure";
}

export interface DispatchStore {
  save(state: DispatchState): Promise<void>;
  load(conversationId: string): Promise<DispatchState | null>;
  listInFlight(): Promise<DispatchState[]>;
  updateResponse(
    conversationId: string,
    response: DispatchResponse,
    aggregateStatus?: DispatchState["status"],
  ): Promise<void>;
}
