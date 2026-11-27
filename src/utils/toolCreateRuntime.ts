import type { z } from 'zod/v4'
import type { AgentDefinitionsResult } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { Command } from '../commands.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type {
  MCPServerConnection,
  ServerResource,
} from '../services/mcp/types.js'
import type { AppState } from '../state/AppState.js'
import type {
  AnyObject,
  QueryChainTracking,
  Tool,
  ToolCallProgress,
  ToolPermissionContext,
  ToolProgressData,
  ToolResult,
  Tools,
  ToolUseContext,
  ValidationResult,
} from '../Tool.js'
import type { AgentId } from '../types/ids.js'
import type { AssistantMessage, Message } from '../types/message.js'
import type {
  PermissionDecision,
  PermissionResult,
} from '../types/permissions.js'
import { isAbortError } from './errors.js'
import { FileStateCache } from './fileStateCache.js'
import { RootSessionSlot } from './hostSlot.js'
import { isDisklessLaunch } from './sessionHost.js'
import type { TaskRegistry } from './taskRegistry.js'
import type { ThinkingConfig } from './thinking.js'
import type { ToolStateSlots } from './toolState.js'

// ============================================================================
// Official 2.1.331 Cross-Process Native-Tool Constants & Errors
// ============================================================================

/**
 * Official 2.1.331 `te` / `ao` — the 10 local-only native tools that never run
 * in-process when the session host is diskless (`launchOptions.diskless()`).
 */
export const LOCAL_ONLY_NATIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Bash',
  'PowerShell',
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'SendUserFile',
  'Monitor',
])

export type RemoteNativeToolSession = {
  readonly root: object
  readonly host?: {
    readonly launchOptions?: {
      diskless(): boolean
    }
  }
}

export type NativeToolElsewhereErrorCode = 'NOT_RUN' | 'ANSWER_LOST'

/**
 * Official 2.1.331 `M6e` (`NativeToolElsewhereError`):
 * Raised when a remote native tool's execution target changed after its
 * permission check (`NOT_RUN`), when its cross-process output failed schema
 * parsing (`ANSWER_LOST`), or when a remote transport error had to be
 * sanitized into a safe error boundary.
 */
export class NativeToolElsewhereError extends Error {
  readonly code?: NativeToolElsewhereErrorCode
  noteBehindResult?: string

  constructor(message: string, code?: NativeToolElsewhereErrorCode) {
    super(message)
    this.code = code
    this.name = 'NativeToolElsewhereError'
  }
}

/**
 * Official 2.1.331 `ue` (`NeverRunsInThisProcessError`):
 * Raised when a local-only native tool (`Bash`, `PowerShell`, `Read`, `Write`,
 * `Edit`, `NotebookEdit`, `Glob`, `Grep`, `SendUserFile`, `Monitor`) is
 * instantiated or invoked locally in a diskless host without a remote runner.
 */
export class NeverRunsInThisProcessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NeverRunsInThisProcessError'
  }
}

/**
 * Official 2.1.331 `oPr` — sentinel returned by a `RemoteNativeToolCheck`
 * when it defers decision-making back to the local permission evaluator.
 */
export const REMOTE_CHECK_DOES_NOT_DECIDE = Symbol('check does not decide')

export function isDisklessForSession(
  session?: RemoteNativeToolSession,
): boolean {
  if (session?.host?.launchOptions !== undefined) {
    return session.host.launchOptions.diskless()
  }
  return isDisklessLaunch()
}

/**
 * Official 2.1.331 `Fk(toolName)`: true when `toolName` is one of the 10
 * local-only native tools and this process/session is diskless.
 */
export function isNativeToolDisabledInThisProcess(
  toolName: string,
  session?: RemoteNativeToolSession,
): boolean {
  return (
    LOCAL_ONLY_NATIVE_TOOL_NAMES.has(toolName) && isDisklessForSession(session)
  )
}

/**
 * Official 2.1.331 `le(toolName, session)`: fail-closed guard invoked on both
 * `tool.create(deps)` and legacy local execution when a local-only native tool
 * cannot run in this process.
 */
export function assertNativeToolCanRunLocally(
  toolName: string,
  session?: RemoteNativeToolSession,
): void {
  if (!isNativeToolDisabledInThisProcess(toolName, session)) {
    return
  }
  throw new NeverRunsInThisProcessError(
    `${toolName} is unavailable: this session runs file and shell tools only in its cloud environment, and this call could not be sent there. Retrying will not help.`,
  )
}

// ============================================================================
// Official 2.1.331 Remote Native-Tool Runner Registry (`so`, `re`, `se`)
// ============================================================================

export type RemoteNativeToolResult = {
  output?: unknown
  newMessages?: ToolResult<unknown>['newMessages']
  afterRead?: {
    ok?: () => void
    unreadable?: () => void
  }
  subagentFrameResult?: unknown
  fieldsFromThisSide?: Record<string, unknown>
}

export type RemoteNativeToolRunner = {
  (
    toolName: string,
    input: unknown,
    signal: AbortSignal,
    context: ToolUseContext,
  ): Promise<RemoteNativeToolResult | undefined>
  refusedUnasked?: (
    input: unknown,
    context: ToolUseContext,
  ) => string | undefined
  checkPermissions?: (
    tool: Tool,
    input: unknown,
    context: ToolUseContext,
  ) => Promise<PermissionResult | undefined>
}

export type RemoteNativeToolCheckParams = {
  tool: Tool
  input: Record<string, unknown>
  context: ToolUseContext
  toolUseID: string
  evaluateHere: () => Promise<PermissionDecision>
}

export type RemoteNativeToolCheck = (
  params: RemoteNativeToolCheckParams,
) => Promise<PermissionDecision | typeof REMOTE_CHECK_DOES_NOT_DECIDE>

type RemoteNativeToolCheckEntry = {
  runner: RemoteNativeToolRunner
  check: RemoteNativeToolCheck
}

const REMOTE_LOCALLY_CHECKED_MAX_SIZE = 256

/** Official 2.1.331 `so` — per-root-session map of toolName → remote runner. */
const remoteNativeToolRunnersSlot = new RootSessionSlot<
  Map<string, RemoteNativeToolRunner>
>(() => new Map())

/** Official 2.1.331 `re` — per-root-session map of toolName → { runner, check }. */
const remoteNativeToolChecksSlot = new RootSessionSlot<
  Map<string, RemoteNativeToolCheckEntry>
>(() => new Map())

/** Official 2.1.331 `se` — bounded LRU set (cap 256) of toolUseIds checked locally. */
const remoteNativeToolLocallyCheckedSlot = new RootSessionSlot<Set<string>>(
  () => new Set(),
)

/**
 * Register a cross-process native-tool runner (and optional pre-execution check)
 * for `toolName` on `session`. Returns a dispose callback that unregisters only
 * if the same runner is still active.
 */
export function registerRemoteNativeToolRunner(
  session: RemoteNativeToolSession,
  toolName: string,
  runner: RemoteNativeToolRunner,
  check?: RemoteNativeToolCheck,
): () => void {
  remoteNativeToolRunnersSlot.of(session).set(toolName, runner)
  if (check !== undefined) {
    remoteNativeToolChecksSlot.of(session).set(toolName, { runner, check })
  } else {
    remoteNativeToolChecksSlot.peek(session)?.delete(toolName)
  }
  return () => {
    unregisterRemoteNativeToolRunner(session, toolName, runner)
  }
}

