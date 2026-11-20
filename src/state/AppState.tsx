import { feature } from 'bun:bundle';
import React, { useCallback, useContext, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { MailboxProvider } from '../context/mailbox.js';
import { DialogStoreProvider } from '../dialog/DialogStoreContext.js';
import { useSettingsChange } from '../hooks/useSettingsChange.js';
import { logForDebugging } from '../utils/debug.js';
import {
  createDisabledBypassPermissionsContext,
  isBypassPermissionsModeDisabled,
} from '../utils/permissions/permissionSetup.js';
import { getBootstrapSession } from '../utils/sessionHost.js';
import type { Session } from '../utils/sessionRoot.js';
import { applySettingsChange } from '../utils/settings/applySettingsChange.js';
import type { SettingsChangeExtra } from '../utils/settings/changeDetector.js';
import type { SettingSource } from '../utils/settings/constants.js';
import type { SettingsJson } from '../utils/settings/types.js';
import { ActivePluginsFacade, McpConnectionsFacade } from './appStateFacades.js';
import { createSessionHooksRegistry, type SessionHooksRegistry } from './sessionHooksRegistry.js';
import { createStore, updateAppState } from './store.js';
import { TasksV2Store } from '../hooks/useTasksV2.js';
import {
  defaultQueue,
  getActiveMessageQueue,
  type MessageQueueInstance,
  setActiveMessageQueue,
} from '../utils/messageQueueManager.js';
import { LeftoverIhrStoreProvider } from './leftoverIhrStore.js';

// DCE: voice context is ant-only. External builds get a noop provider that
// still wraps children in VoiceContext so useVoiceState never throws.
/* eslint-disable @typescript-eslint/no-require-imports */
const VoiceProvider: (props: { children: React.ReactNode }) => React.ReactNode = feature('VOICE_MODE')
  ? require('../context/voice.js').VoiceProvider
  : (() => {
      const { VoiceContext } = require('../context/voice.js');
      const noopStore = createStore({
        voiceState: 'idle' as const,
        voiceError: null as string | null,
        voiceInterimTranscript: '',
        voiceAudioLevels: [] as number[],
        voiceWarmingUp: false,
      });
      return ({ children }: { children: React.ReactNode }) => (
        <VoiceContext.Provider value={noopStore}>{children}</VoiceContext.Provider>
      );
    })();

/* eslint-enable @typescript-eslint/no-require-imports */
import { type AppState, type AppStateStore, getDefaultAppState, getDefaultSessionAppState } from './AppStateStore.js';

// TODO: Remove these re-exports once all callers import directly from
// ./AppStateStore.js. Kept for back-compat during migration so .ts callers
// can incrementally move off the .tsx import and stop pulling React.
export {
  type AppState,
  type AppStateStore,
  type CompletionBoundary,
  getDefaultAppState,
  getDefaultSessionAppState,
  IDLE_SPECULATION_STATE,
  type SpeculationResult,
  type SpeculationState,
} from './AppStateStore.js';

export const AppStoreContext = React.createContext<AppStateStore | null>(null);
/** Official `lDn` @195652056 — active Session context mounted by `<AppStateProvider />`. */
export const AppStateSessionContext = React.createContext<Session | null>(null);
/** Official `cDn` @195652056 — MCP connections facade mounted by `<AppStateProvider />`. */
export const McpConnectionsContext = React.createContext<McpConnectionsFacade | null>(null);
/** Official `dDn` @195652056 — Active plugins facade mounted by `<AppStateProvider />`. */
export const ActivePluginsContext = React.createContext<ActivePluginsFacade | null>(null);
/** Official `Se` @197297545 — SessionHooksRegistry mounted by `<AppStateProvider />`. */
export const SessionHooksRegistryContext = React.createContext<SessionHooksRegistry | null>(null);
/** Official `WMn` @197297545 — TaskStore mounted by `<AppStateProvider />`. */
export const TaskStoreContext = React.createContext<TasksV2Store | null>(null);
/** Official `zVe` @197245042 — MessageQueueInstance mounted by `<AppStateProvider />`. */
export const MessageQueueContext = React.createContext<MessageQueueInstance | null>(null);

type Props = {
  children: React.ReactNode;
  store?: AppStateStore;
  session?: Session;
  sessionHooks?: SessionHooksRegistry;
  messageQueue?: MessageQueueInstance;
  initialState?: AppState;
  onChangeAppState?: (args: { newState: AppState; oldState: AppState }) => void;
};

const HasAppStateContext = React.createContext<boolean>(false);

export function AppStateProvider({
  children,
  store: providedStore,
  session: providedSession,
  sessionHooks: providedSessionHooks,
  messageQueue: providedMessageQueue,
  initialState,
  onChangeAppState,
}: Props): React.ReactNode {
  // Don't allow nested AppStateProviders.
  const hasAppStateContext = useContext(HasAppStateContext);
  if (hasAppStateContext) {
    throw new Error('AppStateProvider can not be nested within another AppStateProvider');
  }

  // Store is created once and never changes -- stable context value means
  // the provider never triggers re-renders. Consumers subscribe to slices
  // via useSyncExternalStore in useAppState(selector).
  const [store] = useState(
    () => providedStore ?? createStore<AppState>(initialState ?? getDefaultAppState(), onChangeAppState),
  );

  // Official 2.1.328 `uZr` engineStore.current — point memory permission reads
  // at this live store so mid-session permission changes apply to CLAUDE.md /
  // @include / .claude/rules loads (registered at launch by main.tsx for
  // entrypoints without an AppStateProvider).
  useEffect(() => {
    const { registerClaudeMdPermissionContextSource } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/claudemd.js') as typeof import('../utils/claudemd.js');
    registerClaudeMdPermissionContextSource(() => store.getState().toolPermissionContext);
  }, [store]);
  const [session] = useState(() => providedSession ?? getBootstrapSession());
  const [sessionHooks] = useState(() => {
    const registry = providedSessionHooks ?? createSessionHooksRegistry();
    registry.bindStore(store);
    return registry;
  });
  const [taskStore] = useState(() => new TasksV2Store());
  const [messageQueue] = useState(() => providedMessageQueue ?? getActiveMessageQueue());
  useEffect(() => {
    if (!providedMessageQueue) return;
    setActiveMessageQueue(providedMessageQueue);
    return () => {
      if (getActiveMessageQueue() === providedMessageQueue) {
        setActiveMessageQueue(defaultQueue);
      }
    };
  }, [providedMessageQueue]);
  const [mcpConnections] = useState(() => McpConnectionsFacade.over(store));
  const [activePlugins] = useState(() => ActivePluginsFacade.over(store));

  // Check on mount if bypass mode should be disabled
  // This handles the race condition where remote settings load BEFORE this component mounts,
  // meaning the settings change notification was sent when no listeners were subscribed.
  // On subsequent sessions, the cached remote-settings.json is read during initial setup,
  // but on the first session the remote fetch may complete before React mounts.
  useEffect(() => {
    const { toolPermissionContext } = store.getState();
    if (toolPermissionContext.isBypassPermissionsModeAvailable && isBypassPermissionsModeDisabled()) {
      logForDebugging('Disabling bypass permissions mode on mount (remote settings loaded before mount)');
      store.setState(prev => ({
        ...prev,
        toolPermissionContext: createDisabledBypassPermissionsContext(prev.toolPermissionContext),
      }));
    }
  }, []);

  // Listen for external settings changes and sync to AppState.
  // This ensures file watcher changes propagate through the app --
  // shared with the headless/SDK path via applySettingsChange.
  const onSettingsChange = useEffectEvent(
    (source: SettingSource, _settings: SettingsJson, extra?: SettingsChangeExtra) =>
      applySettingsChange(source, store.setState, extra),
  );
  useSettingsChange(onSettingsChange);

  // densable Wrs: useState(bGl) → Srs.Provider around children (DialogStore).
  return (
    <HasAppStateContext.Provider value={true}>
      <AppStoreContext.Provider value={store}>
        <McpConnectionsContext.Provider value={mcpConnections}>
          <ActivePluginsContext.Provider value={activePlugins}>
            <AppStateSessionContext.Provider value={session}>
              <SessionHooksRegistryContext.Provider value={sessionHooks}>
                <TaskStoreContext.Provider value={taskStore}>
                  <MessageQueueContext.Provider value={messageQueue}>
                    <LeftoverIhrStoreProvider>
                      <DialogStoreProvider>
                        <MailboxProvider>
                          <VoiceProvider>{children}</VoiceProvider>
                        </MailboxProvider>
                      </DialogStoreProvider>
                    </LeftoverIhrStoreProvider>
                  </MessageQueueContext.Provider>
                </TaskStoreContext.Provider>
              </SessionHooksRegistryContext.Provider>
            </AppStateSessionContext.Provider>
          </ActivePluginsContext.Provider>
        </McpConnectionsContext.Provider>
      </AppStoreContext.Provider>
    </HasAppStateContext.Provider>
  );
}

function useAppStore(): AppStateStore {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new ReferenceError('useAppState/useSetAppState cannot be called outside of an <AppStateProvider />');
  }
  return store;
}

