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
    expect(repl).toContain('idle-return-hint')
    expect(repl).toContain('hint_shown')
    expect(repl).toContain('contextTokens:')
    expect(repl).not.toContain('totalInputTokens: totalTokens')
  })
})
