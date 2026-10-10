/**
 * densable 2.1.289 `/keybindings` unique English.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '../keybindings.ts')

describe('densable 2.1.289 /keybindings unique English', () => {
  test('disabled / write-failed / Safe-mode suffix copy', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain(
      'Keybinding customization is disabled in this environment.',
    )
    expect(src).toContain('keybindings template write failed:')
    expect(src).toContain(
      'Safe mode: custom keybindings are disabled this session — changes take effect after you',
    )
  })
})
