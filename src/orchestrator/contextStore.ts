import { ContextScope, ContextStore, ScopedContextEntry } from "./context";

export class LocalContextStore implements ContextStore {
  private readonly entries = new Map<string, ScopedContextEntry>();

  async add(
    entry: Omit<ScopedContextEntry, "createdAt" | "updatedAt">,
  ): Promise<ScopedContextEntry> {
    const timestamp = new Date().toISOString();
    const persisted: ScopedContextEntry = {
      ...entry,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.entries.set(persisted.id, persisted);
    return persisted;
  }

  async list(): Promise<ScopedContextEntry[]> {
    return [...this.entries.values()];
  }

  async listByScope(scope: ContextScope): Promise<ScopedContextEntry[]> {
    const entries = await this.list();
    return entries.filter((entry) => entry.scope === scope);
  }

  async update(entry: ScopedContextEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async getById(id: string): Promise<ScopedContextEntry | null> {
    return this.entries.get(id) ?? null;
  }
}
