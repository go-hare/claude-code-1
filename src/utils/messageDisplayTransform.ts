/**
 * densable 2.1.222 MessageDisplay transform controller (wth) + RH strip +
 * Ath telemetry + Tth/ilr SDK completed-message transform.
 *
 * Streaming path: begin(apiMessageId) → delta(text) → entryLanded/finalize.
 * Flushes complete lines on ~100ms cadence (Sth=1000/zrv, zrv=10), max Eth=3
 * in-flight hook batches. Writes transformed via onStreamingDisplay and final
 * salvage-merged content via onMessageDisplay.
 */
import { randomUUID } from 'crypto'
import type { AppState } from '../state/AppStateStore.js'
import type { AssistantMessage } from '../types/message.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { executeMessageDisplayHooks, hasHookForEvent } from './hooks.js'
import { logForDebugging } from './debug.js'
import { getSessionId } from '../bootstrap/state.js'

/** densable zrv / Sth — line-batch flush cadence (ms) */
export const MESSAGE_DISPLAY_FLUSH_MS = 1000 / 10
/** densable Eth — max concurrent MessageDisplay hook flushes */
export const MESSAGE_DISPLAY_MAX_IN_FLIGHT = 3
/** densable vth — per-flush timeout (ms) */
export const MESSAGE_DISPLAY_TIMEOUT_MS = 10_000

/** densable RH / upo — strip cc-memory tags before hook flush */
const CC_MEMORY_TAG_RE = /<\/?cc-memory\b[^>]*>/g
/** densable uau — filenames attr on open tags */
const CC_MEMORY_FILENAMES_RE = /\bfilenames="([^"]*)"/
const CC_MEMORY_MARKER = 'cc-memory'

export function stripCcMemoryTags(text: string): string {
  if (!text.includes(CC_MEMORY_MARKER)) return text
  return text.replace(CC_MEMORY_TAG_RE, '')
}

/**
 * densable ilr — RH-strip text + thinking blocks on completed message content.
 */
export function stripCcMemoryFromContentBlocks<
  T extends { type: string; text?: string; thinking?: string },
>(content: T[]): T[] {
  const next = content.map(block => {
    if (block.type === 'text' && typeof block.text === 'string') {
      const n = stripCcMemoryTags(block.text)
      return n === block.text ? block : { ...block, text: n }
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      const n = stripCcMemoryTags(block.thinking)
      return n === block.thinking ? block : { ...block, thinking: n }
    }
    return block
  })
  return next.every((b, i) => b === content[i]) ? content : next
}

type CcMemoryTagStats = {
  openTagCount: number
  closeTagCount: number
  taggedContentChars: number
  memoryFileCount: number
  missingFilenamesAttr: boolean
  openTagCharsBucket: number
}

/**
 * densable dau — scan cc-memory tags for Ath telemetry.
 */
export function scanCcMemoryTags(source: string): CcMemoryTagStats {
  if (!source.includes(CC_MEMORY_MARKER)) {
    return {
      openTagCount: 0,
      closeTagCount: 0,
      taggedContentChars: 0,
      memoryFileCount: 0,
      missingFilenamesAttr: false,
      openTagCharsBucket: 0,
    }
  }
  const matches = [...source.matchAll(CC_MEMORY_TAG_RE)]
  const openTags = matches.filter(m => !m[0].startsWith('</'))
  const openTagChars = openTags.reduce((s, a) => s + a[0].length, 0)
  const filenames = openTags.map(s => s[0].match(CC_MEMORY_FILENAMES_RE))
  const { taggedContentChars } = matches.reduce(
    (acc, a) => {
      if (!a[0].startsWith('</')) {
        if (acc.openAt === null) {
          return {
            taggedContentChars: acc.taggedContentChars,
            openAt: (a.index ?? 0) + a[0].length,
          }
        }
        return acc
      }
      if (acc.openAt === null) return acc
      return {
        taggedContentChars:
          acc.taggedContentChars + ((a.index ?? 0) - acc.openAt),
        openAt: null as number | null,
      }
    },
    { taggedContentChars: 0, openAt: null as number | null },
  )
  const memoryFileCount = filenames.reduce((s, a) => {
    if (a === null) return s
    return (
      s +
      (a[1] ?? '')
        .split(',')
        .map(x => x.trim())
        .filter(x => x !== '').length
    )
  }, 0)
  return {
    openTagCount: openTags.length,
    closeTagCount: matches.length - openTags.length,
    taggedContentChars,
    memoryFileCount,
    missingFilenamesAttr: filenames.some(s => s === null),
    openTagCharsBucket:
      openTagChars === 0 ? 0 : 2 ** Math.ceil(Math.log2(openTagChars)),
  }
}

