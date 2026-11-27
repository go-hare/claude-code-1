/**
 * UI message normalization, single-message memoization cache, and IncrementalNormalizer.
 */

import type { UUID } from 'crypto'
import type {
  AssistantMessage,
  Message,
  MessageOrigin,
  NormalizedAssistantMessage,
  NormalizedMessage,
  NormalizedUserMessage,
  UserMessage,
} from '../../types/message.js'
import { createUserMessage } from './factories.js'
import { isNotEmptyMessage } from './messageQueries.js'

// Deterministic UUID derivation. Produces a stable UUID-shaped string from a
// parent UUID + content block index so that the same input always produces the
// same key across calls. Used by normalizeMessages and synthetic message creation.
export function deriveUUID(parentUUID: UUID, index: number): UUID {
  const hex = index.toString(16).padStart(12, '0')
  return `${parentUUID.slice(0, 24)}${hex}` as UUID
}

function extractMutableBlockText(block: unknown): string | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  if (
    'text' in block &&
    typeof (block as { text?: unknown }).text === 'string'
  ) {
    return (block as { text: string }).text
  }
  if (
    'thinking' in block &&
    typeof (block as { thinking?: unknown }).thinking === 'string'
  ) {
    return (block as { thinking: string }).thinking
  }
  return undefined
}

function normalizeSingleMessage(
  message: Message,
  prevIsNewChain: boolean,
): { normalized: NormalizedMessage[]; nextIsNewChain: boolean } {
  if (!message) {
    return { normalized: [], nextIsNewChain: prevIsNewChain }
  }
  let isNewChain = prevIsNewChain
  switch (message.type) {
    case 'assistant': {
      const aMsg = message as AssistantMessage
      const assistantContent = Array.isArray(aMsg.message.content)
        ? aMsg.message.content
        : []
      isNewChain = isNewChain || assistantContent.length > 1
      const normalized = assistantContent.map((_, index) => {
        const uuid = isNewChain ? deriveUUID(message.uuid, index) : message.uuid
        return {
          type: 'assistant' as const,
          timestamp: message.timestamp,
          message: {
            ...aMsg.message,
            content: [_],
            context_management: aMsg.message.context_management ?? null,
          },
          isMeta: message.isMeta,
          isVirtual: message.isVirtual,
          requestId: message.requestId,
          uuid,
          error: message?.error,
          isApiErrorMessage: message.isApiErrorMessage,
          truncatedAfterOutput: message.truncatedAfterOutput,
          advisorModel: message.advisorModel,
        } as NormalizedAssistantMessage
      })
      return { normalized, nextIsNewChain: isNewChain }
    }
    case 'attachment':
      return { normalized: [message], nextIsNewChain: isNewChain }
    case 'progress':
      return { normalized: [message], nextIsNewChain: isNewChain }
    case 'system':
      return { normalized: [message], nextIsNewChain: isNewChain }
    case 'user': {
      const uMsg = message as UserMessage
      if (typeof uMsg.message.content === 'string') {
        const uuid = isNewChain ? deriveUUID(uMsg.uuid, 0) : uMsg.uuid
        return {
          normalized: [
            {
              ...uMsg,
              uuid,
              message: {
                ...uMsg.message,
                content: [{ type: 'text', text: uMsg.message.content }],
              },
            } as NormalizedMessage,
          ],
          nextIsNewChain: isNewChain,
        }
      }
      isNewChain = isNewChain || (uMsg.message.content?.length ?? 0) > 1
      let imageIndex = 0
      const normalized = (uMsg.message.content ?? []).map((_, index) => {
        const isImage = _.type === 'image'
        // For image content blocks, extract just the ID for this image
        const imageId =
          isImage && uMsg.imagePasteIds
            ? (uMsg.imagePasteIds as number[])[imageIndex]
            : undefined
        if (isImage) imageIndex++
        return {
          ...createUserMessage({
            content: [_],
            toolUseResult: uMsg.toolUseResult,
            mcpMeta: uMsg.mcpMeta as {
              _meta?: Record<string, unknown>
              structuredContent?: Record<string, unknown>
            },
            isMeta: uMsg.isMeta === true ? true : undefined,
            isVisibleInTranscriptOnly:
              uMsg.isVisibleInTranscriptOnly === true ? true : undefined,
            isVirtual:
              (uMsg.isVirtual as boolean | undefined) === true
                ? true
                : undefined,
            timestamp: uMsg.timestamp as string | undefined,
            imagePasteIds: imageId !== undefined ? [imageId] : undefined,
            origin: uMsg.origin as MessageOrigin | undefined,
            turnCompanion: uMsg.turnCompanion === true ? true : undefined,
            replacesSpan: uMsg.replacesSpan === true ? true : undefined,
            sourceToolUseID:
              typeof uMsg.sourceToolUseID === 'string'
                ? uMsg.sourceToolUseID
                : undefined,
          }),
          uuid: isNewChain ? deriveUUID(uMsg.uuid, index) : uMsg.uuid,
        } as NormalizedMessage
      })
      return { normalized, nextIsNewChain: isNewChain }
    }
    default:
      return { normalized: [message], nextIsNewChain: isNewChain }
  }
}

