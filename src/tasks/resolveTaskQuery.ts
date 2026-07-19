/**
 * Official densable Elo — resolve a TaskStop query that is not an exact
 * registry key. Teammate identity (name / agentId), agentNameRegistry, and a
 * short edit-distance "Did you mean" suggestion.
 *
 * Local-only: no cloud fleet. Keeps densable message shapes for ambiguous /
 * not_found so tool errors stay familiar.
 */

import type { AppState } from '../state/AppState.js'
import type { TaskStateBase } from '../Task.js'
import {
  isInProcessTeammateTask,
  type InProcessTeammateTaskState,
} from './InProcessTeammateTask/types.js'
import { isLocalAgentTask } from './LocalAgentTask/LocalAgentTask.js'
import { isParkedKeepaliveAgent } from '../utils/task/framework.js'

export type ResolveTaskQueryResult =
  | { status: 'found'; task: TaskStateBase }
  | { status: 'ambiguous'; message: string }
  | { status: 'not_found'; suggestion?: string }

/** densable G2 — NFKC + strip controls + lower + collapse spaces to `-`. */
export function normalizeTaskQueryName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, t => (/\s/.test(t) ? t : ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/** densable _er — Levenshtein with adjacent-transposition. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      )
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        dp[i]![j] = Math.min(dp[i]![j]!, dp[i - 2]![j - 2]! + 1)
      }
    }
  }
  return dp[m]![n]!
}

/** densable yer — closest names within distance ≤2. */
function closestNames(
  query: string,
  candidates: string[],
  limit: number,
): string[] {
  const seen = new Set<string>()
  const scored: { name: string; distance: number }[] = []
  for (const c of candidates) {
    if (seen.has(c)) continue
    seen.add(c)
    if (Math.abs(c.length - query.length) > 2) continue
    const d = editDistance(query, c)
    if (d <= 2) scored.push({ name: c, distance: d })
  }
  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(s => s.name)
}

function teammatesOf(
  tasks: Record<string, TaskStateBase>,
): InProcessTeammateTaskState[] {
  return Object.values(tasks).filter(isInProcessTeammateTask)
}

/** densable nje — teammate by identity.agentId (prefer running). */
function findTeammateByAgentId(
  query: string,
  tasks: Record<string, TaskStateBase>,
): InProcessTeammateTaskState | undefined {
  let fallback: InProcessTeammateTaskState | undefined
  for (const t of teammatesOf(tasks)) {
    if (t.identity.agentId !== query) continue
    if (t.status === 'running') return t
    if (!fallback) fallback = t
  }
  return fallback
}

/**
 * densable oqu — exact teammate agentId, else exact agentName
 * (prefer running when multiple share a name).
 */
function resolveTeammateExact(
  query: string,
  tasks: Record<string, TaskStateBase>,
):
  | { status: 'found'; task: InProcessTeammateTaskState }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'not_found' } {
  const byId = findTeammateByAgentId(query, tasks)
  if (byId) return { status: 'found', task: byId }

  const byName = new Map<string, InProcessTeammateTaskState>()
  for (const t of teammatesOf(tasks)) {
    if (t.identity.agentName !== query) continue
    const prev = byName.get(t.identity.agentId)
    if (!prev || (prev.status !== 'running' && t.status === 'running')) {
      byName.set(t.identity.agentId, t)
    }
  }
  const all = [...byName.values()]
  const running = all.filter(t => t.status === 'running')
  const pick = running.length > 0 ? running : all
  if (pick.length === 1) return { status: 'found', task: pick[0]! }
  if (pick.length > 1) {
    return {
      status: 'ambiguous',
      candidates: pick.map(t => t.identity.agentId),
    }
  }
  return { status: 'not_found' }
}

/** densable jzg — teammates whose G2(agentName) matches. */
function resolveTeammateNormalized(
  normalized: string,
  tasks: Record<string, TaskStateBase>,
): InProcessTeammateTaskState[] {
  const byId = new Map<string, InProcessTeammateTaskState>()
  for (const t of teammatesOf(tasks)) {
    if (normalizeTaskQueryName(t.identity.agentName) !== normalized) continue
    const prev = byId.get(t.identity.agentId)
    if (!prev || (prev.status !== 'running' && t.status === 'running')) {
      byId.set(t.identity.agentId, t)
    }
  }
  const all = [...byId.values()]
  const running = all.filter(t => t.status === 'running')
  return running.length > 0 ? running : all
}

/** densable Vqu — agentNameRegistry predicate match → local_agent task. */
function resolveFromNameRegistry(
  predicate: (name: string) => boolean,
  tasks: Record<string, TaskStateBase>,
  agentNameRegistry: Map<string, string> | undefined,
): TaskStateBase | undefined {
  if (!agentNameRegistry) return undefined
  for (const [name, id] of agentNameRegistry) {
    if (!predicate(name)) continue
    const t = tasks[id]
    if (t && isLocalAgentTask(t)) return t
  }
  return undefined
}

function multiTeammateMsg(query: string, ids: string[]): string {
  return `Multiple teammates match "${query}": ${ids.join(', ')}. Use the full agent ID (name@team).`
}

function bothKindsMsg(
  query: string,
  teammateIds: string[],
  agentTaskId: string,
): string {
  return `"${query}" matches both teammate ${teammateIds.join(', ')} and background agent ${agentTaskId}. Use the full agent ID (name@team) for the teammate or the task ID for the background agent.`
}

