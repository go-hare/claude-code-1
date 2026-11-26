import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findNonHeaderRowIndex } from '../AgentView.js'

describe('2.1.290 #49/#56/#61/#75 AgentView alignments', () => {
  test('#56/#61 findNonHeaderRowIndex avoids landing on header rows', () => {
    const rows = [
      { kind: 'header' },
      { kind: 'job' },
      { kind: 'header' },
      { kind: 'job' },
    ]
    expect(findNonHeaderRowIndex(rows, 2)).toBe(1)
    expect(findNonHeaderRowIndex(rows, 0)).toBe(1)
    expect(findNonHeaderRowIndex(rows, 3)).toBe(3)
    expect(findNonHeaderRowIndex([], 0)).toBe(0)
  })

  test('#49/#56/#61/#75 source invariants in AgentView.tsx', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'AgentView.tsx'),
      'utf8',
    )
    // #49 restartOfferedJobId (per-session RootSessionSlot) + non-Esc check
    expect(src).toContain('restartOfferedJobId: null')
    expect(src).toContain('new RootSessionSlot<AgentViewSessionState>')
    expect(src).toContain("trigger !== 'esc'")
    // #56/#61 no ctrl+x bulk delete on header row
    expect(src).not.toContain("deleteConfirmSessionId === '*done*'")
    // #61 Esc clearing dispatchInput restores non-header focus
    expect(src).toContain(
      'setSelectedIndex(idx => findNonHeaderRowIndex(flatRows, idx));',
    )
    // #75 forceFresh included in skipIntentReplay
    expect(src).toContain(
      'const skipIntentReplay = hasMessages || resumePointsElsewhere || forceFresh;',
    )
  })
})
