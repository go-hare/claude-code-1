/**
 * densable taskRegistry counter subset — session runaway guards.
 *
 * densable 2.1.212: Etu/vtu + TotalAgentSpawns / WebSearchCalls (qpg/zpg=200)
 * densable 2.1.217: concurrent live slots ($vu/vBg=20)
 * densable 2.1.219: nest depth (Bue/_ee/qPu=3; was Evu=1 in 217)
 *
 * Concurrent slots: densable Xm instance `r` writes AppState.runningSubagents.
 * No-arg takeConcurrencySlot keeps a test-only process counter.
 * WebSearch: consume requires taskRegistry (Xm get/increment). Missing
 * registry does not fall back to the process module counter.
 *
 * 2.1.216 #15: L(Me) interrupt immunity for async local spawn (see assertCanSpawnSubagent).
 * 2.1.217 #18/#19: takeConcurrencySlot + CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { AppState } from 'src/state/AppState.js'
import { getAbortReasonMessage } from 'src/utils/abortController.js'
import type { AgentContext } from 'src/utils/agentContext.js'
import { logForDebugging } from 'src/utils/debug.js'
import { type EffortValue, isUltracodeModeActive } from 'src/utils/effort.js'
import { getBootstrapSession, RootSessionSlot } from 'src/utils/sessionRoot.js'
import { recordSubagentSpawnRefused } from 'src/utils/subagentSpawnLedger.js'
import { createTaskRegistry } from 'src/utils/taskRegistry.js'

/**
 * densable 2.1.212 qpg=200 default hard cap.
 * densable 2.1.224 #23: session subagent spawn hard cap removed — no default
 * ceiling. Env CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION still optional override.
 * Concurrent + depth limits unchanged.
 */
export const DEFAULT_MAX_SUBAGENTS_PER_SESSION = Number.POSITIVE_INFINITY
export const DEFAULT_MAX_WEB_SEARCHES_PER_SESSION = 200
/** official nt=100, bn=3600, yn="tengu_memoized_turtle" — WebSearch hourly refill */
export const DEFAULT_WEB_SEARCH_REFILLS_PER_HOUR = 100
export const MAX_WEB_SEARCH_REFILLS_PER_HOUR = 3600
export const WEB_SEARCH_REFILL_FEATURE = 'tengu_memoized_turtle'
const WEB_SEARCH_REFILL_WINDOW_MS = 3_600_000
/** densable vBg */
export const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 20
/** densable qPu/Evu (2.1.219) — main depth 0; default max 3 ⇒ nested spawn allowed */
export const DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH = 3
/** densable pBg */
export const HAZEL_TRELLIS_FEATURE = 'tengu_hazel_trellis'
/** densable tengu_amber_kestrel — concurrent cap kill-switch */
export const AMBER_KESTREL_FEATURE = 'tengu_amber_kestrel'

type SessionSpawnCapState = {
  totalAgentSpawns: number
  webSearchCalls: number
  /**
   * Test-only fallback counter. Production takeConcurrencySlot writes
   * AppState.runningSubagents via densable Xm (`createTaskRegistry`).
   */
  concurrentSubagents: number
  /** densable Hts — cache GB hazel once resolved per root session */
  hazelTrellisCache: number | null
}

const sessionSpawnCapSlot = new RootSessionSlot<SessionSpawnCapState>(() => ({
  totalAgentSpawns: 0,
  webSearchCalls: 0,
  concurrentSubagents: 0,
  hazelTrellisCache: null,
}))

function getSessionSpawnCapState(): SessionSpawnCapState {
  return sessionSpawnCapSlot.of(getBootstrapSession())
}

/**
 * densable 2.1.224 #23 — CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION when set;
 * else no session spawn ceiling (Infinity). Concurrent/depth still apply.
 */
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
  const state = getSessionSpawnCapState()
  if (state.hazelTrellisCache === null) {
    const r = getFeatureValue_CACHED_MAY_BE_STALE(
      HAZEL_TRELLIS_FEATURE,
      DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH,
    )
    state.hazelTrellisCache =
      typeof r === 'number' && Number.isInteger(r) && r >= 1
        ? r
        : DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH
  }
  return state.hazelTrellisCache
}

/** Test /clear helper — reset GB cache between cases */
export function resetHazelTrellisCache(): void {
  getSessionSpawnCapState().hazelTrellisCache = null
}

function parseSessionCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

// --- densable taskRegistry counter API ---

export function getTotalAgentSpawns(): number {
  return getSessionSpawnCapState().totalAgentSpawns
}

export function incrementTotalAgentSpawns(): number {
  const state = getSessionSpawnCapState()
  state.totalAgentSpawns += 1
  return state.totalAgentSpawns
}

export function resetTotalAgentSpawns(): void {
  getSessionSpawnCapState().totalAgentSpawns = 0
}