type SingleNormalizeCacheEntry = {
  prevIsNewChain: boolean
  nextIsNewChain: boolean
  contentRef: unknown
  contentLength: number
  blocks: readonly unknown[] | null
  blockTexts: readonly (string | undefined)[] | null
  stopReason: unknown
  uuid: unknown
  error: unknown
  isApiErrorMessage: unknown
  normalized: NormalizedMessage[]
  filteredNormalized?: NormalizedMessage[]
}

function isCacheEntryValid(
  message: Message,
  prevIsNewChain: boolean,
  entry: SingleNormalizeCacheEntry,
): boolean {
  if (entry.prevIsNewChain !== prevIsNewChain) return false
  if (message.type === 'assistant') {
    const aMsg = message as AssistantMessage
    if (
      entry.uuid !== aMsg.uuid ||
      entry.contentRef !== aMsg.message.content ||
      entry.stopReason !== aMsg.message.stop_reason ||
      entry.error !== aMsg.error ||
      entry.isApiErrorMessage !== aMsg.isApiErrorMessage
    ) {
      return false
    }
    const content = Array.isArray(aMsg.message.content)
      ? aMsg.message.content
      : []
    if (entry.contentLength !== content.length || entry.blocks === null) {
      return false
    }
    for (let i = 0; i < content.length; i++) {
      if (entry.blocks[i] !== content[i]) return false
      if (
        aMsg.message.stop_reason === null &&
        entry.blockTexts !== null &&
        entry.blockTexts[i] !== extractMutableBlockText(content[i])
      ) {
        return false
      }
    }
    return true
  }
  if (message.type === 'user') {
    const uMsg = message as UserMessage
    if (entry.uuid !== uMsg.uuid || entry.contentRef !== uMsg.message.content) {
      return false
    }
    if (Array.isArray(uMsg.message.content)) {
      const content = uMsg.message.content
      if (entry.contentLength !== content.length || entry.blocks === null) {
        return false
      }
      for (let i = 0; i < content.length; i++) {
        if (entry.blocks[i] !== content[i]) return false
      }
    }
    return true
  }
  return false
}

