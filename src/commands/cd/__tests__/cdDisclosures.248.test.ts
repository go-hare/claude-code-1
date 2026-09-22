import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readCdDisclosures } from '../cdDisclosures.js'

describe('densable 2.1.248 #28 d / de trust-rule cut', () => {
  test('long allow rule cut drops a mid-emoji high surrogate', () => {
    const there = mkdtempSync(join(tmpdir(), 'd-248-'))
    mkdirSync(join(there, '.claude'), { recursive: true })
    // MAX_DISCLOSURE_ENTRY_LENGTH=200. 'Bash(' + 194 x + 👋 (U+1F44B = 2
    // units) + tail. Unit 199 is the high surrogate; slice(0,200) would
    // keep a lone U+D83D; de/Jd drops it.
    const rule = `Bash(${'x'.repeat(194)}👋YYYY*)`
    writeFileSync(
      join(there, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: [rule] } }),
    )
    const shown = readCdDisclosures(there).allowRules.rules[0]
    expect(shown).toBe(`Bash(${'x'.repeat(194)}…`)
    expect(shown).not.toContain('\uD83D')
    expect(shown).not.toContain('\uDC4B')
  })
})
