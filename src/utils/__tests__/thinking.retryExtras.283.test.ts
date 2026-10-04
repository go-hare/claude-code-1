/**
 * densable 2.1.283 thinking/effort 400-retry extras next to Kue @184975200.
 * Gold unique strings @78419976–78421640.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  getThinkingResumptionRefused,
  getThinkingTypeOverride,
  isEffortUnsupported,
  isStickyBetaRejected,
  resetStateForTests,
} from '../../bootstrap/state.js'
import {
  THINKING_BINDING_CONTROLS_BETA_HEADER,
  THINKING_RESUMPTION_BETA_HEADER,
  THINKING_TOKEN_COUNT_BETA_HEADER,
} from '../../constants/betas.js'
import { createAssistantMessage } from '../messages.js'
import {
  THINKING_BLOCK_BINDING_EXTRA_INPUTS_RE,
  classifyEffortUnsupportedRetry,
  classifyPrefixLockStripRetry,
  classifySafeguardsUnclaimedRetry,
  classifyThinkingBindingControlsRetry,
  classifyThinkingDisplayRetry,
  classifyThinkingResumptionRetry,
  classifyThinkingTokenCountRetry,
  classifyThinkingTypeRetry,
  parseThinkingTypeRejection,
  emitRelayThinkingStripped,
  isEffortUnsupportedRejected,
  isPrefixLockHealDeclined,
  isThinkingBindingControlsRejected,
  isThinkingResumptionBetaRejected,
  isThinkingTokenCountBetaRejected,
  mapPrefixMismatchBehavior,
  setPendingThinkingStripped,
  stripAllThinkingBlocks,
  takePendingThinkingStripped,
  thinkingStrippedAttachment,
} from '../thinking.js'
import { DANGEROUS_TOOL_USE_BETA_HEADER } from '../../constants/betas.js'

const root = join(import.meta.dir, '../../..')
const src = (rel: string) => readFileSync(join(root, rel), 'utf8')

function api400(message: string, headers?: Headers): APIError {
  return new APIError(
    400,
    { type: 'error', error: { type: 'invalid_request_error', message } },
    message,
    headers ?? new Headers(),
  )
}

afterEach(() => {
  resetStateForTests()
})

describe('densable 2.1.283 thinking retry extras (Kue siblings)', () => {
  test('source-lock unique tokens + pydantic + warn strings', () => {
    expect(THINKING_BLOCK_BINDING_EXTRA_INPUTS_RE.source).toBe(
      'thinking\\.(adaptive|enabled)\\.block_binding(\\.prefix_mismatch_behavior)?: Extra inputs are not permitted',
    )
    const thinking = src('src/utils/thinking.ts')
    expect(thinking).toContain('retry:thinking-type')
    expect(thinking).toContain('thinking_type:enabled')
    expect(thinking).toContain('thinking_type:adaptive')
    expect(thinking).toContain('[thinking] model rejected thinking.type=')
    expect(thinking).toContain('retry:thinking-binding-controls')
    expect(thinking).toContain('tengu_thinking_binding_rejected_retry')
    expect(thinking).toContain(
      '[thinking] server rejected the thinking-binding-controls beta; dropping the header and the block_binding value for this conversation and retrying.',
    )
    expect(thinking).toContain(
      `[thinking] an HTTP 400 that does not name the thinking-binding-controls beta arrived on a request that carried it; guessing the platform refuses that beta, so retrying once without it and leaving it off for this conversation. The only loss is the API's list of the thinking blocks it dropped.`,
    )
    expect(thinking).toContain('retry:thinking-token-count-beta')
    expect(thinking).toContain('tengu_thinking_token_count_rejected_retry')
    expect(thinking).toContain(
      '[thinking-token-count] server rejected the beta; dropping it for this conversation and retrying.',
    )
    expect(thinking).toContain('retry:thinking-resumption-beta')
    expect(thinking).toContain(
      '[thinking-resumption] server rejected the thinking-resumption beta header; disabled for this process',
    )
    expect(thinking).toContain('surface:resume-prefill')
    expect(thinking).toContain('retry:effort-unsupported')
    expect(thinking).toContain('tengu_effort_unsupported_retry')
    expect(thinking).toContain(
      'rejected output_config.effort; latching unsupported and retrying without it.',
    )
    expect(thinking).toContain('retry:prefix-lock-strip-')
    expect(thinking).toContain('retry:prefix-lock-strip-all-')
    expect(thinking).toContain('tengu_strict_prefix_lock_400_surfaced')
    expect(thinking).toContain('prefixLockHealDeclined')
    expect(thinking).toContain('retry:safeguards-unclaimed')
    expect(thinking).toContain('tengu_server_classifier_beta_rejected_retry')
    expect(thinking).toContain("type: 'thinking_stripped'")
    expect(src('src/constants/betas.ts')).toContain(
      'dangerous-tool-use-2026-09-03',
    )
    expect(src('src/utils/attachments.ts')).toContain(
      "type: 'thinking_stripped'",
    )
    expect(src('src/cli/claimSession.ts')).toContain(
      'void registerSession(host.storageV5).catch(() => {})',
    )
    expect(src('src/utils/memoryStoreSkills.ts')).toContain(
      'store skills are not loaded on Windows (no O_NOFOLLOW)',
    )
    expect(thinking).toContain(
      '[thinking] prefix-lock rejection: nothing to strip; the error is returned.',
    )
    expect(thinking).toContain('[thinking] prefix-lock rejection: stripped ')

    const claude = src('src/services/api/claude.ts')
    expect(claude).toContain('classifyThinkingDisplayRetry')
    expect(claude).toContain('retry:thinking-type')
    expect(claude).toContain('getThinkingTypeOverride')
    expect(claude).toContain('retry:thinking-binding-controls')
    expect(claude).toContain('retry:thinking-token-count-beta')
    expect(claude).toContain('retry:thinking-resumption-beta')
    expect(claude).toContain('retry:prefix-lock-strip')

    const withRetry = src('src/services/api/withRetry.ts')
    expect(withRetry).toContain('consumedOnErrorRetryTokens')
    expect(withRetry).toContain('await options.onError?.(error)')

    expect(THINKING_BINDING_CONTROLS_BETA_HEADER).toBe(
      'thinking-binding-controls-2026-08-01',
    )
    expect(THINKING_TOKEN_COUNT_BETA_HEADER).toBe(
      'thinking-token-count-2026-05-13',
    )
    expect(THINKING_RESUMPTION_BETA_HEADER).toBe(
      'thinking-resumption-2026-07-17',
    )
  })

  test('Ewe: block_binding extra inputs → sticky-reject OL', () => {
    const err = api400(
      'thinking.adaptive.block_binding: Extra inputs are not permitted',
    )
    expect(isThinkingBindingControlsRejected(err)).toBe(true)
    expect(
      classifyThinkingBindingControlsRetry(err, {
        lastSentDisplay: undefined,
        lastRequestBetas: [THINKING_BINDING_CONTROLS_BETA_HEADER],
        model: 'claude-opus-4-6',
        carriedBindingControls: true,
      }),
    ).toBe('retry:thinking-binding-controls')
    expect(isStickyBetaRejected(THINKING_BINDING_CONTROLS_BETA_HEADER)).toBe(
      true,
    )
  })

  test('Ewe: prefix_mismatch_behavior extra inputs', () => {
    const err = api400(
      'thinking.enabled.block_binding.prefix_mismatch_behavior: Extra inputs are not permitted',
    )
    expect(THINKING_BLOCK_BINDING_EXTRA_INPUTS_RE.test(err.message)).toBe(true)
    expect(
      classifyThinkingDisplayRetry(
        err,
        undefined,
        [THINKING_BINDING_CONTROLS_BETA_HEADER],
        'claude-opus-4-6',
        { carriedBindingControls: true },
      ),
    ).toBe('retry:thinking-binding-controls')
  })

  test('aQ: thinking_type:enabled 400 → retry:thinking-type before dY', () => {
    const err = api400('capability_rejected: thinking_type:enabled')
    expect(parseThinkingTypeRejection(err)).toBe('enabled')
    expect(isEffortUnsupportedRejected(err)).toBe(false)
    expect(classifyThinkingTypeRetry(err, { model: 'claude-opus-4-6' })).toBe(
      'retry:thinking-type',
    )
    expect(getThinkingTypeOverride('claude-opus-4-6')).toBe('adaptive')
    expect(
      classifyThinkingDisplayRetry(
        err,
        undefined,
        [THINKING_BINDING_CONTROLS_BETA_HEADER],
        'claude-opus-4-6',
        { carriedBindingControls: true },
      ),
    ).toBe('retry:thinking-type')
  })

  test('aQ: thinking.type adaptive not supported flips to enabled', () => {
    const err = api400(
      'thinking.type: adaptive is not supported for this model',
    )
    expect(parseThinkingTypeRejection(err)).toBe('adaptive')
    expect(
      classifyThinkingDisplayRetry(err, undefined, [], 'claude-opus-4-6'),
    ).toBe('retry:thinking-type')
    expect(getThinkingTypeOverride('claude-opus-4-6')).toBe('enabled')
  })

  test('LU: aQ is excluded from unnamed dY binding guess', () => {
    const err = api400('capability_rejected: thinking_type:enabled')
    expect(
      classifyThinkingBindingControlsRetry(err, {
        lastSentDisplay: undefined,
        lastRequestBetas: [THINKING_BINDING_CONTROLS_BETA_HEADER],
        model: 'claude-opus-4-6',
        carriedBindingControls: true,
        allowUnnamedBindingGuess: true,
      }),
    ).toBeNull()
  })

  test('dY does not fire unless last request carried OL', () => {
    const err = api400(
      'thinking.adaptive.block_binding: Extra inputs are not permitted',
    )
    expect(
      classifyThinkingBindingControlsRetry(err, {
        lastSentDisplay: undefined,
        lastRequestBetas: [],
        model: 'claude-opus-4-6',
        carriedBindingControls: false,
      }),
    ).toBeNull()
  })

  test('Vue: Hx header 400 → sticky-reject token-count beta', () => {
    const header = THINKING_TOKEN_COUNT_BETA_HEADER
    const err = api400(
      `invalid anthropic-beta: ${header} is not supported on this endpoint`,
    )
    expect(isThinkingTokenCountBetaRejected(err)).toBe(true)
    expect(
      classifyThinkingTokenCountRetry(err, {
        lastSentDisplay: undefined,
        lastRequestBetas: [header],
        model: 'claude-opus-4-6',
        carriedTokenCount: true,
      }),
    ).toBe('retry:thinking-token-count-beta')
    expect(isStickyBetaRejected(header)).toBe(true)
  })

  test('Yue: ipt 400 → process latch; resume-prefill is not a retry token', () => {
    const header = THINKING_RESUMPTION_BETA_HEADER
    const err = api400(`invalid anthropic-beta: ${header} is not supported`)
    expect(isThinkingResumptionBetaRejected(err)).toBe(true)
    expect(classifyThinkingResumptionRetry(err, [header], false)).toBe(
      'retry:thinking-resumption-beta',
    )
    expect(getThinkingResumptionRefused()).toBe(true)
    resetStateForTests()
    expect(classifyThinkingResumptionRetry(err, [header], true)).toBe(
      'surface:resume-prefill',
    )
    expect(
      classifyThinkingDisplayRetry(
        err,
        undefined,
        [header],
        'claude-opus-4-6',
        {
          resumeIncompleteThinking: true,
        },
      ),
    ).toBeNull()
  })

  test('zue: PN effort extra inputs → latch + retry:effort-unsupported', () => {
    const err = api400('output_config.effort: Extra inputs are not permitted')
    expect(isEffortUnsupportedRejected(err)).toBe(true)
    expect(
      classifyEffortUnsupportedRetry(err, { model: 'claude-opus-4-6' }),
    ).toBe('retry:effort-unsupported')
    expect(isEffortUnsupported('claude-opus-4-6')).toBe(true)
    expect(
      classifyThinkingDisplayRetry(err, undefined, [], 'claude-opus-4-6'),
    ).toBe('retry:effort-unsupported')
  })

  test('zue: effort parameter not support', () => {
    const err = api400('The effort parameter is not supported for this model')
    expect(isEffortUnsupportedRejected(err)).toBe(true)
  })

  test('zue: capability_rejected effort_unsupported', () => {
    const err = api400('capability_rejected: effort_unsupported')
    expect(isEffortUnsupportedRejected(err)).toBe(true)
  })

  test('vMt maps drop/block; unknown is undefined', () => {
    expect(mapPrefixMismatchBehavior('drop')).toBe('drop_block')
    expect(mapPrefixMismatchBehavior('block')).toBe('error')
    expect(mapPrefixMismatchBehavior('')).toBeUndefined()
    expect(mapPrefixMismatchBehavior('warn')).toBeUndefined()
  })

  test('dGe: nothing to strip surfaces; strip-all retries', () => {
    const err = api400('thinking block bound to a different conversation')
    expect(
      classifyPrefixLockStripRetry(err, [], undefined, 'claude-opus-4-6'),
    ).toBeNull()

    const withThinking = [
      createAssistantMessage({
        content: [
          {
            type: 'thinking',
            thinking: 'secret',
            signature: 'sig-1',
          } as never,
          { type: 'text', text: 'hi' } as never,
        ],
      }),
    ]
    let healed: typeof withThinking | undefined
    const stripErr = api400('thinking block bound to a different conversation')
    const token = classifyPrefixLockStripRetry(
      stripErr,
      withThinking,
      next => {
        healed = next as typeof withThinking
      },
      'claude-opus-4-6',
    )
    expect(token).toBe('retry:prefix-lock-strip-all-1')
    expect(healed).toBeDefined()
    const stripped = stripAllThinkingBlocks(withThinking)[0]
    const content = stripped?.message?.content
    expect(Array.isArray(content)).toBe(true)
    expect(
      Array.isArray(content) &&
        content.some(b => (b as { type?: string }).type === 'thinking'),
    ).toBe(false)
    const empty = api400('thinking block bound to a different conversation')
    expect(
      classifyPrefixLockStripRetry(empty, [], undefined, 'claude-opus-4-6'),
    ).toBeNull()
    expect(isPrefixLockHealDeclined(empty)).toBe(true)
    expect(isPrefixLockHealDeclined(stripErr)).toBe(false)
    expect(isPrefixLockHealDeclined(err)).toBe(true)
  })

  test('gue: unnamed 400 with Gv on the request → retry:safeguards-unclaimed', () => {
    const err = api400('unrecognised field on this deployment')
    // gold p1e = thirdParty ∧ Gv. Default provider firstParty → null.
    expect(
      classifySafeguardsUnclaimedRetry(err, {
        lastSentDisplay: undefined,
        lastRequestBetas: [DANGEROUS_TOOL_USE_BETA_HEADER],
        model: 'claude-opus-4-6',
      }),
    ).toBeNull()
    expect(
      classifySafeguardsUnclaimedRetry(err, {
        lastSentDisplay: undefined,
        lastRequestBetas: [],
        model: 'claude-opus-4-6',
      }),
    ).toBeNull()
    expect(src('src/utils/thinking.ts')).toContain(
      "getAPIProvider() === 'firstParty'",
    )
    expect(src('src/utils/betas.ts')).toContain("provider !== 'firstParty'")
    expect(src('src/cli/claimSession.ts')).toContain(
      'void registerSession(host.storageV5).catch(() => {})',
    )
    expect(src('src/utils/memoryStoreSkills.ts')).toContain(
      'skills_as_tools_unsupported',
    )
    expect(src('src/utils/thinking.ts')).toContain("'error_recovery'")
    expect(src('src/utils/thinking.ts')).toContain('setPendingThinkingStripped')
    expect(src('src/utils/thinking.ts')).toContain(
      'takePendingThinkingStripped',
    )
    expect(src('src/services/api/claude.ts')).toContain(
      'setPendingThinkingStripped(att)',
    )
    expect(src('src/query.ts')).toContain('takePendingThinkingStripped()')
    expect(src('src/utils/memoryStoreSkills.ts')).toContain(
      'loadMemoryStoreSkillCommands',
    )
    expect(src('src/utils/memoryStoreSkills.ts')).toContain(
      "source: 'memoryStore'",
    )
    expect(src('src/utils/memoryStoreSkills.ts')).toContain(
      "loadedFrom: 'memoryStore'",
    )
  })

  test('thinking_stripped attachment is all or partial', () => {
    expect(thinkingStrippedAttachment('all')).toEqual({
      type: 'thinking_stripped',
      scope: 'all',
    })
    expect(
      thinkingStrippedAttachment('partial', {
        messageId: 'msg_1',
        thinkingIndex: 0,
      }),
    ).toEqual({
      type: 'thinking_stripped',
      scope: 'partial',
      from: { messageId: 'msg_1', thinkingIndex: 0 },
    })
  })

  test('Xue stash is consumed once by Zue takePending', () => {
    takePendingThinkingStripped()
    setPendingThinkingStripped(thinkingStrippedAttachment('all'))
    expect(takePendingThinkingStripped()).toEqual({
      type: 'thinking_stripped',
      scope: 'all',
    })
    expect(takePendingThinkingStripped()).toBeUndefined()
  })

  test('Zue emitRelayThinkingStripped waits for relayStopped latch', () => {
    const { markRelayStoppedInLastDispatch, resetStateForTests: reset } =
      require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
    reset()
    expect(emitRelayThinkingStripped(true)).toBeUndefined()
    markRelayStoppedInLastDispatch()
    expect(emitRelayThinkingStripped(true)).toEqual({
      type: 'thinking_stripped',
      scope: 'all',
    })
    expect(emitRelayThinkingStripped(true)).toBeUndefined()
  })

  test('Joe extraBody copy is 1:1', () => {
    const { copyBetaHeaderToExtraBody } =
      require('../../constants/betas.js') as typeof import('../../constants/betas.js')
    const body: Record<string, unknown> = { anthropic_beta: ['keep'] }
    copyBetaHeaderToExtraBody(body, 'thinking-token-count-2026-05-13', false)
    expect(body.anthropic_beta).toEqual(['keep'])
    copyBetaHeaderToExtraBody(body, 'thinking-token-count-2026-05-13', true)
    expect(body.anthropic_beta).toEqual([
      'keep',
      'thinking-token-count-2026-05-13',
    ])
    copyBetaHeaderToExtraBody(body, 'thinking-token-count-2026-05-13', true)
    expect(body.anthropic_beta).toEqual([
      'keep',
      'thinking-token-count-2026-05-13',
    ])
  })
})
