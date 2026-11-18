import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { APIError } from '@anthropic-ai/sdk'
import {
  findRejectedBetaHeaders,
  isPromptTooLongErrorMessage,
} from '../errors.js'
import { getRetryWatchdogUsageLimitRecheckMs } from '../withRetry.js'
import { getSuggestionSuppressReason } from '../../PromptSuggestion/promptSuggestion.js'
import { isSearchExtraToolsEnabledOptimistic } from '../../../utils/searchExtraTools.js'
import { CONTEXT_MANAGEMENT_BETA_HEADER } from '../../../constants/betas.js'
import type { AppState } from '../../../state/AppState.js'

const SAVED_ENV: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS',
  'USER_TYPE',
]

beforeEach(() => {
  for (const k of ENV_KEYS) {
    SAVED_ENV[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k]
    else process.env[k] = SAVED_ENV[k]
  }
})

describe('v2.1.302-2.1.309 API & OAuth alignment', () => {
  test('#912: getSuggestionSuppressReason suppresses with usage_credits when billedToUsageCredits is true', () => {
    process.env.USER_TYPE = 'external'
    const fakeAppState = {
      promptSuggestionEnabled: true,
      pendingWorkerRequest: null,
      pendingSandboxRequest: null,
      elicitation: { queue: [] },
      toolPermissionContext: { mode: 'default' },
    } as unknown as AppState
    expect(getSuggestionSuppressReason(fakeAppState, true)).toBe(
      'usage_credits',
    )
  })

  test('#979: findRejectedBetaHeaders matches context_management Extra inputs are not permitted', () => {
    const err = new APIError(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'context_management: Extra inputs are not permitted',
        },
      },
      '400 context_management: Extra inputs are not permitted',
      new Headers(),
    )
    const matches = findRejectedBetaHeaders(err, [
      CONTEXT_MANAGEMENT_BETA_HEADER,
    ])
    expect(matches.length).toBe(1)
    expect(matches[0]?.header).toBe(CONTEXT_MANAGEMENT_BETA_HEADER)
  })

  test('#1015: isSearchExtraToolsEnabledOptimistic defaults to true behind custom ANTHROPIC_BASE_URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com'
    expect(isSearchExtraToolsEnabledOptimistic()).toBe(true)
  })

  test('#1035: getRetryWatchdogUsageLimitRecheckMs parses CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS', () => {
    expect(getRetryWatchdogUsageLimitRecheckMs()).toBeUndefined()
    process.env.CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS = '30000'
    expect(getRetryWatchdogUsageLimitRecheckMs()).toBe(30000)
  })

  test('#1073: isPromptTooLongErrorMessage excludes MCP schema maxlength / policy_blocked errors', () => {
    expect(
      isPromptTooLongErrorMessage(
        'string too long. expected a string with maximum length 1024, exceeds the maximum number of tokens allowed',
      ),
    ).toBe(false)
    expect(
      isPromptTooLongErrorMessage('policy_blocked: maximum context length'),
    ).toBe(false)
    expect(
      isPromptTooLongErrorMessage(
        'prompt is too long: 210000 tokens > 200000 maximum',
      ),
    ).toBe(true)
  })

  test('#982, #1005, #1036, #1099, #1136: source wiring checks', () => {
    const groveSrc = readFileSync(
      join(process.cwd(), 'src/services/api/grove.ts'),
      'utf8',
    )
    expect(groveSrc).toContain('getGroveNoticeConfig.cache.clear?.()')
    expect(groveSrc).toContain('groveChoiceSeenAt')

    const claudeSrc = readFileSync(
      join(process.cwd(), 'src/services/api/claude.ts'),
      'utf8',
    )
    expect(claudeSrc).not.toContain(
      'recordServerClassifierRequest(\n        serverClassifierRequest.key,\n        slimClassifierContextForHistory(classifierContext)',
    )
    expect(claudeSrc).toContain('ToolSearchRefusalError')
    expect(claudeSrc).toContain('_toolSearchRefusalRetried')

    const oauthSrc = readFileSync(
      join(process.cwd(), 'src/services/oauth/index.ts'),
      'utf8',
    )
    const redirectIdx = oauthSrc.indexOf('handleSuccessRedirect(scopes)')
    const profileIdx = oauthSrc.indexOf('client.fetchProfileInfo(')
    expect(redirectIdx).toBeGreaterThan(-1)
    expect(profileIdx).toBeGreaterThan(redirectIdx)

    const authSrc = readFileSync(
      join(process.cwd(), 'src/utils/auth.ts'),
      'utf8',
    )
    expect(authSrc).toContain('keepInjectedAppSessionToken')
    expect(authSrc).toContain(
      'The login saved on this machine was not used because it may be a different account',
    )
  })
})
