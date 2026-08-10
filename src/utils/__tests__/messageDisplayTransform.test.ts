import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppStateStore.js'
import type { AssistantMessage } from '../../types/message.js'
import {
  pruneDisplayedMessageContent,
  scanCcMemoryTags,
  stripCcMemoryFromContentBlocks,
  stripCcMemoryTags,
  transformCompletedAssistantMessage,
} from '../messageDisplayTransform.js'

describe('stripCcMemoryTags densable RH', () => {
  test('strips open/close cc-memory tags, keeps inner text (RH tag-only)', () => {
    // densable RH = /<\/?cc-memory\b[^>]*>/g — tags only, not content
    const src =
      'before <cc-memory filenames="a.md">mem</cc-memory> after </cc-memory>'
    expect(stripCcMemoryTags(src)).toBe('before mem after ')
  })

  test('no-op when no cc-memory marker', () => {
    expect(stripCcMemoryTags('plain text')).toBe('plain text')
  })
})

describe('pruneDisplayedMessageContent densable z$l', () => {
  const base = {
    displayedMessageContent: {
      msg1: 'one',
      msg2: 'two',
      stale: 'gone',
    },
  } as unknown as AppState

  test('keeps only live assistant message ids', () => {
    const next = pruneDisplayedMessageContent(base, [
      { type: 'assistant', message: { id: 'msg1' } },
      { type: 'user' },
      { type: 'assistant', message: { id: 'msg2' } },
    ])
    expect(next).not.toBe(base)
    expect(next.displayedMessageContent).toEqual({
      msg1: 'one',
      msg2: 'two',
    })
  })

  test('returns same state when nothing to prune', () => {
    const state = {
      displayedMessageContent: { msg1: 'one' },
    } as unknown as AppState
    const next = pruneDisplayedMessageContent(state, [
      { type: 'assistant', message: { id: 'msg1' } },
    ])
    expect(next).toBe(state)
  })

  test('returns same state when map empty', () => {
    const state = { displayedMessageContent: {} } as unknown as AppState
    const next = pruneDisplayedMessageContent(state, [])
    expect(next).toBe(state)
  })
})

describe('scanCcMemoryTags densable dau', () => {
  test('counts open/close tags and content chars', () => {
    const src = 'x<cc-memory filenames="a.md,b.md">inner</cc-memory>y'
    const s = scanCcMemoryTags(src)
    expect(s.openTagCount).toBe(1)
    expect(s.closeTagCount).toBe(1)
    expect(s.taggedContentChars).toBe('inner'.length)
    expect(s.memoryFileCount).toBe(2)
    expect(s.missingFilenamesAttr).toBe(false)
  })
})

describe('stripCcMemoryFromContentBlocks densable ilr', () => {
  test('strips tags on text and thinking only', () => {
    const content = [
      { type: 'text', text: 'a <cc-memory>m</cc-memory> b' },
      { type: 'thinking', thinking: '<cc-memory>t</cc-memory>ok' },
      { type: 'tool_use', id: '1' },
    ]
    const next = stripCcMemoryFromContentBlocks(content)
    expect(next).not.toBe(content)
    expect(next[0]).toEqual({ type: 'text', text: 'a m b' })
    expect(next[1]).toEqual({ type: 'thinking', thinking: 'tok' })
    expect(next[2]).toBe(content[2])
  })
})

describe('transformCompletedAssistantMessage densable Tth', () => {
  test('ilr strips tags when no MessageDisplay hooks', async () => {
    const msg = {
      type: 'assistant',
      uuid: 'u1',
      message: {
        id: 'm1',
        content: [
          { type: 'text', text: 'hello <cc-memory>x</cc-memory> world' },
          { type: 'text', text: 'second' },
        ],
      },
    } as unknown as AssistantMessage
    const out = await transformCompletedAssistantMessage(
      msg,
      'turn',
      () =>
        ({
          // empty hooks → hasHookForEvent false
          sessionHooks: new Map(),
        }) as unknown as AppState,
    )
    expect(out).not.toBe(msg)
    const blocks = out.message.content as Array<{ type: string; text?: string }>
    expect(blocks[0]?.text).toBe('hello x world')
    expect(blocks[1]?.text).toBe('second')
  })
})
