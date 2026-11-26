/**
 * densable 2.1.283 send-now detach registry (EEe / Wuo).
 * Running tool uses register a backgroundNow() that detaches instead of cancel.
 */
import { logError } from './log.js'
import { logForDebugging } from './debug.js'
import { leftoverM, leftoverP, leftoverY } from './leftoverOt.js'
import { isHumanLikeOrigin } from './messages.js'
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  RootSessionSlot,
  runWithSession,
} from './sessionHost.js'
import type { QueuePriority } from '../types/textInputTypes.js'

export type ForegroundToolCall = {
  toolUseId?: string
  backgroundNow: () => boolean
}

/** densable `Ct.peek/of` key — `session.root`, else the object (test bags). */
function sessionRoot(session: object): object {
  if (session === queryForegroundSession) {
    try {
      const active = getBootstrapSession()
      if (active?.root) return active.root
    } catch {
      // Fall back to queryForegroundSession when sessionHost is mocked
    }
    return queryForegroundSession
  }
  if (
    'root' in session &&
    typeof (session as { root?: unknown }).root === 'object' &&
    (session as { root: object | null }).root !== null
  ) {
    return (session as { root: object }).root
  }
  return session
}

/** densable `aOt`. */
class ForegroundCallBag {
  #e = new Set<ForegroundToolCall>()
  add(call: ForegroundToolCall): () => void {
    this.#e.add(call)
    return () => {
      this.#e.delete(call)
    }
  }
  list(): ForegroundToolCall[] {
    return [...this.#e]
  }
}

/** densable `Ct` — WeakMap keyed by `session.root`. */
class SessionRootMap<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(factory: () => T) {
    this.#e = factory
  }
  peek(session: object): T | undefined {
    return this.#t.get(sessionRoot(session))
  }
  of(session: object): T {
    const t = sessionRoot(session)
    const existing = this.#t.get(t)
    if (existing !== undefined) return existing
    const created = this.#e()
    this.#t.set(t, created)
    return created
  }
}

/** densable `TTe`. */
const TTe = new SessionRootMap(() => new ForegroundCallBag())

export function registerForegroundToolCall(
  session: object,
  call: ForegroundToolCall,
): () => void {
  return TTe.of(session).add(call)
}

export function listForegroundToolCalls(session: object): ForegroundToolCall[] {
  return TTe.peek(session)?.list() ?? []
}

/** densable `b0o` — background a provided call list. */
export function backgroundForegroundToolCallList(
  calls: readonly ForegroundToolCall[],
): number {
  let moved = 0
  for (const call of calls) {
    try {
      if (call.backgroundNow()) moved++
    } catch (error) {
      logForDebugging(
        `[foreground-tool-calls] moving ${call.toolUseId ?? 'a call'} threw; it stays in the foreground`,
        { level: 'error' },
      )
      logError(error)
    }
  }
  return moved
}

/** densable Wuo — background running tools; do not cancel. */
export function backgroundForegroundToolCalls(session: object): number {
  return backgroundForegroundToolCallList(listForegroundToolCalls(session))
}

/** Process-wide bag when ToolUseContext.session is unset (tests / headless). */
export const queryForegroundSession: object = {}

/**
 * densable `tNr` — XVe with `{backgroundedToDeliverMessage:!0}` so DVn
 * uses the deliver-message copy instead of Ctrl+B.
 */
/** densable `Ns` / `Mo` / `Us`. */
const QUEUED_NOW_TICK_MS = 200
const UNMOVABLE_GRACE = 2
const MOVED_RESULT_GRACE = 8
const MOVABLE_AGENT_TOOL_NAMES = new Set(['Bash', 'PowerShell'])

/** densable `WR` — Clock.setTimeout cancel handle, no unref. */
function clockSetTimeout(callback: () => void, ms: number): () => void {
  const capturedSession = getActiveSessionFromAls()
  const timer = setTimeout(() => {
    if (
      capturedSession !== undefined &&
      getActiveSessionFromAls() !== capturedSession
    ) {
      runWithSession(capturedSession, callback)
    } else {
      callback()
    }
  }, ms)
  return () => clearTimeout(timer)
}

/**
 * densable `kdt(h,v)` — drop transcript rows whose uuid is already in the
 * pending named-agent queue. Empty pending returns `h` (same ref).
 */
export function queuedNowTranscriptWithoutPending<T extends { uuid?: string }>(
  messages: readonly T[],
  pending: ReadonlyArray<{ uuid?: string }>,
): T[] {
  if (pending.length === 0) return messages as T[]
  const ids = new Set(pending.map(row => row.uuid))
  return messages.filter(row => !ids.has(row.uuid))
}

export type QueuedNowEvidence = {
  head: string
  hasFoldTakenPrompt: boolean
  isLocalTurnActive: boolean
  isLocalTurnRunning: boolean
  isHeldByDialog: boolean
  holderCount: number
  unmovableHolderCount: number
  isExecuting: boolean
  isAwaitingMovedResult: boolean
  isCompacting: boolean
  isUnmovableGraceOver: boolean
  isBackgroundingDisabled: boolean
  isMainRequestInFlight: boolean
}

type QueuedNowRow = {
  uuid?: string
  priority?: string
  mode?: string
  agentId?: string
  drainOnly?: boolean
  promptSubmitted?: unknown
  screeningPending?: boolean
}

/**
 * densable `Eo` — first tracked non-now queue row's head.
 */
export function queuedNowHead(
  queue: QueuedNowRow[],
  tracked: { has(uuid: string): boolean },
  agentId?: string,
  folds?: {
    isFoldInFlight?: (uuid: string) => boolean
    isMidTurnFoldSuspended?: () => boolean
  },
): {
  head: 'ended_by_hook' | 'not_ready' | 'behind_earlier' | 'deliverable'
  uuid: string
  priority: string
} | null {
  const index = queue.findIndex(
    row =>
      row.uuid !== undefined && tracked.has(row.uuid) && row.priority !== 'now',
  )
  const row = queue[index]
  const uuid = row?.uuid
  if (row === undefined || uuid === undefined) return null
  const priority = row.priority === 'later' ? 'later' : 'next'
  if (row.drainOnly === true && row.promptSubmitted !== undefined) {
    return { head: 'ended_by_hook', uuid, priority }
  }
  const earlier = queue.slice(0, index)
  if (
    queue.some(
      item => item.screeningPending === true && item.agentId === agentId,
    ) ||
    folds?.isFoldInFlight?.(uuid) === true ||
    folds?.isMidTurnFoldSuspended?.() === true ||
    earlier.some(item => item.priority === 'now' && item.agentId === agentId)
  ) {
    return { head: 'not_ready', uuid, priority }
  }
  if (
    earlier.some(
      item =>
        item.agentId === agentId &&
        (item.mode === 'prompt' || item.mode === 'bash'),
    )
  ) {
    return { head: 'behind_earlier', uuid, priority }
  }
  return { head: 'deliverable', uuid, priority }
}

/**
 * densable `b0n` — outstanding tool_use id → name. `outstandingToolUseIds`
 * is the id set (Bs/`Le` only needs `.has`).
 */
