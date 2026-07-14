import { describe, expect, test } from 'bun:test'
import {
  AUTO_BACKGROUND_TIMEOUT_FLOOR_MS,
  clampTimeoutForAutoBackground,
  resolveAgentAutoBackgroundMs,
} from '../autoBackgroundTimeout.js'

describe('clampTimeoutForAutoBackground', () => {
  test('no-op when not main agent', () => {
    expect(
      clampTimeoutForAutoBackground({
        requestedTimeoutMs: 120_000,
        isMainAgent: false,
        canAutoBackground: true,
        env: { CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS: '5000' },
      }),
    ).toBe(120_000)
  })

  test('no-op when cannot auto-background', () => {
    expect(
      clampTimeoutForAutoBackground({
        requestedTimeoutMs: 120_000,
        isMainAgent: true,
        canAutoBackground: false,
        env: { CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS: '5000' },
      }),
    ).toBe(120_000)
  })

  test('clamps to env with floor 2000', () => {
    expect(
      clampTimeoutForAutoBackground({
        requestedTimeoutMs: 120_000,
        isMainAgent: true,
        canAutoBackground: true,
        env: { CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS: '5000' },
      }),
    ).toBe(5000)
  })

  test('env below floor raises to floor', () => {
    expect(
      clampTimeoutForAutoBackground({
        requestedTimeoutMs: 120_000,
        isMainAgent: true,
        canAutoBackground: true,
        env: { CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS: '500' },
      }),
    ).toBe(AUTO_BACKGROUND_TIMEOUT_FLOOR_MS)
  })

  test('invalid env leaves requested', () => {
    expect(
      clampTimeoutForAutoBackground({
        requestedTimeoutMs: 60_000,
        isMainAgent: true,
        canAutoBackground: true,
        env: { CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS: 'nope' },
      }),
    ).toBe(60_000)
  })
})

describe('resolveAgentAutoBackgroundMs', () => {
  test('disabled by default', () => {
    expect(resolveAgentAutoBackgroundMs({ env: {}, gbEnabled: false })).toBe(0)
  })

  test('env enables with default 120s', () => {
    expect(
      resolveAgentAutoBackgroundMs({
        env: { CLAUDE_AUTO_BACKGROUND_TASKS: '1' },
      }),
    ).toBe(120_000)
  })

  test('timeout env overrides default when enabled', () => {
    expect(
      resolveAgentAutoBackgroundMs({
        env: {
          CLAUDE_AUTO_BACKGROUND_TASKS: '1',
          CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS: '8000',
        },
      }),
    ).toBe(8000)
  })

  test('gb enables', () => {
    expect(resolveAgentAutoBackgroundMs({ env: {}, gbEnabled: true })).toBe(
      120_000,
    )
  })
})
