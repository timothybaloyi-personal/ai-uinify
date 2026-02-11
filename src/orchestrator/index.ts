import { providers } from "../../config/providers";
import { DispatchCoordinator } from "./DispatchCoordinator";
import { AdapterRegistry, MockProviderAdapter } from "./adapters";
import { UnifiedActivityFeed } from "./activityFeed";
import {
  ContextComposer,
  ContextMergeEngine,
  DashboardContextController,
} from "./context";
import { LocalContextStore } from "./contextStore";
import { LocalDispatchStore } from "./localStore";

export { MentionParser } from "./MentionParser";
export type { DispatchEnvelope, ProviderAdapter } from "./types";
export { DispatchCoordinator } from "./DispatchCoordinator";
export {
  ContextComposer,
  ContextMergeEngine,
  DashboardContextController,
} from "./context";
export { LocalContextStore } from "./contextStore";

export const createOrchestratorService = (): {
  coordinator: DispatchCoordinator;
  activityFeed: UnifiedActivityFeed;
  contextComposer: ContextComposer;
  dashboardContextController: DashboardContextController;
} => {
  const adapterRegistry = new AdapterRegistry();

  adapterRegistry.register(new MockProviderAdapter("chrome-tab-messenger"));

  const activityFeed = new UnifiedActivityFeed();
  const store = new LocalDispatchStore();
  const contextStore = new LocalContextStore();
  const contextMergeEngine = new ContextMergeEngine(contextStore);
  const contextComposer = new ContextComposer(contextStore);
  const dashboardContextController = new DashboardContextController(
    contextStore,
    contextMergeEngine,
  );

  const coordinator = new DispatchCoordinator(
    providers,
    adapterRegistry,
    store,
    async (event) => {
      await activityFeed.publish(event);
    },
  );

  return {
    coordinator,
    activityFeed,
    contextComposer,
    dashboardContextController,
  };
};
