import { describe, expect, test } from 'bun:test'
import {
  evaluateResumeReturnOffer,
  formatResumeReturnAge,
  formatResumeReturnBanner,
  getResumePrompt,
  getResumeReturnWarning,
  getResumeThresholdMinutes,
  getResumeTokenThreshold,
  parseEnvInt,
  RESUME_PROMPT_DEFAULT,
  RESUME_RETURN_OPTIONS,
  RESUME_THRESHOLD_MINUTES_DEFAULT,
  RESUME_TOKEN_THRESHOLD_DEFAULT,
} from '../resumeReturn.js'

describe('parseEnvInt / thresholds', () => {
  test('defaults', () => {
    expect(parseEnvInt(undefined, 70)).toBe(70)
    expect(parseEnvInt('abc', 70)).toBe(70)
    expect(parseEnvInt('90', 70)).toBe(90)
    expect(getResumeThresholdMinutes({})).toBe(RESUME_THRESHOLD_MINUTES_DEFAULT)
    expect(getResumeTokenThreshold({})).toBe(RESUME_TOKEN_THRESHOLD_DEFAULT)
    expect(
      getResumeThresholdMinutes({ CLAUDE_CODE_RESUME_THRESHOLD_MINUTES: '30' }),
    ).toBe(30)
    expect(
      getResumeTokenThreshold({ CLAUDE_CODE_RESUME_TOKEN_THRESHOLD: '5000' }),
    ).toBe(5000)
  })

  test('densable 211: scientific notation and digit separators', () => {
    expect(parseEnvInt('1e6', 0)).toBe(1_000_000)
    expect(parseEnvInt('64_000', 0)).toBe(64_000)
    expect(parseEnvInt('1.5e3', 0)).toBe(1500)
    expect(
      getResumeTokenThreshold({
        CLAUDE_CODE_RESUME_TOKEN_THRESHOLD: '1e5',
      }),
    ).toBe(100_000)
    expect(
      getResumeTokenThreshold({
        CLAUDE_CODE_RESUME_TOKEN_THRESHOLD: '100_000',
      }),
    ).toBe(100_000)
  })
})

describe('getResumePrompt (kdo)', () => {
  test('default and override', () => {
    expect(getResumePrompt({})).toBe(RESUME_PROMPT_DEFAULT)
    expect(
      getResumePrompt({ CLAUDE_CODE_RESUME_PROMPT: 'Pick up the work.' }),
    ).toBe('Pick up the work.')
  })
})

describe('copy', () => {
  test('banner + warning + options', () => {
    expect(formatResumeReturnAge(59)).toBe('59m')
    expect(formatResumeReturnAge(60)).toBe('1h')
    expect(formatResumeReturnAge(70)).toBe('1h 10m')
    expect(formatResumeReturnAge(120)).toBe('2h')
    expect(formatResumeReturnBanner(70, 100_000)).toBe(
      'This session is 1h 10m old and 100k tokens.',
    )
    expect(getResumeReturnWarning()).toContain('usage limits')
    expect(RESUME_RETURN_OPTIONS.map(o => o.value)).toEqual([
      'compact',
      'continue',
      'never',
    ])
  })
})

describe('evaluateResumeReturnOffer (CBp)', () => {
  const now = Date.parse('2026-07-14T12:00:00.000Z')
  const oldTs = new Date(now - 80 * 60_000).toISOString() // 80 min ago
  const msgs = [
    { type: 'user', timestamp: oldTs },
    { type: 'assistant', timestamp: oldTs },
  ]

  test('null when gb off', () => {
    expect(
      evaluateResumeReturnOffer(msgs, () => 200_000, {
        gbEnabled: false,
        resumeReturnDismissed: false,
        nowMs: now,
      }),
    ).toBeNull()
  })

  test('null when dismissed', () => {
    expect(
      evaluateResumeReturnOffer(msgs, () => 200_000, {
        gbEnabled: true,
        resumeReturnDismissed: true,
        nowMs: now,
      }),
    ).toBeNull()
  })

  test('null when too young', () => {
    const young = [
      {
        type: 'user',
        timestamp: new Date(now - 10 * 60_000).toISOString(),
      },
    ]
    expect(
      evaluateResumeReturnOffer(young, () => 200_000, {
        gbEnabled: true,
        resumeReturnDismissed: false,
        nowMs: now,
      }),
    ).toBeNull()
  })

  test('null when under token threshold', () => {
    expect(
      evaluateResumeReturnOffer(msgs, () => 50, {
        gbEnabled: true,
        resumeReturnDismissed: false,
        nowMs: now,
      }),
    ).toBeNull()
  })

  test('offers when age + tokens clear thresholds', () => {
    const offer = evaluateResumeReturnOffer(msgs, () => 150_000, {
      gbEnabled: true,
      resumeReturnDismissed: false,
      nowMs: now,
      env: {},
    })
    expect(offer).not.toBeNull()
    expect(offer!.estimatedTokens).toBe(150_000)
    expect(offer!.sessionAgeMinutes).toBeGreaterThan(70)
  })
})
