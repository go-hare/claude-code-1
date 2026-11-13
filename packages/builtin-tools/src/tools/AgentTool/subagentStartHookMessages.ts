import { randomUUID } from 'crypto'
import type { AttachmentMessage } from 'src/types/message.js'
import { createAttachmentMessage } from 'src/utils/attachments.js'
import type { AggregatedHookResult } from 'src/utils/hooks.js'

/** SubagentStart reports hook failures to the child, but does not block launch. */
export function subagentStartHookMessages(
  result: AggregatedHookResult,
  agentType: string,
): AttachmentMessage[] {
  const messages: AttachmentMessage[] = []
  const message = result.message
  if (message?.type === 'attachment' && message.attachment) {
    const attachment = message.attachment
    const emptySuccess =
      attachment.type === 'hook_success' &&
      !attachment.content &&
      !(typeof attachment.stdout === 'string' && attachment.stdout.trim()) &&
      !(typeof attachment.stderr === 'string' && attachment.stderr.trim())
    const laptopMemory =
      (attachment.type === 'cowork_memory_context' ||
        attachment.type === 'account_memory_recall') &&
      attachment.leg === 'laptop' &&
      attachment.content !== null
    if (
      attachment.type !== 'hook_blocking_error' &&
      !emptySuccess &&
      !laptopMemory
    )
      messages.push(message as AttachmentMessage)
  }
  if (result.blockingError) {
    messages.push(
      createAttachmentMessage({
        type: 'hook_non_blocking_error',
        hookName: `SubagentStart:${agentType}`,
        hookEvent: 'SubagentStart',
        toolUseID: randomUUID(),
        stderr: result.blockingError.blockingError,
        stdout: '',
        exitCode: 2,
        command: result.blockingError.command,
      }),
    )
  }
  return messages
}
