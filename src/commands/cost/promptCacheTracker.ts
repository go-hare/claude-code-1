/**
 * densable 2.1.251 live prompt-cache tracker — gold `xhe` / `O6e` / `cL` /
 * `c$t` / `u$t` / `D6e` / `F6e` / `_8` / `_Gn` (gold-251-j).
 *
 * Bindings peeled next to the class body:
 *   Cb="main"; Ven=2000; Yen=200; tC=300000; D4=3600000;
 *   x6e={"5m":tC,"1h":D4}; psn=new Ln(()=>new O6e)
 *
 * Wire site (SEA @187342807): main-thread credit calls
 *   D6e(Cb,{at,ttl,inputTokens,cacheReadTokens,cacheCreationTokens})
 * when gh(agentContext)&&querySource startsWith repl_main_thread | ===sdk.
 * Local maps that onto addToTotalSessionCost for the main query sources.
 */
import { logError } from '../../utils/log.js'
import { getBootstrapSession, type Session } from '../../utils/sessionRoot.js'

/** densable `Cb` */
export const MAIN_PROMPT_CACHE_SCOPE = 'main' as const

/** densable `tC` / `D4` / `x6e` */
export const PROMPT_CACHE_TTL_MS = {
  '5m': 300_000,
  '1h': 3_600_000,
} as const

/** densable `Ven` — min non-cached residual tokens to call a miss */
const MISS_RESIDUAL_TOKENS = 2000
/** densable `Yen` — ring buffer cap */
const ENTRY_CAP = 200

export type PromptCacheTtlLabel = keyof typeof PROMPT_CACHE_TTL_MS

export type PromptCacheOutcome =
  | 'cold'
  | 'uncached'
  | 'expected'
  | 'miss'
  | 'hit'

