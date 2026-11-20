// densable local_workflow progress → system/task_progress (jrH).
// Official path: buffer onProgress deltas → setTimeout(flush, 16) → tm8 merge into
// AppState.tasks[taskId].workflowProgress, then jrH emitTaskProgress.
// densable 2.1.289: the SDK/RC wire has no workflow_progress on task_progress
// (official21HostSchemas). Phase tree lives on the local task only.
//
// Our engine emits ProgressEvent on the progress bus (not densable's progress toolUse
// stream). This bridge is the adapter: map bus events → SdkWorkflowProgress deltas,
// throttle flush, emitTaskProgress.

import type { ProgressEvent } from '@claude-code/workflow-engine'
import {
  getIsNonInteractiveSession,
  isReplBridgeActive,
} from '../bootstrap/state.js'
import {
  applyWorkflowProgressDeltas,
  setWorkflowDeclaredPhases,
} from '../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { SetAppState } from '../Task.js'
import type { SdkWorkflowProgress } from '../types/workflowProgress.js'
import { emitTaskProgress } from '../utils/task/sdkProgress.js'
import type { ProgressBus } from './progress/bus.js'
import type { ProgressStore } from './progress/store.js'

/** densable HGg=16 — coalesce high-frequency agent_progress into one SDK frame. */
export const WORKFLOW_TASK_PROGRESS_FLUSH_MS = 16

/**
 * densable xGg=250 — min spacing between SDK flushes when interactive+bridge
 * (IGg rate-limit so bridge wire is not flooded).
 */
export const WORKFLOW_TASK_PROGRESS_MIN_SDK_GAP_MS = 250

/**
 * Official 2.1.328 (#591): legacy 1-hour workflow progress resend cutoff only
 * applies to legacy Claude Desktop sessions; IDE extensions (`claude-vscode`),
 * SDK apps (`sdk-*`), and modern Desktop keep resending workflow progress while
 * the workflow is still running.
 */
export const WORKFLOW_PROGRESS_LEGACY_CUTOFF_MS = 3_600_000
export const WORKFLOW_PROGRESS_RESEND_INTERVAL_MS = 30_000

const WORKFLOW_RESEND_UNBOUNDED_MIN_DESKTOP_VERSION = '6.7665.0'
const DESKTOP_HOST_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
  'desktop',
])

