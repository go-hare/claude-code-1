import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  progressiveThinkingLabel,
  thinkingFadeIntensity,
  THINKING_DEEP_MS,
  THINKING_MORE_MS,
  THINKING_SOME_MORE_MS,
  THINKING_STILL_MS,
} from '../thinkingFade.js'
import { STALL_AFTER_MS, STALL_FADE_MS } from '../useStalledAnimation.js'

describe('densable 2.1.289 Ye/ze/no spinner color', () => {
  test('Ye stall is 10s after last token, fade 10s', () => {
    expect(STALL_AFTER_MS).toBe(10_000)
    expect(STALL_FADE_MS).toBe(10_000)
    const src = readFileSync(
      join(import.meta.dir, '../useStalledAnimation.ts'),
      'utf8',
    )
    expect(src).toContain(
      'timeSinceLastToken > STALL_AFTER_MS && !hasActiveTools',
    )
    expect(src).toContain(
      '(timeSinceLastToken - STALL_AFTER_MS) / STALL_FADE_MS',
    )
    expect(src).not.toContain('3_000')
    expect(src).not.toContain('2_000')
  })

  test('no() Yn/Jn/Qn/Zn labels', () => {
    expect(THINKING_STILL_MS).toBe(10_000)
    expect(THINKING_MORE_MS).toBe(20_000)
    expect(THINKING_SOME_MORE_MS).toBe(30_000)
    expect(THINKING_DEEP_MS).toBe(45_000)
    expect(progressiveThinkingLabel(0)).toBe('thinking')
    expect(progressiveThinkingLabel(9_999)).toBe('thinking')
    expect(progressiveThinkingLabel(10_000)).toBe('still thinking')
    expect(progressiveThinkingLabel(19_999)).toBe('still thinking')
    expect(progressiveThinkingLabel(20_000)).toBe('thinking more')
    expect(progressiveThinkingLabel(29_999)).toBe('thinking more')
    expect(progressiveThinkingLabel(30_000)).toBe('thinking some more')
    expect(progressiveThinkingLabel(44_999)).toBe('thinking some more')
    expect(progressiveThinkingLabel(45_000)).toBe('deep in thought')
    expect(progressiveThinkingLabel(7 * 60_000)).toBe('deep in thought')
  })

  test('ze thinkingIntensity after 10s of burst, fade 10s, tools/not-thinking zero', () => {
    const start = 1_000_000
    expect(thinkingFadeIntensity(start, start, true, false)).toBe(0)
    expect(thinkingFadeIntensity(start + 10_000, start, true, false)).toBe(0)
    expect(thinkingFadeIntensity(start + 15_000, start, true, false)).toBe(0.5)
    expect(thinkingFadeIntensity(start + 20_000, start, true, false)).toBe(1)
    expect(thinkingFadeIntensity(start + 30_000, start, true, false)).toBe(1)
    expect(thinkingFadeIntensity(start + 20_000, start, true, true)).toBe(0)
    expect(thinkingFadeIntensity(start + 20_000, start, false, false)).toBe(0)
    expect(thinkingFadeIntensity(start + 20_000, null, true, false)).toBe(0)
  })

  test('Je stallHold includes thinking, pause, compact-not-responding', () => {
    const src = readFileSync(
      join(import.meta.dir, '../SpinnerAnimationRow.tsx'),
      'utf8',
    )
    expect(src).toContain("mode === 'thinking'")
    expect(src).toContain("isCompacting && mode !== 'responding'")
    expect(src).toContain('pauseStartTimeRef.current !== null')
    expect(src).toContain(
      'thinkingIntensity={overrideColor ? 0 : thinkingIntensity}',
    )
    expect(src).toContain('formatSpinnerStatusText')
    expect(src).toContain('thinkingFadeIntensity')
    expect(src).toContain('tengu_spinner_stalled_ui')
    expect(src).toContain('STALL_TELEMETRY_THRESHOLDS_MS')
    expect(src).toContain('showToolCallTimer')
    expect(src).toContain('outputLimitRecovery')
    expect(src).toContain('Math.floor(time / 120)')
    expect(src).not.toContain('pingPongFrameIndex(')
    expect(src).not.toContain('getDefaultCharacters().length')
  })

  test('RTt/Rte fade thinkingIntensity toward warning after stall', () => {
    const glimmer = readFileSync(
      join(import.meta.dir, '../GlimmerMessage.tsx'),
      'utf8',
    )
    const glyph = readFileSync(
      join(import.meta.dir, '../SpinnerGlyph.tsx'),
      'utf8',
    )
    expect(glimmer).toContain('thinkingIntensity')
    expect(glimmer).toContain('theme.warning')
    expect(glimmer.indexOf('thinkingIntensity > 0')).toBeGreaterThan(
      glimmer.indexOf('stalledIntensity > 0'),
    )
    expect(glyph).toContain('thinkingIntensity')
    expect(glyph).toContain('theme.warning')
    expect(glyph).toContain('thinkingIntensity >= 0.5')
  })
})
