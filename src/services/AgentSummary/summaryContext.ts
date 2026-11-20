import { createHash } from 'node:crypto'
import { filterIncompleteToolCalls } from '@claude-code/builtin-tools/tools/AgentTool/filterIncompleteToolCalls.js'
import type { Message } from '../../types/message.js'

export const MAX_SUMMARY_CONTEXT_MESSAGES = 120
export const MAX_SUMMARY_CONTEXT_CHARS = 200_000
export const SHORT_NOTES_MAX_MESSAGES = 60
export const SHORT_NOTES_TOKEN_BUDGET = 1_500

function escapeXmlNote(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function normalizeAndClipNote(raw: string, maxChars: number): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ')
  if (!collapsed) return ''
  const clipped =
    collapsed.length > maxChars ? `${collapsed.slice(0, maxChars)}…` : collapsed
  return escapeXmlNote(clipped)
}

function estimateShortNotesTokens(text: string): number {
  let nonAscii = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) nonAscii++
  }
  return (text.length - nonAscii) / 3 + nonAscii
}

/**
 * Official 2.1.327/2.1.328 `Ca()` (#526, #675): build compact XML-escaped
 * short notes (`<task>`, `<recent_steps>`, `<started_not_finished>`) from the
 * recent messages of a subagent instead of sending its full conversation.
 */
export function buildShortSummaryNotes(opts: {
  task: string
  messages: Message[]
  maxTokens?: number
}): string {
  const maxTokens = opts.maxTokens ?? SHORT_NOTES_TOKEN_BUDGET
  const tail = opts.messages.slice(-SHORT_NOTES_MAX_MESSAGES)
  const lastBoundaryIdx = tail.findLastIndex(
    m =>
      m.type === 'system' &&
      'subtype' in m &&
      (m as { subtype?: string }).subtype === 'compact_boundary',
  )
  const windowMessages =
    lastBoundaryIdx >= 0 ? tail.slice(lastBoundaryIdx + 1) : tail

  type NoteEntry = {
    text: string
    call?: 'open' | 'done' | 'failed'
    responseId?: string
  }
  const entries: NoteEntry[] = []
  const openCalls = new Map<string, NoteEntry>()
  let lastResponseId: string | undefined
  let sawUserPromptSinceLastAssistant = false

  for (const msg of windowMessages) {
    if (msg.type === 'user') {
      const content = msg.message?.content
      const blocks = Array.isArray(content) ? content.filter(Boolean) : []
      if (
        !msg.isMeta &&
        !blocks.some(b => typeof b === 'object' && b.type === 'tool_result') &&
        (typeof content === 'string' ||
          blocks.some(b => typeof b === 'object' && b.type === 'text'))
      ) {
        sawUserPromptSinceLastAssistant = true
      }
      for (const block of blocks) {
        if (
          typeof block === 'object' &&
          block.type === 'tool_result' &&
          'tool_use_id' in block &&
          typeof block.tool_use_id === 'string'
        ) {
          const entry = openCalls.get(block.tool_use_id)
          if (entry) {
            entry.call =
              'is_error' in block && block.is_error === true ? 'failed' : 'done'
          }
        }
      }
    } else if (
      msg.type === 'assistant' &&
      !msg.isApiErrorMessage &&
      Array.isArray(msg.message?.content)
    ) {
      const respId = msg.message.id ?? msg.uuid
      lastResponseId = respId
      sawUserPromptSinceLastAssistant = false
      for (const block of msg.message.content) {
        if (!block || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') {
          const text = normalizeAndClipNote(block.text, 300)
          if (text) entries.push({ text: `said: ${text}`, responseId: respId })
        } else if (
          block.type === 'tool_use' &&
          typeof block.name === 'string' &&
          typeof block.id === 'string'
        ) {
          const input =
            typeof block.input === 'object' && block.input !== null
              ? (block.input as Record<string, unknown>)
              : {}
          const desc =
            typeof input.description === 'string'
              ? input.description
              : typeof input.command === 'string'
                ? input.command
                : typeof input.file_path === 'string'
                  ? input.file_path
                  : typeof input.pattern === 'string'
                    ? input.pattern
                    : ''
          const summary = normalizeAndClipNote(
            desc ? `${block.name} - ${desc}` : block.name,
            160,
          )
          if (summary) {
            const entry: NoteEntry = {
              text: summary,
              call: 'open',
              responseId: respId,
            }
            entries.push(entry)
            openCalls.set(block.id, entry)
          }
        }
      }
    }
  }

  const lines: Array<{ isOpen: boolean; text: string }> = []
  for (const entry of entries) {
    if (entry.call === undefined) {
      lines.push({ isOpen: false, text: entry.text })
    } else if (entry.call !== 'open') {
      lines.push({
        isOpen: false,
        text: `did: ${entry.text}${entry.call === 'failed' ? ' (failed)' : ''}`,
      })
    } else if (
      entry.responseId === lastResponseId &&
      !sawUserPromptSinceLastAssistant
    ) {
      lines.push({ isOpen: true, text: entry.text })
    }
  }
  if (lines.length === 0) return ''

  let taskXml = ''
  for (let limit = 800; limit >= 50; limit = Math.floor(limit / 2)) {
    const clippedTask = normalizeAndClipNote(opts.task, limit)
    const candidate = clippedTask ? `<task>\n${clippedTask}\n</task>` : ''
    if (estimateShortNotesTokens(candidate) <= maxTokens / 2) {
      taskXml = candidate
      break
    }
  }

  let remaining = maxTokens - estimateShortNotesTokens(taskXml)
  let startIdx = lines.length - 1
  for (let i = lines.length - 1; i >= 0; i--) {
    remaining -= estimateShortNotesTokens(lines[i]?.text ?? '')
    if (remaining < 0) break
    startIdx = i
  }
  const kept = lines.slice(startIdx)
  const formatTag = (tag: string, items: typeof kept): string =>
    items.length > 0
      ? `<${tag}>\n${items.map(item => item.text).join('\n')}\n</${tag}>`
      : ''

  return [
    taskXml,
    formatTag(
      'recent_steps',
      kept.filter(item => !item.isOpen),
    ),
    formatTag(
      'started_not_finished',
      kept.filter(item => item.isOpen),
    ),
  ]
    .filter(Boolean)
    .join('\n')
}

