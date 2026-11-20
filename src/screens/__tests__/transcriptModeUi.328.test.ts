import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildTranscriptShortcutHints,
  packTranscriptShortcutColumns,
} from '../REPL.js'

describe('2.1.328 REPL transcript mode UI & shortcuts (A-P0-1, A-P1-6, A-P2-8)', () => {
  test('A-P0-1: REPL.tsx does not swallow q in local transcript useInput', () => {
    const src = readFileSync(join(import.meta.dir, '../REPL.tsx'), 'utf8')
    expect(src).not.toContain("if (input === 'q')")
  })

  test('A-P1-6: buildTranscriptShortcutHints matches official Hce ordering and copy', () => {
    const hints = buildTranscriptShortcutHints({
      exitShortcut: 'q',
      toggleShortcut: 'ctrl+o',
      editorName: 'vim',
    })
    expect(hints[0]).toBe('q/ctrl+o to exit')
    expect(hints[1]).toBe('? to close')
    expect(hints).toContain('↑/↓/j/k to scroll')
    expect(hints).toContain('ctrl+u/d to move half a page')
    expect(hints).toContain('space/b to move a page')
    expect(hints).toContain('g/G to go to top/bottom')
    expect(hints).toContain('{/} to jump between prompts')
    expect(hints).toContain('/ to search')
    expect(hints).toContain('n/N to cycle matches')
    expect(hints).toContain('[ to print to scrollback')
    expect(hints).toContain('v to open in vim')
  })

  test('A-P1-6: packTranscriptShortcutColumns packs columns and keeps exit/close in short windows', () => {
    const hints = buildTranscriptShortcutHints({
      exitShortcut: 'q',
      toggleShortcut: 'ctrl+o',
    })
    // Wide terminal packs into multiple columns of 3 rows each
    const wide = packTranscriptShortcutColumns(hints, 140, 30, s => s.length)
    expect(wide.length).toBeGreaterThan(1)
    expect(wide[0]![0]).toBe('q/ctrl+o to exit')
    expect(wide[0]![1]).toBe('? to close')

    // Narrow + very short window still keeps exit and close hints visible
    const shortNarrow = packTranscriptShortcutColumns(
      hints,
      30,
      4,
      s => s.length,
    )
    expect(shortNarrow.length).toBe(1)
    expect(shortNarrow[0]).toEqual(['q/ctrl+o to exit', '? to close'])
  })

  test('A-P1-6 + A-P2-8: TranscriptModeFooter copy, badges, and ? toggle wired in REPL.tsx', () => {
    const src = readFileSync(join(import.meta.dir, '../REPL.tsx'), 'utf8')
    expect(src).toContain(
      '${figures.arrowUp}/${figures.arrowDown} to scroll · v to ${openInLabel} · ? for shortcuts',
    )
    expect(src).toContain('? `v to ${openInLabel}`')
    expect(src).toContain("{searchBadge.current} of {searchBadge.count}{' '}")
    expect(src).toContain('const showVerboseBadge = statusLabel === undefined;')
    expect(src).toContain("if (input === '?' && !dumpMode)")
    expect(src).toContain('<TranscriptShortcutsHelp />')
  })
})
