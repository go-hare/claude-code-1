/**
 * densable 2.1.239 #13 + 2.1.246 #40 planModeResume.
 *
 * 239: `uu`/`ll`/`bD`/`dy`/`mu`/`cy`/`__u`/`h_u`/`Ibu` — worker
 * `internal_metadata.worker_permission_mode` re-enters plan on resume.
 * 246 print: `my`/`pu`/`fu`/`uy`/`vD`/`CD` — `--continue` hydrates from
 * an open transcript plan segment. Resume runs `mu` then `pu`.
 *
 * Invent-ban: do not implement official empty `iX`/`EaT`. Do not call
 * `my` on interactive `--continue`. Do not restore `session_allow_rules`.
 */
import type { ToolPermissionContext } from '../../Tool.js'
import { COMMAND_NAME_TAG } from '../../constants/xml.js'
import { ENTER_PLAN_MODE_TOOL_NAME } from '@claude-code/builtin-tools/tools/EnterPlanModeTool/constants.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '@claude-code/builtin-tools/tools/ExitPlanModeTool/constants.js'
import {
  EXTERNAL_PERMISSION_MODES,
  type ExternalPermissionMode,
  type PermissionMode,
} from '../../types/permissions.js'
import { toExternalPermissionMode } from './PermissionMode.js'
import { logForDebugging } from '../debug.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../services/analytics/index.js'

export type PlanModeResumeSource = 'none' | 'internal' | 'transcript'

export type PlanModeRecordedMode = ExternalPermissionMode | 'absent' | 'invalid'

export type PlanModeOnResume = 'restored' | 'declined' | 'none'

export type TranscriptPlanState = 'open' | 'exited' | 'none'

export type PlanModeResumeTracker = {
  source: PlanModeResumeSource
  trustedMode: PermissionMode | undefined
  recordedMode: PlanModeRecordedMode
  transcriptOpen?: boolean
  recordTranscriptState?: TranscriptPlanState
}

/** Structural transcript rows for official `uy` / `vD` / `CD`. */
export type TranscriptPlanScanMessage = {
  type?: string
  attachment?: { type?: string }
  message?: { content?: unknown }
  permissionMode?: string
  isMeta?: boolean
  origin?: { kind?: string }
  toolUseResult?: unknown
}

export type WorkerInternalMetadata = {
  worker_permission_mode?: unknown
}

export type RestoredWorkerMetadata = {
  external?: unknown
  internal?: unknown
} | null

const TRANQUIL_FERN = 'tengu_tranquil_fern'

let planModeResumeGuardEnabled: boolean | undefined

/** Official `YWy`. */
export function createPlanModeResumeTracker(): PlanModeResumeTracker {
  return { source: 'none', trustedMode: undefined, recordedMode: 'absent' }
}

/** Official `$M` + `H8` — external modes only; `manual` → `default`. */
export function parseExternalPermissionMode(
  value: string,
): ExternalPermissionMode | undefined {
  const normalized = value === 'manual' ? 'default' : value
  return (EXTERNAL_PERMISSION_MODES as readonly string[]).includes(normalized)
    ? (normalized as ExternalPermissionMode)
    : undefined
}

/** Official `QnT`. */
export function parseRecordedWorkerPermissionMode(
  internal: WorkerInternalMetadata | null | undefined,
): PlanModeRecordedMode {
  const raw = internal?.worker_permission_mode
  if (raw === undefined || raw === null) return 'absent'
  if (typeof raw === 'string') {
    const parsed = parseExternalPermissionMode(raw)
    if (parsed) return parsed
  }
  return 'invalid'
}

/** Official `ll` / 239 `g_u`. 246: `transcriptOpen` also declines. */
export function classifyPlanModeOnResume(
  tracker: PlanModeResumeTracker,
): PlanModeOnResume {
  if (tracker.source !== 'none') return 'restored'
  return (tracker.recordedMode === 'plan' || tracker.transcriptOpen === true) &&
    tracker.trustedMode !== 'plan'
    ? 'declined'
    : 'none'
}

/** Official `Ibu(e){return(e??1)>1}`. */
export function isRestartedWorker(epoch: number | null | undefined): boolean {
  return (epoch ?? 1) > 1
}

