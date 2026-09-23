/**
 * densable 2.1.251 #1 — hdt/ydt/KSn callees.
 * Hook execution stays on existing executeHooks (local z_/Xxt/Qxt).
 */
import { randomUUID } from 'crypto'
import { promptCacheCommandFields } from '../../commands/cost/promptCacheStatus.js'
import type {
  AssistantMessage,
  HookResultMessage,
  Message,
} from '../../types/message.js'
import { logForDebugging } from '../debug.js'
import { calculateCostFromTokens } from '../modelCost.js'
import { isModelAlias, isModelFamilyAlias } from '../model/aliases.js'
import { getMainLoopModel } from '../model/model.js'
import { getCompiledOrgPricing, lookupOrgModelCosts } from '../modelPricing.js'
import { recognizePrintModel } from '../model/printSetModel.js'
import {
  findLastCompactBoundaryIndex,
  isCompactBoundaryMessage,
  SYNTHETIC_MODEL,
} from '../messages.js'
import {
  clearPluginHookCache,
  getPluginHookRegistration,
  loadPluginHooks,
} from '../plugins/loadPluginHooks.js'
import { resolvePromptCacheTtlOverride } from '../promptCacheTtl.js'
import { getBootstrapSession } from '../sessionRoot.js'
import {
  getTokenCountFromUsage,
  getTokenUsage,
  tokenCountWithEstimation,
} from '../tokens.js'

/** densable Hye — Pre/Post model-switch default timeout. */
export const Hye = 30_000

export type ModelSwitchRequest = {
  fromModel: string
  toModel: string
  requestedModel: string | null
  source: string
}

export type ModelSwitchCacheFields = {
  context_tokens: number
  prompt_cache_warm: boolean
  cache_ttl: '5m' | '1h'
  estimated_cache_write_usd: number
  pricing: 'configured' | 'catalog' | 'default'
}

export type ResumeCacheFields = {
  seconds_since_last_response: number
  context_tokens: number
  prompt_cache_likely_expired: boolean
  estimated_cache_write_usd: number
}

export type PostModelSwitchPending = {
  sessionId: string
  toModel: string
  contexts: string[]
  messages: HookResultMessage[]
}

/** densable Ln — WeakMap keyed by session.root. */
class Ln<T> {
  #factory: () => T
  #byRoot = new WeakMap<object, T>()

  constructor(factory: () => T) {
    this.#factory = factory
  }

  of(session: { root: object }): T {
    const root = session.root
    const existing = this.#byRoot.get(root)
    if (existing !== undefined) return existing
    const created = this.#factory()
    this.#byRoot.set(root, created)
    return created
  }
}

/** densable gEt */
export class ModelSwitchPostStore {
  pending: PostModelSwitchPending[] = []
  landedOn: { sessionId: string; toModel: string } | null = null
  inFlight = new Set<Promise<void>>()
}

/** densable Kle */
export const Kle = new Ln(() => ({ registry: undefined as unknown }))

/** densable yEt */
export const yEt = new Ln(() => new ModelSwitchPostStore())

/** densable Osn */
export function Osn(): Promise<unknown> | undefined {
  return getPluginHookRegistration().hookRegistrationInFlight?.catch(() => {})
}

/** densable Lsn — Pre retries once via local fY (loadPluginHooks). */
export async function Lsn(retry: boolean): Promise<boolean> {
  const t = getPluginHookRegistration()
  await t.hookRegistrationInFlight?.catch(() => {})
  if (!t.hookRegistrationFailed) return false
  if (retry && !t.hookRegistrationRetried) {
    t.hookRegistration = undefined
    logForDebugging('plugin hook registration retry')
    clearPluginHookCache()
    await loadPluginHooks().catch(() => {})
    await t.hookRegistrationInFlight?.catch(() => {})
    t.hookRegistrationRetried = true
  }
  return t.hookRegistrationFailed
}

/** densable nVn */
export function nVn(): boolean {
  const e = getPluginHookRegistration()
  return e.hookRegistrationInFlight !== undefined || e.hookRegistrationFailed
}

/** densable yBn */
export function yBn(
  message: HookResultMessage | undefined,
  collected: string[],
): void {
  if (message?.type !== 'attachment') return
  const r = message.attachment
  if (!r || typeof r !== 'object' || !('type' in r)) return
  if (r.type === 'hook_system_message') {
    const content = 'content' in r ? r.content : undefined
    if (typeof content === 'string') collected.push(content)
    return
  }
  if (r.type === 'hook_non_blocking_error') {
    const stderr =
      'stderr' in r && typeof r.stderr === 'string' ? r.stderr.trim() : ''
    const hookName =
      'hookName' in r && typeof r.hookName === 'string' ? r.hookName : ''
    collected.push(
      `PreModelSwitch hook ${hookName} failed${stderr ? `: ${stderr}` : ''}`,
    )
  }
}

function compactAnchorUuid(message: {
  compactMetadata: {
    preservedSegment?: { anchorUuid?: string }
    [key: string]: unknown
  }
}): string | undefined {
  const preserved = message.compactMetadata.preservedMessages
  if (preserved && typeof preserved === 'object' && 'anchorUuid' in preserved) {
    const id = preserved.anchorUuid
    if (typeof id === 'string') return id
  }
  return message.compactMetadata.preservedSegment?.anchorUuid
}

