/**
 * densable sendMessagePins residual (jVu / VVu / Ozu / kls / Slo / G2).
 *
 * Pins disambiguate SendMessage targets when a display name is reused across
 * agents within a session. Successful subagent deliveries record
 * `{id,name,ref}` under a normalized name key; a later resolve to a different
 * id rebounds unless the caller addresses with an explicit `Name [ref]`.
 */
import { createHash } from 'crypto'
import { z } from 'zod'
import { SEND_MESSAGE_TOOL_NAME } from '@claude-code/builtin-tools/tools/SendMessageTool/constants.js'
import { toAgentId } from '../types/ids.js'
import type { Message } from '../types/message.js'
import { lazySchema } from './lazySchema.js'

/** densable qqu — pin ref display length (hex chars). */
export const SEND_MESSAGE_PIN_REF_LEN = 6

/** densable Fzg — max characters kept for session display names. */
export const SEND_MESSAGE_PIN_NAME_MAX = 200

export type SendMessagePin = {
  id: string
  name: string
  ref: string
}

export type SendMessagePinsMap = { [normalizedName: string]: SendMessagePin }

export type SubagentPinCandidate = {
  kind: 'subagent'
  id: string
  name: string
}

export type PinGuardResult =
  | { kind: 'proceed'; pin: SendMessagePin | undefined }
  | {
      kind: 'rebound'
      name: string
      previous: SendMessagePin
      nextId: string
      nextName: string
    }

const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu

/**
 * densable G2 — normalize agent display names for pin map keys.
 * NFKC → drop controls (keep whitespace) → trim → lower → collapse spaces to `-`.
 */
