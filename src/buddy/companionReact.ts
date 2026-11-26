/**
 * Companion reaction system.
 *
 * Called from REPL.tsx after each query turn. Checks mute state, frequency
 * limits, and @-mention detection. Official Anthropic OAuth sessions use the
 * buddy_react API; external/provider-compatible sessions fall back to the
 * current model provider through queryWithModel().
 */
import { getCompanion } from './companion.js'
import { parseStructuredJSONObject } from './structuredResponse.js'
import { getGlobalConfig } from '../utils/config.js'
import { getClaudeAIOAuthTokens } from '../utils/auth.js'
import { getOauthConfig } from '../constants/oauth.js'
import { getUserAgent } from '../utils/http.js'
import type { Message } from '../types/message.js'
import { queryWithModel } from '../services/api/claude.js'
import { extractTextContent } from '../utils/messages.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import { getMainLoopModel, getSmallFastModel } from '../utils/model/model.js'
import { getAPIProvider } from '../utils/model/providers.js'
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  RootSessionSlot,
  runWithSession,
} from '../utils/sessionHost.js'

// ─── Rate limiting & recent reactions (per root session) ────

type CompanionReactSessionState = {
  lastReactTime: number
  recentReactions: string[]
}

const companionReactStateSlot = new RootSessionSlot<CompanionReactSessionState>(
  () => ({
    lastReactTime: 0,
    recentReactions: [],
  }),
)

function getCompanionReactState(): CompanionReactSessionState {
  return companionReactStateSlot.of(getBootstrapSession())
}

const MIN_INTERVAL_MS = 45_000 // official is roughly 30-60s
const MAX_RECENT = 8
export const BUDDY_REACTION_MAX_OUTPUT_TOKENS = 1_024

// ─── Public API ─────────────────────────────────────

type CompanionObserver = (
  messages: Message[],
  setReaction: (text: string | undefined) => void,
) => void

type GlobalWithCompanionObserver = typeof globalThis & {
  fireCompanionObserver?: CompanionObserver
}

const REACTION_SCHEMA = {
  type: 'object',
  properties: {
    reaction: { type: 'string' },
  },
  required: ['reaction'],
  additionalProperties: false,
} as const

export function getBuddyReactionModel(): string {
  if (getAPIProvider() !== 'openai') {
    return getSmallFastModel()
  }

  if (process.env.OPENAI_SMALL_FAST_MODEL) {
    return process.env.OPENAI_SMALL_FAST_MODEL
  }

  if (
    process.env.OPENAI_DEFAULT_HAIKU_MODEL ||
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  ) {
    return getSmallFastModel()
  }

  if (process.env.OPENAI_MODEL) {
    return process.env.OPENAI_MODEL
  }

  return getMainLoopModel()
}

export function parseBuddyReactionResponse(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const parsed = parseStructuredJSONObject(trimmed)
  if (parsed && typeof parsed === 'object') {
    const reaction = (parsed as { reaction?: unknown }).reaction
    return typeof reaction === 'string' ? reaction.trim() || null : null
  }

  const plainText = trimmed
    .replace(/```(?:json)?|```/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plainText || /[{}[\]]/.test(plainText)) {
    return null
  }

  return plainText.length > 140 ? `${plainText.slice(0, 139)}...` : plainText
}

/**
 * Trigger a companion reaction after a query turn.
 *
 * Flow:
 *  1. Check companion exists and is not muted
 *  2. Detect if user @-mentioned companion by name
 *  3. Apply rate limiting (skip if not addressed and too soon)
 *  4. Build conversation transcript
 *  5. Use official buddy_react when OAuth + orgId are present
 *  6. Otherwise call the currently configured model provider
 *  7. Pass reaction text to setReaction callback
 */
export function triggerCompanionReaction(
  messages: Message[],
  setReaction: (text: string | undefined) => void,
): void {
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) return

  const addressed = isAddressed(messages, companion.name)

  const state = getCompanionReactState()
  const now = Date.now()
  if (!addressed && now - state.lastReactTime < MIN_INTERVAL_MS) return

  const transcript = buildTranscript(messages)
  if (!transcript.trim()) return

  state.lastReactTime = now
  const capturedSession = getActiveSessionFromAls()

  void generateBuddyReaction(companion, transcript, addressed)
    .then(reaction => {
      if (!reaction) return
      const deliver = () => {
        state.recentReactions.push(reaction)
        if (state.recentReactions.length > MAX_RECENT) {
          state.recentReactions.shift()
        }
        setReaction(reaction)
      }
      if (
        capturedSession !== undefined &&
        getActiveSessionFromAls() !== capturedSession
      ) {
        runWithSession(capturedSession, deliver)
        return
      }
      deliver()
    })
    .catch(() => {})
}

// ─── Helpers ────────────────────────────────────────

