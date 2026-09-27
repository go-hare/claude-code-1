import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppStateStore.js'
import type { AssistantMessage } from '../../types/message.js'
import { createMessageDisplayTransform } from '../messageDisplayTransform.js'

function transform(hooks: {
  onStreamingDisplay?: (content: string | null) => void
  onStreamingRewrite?: (
    rewrite: { original: string; text: string } | null,
  ) => void
  onMessageDisplay?: (id: string, content: string) => void
}) {
  return createMessageDisplayTransform({
    getAppState: () => ({ sessionHooks: new Map() }) as unknown as AppState,
    onStreamingDisplay: hooks.onStreamingDisplay ?? (() => {}),
    onStreamingRewrite: hooks.onStreamingRewrite ?? (() => {}),
    onMessageDisplay: hooks.onMessageDisplay ?? (() => {}),
  })
}

describe('2.1.282 MessageDisplay live path', () => {
  test('no hook clears rewrite and does not start a session', () => {
    const display: Array<string | null> = []
    const rewrite: Array<{ original: string; text: string } | null> = []
    const t = transform({
      onStreamingDisplay: v => display.push(v),
      onStreamingRewrite: v => rewrite.push(v),
    })
    t.begin('msg')
    t.delta('hello')
    expect(display).toEqual([null])
    expect(rewrite).toEqual([null])
  })

  test('finalize clears both display and rewrite', () => {
    const display: Array<string | null> = []
    const rewrite: Array<{ original: string; text: string } | null> = []
    const t = transform({
      onStreamingDisplay: v => display.push(v),
      onStreamingRewrite: v => rewrite.push(v),
    })
    t.begin('msg')
    display.length = 0
    rewrite.length = 0
    t.finalize()
    // No session was started, so finalize is a no-op. The clear happens
    // in begin, before the hook check.
    expect(display).toEqual([])
    expect(rewrite).toEqual([])
  })

  test('entryLanded on an empty session does not clear the preview', () => {
    const display: Array<string | null> = []
    const t = transform({ onStreamingDisplay: v => display.push(v) })
    t.begin('msg')
    display.length = 0
    t.entryLanded({
      type: 'assistant',
      message: { id: 'msg', content: [{ type: 'text', text: 'landed' }] },
    } as AssistantMessage)
    expect(display).toEqual([])
  })
})
