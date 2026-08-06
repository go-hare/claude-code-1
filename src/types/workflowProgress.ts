/**
 * densable-shaped workflow progress deltas.
 * Clients upsert by `${type}:${index}` (agent/phase) then group by phaseIndex
 * (same fold as PhaseProgress / collectFromEvents).
 *
 * Kept separate from the `any` stub in tools.ts historical surface — tools.ts
 * re-exports this type as SdkWorkflowProgress.
 */

export type SdkWorkflowPhaseProgress = {
  type: 'workflow_phase'
  index: number
  title?: string
  state: 'start' | 'done'
  lastProgressAt?: number
}

export type SdkWorkflowAgentProgress = {
  type: 'workflow_agent'
  /** Engine agent() call index (densable `index`). */
  index: number
  label?: string
  phaseIndex?: number
  phaseTitle?: string
  /** Backend agent id string when available. */
  agentId?: string
  agentType?: string
  isolation?: 'worktree' | 'remote'
  model?: string
  /**
   * densable: start (queued/running), progress (mid-flight token/tool tick),
   * done / error (terminal). Mid-flight ticks use `progress` so IGg can
   * throttle full-snapshot SDK emits (kGg=10s) while still upserting task state.
   */
  state: 'start' | 'progress' | 'done' | 'error'
  tokens?: number
  toolCalls?: number
  durationMs?: number
  startedAt?: number
  queuedAt?: number
  lastProgressAt?: number
  lastToolName?: string
  promptPreview?: string
  resultPreview?: string
  error?: string
  cached?: boolean
}

export type SdkWorkflowLogProgress = {
  type: 'workflow_log'
  message: string
  lastProgressAt?: number
}

export type SdkWorkflowProgress =
  | SdkWorkflowPhaseProgress
  | SdkWorkflowAgentProgress
  | SdkWorkflowLogProgress

export function isSdkWorkflowProgress(
  value: unknown,
): value is SdkWorkflowProgress {
  if (typeof value !== 'object' || value === null) return false
  const t = (value as { type?: unknown }).type
  return (
    t === 'workflow_phase' || t === 'workflow_agent' || t === 'workflow_log'
  )
}
