// densable Elo/sas portable — fuzzy/name/registry task resolution for TaskStop.
// Surgical port: teammate identity + agentNameRegistry + prefix/fuzzy suggest.
// No taskRegistry abstraction — operates on AppState.tasks.
//
// Avoids importing LocalAgentTask runtime (circular type collapse → never).

import type { AppState } from '../state/AppState.js'
import type { TaskStateBase } from '../Task.js'
import {
  isInProcessTeammateTask,
  type InProcessTeammateTaskState,
} from './InProcessTeammateTask/types.js'

export type ResolveTaskForStopResult =
  | { status: 'found'; taskId: string; task: TaskStateBase }
  | { status: 'ambiguous'; message: string }
  | { status: 'not_found'; suggestion?: string }

/** Structural local_agent view — avoids circular import with LocalAgentTask. */
type LocalAgentView = TaskStateBase & {
  type: 'local_agent'
  agentType?: string
  isBackgrounded?: boolean
  isObserver?: boolean
  keepaliveReasons?: Set<string>
}

function isLocalAgentView(task: unknown): task is LocalAgentView {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    (task as { type?: unknown }).type === 'local_agent'
  )
}

/** densable zle — completed local_agent with non-empty keepaliveReasons. */
function isParkedView(task: {
  type?: string
  status?: string
  keepaliveReasons?: Set<string>
}): boolean {
  return (
    task.type === 'local_agent' &&
    task.status === 'completed' &&
    (task.keepaliveReasons?.size ?? 0) > 0
  )
}

/** densable G2 — normalize agent name for fuzzy match. */
export function normalizeAgentName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ch => (/\s/.test(ch) ? ch : ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/** densable _er — Levenshtein edit distance. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]!
}

/** densable yer — closest names within edit distance 2, limit r. */
function fuzzyClosestNames(
  query: string,
  candidates: string[],
  limit: number,
): string[] {
  const seen = new Set<string>()
  const hits: { name: string; distance: number }[] = []
  for (const s of candidates) {
    if (seen.has(s)) continue
    seen.add(s)
    if (Math.abs(s.length - query.length) > 2) continue
    const d = editDistance(query, s)
    if (d <= 2) hits.push({ name: s, distance: d })
  }
  return hits
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(h => h.name)
}

function listTeammates(
  tasks: Record<string, TaskStateBase | undefined>,
): InProcessTeammateTaskState[] {
  return Object.values(tasks).filter(isInProcessTeammateTask)
}

/** densable nje — exact teammate agentId, prefer running. */
function findTeammateByAgentId(
  agentId: string,
  tasks: Record<string, TaskStateBase | undefined>,
): InProcessTeammateTaskState | undefined {
  let fallback: InProcessTeammateTaskState | undefined
  for (const t of Object.values(tasks)) {
    if (!isInProcessTeammateTask(t) || t.identity.agentId !== agentId) continue
    if (t.status === 'running') return t
    if (!fallback) fallback = t
  }
  return fallback
}

/**
 * densable oqu — resolve teammate by agentId or agentName.
 * Prefers running when multiple name matches.
 */
function resolveTeammateByQuery(
  query: string,
  tasks: Record<string, TaskStateBase | undefined>,
):
  | { status: 'found'; task: InProcessTeammateTaskState }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'not_found' } {
  const byId = findTeammateByAgentId(query, tasks)
  if (byId) return { status: 'found', task: byId }

  const byName = new Map<string, InProcessTeammateTaskState>()
  for (const t of Object.values(tasks)) {
    if (!isInProcessTeammateTask(t) || t.identity.agentName !== query) continue
    const prev = byName.get(t.identity.agentId)
    if (!prev || (prev.status !== 'running' && t.status === 'running')) {
      byName.set(t.identity.agentId, t)
    }
  }
  const all = [...byName.values()]
  const running = all.filter(t => t.status === 'running')
  const pool = running.length > 0 ? running : all
  if (pool.length === 1) return { status: 'found', task: pool[0]! }
  if (pool.length > 1) {
    return {
      status: 'ambiguous',
      candidates: pool.map(t => t.identity.agentId),
    }
  }
  return { status: 'not_found' }
}