export function unregisterRemoteNativeToolRunner(
  session: RemoteNativeToolSession,
  toolName: string,
  runner?: RemoteNativeToolRunner,
): void {
  const runners = remoteNativeToolRunnersSlot.peek(session)
  if (runners) {
    if (runner === undefined || runners.get(toolName) === runner) {
      runners.delete(toolName)
    }
  }
  const checks = remoteNativeToolChecksSlot.peek(session)
  if (checks) {
    const entry = checks.get(toolName)
    if (entry && (runner === undefined || entry.runner === runner)) {
      checks.delete(toolName)
    }
  }
}

export function clearRemoteNativeToolRunners(
  session: RemoteNativeToolSession,
): void {
  remoteNativeToolRunnersSlot.peek(session)?.clear()
  remoteNativeToolChecksSlot.peek(session)?.clear()
  remoteNativeToolLocallyCheckedSlot.peek(session)?.clear()
}

/** Official 2.1.331 `nM(session, toolName)` */
export function getRemoteNativeToolRunner(
  session: RemoteNativeToolSession | undefined,
  toolName: string,
): RemoteNativeToolRunner | undefined {
  return session !== undefined
    ? remoteNativeToolRunnersSlot.peek(session)?.get(toolName)
    : undefined
}

/** Official 2.1.331 `ie(session, toolName)` */
export function hasRemoteNativeToolCheck(
  session: RemoteNativeToolSession | undefined,
  toolName: string,
): boolean {
  return (
    session !== undefined &&
    (remoteNativeToolChecksSlot.peek(session)?.has(toolName) ?? false)
  )
}

/** Official 2.1.331 `nue(session, toolName)` */
export function getRemoteNativeToolCheck(
  session: RemoteNativeToolSession | undefined,
  toolName: string,
): RemoteNativeToolCheck | undefined {
  const entry =
    session !== undefined
      ? remoteNativeToolChecksSlot.peek(session)?.get(toolName)
      : undefined
  if (
    entry !== undefined &&
    getRemoteNativeToolRunner(session, toolName) === entry.runner
  ) {
    return entry.check
  }
  return undefined
}

/** Official 2.1.331 `J5i(session, toolUseId)` */
export function recordRemoteNativeToolLocallyChecked(
  session: RemoteNativeToolSession | undefined,
  toolUseId: string,
): void {
  if (session === undefined || toolUseId === '') {
    return
  }
  const seen = remoteNativeToolLocallyCheckedSlot.of(session)
  seen.add(toolUseId)
  if (seen.size > REMOTE_LOCALLY_CHECKED_MAX_SIZE) {
    const [oldest] = seen
    if (oldest !== undefined) {
      seen.delete(oldest)
    }
  }
}

/** Official 2.1.331 `a0l(session, toolUseId)` */
export function consumeRemoteNativeToolLocallyChecked(
  session: RemoteNativeToolSession | undefined,
  toolUseId: string,
): boolean {
  return (
    session !== undefined &&
    (remoteNativeToolLocallyCheckedSlot.peek(session)?.delete(toolUseId) ??
      false)
  )
}

// ============================================================================
// Tool Permission Layer Reader Bridge (avoids circular import with Tool.ts)
// ============================================================================

type PermissionLayerReader = (
  context: Pick<ToolUseContext, 'getAppState' | 'permissionLayers'> & {
    agentId?: ToolUseContext['agentId']
  },
) => ToolPermissionContext

let registeredPermissionLayerReader: PermissionLayerReader | undefined

export function registerToolPermissionLayerReader(
  reader: PermissionLayerReader,
): void {
  registeredPermissionLayerReader = reader
}

function createEmptyToolPermissionContext(): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  }
}

function getPermissionLayerReader(): PermissionLayerReader | undefined {
  if (registeredPermissionLayerReader === undefined) {
    try {
      const mod =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../engine/permissionLayerReaders.js') as typeof import('../engine/permissionLayerReaders.js')
      if (typeof mod.getToolPermissionContextFromLayers === 'function') {
        registeredPermissionLayerReader = mod.getToolPermissionContextFromLayers
      }
    } catch {
      // Fallback to raw appState.toolPermissionContext if module unavailable
    }
  }
  return registeredPermissionLayerReader
}

function resolveEffectivePermissionsFromContext(
  context: ToolUseContext,
): ToolPermissionContext {
  if (typeof context.getAppState !== 'function') {
    return createEmptyToolPermissionContext()
  }
  const reader = getPermissionLayerReader()
  if (reader !== undefined) {
    const appState = context.getAppState()
    if (appState?.toolPermissionContext !== undefined) {
      return reader(context)
    }
  }
  return (
    context.getAppState()?.toolPermissionContext ??
    createEmptyToolPermissionContext()
  )
}

// ============================================================================
// ToolDeps (`EKt`), ToolCallContext (`n`), ToolInstance
// ============================================================================

export type ToolCallExecutionOptions = {
  userModified?: boolean
  globLimits?: {
    maxResults?: number
  }
  fileReadingLimits?: {
    maxTokens?: number
    maxSizeBytes?: number
  }
  /**
   * Remote runner bound at permission-check time (`null` asserts local check).
   * If execution routing changed before `call()`, rejects with
   * `NativeToolElsewhereError(..., 'NOT_RUN')`.
   */
  permissionCheckedFor?: RemoteNativeToolRunner | null
  runnerCheckedHere?: RemoteNativeToolRunner
  gitDiffRead?: boolean
  smallResultAsked?: boolean
  callerLogsSharedEvents?: boolean
  timing?: unknown
  remoteCall?: unknown
}

export type ToolCallContext<P extends ToolProgressData = ToolProgressData> = {
  readonly toolUseId?: string
  readonly signal: AbortSignal
  readonly abortController: AbortController
  abort: (reason?: unknown) => void
  readonly parentMessage?: AssistantMessage
  readonly onProgress?: ToolCallProgress<P>
  readonly canUseTool?: CanUseToolFn
  readonly userModified?: boolean
  readonly globLimits?: {
    maxResults?: number
  }
  readonly fileReadingLimits?: {
    maxTokens?: number
    maxSizeBytes?: number
  }
  readonly innerCall?: boolean
  readonly sameTurnToolUses?: Message[]
  readonly gitDiffRead?: boolean
  readonly smallResultAsked?: boolean
  readonly callerLogsSharedEvents?: boolean
  readonly timing?: unknown
  readonly remoteCall?: unknown
  readonly permissionSurface?: string
  ask?: (
    input: Record<string, unknown>,
    options?: {
      toolUseId?: string
      forceDecision?: PermissionDecision
    },
  ) => Promise<PermissionDecision>
}

/**
 * Official 2.1.331 `EKt(context)` — narrow, explicit dependency surface passed
 * to `Tool.create(deps)`. Can be projected from a `ToolUseContext` via
 * `createToolDeps(context)` OR constructed explicitly in a separate process /
 * worker / unit test via `createExplicitToolDeps(...)` with ZERO ALS.
 */
