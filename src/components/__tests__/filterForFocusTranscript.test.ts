import { describe, expect, test } from 'bun:test'
import { filterForFocusTranscript } from '../Messages.js'

type Msg = {
  type: string
  subtype?: string
  isMeta?: boolean
  isApiErrorMessage?: boolean
  message?: {
    content: Array<{
      type: string
      name?: string
      id?: string
      tool_use_id?: string
      text?: string
    }>
  }
  attachment?: {
    type: string
    isMeta?: boolean
    origin?: unknown
    commandMode?: string
  }
}

describe('filterForFocusTranscript densable residual', () => {
  test('keeps user prompt, assistant text, collapsed summary; drops tool chrome', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        message: { content: [{ type: 'text', text: 'hello' }] },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'tu1' }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1' }],
        },
      },
      {
        type: 'collapsed_read_search',
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'done' }] },
      },
      {
        type: 'system',
        subtype: 'api_metrics',
      },
      {
        type: 'system',
        subtype: 'compact_boundary',
      },
    ]
    const out = filterForFocusTranscript(msgs)
    expect(out.map(m => m.type + (m.subtype ? `:${m.subtype}` : ''))).toEqual([
      'user',
      'collapsed_read_search',
      'assistant',
      'system:compact_boundary',
    ])
  })

  test('keeps api error assistant messages', () => {
    const msgs: Msg[] = [
      {
        type: 'assistant',
        isApiErrorMessage: true,
        message: { content: [{ type: 'text', text: 'auth fail' }] },
      },
    ]
    expect(filterForFocusTranscript(msgs)).toHaveLength(1)
  })

  test('drops meta user and keeps real user', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        isMeta: true,
        message: { content: [{ type: 'text', text: 'meta' }] },
      },
      {
        type: 'user',
        message: { content: [{ type: 'text', text: 'real' }] },
      },
    ]
    const out = filterForFocusTranscript(msgs)
    expect(out).toHaveLength(1)
    expect(out[0]?.isMeta).toBeUndefined()
  })
})
