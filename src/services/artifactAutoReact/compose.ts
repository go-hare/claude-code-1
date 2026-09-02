/**
 * densable qPw / KPw / substantive compose via sideQuery (2.1.239).
 * editCapable threads use densable KPw (B3i numbered pick); else qPw free sentence.
 */
import { FAST_ACK_TEXT } from './actGates.js'
import type { ArtifactComment, ArtifactThread } from './commentRead.js'
import { composeFastAckKPw } from './kpw.js'

/** densable LPw — mechanical auto-reply system prompt. */
export const ARTIFACT_COMPOSE_SYSTEM =
  'You write short artifact comment-thread replies for Claude Code. Output only the requested text — no quotes, no code fences, no preamble.'

/** densable sbr / FAST_ACK_TEXT is the fixed fallback. */
export const FAST_ACK_COMPOSE_INSTRUCTION = `You are about to start working on the newest comment sent to you in this thread; your full reply will follow separately. Write ONE short acknowledgement sentence (under 160 characters) telling the commenter their comment was received and what happens next, matched to what it is: for a change request, say you are working on it now; for a question, say you are finding the answer and will reply here. Do not answer the question or describe the change yet. Output only the sentence — no quotes, no code fences, no preamble.`

export function formatThreadForCompose(
  thread: ArtifactThread,
  newComments: ArtifactComment[],
): string {
  const lines = [
    `Comment thread: ${thread.id}`,
    ...(thread.editCapable === true ? ['editCapable: true'] : []),
    'Newest comments sent to Claude:',
    ...newComments.map(
      c =>
        `- [${c.id}] ${c.account || 'someone'}${c.toClaudeAt ? ` @${c.toClaudeAt}` : ''}: ${c.text.slice(0, 4000)}`,
    ),
  ]
  return lines.join('\n')
}

function extractTextFromSideQuery(message: {
  content?: unknown
}): string | null {
  const content = message.content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'text' &&
      typeof (block as { text?: string }).text === 'string'
    ) {
      parts.push((block as { text: string }).text)
    }
  }
  const s = parts.join('').replace(/\s+/g, ' ').trim()
  return s || null
}

/**
 * densable qPw — model fast-ack sentence (falls back to sbr).
 */
export async function composeFastAck(input: {
  thread: ArtifactThread
  newComments: ArtifactComment[]
  signal: AbortSignal
}): Promise<string> {
  try {
    const { sideQuery } = await import('../../utils/sideQuery.js')
    const { getSmallFastModel } = await import('../../utils/model/model.js')
    const framed = formatThreadForCompose(input.thread, input.newComments)
    const response = await sideQuery({
      model: getSmallFastModel(),
      system: ARTIFACT_COMPOSE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `${framed}\n\n${FAST_ACK_COMPOSE_INSTRUCTION}`,
        },
      ],
      max_tokens: 96,
      thinking: false,
      skipSystemPromptPrefix: true,
      signal: input.signal,
      querySource: 'artifact_comment_fast_ack',
      optional: true,
    })
    const text = extractTextFromSideQuery(response)
    if (!text || text.length > 200) return FAST_ACK_TEXT
    return text
  } catch {
    return FAST_ACK_TEXT
  }
}

/**
 * densable substantive reply compose (reply-only arm of cDw when no edit).
 */
export async function composeSubstantiveReply(input: {
  slug: string
  url: string
  thread: ArtifactThread
  newComments: ArtifactComment[]
  signal: AbortSignal
}): Promise<string | null> {
  try {
    const { sideQuery } = await import('../../utils/sideQuery.js')
    const { getMainLoopModel } = await import('../../utils/model/model.js')
    const framed = formatThreadForCompose(input.thread, input.newComments)
    const prompt = `${framed}

Artifact URL: ${input.url}
Slug: ${input.slug}

Write a concise reply to post on this artifact comment thread answering the newest comment(s). Be specific and helpful. Output only the reply text — no quotes, no code fences, no preamble.`
    const response = await sideQuery({
      model: getMainLoopModel(),
      system: ARTIFACT_COMPOSE_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
      thinking: false,
      skipSystemPromptPrefix: true,
      signal: input.signal,
      querySource: 'artifact_comment_reply',
      optional: true,
    })
    return extractTextFromSideQuery(response)
  } catch {
    return null
  }
}

/**
 * densable default composeAutoReply — KPw when editCapable, else qPw; then substantive.
 */
export async function defaultComposeAutoReply(input: {
  slug: string
  url: string
  thread: ArtifactThread
  newComments: ArtifactComment[]
  phase: 'fast_ack' | 'substantive'
  signal?: AbortSignal
}): Promise<string | null> {
  const signal = input.signal ?? new AbortController().signal
  if (input.phase === 'fast_ack') {
    if (input.thread.editCapable === true) {
      return composeFastAckKPw({
        thread: input.thread,
        newComments: input.newComments,
        signal,
      })
    }
    return composeFastAck({
      thread: input.thread,
      newComments: input.newComments,
      signal,
    })
  }
  return composeSubstantiveReply({
    slug: input.slug,
    url: input.url,
    thread: input.thread,
    newComments: input.newComments,
    signal,
  })
}