/** Official `h_u` / `tengu_tranquil_fern` default ON. */
export function isPlanModeResumeGuardEnabled(): boolean {
  if (planModeResumeGuardEnabled !== undefined) {
    return planModeResumeGuardEnabled
  }
  const { getFeatureValue_CACHED_MAY_BE_STALE } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../services/analytics/growthbook.js') as typeof import('../../services/analytics/growthbook.js')
  planModeResumeGuardEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    TRANQUIL_FERN,
    true,
  )
  return planModeResumeGuardEnabled
}

export function resetPlanModeResumeGuardForTests(): void {
  planModeResumeGuardEnabled = undefined
}

export type PlanModeResumeAppState = {
  toolPermissionContext: ToolPermissionContext
}

export type ApplyPlanModeResumeOptions = {
  forkSession?: boolean
  transcript?: readonly TranscriptPlanScanMessage[]
  isGuardEnabled?: () => boolean
  isExitPlanModeEnabled?: () => boolean
  isExitPlanModeDenied?: (ctx: ToolPermissionContext) => boolean
  enterPlan?: <T extends PlanModeResumeAppState>(state: T) => T
  log?: (message: string, extra?: { level?: string }) => void
}

/** Official `gQr` + `eoT` — stash via prepareContextForPlanMode, then `mode:"plan"`. */
export function enterPlanModeFromWorkerRecord<T extends PlanModeResumeAppState>(
  state: T,
): T {
  const { prepareContextForPlanMode } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./permissionSetup.js') as typeof import('./permissionSetup.js')
  return {
    ...state,
    toolPermissionContext: {
      ...prepareContextForPlanMode(state.toolPermissionContext),
      mode: 'plan',
    },
  }
}

function defaultIsExitPlanModeEnabled(): boolean {
  const { ExitPlanModeV2Tool } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code/builtin-tools/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js') as typeof import('@claude-code/builtin-tools/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js')
  return ExitPlanModeV2Tool.isEnabled()
}

function defaultIsExitPlanModeDenied(ctx: ToolPermissionContext): boolean {
  const { ExitPlanModeV2Tool } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code/builtin-tools/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js') as typeof import('@claude-code/builtin-tools/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js')
  const { getDenyRuleForTool } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./permissions.js') as typeof import('./permissions.js')
  return getDenyRuleForTool(ctx, ExitPlanModeV2Tool) !== null
}

/**
 * Official `mu` / 239 `y_u`. 246 records `uy(transcript)` when the worker
 * record is plan. `Ei` is ExitPlanMode; `du` is a matching deny rule.
 */
export function applyPlanModeResumeFromInternal<
  T extends PlanModeResumeAppState,
>(
  internal: WorkerInternalMetadata | null | undefined,
  tracker: PlanModeResumeTracker,
  options: ApplyPlanModeResumeOptions = {},
): (prev: T) => T {
  const log = options.log ?? logForDebugging
  const isGuardEnabled = options.isGuardEnabled ?? isPlanModeResumeGuardEnabled
  tracker.recordedMode = parseRecordedWorkerPermissionMode(internal)
  if (tracker.recordedMode === 'invalid') {
    log(
      '[planModeResume] ignoring unrecognized internal_metadata.worker_permission_mode',
      { level: 'warn' },
    )
  }
  if (
    tracker.recordedMode === 'plan' &&
    options.transcript &&
    isGuardEnabled()
  ) {
    tracker.recordTranscriptState = scanTranscriptPlanState(options.transcript)
  }
  return prev => {
    tracker.trustedMode ??= prev.toolPermissionContext.mode
    const isExitEnabled =
      options.isExitPlanModeEnabled ?? defaultIsExitPlanModeEnabled
    const isDenied = options.isExitPlanModeDenied ?? defaultIsExitPlanModeDenied
    const enterPlan = options.enterPlan ?? enterPlanModeFromWorkerRecord
    if (
      tracker.recordedMode !== 'plan' ||
      prev.toolPermissionContext.mode === 'plan' ||
      !isGuardEnabled() ||
      options.forkSession ||
      !isExitEnabled() ||
      isDenied(prev.toolPermissionContext)
    ) {
      return prev
    }
    tracker.source = 'internal'
    log(
      `[planModeResume] re-entering plan mode from the prior worker's record (was ${prev.toolPermissionContext.mode})`,
    )
    return enterPlan(prev)
  }
}

