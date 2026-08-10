import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearStreamingToolJsonPreview,
  decodePartialReplCodeJson,
  isReplStreamingPreviewEnabled,
  updateStreamingToolJsonPreview,
} from '../streamingToolJsonPreview.js'

describe('streamingToolJsonPreview (densable ALp/xLp/CLp)', () => {
  afterEach(() => {
    clearStreamingToolJsonPreview()
    delete process.env.CLAUDE_REPL_VERBOSE
  })

  test('ALp decodes partial {"code":"... JSON', () => {
    expect(decodePartialReplCodeJson('{"code":"hello\\nworld')).toBe(
      'hello\nworld',
    )
    expect(decodePartialReplCodeJson('{"code":"x\\"y')).toBe('x"y')
    expect(decodePartialReplCodeJson('not-json')).toBe('')
  })

  test('g4e gate requires CLAUDE_REPL_VERBOSE', () => {
    process.env.CLAUDE_REPL_VERBOSE = '0'
    expect(isReplStreamingPreviewEnabled()).toBe(false)
  })

  test('xLp no-ops when preview gate off', () => {
    delete process.env.CLAUDE_REPL_VERBOSE
    let called = 0
    updateStreamingToolJsonPreview(0, '{"code":"hi', () => {
      called++
      return []
    })
    expect(called).toBe(0)
  })
})
