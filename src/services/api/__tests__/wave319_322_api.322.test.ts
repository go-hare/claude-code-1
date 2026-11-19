import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { resetModelStringsForTestingOnly } from '../../../bootstrap/state.js'
import {
  isFirstPartyBehindLlmGateway,
  isLocalAutoModeClassifierSwitchedOff,
  readExternalAutoModeServerRaw,
  resetAutoModeClassifierTransportForTests,
  serverClassifierBetasEligible,
} from '../autoModeClassifierTransport.js'
import {
  StreamTruncatedError,
  wrapMidStreamTlsErrorAsTruncated,
} from '../claude.js'
import {
  formatGatewayErrorMessage,
  getErrorMessageIfRefusal,
  getExpiredClaudeAiAntProfileWarning,
} from '../errors.js'
import { isStaleConnectionError } from '../withRetry.js'
import {
  extractUnansweredTaskNotifications,
  isAsyncAgentOwnedByContext,
  isTaskNotificationMessage,
} from '../../compact/compact.js'
import { withOAuthWallClockTimeout } from '../../oauth/client.js'
import {
  formatAntProfileFallbackWarning,
  formatAntProfileOrganizationLabel,
} from '../../../utils/auth.js'
import {
  bytesPerTokenForModel,
  estimateContextTokensLocally,
} from '../../../utils/analyzeContext.js'
import { getUnknownModelWindowWarning } from '../../../utils/context.js'
import { isKSlFableCreditsRequired } from '../../../utils/extraUsage.js'
import {
  clearSessionFastModeRejections,
  getFastModeModel,
  getVertexFastModeRegionUnavailableReason,
  isFastModeRefusalError,
  isFastModeSupportedByModel,
  isModelFastModeRejectedForSession,
  markModelFastModeRejectedForSession,
  resolveVertexRegionForModel,
  VERTEX_FAST_MODE_REGIONS,
} from '../../../utils/fastMode.js'
import {
  gatewayDeviceAuthorizationResponseSchema,
  stripGatewayUrlCredentials,
} from '../../../utils/gatewayLogin.js'
import {
  ALL_MODEL_CONFIGS,
  CLAUDE_FABLE_5_2_CONFIG,
} from '../../../utils/model/configs.js'
import { isFablePickerRowValue } from '../../../utils/model/fablePicker.js'
import {
  getDefaultFableModel,
  renderModelName,
} from '../../../utils/model/model.js'
import {
  isTlsCertificateVerificationError,
  resolveCertRepairProxyUrl,
} from '../../../utils/mtls.js'
import {
  CYBER_VERIFICATION_NOTICE,
  planSameModelRefusalRetryNudge,
} from '../../../utils/refusalFallback.js'
import { migrateFable51ToFable } from '../../../migrations/migrateFable51ToFable.js'
import { getGlobalConfig, saveGlobalConfig } from '../../../utils/config.js'

const savedEnv = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key]
    }
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v !== undefined) {
      process.env[k] = v
    }
  }
}

beforeEach(() => {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_GATEWAY
  resetModelStringsForTestingOnly()
})

afterEach(() => {
  restoreEnv()
  clearSessionFastModeRejections()
  resetAutoModeClassifierTransportForTests()
  resetModelStringsForTestingOnly()
})

