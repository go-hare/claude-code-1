import { DIAMOND_FILLED, DIAMOND_OPEN } from '../constants/figures.js'
import { SN, un } from '../services/artifactAutoReact/index.js'
import { count } from '../utils/array.js'
import { isMonitorWsTask } from './MonitorWsTask/MonitorWsTask.js'
import type { BackgroundTaskState } from './types.js'

/**
 * True when a background task is an armed, active Artifact comment monitor
 * (`sne` in 2.1.289).
 */
export function isArtifactCommentMonitor(task: unknown): boolean {
  if (
    !isMonitorWsTask(task) ||
    task.status !== 'running' ||
    task.autoReactArmed !== true
  ) {
    return false
  }
  const store = un()
  if (store.autoReact.userDisarmed || store.autoReact.enabledMemo === false) {
    return false
  }
  if (task.autoReactSlug !== undefined && SN(task.autoReactSlug)) {
    return false
  }
  return true
}

/**
 * Produces the compact footer-pill label for a set of background tasks.
 * Used by both the footer pill and the turn-duration transcript line so the
 * two surfaces agree on terminology.
 */
export function getPillLabel(tasks: BackgroundTaskState[]): string {
  const first = tasks[0]
  if (!first) return ''
  const n = tasks.length
  const allSameType = tasks.every(t => t.type === first.type)

  if (allSameType) {
    switch (first.type) {
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
        if (
          n === 1 &&
          (first.isUltraplan || first.ultraplanPhase !== undefined)
        ) {
          switch (first.ultraplanPhase) {
            case 'plan_ready':
              return `${DIAMOND_FILLED} ultraplan ready`
            case 'needs_input':
              return `${DIAMOND_OPEN} ultraplan needs your input`
            default:
              return `${DIAMOND_OPEN} ultraplan`
          }
        }
        if (
          tasks.every(
            t =>
              t.type === 'remote_agent' &&
              (t.remoteTaskType as string) === 'remote-workflow',
          )
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
        return n === 1
          ? '1 background dynamic workflow'
          : `${n} background dynamic workflows`
      case 'monitor_mcp':
      case 'monitor_ws': {
        if (tasks.every(isArtifactCommentMonitor)) {
          return n === 1
            ? '1 Artifact comment monitor'
            : `${n} Artifact comment monitors`
        }
        return n === 1 ? '1 monitor' : `${n} monitors`
      }
      case 'dream':
        return 'dreaming'
      case 'auto_mode_scan':
        return 'auto-mode scan'
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
    (t.isUltraplan === true || t.ultraplanPhase !== undefined) &&
    t.ultraplanPhase !== undefined
  )
}
