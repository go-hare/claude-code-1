/**
 * densable 2.1.289 SkillTool `Be` — byte-identical re-invocation elision.
 * Unique English lives here. Never export minify Be|Uln|qdt.
 */
import type { AttachmentMessage, Message } from '../../types/message.js'
import { logForDebugging } from '../debug.js'
import { createUserMessage } from '../messages.js'

const SKILL_COMPACTION_TRUNCATION_MARK =
  '\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]'

function metaUserText(message: Message): string | null {
  if (message.type !== 'user' || !message.isMeta) return null
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = content.filter(
    (block): block is { type: 'text'; text: string } =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      block.type === 'text' &&
      'text' in block &&
      typeof block.text === 'string',
  )
  if (texts.length !== content.length) return null
  return texts.map(block => block.text).join('\n\n')
}

/**
 * densable `qdt` — walk contextMessages newest-first.
 * invoked_skills attachment whose body matches prior → "attachment".
 * meta user body match → "body". Else null (skip elision).
 */
export function findPriorSkillContentSite(
  contextMessages: Message[],
  priorContent: string,
): 'attachment' | 'body' | null {
  let sawAttachment = false
  for (let i = contextMessages.length - 1; i >= 0; i--) {
    const message = contextMessages[i]
    if (!message) continue
    if (message.type === 'attachment') {
      const attachment = (message as AttachmentMessage).attachment as {
        type?: string
        skills?: Array<{ content?: string }>
      }
      if (
        !sawAttachment &&
        attachment?.type === 'invoked_skills' &&
        attachment.skills?.some(skill => skill.content === priorContent)
      ) {
        sawAttachment = true
      }
      continue
    }
    if (metaUserText(message) === priorContent) return 'body'
  }
  return sawAttachment ? 'attachment' : null
}

export type ElideSkillReinvocationInput = {
  messages: Message[]
  contextMessages: Message[]
  commandName: string
  args?: string
  priorContent?: string
  renderedContent?: string
}

/**
 * densable `Be`. Skip when prior/rendered missing, or any new message has
 * promptShellHandOff. Content changed → prepend re-invocation note.
 * Byte-identical → replace matching meta body with unique English.
 */
export function elideByteIdenticalSkillReinvocation<T extends Message>({
  messages,
  contextMessages,
  commandName,
  args,
  priorContent,
  renderedContent,
}: ElideSkillReinvocationInput & { messages: T[] }): T[] {
  if (!priorContent || !renderedContent) return messages
  if (
    messages.some(
      message =>
        message.type === 'user' &&
        (message as { promptShellHandOff?: unknown }).promptShellHandOff !==
          undefined,
    )
  ) {
    return messages
  }
  const site = findPriorSkillContentSite(contextMessages, priorContent)
  if (!site) return messages
  const argSuffix = args ? ` Arguments: ${args}` : ''
  if (priorContent !== renderedContent) {
    const note = priorContent.endsWith(SKILL_COMPACTION_TRUNCATION_MARK)
      ? `(Re-invocation of /${commandName} — the previously loaded copy was truncated by compaction; the full instructions follow.)`
      : `(Re-invocation of /${commandName} — the skill instructions were previously loaded; the arguments or dynamic output below are new.)`
    return [
      createUserMessage({ content: note, isMeta: true }),
      ...messages,
    ] as T[]
  }
  let replaced = false
  const next = messages.map(message => {
    if (metaUserText(message) !== renderedContent) return message
    replaced = true
    const content =
      site === 'attachment'
        ? `Skill /${commandName} was loaded earlier (see the invoked-skills reminder above); this is a NEW invocation — follow those instructions now, including any setup steps.${argSuffix}`
        : `Skill /${commandName} is already loaded above; instructions unchanged.${argSuffix}`
    return createUserMessage({ content, isMeta: true })
  })
  if (replaced) {
    logForDebugging(
      `SkillTool eliding byte-identical re-invocation of skill ${commandName}`,
    )
  }
  return next as T[]
}