describe('Wave 319-322 Group 2: Auto Mode Classifier Transport (#1699, #1700, #1777, #1806)', () => {
  test('#1699: detects first-party LLM gateway via ANTHROPIC_BASE_URL', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    process.env.ANTHROPIC_BASE_URL = 'https://llm-gateway.internal.example.com'
    expect(isFirstPartyBehindLlmGateway()).toBe(true)

    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
    expect(isFirstPartyBehindLlmGateway()).toBe(false)
  })

  test('#1699: disables local auto mode classifier fallback when telemetry or feature flags are off on firstParty', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
    delete process.env.CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF
    delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    delete process.env.CLAUDE_CODE_AUTO_MODE_SERVER
    process.env.ANTHROPIC_BASE_URL = 'https://llm-gateway.internal.example.com'
    process.env.DISABLE_TELEMETRY = '1'

    expect(isLocalAutoModeClassifierSwitchedOff()).toBe(true)

    // CLAUDE_CODE_AUTO_MODE_SERVER=0 opts back into the built-in classifier
    process.env.CLAUDE_CODE_AUTO_MODE_SERVER = '0'
    expect(isLocalAutoModeClassifierSwitchedOff()).toBe(false)

    // Third-party cloud providers are unchanged
    delete process.env.CLAUDE_CODE_AUTO_MODE_SERVER
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(isLocalAutoModeClassifierSwitchedOff()).toBe(false)
  })

  test('#1806 & #1700: external CLAUDE_CODE_AUTO_MODE_SERVER=0 locks server classifier off and respects experimental beta gate', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    process.env.ANTHROPIC_BASE_URL = 'https://llm-gateway.internal.example.com'

    process.env.CLAUDE_CODE_AUTO_MODE_SERVER = '0'
    expect(readExternalAutoModeServerRaw()).toBe('0')

    // Experimental betas disabled blocks server classifier when CLAUDE_CODE_AUTO_MODE_SERVER is not explicitly set
    delete process.env.CLAUDE_CODE_AUTO_MODE_SERVER
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
    expect(serverClassifierBetasEligible()).toBe(false)

    // Explicit CLAUDE_CODE_AUTO_MODE_SERVER=1 overrides non-managed CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS behind an LLM gateway
    resetAutoModeClassifierTransportForTests()
    process.env.CLAUDE_CODE_AUTO_MODE_SERVER = '1'
    expect(serverClassifierBetasEligible()).toBe(true)
  })
})

describe('Wave 319-322 Group 2: Gateway, Auth & OAuth (#1708, #1712, #1713, #1897, #1932)', () => {
  test('#1708: parses optional login_notice in gateway device authorization response', () => {
    const parsed = gatewayDeviceAuthorizationResponseSchema.parse({
      device_code: 'dev-123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://gw.example.com/verify',
      expires_in: 600,
      login_notice: 'Sign in with your corporate SSO account.',
    })
    expect(parsed.login_notice).toBe('Sign in with your corporate SSO account.')

    // Malformed login_notice is safely caught as undefined
    const parsedBad = gatewayDeviceAuthorizationResponseSchema.parse({
      device_code: 'dev-123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://gw.example.com/verify',
      expires_in: 600,
      login_notice: 42,
    })
    expect(parsedBad.login_notice).toBeUndefined()
  })

  test('#1932: strips username:password credentials from gateway URLs in errors', () => {
    expect(
      stripGatewayUrlCredentials(
        'https://alice:s3cr3t@gateway.corp.example.com/v1/messages?foo=1',
      ),
    ).toBe('https://gateway.corp.example.com/v1/messages')
    expect(
      formatGatewayErrorMessage(
        'https://user:pw@gw.internal.net/api',
        'unauthorized',
      ),
    ).toBe('Gateway error (https://gw.internal.net/api): unauthorized')
  })

  test('#1712 & #1713: formats ant_profile Console label and expired claude.ai fallback warning', () => {
    const label = formatAntProfileOrganizationLabel({
      organizationName: 'Acme Corp',
    })
    expect(label).toBe('Acme Corp (Claude Console)')
    expect(formatAntProfileOrganizationLabel(null)).toBe(
      'your Claude Console organization',
    )
    const warn = formatAntProfileFallbackWarning(label)
    expect(warn).toContain('Acme Corp (Claude Console)')
    expect(warn).toContain('ant auth login')
    // No active ant_profile in clean env → returns null safely
    expect(getExpiredClaudeAiAntProfileWarning()).toBeNull()
  })

  test('#1897: withOAuthWallClockTimeout aborts hung OAuth operations on wall-clock deadline', async () => {
    await expect(
      withOAuthWallClockTimeout(
        25,
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(signal.reason ?? new Error('aborted'))
            })
          }),
      ),
    ).rejects.toThrow()
  })
})