export function normalizeAgentNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(CONTROL_CHARS, t => (/\s/.test(t) ? t : ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/**
 * densable jqu/Slo — short stable ref from kind+id.
 * sha256(`${kind}:${id}`).hex.slice(0, 12) then slice(0, REF_LEN).
 */
export function computeSendMessagePinRef(
  kind: string,
  id: string,
  refLen: number = SEND_MESSAGE_PIN_REF_LEN,
): string {
  const full = createHash('sha256')
    .update(`${kind}:${id}`)
    .digest('hex')
    .slice(0, 12)
  return full.slice(0, refLen)
}

export function createSendMessagePin(
  name: string,
  id: string,
  kind: string = 'subagent',
): SendMessagePin {
  return {
    id,
    name,
    ref: computeSendMessagePinRef(kind, id),
  }
}

/** densable Nzg / Mtr — parse `Name [hexref]` addressing. */
const NAMED_REF_RE = /^(.*\S)\s*\[([0-9a-f]{6,12})\]$/i

export function parseNamedRef(
  to: string,
): { name: string; ref: string } | null {
  const m = NAMED_REF_RE.exec(to.trim())
  if (!m) return null
  return { name: m[1]!, ref: m[2]!.toLowerCase() }
}

/**
 * densable VVu (subagent subset) — decide whether to proceed/set pin or rebound.
 * Only pins subagent targets (agent-live/stopped/evicted equivalent).
 */
export function evaluateSubagentPinGuard(args: {
  to: string
  message: unknown
  pins: SendMessagePinsMap | undefined
  resolved: SubagentPinCandidate | null
}): PinGuardResult {
  if (typeof args.message !== 'string') {
    return { kind: 'proceed', pin: undefined }
  }
  if (args.resolved === null) {
    return { kind: 'proceed', pin: undefined }
  }
  const key = normalizeAgentNameKey(args.resolved.name)
  const previous = args.pins?.[key]
  if (previous !== undefined && previous.id === args.resolved.id) {
    return { kind: 'proceed', pin: previous }
  }
  if (previous !== undefined) {
    const explicitRef = parseNamedRef(args.to) !== null
    // densable: bare rename of same pin name → allow without re-pin
    if (
      !explicitRef &&
      args.to === args.resolved.name &&
      args.to !== previous.name
    ) {
      return { kind: 'proceed', pin: undefined }
    }
    if (!explicitRef) {
      return {
        kind: 'rebound',
        name: args.resolved.name,
        previous,
        nextId: args.resolved.id,
        nextName: args.resolved.name,
      }
    }
  }
  return {
    kind: 'proceed',
    pin: createSendMessagePin(args.resolved.name, args.resolved.id, 'subagent'),
  }
}

export function formatPinReboundMessage(rebound: Extract<
  PinGuardResult,
  { kind: 'rebound' }
>): string {
  const y = `'${rebound.name}' now resolves to a different agent than it did earlier in this conversation: earlier sends went to [${rebound.previous.ref}], which this name no longer reaches. Nothing was sent.`
  const isAgentId = toAgentId(rebound.previous.id) !== null
  const tip = isAgentId
    ? 'If you need the earlier agent and it is still running, address it by its agent ID from its spawn result.'
    : 'The earlier recipient may be another session; this name now belongs to an agent in this session.'
  const named = `${rebound.nextName} [${rebound.previous.ref}]`
  return `${y}
It now resolves to agent id ${rebound.nextId}.
To message the new agent, re-send with an explicit ref:
e.g. {"to": "${named}", ...}
${tip}`
}

/** densable setSendMessagePin / Ozu — immutable pin map update. */
export function upsertSendMessagePin(
  pins: SendMessagePinsMap,
  pin: SendMessagePin,
): SendMessagePinsMap {
  const key = normalizeAgentNameKey(pin.name)
  const existing = Object.hasOwn(pins, key) ? pins[key] : undefined
  if (
    existing &&
    existing.id === pin.id &&
    existing.name === pin.name &&
    existing.ref === pin.ref
  ) {
    return pins
  }
  return {
    ...pins,
    [key]: pin,
  }
}

/** AppState updater helper for Ozu-style write. */
export function applySendMessagePin(
  pins: SendMessagePinsMap | undefined,
  pin: SendMessagePin,
): SendMessagePinsMap {
  return upsertSendMessagePin(pins ?? {}, pin)
}

/**
 * densable toolUseResult pin schema (tXg) — used by kls rehydrate.
 * id must look like createAgentId (toAgentId / Fpe).
 */
export const sendMessagePinResultSchema = lazySchema(() =>
  z.object({
    success: z.literal(true),
    pin: z.object({
      name: z.string().min(1).max(SEND_MESSAGE_PIN_NAME_MAX),
      id: z
        .string()
        .max(1024)
        .refine(id => toAgentId(id) !== null),
      ref: z.string().regex(/^[0-9a-f]{6,12}$/i),
    }),
  }),
)

/**
 * densable kls — rebuild pin map from successful SendMessage tool_use/results.
 */
export function extractSendMessagePinsFromMessages(
  messages: ReadonlyArray<Message>,
): SendMessagePinsMap {
  const pins = new Map<string, SendMessagePin>()
  const sendMessageToolUseIds = new Set<string>()

  for (const msg of messages) {
    if (msg.type === 'assistant') {
      const content = msg.message.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'tool_use' &&
          'name' in block &&
          block.name === SEND_MESSAGE_TOOL_NAME &&
          'id' in block &&
          typeof block.id === 'string'
        ) {
          sendMessageToolUseIds.add(block.id)
        }
      }
      continue
    }
    if (msg.type !== 'user') continue
    const content = msg.message.content
    if (!Array.isArray(content)) continue
    const hasSuccessResult = content.some(
      block =>
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'tool_result' &&
        !('is_error' in block && block.is_error) &&
        'tool_use_id' in block &&
        typeof block.tool_use_id === 'string' &&
        sendMessageToolUseIds.has(block.tool_use_id),
    )
    if (!hasSuccessResult) continue

    const rawResult = (msg as { toolUseResult?: unknown }).toolUseResult
    const parsed = sendMessagePinResultSchema().safeParse(rawResult)
    if (!parsed.success) continue
    const pin = {
      id: parsed.data.pin.id,
      name: parsed.data.pin.name,
      ref: parsed.data.pin.ref.toLowerCase(),
    }
    pins.set(normalizeAgentNameKey(pin.name), pin)
  }

  return Object.fromEntries(pins)
}
