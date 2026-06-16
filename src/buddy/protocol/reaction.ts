import type { BuddyReactionInput, BuddyReactionGenerateInput } from './types.js'

const REACTION_SCHEMA: BuddyReactionGenerateInput['schema'] = {
  type: 'object',
  properties: {
    reaction: { type: 'string' },
  },
  required: ['reaction'],
  additionalProperties: false,
}

export function parseBuddyReaction(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as { reaction?: unknown }
    if (typeof parsed.reaction === 'string') {
      return parsed.reaction.trim() || null
    }
  } catch {
    // Fall through to plain text parsing.
  }

  const plainText = trimmed
    .replace(/```(?:json)?|```/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!plainText || /[{}[\]]/.test(plainText)) return null
  return plainText.length > 140 ? `${plainText.slice(0, 139)}...` : plainText
}

export async function reactBuddy(
  input: BuddyReactionInput,
): Promise<string | null> {
  const systemPrompt = [
    'You are a tiny coding companion reacting to a coding conversation.',
    `Your name is ${input.buddy.name}.`,
    `Your personality is: ${input.buddy.personality}`,
    'Return strict JSON with one field: "reaction".',
    'The reaction must be one short sentence, warm, concise, and in character.',
    'Do not narrate actions outside the buddy voice.',
  ].join(' ')

  const userPrompt = [
    `species: ${input.buddy.species ?? 'unknown'}`,
    `rarity: ${input.buddy.rarity ?? 'unknown'}`,
    `addressed: ${input.addressed ? 'yes' : 'no'}`,
    `stats: ${JSON.stringify(input.buddy.stats ?? {})}`,
    `recent_reactions: ${input.recentReactions?.join(' | ') || 'none'}`,
    '',
    'conversation:',
    input.transcript.slice(0, 5000),
  ].join('\n')

  return parseBuddyReaction(
    await input.generate({
      systemPrompt,
      userPrompt,
      schema: REACTION_SCHEMA,
    }),
  )
}