export function outstandingToolUses(
  messages: Array<{
    type?: string
    isMeta?: boolean
    message?: { content?: unknown }
  }>,
): Map<string, string> {
  const uses = new Map<string, string>()
  const results = new Set<string>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'tool_use' &&
            typeof (block as { id?: string }).id === 'string'
          ) {
            const name = (block as { name?: string }).name
            uses.set(
              (block as { id: string }).id,
              typeof name === 'string' ? name : 'tool_use',
            )
          }
        }
      }
      continue
    }
    if (msg?.type !== 'user') continue
    const content = msg.message?.content
    if (!Array.isArray(content)) {
      if (msg.isMeta !== true) break
      continue
    }
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: string }).type === 'tool_result' &&
        typeof (block as { tool_use_id?: string }).tool_use_id === 'string'
      ) {
        results.add((block as { tool_use_id: string }).tool_use_id)
      }
    }
  }
  for (const id of results) uses.delete(id)
  return uses
}

export function outstandingToolUseIds(
  messages: Array<{
    type?: string
    isMeta?: boolean
    message?: { content?: unknown }
  }>,
): Set<string> {
  return new Set(outstandingToolUses(messages).keys())
}

/**
 * densable `uf` — `zxn(mode) && !isMeta && jy(origin) && !ddt`.
 * `zxn`/`ddt` drop poll-event and task-notification; `ddt` also skipAttachments.
 */
export function isQueuedNowPrompt(cmd: {
  mode?: string
  isMeta?: boolean
  origin?: { kind?: string }
  skipAttachments?: boolean
}): boolean {
  if (cmd.mode === 'poll-event' || cmd.mode === 'task-notification') {
    return false
  }
  if (cmd.isMeta) return false
  if (!isHumanLikeOrigin(cmd.origin)) return false
  if (cmd.skipAttachments === true) return false
  return true
}

type HolderTask = {
  id?: string
  status?: string
  isBackgrounded?: boolean
  toolUseId?: string
  type?: string
  agentId?: string
  parentAgentId?: string
  caller?: string
  shellCommand?: unknown
}

const PREAMBLE_MARK = ':preamble-'

/** densable `Q3n`. */
export function stripPreambleToolUseId(id: string): string {
  const at = id.indexOf(PREAMBLE_MARK)
  return at === -1 ? id : id.slice(0, at)
}

/**
 * densable `ZLr` — local_bash for this agent (or main when agentId is unset).
 */
function isLocalBashForAgent(task: HolderTask, agentId?: string): boolean {
  if (task.type !== undefined && task.type !== 'local_bash') return false
  // densable `oFt`/`Vu`: foreground local_bash needs a live shellCommand.
  if (task.type === 'local_bash' && !task.shellCommand) return false
  return task.agentId === agentId
}

/**
 * densable `eNr` — ZLr and caller is `turn` (main) or `agent` (subagent).
 */
function isTurnOrAgentCaller(task: HolderTask, agentId?: string): boolean {
  if (!isLocalBashForAgent(task, agentId)) return false
  const expected = agentId === undefined ? 'turn' : 'agent'
  return task.caller === undefined || task.caller === expected
}

/**
 * densable `Bs` — running local_bash holders whose toolUseId is outstanding.
 * Inner preamble calls (`caller==="inner"` + `:preamble-`) also count.
 */
export function holderBackgroundTasks<T extends HolderTask>(
  tasks: T[],
  outstanding: { has(id: string): boolean },
  agentId?: string,
): T[] {
  return tasks.filter(task => {
    if (task.status !== 'running' || task.isBackgrounded === true) return false
    if (!isLocalBashForAgent(task, agentId)) return false
    const id = task.toolUseId
    if (id === undefined) return false
    const inner = task.caller === 'inner' && id.includes(PREAMBLE_MARK)
    if (!(inner || isTurnOrAgentCaller(task, agentId))) return false
    return outstanding.has(stripPreambleToolUseId(id))
  })
}

/**
 * densable `s$r` then `Le(h, toolUseId)` — running local_agent children of
 * `turn.agentId` (main = undefined) whose tool_use is still outstanding.
 */
export function holderLocalAgentTasks<T extends HolderTask>(
  tasks: T[],
  outstanding: { has(id: string): boolean },
  agentId?: string,
): T[] {
  return tasks.filter(
    task =>
      task.type === 'local_agent' &&
      task.status === 'running' &&
      task.isBackgrounded !== true &&
      task.parentAgentId === agentId &&
      task.toolUseId !== undefined &&
      outstanding.has(task.toolUseId),
  )
}

/**
 * densable `Gs` — running local_bash that are not Bs/eNr holders but sit
 * under descendant local_agents of `turn.agentId`. `#A` kills these via
 * zN after unmovable grace when `endsUnmovableShells`.
 */
export function unmovableDescendantShells<T extends HolderTask>(
  tasks: T[],
  outstanding: { has(id: string): boolean; values?: () => Iterable<string> },
  holders: T[],
  agentId?: string,
): T[] {
  // densable Gs (@205863200): `let s = [...n.values()].includes(uc)` (`REPL`).
  const hasReplTool =
    typeof outstanding.values === 'function' &&
    [...outstanding.values()].includes('REPL')
  const holderSet = new Set(holders)
  const runningAgents = tasks.filter(
    task =>
      task.type === 'local_agent' &&
      task.status === 'running' &&
      task.isBackgrounded !== true,
  )
  const descendants = new Set(
    runningAgents
      .filter(
        task =>
          task.parentAgentId === agentId &&
          (hasReplTool ||
            (task.toolUseId !== undefined && outstanding.has(task.toolUseId))),
      )
      .flatMap(task => (task.agentId === undefined ? [] : [task.agentId])),
  )
  for (let prev = -1; prev !== descendants.size; ) {
    prev = descendants.size
    for (const task of runningAgents) {
      if (
        task.parentAgentId !== undefined &&
        descendants.has(task.parentAgentId) &&
        task.agentId !== undefined
      ) {
        descendants.add(task.agentId)
      }
    }
  }
  return tasks.filter(task => {
    if (task.type !== 'local_bash' || task.status !== 'running') return false
    if (task.isBackgrounded === true || !task.shellCommand) return false
    if (isTurnOrAgentCaller(task, agentId) || holderSet.has(task)) return false
    if (task.agentId !== agentId) {
      return task.agentId !== undefined && descendants.has(task.agentId)
    }
    const id = task.toolUseId
    return (
      hasReplTool ||
      (id !== undefined && outstanding.has(id.split(':')[0] ?? id))
    )
  })
}

/**
 * densable `Hs` — queued-now action.
 */
export function queuedNowAction(e: QueuedNowEvidence): {
  action: 'stand_by' | 'wait' | 'background' | 'interrupt' | 'cancel'
  reason?: string
} {
  if (
    e.head === 'ended_by_hook' ||
    e.hasFoldTakenPrompt ||
    !e.isLocalTurnActive
  ) {
    return { action: 'stand_by' }
  }
  if (e.isHeldByDialog) return { action: 'wait', reason: 'held_by_dialog' }
  if (e.head === 'not_ready' || !e.isLocalTurnRunning) {
    return { action: 'wait', reason: 'not_ready' }
  }
  if (e.head === 'behind_earlier')
    return { action: 'wait', reason: 'behind_earlier' }
  if (e.holderCount > e.unmovableHolderCount) return { action: 'background' }
  if (e.isCompacting) return { action: 'wait', reason: 'compacting' }
  if (e.isAwaitingMovedResult) return { action: 'wait', reason: 'moved_result' }
  if (e.holderCount > 0 || e.isExecuting) {
    if (!e.isUnmovableGraceOver)
      return { action: 'wait', reason: 'unmovable_grace' }
    return e.isBackgroundingDisabled
      ? { action: 'cancel' }
      : { action: 'interrupt' }
  }
  if (!e.isMainRequestInFlight)
    return { action: 'wait', reason: 'not_sampling' }
  return { action: 'interrupt' }
}