export function getWebSearchCalls(): number {
  return getSessionSpawnCapState().webSearchCalls
}

export function incrementWebSearchCalls(): number {
  const state = getSessionSpawnCapState()
  state.webSearchCalls += 1
  return state.webSearchCalls
}

export function resetWebSearchCalls(): void {
  getSessionSpawnCapState().webSearchCalls = 0
}

/** densable getConcurrentSubagents */
export function getConcurrentSubagents(): number {
  return getSessionSpawnCapState().concurrentSubagents
}

type ConcurrencySlotOptions = {
  /** densable Xm instance `r` — takeConcurrencySlot writes runningSubagents. */
  taskRegistry?: {
    takeConcurrencySlot(): () => void
  }
  getAppState?: () => AppState
  setAppState?: (updater: (prev: AppState) => AppState) => void
}

function resolveXmConcurrencyTake(
  options?: ConcurrencySlotOptions,
): (() => void) | undefined {
  if (options?.taskRegistry) {
    return options.taskRegistry.takeConcurrencySlot()
  }
  if (options?.getAppState && options?.setAppState) {
    return createTaskRegistry(
      options.getAppState,
      options.setAppState,
    ).takeConcurrencySlot()
  }
  return undefined
}

/**
 * densable Xm.takeConcurrencySlot():
 *   runningSubagents += 1
 *   return once-safe release () => runningSubagents = max(0, n-1)
 *
 * Production: require `taskRegistry` or `getAppState`+`setAppState` (Xm
 * instance). No-arg module counter is test-only.
 */
export function takeConcurrencySlot(
  options?: ConcurrencySlotOptions,
): () => void {
  const fromXm = resolveXmConcurrencyTake(options)
  if (fromXm) return fromXm
  // Production options without Xm: do not use the process module counter.
  if (options !== undefined) {
    let released = false
    return () => {
      if (released) return
      released = true
    }
  }
  // No-arg: test-only root-session counter.
  const state = getSessionSpawnCapState()
  state.concurrentSubagents += 1
  let released = false
  return () => {
    if (released) return
    released = true
    state.concurrentSubagents = Math.max(0, state.concurrentSubagents - 1)
  }
}

export function resetConcurrentSubagents(): void {
  getSessionSpawnCapState().concurrentSubagents = 0
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
    recordSubagentSpawnRefused('depth_limit')
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
  /** densable `e.taskRegistry` — takeConcurrencySlot / getConcurrentSubagents. */
  taskRegistry?: {
    getConcurrentSubagents(): number
    takeConcurrencySlot(): () => void
  }
  getAppState?: () => AppState
  setAppState?: (updater: (prev: AppState) => AppState) => void
}): () => void {
  const max = resolveMaxConcurrentSubagents(options?.env)
  const xm =
    options?.taskRegistry ??
    (options?.getAppState && options?.setAppState
      ? createTaskRegistry(options.getAppState, options.setAppState)
      : undefined)
  const concurrent = xm ? () => xm.getConcurrentSubagents() : () => 0
  // Production wrap: never fall back to the no-arg module counter.
  const take = xm
    ? () => xm.takeConcurrencySlot()
    : () =>
        takeConcurrencySlot({
          taskRegistry: options?.taskRegistry,
          getAppState: options?.getAppState,
          setAppState: options?.setAppState,
        })
  if (concurrent() < max) {
    return take()
  }
  // densable: if(Ke("tengu_amber_kestrel",!1))return — cap disabled
  if (getFeatureValue_CACHED_MAY_BE_STALE(AMBER_KESTREL_FEATURE, false)) {
    return take()
  }
  // densable G9(model, effort, ultracode) — ultracode mode ignores concurrent cap
  const model = options?.mainLoopModel
  if (
    model &&
    isUltracodeModeActive(model, options?.effortValue, options?.ultracode)
  ) {
    return take()
  }
  recordSubagentSpawnRefused('concurrency_limit')
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
      recordSubagentSpawnRefused('budget')
      throw new Error(
        formatSubagentBudgetExhaustedMessage(options.maxBudgetUsd),
      )
    }
  }
  // densable 2.1.224 #23: no default session spawn ceiling. Only enforce when
  // CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION sets a finite max.
  const max = resolveMaxSubagentsPerSession(options?.env)
  const used = getTotalAgentSpawns()
  if (Number.isFinite(max) && used >= max) {
    throw new Error(
      `Subagent spawn limit reached (${used} of ${max} agents spawned). Complete the remaining work directly with your tools instead of spawning more agents. If more agents are genuinely needed, ask the user to raise CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION.`,
    )
  }
  incrementTotalAgentSpawns()
}

/**
 * official _n({ refillsByDefault }) — resolve WebSearch refills/hour.
 * Env CLAUDE_CODE_WEB_SEARCH_REFILLS_PER_HOUR overrides; otherwise returns 0
 * unless refillsByDefault is true, in which case GB tengu_memoized_turtle
 * (integer 0..3600) or DEFAULT_WEB_SEARCH_REFILLS_PER_HOUR (100).
 */
