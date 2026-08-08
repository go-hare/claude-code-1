/**
 * densable taskRegistry counter subset — session runaway guards.
 *
 * densable 2.1.212: Etu/vtu + TotalAgentSpawns / WebSearchCalls (qpg/zpg=200)
 * densable 2.1.217: concurrent live slots ($vu/vBg=20)
 * densable 2.1.219: nest depth (Bue/_ee/qPu=3; was Evu=1 in 217)
 *
 * Local product: session-scoped module counters (single CLI process = session).
 * /clear calls reset*; WebSearchTool + AgentTool call get/increment.
 *
 * 2.1.216 #15: L(Me) interrupt immunity for async local spawn (see assertCanSpawnSubagent).
 * 2.1.217 #18/#19: takeConcurrencySlot + CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { getAbortReasonMessage } from 'src/utils/abortController.js'
import type { AgentContext } from 'src/utils/agentContext.js'
import { type EffortValue, isUltracodeModeActive } from 'src/utils/effort.js'

/** densable qpg / zpg */
export const DEFAULT_MAX_SUBAGENTS_PER_SESSION = 200
export const DEFAULT_MAX_WEB_SEARCHES_PER_SESSION = 200
/** densable vBg */
export const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 20
/** densable qPu/Evu (2.1.219) — main depth 0; default max 3 ⇒ nested spawn allowed */
export const DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH = 3
/** densable pBg */
export const HAZEL_TRELLIS_FEATURE = 'tengu_hazel_trellis'
/** densable tengu_amber_kestrel — concurrent cap kill-switch */
export const AMBER_KESTREL_FEATURE = 'tengu_amber_kestrel'

let totalAgentSpawns = 0
let webSearchCalls = 0
/** densable AppState.runningSubagents (module counter — single process session) */
let concurrentSubagents = 0
/** densable Hts — cache GB hazel once resolved */
let hazelTrellisCache: number | null = null

/** densable Fvu / Etu — CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION ?? 200 */
export function resolveMaxSubagentsPerSession(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseSessionCap(
    env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION,
    DEFAULT_MAX_SUBAGENTS_PER_SESSION,
  )
}

/** densable Uvu / vtu — CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION ?? 200 */
export function resolveMaxWebSearchesPerSession(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseSessionCap(
    env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION,
    DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
  )
}

/** densable $vu — CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ?? vBg=20 */
export function resolveMaxConcurrentSubagents(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parseSessionCap(
    env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS,
    DEFAULT_MAX_CONCURRENT_SUBAGENTS,
  )
}

/**
 * densable Bue():
 *   env CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH if set
 *   else GB tengu_hazel_trellis (integer >= 1) else Evu=1
 *
 * Note: densable returns env raw (`e`) without Number(); we parse to number
 * for TypeScript safety while preserving invalid → fallback.
 */
export function resolveMaxSubagentSpawnDepth(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  if (hazelTrellisCache === null) {
    const r = getFeatureValue_CACHED_MAY_BE_STALE(
      HAZEL_TRELLIS_FEATURE,
      DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH,
    )
    hazelTrellisCache =
      typeof r === 'number' && Number.isInteger(r) && r >= 1
        ? r
        : DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH
  }
  return hazelTrellisCache
}

/** Test /clear helper — reset GB cache between cases */
export function resetHazelTrellisCache(): void {
  hazelTrellisCache = null
}

function parseSessionCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

// --- densable taskRegistry counter API ---

export function getTotalAgentSpawns(): number {
  return totalAgentSpawns
}

export function incrementTotalAgentSpawns(): number {
  totalAgentSpawns += 1
  return totalAgentSpawns
}

export function resetTotalAgentSpawns(): void {
  totalAgentSpawns = 0
}

export function getWebSearchCalls(): number {
  return webSearchCalls
}

export function incrementWebSearchCalls(): number {
  webSearchCalls += 1
  return webSearchCalls
}

export function resetWebSearchCalls(): void {
  webSearchCalls = 0
}

/** densable getConcurrentSubagents */
export function getConcurrentSubagents(): number {
  return concurrentSubagents
}

/**
 * densable takeConcurrencySlot():
 *   runningSubagents += 1
 *   return once-safe release () => runningSubagents = max(0, n-1)
 */
export function takeConcurrencySlot(): () => void {
  concurrentSubagents += 1
  let released = false
  return () => {
    if (released) return
    released = true
    concurrentSubagents = Math.max(0, concurrentSubagents - 1)
  }
}

export function resetConcurrentSubagents(): void {
  concurrentSubagents = 0
}

/** densable /clear — all budgets */
export function resetSessionSpawnCaps(): void {
  resetTotalAgentSpawns()
  resetWebSearchCalls()
  resetConcurrentSubagents()
  resetHazelTrellisCache()
}

/**
 * densable cN(e):
 *   if agentType === "main" → 0
 *   else depth ?? 0
 * undefined context (main REPL) → 0
 */
export function getAgentContextDepth(
  agentContext: AgentContext | undefined | null,
): number {
  if (!agentContext) return 0
  // AgentContext union has no "main" variant locally — main = no context.
  // densable main agentType returns 0; treat missing depth as 0.
  return agentContext.depth ?? 0
}

/** densable subagent_depth_cap message */
export function formatSubagentDepthCapMessage(
  depth: number,
  max: number,
): string {
  return `Subagent nesting limit reached (depth ${depth} of ${max}). Complete this task directly using your tools instead of spawning another agent. If the user explicitly requested deeper nesting, ask them to raise CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH.`
}

