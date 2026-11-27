import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { APIConnectionError, APIError } from '@anthropic-ai/sdk'
import {
  formatCertSignatureFailureCause,
  getSSLErrorHint,
  isCertSignatureFailureError,
} from '@ant/model-provider'
import {
  formatAdminUsageCreditRequestError,
  formatGroupPoolBudgetResetSuffix,
} from '../../../commands/extra-usage/extra-usage-core.js'
import { shouldGenerateAwaySummary } from '../../../hooks/useAwaySummary.js'
import { shouldFilterSuggestion } from '../../PromptSuggestion/promptSuggestion.js'
import {
  hasCompactSummaryBlock,
  getCompactPrompt,
  SUMMARY_DO_NOT_ANSWER_REMINDER,
} from '../../compact/prompt.js'
import {
  armQuotaAutoResume,
  AUTO_CONTINUE_LOGIN_CHANGED_NOTICE,
  checkAndStopIfLoginChanged,
  compareArmedAccountIdentity,
  getQuotaAutoResumeState,
  resetQuotaAutoResumeForTests,
  subscribeQuotaAutoResumeEvents,
} from '../../quotaAutoResume.js'
import {
  classifyAPIError,
  classifyNonOriginBlockHeaders,
  getApiKeyAuthDisabledMessage,
  isNonOriginCloudflare403Error,
  isVertexRequestSizeLimitError,
  isVertexRequestSizeLimitMessage,
  NETWORK_EDGE_BLOCKED_MESSAGE,
  parseMediaErrorLocation,
  stripTargetedMediaBlock,
} from '../errors.js'
import {
  clearCachedModelMaxTokensCeilings,
  getCachedModelMaxTokensCeiling,
  isDesktopCodeTabOneOff401Eligible,
  parseApiMaxTokensCeilingError,
  setCachedModelMaxTokensCeiling,
} from '../withRetry.js'
import {
  buildRemoteSettingsLoadNotice,
  resetRemoteSettingsStateForTesting,
  setRemoteSettingsLoadStatus,
} from '../../../utils/settings/remoteSettingsState.js'

function makeApiError(
  status: number,
  message: string,
  headers?: Record<string, string>,
  body?: unknown,
): APIError {
  return new APIError(
    status,
    body ?? { message },
    message,
    new Headers(headers ?? {}),
  )
}