/**
 * Subscribe to a slice of AppState. Only re-renders when the selected value
 * changes (compared via Object.is).
 *
 * For multiple independent fields, call the hook multiple times:
 * ```
 * const verbose = useAppState(s => s.verbose)
 * const model = useAppState(s => s.mainLoopModel)
 * ```
 *
 * Do NOT return new objects from the selector -- Object.is will always see
 * them as changed. Instead, select an existing sub-object reference:
 * ```
 * const { text, promptId } = useAppState(s => s.promptSuggestion) // good
 * ```
 */
export function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useAppStore();

  const get = () => {
    const state = store.getState();
    const selected = selector(state);

    if (process.env.USER_TYPE === 'ant' && state === selected) {
      throw new Error(
        `Your selector in \`useAppState(${selector.toString()})\` returned the original state, which is not allowed. You must instead return a property for optimised rendering.`,
      );
    }

    return selected;
  };

  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * Get the setAppState updater without subscribing to any state.
 * Returns a stable reference that never changes -- components using only
 * this hook will never re-render from state changes.
 */
export function useSetAppState(): (updater: (prev: AppState) => AppState) => void {
  return useAppStore().setState;
}

/**
 * Get the store directly (for passing getState/setState to non-React code).
 */
export function useAppStateStore(): AppStateStore {
  return useAppStore();
}