function normalizeSingleMessageCached(
  message: Message,
  prevIsNewChain: boolean,
  cache: WeakMap<Message, SingleNormalizeCacheEntry>,
  filterEmpty: boolean,
): { normalized: NormalizedMessage[]; nextIsNewChain: boolean } {
  if (!message) {
    return { normalized: [], nextIsNewChain: prevIsNewChain }
  }
  if (message.type !== 'assistant' && message.type !== 'user') {
    if (filterEmpty && !isNotEmptyMessage(message)) {
      return { normalized: [], nextIsNewChain: prevIsNewChain }
    }
    return { normalized: [message], nextIsNewChain: prevIsNewChain }
  }

  const cached = cache.get(message)
  if (
    cached !== undefined &&
    isCacheEntryValid(message, prevIsNewChain, cached)
  ) {
    if (filterEmpty) {
      cached.filteredNormalized ??= cached.normalized.filter(isNotEmptyMessage)
      return {
        normalized: cached.filteredNormalized,
        nextIsNewChain: cached.nextIsNewChain,
      }
    }
    return {
      normalized: cached.normalized,
      nextIsNewChain: cached.nextIsNewChain,
    }
  }

  const { normalized, nextIsNewChain } = normalizeSingleMessage(
    message,
    prevIsNewChain,
  )
  const rawContent =
    message.type === 'assistant'
      ? (message as AssistantMessage).message.content
      : (message as UserMessage).message.content
  const blocks = Array.isArray(rawContent) ? rawContent.slice() : null
  const stopReason =
    message.type === 'assistant'
      ? (message as AssistantMessage).message.stop_reason
      : undefined
  const blockTexts =
    message.type === 'assistant' && stopReason === null && blocks !== null
      ? blocks.map(extractMutableBlockText)
      : null
  const filteredNormalized = filterEmpty
    ? normalized.filter(isNotEmptyMessage)
    : undefined

  cache.set(message, {
    prevIsNewChain,
    nextIsNewChain,
    contentRef: rawContent,
    contentLength: blocks !== null ? blocks.length : -1,
    blocks,
    blockTexts,
    stopReason,
    uuid: message.uuid,
    error: message.type === 'assistant' ? message.error : undefined,
    isApiErrorMessage:
      message.type === 'assistant' ? message.isApiErrorMessage : undefined,
    normalized,
    filteredNormalized,
  })

  return {
    normalized: filterEmpty ? filteredNormalized! : normalized,
    nextIsNewChain,
  }
}

export type IncrementalNormalizerOptions = {
  /** When true, drops empty messages via `isNotEmptyMessage` inside the incremental pass. */
  filterEmpty?: boolean
  /** Optional WeakMap cache to share across calls (defaults to a fresh instance WeakMap). */
  cache?: WeakMap<Message, SingleNormalizeCacheEntry>
}

/**
 * Official 2.1.328 `Vr` (`IncrementalNormalizer`) — stateful normalizer that
 * preserves exact `NormalizedMessage` object references across unchanged source
 * message prefixes/suffixes and per-message WeakMap entries so downstream caches
 * (`TranscriptProgressSplitter`, `LeftoverCollapseCache`, `applyGrouping`,
 * `searchTextCache`, `VirtualMessageList.rowCacheRef`, `React.memo(MessageRow)`)
 * hit cleanly on progress ticks and appended turns.
 */
export class IncrementalNormalizer {
  static readonly RECENT = 4
  static readonly PRUNE_PENDING_AT = 64

  private readonly cache: WeakMap<Message, SingleNormalizeCacheEntry>
  private readonly filterEmpty: boolean
  private input: readonly Message[] = []
  private inputLength = 0
  private output: NormalizedMessage[] = []
  private starts: number[] = [0]
  private chainAt: boolean[] = [false]
  private pending = new Map<Message, boolean>()
  lastWalked = 0

  constructor(options?: IncrementalNormalizerOptions) {
    this.cache = options?.cache ?? new WeakMap()
    this.filterEmpty = options?.filterEmpty ?? false
  }

  reset(): void {
    this.input = []
    this.inputLength = 0
    this.output = []
    this.starts = [0]
    this.chainAt = [false]
    this.pending.clear()
    this.lastWalked = 0
  }

  private notePending(msg: Message | undefined, chain: boolean): void {
    if (!msg || msg.type !== 'assistant') return
    if ((msg as AssistantMessage).message.stop_reason === null) {
      this.pending.set(msg, chain)
    } else {
      this.pending.delete(msg)
    }
  }

  private prunePending(messages: readonly Message[]): void {
    if (this.pending.size <= IncrementalNormalizer.PRUNE_PENDING_AT) return
    const present = new Set(messages)
    for (const msg of this.pending.keys()) {
      if (!present.has(msg)) {
        this.pending.delete(msg)
      }
    }
  }