/** densable subagent_concurrency_cap message */
export function formatSubagentConcurrencyCapMessage(max: number): string {
  return `Concurrent subagent limit reached. You can run ${max} subagents at once. Do not retry. If the user wants more concurrent subagents, ask them to increase CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS.`
}

/**
 * densable AgentTool depth gate:
 *   m = cN(agentContext); g = Bue(); if (m >= g) throw depth_cap
 * Returns parent depth for childDepth = parent + 1.
 */
export function assertSubagentDepthAllowed(options?: {
  agentContext?: AgentContext | null
  env?: NodeJS.ProcessEnv
}): number {
  const parentDepth = getAgentContextDepth(options?.agentContext)
  const max = resolveMaxSubagentSpawnDepth(options?.env)
  if (parentDepth >= max) {
    throw new Error(formatSubagentDepthCapMessage(parentDepth, max))
  }
  return parentDepth
}

/**
 * densable P() concurrency preflight + B() take:
 *   Me = $vu()
 *   if getConcurrent < Me → take
 *   if GB tengu_amber_kestrel → bypass (no throw, no take? densable: return undefined from P → no throw)
 *   if G9(model, effort, ultracode) → bypass
 *   else throw concurrency_cap
 *
 * densable B: if P() truthy throw; else return takeConcurrencySlot()
 * Bypass paths: P returns undefined → B takes a slot anyway.
 * Only throw path skips take.
 */
export function assertAndTakeConcurrencySlot(options?: {
  env?: NodeJS.ProcessEnv
  mainLoopModel?: string
  effortValue?: EffortValue
  ultracode?: boolean
}): () => void {
  const max = resolveMaxConcurrentSubagents(options?.env)
  if (getConcurrentSubagents() < max) {
    return takeConcurrencySlot()
  }
  // densable: if(Ke("tengu_amber_kestrel",!1))return — cap disabled
  if (getFeatureValue_CACHED_MAY_BE_STALE(AMBER_KESTREL_FEATURE, false)) {
    return takeConcurrencySlot()
  }
  // densable G9(model, effort, ultracode) — ultracode mode ignores concurrent cap
  const model = options?.mainLoopModel
  if (
    model &&
    isUltracodeModeActive(model, options?.effortValue, options?.ultracode)
  ) {
    return takeConcurrencySlot()
  }
  throw new Error(formatSubagentConcurrencyCapMessage(max))
}

/**
 * densable AgentTool L(Me)/N():
 *   if aborted:
 *     if Me && q_(reason)==="interrupt" → continue (bg startup immunity)
 *     else throw AbortError-like
 *   at cap → throw message; else increment.
 *
 * densable: L(G&&!B) where G=async, B=remote — only local async spawns ignore
 * "interrupt" during the pre-register startup window (2.1.216 #15).
 */
export function assertCanSpawnSubagent(options?: {
  abortSignal?: AbortSignal
  env?: NodeJS.ProcessEnv
  /** densable Me — allow "interrupt" reason through for async local spawn */
  allowInterrupt?: boolean
  /**
   * densable 2.1.217 Hrr(maxBudgetUsd) gate — deny new agents once USD cap hit.
   * Pass toolUseContext.options.maxBudgetUsd from AgentTool.
   */
  maxBudgetUsd?: number
}): void {
  if (options?.abortSignal?.aborted) {
    // densable: if(!(Me&&Ze==="interrupt")) throw new wl
    if (
      !(
        options.allowInterrupt === true &&
        getAbortReasonMessage(options.abortSignal.reason) === 'interrupt'
      )
    ) {
      const err = new Error('Aborted')
      err.name = 'AbortError'
      throw err
    }
  }
  // densable: if(Hrr(Ze)) throw subagent_budget_exhausted
  // Lazy import avoids circular deps with cost-tracker ↔ session paths.
  if (options?.maxBudgetUsd !== undefined) {
    const { formatSubagentBudgetExhaustedMessage, isMaxBudgetUsdReached } =
      require('./budgetHalt.js') as typeof import('./budgetHalt.js')
    if (isMaxBudgetUsdReached(options.maxBudgetUsd)) {
      throw new Error(
        formatSubagentBudgetExhaustedMessage(options.maxBudgetUsd),
      )
    }
  }
  const max = resolveMaxSubagentsPerSession(options?.env)
  const used = getTotalAgentSpawns()
  if (used >= max) {
    throw new Error(
      `Subagent spawn limit reached (${used} of ${max} agents spawned). Complete the remaining work directly with your tools instead of spawning more agents. If more agents are genuinely needed, ask the user to raise CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION.`,
    )
  }
  incrementTotalAgentSpawns()
}

/** densable WebSearch soft budget message body (results[0] string). */
export function formatWebSearchSessionCapMessage(
  used: number,
  max: number,
): string {
  return `Web search was not performed: this session has used its web search budget (${used} of ${max} WebSearch calls). Continue with the information already gathered instead of issuing more searches. If more searches are genuinely needed, ask the user to raise CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION.`
}

/**
 * densable WebSearch preflight: if at cap, return soft-fail payload fields;
 * else increment and return null (caller proceeds).
 */
export function consumeWebSearchBudgetOrCapMessage(options?: {
  env?: NodeJS.ProcessEnv
}): { capped: true; used: number; max: number; message: string } | null {
  const max = resolveMaxWebSearchesPerSession(options?.env)
  const used = getWebSearchCalls()
  if (used >= max) {
    return {
      capped: true,
      used,
      max,
      message: formatWebSearchSessionCapMessage(used, max),
    }
  }
  incrementWebSearchCalls()
  return null
}
