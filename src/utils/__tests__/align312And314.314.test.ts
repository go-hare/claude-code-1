import { afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  _resetSessionOrgEffortCapsForTesting,
  clampEffortToCap,
  getSessionOrgEffortCap,
  isInvalidEffortLevelError,
  markOrgEffortCapNotified,
  shouldWarnEffortCacheMiss,
  stepDownOrgEffortCap,
} from '../effort.js'
import {
  isToolSearchSessionLatchedOff,
  latchToolSearchOffForSession,
  resetToolSearchSessionLatch,
} from '../searchExtraTools.js'
import { isDenseDefaultSystemPromptModel } from '../simpleSystemPrompt.js'
import {
  resolve3PRefusalFallbackTarget,
  resolveDefaultRefusalFallbackModel,
} from '../refusalFallback.js'
import {
  isFoundryDeploymentNotFoundError,
  resolveFoundryFamilyFallbackModel,
} from '../foundryCapabilities.js'
import { formatGatewayTlsCertHint } from '../gatewayLogin.js'
import {
  getEffortNotificationText,
  formatEffortIndicatorText,
} from '../../components/EffortIndicator.js'
import {
  CACHE_MISS_SUBTITLE,
  formatCacheSwitchBody,
} from '../../commands/model/model.js'

describe('v2.1.311–314 effort, prompts, refusal, foundry, gateway alignment', () => {
  const savedEnv = { ...process.env }

  afterEach(() => {
    _resetSessionOrgEffortCapsForTesting()
    resetToolSearchSessionLatch()
    for (const k of Object.keys(process.env)) {
      if (!(k in savedEnv)) delete process.env[k]
    }
    Object.assign(process.env, savedEnv)
  })

  test('#1247 shouldWarnEffortCacheMiss checks plan model when in plan mode', () => {
    expect(
      shouldWarnEffortCacheMiss({
        target: 'low',
        current: 'high',
        mainLoopModel: 'claude-opus-4-5',
        permissionMode: 'plan',
        totalOutputTokens: 100,
        promptCacheMayBeWarm: true,
      }),
    ).toBe(true)
  })

  test('#1324 cache warning copy matches SEA Qie', () => {
    expect(CACHE_MISS_SUBTITLE).toBe(
      'Your next response will be slower and use more tokens',
    )
    expect(formatCacheSwitchBody('effort', 'low')).toBe(
      'This conversation is cached for the current effort level. Switching to low means the full history gets re-read.',
    )
  })

  test('#1330 EffortIndicator mid-task pending note', () => {
    expect(
      formatEffortIndicatorText('medium', false, false, true, 'medium'),
    ).toContain('may wait for your next message')
    expect(
      formatEffortIndicatorText('medium', false, false, false, 'medium'),
    ).toContain('/effort')
    const txt = getEffortNotificationText(
      'medium',
      'claude-sonnet-4-6',
      false,
      {
        midTaskPending: true,
      },
    )
    expect(txt).toContain('may wait for your next message')
  })

  test('#1332 simpleSystemPrompt uses canonical resolution for unrecognized ARNs/deployments', () => {
    expect(isDenseDefaultSystemPromptModel('claude-sonnet-4-6')).toBe(true)
    expect(isDenseDefaultSystemPromptModel('claude-haiku-4-5')).toBe(true)
    expect(
      isDenseDefaultSystemPromptModel(
        'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/my-sonnet-proxy',
      ),
    ).toBe(false)
    expect(isDenseDefaultSystemPromptModel('custom-haiku-deployment')).toBe(
      false,
    )
  })

  test('#1333 refusalFallback resolves 3P / unrecognized model fallback target', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'us.anthropic.claude-opus-4-6-v1'
    expect(resolve3PRefusalFallbackTarget()).toBe(
      'us.anthropic.claude-opus-4-6-v1',
    )
    expect(resolveDefaultRefusalFallbackModel('custom-deployment')).toBe(
      'us.anthropic.claude-opus-4-6-v1',
    )
  })

  test('#1358 Invalid effort level error steps down effort and latches cap', () => {
    const err = new APIError(
      400,
      {
        error: {
          type: 'invalid_request_error',
          message: 'Invalid effort level',
        },
      },
      '400 {"error":{"message":"Invalid effort level"}}',
      new Headers(),
    )
    expect(isInvalidEffortLevelError(err)).toBe(true)
    const next = stepDownOrgEffortCap('claude-opus-4-7', 'xhigh')
    expect(next).toBe('high')
    expect(getSessionOrgEffortCap('claude-opus-4-7')).toBe('high')
    expect(clampEffortToCap('max', next)).toBe('high')
    expect(markOrgEffortCapNotified('claude-opus-4-7')).toBe(true)
    expect(markOrgEffortCapNotified('claude-opus-4-7')).toBe(false)
  })

  test('#1361 Foundry DeploymentNotFound & family fallback resolution', () => {
    const err = new APIError(
      404,
      {
        error: {
          code: 'DeploymentNotFound',
          message: 'The API deployment does not exist',
        },
      },
      '404 DeploymentNotFound',
      new Headers(),
    )
    expect(isFoundryDeploymentNotFoundError(err)).toBe(true)
    expect(resolveFoundryFamilyFallbackModel('claude-opus-4-6')).toBe(
      'claude-opus-4-5',
    )
    expect(resolveFoundryFamilyFallbackModel('claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-5',
    )
  })

  test('#1362 tool_search session latch toggles cleanly', () => {
    expect(isToolSearchSessionLatchedOff()).toBe(false)
    latchToolSearchOffForSession()
    expect(isToolSearchSessionLatchedOff()).toBe(true)
    resetToolSearchSessionLatch()
    expect(isToolSearchSessionLatchedOff()).toBe(false)
  })

  test('#1363 gatewayLogin UNABLE_TO_GET_ISSUER_CERT gives renewal guidance', () => {
    const err = Object.assign(new Error('unable to get issuer certificate'), {
      code: 'UNABLE_TO_GET_ISSUER_CERT',
    })
    const hint = formatGatewayTlsCertHint(err)
    expect(hint).toContain('UNABLE_TO_GET_ISSUER_CERT')
    expect(hint).toContain('leftover from a renewal')
  })
})
