import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('densable 2.1.289 PromptInputHelpMenu copy', () => {
  test('shell mode, no background row, auto-accept edits, opt on macos', () => {
    const src = readFileSync(
      join(import.meta.dir, '../PromptInputHelpMenu.tsx'),
      'utf8',
    )
    expect(src).toContain('! for shell mode')
    expect(src).not.toContain('! for bash mode')
    expect(src).not.toContain('& for background')
    expect(src).toContain('auto-accept edits')
    expect(src).not.toContain('cycle permission modes')
    expect(src).toContain("s.replace(/\\balt\\b/g, 'opt')")
    expect(src).toContain('s.slice(0, -3)}_')
  })

  test('footer bash pill is shell mode', () => {
    const src = readFileSync(
      join(import.meta.dir, '../PromptInputFooterLeftSide.tsx'),
      'utf8',
    )
    expect(src).toContain('! for shell mode')
    expect(src).not.toContain('! for bash mode')
  })
})
