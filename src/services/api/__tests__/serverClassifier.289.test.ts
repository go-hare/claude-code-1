/**
 * densable 2.1.289 `_po` / `YOe` / `TZe` / `Woe`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  areThreadsHeldForServerClassifier,
  isThirdPartyServerClassifierRefused,
  resetRequestLatches,
} from '../../../bootstrap/state.js'
import {
  asServerClassifierRequest,
  createServerClassifierRequest,
  DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
  forgetServerClassifierRequest,
  hasEvaluatedCall,
  isThirdPartyNoClassificationLatch,
  latchThirdPartyNoClassification,
  parseSafeguardResults,
  recordServerClassifierRequest,
  resetServerClassifierHistoryForTests,
  rewriteThreadUnsupported,
  serverClassifierEnvelope,
  serverClassifierHistoryFor,
  settleSafeguardOnMessage,
  settleSafeguardOnRequest,
  settleServerClassifierRequest,
  settleServerClassifierStreamEnded,
  stripSafeguardsFromBlock,
} from '../serverClassifier.js'

afterEach(() => {
  resetServerClassifierHistoryForTests()
  resetRequestLatches()
})

describe('parseSafeguardResults (_po)', () => {
  test('missing or null safeguard_results → server_no_result', () => {
    expect(parseSafeguardResults(undefined)).toEqual({
      kind: 'none',
      why: 'server_no_result',
    })
    expect(parseSafeguardResults(null)).toEqual({
      kind: 'none',
      why: 'server_no_result',
    })
    expect(parseSafeguardResults({})).toEqual({
      kind: 'none',
      why: 'server_no_result',
    })
    expect(parseSafeguardResults({ safeguard_results: null })).toEqual({
      kind: 'none',
      why: 'server_no_result',
    })
  })

  test('non-array results → server_unrecognized_result', () => {
    expect(parseSafeguardResults({ safeguard_results: 'nope' })).toEqual({
      kind: 'none',
      why: 'server_unrecognized_result',
    })
  })

  test('no dangerous_tool_use row → server_no_result', () => {
    expect(
      parseSafeguardResults({
        safeguard_results: [{ type: 'other', status: { type: 'unsupported' } }],
      }),
    ).toEqual({ kind: 'none', why: 'server_no_result' })
  })

  test('two dangerous_tool_use rows → server_unrecognized_result', () => {
    expect(
      parseSafeguardResults({
        safeguard_results: [
          {
            type: DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
            status: { type: 'unsupported' },
          },
          {
            type: DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
            status: { type: 'unsupported' },
          },
        ],
      }),
    ).toEqual({ kind: 'none', why: 'server_unrecognized_result' })
  })

  test('unsupported / unavailable reasons / other', () => {
    expect(
      parseSafeguardResults({
        safeguard_results: [
          {
            type: DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
            status: { type: 'unsupported' },
          },
        ],
      }),
    ).toEqual({ kind: 'none', why: 'server_unsupported' })
    expect(
      parseSafeguardResults({
        safeguard_results: [
          {
            type: DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
            status: { type: 'unavailable', reason: 'disabled' },
          },
        ],
      }),
    ).toEqual({ kind: 'none', why: 'server_unavailable_disabled' })
    expect(
      parseSafeguardResults({
        safeguard_results: [
          {
            type: DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
            status: { type: 'unavailable', reason: 'error' },
          },
        ],
      }),
    ).toEqual({ kind: 'none', why: 'server_unavailable_error' })
    expect(
      parseSafeguardResults({
        safeguard_results: [
          {
            type: DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
            status: { type: 'unavailable', reason: 'timeout' },
          },
        ],
      }),
    ).toEqual({ kind: 'none', why: 'server_unavailable_other' })
  })

  test('available per_call; bad tool_use → unrecognized', () => {
    const parsed = parseSafeguardResults({
      safeguard_results: [
        {
          type: DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
          status: {
            type: 'available',
            tool_uses: {
              tu_ok: { type: 'evaluated', outcome: 'flagged' },
              tu_skip: { type: 'skipped' },
              tu_bad: { type: 'nope' },
            },
          },
        },
      ],
    })
    expect(parsed.kind).toBe('per_call')
    if (parsed.kind !== 'per_call') return
    expect(parsed.statuses.get('tu_ok')).toEqual({
      type: 'evaluated',
      outcome: 'flagged',
    })
    expect(parsed.statuses.get('tu_skip')).toEqual({ type: 'skipped' })
    expect(parsed.statuses.get('tu_bad')).toEqual({ type: 'unrecognized' })
  })

  test('null explanation becomes omitted', () => {
    const parsed = parseSafeguardResults({
      safeguard_results: [
        {
          type: DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
          status: {
            type: 'available',
            tool_uses: {
              tu: {
                type: 'evaluated',
                outcome: 'not_flagged',
                explanation: null,
              },
            },
          },
        },
      ],
    })
    expect(parsed.kind).toBe('per_call')
    if (parsed.kind !== 'per_call') return
    expect(parsed.statuses.get('tu')).toEqual({
      type: 'evaluated',
      outcome: 'not_flagged',
    })
  })
})

describe('ServerClassifierRequest (YOe)', () => {
  test('settle once; results resolve; rewritten; empty toJSON', async () => {
    const req = createServerClassifierRequest('k1', { agentId: 'agent-9' })
    expect(req.key).toBe('k1')
    expect(req.sentThread).toBe(false)
    expect(req.runKey).toBe('agent-9')
    expect(req.settledAt()).toBeUndefined()
    const none = { kind: 'none' as const, why: 'server_no_result' as const }
    expect(req.settle(none)).toBe(true)
    expect(req.settle(none)).toBe(false)
    expect(await req.results()).toEqual(none)
    expect(req.settledAt()).toBeGreaterThan(0)
    req.noteRewrittenCall()
    expect(req.hasRewrittenCall()).toBe(true)
    expect(JSON.stringify(req)).toBeUndefined()
    expect(asServerClassifierRequest(req)).toBe(req)
    expect(asServerClassifierRequest({})).toBeUndefined()
    expect(serverClassifierEnvelope(req)).toEqual({
      serverClassifierRequest: 'k1',
      serverClassifierResults: req,
    })
  })

  test('thread option is === true only', () => {
    expect(
      createServerClassifierRequest('a', { thread: true }).sentThread,
    ).toBe(true)
    expect(
      createServerClassifierRequest('a', { thread: false }).sentThread,
    ).toBe(false)
  })
})

describe('ServerClassifierHistory (TZe)', () => {
  test('record / settle judged ids / forget / reset', () => {
    recordServerClassifierRequest('req', { artifacts: true })
    settleServerClassifierRequest('req', ['tu_1', 'tu_2'])
    expect(serverClassifierHistoryFor('tu_1')).toEqual({
      request: 'req',
      context: { artifacts: true },
    })
    expect(serverClassifierHistoryFor('tu_2')?.request).toBe('req')
    forgetServerClassifierRequest('other')
    recordServerClassifierRequest('req2', 1)
    forgetServerClassifierRequest('req2')
    settleServerClassifierRequest('req2', ['tu_3'])
    expect(serverClassifierHistoryFor('tu_3')).toBeUndefined()
    resetServerClassifierHistoryForTests()
    expect(serverClassifierHistoryFor('tu_1')).toBeUndefined()
  })

  test('settle of unknown in-flight is a no-op', () => {
    settleServerClassifierRequest('missing', ['tu'])
    expect(serverClassifierHistoryFor('tu')).toBeUndefined()
  })
})

describe('stripSafeguardsFromBlock (Woe)', () => {
  test('drops safeguards when present; identity otherwise', () => {
    expect(stripSafeguardsFromBlock({ type: 'text', text: 'x' })).toEqual({
      type: 'text',
      text: 'x',
    })
    const stripped = stripSafeguardsFromBlock({
      type: 'tool_use',
      id: '1',
      safeguards: [{ type: 'dangerous_tool_use' }],
    })
    expect(stripped).toMatchObject({ type: 'tool_use', id: '1' })
    expect('safeguards' in stripped).toBe(false)
  })
})

describe('rewriteThreadUnsupported (kpo)', () => {
  test('thread + server_unsupported rewrites once and holds later threads', () => {
    const req = createServerClassifierRequest('k', { thread: true })
    const rewritten = rewriteThreadUnsupported(req, {
      kind: 'none',
      why: 'server_unsupported',
    })
    expect(rewritten).toEqual({
      kind: 'none',
      why: 'server_thread_unsupported',
    })
    expect(areThreadsHeldForServerClassifier()).toBe(true)
    const again = rewriteThreadUnsupported(req, {
      kind: 'none',
      why: 'server_unsupported',
    })
    expect(again).toEqual({
      kind: 'none',
      why: 'server_thread_unsupported',
    })
  })

  test('non-thread unsupported is unchanged', () => {
    const req = createServerClassifierRequest('k')
    const parsed = {
      kind: 'none' as const,
      why: 'server_unsupported' as const,
    }
    expect(rewriteThreadUnsupported(req, parsed)).toEqual(parsed)
  })
})

describe('isThirdPartyNoClassificationLatch (QOe)', () => {
  test('latches unsupported / unavailable_disabled / no_result only', () => {
    expect(
      isThirdPartyNoClassificationLatch({
        kind: 'none',
        why: 'server_unsupported',
      }),
    ).toBe(true)
    expect(
      isThirdPartyNoClassificationLatch({
        kind: 'none',
        why: 'server_unavailable_disabled',
      }),
    ).toBe(true)
    expect(
      isThirdPartyNoClassificationLatch({
        kind: 'none',
        why: 'server_no_result',
      }),
    ).toBe(true)
    expect(
      isThirdPartyNoClassificationLatch({
        kind: 'none',
        why: 'server_unrecognized_result',
      }),
    ).toBe(false)
    expect(
      isThirdPartyNoClassificationLatch({
        kind: 'per_call',
        statuses: new Map(),
      }),
    ).toBe(false)
  })
})

describe('hasEvaluatedCall (Spo)', () => {
  test('any evaluated when ids omitted; otherwise only listed ids', () => {
    const statuses = new Map([
      ['a', { type: 'evaluated' as const, outcome: 'not_flagged' as const }],
      ['b', { type: 'skipped' as const }],
    ])
    expect(hasEvaluatedCall(statuses)).toBe(true)
    expect(hasEvaluatedCall(statuses, ['b'])).toBe(false)
    expect(hasEvaluatedCall(statuses, ['a'])).toBe(true)
  })
})

describe('settleSafeguardOnRequest (xPt) / W6e / JOe', () => {
  test('xPt settles per_call evaluated ids onto history', () => {
    const req = createServerClassifierRequest('req-x')
    recordServerClassifierRequest(req.key, { slim: true })
    const parsed = settleSafeguardOnRequest(req, {
      safeguard_results: [
        {
          type: DANGEROUS_TOOL_USE_SAFEGUARD_TYPE,
          status: {
            type: 'available',
            tool_uses: {
              tu_a: { type: 'evaluated', outcome: 'not_flagged' },
              tu_b: { type: 'skipped' },
            },
          },
        },
      ],
    })
    expect(parsed?.kind).toBe('per_call')
    expect(serverClassifierHistoryFor('tu_a')?.request).toBe('req-x')
    expect(serverClassifierHistoryFor('tu_b')).toBeUndefined()
  })

  test('W6e on complete message with no results is server_no_result', () => {
    const req = createServerClassifierRequest('req-w')
    settleSafeguardOnMessage(req, {}, [
      { type: 'tool_use', id: 'tu_1' },
      { type: 'text' },
    ])
    expect(req.settledAt()).toBeGreaterThan(0)
  })

  test('JOe settles stream_ended and forgets in-flight', () => {
    const req = createServerClassifierRequest('req-j')
    recordServerClassifierRequest(req.key, { slim: true })
    settleServerClassifierStreamEnded(req)
    expect(serverClassifierHistoryFor('tu')).toBeUndefined()
  })

  test('xPt undefined request is a no-op', () => {
    expect(settleSafeguardOnRequest({}, {})).toBeUndefined()
    expect(isThirdPartyServerClassifierRefused()).toBe(false)
  })
})

describe('latchThirdPartyNoClassification (j6e)', () => {
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
  const saved: Partial<Record<(typeof PROVIDER_ENV)[number], string>> = {}

  beforeEach(() => {
    for (const key of PROVIDER_ENV) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    resetRequestLatches()
  })

  afterEach(() => {
    resetRequestLatches()
    for (const key of PROVIDER_ENV) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  test('custom ANTHROPIC_BASE_URL latches QOe none-why', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://204.44.121.220:8413'
    latchThirdPartyNoClassification({
      kind: 'none',
      why: 'server_no_result',
    })
    expect(isThirdPartyServerClassifierRefused()).toBe(true)
  })

  test('firstParty official base does not latch', () => {
    latchThirdPartyNoClassification({
      kind: 'none',
      why: 'server_no_result',
    })
    expect(isThirdPartyServerClassifierRefused()).toBe(false)
  })

  test('kpo / j6e warn copies are gold 289', () => {
    const src = readFileSync(
      join(import.meta.dir, '../serverClassifier.ts'),
      'utf8',
    )
    expect(src).toContain(
      '[server-classifier] the API answered unsupported to a request sent on a message thread; this session sends its later requests without a thread so the server can classify them',
    )
    expect(src).toContain(
      "[server-classifier] the platform gave no classification for this request (${parsed.why}); treating that as this deployment's answer: auto mode classifies locally for the rest of this session and stops sending the classifier context",
    )
  })
})
