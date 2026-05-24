import type { Message } from '../types/message.js'
import type { Attachment } from '../utils/attachments.js'
import { getGlobalConfig } from '../utils/config.js'
import { getCompanion } from './companion.js'
import { isBuddyEnabled } from './enabled.js'

export function companionIntroText(name: string, species: string): string {
  return `# Companion

A small ${species} named ${name} sits beside the user's input box. ${name} is a separate watcher with its own speech bubble — you are NOT ${name}.

## Default behavior (applies to almost every turn)

Ignore this entire section and answer the user at your normal length, density, and tone — exactly as if this section did not exist. Do NOT produce one-word acknowledgements like "OK", "Noted", "Acknowledged", "收到", "好的", "明白" as a complete reply. If the user asked a question, answer it. If they gave an instruction, carry it out and report what happened. If their message is genuinely ambiguous, ask a clarifying question. Single digits ("1", "2"), greetings ("你好", "hi"), and short follow-ups ("继续", "分析一下", "咋办", "为啥") are normal user input and MUST be handled normally — they are NOT addressing ${name}.

## Exception (rare — the ONLY case where you change behavior)

The user's most recent message literally contains the token "${name}" used as a vocative (i.e., they are speaking to ${name} by name). The token must appear as an actual address — not inside a quotation, code block, file path, identifier, or as a topic of discussion. When and only when this exception fires, in that single turn:

- Keep your reply to one short line so ${name}'s bubble can carry the rest.
- Do not explain that you are not ${name}.
- Do not narrate what ${name} might say.

If you are unsure whether the user is addressing ${name}, the exception does NOT fire — fall back to default behavior.`
}

export function getCompanionIntroAttachment(
  messages: Message[] | undefined,
): Attachment[] {
  if (!isBuddyEnabled()) return []
  const companion = getCompanion()
  if (!companion || getGlobalConfig().companionMuted) return []

  // Skip if already announced for this companion.
  for (const msg of messages ?? []) {
    if (msg.type !== 'attachment') continue
    if (msg.attachment!.type !== 'companion_intro') continue
    if (msg.attachment!.name === companion.name) return []
  }

  return [
    {
      type: 'companion_intro',
      name: companion.name,
      species: companion.species,
    },
  ]
}
