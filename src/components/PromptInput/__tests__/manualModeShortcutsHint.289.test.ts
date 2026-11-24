import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('2.1.328 manual mode footer (Prt / jl / sc)', () => {
  const src = readFileSync(
    join(import.meta.dir, '../PromptInputFooterLeftSide.tsx'),
    'utf8',
  )

  test('cycle hint only for non-default modes and respects rowWidth fit (sc)', () => {
    expect(src).toContain(
      "const showModeCycleHint =\n    shouldShowModeHint && currentMode !== 'default' && modeCycleShortcut !== '' && cycleHintFitsRow;",
    )
    expect(src).toContain('cycleShortcut={effectiveCycleShortcut}')
  })

  test('manual mode uses single-winner priority without stacking "? for shortcuts" and agents hint', () => {
    expect(src).toContain('resolveFullscreenFooterHint')
    expect(src).not.toContain(
      'if (modePart && !showModeCycleHint && parts.length === 0 && !hasParkedSubagentsHint)',
    )
    expect(src).toContain('(!modePart || !showModeCycleHint) &&')
  })
})
