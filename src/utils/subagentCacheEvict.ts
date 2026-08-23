/**
 * Official vNy — CLAUDE_CODE_SUBAGENT_CACHE_EVICT / tengu_subagent_cache_evict.
 *
 * When enabled, subagent image/document tool results may be evicted from the
 * prompt cache more aggressively. Full eviction wiring stays in the cache
 * path; this is the portable gate.
 *
 * densable 2.1.238 HWT — nested tool_result media strip for request-limit
 * (keep-count + optional byte cap). Immutable map; placeholder only when the
 * whole message content is emptied. Does NOT invent a display-window GC.
 */

import { logEvent } from '../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { API_REQUEST_BODY_MAX_SIZE } from '../constants/apiLimits.js'
import { CONTEXT_1M_BETA_HEADER } from '../constants/betas.js'
import {
  getSonnet1mExpTreatmentEnabled,
  has1mContext,
  modelSupports1M,
} from './context.js'
import { isEnvTruthy } from './envUtils.js'
import { getAPIProvider } from './model/providers.js'

/**
 * @param prerequisites both official wN() and Wqt() must already be true
 *   (caller supplies — typically feature + model support).
 */
export function isSubagentCacheEvictEnabled(input: {
  prerequisitesMet: boolean
  env?: NodeJS.ProcessEnv
  gbValue?: boolean
}): boolean {
  if (!input.prerequisitesMet) return false
  const env = input.env ?? process.env
  if (env.CLAUDE_CODE_SUBAGENT_CACHE_EVICT !== undefined) {
    return isEnvTruthy(env.CLAUDE_CODE_SUBAGENT_CACHE_EVICT)
  }
  if (input.gbValue !== undefined) return input.gbValue
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_subagent_cache_evict',
    false,
  )
}

/** Official sSo / e8i — media blocks that participate in cache eviction. */
export function isEvictableMediaBlock(block: { type: string }): boolean {
  return block.type === 'image' || block.type === 'document'
}

/** densable oOl — throws if `source` is missing (same as `e.source.type`). */
function mediaBlockBytes(block: {
  source?: { type?: string; data?: string }
}): number {
  const source = (block as { source: { type: string; data: string } }).source
  return source.type === 'base64' ? source.data.length : 0
}

const MEDIA_REMOVED_PLACEHOLDER = [
  { type: 'text', text: '[media removed: request limit]' },
] as const

type ContentBlock = {
  type: string
  source?: { type?: string; data?: string }
  content?: unknown
  [key: string]: unknown
}

/** densable vNp / TNp / wNp / kNp / CNp / ENp */
export const HWT_KEEP_COUNT = 100
export const HWT_KEEP_COUNT_1M = 600
export const HWT_KEEP_PADDING = 20
/** densable CNp = q3r-8MiB (first-party request body minus 8MiB headroom). */
export const HWT_BYTE_CAP_1P = API_REQUEST_BODY_MAX_SIZE - 8_388_608
/** densable ENp */
export const HWT_BYTE_CAP_3P = 78_643_200
export const HWT_BYTE_PADDING = 10_485_760

/**
 * densable qWT keep-count predicate:
 * kE(model) || IU(model) || betas.includes(R7) || h8o(model)!==null || sDn(model)
 * (sDn is unconditionally false in 2.1.238).
 */
export function getRequestLimitMediaKeepCount(
  model: string,
  betas: string[] = [],
): number {
  const oneM =
    has1mContext(model) ||
    modelSupports1M(model) ||
    betas.includes(CONTEXT_1M_BETA_HEADER) ||
    getSonnet1mExpTreatmentEnabled(model)
  return oneM ? HWT_KEEP_COUNT_1M : HWT_KEEP_COUNT
}

/**
 * densable NWT — `it("tengu_media_byte_cap", ZQt()?CNp:ENp)`.
 * ZQt ≈ first-party Anthropic (not 3P providers).
 */