function estimateJsonChars(
  value: unknown,
  limit: number,
  seen = new Set<object>(),
): number {
  if (value === null) return 4
  switch (typeof value) {
    case 'string':
      return value.length + 2
    case 'number':
    case 'boolean':
      return String(value).length
    case 'undefined':
    case 'function':
    case 'symbol':
      return 0
    case 'object': {
      if (seen.has(value)) return Number.POSITIVE_INFINITY
      seen.add(value)
      let total = 2
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
          total += String(index).length + 3
          total += estimateJsonChars(value[index], limit - total, seen)
          if (total > limit) return total
        }
      } else {
        const record = value as Record<string, unknown>
        for (const key in record) {
          if (!Object.hasOwn(record, key)) continue
          total += key.length + 3
          total += estimateJsonChars(record[key], limit - total, seen)
          if (total > limit) return total
        }
      }
      seen.delete(value)
      return total
    }
  }
  return 0
}

function updateFingerprintHash(
  hash: ReturnType<typeof createHash>,
  value: unknown,
  limit: { remaining: number },
  seen = new Set<object>(),
): void {
  if (limit.remaining <= 0) return
  if (value === null || typeof value !== 'object') {
    const text = String(value)
    const consumed = Math.min(text.length, limit.remaining)
    if (consumed <= 0) return
    hash.update(typeof value)
    hash.update(':')
    hash.update(text.slice(0, consumed))
    if (consumed < text.length) {
      hash.update(`#truncated:${text.length}:${text.slice(-64)}`)
    }
    limit.remaining -= consumed
    return
  }
  if (seen.has(value)) {
    hash.update('[Circular]')
    return
  }
  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (limit.remaining <= 0) break
      const key = String(index)
      hash.update(key)
      limit.remaining -= key.length
      updateFingerprintHash(hash, value[index], limit, seen)
    }
  } else {
    const record = value as Record<string, unknown>
    for (const key in record) {
      if (limit.remaining <= 0) break
      if (!Object.hasOwn(record, key)) continue
      hash.update(key)
      limit.remaining -= key.length
      updateFingerprintHash(hash, record[key], limit, seen)
    }
  }
  seen.delete(value)
}

export function estimateMessageChars(
  message: Message,
  limit = Number.POSITIVE_INFINITY,
): number {
  const estimated = estimateJsonChars(message, limit)
  if (!Number.isFinite(estimated)) {
    return Number.POSITIVE_INFINITY
  }
  return estimated
}

function hasToolResultBlock(message: Message): boolean {
  if (message.type !== 'user') return false
  const content = message.message?.content
  return (
    Array.isArray(content) &&
    content.some(block => {
      return Boolean(
        block &&
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'tool_result',
      )
    })
  )
}

export function getSummaryContextFingerprint(
  messages: Message[],
): string | null {
  const lastMessage = messages.at(-1)
  if (!lastMessage) return null
  const hash = createHash('sha256')
  updateFingerprintHash(hash, messages, {
    remaining: MAX_SUMMARY_CONTEXT_CHARS,
  })
  return `${messages.length}:${lastMessage.uuid}:${hash.digest('hex').slice(0, 16)}`
}

export function selectSummaryContextMessages(
  messages: Message[],
  limits: {
    maxMessages?: number
    maxChars?: number
  } = {},
): Message[] {
  const maxMessages = limits.maxMessages ?? MAX_SUMMARY_CONTEXT_MESSAGES
  const maxChars = limits.maxChars ?? MAX_SUMMARY_CONTEXT_CHARS
  if (maxMessages <= 0 || maxChars <= 0) return []

  const selected: Message[] = []
  let selectedChars = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) continue

    const messageChars = estimateMessageChars(message, maxChars - selectedChars)
    if (messageChars > maxChars) {
      if (selected.length === 0) return []
      break
    }

    if (
      selected.length >= maxMessages ||
      selectedChars + messageChars > maxChars
    ) {
      break
    }

    selected.unshift(message)
    selectedChars += messageChars
  }

  while (selected.length > 0) {
    const first = selected[0]
    if (!first) break
    if (first.type !== 'user' || hasToolResultBlock(first)) {
      selected.shift()
      continue
    }
    break
  }

  return selected
}

export type SummaryContextBuildResult = {
  messages: Message[]
  fingerprint: string | null
  skipReason?: 'too_small' | 'unchanged'
}

export function buildSummaryContext(
  messages: Message[],
  previousFingerprint: string | null,
): SummaryContextBuildResult {
  const cleanMessages = filterIncompleteToolCalls(messages)
  const boundedMessages = filterIncompleteToolCalls(
    selectSummaryContextMessages(cleanMessages),
  )
  const fingerprint = getSummaryContextFingerprint(boundedMessages)

  if (fingerprint && fingerprint === previousFingerprint) {
    return {
      messages: boundedMessages,
      fingerprint,
      skipReason: 'unchanged',
    }
  }

  if (boundedMessages.length < 3) {
    return {
      messages: boundedMessages,
      fingerprint,
      skipReason: 'too_small',
    }
  }

  return {
    messages: boundedMessages,
    fingerprint,
  }
}
