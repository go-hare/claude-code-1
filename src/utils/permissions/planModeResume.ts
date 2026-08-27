/**
 * densable 2.1.239 #13 planModeResume — official `YWy`/`g_u`/`QnT`/`eoT`/`y_u`/`XWy`/`__u`/`h_u`/`Ibu`.
 *
 * Cloud idle-worker restart drops the session out of plan mode because
 * `external_metadata.permission_mode` is not the record. Official writes
 * `internal_metadata.worker_permission_mode` and re-enters plan on resume.
 *
 * Invent-ban: do not implement official empty `EaT`. Do not restore
 * `session_allow_rules` (`nxh`) or upgrade `rxh` here.
 */
import type { ToolPermissionContext } from '../../Tool.js'
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

export type PlanModeResumeSource = 'none' | 'internal'

export type PlanModeRecordedMode = ExternalPermissionMode | 'absent' | 'invalid'

export type PlanModeOnResume = 'restored' | 'declined' | 'none'

export type PlanModeResumeTracker = {
  source: PlanModeResumeSource
  trustedMode: PermissionMode | undefined
  recordedMode: PlanModeRecordedMode
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

/** Official `g_u`. */
export function classifyPlanModeOnResume(
  tracker: PlanModeResumeTracker,
): PlanModeOnResume {
  if (tracker.source !== 'none') return 'restored'
  return tracker.recordedMode === 'plan' && tracker.trustedMode !== 'plan'
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
 * Official `y_u` — setAppState updater. `qqe` is ExitPlanMode (EnterPlanMode
 * `isEnabled()` delegates to it). `KS` is a matching deny rule on that tool.
 */
export function applyPlanModeResumeFromInternal<
  T extends PlanModeResumeAppState,
>(
  internal: WorkerInternalMetadata | null | undefined,
  tracker: PlanModeResumeTracker,
  options: ApplyPlanModeResumeOptions = {},
): (prev: T) => T {
  return prev => {
    tracker.trustedMode = prev.toolPermissionContext.mode
    tracker.recordedMode = parseRecordedWorkerPermissionMode(internal)
    const log = options.log ?? logForDebugging
    if (tracker.recordedMode === 'invalid') {
      log(
        '[planModeResume] ignoring unrecognized internal_metadata.worker_permission_mode',
        { level: 'warn' },
      )
    }
    const isGuardEnabled =
      options.isGuardEnabled ?? isPlanModeResumeGuardEnabled
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
  })
}

/**
 * densable OMo-then-y_u hydrate — print + interactive share this.
 * `continue` must not call (gold). Pass null restored when no CCR metadata.
 */
export function hydratePlanModeFromRestoredWorker<
  T extends PlanModeResumeAppState,
>(
  setAppState: (f: (prev: T) => T) => void,
  restored: RestoredWorkerMetadata,
  options: {
    forkSession?: boolean
    lane: 'print' | 'sdk_url' | 'interactive'
  },
): PlanModeOnResume {
  const tracker = createPlanModeResumeTracker()
  setAppState(
    applyPlanModeResumeFromInternal<T>(
      (restored?.internal ?? null) as WorkerInternalMetadata | null,
      tracker,
      { forkSession: !!options.forkSession },
    ),
  )
  recordPlanModeResumeTelemetry(tracker, {
    lane: options.lane,
    hadExternal: !!restored?.external,
    hadInternal: !!restored?.internal,
  })
  return classifyPlanModeOnResume(tracker)
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
}
