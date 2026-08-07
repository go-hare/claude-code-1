import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ATTACH_DEFAULT_COLOR_LEVEL,
  ATTACH_MARKDOWN_BUDGET,
  ATTACH_MARKDOWN_TIME_BUDGET_MS,
  ATTACH_TRANSCRIPT_TAIL_BYTES,
  COLD_ATTACH_SHOWING_TRANSCRIPT,
  formatColdAttachTranscriptPreview,
  formatTranscriptTailFrame,
} from '../attachTranscriptPreview.js'

describe('attachTranscriptPreview densable Nia/J5_', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  test('formatTranscriptTailFrame includes B5_ footer and user/assistant text', () => {
    const utf8 = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'hello from user' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hi from assistant' }],
        },
      }),
    ].join('\n')
    const frame = formatTranscriptTailFrame(utf8, 80, 24)
    expect(frame).not.toBeNull()
    expect(frame!).toContain('hello from user')
    expect(frame!).toContain('hi from assistant')
    expect(frame!).toContain(COLD_ATTACH_SHOWING_TRANSCRIPT)
  })

  test('densable zgb #14: one-line gap before footer rule/pointer chrome', () => {
    const utf8 = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'gap check body' },
    })
    // colorLevel 0 keeps footer plain (no dim SGR) so structure is readable.
    const frame = formatTranscriptTailFrame(utf8, 40, 16, { colorLevel: 0 })
    expect(frame).not.toBeNull()
    const lines = frame!.split('\r\n')
    expect(lines[lines.length - 1]).toBe(COLD_ATTACH_SHOWING_TRANSCRIPT)
    expect(lines[lines.length - 2]).toBe('─'.repeat(40))
    expect(lines[lines.length - 3]).toBe('›')
    expect(lines[lines.length - 4]).toBe('─'.repeat(40))
    // densable u=["",c,b6p,c,Ngb] — leading "" is the body↔chrome gap
    expect(lines[lines.length - 5]).toBe('')
    expect(frame!).toContain('gap check body')
  })

  test('formatColdAttachTranscriptPreview reads file tail', () => {
    dir = mkdtempSync(join(tmpdir(), 'cold-attach-'))
    const path = join(dir, 'sess.jsonl')
    writeFileSync(
      path,
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'tail content visible' },
      }) + '\n',
      'utf-8',
    )
    const frame = formatColdAttachTranscriptPreview(path, 80, 20)
    expect(frame).not.toBeNull()
    expect(frame!).toContain('tail content visible')
    expect(frame!).toContain(COLD_ATTACH_SHOWING_TRANSCRIPT)
  })

  test('missing file returns null', () => {
    expect(
      formatColdAttachTranscriptPreview(
        join(tmpdir(), 'no-such-transcript-xyz.jsonl'),
        80,
        20,
      ),
    ).toBeNull()
  })

  test('FPp constant matches densable', () => {
    expect(ATTACH_TRANSCRIPT_TAIL_BYTES).toBe(262_144)
  })

  test('M5_/O5_/F5_ constants match densable', () => {
    expect(ATTACH_MARKDOWN_BUDGET).toBe(4096)
    expect(ATTACH_MARKDOWN_TIME_BUDGET_MS).toBe(50)
    expect(ATTACH_DEFAULT_COLOR_LEVEL).toBe(2)
  })

  test('colorLevel 0 skips dim ANSI on footer', () => {
    const utf8 = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'plain' },
    })
    const withColor = formatTranscriptTailFrame(utf8, 80, 20, {
      colorLevel: 2,
    })
    const noColor = formatTranscriptTailFrame(utf8, 80, 20, { colorLevel: 0 })
    expect(withColor).not.toBeNull()
    expect(noColor).not.toBeNull()
    expect(withColor!).toContain('\x1B[2m')
    expect(noColor!).not.toContain('\x1B[2m')
  })

  test('J5_ theme chalk: user line gets ANSI when colorLevel>0', () => {
    const utf8 = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'themed user' },
    })
    const frame = formatTranscriptTailFrame(utf8, 80, 20, {
      colorLevel: 2,
      theme: 'dark',
    })
    expect(frame).not.toBeNull()
    expect(frame!).toContain('themed user')
    // densable zn color path — some SGR sequence present for themed user line
    expect(frame!.includes('\x1B[')).toBe(true)
  })

  test('J5_ assistant markdown path runs under M5_/O5_', () => {
    const utf8 = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello **bold** world' }],
      },
    })
    const frame = formatTranscriptTailFrame(utf8, 80, 24, {
      colorLevel: 2,
      theme: 'dark',
    })
    expect(frame).not.toBeNull()
    expect(frame!).toContain('hello')
    expect(frame!).toContain('world')
  })
})
