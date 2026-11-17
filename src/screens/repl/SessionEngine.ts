import { feature } from 'bun:bundle'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { LRUCache } from 'lru-cache'
import { createSessionToolUseContext } from '../../engine/createSessionToolUseContext.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import type { AppStateStore } from '../../state/AppStateStore.js'
import type { Tools } from '../../Tool.js'
import type { Command } from '../../types/command.js'
import type { Message as MessageType } from '../../types/message.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js'
import { toggleDiffPanelForSlash } from '../../utils/replDiffTab.js'
import { getReplDiffHost } from '../../utils/sessionHost.js'
import type { Session } from '../../utils/sessionRoot.js'
import { createSignal } from '../../utils/signal.js'
import type { Theme } from '../../utils/theme.js'
import type { ThinkingConfig } from '../../utils/thinking.js'

export type SessionEngineOptions = {
  store: AppStateStore
  session: Session
  initialCommands: Command[]
  initialTools: Tools
  initialDynamicMcpConfig?: Record<string, ScopedMcpServerConfig>
  mainThreadAgentDefinition?: AgentDefinition
}

export type SessionEngineSnapshot = {
  commands: Command[]
  tools: Tools
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined
}

export type BuildToolUseContextParams = {
  messages: MessageType[]
  _newMessages: MessageType[]
  abortController: AbortController
  mainLoopModel: string
  commands: Command[]
  combinedInitialTools: Tools
  debug: boolean
  fallbackModel?: string
  thinkingConfig: ThinkingConfig
  initialMcpClients?: MCPServerConnection[]
  ideInstallationStatus: ProcessUserInputContext['options']['ideInstallationStatus']
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>
  theme: ProcessUserInputContext['options']['theme']
  allowedAgentTypes?: string[]
  customSystemPrompt?: string
  appendSystemPrompt?: string
  appendSubagentSystemPrompt?: string
  mcpConnections: {
    adoptServer: (
      name: string,
      client: MCPServerConnection,
      opts?: { appendIfAbsent?: boolean },
    ) => void
  }
  shouldStopBeforeNextApiCall: () => boolean
  taskRegistry: ProcessUserInputContext['taskRegistry']
  setAppState: ProcessUserInputContext['setAppState']
  setSessionToolPermissionContext: ProcessUserInputContext['setSessionToolPermissionContext']
  setMessages: ProcessUserInputContext['setMessages']
  openMessageSelector: () => void
  onChangeAPIKey: () => void
  readFileState: ProcessUserInputContext['readFileState']
  toolState: ProcessUserInputContext['toolState']
  setToolJSX: ProcessUserInputContext['setToolJSX']
  addNotification: ProcessUserInputContext['addNotification']
  sendOSNotification: ProcessUserInputContext['sendOSNotification']
  onChangeDynamicMcpConfig: ProcessUserInputContext['onChangeDynamicMcpConfig']
  onInstallIDEExtension: ProcessUserInputContext['onInstallIDEExtension']
  loadedNestedMemoryPaths: Set<string>
  pendingNestedMemoryTriggers: Set<string>
  discoveredSkillNames: Set<string>
  setResponseLength: ProcessUserInputContext['setResponseLength']
  pushApiMetricsEntry?: (ttftMs: number) => void
  setStreamMode: ProcessUserInputContext['setStreamMode']
  setRetryStatus: ProcessUserInputContext['setRetryStatus']
  setOutputLimitRecovery: ProcessUserInputContext['setOutputLimitRecovery']
  setSpinnerColor: (color: keyof Theme | null) => void
  setSpinnerShimmerColor: (shimmer: keyof Theme | null) => void
  setSpinnerMessage: (msg: string | null) => void
  setCompactingHint: (hint: string | null) => void
  setCompactingStartTime: (
    updater: number | null | ((prev: number | null) => number | null),
  ) => void
  compactProgressActiveRef: { current: boolean }
  setInProgressToolUseIDs: ProcessUserInputContext['setInProgressToolUseIDs']
  setHasInterruptibleToolInProgress: (v: boolean) => void
  resume?: ProcessUserInputContext['resume']
  strictMcpConfig: boolean
  setConversationId: ProcessUserInputContext['setConversationId']
  requestPrompt?: ProcessUserInputContext['requestPrompt']
  contentReplacementState: ProcessUserInputContext['contentReplacementState']
  requestDialog: NonNullable<ProcessUserInputContext['requestDialog']>
  storageV5: ProcessUserInputContext['storageV5']
  credentials: ProcessUserInputContext['credentials']
  replDiffColumns: number
}

