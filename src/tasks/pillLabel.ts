import { DIAMOND_FILLED, DIAMOND_OPEN } from '../constants/figures.js'
import { count } from '../utils/array.js'
import { formatMcpBackgroundTaskLabel } from '../utils/densableNamingGates.js'
import type { BackgroundTaskState } from './types.js'

/**
 * Produces the compact footer-pill label for a set of background tasks.
 * Used by both the footer pill and the turn-duration transcript line so the
 * two surfaces agree on terminology.
 *
 * densable alt() polarity: local_workflow uses "background dynamic workflow",
 * remote-workflow sessions get a dedicated label, monitor_mcp|monitor_ws share
 * monitors, mcp_task noun is copper_thistle-gated job|task.
 */
export function getPillLabel(tasks: BackgroundTaskState[]): string {
  const n = tasks.length
  if (n === 0) return '0 background tasks'
  const first = tasks[0]!
  const allSameType = tasks.every(t => t.type === first.type)

  if (allSameType) {
    // densable residual types (mcp_task / monitor_ws) may not be in the local
    // TaskState union yet — compare as string for label parity.
    const type = first.type as string
    switch (type) {
      case 'local_bash': {
        const monitors = count(
          tasks,
          t => t.type === 'local_bash' && t.kind === 'monitor',
        )
        const shells = n - monitors
        const parts: string[] = []
        if (shells > 0)
          parts.push(shells === 1 ? '1 shell' : `${shells} shells`)
        if (monitors > 0)
          parts.push(monitors === 1 ? '1 monitor' : `${monitors} monitors`)
        return parts.join(', ')
      }
      case 'in_process_teammate': {
        const teamCount = new Set(
          tasks.map(t =>
            t.type === 'in_process_teammate' ? t.identity.teamName : '',
          ),
        ).size
        return teamCount === 1 ? '1 team' : `${teamCount} teams`
      }
      case 'local_agent':
        return n === 1 ? '1 local agent' : `${n} local agents`
      case 'remote_agent': {
        // Per design mockup: ◇ open diamond while running/needs-input,
        // ◆ filled once ExitPlanMode is awaiting approval.
        if (n === 1 && first.type === 'remote_agent' && first.isUltraplan) {
          switch (first.ultraplanPhase) {
            case 'plan_ready':
              return `${DIAMOND_FILLED} ultraplan ready`
            case 'needs_input':
              return `${DIAMOND_OPEN} ultraplan needs your input`
            default:
              return `${DIAMOND_OPEN} ultraplan`
          }
        }
        // densable: all remote-workflow → "remote dynamic workflow(s)".
        // remoteTaskType 'remote-workflow' exists in densable alt(); local
        // RemoteTaskType union may lag — compare as string for label parity.
        if (
          tasks.every(t => {
            if (t.type !== 'remote_agent') return false
            return (t.remoteTaskType as string) === 'remote-workflow'
          })
        ) {
          return n === 1
            ? `${DIAMOND_OPEN} 1 remote dynamic workflow`
            : `${DIAMOND_OPEN} ${n} remote dynamic workflows`
        }
        return n === 1
          ? `${DIAMOND_OPEN} 1 cloud session`
          : `${DIAMOND_OPEN} ${n} cloud sessions`
      }
      case 'local_workflow':
        // densable: "background dynamic workflow(s)"
        return n === 1
          ? '1 background dynamic workflow'
          : `${n} background dynamic workflows`
      case 'monitor_mcp':
      case 'monitor_ws':
        return n === 1 ? '1 monitor' : `${n} monitors`
      case 'mcp_task':
        return formatMcpBackgroundTaskLabel(n)
      case 'dream':
        return 'dreaming'
    }
  }

  return `${n} background ${n === 1 ? 'task' : 'tasks'}`
}

/**
 * True when the pill should show the dimmed " · ↓ to view" call-to-action.
 * Per the state diagram: only the two attention states (needs_input,
 * plan_ready) surface the CTA; plain running shows just the diamond + label.
 */
export function pillNeedsCta(tasks: BackgroundTaskState[]): boolean {
  if (tasks.length !== 1) return false
  const t = tasks[0]!
  return (
    t.type === 'remote_agent' &&
    t.isUltraplan === true &&
    t.ultraplanPhase !== undefined
  )
}