type QueuedNowTracked = {
  outcome: string
  raisedFrom: QueuePriority | null
}

export type QueuedNowTurnEvidence = {
  isHeldByDialog: boolean
  isToolCallStarting: boolean
  isCompacting: boolean
  isMainRequestAnnounced: boolean
}

/**
 * densable `aM` — engine dialogs that do not hold send-now.
 */
export const QUEUED_NOW_DIALOG_SKIP_KINDS = new Set([
  'lsp_recommendation',
  'plugin_hint',
  'left_arrow_confirm',
  'goal_proposal',
  'remote_callout',
  'ultraplan_choice',
  'cost_threshold',
  'resume_return',
  'cold_resume_quota',
  'newer_model_offer',
  'ide_onboarding',
  'fullscreen_upsell',
  'effort_medium_nudge',
])

/** densable `hm`. */
export function queuedNowEngineDialog(
  open: Array<{ userInvoked?: boolean; kind?: string }>,
): { userInvoked?: boolean; kind?: string } | null {
  for (let i = open.length - 1; i >= 0; i--) {
    const row = open[i]
    if (!row || row.userInvoked === true) continue
    if (QUEUED_NOW_DIALOG_SKIP_KINDS.has(row.kind ?? '')) continue
    return row
  }
  return null
}

/**
 * densable `vdt` isHeldByDialog `hm` + userInvoked.
 * `vEo(session)` is ORed in `queuedNowReadEvidence`.
 */
export function isQueuedNowHeldByDialog(
  open: Array<{ userInvoked?: boolean; kind?: string }>,
): boolean {
  if (queuedNowEngineDialog(open) !== null) return true
  return open.some(row => row.userInvoked === true)
}

export type SendQueuedNowOpts = {
  isTurnRunning?: () => boolean
  isDispatchingForModel?: () => boolean
  isTurnActive?: () => boolean
  subscribeTurnGuard?: (onChange: () => void) => () => void
  interruptForSubmit?: () => boolean | undefined
  abortSignal?: AbortController | null
  readEvidence?: () => QueuedNowTurnEvidence
  streamMode?: string
  /** densable turn.endsUnmovableShells — REPL vdt host is true. */
  endsUnmovableShells?: boolean
  /** densable U_e `turn.agentId` — named_agent send-now. */
  agentId?: string
  /** densable U_e `messageQueue.getCommandQueueSnapshot` — bdt pending. */
  getCommandQueueSnapshot?: () => ReadonlyArray<{
    uuid?: string
    agentId?: string
    mode?: string
    isMeta?: boolean
    origin?: { kind?: string }
    skipAttachments?: boolean
  }>
  /** densable REPL `wa` Xj instance. Gold `sendQueuedNow(v)` is uuid-only. */
  lowLatency?: {
    sendQueuedNow(uuid: string | undefined): boolean
  }
  taskRegistry?: import('./taskRegistry.js').TaskRegistry
  getAbortController?: () => AbortController | null | undefined
  /** densable cAt `messageQueue.subscribe`. U_e stub is a no-op. */
  subscribeQueue?: (onChange: () => void) => () => void
  /** densable `clock.setTimeout` — returns cancel. Overlayed by Xj. */
  clock?: { setTimeout: (fn: () => void, ms: number) => () => void }
  /** densable `transcript.getSnapshot` — message array. */
  getTranscriptMessages?: () => unknown[]
  /** densable Xj overlay `session:this.#e.session`. */
  session?: object
  /** densable Xj overlay `featureName:"input_low_latency_submit"`. */
  featureName?: string
}

export type QueuedNowSpinnerSlice = {
  mode: string
  isCompacting: boolean
}

/** densable `Xj` constructor host (`turn,store,session,spinnerStore,dialogStore`). */
export type QueuedNowLowLatencyHost = {
  turn: {
    guard: {
      readonly isRunning: boolean
      readonly isDispatchingForModel?: boolean
      readonly isActive: boolean
      subscribe: (onChange: () => void) => () => void
    }
    readonly abortController?: AbortController | null
    interruptForSubmit?: () => boolean | undefined
    stream: {
      readonly isMainResponseStreaming: boolean
      readonly isMainRequestAwaitingResponse?: boolean
    }
  }
  store: {
    getState: () => {
      transcripts?: Record<string, { inProgressToolUseIDs?: Set<string> }>
      tasks?: Record<string, unknown>
    }
  }
  session: object
  /** densable `N` — Ihr instance `Wr` (`leftoverIhr.get` / `.main`). */
  spinnerStore: { get: (sessionId?: string) => QueuedNowSpinnerSlice }
  dialogStore: {
    getState: () => {
      open: Array<{ userInvoked?: boolean; kind?: string }>
    }
  }
  messageQueue?: QueuedNowMessageQueue
  transcript?: { getSnapshot?: () => unknown }
  /** densable Xj `clock` — Ink `useClock` / `Clock.setTimeout` → cancel. */
  clock: { setTimeout: (fn: () => void, ms: number) => () => void }
  taskRegistry: import('./taskRegistry.js').TaskRegistry
  getAppState: () => import('../state/AppState.js').AppState
  setAppState: import('../Task.js').SetAppState
}

export type QueuedNowQueueRow = {
  uuid?: string
  agentId?: string
  mode?: string
  isMeta?: boolean
  origin?: { kind?: string }
  skipAttachments?: boolean
  priority?: string
  drainOnly?: boolean
  promptSubmitted?: unknown
  screeningPending?: boolean
}

/** densable cAt `messageQueue` bag (REPL `bn=Zu()` / U_e stub). */
export type QueuedNowMessageQueue = {
  getCommandQueueSnapshot: () => ReadonlyArray<QueuedNowQueueRow>
  getCommandQueue: () => ReadonlyArray<QueuedNowQueueRow>
  subscribe: (onChange: () => void) => () => void
  isFoldInFlight: (uuid: string) => boolean
  isMidTurnFoldSuspended: () => boolean
  promoteToNow: (uuid: string) => boolean
  demoteFromNow: (uuid: string, from: QueuePriority) => void
}

/** densable cAt constructor bag `#t`. */
export type QueuedNowCAtBag = {
  turn: {
    agentId?: string
    guard: {
      readonly isActive: boolean
      readonly isRunning: boolean
      readonly isDispatchingForModel?: boolean
      subscribe: (onChange: () => void) => () => void
    }
    readonly abortController: AbortController | null
    readEvidence: () => QueuedNowTurnEvidence
    interruptForSubmit?: () => boolean | undefined
    endsUnmovableShells: boolean
  }
  messageQueue: QueuedNowMessageQueue
  transcript: { getSnapshot: () => unknown[] }
  session: object
  taskRegistry: import('./taskRegistry.js').TaskRegistry
  clock: { setTimeout: (fn: () => void, ms: number) => () => void }
  featureName: string
}

/**
 * densable `vdt({turn,store,session,spinnerStore,dialogStore})`.
 * densable `N.get()` is `Ihr.get` (`leftoverIhrPeek`).
 * `Ve()` leftover = `getMainThreadAgentId`.
 */
