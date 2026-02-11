import { ProviderConfig, ProviderRegistry } from "../src/orchestrator/types";

const basePolicy = {
  timeoutMs: 30_000,
  retry: {
    retries: 2,
    backoffMs: 500,
  },
};

const providerCatalog: ProviderConfig[] = [
  {
    providerName: "openai-chatgpt",
    aliases: ["@gpt", "@chatgpt"],
    transportAdapter: "chrome-tab-messenger",
    target: {
      tabId: 101,
      sessionId: "chatgpt-primary",
    },
    policy: basePolicy,
  },
  {
    providerName: "google-gemini",
    aliases: ["@gem", "@gemini"],
    transportAdapter: "chrome-tab-messenger",
    target: {
      tabId: 102,
      sessionId: "gemini-primary",
    },
    policy: {
      timeoutMs: 35_000,
      retry: {
        retries: 2,
        backoffMs: 750,
      },
    },
  },
  {
    providerName: "perplexity",
    aliases: ["@perp", "@perplexity"],
    transportAdapter: "chrome-tab-messenger",
    target: {
      tabId: 103,
      sessionId: "perplexity-primary",
    },
    policy: {
      timeoutMs: 25_000,
      retry: {
        retries: 1,
        backoffMs: 500,
      },
    },
  },
];

export const providers: ProviderRegistry = providerCatalog.reduce<ProviderRegistry>(
  (registry, provider) => {
    provider.aliases.forEach((alias) => {
      registry[alias] = provider;
    });

    return registry;
  },
  {},
);

export { providerCatalog };
