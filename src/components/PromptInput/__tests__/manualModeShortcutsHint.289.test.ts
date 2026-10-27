import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.289 dHe manual mode footer', () => {
  const src = readFileSync(
    join(import.meta.dir, '../PromptInputFooterLeftSide.tsx'),
    'utf8',
  )

  test('cycle hint only for non-default modes', () => {
    expect(src).toContain(
      "const showModeCycleHint = shouldShowModeHint && currentMode !== 'default' && modeCycleShortcut !== '';",
    )
    expect(src).toContain(
      'cycleShortcut={showModeCycleHint ? modeCycleShortcut : undefined}',
    )
  })

  test('manual mode falls through to "? for shortcuts" ahead of agents hint', () => {
    const at = src.indexOf(
      'if (modePart && !showModeCycleHint && parts.length === 0 && !hasParkedSubagentsHint)',
    )
    expect(at).toBeGreaterThan(-1)
    expect(src.indexOf('key="shortcuts-hint"', at)).toBeLessThan(
      src.indexOf('<AgentsFooterHint key="agents-hint"', at),
    )
    expect(src).toContain('(!modePart || !showModeCycleHint) &&')
  })
})
