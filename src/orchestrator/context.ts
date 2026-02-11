import { MentionAlias } from "./types";

export type ContextScope = "global_shared" | "team_role" | "provider_private";
export type TeamRole = "architect" | "dev" | "reviewer";

export interface TaskCard {
  id: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  constraints?: string[];
}

export interface ScopedContextEntry {
  id: string;
  scope: ContextScope;
  content: string;
  tags?: string[];
  roleCohorts?: TeamRole[];
  providerAlias?: MentionAlias;
  providerSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderSession {
  providerAlias: MentionAlias;
  providerSessionId: string;
}

export interface PromotionApproval {
  approved: boolean;
  approvedBy: TeamRole;
  reason: string;
  promotedAt: string;
}

export interface ComposedPromptPayload {
  taskCard: TaskCard;
  roleInstruction: string;
  scopedMemory: ScopedContextEntry[];
}

export interface ContextComposerInput {
  taskCard: TaskCard;
  role: TeamRole;
  providerSession: ProviderSession;
}

export interface ContextStore {
  add(entry: Omit<ScopedContextEntry, "createdAt" | "updatedAt">): Promise<ScopedContextEntry>;
  list(): Promise<ScopedContextEntry[]>;
  listByScope(scope: ContextScope): Promise<ScopedContextEntry[]>;
  update(entry: ScopedContextEntry): Promise<void>;
  getById(id: string): Promise<ScopedContextEntry | null>;
}

const ROLE_INSTRUCTIONS: Record<TeamRole, string> = {
  architect:
    "Focus on system boundaries, interfaces, migration path, and non-functional risks.",
  dev: "Deliver implementation-ready details with clear assumptions and edge-case handling.",
  reviewer: "Evaluate correctness, regressions, and policy compliance before approval.",
};

export class ContextComposer {
  constructor(private readonly contextStore: ContextStore) {}

  async compose(input: ContextComposerInput): Promise<ComposedPromptPayload> {
    const entries = await this.contextStore.list();

    const scopedMemory = entries.filter((entry) =>
      this.isEntryVisible(entry, input.role, input.providerSession),
    );

    return {
      taskCard: input.taskCard,
      roleInstruction: ROLE_INSTRUCTIONS[input.role],
      scopedMemory,
    };
  }

  private isEntryVisible(
    entry: ScopedContextEntry,
    role: TeamRole,
    providerSession: ProviderSession,
  ): boolean {
    if (entry.scope === "global_shared") {
      return true;
    }

    if (entry.scope === "team_role") {
      return !!entry.roleCohorts?.includes(role);
    }

    return (
      entry.providerAlias === providerSession.providerAlias &&
      entry.providerSessionId === providerSession.providerSessionId
    );
  }
}

export class ContextMergeEngine {
  constructor(private readonly contextStore: ContextStore) {}

  async promoteProviderPrivateToGlobal(
    entryId: string,
    approval: PromotionApproval,
  ): Promise<ScopedContextEntry> {
    const entry = await this.contextStore.getById(entryId);
    if (!entry) {
      throw new Error(`Context entry not found: ${entryId}`);
    }

    if (entry.scope !== "provider_private") {
      throw new Error("Only provider_private entries can be promoted to global_shared");
    }

    if (!approval.approved) {
      throw new Error("Promotion rejected: approval.approved must be true");
    }

    const promoted: ScopedContextEntry = {
      ...entry,
      scope: "global_shared",
      updatedAt: approval.promotedAt,
      tags: [...(entry.tags ?? []), `approved_by:${approval.approvedBy}`],
    };

    await this.contextStore.update(promoted);
    return promoted;
  }

  async demoteToProviderPrivate(
    entryId: string,
    providerSession: ProviderSession,
  ): Promise<ScopedContextEntry> {
    const entry = await this.contextStore.getById(entryId);
    if (!entry) {
      throw new Error(`Context entry not found: ${entryId}`);
    }

    const demoted: ScopedContextEntry = {
      ...entry,
      scope: "provider_private",
      providerAlias: providerSession.providerAlias,
      providerSessionId: providerSession.providerSessionId,
      updatedAt: new Date().toISOString(),
    };

    await this.contextStore.update(demoted);
    return demoted;
  }
}

export class DashboardContextController {
  constructor(
    private readonly contextStore: ContextStore,
    private readonly mergeEngine: ContextMergeEngine,
  ) {}

  async addContextEntry(
    entry: Omit<ScopedContextEntry, "createdAt" | "updatedAt">,
  ): Promise<ScopedContextEntry> {
    return this.contextStore.add(entry);
  }

  async listContextByScope(scope: ContextScope): Promise<ScopedContextEntry[]> {
    return this.contextStore.listByScope(scope);
  }

  async promoteToGlobalShared(
    entryId: string,
    approval: PromotionApproval,
  ): Promise<ScopedContextEntry> {
    return this.mergeEngine.promoteProviderPrivateToGlobal(entryId, approval);
  }

  async demoteToProviderPrivate(
    entryId: string,
    providerSession: ProviderSession,
  ): Promise<ScopedContextEntry> {
    return this.mergeEngine.demoteToProviderPrivate(entryId, providerSession);
  }
}
