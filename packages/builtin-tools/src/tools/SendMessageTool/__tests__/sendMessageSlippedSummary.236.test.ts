import { describe, expect, test } from 'bun:test'
import {
  coerceSendMessageInput,
  getRepairedSlippedSummarySplit,
  SendMessageTool,
} from '../SendMessageTool.js'
import { SEND_MESSAGE_SUMMARY_MAX_CHARS } from '../constants.js'

const BARE = '<parameter name="message">'
const NS = '<antml:parameter name="message">'

function slippedSummary(body: string, opener: string, message: string): string {
  return `${body}</summary>\n${opener}${message}`
}

describe('densable 2.1.236 #7 / 239 vMi slipped-summary coerce', () => {
  test('bare opener: apply split and keep first shapeClass', () => {
    const coerced = coerceSendMessageInput({
      to: 'worker',
      summary: slippedSummary('hello there', BARE, 'the real message'),
    })
    expect(coerced).not.toBeNull()
    expect(coerced!.shapeClass).toBe('split_slipped_summary_bare')
    expect(coerced!.input.summary).toBe('hello there')
    expect(coerced!.input.message).toBe('the real message')
    expect(SendMessageTool.inputSchema.safeParse(coerced!.input).success).toBe(
      true,
    )
  })

  test('namespaced opener: apply split', () => {
    const coerced = coerceSendMessageInput({
      to: 'worker',
      summary: slippedSummary('ns preview', NS, 'namespaced body'),
    })
    expect(coerced!.shapeClass).toBe('split_slipped_summary_namespaced')
    expect(coerced!.input.summary).toBe('ns preview')
    expect(coerced!.input.message).toBe('namespaced body')
  })

  test('whitespace between closer and opener is skipped', () => {
    const coerced = coerceSendMessageInput({
      to: 'w',
      summary: `preview</summary>  \n\t${BARE}body`,
    })
    expect(coerced!.shapeClass).toBe('split_slipped_summary_bare')
    expect(coerced!.input.message).toBe('body')
  })

  test('later </summary> wins when the first has no message opener', () => {
    const coerced = coerceSendMessageInput({
      to: 'w',
      summary: `keep </summary> this then</summary>\n${BARE}payload`,
    })
    expect(coerced!.shapeClass).toBe('split_slipped_summary_bare')
    expect(coerced!.input.summary).toBe('keep </summary> this then')
    expect(coerced!.input.message).toBe('payload')
  })

  test('empty message after opener is not a split', () => {
    expect(
      coerceSendMessageInput({
        to: 'w',
        summary: `preview</summary>\n${BARE}   `,
      }),
    ).toBeNull()
    expect(
      getRepairedSlippedSummarySplit({
        to: 'w',
        summary: `preview</summary>\n${BARE}   `,
      }),
    ).toBeUndefined()
  })

  test('message already set blocks split', () => {
    expect(
      coerceSendMessageInput({
        to: 'w',
        message: 'already',
        summary: slippedSummary('preview', BARE, 'slipped'),
      }),
    ).toBeNull()
  })

  test('extra keys block split', () => {
    expect(
      coerceSendMessageInput({
        to: 'w',
        type: 'message',
        summary: slippedSummary('preview', BARE, 'slipped'),
      }),
    ).toBeNull()
  })

  test('notify_when_idle is an allowed key and is preserved', () => {
    const coerced = coerceSendMessageInput({
      to: 'w',
      notify_when_idle: true,
      summary: slippedSummary('preview', BARE, 'body'),
    })
    expect(coerced!.shapeClass).toBe('split_slipped_summary_bare')
    expect(
      (coerced!.input as { notify_when_idle?: unknown }).notify_when_idle,
    ).toBe(true)
  })

  test('unrepaired markup: detect, do not apply, still truncate blob', () => {
    const blob = slippedSummary(
      'x'.repeat(SEND_MESSAGE_SUMMARY_MAX_CHARS),
      BARE,
      '<parameter name="other">still markup',
    )
    const coerced = coerceSendMessageInput({ to: 'w', summary: blob })
    expect(coerced!.shapeClass).toBe(
      'split_slipped_summary_bare_unrepaired_markup',
    )
    expect(coerced!.input.message).toBeUndefined()
    expect(coerced!.input.summary?.endsWith('…')).toBe(true)
    expect(coerced!.input.summary?.length).toBe(SEND_MESSAGE_SUMMARY_MAX_CHARS)
  })

  test('unrepaired json object/array', () => {
    expect(
      coerceSendMessageInput({
        to: 'w',
        summary: slippedSummary('p', BARE, '{"a":1}'),
      })!.shapeClass,
    ).toBe('split_slipped_summary_bare_unrepaired_json')
    expect(
      coerceSendMessageInput({
        to: 'w',
        summary: slippedSummary('p', NS, ' [1,2] '),
      })!.shapeClass,
    ).toBe('split_slipped_summary_namespaced_unrepaired_json')
    expect(
      getRepairedSlippedSummarySplit({
        to: 'w',
        summary: slippedSummary('p', BARE, '{"a":1}'),
      }),
    ).toBeUndefined()
  })

  test('applySplit false: detect_only, leave fields alone', () => {
    const summary = slippedSummary('preview', BARE, 'body')
    const coerced = coerceSendMessageInput(
      { to: 'w', summary },
      { applySplit: false },
    )
    expect(coerced!.shapeClass).toBe('split_slipped_summary_bare_detect_only')
    expect(coerced!.input.message).toBeUndefined()
    expect(coerced!.input.summary).toBe(summary)
  })

  test('derive_summary from first line when summary empty', () => {
    const coerced = coerceSendMessageInput({
      to: 'w',
      message: '  first line\nsecond  ',
    })
    expect(coerced!.shapeClass).toBe('derive_summary')
    expect(coerced!.input.summary).toBe('first line')
    expect(coerced!.input.message).toBe('  first line\nsecond  ')
  })

  test('split shapeClass wins over later truncate', () => {
    const coerced = coerceSendMessageInput({
      to: 'w',
      summary: slippedSummary('x'.repeat(250), BARE, 'body'),
    })
    expect(coerced!.shapeClass).toBe('split_slipped_summary_bare')
    expect(coerced!.input.summary?.length).toBe(SEND_MESSAGE_SUMMARY_MAX_CHARS)
    expect(coerced!.input.message).toBe('body')
  })

  test('tool.coerceInput applies split (QTl default true)', () => {
    const out = SendMessageTool.coerceInput!({
      to: 'w',
      summary: slippedSummary('preview', BARE, 'wired'),
    })
    expect(out?.shapeClass).toBe('split_slipped_summary_bare')
    expect(out?.input.message).toBe('wired')
  })

  test('backfillObservableInput skips repaired slipped summary (bMi)', () => {
    const input: Record<string, unknown> = {
      to: 'alice',
      summary: slippedSummary('preview', BARE, 'body'),
    }
    SendMessageTool.backfillObservableInput!(input)
    expect(input.type).toBeUndefined()
    expect(input.content).toBeUndefined()
  })

  test('backfill still runs when message is a normal string', () => {
    const input: Record<string, unknown> = {
      to: 'alice',
      message: 'hello',
      summary: 'hi',
    }
    SendMessageTool.backfillObservableInput!(input)
    expect(input.type).toBe('message')
  })
})