export function readQueuedNowTurnEvidence(
  host: Pick<
    QueuedNowLowLatencyHost,
    'turn' | 'store' | 'session' | 'spinnerStore' | 'dialogStore'
  >,
): QueuedNowTurnEvidence {
  const spinner = host.spinnerStore.get()
  const dialogState = host.dialogStore.getState()
  const { getMainThreadAgentId } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  const inProgress =
    host.store.getState().transcripts?.[getMainThreadAgentId()]
      ?.inProgressToolUseIDs
  const { isUserPromptWaiting } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./sessionHost.js') as typeof import('./sessionHost.js')
  return {
    isHeldByDialog:
      isUserPromptWaiting(host.session) ||
      queuedNowEngineDialog(dialogState.open) !== null ||
      dialogState.open.some(row => row.userInvoked === true),
    isToolCallStarting:
      (inProgress?.size ?? 0) > 0 || spinner.mode === 'tool-input',
    isCompacting: spinner.isCompacting,
    isMainRequestAnnounced:
      host.turn.stream.isMainRequestAwaitingResponse === true ||
      host.turn.stream.isMainResponseStreaming,
  }
}

/**
 * leftover extra bag for tests. Production main-turn evidence is
 * `readQueuedNowTurnEvidence(host)` (gold `vdt`).
 */
export function queuedNowReadEvidence(
  extra?: Partial<QueuedNowTurnEvidence> & {
    inProgressToolUseCount?: number
    dialogOpen?: Array<{ userInvoked?: boolean; kind?: string }>
    /** densable `vdt` `session` / `vEo(M)`. */
    session?: object
    /** leftover analog of `vEo` when session is not passed. */
    waitingFor?: string
    /** densable `vdt` `h.stream.isMainResponseStreaming`. */
    isMainResponseStreaming?: boolean
    /**
     * densable `vdt` `store.getState()` — `transcripts[Ve()]`.
     * REPL can pass `store.getState` later without editing REPL here.
     */
    getAppState?: () => {
      transcripts?: Record<string, { inProgressToolUseIDs?: Set<string> }>
    }
    /** leftover analog of `transcripts[Ve()].inProgressToolUseIDs`. */
    transcriptsInProgress?: Set<string>
  },
): QueuedNowTurnEvidence {
  let spinnerMode: string | undefined
  let spinnerCompacting = false
  try {
    const { leftoverIhrPeek } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./collapseReadSearch.js') as typeof import('./collapseReadSearch.js')
    const slice = leftoverIhrPeek()
    spinnerMode = slice.mode
    spinnerCompacting = slice.isCompacting
  } catch {
    // leftoverIhrPeek reads freeze `y` when Ve() is unset in tests.
  }

  let inProgressSize = extra?.inProgressToolUseCount
  if (inProgressSize === undefined) {
    const fromExtra = extra?.transcriptsInProgress
    if (fromExtra !== undefined) {
      inProgressSize = fromExtra.size
    } else if (extra?.getAppState) {
      const { getMainThreadAgentId } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      inProgressSize =
        extra.getAppState().transcripts?.[getMainThreadAgentId()]
          ?.inProgressToolUseIDs?.size ?? 0
    } else {
      inProgressSize = 0
    }
  }

  let isHeldByDialog = extra?.isHeldByDialog
  if (isHeldByDialog === undefined) {
    let waiting = extra?.waitingFor !== undefined
    if (!waiting && extra?.session) {
      try {
        const { isUserPromptWaiting } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('./sessionHost.js') as typeof import('./sessionHost.js')
        waiting = isUserPromptWaiting(extra.session)
      } catch {
        /* host unset in some tests */
      }
    }
    isHeldByDialog =
      waiting ||
      (extra?.dialogOpen !== undefined
        ? isQueuedNowHeldByDialog(extra.dialogOpen)
        : false)
  }

  return {
    isHeldByDialog,
    isToolCallStarting:
      extra?.isToolCallStarting ??
      (inProgressSize > 0 || spinnerMode === 'tool-input'),
    isCompacting: extra?.isCompacting ?? spinnerCompacting,
    isMainRequestAnnounced:
      extra?.isMainRequestAnnounced ??
      (extra?.isMainResponseStreaming === true || spinnerMode === 'requesting'),
  }
}

/** densable `Io(turn.agentId)`. */
function queuedNowTurnAgentId(agentId: string | undefined): string {
  if (agentId !== undefined) return agentId
  const { getMainThreadAgentId } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  return getMainThreadAgentId()
}

function moduleMessageQueue(): QueuedNowMessageQueue {
  const mq =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./messageQueueManager.js') as typeof import('./messageQueueManager.js')
  return {
    getCommandQueueSnapshot: mq.getCommandQueueSnapshot,
    getCommandQueue: mq.getCommandQueue,
    subscribe: mq.subscribeToCommandQueue,
    isFoldInFlight: mq.isFoldInFlight,
    isMidTurnFoldSuspended: mq.isMidTurnFoldSuspended,
    promoteToNow: mq.promoteToNow,
    demoteFromNow: mq.demoteFromNow,
  }
}

/** densable `H_e` — U_e subscribe no-op. */
const queuedNowNoopUnsubscribe = (): (() => void) => () => {}

/** densable `XVe(e,n,{backgroundedToDeliverMessage:!0})`. */
function xve(
  id: string,
  registry: import('./taskRegistry.js').TaskRegistry,
): boolean {
  const { backgroundTask } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../tasks/LocalShellTask/LocalShellTask.js') as typeof import('../tasks/LocalShellTask/LocalShellTask.js')
  return backgroundTask(id, registry, { backgroundedToDeliverMessage: true })
}

/**
 * densable `cAt` — `sendQueuedNow` returns whether it armed. `#A` Hs then
 * tNr / `#k` promoteToNow / `#w` interruptForSubmit. `#_` first-uuid
 * reschedule; `#C` turn.guard.subscribe.
 */
export class QueuedNowCoordinator {
  /** densable cAt `#t` — turn/messageQueue/transcript/session/taskRegistry/clock. */
  #t: QueuedNowCAtBag
  /** densable cAt `#n` — clock.setTimeout cancel; null when idle. */
  #n: (() => void) | null = null
  #f: Array<() => void> = []
  #disposed = false
  #m = false
  #p = ''
  #d = false
  #o = 0
  #a = false
  #r = new Set<string>()
  #g = 0
  #l = 0
  #e = new Map<string, QueuedNowTracked>()

  constructor(deps: QueuedNowCAtBag) {
    this.#t = deps
  }

