import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildBlockedPostTurnSummary,
  buildCompletedPostTurnSummary,
  buildPostTurnSummary,
  resolveClassifierCaps,
  resolveClassifierSummaryMode,
  resolveClassifierSurfaces,
  shouldEmitBlockedClassifierSummary,
  shouldEmitCompletedClassifierSummary,
} from '../classifierSummary.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_CLASSIFIER_SUMMARY
  delete process.env.CLAUDE_CODE_CLASSIFIER_SURFACES
  delete process.env.CLAUDE_CODE_CLASSIFIER_DISABLED_SURFACES
  delete process.env.CLAUDE_CODE_CLASSIFIER_SUMMARY_KILL
  delete process.env.CLAUDE_CODE_ENTRYPOINT
})

describe('resolveClassifierSurfaces / caps (official $ro / MNu)', () => {
  test('defaults to cli', () => {
    expect(resolveClassifierSurfaces(undefined).has('cli')).toBe(true)
  })
  test('bg drops summary', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'bg'
    const caps = resolveClassifierCaps(resolveClassifierSurfaces('bg'))
    expect(caps.has('state')).toBe(true)
    expect(caps.has('summary')).toBe(false)
  })
  test('cli has summary', () => {
    const caps = resolveClassifierCaps(resolveClassifierSurfaces('cli'))
    expect(caps.has('summary')).toBe(true)
  })
})

describe('resolveClassifierSummaryMode (official NNu)', () => {
  test('heuristic default for summary surfaces', () => {
    expect(resolveClassifierSummaryMode(new Set(['summary']), {})).toBe(
      'heuristic',
    )
  })
  test('env truthy → llm', () => {
    expect(
      resolveClassifierSummaryMode(new Set(['summary']), {
        CLAUDE_CODE_CLASSIFIER_SUMMARY: '1',
      }),
    ).toBe('llm')
  })
  test('env falsy string → heuristic', () => {
    expect(
      resolveClassifierSummaryMode(new Set(['summary']), {
        CLAUDE_CODE_CLASSIFIER_SUMMARY: '0',
      }),
    ).toBe('heuristic')
  })
  test('state-only → llm', () => {
    expect(resolveClassifierSummaryMode(new Set(['state']), {})).toBe('llm')
  })
})

describe('buildBlockedPostTurnSummary (official GMg)', () => {
  test('dialog vs permission', () => {
    expect(
      buildBlockedPostTurnSummary({
        tool_name: 'dialog:plan',
        action_description: 'Pick a plan',
        tool_use_id: 't1',
        request_id: 'r1',
      }),
    ).toEqual({
      status_category: 'blocked',
      status_detail: 'Waiting on a user dialog',
      needs_action: 'Pick a plan',
    })
    expect(
      buildBlockedPostTurnSummary({
        tool_name: 'Bash',
        action_description: 'Running tests',
        tool_use_id: 't2',
        request_id: 'r2',
      }).status_detail,
    ).toContain('Bash')
  })
})

describe('buildPostTurnSummary (official WMg)', () => {
  test('review_ready clears needs_action', () => {
    expect(
      buildPostTurnSummary({
        state: 'review_ready',
        detail: 'Turn complete',
        needs: 'should be ignored',
      }),
    ).toEqual({
      status_category: 'review_ready',
      status_detail: 'Turn complete',
      needs_action: '',
    })
  })
})

describe('shouldEmitBlockedClassifierSummary', () => {
  test('true for default cli', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    expect(shouldEmitBlockedClassifierSummary(process.env)).toBe(true)
  })
  test('false for bg state-only', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'bg'
    // state-only mode is llm but no summary cap → false
    expect(shouldEmitBlockedClassifierSummary(process.env)).toBe(false)
  })
})

describe('buildCompletedPostTurnSummary densable', () => {
  test('uses assistant text snippet', () => {
    expect(
      buildCompletedPostTurnSummary({
        assistantText: '  Fixed the cold resume reattach path.  ',
      }),
    ).toEqual({
      status_category: 'completed',
      status_detail: 'Fixed the cold resume reattach path.',
      needs_action: '',
    })
  })
  test('truncates long text and tool fallback', () => {
    const long = 'x'.repeat(200)
    const withText = buildCompletedPostTurnSummary({ assistantText: long })
    expect(withText.status_category).toBe('completed')
    expect(withText.status_detail.endsWith('...')).toBe(true)
    expect(withText.status_detail.length).toBe(160)
    expect(
      buildCompletedPostTurnSummary({ toolUseCount: 3 }).status_detail,
    ).toBe('Turn completed after 3 tool uses')
    expect(
      buildCompletedPostTurnSummary({ outcome: 'error' }).status_category,
    ).toBe('failed')
  })
})

