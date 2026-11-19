import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { APIError } from '@anthropic-ai/sdk'
import type { Message } from 'src/types/message.js'
import { runWithCrossProcessAuthRefreshLock } from '../../../utils/auth.js'
import {
  getFsImplementation,
  setFsImplementation,
  setOriginalFsImplementation,
} from '../../../utils/fsOperations.js'
import { getContextWindowForModel } from '../../../utils/context.js'
import { getOrgPolicyAxiosProxyConfig } from '../../../utils/proxy.js'
import { sanitizeLoneSurrogatesInPlace } from '../../../utils/sanitization.js'
import {
  extractQuotaStatusFromHeaders,
  extractRawUtilization,
  isSideRequestQuerySourceForRateLimits,
} from '../../claudeAiLimits.js'
import {
  getAutoCompactThreshold,
  isCloudAutocompactPctOverrideExempt,
} from '../../compact/autoCompact.js'
import { splitUnansweredTrailingTurn } from '../../compact/compact.js'
import { formatOAuthSignInError } from '../../oauth/client.js'
import {
  getRateLimitErrorMessage,
  isCloudOrRemoteControlSession,
} from '../../rateLimitMessages.js'
import {
  formatNameConstraintCertErrorMessage,
  isBedrockModelAccessRefusalError,
  NAME_CONSTRAINT_CERT_ERROR_CODES,
} from '../errors.js'
import {
  OVERLOADED_RETRY_MAX_DELAY_MAX_MS,
  OVERLOADED_RETRY_MAX_DELAY_MIN_MS,
  shouldOpenUsageLimitMenuAfterWaitRefusal,
} from '../withRetry.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 323 Group 2 — API, Auth, Models, Compact, Rate Limits', () => {
  test('#1980: splitUnansweredTrailingTurn preserves unanswered trailing user message', () => {
    const msgs = [
      {
        type: 'user',
        uuid: 'u1',
        message: { role: 'user', content: 'first' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      },
      {
        type: 'user',
        uuid: 'u2',
        message: { role: 'user', content: 'please do this after compact' },
      },
    ] as unknown as Message[]

    const { toSummarize, toKeep } = splitUnansweredTrailingTurn(msgs)
    expect(toSummarize).toHaveLength(2)
    expect(toKeep).toHaveLength(1)
    expect((toKeep[0] as { uuid?: string } | undefined)?.uuid).toBe('u2')
  })

  test('#2006: isBedrockModelAccessRefusalError detects Bedrock 403 model access refusal', () => {
    const prevBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    try {
      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      const refusal = new APIError(
        403,
        {
          error: {
            message:
              "You don't have access to the model with the specified model ID.",
          },
        },
        "You don't have access to the model with the specified model ID.",
        new Headers(),
      )
      expect(isBedrockModelAccessRefusalError(refusal)).toBe(true)

      const credExpired = new APIError(
        403,
        {
          error: {
            message: 'The security token included in the request is expired',
          },
        },
        'The security token included in the request is expired',
        new Headers(),
      )
      expect(isBedrockModelAccessRefusalError(credExpired)).toBe(false)

      // #2006 regression: generic "model ID" errors or on-demand throughput 400s
      // must NOT be misclassified as model-access refusals.
      const onDemand400 = new APIError(
        400,
        {
          error: {
            message:
              'Invocation of model ID anthropic.claude-3-5-sonnet with on-demand throughput isn’t supported.',
          },
        },
        'Invocation of model ID anthropic.claude-3-5-sonnet with on-demand throughput isn’t supported.',
        new Headers(),
      )
      expect(isBedrockModelAccessRefusalError(onDemand400)).toBe(false)

      const invalidOnDemand400 = new APIError(
        400,
        {
          error: {
            message:
              'The provided model identifier is invalid for on-demand throughput.',
          },
        },
        'The provided model identifier is invalid for on-demand throughput.',
        new Headers(),
      )
      expect(isBedrockModelAccessRefusalError(invalidOnDemand400)).toBe(false)

      const invalidModelId400 = new APIError(
        400,
        {
          error: {
            message: 'The provided model identifier is invalid.',
          },
        },
        'The provided model identifier is invalid.',
        new Headers(),
      )
      expect(isBedrockModelAccessRefusalError(invalidModelId400)).toBe(true)

      const notAvailable = new APIError(
        403,
        {
          error: {
            message:
              'anthropic.claude-opus-4-6-v1:0 is not available for this account',
          },
        },
        'anthropic.claude-opus-4-6-v1:0 is not available for this account',
        new Headers(),
      )
      expect(isBedrockModelAccessRefusalError(notAvailable)).toBe(true)

      const genericModelId = new Error('Unknown model ID parameter in request')
      expect(isBedrockModelAccessRefusalError(genericModelId)).toBe(false)
    } finally {
      if (prevBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK
      else process.env.CLAUDE_CODE_USE_BEDROCK = prevBedrock
    }
  })

  test('#2007: runWithCrossProcessAuthRefreshLock coalesces concurrent calls', async () => {
    const lockDir = makeTempDir('w323-authlock-')
    let runs = 0
    const run = async (): Promise<boolean> => {
      runs++
      await new Promise(r => setTimeout(r, 30))
      return true
    }
    const [r1, r2, r3] = await Promise.all([
      runWithCrossProcessAuthRefreshLock('aws', run, { lockDir }),
      runWithCrossProcessAuthRefreshLock('aws', run, { lockDir }),
      runWithCrossProcessAuthRefreshLock('aws', run, { lockDir }),
    ])
    expect(runs).toBe(1)
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    expect(r3).toBe(true)
  })

  test('#2007: runWithCrossProcessAuthRefreshLock avoids busy-spin on EACCES and non-ENOENT stat errors', async () => {
    const lockDir = makeTempDir('w323-authlock-err-')
    const lockPath = join(lockDir, '.aws-auth-refresh.lock')
    writeFileSync(lockPath, '99999\n0\n')

    const baseFs = getFsImplementation()
    // 1. EACCES breaks immediately and falls back to running directly
    let eaccesStatCalls = 0
    setFsImplementation({
      ...baseFs,
      statSync: (p: string) => {
        if (p === lockPath) {
          eaccesStatCalls++
          throw Object.assign(new Error('permission denied'), {
            code: 'EACCES',
          })
        }
        return baseFs.statSync(p)
      },
    })
    try {
      let ran = 0
      const ok = await runWithCrossProcessAuthRefreshLock(
        'aws',
        async () => {
          ran++
          return true
        },
        { lockDir, pollMs: 25, maxWaitMs: 5_000 },
      )
      expect(ok).toBe(true)
      expect(ran).toBe(1)
      expect(eaccesStatCalls).toBe(1)
    } finally {
      setOriginalFsImplementation()
    }

    // 2. Non-ENOENT transient error (EIO) sleeps pollMs instead of 100% CPU busy-spinning
    let eioStatCalls = 0
    setFsImplementation({
      ...baseFs,
      statSync: (p: string) => {
        if (p === lockPath) {
          eioStatCalls++
          throw Object.assign(new Error('io error'), { code: 'EIO' })
        }
        return baseFs.statSync(p)
      },
    })
    try {
      const ok = await runWithCrossProcessAuthRefreshLock(
        'aws',
        async () => true,
        { lockDir, pollMs: 25, maxWaitMs: 70 },
      )
      expect(ok).toBe(true)
      // At 25ms poll over 70ms maxWaitMs, should only poll a few times (never thousands)
      expect(eioStatCalls).toBeGreaterThanOrEqual(1)
      expect(eioStatCalls).toBeLessThanOrEqual(6)
    } finally {
      setOriginalFsImplementation()
    }
  })

  test('#2062: sanitizeLoneSurrogatesInPlace repairs lone UTF-16 surrogates in both keys and values', () => {
    const brokenKey = `param_\uD83D_name`
    const payload: Record<string, unknown> = {
      tool_input: {
        [brokenKey]: `value_\uDC00_end`,
      },
    }
    sanitizeLoneSurrogatesInPlace(payload, true)
    const toolInput = payload.tool_input as Record<string, string>
    const keys = Object.keys(toolInput)
    expect(keys).toEqual(['param_\uFFFD_name'])
    expect(toolInput['param_\uFFFD_name']).toBe('value_\uFFFD_end')
  })

  test('#2072: certificate name-constraint error codes and actionable guidance', () => {
    expect(NAME_CONSTRAINT_CERT_ERROR_CODES.has('PERMITTED_VIOLATION')).toBe(
      true,
    )
    expect(NAME_CONSTRAINT_CERT_ERROR_CODES.has('EXCLUDED_VIOLATION')).toBe(
      true,
    )
    const msg = formatNameConstraintCertErrorMessage('PERMITTED_VIOLATION')
    expect(msg).toContain('name constraint')
    expect(msg).toContain('certificate')
  })

  test('#2105: side request on smaller model is classified as side request for rate limits', () => {
    expect(isSideRequestQuerySourceForRateLimits('title_generation')).toBe(true)
    expect(isSideRequestQuerySourceForRateLimits('prompt_suggestion')).toBe(
      true,
    )
    expect(isSideRequestQuerySourceForRateLimits('repl_main_thread')).toBe(
      false,
    )
    const headers = new Headers({
      'anthropic-ratelimit-unified-status': 'allowed',
    })
    expect(() =>
      extractQuotaStatusFromHeaders(headers, Date.now(), {
        querySource: 'title_generation',
      }),
    ).not.toThrow()
  })

  test('#2106 & #2162: seven_day_overage_included reset hint and non-interactive continuation text', () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 7200
    const raw = extractRawUtilization(
      new Headers({
        'anthropic-ratelimit-unified-7d_oi-utilization': '1.0',
        'anthropic-ratelimit-unified-7d_oi-reset': String(resetsAt),
      }),
    )
    expect(raw.seven_day_overage_included?.utilization).toBe(1)
    expect(raw.seven_day_overage_included?.resets_at).toBe(resetsAt)

    const msg = getRateLimitErrorMessage(
      {
        status: 'rejected',
        rateLimitType: 'seven_day_overage_included',
        resetsAt,
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
        overageStatus: 'rejected',
        overageDisabledReason: 'out_of_credits',
      },
      'claude-opus-4-6',
    )
    expect(msg).toContain('Fable limit')
    expect(msg).toContain('resets')
  })

  test('#2107: shouldOpenUsageLimitMenuAfterWaitRefusal returns true on 429 refusal after wait', () => {
    const err429 = new APIError(
      429,
      {},
      'rate limited',
      new Headers({ 'anthropic-ratelimit-unified-status': 'rejected' }),
    )
    expect(
      shouldOpenUsageLimitMenuAfterWaitRefusal(err429, {
        choseWaitInMenu: true,
      }),
    ).toBe(true)
    expect(
      shouldOpenUsageLimitMenuAfterWaitRefusal(err429, {
        choseWaitInMenu: false,
      }),
    ).toBe(false)
  })

  test('#2148: formatOAuthSignInError gives clear guidance for timeout / unreachable / rejected', () => {
    const timeoutErr = Object.assign(new Error('timeout of 30000ms exceeded'), {
      code: 'ECONNABORTED',
    })
    const timeoutFormatted = formatOAuthSignInError(
      timeoutErr,
      'token_exchange',
    )
    expect(timeoutFormatted.message.toLowerCase()).toContain('timed out')

    const dnsErr = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
      code: 'ENOTFOUND',
    })
    const dnsFormatted = formatOAuthSignInError(dnsErr, 'token_exchange')
    expect(dnsFormatted.message.toLowerCase()).toContain('reach')
  })

  test('#2166: getOrgPolicyAxiosProxyConfig disables axios ALL_PROXY auto-proxy', () => {
    expect(getOrgPolicyAxiosProxyConfig()).toEqual({ proxy: false })
  })

  test('#2167 & #2168: unknown model defaults to 1M context unless CLAUDE_CODE_DISABLE_1M_CONTEXT=1', () => {
    const prevDisable = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    const prevMax = process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
    try {
      delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
      delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
      expect(getContextWindowForModel('custom-vendor-model-xyz', [])).toBe(
        1_000_000,
      )
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
      expect(getContextWindowForModel('custom-vendor-model-xyz', [])).toBe(
        200_000,
      )
    } finally {
      if (prevDisable === undefined) {
        delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
      } else {
        process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = prevDisable
      }
      if (prevMax === undefined) {
        delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
      } else {
        process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = prevMax
      }
    }
  })

  test('#2202: overloaded retry max delay bounds are [32000, 300000]', () => {
    expect(OVERLOADED_RETRY_MAX_DELAY_MIN_MS).toBe(32_000)
    expect(OVERLOADED_RETRY_MAX_DELAY_MAX_MS).toBe(300_000)
  })

  test('#2204: isCloudOrRemoteControlSession detects cloud/remote-control sessions', () => {
    const prevRemote = process.env.CLAUDE_CODE_REMOTE
    try {
      process.env.CLAUDE_CODE_REMOTE = '1'
      expect(isCloudOrRemoteControlSession()).toBe(true)
    } finally {
      if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
      else process.env.CLAUDE_CODE_REMOTE = prevRemote
    }
  })

  test('#2209: cloud CLAUDE_AUTOCOMPACT_PCT_OVERRIDE exempts auto-memory and /btw', () => {
    const prevRemote = process.env.CLAUDE_CODE_REMOTE
    const prevPct = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
    try {
      process.env.CLAUDE_CODE_REMOTE = '1'
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '20'

      expect(isCloudAutocompactPctOverrideExempt('extract_memories')).toBe(true)
      expect(isCloudAutocompactPctOverrideExempt('btw')).toBe(true)
      expect(isCloudAutocompactPctOverrideExempt('repl_main_thread')).toBe(
        false,
      )

      const mainThreshold = getAutoCompactThreshold('claude-sonnet-4-6', {
        querySource: 'repl_main_thread',
      })
      const btwThreshold = getAutoCompactThreshold('claude-sonnet-4-6', {
        querySource: 'btw',
      })
      expect(btwThreshold).toBeGreaterThan(mainThreshold)
    } finally {
      if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
      else process.env.CLAUDE_CODE_REMOTE = prevRemote
      if (prevPct === undefined) {
        delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
      } else {
        process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = prevPct
      }
    }
  })
})
