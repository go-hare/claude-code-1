import { describe, expect, test } from 'bun:test'
import {
  applyToolResultCutStandIns,
  collectToolResultCutMap,
  isTypedUltrathinkPrompt,
  resolveToolResultCutStandIns,
} from '../../../utils/attachments.js'
import { canBoostTurnToXhigh } from '../../../utils/effort.js'
import { mintComposerEnter } from '../../../utils/processUserInput/composerEnter.js'
import {
  createPermissionRetryMessage,
  formatPermissionRetryPrefix,
  formatPermissionRetrySuffix,
  STOPPED_WHILE_RUNNING_REJECT_MESSAGE,
} from '../../../utils/messages.js'
import { leaveOutToolResultsForPTLRetry } from '../../compact/compact.js'
import { hasStaticAuthHeader } from '../../mcp/auth.js'
import type { Message } from '../../../types/message.js'
import { randomUUID } from 'crypto'

describe('Wave 2 325 alignment', () => {
  test('hasStaticAuthHeader detects Authorization header case-insensitively', () => {
    expect(
      hasStaticAuthHeader({
        type: 'http',
        url: 'https://example.com',
        headers: { Authorization: 'Bearer tok' },
      }),
    ).toBe(true)
    expect(
      hasStaticAuthHeader({
        type: 'sse',
        url: 'https://example.com',
        headers: { 'x-api-key': 'k' },
      }),
    ).toBe(false)
  })

  test('#1426 permission_retry uses Mtn/Dtn text and heardAtNextPrompt', () => {
    expect(formatPermissionRetryPrefix(false)).toBe('Told Claude it may retry')
    expect(formatPermissionRetryPrefix(true)).toBe(
      'At your next prompt, Claude will be told it may retry',
    )
    expect(formatPermissionRetrySuffix(1)).toBe(
      'Auto mode checks it again; this adds no rule.',
    )
    expect(formatPermissionRetrySuffix(2)).toBe(
      'Auto mode checks them again; this adds no rule.',
    )

    const msg = createPermissionRetryMessage(['Bash(ls)', 'Read'], true)
    expect(msg.subtype).toBe('permission_retry')
    expect(msg.content).toBe(
      'At your next prompt, Claude will be told it may retry Bash(ls), Read. Auto mode checks them again; this adds no rule.',
    )
    expect((msg as { heardAtNextPrompt?: boolean }).heardAtNextPrompt).toBe(
      true,
    )
  })

  test('#1287 isTypedUltrathinkPrompt (Aoo) and canBoostTurnToXhigh (jjr)', () => {
    const enter = mintComposerEnter()
    expect(
      isTypedUltrathinkPrompt({
        composerEnter: enter,
        preExpansionInput: 'please ultrathink this',
        input: 'please ultrathink this',
      }),
    ).toBe(true)
    // Paste-expanded text that didn't have ultrathink before expansion is rejected
    expect(
      isTypedUltrathinkPrompt({
        composerEnter: enter,
        preExpansionInput: 'please check [Pasted text #1]',
        input: 'please check ultrathink',
      }),
    ).toBe(false)
    // Stdin without localStdinOrigin is rejected
    expect(
      isTypedUltrathinkPrompt({
        localStdinOrigin: false,
        input: 'ultrathink',
      }),
    ).toBe(false)
    // Stdin with ultrathink only inside <pasted_content> is rejected
    expect(
      isTypedUltrathinkPrompt({
        localStdinOrigin: true,
        input: '<pasted_content id="abcd">ultrathink</pasted_content>',
      }),
    ).toBe(false)
    // Stdin with typed ultrathink outside pasted_content is accepted
    expect(
      isTypedUltrathinkPrompt({
        localStdinOrigin: true,
        input: 'please ultrathink this',
      }),
    ).toBe(true)

    expect(typeof canBoostTurnToXhigh('claude-opus-4-6', 'medium')).toBe(
      'boolean',
    )
  })

  test('#1422 tool_results_cut stand-in collection and substitution (pbs/UY/xGt)', () => {
    const assistantMsg = {
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} },
          { type: 'tool_use', id: 'batch1_0', name: 'Read', input: {} },
        ],
      },
      batchToolUses: [{ id: 'batch1', name: 'BatchRead' }],
    } as unknown as Message

    const userMsg = {
      type: 'user',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: '<remote-control-device-report/>\n' + 'x'.repeat(500),
          },
          {
            type: 'tool_result',
            tool_use_id: 'batch1_0',
            content: 'y'.repeat(500),
          },
        ],
      },
    } as unknown as Message

    const cutAttachment = {
      type: 'attachment',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      attachment: {
        type: 'tool_results_cut',
        callIds: ['tu_1', 'batch1_0'],
        standIn: '[cut]',
      },
    } as unknown as Message

    const msgs = [assistantMsg, userMsg, cutAttachment]
    const rawMap = collectToolResultCutMap(msgs)
    expect(rawMap.get('tu_1')).toBe('[cut]')

    const resolved = resolveToolResultCutStandIns(msgs)
    expect(resolved?.get('tu_1')).toBe('[cut]')
    // Batch child tool_use IDs are excluded
    expect(resolved?.has('batch1_0')).toBe(false)

    const out = applyToolResultCutStandIns([userMsg], resolved)
    const content = (
      out[0] as { message: { content: Array<{ content: string }> } }
    ).message.content
    expect(content[0]!.content).toBe('<remote-control-device-report/>\n[cut]')
    expect(content[1]!.content).toBe('y'.repeat(500))
  })

  test('#1200 leaveOutToolResultsForPTLRetry clears largest tool_result payloads', () => {
    const u1 = {
      type: 'user',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_big',
            content: 'a'.repeat(4000),
          },
          {
            type: 'tool_result',
            tool_use_id: 'tu_small',
            content: 'ok',
          },
        ],
      },
    } as unknown as Message

    const out = leaveOutToolResultsForPTLRetry([u1], undefined, false)
    expect(out).not.toBeNull()
    const blocks = (
      out![0] as {
        message: { content: Array<{ tool_use_id: string; content: string }> }
      }
    ).message.content
    expect(blocks[0]!.content).toStartWith('[Tool result left out:')
    expect(blocks[1]!.content).toBe('ok')
  })

  test('#1399 STOPPED_WHILE_RUNNING_REJECT_MESSAGE is defined', () => {
    expect(STOPPED_WHILE_RUNNING_REJECT_MESSAGE).toContain(
      'this call was stopped while running',
    )
  })
})
