import { describe, expect, test } from 'bun:test'
import { filterForBriefTool } from '../Messages.js'

type BriefMsg = Parameters<typeof filterForBriefTool>[0][number]

function userMsg(
  text: string,
  opts: {
    isMeta?: boolean
    origin?: { kind?: string; senderTaskId?: string }
  } = {},
): BriefMsg {
  return {
    type: 'user',
    isMeta: opts.isMeta,
    origin: opts.origin,
    message: { content: [{ type: 'text' }] },
  }
}

function attachmentMsg(opts: {
  isMeta?: boolean
  origin?: { kind?: string; senderTaskId?: string }
  commandMode?: string
}): BriefMsg {
  return {
    type: 'attachment',
    attachment: {
      type: 'queued_command',
      commandMode: opts.commandMode ?? 'prompt',
      isMeta: opts.isMeta,
      origin: opts.origin,
    },
  }
}

describe('filterForBriefTool densable Ace/IDd', () => {
  test('keeps non-meta user input', () => {
    const out = filterForBriefTool([userMsg('hi')], [])
    expect(out).toHaveLength(1)
  })

  test('drops bare isMeta tick', () => {
    const out = filterForBriefTool([userMsg('tick', { isMeta: true })], [])
    expect(out).toHaveLength(0)
  })

  test('keeps meta peer with senderTaskId / channel / observer / observer-activity', () => {
    const msgs = [
      userMsg('p', {
        isMeta: true,
        origin: { kind: 'peer', senderTaskId: 't1' },
      }),
      userMsg('c', { isMeta: true, origin: { kind: 'channel' } }),
      userMsg('o', { isMeta: true, origin: { kind: 'observer' } }),
      userMsg('oa', { isMeta: true, origin: { kind: 'observer-activity' } }),
    ]
    expect(filterForBriefTool(msgs, [])).toHaveLength(4)
  })

  test('drops bare peer meta without senderTaskId', () => {
    const out = filterForBriefTool(
      [userMsg('p', { isMeta: true, origin: { kind: 'peer' } })],
      [],
    )
    expect(out).toHaveLength(0)
  })

  test('attachment: human drain (no origin, !isMeta) kept', () => {
    const out = filterForBriefTool([attachmentMsg({})], [])
    expect(out).toHaveLength(1)
  })

  test('attachment: Ace origin kept even when isMeta', () => {
    const out = filterForBriefTool(
      [
        attachmentMsg({
          isMeta: true,
          origin: { kind: 'peer', senderTaskId: 't1' },
        }),
      ],
      [],
    )
    expect(out).toHaveLength(1)
  })

  test('attachment: task-notification origin dropped', () => {
    const out = filterForBriefTool(
      [attachmentMsg({ origin: { kind: 'task-notification' } })],
      [],
    )
    expect(out).toHaveLength(0)
  })

  test('attachment: isMeta human-like without Ace dropped', () => {
    const out = filterForBriefTool(
      [attachmentMsg({ isMeta: true, origin: { kind: 'human' } })],
      [],
    )
    expect(out).toHaveLength(0)
  })
})