describe('shouldEmitCompletedClassifierSummary densable', () => {
  test('true for cli summary surfaces', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    expect(shouldEmitCompletedClassifierSummary(process.env)).toBe(true)
  })
  test('false for bg', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'bg'
    expect(shouldEmitCompletedClassifierSummary(process.env)).toBe(false)
  })
})

describe('buildCompletedPostTurnSummaryWithHost LLM densable', () => {
  test('falls back to heuristic without host', async () => {
    const {
      buildCompletedPostTurnSummaryWithHost,
      resetCompletedClassifierLlmHostForTests,
    } = await import('../classifierSummary.js')
    resetCompletedClassifierLlmHostForTests()
    const out = await buildCompletedPostTurnSummaryWithHost(
      { assistantText: 'done via heuristic' },
      { env: { CLAUDE_CODE_ENTRYPOINT: 'cli' } },
    )
    expect(out.status_detail).toBe('done via heuristic')
  })

  test('uses LLM host when mode is llm', async () => {
    const {
      buildCompletedPostTurnSummaryWithHost,
      setCompletedClassifierLlmHost,
      resetCompletedClassifierLlmHostForTests,
    } = await import('../classifierSummary.js')
    resetCompletedClassifierLlmHostForTests()
    setCompletedClassifierLlmHost({
      generate: async () => ({
        status_category: 'completed',
        status_detail: 'LLM: fixed observer cold reattach',
        needs_action: '',
      }),
    })
    try {
      const out = await buildCompletedPostTurnSummaryWithHost(
        { assistantText: 'ignored when host returns' },
        {
          env: {
            CLAUDE_CODE_ENTRYPOINT: 'cli',
            CLAUDE_CODE_CLASSIFIER_SUMMARY: '1',
          },
        },
      )
      expect(out.status_detail).toBe('LLM: fixed observer cold reattach')
      expect(out.status_category).toBe('completed')
    } finally {
      resetCompletedClassifierLlmHostForTests()
    }
  })

  test('host throw falls back to heuristic', async () => {
    const {
      buildCompletedPostTurnSummaryWithHost,
      setCompletedClassifierLlmHost,
      resetCompletedClassifierLlmHostForTests,
    } = await import('../classifierSummary.js')
    resetCompletedClassifierLlmHostForTests()
    setCompletedClassifierLlmHost({
      generate: async () => {
        throw new Error('model down')
      },
    })
    try {
      const out = await buildCompletedPostTurnSummaryWithHost(
        { assistantText: 'safe fallback' },
        {
          env: {
            CLAUDE_CODE_ENTRYPOINT: 'cli',
            CLAUDE_CODE_CLASSIFIER_SUMMARY: '1',
          },
        },
      )
      expect(out.status_detail).toBe('safe fallback')
    } finally {
      resetCompletedClassifierLlmHostForTests()
    }
  })

  test('ensureCompletedClassifierLlmHost installs default when mode is llm', async () => {
    const {
      ensureCompletedClassifierLlmHost,
      getCompletedClassifierLlmHost,
      resetCompletedClassifierLlmHostForTests,
      createDefaultCompletedClassifierLlmHost,
      buildCompletedPostTurnSummaryWithHost,
    } = await import('../classifierSummary.js')
    resetCompletedClassifierLlmHostForTests()
    try {
      expect(
        ensureCompletedClassifierLlmHost({
          CLAUDE_CODE_ENTRYPOINT: 'cli',
          CLAUDE_CODE_CLASSIFIER_SUMMARY: '0',
        }),
      ).toBeNull()
      expect(getCompletedClassifierLlmHost()).toBeNull()

      const host = ensureCompletedClassifierLlmHost({
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_CLASSIFIER_SUMMARY: '1',
      })
      expect(host).not.toBeNull()
      expect(getCompletedClassifierLlmHost()).toBe(host)
      // Idempotent
      expect(
        ensureCompletedClassifierLlmHost({
          CLAUDE_CODE_ENTRYPOINT: 'cli',
          CLAUDE_CODE_CLASSIFIER_SUMMARY: '1',
        }),
      ).toBe(host)

      // Injectable generate path of default host factory
      const injected = createDefaultCompletedClassifierLlmHost({
        generate: async () => ({
          status_detail: 'LLM via default factory',
        }),
      })
      const out = await buildCompletedPostTurnSummaryWithHost(
        { assistantText: 'ignored' },
        {
          env: {
            CLAUDE_CODE_ENTRYPOINT: 'cli',
            CLAUDE_CODE_CLASSIFIER_SUMMARY: '1',
          },
          host: injected,
        },
      )
      expect(out.status_detail).toBe('LLM via default factory')
    } finally {
      resetCompletedClassifierLlmHostForTests()
    }
  })
})
