/**
 * densable 2.1.214 #7 — EEf / R5b remote user-dialog handlers.
 */
import { describe, expect, test } from 'bun:test'
import { REFUSAL_FALLBACK_DIALOG_KIND } from '../../utils/printRequestDialog.js'
import { REMOTE_USER_DIALOG_HANDLERS } from '../useRemoteUserDialog.js'

describe('densable EEf R5b remote user dialog handlers', () => {
  test('only refusal_fallback_prompt is registered (densable O5-only R5b)', () => {
    expect(Object.keys(REMOTE_USER_DIALOG_HANDLERS)).toEqual([
      REFUSAL_FALLBACK_DIALOG_KIND,
    ])
  })

  test('invalid payload cancels', async () => {
    const h = REMOTE_USER_DIALOG_HANDLERS[REFUSAL_FALLBACK_DIALOG_KIND]!
    const r = await h(
      undefined,
      { foo: 1 },
      { signal: new AbortController().signal },
    )
    expect(r).toEqual({ behavior: 'cancelled' })
  })

  test('missing requestDialog host cancels', async () => {
    const h = REMOTE_USER_DIALOG_HANDLERS[REFUSAL_FALLBACK_DIALOG_KIND]!
    const r = await h(
      undefined,
      { originalModel: 'opus', fallbackModel: 'sonnet' },
      { signal: new AbortController().signal },
    )
    expect(r).toEqual({ behavior: 'cancelled' })
  })

  test('host choice completed with result', async () => {
    const h = REMOTE_USER_DIALOG_HANDLERS[REFUSAL_FALLBACK_DIALOG_KIND]!
    const r = await h(
      async () => 'retry_fallback',
      { originalModel: 'opus', fallbackModel: 'sonnet' },
      { signal: new AbortController().signal },
    )
    expect(r).toEqual({ behavior: 'completed', result: 'retry_fallback' })
  })

  test('host cancelled maps to cancelled behavior', async () => {
    const h = REMOTE_USER_DIALOG_HANDLERS[REFUSAL_FALLBACK_DIALOG_KIND]!
    const r = await h(
      async () => 'cancelled',
      { originalModel: 'opus', fallbackModel: 'sonnet' },
      { signal: new AbortController().signal },
    )
    expect(r).toEqual({ behavior: 'cancelled' })
  })
})