  sendQueuedNow = (): boolean => {
    let armed = false
    this.#u(() => {
      if (this.#disposed) return
      const { messageQueue, turn } = this.#t
      if (!turn.guard.isRunning && !turn.guard.isDispatchingForModel) {
        this.#s()
        return
      }
      const snapshot = [...messageQueue.getCommandQueueSnapshot()]
      const mainId = queuedNowTurnAgentId(turn.agentId)
      for (const cmd of snapshot) {
        if (
          cmd.uuid !== undefined &&
          cmd.agentId === mainId &&
          cmd.mode === 'prompt' &&
          isQueuedNowPrompt(cmd) &&
          !this.#e.has(cmd.uuid)
        ) {
          this.#e.set(cmd.uuid, { outcome: 'undecided', raisedFrom: null })
        }
      }
      if (this.#e.size === 0) return
      const head = queuedNowHead(
        [...messageQueue.getCommandQueue()],
        this.#e,
        mainId,
        messageQueue,
      )?.head
      if (head === 'behind_earlier' || head === 'ended_by_hook') {
        this.#s()
        return
      }
      armed = true
      this.#d = false
      this.#a = false
      if (this.#f.length === 0) {
        this.#f = [
          messageQueue.subscribe(this.#_),
          turn.guard.subscribe(this.#C),
        ]
      }
      if (this.#n === null) this.#h(0)
    })
    return armed
  }

  dispose(): void {
    this.#disposed = true
    this.#u(() => this.#s())
  }

  /** densable `#h(e){this.#n?.();this.#n=this.#t.clock.setTimeout(this.#v,e)}`. */
  #h(ms: number): void {
    this.#n?.()
    this.#n = this.#t.clock.setTimeout(this.#v, ms)
  }

  /** densable `#v=()=>{this.#n=null,this.#u(()=>{this.#A()})}`. */
  #v = (): void => {
    this.#n = null
    this.#u(() => {
      this.#A()
    })
  }

  #i(): void {
    this.#n?.()
    this.#n = null
    this.#o = 0
    this.#r.clear()
    this.#g = 0
    this.#l = 0
  }

  #s(): void {
    this.#i()
    for (const unsub of this.#f.splice(0)) unsub()
    this.#S()
    this.#e.clear()
    this.#m = false
    this.#p = ''
    this.#d = false
    this.#a = false
  }

  #c(): void {
    if (this.#e.size > 0) this.#h(QUEUED_NOW_TICK_MS)
  }

  #S(): void {
    for (const [uuid, row] of this.#e) {
      if (row.raisedFrom !== null) {
        const from = row.raisedFrom
        row.raisedFrom = null
        this.#t.messageQueue.demoteFromNow(uuid, from)
      }
    }
  }

  #b(): void {
    const live = new Set(
      this.#t.messageQueue.getCommandQueueSnapshot().map(row => row.uuid),
    )
    for (const [uuid, row] of this.#e) {
      if (live.has(uuid)) continue
      this.#e.delete(uuid)
      if (this.#t.messageQueue.isFoldInFlight(uuid)) this.#a = true
      if (row.outcome !== 'undecided' && row.outcome !== 'delivered_early') {
        leftoverP(this.#t.featureName, row.outcome)
      }
    }
  }

  #_ = (): void => {
    this.#u(() => {
      const [first] = this.#e.keys()
      this.#b()
      if (this.#e.size === 0) {
        this.#s()
        return
      }
      if (this.#a) {
        this.#i()
        return
      }
      const [next] = this.#e.keys()
      if (next !== first && (this.#n !== null || this.#t.turn.guard.isActive)) {
        this.#h(0)
      }
    })
  }

  #C = (): void => {
    this.#u(() => {
      const { guard } = this.#t.turn
      if (!guard.isActive) {
        this.#d = true
        this.#i()
        return
      }
      if (this.#d) this.#s()
    })
  }

  #u(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      logError(error)
      if (!this.#m) {
        this.#m = true
        leftoverM(this.#t.featureName, 'check_threw')
      }
    }
  }

  /** densable `#A` — Hs then tNr / `#k` / `#w`. */
  #A(): void {
    if (this.#disposed) return
    const { messageQueue, turn, transcript, session, taskRegistry } = this.#t
    this.#b()
    if (this.#e.size === 0) {
      this.#s()
      return
    }
    const mainId = queuedNowTurnAgentId(turn.agentId)
    const found = queuedNowHead(
      [...messageQueue.getCommandQueue()],
      this.#e,
      mainId,
      messageQueue,
    )
    const tracked = found === null ? undefined : this.#e.get(found.uuid)
    const tasks = Object.entries(taskRegistry.all()).flatMap(([id, task]) =>
      task === undefined ? [] : [{ ...task, id }],
    )
    const fromTranscript = transcript.getSnapshot()
    const messages = (
      Array.isArray(fromTranscript) ? fromTranscript : []
    ) as Array<{
      type?: string
      isMeta?: boolean
      isApiErrorMessage?: boolean
      message?: { content?: unknown; stop_reason?: unknown }
    }>
    const outstanding = outstandingToolUses(messages)
    const holders = holderBackgroundTasks(tasks, outstanding, turn.agentId)
    const agents = holderLocalAgentTasks(tasks, outstanding, turn.agentId)
    const foreground = (TTe.peek(session)?.list() ?? []).filter(
      call => call.toolUseId !== undefined && outstanding.has(call.toolUseId),
    )
    const { areBackgroundTasksDisabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./sessionBackgroundGates.js') as typeof import('./sessionBackgroundGates.js')
    const backgroundingDisabled = areBackgroundTasksDisabled()
    const movableAgents = backgroundingDisabled
      ? []
      : agents.filter(task => {
          const name =
            task.toolUseId === undefined
              ? undefined
              : outstanding.get(task.toolUseId)
          return name !== undefined && MOVABLE_AGENT_TOOL_NAMES.has(name)
        })
    const bashHolders = backgroundingDisabled ? [] : holders
    const raised =
      turn.guard.isActive &&
      [...this.#e.values()].some(row => row.raisedFrom !== null)
    if (raised && !backgroundingDisabled) {
      this.#tNr(holders)
      this.#l = outstanding.size > 0 ? this.#l + 1 : 0
      if (turn.endsUnmovableShells && this.#l > UNMOVABLE_GRACE) {
        const { killTask } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../tasks/LocalShellTask/killShellTasks.js') as typeof import('../tasks/LocalShellTask/killShellTasks.js')
        for (const shell of unmovableDescendantShells(
          tasks,
          outstanding,
          holders,
          turn.agentId,
        )) {
          if (shell.id !== undefined) {
            killTask(shell.id, taskRegistry)
          }
        }
      }
    }
    if (found === null || tracked === undefined) {
      if (raised) this.#c()
      else this.#i()
      return
    }
    const abort = turn.abortController
    for (const id of this.#r) {
      if (!outstanding.has(id)) this.#r.delete(id)
    }
    const turnEvidence = turn.readEvidence()
    const evidence: QueuedNowEvidence = {
      head: found.head,
      hasFoldTakenPrompt: this.#a,
      isLocalTurnActive: turn.guard.isActive,
      isLocalTurnRunning:
        turn.guard.isRunning && abort !== null && !abort.signal.aborted,
      isHeldByDialog: turnEvidence.isHeldByDialog,
      holderCount: holders.length + agents.length + foreground.length,
      unmovableHolderCount:
        (backgroundingDisabled ? holders.length : 0) +
        (agents.length - movableAgents.length),
      isExecuting: turnEvidence.isToolCallStarting || outstanding.size > 0,
      isAwaitingMovedResult: this.#r.size > 0,
      isCompacting: turnEvidence.isCompacting,
      isUnmovableGraceOver: this.#o >= UNMOVABLE_GRACE,
      isBackgroundingDisabled: backgroundingDisabled,
      isMainRequestInFlight: this.#isMainRequestInFlight(
        turnEvidence.isMainRequestAnnounced,
        messages,
      ),
    }
    const decision = queuedNowAction(evidence)
    const line = `${decision.action}${decision.action === 'wait' ? ` ${decision.reason}` : ''} head=${found.head} holders=${evidence.holderCount} executing=${evidence.isExecuting}`
    if (line !== this.#p) {
      this.#p = line
      logForDebugging(
        `[low-latency-submit] ${line} agent=${turn.agentId ?? 'main'}`,
      )
    }
    switch (decision.action) {
      case 'stand_by':
        this.#i()
        return
      case 'wait':
        this.#o = decision.reason === 'unmovable_grace' ? this.#o + 1 : 0
        if (
          decision.reason === 'moved_result' &&
          ++this.#g >= MOVED_RESULT_GRACE
        ) {
          this.#r.clear()
        }
        if (
          decision.reason !== 'not_ready' &&
          tracked.outcome === 'undecided'
        ) {
          tracked.outcome = decision.reason ?? 'wait'
        }
        this.#c()
        return
      case 'background': {
        const previous = tracked.outcome
        tracked.outcome = 'delivered_early'
        const moved: Array<string | undefined> = this.#tNr(bashHolders)
        for (const agent of movableAgents) {
          if (this.#backgroundAgent(agent.id)) {
            moved.push(agent.toolUseId)
          }
        }
        let movedCount = moved.length
        // densable cAt (@205862580): detachable foreground calls (`w`) step aside
        // even when CLAUDE_CODE_DISABLE_BACKGROUND_TASKS (`M`) is set.
        let foregroundMoved = 0
        for (const call of foreground) {
          try {
            if (call.backgroundNow()) {
              foregroundMoved += 1
            }
          } catch (error) {
            logForDebugging(
              `[foreground-tool-calls] moving ${call.toolUseId ?? 'a call'} threw; it stays in the foreground`,
              { level: 'error' },
            )
            logError(error)
          }
        }
        movedCount += foregroundMoved
        if (foregroundMoved > 0) {
          moved.push(...foreground.map(call => call.toolUseId))
        }
        if (this.#e.size > 0) {
          this.#g = 0
          for (const id of moved) {
            if (id !== undefined) this.#r.add(id)
          }
        }
        if (movedCount === 0) {
          tracked.outcome =
            previous === 'undecided' ? 'nothing_moved' : previous
          if (evidence.isUnmovableGraceOver) {
            if (backgroundingDisabled) this.#w(tracked)
            else this.#k(tracked, found.uuid, found.priority)
            return
          }
          if (this.#e.size > 0) this.#o++
        } else {
          this.#o = 0
          if (previous !== 'delivered_early') {
            leftoverY(this.#t.featureName)
          }
        }
        this.#c()
        return
      }
      case 'interrupt':
        this.#k(tracked, found.uuid, found.priority)
        return
      case 'cancel':
        this.#w(tracked)
    }
  }

  /** densable isMainRequestInFlight: announced && !stopped && VKo(api_call) && afe()>0 */
  #isMainRequestInFlight(
    announced: boolean,
    messages: Array<{
      type?: string
      isApiErrorMessage?: boolean
      message?: { stop_reason?: unknown }
    }>,
  ): boolean {
    if (!announced) return false
    const last = messages.at(-1)
    if (
      last?.type === 'assistant' &&
      (last.message?.stop_reason != null || last.isApiErrorMessage === true)
    ) {
      return false
    }
    const { isSessionActivityReasonActive, getMainLoopRefcount } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./sessionActivity.js') as typeof import('./sessionActivity.js')
    return (
      isSessionActivityReasonActive('api_call') && getMainLoopRefcount() > 0
    )
  }

  /** densable `tNr(e,n).map(Po)` — XVe via taskRegistry. */
  #tNr(holders: Array<{ id?: string; toolUseId?: string }>): string[] {
    const registry = this.#t.taskRegistry
    return holders.flatMap(holder => {
      if (holder.id === undefined) return []
      if (!xve(holder.id, registry)) {
        return []
      }
      return holder.toolUseId === undefined
        ? []
        : [stripPreambleToolUseId(holder.toolUseId)]
    })
  }

  /** densable `T$e(e,n)`. */
  #backgroundAgent(taskId: string | undefined): boolean {
    if (taskId === undefined) return false
    const { backgroundAgentTask } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../tasks/LocalAgentTask/LocalAgentTask.js') as typeof import('../tasks/LocalAgentTask/LocalAgentTask.js')
    const registry = this.#t.taskRegistry
    return backgroundAgentTask(taskId, registry)
  }

  #w(row: QueuedNowTracked): void {
    const interrupt = this.#t.turn.interruptForSubmit
    if (interrupt === undefined) {
      if (row.outcome === 'undecided') row.outcome = 'nothing_moved'
    } else {
      if (row.outcome !== 'delivered_early') {
        row.outcome = 'fell_back_to_cancel'
      }
      interrupt()
    }
    this.#i()
  }

  #k(row: QueuedNowTracked, uuid: string, priority: string): void {
    this.#o = 0
    this.#l = 0
    const raisedFrom: QueuePriority = priority === 'later' ? 'later' : 'next'
    row.raisedFrom = raisedFrom
    if (!this.#t.messageQueue.promoteToNow(uuid)) row.raisedFrom = null
    else if (row.outcome !== 'delivered_early') {
      row.outcome = 'delivered_early'
      leftoverY(this.#t.featureName)
    }
    this.#c()
  }
}

