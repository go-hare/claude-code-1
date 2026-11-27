import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  parseAmberMoleskinTable,
  resolvePrecomputeBufferFraction,
} from '../../query.js'
import { isUnparsedToolInput } from '../../utils/messages.js'
import {
  MAX_MALFORMED_TOOL_USE_RETRIES,
  malformedToolUseRetryAction,
} from '../queryHelpers.js'

const QUERY_DIR = join(import.meta.dir, '..')
const QUERY_TS = [
  readFileSync(join(import.meta.dir, '../../query.ts'), 'utf8'),
  ...readdirSync(QUERY_DIR)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map(f => readFileSync(join(QUERY_DIR, f), 'utf8')),
].join('\n')

describe('Wave 2 query.ts alignments (#897, #921, #984, #1082, #1097)', () => {
  test('#1097 isUnparsedToolInput matches SEA sX(__unparsedToolInput) sentinel', () => {
    expect(
      isUnparsedToolInput({ __unparsedToolInput: { raw: '{bad', len: 4 } }),
    ).toBe(true)
    expect(
      isUnparsedToolInput({ __unparsedToolInput: { raw: '', len: 0 } }),
    ).toBe(true)
    expect(isUnparsedToolInput({ foo: 'bar' })).toBe(false)
    expect(isUnparsedToolInput(null)).toBe(false)
    expect(isUnparsedToolInput([])).toBe(false)
    expect(
      isUnparsedToolInput({
        __unparsedToolInput: { raw: '{', len: 1 },
        extra: 1,
      }),
    ).toBe(false)
  })

  test('#1097 malformedToolUseRetryAction allows MAX_MALFORMED_TOOL_USE_RETRIES=2 retries and query.ts passes retryCount', () => {
    expect(MAX_MALFORMED_TOOL_USE_RETRIES).toBe(2)
    expect(
      malformedToolUseRetryAction({
        stopReason: 'tool_use',
        parsedToolUseCount: 0,
        isApiErrorMessage: false,
        previousReason: 'malformed_tool_use_retry',
        retryCount: 0,
      }).action,
    ).toBe('retry')
    expect(
      malformedToolUseRetryAction({
        stopReason: 'tool_use',
        parsedToolUseCount: 0,
        isApiErrorMessage: false,
        previousReason: 'malformed_tool_use_retry',
        retryCount: 1,
      }).action,
    ).toBe('retry')
    expect(
      malformedToolUseRetryAction({
        stopReason: 'tool_use',
        parsedToolUseCount: 0,
        isApiErrorMessage: false,
        previousReason: 'malformed_tool_use_retry',
        retryCount: 2,
      }).action,
    ).toBe('exhausted')
    expect(QUERY_TS).toContain('retryCount: malformedToolUseRetryCount')
    expect(QUERY_TS).toContain('!isUnparsedToolInput(b.input)')
    expect(QUERY_TS).not.toContain('UNPARSED_TOOL_INPUT_KEY')
  })

  test('#1082 tengu_amber_moleskin table parsing and resolution (JEn / Nlt)', () => {
    const raw = {
      '200000': { repl: 0.15, sdk: 0.25 },
      default: { repl: 0.1, sdk: 0.2 },
    }
    const parsed = parseAmberMoleskinTable(raw)
    expect(parsed).not.toBeNull()
    expect(resolvePrecomputeBufferFraction(raw, 200000, 'cli', 0.05)).toEqual({
      fraction: 0.15,
      source: 'table_exact',
      matchedWindowKey: 200000,
    })
    expect(resolvePrecomputeBufferFraction(raw, 1000000, 'sdk', 0.05)).toEqual({
      fraction: 0.2,
      source: 'table_default',
    })
    expect(resolvePrecomputeBufferFraction('bad', 200000, 'cli', 0.05)).toEqual(
      {
        fraction: 0.05,
        source: 'malformed',
      },
    )
  })

  test('#1082 rapidRefillBreakerTripped returns rapid_refill_breaker (not blocking_limit)', () => {
    expect(QUERY_TS).toContain("{ reason: 'rapid_refill_breaker' }")
  })

  test('#984 !isWithheldMedia && abortController.signal.aborted returns aborted_streaming', () => {
    expect(QUERY_TS).toMatch(
      /if\s*\(\s*!isWithheldMedia\s*&&\s*toolUseContext\.abortController\.signal\.aborted\s*\)/,
    )
  })

  test('#921 query.ts calls consumeClassifierOverflowCompact', () => {
    expect(QUERY_TS).toContain('consumeClassifierOverflowCompact(')
    expect(QUERY_TS).toContain('tengu_auto_mode_classifier_overflow_compact')
  })

  test('#897 query.ts returns aborted_streaming if aborted during autocompact before blocking_limit', () => {
    expect(QUERY_TS).toMatch(
      /!compactionResult\s*&&\s*!rapidRefillBreakerTripped\s*&&\s*toolUseContext\.abortController\.signal\.aborted/,
    )
  })
})