describe('Wave 326 Group 2 — API / Compact / Models / Quota / Usage / Cert', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of [
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_REMOTE',
      'CLAUDE_CODE_IS_COWORK',
      'CLAUDE_CODE_OAUTH_401_WAIT_MS',
    ]) {
      savedEnv[k] = process.env[k]
    }
    clearCachedModelMaxTokensCeilings()
    resetQuotaAutoResumeForTests()
    resetRemoteSettingsStateForTesting()
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    clearCachedModelMaxTokensCeilings()
    resetQuotaAutoResumeForTests()
    resetRemoteSettingsStateForTesting()
  })

  test('#47 batch PDF rejection drops ONLY the failing nested PDF and keeps sibling PDFs', () => {
    const errMsg =
      'messages.0.content.0.tool_result.content.1.document: The PDF specified was not valid.'
    const loc = parseMediaErrorLocation(errMsg)
    expect(loc).toEqual({
      messageIdx: 0,
      contentIdx: 0,
      nestedContentIdx: 1,
      kind: 'document',
    })

    const messages = [
      {
        type: 'user',
        uuid: 'u1',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_batch',
              content: [
                {
                  type: 'document',
                  source: { type: 'base64', data: 'good-pdf' },
                },
                {
                  type: 'document',
                  source: { type: 'base64', data: 'bad-pdf' },
                },
                {
                  type: 'document',
                  source: { type: 'base64', data: 'good-pdf-2' },
                },
              ],
            },
          ],
        },
      },
    ] as unknown as import('../../../types/message.js').Message[]

    const result = stripTargetedMediaBlock(
      messages,
      {
        messageIdx: loc!.messageIdx!,
        contentIdx: loc!.contentIdx!,
        nestedContentIdx: loc!.nestedContentIdx,
        kind: loc!.kind,
      },
      errMsg,
    )
    expect(result.removed).toBe(true)
    const toolRes = (
      result.messages[0] as unknown as {
        message: {
          content: Array<{ content: Array<{ type: string; text?: string }> }>
        }
      }
    ).message.content[0]!.content
    expect(toolRes[0]?.type).toBe('document')
    expect(toolRes[1]?.type).toBe('text')
    expect(toolRes[1]?.text).toContain('PDF document removed')
    expect(toolRes[2]?.type).toBe('document')
  })

  test('#49 compaction prompt includes do-not-answer reminder and detects missing <summary> blocks', () => {
    const prompt = getCompactPrompt()
    expect(prompt).toContain(SUMMARY_DO_NOT_ANSWER_REMINDER.trim())
    expect(
      hasCompactSummaryBlock('<analysis>x</analysis>\n<summary>done</summary>'),
    ).toBe(true)
    expect(
      hasCompactSummaryBlock('Sure, I can help you fix that bug right now!'),
    ).toBe(false)
  })

  test('#50 Vertex AI 30MB HTTP 400 error is classified for compaction/retry', () => {
    const plain = '400 The request size (33554432 bytes) exceeds 30MB limit.'
    const escaped =
      '400 {"error":{"code":400,"message":"{\\"error\\":{\\"code\\":400,\\"message\\":\\"The request size (35000000 bytes) exceeds 30MB limit.\\",\\"status\\":\\"FAILED_PRECONDITION\\"}}","status":"FAILED_PRECONDITION"}}'
    expect(isVertexRequestSizeLimitMessage(plain)).toBe(true)
    expect(isVertexRequestSizeLimitMessage(escaped)).toBe(true)
    expect(
      isVertexRequestSizeLimitMessage(
        '400 {"error":{"type":"policy_blocked","message":"The request size (33554432 bytes) exceeds 30MB limit."}}',
      ),
    ).toBe(false)

    const err = makeApiError(400, escaped)
    expect(isVertexRequestSizeLimitError(err)).toBe(true)
    expect(classifyAPIError(err)).toBe('request_too_large')
  })

  test('#51 API max_tokens > model ceiling error parses reported maximum and caches per model', () => {
    const err = makeApiError(
      400,
      'max_tokens: 64000 > 16384, which is the maximum allowed number of output tokens for claude-custom-v1',
    )
    expect(parseApiMaxTokensCeilingError(err)).toEqual({
      requested: 64000,
      maximum: 16384,
    })
    // Below 4096 floor is ignored
    const tooSmall = makeApiError(
      400,
      'max_tokens: 8192 > 1024, which is the maximum allowed number of output tokens for tiny',
    )
    expect(parseApiMaxTokensCeilingError(tooSmall)).toBeNull()

    setCachedModelMaxTokensCeiling('Claude-Custom-V1', 16384)
    expect(getCachedModelMaxTokensCeiling('claude-custom-v1')).toBe(16384)
    clearCachedModelMaxTokensCeilings()
    expect(getCachedModelMaxTokensCeiling('claude-custom-v1')).toBeUndefined()
  })

  test('#55 automatic recap skips when billed to usage credits, while force (/recap) still runs', () => {
    const humanMessages = [
      { type: 'user', uuid: '1', message: { role: 'user', content: 'hi' } },
      { type: 'user', uuid: '2', message: { role: 'user', content: 'next' } },
      { type: 'user', uuid: '3', message: { role: 'user', content: 'more' } },
    ] as unknown as import('../../../types/message.js').Message[]

    expect(
      shouldGenerateAwaySummary({
        awaySummaryEnabled: true,
        gbEnabled: true,
        featureOn: true,
        messages: humanMessages,
        billedToUsageCredits: true,
      }),
    ).toBe(false)

    expect(
      shouldGenerateAwaySummary({
        awaySummaryEnabled: true,
        gbEnabled: true,
        featureOn: true,
        messages: humanMessages,
        billedToUsageCredits: true,
        force: true,
      }),
    ).toBe(true)
  })

  test('#62 Desktop Code tab one-off non-expired 401 is eligible for direct retry first', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CODE_IS_COWORK
    delete process.env.CLAUDE_CODE_OAUTH_401_WAIT_MS

    const transient401 = makeApiError(
      401,
      'authentication_error: temporary glitch',
    )
    const expired401 = makeApiError(401, 'OAuth token has expired')
    expect(isDesktopCodeTabOneOff401Eligible(transient401)).toBe(true)
    expect(isDesktopCodeTabOneOff401Eligible(expired401)).toBe(false)

    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    expect(isDesktopCodeTabOneOff401Eligible(transient401)).toBe(false)
  })

  test('#63 non-origin Cloudflare 403 block page does not tell user to sign in again', () => {
    expect(
      classifyNonOriginBlockHeaders(name =>
        name === 'cf-ray'
          ? '9abc123-SJC'
          : name === 'server'
            ? 'cloudflare'
            : null,
      ),
    ).toBe('nonorigin_cf')
    expect(
      classifyNonOriginBlockHeaders(name =>
        name === 'request-id'
          ? 'req_01ABC123'
          : name === 'cf-ray'
            ? '9abc-SJC'
            : null,
      ),
    ).toBeNull()

    const cf403 = makeApiError(
      403,
      '<html><title>Attention Required! | Cloudflare</title></html>',
      { 'cf-ray': '9abc123-SJC', server: 'cloudflare' },
      '<html>blocked</html>',
    )
    expect(isNonOriginCloudflare403Error(cf403)).toBe(true)
    expect(classifyAPIError(cf403)).toBe('network_edge_blocked')
    expect(NETWORK_EDGE_BLOCKED_MESSAGE).toContain(
      "signing in to Claude again won't help",
    )

    setRemoteSettingsLoadStatus({
      state: 'failed',
      failure: { errorKind: 'network_edge_blocked', httpStatus: 403 },
    })
    const notice = buildRemoteSettingsLoadNotice(undefined)
    expect(notice?.message).toContain('signing in again will not help')
  })

  test('#155 PromptSuggestion filters bare and backtick-wrapped XML/signal tags', () => {
    expect(
      shouldFilterSuggestion('<signal type="empty" />', 'user_intent'),
    ).toBe(true)
    expect(
      shouldFilterSuggestion('`<signal type="empty" />`', 'user_intent'),
    ).toBe(true)
    expect(shouldFilterSuggestion('<noop></noop>', 'user_intent')).toBe(true)
    expect(
      shouldFilterSuggestion('Run the unit tests now', 'user_intent'),
    ).toBe(false)
  })

  test('#174 & #263 CERT_SIGNATURE_FAILURE classifies as tls_cert_signature_failure with CA renewal guidance', () => {
    const cause = Object.assign(new Error('certificate signature failure'), {
      code: 'CERT_SIGNATURE_FAILURE',
    })
    const connErr = new APIConnectionError({ cause })
    expect(isCertSignatureFailureError(connErr)).toBe(true)
    expect(classifyAPIError(connErr)).toBe('tls_cert_signature_failure')

    const desktopGuidance = formatCertSignatureFailureCause(true)
    const cliGuidance = formatCertSignatureFailureCause(false)
    expect(desktopGuidance).toContain('two CA certificates with the same name')
    expect(desktopGuidance).toContain('Ask your IT team')
    expect(cliGuidance).toContain('NODE_EXTRA_CA_CERTS')
    expect(getSSLErrorHint(connErr)).toContain('CERT_SIGNATURE_FAILURE')
  })

  test('#178 & #264 & #265 admin usage-credit billing guidance, pooled budget reset time, and Console /login prompt', () => {
    const billingErr = {
      response: {
        status: 403,
        data: {
          error: {
            code: 'admin_request_admin_can_act',
            message: 'Admins can act directly',
          },
        },
      },
    }
    expect(formatAdminUsageCreditRequestError(billingErr, false)).toContain(
      'https://claude.ai/admin-settings/usage',
    )
    expect(formatAdminUsageCreditRequestError(billingErr, true)).toContain(
      'Manage usage credits in admin settings on the web.',
    )
    expect(
      formatAdminUsageCreditRequestError({ response: { status: 500 } }, false),
    ).toBe("Couldn't send your request. Try again later.")

    const futureEpochSec = Math.floor((Date.now() + 2 * 3600 * 1000) / 1000)
    const resetSuffix = formatGroupPoolBudgetResetSuffix({
      overageScope: 'group_pool',
      rateLimitType: 'overage',
      overageResetsAt: futureEpochSec,
    })
    expect(resetSuffix).toContain('resets')
    expect(
      formatGroupPoolBudgetResetSuffix({
        overageScope: 'group_pool',
        rateLimitType: 'five_hour',
        overageResetsAt: futureEpochSec,
      }),
    ).toBe('')

    expect(getApiKeyAuthDisabledMessage(false)).toContain('Run /login')
    expect(getApiKeyAuthDisabledMessage(true)).toContain(
      'Sign in again with your claude.ai account',
    )
  })

  test('#336 quotaAutoResume stops with login-changed event & notice when login changes or ends', () => {
    const events: string[] = []
    const unsub = subscribeQuotaAutoResumeEvents(ev => events.push(ev))
    try {
      const futureReset = Math.floor((Date.now() + 600_000) / 1000)
      armQuotaAutoResume(futureReset, Date.now(), 'dialog', null, {
        accountUuid: 'acct-1',
        organizationUuid: 'org-1',
      })
      expect(getQuotaAutoResumeState().phase).toBe('armed')
      expect(
        compareArmedAccountIdentity(
          { accountUuid: 'acct-1', organizationUuid: 'org-1' },
          { accountUuid: 'acct-1', organizationUuid: 'org-1' },
        ),
      ).toBe('same')
      expect(
        compareArmedAccountIdentity(
          { accountUuid: 'acct-1', organizationUuid: 'org-1' },
          { accountUuid: 'acct-2', organizationUuid: 'org-1' },
        ),
      ).toBe('other')
      expect(
        compareArmedAccountIdentity(
          { accountUuid: 'acct-1', organizationUuid: 'org-1' },
          null,
        ),
      ).toBe('missing')

      // Login ended -> stops waiting and emits login-changed
      const stopped = checkAndStopIfLoginChanged(null)
      expect(stopped).toBe(true)
      expect(getQuotaAutoResumeState().phase).toBe('idle')
      expect(events).toContain('login-changed')
      expect(AUTO_CONTINUE_LOGIN_CHANGED_NOTICE).toContain(
        'your login changed or ended',
      )
    } finally {
      unsub()
    }
  })

  test('#47 targeted media block strip in claude.ts runs BEFORE ToolSearchRefusalError catch-all', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const claudeDir = join(import.meta.dir, '../claude')
    const src = [
      readFileSync(join(import.meta.dir, '../claude.ts'), 'utf8'),
      ...readdirSync(claudeDir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .sort()
        .map(f => readFileSync(join(claudeDir, f), 'utf8')),
    ].join('\n')
    const mediaLimitIdx = src.indexOf('if (isUnprocessableMediaError(error)')
    const targetedStripIdx = src.indexOf(
      'const mediaLoc = parseMediaErrorLocation(error.message)',
    )
    const toolSearchCatchAllIdx = src.indexOf(
      'throw new ToolSearchRefusalError(error)',
    )
    expect(mediaLimitIdx).toBeGreaterThan(-1)
    expect(targetedStripIdx).toBeGreaterThan(mediaLimitIdx)
    expect(toolSearchCatchAllIdx).toBeGreaterThan(targetedStripIdx)
  })
})