/**
 * Test-only Xj. Gold has no process-global Xj; REPL owns the
 * useMemo instance passed as `opts.lowLatency`.
 */
class ProcessLowLatencySessionState {
  processLowLatency: QueuedNowLowLatency | undefined = undefined
  processLowLatencyOpts: SendQueuedNowOpts | undefined = undefined
  processLowLatencyState:
    | {
        getAppState: () => import('../state/AppState.js').AppState
        setAppState: import('../Task.js').SetAppState
      }
    | undefined = undefined
}

const fallbackProcessLowLatencySession = { root: {} as object }
const processLowLatencyBySession =
  new RootSessionSlot<ProcessLowLatencySessionState>(
    () => new ProcessLowLatencySessionState(),
  )

function getProcessLowLatencySessionState(): ProcessLowLatencySessionState {
  try {
    const session = getBootstrapSession()
    if (session?.root) return processLowLatencyBySession.of(session)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return processLowLatencyBySession.of(fallbackProcessLowLatencySession)
}

function isLocalAgentTaskRow(task: unknown): task is {
  type: 'local_agent'
  status: string
  abortController?: AbortController
  agentId?: string
  pendingMessages?: Array<{
    text: string
    origin?: { kind?: string }
    shownAs?: string
  }>
} {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    (task as { type?: unknown }).type === 'local_agent'
  )
}

/** densable `bdt` — pending human messages with shownAs. */
function pendingMessagesAsQueuedNow(task: {
  agentId?: string
  pendingMessages?: Array<{
    text: string
    origin?: { kind?: string }
    shownAs?: string
  }>
}): Array<{
  value: string
  mode: 'prompt'
  uuid: string
  agentId?: string
  origin?: { kind?: string }
}> {
  const out: Array<{
    value: string
    mode: 'prompt'
    uuid: string
    agentId?: string
    origin?: { kind?: string }
  }> = []
  for (const row of task.pendingMessages ?? []) {
    if (row.origin?.kind === 'human' && row.shownAs !== undefined) {
      out.push({
        value: row.text,
        mode: 'prompt',
        uuid: row.shownAs,
        agentId: task.agentId,
        origin: row.origin,
      })
    }
  }
  return out
}

/** densable `U_e(h,v)` — named_agent turn from taskRegistry. */
function queuedNowOptsForAgent(
  taskId: string,
  registry: import('./taskRegistry.js').TaskRegistry,
): Pick<QueuedNowCAtBag, 'turn' | 'messageQueue' | 'transcript'> {
  const lookup = () => {
    const task = registry.get(taskId)
    return isLocalAgentTaskRow(task) ? task : undefined
  }
  const running = () => lookup()?.status === 'running'
  const pending = () => pendingMessagesAsQueuedNow(lookup() ?? {})
  return {
    turn: {
      agentId: taskId,
      guard: {
        get isActive() {
          return running()
        },
        get isRunning() {
          return running()
        },
        subscribe: queuedNowNoopUnsubscribe,
      },
      get abortController() {
        return lookup()?.abortController ?? null
      },
      readEvidence: () => ({
        isHeldByDialog: false,
        isToolCallStarting:
          (registry.getTranscript(taskId)?.inProgressToolUseIDs.size ?? 0) > 0,
        isCompacting: false,
        isMainRequestAnnounced: false,
      }),
      interruptForSubmit: undefined,
      endsUnmovableShells: false,
    },
    messageQueue: {
      getCommandQueueSnapshot: pending,
      getCommandQueue: pending,
      subscribe: queuedNowNoopUnsubscribe,
      isFoldInFlight: () => false,
      isMidTurnFoldSuspended: () => false,
      promoteToNow: () => false,
      demoteFromNow: () => false,
    },
    transcript: {
      getSnapshot: () =>
        queuedNowTranscriptWithoutPending(
          registry.getTranscript(taskId)?.messages ?? [],
          pending(),
        ),
    },
  }
}