export function getRequestLimitMediaByteCap(): number {
  const firstParty = getAPIProvider() === 'firstParty'
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_media_byte_cap',
    firstParty ? HWT_BYTE_CAP_1P : HWT_BYTE_CAP_3P,
  )
}

/**
 * densable HWT — strip stored image/document blocks (including nested
 * tool_result content) past keepCount, with optional byteLimit.
 *
 * Predicate: `i>0 || (a>0 && m>0)` (JS `||`/`&&` precedence).
 * Empty **message** content after strip → placeholder text block.
 * Nested tool_result emptied of media stays an empty array (no nested placeholder).
 * Immutable: returns a new array when anything is stripped.
 */
export function stripStoredMediaForRequestLimit<T>(
  messages: T[],
  keepCount: number,
  keepPadding = 0,
  byteLimit = Number.POSITIVE_INFINITY,
  bytePadding = 0,
): T[] {
  let mediaCount = 0
  let totalBytes = 0
  for (const msg of messages) {
    const content = (msg as { message?: { content?: unknown } })?.message
      ?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as ContentBlock
      if (isEvictableMediaBlock(b)) {
        mediaCount += 1
        totalBytes += mediaBlockBytes(b)
      }
      if (b.type === 'tool_result' && Array.isArray(b.content)) {
        for (const nested of b.content) {
          if (
            nested &&
            typeof nested === 'object' &&
            isEvictableMediaBlock(nested as ContentBlock)
          ) {
            mediaCount += 1
            totalBytes += mediaBlockBytes(nested as ContentBlock)
          }
        }
      }
    }
  }

  let remainingKeep = mediaCount - keepCount
  const byteOverflow = byteLimit > 0 ? totalBytes - byteLimit : -1
  let remainingBytes = byteOverflow
  if (remainingKeep <= 0 && remainingBytes <= 0) return messages
  if (remainingKeep > 0) remainingKeep += keepPadding
  const byteCapTriggered = remainingBytes > 0
  if (byteCapTriggered) remainingBytes += bytePadding

  let removedCount = 0
  let removedBytes = 0
  const shouldStrip = (block: ContentBlock): boolean => {
    const m = mediaBlockBytes(block)
    // densable: i>0 || a>0 && m>0  →  i>0 || (a>0 && m>0)
    if (remainingKeep > 0 || (remainingBytes > 0 && m > 0)) {
      remainingKeep -= 1
      remainingBytes -= m
      removedCount += 1
      removedBytes += m
      return true
    }
    return false
  }

  const next = messages.map(msg => {
    if (remainingKeep <= 0 && remainingBytes <= 0) return msg
    const rec = msg as { message?: { content?: unknown } }
    const content = rec.message?.content
    if (!Array.isArray(content)) return msg
    const removedBefore = removedCount
    const stripped = content
      .map(block => {
        if (remainingKeep <= 0 && remainingBytes <= 0) return block
        if (!block || typeof block !== 'object') return block
        const b = block as ContentBlock
        if (b.type !== 'tool_result' || !Array.isArray(b.content)) return block
        const nested = (b.content as ContentBlock[]).filter(
          v => !(isEvictableMediaBlock(v) && shouldStrip(v)),
        )
        return nested.length === b.content.length
          ? block
          : { ...b, content: nested }
      })
      .filter(block => {
        if (!block || typeof block !== 'object') return true
        const b = block as ContentBlock
        return !(isEvictableMediaBlock(b) && shouldStrip(b))
      })
    if (removedBefore === removedCount) return msg
    const y = stripped.length > 0 ? stripped : [...MEDIA_REMOVED_PLACEHOLDER]
    return {
      ...rec,
      message: { ...rec.message, content: y },
    } as T
  })

  if (byteCapTriggered) {
    logEvent('tengu_media_byte_cap_stripped', {
      totalBytes,
      byteLimit,
      removedCount,
      removedBytes,
    })
  }
  return next
}
