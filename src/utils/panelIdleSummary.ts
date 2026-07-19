/**
 * densable G7 idle_summary residual (cIa / sAb / mrf / $de / UQ).
 *
 * When more than IDLE_COLLAPSE_THRESHOLD idle panel agents exist and the user
 * has not expanded (`idleTeammatesExpanded`), collapse the excess into one
 * synthetic idle_summary row ("N idle agents").
 *
 * densable UQ = non-main local_agent (R6) OR in_process_teammate (Nv).
 * densable mrf only collapses in_process_teammate when idle; local residual also
 * duck-types optional isIdle on local_agent for tests / future parity.
 */
import { isTerminalStatus } from '../components/tasks/taskStatusUtils.js'
import type { LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js'
import {
  isInProcessTeammateTask,
  type InProcessTeammateTaskState,
} from '../tasks/InProcessTeammateTask/types.js'
import { isPanelAgentTask } from '../tasks/LocalAgentTask/LocalAgentTask.js'

/** densable cIa — show this many idle rows before collapsing the rest. */
export const IDLE_COLLAPSE_THRESHOLD = 3

/** densable sAb — synthetic summary row id. */
export const IDLE_SUMMARY_ID = 'idle-teammate-summary'

export type IdleSummaryRow = {
  type: 'idle_summary'
  id: typeof IDLE_SUMMARY_ID
  taskIds: string[]
}

/** densable UQ panel row — local_agent (non-main) or in_process_teammate. */
export type PanelAgentTask = LocalAgentTaskState | InProcessTeammateTaskState

export type PanelListItem = PanelAgentTask | IdleSummaryRow

/** densable $de */
export function isIdleSummaryRow(
  row: PanelListItem | unknown,
): row is IdleSummaryRow {
  return (
    typeof row === 'object' &&
    row !== null &&
    (row as { type?: string }).type === 'idle_summary'
  )
}

/**
 * densable UQ residual — panel-managed task rows.
 * local_agent (non main-session) OR in_process_teammate; exclude immediate dismiss.
 */
export function isPanelListTask(t: unknown): t is PanelAgentTask {
  if (isPanelAgentTask(t)) return t.evictAfter !== 0
  if (isInProcessTeammateTask(t)) return t.evictAfter !== 0
  return false
}

/**
 * densable $eo / prf — teammate awaiting plan or has queued user messages
 * should not collapse into idle_summary (still "active" from leader POV).
 */
export function isTeammateBusyForIdleCollapse(
  task: InProcessTeammateTaskState,
): boolean {
  return (
    task.awaitingPlanApproval || (task.pendingUserMessages?.length ?? 0) > 0
  )
}

/**
 * densable mrf — collapsible idle agent for panel list.
 * Primary: in_process_teammate isIdle && !terminal && !viewed && !$eo.
 * Secondary: local_agent duck-type optional isIdle (tests / future).
 */
export function isCollapsibleIdlePanelTask(
  task: PanelAgentTask | (LocalAgentTaskState & { isIdle?: boolean }),
  viewingAgentTaskId: string | undefined,
): boolean {
  if (task.id === viewingAgentTaskId) return false
  if (isTerminalStatus(task.status)) return false
  if (task.type === 'in_process_teammate') {
    const tm = task as InProcessTeammateTaskState
    if (isTeammateBusyForIdleCollapse(tm)) return false
    return Boolean(tm.isIdle)
  }
  // Duck-type local_agent if isIdle is ever set on the task state.
  return Boolean((task as { isIdle?: boolean }).isIdle)
}

/**
 * densable G7 tail: given decoration-filtered rows, optionally collapse idle
 * agents past the threshold into one idle_summary row.
 * When expanded=true, return rows unchanged (n flag in densable G7).
 */
export function collapseIdlePanelRows(
  rows: PanelAgentTask[],
  expanded: boolean,
  viewingAgentTaskId?: string,
): PanelListItem[] {
  if (expanded) return rows
  const idleIds = rows
    .filter(t => isCollapsibleIdlePanelTask(t, viewingAgentTaskId))
    .map(t => t.id)
  if (idleIds.length <= IDLE_COLLAPSE_THRESHOLD) return rows
  const collapsed = new Set(idleIds.slice(IDLE_COLLAPSE_THRESHOLD))
  const out: PanelListItem[] = []
  let inserted = false
  for (const row of rows) {
    if (!collapsed.has(row.id)) {
      out.push(row)
      continue
    }
    if (!inserted) {
      inserted = true
      out.push({
        type: 'idle_summary',
        id: IDLE_SUMMARY_ID,
        taskIds: idleIds.slice(IDLE_COLLAPSE_THRESHOLD),
      })
    }
  }
  return out
}

/** densable _rf label: "1 idle agent" / "N idle agents". */
export function idleSummaryLabel(count: number): string {
  return count === 1 ? '1 idle agent' : `${count} idle agents`
}

/**
 * densable mqo — true when expanded idle list would collapse past threshold.
 * Used by footer:clearSelection to keep tasks selected after collapse.
 */
export function wouldCollapseIdlePanelRows(
  rows: PanelAgentTask[],
  viewingAgentTaskId?: string,
): boolean {
  let n = 0
  for (const t of rows) {
    if (isCollapsibleIdlePanelTask(t, viewingAgentTaskId)) n++
  }
  return n > IDLE_COLLAPSE_THRESHOLD
}

/**
 * densable hrf — remap coordinatorTaskIndex when panel row ids change
 * (e.g. expand/collapse idle_summary). index 0 is "main"; agent rows are 1+.
 * Walks previous selection stack from the selected agent toward main and
 * returns the first still-present id's new 1-based index, else 0.
 */
export function remapPanelSelectionIndex(
  index: number,
  prevIds: readonly string[],
  nextIds: readonly string[],
): number {
  if (index < 1) return index
  for (let n = Math.min(index, prevIds.length) - 1; n >= 0; n--) {
    const o = nextIds.indexOf(prevIds[n]!)
    if (o !== -1) return o + 1
  }
  return 0
}