/** Official `Boolean(n?.external||n?.internal)`. */
export function restoredWorkerHasMetadata(
  restored: RestoredWorkerMetadata,
): boolean {
  return Boolean(restored?.external || restored?.internal)
}

/**
 * Official `XWy`: restarted worker with no restored metadata skips.
 * Otherwise enable the record; if `planModeOnResume` is defined and metadata
 * exists, write the current (post-y_u) mode back to internal_metadata.
 */
export function syncWorkerPermissionModeRecord(options: {
  enable: () => void
  notifyInternal: (metadata: Record<string, unknown>) => void
  currentMode: PermissionMode
  planModeOnResume: PlanModeOnResume | undefined
  restored: RestoredWorkerMetadata
  restartedWorker: boolean
}): void {
  if (options.restartedWorker && !restoredWorkerHasMetadata(options.restored)) {
    return
  }
  options.enable()
  if (
    options.planModeOnResume !== undefined &&
    restoredWorkerHasMetadata(options.restored)
  ) {
    options.notifyInternal({
      worker_permission_mode: toExternalPermissionMode(options.currentMode),
    })
  }
}

/** Official `__u` / `tengu_worker_permission_mode_restore`. */
export function recordPlanModeResumeTelemetry(
  tracker: PlanModeResumeTracker,
  options: {
    lane: 'print' | 'sdk_url' | 'interactive'
    hadExternal: boolean
    hadInternal: boolean
    isGuardEnabled?: () => boolean
  },
): void {
  const targetMode = tracker.source === 'none' ? tracker.trustedMode : 'plan'
  const guardEnabled = (
    options.isGuardEnabled ?? isPlanModeResumeGuardEnabled
  )()
  logEvent('tengu_worker_permission_mode_restore', {
    source:
      tracker.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    lane: options.lane as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    trusted_mode: (tracker.trustedMode ??
      null) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    recorded_mode:
      tracker.recordedMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    target_mode: (targetMode ??
      null) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    had_external: options.hadExternal,
    had_internal: options.hadInternal,
    guard_enabled: guardEnabled,
    ...(tracker.recordTranscriptState
      ? {
          record_transcript_state:
            tracker.recordTranscriptState as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
    ...(tracker.transcriptOpen ? { transcript_open: true } : {}),
  })
}

const PLAN_SLASH_PREFIX = `<${COMMAND_NAME_TAG}>/plan</${COMMAND_NAME_TAG}>`
const LEADER_PLAN_SUBMITTED = 'Your plan has been submitted to the team lead'

function isTranscriptToolResultUser(
  message: TranscriptPlanScanMessage,
): boolean {
  if (message.type !== 'user') return false
  const content = message.message?.content
  if (!content || typeof content === 'string' || !Array.isArray(content)) {
    return false
  }
  return content.some(
    block =>
      block !== null &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'tool_result',
  )
}

function userMessageText(message: TranscriptPlanScanMessage): string | null {
  const { getUserMessageText } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../messages.js') as typeof import('../messages.js')
  return getUserMessageText(message as Parameters<typeof getUserMessageText>[0])
}

function isHumanLikeTranscriptOrigin(
  origin: { kind?: string } | undefined,
): boolean {
  const { isHumanLikeOrigin } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../messages.js') as typeof import('../messages.js')
  return isHumanLikeOrigin(origin)
}

/** Official `CD`. */
export function isLeaderApprovalPlanResult(
  message: TranscriptPlanScanMessage,
  content: unknown,
): boolean {
  const result = message.toolUseResult
  if (
    result !== null &&
    typeof result === 'object' &&
    (result as { awaitingLeaderApproval?: unknown }).awaitingLeaderApproval ===
      true
  ) {
    return true
  }
  return (
    typeof content === 'string' && content.startsWith(LEADER_PLAN_SUBMITTED)
  )
}

/** Official `vD` — assistant `tool_use` ids that appear more than once. */
export function duplicateToolUseIds(
  messages: readonly TranscriptPlanScanMessage[],
): Set<string> {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const message of messages) {
    if (
      message.type !== 'assistant' ||
      !Array.isArray(message.message?.content)
    ) {
      continue
    }
    for (const block of message.message.content) {
      if (
        block === null ||
        typeof block !== 'object' ||
        (block as { type?: string }).type !== 'tool_use'
      ) {
        continue
      }
      const id = (block as { id?: unknown }).id
      if (typeof id !== 'string') continue
      if (seen.has(id)) dupes.add(id)
      else seen.add(id)
    }
  }
  return dupes
}

/** Official `uy` — scan backwards for an open / exited / none plan segment. */
export function scanTranscriptPlanState(
  messages: readonly TranscriptPlanScanMessage[],
): TranscriptPlanState {
  const errorIds = new Set<string>()
  const successIds = new Set<string>()
  const dupes = duplicateToolUseIds(messages)
  let laterHumanNonPlan = false
  const openOrNone = (): TranscriptPlanState =>
    laterHumanNonPlan ? 'none' : 'open'
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) continue
    if (message.type === 'attachment') {
      const kind = message.attachment?.type
      if (kind === 'plan_mode' || kind === 'plan_mode_reentry') {
        return openOrNone()
      }
      if (kind === 'plan_mode_exit') return 'exited'
      continue
    }
    if (
      message.type === 'assistant' &&
      Array.isArray(message.message?.content)
    ) {
      const blocks = message.message.content
      for (let j = blocks.length - 1; j >= 0; j--) {
        const block = blocks[j] as {
          type?: string
          name?: string
          id?: string
        }
        if (block?.type !== 'tool_use') continue
        const id = block.id
        if (typeof id !== 'string') continue
        if (
          block.name === EXIT_PLAN_MODE_V2_TOOL_NAME &&
          successIds.has(id) &&
          !errorIds.has(id) &&
          !dupes.has(id)
        ) {
          return 'exited'
        }
        if (
          block.name === ENTER_PLAN_MODE_TOOL_NAME &&
          successIds.has(id) &&
          (!errorIds.has(id) || dupes.has(id))
        ) {
          return openOrNone()
        }
      }
      continue
    }
    if (message.type === 'user' && isTranscriptToolResultUser(message)) {
      const content = message.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block === null ||
            typeof block !== 'object' ||
            (block as { type?: string }).type !== 'tool_result'
          ) {
            continue
          }
          const id = (block as { tool_use_id?: unknown }).tool_use_id
          if (typeof id !== 'string') continue
          const failed =
            (block as { is_error?: boolean }).is_error ||
            isLeaderApprovalPlanResult(
              message,
              (block as { content?: unknown }).content,
            )
          ;(failed ? errorIds : successIds).add(id)
        }
      }
      continue
    }
    if (message.type === 'user') {
      if (userMessageText(message)?.trimStart().startsWith(PLAN_SLASH_PREFIX)) {
        return openOrNone()
      }
      if (message.permissionMode === 'plan') return openOrNone()
      if (
        message.permissionMode !== undefined &&
        !message.isMeta &&
        isHumanLikeTranscriptOrigin(message.origin)
      ) {
        laterHumanNonPlan = true
      }
    }
  }
  return 'none'
}