/**
 * Official `IW` @208518810 — REPL SessionEngine scope owning session-lived
 * command/tool/MCP state, env vars, and file read caches.
 */
export class SessionEngine {
  readonly store: AppStateStore
  readonly session: Session
  readonly readFileState = new LRUCache<
    string,
    { content: string; timestamp: number }
  >({ max: 200 })
  readonly sessionEnvVars = new Map<string, string>()
  readonly mainThreadAgentDefinition?: AgentDefinition
  readonly changed = createSignal()

  #snapshot: SessionEngineSnapshot
  #disposed = false

  constructor(options: SessionEngineOptions) {
    this.store = options.store
    this.session = options.session
    this.mainThreadAgentDefinition = options.mainThreadAgentDefinition
    this.#snapshot = {
      commands: options.initialCommands,
      tools: options.initialTools,
      dynamicMcpConfig: options.initialDynamicMcpConfig,
    }
  }

  getSnapshot = (): SessionEngineSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) =>
    this.changed.subscribe(listener)

  setCommands(commands: Command[]): void {
    if (this.#disposed || this.#snapshot.commands === commands) return
    this.#snapshot = { ...this.#snapshot, commands }
    this.changed.emit()
  }

  setTools(tools: Tools): void {
    if (this.#disposed || this.#snapshot.tools === tools) return
    this.#snapshot = { ...this.#snapshot, tools }
    this.changed.emit()
  }

  setDynamicMcpConfig(
    dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined,
  ): void {
    if (this.#disposed || this.#snapshot.dynamicMcpConfig === dynamicMcpConfig)
      return
    this.#snapshot = { ...this.#snapshot, dynamicMcpConfig }
    this.changed.emit()
  }

  buildToolUseContext(
    params: BuildToolUseContextParams,
  ): ProcessUserInputContext {
    const {
      messages,
      abortController,
      mainLoopModel,
      commands,
      combinedInitialTools,
      debug,
      fallbackModel,
      thinkingConfig,
      initialMcpClients,
      ideInstallationStatus,
      dynamicMcpConfig,
      theme,
      allowedAgentTypes,
      customSystemPrompt,
      appendSystemPrompt,
      appendSubagentSystemPrompt,
      mcpConnections,
      shouldStopBeforeNextApiCall,
      taskRegistry,
      setAppState,
      setSessionToolPermissionContext,
      setMessages,
      openMessageSelector,
      onChangeAPIKey,
      readFileState,
      toolState,
      setToolJSX,
      addNotification,
      sendOSNotification,
      onChangeDynamicMcpConfig,
      onInstallIDEExtension,
      loadedNestedMemoryPaths,
      pendingNestedMemoryTriggers,
      discoveredSkillNames,
      setResponseLength,
      pushApiMetricsEntry,
      setStreamMode,
      setRetryStatus,
      setOutputLimitRecovery,
      setSpinnerColor,
      setSpinnerShimmerColor,
      setSpinnerMessage,
      setCompactingHint,
      setCompactingStartTime,
      compactProgressActiveRef,
      setInProgressToolUseIDs,
      setHasInterruptibleToolInProgress,
      resume,
      strictMcpConfig,
      setConversationId,
      requestPrompt,
      contentReplacementState,
      requestDialog,
      storageV5,
      credentials,
      replDiffColumns,
    } = params

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getBootstrapSession: getSession } =
        require('../../utils/sessionRoot.js') as typeof import('../../utils/sessionRoot.js')
      getSession().mcpSessionWiring.registerConnections({
        adoptServer(name, client, opts) {
          mcpConnections.adoptServer(
            name,
            client as MCPServerConnection,
            opts as { appendIfAbsent?: boolean } | undefined,
          )
        },
      })
    } catch {
      // connections owner optional until session root is up
    }

    return createSessionToolUseContext({
      messages,
      setMessages,
      abortController,
      // densable: shouldStopBeforeNextApiCall: () => Ki.current !== null
      shouldStopBeforeNextApiCall,
      getAppState: () => this.store.getState(),
      setAppState,
      // densable y8r: main session both setters write toolPermissionContext
      setSessionToolPermissionContext,
      taskRegistry,
      readFileState,
      toolState,
      sessionEnvVars: this.sessionEnvVars,
      loadedNestedMemoryPaths,
      pendingNestedMemoryTriggers,
      discoveredSkillNames,
      commands,
      debug,
      mainLoopModel,
      fallbackModel,
      thinkingConfig,
      respectThinkingEnabled: true,
      isNonInteractiveSession: false,
      theme,
      ideInstallationStatus,
      dynamicMcpConfig,
      customSystemPrompt,
      appendSystemPrompt,
      appendSubagentSystemPrompt,
      combinedInitialTools,
      mainThreadAgentDefinition: this.mainThreadAgentDefinition,
      initialMcpClients,
      preferLiveMcpClientsFromStore: true,
      useStoreMcpResources: true,
      allowedAgentTypes,
      credentials,
      requestDialog,
      setInProgressToolUseIDs,
      setResponseLength,
      setRetryStatus,
      setStreamMode,
      onChangeAPIKey,
      getProactivityLevel: () => this.store.getState().proactivityLevel,
      openMessageSelector,
      setToolJSX,
      addNotification,
      appendSystemMessage: msg => setMessages(prev => [...prev, msg]),
      sendOSNotification,
      onChangeDynamicMcpConfig,
      onInstallIDEExtension,
      pushApiMetricsEntry,
      setOutputLimitRecovery,
      onCompactProgress: event => {
        try {
          const { leftoverIhr } =
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../utils/collapseReadSearch.js') as typeof import('../../utils/collapseReadSearch.js')
          leftoverIhr.main.applyCompactProgress(event)
        } catch {
          // isolation — optional
        }
        switch (event.type) {
          case 'hooks_start':
            setSpinnerColor('claudeBlue_FOR_SYSTEM_SPINNER')
            setSpinnerShimmerColor('claudeBlueShimmer_FOR_SYSTEM_SPINNER')
            setSpinnerMessage(
              event.hookType === 'pre_compact'
                ? 'Running PreCompact hooks\u2026'
                : event.hookType === 'post_compact'
                  ? 'Running PostCompact hooks\u2026'
                  : 'Running SessionStart hooks\u2026',
            )
            break
          case 'compact_start':
            setSpinnerMessage('Compacting conversation')
            compactProgressActiveRef.current = true
            setCompactingHint(event.hintText ?? null)
            setCompactingStartTime(start => start ?? Date.now())
            break
          case 'compact_end':
            setSpinnerMessage(null)
            setSpinnerColor(null)
            setSpinnerShimmerColor(null)
            compactProgressActiveRef.current = false
            setCompactingHint(null)
            setCompactingStartTime(null)
            break
        }
      },
      // densable 2.1.224 #21 — compact progress to RC via system/status
      // (setSDKStatus('compacting'|null) → enqueueSdkEvent → bridge write).
      setSDKStatus: (status: string | null | undefined) => {
        if (!feature('BRIDGE_MODE')) return
        // densable fDl: skip "requesting"; only emit when bridge can drain.
        if (status === 'requesting') return
        try {
          // Lazy require avoids circular import weight at REPL module init.
          const { enqueueSdkEvent } =
            require('../../utils/sdkEventQueue.js') as typeof import('../../utils/sdkEventQueue.js')
          // densable $Oi / SDKStatusSchema: only 'compacting' | null on the wire
          const wireStatus: 'compacting' | null =
            status === 'compacting' ? 'compacting' : null
          enqueueSdkEvent({
            type: 'system',
            subtype: 'status',
            status: wireStatus,
          })
        } catch {
          // optional path
        }
      },
      setHasInterruptibleToolInProgress,
      resume,
      // densable /cd `Mt` — refresh plugins/MCP after a directory move
      reloadPlugins: async () => {
        await refreshActivePlugins(setAppState, { applyStagedInstalls: false })
      },
      // densable Te/`le` — `/cd` `Rt` skips project MCP approval when set
      strictMcpConfig,
      setConversationId,
      requestPrompt,
      contentReplacementState,
      // densable PBr / We() — session services Provider, not lastPinned.
      storageV5,
      presentation: isFullscreenEnvEnabled() ? 'fullscreen' : 'inline',
      toggleDiffPanel: async () =>
        toggleDiffPanelForSlash(
          getReplDiffHost(),
          setAppState,
          () => this.store.getState().replTab,
          replDiffColumns,
        ),
    })
  }

  dispose(): void {
    this.#disposed = true
  }
}
