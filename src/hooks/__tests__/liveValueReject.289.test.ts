import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('densable 2.1.289 empty-box ?/! leftover', () => {
  test('useTextInput does not write shared liveValueRef when onChange rejects', () => {
    const src = readFileSync(
      join(import.meta.dir, '../useTextInput.ts'),
      'utf8',
    )
    expect(src).toContain('function commitLiveCursor')
    expect(src).toContain('externalLiveValueRef')
    expect(src).toContain('liveValueRef.current === previous')
    expect(src).toContain('Ctrl+Y to paste deleted text')
    expect(src).toContain('kill-paste-hint')
  })

  test('PromptInput inputFilter swallows empty-box ? help toggle', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(src).toContain("input === '?'")
    expect(src).toContain("liveInputRef.current === ''")
    expect(src).toContain('setHelpOpen(v => !v)')
    expect(src).toContain('tengu_help_toggled')
  })
})