export type HydratePlanFromTranscriptOptions = {
  sdkUrl?: string
  permissionModeSuppliedOnInvocation?: boolean
  forkSession?: boolean
  isExitPlanModeEnabled?: () => boolean
}

/** Official `fu`. */
export function shouldHydratePlanFromTranscript(
  options: HydratePlanFromTranscriptOptions,
): boolean {
  const isExitEnabled =
    options.isExitPlanModeEnabled ?? defaultIsExitPlanModeEnabled
  if (!isExitEnabled() || options.forkSession) return false
  return (
    !!options.sdkUrl || options.permissionModeSuppliedOnInvocation === false
  )
}

/** Official `pu`. */
export function applyPlanModeResumeFromTranscript<
  T extends PlanModeResumeAppState,
>(
  messages: readonly TranscriptPlanScanMessage[],
  tracker: PlanModeResumeTracker,
  setAppState: (f: (prev: T) => T) => void,
  shouldHydrate: boolean,
  options: ApplyPlanModeResumeOptions = {},
): void {
  const isGuardEnabled = options.isGuardEnabled ?? isPlanModeResumeGuardEnabled
  const shouldEnter =
    shouldHydrate &&
    tracker.source === 'none' &&
    (tracker.recordedMode === 'absent' || tracker.recordedMode === 'invalid') &&
    isGuardEnabled() &&
    scanTranscriptPlanState(messages) === 'open'
  if (shouldEnter) tracker.transcriptOpen = true
  const isDenied = options.isExitPlanModeDenied ?? defaultIsExitPlanModeDenied
  const enterPlan = options.enterPlan ?? enterPlanModeFromWorkerRecord
  const log = options.log ?? logForDebugging
  setAppState(prev => {
    tracker.trustedMode ??= prev.toolPermissionContext.mode
    if (
      !shouldEnter ||
      prev.toolPermissionContext.mode === 'plan' ||
      isDenied(prev.toolPermissionContext)
    ) {
      return prev
    }
    tracker.source = 'transcript'
    log(
      `[planModeResume] re-entering plan mode from the transcript's open plan segment (was ${prev.toolPermissionContext.mode})`,
    )
    return enterPlan(prev)
  })
}