export type ToolDeps = {
  readonly session?: RemoteNativeToolSession
  readonly agentId?: AgentId
  readonly agentType?: string
  readonly agentWorktree?: string
  readonly isBackgroundAgent?: boolean
  readonly innerCall?: boolean
  readonly forRemoteExecution?: boolean
  readonly hookCaller?: string
  readonly storageV5?: unknown
  readonly credentials?: unknown
  readonly toolState?: ToolStateSlots
  readonly taskRegistry?: TaskRegistry
  readonly readFileState: FileStateCache
  readonly updateFileHistoryState?: ToolUseContext['updateFileHistoryState']
  readonly dynamicSkillDirTriggers?: Set<string>
  readonly nestedMemoryAttachmentTriggers?: Set<string>
  readonly loadedNestedMemoryPaths?: Set<string>
  readonly pendingNestedMemoryTriggers?: Set<string>
  readonly discoveredSkillNames?: Set<string>
  readonly tools: Tools
  readonly commands?: Command[]
  readonly isNonInteractiveSession: boolean
  readonly hasSpendCap: boolean
  readonly messageClientPlatform?: string
  readonly mcpClients: () => MCPServerConnection[]
  readonly turnMcpClients: MCPServerConnection[]
  readonly mcpResources?: Record<string, ServerResource[]>
  readonly toolAliases?: Record<string, string>
  readonly refreshTools?: () => Tools
  readonly refreshMcpClients?: () => MCPServerConnection[]
  readonly agentDefinitions?: AgentDefinitionsResult
  readonly appendSystemPrompt?: string
  readonly customSystemPrompt?: string
  readonly appendSubagentSystemPrompt?: string
  readonly permissions: () => ToolPermissionContext
  readonly unlayeredPermissions: () => ToolPermissionContext
  readonly setToolPermissionContext: ToolUseContext['setToolPermissionContext']
  readonly setSessionToolPermissionContext: ToolUseContext['setSessionToolPermissionContext']
  readonly appendSystemMessage?: ToolUseContext['appendSystemMessage']
  readonly addNotification?: ToolUseContext['addNotification']
  readonly sendOSNotification?: ToolUseContext['sendOSNotification']
  readonly requestDialog?: ToolUseContext['requestDialog']
  readonly requestPrompt?: ToolUseContext['requestPrompt']
  readonly handleElicitation?: ToolUseContext['handleElicitation']
  readonly onChangeDynamicMcpConfig?: ToolUseContext['onChangeDynamicMcpConfig']
  readonly setToolJSX?: ToolUseContext['setToolJSX']
  readonly setInProgressToolUseIDs?: ToolUseContext['setInProgressToolUseIDs']
  readonly setResponseLength?: ToolUseContext['setResponseLength']
  readonly setStreamMode?: ToolUseContext['setStreamMode']
  readonly loopModel: () => string
  readonly thinkingConfig: () => ThinkingConfig
  readonly tasks: () => AppState['tasks']
  readonly messages: () => Message[]
  readonly todos: {
    get: (agentKey: string) => AppState['todos'][string] | undefined
    set: (agentKey: string, items: AppState['todos'][string]) => void
  }
  readonly activeGoal: () => AppState['activeGoal']
  readonly pauseActiveGoal: (reason: string) => void
  readonly markEndedByModel: () => void
  readonly getAppState: () => AppState
  readonly setAppState: ToolUseContext['setAppState']
  readonly setAppStateForTasks?: ToolUseContext['setAppStateForTasks']
  readonly getMcp?: ToolUseContext['getMcp']
  readonly getProactivityLevel?: ToolUseContext['getProactivityLevel']
  readonly queryTracking?: QueryChainTracking
  readonly permissionLayers?: ToolUseContext['permissionLayers']
  readonly toolDecisions?: ToolUseContext['toolDecisions']
  readonly cwd?: () => string
}

export type ToolInstance<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {
  call(
    args: z.infer<Input>,
    callCtx: ToolCallContext<P>,
  ): Promise<ToolResult<Output>>
  validateInput?(
    input: z.infer<Input>,
    callCtx: ToolCallContext<P>,
  ): Promise<ValidationResult>
  checkPermissions?(
    input: z.infer<Input>,
    callCtx: ToolCallContext<P>,
  ): Promise<PermissionResult>
  permissionCheckFailureDecision?(
    input: z.infer<Input>,
    callCtx: ToolCallContext<P>,
  ): PermissionResult | undefined
  deriveObservableInput?(
    input: z.infer<Input>,
    callCtx: ToolCallContext<P>,
  ): Promise<Record<string, unknown> | undefined>
}

const rawContextByDeps = new WeakMap<ToolDeps, ToolUseContext>()

function resolveMcpClientsFromContext(
  context: ToolUseContext,
): MCPServerConnection[] {
  return (
    context.options?.refreshMcpClients?.() ??
    context.getMcp?.().clients ??
    context.options?.mcpClients ??
    []
  )
}

/**
 * Official 2.1.331 `EKt(context)` — projects a narrow `ToolDeps` capability
 * facade from a host `ToolUseContext`.
 */
