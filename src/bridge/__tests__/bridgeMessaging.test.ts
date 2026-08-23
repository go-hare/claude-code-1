import { describe, expect, test } from 'bun:test'

import {
  isEligibleBridgeMessage,
  shouldReportRunningForMessage,
  shouldReportRunningForMessages,
} from '../bridgeMessaging.js'
import type { Message } from '../../types/message.js'
import { createUserMessage } from '../../utils/messages.js'

describe('bridge running-state classification', () => {
  test('treats real user prompts as turn-starting work', () => {
    expect(
      shouldReportRunningForMessage(
        createUserMessage({ content: 'please inspect the repo' }),
      ),
    ).toBe(true)
  })

  test('keeps tool-result style user messages eligible during mid-turn attach', () => {
    expect(
      shouldReportRunningForMessage(
        createUserMessage({
          content: '<local-command-stdout>done</local-command-stdout>',
          toolUseResult: { ok: true },
        }),
      ),
    ).toBe(true)
  })

  test('ignores local slash-command scaffolding that should not reopen a turn', () => {
    expect(
      shouldReportRunningForMessage(
        createUserMessage({
          content:
            '<local-command-caveat>Caveat: hidden local command scaffolding</local-command-caveat>',
          isMeta: true,
        }),
      ),
    ).toBe(false)

    expect(
      shouldReportRunningForMessage(
        createUserMessage({
          content:
            '<system-reminder>\nProactive mode is now enabled. You will receive periodic <tick> prompts.\n</system-reminder>',
          isMeta: true,
        }),
      ),
    ).toBe(false)
  })

  test('still marks real automation triggers as running', () => {
    expect(
      shouldReportRunningForMessage(
        createUserMessage({
          content: '<tick>2:56:47 PM</tick>',
          isMeta: true,
        }),
      ),
    ).toBe(true)

    expect(
      shouldReportRunningForMessage(
        createUserMessage({
          content: 'scheduled job: refresh analytics cache',
          isMeta: true,
        }),
      ),
    ).toBe(true)
  })

  test('classifies batches by any work-starting message', () => {
    const scaffoldingOnly = [
      createUserMessage({
        content:
          '<local-command-caveat>Caveat: hidden local command scaffolding</local-command-caveat>',
        isMeta: true,
      }),
      createUserMessage({
        content:
          '<system-reminder>\nProactive mode is now enabled.\n</system-reminder>',
        isMeta: true,
      }),
    ]
    expect(shouldReportRunningForMessages(scaffoldingOnly)).toBe(false)

    expect(
      shouldReportRunningForMessages([
        ...scaffoldingOnly,
        createUserMessage({
          content: '<tick>2:57:17 PM</tick>',
          isMeta: true,
        }),
      ]),
    ).toBe(true)
  })
})

function attachment(att: Record<string, unknown>): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-000000000001',
    attachment: att,
  } as unknown as Message
}

describe('isEligibleBridgeMessage (SOt)', () => {
  test('user/assistant eligible; virtual not', () => {
    expect(isEligibleBridgeMessage(createUserMessage({ content: 'hi' }))).toBe(
      true,
    )
    expect(
      isEligibleBridgeMessage({
        ...createUserMessage({ content: 'inner' }),
        isVirtual: true,
      }),
    ).toBe(false)
  })

  test('hook_system_message always eligible', () => {
    expect(
      isEligibleBridgeMessage(attachment({ type: 'hook_system_message' })),
    ).toBe(true)
  })

  test('queued_command prompt !isMeta human/undefined/auto-continuation eligible', () => {
    expect(
      isEligibleBridgeMessage(
        attachment({
          type: 'queued_command',
          commandMode: 'prompt',
          origin: { kind: 'human' },
        }),
      ),
    ).toBe(true)
    expect(
      isEligibleBridgeMessage(
        attachment({
          type: 'queued_command',
          commandMode: 'prompt',
        }),
      ),
    ).toBe(true)
    expect(
      isEligibleBridgeMessage(
        attachment({
          type: 'queued_command',
          commandMode: 'prompt',
          origin: { kind: 'auto-continuation' },
        }),
      ),
    ).toBe(true)
  })

  test('queued_command isMeta / non-prompt / non-O7 origin not eligible', () => {
    expect(
      isEligibleBridgeMessage(
        attachment({
          type: 'queued_command',
          commandMode: 'prompt',
          isMeta: true,
          origin: { kind: 'human' },
        }),
      ),
    ).toBe(false)
    expect(
      isEligibleBridgeMessage(
        attachment({
          type: 'queued_command',
          commandMode: 'task-notification',
          origin: { kind: 'human' },
        }),
      ),
    ).toBe(false)
    expect(
      isEligibleBridgeMessage(
        attachment({
          type: 'queued_command',
          commandMode: 'prompt',
          origin: { kind: 'peer' },
        }),
      ),
    ).toBe(false)
  })

  test('compact_boundary eligible (no tip bridgeStateFramesGate → true)', () => {
    expect(
      isEligibleBridgeMessage({
        type: 'system',
        subtype: 'compact_boundary',
        uuid: '00000000-0000-4000-8000-000000000002',
      } as unknown as Message),
    ).toBe(true)
  })

  test('local_command still eligible', () => {
    expect(
      isEligibleBridgeMessage({
        type: 'system',
        subtype: 'local_command',
        uuid: '00000000-0000-4000-8000-000000000003',
      } as unknown as Message),
    ).toBe(true)
  })
})
