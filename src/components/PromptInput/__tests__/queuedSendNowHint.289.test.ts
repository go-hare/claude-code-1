/**
 * densable DualInk jye — queue send-now hint uses B format keyCase lower.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '../PromptInputQueuedCommands.tsx')

describe('densable DualInk jye send-now keyCase lower (289)', () => {
  test('source: KeyboardShortcutHint format keyCase lower', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('action="send now"')
    expect(src).toContain("format={{ keyCase: 'lower' }}")
    expect(src).not.toContain('export function B(')
    expect(src).not.toContain('export function jye(')
  })
})