describe('Wave 319-322 Group 2: TLS Cert Repair & Proxy (#1784, #1817)', () => {
  test('#1784: recognizes TLS verification errors', () => {
    expect(
      isTlsCertificateVerificationError(
        Object.assign(new Error('unable to verify'), {
          code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        }),
      ),
    ).toBe(true)
    expect(
      isTlsCertificateVerificationError(
        Object.assign(new Error('self signed'), {
          code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
        }),
      ),
    ).toBe(true)
    expect(isTlsCertificateVerificationError(new Error('ECONNREFUSED'))).toBe(
      false,
    )
  })

  test('#1817: skips cert repair when only ALL_PROXY is set and uses HTTPS_PROXY when present', () => {
    delete process.env.HTTPS_PROXY
    delete process.env.https_proxy
    delete process.env.HTTP_PROXY
    delete process.env.http_proxy
    process.env.ALL_PROXY = 'http://proxy.internal:8080'

    const res = resolveCertRepairProxyUrl('https://api.anthropic.com')
    expect(res.kind).toBe('unusable')

    process.env.HTTPS_PROXY = 'http://proxy.internal:8080'
    const resWithHttps = resolveCertRepairProxyUrl('https://api.anthropic.com')
    expect(resWithHttps.kind).toBe('proxy')
    if (resWithHttps.kind === 'proxy') {
      expect(resWithHttps.url.href).toBe('http://proxy.internal:8080/')
    }
  })
})

describe('Wave 319-322 Group 2: Models, Fable 5.2, Migration, ExtraUsage & FastMode (#1743, #1845, #1851, #1859, #1940, #1963)', () => {
  test('#1845: CLAUDE_FABLE_5_2_CONFIG is registered and default Fable model resolves to claude-fable-5-2', () => {
    expect(ALL_MODEL_CONFIGS.fable52).toBe(CLAUDE_FABLE_5_2_CONFIG)
    expect(CLAUDE_FABLE_5_2_CONFIG.firstParty).toBe('claude-fable-5-2')
    expect(getDefaultFableModel()).toBe('claude-fable-5-2')
    expect(renderModelName('claude-fable-5-2')).toBe('Fable 5.2')
    expect(isFablePickerRowValue('claude-fable-5-2')).toBe(true)
  })

  test('#1940: migrateFable51ToFable respects cutoff and provider guards', () => {
    const original = getGlobalConfig()
    try {
      // Past Dec 15, 2026 UTC cutoff → never migrates
      expect(migrateFable51ToFable(Date.UTC(2026, 11, 16))).toBe(false)
      // Non-firstParty provider → never migrates
      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      expect(migrateFable51ToFable(Date.UTC(2026, 10, 19))).toBe(false)
    } finally {
      saveGlobalConfig(() => original)
    }
  })

  test('#1851: Enterprise included_in_plan seat does not require extra-usage credits for Fable', () => {
    expect(
      isKSlFableCreditsRequired({
        planStatus: 'included_in_plan',
      }),
    ).toBe(false)
  })

  test('#1963: Vertex fast mode supports global/us/eu regions, rejects unsupported regions, and handles session refusal downgrade', () => {
    expect(VERTEX_FAST_MODE_REGIONS.has('global')).toBe(true)
    expect(VERTEX_FAST_MODE_REGIONS.has('us')).toBe(true)
    expect(VERTEX_FAST_MODE_REGIONS.has('eu')).toBe(true)

    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    process.env.CLOUD_ML_REGION = 'asia-northeast1'
    expect(resolveVertexRegionForModel('claude-fable-5-2').region).toBe(
      'asia-northeast1',
    )
    const unavail = getVertexFastModeRegionUnavailableReason('claude-fable-5-2')
    expect(unavail).toContain('global')

    process.env.CLOUD_ML_REGION = 'us'
    expect(
      getVertexFastModeRegionUnavailableReason('claude-fable-5-2'),
    ).toBeNull()
    expect(getFastModeModel()).toBe('claude-fable-5-2')

    markModelFastModeRejectedForSession('claude-fable-5-2')
    expect(isModelFastModeRejectedForSession('claude-fable-5-2')).toBe(true)
    expect(isFastModeSupportedByModel('claude-fable-5-2')).toBe(false)

    expect(
      isFastModeRefusalError(
        new APIError(
          400,
          {
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: 'Fast mode is not enabled for this project',
            },
          },
          'Fast mode is not enabled',
          new Headers(),
        ),
      ),
    ).toBe(true)
  })

  test('#1743: unknown model window warning suggests close canonical model spellings', () => {
    const warn = getUnknownModelWindowWarning('fable-5-2')
    expect(warn).not.toBeNull()
    expect(warn?.suggestion).toBe('claude-fable-5-2')
  })

  test('#1859: local context token estimation uses model bytes-per-token and tool overhead', () => {
    expect(bytesPerTokenForModel('claude-opus-4-6')).toBeGreaterThan(0)
    const tokens = estimateContextTokensLocally(
      [{ role: 'user', content: 'Hello world' }],
      [
        {
          name: 'Read',
          description: 'Read a file',
          input_schema: { type: 'object', properties: {} },
        },
      ],
      'claude-opus-4-6',
    )
    expect(tokens).toBeGreaterThan(100)
  })
})

