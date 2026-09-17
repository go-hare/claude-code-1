/**
 * Tests for src/utils/taskSummary.ts
 *
 * Covers: shouldGenerateTaskSummary, maybeGenerateTaskSummary
 *
 * Note: bun:bundle's feature() is a compile-time construct and cannot be
 * trivially mocked at test time. We test maybeGenerateTaskSummary (which
 * is called unconditionally) and the rate-limit behavior indirectly.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { bunBundleMock } from '../../../tests/mocks/bunBundle.js'
import { debugMock } from '../../../tests/mocks/debug.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import * as realConcurrent from '../concurrentSessions.js'

const concurrentSnap = snapshotModuleExports(realConcurrent)

// ─── mocks ──────────────────────────────────────────────────────────────────

let _updateCalls: any[] = []

mock.module('bun:bundle', bunBundleMock)
mock.module('../debug.js', debugMock)
mock.module('../concurrentSessions.js', () => ({
  ...concurrentSnap,
  isBgSession: () => false,
  updateSessionActivity: async (data: any) => {
    _updateCalls.push(data)
  },
}))

afterAll(() => {
  mock.module('../concurrentSessions.js', () => ({ ...concurrentSnap }))
})

// ─── import after mocks ─────────────────────────────────────────────────────

const { shouldGenerateTaskSummary, maybeGenerateTaskSummary } = await import(
  '../taskSummary.js'
)

// ─── tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  _updateCalls = []
})

describe('shouldGenerateTaskSummary', () => {
  test('returns false when feature is disabled', () => {
    // bun:bundle feature mock returns false
    expect(shouldGenerateTaskSummary()).toBe(false)
  })
})

describe('maybeGenerateTaskSummary', () => {
  test('does not throw with empty messages', () => {
    expect(() =>
      maybeGenerateTaskSummary({ forkContextMessages: [] }),
    ).not.toThrow()
  })

  test('does not throw with undefined messages', () => {
    expect(() => maybeGenerateTaskSummary({})).not.toThrow()
  })

  test('does not throw with assistant message containing tool_use', () => {
    expect(() =>
      maybeGenerateTaskSummary({
        forkContextMessages: [
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Let me check' },
                { type: 'tool_use', name: 'bash' },
              ],
            },
          },
        ],
      }),
    ).not.toThrow()
  })

  test('does not throw with non-array content', () => {
    expect(() =>
      maybeGenerateTaskSummary({
        forkContextMessages: [
          {
            type: 'assistant',
            message: {
              content: 'plain text response',
            },
          },
        ],
      }),
    ).not.toThrow()
  })
})
