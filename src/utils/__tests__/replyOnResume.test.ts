import { describe, expect, test } from 'bun:test'
import {
  buildInterruptedOutputHintContent,
  buildInterruptedOutputNotice,
  checkInterruptedOutputBoundary,
  escapeInterruptedOutputFence,
  formatPartialHintLog,
  formatPrefillBoundaryMismatchLog,
} from '../replyOnResume.js'

describe('escapeInterruptedOutputFence', () => {
  test('escapes angle brackets only (official nLp)', () => {
    expect(escapeInterruptedOutputFence('a<b>&c>d')).toBe('a&lt;b&gt;&c&gt;d')
  })
})

describe('checkInterruptedOutputBoundary', () => {
  test('rejects empty', () => {
    expect(checkInterruptedOutputBoundary({ text: '' }, 'x').reason).toBe(
      'empty_text',
    )
  })
  test('rejects mismatch', () => {
    expect(
      checkInterruptedOutputBoundary(
        { text: 'hi', boundaryUuid: 'press' },
        'fork',
      ).reason,
    ).toBe('boundary_mismatch')
  })
  test('accepts matching or missing boundary', () => {
    expect(
      checkInterruptedOutputBoundary(
        { text: 'hi', boundaryUuid: 'same' },
        'same',
      ).accept,
    ).toBe(true)
    expect(checkInterruptedOutputBoundary({ text: 'hi' }, 'fork').accept).toBe(
      true,
    )
  })
})

describe('buildInterruptedOutputHintContent', () => {
  test('fences escaped partial with official copy', () => {
    const body = buildInterruptedOutputHintContent('partial <tool>')
    expect(body).toContain('<interrupted-output>')
    expect(body).toContain('partial &lt;tool&gt;')
    expect(body).toContain('</interrupted-output>')
    expect(body).toContain('interrupted mid-generation')
    expect(body).toContain('tool/file/web content')
    expect(body).toContain('without repeating it')
  })
})

describe('buildInterruptedOutputNotice', () => {
  test('includes partial when provided', () => {
    expect(buildInterruptedOutputNotice('hello')).toContain(
      'Text before the interruption',
    )
    expect(buildInterruptedOutputNotice('hello')).toContain('hello')
    expect(buildInterruptedOutputNotice()).toBe(
      'Continuing an interrupted response.',
    )
  })
})

describe('reply-on-resume logs', () => {
  test('boundary mismatch + partial hint', () => {
    expect(formatPrefillBoundaryMismatchLog('a', 'b')).toContain(
      'boundary mismatch',
    )
    expect(formatPartialHintLog(12)).toBe(
      '[reply-on-resume] partial-hint 12 chars',
    )
  })
})
