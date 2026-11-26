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

import { createHash } from 'crypto'
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
import { getBootstrapSession, RootSessionSlot } from './sessionRoot.js'

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

const MEDIA_REMOVED_PREFIX = '[media removed: request limit.'
const MEDIA_REMOVED_SUFFIX =
  "Re-reading pushes out others and re-sends everything, so don't re-read them all.]"

/** Official 2.1.321 `PUs` (#1929): placeholder when the model already saw this image/document. */
export const MEDIA_REMOVED_SEEN_TEXT = `${MEDIA_REMOVED_PREFIX} You have already seen this, and what you concluded from it still stands. It made room for newer images and documents. ${MEDIA_REMOVED_SUFFIX}`

/** Official 2.1.321 `OUs` (#1929): placeholder when the image/document never fit in a prior request. */
export const MEDIA_REMOVED_UNSEEN_TEXT = `${MEDIA_REMOVED_PREFIX} You have not seen this: it did not fit in the request. If you need it, get it again once, by itself. If it is dropped again, go on without it and say so. ${MEDIA_REMOVED_SUFFIX}`

/** Official 2.1.321 `zwt` (#1929): fallback placeholder when seen state is unknown. */
export const MEDIA_REMOVED_FALLBACK_TEXT = `${MEDIA_REMOVED_PREFIX} If you have seen this, what you concluded from it still stands. ${MEDIA_REMOVED_SUFFIX}`

/**
 * Official 2.1.321 `JOo(msgIndex, lastAssistantIndex)` (#1929):
 * Distinguish seen (`lastAssistantIndex > msgIndex`) vs unseen media placeholders.
 */