/** densable jzg — teammate name normalized match. */
function findTeammatesByNormalizedName(
  normalized: string,
  tasks: Record<string, TaskStateBase | undefined>,
): InProcessTeammateTaskState[] {
  const byId = new Map<string, InProcessTeammateTaskState>()
  for (const t of listTeammates(tasks)) {
    if (normalizeAgentName(t.identity.agentName) !== normalized) continue
    const prev = byId.get(t.identity.agentId)
    if (!prev || (prev.status !== 'running' && t.status === 'running')) {
      byId.set(t.identity.agentId, t)
    }
  }
  const all = [...byId.values()]
  const running = all.filter(t => t.status === 'running')
  return running.length > 0 ? running : all
}

/** densable Vqu — agentNameRegistry lookup with name predicate. */
function findNamedAgent(
  pred: (name: string) => boolean,
  tasks: Record<string, TaskStateBase | undefined>,
  registry: Map<string, string> | undefined,
): LocalAgentView | undefined {
  if (!registry) return undefined
  for (const [name, id] of registry) {
    if (!pred(name)) continue
    const t = tasks[id]
    if (isLocalAgentView(t)) return t
  }
  return undefined
}

/** densable qzg — fuzzy suggestion among running teammates + named agents. */
function suggestClosestName(
  normalizedQuery: string,
  tasks: Record<string, TaskStateBase | undefined>,
  registry: Map<string, string> | undefined,
): string | undefined {
  const map = new Map<string, string>()
  for (const t of listTeammates(tasks)) {
    if (t.status !== 'running') continue
    map.set(normalizeAgentName(t.identity.agentName), t.identity.agentId)
  }
  if (registry) {
    for (const [name, id] of registry) {
      const t = tasks[id]
      if (isLocalAgentView(t) && (t.status === 'running' || isParkedView(t))) {
        map.set(normalizeAgentName(name), name)
      }
    }
  }
  const closest = fuzzyClosestNames(normalizedQuery, [...map.keys()], 1)[0]
  if (closest === undefined) return undefined
  return map.get(closest)
}

function ambiguousTeammateMessage(query: string, candidates: string[]): string {
  return `Multiple teammates match "${query}": ${candidates.join(', ')}. Use the full agent ID (name@team).`
}

function ambiguousCrossMessage(
  query: string,
  teammateIds: string[],
  agentId: string,
): string {
  return `"${query}" matches both teammate ${teammateIds.join(', ')} and background agent ${agentId}. Use the full agent ID (name@team) for the teammate or the task ID for the background agent.`
}

/**
 * densable Elo(query, registry, getAppState):
 * resolve exact id miss → teammate name / agentNameRegistry / fuzzy.
 */