export function createToolDeps(context?: ToolUseContext): ToolDeps {
  if (context === undefined) {
    return createExplicitToolDeps()
  }
  const deps: ToolDeps = {
    get session() {
      return context.session as RemoteNativeToolSession | undefined
    },
    get agentId() {
      return context.agentId
    },
    get agentType() {
      return context.agentType
    },
    get agentWorktree() {
      return context.agentWorktree
    },
    get isBackgroundAgent() {
      return context.isBackgroundAgent
    },
    get innerCall() {
      return context.innerCall
    },
    get forRemoteExecution() {
      return context.forRemoteExecution
    },
    get hookCaller() {
      return context.hookCaller
    },
    get storageV5() {
      return context.storageV5
    },
    get credentials() {
      return context.credentials
    },
    get toolState() {
      return context.toolState
    },
    get taskRegistry() {
      return context.taskRegistry
    },
    get readFileState() {
      return context.readFileState
    },
    get updateFileHistoryState() {
      return context.updateFileHistoryState
    },
    get dynamicSkillDirTriggers() {
      return context.dynamicSkillDirTriggers
    },
    get nestedMemoryAttachmentTriggers() {
      return context.nestedMemoryAttachmentTriggers
    },
    get loadedNestedMemoryPaths() {
      return context.loadedNestedMemoryPaths
    },
    get pendingNestedMemoryTriggers() {
      return context.pendingNestedMemoryTriggers
    },
    get discoveredSkillNames() {
      return context.discoveredSkillNames
    },
    get tools() {
      return context.options?.tools ?? []
    },
    get commands() {
      return context.options?.commands
    },
    get isNonInteractiveSession() {
      return context.options?.isNonInteractiveSession ?? false
    },
    get hasSpendCap() {
      return context.options?.maxBudgetUsd !== undefined
    },
    get messageClientPlatform() {
      return context.options?.messageClientPlatform
    },
    mcpClients: () => [...resolveMcpClientsFromContext(context)],
    get turnMcpClients() {
      return context.options?.mcpClients ?? []
    },
    get mcpResources() {
      return context.options?.mcpResources
    },
    get toolAliases() {
      return context.options?.toolAliases
    },
    get refreshTools() {
      return context.options?.refreshTools
    },
    get refreshMcpClients() {
      return context.options?.refreshMcpClients
    },
    get agentDefinitions() {
      return context.options?.agentDefinitions
    },
    get appendSystemPrompt() {
      return context.options?.appendSystemPrompt
    },
    get customSystemPrompt() {
      return context.options?.customSystemPrompt
    },
    get appendSubagentSystemPrompt() {
      return context.options?.appendSubagentSystemPrompt
    },
    permissions: () => resolveEffectivePermissionsFromContext(context),
    unlayeredPermissions: () =>
      context.getAppState?.()?.toolPermissionContext ??
      createEmptyToolPermissionContext(),
    get setToolPermissionContext() {
      return context.setToolPermissionContext
    },
    get setSessionToolPermissionContext() {
      return context.setSessionToolPermissionContext
    },
    get appendSystemMessage() {
      return context.appendSystemMessage
    },
    get addNotification() {
      return context.addNotification
    },
    get sendOSNotification() {
      return context.sendOSNotification
    },
    get requestDialog() {
      return context.requestDialog
    },
    get requestPrompt() {
      return context.requestPrompt
    },
    get handleElicitation() {
      return context.handleElicitation
    },
    get onChangeDynamicMcpConfig() {
      return context.onChangeDynamicMcpConfig
    },
    get setToolJSX() {
      return context.setToolJSX
    },
    get setInProgressToolUseIDs() {
      return context.setInProgressToolUseIDs
    },
    get setResponseLength() {
      return context.setResponseLength
    },
    get setStreamMode() {
      return context.setStreamMode
    },
    loopModel: () => context.options?.mainLoopModel ?? '',
    thinkingConfig: () =>
      context.options?.thinkingConfig ?? { type: 'disabled' },
    tasks: () => context.getAppState?.()?.tasks ?? {},
    messages: () => context.messages ?? [],
    todos: {
      get: agentKey => context.getAppState?.()?.todos?.[agentKey],
      set: (agentKey, items) => {
        context.setAppState?.(prev => ({
          ...prev,
          todos: {
            ...prev.todos,
            [agentKey]: items,
          },
        }))
      },
    },
    activeGoal: () => context.getAppState?.()?.activeGoal,
    pauseActiveGoal: reason => {
      context.setAppState?.(prev =>
        prev.activeGoal === undefined
          ? prev
          : {
              ...prev,
              activeGoal: {
                ...prev.activeGoal,
                paused: { reason },
              },
            },
      )
    },
    markEndedByModel: () => {
      context.setAppState?.(prev => ({
        ...prev,
        endedByModel: true,
      }))
    },
    getAppState: () => context.getAppState(),
    setAppState: updater => context.setAppState(updater),
    get setAppStateForTasks() {
      return context.setAppStateForTasks
    },
    get getMcp() {
      return context.getMcp
    },
    get getProactivityLevel() {
      return context.getProactivityLevel
    },
    get queryTracking() {
      return context.queryTracking
    },
    get permissionLayers() {
      return context.permissionLayers
    },
    get toolDecisions() {
      return context.toolDecisions
    },
  }
  rawContextByDeps.set(deps, context)
  return deps
}

/**
 * Construct a standalone `ToolDeps` explicitly without a host `ToolUseContext`
 * and without AsyncLocalStorage — designed for cross-process tool workers,
 * RPC handlers, and isolated unit tests calling `Tool.create(deps)`.
 */
export function createExplicitToolDeps(
  overrides: Partial<ToolDeps> = {},
): ToolDeps {
  const initialPermissionContext =
    overrides.permissions?.() ??
    overrides.unlayeredPermissions?.() ??
    createEmptyToolPermissionContext()
  let currentAppState = {
    toolPermissionContext: initialPermissionContext,
    tasks: {},
    todos: {},
    agentNameRegistry: new Map(),
    sendMessagePins: {},
    sessionHooks: new Map(),
    inbox: { messages: [] },
    mcp: { clients: [], tools: [], commands: [], resources: {} },
    fileHistory: {
      snapshots: [],
      trackedFiles: new Set<string>(),
      snapshotSequence: 0,
    },
  } as unknown as AppState

  let permUpdatedLocally = false
  const getAppState = overrides.getAppState ?? (() => currentAppState)
  const setAppState: ToolUseContext['setAppState'] =
    overrides.setAppState ??
    (updater => {
      currentAppState = updater(currentAppState)
    })
  const updatePermContext = (
    update:
      | ToolPermissionContext
      | ((prev: ToolPermissionContext) => ToolPermissionContext),
  ): void => {
    permUpdatedLocally = true
    setAppState(prev => ({
      ...prev,
      toolPermissionContext:
        typeof update === 'function'
          ? update(prev.toolPermissionContext)
          : update,
    }))
  }

  const readFileState =
    overrides.readFileState ?? new FileStateCache(100, 1024 * 1024)
  const turnMcpClients = overrides.turnMcpClients ?? []

  return {
    session: overrides.session,
    agentId: overrides.agentId,
    agentType: overrides.agentType,
    agentWorktree: overrides.agentWorktree,
    isBackgroundAgent: overrides.isBackgroundAgent,
    innerCall: overrides.innerCall,
    forRemoteExecution: overrides.forRemoteExecution,
    hookCaller: overrides.hookCaller,
    storageV5: overrides.storageV5,
    credentials: overrides.credentials,
    toolState: overrides.toolState,
    taskRegistry: overrides.taskRegistry,
    readFileState,
    updateFileHistoryState: overrides.updateFileHistoryState ?? (() => {}),
    dynamicSkillDirTriggers: overrides.dynamicSkillDirTriggers,
    nestedMemoryAttachmentTriggers: overrides.nestedMemoryAttachmentTriggers,
    loadedNestedMemoryPaths: overrides.loadedNestedMemoryPaths,
    pendingNestedMemoryTriggers: overrides.pendingNestedMemoryTriggers,
    discoveredSkillNames: overrides.discoveredSkillNames,
    tools: overrides.tools ?? [],
    commands: overrides.commands ?? [],
    isNonInteractiveSession: overrides.isNonInteractiveSession ?? true,
    hasSpendCap: overrides.hasSpendCap ?? false,
    messageClientPlatform: overrides.messageClientPlatform,
    mcpClients: overrides.mcpClients ?? (() => [...turnMcpClients]),
    turnMcpClients,
    mcpResources: overrides.mcpResources ?? {},
    toolAliases: overrides.toolAliases,
    refreshTools: overrides.refreshTools,
    refreshMcpClients: overrides.refreshMcpClients,
    agentDefinitions: overrides.agentDefinitions,
    appendSystemPrompt: overrides.appendSystemPrompt,
    customSystemPrompt: overrides.customSystemPrompt,
    appendSubagentSystemPrompt: overrides.appendSubagentSystemPrompt,
    permissions:
      overrides.permissions !== undefined
        ? () =>
            permUpdatedLocally
              ? (getAppState().toolPermissionContext ??
                createEmptyToolPermissionContext())
              : overrides.permissions!()
        : () =>
            getAppState().toolPermissionContext ??
            createEmptyToolPermissionContext(),
    unlayeredPermissions:
      overrides.unlayeredPermissions !== undefined
        ? () =>
            permUpdatedLocally
              ? (getAppState().toolPermissionContext ??
                createEmptyToolPermissionContext())
              : overrides.unlayeredPermissions!()
        : () =>
            getAppState().toolPermissionContext ??
            createEmptyToolPermissionContext(),
    setToolPermissionContext:
      overrides.setToolPermissionContext ?? updatePermContext,
    setSessionToolPermissionContext:
      overrides.setSessionToolPermissionContext ?? updatePermContext,
    appendSystemMessage: overrides.appendSystemMessage,
    addNotification: overrides.addNotification,
    sendOSNotification: overrides.sendOSNotification,
    requestDialog: overrides.requestDialog,
    requestPrompt: overrides.requestPrompt,
    handleElicitation: overrides.handleElicitation,
    onChangeDynamicMcpConfig: overrides.onChangeDynamicMcpConfig,
    setToolJSX: overrides.setToolJSX,
    setInProgressToolUseIDs: overrides.setInProgressToolUseIDs ?? (() => {}),
    setResponseLength: overrides.setResponseLength ?? (() => {}),
    setStreamMode: overrides.setStreamMode,
    loopModel: overrides.loopModel ?? (() => ''),
    thinkingConfig: overrides.thinkingConfig ?? (() => ({ type: 'disabled' })),
    tasks: overrides.tasks ?? (() => getAppState().tasks ?? {}),
    messages: overrides.messages ?? (() => []),
    todos: overrides.todos ?? {
      get: agentKey => getAppState().todos?.[agentKey],
      set: (agentKey, items) => {
        setAppState(prev => ({
          ...prev,
          todos: {
            ...prev.todos,
            [agentKey]: items,
          },
        }))
      },
    },
    activeGoal: overrides.activeGoal ?? (() => getAppState().activeGoal),
    pauseActiveGoal:
      overrides.pauseActiveGoal ??
      (reason => {
        setAppState(prev =>
          prev.activeGoal === undefined
            ? prev
            : {
                ...prev,
                activeGoal: {
                  ...prev.activeGoal,
                  paused: { reason },
                },
              },
        )
      }),
    markEndedByModel:
      overrides.markEndedByModel ??
      (() => {
        setAppState(prev => ({ ...prev, endedByModel: true }))
      }),
    getAppState,
    setAppState,
    setAppStateForTasks: overrides.setAppStateForTasks ?? setAppState,
    getMcp: overrides.getMcp,
    getProactivityLevel: overrides.getProactivityLevel,
    queryTracking: overrides.queryTracking,
    permissionLayers: overrides.permissionLayers,
    toolDecisions: overrides.toolDecisions,
    cwd: overrides.cwd,
  }
}

