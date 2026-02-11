import { providers } from "../../config/providers";
import { DispatchCoordinator } from "./DispatchCoordinator";
import { AdapterRegistry, MockProviderAdapter } from "./adapters";
import { UnifiedActivityFeed } from "./activityFeed";
import { LocalDispatchStore } from "./localStore";

export { MentionParser } from "./MentionParser";
export type { DispatchEnvelope, ProviderAdapter } from "./types";
export { DispatchCoordinator } from "./DispatchCoordinator";

export const createOrchestratorService = (): {
  coordinator: DispatchCoordinator;
  activityFeed: UnifiedActivityFeed;
} => {
  const adapterRegistry = new AdapterRegistry();

  adapterRegistry.register(new MockProviderAdapter("chrome-tab-messenger"));

  const activityFeed = new UnifiedActivityFeed();
  const store = new LocalDispatchStore();

  const coordinator = new DispatchCoordinator(
    providers,
    adapterRegistry,
    store,
    async (event) => {
      await activityFeed.publish(event);
    },
  );

  return { coordinator, activityFeed };
};
