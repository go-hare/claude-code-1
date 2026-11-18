import { describe, expect, test } from 'bun:test'
import {
  describeAuthSourceUnset,
  formatApiKeyOverrideReason,
  getCloudSessionsDisabledReason,
} from '../bridgeEnabled.js'

describe('bridgeEnabled #582 & #702 (2.1.302 alignment)', () => {
  test('describeAuthSourceUnset (U2e) covers all auth sources', () => {
    expect(describeAuthSourceUnset('claude.ai')).toBe(
      'claude /logout to sign out of claude.ai.',
    )
    expect(describeAuthSourceUnset('profile')).toContain('ant auth logout')
    expect(describeAuthSourceUnset('anthropic-profile')).toContain(
      'ant auth logout',
    )
    expect(describeAuthSourceUnset('apiKeyHelper')).toBe(
      'Unset the apiKeyHelper setting.',
    )
    expect(describeAuthSourceUnset('CCR_OAUTH_TOKEN_FILE')).toContain(
      'CCR host',
    )
    expect(describeAuthSourceUnset('none')).toBe('')
    expect(describeAuthSourceUnset('CLAUDE_CODE_OAUTH_TOKEN')).toBe(
      'Unset the CLAUDE_CODE_OAUTH_TOKEN environment variable.',
    )
  })

  test('formatApiKeyOverrideReason (rot) handles implicit profile and non-claude.ai token sources', () => {
    expect(
      formatApiKeyOverrideReason({
        prefix: 'Remote Control requires claude.ai subscription auth.',
        suffix: 'to use Remote Control.',
        env: {},
        apiKeySource: { key: null, source: 'none' },
        tokenSource: 'anthropic-profile',
        isImplicitProfileOAuth: true,
      }),
    ).toBe(
      'Remote Control requires claude.ai subscription auth. Run `claude auth login` to use Remote Control.',
    )

    expect(
      formatApiKeyOverrideReason({
        prefix: 'Remote Control requires claude.ai subscription auth.',
        suffix: 'to use Remote Control.',
        env: {},
        apiKeySource: { key: null, source: 'none' },
        tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN',
        isImplicitProfileOAuth: false,
      }),
    ).toBe(
      'Remote Control requires claude.ai subscription auth. This session is using CLAUDE_CODE_OAUTH_TOKEN auth — Unset the CLAUDE_CODE_OAUTH_TOKEN environment variable.',
    )
  })

  test('getCloudSessionsDisabledReason (ihe) #582 apiKeyHelper org_denied short-circuit', () => {
    expect(
      getCloudSessionsDisabledReason({
        provider: 'firstParty',
        policyReason: 'Cloud sessions are disabled.',
        policyVerdict: 'org_denied',
        orgDenialIsAuthoritative: true,
        policyTaints: [],
        apiKeyOverrideSource: 'apiKeyHelper',
      }),
    ).toBe("Cloud sessions are disabled by your organization's policy.")

    const keyMsg = getCloudSessionsDisabledReason({
      provider: 'firstParty',
      policyReason: 'Cloud sessions are disabled.',
      policyVerdict: 'org_denied',
      orgDenialIsAuthoritative: true,
      policyTaints: [],
      apiKeyOverrideSource: 'ANTHROPIC_API_KEY',
      fetchedLoadedKeyAnswer: true,
    })
    expect(keyMsg).toContain('ANTHROPIC_API_KEY')
    expect(keyMsg).toContain('Cloud sessions use your claude.ai login.')
  })

  test('getCloudSessionsDisabledReason (ihe) #702 claude auth login hints', () => {
    expect(
      getCloudSessionsDisabledReason({
        provider: 'firstParty',
        policyReason: 'Cloud sessions are temporarily unavailable.',
        policyVerdict: 'cache_miss',
        loadFailure: {
          errorCode: 'auth_failed',
          host: 'api.anthropic.com',
          httpStatus: 401,
          success: false,
          retrying: true,
        },
        hasClaudeAISubscriberAuth: true,
      }),
    ).toBe(
      "Cloud sessions are temporarily unavailable. If that doesn't help, run `claude auth login` (or /login in a local session).",
    )

    expect(
      getCloudSessionsDisabledReason({
        provider: 'firstParty',
        policyReason: 'Cloud sessions are unavailable.',
        policyVerdict: 'cache_miss',
        loadFailure: {
          errorCode: 'auth_failed',
          host: 'api.anthropic.com',
          httpStatus: 401,
          success: false,
          retrying: false,
        },
        hasClaudeAISubscriberAuth: true,
      }),
    ).toContain(
      'Run `claude auth login` (or /login in a local session), then try again.',
    )

    const apiKeyOverrideMsg = getCloudSessionsDisabledReason({
      provider: 'firstParty',
      policyReason: 'Cloud sessions are unavailable.',
      policyVerdict: 'cache_miss',
      loadFailure: {
        errorCode: 'auth_failed',
        host: 'api.anthropic.com',
        httpStatus: 401,
        success: false,
        retrying: false,
      },
      apiKeyOverrideSource: 'apiKeyHelper',
    })
    expect(apiKeyOverrideMsg).toContain('apiKeyHelper is configured')
    expect(apiKeyOverrideMsg).toContain('to use cloud sessions.')
  })
})
