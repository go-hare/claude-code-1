/**
 * densable 236 #31/#32 — session title chip + footer-right notices.
 * Gold: FSh/kPE (`hideSessionTitle`), $Ir (fill + padded chip + one `─`),
 * Notifications column `alignItems:flex-end, flexShrink:1, overflowX:hidden`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { computeStandaloneAgentContext } from '../../../utils/sessionRestore.js'
import {
  hideSessionTitleFromTasks,
  swarmBannerFillColumns,
  swarmBannerGradientSegments,
} from '../useSwarmBanner.js'

describe('hideSessionTitleFromTasks (densable FSh/kPE)', () => {
  test('undefined snapshot (hidden/disabled) does not hide the chip', () => {
    expect(hideSessionTitleFromTasks(undefined)).toBe(false)
  })

  test('empty visible list does not hide the chip', () => {
    expect(hideSessionTitleFromTasks([])).toBe(false)
  })

  test('visible non-empty Tasks V2 list hides the standalone title', () => {
    expect(hideSessionTitleFromTasks([{ id: '1' }])).toBe(true)
  })
})

describe('swarmBannerFillColumns (densable $Ir)', () => {
  test('fill + padded chip + one trailing dash equals columns', () => {
    const columns = 80
    const textWidth = 12
    const fill = swarmBannerFillColumns(columns, textWidth)
    expect(fill).toBe(columns - (textWidth + 2) - 1)
    expect(fill + (textWidth + 2) + 1).toBe(columns)
  })

  test('empty text is a full-width rule (no trailing chip dash)', () => {
    expect(swarmBannerFillColumns(80, 0)).toBe(80)
  })
})

describe('computeStandaloneAgentContext (densable LMo + g8)', () => {
  test('keeps prideGradient when the log has no name/color', () => {
    expect(
      computeStandaloneAgentContext(undefined, undefined, ['red', 'orange']),
    ).toEqual({
      name: '',
      color: undefined,
      prideGradient: ['red', 'orange'],
    })
  })

  test('merges log name/color with previous prideGradient', () => {
    expect(computeStandaloneAgentContext('chip', 'blue', ['red'])).toEqual({
      name: 'chip',
      color: 'blue',
      prideGradient: ['red'],
    })
  })

  test('empty log and empty gradient is undefined', () => {
    expect(computeStandaloneAgentContext(undefined, undefined)).toBeUndefined()
  })
})

describe('swarmBannerGradientSegments (densable Biy)', () => {
  test('splits remainder onto the first colors', () => {
    expect(swarmBannerGradientSegments(5, ['a', 'b'])).toEqual([
      { color: 'a', dashes: 3 },
      { color: 'b', dashes: 2 },
    ])
  })

  test('empty count or colors is a no-op', () => {
    expect(swarmBannerGradientSegments(0, ['a'])).toEqual([])
    expect(swarmBannerGradientSegments(4, [])).toEqual([])
  })
})

describe('PromptInput wires gold FSh / $Ir / Notifications', () => {
  const prompt = readFileSync(
    join(import.meta.dir, '../PromptInput.tsx'),
    'utf8',
  )
  const hook = readFileSync(
    join(import.meta.dir, '../useSwarmBanner.ts'),
    'utf8',
  )
  const notif = readFileSync(
    join(import.meta.dir, '../Notifications.tsx'),
    'utf8',
  )

  test('REPL and ResumeConversation merge prev prideGradient (g8)', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    const resume = readFileSync(
      join(import.meta.dir, '../../../screens/ResumeConversation.tsx'),
      'utf8',
    )
    expect(repl).toContain('prev.standaloneAgentContext?.prideGradient')
    expect(resume).toContain('prev.standaloneAgentContext?.prideGradient')
  })

  test('PromptInput passes FSh analog into zRr', () => {
    expect(prompt).toContain('hideSessionTitleFromTasks(tasksV2)')
    expect(prompt).toMatch(/useSwarmBanner\(\{\s*hideSessionTitle\s*\}/)
    expect(hook).toContain('!hideSessionTitle &&')
    expect(hook).toContain('prideGradient?.length')
  })

  test('$Ir fill uses one trailing dash, not two', () => {
    expect(prompt).toContain('swarmBannerFillColumns(')
    expect(prompt).not.toContain("{'──'}")
  })

  test('Notifications column matches gold flex-end + shrink + overflowX', () => {
    expect(notif).toContain('alignItems="flex-end"')
    expect(notif).toContain('flexShrink={1}')
    expect(notif).toContain('overflowX="hidden"')
  })
})
