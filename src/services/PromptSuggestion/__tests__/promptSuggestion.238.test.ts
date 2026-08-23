import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { emitStatusChange } from '../../claudeAiLimits.js'
import { getSuggestionSuppressReason } from '../promptSuggestion.js'

function appState(overrides: Record<string, unknown> = {}) {
  return {
    promptSuggestionEnabled: true,
    pendingWorkerRequest: false,
    pendingSandboxRequest: false,
    elicitation: { queue: [] as unknown[] },
    toolPermissionContext: { mode: 'default' },
    ...overrides,
  } as never
}

function setLimits(status: 'allowed' | 'allowed_warning' | 'rejected'): void {
  emitStatusChange({
    status,
    unifiedRateLimitFallbackAvailable: false,
    isUsingOverage: false,
  })
}

describe('getSuggestionSuppressReason densable 2.1.238 YUv', () => {
  const prevUserType = process.env.USER_TYPE
  const prevEnv = process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION

  beforeEach(() => {
    process.env.USER_TYPE = 'external'
    delete process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
    setLimits('allowed')
  })

  afterEach(() => {
    setLimits('allowed')
    if (prevUserType === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = prevUserType
    if (prevEnv === undefined) {
      delete process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
    } else {
      process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = prevEnv
    }
  })

  test('allowed → null', () => {
    expect(getSuggestionSuppressReason(appState())).toBeNull()
  })

  test('allowed_warning + env true → null (near-limit still suggest)', () => {
    process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = 'true'
    setLimits('allowed_warning')
    expect(getSuggestionSuppressReason(appState())).toBeNull()
  })

  test('allowed_warning without env override → rate_limit', () => {
    setLimits('allowed_warning')
    expect(getSuggestionSuppressReason(appState())).toBe('rate_limit')
  })

  test('rejected never allowed even with env true', () => {
    process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = 'true'
    setLimits('rejected')
    expect(getSuggestionSuppressReason(appState())).toBe('rate_limit')
  })

  test('non-external USER_TYPE skips rate gate', () => {
    process.env.USER_TYPE = 'ant'
    setLimits('rejected')
    expect(getSuggestionSuppressReason(appState())).toBeNull()
  })
})
