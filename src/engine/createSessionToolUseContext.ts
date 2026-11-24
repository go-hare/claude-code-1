import { resolveAgentTools } from '@claude-code/builtin-tools/tools/AgentTool/agentToolUtils.js'
import type {
  AgentDefinition,
  AgentDefinitionsResult,
} from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { preferLiveMcpClients } from '../hooks/useMergedClients.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../services/mcp/types.js'
import type { AppState } from '../state/AppState.js'
import type { Tools } from '../Tool.js'
import { assembleToolPool } from '../tools.js'
import type { Command } from '../types/command.js'
import type { Message } from '../types/message.js'
import type { FileHistoryState } from '../utils/fileHistory.js'
import type { FileStateCache } from '../utils/fileStateCache.js'
import { createAppStatePermissionContextSetters } from '../utils/permissions/permissionContextSetters.js'
import { getRegisteredPluginAgentDefinitions } from '../utils/plugins/functionHooksModules.js'
import type { ProcessUserInputContext } from '../utils/processUserInput/processUserInput.js'
import { getBootstrapSession } from '../utils/sessionRoot.js'
import { retireDepartedAdditionalDirectories } from '../utils/settings/applySettingsChange.js'
import type { ThinkingConfig } from '../utils/thinking.js'
import { mergeAndFilterTools } from '../utils/toolPool.js'

/**
 * Merges registered plugin agent definitions into a base `AgentDefinitionsResult`,
 * deduplicating by `agentType`, and optionally applies `allowedAgentTypes`.
 */
export function mergeSessionAgentDefinitions(
  defs: AgentDefinitionsResult,
  allowedAgentTypes?: string[],
): AgentDefinitionsResult {
  const registered = getRegisteredPluginAgentDefinitions()
  if (registered.length === 0) {
    return allowedAgentTypes ? { ...defs, allowedAgentTypes } : defs
  }
  const seen = new Set(defs.activeAgents.map(a => a.agentType))
  const extra = registered.filter(a => !seen.has(a.agentType))
  const allSeen = new Set(defs.allAgents.map(a => a.agentType))
  const extraAll = registered.filter(a => !allSeen.has(a.agentType))
  const merged: AgentDefinitionsResult = {
    ...defs,
    activeAgents:
      extra.length === 0 ? defs.activeAgents : [...defs.activeAgents, ...extra],
    allAgents:
      extraAll.length === 0 ? defs.allAgents : [...defs.allAgents, ...extraAll],
  }
  return allowedAgentTypes ? { ...merged, allowedAgentTypes } : merged
}

/**
 * Builds a `computeTools` callback that assembles the live tool pool from
 * `AppState`, merges it with `combinedInitialTools`, and applies
 * `mainThreadAgentDefinition` tool filtering when present.
 */
export function createSessionToolPoolComputer(params: {
  getAppState: () => AppState
  combinedInitialTools: Tools
  mainThreadAgentDefinition?: AgentDefinition
}): () => Tools {
  const { getAppState, combinedInitialTools, mainThreadAgentDefinition } =
    params
  return () => {
    const state = getAppState()
    const assembled = assembleToolPool(
      state.toolPermissionContext,
      state.mcp.tools,
    )
    const merged = mergeAndFilterTools(
      combinedInitialTools,
      assembled,
      state.toolPermissionContext.mode,
    )
    if (!mainThreadAgentDefinition) return merged
    return resolveAgentTools(mainThreadAgentDefinition, merged, false, true)
      .resolvedTools
  }
}

/**
 * Builds a `computeMcpClients` callback that prefers live MCP clients from
 * `AppState` over session-initial fallback clients.
 */
export function createSessionMcpClientsComputer(params: {
  getAppState: () => AppState
  initialMcpClients?: readonly MCPServerConnection[]
}): () => MCPServerConnection[] {
  const { getAppState, initialMcpClients } = params
  return () =>
    preferLiveMcpClients(getAppState().mcp.clients, initialMcpClients)
}