export type PromptCacheRecordInput = {
  at: number
  ttl: PromptCacheTtlLabel
  inputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export type PromptCacheEntry = PromptCacheRecordInput & {
  outcome: PromptCacheOutcome
}

export type PromptCacheSummary = {
  requests: number
  hits: number
  misses: number
  expectedRebuilds: number
  coldStarts: number
  hitRatio: number | null
  cacheWriteTokens: number
  missRecacheTokens: number
  lastMissAt: number | null
  lastRequest: PromptCacheEntry | null
  cachingObserved: boolean
  lastActivityAt: number | null
  expiresAt: number | null
  warm: boolean
}

/**
 * densable `xhe` — per-scope accumulate.
 * Gold body: gold-251-j.md `xhe` @185033617.
 */
export class PromptCacheTracker {
  entries: PromptCacheEntry[] = []
  requests = 0
  hits = 0
  misses = 0
  expectedRebuilds = 0
  coldStarts = 0
  cacheReadTokens = 0
  cacheCreationTokens = 0
  inputTokens = 0
  missRecacheTokens = 0
  lastMissAt: number | null = null
  dropExpectedAt: number | null = null
  touchedAt: number | null = null

  touch(e: number): void {
    if (this.entries.length > 0) {
      this.touchedAt = Math.max(this.touchedAt ?? 0, e)
    }
  }

  expectDrop(e: number): void {
    this.dropExpectedAt = e
  }

  record(e: PromptCacheRecordInput): PromptCacheEntry {
    const t = this.entries.at(-1) ?? null
    const r = this.dropExpectedAt
    this.dropExpectedAt = null
    const o =
      r !== null &&
      t !== null &&
      e.at - Math.max(t.at, this.touchedAt ?? 0) < PROMPT_CACHE_TTL_MS[t.ttl]
    let u: PromptCacheOutcome
    const d =
      this.cacheReadTokens + this.cacheCreationTokens > 0 ||
      e.cacheReadTokens + e.cacheCreationTokens > 0
    if (t === null) u = 'cold'
    else if (!d) u = 'uncached'
    else if (
      t.cacheReadTokens + t.cacheCreationTokens === 0 &&
      e.cacheReadTokens + e.cacheCreationTokens > 0
    ) {
      u = 'cold'
    } else {
      const A = t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens
      const x = e.inputTokens + e.cacheReadTokens + e.cacheCreationTokens
      const O = Math.min(A, x)
      const F = O - e.cacheReadTokens
      u =
        e.cacheReadTokens < O * 0.95 && F >= MISS_RESIDUAL_TOKENS
          ? o
            ? 'expected'
            : 'miss'
          : 'hit'
    }
    const y = e.cacheCreationTokens === 0 && t !== null ? t.ttl : e.ttl
    const k: PromptCacheEntry = { ...e, ttl: y, outcome: u }
    this.entries.push(k)
    if (this.entries.length > ENTRY_CAP) this.entries.shift()
    this.requests++
    this.cacheReadTokens += e.cacheReadTokens
    this.cacheCreationTokens += e.cacheCreationTokens
    this.inputTokens += e.inputTokens
    switch (u) {
      case 'hit':
        this.hits++
        break
      case 'miss':
        this.misses++
        this.missRecacheTokens += e.cacheCreationTokens
        this.lastMissAt = e.at
        break
      case 'expected':
        this.expectedRebuilds++
        break
      case 'cold':
        this.coldStarts++
        break
      case 'uncached':
        break
    }
    return k
  }

  summary(e: number): PromptCacheSummary {
    const t = this.cacheReadTokens + this.cacheCreationTokens + this.inputTokens
    const r = this.entries.at(-1) ?? null
    const o = PROMPT_CACHE_TTL_MS[r?.ttl ?? '5m']
    const u = this.cacheReadTokens + this.cacheCreationTokens > 0
    const d = r !== null && r.cacheReadTokens + r.cacheCreationTokens > 0
    const y = r !== null ? Math.max(r.at, this.touchedAt ?? 0) : 0
    return {
      requests: this.requests,
      hits: this.hits,
      misses: this.misses,
      expectedRebuilds: this.expectedRebuilds,
      coldStarts: this.coldStarts,
      hitRatio: t > 0 ? this.cacheReadTokens / t : null,
      cacheWriteTokens: this.cacheCreationTokens,
      missRecacheTokens: this.missRecacheTokens,
      lastMissAt: this.lastMissAt,
      lastRequest: r,
      cachingObserved: u,
      lastActivityAt: r !== null ? y : null,
      expiresAt: r !== null && d ? y + o : null,
      warm: r !== null && d && e - y < o,
    }
  }
}

/**
 * densable `O6e` — per-session map of scope → `xhe`.
 * Gold body: gold-251-j.md `O6e` @185035774.
 */
export class PromptCacheSessionBag {
  #e = new Map<string, PromptCacheTracker>()

  record(e: string, t: PromptCacheRecordInput): PromptCacheEntry {
    let r = this.#e.get(e)
    if (r === undefined) {
      r = new PromptCacheTracker()
      this.#e.set(e, r)
    }
    return r.record(t)
  }

  expectDrop(e: string, t: number): void {
    this.#e.get(e)?.expectDrop(t)
  }

  touch(e: string, t: number): void {
    this.#e.get(e)?.touch(t)
  }

  summary(e: string, t: number): PromptCacheSummary {
    return (this.#e.get(e) ?? new PromptCacheTracker()).summary(t)
  }

  estimateRecacheTokens(e: string): number | null {
    const t = this.#e.get(e)
    const r = t?.entries.at(-1)
    if (!r) return 0
    if (t?.dropExpectedAt != null) return null
    return r.inputTokens + r.cacheReadTokens + r.cacheCreationTokens
  }

  clear(e?: string): void {
    if (e === undefined) this.#e.clear()
    else this.#e.delete(e)
  }
}

/**
 * densable `Ln` bag for `psn=new Ln(()=>new O6e)`.
 * Same root-keyed WeakMap shape as sessionRoot RootKeyedBag.
 */
class RootKeyedBag<T extends object> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: { root: object }): T {
    const t = e.root
    const o = this.#t.get(t)
    if (o !== undefined) return o
    const r = this.#e()
    this.#t.set(t, r)
    return r
  }
  drop(e: { root: object }): void {
    this.#t.delete(e.root)
  }
}

/** densable `psn` */
const promptCacheSessionBag = new RootKeyedBag(
  () => new PromptCacheSessionBag(),
)

/** densable `G()` → bootstrap session */
function sessionForBag(): Session {
  return getBootstrapSession()
}

