/**
 * densable 2.1.218 #14 — plugin/settings focus row moves terminal cursor
 * via ListItem.declareCursor + useDeclaredCursor.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const listItemSrc = readFileSync(
  join(import.meta.dir, '../ListItem.tsx'),
  'utf8',
)
// theme/__tests__ → packages/@ant/ink/src/theme/__tests__ → 6×.. = repo root
const repoRoot = join(import.meta.dir, '../../../../../../')
const selectOptionSrc = readFileSync(
  join(repoRoot, 'src/components/CustomSelect/select-option.tsx'),
  'utf8',
)

describe('densable 2.1.218 #14 declareCursor', () => {
  test('ListItem accepts declareCursor prop and gates useDeclaredCursor', () => {
    expect(listItemSrc).toContain('declareCursor')
    expect(listItemSrc).toContain('useDeclaredCursor')
    // active when focused, not disabled, and declareCursor !== false
    expect(listItemSrc).toContain('declareCursor !== false')
    expect(listItemSrc).toMatch(
      /active:\s*isFocused\s*&&\s*!disabled\s*&&\s*declareCursor\s*!==\s*false/,
    )
  })

  test('SelectOption forwards declareCursor to ListItem', () => {
    expect(selectOptionSrc).toContain('declareCursor')
    expect(selectOptionSrc).toContain('declareCursor={declareCursor}')
  })

  test('CustomSelect can disable parent cursor when child owns it', () => {
    // select-input-option sets declareCursor={false} when embedding text input
    const inputOption = readFileSync(
      join(repoRoot, 'src/components/CustomSelect/select-input-option.tsx'),
      'utf8',
    )
    expect(inputOption).toContain('declareCursor={false}')
  })
})
