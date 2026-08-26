/**
 * densable gold-spell-ui — PromptInput wires useSpellcheckHighlights.active
 * as `mode === 'prompt' && !isModalOverlayActive` (M3).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Mirror of PromptInput → useSpellcheckHighlights active predicate. */
function spellcheckActive(
  mode: string,
  isModalOverlayActive: boolean,
): boolean {
  return mode === 'prompt' && !isModalOverlayActive
}

describe('PromptInput spellcheck active predicate (M3)', () => {
  test('active only in prompt mode without modal overlay', () => {
    expect(spellcheckActive('prompt', false)).toBe(true)
    expect(spellcheckActive('prompt', true)).toBe(false)
    expect(spellcheckActive('bash', false)).toBe(false)
    expect(spellcheckActive('slash', false)).toBe(false)
  })

  test('PromptInput.tsx wires mode === prompt && !isModalOverlayActive', () => {
    const src = readFileSync(
      join(import.meta.dir, '../PromptInput.tsx'),
      'utf8',
    )
    const idx = src.indexOf('useSpellcheckHighlights({')
    expect(idx).toBeGreaterThanOrEqual(0)
    const block = src.slice(idx, idx + 280)
    expect(block).toMatch(
      /active:\s*mode\s*===\s*['"]prompt['"]\s*&&\s*!isModalOverlayActive/,
    )
    expect(block).not.toMatch(/active:\s*!isModalOverlayActive\s*[,}]/)
  })
})