export function getMediaRemovedPlaceholderText(
  messageIndex: number,
  lastAssistantIndex: number,
): string {
  return lastAssistantIndex > messageIndex
    ? MEDIA_REMOVED_SEEN_TEXT
    : MEDIA_REMOVED_UNSEEN_TEXT
}

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
 * Official 2.1.321 (#1929): count stripped blocks whose `type === 'image'`
 * for feeding `noteImageMediaStripped(agentId, strippedImageCount)`.
 */
export function countStrippedImageBlocks(
  blocks: readonly { type: string }[],
): number {
  let images = 0
  for (const block of blocks) {
    if (block.type === 'image') images += 1
  }
  return images
}

/**
 * densable HWT / official 2.1.325 `eKn` — strip stored image/document blocks
 * (including nested tool_result content) past keepCount, with optional byteLimit.
 *
 * Predicate: `i>0 || (a>0 && m>0)` (JS `||`/`&&` precedence).
 * Empty **message** content after strip → placeholder text block.
 * Nested tool_result emptied of media stays an empty array (no nested placeholder).
 * Immutable: returns a new array when anything is stripped.
 *
 * When `strippedOut` is provided, each evicted media block is pushed into it
 * so callers (e.g. `claude.ts`) can notify `noteImageMediaStripped` (#1929).
 */
export function stripStoredMediaForRequestLimit<T>(
  messages: T[],
  keepCount: number,
  keepPadding = 0,
  byteLimit = Number.POSITIVE_INFINITY,
  bytePadding = 0,
  strippedOut?: Array<{ type: string }>,
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
      strippedOut?.push(block)
      return true
    }
    return false
  }

  // Official 2.1.321 (#1929): determine the last real assistant message index
  // so evicted media before it uses the "You have already seen this..." text
  // and evicted media at/after it uses "You have not seen this...".
  let lastAssistantIndex = -1
  for (let idx = messages.length - 1; idx >= 0; idx--) {
    const candidate = messages[idx] as {
      type?: string
      message?: { role?: string }
    }
    if (
      candidate?.type === 'assistant' ||
      candidate?.message?.role === 'assistant'
    ) {
      lastAssistantIndex = idx
      break
    }
  }

  const next = messages.map((msg, msgIndex) => {
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
    const placeholderText = getMediaRemovedPlaceholderText(
      msgIndex,
      lastAssistantIndex,
    )
    const y =
      stripped.length > 0 ? stripped : [{ type: 'text', text: placeholderText }]
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

/**
 * Official 2.1.321 #1929 (`Wit=3`, `k$r=60`, `S$r=48`, `O_o`, `zbn`, `w$r`):
 * Limit repeated reads of the exact same unchanged image once a conversation
 * has stripped images/documents to fit within request limits.
 *
 * Lives in this leaf module (and re-exported by FileReadTool) to avoid a
 * static cycle `claude.ts -> FileReadTool.ts -> tokenEstimation.ts -> claude.ts`.
 */
export const UNCHANGED_IMAGE_REREAD_LIMIT = 3 // Wit
const IMAGE_REREAD_WINDOW_SIZE = 60 // k$r
const IMAGE_REREAD_RECENT_THRESHOLD = 48 // S$r
const IMAGE_REREAD_KILLSWITCH = 'tengu_brisk_otter'

export const UNCHANGED_IMAGE_REREAD_REFUSAL_REASON =
  'Read of an unchanged image refused past its limit'

export const UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE = `Image not read again: Read has already returned this unchanged image at least ${UNCHANGED_IMAGE_REREAD_LIMIT} times, most of your recent image reads were of images you had already read, and this conversation holds more images and documents than one request can carry, so each re-read pushes out others and re-sends the conversation. Work from what you have already seen, and keep fewer images in play at once. If you cannot go on without this image, say so in your reply.`

type ImageRereadState = {
  returned: Map<string, number>
  contents: Set<string>
  recent: boolean[]
  mediaStripped: boolean
  reportedStrip: boolean
  refused: boolean
}

const imageRereadStatesSlot = new RootSessionSlot(
  () => new Map<string, ImageRereadState>(),
)

function getImageRereadStates(): Map<string, ImageRereadState> {
  return imageRereadStatesSlot.of(getBootstrapSession())
}

function getImageRereadState(agentKey: string): ImageRereadState {
  const imageRereadStates = getImageRereadStates()
  let state = imageRereadStates.get(agentKey)
  if (state === undefined) {
    state = {
      returned: new Map(),
      contents: new Set(),
      recent: [],
      mediaStripped: false,
      reportedStrip: false,
      refused: false,
    }
    imageRereadStates.set(agentKey, state)
  }
  return state
}

/**
 * Official 2.1.325 #1929: decide whether an API request's stripped media count
 * should update `imageRereadStates`. Matches main thread (`repl_main_thread`
 * including `:outputStyle:...` suffixes), `sdk`, and named subagents
 * (`agent:*` with `agentId`), while excluding auxiliary requests without a
 * `querySource`.
 */
export function shouldTrackImageMediaStripped(
  querySource: string | undefined,
  agentId: string | undefined,
): boolean {
  return Boolean(
    querySource &&
      (querySource.startsWith('repl_main_thread') ||
        querySource === 'sdk' ||
        (querySource.startsWith('agent:') && agentId !== undefined)),
  )
}

export function noteImageMediaStripped(
  agentId: string | undefined,
  strippedCount: number,
): void {
  const key = agentId ?? 'main'
  if (strippedCount === 0) {
    const existing = getImageRereadStates().get(key)
    if (existing !== undefined) {
      existing.mediaStripped = false
    }
    return
  }
  const state = getImageRereadState(key)
  state.mediaStripped = true
  state.reportedStrip = true
}

export function resetImageRereadState(agentId?: string): void {
  const imageRereadStates = getImageRereadStates()
  if (agentId === undefined) {
    imageRereadStates.clear()
  } else {
    imageRereadStates.delete(agentId)
  }
}

export function checkUnchangedImageRereadLimit(
  agentId: string | undefined,
  fullFilePath: string,
  base64: string,
): string | undefined {
  const key = agentId ?? 'main'
  const state = getImageRereadState(key)
  const contentHash = createHash('sha256').update(base64).digest('hex')
  const mapKey = `${fullFilePath}\0${contentHash}`
  const count = state.returned.get(mapKey) ?? 0
  state.recent.push(state.contents.has(contentHash))
  state.contents.add(contentHash)
  if (state.recent.length > IMAGE_REREAD_WINDOW_SIZE) {
    state.recent.shift()
  }
  const recentRepeatCount = state.recent.filter(Boolean).length
  if (
    count >= UNCHANGED_IMAGE_REREAD_LIMIT &&
    recentRepeatCount >= IMAGE_REREAD_RECENT_THRESHOLD &&
    state.mediaStripped &&
    !getFeatureValue_CACHED_MAY_BE_STALE(IMAGE_REREAD_KILLSWITCH, false)
  ) {
    state.refused = true
    return UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE
  }
  state.returned.set(mapKey, count + 1)
  return undefined
}

export class UnchangedImageRereadLimitError extends Error {
  readonly telemetryMessage = UNCHANGED_IMAGE_REREAD_REFUSAL_REASON
  constructor(message: string) {
    super(message)
    this.name = 'UnchangedImageRereadLimitError'
  }
}
