/**
 * densable 2.1.246 #55 — official GJn midstream continue gate.
 *
 * Official GJn @214370857:
 *   assistant && isApiErrorMessage && truncatedAfterOutput
 *   && isNonInteractiveSession && kl(querySource)==="main"
 *   && we("tengu_truncated_response_recovery", true)
 *
 * Call site lQn @214417526 after max_output_tokens / before
 * malformed_tool_use. Shares WJn=3 with max_output_tokens_recovery.
 *
 * Producer @217050118: truncatedAfterOutput: yl&&!Xr ? true : void 0
 *
 * 09-16 promoted to HAVE.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isCompanionOrToolUserMessage,
  isUserMessageWithPairedToolResultsOnly,
} from '../messages.js'

const srcRoot = join(import.meta.dir, '../..')
const query = readFileSync(join(srcRoot, 'query.ts'), 'utf8')
const transitions = readFileSync(join(srcRoot, 'query/transitions.ts'), 'utf8')
const messages = readFileSync(join(srcRoot, 'utils/messages.ts'), 'utf8')
const claude = readFileSync(join(srcRoot, 'services/api/claude.ts'), 'utf8')

describe('#55 GJn truncated recovery (2.1.246)', () => {
  test('GJn host + producer field are landed 1:1', () => {
    expect(query).toContain('function isTruncatedAfterOutputRecovery(')
    expect(query).toContain('tengu_truncated_response_recovery')
    expect(query).toContain('truncated_response_recovery')
    expect(query).toContain('cut off mid-stream')
    expect(query).toContain('MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3')
    expect(transitions).toContain('truncated_response_recovery')
    expect(messages).toContain('truncatedAfterOutput')
    expect(claude).toContain('truncatedAfterOutput')
    expect(claude).toContain('hasOutput && !hasToolUse ? true : undefined')
    // Official dt({isMeta:!0,turnCompanion:!0}) on GJn and qJn recoveries.
    expect(messages).toContain('turnCompanion?: true')
    expect(messages).toContain('uMsg.turnCompanion === true ? true : undefined')
    const gjn = query.slice(
      query.indexOf('cut off mid-stream'),
      query.indexOf("reason: 'truncated_response_recovery'"),
    )
    expect(gjn).toContain('turnCompanion: true')
    const qjn = query.slice(
      query.indexOf('Output token limit hit'),
      query.indexOf("reason: 'max_output_tokens_recovery'"),
    )
    expect(qjn).toContain('turnCompanion: true')
  })

  test('ae / replacesSpan / Ze pairing are official #55', () => {
    expect(messages).toContain('export function isCompanionOrToolUserMessage(')
    expect(messages).toContain(
      'export function isUserMessageWithPairedToolResultsOnly(',
    )
    expect(messages).toContain('replacesSpan?: true')
    expect(messages).toContain('sourceToolUseID?: string')
    expect(messages).toContain('s.replacesSpan === true')
    expect(messages).toContain('message.turnCompanion === true')
  })

  test('isCompanionOrToolUserMessage official or-chain; isUserMessageWithPairedToolResultsOnly pairs then replacesSpan stops', () => {
    expect(isCompanionOrToolUserMessage({})).toBe(false)
    expect(isCompanionOrToolUserMessage({ turnCompanion: true })).toBe(true)
    expect(isCompanionOrToolUserMessage({ toolUseResult: 1 })).toBe(true)
    const assistant = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1' }] },
    }
    const user = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] },
    }
    expect(isUserMessageWithPairedToolResultsOnly([assistant, user], 1)).toBe(
      true,
    )
    const span = {
      type: 'user',
      replacesSpan: true,
      message: { content: [] },
    }
    expect(
      isUserMessageWithPairedToolResultsOnly([assistant, span, user], 2),
    ).toBe(false)
  })
})
