/**
 * densable 2.1.239 idle-return is ungated hint-only.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../..')

describe('idle-return hint-only (densable 2.1.239)', () => {
  test('REPL has no focused idle-return / IdleReturnDialog invent', () => {
    const repl = readFileSync(join(root, 'screens/REPL.tsx'), 'utf8')
    expect(repl).not.toContain('IdleReturnDialog')
    expect(repl).not.toMatch(/['"]idle-return['"]/)
    expect(repl).not.toContain('idleReturnPending')
    expect(repl).not.toContain('skipIdleCheckRef')
    expect(repl).not.toMatch(/willowMode === 'dialog'/)
    expect(repl).not.toContain('willowMode variant')
    expect(repl).toContain('idle-return-hint')
    expect(repl).toContain('hint_shown')
    expect(repl).toMatch(/kind:\s*['"]contextual['"]/)
    expect(repl).toContain('hintRef.current = true')
    expect(repl).toContain('idleReturnContextTokens')
    expect(repl).toContain('contextTokens:')
    expect(repl).not.toContain('getTotalInputTokens()')
    expect(repl).not.toContain('totalInputTokens: totalTokens')
    expect(repl).not.toContain("hintRef.current = 'hint_v2'")
    expect(repl).not.toContain('lastTranscriptActivityMs')
    expect(repl).not.toContain('variant: idleHintShownRef')
    expect(repl).toContain('immediate-ended-by-model')
    expect(repl).toContain("kind: 'feedback'")
    expect(repl).toContain('isEndedByModelCommandBlocked')
    expect(repl).not.toContain('isStickyContextual')
  })
})
