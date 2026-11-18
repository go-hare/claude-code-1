import { describe, expect, test } from 'bun:test'
import {
  formatArtifactPolicyError,
  formatArtifactPolicyToolGuidance,
  formatArtifactPolicyUserMessage,
  isCoworkOauthNotAllowedForOrg,
} from '../artifactPolicyMessages.js'

describe('v2.1.292 #236 Cowork cloud artifact policy error distinction', () => {
  test('distinguishes Cowork cloud HTTP 403 oauth_not_allowed_for_organization from proxy block', () => {
    const cowork403 = {
      cause: 'policy_fetch_failed',
      isCoworkCloud: true,
      outcome: {
        success: false,
        httpStatus: 403,
        host: 'api.anthropic.com',
        serverErrorCode: 'oauth_not_allowed_for_organization',
      },
    }
    expect(isCoworkOauthNotAllowedForOrg(cowork403)).toBe(true)
    expect(formatArtifactPolicyUserMessage(cowork403)).toContain(
      "Anthropic couldn't confirm your organization's settings for this cloud session (HTTP 403). This isn't a problem with your network.",
    )
    expect(formatArtifactPolicyToolGuidance(cowork403)).toContain(
      "and that it isn't a problem with their network.",
    )
    expect(formatArtifactPolicyError(cowork403)).not.toContain('IT admin')
  })

  test('non-403 policy_fetch_failed mentions background retry and IT admin guidance', () => {
    const pending = {
      cause: 'policy_fetch_failed',
      isCoworkCloud: false,
      outcome: {
        success: false,
        httpStatus: null,
        host: 'api.anthropic.com',
      },
    }
    expect(isCoworkOauthNotAllowedForOrg(pending)).toBe(false)
    expect(formatArtifactPolicyToolGuidance(pending)).toContain(
      'whether artifacts are allowed is decided once it loads. Do not retry this call now.',
    )
  })

  test('policy_route_missing (404) mentions proxy/gateway not forwarding policy_limits', () => {
    const missing = {
      cause: 'policy_route_missing',
      isCoworkCloud: false,
      outcome: {
        success: false,
        httpStatus: 404,
        host: 'proxy.corp.local',
      },
    }
    expect(formatArtifactPolicyUserMessage(missing)).toContain('404')
    expect(formatArtifactPolicyToolGuidance(missing)).toContain(
      'will keep answering 404',
    )
  })
})