function compareSemverMajorMinorPatch(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Official 2.1.328 `Din()` — read host Desktop app version from
 * `CLAUDE_CODE_DESKTOP_APP_VERSION` when running under a Desktop entrypoint.
 */
export function getDesktopHostAppVersion(
  entrypoint: string = process.env.CLAUDE_CODE_ENTRYPOINT ?? '',
): string | undefined {
  if (DESKTOP_HOST_ENTRYPOINTS.has(entrypoint)) {
    const raw = process.env.CLAUDE_CODE_DESKTOP_APP_VERSION?.trim()
    return raw && raw.length > 0 ? raw : undefined
  }
  return undefined
}

/**
 * Official 2.1.328 (#591): decide whether a running workflow should resend
 * progress frames after `elapsedSinceLastProgressMs`. Returns `true` unless
 * running on a legacy Claude Desktop host older than the cutoff-free version
 * AND more than 1 hour has elapsed since the last progress update.
 */
export function shouldResendWorkflowProgress(opts: {
  isNonInteractive: boolean
  elapsedSinceLastProgressMs: number
  entrypoint?: string
  desktopVersion?: string
}): boolean {
  if (!opts.isNonInteractive) return true
  const entrypoint = opts.entrypoint ?? process.env.CLAUDE_CODE_ENTRYPOINT ?? ''
  if (!DESKTOP_HOST_ENTRYPOINTS.has(entrypoint)) {
    // IDE extensions (claude-vscode) and SDK apps (sdk-ts / sdk-py / sdk-cli)
    // no longer cut off after 1 hour.
    return true
  }
  const desktopVersion =
    opts.desktopVersion ?? getDesktopHostAppVersion(entrypoint)
  if (
    desktopVersion &&
    compareSemverMajorMinorPatch(
      desktopVersion,
      WORKFLOW_RESEND_UNBOUNDED_MIN_DESKTOP_VERSION,
    ) >= 0
  ) {
    return true
  }
  return opts.elapsedSinceLastProgressMs < WORKFLOW_PROGRESS_LEGACY_CUTOFF_MS
}

export type WorkflowTaskProgressBinding = {
  taskId: string
  toolUseId?: string
  description: string
  summary?: string
  startTime: number
  /** densable tm8 writes into AppState.tasks[taskId].workflowProgress. */
  setAppState?: SetAppState
  /**
   * densable IGg rate-limit override:
   * - `undefined` (production default): apply xGg when interactive **and**
   *   `isReplBridgeActive()` (densable `!dn()&&FC()`)
   * - `false`: force xGg (tests)
   * - `true`: never rate-limit (tests / print flood OK)
   */
  rateLimitSdk?: boolean
}

type PhaseIndexMap = Map<string, number>

type RunBuffer = {
  pending: SdkWorkflowProgress[]
  timer: ReturnType<typeof setTimeout> | undefined
  /** phase title → stable index for Desktop PhaseProgress fold. */
  phaseIndex: PhaseIndexMap
  nextPhaseIndex: number
}

type PhaseIndexState = {
  phaseIndex: PhaseIndexMap
  nextPhaseIndex: number
}

function phaseIndexFor(
  buf: PhaseIndexState,
  phase: string | undefined,
): number | undefined {
  if (!phase) return undefined
  let idx = buf.phaseIndex.get(phase)
  if (idx === undefined) {
    idx = buf.nextPhaseIndex++
    buf.phaseIndex.set(phase, idx)
  }
  return idx
}

/**
 * Map a progress-bus event to a densable-shaped SdkWorkflowProgress delta.
 * `log` maps to workflow_log (buffered for task state parity; stripped on emit).
 * `run_started` / `run_done` produce no progress item (lifecycle is task_started /
 * task_notification). `run_started` still seeds phaseIndex from meta.phases so
 * later agents keep stable phase indices matching declared order.
 */
export function mapProgressEventToSdk(
  event: ProgressEvent,
  buf: PhaseIndexState,
): SdkWorkflowProgress | null {
  const now = Date.now()
  switch (event.type) {
    case 'run_started': {
      // densable B03: reserve phase indices from meta.phases in declaration order.
      for (const ph of event.meta?.phases ?? []) {
        if (ph?.title) phaseIndexFor(buf, ph.title)
      }
      return null
    }
    case 'run_done':
      return null
    case 'log':
      return {
        type: 'workflow_log',
        message: event.message,
        lastProgressAt: now,
      }
    case 'phase_started': {
      const index = phaseIndexFor(buf, event.phase) ?? 0
      return {
        type: 'workflow_phase',
        index,
        title: event.phase,
        state: 'start',
        lastProgressAt: now,
      }
    }
    case 'phase_done': {
      const index = phaseIndexFor(buf, event.phase) ?? 0
      return {
        type: 'workflow_phase',
        index,
        title: event.phase,
        state: 'done',
        lastProgressAt: now,
      }
    }
    case 'agent_started': {
      const phaseIndex = phaseIndexFor(buf, event.phase)
      return {
        type: 'workflow_agent',
        index: event.agentId,
        label: event.label,
        phaseIndex,
        phaseTitle: event.phase,
        state: 'start',
        startedAt: now,
        lastProgressAt: now,
        ...(event.model ? { model: event.model } : {}),
        ...(event.agentType ? { agentType: event.agentType } : {}),
        ...(event.isolation ? { isolation: event.isolation } : {}),
        ...(event.promptPreview ? { promptPreview: event.promptPreview } : {}),
      }
    }
    case 'agent_progress': {
      const phaseIndex = phaseIndexFor(buf, event.phase)
      return {
        type: 'workflow_agent',
        index: event.agentId,
        label: event.label,
        phaseIndex,
        phaseTitle: event.phase,
        // densable mid-flight tick uses state:"progress" (not start) so IGg
        // can throttle full-snapshot SDK emits (every(k) === progress → kGg).
        state: 'progress',
        tokens: event.tokenCount,
        toolCalls: event.toolCount,
        lastProgressAt: now,
        ...(event.lastToolName ? { lastToolName: event.lastToolName } : {}),
      }
    }
    case 'agent_done': {
      const phaseIndex = phaseIndexFor(buf, event.phase)
      const base = {
        type: 'workflow_agent' as const,
        index: event.agentId,
        label: event.label,
        phaseIndex,
        phaseTitle: event.phase,
        lastProgressAt: now,
      }
      if (event.result.kind === 'ok') {
        const preview =
          typeof event.result.output === 'string'
            ? event.result.output.slice(0, 200)
            : event.result.output !== undefined
              ? (() => {
                  try {
                    return JSON.stringify(event.result.output).slice(0, 200)
                  } catch {
                    return undefined
                  }
                })()
              : undefined
        return {
          ...base,
          state: 'done',
          model: event.result.model,
          tokens: event.result.tokenCount,
          toolCalls: event.result.toolCount,
          ...(preview ? { resultPreview: preview } : {}),
          ...(event.cached !== undefined ? { cached: event.cached } : {}),
        }
      }
      if (event.result.kind === 'skipped') {
        return {
          ...base,
          state: 'done',
          error: 'skipped by user',
        }
      }
      return {
        ...base,
        state: 'error',
        error: event.result.detail ?? event.result.reason ?? 'dead',
      }
    }
    default:
      return null
  }
}

export type WorkflowTaskProgressEmitParams = Parameters<
  typeof emitTaskProgress
>[0] & {
  resent?: boolean
}

export type InstallWorkflowTaskProgressBridgeOpts = {
  bus: ProgressBus
  store: ProgressStore
  getBinding: (runId: string) => WorkflowTaskProgressBinding | undefined
  /** Override for tests (default WORKFLOW_TASK_PROGRESS_FLUSH_MS). */
  flushMs?: number
  /** Override emit for tests. */
  emit?: (params: WorkflowTaskProgressEmitParams) => void
  /**
   * Official 2.1.328 (#591): periodic resend check interval (ms) for keeping
   * RC/IDE/SDK sessions updated when a workflow runs without emitting new
   * deltas for >1h. Defaults to `WORKFLOW_PROGRESS_RESEND_INTERVAL_MS` (30s);
   * pass `0` to disable in unit tests.
   */
  resendIntervalMs?: number
}

/**
 * Subscribe to the progress bus and emit throttled system/task_progress frames.
 * Returns dispose + forceFlush (call forceFlush before deleting a run binding so
 * the final batch is not dropped).
 */
export function installWorkflowTaskProgressBridge(
  opts: InstallWorkflowTaskProgressBridgeOpts,
): { dispose: () => void; forceFlush: (runId?: string) => void } {
  const flushMs = opts.flushMs ?? WORKFLOW_TASK_PROGRESS_FLUSH_MS
  const emit =
    opts.emit ??
    ((params: WorkflowTaskProgressEmitParams) => emitTaskProgress(params))
  const buffers = new Map<string, RunBuffer>()
  const lastProgressAtByRun = new Map<string, number>()
  const lastBatchByRun = new Map<string, SdkWorkflowProgress[]>()
  /** densable IGg last SDK emit time (for xGg gap when rate-limited). */
  let lastSdkEmitAt = 0

  const ensure = (runId: string): RunBuffer => {
    let b = buffers.get(runId)
    if (!b) {
      b = {
        pending: [],
        timer: undefined,
        phaseIndex: new Map(),
        nextPhaseIndex: 0,
      }
      buffers.set(runId, b)
    }
    return b
  }

  const flushOne = (runId: string, force = false): void => {
    const buf = buffers.get(runId)
    if (!buf) return
    if (buf.timer !== undefined) {
      clearTimeout(buf.timer)
      buf.timer = undefined
    }
    if (buf.pending.length === 0) return

    const binding = opts.getBinding(runId)
    if (!binding) {
      // Drop pending if binding vanished (task unregistered).
      buf.pending = []
      return
    }

    // densable IGg: `if(!i&&!dn()&&FC())` wait xGg between SDK flushes.
    // force (run_done / dispose / forceFlush) always bypasses.
    const densableRateLimit =
      !getIsNonInteractiveSession() && isReplBridgeActive()
    const applyRateLimit =
      binding.rateLimitSdk === false
        ? true
        : binding.rateLimitSdk === true
          ? false
          : densableRateLimit
    if (!force && applyRateLimit) {
      const wait =
        lastSdkEmitAt + WORKFLOW_TASK_PROGRESS_MIN_SDK_GAP_MS - Date.now()
      if (wait > 0) {
        buf.timer = setTimeout(() => {
          buf.timer = undefined
          flushOne(runId, false)
        }, wait)
        buf.timer.unref?.()
        return
      }
    }

    const batch = buf.pending
    buf.pending = []

    // densable tm8 / Vss: always merge full batch (incl. logs) into task state first.
    let totalTokens = 0
    let toolUses = 0
    if (binding.setAppState) {
      const applied = applyWorkflowProgressDeltas(
        binding.taskId,
        batch,
        binding.setAppState,
      )
      if (applied) {
        totalTokens = applied.totalTokens
        toolUses = applied.totalToolCalls
      }
    } else {
      // Fallback: store agents (tests / no AppState).
      const run = opts.store.get(runId)
      if (run) {
        for (const a of run.agents) {
          totalTokens += a.tokenCount ?? 0
          toolUses += a.toolCount ?? 0
        }
      }
    }

    // densable 2.1.289 jrH: no workflow_progress on the SDK wire. Still skip
    // a flush whose batch is only workflow_log (UNu), matching gold's empty
    // after-strip early return. tm8 already merged the full batch above.
    const forSdk = batch.filter(item => item.type !== 'workflow_log')
    if (forSdk.length === 0) return

    const lastAgent = [...forSdk]
      .reverse()
      .find(item => item.type === 'workflow_agent') as
      | Extract<SdkWorkflowProgress, { type: 'workflow_agent' }>
      | undefined

    const now = Date.now()
    const description = lastAgent
      ? lastAgent.phaseTitle
        ? `${lastAgent.phaseTitle}: ${lastAgent.label ?? `agent ${lastAgent.index}`}`
        : (lastAgent.label ?? binding.description)
      : binding.description

    lastSdkEmitAt = now
    lastProgressAtByRun.set(runId, now)
    lastBatchByRun.set(runId, forSdk)
    emit({
      taskId: binding.taskId,
      toolUseId: binding.toolUseId,
      description,
      startTime: binding.startTime,
      totalTokens,
      toolUses,
      lastToolName: lastAgent?.lastToolName ?? lastAgent?.label,
      summary: binding.summary ?? binding.description,
      workflowProgress: forSdk,
    })
  }

  const schedule = (runId: string): void => {
    const buf = ensure(runId)
    if (buf.timer !== undefined) return
    buf.timer = setTimeout(() => {
      buf.timer = undefined
      flushOne(runId, false)
    }, flushMs)
    // Don't keep the process alive solely for progress frames.
    buf.timer.unref?.()
  }

  const onEvent = (event: ProgressEvent): void => {
    const runId = event.runId
    const buf = ensure(runId)
    // densable B03: stamp declaredPhases on task for WorkflowDetailDialog fold.
    if (event.type === 'run_started') {
      const titles =
        event.meta?.phases
          ?.map(ph => ph?.title)
          .filter((t): t is string => typeof t === 'string' && t.length > 0) ??
        []
      const binding = opts.getBinding(runId)
      if (binding?.setAppState && titles.length > 0) {
        setWorkflowDeclaredPhases(binding.taskId, titles, binding.setAppState)
      }
    }
    const mapped = mapProgressEventToSdk(event, buf)
    if (mapped) {
      buf.pending.push(mapped)
      schedule(runId)
    }
    // Terminal run: force flush so Desktop sees a last progress frame before
    // task_notification (complete path deletes the binding).
    if (event.type === 'run_done') {
      flushOne(runId, true)
      buffers.delete(runId)
      lastProgressAtByRun.delete(runId)
      lastBatchByRun.delete(runId)
    }
  }

  const unsubscribe = opts.bus.subscribe(onEvent)

  const resendActiveRuns = (now = Date.now()): number => {
    let resent = 0
    for (const [runId, lastAt] of lastProgressAtByRun) {
      const binding = opts.getBinding(runId)
      if (!binding) continue
      const lastBatch = lastBatchByRun.get(runId)
      if (!lastBatch || lastBatch.length === 0) continue
      if (
        !shouldResendWorkflowProgress({
          isNonInteractive: getIsNonInteractiveSession(),
          elapsedSinceLastProgressMs: Math.max(0, now - lastAt),
        })
      ) {
        continue
      }
      const run = opts.store.get(runId)
      let totalTokens = 0
      let toolUses = 0
      if (run) {
        for (const a of run.agents) {
          totalTokens += a.tokenCount ?? 0
          toolUses += a.toolCount ?? 0
        }
      }
      emit({
        taskId: binding.taskId,
        toolUseId: binding.toolUseId,
        description: binding.description,
        startTime: binding.startTime,
        totalTokens,
        toolUses,
        summary: binding.summary ?? binding.description,
        workflowProgress: lastBatch,
        resent: true,
      })
      resent++
    }
    return resent
  }

  const effectiveResendIntervalMs =
    opts.resendIntervalMs ?? WORKFLOW_PROGRESS_RESEND_INTERVAL_MS
  let resendTimer: ReturnType<typeof setInterval> | undefined
  if (effectiveResendIntervalMs > 0) {
    resendTimer = setInterval(() => {
      resendActiveRuns()
    }, effectiveResendIntervalMs)
    resendTimer.unref?.()
  }

  return {
    dispose: () => {
      if (resendTimer !== undefined) {
        clearInterval(resendTimer)
        resendTimer = undefined
      }
      unsubscribe()
      for (const [runId, buf] of buffers) {
        if (buf.timer !== undefined) clearTimeout(buf.timer)
        flushOne(runId, true)
      }
      buffers.clear()
      lastProgressAtByRun.clear()
      lastBatchByRun.clear()
    },
    forceFlush: (runId?: string) => {
      if (runId) {
        flushOne(runId, true)
        return
      }
      for (const id of [...buffers.keys()]) flushOne(id, true)
    },
  }
}