export function createToolCallContext<
  P extends ToolProgressData = ToolProgressData,
>(overrides: Partial<ToolCallContext<P>> = {}): ToolCallContext<P> {
  const abortController = overrides.abortController ?? new AbortController()
  if (
    overrides.abortController === undefined &&
    overrides.signal !== undefined &&
    overrides.signal !== abortController.signal
  ) {
    const externalSignal = overrides.signal
    if (externalSignal.aborted) {
      abortController.abort(externalSignal.reason)
    } else {
      externalSignal.addEventListener(
        'abort',
        () => abortController.abort(externalSignal.reason),
        { once: true },
      )
    }
  }
  return {
    toolUseId: overrides.toolUseId,
    abortController,
    signal: overrides.signal ?? abortController.signal,
    abort: overrides.abort ?? (reason => abortController.abort(reason)),
    parentMessage: overrides.parentMessage,
    onProgress: overrides.onProgress,
    canUseTool: overrides.canUseTool,
    userModified: overrides.userModified,
    globLimits: overrides.globLimits,
    fileReadingLimits: overrides.fileReadingLimits,
    innerCall: overrides.innerCall,
    sameTurnToolUses: overrides.sameTurnToolUses,
    gitDiffRead: overrides.gitDiffRead,
    smallResultAsked: overrides.smallResultAsked,
    callerLogsSharedEvents: overrides.callerLogsSharedEvents,
    timing: overrides.timing,
    remoteCall: overrides.remoteCall,
    permissionSurface: overrides.permissionSurface,
    ask: overrides.ask,
  }
}

function createCallContextFromLegacy<
  P extends ToolProgressData = ToolProgressData,
>(
  tool: Tool,
  context: ToolUseContext | undefined,
  onProgress?: ToolCallProgress<P>,
  parentMessage?: AssistantMessage,
  canUseTool?: CanUseToolFn,
  opts?: ToolCallExecutionOptions,
): ToolCallContext<P> {
  const abortController = context?.abortController ?? new AbortController()
  const ask =
    canUseTool !== undefined &&
    parentMessage !== undefined &&
    context !== undefined
      ? (
          input: Record<string, unknown>,
          askOpts?: { toolUseId?: string; forceDecision?: PermissionDecision },
        ): Promise<PermissionDecision> =>
          canUseTool(
            tool,
            input,
            context,
            parentMessage,
            askOpts?.toolUseId ?? context.toolUseId ?? '',
            askOpts?.forceDecision,
          )
      : undefined

  return {
    get toolUseId() {
      return context?.toolUseId
    },
    abortController,
    get signal() {
      return abortController.signal
    },
    abort: reason => abortController.abort(reason),
    parentMessage,
    onProgress,
    canUseTool,
    userModified: opts?.userModified ?? context?.userModified,
    globLimits: opts?.globLimits ?? context?.globLimits,
    fileReadingLimits: opts?.fileReadingLimits ?? context?.fileReadingLimits,
    get innerCall() {
      return context?.innerCall
    },
    get sameTurnToolUses() {
      return context?.sameTurnToolUses
    },
    gitDiffRead: opts?.gitDiffRead,
    smallResultAsked: opts?.smallResultAsked,
    callerLogsSharedEvents: opts?.callerLogsSharedEvents,
    timing: opts?.timing,
    remoteCall: opts?.remoteCall,
    get permissionSurface() {
      if (context?.toolUseId === undefined) return undefined
      return context.toolDecisions?.get(context.toolUseId)?.source
    },
    ask,
  }
}

/**
 * Reconstruct a `ToolUseContext` from `(deps, callCtx)` for delegating into
 * deep internal helpers that still expect a `ToolUseContext`.
 *
 * - If `deps` was projected from a host `ToolUseContext` via `createToolDeps`,
 *   returns that original context with any per-call `callCtx` overrides.
 * - If `deps` was constructed explicitly via `createExplicitToolDeps` (e.g. in
 *   a separate worker process with ZERO ALS), synthesizes a valid
 *   `ToolUseContext` purely from the explicit `deps` + `callCtx` fields.
 */
export function resolveToolUseContext<
  P extends ToolProgressData = ToolProgressData,