/**
 * Official `my` — print `--continue` only. Fresh tracker; no `y_u`.
 * `hadExternal`/`hadInternal` are dead false.
 */
export function hydratePlanModeFromTranscript<T extends PlanModeResumeAppState>(
  setAppState: (f: (prev: T) => T) => void,
  messages: readonly TranscriptPlanScanMessage[],
  options: HydratePlanFromTranscriptOptions & {
    isGuardEnabled?: () => boolean
    isExitPlanModeDenied?: (ctx: ToolPermissionContext) => boolean
    enterPlan?: <TState extends PlanModeResumeAppState>(state: TState) => TState
    log?: (message: string, extra?: { level?: string }) => void
  } = {},
): PlanModeOnResume {
  const tracker = createPlanModeResumeTracker()
  applyPlanModeResumeFromTranscript(
    messages,
    tracker,
    setAppState,
    shouldHydratePlanFromTranscript(options),
    options,
  )
  recordPlanModeResumeTelemetry(tracker, {
    lane: options.sdkUrl ? 'sdk_url' : 'print',
    hadExternal: false,
    hadInternal: false,
    isGuardEnabled: options.isGuardEnabled,
  })
  return classifyPlanModeOnResume(tracker)
}

/**
 * densable Jqy: continue never runs y_u, even if a CCR stash leaks in.
 * Resume / mid-session /resume clears this before applying.
 * 246 print `--continue` uses `my` instead — this gate stays for `y_u`.
 */
let skipPlanModeResumeBecauseContinue = false

export function setSkipPlanModeResumeBecauseContinue(skip: boolean): void {
  skipPlanModeResumeBecauseContinue = skip
}

export function isPlanModeResumeSkippedBecauseContinue(): boolean {
  return skipPlanModeResumeBecauseContinue
}

/**
 * densable OMo-then-y_u hydrate — print + interactive share this.
 * `continue` must not call `y_u` (239 gold / 246 `my` is a different entry).
 * Print `--resume` then runs official `pu` when `transcript` is passed.
 */
export function hydratePlanModeFromRestoredWorker<
  T extends PlanModeResumeAppState,
