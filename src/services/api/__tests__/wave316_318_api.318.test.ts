import { afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { formatAPIError } from '../../../../packages/@ant/model-provider/src/errorUtils.js'
import {
  getAssistantMessageFromError,
  getCloudCredentialProvider,
  classifyAPIError,
} from '../errors.js'
import {
  getOpus48FastModeDeprecationNotice,
  isOpus48FastModeRemoved,
  resolveAccessFallbackModel,
} from '../withRetry.js'
import {
  getPromptCachingEnabled,
  isSameModelForPromptCaching,
} from '../claude/promptCaching.js'
import {
  resetAutoModeClassifierTransportForTests,
  serverClassifierBetasEligible,
} from '../autoModeClassifierTransport.js'
import { OAuthRefreshDeadError } from '../../../utils/accountOnHold.js'

describe('Wave 316-318 Group B: API / Model Provider', () => {
  const prevEnv: Record<string, string | undefined> = {}

  function setEnv(k: string, v: string | undefined) {
    if (!(k in prevEnv)) prevEnv[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const k of Object.keys(prevEnv)) delete prevEnv[k]
    resetAutoModeClassifierTransportForTests()
  })

  test('#1510: formatAPIError explains intermediate certificate and name constraint SSL errors', () => {
    const leafErr = new APIError(
      undefined,
      undefined,
      'Connection error.',
      new Headers(),
    )
    ;(leafErr as { cause?: unknown }).cause = Object.assign(new Error('cert'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    })
    const formatted = formatAPIError(leafErr)
    expect(formatted).toContain('intermediate certificate')
    expect(formatted).toContain('NODE_EXTRA_CA_CERTS')

    const ncErr = new APIError(
      undefined,
      undefined,
      'Connection error.',
      new Headers(),
    )
    ;(ncErr as { cause?: unknown }).cause = Object.assign(new Error('nc'), {
      code: 'NAME_CONSTRAINTS_WITHOUT_SANS',
    })
    expect(formatAPIError(ncErr)).toContain('subject alternative names')
  })

  test('#1651: many-image dimension error extracts actual pixel limit from API error', () => {
    const err = new APIError(
      400,
      undefined,
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"image dimensions exceed max allowed size for many-image requests: 4096 pixels"}}',
      new Headers(),
    )
    const msg = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    const blocks = msg.message?.content
    const text =
      Array.isArray(blocks) && blocks[0]?.type === 'text' ? blocks[0].text : ''
    expect(text).toContain('(4096px)')
    expect(text).not.toContain('2000px')
  })

  test('#1660: OAuthRefreshDeadError with reachedTimeLimit reports time limit and headless commands', () => {
    const err = new OAuthRefreshDeadError()
    ;(err as { reachedTimeLimit?: boolean }).reachedTimeLimit = true
    expect(classifyAPIError(err)).toBe('auth_error')
    const msg = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    const blocks = msg.message?.content
    const text =
      Array.isArray(blocks) && blocks[0]?.type === 'text' ? blocks[0].text : ''
    expect(text).toContain('time limit')
  })

  test('#1584: Foundry Azure credential errors report as cloud_credential_error', () => {
    setEnv('CLAUDE_CODE_USE_FOUNDRY', '1')
    const azureErr = Object.assign(new Error('DefaultAzureCredential failed'), {
      name: 'CredentialUnavailableError',
    })
    expect(getCloudCredentialProvider(azureErr)).toBe('Azure')
    expect(classifyAPIError(azureErr)).toBe('cloud_credential_error')
    const msg = getAssistantMessageFromError(azureErr, 'claude-sonnet-4-6')
    expect(msg.error as string).toBe('cloud_credential_error')
  })

  test('#1479: Opus 4.8 fast mode deprecation notice before sunset and removed after sunset', () => {
    const beforeMs = Date.parse('2026-11-15T00:00:00Z')
    const afterMs = Date.parse('2026-12-01T00:00:00Z')
    const notice = getOpus48FastModeDeprecationNotice(
      'claude-opus-4-8',
      beforeMs,
    )
    expect(notice?.key).toBe('opus48-fast-mode-deprecation')
    expect(notice?.text).toContain('Nov 30')
    expect(isOpus48FastModeRemoved('claude-opus-4-8', beforeMs)).toBe(false)
    expect(isOpus48FastModeRemoved('claude-opus-4-8', afterMs)).toBe(true)
    expect(isOpus48FastModeRemoved('claude-opus-5-5', afterMs)).toBe(false)
  })

  test('#1485: resolveAccessFallbackModel falls back to older family model on Vertex/Bedrock', () => {
    setEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    const fb = resolveAccessFallbackModel({
      model: 'us.anthropic.claude-sonnet-4-6',
    })
    expect(fb).toBe('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
    expect(
      resolveAccessFallbackModel({
        model: 'claude-sonnet-4-6',
        accessFallbackModel: 'custom-fallback',
      }),
    ).toBe('custom-fallback')
    setEnv('CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK', '1')
    expect(
      resolveAccessFallbackModel({
        model: 'us.anthropic.claude-sonnet-4-6',
      }),
    ).toBeUndefined()
  })

  test('#1568: isSameModelForPromptCaching normalizes [1m], cross-region, and undated variants', () => {
    expect(
      isSameModelForPromptCaching(
        'us.anthropic.claude-sonnet-4-5-20250929-v1:0[1m]',
        'claude-sonnet-4-5-20250929',
      ),
    ).toBe(true)
    expect(
      isSameModelForPromptCaching(
        'claude-sonnet-4-5',
        'claude-sonnet-4-5-20250929',
      ),
    ).toBe(true)
    expect(
      isSameModelForPromptCaching(
        'claude-sonnet-4-5-20250929',
        'claude-sonnet-4-5-20251001',
      ),
    ).toBe(false)
    setEnv('DISABLE_PROMPT_CACHING_SONNET', '1')
    expect(getPromptCachingEnabled('claude-sonnet-4-6[1m]')).toBe(
      getPromptCachingEnabled('claude-sonnet-4-6'),
    )
  })

  test('#1494: CLAUDE_CODE_AUTO_MODE_SERVER bypasses experimental betas restriction on 3P', () => {
    setEnv('ANTHROPIC_BASE_URL', 'https://gateway.example.com')
    setEnv('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', '1')
    setEnv('CLAUDE_CODE_AUTO_MODE_SERVER', '1')
    resetAutoModeClassifierTransportForTests()
    expect(serverClassifierBetasEligible()).toBe(true)
  })
})
