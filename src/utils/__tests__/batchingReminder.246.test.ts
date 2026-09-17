/**
 * densable 2.1.246 #38 — batching_reminder producer (mXn/TXo) + C latch.
 *
 * Stay leftover. Do not invent default reminder copy.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { AttachmentMessage, Message } from '../../types/message.js'
import { saveGlobalConfig } from '../config.js'
import {
  injectBatchingReminder,
  matchToastyThimbleMap,
  resetBatchingReminderLatch,
  TOASTY_THIMBLE_ENV,
  TOASTY_THIMBLE_FEATURE,
} from '../batchingReminder.js'
import { isApiSystemMessage } from '../midConversationSystem.js'
import {
  CANCEL_MESSAGE,
  createUserMessage,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  normalizeMessagesForAPI,
  REJECT_MESSAGE,
} from '../messages.js'

const MID_MODEL = 'claude-mythos-5'
const TIP = 'Batch independent reads in one turn.'

function toolResultUser(text: string): Message {
  return createUserMessage({
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: text,
      },
    ],
  })
}

function attachment(
  type: string,
  extra: Record<string, unknown> = {},
): AttachmentMessage {
  return {
    type: 'attachment',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    attachment: { type, ...extra },
  } as unknown as AttachmentMessage
}

describe('#38 batching_reminder producer + C latch (2.1.246)', () => {
  afterEach(() => {
    resetBatchingReminderLatch()
    delete process.env[TOASTY_THIMBLE_ENV]
    delete process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM
    saveGlobalConfig(c => ({ ...c, clientDataCache: null }))
  })

  test('source-locks official producer + C latch + query host', () => {
    const producer = readFileSync(
      join(import.meta.dir, '../batchingReminder.ts'),
      'utf8',
    )
    const messages = readFileSync(
      join(import.meta.dir, '../messages.ts'),
      'utf8',
    )
    const query = readFileSync(join(import.meta.dir, '../../query.ts'), 'utf8')

    expect(producer).toContain('tengu_toasty_thimble')
    expect(producer).toContain('CLAUDE_CODE_TOASTY_THIMBLE')
    expect(producer).toContain('queued_command')
    expect(producer).toContain('teammate_mailbox')
    expect(producer).toContain('poll_events')
    expect(producer).toContain('INTERRUPT_MESSAGE_FOR_TOOL_USE')
    expect(producer).toContain('CANCEL_MESSAGE')
    expect(producer).not.toContain('function QOs')
    expect(producer).not.toContain('function qXe')

    expect(messages).toContain(
      "message.attachment.type === 'batching_reminder'",
    )
    expect(messages).toContain('pendingBatchingReminderEphemeral')
    expect(messages).toContain(
      'if (markEphemeral) lastMessage.ephemeral = true',
    )
    expect(messages).toContain("case 'batching_reminder':")
    expect(messages).toContain("case 'batching_reminder_sent':")

    expect(query).toContain('injectBatchingReminder')
    expect(query).toContain("type: 'batching_reminder_sent'")
    expect(query).toContain('lastBatchingReminderSent')
  })

  test('injects after tool_result when env text + mid-conv', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    process.env[TOASTY_THIMBLE_ENV] = TIP
    const user = toolResultUser('ok')
    const out = injectBatchingReminder([user], { id: 's1' }, MID_MODEL)
    expect(out.text).toBe(TIP)
    expect(out.afterUuid).toBe(user.uuid)
    expect(out.messages).toHaveLength(2)
    expect(out.messages[1]).toMatchObject({
      type: 'attachment',
      attachment: { type: 'batching_reminder', text: TIP },
    })
  })

  test('no default copy when env and client_data are empty', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    const out = injectBatchingReminder(
      [toolResultUser('ok')],
      { id: 's1' },
      MID_MODEL,
    )
    expect(out.text).toBeNull()
    expect(out.messages).toHaveLength(1)
  })

  test('aborts when mid-conv is off', () => {
    process.env[TOASTY_THIMBLE_ENV] = TIP
    const out = injectBatchingReminder(
      [toolResultUser('ok')],
      { id: 's1' },
      'claude-sonnet-4-6',
    )
    expect(out.text).toBeNull()
  })

  test('env flag values 1/true/0/false are not reminder text', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    for (const flag of ['1', 'true', '0', 'false']) {
      resetBatchingReminderLatch()
      process.env[TOASTY_THIMBLE_ENV] = flag
      const out = injectBatchingReminder(
        [toolResultUser('ok')],
        { id: 's1' },
        MID_MODEL,
      )
      expect(out.text).toBeNull()
    }
  })

  test('aborts on reject/interrupt tool_result prefixes', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    process.env[TOASTY_THIMBLE_ENV] = TIP
    for (const prefix of [
      REJECT_MESSAGE,
      CANCEL_MESSAGE,
      INTERRUPT_MESSAGE_FOR_TOOL_USE,
    ]) {
      resetBatchingReminderLatch()
      const out = injectBatchingReminder(
        [toolResultUser(prefix)],
        { id: 's1' },
        MID_MODEL,
      )
      expect(out.text).toBeNull()
    }
  })

  test('aborts when trailing attachment is queued_command', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    process.env[TOASTY_THIMBLE_ENV] = TIP
    const out = injectBatchingReminder(
      [toolResultUser('ok'), attachment('queued_command', { prompt: 'next' })],
      { id: 's1' },
      MID_MODEL,
    )
    expect(out.text).toBeNull()
  })

  test('skips trailing non-EXo attachments and still inserts', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    process.env[TOASTY_THIMBLE_ENV] = TIP
    const tr = toolResultUser('ok')
    const sent = attachment('batching_reminder_sent', {
      text: TIP,
      model: MID_MODEL,
    })
    const out = injectBatchingReminder([tr, sent], { id: 's1' }, MID_MODEL)
    expect(out.text).toBe(TIP)
    expect(out.afterUuid).toBe(tr.uuid)
    expect(out.messages[1]).toMatchObject({
      type: 'attachment',
      attachment: { type: 'batching_reminder', text: TIP },
    })
    expect(out.messages[2]).toBe(sent)
  })

  test('client_data * map supplies text', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    saveGlobalConfig(c => ({
      ...c,
      clientDataCache: {
        [TOASTY_THIMBLE_FEATURE]: { '*': TIP },
      },
    }))
    const out = injectBatchingReminder(
      [toolResultUser('ok')],
      { id: 's1' },
      MID_MODEL,
    )
    expect(out.text).toBe(TIP)
  })

  test('wXo prefers exact then longest wildcard then *', () => {
    const map = {
      '*': 'star',
      '*sonnet*': 'wild',
      'claude-opus-4-8': 'exact',
    }
    expect(matchToastyThimbleMap(map, 'claude-opus-4-8')).toEqual([
      'claude-opus-4-8',
      'exact',
    ])
    expect(matchToastyThimbleMap(map, 'claude-sonnet-4-6')).toEqual([
      '*sonnet*',
      'wild',
    ])
    expect(matchToastyThimbleMap({ '*': 'star' }, 'other')).toEqual([
      '*',
      'star',
    ])
  })

  test('latches first text per conversation+model', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    process.env[TOASTY_THIMBLE_ENV] = 'first'
    const a = injectBatchingReminder(
      [toolResultUser('ok')],
      { id: 's1' },
      MID_MODEL,
    )
    process.env[TOASTY_THIMBLE_ENV] = 'second'
    const b = injectBatchingReminder(
      [toolResultUser('ok')],
      { id: 's1' },
      MID_MODEL,
    )
    expect(a.text).toBe('first')
    expect(b.text).toBe('first')
  })

  test('omitted r6 does not abort command-name or compact-summary tool_result', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    process.env[TOASTY_THIMBLE_ENV] = TIP
    const withCommand = createUserMessage({
      content: [
        { type: 'text', text: '<command-name>/foo</command-name>' },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'ok',
        },
      ],
    })
    const compact = {
      ...toolResultUser('ok'),
      isCompactSummary: true,
    } as Message
    expect(
      injectBatchingReminder([withCommand], { id: 's1' }, MID_MODEL).text,
    ).toBe(TIP)
    resetBatchingReminderLatch()
    expect(
      injectBatchingReminder([compact], { id: 's1' }, MID_MODEL).text,
    ).toBe(TIP)
  })

  test('C latch marks flushed api_system ephemeral', () => {
    process.env.CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM = '1'
    const messages: Message[] = [
      createUserMessage({ content: 'hello' }),
      attachment('batching_reminder', { text: TIP }),
    ]
    const out = normalizeMessagesForAPI(messages, [], MID_MODEL)
    const sys = out.find(isApiSystemMessage)
    expect(sys).toBeDefined()
    expect(sys!.ephemeral).toBe(true)
    expect(sys!.message.content).toContain(TIP)
  })

  test('!mid-conv drops persisted batching_reminder', () => {
    const messages: Message[] = [
      createUserMessage({ content: 'hello' }),
      attachment('batching_reminder', { text: TIP }),
    ]
    const out = normalizeMessagesForAPI(messages, [], 'claude-sonnet-4-6')
    expect(out.every(m => m.type !== 'api_system')).toBe(true)
    const joined = out
      .map(m =>
        m.type === 'user' && typeof m.message.content === 'string'
          ? m.message.content
          : '',
      )
      .join('')
    expect(joined).not.toContain(TIP)
  })
})