export type CreateSessionToolUseContextParams = {
  // Core session state & setters
  messages: Message[]
  setMessages: ProcessUserInputContext['setMessages']
  abortController: AbortController
  getAppState: () => AppState
  setAppState: ProcessUserInputContext['setAppState']
  setSessionToolPermissionContext?: ProcessUserInputContext['setSessionToolPermissionContext']
  taskRegistry: ProcessUserInputContext['taskRegistry']
  readFileState: FileStateCache
  toolState?: ProcessUserInputContext['toolState']
  sessionEnvVars?: Map<string, string>
  loadedNestedMemoryPaths: Set<string>
  pendingNestedMemoryTriggers: Set<string>
  discoveredSkillNames: Set<string>

  // Options assembly
  commands: Command[]
  debug: boolean
  verbose?: boolean
  mainLoopModel: string
  fallbackModel?: string | string[]
  thinkingConfig: ThinkingConfig
  respectThinkingEnabled?: boolean
  isNonInteractiveSession: boolean
  theme: ProcessUserInputContext['options']['theme']
  ideInstallationStatus: ProcessUserInputContext['options']['ideInstallationStatus']
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>
  customSystemPrompt?: string
  appendSystemPrompt?: string
  appendSubagentSystemPrompt?: string
  maxBudgetUsd?: number
  forwardSubagentText?: boolean
  toolAliases?: Record<string, string>
  messageClientPlatform?: string

  // Tools (either dynamic store computation or explicit static/refreshable tools)
  tools?: Tools
  combinedInitialTools?: Tools
  mainThreadAgentDefinition?: AgentDefinition
  refreshTools?: () => Tools

  // MCP clients & resources (either live store preference or explicit)
  mcpClients?: MCPServerConnection[]
  initialMcpClients?: MCPServerConnection[]
  preferLiveMcpClientsFromStore?: boolean
  refreshMcpClients?: () => MCPServerConnection[]
  mcpResources?: ProcessUserInputContext['options']['mcpResources']
  useStoreMcpResources?: boolean

  // Agent definitions
  baseAgentDefinitions?: AgentDefinitionsResult
  allowedAgentTypes?: string[]

  // Shared optional callbacks & capabilities
  credentials?: ProcessUserInputContext['credentials']
  handleElicitation?: ProcessUserInputContext['handleElicitation']
  requestDialog?: ProcessUserInputContext['requestDialog']
  setInProgressToolUseIDs?: ProcessUserInputContext['setInProgressToolUseIDs']
  setResponseLength?: ProcessUserInputContext['setResponseLength']
  setRetryStatus?: ProcessUserInputContext['setRetryStatus']
  setStreamMode?: ProcessUserInputContext['setStreamMode']
  setSDKStatus?: ProcessUserInputContext['setSDKStatus']
  onChangeAPIKey?: () => void
  shouldStopBeforeNextApiCall?: () => boolean
  getProactivityLevel?: () => unknown

  // Interactive / REPL-specific callbacks & fields
  openMessageSelector?: () => void
  setToolJSX?: ProcessUserInputContext['setToolJSX']
  addNotification?: ProcessUserInputContext['addNotification']
  appendSystemMessage?: ProcessUserInputContext['appendSystemMessage']
  sendOSNotification?: ProcessUserInputContext['sendOSNotification']
  onChangeDynamicMcpConfig?: ProcessUserInputContext['onChangeDynamicMcpConfig']
  onInstallIDEExtension?: ProcessUserInputContext['onInstallIDEExtension']
  pushApiMetricsEntry?: (ttftMs: number) => void
  setOutputLimitRecovery?: ProcessUserInputContext['setOutputLimitRecovery']
  onCompactProgress?: ProcessUserInputContext['onCompactProgress']
  setHasInterruptibleToolInProgress?: (v: boolean) => void
  resume?: ProcessUserInputContext['resume']
  reloadPlugins?: ProcessUserInputContext['reloadPlugins']
  strictMcpConfig?: boolean
  setConversationId?: ProcessUserInputContext['setConversationId']
  requestPrompt?: ProcessUserInputContext['requestPrompt']
  contentReplacementState?: ProcessUserInputContext['contentReplacementState']
  storageV5?: ProcessUserInputContext['storageV5']
  presentation?: ProcessUserInputContext['presentation']
  toggleDiffPanel?: ProcessUserInputContext['toggleDiffPanel']
}