function isAddressed(messages: Message[], name: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i')
  for (
    let i = messages.length - 1;
    i >= Math.max(0, messages.length - 3);
    i--
  ) {
    const m = messages[i]
    if (m?.type !== 'user') continue
    const content = m.message?.content
    if (typeof content === 'string' && pattern.test(content)) return true
  }
  return false
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildTranscript(messages: Message[]): string {
  return messages
    .slice(-12)
    .filter(m => m.type === 'user' || m.type === 'assistant')
    .map(m => {
      const role = m.type === 'user' ? 'user' : 'claude'
      const content = m.message?.content
      const text =
        typeof content === 'string'
          ? content.slice(0, 300)
          : Array.isArray(content)
            ? content
                .filter(
                  (b): b is { type: 'text'; text: string } =>
                    typeof b === 'object' &&
                    b !== null &&
                    (b as { type?: unknown }).type === 'text' &&
                    typeof (b as { text?: unknown }).text === 'string',
                )
                .map(b => b.text)
                .join(' ')
                .slice(0, 300)
            : ''
      return `${role}: ${text}`
    })
    .join('\n')
    .slice(0, 5000)
}

export function installCompanionObserver(): void {
  const globalWithObserver = globalThis as GlobalWithCompanionObserver
  globalWithObserver.fireCompanionObserver = triggerCompanionReaction
}

// ─── Reaction backends ──────────────────────────────

type CompanionReactionProfile = {
  name: string
  personality: string
  species: string
  rarity: string
  stats: Record<string, number>
}

function shouldUseOfficialBuddyReact(): boolean {
  const tokens = getClaudeAIOAuthTokens()
  const orgId = getGlobalConfig().oauthAccount?.organizationUuid
  return Boolean(tokens?.accessToken && orgId)
}

async function generateBuddyReaction(
  companion: CompanionReactionProfile,
  transcript: string,
  addressed: boolean,
): Promise<string | null> {
  if (shouldUseOfficialBuddyReact()) {
    return callBuddyReactAPI(companion, transcript, addressed)
  }

  return queryBuddyReactionWithModel(companion, transcript, addressed)
}

async function callBuddyReactAPI(
  companion: CompanionReactionProfile,
  transcript: string,
  addressed: boolean,
): Promise<string | null> {
  const tokens = getClaudeAIOAuthTokens()
  const orgId = getGlobalConfig().oauthAccount?.organizationUuid
  if (!tokens?.accessToken || !orgId) return null

  const baseUrl = getOauthConfig().BASE_API_URL
  const url = `${baseUrl}/api/organizations/${orgId}/claude_code/buddy_react`

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': getUserAgent(),
      },
      body: JSON.stringify({
        name: companion.name.slice(0, 32),
        personality: companion.personality.slice(0, 200),
        species: companion.species,
        rarity: companion.rarity,
        stats: companion.stats,
        transcript,
        reason: addressed ? 'addressed' : 'turn',
        recent: getCompanionReactState().recentReactions.map(r =>
          r.slice(0, 200),
        ),
        addressed,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!resp.ok) return null

    const data = (await resp.json()) as { reaction?: string }
    return data.reaction?.trim() || null
  } catch {
    return null
  }
}

async function queryBuddyReactionWithModel(
  companion: {
    name: string
    personality: string
    species: string
    rarity: string
    stats: Record<string, number>
  },
  transcript: string,
  addressed: boolean,
): Promise<string | null> {
  try {
    const result = await queryWithModel({
      systemPrompt: asSystemPrompt([
        [
          'You are a tiny terminal buddy reacting to a coding conversation.',
          `Your name is ${companion.name}.`,
          `Your personality is: ${companion.personality}`,
          'Return strict JSON with one field: "reaction".',
          'The reaction must be one short sentence, playful, warm, and concise.',
          'Do not narrate actions outside the buddy voice.',
          'Avoid repeating recent reactions.',
        ].join(' '),
      ]),
      userPrompt: [
        `species: ${companion.species}`,
        `rarity: ${companion.rarity}`,
        `addressed: ${addressed ? 'yes' : 'no'}`,
        `recent_reactions: ${getCompanionReactState().recentReactions.join(' | ') || 'none'}`,
        '',
        'conversation:',
        transcript,
      ].join('\n'),
      outputFormat: {
        type: 'json_schema',
        schema: REACTION_SCHEMA,
      },
      signal: AbortSignal.timeout(10_000),
      options: {
        model: getBuddyReactionModel(),
        querySource: 'buddy_reaction',
        agents: [],
        isNonInteractiveSession: false,
        hasAppendSystemPrompt: false,
        mcpTools: [],
        maxOutputTokensOverride: BUDDY_REACTION_MAX_OUTPUT_TOKENS,
      },
    })

    return parseBuddyReactionResponse(
      extractTextContent(
        result.message.content as readonly { readonly type: string }[],
      ) ?? '',
    )
  } catch {
    return null
  }
}
