import {
  ContextScope,
  PromotionApproval,
  ProviderSession,
  ScopedContextEntry,
} from "../orchestrator/context";

export interface ContextScopeControlActions {
  onScopeSelected: (scope: ContextScope) => Promise<ScopedContextEntry[]>;
  onPromote: (entryId: string, approval: PromotionApproval) => Promise<void>;
  onDemote: (entryId: string, providerSession: ProviderSession) => Promise<void>;
}

export const mountContextScopeControls = (
  container: HTMLElement,
  actions: ContextScopeControlActions,
): void => {
  const title = document.createElement("h3");
  title.textContent = "Context Scopes";

  const scopePicker = document.createElement("select");
  ["global_shared", "team_role", "provider_private"].forEach((scopeValue) => {
    const option = document.createElement("option");
    option.value = scopeValue;
    option.textContent = scopeValue;
    scopePicker.append(option);
  });

  const refreshButton = document.createElement("button");
  refreshButton.textContent = "Load scope";

  const promoteButton = document.createElement("button");
  promoteButton.textContent = "Promote to global_shared";

  const demoteButton = document.createElement("button");
  demoteButton.textContent = "Demote to provider_private";

  const entryInput = document.createElement("input");
  entryInput.placeholder = "Context entry id";

  const providerAliasInput = document.createElement("input");
  providerAliasInput.placeholder = "Provider alias (e.g. @gpt)";

  const providerSessionInput = document.createElement("input");
  providerSessionInput.placeholder = "Provider session id";

  const status = document.createElement("pre");

  refreshButton.addEventListener("click", async () => {
    const selectedScope = scopePicker.value as ContextScope;
    const entries = await actions.onScopeSelected(selectedScope);
    status.textContent = JSON.stringify(entries, null, 2);
  });

  promoteButton.addEventListener("click", async () => {
    if (!entryInput.value.trim()) {
      status.textContent = "Missing context entry id for promotion.";
      return;
    }

    await actions.onPromote(entryInput.value.trim(), {
      approved: true,
      approvedBy: "reviewer",
      reason: "Reviewed and approved in dashboard",
      promotedAt: new Date().toISOString(),
    });

    status.textContent = `Promoted ${entryInput.value.trim()} to global_shared.`;
  });

  demoteButton.addEventListener("click", async () => {
    if (!entryInput.value.trim()) {
      status.textContent = "Missing context entry id for demotion.";
      return;
    }

    const providerAlias = providerAliasInput.value.trim();
    const providerSessionId = providerSessionInput.value.trim();

    if (!providerAlias || !providerSessionId) {
      status.textContent = "Provider alias and session id are required for demotion.";
      return;
    }

    await actions.onDemote(entryInput.value.trim(), {
      providerAlias,
      providerSessionId,
    });

    status.textContent = `Demoted ${entryInput.value.trim()} to provider_private (${providerAlias}/${providerSessionId}).`;
  });

  container.append(
    title,
    scopePicker,
    refreshButton,
    document.createElement("br"),
    entryInput,
    providerAliasInput,
    providerSessionInput,
    document.createElement("br"),
    promoteButton,
    demoteButton,
    status,
  );
};
