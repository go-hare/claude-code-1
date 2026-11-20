import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import { APIError } from '@anthropic-ai/sdk'
import {
  clearBetaHeaderLatches,
  getSessionId,
  regenerateSessionId,
  resetStickyBetas,
  switchSession,
} from '../../../bootstrap/state.js'
import type { SessionId } from '../../../types/ids.js'
import { clearOAuthTokenCache } from '../../../utils/auth.js'
import {
  resolveOutputTokenLimitForContinuation,
  UNRECOGNIZED_MODEL_CONTINUATION_MAX_OUTPUT_TOKENS,
  UNRECOGNIZED_MODEL_DEFAULT_MAX_OUTPUT_TOKENS,
} from '../../../utils/context.js'
import { setSdkOauthTokenRefreshCallback } from '../../../utils/sdkOauthTokenRefresh.js'
import {
  getBillingGroupRequestTags,
  resolveAttributionProject,
} from '../client.js'
import {
  CannotRetryError,
  clearCachedModelMaxTokensCeilings,
  confirmModelMaxTokensCeiling,
  DESKTOP_CODE_TAB_ONE_OFF_401_RETRY_DELAY_MS,
  getCachedModelMaxTokensCeiling,
  isDesktopCodeTabOneOff401Eligible,
  setCachedModelMaxTokensCeiling,
  withRetry,
} from '../withRetry.js'

const ROOT = join(import.meta.dir, '../../../..')

function makeApiError(
  status: number,
  message: string,
  body?: Record<string, unknown>,
): APIError {
  return new APIError(status, body ?? { message }, message, new Headers())
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
    'base64url',
  )
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

async function drainWithRetry<T>(
  gen: AsyncGenerator<unknown, T>,
): Promise<{ yielded: unknown[]; value: T }> {
  const yielded: unknown[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) {
      return { yielded, value: next.value }
    }
    yielded.push(next.value)
  }
}

const ENV_KEYS = [
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_CODE_IS_COWORK',
  'CLAUDE_CODE_OAUTH_401_WAIT_MS',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
] as const

