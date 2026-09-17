import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { wrapInSystemReminder } from '../../../utils/messages.js'
import { readCdDisclosures, shouldShowCdDisclosures } from '../cdDisclosures.js'
import { replaceGatedNotice } from '../CdUntrustedMoveFlow.js'

describe('densable 2.1.246 #52 so / me / Qe', () => {
  test('so reads the target directory, not cwd', () => {
    const here = mkdtempSync(join(tmpdir(), 'so-here-'))
    const there = mkdtempSync(join(tmpdir(), 'so-there-'))
    mkdirSync(join(here, '.claude'), { recursive: true })
    mkdirSync(join(there, '.claude'), { recursive: true })
    writeFileSync(
      join(here, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(pwd *)'] } }),
    )
    writeFileSync(
      join(there, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: {
          allow: ['Bash(echo *)', 'Read'],
          additionalDirectories: ['/tmp/extra'],
        },
      }),
    )
    const disclosures = readCdDisclosures(there)
    expect(disclosures.allowRules.rawCount).toBe(2)
    expect(disclosures.allowRules.rules).toContain('Bash(echo *)')
    expect(disclosures.allowRules.rules).not.toContain('Bash(pwd *)')
    expect(disclosures.additionalDirectories.rawCount).toBe(1)
    expect(shouldShowCdDisclosures(disclosures, false)).toBe(true)
    expect(shouldShowCdDisclosures(disclosures, true)).toBe(true)
  })

  test('Qe replaces the gated notice with the trust-applied reminder', () => {
    const gated = wrapInSystemReminder(
      "Note: /tmp/x declares project permission rules and/or additional directories in its settings, but they are NOT applied — the workspace is trusted only through a parent directory's grant, and project-scoped grants require trusting this directory explicitly. Tool calls those rules would have pre-approved will ask for permission.",
    )
    const model = `before\n${gated}\nafter`
    const next = replaceGatedNotice(model, gated)
    expect(next).toContain(
      'The user trusted this directory explicitly: its project permission rules and additional directories are now applied.',
    )
    expect(next).not.toContain('they are NOT applied')
  })
})