/**
 * Shared core `ToolUseContext` / `ProcessUserInputContext` builder used by both
 * Interactive (`SessionEngine`) and Headless/SDK (`QueryEngine`).
 */
export function createSessionToolUseContext(
  params: CreateSessionToolUseContextParams,
): ProcessUserInputContext {
  const {
    messages,
    setMessages,
    abortController,
    getAppState,
    setAppState,
    setSessionToolPermissionContext,
    taskRegistry,
    readFileState,
    toolState,
    loadedNestedMemoryPaths,
    pendingNestedMemoryTriggers,
    discoveredSkillNames,
    commands,
    debug,
    verbose,
    mainLoopModel,
    fallbackModel,
    thinkingConfig,
    respectThinkingEnabled = false,
    isNonInteractiveSession,
    theme,
    ideInstallationStatus,
    dynamicMcpConfig,
    customSystemPrompt,
    appendSystemPrompt,
    appendSubagentSystemPrompt,
    maxBudgetUsd,
    forwardSubagentText,
    toolAliases,
    messageClientPlatform,
    tools,
    combinedInitialTools,
    mainThreadAgentDefinition,
    refreshTools,
    mcpClients,
    initialMcpClients,
    preferLiveMcpClientsFromStore = false,
    refreshMcpClients,
    mcpResources,
    useStoreMcpResources = false,
    baseAgentDefinitions,
    allowedAgentTypes,
    credentials,
    handleElicitation,
    requestDialog,
    setInProgressToolUseIDs,
    setResponseLength = () => {},
    setRetryStatus,
    setStreamMode,
    setSDKStatus,
    onChangeAPIKey = () => {},
    shouldStopBeforeNextApiCall,
    getProactivityLevel,
    openMessageSelector,
    setToolJSX,
    addNotification,
    appendSystemMessage,
    sendOSNotification,
    onChangeDynamicMcpConfig,
    onInstallIDEExtension,
    pushApiMetricsEntry,
    setOutputLimitRecovery,
    onCompactProgress,
    setHasInterruptibleToolInProgress,
    resume,
    reloadPlugins,
    strictMcpConfig,
    setConversationId,
    requestPrompt,
    contentReplacementState,
    storageV5,
    presentation,
    toggleDiffPanel,
  } = params

  const appState = getAppState()

  const computeTools = combinedInitialTools
    ? createSessionToolPoolComputer({
        getAppState,
        combinedInitialTools,
        mainThreadAgentDefinition,
      })
    : refreshTools

  const resolvedTools = computeTools
    ? combinedInitialTools
      ? computeTools()
      : (tools ?? [])
    : (tools ?? [])

  const computeMcpClients = preferLiveMcpClientsFromStore
    ? createSessionMcpClientsComputer({
        getAppState,
        initialMcpClients,
      })
    : refreshMcpClients

  const resolvedMcpClients = preferLiveMcpClientsFromStore
    ? preferLiveMcpClients(appState.mcp.clients, initialMcpClients)
    : (mcpClients ?? [])

  const resolvedAgentDefinitions = mergeSessionAgentDefinitions(
    baseAgentDefinitions ?? appState.agentDefinitions,
    allowedAgentTypes,
  )

  const permissionSetters = setSessionToolPermissionContext
    ? {
        setToolPermissionContext: setSessionToolPermissionContext,
        setSessionToolPermissionContext,
      }
    : createAppStatePermissionContextSetters(setAppState)

  return {
    abortController,
    ...(shouldStopBeforeNextApiCall ? { shouldStopBeforeNextApiCall } : {}),
    options: {
      commands,
      tools: resolvedTools,
      debug,
      verbose: verbose ?? appState.verbose,
      mainLoopModel,
      ...(fallbackModel !== undefined ? { fallbackModel } : {}),
      thinkingConfig:
        respectThinkingEnabled && appState.thinkingEnabled === false
          ? { type: 'disabled' }
          : thinkingConfig,
      mcpClients: resolvedMcpClients,
      mcpResources:
        mcpResources ?? (useStoreMcpResources ? appState.mcp.resources : {}),
      ideInstallationStatus,
      isNonInteractiveSession,
      ...(dynamicMcpConfig !== undefined ? { dynamicMcpConfig } : {}),
      theme,
      agentDefinitions: resolvedAgentDefinitions,
      customSystemPrompt,
      appendSystemPrompt,
      appendSubagentSystemPrompt,
      ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
      ...(forwardSubagentText !== undefined ? { forwardSubagentText } : {}),
      ...(toolAliases !== undefined ? { toolAliases } : {}),
      ...(messageClientPlatform !== undefined ? { messageClientPlatform } : {}),
      ...(computeTools ? { refreshTools: computeTools } : {}),
      ...(computeMcpClients ? { refreshMcpClients: computeMcpClients } : {}),
    },
    getAppState,
    taskRegistry,
    session: getBootstrapSession(),
    ...(getProactivityLevel ? { getProactivityLevel } : {}),
    setAppState,
    ...permissionSetters,
    messages,
    setMessages,
    updateFileHistoryState(
      updater: (prev: FileHistoryState) => FileHistoryState,
    ) {
      // Perf: skip the setState when the updater returns the same reference
      // (e.g. fileHistoryTrackEdit returns `state` when the file is already
      // tracked). Otherwise every no-op call would notify all store listeners.
      setAppState(prev => {
        const updated = updater(prev.fileHistory)
        if (updated === prev.fileHistory) return prev
        return { ...prev, fileHistory: updated }
      })
    },
    retireDepartedAdditionalDirectories: directories => {
      setAppState(prev => {
        const next = retireDepartedAdditionalDirectories(
          prev.toolPermissionContext,
          directories,
        )
        return next === prev.toolPermissionContext
          ? prev
          : { ...prev, toolPermissionContext: next }
      })
    },
    onChangeAPIKey,
    readFileState,
    toolState,
    credentials,
    handleElicitation,
    requestDialog,
    nestedMemoryAttachmentTriggers: new Set<string>(),
    loadedNestedMemoryPaths,
    pendingNestedMemoryTriggers,
    dynamicSkillDirTriggers: new Set<string>(),
    discoveredSkillNames,
    setResponseLength,
    setRetryStatus,
    setStreamMode,
    setInProgressToolUseIDs,
    setSDKStatus,
    ...(openMessageSelector ? { openMessageSelector } : {}),
    ...(setToolJSX ? { setToolJSX } : {}),
    ...(addNotification ? { addNotification } : {}),
    ...(appendSystemMessage ? { appendSystemMessage } : {}),
    ...(sendOSNotification ? { sendOSNotification } : {}),
    ...(onChangeDynamicMcpConfig ? { onChangeDynamicMcpConfig } : {}),
    ...(onInstallIDEExtension ? { onInstallIDEExtension } : {}),
    ...(pushApiMetricsEntry ? { pushApiMetricsEntry } : {}),
    ...(setOutputLimitRecovery ? { setOutputLimitRecovery } : {}),
    ...(onCompactProgress ? { onCompactProgress } : {}),
    ...(setHasInterruptibleToolInProgress
      ? { setHasInterruptibleToolInProgress }
      : {}),
    ...(resume !== undefined ? { resume } : {}),
    ...(reloadPlugins ? { reloadPlugins } : {}),
    ...(strictMcpConfig !== undefined ? { strictMcpConfig } : {}),
    ...(setConversationId ? { setConversationId } : {}),
    ...(requestPrompt ? { requestPrompt } : {}),
    ...(contentReplacementState !== undefined
      ? { contentReplacementState }
      : {}),
    ...(storageV5 !== undefined ? { storageV5 } : {}),
    ...(presentation !== undefined ? { presentation } : {}),
    ...(toggleDiffPanel ? { toggleDiffPanel } : {}),
  } as ProcessUserInputContext
}