describe('Deep Parity Fix 3 (2.1.328) — API / Attribution Billing / Retry & Auth', () => {
  const savedEnv: Record<string, string | undefined> = {}
  let savedSessionId: SessionId

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    savedSessionId = getSessionId()
    clearOAuthTokenCache()
    setSdkOauthTokenRefreshCallback(null)
    clearCachedModelMaxTokensCeilings()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    switchSession(savedSessionId)
    clearOAuthTokenCache()
    setSdkOauthTokenRefreshCallback(null)
    clearCachedModelMaxTokensCeilings()
  })

  describe('Bug 1 (P1): unknown model continuation respects server-lowered retry max_tokens cap', () => {
    const unknownModel = 'custom-future-unknown-model-v99'

    test('resolveOutputTokenLimitForContinuation never raises retryMaxTokensOverride (16384) back to 128000', () => {
      // Baseline: without retry override or cached ceiling, continuation raises 32k -> 128k
      expect(
        resolveOutputTokenLimitForContinuation({
          model: unknownModel,
          requestedMaxTokens: UNRECOGNIZED_MODEL_DEFAULT_MAX_OUTPUT_TOKENS,
          continuesCutReply: true,
          env: {},
        }),
      ).toBe(UNRECOGNIZED_MODEL_CONTINUATION_MAX_OUTPUT_TOKENS)

      // Server rejected 128000 > 16384 and retryContext.maxTokensOverride = 16384
      // (cachedModelCeiling is STILL undefined until reply begins)
      expect(
        resolveOutputTokenLimitForContinuation({
          model: unknownModel,
          requestedMaxTokens: UNRECOGNIZED_MODEL_DEFAULT_MAX_OUTPUT_TOKENS,
          continuesCutReply: true,
          cachedModelCeiling: undefined,
          retryMaxTokensOverride: 16384,
          env: {},
        }),
      ).toBe(16384)

      // Even if caller passes 16384 as requestedMaxTokens alongside retryMaxTokensOverride
      expect(
        resolveOutputTokenLimitForContinuation({
          model: unknownModel,
          requestedMaxTokens: 16384,
          continuesCutReply: true,
          cachedModelCeiling: undefined,
          retryMaxTokensOverride: 16384,
          env: {},
        }),
      ).toBe(16384)

      // Minimum of retryMaxTokensOverride and cachedModelCeiling wins
      expect(
        resolveOutputTokenLimitForContinuation({
          model: unknownModel,
          requestedMaxTokens: UNRECOGNIZED_MODEL_DEFAULT_MAX_OUTPUT_TOKENS,
          continuesCutReply: true,
          cachedModelCeiling: 32000,
          retryMaxTokensOverride: 16384,
          env: {},
        }),
      ).toBe(16384)

      // Security-control calls also honor retryMaxTokensOverride as an upper cap
      expect(
        resolveOutputTokenLimitForContinuation({
          model: unknownModel,
          requestedMaxTokens: 32000,
          continuesCutReply: true,
          retryMaxTokensOverride: 16384,
          isSecurityControl: true,
          env: {},
        }),
      ).toBe(16384)
    })

    test('live withRetry probe: unknown model continuation retries at 16384 (NOT 128000)', async () => {
      const sentMaxTokens: number[] = []
      const gen = withRetry(
        async () => ({}) as Anthropic,
        async (_client, _attempt, retryContext) => {
          const effectiveMaxTokens = resolveOutputTokenLimitForContinuation({
            model: unknownModel,
            requestedMaxTokens: UNRECOGNIZED_MODEL_DEFAULT_MAX_OUTPUT_TOKENS,
            continuesCutReply: true,
            cachedModelCeiling: getCachedModelMaxTokensCeiling(
              retryContext.model,
            ),
            retryMaxTokensOverride: retryContext.maxTokensOverride,
            env: {},
          })
          sentMaxTokens.push(effectiveMaxTokens)
          if (effectiveMaxTokens > 16384) {
            throw makeApiError(
              400,
              `max_tokens: ${effectiveMaxTokens} > 16384, which is the maximum allowed number of output tokens for ${unknownModel}`,
            )
          }
          return { ok: true, maxTokens: effectiveMaxTokens }
        },
        {
          model: unknownModel,
          maxRetries: 2,
          thinkingConfig: { type: 'disabled' },
        },
      )

      const { value } = await drainWithRetry(gen)
      expect(sentMaxTokens).toEqual([128000, 16384])
      expect(value).toEqual({ ok: true, maxTokens: 16384 })
    })

    test('claude.ts wires retryContext.maxTokensOverride into resolveOutputTokenLimitForContinuation', () => {
      const claudeSrc = readFileSync(
        join(ROOT, 'src/services/api/claude.ts'),
        'utf8',
      )
      expect(claudeSrc).toContain(
        'retryMaxTokensOverride: retryContext?.maxTokensOverride',
      )
    })
  })

  describe('Bug 2 (P1): attributionProject settings precedence matches official vCn', () => {
    test('enforces strict precedence: policySettings > flagSettings > localSettings > projectSettings > userSettings', () => {
      const allFive = {
        policySettings: {
          attributionProject: '550e8400-e29b-41d4-a716-446655440001',
        },
        flagSettings: {
          attributionProject: '550e8400-e29b-41d4-a716-446655440002',
        },
        localSettings: {
          attributionProject: '550e8400-e29b-41d4-a716-446655440003',
        },
        projectSettings: {
          attributionProject: '550e8400-e29b-41d4-a716-446655440004',
        },
        userSettings: {
          attributionProject: '550e8400-e29b-41d4-a716-446655440005',
        },
      }

      // 1. policySettings beats everything in settings cascade (including localSettings)
      expect(
        resolveAttributionProject({
          env: {},
          getSourceSettings: src => allFive[src] ?? null,
        }),
      ).toMatchObject({
        written: '550e8400-e29b-41d4-a716-446655440001',
        source: 'policySettings',
      })

      // 2. flagSettings beats localSettings / projectSettings / userSettings
      expect(
        resolveAttributionProject({
          env: {},
          getSourceSettings: src =>
            src === 'policySettings' ? null : (allFive[src] ?? null),
        }),
      ).toMatchObject({
        written: '550e8400-e29b-41d4-a716-446655440002',
        source: 'flagSettings',
      })

      // 3. localSettings beats projectSettings / userSettings
      expect(
        resolveAttributionProject({
          env: {},
          getSourceSettings: src =>
            src === 'policySettings' || src === 'flagSettings'
              ? null
              : (allFive[src] ?? null),
        }),
      ).toMatchObject({
        written: '550e8400-e29b-41d4-a716-446655440003',
        source: 'localSettings',
      })

      // 4. projectSettings beats userSettings
      expect(
        resolveAttributionProject({
          env: {},
          getSourceSettings: src =>
            src === 'projectSettings' || src === 'userSettings'
              ? allFive[src]
              : null,
        }),
      ).toMatchObject({
        written: '550e8400-e29b-41d4-a716-446655440004',
        source: 'projectSettings',
      })

      // 5. userSettings is lowest precedence
      expect(
        resolveAttributionProject({
          env: {},
          getSourceSettings: src =>
            src === 'userSettings' ? allFive[src] : null,
        }),
      ).toMatchObject({
        written: '550e8400-e29b-41d4-a716-446655440005',
        source: 'userSettings',
      })

      // 6. Env CLAUDE_CODE_ATTRIBUTION_PROJECT still wins over settings cascade
      expect(
        resolveAttributionProject({
          env: {
            CLAUDE_CODE_ATTRIBUTION_PROJECT:
              '550e8400-e29b-41d4-a716-446655440000',
          },
          getSourceSettings: src => allFive[src] ?? null,
        }),
      ).toMatchObject({
        written: '550e8400-e29b-41d4-a716-446655440000',
        source: 'harness',
      })
    })

    test('explicit empty string in higher-precedence source blocks lower sources and falls back to admin_default', () => {
      expect(
        resolveAttributionProject({
          env: {},
          getSourceSettings: src => {
            if (src === 'policySettings') {
              return {
                attributionProject: '',
                attributionProjectPolicy: {
                  default: '550e8400-e29b-41d4-a716-446655440006',
                },
              }
            }
            if (src === 'localSettings') {
              return {
                attributionProject: '550e8400-e29b-41d4-a716-446655440003',
              }
            }
            return null
          },
        }),
      ).toMatchObject({
        written: '550e8400-e29b-41d4-a716-446655440006',
        source: 'admin_default',
      })

      // Without admin_default, empty string yields undefined (does NOT read localSettings)
      expect(
        resolveAttributionProject({
          env: {},
          getSourceSettings: src => {
            if (src === 'flagSettings') return { attributionProject: '' }
            if (src === 'localSettings')
              return {
                attributionProject: '550e8400-e29b-41d4-a716-446655440003',
              }
            return null
          },
        }),
      ).toMatchObject({ written: undefined })
    })

    test('uYo normalization: UUID becomes claude_proj_01 base58; invalid values are ignored per official vCn', () => {
      const { normalizeAttributionProjectId } =
        require('../client.js') as typeof import('../client.js')
      // UUID → claude_proj_01<base58-22>
      expect(
        normalizeAttributionProjectId('550e8400-e29b-41d4-a716-446655440000'),
      ).toMatch(/^claude_proj_01[1-9A-HJ-NP-Za-km-z]{22}$/)
      // Existing tagged id passes through unchanged
      const tagged = normalizeAttributionProjectId(
        '550e8400-e29b-41d4-a716-446655440000',
      )!
      expect(normalizeAttributionProjectId(tagged)).toBe(tagged)
      // staging/local variants accepted verbatim
      expect(
        normalizeAttributionProjectId(
          `claude_proj_staging_01${'1'.repeat(22)}`,
        ),
      ).toBe(`claude_proj_staging_01${'1'.repeat(22)}`)
      expect(normalizeAttributionProjectId(`chan_01${'1'.repeat(22)}`)).toBe(
        `chan_01${'1'.repeat(22)}`,
      )
      // Non-project strings are rejected
      expect(normalizeAttributionProjectId('not-a-project')).toBeUndefined()
      expect(normalizeAttributionProjectId('')).toBeUndefined()

      // resolveAttributionProject returns the official project/taggedId shape
      expect(
        resolveAttributionProject({
          env: {
            CLAUDE_CODE_ATTRIBUTION_PROJECT:
              '550e8400-e29b-41d4-a716-446655440000',
          },
          getSourceSettings: () => null,
        }),
      ).toMatchObject({
        project: { source: 'harness' },
        written: '550e8400-e29b-41d4-a716-446655440000',
        source: 'harness',
      })
      expect(
        resolveAttributionProject({
          env: {
            CLAUDE_CODE_ATTRIBUTION_PROJECT:
              '550e8400-e29b-41d4-a716-446655440000',
          },
          getSourceSettings: () => null,
        }).project?.taggedId,
      ).toMatch(/^claude_proj_01[1-9A-HJ-NP-Za-km-z]{22}$/)

      // Invalid harness value is ignored, cascade still consulted per official vCn
      const res = resolveAttributionProject({
        env: { CLAUDE_CODE_ATTRIBUTION_PROJECT: 'bogus' },
        getSourceSettings: src =>
          src === 'policySettings'
            ? {
                attributionProjectPolicy: {
                  default: '550e8400-e29b-41d4-a716-446655440000',
                },
              }
            : null,
      })
      expect(res.ignored).toEqual(['harness'])
      expect(res.project?.source).toBe('admin_default')
    })

    test('getBillingGroupRequestTags emits policy tag (written value) instead of localSettings override', () => {
      const jwt = makeJwt({ billing_group_tag: 'cost_center' })
      const policyUuid = '550e8400-e29b-41d4-a716-446655440000'
      expect(
        getBillingGroupRequestTags({
          jwt,
          env: {},
          getSourceSettings: src => {
            if (src === 'policySettings')
              return { attributionProject: policyUuid }
            if (src === 'localSettings')
              return {
                attributionProject: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
              }
            return null
          },
        }),
      ).toEqual({ tags: { cost_center: policyUuid } })
    })

    test('billing tags stay empty when the resolved project id fails uYo normalization', () => {
      const jwt = makeJwt({ billing_group_tag: 'cost_center' })
      expect(
        getBillingGroupRequestTags({
          jwt,
          env: {},
          getSourceSettings: src =>
            src === 'policySettings'
              ? { attributionProject: 'policy-billing' }
              : null,
        }),
      ).toEqual({})
    })
  })

  describe('Bug 3 (P2): Desktop Code tab one-shot 401 resend is wired to real OAuth branch', () => {
    test('resends once with original OAuth credential before invoking SDK host refresh callback', async () => {
      process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-orig-1'
      clearOAuthTokenCache()

      let refreshCalls = 0
      setSdkOauthTokenRefreshCallback(async () => {
        refreshCalls++
        return 'tok-refreshed-2'
      })

      const tokensSeen: Array<string | undefined> = []
      const retryStatuses: unknown[] = []
      const gen = withRetry(
        async () => ({}) as Anthropic,
        async () => {
          const tok = process.env.CLAUDE_CODE_OAUTH_TOKEN
          tokensSeen.push(tok)
          if (tokensSeen.length === 1) {
            throw makeApiError(401, 'authentication_error: temporary glitch')
          }
          return 'recovered-on-resend'
        },
        {
          model: 'claude-sonnet-4-6',
          maxRetries: 2,
          thinkingConfig: { type: 'disabled' },
          desktopOneOff401DelayMs: 5,
          onRetryStatus: status => retryStatuses.push(status),
        },
      )

      const { yielded, value } = await drainWithRetry(gen)
      expect(value).toBe('recovered-on-resend')
      // Resent with exact same original credential, NEVER called host refresh!
      expect(tokensSeen).toEqual(['tok-orig-1', 'tok-orig-1'])
      expect(refreshCalls).toBe(0)
      // Retry banner suppressed during one-off resend wait (matches official Ec)
      expect(yielded).toHaveLength(0)
      expect(retryStatuses.every(s => s === null)).toBe(true)
    })

    test('if one-shot OAuth resend also returns 401, escalates to SDK host refresh without burning attempt', async () => {
      process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-orig-1'
      clearOAuthTokenCache()

      let refreshCalls = 0
      setSdkOauthTokenRefreshCallback(async () => {
        refreshCalls++
        return 'tok-fresh-2'
      })

      const tokensSeen: Array<string | undefined> = []
      const gen = withRetry(
        async () => ({}) as Anthropic,
        async () => {
          const tok = process.env.CLAUDE_CODE_OAUTH_TOKEN
          tokensSeen.push(tok)
          if (tok === 'tok-orig-1') {
            throw makeApiError(401, 'authentication_error: still rejected')
          }
          return `ok:${tok}`
        },
        {
          model: 'claude-sonnet-4-6',
          // maxRetries=1 proves the refused one-shot resend does NOT burn a retry attempt
          maxRetries: 1,
          thinkingConfig: { type: 'disabled' },
          desktopOneOff401DelayMs: 5,
        },
      )

      const { value } = await drainWithRetry(gen)
      expect(value).toBe('ok:tok-fresh-2')
      // Attempt 1 (tok-orig-1) -> 401 -> one-shot resend (tok-orig-1) -> 401 -> host refresh -> Attempt 3 (tok-fresh-2)
      expect(tokensSeen).toEqual(['tok-orig-1', 'tok-orig-1', 'tok-fresh-2'])
      expect(refreshCalls).toBe(1)
    })

    test('explicit token_expired 401 skips one-shot resend and refreshes immediately', async () => {
      process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-expired-1'
      clearOAuthTokenCache()

      let refreshCalls = 0
      setSdkOauthTokenRefreshCallback(async () => {
        refreshCalls++
        return 'tok-fresh-2'
      })

      const tokensSeen: Array<string | undefined> = []
      const gen = withRetry(
        async () => ({}) as Anthropic,
        async () => {
          const tok = process.env.CLAUDE_CODE_OAUTH_TOKEN
          tokensSeen.push(tok)
          if (tok === 'tok-expired-1') {
            throw makeApiError(401, 'OAuth token has expired', {
              error: { details: { error_code: 'token_expired' } },
            })
          }
          return `ok:${tok}`
        },
        {
          model: 'claude-sonnet-4-6',
          maxRetries: 2,
          thinkingConfig: { type: 'disabled' },
          desktopOneOff401DelayMs: 5,
        },
      )

      const { value } = await drainWithRetry(gen)
      expect(value).toBe('ok:tok-fresh-2')
      // No duplicate resend with tok-expired-1: immediately refreshed!
      expect(tokensSeen).toEqual(['tok-expired-1', 'tok-fresh-2'])
      expect(refreshCalls).toBe(1)
    })

    test('structured token_expired error_code and CLAUDE_CODE_REMOTE_SESSION_ID disqualify one-shot resend', () => {
      process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
      expect(DESKTOP_CODE_TAB_ONE_OFF_401_RETRY_DELAY_MS).toBe(1500)

      const structuredExpired = makeApiError(401, 'authentication_error', {
        error: { details: { error_code: 'token_expired' } },
      })
      expect(isDesktopCodeTabOneOff401Eligible(structuredExpired)).toBe(false)

      const transient = makeApiError(401, 'authentication_error: transient')
      expect(isDesktopCodeTabOneOff401Eligible(transient)).toBe(true)

      process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'sess_remote_1'
      expect(isDesktopCodeTabOneOff401Eligible(transient)).toBe(false)
    })

    test('if SDK host refresh callback returns same token after refused resend, fails with CannotRetryError', async () => {
      process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-stuck-1'
      clearOAuthTokenCache()

      let refreshCalls = 0
      setSdkOauthTokenRefreshCallback(async () => {
        refreshCalls++
        return 'tok-stuck-1'
      })

      const gen = withRetry(
        async () => ({}) as Anthropic,
        async () => {
          throw makeApiError(401, 'authentication_error: bad token')
        },
        {
          model: 'claude-sonnet-4-6',
          maxRetries: 3,
          thinkingConfig: { type: 'disabled' },
          desktopOneOff401DelayMs: 5,
        },
      )

      await expect(drainWithRetry(gen)).rejects.toBeInstanceOf(CannotRetryError)
      expect(refreshCalls).toBe(1)
    })
  })

  describe('Bug 4 (P2): learned output-limit cache lifecycle cleanup & stream-start confirmation timing', () => {
    const model = 'custom-ceiling-lifecycle-v1'

    test('4(a): clears learned output-limit cache on stickyBetas reset, session switch, regenerate, provider switch, base URL & auth switch', () => {
      // 1. clearBetaHeaderLatches (/compact, /clear)
      setCachedModelMaxTokensCeiling(model, 16384)
      expect(getCachedModelMaxTokensCeiling(model)).toBe(16384)
      clearBetaHeaderLatches()
      expect(getCachedModelMaxTokensCeiling(model)).toBeUndefined()

      // 2. resetStickyBetas
      setCachedModelMaxTokensCeiling(model, 16384)
      expect(getCachedModelMaxTokensCeiling(model)).toBe(16384)
      resetStickyBetas()
      expect(getCachedModelMaxTokensCeiling(model)).toBeUndefined()

      // 3. switchSession (/resume)
      setCachedModelMaxTokensCeiling(model, 16384)
      expect(getCachedModelMaxTokensCeiling(model)).toBe(16384)
      switchSession('11111111-2222-4333-8444-555555555555' as SessionId)
      expect(getCachedModelMaxTokensCeiling(model)).toBeUndefined()

      // 4. regenerateSessionId (/clear)
      setCachedModelMaxTokensCeiling(model, 16384)
      expect(getCachedModelMaxTokensCeiling(model)).toBe(16384)
      regenerateSessionId()
      expect(getCachedModelMaxTokensCeiling(model)).toBeUndefined()

      // 5. Provider change (firstParty -> bedrock)
      setCachedModelMaxTokensCeiling(model, 16384)
      expect(getCachedModelMaxTokensCeiling(model)).toBe(16384)
      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      expect(getCachedModelMaxTokensCeiling(model)).toBeUndefined()
      delete process.env.CLAUDE_CODE_USE_BEDROCK

      // 6. Base URL change
      setCachedModelMaxTokensCeiling(model, 16384)
      expect(getCachedModelMaxTokensCeiling(model)).toBe(16384)
      process.env.ANTHROPIC_BASE_URL = 'https://proxy-b.internal.example'
      expect(getCachedModelMaxTokensCeiling(model)).toBeUndefined()
      delete process.env.ANTHROPIC_BASE_URL

      // 7. Auth mode switch
      setCachedModelMaxTokensCeiling(model, 16384)
      expect(getCachedModelMaxTokensCeiling(model)).toBe(16384)
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      expect(getCachedModelMaxTokensCeiling(model)).toBeUndefined()
    })

    test('4(b): streaming withRetry does NOT cache learned ceiling when stream object is returned; caches only when message_start confirms', async () => {
      const streamModel = 'custom-stream-ceiling-model-v1'
      let confirmFn: (() => void) | undefined
      let attemptCount = 0

      async function* fakeStream() {
        yield { type: 'message_start', message: { id: 'msg_1' } }
      }

      const gen = withRetry(
        async () => ({}) as Anthropic,
        async (_client, _attempt, retryContext) => {
          attemptCount++
          if (attemptCount === 1) {
            throw makeApiError(
              400,
              `max_tokens: 128000 > 16384, which is the maximum allowed number of output tokens for ${streamModel}`,
            )
          }
          expect(retryContext.maxTokensOverride).toBe(16384)
          return fakeStream()
        },
        {
          model: streamModel,
          maxRetries: 2,
          thinkingConfig: { type: 'disabled' },
          deferMaxTokensCeilingConfirmation: true,
          onPendingMaxTokensCeiling: pending => {
            expect(pending.model).toBe(streamModel)
            expect(pending.limit).toBe(16384)
            confirmFn = pending.confirm
          },
        },
      )

      const { value: stream } = await drainWithRetry(gen)
      expect(attemptCount).toBe(2)

      // CRITICAL: Immediately after stream object is returned (before message_start),
      // the ceiling MUST NOT be cached yet!
      expect(getCachedModelMaxTokensCeiling(streamModel)).toBeUndefined()
      expect(confirmFn).toBeDefined()

      // Simulate consuming stream up to message_start
      for await (const event of stream) {
        if (event.type === 'message_start') {
          confirmFn?.()
        }
      }
      expect(getCachedModelMaxTokensCeiling(streamModel)).toBe(16384)
    })

    test('4(b): AsyncIterable stream returned without defer flag also does NOT prematurely cache ceiling before stream starts', async () => {
      const streamModel = 'custom-stream-autodetect-v1'
      let calls = 0

      const failingBeforeMessageStart = (): AsyncIterable<unknown> => ({
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error('stream dropped before message_start')
            },
          }
        },
      })

      const gen = withRetry(
        async () => ({}) as Anthropic,
        async () => {
          calls++
          if (calls === 1) {
            throw makeApiError(
              400,
              `max_tokens: 64000 > 16384, which is the maximum allowed number of output tokens for ${streamModel}`,
            )
          }
          return failingBeforeMessageStart()
        },
        {
          model: streamModel,
          maxRetries: 2,
          thinkingConfig: { type: 'disabled' },
        },
      )

      const { value: stream } = await drainWithRetry(gen)
      expect(getCachedModelMaxTokensCeiling(streamModel)).toBeUndefined()
      await expect(
        (async () => {
          for await (const _e of stream) {
            // unreachable
          }
        })(),
      ).rejects.toThrow('stream dropped before message_start')
      // Stream never yielded message_start -> ceiling remains uncached!
      expect(getCachedModelMaxTokensCeiling(streamModel)).toBeUndefined()

      // Explicit confirmation helper still caches when called
      confirmModelMaxTokensCeiling(streamModel, 16384)
      expect(getCachedModelMaxTokensCeiling(streamModel)).toBe(16384)
    })

    test('4(b): non-streaming withRetry confirms learned ceiling once validated response returns', async () => {
      const nonStreamModel = 'custom-nonstream-ceiling-v1'
      let calls = 0

      const gen = withRetry(
        async () => ({}) as Anthropic,
        async (_client, _attempt, retryContext) => {
          calls++
          if (calls === 1) {
            throw makeApiError(
              400,
              `max_tokens: 64000 > 16384, which is the maximum allowed number of output tokens for ${nonStreamModel}`,
            )
          }
          expect(retryContext.maxTokensOverride).toBe(16384)
          return { id: 'msg_nonstream', type: 'message', content: [] }
        },
        {
          model: nonStreamModel,
          maxRetries: 2,
          thinkingConfig: { type: 'disabled' },
        },
      )

      await drainWithRetry(gen)
      expect(getCachedModelMaxTokensCeiling(nonStreamModel)).toBe(16384)
    })

    test('claude.ts wires deferMaxTokensCeilingConfirmation and confirms inside message_start', () => {
      const claudeSrc = readFileSync(
        join(ROOT, 'src/services/api/claude.ts'),
        'utf8',
      )
      expect(claudeSrc).toContain('deferMaxTokensCeilingConfirmation: true')
      expect(claudeSrc).toContain(
        'confirmPendingMaxTokensCeiling = pending.confirm',
      )
      const msgStartIdx = claudeSrc.indexOf("case 'message_start':")
      const confirmIdx = claudeSrc.indexOf(
        'confirmPendingMaxTokensCeiling()',
        msgStartIdx,
      )
      expect(msgStartIdx).toBeGreaterThan(-1)
      expect(confirmIdx).toBeGreaterThan(msgStartIdx)
      expect(confirmIdx - msgStartIdx).toBeLessThan(200)
    })
  })
})