export function resolveWebSearchRefillsPerHour(options?: {
  refillsByDefault?: boolean
  env?: NodeJS.ProcessEnv
}): number {
  const env = options?.env ?? process.env
  const rawEnv = env.CLAUDE_CODE_WEB_SEARCH_REFILLS_PER_HOUR
  if (rawEnv !== undefined && rawEnv !== '') {
    const n = /^\d+$/.test(rawEnv) ? Number(rawEnv) : Number(rawEnv)
    if (Number.isInteger(n) && n >= 0 && n <= MAX_WEB_SEARCH_REFILLS_PER_HOUR) {
      return n
    }
  }
  if (!options?.refillsByDefault) {
    return 0
  }
  const served = getFeatureValue_CACHED_MAY_BE_STALE(
    WEB_SEARCH_REFILL_FEATURE,
    DEFAULT_WEB_SEARCH_REFILLS_PER_HOUR,
  )
  const coerced =
    typeof served === 'string' && /^\d+$/.test(served) ? Number(served) : served
  if (
    typeof coerced === 'number' &&
    Number.isInteger(coerced) &&
    coerced >= 0 &&
    coerced <= MAX_WEB_SEARCH_REFILLS_PER_HOUR
  ) {
    return coerced
  }
  logForDebugging(
    `WebSearch budget: ignoring the served ${WEB_SEARCH_REFILL_FEATURE} value ${JSON.stringify(served)} (not an integer from 0 to ${MAX_WEB_SEARCH_REFILLS_PER_HOUR}); using ${DEFAULT_WEB_SEARCH_REFILLS_PER_HOUR} refills per hour`,
    { level: 'warn' },
  )
  return DEFAULT_WEB_SEARCH_REFILLS_PER_HOUR
}

export type WebSearchBudget = {
  tryConsume(): boolean
  msUntilNextCall(): number
  refillsPerHour(): number
}

/**
 * official wn({ refillsByDefault, now }) — token-bucket WebSearch budget
 * with 200-call burst cap and 100/hr default refill.
 */
export function createWebSearchBudget(options?: {
  refillsByDefault?: boolean
  now?: () => number
  env?: NodeJS.ProcessEnv
}): WebSearchBudget {
  const refillsByDefault = options?.refillsByDefault ?? false
  const now = options?.now ?? (() => Date.now())
  const env = options?.env
  let used = 0
  let carryMs = 0
  let lastAt = now()
  let rate = resolveWebSearchRefillsPerHour({ refillsByDefault, env })

  function refill(): void {
    const current = now()
    const nextRate = resolveWebSearchRefillsPerHour({ refillsByDefault, env })
    const effectiveRate = Math.min(nextRate, rate)
    rate = nextRate
    const elapsed = Math.max(0, current - lastAt)
    lastAt = current
    if (used === 0) {
      carryMs = 0
      return
    }
    carryMs += elapsed * effectiveRate
    const recovered = Math.floor(carryMs / WEB_SEARCH_REFILL_WINDOW_MS)
    if (recovered >= used) {
      used = 0
      carryMs = 0
      return
    }
    used -= recovered
    carryMs -= recovered * WEB_SEARCH_REFILL_WINDOW_MS
  }

  return {
    tryConsume(): boolean {
      refill()
      const max = resolveMaxWebSearchesPerSession(env)
      if (used >= max) {
        return false
      }
      used++
      return true
    },
    msUntilNextCall(): number {
      refill()
      const max = resolveMaxWebSearchesPerSession(env)
      const over = used - max
      if (over < 0) return 0
      if (rate === 0) return Infinity
      const needed = (over + 1) * WEB_SEARCH_REFILL_WINDOW_MS - carryMs
      return Math.max(1, Math.ceil(needed / rate))
    },
    refillsPerHour(): number {
      return rate
    },
  }
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
 *
 * Gold cap is Xm instance `r` (`taskRegistry`) only — not the process
 * module counter. Missing registry: used=0, no increment.
 */
export function consumeWebSearchBudgetOrCapMessage(options?: {
  env?: NodeJS.ProcessEnv
  taskRegistry?: {
    getWebSearchCalls(): number
    incrementWebSearchCalls(): void
  }
}): { capped: true; used: number; max: number; message: string } | null {
  const max = resolveMaxWebSearchesPerSession(options?.env)
  const registry = options?.taskRegistry
  const used = registry ? registry.getWebSearchCalls() : 0
  if (used >= max) {
    return {
      capped: true,
      used,
      max,
      message: formatWebSearchSessionCapMessage(used, max),
    }
  }
  if (registry) {
    registry.incrementWebSearchCalls()
  }
  return null
}