function queuedNowOptsForMainTurn(
  host: QueuedNowLowLatencyHost,
): Pick<QueuedNowCAtBag, 'turn' | 'messageQueue' | 'transcript'> {
  const { turn } = host
  const mq = host.messageQueue ?? moduleMessageQueue()
  return {
    turn: {
      agentId: undefined,
      guard: turn.guard,
      get abortController() {
        return turn.abortController ?? null
      },
      readEvidence: () => readQueuedNowTurnEvidence(host),
      interruptForSubmit: () => turn.interruptForSubmit?.(),
      endsUnmovableShells: true,
    },
    messageQueue: mq,
    transcript: {
      getSnapshot: () => {
        const snap = host.transcript?.getSnapshot?.()
        return Array.isArray(snap) ? snap : []
      },
    },
  }
}

function queuedNowTurnOpts(
  host: QueuedNowLowLatencyHost,
  uuid: string | undefined,
): Pick<QueuedNowCAtBag, 'turn' | 'messageQueue' | 'transcript'> {
  // densable `#r(h)` — named_agent `U_e`; main turn `vdt(this.#e)`.
  if (uuid !== undefined) return queuedNowOptsForAgent(uuid, host.taskRegistry)
  return queuedNowOptsForMainTurn(host)
}

function leftoverIhrSpinnerSlice(): QueuedNowSpinnerSlice {
  try {
    const { leftoverIhrPeek } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./collapseReadSearch.js') as typeof import('./collapseReadSearch.js')
    const slice = leftoverIhrPeek()
    return { mode: slice.mode, isCompacting: slice.isCompacting }
  } catch {
    return { mode: 'responding', isCompacting: false }
  }
}

function testQueuedNowHost(
  slot: ProcessLowLatencySessionState,
): QueuedNowLowLatencyHost {
  const getAppState = () => slot.processLowLatencyState!.getAppState()
  const setAppState: import('../Task.js').SetAppState = updater =>
    slot.processLowLatencyState!.setAppState(updater)
  return {
    turn: {
      guard: {
        get isRunning() {
          return slot.processLowLatencyOpts?.isTurnRunning?.() ?? false
        },
        get isDispatchingForModel() {
          return slot.processLowLatencyOpts?.isDispatchingForModel?.() ?? false
        },
        get isActive() {
          return (
            slot.processLowLatencyOpts?.isTurnActive?.() ??
            slot.processLowLatencyOpts?.isTurnRunning?.() ??
            false
          )
        },
        subscribe: onChange =>
          slot.processLowLatencyOpts?.subscribeTurnGuard?.(onChange) ??
          (() => {}),
      },
      get abortController() {
        return (
          slot.processLowLatencyOpts?.getAbortController?.() ??
          slot.processLowLatencyOpts?.abortSignal ??
          null
        )
      },
      get interruptForSubmit() {
        return slot.processLowLatencyOpts?.interruptForSubmit
      },
      stream: {
        get isMainResponseStreaming() {
          return slot.processLowLatencyOpts?.isTurnRunning?.() ?? false
        },
      },
    },
    store: {
      getState: () => getAppState(),
    },
    session: {},
    spinnerStore: { get: leftoverIhrSpinnerSlice },
    dialogStore: { getState: () => ({ open: [] }) },
    clock: { setTimeout: clockSetTimeout },
    get messageQueue() {
      const mq = moduleMessageQueue()
      const snap = slot.processLowLatencyOpts?.getCommandQueueSnapshot
      const subscribe = slot.processLowLatencyOpts?.subscribeQueue
      return {
        ...mq,
        ...(snap
          ? { getCommandQueueSnapshot: snap, getCommandQueue: snap }
          : {}),
        ...(subscribe ? { subscribe } : {}),
      }
    },
    get taskRegistry() {
      return (
        slot.processLowLatencyOpts?.taskRegistry ??
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (
          require('./taskRegistry.js') as typeof import('./taskRegistry.js')
        ).createTaskRegistry(getAppState, setAppState)
      )
    },
    getAppState,
    setAppState,
  }
}

function rememberProcessLowLatency(
  getAppState: () => import('../state/AppState.js').AppState,
  setAppState: import('../Task.js').SetAppState,
  opts?: SendQueuedNowOpts,
): QueuedNowLowLatency {
  const slot = getProcessLowLatencySessionState()
  slot.processLowLatencyOpts = opts
  slot.processLowLatencyState = { getAppState, setAppState }
  slot.processLowLatency ??= new QueuedNowLowLatency(testQueuedNowHost(slot))
  return slot.processLowLatency
}

/**
 * densable `Xj` — per-uuid cAt map. `sendQueuedNow(h)` is uuid-only.
 */
export class QueuedNowLowLatency {
  #e: QueuedNowLowLatencyHost
  #t = new Map<string | undefined, QueuedNowCoordinator>()
  #o = false

  constructor(host: QueuedNowLowLatencyHost) {
    this.#e = host
  }