  normalize(
    messages: readonly Message[],
    initialNewChain = false,
  ): NormalizedMessage[] {
    const prevInput = this.input
    const intact =
      prevInput.length === this.inputLength &&
      this.starts.length === this.inputLength + 1 &&
      this.chainAt.length === this.inputLength + 1 &&
      this.starts[this.inputLength] === this.output.length
    if (!intact) {
      this.reset()
    }

    const recentCutoff = Math.max(
      0,
      messages.length - IncrementalNormalizer.RECENT,
    )
    let head = 0
    let tail = 0
    if (intact && this.chainAt[0] === initialNewChain) {
      const maxHead = Math.min(prevInput.length, recentCutoff)
      while (
        head < maxHead &&
        prevInput[head] === messages[head] &&
        !this.pending.has(prevInput[head]!)
      ) {
        head++
      }
      const maxTail = Math.min(prevInput.length - head, recentCutoff - head)
      while (
        tail < maxTail &&
        prevInput[prevInput.length - 1 - tail] ===
          messages[messages.length - 1 - tail] &&
        !this.pending.has(prevInput[prevInput.length - 1 - tail]!)
      ) {
        tail++
      }
    }

    const headOutputEnd = this.starts[head] ?? 0
    const nextOutput = this.output.slice(0, headOutputEnd)
    const nextStarts = this.starts.slice(0, head + 1)
    const nextChainAt = this.chainAt.slice(0, head + 1)
    if (head === 0) {
      nextChainAt[0] = initialNewChain
    }

    let chain = nextChainAt[head] ?? initialNewChain
    let walked = 0
    const walkRange = (from: number, to: number): void => {
      for (let i = from; i < to; i++) {
        const msg = messages[i]!
        const { normalized, nextIsNewChain } = normalizeSingleMessageCached(
          msg,
          chain,
          this.cache,
          this.filterEmpty,
        )
        for (const item of normalized) {
          nextOutput.push(item)
        }
        this.notePending(msg, chain)
        chain = nextIsNewChain
        nextStarts.push(nextOutput.length)
        nextChainAt.push(chain)
        walked++
      }
    }

    const tailStartInNew = messages.length - tail
    walkRange(head, tailStartInNew)

    const tailStartInOld = prevInput.length - tail
    if (tail > 0 && this.chainAt[tailStartInOld] === chain) {
      const oldTailOutputStart = this.starts[tailStartInOld]!
      const offset = nextOutput.length - oldTailOutputStart
      for (let i = oldTailOutputStart; i < this.output.length; i++) {
        nextOutput.push(this.output[i]!)
      }
      for (let i = tailStartInOld + 1; i <= prevInput.length; i++) {
        nextStarts.push(this.starts[i]! + offset)
        nextChainAt.push(this.chainAt[i]!)
      }
    } else {
      walkRange(tailStartInNew, messages.length)
    }

    this.prunePending(messages)

    let finalOutput = nextOutput
    if (nextOutput.length === this.output.length) {
      let allSame = true
      for (let i = headOutputEnd; i < nextOutput.length; i++) {
        if (nextOutput[i] !== this.output[i]) {
          allSame = false
          break
        }
      }
      if (allSame) {
        finalOutput = this.output
      }
    }

    this.input = messages
    this.inputLength = messages.length
    this.output = finalOutput
    this.starts = nextStarts
    this.chainAt = nextChainAt
    this.lastWalked = walked
    return finalOutput
  }
}

// Split messages, so each content block gets its own message
export function normalizeMessages(
  messages: AssistantMessage[],
): NormalizedAssistantMessage[]

export function normalizeMessages(
  messages: UserMessage[],
): NormalizedUserMessage[]

export function normalizeMessages(
  messages: (AssistantMessage | UserMessage)[],
): (NormalizedAssistantMessage | NormalizedUserMessage)[]

export function normalizeMessages(messages: Message[]): NormalizedMessage[]

export function normalizeMessages(messages: Message[]): NormalizedMessage[] {
  // isNewChain tracks whether we need to generate new UUIDs for messages when normalizing.
  // When a message has multiple content blocks, we split it into multiple messages,
  // each with a single content block. When this happens, we need to generate new UUIDs
  // for all subsequent messages to maintain proper ordering and prevent duplicate UUIDs.
  // This flag is set to true once we encounter a message with multiple content blocks,
  // and remains true for all subsequent messages in the normalization process.
  let isNewChain = false
  const out: NormalizedMessage[] = []
  for (const message of messages) {
    const { normalized, nextIsNewChain } = normalizeSingleMessage(
      message,
      isNewChain,
    )
    isNewChain = nextIsNewChain
    for (const item of normalized) {
      out.push(item)
    }
  }
  return out
}