>(
  setAppState: (f: (prev: T) => T) => void,
  restored: RestoredWorkerMetadata,
  options: {
    forkSession?: boolean
    lane: 'print' | 'sdk_url' | 'interactive'
    transcript?: readonly TranscriptPlanScanMessage[]
    applyTranscriptHydrate?: boolean
    sdkUrl?: string
    permissionModeSuppliedOnInvocation?: boolean
    isGuardEnabled?: () => boolean
    isExitPlanModeEnabled?: () => boolean
    isExitPlanModeDenied?: (ctx: ToolPermissionContext) => boolean
    enterPlan?: <TState extends PlanModeResumeAppState>(state: TState) => TState
    log?: (message: string, extra?: { level?: string }) => void
  },
): PlanModeOnResume {
  if (skipPlanModeResumeBecauseContinue) {
    return 'none'
  }
  const tracker = createPlanModeResumeTracker()
  setAppState(
    applyPlanModeResumeFromInternal<T>(
      (restored?.internal ?? null) as WorkerInternalMetadata | null,
      tracker,
      {
        forkSession: !!options.forkSession,
        transcript: options.transcript,
        isGuardEnabled: options.isGuardEnabled,
        isExitPlanModeEnabled: options.isExitPlanModeEnabled,
        isExitPlanModeDenied: options.isExitPlanModeDenied,
        enterPlan: options.enterPlan,
        log: options.log,
      },
    ),
  )
  if (options.applyTranscriptHydrate && options.transcript !== undefined) {
    applyPlanModeResumeFromTranscript(
      options.transcript,
      tracker,
      setAppState,
      shouldHydratePlanFromTranscript({
        sdkUrl: options.sdkUrl,
        permissionModeSuppliedOnInvocation:
          options.permissionModeSuppliedOnInvocation,
        forkSession: options.forkSession,
        isExitPlanModeEnabled: options.isExitPlanModeEnabled,
      }),
      {
        isGuardEnabled: options.isGuardEnabled,
        isExitPlanModeDenied: options.isExitPlanModeDenied,
        enterPlan: options.enterPlan,
        log: options.log,
      },
    )
  }
  recordPlanModeResumeTelemetry(tracker, {
    lane: options.lane,
    hadExternal: !!restored?.external,
    hadInternal: !!restored?.internal,
    isGuardEnabled: options.isGuardEnabled,
  })
  return classifyPlanModeOnResume(tracker)
}

/**
 * Launch hydrate for processResumedConversation.
 * Continue: drain stash, set skip, leave state alone (Jqy has no y_u).
 * Resume: clear skip and apply stash when present.
 */
export function applyStashedPlanModeResumeForLaunch<
  T extends PlanModeResumeAppState,
>(state: T, opts: { forkSession: boolean; continueRequested?: boolean }): T {
  if (opts.continueRequested) {
    setSkipPlanModeResumeBecauseContinue(true)
    takeRestoredWorkerForPlanResume()
    return state
  }
  setSkipPlanModeResumeBecauseContinue(false)
  const restored = takeRestoredWorkerForPlanResume()
  if (!restored?.internal && !restored?.external) {
    return state
  }
  const tracker = createPlanModeResumeTracker()
  const next = applyPlanModeResumeFromInternal<T>(
    restored.internal as WorkerInternalMetadata | null,
    tracker,
    { forkSession: opts.forkSession },
  )(state)
  recordPlanModeResumeTelemetry(tracker, {
    lane: 'interactive',
    hadExternal: !!restored.external,
    hadInternal: !!restored.internal,
  })
  void classifyPlanModeOnResume(tracker)
  return next
}

/** Bridge CCR initialize result — taken by REPL hydrate / resume. */
let stashedRestoredWorker: RestoredWorkerMetadata = null
const restoredWorkerListeners = new Set<
  (restored: NonNullable<RestoredWorkerMetadata>) => void
>()

export function stashRestoredWorkerForPlanResume(
  restored: RestoredWorkerMetadata,
): void {
  stashedRestoredWorker = restored
  if (restored) {
    for (const cb of restoredWorkerListeners) {
      cb(restored)
    }
  }
}

export function takeRestoredWorkerForPlanResume(): RestoredWorkerMetadata {
  const next = stashedRestoredWorker
  stashedRestoredWorker = null
  return next
}

export function peekRestoredWorkerForPlanResume(): RestoredWorkerMetadata {
  return stashedRestoredWorker
}

/** Interactive REPL: apply pending CCR restore + future bridge connects. */
export function subscribeRestoredWorkerForPlanResume(
  cb: (restored: NonNullable<RestoredWorkerMetadata>) => void,
): () => void {
  restoredWorkerListeners.add(cb)
  return () => {
    restoredWorkerListeners.delete(cb)
  }
}

export function clearRestoredWorkerForPlanResumeForTests(): void {
  stashedRestoredWorker = null
  restoredWorkerListeners.clear()
  skipPlanModeResumeBecauseContinue = false
}
