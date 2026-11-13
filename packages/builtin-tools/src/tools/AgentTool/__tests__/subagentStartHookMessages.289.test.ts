import { describe, expect, test } from 'bun:test'
import { createAttachmentMessage } from 'src/utils/attachments.js'
import { subagentStartHookMessages } from '../subagentStartHookMessages.js'

describe('SubagentStart hook diagnostics', () => {
  test('retains useful hook messages in child initial messages', () => {
    const message = createAttachmentMessage({
      type: 'hook_error_during_execution',
      content: 'diagnostic',
      hookName: 'SubagentStart',
      toolUseID: 'hook',
      hookEvent: 'SubagentStart',
    })
    expect(subagentStartHookMessages({ message }, 'Explore')).toEqual([message])
  })

  test('turns blocking errors into nonblocking child attachments', () => {
    const messages = subagentStartHookMessages(
      {
        blockingError: { blockingError: 'setup failed', command: 'setup.sh' },
      },
      'Explore',
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]?.attachment).toMatchObject({
      type: 'hook_non_blocking_error',
      hookName: 'SubagentStart:Explore',
      hookEvent: 'SubagentStart',
      stderr: 'setup failed',
      stdout: '',
      exitCode: 2,
      command: 'setup.sh',
    })
  })

  test('does not duplicate blocking errors and drops empty success messages', () => {
    const blocking = createAttachmentMessage({
      type: 'hook_blocking_error',
      hookName: 'SubagentStart',
      toolUseID: 'hook',
      hookEvent: 'SubagentStart',
      blockingError: { blockingError: 'failed', command: 'hook' },
    })
    expect(subagentStartHookMessages({ message: blocking }, 'Explore')).toEqual(
      [],
    )
    const empty = createAttachmentMessage({
      type: 'hook_success',
      content: '',
      hookName: 'SubagentStart',
      toolUseID: 'hook',
      hookEvent: 'SubagentStart',
    })
    expect(subagentStartHookMessages({ message: empty }, 'Explore')).toEqual([])
    const output = {
      ...empty,
      attachment: { ...empty.attachment, stdout: 'details' },
    }
    expect(subagentStartHookMessages({ message: output }, 'Explore')).toEqual([
      output,
    ])
  })
})