/** densable $sn */
export function contextTokensAfterCompact(messages: Message[]): number {
  const t = findLastCompactBoundaryIndex(messages)
  for (let o = messages.length - 1; o > t; o--) {
    const u = messages[o]
    if (u?.type !== 'assistant') continue
    const d = getTokenUsage(u)
    const y = d ? getTokenCountFromUsage(d) : 0
    if (y > 0) return y
  }
  const r = t === -1 ? undefined : messages[t]
  if (r !== undefined && isCompactBoundaryMessage(r)) {
    const post = r.compactMetadata.postTokens
    if (typeof post === 'number') return post
    return tokenCountWithEstimation(messages.slice(t + 1))
  }
  return tokenCountWithEstimation(messages)
}

/** densable Y_e */
export function lastRealAssistant(
  messages: Message[],
): AssistantMessage | undefined {
  return messages.findLast((t): t is AssistantMessage => {
    if (t.type !== 'assistant' || t.message === undefined) return false
    return t.message.model !== SYNTHETIC_MODEL
  })
}

function resolveCacheTtl(): '5m' | '1h' {
  return resolvePromptCacheTtlOverride('repl_main_thread')?.ttl ?? '5m'
}

function pricingForModel(model: string): 'configured' | 'catalog' | 'default' {
  const compiled = getCompiledOrgPricing()
  if (compiled && lookupOrgModelCosts(compiled, model)) {
    return 'configured'
  }
  return recognizePrintModel(model).recognized ? 'catalog' : 'default'
}

/** densable vwe */
export function vwe(
  model: string,
  tokens: number,
  ttl: '5m' | '1h' = resolveCacheTtl(),
): Pick<
  ModelSwitchCacheFields,
  'cache_ttl' | 'estimated_cache_write_usd' | 'pricing'
> {
  const usd = calculateCostFromTokens(model, {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: tokens,
    cacheCreation1hInputTokens: ttl === '1h' ? tokens : 0,
  })
  return {
    cache_ttl: ttl,
    estimated_cache_write_usd: Math.round(usd * 1e4) / 1e4,
    pricing: pricingForModel(model),
  }
}

/** densable VSn */
export function isCacheWarmAnchor(messages: Message[]): boolean {
  const t = findLastCompactBoundaryIndex(messages)
  if (t === -1) return true
  for (let u = messages.length - 1; u > t; u--) {
    const d = messages[u]
    if (d?.type !== 'assistant') continue
    const y = getTokenUsage(d)
    if (y && getTokenCountFromUsage(y) > 0) return true
  }
  const r = messages[t]
  if (r === undefined || !isCompactBoundaryMessage(r)) return false
  const o = compactAnchorUuid(r)
  return o !== undefined && o === r.uuid
}

/**
 * densable gRn. Local RequestJournal has no applyResumeSeed /
 * stageResumeSeed — write path LEFT (ABSENT), not invented.
 */
export function gRn(_seed: {
  sessionId?: string
  contextTokens: number
  requestAt: number | null
  ttlMs: number | null
}): void {}

/** densable Ewe — jw cache fields for Pre/Post. */
export function Ewe(
  toModel: string,
  contextTokens = 0,
): ModelSwitchCacheFields {
  return {
    context_tokens: contextTokens,
    prompt_cache_warm: Boolean(promptCacheCommandFields().prompt_cache?.warm),
    ...vwe(toModel, contextTokens),
  }
}

/** densable KSn — resume cache fields (also seeds gRn when present). */
export function KSn(
  messages: Message[],
  model: string | undefined,
  sessionId: string,
): Partial<ResumeCacheFields> {
  const o = contextTokensAfterCompact(messages)
  const seed = (requestAt: number | null, ttlMs: number | null) => {
    gRn({ sessionId, contextTokens: o, requestAt, ttlMs })
  }
  const d = lastRealAssistant(messages)
  const rawTs = d && 'timestamp' in d ? d.timestamp : undefined
  const y = typeof rawTs === 'string' ? Date.parse(rawTs) : NaN
  if (!d || Number.isNaN(y)) {
    seed(null, null)
    return {}
  }
  const k = Math.max(0, Math.round((Date.now() - y) / 1000))
  const modelId =
    model ??
    (typeof d.message.model === 'string' ? d.message.model : undefined) ??
    getMainLoopModel()
  const A = vwe(modelId, o)
  const x = A.cache_ttl === '1h' ? 3600 : 300
  const O = isCacheWarmAnchor(messages) ? y : NaN
  const F = Number.isNaN(O)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.round((Date.now() - O) / 1000))
  seed(Number.isNaN(O) ? null : O, Number.isNaN(O) ? null : x * 1000)
  return {
    seconds_since_last_response: k,
    context_tokens: o,
    prompt_cache_likely_expired: F >= x,
    estimated_cache_write_usd: A.estimated_cache_write_usd,
  }
}

/** densable cre — profile without a resolved backing string. */
export function cre(model: string): boolean {
  if (!model.includes('application-inference-profile')) return false
  const map =
    getBootstrapSession().host.requestLatches.inferenceProfileBackingModels()
  const backing = map.get(model)
  return typeof backing !== 'string'
}

/**
 * densable hJ. `_I` fetch is ABSENT locally — return the cached
 * backing entry only; do not invent a Bedrock profile resolver.
 */
export function hJ(model: string): unknown {
  const map =
    getBootstrapSession().host.requestLatches.inferenceProfileBackingModels()
  return map.get(model)
}

/** densable LOe / DOe — alias or family matcher. */
export function LOe(model: string): boolean {
  const t = model.trim().toLowerCase()
  return isModelAlias(t) || isModelFamilyAlias(t)
}

/** densable pEt stand-in — gold Kt(we(), GXe) is ABSENT. */
export function modelSwitchToolUseId(): string {
  return randomUUID()
}

export function getModelSwitchSession(): {
  id: string
  root: object
} {
  return getBootstrapSession()
}
