import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getAdvisorStallPollMs,
  ADVISOR_STALL_POLL_MS,
  ADVISOR_STALL_POLL_OFF_BACKEND_MS,
} from '../advisorNetworkStall.js'
import {
  shouldUseGlobalCacheScope,
  shouldUsePromptCachingScopeBeta,
} from '../betas.js'
import { canonicalEffortModelKey } from '../effort.js'
import { resolveFirstByteDispatchTimeoutMs } from '../firstByteWatchdog.js'
import { parseUserSpecifiedModel } from '../model/model.js'
import { getModelEagerInputStreamingSupport } from '../model/modelCatalogCapabilities.js'
import { resolveOverriddenModel } from '../model/modelStrings.js'
import { isGenuineBedrockEndpoint } from '../model/providers.js'
import {
  getAutoCompactWindowEnvWarning,
  resolveAutoCompactWindowOverride,
} from '../residualFinalEnvGates.js'
import { updateSettingsForSource } from '../settings/settings.js'
import { isFastModeResearchPreview } from '../../commands/fast/fast.js'
import {
  clearUltracodeFlag,
  setUltracodeEffort,
  showCurrentEffort,
} from '../../commands/effort/effort.js'

const SAVED_ENV: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS',
  'CLAUDE_ENABLE_BYTE_WATCHDOG',
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

describe('v2.1.302-2.1.309 utils alignment', () => {
  test('#900: canonicalEffortModelKey maps gateway-prefixed Opus 4 / 4.1', () => {
    expect(canonicalEffortModelKey('anthropic/claude-opus-4-1')).toBe(
      'claude-opus-4-1',
    )
    expect(canonicalEffortModelKey('anthropic/claude-opus-4')).toBe(
      'claude-opus-4-0',
    )
  })

  test('#990: effort.tsx showCurrentEffort and ultracode avoid guessing high when env is auto/unset', () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'auto'
    const res = showCurrentEffort(undefined, 'claude-opus-4-7')
    expect(res.message).toBe('Effort level: auto')
    const offRes = clearUltracodeFlag(undefined, 'claude-opus-4-7')
    expect(offRes.message).toBe('Ultracode off. Effort stays auto.')
    const onRes = setUltracodeEffort('claude-opus-4-7', false, undefined)
    expect(onRes.message).toContain('Effort stays')
  })

  test('#998: CLAUDE_CODE_AUTO_COMPACT_WINDOW accepts k/M suffixes and warns when out of range', () => {
    expect(
      resolveAutoCompactWindowOverride({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200k',
      }),
    ).toBe(200_000)
    expect(
      resolveAutoCompactWindowOverride({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1M',
      }),
    ).toBe(1_000_000)
    expect(
      resolveAutoCompactWindowOverride({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '50k',
      }),
    ).toBe(100_000)
    expect(
      resolveAutoCompactWindowOverride({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '2M',
      }),
    ).toBe(1_000_000)
    expect(
      resolveAutoCompactWindowOverride({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'bogus',
      }),
    ).toBeNull()
    expect(
      getAutoCompactWindowEnvWarning({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200k',
      }),
    ).toBeNull()
    expect(
      getAutoCompactWindowEnvWarning({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '50k',
      }),
    ).toContain('minimum')
    expect(
      getAutoCompactWindowEnvWarning({
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'bogus',
      }),
    ).toContain('ignores it')
  })

  test('#1021: isFastModeResearchPreview is true only for Opus 4.8 and Opus 5, false for Opus 5.5', () => {
    expect(isFastModeResearchPreview('claude-opus-4-8')).toBe(true)
    expect(isFastModeResearchPreview('claude-opus-5')).toBe(true)
    expect(isFastModeResearchPreview('claude-opus-5-5')).toBe(false)
    expect(isFastModeResearchPreview('claude-opus-4-6')).toBe(false)
  })

  test('#1037: resolveOverriddenModel matches case-insensitively and strips [1m]', () => {
    updateSettingsForSource('userSettings', {
      modelOverrides: {
        'claude-opus-4-6': 'Custom-Opus-4-6',
      },
    })
    try {
      expect(resolveOverriddenModel('custom-opus-4-6[1m]')).toBe(
        'claude-opus-4-6',
      )
      expect(resolveOverriddenModel('CUSTOM-OPUS-4-6')).toBe('claude-opus-4-6')
    } finally {
      updateSettingsForSource('userSettings', { modelOverrides: undefined })
    }
  })

  test('#1076: parseUserSpecifiedModel strips [1m] from alias even when CLAUDE_CODE_DISABLE_1M_CONTEXT is set', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    const resolved = parseUserSpecifiedModel('opus[1m]')
    expect(resolved).not.toBe('opus[1m]')
    expect(resolved.endsWith('[1m]')).toBe(false)
  })

  test('#1077: prompt-caching-scope and global cache scope are off behind custom ANTHROPIC_BASE_URL and Foundry', () => {
    expect(shouldUseGlobalCacheScope()).toBe(true)
    expect(shouldUsePromptCachingScopeBeta()).toBe(true)

    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com'
    expect(shouldUseGlobalCacheScope()).toBe(false)
    expect(shouldUsePromptCachingScopeBeta()).toBe(false)
    delete process.env.ANTHROPIC_BASE_URL

    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(shouldUsePromptCachingScopeBeta()).toBe(false)
  })

  test('#1085: resolveFirstByteDispatchTimeoutMs honors CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS on gateway POST', () => {
    const ms = resolveFirstByteDispatchTimeoutMs({
      clientRequestId: undefined,
      provider: 'gateway',
      routedProvider: 'gateway',
      method: 'POST',
      url: 'https://claude.ai/api/v1/messages',
      body: '{}',
      env: {
        CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: '15000',
        CLAUDE_ENABLE_BYTE_WATCHDOG: '1',
      },
    })
    expect(ms).toBe(16000)
  })

  test('#1154: isGenuineBedrockEndpoint allows default bedrock-runtime.<region>.amazonaws.com and rejects proxies', () => {
    expect(isGenuineBedrockEndpoint({})).toBe(true)
    expect(
      isGenuineBedrockEndpoint({
        ANTHROPIC_BEDROCK_BASE_URL:
          'https://bedrock-runtime.us-east-1.amazonaws.com',
      }),
    ).toBe(true)
    expect(
      isGenuineBedrockEndpoint({
        ANTHROPIC_BEDROCK_BASE_URL: 'https://proxy.example.com/bedrock',
      }),
    ).toBe(false)
    const support = getModelEagerInputStreamingSupport('claude-sonnet-4-6')
    expect(support?.bedrock).toBe(true)
  })

  test('#1155: getAdvisorStallPollMs returns 20s on direct firstParty and 45s off Anthropic backend', () => {
    expect(getAdvisorStallPollMs({})).toBe(ADVISOR_STALL_POLL_MS)
    expect(
      getAdvisorStallPollMs({
        ANTHROPIC_BASE_URL: 'https://gateway.example.com',
      }),
    ).toBe(ADVISOR_STALL_POLL_OFF_BACKEND_MS)
  })
})