/**
 * densable Ath — emit tengu_cc_memory_tag_stripped for text/thinking blocks.
 */
export function emitCcMemoryTagTelemetry(
  message: AssistantMessage,
  seam: 'repl' | 'sdk',
): void {
  const content = message.message.content
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (typeof block === 'string') continue
    const n =
      block.type === 'text'
        ? { name: 'text', source: block.text }
        : block.type === 'thinking'
          ? { name: 'thinking', source: block.thinking }
          : null
    if (n === null || typeof n.source !== 'string') continue
    const o = scanCcMemoryTags(n.source)
    if (o.openTagCount === 0 && o.closeTagCount === 0) continue
    logEvent('tengu_cc_memory_tag_stripped', {
      surface:
        n.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      seam: seam as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      open_tag_count: o.openTagCount,
      close_tag_count: o.closeTagCount,
      tagged_content_chars: o.taggedContentChars,
      block_chars: n.source.length,
      memory_file_count: o.memoryFileCount,
      missing_filenames_attr: o.missingFilenamesAttr,
      open_tag_chars_bucket: o.openTagCharsBucket,
      request_id: message.requestId
        ? (message.requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
        : undefined,
      messageID: message.message.id
        ? (message.message
            .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
        : undefined,
    })
  }
}

/**
 * densable Tth — completed assistant MessageDisplay transform (SDK/print path).
 * Ath → ilr → single final GCr → first text block = displayContent, rest text "".
 */
export async function transformCompletedAssistantMessage(
  message: AssistantMessage,
  turnId: string,
  getAppState: () => AppState,
  signal?: AbortSignal,
): Promise<AssistantMessage> {
  emitCcMemoryTagTelemetry(message, 'sdk')
  const content = message.message.content
  if (!Array.isArray(content)) return message
  const stripped = stripCcMemoryFromContentBlocks(
    content as Array<{ type: string; text?: string; thinking?: string }>,
  )
  const base: AssistantMessage =
    stripped === content
      ? message
      : {
          ...message,
          message: {
            ...message.message,
            content: stripped as typeof content,
          },
        }
  if (!hasHookForEvent('MessageDisplay', getAppState(), getSessionId())) {
    return base
  }
  const joined = (
    base.message.content as Array<{ type: string; text?: string }>
  )
    .map(c => (c.type === 'text' ? (c.text ?? '') : ''))
    .join('')
  if (joined === '') return base
  let displayContent: string | undefined
  try {
    for await (const result of executeMessageDisplayHooks(
      {
        turnId,
        messageId: randomUUID(),
        index: 0,
        final: true,
        delta: joined,
      },
      getAppState,
      signal,
      MESSAGE_DISPLAY_TIMEOUT_MS,
    )) {
      if (result.displayContent !== undefined) {
        displayContent = result.displayContent
      }
    }
  } catch (err) {
    logForDebugging(
      `MessageDisplay hook failed for completed message; emitting original text: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'error' },
    )
    return base
  }
  if (displayContent === undefined) return base
  let first = true
  return {
    ...base,
    message: {
      ...base.message,
      content: (
        base.message.content as Array<{ type: string; text?: string }>
      ).map(c => {
        if (c.type !== 'text') return c
        const text = first ? displayContent! : ''
        first = false
        return { ...c, text }
      }) as typeof base.message.content,
    },
  }
}

type SessionStats = {
  totalDurationMs: number
  maxDurationMs: number
  errorCount: number
  summaryEmitted: boolean
}

type TransformSession = {
  apiMessageId: string
  messageId: string
  turnId: string
  raw: string
  flushedOffset: number
  index: number
  output: string
  appendChain: Promise<void>
  lastFlushAt: number
  flushTimer: ReturnType<typeof setTimeout> | null
  inFlight: number
  abortController: AbortController
  finalized: boolean
  finalDispatched: boolean
  done: boolean
  abandoned: boolean
  stats: SessionStats
}

export type MessageDisplayTransform = {
  newTurn: () => void
  begin: (apiMessageId: string) => void
  delta: (text: string) => void
  entryLanded: (message: AssistantMessage) => void
  finalize: () => void
}

/**
 * densable wth
 */
export function createMessageDisplayTransform(opts: {
  getAppState: () => AppState
  onStreamingDisplay: (content: string | null) => void
  onMessageDisplay: (apiMessageId: string, content: string) => void
}): MessageDisplayTransform {
  const { getAppState, onStreamingDisplay, onMessageDisplay } = opts
  let turnId = randomUUID()
  let session: TransformSession | null = null

  function emit(s: TransformSession): void {
    if (s.abandoned) return
    if (s.done) onMessageDisplay(s.apiMessageId, s.output)
    else onStreamingDisplay(s.output)
  }

  function abandon(s: TransformSession): void {
    s.abandoned = true
    if (s.flushTimer !== null) {
      clearTimeout(s.flushTimer)
      s.flushTimer = null
    }
    s.abortController.abort()
  }

  function afterInFlight(s: TransformSession): void {
    if (s.abandoned) return
    if (s.finalized) {
      if (!s.finalDispatched) {
        flush(s, true)
      } else if (s.inFlight === 0 && !s.stats.summaryEmitted) {
        s.stats.summaryEmitted = true
        logEvent('tengu_message_display_hooks', {
          flushCount: s.index,
          errorCount: s.stats.errorCount,
          totalDurationMs: s.stats.totalDurationMs,
          maxDurationMs: s.stats.maxDurationMs,
        })
      }
      return
    }
    schedule(s)
  }

  function runFlush(
    s: TransformSession,
    index: number,
    isFinal: boolean,
    delta: string,
  ): void {
    s.inFlight++
    const started = Date.now()
    const work = (async () => {
      let out = delta
      try {
        for await (const result of executeMessageDisplayHooks(
          {
            turnId: s.turnId,
            messageId: s.messageId,
            index,
            final: isFinal,
            delta,
          },
          getAppState,
          s.abortController.signal,
          MESSAGE_DISPLAY_TIMEOUT_MS,
        )) {
          const msg = result.message
          if (
            msg &&
            typeof msg === 'object' &&
            'type' in msg &&
            msg.type === 'attachment'
          ) {
            const att = (msg as { attachment?: { type?: string } }).attachment
            if (
              att?.type === 'hook_non_blocking_error' ||
              att?.type === 'hook_cancelled'
            ) {
              s.stats.errorCount++
            }
          }
          if (result.displayContent !== undefined) {
            out = result.displayContent
          }
        }
      } catch (err) {
        s.stats.errorCount++
        logForDebugging(
          `MessageDisplay hook flush ${index} failed; displaying original delta: ${err instanceof Error ? err.message : String(err)}`,
          { level: 'error' },
        )
      } finally {
        const dur = Date.now() - started
        s.stats.totalDurationMs += dur
        s.stats.maxDurationMs = Math.max(s.stats.maxDurationMs, dur)
        s.inFlight--
        afterInFlight(s)
      }
      return out
    })()
    s.appendChain = s.appendChain.then(async () => {
      s.output += await work
      emit(s)
    })
  }

  function flush(s: TransformSession, isFinal: boolean): void {
    if (s.flushTimer !== null) {
      clearTimeout(s.flushTimer)
      s.flushTimer = null
    }
    if (s.inFlight >= MESSAGE_DISPLAY_MAX_IN_FLIGHT) return
    const end = isFinal ? s.raw.length : s.raw.lastIndexOf('\n') + 1
    const chunk = s.raw.slice(s.flushedOffset, end)
    if (!isFinal && chunk === '') return
    if (isFinal) s.finalDispatched = true
    s.flushedOffset = end
    s.lastFlushAt = Date.now()
    const idx = s.index
    s.index++
    runFlush(s, idx, isFinal, stripCcMemoryTags(chunk))
  }

  function schedule(s: TransformSession): void {
    if (s.flushTimer !== null) return
    if (s.inFlight >= MESSAGE_DISPLAY_MAX_IN_FLIGHT) return
    if (s.raw.lastIndexOf('\n') + 1 <= s.flushedOffset) return
    const elapsed = Date.now() - s.lastFlushAt
    if (elapsed >= MESSAGE_DISPLAY_FLUSH_MS) {
      flush(s, false)
      return
    }
    s.flushTimer = setTimeout(() => {
      s.flushTimer = null
      if (!s.finalized && !s.abandoned) flush(s, false)
    }, MESSAGE_DISPLAY_FLUSH_MS - elapsed)
  }

  return {
    newTurn() {
      if (session && !session.finalized) abandon(session)
      session = null
      turnId = randomUUID()
    },
    begin(apiMessageId: string) {
      if (session && !session.finalized) abandon(session)
      if (!hasHookForEvent('MessageDisplay', getAppState(), getSessionId())) {
        session = null
        onStreamingDisplay(null)
        return
      }
      session = {
        apiMessageId,
        messageId: randomUUID(),
        turnId,
        raw: '',
        flushedOffset: 0,
        index: 0,
        output: '',
        appendChain: Promise.resolve(),
        lastFlushAt: 0,
        flushTimer: null,
        inFlight: 0,
        abortController: new AbortController(),
        finalized: false,
        finalDispatched: false,
        done: false,
        abandoned: false,
        stats: {
          totalDurationMs: 0,
          maxDurationMs: 0,
          errorCount: 0,
          summaryEmitted: false,
        },
      }
      onStreamingDisplay('')
    },
    delta(text: string) {
      if (session === null || session.finalized) return
      session.raw += text
      schedule(session)
    },
    entryLanded(message: AssistantMessage) {
      // densable: entryLanded(d){Ath(d,"repl");...}
      emitCcMemoryTagTelemetry(message, 'repl')
      const s = session
      if (s === null || s.apiMessageId !== message.message.id) return
      const content = message.message.content
      if (
        s.raw === '' ||
        !Array.isArray(content) ||
        !content.some(
          block => typeof block !== 'string' && block.type === 'text',
        )
      ) {
        return
      }
      s.done = true
      emit(s)
      onStreamingDisplay('')
    },
    finalize() {
      const s = session
      if (s === null) return
      s.finalized = true
      session = null
      onStreamingDisplay(null)
      if (s.raw === '' && s.index === 0) return
      s.done = true
      flush(s, true)
      emit(s)
    },
  }
}

/**
 * densable z$l — keep displayedMessageContent entries only for live assistants.
 */
export function pruneDisplayedMessageContent(
  state: AppState,
  messages: ReadonlyArray<{ type: string; message?: { id?: string } }>,
): AppState {
  const map = state.displayedMessageContent ?? {}
  if (Object.keys(map).length === 0) {
    // Normalize missing map so later selectors never crash.
    if (state.displayedMessageContent === undefined) {
      return { ...state, displayedMessageContent: {} }
    }
    return state
  }
  const keep = new Set<string>()
  for (const m of messages) {
    if (m.type === 'assistant' && m.message?.id) keep.add(m.message.id)
  }
  let changed = false
  const next: Record<string, string> = {}
  for (const [id, text] of Object.entries(map)) {
    if (keep.has(id)) next[id] = text
    else changed = true
  }
  if (!changed) return state
  return { ...state, displayedMessageContent: next }
}
