import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  pickTranscriptVirtualScrollHints,
  TRANSCRIPT_FOOTER_RIGHT_BADGE,
} from '../transcriptFooterHints.js'

describe('densable 2.1.289 transcript footer l8 `verbose` badge', () => {
  test('pW is "verbose "', () => {
    expect(TRANSCRIPT_FOOTER_RIGHT_BADGE).toBe('verbose ')
  })

  test('REPL footer renders the badge and counts it in the width gate', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(src).toContain('rightBadge: TRANSCRIPT_FOOTER_RIGHT_BADGE,')
    expect(src).toContain(
      '<Text dimColor>{TRANSCRIPT_FOOTER_RIGHT_BADGE}</Text>',
    )
  })

  test('badge width can collapse the scroll hints', () => {
    const opts = {
      stringWidth: (s: string) => s.length,
      toggleShortcut: 'ctrl+o',
      fullHints: '↑↓ scroll · v to open in vi · ? for shortcuts',
    }
    const left =
      2 +
      ['Showing detailed transcript', 'ctrl+o to toggle', opts.fullHints].join(
        ' · ',
      ).length
    const cols = left + 4
    expect(pickTranscriptVirtualScrollHints(cols, opts)).toBe(opts.fullHints)
    expect(
      pickTranscriptVirtualScrollHints(cols, {
        ...opts,
        rightBadge: TRANSCRIPT_FOOTER_RIGHT_BADGE,
      }),
    ).toBe('? for shortcuts')
  })
})