/** densable qzg — suggestion key among running teammates + live registry names. */
function suggestName(
  normalizedQuery: string,
  tasks: Record<string, TaskStateBase>,
  agentNameRegistry: Map<string, string> | undefined,
): string | undefined {
  const names = new Map<string, string>()
  for (const t of teammatesOf(tasks)) {
    if (t.status !== 'running') continue
    names.set(normalizeTaskQueryName(t.identity.agentName), t.identity.agentId)
  }
  if (agentNameRegistry) {
    for (const [name, id] of agentNameRegistry) {
      const t = tasks[id]
      if (
        t &&
        isLocalAgentTask(t) &&
        (t.status === 'running' || isParkedKeepaliveAgent(t))
      ) {
        names.set(normalizeTaskQueryName(name), name)
      }
    }
  }
  const hit = closestNames(normalizedQuery, [...names.keys()], 1)[0]
  if (hit === undefined) return undefined
  return names.get(hit)
}

/**
 * densable Elo(e, registry, getAppState).
 * Call only when `tasks[query]` is missing.
 */
export function resolveTaskQuery(
  query: string,
  tasks: Record<string, TaskStateBase>,
  getAppState?: () => AppState,
): ResolveTaskQueryResult {
  const registry = getAppState?.().agentNameRegistry as
    | Map<string, string>
    | undefined

  const teammate = resolveTeammateExact(query, tasks)
  const fromRegistryExact = resolveFromNameRegistry(
    name => name === query,
    tasks,
    registry,
  )

  // densable: if teammate hit AND registry hit → ambiguous (both kinds)
  if (teammate.status !== 'not_found' && fromRegistryExact) {
    const cands =
      teammate.status === 'found'
        ? [teammate.task.identity.agentId]
        : teammate.candidates
    return {
      status: 'ambiguous',
      message: bothKindsMsg(query, cands, fromRegistryExact.id),
    }
  }
  if (teammate.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      message: multiTeammateMsg(query, teammate.candidates),
    }
  }
  if (teammate.status === 'found') {
    return { status: 'found', task: teammate.task }
  }
  if (fromRegistryExact) {
    return { status: 'found', task: fromRegistryExact }
  }

  // Normalized name pass (G2)
  const normalized = normalizeTaskQueryName(query)
  const teammatesNorm = resolveTeammateNormalized(normalized, tasks)
  const fromRegistryNorm = resolveFromNameRegistry(
    name => normalizeTaskQueryName(name) === normalized,
    tasks,
    registry,
  )
  if (teammatesNorm.length > 0 && fromRegistryNorm) {
    return {
      status: 'ambiguous',
      message: bothKindsMsg(
        query,
        teammatesNorm.map(t => t.identity.agentId),
        fromRegistryNorm.id,
      ),
    }
  }
  if (teammatesNorm.length > 1) {
    return {
      status: 'ambiguous',
      message: multiTeammateMsg(
        query,
        teammatesNorm.map(t => t.identity.agentId),
      ),
    }
  }
  if (teammatesNorm.length === 1) {
    return { status: 'found', task: teammatesNorm[0]! }
  }
  if (fromRegistryNorm) {
    return { status: 'found', task: fromRegistryNorm }
  }

  // Also: local_agent whose agentId field equals query but map key differs
  for (const t of Object.values(tasks)) {
    if (
      isLocalAgentTask(t) &&
      t.agentId === query &&
      (t.status === 'running' || isParkedKeepaliveAgent(t))
    ) {
      return { status: 'found', task: t }
    }
  }

  return {
    status: 'not_found',
    suggestion: suggestName(normalized, tasks, registry),
  }
}

/**
 * densable sas — richer not_found message with Did you mean + running lists.
 */
export function formatTaskNotFoundMessage(
  query: string,
  tasks: Record<string, TaskStateBase>,
  getAppState: (() => AppState) | undefined,
  suggestion: string | undefined,
  callerAgentId: string | undefined,
): string {
  let msg = `No task found with ID: ${query}`
  if (suggestion !== undefined) {
    msg += `. Did you mean: ${suggestion}?`
  }

  const runningTeammates = teammatesOf(tasks)
    .filter(t => t.status === 'running')
    .map(t => t.identity.agentId)
  if (runningTeammates.length > 0) {
    msg += `. Running teammates: ${runningTeammates.join(', ')}`
  }

  const registry = getAppState?.().agentNameRegistry as
    | Map<string, string>
    | undefined
  if (registry) {
    const named: string[] = []
    for (const [name, id] of registry) {
      const t = tasks[id]
      if (
        t &&
        isLocalAgentTask(t) &&
        (t.status === 'running' || isParkedKeepaliveAgent(t))
      ) {
        named.push(name)
      }
    }
    if (named.length > 0) {
      msg += `. Running named agents: ${named.join(', ')}`
    }
  }

  // densable vlo — background agents not in registry
  const regIds = new Set(registry?.values() ?? [])
  const bg = Object.values(tasks)
    .filter(
      t =>
        isLocalAgentTask(t) &&
        t.id !== callerAgentId &&
        t.agentType !== 'main-session' &&
        t.isBackgrounded &&
        t.isObserver !== true &&
        !regIds.has(t.id) &&
        (t.status === 'running' || isParkedKeepaliveAgent(t)),
    )
    .map(t => (t.description ? `${t.id} (${t.description})` : t.id))
  if (bg.length > 0) {
    msg += `. Running background agents: ${bg.join(', ')}`
  }

  return msg
}
