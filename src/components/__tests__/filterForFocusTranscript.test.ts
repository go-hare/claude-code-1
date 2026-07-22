import { describe, expect, test } from 'bun:test'
import { filterForFocusTranscript } from '../Messages.js'
import {
  computeAgentToolStats,
  collapseFocusTranscript,
  type FocusTranscriptMessage,
} from '../../utils/focusTranscript.js'

type Msg = FocusTranscriptMessage

describe('filterForFocusTranscript full collapse', () => {
  test('keeps user prompt, re-collapses tool chrome, keeps assistant text', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'hello' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: {} }],
        },
      },
      {
        type: 'user',
        uuid: 'tr1',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1' }],
        },
      },
      {
        type: 'collapsed_read_search',
        uuid: 'c1',
        searchCount: 1,
        readCount: 0,
        listCount: 0,
        replCount: 0,
        memorySearchCount: 0,
        memoryReadCount: 0,
        memoryWriteCount: 0,
        messages: [],
      },
      {
        type: 'assistant',
        uuid: 'a2',
        message: {
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'system',
        subtype: 'api_metrics',
        uuid: 'm1',
      },
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'cb1',
      },
    ]
    const out = filterForFocusTranscript(msgs)
    // boundary user kept; tools → brief collapsed_read_search; text kept;
    // compact_boundary kept; api_metrics dropped as non-informational system keep?
    // non-info system is kept (only informational+info is hidden).
    // so api_metrics is KEPT. Local prior residual dropped api_metrics as noise —
    // full focus collapse keeps it.
    const types = out.map(m => m.type + (m.subtype ? `:${m.subtype}` : ''))
    expect(types[0]).toBe('user')
    expect(types.some(t => t === 'collapsed_read_search')).toBe(true)
    expect(types).toContain('assistant')
    expect(types).toContain('system:compact_boundary')
  })

  test('keeps api error assistant messages as text', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        isApiErrorMessage: true,
        message: {
          content: [{ type: 'text', text: 'auth fail' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    const out = filterForFocusTranscript(msgs)
    expect(out.some(m => m.type === 'assistant')).toBe(true)
  })

  test('meta user without tool_result is turn boundary', () => {
    // user without tool_result is boundary — meta still boundary.
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        isMeta: true,
        message: { content: [{ type: 'text', text: 'meta' }] },
      },
      {
        type: 'user',
        uuid: 'u2',
        message: { content: [{ type: 'text', text: 'real' }] },
      },
    ]
    const out = filterForFocusTranscript(msgs)
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(
      out.some(m => {
        const c = m.message?.content
        const b = Array.isArray(c) ? c[0] : undefined
        return b?.type === 'text' && b.text === 'real'
      }),
    ).toBe(true)
  })

  test('drops thinking, keeps assistant text', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'q' }] },
      },
      {
        type: 'assistant',
        uuid: 't1',
        message: { content: [{ type: 'thinking', text: '...' }] },
      },
      {
        type: 'assistant',
        uuid: 't2',
        message: { content: [{ type: 'redacted_thinking' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          content: [{ type: 'text', text: 'answer' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    const out = filterForFocusTranscript(msgs)
    const assistants = out.filter(m => m.type === 'assistant')
    expect(assistants).toHaveLength(1)
    const c = assistants[0]?.message?.content
    const b = Array.isArray(c) ? c[0] : undefined
    expect(b?.type).toBe('text')
  })

  test('hidden count: stamps briefHiddenCount on turn_duration (excludes thinking H)', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      {
        type: 'assistant',
        uuid: 'th',
        message: { content: [{ type: 'thinking', text: '...' }] },
      },
      {
        type: 'assistant',
        uuid: 'tu',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: {} }],
        },
      },
      {
        type: 'user',
        uuid: 'tr',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'system',
        subtype: 'turn_duration',
        uuid: 'td',
      },
    ]
    const out = filterForFocusTranscript(msgs)
    const td = out.find(m => m.subtype === 'turn_duration') as
      | { briefHiddenCount?: number }
      | undefined
    // body: thinking(H) + tool_use + tool_result + text + turn_duration
    // kept: text, turn_duration, collapsed group(s) — tool_use+result fold into 1 group
    // H=1 thinking; bodyLen=5; k includes text + td + 1 brief collapse = 3
    // P = 5 - 3 - 1 = 1
    expect(td?.briefHiddenCount).toBeGreaterThanOrEqual(1)
    expect(out.some(m => m.type === 'collapsed_read_search')).toBe(true)
    expect(out.some(m => m.type === 'assistant')).toBe(true)
  })

  test('per-turn briefHiddenCount does not leak across turns', () => {
    // turn1: tool_use + tool_result fold to 1 group + td → bodyLen 3, k=2, P=1
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'a' }] },
      },
      {
        type: 'assistant',
        uuid: 'bash',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 't1', input: {} }],
        },
      },
      {
        type: 'user',
        uuid: 'tr1',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't1' }],
        },
      },
      {
        type: 'system',
        subtype: 'turn_duration',
        uuid: 'td1',
      },
      {
        type: 'user',
        uuid: 'u2',
        message: { content: [{ type: 'text', text: 'b' }] },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        message: {
          content: [{ type: 'text', text: 'only' }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'system',
        subtype: 'turn_duration',
        uuid: 'td2',
      },
    ]
    const out = filterForFocusTranscript(msgs)
    const tds = out.filter(m => m.subtype === 'turn_duration') as Array<{
      briefHiddenCount?: number
    }>
    expect(tds).toHaveLength(2)
    // turn1 has hidden tool chrome (use+result → 1 group); turn2 only text
    expect(tds[0]?.briefHiddenCount).toBeGreaterThanOrEqual(1)
    expect(tds[1]?.briefHiddenCount).toBeUndefined()
  })

  test('briefStandalone keeps last tool_use of name + tool_result', () => {
    const tools = [
      { name: 'SendUserMessage', briefStandalone: true },
      { name: 'Bash', briefStandalone: false },
    ] as any
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      {
        type: 'assistant',
        uuid: 'b1',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'bash1', input: {} }],
        },
      },
      {
        type: 'user',
        uuid: 'br1',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'bash1' }],
        },
      },
      {
        type: 'assistant',
        uuid: 's1',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'SendUserMessage',
              id: 'brief1',
              input: {},
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'sr1',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'brief1' }],
        },
      },
      {
        type: 'assistant',
        uuid: 's2',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'SendUserMessage',
              id: 'brief2',
              input: {},
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'sr2',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'brief2' }],
        },
      },
      {
        type: 'system',
        subtype: 'turn_duration',
        uuid: 'td',
      },
    ]
    const out = filterForFocusTranscript(msgs, { tools })
    const types = out.map(m => {
      if (m.type === 'assistant') {
        const c = m.message?.content
        const b = Array.isArray(c) ? c[0] : undefined
        return `assistant:${b?.name ?? b?.type}`
      }
      if (m.type === 'user') {
        const c = m.message?.content
        const b = Array.isArray(c) ? c[0] : undefined
        if (b?.type === 'tool_result') {
          return `tool_result:${b.tool_use_id}`
        }
      }
      return m.type + (m.subtype ? `:${m.subtype}` : '')
    })
    expect(types).toContain('assistant:SendUserMessage')
    expect(types).toContain('tool_result:brief2')
    expect(types).not.toContain('tool_result:brief1')
    expect(types).not.toContain('assistant:Bash')
    expect(types.some(t => t === 'collapsed_read_search')).toBe(true)
  })

  test('isLoading open tail suppresses briefHiddenCount stamp', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      {
        type: 'assistant',
        uuid: 'tu',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: {} }],
        },
      },
      {
        type: 'system',
        subtype: 'turn_duration',
        uuid: 'td',
      },
    ]
    const out = filterForFocusTranscript(msgs, { isLoading: true })
    const td = out.find(m => m.subtype === 'turn_duration') as
      | { briefHiddenCount?: number }
      | undefined
    expect(td?.briefHiddenCount).toBeUndefined()
  })

  test('keepAllText suppresses briefHiddenCount', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      {
        type: 'assistant',
        uuid: 'tu',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: {} }],
        },
      },
      {
        type: 'system',
        subtype: 'turn_duration',
        uuid: 'td',
      },
    ]
    const out = filterForFocusTranscript(msgs, { keepAllText: true })
    const td = out.find(m => m.subtype === 'turn_duration') as
      | { briefHiddenCount?: number }
      | undefined
    expect(td?.briefHiddenCount).toBeUndefined()
  })

  test('re-collapse folds Edit into editFileCount', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'edit' }] },
      },
      {
        type: 'assistant',
        uuid: 'e1',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              id: 'e1',
              input: { old_string: 'a\nb', new_string: 'a\nb\nc' },
            },
          ],
        },
      },
      {
        type: 'assistant',
        uuid: 'txt',
        message: {
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    const out = filterForFocusTranscript(msgs)
    const group = out.find(m => m.type === 'collapsed_read_search') as
      | { editFileCount?: number; linesAdded?: number }
      | undefined
    expect(group?.editFileCount).toBe(1)
    expect((group?.linesAdded ?? 0) > 0).toBe(true)
  })

  test('pendingText hangs on open streaming tail collapse group', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      {
        type: 'assistant',
        uuid: 'bash',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'b1', input: {} }],
        },
      },
      {
        type: 'assistant',
        uuid: 'stream',
        // no stop_reason → still streaming; isLoading open tail
        message: { content: [{ type: 'text', text: 'partial…' }] },
      },
    ]
    const out = collapseFocusTranscript(msgs, undefined, undefined, true)
    const group = out.find(m => m.type === 'collapsed_read_search') as
      | { pendingText?: string }
      | undefined
    expect(group?.pendingText).toBe('partial…')
  })

  test('agent toolStats fold into collapse via getAgentToolStats', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'run agent' }] },
      },
      {
        type: 'assistant',
        uuid: 'ag',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Agent',
              id: 'ag1',
              input: { description: 'explore codebase', prompt: 'x' },
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'agr',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'ag1' }],
        },
        toolUseResult: {
          status: 'async_launched',
          agentId: 'agent-xyz',
        },
      },
      {
        type: 'assistant',
        uuid: 'txt',
        message: {
          content: [{ type: 'text', text: 'launched' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    const out = collapseFocusTranscript(
      msgs,
      undefined,
      id =>
        id === 'agent-xyz'
          ? {
              readCount: 3,
              searchCount: 1,
              bashCount: 0,
              editFileCount: 0,
              linesAdded: 0,
              linesRemoved: 0,
              otherToolCount: 0,
            }
          : undefined,
      false,
    )
    const group = out.find(m => m.type === 'collapsed_read_search') as
      | {
          agentCount?: number
          readCount?: number
          searchCount?: number
          agentDescriptions?: string[]
        }
      | undefined
    expect(group?.agentCount).toBe(1)
    expect(group?.readCount).toBe(3)
    expect(group?.searchCount).toBe(1)
    expect(group?.agentDescriptions?.[0]).toBe('explore codebase')
  })

  test('computeAgentToolStats counts tools for brief summary', () => {
    const stats = computeAgentToolStats([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', id: '1' },
            { type: 'tool_use', name: 'Grep', id: '2' },
            { type: 'tool_use', name: 'Bash', id: '3' },
            {
              type: 'tool_use',
              name: 'Edit',
              id: '4',
              input: { old_string: 'a', new_string: 'a\nb' },
            },
          ],
        },
      },
    ])
    expect(stats).toEqual({
      readCount: 1,
      searchCount: 1,
      bashCount: 1,
      editFileCount: 1,
      linesAdded: 2,
      linesRemoved: 1,
      otherToolCount: 0,
    })
  })

  test('leading bash task-notification folds into bashCount', () => {
    const notif = (summary: string, uuid: string): Msg => ({
      type: 'user',
      uuid,
      origin: { kind: 'task-notification' },
      message: {
        content: [
          {
            type: 'text',
            text: `<task-notification><status>completed</status><summary>${summary}</summary></task-notification>`,
          },
        ],
      },
    })
    const msgs: Msg[] = [
      notif('Background command "sleep" completed', 'n1'),
      {
        type: 'assistant',
        uuid: 'tu',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'b1', input: {} }],
        },
      },
      {
        type: 'user',
        uuid: 'tr',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'b1' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'txt',
        message: {
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    const out = collapseFocusTranscript(msgs, undefined, undefined, false)
    // boundary notification absorbed — not raw in output
    expect(
      out.some(m => {
        if (m.type !== 'user') return false
        const c = m.message?.content
        const b = Array.isArray(c) ? c[0] : undefined
        return (
          b?.type === 'text' &&
          typeof b.text === 'string' &&
          b.text.includes('task-notification')
        )
      }),
    ).toBe(false)
    const group = out.find(m => m.type === 'collapsed_read_search') as
      | { bashCount?: number; otherToolCount?: number }
      | undefined
    expect(group?.bashCount).toBeGreaterThanOrEqual(1)
    expect(out.some(m => m.type === 'assistant')).toBe(true)
  })

  test('leading agent task-notification folds into agentCount', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'n1',
        origin: { kind: 'task-notification' },
        message: {
          content: [
            {
              type: 'text',
              text: `<task-notification><status>completed</status><summary>Agent "explore" finished</summary></task-notification>`,
            },
          ],
        },
      },
      {
        type: 'assistant',
        uuid: 'txt',
        message: {
          content: [{ type: 'text', text: 'next' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    const out = collapseFocusTranscript(msgs, undefined, undefined, false)
    const group = out.find(m => m.type === 'collapsed_read_search') as
      | { agentCount?: number }
      | undefined
    expect(group?.agentCount).toBe(1)
    expect(out.some(m => m.type === 'assistant')).toBe(true)
  })

  test('multi bash summary "N background commands completed" counts N', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'n1',
        origin: { kind: 'task-notification' },
        message: {
          content: [
            {
              type: 'text',
              text: `<task-notification><status>completed</status><summary>3 background commands completed</summary></task-notification>`,
            },
          ],
        },
      },
      {
        type: 'assistant',
        uuid: 'txt',
        message: {
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    const out = collapseFocusTranscript(msgs, undefined, undefined, false)
    const group = out.find(m => m.type === 'collapsed_read_search') as
      | { bashCount?: number }
      | undefined
    expect(group?.bashCount).toBe(3)
  })

  test('real user prompt is not absorbed as notification', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'u1',
        message: { content: [{ type: 'text', text: 'hello' }] },
      },
      {
        type: 'assistant',
        uuid: 'txt',
        message: {
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    const out = collapseFocusTranscript(msgs, undefined, undefined, false)
    expect(out[0]?.type).toBe('user')
    const c = out[0]?.message?.content
    const b = Array.isArray(c) ? c[0] : undefined
    expect(b?.type === 'text' && b.text === 'hello').toBe(true)
  })

  test('keepAllText skips notification absorb', () => {
    const msgs: Msg[] = [
      {
        type: 'user',
        uuid: 'n1',
        origin: { kind: 'task-notification' },
        message: {
          content: [
            {
              type: 'text',
              text: `<task-notification><status>completed</status><summary>Background command "x" completed</summary></task-notification>`,
            },
          ],
        },
      },
      {
        type: 'assistant',
        uuid: 'txt',
        message: {
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
        },
      },
    ]
    const out = collapseFocusTranscript(msgs, undefined, undefined, false, {
      keepAllText: true,
    })
    // boundary pushed raw
    expect(out[0]?.type).toBe('user')
    expect(
      out.some(
        m =>
          m.type === 'collapsed_read_search' &&
          (m as { bashCount?: number }).bashCount,
      ),
    ).toBe(false)
  })
})
