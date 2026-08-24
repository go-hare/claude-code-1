/**
 * densable 2.1.234 #17 — Qoi silent absorb so interleaved TodoWrite/Task*
 * do not split fullscreen "Ran N bash commands" groups; popsOutOnError (edv)
 * ejects absorb on error tool_result.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { TASK_UPDATE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskUpdateTool/constants.js'
import { TODO_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TodoWriteTool/constants.js'
import type { Tools } from '../../Tool.js'
import type { RenderableMessage } from '../../types/message.js'
import {
  collapseReadSearchGroups,
  getSearchExtraToolsOrReadInfo,
} from '../collapseReadSearch.js'

const ORIG_NO_FLICKER = process.env.CLAUDE_CODE_NO_FLICKER

/** Minimal Bash stub — non-search/read so fullscreen classifies as isBash. */
const bashStubTools = [
  {
    name: BASH_TOOL_NAME,
    isSearchOrReadCommand: () => ({
      isSearch: false,
      isRead: false,
      isList: false,
    }),
  },
] as unknown as Tools

function toolUseMsg(
  id: string,
  name: string,
  input: unknown,
  uuidSuffix: string,
): RenderableMessage {
  return {
    type: 'assistant',
    uuid: `00000000-0000-4000-8000-0000000000${uuidSuffix}`,
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
    },
  } as unknown as RenderableMessage
}

function toolResultMsg(
  toolUseId: string,
  uuidSuffix: string,
  isError = false,
): RenderableMessage {
  return {
    type: 'user',
    uuid: `00000000-0000-4000-8000-0000000001${uuidSuffix}`,
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: isError ? 'failed' : 'ok',
          is_error: isError || undefined,
        },
      ],
    },
  } as unknown as RenderableMessage
}

beforeEach(() => {
  process.env.CLAUDE_CODE_NO_FLICKER = '1'
  delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
  delete process.env.TMUX
  delete process.env.SSH_CONNECTION
  delete process.env.SSH_CLIENT
  delete process.env.SSH_TTY
})

afterEach(() => {
  if (ORIG_NO_FLICKER === undefined) delete process.env.CLAUDE_CODE_NO_FLICKER
  else process.env.CLAUDE_CODE_NO_FLICKER = ORIG_NO_FLICKER
})

describe('densable 2.1.234 #17 Qoi absorb / popsOutOnError', () => {
  test('TodoWrite/TaskUpdate classify as absorbed silently with popsOutOnError', () => {
    for (const name of [TODO_WRITE_TOOL_NAME, TASK_UPDATE_TOOL_NAME]) {
      const info = getSearchExtraToolsOrReadInfo(name, {}, [])
      expect(info.isCollapsible).toBe(true)
      expect(info.isAbsorbedSilently).toBe(true)
      expect(info.popsOutOnError).toBe(true)
      expect(info.isBash).toBeUndefined()
    }
  })

  test('Bash + TodoWrite + Bash collapse to one group with bashCount=2', () => {
    const messages = [
      toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '01'),
      toolResultMsg('b1', '01'),
      toolUseMsg(
        't1',
        TODO_WRITE_TOOL_NAME,
        { todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] },
        '02',
      ),
      toolResultMsg('t1', '02'),
      toolUseMsg('b2', BASH_TOOL_NAME, { command: 'echo two' }, '03'),
      toolResultMsg('b2', '03'),
    ]

    const out = collapseReadSearchGroups(messages, bashStubTools)
    const collapsed = out.filter(m => m.type === 'collapsed_read_search')
    expect(collapsed).toHaveLength(1)
    const group = collapsed[0] as {
      type: 'collapsed_read_search'
      bashCount?: number
    }
    expect(group.bashCount).toBe(2)
    // TodoWrite absorb stays inside group messages (verbose) but no own row
    expect(out.filter(m => m.type === 'assistant')).toHaveLength(0)
  })

  test('error TodoWrite popsOutOnError ejects absorb from group', () => {
    const messages = [
      toolUseMsg('b1', BASH_TOOL_NAME, { command: 'echo one' }, '11'),
      toolResultMsg('b1', '11'),
      toolUseMsg(
        't1',
        TODO_WRITE_TOOL_NAME,
        { todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] },
        '12',
      ),
      toolResultMsg('t1', '12', true),
      toolUseMsg('b2', BASH_TOOL_NAME, { command: 'echo two' }, '13'),
      toolResultMsg('b2', '13'),
    ]

    const out = collapseReadSearchGroups(messages, bashStubTools)
    // densable edv: errored TodoWrite ejects; subsequent bash starts new group
    // → TodoWrite assistant message surfaces outside collapsed groups.
    const assistants = out.filter(m => m.type === 'assistant')
    expect(
      assistants.some(m => {
        const c = (m as { message?: { content?: { name?: string }[] } }).message
          ?.content?.[0]
        return c && (c as { name?: string }).name === TODO_WRITE_TOOL_NAME
      }),
    ).toBe(true)

    const collapsed = out.filter(m => m.type === 'collapsed_read_search') as {
      bashCount?: number
    }[]
    // First bash may flush alone; second bash is its own group — bashCounts sum to 2
    const totalBash = collapsed.reduce((n, g) => n + (g.bashCount ?? 0), 0)
    expect(totalBash).toBe(2)
  })
})