>(deps: ToolDeps, callCtx?: ToolCallContext<P>): ToolUseContext {
  const original = rawContextByDeps.get(deps)
  if (original !== undefined) {
    if (
      callCtx === undefined ||
      (callCtx.toolUseId === original.toolUseId &&
        callCtx.userModified === original.userModified &&
        callCtx.globLimits === original.globLimits &&
        callCtx.fileReadingLimits === original.fileReadingLimits &&
        callCtx.abortController === original.abortController &&
        callCtx.innerCall === original.innerCall &&
        callCtx.sameTurnToolUses === original.sameTurnToolUses)
    ) {
      return original
    }
    return {
      ...original,
      ...(callCtx.abortController !== undefined
        ? { abortController: callCtx.abortController }
        : {}),
      ...(callCtx.toolUseId !== undefined
        ? { toolUseId: callCtx.toolUseId }
        : {}),
      ...(callCtx.userModified !== undefined
        ? { userModified: callCtx.userModified }
        : {}),
      ...(callCtx.globLimits !== undefined
        ? { globLimits: callCtx.globLimits }
        : {}),
      ...(callCtx.fileReadingLimits !== undefined
        ? { fileReadingLimits: callCtx.fileReadingLimits }
        : {}),
      ...(callCtx.innerCall !== undefined
        ? { innerCall: callCtx.innerCall }
        : {}),
      ...(callCtx.sameTurnToolUses !== undefined
        ? { sameTurnToolUses: callCtx.sameTurnToolUses }
        : {}),
    }
  }

  const abortController = callCtx?.abortController ?? new AbortController()
  const synthesized: ToolUseContext = {
    options: {
      commands: deps.commands ?? [],
      debug: false,
      mainLoopModel: deps.loopModel(),
      tools: deps.tools,
      verbose: false,
      thinkingConfig: deps.thinkingConfig(),
      mcpClients: deps.mcpClients(),
      mcpResources: deps.mcpResources ?? {},
      isNonInteractiveSession: deps.isNonInteractiveSession,
      agentDefinitions: deps.agentDefinitions ?? {
        activeAgents: [],
        allAgents: [],
      },
      appendSystemPrompt: deps.appendSystemPrompt,
      customSystemPrompt: deps.customSystemPrompt,
      appendSubagentSystemPrompt: deps.appendSubagentSystemPrompt,
      refreshTools: deps.refreshTools,
      refreshMcpClients: deps.refreshMcpClients,
      toolAliases: deps.toolAliases,
      messageClientPlatform: deps.messageClientPlatform,
    },
    abortController,
    readFileState: deps.readFileState,
    getAppState: () => {
      const base = deps.getAppState()
      const perms = deps.permissions()
      if (base?.toolPermissionContext === perms) {
        return base
      }
      return {
        ...base,
        toolPermissionContext: perms,
      }
    },
    setAppState: deps.setAppState,
    setToolPermissionContext: deps.setToolPermissionContext,
    setSessionToolPermissionContext: deps.setSessionToolPermissionContext,
    setAppStateForTasks: deps.setAppStateForTasks,
    setInProgressToolUseIDs: deps.setInProgressToolUseIDs ?? (() => {}),
    setResponseLength: deps.setResponseLength ?? (() => {}),
    updateFileHistoryState: deps.updateFileHistoryState ?? (() => {}),
    messages: deps.messages(),
    session: deps.session,
    agentId: deps.agentId,
    agentType: deps.agentType,
    agentWorktree: deps.agentWorktree,
    isBackgroundAgent: deps.isBackgroundAgent,
    innerCall: callCtx?.innerCall ?? deps.innerCall,
    forRemoteExecution: deps.forRemoteExecution,
    hookCaller: deps.hookCaller,
    storageV5: deps.storageV5,
    credentials: deps.credentials,
    toolState: deps.toolState,
    taskRegistry: deps.taskRegistry,
    dynamicSkillDirTriggers: deps.dynamicSkillDirTriggers,
    nestedMemoryAttachmentTriggers: deps.nestedMemoryAttachmentTriggers,
    loadedNestedMemoryPaths: deps.loadedNestedMemoryPaths,
    pendingNestedMemoryTriggers: deps.pendingNestedMemoryTriggers,
    discoveredSkillNames: deps.discoveredSkillNames,
    appendSystemMessage: deps.appendSystemMessage,
    addNotification: deps.addNotification,
    sendOSNotification: deps.sendOSNotification,
    requestDialog: deps.requestDialog,
    requestPrompt: deps.requestPrompt,
    handleElicitation: deps.handleElicitation,
    onChangeDynamicMcpConfig: deps.onChangeDynamicMcpConfig,
    setToolJSX: deps.setToolJSX,
    setStreamMode: deps.setStreamMode,
    getMcp: deps.getMcp,
    getProactivityLevel: deps.getProactivityLevel,
    queryTracking: deps.queryTracking,
    permissionLayers: deps.permissionLayers,
    toolDecisions: deps.toolDecisions,
    toolUseId: callCtx?.toolUseId,
    userModified: callCtx?.userModified,
    globLimits: callCtx?.globLimits,
    fileReadingLimits: callCtx?.fileReadingLimits,
    sameTurnToolUses: callCtx?.sameTurnToolUses,
  }
  return synthesized
}

export function createDefaultCanUseTool(): CanUseToolFn {
  return async (_tool, input) => ({
    behavior: 'allow',
    updatedInput: input,
  })
}

// ============================================================================
// Official 2.1.331 Cross-Process Dispatch (`pe`) & Error Sanitization (`lo`)
// ============================================================================

const MAX_REMOTE_ERROR_MESSAGE_CHARS = 2000
// Strip ANSI CSI / OSC escape sequences before removing control/format/surrogate chars.
const ANSI_ESCAPE_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberate ANSI escape stripping
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g
const UNSAFE_WIRE_CHARS_RE = /[\p{Cc}\p{Cf}\p{Cs}]+/gu

/**
 * Official 2.1.331 `Mge(ap(str, maxLen))` — strip ANSI escapes, control/bidi/
 * format/surrogate code points, collapse whitespace, cap length, and escape
 * `<`/`>` to `&lt;`/`&gt;` so remote worker text can never break out of XML
 * tool wrappers (`<tool_use_error>`) or inject bidi overrides.
 */