describe('Wave 319-322 Group 2: Refusal Fallback, Mid-Stream TLS & Compact (#1790, #1852, #1862, #1878, #1953)', () => {
  test('#1852 & #1953: virtual nudge when refusal producedNothing and CYBER_VERIFICATION_NOTICE in refusal message', () => {
    const plan = planSameModelRefusalRetryNudge({
      producedNothing: true,
      interruptedToolCount: 0,
    })
    expect(plan.isVirtual).toBe(true)
    expect(plan.nudgeSent).toBe(false)

    expect(CYBER_VERIFICATION_NOTICE).toContain('Cyber Verification Program')
    const msg = getErrorMessageIfRefusal('refusal', 'claude-opus-4-6', {
      category: 'cyber',
    })
    const contentBlocks = msg?.message.content
    const firstBlock = Array.isArray(contentBlocks)
      ? contentBlocks[0]
      : undefined
    const text =
      firstBlock && typeof firstBlock === 'object' && 'text' in firstBlock
        ? String(firstBlock.text)
        : ''
    expect(text).toContain('Cyber Verification Program')
  })

  test('#1878: wraps mid-stream EPROTO / ERR_SSL_* as StreamTruncatedError and classifies as stale connection', () => {
    const sslErr = Object.assign(
      new Error('EPROTO: The TLS handshake failed'),
      {
        code: 'EPROTO',
      },
    )
    const wrapped = wrapMidStreamTlsErrorAsTruncated(sslErr, true)
    expect(wrapped).toBeInstanceOf(StreamTruncatedError)
    expect(isStaleConnectionError(wrapped)).toBe(true)

    // Before any stream event arrives, leave untouched
    const unwrapped = wrapMidStreamTlsErrorAsTruncated(sslErr, false)
    expect(unwrapped).toBe(sslErr)
  })

  test('#1790: filters async agent ownership by ownerAgentId / parentAgentId', () => {
    expect(
      isAsyncAgentOwnedByContext(
        { agentId: 'child-1', ownerAgentId: 'agent-A' },
        'agent-A',
      ),
    ).toBe(true)
    expect(
      isAsyncAgentOwnedByContext(
        { agentId: 'child-2', ownerAgentId: 'agent-B' },
        'agent-A',
      ),
    ).toBe(false)
    expect(
      isAsyncAgentOwnedByContext(
        { agentId: 'child-3', parentAgentId: 'agent-A' },
        'agent-A',
      ),
    ).toBe(true)
    expect(
      isAsyncAgentOwnedByContext(
        {
          agentId: 'child-4',
          ownerAgentId: undefined,
          parentAgentId: undefined,
        },
        undefined,
      ),
    ).toBe(true)
  })

  test('#1862: preserves unanswered background subagent task-notification reports across compaction', () => {
    const messages = [
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'start task' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'started' }],
        },
      },
      {
        type: 'user',
        uuid: 'u2',
        message: {
          role: 'user',
          content:
            '<task-notification><task-id>bg-1</task-id><status>completed</status><summary>Finished indexing</summary></task-notification>',
        },
      },
    ] as unknown as Parameters<typeof extractUnansweredTaskNotifications>[0]

    expect(isTaskNotificationMessage(messages[2]!)).toBe(true)
    expect(isTaskNotificationMessage(messages[0]!)).toBe(false)
    const preserved = extractUnansweredTaskNotifications(messages)
    expect(preserved).toHaveLength(1)
    expect(String(preserved[0]!.uuid)).toBe('u2')
  })
})