export function resolveTaskForStop(
  query: string,
  getAppState: () => AppState,
): ResolveTaskForStopResult {
  const app = getAppState()
  const tasks = (app.tasks ?? {}) as Record<string, TaskStateBase | undefined>
  const registry = app.agentNameRegistry as Map<string, string> | undefined

  const teammate = resolveTeammateByQuery(query, tasks)
  const namedExact = findNamedAgent(n => n === query, tasks, registry)

  if (teammate.status !== 'not_found' && namedExact) {
    const teammateIds =
      teammate.status === 'found'
        ? [teammate.task.identity.agentId]
        : teammate.candidates
    return {
      status: 'ambiguous',
      message: ambiguousCrossMessage(query, teammateIds, namedExact.id),
    }
  }
  if (teammate.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      message: ambiguousTeammateMessage(query, teammate.candidates),
    }
  }
  if (teammate.status === 'found') {
    return {
      status: 'found',
      taskId: teammate.task.id,
      task: teammate.task,
    }
  }
  if (namedExact) {
    return { status: 'found', taskId: namedExact.id, task: namedExact }
  }

  const normalized = normalizeAgentName(query)
  const byNorm = findTeammatesByNormalizedName(normalized, tasks)
  const namedNorm = findNamedAgent(
    n => normalizeAgentName(n) === normalized,
    tasks,
    registry,
  )
  if (byNorm.length > 0 && namedNorm) {
    return {
      status: 'ambiguous',
      message: ambiguousCrossMessage(
        query,
        byNorm.map(t => t.identity.agentId),
        namedNorm.id,
      ),
    }
  }
  if (byNorm.length > 1) {
    return {
      status: 'ambiguous',
      message: ambiguousTeammateMessage(
        query,
        byNorm.map(t => t.identity.agentId),
      ),
    }
  }
  if (byNorm.length === 1) {
    return {
      status: 'found',
      taskId: byNorm[0]!.id,
      task: byNorm[0]!,
    }
  }
  if (namedNorm) {
    return { status: 'found', taskId: namedNorm.id, task: namedNorm }
  }

  return {
    status: 'not_found',
    suggestion: suggestClosestName(normalized, tasks, registry),
  }
}

/** densable Wzg — running named agents from registry. */
function listRunningNamedAgents(
  tasks: Record<string, TaskStateBase | undefined>,
  registry: Map<string, string> | undefined,
): string[] {
  if (!registry) return []
  const names: string[] = []
  for (const [name, id] of registry) {
    const t = tasks[id]
    if (isLocalAgentView(t) && (t.status === 'running' || isParkedView(t))) {
      names.push(name)
    }
  }
  return names
}

/** densable vlo — running unnamed background agents (exclude registry + observers). */
function listRunningBackgroundAgents(
  tasks: Record<string, TaskStateBase | undefined>,
  registry: Map<string, string> | undefined,
  excludeId: string | undefined,
): string {
  const registered = new Set<string>(
    [...(registry?.values() ?? [])].map(String),
  )
  const ids: string[] = []
  for (const key of Object.keys(tasks)) {
    const raw = tasks[key]
    if (!raw || raw.type !== 'local_agent') continue
    // Structural fields live on the concrete task; read via a narrow bag so
    // TaskStateBase × type-predicate does not collapse to never under tsc.
    const bag = raw as TaskStateBase & {
      agentType?: string
      isBackgrounded?: boolean
      isObserver?: boolean
      keepaliveReasons?: Set<string>
    }
    if (bag.id === excludeId) continue
    if (bag.agentType === 'main-session') continue
    if (bag.isBackgrounded !== true) continue
    if (bag.isObserver === true) continue
    if (registered.has(bag.id)) continue
    if (bag.status !== 'running' && !isParkedView(bag)) continue
    ids.push(bag.description ? `${bag.id} (${bag.description})` : bag.id)
  }
  return ids.length > 0 ? `. Running background agents: ${ids.join(', ')}` : ''
}

/**
 * densable sas — rich not_found message with Did you mean / running lists.
 */
export function formatTaskNotFoundMessage(
  query: string,
  getAppState: () => AppState,
  suggestion: string | undefined,
  callerAgentId: string | undefined,
): string {
  const app = getAppState()
  const tasks = (app.tasks ?? {}) as Record<string, TaskStateBase | undefined>
  const registry = app.agentNameRegistry as Map<string, string> | undefined

  const runningTeammates = listTeammates(tasks)
    .filter(t => t.status === 'running')
    .map(t => t.identity.agentId)
  const named = listRunningNamedAgents(tasks, registry)

  let msg = `No task found with ID: ${query}`
  if (suggestion !== undefined) msg += `. Did you mean: ${suggestion}?`
  if (runningTeammates.length > 0) {
    msg += `. Running teammates: ${runningTeammates.join(', ')}`
  }
  if (named.length > 0) {
    msg += `. Running named agents: ${named.join(', ')}`
  }
  msg += listRunningBackgroundAgents(tasks, registry, callerAgentId)
  return msg
}