export function sanitizeRemoteWireText(
  raw: string,
  maxChars = MAX_REMOTE_ERROR_MESSAGE_CHARS,
): string {
  const cleaned = raw
    .replace(ANSI_ESCAPE_RE, ' ')
    .replace(UNSAFE_WIRE_CHARS_RE, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  const truncated =
    cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars)}…`
  return truncated.replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function normalizeRemoteNativeToolError(err: unknown): Error {
  if (
    err instanceof NativeToolElsewhereError ||
    err instanceof NeverRunsInThisProcessError ||
    isAbortError(err)
  ) {
    return err instanceof Error
      ? err
      : new NativeToolElsewhereError(String(err))
  }
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String(err)
  const sanitized = sanitizeRemoteWireText(
    rawMessage,
    MAX_REMOTE_ERROR_MESSAGE_CHARS,
  )
  if (err instanceof Error && Object.isExtensible(err)) {
    const desc = Object.getOwnPropertyDescriptor(err, 'message')
    if (desc === undefined || desc.configurable !== false) {
      try {
        Object.defineProperty(err, 'message', {
          value: sanitized,
          writable: true,
          configurable: true,
        })
        return err
      } catch {
        // Fall through to sanitized NativeToolElsewhereError
      }
    }
  }
  return new NativeToolElsewhereError(sanitized)
}

/**
 * Official 2.1.331 `pe(...)`: executes a native tool via a registered
 * cross-process `RemoteNativeToolRunner`, validates the wire output against
 * `outputSchemaAcrossProcesses ?? outputSchema`, merges `fieldsFromThisSide`,
 * and runs `fromAnotherProcess(...)` to hydrate host-side state/messages.
 */
export async function dispatchRemoteNativeToolCall<
  Input extends AnyObject,
  Output,
>(
  def: Pick<
    Tool<Input, Output>,
    | 'name'
    | 'outputSchema'
    | 'outputSchemaAcrossProcesses'
    | 'isReadOnly'
    | 'fromAnotherProcess'
  >,
  runner: RemoteNativeToolRunner,
  input: z.infer<Input>,
  signal: AbortSignal,
  context: ToolUseContext,
  opts?: ToolCallExecutionOptions,
  model?: string,
): Promise<ToolResult<Output>> {
  let remoteResult: RemoteNativeToolResult
  try {
    remoteResult = (await runner(def.name, input, signal, context)) ?? {}
  } catch (err) {
    throw normalizeRemoteNativeToolError(err)
  }

  const {
    output,
    afterRead,
    subagentFrameResult,
    fieldsFromThisSide,
    newMessages: runnerNewMessages,
  } = remoteResult

  const schema = def.outputSchemaAcrossProcesses ?? def.outputSchema
  const parsed = schema?.safeParse(output)
  if (parsed?.success !== true) {
    afterRead?.unreadable?.()
    let safeToRetry = false
    try {
      safeToRetry =
        def.isReadOnly?.(input) === true && def.name !== 'SendUserFile'
    } catch {
      safeToRetry = false
    }
    throw new NativeToolElsewhereError(
      safeToRetry
        ? `${def.name} ran, but its result could not be read. It changes nothing, so it is safe to run again.`
        : `${def.name} ran, but its result could not be read. Check its effect before running it again.`,
      'ANSWER_LOST',
    )
  }
  afterRead?.ok?.()

  const mergedData = (
    fieldsFromThisSide === undefined ||
    parsed.data === null ||
    typeof parsed.data !== 'object' ||
    Array.isArray(parsed.data)
      ? parsed.data
      : {
          ...(parsed.data as Record<string, unknown>),
          ...fieldsFromThisSide,
        }
  ) as Output

  const hydrated =
    def.fromAnotherProcess?.(mergedData, input, opts, model, context.agentId) ??
    {}

  const combinedMessages = [
    ...(hydrated.newMessages ?? []),
    ...(runnerNewMessages ?? []),
  ]

  return {
    data: (hydrated.data ?? mergedData) as Output,
    ...(combinedMessages.length > 0 ? { newMessages: combinedMessages } : {}),
    ...(subagentFrameResult !== undefined ? { subagentFrameResult } : {}),
  }
}

// ============================================================================
// Official 2.1.331 `vn(def)` Runtime Adapter (`buildTool` backend)
// ============================================================================

const VALIDATION_OK: ValidationResult = Object.freeze({ result: true })

type ProbedOptionalMethod =
  | 'permissionCheckFailureDecision'
  | 'deriveObservableInput'

const probedOptionalMethodsCache = new WeakMap<
  (deps: ToolDeps) => ToolInstance<AnyObject, unknown, ToolProgressData>,
  Partial<Record<ProbedOptionalMethod, boolean>>
>()

/**
 * Official 2.1.331 `we(createFn, methodName)` — probes whether a tool's
 * `create(deps)` instance exposes an optional method using an undefined-returning
 * Proxy, cached per factory function.
 */
function hasInstanceOptionalMethod(
  createFn: (
    deps: ToolDeps,
  ) => ToolInstance<AnyObject, unknown, ToolProgressData>,
  methodName: ProbedOptionalMethod,
): boolean {
  let cache = probedOptionalMethodsCache.get(createFn)
  if (cache === undefined) {
    cache = {}
    probedOptionalMethodsCache.set(createFn, cache)
  }
  if (methodName in cache) {
    return cache[methodName] === true
  }
  let has = false
  try {
    const probeDeps = new Proxy({} as ToolDeps, {
      get: () => undefined,
    })
    const instance = createFn(probeDeps)
    has =
      instance !== null &&
      typeof instance === 'object' &&
      methodName in instance &&
      typeof instance[methodName] === 'function'
  } catch {
    has = false
  }
  cache[methodName] = has
  return has
}

type RuntimeAdaptableToolDef = {
  readonly name: string
  outputSchema?: z.ZodType<unknown>
  outputSchemaAcrossProcesses?: z.ZodType<unknown>
  isReadOnly?: (input: never) => boolean
  fromAnotherProcess?: (
    data: never,
    input: never,
    opts?: ToolCallExecutionOptions,
    model?: string,
    agentId?: AgentId,
  ) => {
    data?: unknown
    newMessages?: ToolResult<unknown>['newMessages']
  }
  create?: (
    deps: ToolDeps,
  ) => ToolInstance<AnyObject, unknown, ToolProgressData>
  call?: (
    args: never,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress<ToolProgressData>,
    opts?: ToolCallExecutionOptions,
  ) => Promise<ToolResult<unknown>>
  validateInput?: (
    input: never,
    context: ToolUseContext,
  ) => Promise<ValidationResult>
  checkPermissions?: (
    input: never,
    context: ToolUseContext,
  ) => Promise<PermissionResult>
  permissionCheckFailureDecision?: (
    input: never,
    context: ToolUseContext,
  ) => PermissionResult | undefined
  deriveObservableInput?: (
    input: never,
    context: ToolUseContext,
  ) => Promise<Record<string, unknown> | undefined>
}

/**
 * Official 2.1.331 `vn(e)` — attaches `create(deps)` and remote-native-tool /
 * diskless runtime dispatch onto a `buildTool(def)` target object WITHOUT
 * invoking any lazy getters on `def`.
 */
export function attachToolCreateAndRemoteRuntime<T extends object>(
  def: RuntimeAdaptableToolDef,
  built: T,
): T {
  const nativeCreate = def.create
  const legacyCall = def.call
  const legacyValidateInput = def.validateInput
  const legacyCheckPermissions = def.checkPermissions
  const legacyPermissionCheckFailureDecision =
    def.permissionCheckFailureDecision
  const legacyDeriveObservableInput = def.deriveObservableInput

  const createInstance = (
    deps: ToolDeps,
    session?: RemoteNativeToolSession,
  ): ToolInstance<AnyObject, unknown, ToolProgressData> => {
    assertNativeToolCanRunLocally(def.name, session ?? deps.session)
    if (nativeCreate !== undefined) {
      return nativeCreate.call(built, deps)
    }
    const instance: ToolInstance<AnyObject, unknown, ToolProgressData> = {
      async call(args, callCtx) {
        if (legacyCall === undefined) {
          throw new Error(
            `Tool "${def.name}" defines neither create() nor call()`,
          )
        }
        const ctx = resolveToolUseContext(deps, callCtx)
        const canUseTool = callCtx.canUseTool ?? createDefaultCanUseTool()
        const parentMessage = callCtx.parentMessage as AssistantMessage
        return legacyCall.call(
          built,
          args as never,
          ctx,
          canUseTool,
          parentMessage,
          callCtx.onProgress,
        )
      },
      ...(legacyValidateInput !== undefined
        ? {
            validateInput(input, callCtx) {
              const ctx = resolveToolUseContext(deps, callCtx)
              return legacyValidateInput.call(built, input as never, ctx)
            },
          }
        : {}),
      ...(legacyCheckPermissions !== undefined
        ? {
            checkPermissions(input, callCtx) {
              const ctx = resolveToolUseContext(deps, callCtx)
              return legacyCheckPermissions.call(built, input as never, ctx)
            },
          }
        : {}),
      ...(legacyPermissionCheckFailureDecision !== undefined
        ? {
            permissionCheckFailureDecision(input, callCtx) {
              const ctx = resolveToolUseContext(deps, callCtx)
              return legacyPermissionCheckFailureDecision.call(
                built,
                input as never,
                ctx,
              )
            },
          }
        : {}),
      ...(legacyDeriveObservableInput !== undefined
        ? {
            deriveObservableInput(input, callCtx) {
              const ctx = resolveToolUseContext(deps, callCtx)
              return legacyDeriveObservableInput.call(
                built,
                input as never,
                ctx,
              )
            },
          }
        : {}),
    }
    return instance
  }

  const instantiateFromLegacy = (
    context: ToolUseContext | undefined,
    onProgress?: ToolCallProgress<ToolProgressData>,
    parentMessage?: AssistantMessage,
    canUseTool?: CanUseToolFn,
    opts?: ToolCallExecutionOptions,
  ) => {
    const deps = createToolDeps(context)
    const toolInstance = createInstance(
      deps,
      context?.session as RemoteNativeToolSession | undefined,
    )
    const callCtx = createCallContextFromLegacy(
      built as unknown as Tool,
      context,
      onProgress,
      parentMessage,
      canUseTool,
      opts,
    )
    return { toolInstance, callCtx }
  }

  const runtimeMethods = {
    create(deps: ToolDeps) {
      return createInstance(deps, deps.session)
    },
    async call(
      args: Record<string, unknown>,
      context?: ToolUseContext,
      canUseTool?: CanUseToolFn,
      parentMessage?: AssistantMessage,
      onProgress?: ToolCallProgress<ToolProgressData>,
      opts?: ToolCallExecutionOptions,
    ): Promise<ToolResult<unknown>> {
      const session = context?.session as RemoteNativeToolSession | undefined
      const currentRunner = getRemoteNativeToolRunner(session, def.name)
      const effectiveRunner =
        opts?.runnerCheckedHere !== undefined &&
        currentRunner !== undefined &&
        hasRemoteNativeToolCheck(session, def.name)
          ? opts.runnerCheckedHere
          : currentRunner

      if (
        opts?.permissionCheckedFor !== undefined &&
        (opts.permissionCheckedFor ?? undefined) !== effectiveRunner
      ) {
        throw new NativeToolElsewhereError(
          `${def.name} was not run: where it runs changed after its permission was checked. Send the call again.`,
          'NOT_RUN',
        )
      }

      if (effectiveRunner !== undefined) {
        const dispatchCtx =
          context ?? resolveToolUseContext(createExplicitToolDeps({ session }))
        return dispatchRemoteNativeToolCall(
          built as unknown as Tool,
          effectiveRunner,
          args,
          dispatchCtx.abortController.signal,
          dispatchCtx,
          opts,
          typeof parentMessage?.message?.model === 'string'
            ? parentMessage.message.model
            : undefined,
        )
      }

      const { toolInstance, callCtx } = instantiateFromLegacy(
        context,
        onProgress,
        parentMessage,
        canUseTool,
        opts,
      )
      return toolInstance.call(args, callCtx)
    },
    async validateInput(
      input: Record<string, unknown>,
      context?: ToolUseContext,
    ): Promise<ValidationResult> {
      const session = context?.session as RemoteNativeToolSession | undefined
      const runner = getRemoteNativeToolRunner(session, def.name)
      if (runner !== undefined) {
        const refusal = runner.refusedUnasked?.(
          input,
          context ?? resolveToolUseContext(createExplicitToolDeps()),
        )
        return refusal === undefined
          ? VALIDATION_OK
          : { result: false, message: refusal, errorCode: 1 }
      }
      const { toolInstance, callCtx } = instantiateFromLegacy(context)
      return toolInstance.validateInput !== undefined
        ? toolInstance.validateInput(input, callCtx)
        : VALIDATION_OK
    },
    async checkPermissions(
      input: Record<string, unknown>,
      context?: ToolUseContext,
    ): Promise<PermissionResult> {
      const session = context?.session as RemoteNativeToolSession | undefined
      const runner = getRemoteNativeToolRunner(session, def.name)
      if (runner !== undefined) {
        const passthrough: PermissionResult = {
          behavior: 'passthrough',
          message: `${def.name} requires permission.`,
        }
        if (
          runner.checkPermissions === undefined ||
          context?.toolUseId === undefined
        ) {
          return passthrough
        }
        return (
          (await runner.checkPermissions(
            built as unknown as Tool,
            input,
            context,
          )) ?? passthrough
        )
      }
      const { toolInstance, callCtx } = instantiateFromLegacy(context)
      return toolInstance.checkPermissions !== undefined
        ? toolInstance.checkPermissions(input, callCtx)
        : { behavior: 'allow', updatedInput: input }
    },
    permissionCheckFailureDecision(
      input: Record<string, unknown>,
      context?: ToolUseContext,
    ): PermissionResult | undefined {
      const session = context?.session as RemoteNativeToolSession | undefined
      if (getRemoteNativeToolRunner(session, def.name) !== undefined) {
        return {
          behavior: 'deny',
          message: `${def.name} was not run: its permission check could not be completed.`,
          decisionReason: {
            type: 'other',
            reason: 'permission check failed',
          },
        }
      }
      if (isNativeToolDisabledInThisProcess(def.name, session)) {
        return {
          behavior: 'deny',
          message: `${def.name} is unavailable: this session runs file and shell tools only in its cloud environment, and this call could not be sent there. Retrying will not help.`,
          decisionReason: {
            type: 'other',
            reason: 'permission check failed',
          },
        }
      }
      if (nativeCreate !== undefined) {
        if (
          !hasInstanceOptionalMethod(
            nativeCreate,
            'permissionCheckFailureDecision',
          )
        ) {
          return undefined
        }
      } else if (legacyPermissionCheckFailureDecision === undefined) {
        return undefined
      }
      const { toolInstance, callCtx } = instantiateFromLegacy(context)
      return toolInstance.permissionCheckFailureDecision?.(input, callCtx)
    },
    async deriveObservableInput(
      input: Record<string, unknown>,
      context?: ToolUseContext,
    ): Promise<Record<string, unknown> | undefined> {
      const session = context?.session as RemoteNativeToolSession | undefined
      if (getRemoteNativeToolRunner(session, def.name) !== undefined) {
        return undefined
      }
      if (nativeCreate !== undefined) {
        if (!hasInstanceOptionalMethod(nativeCreate, 'deriveObservableInput')) {
          return undefined
        }
      } else if (legacyDeriveObservableInput === undefined) {
        return undefined
      }
      const { toolInstance, callCtx } = instantiateFromLegacy(context)
      return toolInstance.deriveObservableInput?.(input, callCtx)
    },
  }

  return Object.assign(built, runtimeMethods)
}