  sendQueuedNow = (uuid: string | undefined): boolean => {
    if (this.#o) return false
    for (const [id, coord] of this.#t) {
      if (id !== undefined && this.#e.taskRegistry.get(id) === undefined) {
        coord.dispose()
        this.#t.delete(id)
      }
    }
    let coord = this.#t.get(uuid)
    if (coord === undefined) {
      coord = new QueuedNowCoordinator({
        ...this.#r(uuid),
        session: this.#e.session,
        taskRegistry: this.#e.taskRegistry,
        clock: this.#e.clock,
        featureName: 'input_low_latency_submit',
      })
      this.#t.set(uuid, coord)
    }
    return coord.sendQueuedNow()
  }

  #r(
    uuid: string | undefined,
  ): Pick<QueuedNowCAtBag, 'turn' | 'messageQueue' | 'transcript'> {
    return queuedNowTurnOpts(this.#e, uuid)
  }

  dispose(): void {
    this.#o = true
    for (const coord of this.#t.values()) coord.dispose()
    this.#t.clear()
  }
}

/**
 * densable `cAt.sendQueuedNow` — main-turn (uuid undefined) via test Xj.
 * Production REPL constructs `new QueuedNowLowLatency(host)`.
 */
export function sendQueuedNow(
  getAppState: () => import('../state/AppState.js').AppState,
  setAppState: import('../Task.js').SetAppState,
  opts?: SendQueuedNowOpts,
): boolean {
  return rememberProcessLowLatency(
    getAppState,
    setAppState,
    opts,
  ).sendQueuedNow(undefined)
}

/**
 * Test-helper Xj. `hostSendQueuedNow` with `opts.lowLatency` must use
 * that instance, not this singleton. Gold arity is uuid-only.
 */
export const queuedNowLowLatency = {
  sendQueuedNow(uuid: string | undefined): boolean {
    return (
      getProcessLowLatencySessionState().processLowLatency?.sendQueuedNow(
        uuid,
      ) ?? false
    )
  },
}

/** densable `Cln` — `k("tengu_velvet_panda", !0)`. */
export function isVelvetPandaEnabled(): boolean {
  const { getFeatureValue_CACHED_MAY_BE_STALE } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
  return (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_velvet_panda', true) === true
  )
}

/**
 * Test helper wrapping gold SessionHost `sendQueuedNow(h,v)`:
 * `v===undefined` → `$Ze`; else `h==="prompt" && Cln() && lowLatency.sendQueuedNow(v)`.
 * Production REPL calls those two arities on the live Xj instance; uuid is
 * named_agent task id or undefined — not a command-queue sentinel.
 */
export function hostSendQueuedNow(
  mode: string,
  uuid: string | undefined,
  getAppState: () => import('../state/AppState.js').AppState,
  setAppState: import('../Task.js').SetAppState,
  opts?: SendQueuedNowOpts,
): boolean {
  if (uuid === undefined) {
    return trySendQueuedNowKey(getAppState, setAppState, {
      ...opts,
      mode,
    })
  }
  if (mode !== 'prompt' || !isVelvetPandaEnabled()) return false
  const host = opts?.lowLatency ?? queuedNowLowLatency
  if (host !== queuedNowLowLatency) return host.sendQueuedNow(uuid)
  return rememberProcessLowLatency(
    getAppState,
    setAppState,
    opts,
  ).sendQueuedNow(uuid)
}

export function resetQueuedNowCoordinatorForTests(): void {
  const slot = getProcessLowLatencySessionState()
  slot.processLowLatency?.dispose()
  slot.processLowLatency = undefined
  slot.processLowLatencyOpts = undefined
  slot.processLowLatencyState = undefined
}

/**
 * densable `W3n` — main-thread queue has a `tp && uf` prompt.
 */
export function hasMainThreadQueuedNowPrompt(): boolean {
  const { getCommandQueue } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./messageQueueManager.js') as typeof import('./messageQueueManager.js')
  const { getMainThreadAgentId } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  const mainId = getMainThreadAgentId()
  return getCommandQueue().some(
    cmd => cmd.agentId === mainId && isQueuedNowPrompt(cmd),
  )
}

/**
 * densable `$Ze` — empty send-now key. Velvet panda + VZe + cAt, else
 * interrupt fallback (`fell_back_to_cancel`).
 */
export function trySendQueuedNowKey(
  getAppState: () => import('../state/AppState.js').AppState,
  setAppState: import('../Task.js').SetAppState,
  opts: SendQueuedNowOpts & { mode?: string },
): boolean {
  const velvet = isVelvetPandaEnabled()
  const mode = opts.mode ?? 'prompt'
  const eligible =
    mode === 'prompt' &&
    ((opts.isTurnActive ?? opts.isTurnRunning)?.() === true ||
      opts.isDispatchingForModel?.() === true) &&
    hasMainThreadQueuedNowPrompt()
  const armed = opts.lowLatency
    ? opts.lowLatency.sendQueuedNow(undefined)
    : sendQueuedNow(getAppState, setAppState, opts)
  if (velvet && eligible && armed) {
    leftoverY('input_send_now_key')
    return true
  }
  if (!eligible) return false
  const interrupted = opts.interruptForSubmit?.()
  if (interrupted === false) {
    leftoverP('input_send_now_key', 'no_live_controller')
    return false
  }
  const { logEvent } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/analytics/index.js') as typeof import('../services/analytics/index.js')
  logEvent('tengu_cancel', {
    source:
      'queued_send_now' as import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(opts.streamMode !== undefined && {
      streamMode:
        opts.streamMode as import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })
  if (velvet) leftoverP('input_send_now_key', 'fell_back_to_cancel')
  else leftoverY('input_send_now_key')
  return true
}

/**
 * densable `_abortOnNowPriorityCommand` — queue subscribe aborts the live
 * turn when any row is priority now (`#k` promoteToNow).
 */
export function abortOnNowPriorityCommand(
  abort: AbortController | null | undefined,
): void {
  if (!abort || abort.signal.aborted) return
  const { getCommandQueueSnapshot } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./messageQueueManager.js') as typeof import('./messageQueueManager.js')
  if (getCommandQueueSnapshot().some(cmd => cmd.priority === 'now')) {
    abort.abort('interrupt')
  }
}

export function backgroundForegroundBashToDeliverMessage(
  getAppState: () => import('../state/AppState.js').AppState,
  setAppState: import('../Task.js').SetAppState,
  onlyIds?: Iterable<string>,
): number {
  const { backgroundTask } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../tasks/LocalShellTask/LocalShellTask.js') as typeof import('../tasks/LocalShellTask/LocalShellTask.js')
  const { createTaskRegistry } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./taskRegistry.js') as typeof import('./taskRegistry.js')
  const { isLocalShellTask } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../tasks/LocalShellTask/guards.js') as typeof import('../tasks/LocalShellTask/guards.js')
  const registry = createTaskRegistry(getAppState, setAppState)
  const filter = onlyIds === undefined ? undefined : new Set(onlyIds)
  let moved = 0
  for (const id of Object.keys(getAppState().tasks)) {
    if (filter && !filter.has(id)) continue
    const task = getAppState().tasks[id]
    if (!isLocalShellTask(task) || task.isBackgrounded || !task.shellCommand) {
      continue
    }
    if (
      backgroundTask(id, registry, {
        backgroundedToDeliverMessage: true,
      })
    ) {
      moved++
    }
  }
  return moved
}

export type HeadlessSendNowOutcome =
  | 'nothing_waiting'
  | 'delivering'
  | 'stopped'

export type HeadlessSendNowResult = {
  still_queued: string[]
  send_now: HeadlessSendNowOutcome
}

/**
 * densable `$M` — headless `interrupt` with `send_now: true` (and not
 * `cancel_queued: true`). Moves waiting foreground calls to background if
 * `deliver()` succeeds instead of aborting the subagent/turn; only aborts
 * when a turn is actively running with waiting messages and cannot be moved.
 */
export function handleHeadlessSendNow(opts: {
  queuedCommands: ReadonlyArray<{
    uuid?: string
    isMeta?: boolean
    origin?: Parameters<typeof isHumanLikeOrigin>[0]
    shouldQuery?: boolean
    passive?: boolean
  }>
  pressedUuid?: string | null
  turnUnderWay: boolean
  abortController: AbortController | null | undefined
  endSessionRequested?: boolean
  deliver?: () => boolean
}): HeadlessSendNowResult {
  const pressed =
    opts.pressedUuid !== undefined &&
    opts.pressedUuid !== null &&
    opts.pressedUuid !== ''
      ? opts.pressedUuid
      : undefined
  const waiting = opts.queuedCommands.filter(
    cmd =>
      !cmd.isMeta &&
      isHumanLikeOrigin(cmd.origin) &&
      cmd.shouldQuery !== false &&
      cmd.passive !== true &&
      (!pressed || cmd.uuid === pressed),
  )
  const still_queued = opts.queuedCommands
    .map(c => c.uuid)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)

  let send_now: HeadlessSendNowOutcome
  if (waiting.length === 0) {
    send_now = 'nothing_waiting'
  } else if (
    !opts.turnUnderWay ||
    !opts.abortController ||
    opts.abortController.signal.aborted ||
    opts.endSessionRequested ||
    opts.deliver?.() === true
  ) {
    send_now = 'delivering'
  } else {
    opts.abortController.abort()
    send_now = 'stopped'
  }
  return { still_queued, send_now }
}