/**
 * Official `Ghr()` @195652056 — shallow-patch updater (`updateAppState(store.setState)`).
 */
export function useUpdateAppState(): (updater: (prev: AppState) => AppState | Partial<AppState>) => void {
  const store = useAppStore();
  return useCallback(updateAppState(store.setState), [store]);
}

/**
 * Official `Rv()` @195652056 — returns the Session mounted by `<AppStateProvider />`.
 */
export function useAppStateSession(): Session {
  const session = useContext(AppStateSessionContext);
  if (!session) {
    throw new ReferenceError('useAppStateSession cannot be called outside of an <AppStateProvider />');
  }
  return session;
}

/**
 * Official `GTt()` @195652056 — MCP connections facade mounted by `<AppStateProvider />`.
 */
export function useMcpConnections(): McpConnectionsFacade {
  const mcp = useContext(McpConnectionsContext);
  if (!mcp) {
    throw new ReferenceError('useMcpConnections cannot be called outside of an <AppStateProvider />');
  }
  return mcp;
}

/**
 * Official `GB()` @195652056 — Active plugins facade mounted by `<AppStateProvider />`.
 */
export function useActivePlugins(): ActivePluginsFacade {
  const plugins = useContext(ActivePluginsContext);
  if (!plugins) {
    throw new ReferenceError('useActivePlugins cannot be called outside of an <AppStateProvider />');
  }
  return plugins;
}

/**
 * Official `QX()` @197297545 — SessionHooksRegistry mounted by `<AppStateProvider />`.
 */
export function useSessionHooksRegistry(): SessionHooksRegistry {
  const registry = useContext(SessionHooksRegistryContext);
  if (!registry) {
    throw new ReferenceError('useSessionHooksRegistry cannot be called outside of an <AppStateProvider />');
  }
  return registry;
}

/**
 * Official `WMn` @197297545 — TaskStore mounted by `<AppStateProvider />`.
 */
export function useTaskStore(): TasksV2Store {
  const taskStore = useContext(TaskStoreContext);
  if (!taskStore) {
    throw new ReferenceError('useTaskStore cannot be called outside of an <AppStateProvider />');
  }
  return taskStore;
}

/**
 * Official `Zu()` @197245042 — returns the MessageQueueInstance mounted by `<AppStateProvider />`,
 * falling back to `getActiveMessageQueue()` outside a provider.
 */
export function useMessageQueue(): MessageQueueInstance {
  return useContext(MessageQueueContext) ?? getActiveMessageQueue();
}

const NOOP_SUBSCRIBE = () => () => {};

/**
 * Safe version of useAppState that returns undefined if called outside of AppStateProvider.
 * Useful for components that may be rendered in contexts where AppStateProvider isn't available.
 */
export function useAppStateMaybeOutsideOfProvider<T>(selector: (state: AppState) => T): T | undefined {
  const store = useContext(AppStoreContext);
  return useSyncExternalStore(store ? store.subscribe : NOOP_SUBSCRIBE, () =>
    store ? selector(store.getState()) : undefined,
  );
}
