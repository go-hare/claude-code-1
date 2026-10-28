/**
 * densable 2.1.289 T6e / R6e / UTt — named + unclaimed dangerous-tool-use
 * retry. Lj is live (default may be arbiter); this file locks T6e/R6e/UTt.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  isStickyBetaRejected,
  isThirdPartyServerClassifierRefused,
  resetStateForTests,
  stickySendBeta,
} from '../../bootstrap/state.js'
import {
  DANGEROUS_TOOL_USE_BETA_HEADER,
  THINKING_BINDING_CONTROLS_BETA_HEADER,
} from '../../constants/betas.js'
import {
  classifySafeguardsNamedRetry,
  classifySafeguardsUnclaimedRetry,
  classifyThinkingRetryExtras,
  isTopLevelSafeguardsRejected,
} from '../thinking.js'
import type { ThinkingRetryContext } from '../thinking.js'

const root = join(import.meta.dir, '../../..')
const thinkingSrc = readFileSync(join(root, 'src/utils/thinking.ts'), 'utf8')

function api400(message: string): APIError {
  return new APIError(
    400,
    { type: 'error', error: { type: 'invalid_request_error', message } },
    message,
    new Headers(),
  )
}

const PROVIDER_ENV = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'ANTHROPIC_UNIX_SOCKET',
  'ANTHROPIC_BASE_URL',
] as const

const savedEnv: Record<(typeof PROVIDER_ENV)[number], string | undefined> =
  Object.fromEntries(PROVIDER_ENV.map(k => [k, undefined])) as Record<
    (typeof PROVIDER_ENV)[number],
    string | undefined
  >

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV) {
    delete process.env[key]
  }
}

beforeEach(() => {
  for (const key of PROVIDER_ENV) {
    savedEnv[key] = process.env[key]
  }
  clearProviderEnv()
  resetStateForTests()
})

afterEach(() => {
  resetStateForTests()
  for (const key of PROVIDER_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

function ctx(
  betas: readonly string[] = [DANGEROUS_TOOL_USE_BETA_HEADER],
): ThinkingRetryContext {
  return {
    lastSentDisplay: undefined,
    lastRequestBetas: betas,
    model: 'claude-opus-4-6',
  }
}

describe('UTt top-level safeguards 400', () => {
  test('header + anthropic-beta counts; content-block path does not', () => {
    expect(
      isTopLevelSafeguardsRejected(
        api400(
          `unknown beta ${DANGEROUS_TOOL_USE_BETA_HEADER} in anthropic-beta`,
        ),
      ),
    ).toBe(true)
    expect(
      isTopLevelSafeguardsRejected(
        api400(
          'capability_rejected: beta_header:' + DANGEROUS_TOOL_USE_BETA_HEADER,
        ),
      ),
    ).toBe(true)
    expect(
      isTopLevelSafeguardsRejected(
        api400('safeguards field is not permitted on this request'),
      ),
    ).toBe(true)
    expect(
      isTopLevelSafeguardsRejected(
        api400(
          'messages.0.content.0.safeguards: Extra inputs are not permitted',
        ),
      ),
    ).toBe(false)
    expect(
      isTopLevelSafeguardsRejected(
        api400(
          'messages.0.content.0.input.safeguards: Extra inputs are not permitted',
        ),
      ),
    ).toBe(false)
  })
})

describe('T6e named retry', () => {
  test('Yy required: lastRequestBetas alone is not enough', () => {
    const err = api400(
      `unknown beta ${DANGEROUS_TOOL_USE_BETA_HEADER} in anthropic-beta`,
    )
    expect(classifySafeguardsNamedRetry(err, ctx())).toBeNull()
  })

  test('1P UTt → retry:safeguards; does not latch nte', () => {
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    const err = api400(
      `unknown beta ${DANGEROUS_TOOL_USE_BETA_HEADER} in anthropic-beta`,
    )
    expect(classifySafeguardsNamedRetry(err, ctx())).toBe('retry:safeguards')
    expect(isStickyBetaRejected(DANGEROUS_TOOL_USE_BETA_HEADER)).toBe(true)
    expect(isThirdPartyServerClassifierRefused()).toBe(false)
  })

  test('3P named header → retry:safeguards and C5t', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    const err = api400(
      `this deployment does not support ${DANGEROUS_TOOL_USE_BETA_HEADER}`,
    )
    expect(classifySafeguardsNamedRetry(err, ctx())).toBe('retry:safeguards')
    expect(isThirdPartyServerClassifierRefused()).toBe(true)
  })

  test('3P invalid beta flag (no OL) is unnamed T6e', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    const err = api400('Invalid beta flag')
    expect(classifySafeguardsNamedRetry(err, ctx())).toBe('retry:safeguards')
    expect(isThirdPartyServerClassifierRefused()).toBe(true)
  })

  test('3P invalid beta flag with OL sticky is not T6e ss (b6e)', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    stickySendBeta(THINKING_BINDING_CONTROLS_BETA_HEADER)
    const err = api400('Invalid beta flag')
    expect(
      classifySafeguardsNamedRetry(
        err,
        ctx([
          DANGEROUS_TOOL_USE_BETA_HEADER,
          THINKING_BINDING_CONTROLS_BETA_HEADER,
        ]),
      ),
    ).toBeNull()
  })

  test('foundry 400 naming dangerous_tool_use records capabilities', () => {
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    const err = api400('dangerous_tool_use not supported in your workspace')
    expect(classifySafeguardsNamedRetry(err, ctx())).toBe('retry:safeguards')
    expect(isThirdPartyServerClassifierRefused()).toBe(true)
  })
})

describe('R6e unclaimed retry', () => {
  test('firstParty k6e is off → null', () => {
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    const err = api400('unrecognised field on this deployment')
    expect(classifySafeguardsUnclaimedRetry(err, ctx())).toBeNull()
  })

  test('3P unnamed 400 with sticky Gv → retry:safeguards-unclaimed', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    const err = api400('unrecognised field on this deployment')
    expect(classifySafeguardsUnclaimedRetry(err, ctx())).toBe(
      'retry:safeguards-unclaimed',
    )
    expect(isStickyBetaRejected(DANGEROUS_TOOL_USE_BETA_HEADER)).toBe(true)
  })

  test('extras: T6e wins over R6e when UTt matches', () => {
    stickySendBeta(DANGEROUS_TOOL_USE_BETA_HEADER)
    const err = api400(
      `unknown beta ${DANGEROUS_TOOL_USE_BETA_HEADER} in anthropic-beta`,
    )
    expect(classifyThinkingRetryExtras(err, ctx())).toBe('retry:safeguards')
  })
})

describe('source lock 289 T6e/R6e/UTt', () => {
  test('gold warn copies and Sto live in thinking.ts', () => {
    expect(thinkingSrc).toContain(
      'the platform rejected a beta on this request (HTTP 400), most likely dangerous-tool-use',
    )
    expect(thinkingSrc).toContain(
      "the server rejected the dangerous-tool-use beta header or the safeguards field (HTTP 400); neither is sent again this conversation, so every auto-mode tool use is denied as classifier-unavailable until the conversation's betas reset (/clear or /compact)",
    )
    expect(thinkingSrc).toContain(
      'an unrecognised HTTP 400 arrived while the dangerous-tool-use beta was on the request',
    )
    expect(thinkingSrc).toContain(
      '^messages\\.\\d+\\.content\\.\\d+(?:\\.\\w+)*\\.safeguards\\b',
    )
    expect(thinkingSrc).toContain('retry:safeguards')
    expect(thinkingSrc).toContain('unclaimed: false')
  })
})
