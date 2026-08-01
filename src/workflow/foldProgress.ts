/**
 * densable PhaseProgress fold (aP6 / op8 / B03 / ep8 / G7K / R7K).
 * Host UI (WorkflowDetailDialog, tool result cards) folds task.workflowProgress
 * by `${type}:${index}` then groups by phaseIndex — same as densable.
 */

import type {
  SdkWorkflowAgentProgress,
  SdkWorkflowProgress,
} from '../types/workflowProgress.js'

export type FoldedPhase = {
  title: string
  phaseIndex: number
  status: 'running' | 'done' | 'failed' | 'not-started'
  agents: SdkWorkflowAgentProgress[]
  doneCount: number
  totalCount: number
  tokens: number
  durationMs: number
}

export type CollectedProgress = {
  agents: SdkWorkflowAgentProgress[]
  logs: string[]
  phaseTitles: Map<number, { title?: string }>
}

/** densable aP6 — collect agents (upsert by index), logs, phase titles. */
export function collectFromProgress(
  items: readonly SdkWorkflowProgress[] | undefined,
): CollectedProgress {
  const byIndex = new Map<number, SdkWorkflowAgentProgress>()
  const logs: string[] = []
  const phaseTitles = new Map<number, { title?: string }>()
  for (const item of items ?? []) {
    if (item.type === 'workflow_agent') {
      byIndex.set(item.index, item)
    } else if (item.type === 'workflow_log') {
      logs.push(item.message)
    } else if (item.type === 'workflow_phase') {
      phaseTitles.set(item.index, { title: item.title })
    }
  }
  return {
    agents: [...byIndex.values()].sort((a, b) => a.index - b.index),
    logs,
    phaseTitles,
  }
}

/** densable op8 — group agents by phaseIndex; null when no agent has phaseIndex. */
export function groupAgentsByPhase(
  agents: SdkWorkflowAgentProgress[],
  phaseTitles: Map<number, { title?: string }>,
): Array<{
  phaseIndex: number
  title: string
  agents: SdkWorkflowAgentProgress[]
}> | null {
  if (!agents.some(a => a.phaseIndex != null)) return null
  const map = new Map<
    number,
    {
      phaseIndex: number
      title: string
      agents: SdkWorkflowAgentProgress[]
    }
  >()
  for (const a of agents) {
    const idx = a.phaseIndex ?? 0
    let g = map.get(idx)
    if (!g) {
      const meta = phaseTitles.get(idx)
      g = {
        phaseIndex: idx,
        title: meta?.title ?? a.phaseTitle ?? `Phase ${idx}`,
        agents: [],
      }
      map.set(idx, g)
    }
    g.agents.push(a)
  }
  return [...map.values()].sort((a, b) => a.phaseIndex - b.phaseIndex)
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().trim()
}

/** densable ep8 — phase row stats from agent list. */
export function foldPhaseGroup(group: {
  phaseIndex: number
  title: string
  agents: SdkWorkflowAgentProgress[]
}): FoldedPhase {
  const doneCount = group.agents.filter(a => a.state === 'done').length
  const failedCount = group.agents.filter(a => a.state === 'error').length
  const totalCount = group.agents.length
  const complete = totalCount > 0 && doneCount + failedCount === totalCount
  let tokens = 0
  let minStart = Infinity
  let maxEnd = 0
  for (const a of group.agents) {
    if (a.tokens) tokens += a.tokens
    if (a.startedAt != null) {
      if (a.startedAt < minStart) minStart = a.startedAt
      const end = a.lastProgressAt ?? a.startedAt
      if (end > maxEnd) maxEnd = end
    }
  }
  return {
    title: group.title,
    phaseIndex: group.phaseIndex,
    status: complete
      ? failedCount > 0
        ? 'failed'
        : 'done'
      : totalCount === 0
        ? 'not-started'
        : 'running',
    agents: group.agents,
    doneCount,
    totalCount,
    tokens,
    durationMs: minStart < Infinity ? maxEnd - minStart : 0,
  }
}

function emptyPhase(title: string, phaseIndex: number): FoldedPhase {
  return {
    title,
    phaseIndex,
    status: 'not-started',
    agents: [],
    doneCount: 0,
    totalCount: 0,
    tokens: 0,
    durationMs: 0,
  }
}

/**
 * densable B03 + G7K — merge declared phase titles with live groups.
 * `declaredPhases` is optional meta.phases[].title (or task.phases).
 */
export function foldWorkflowPhases(
  workflowProgress: readonly SdkWorkflowProgress[] | undefined,
  declaredPhases?: readonly string[] | null,
  agentCountHint = 0,
): {
  phases: FoldedPhase[]
  /** Agents with state===done only (excludes failed/skipped-as-error). */
  doneAgents: number
  /** Agents with state done or error (finished terminal work). */
  finishedAgents: number
  totalAgents: number
} {
  const collected = collectFromProgress(workflowProgress)
  const groups =
    groupAgentsByPhase(collected.agents, collected.phaseTitles) ??
    (collected.agents.length > 0
      ? [
          {
            phaseIndex: 0,
            title: 'Agents',
            agents: collected.agents,
          },
        ]
      : [])

  const used = new Set<(typeof groups)[number]>()
  const matchGroup = (title: string) => {
    const n = normalizeTitle(title)
    for (const g of groups) {
      if (used.has(g)) continue
      const gn = normalizeTitle(g.title)
      if (n === gn || gn.startsWith(n) || n.startsWith(gn)) {
        used.add(g)
        return g
      }
    }
    return undefined
  }

  const phases: FoldedPhase[] = []
  let i = 0
  for (const title of declaredPhases ?? []) {
    const g = matchGroup(title)
    phases.push(g ? foldPhaseGroup(g) : emptyPhase(title, i))
    i++
  }
  for (const g of groups) {
    if (!used.has(g)) phases.push(foldPhaseGroup(g))
  }

  // densable G7K fallback when only agents exist without phaseIndex grouping
  // already handled above via synthetic "Agents" group.

  let doneAgents = 0
  let finishedAgents = 0
  let totalAgents = 0
  for (const p of phases) {
    doneAgents += p.doneCount
    totalAgents += p.totalCount
    for (const a of p.agents) {
      if (a.state === 'done' || a.state === 'error') finishedAgents++
    }
  }
  totalAgents = Math.max(
    agentCountHint,
    totalAgents,
    doneAgents,
    finishedAgents,
  )
  return { phases, doneAgents, finishedAgents, totalAgents }
}

/** densable B6_ — display status for an agent row. */
export function agentDisplayStatus(
  agent: SdkWorkflowAgentProgress,
  workflowRunning: boolean,
): 'done' | 'failed' | 'skipped' | 'interrupted' | 'queued' | 'running' {
  if (agent.state === 'done') {
    return agent.error === 'skipped by user' ? 'skipped' : 'done'
  }
  if (agent.state === 'error') {
    return agent.error === 'skipped by user' ? 'skipped' : 'failed'
  }
  if (!workflowRunning) return 'interrupted'
  if (agent.queuedAt != null && agent.startedAt == null) return 'queued'
  return 'running'
}

/** Live = mid-flight agent (state start). densable progress events map to start until done/error. */
export function isAgentLive(agent: SdkWorkflowAgentProgress): boolean {
  return agent.state === 'start'
}