/** densable `cL` */
export function getPromptCacheSessionBag(): PromptCacheSessionBag {
  return promptCacheSessionBag.of(sessionForBag())
}

/** densable `c$t` */
export function summarizePromptCache(
  e: string = MAIN_PROMPT_CACHE_SCOPE,
  t: number = Date.now(),
): PromptCacheSummary {
  return getPromptCacheSessionBag().summary(e, t)
}

/** densable `u$t` */
export function estimatePromptCacheRecacheTokens(
  e: string = MAIN_PROMPT_CACHE_SCOPE,
): number | null {
  return getPromptCacheSessionBag().estimateRecacheTokens(e)
}

/** densable `D6e` */
export function recordPromptCacheUsage(
  e: string,
  t: PromptCacheRecordInput,
): PromptCacheEntry | null {
  try {
    return getPromptCacheSessionBag().record(e, t)
  } catch (r) {
    logError(r)
    return null
  }
}

/** densable `F6e` */
export function touchPromptCache(e: string, t: number): void {
  try {
    getPromptCacheSessionBag().touch(e, t)
  } catch (r) {
    logError(r)
  }
}

/** densable `_8` */
export function expectPromptCacheDrop(
  e: string = MAIN_PROMPT_CACHE_SCOPE,
  t: number = Date.now(),
): void {
  try {
    getPromptCacheSessionBag().expectDrop(e, t)
  } catch (r) {
    logError(r)
  }
}

/**
 * densable `_Gn` body without the `au` subscribe side — call on session id
 * switch when reason is neither cd nor hydrate.
 */
export function clearPromptCacheOnSessionSwitch(reason?: string): void {
  if (reason === 'cd' || reason === 'hydrate') return
  getPromptCacheSessionBag().clear()
}

/** Test hook — drop the bag on the bootstrap session root. */
export function resetPromptCacheSessionBagForTests(): void {
  promptCacheSessionBag.drop(getBootstrapSession())
}

/**
 * densable main-thread gate for D6e:
 *   ut=gh(agentContext)&&(querySource.startsWith("repl_main_thread")||querySource==="sdk")
 * Local: no agent ALS ⇒ main; querySource main-thread family or sdk.
 */
export function shouldRecordMainPromptCache(
  querySource: string | undefined,
  agentContext: { agentType?: string } | undefined | null,
): boolean {
  const isMainAgent = agentContext == null || agentContext.agentType === 'main'
  if (!isMainAgent) return false
  if (querySource === undefined) return false
  return querySource.startsWith('repl_main_thread') || querySource === 'sdk'
}

/**
 * Resolve gold ttl label from usage.cache_creation ephemeral buckets or
 * the request's intended ttl (Sr).
 */
export function resolvePromptCacheRecordTtl(
  usage: {
    cache_creation?: {
      ephemeral_1h_input_tokens?: number | null
      ephemeral_5m_input_tokens?: number | null
    } | null
  },
  intendedTtl: PromptCacheTtlLabel | undefined,
): PromptCacheTtlLabel {
  const Ir = (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0
  const bo = (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0) > 0
  if (Ir) return '1h'
  if (bo) return '5m'
  return intendedTtl === '1h' ? '1h' : '5m'
}

/**
 * Build + record from a usage object (API message_delta / stop credit).
 * Returns null when the main-thread gate fails or record throws.
 */
export function recordPromptCacheFromUsage(
  usage: {
    input_tokens?: number | null
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
    cache_creation?: {
      ephemeral_1h_input_tokens?: number | null
      ephemeral_5m_input_tokens?: number | null
    } | null
  },
  opts: {
    querySource?: string
    agentContext?: { agentType?: string } | null
    intendedTtl?: PromptCacheTtlLabel
    at?: number
  } = {},
): PromptCacheEntry | null {
  if (!shouldRecordMainPromptCache(opts.querySource, opts.agentContext)) {
    return null
  }
  return recordPromptCacheUsage(MAIN_PROMPT_CACHE_SCOPE, {
    at: opts.at ?? Date.now(),
    ttl: resolvePromptCacheRecordTtl(usage, opts.intendedTtl),
    inputTokens: usage.input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  })
}
