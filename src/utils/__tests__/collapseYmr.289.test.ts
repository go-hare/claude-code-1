/**
 * densable 2.1.289 yMr arms that the 234 walker did not have:
 * transcriptV2, expandRows, Wcn resume, swr/rwr, non-minted MCP,
 * gwr, account_memory_recall + bwr, kwr.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import type { Tools } from '../../Tool.js'
import type { RenderableMessage } from '../../types/message.js'
import {
  collapseReadSearchGroups,
  getSearchExtraToolsOrReadInfo,
  LeftoverCollapseCache,
} from '../collapseReadSearch.js'
import {
  getScratchpadDir,
  isScratchpadEnabled,
} from '../permissions/filesystem.js'

const ORIG_NO_FLICKER = process.env.CLAUDE_CODE_NO_FLICKER

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

function toolUse(
  id: string,
  name: string,
  input: unknown,
  uuidSuffix: string,
): RenderableMessage {
  return {
    type: 'assistant',
    uuid: `00000000-0000-4000-8000-0000000000${uuidSuffix}`,
    timestamp: '2026-09-05T01:12:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }],
    },
  } as unknown as RenderableMessage
}

function toolResult(toolUseId: string, uuidSuffix: string): RenderableMessage {
  return {
    type: 'user',
    uuid: `00000000-0000-4000-8000-0000000001${uuidSuffix}`,
    timestamp: '2026-09-05T01:12:01.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'ok',
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

describe('densable 2.1.289 yMr remaining arms', () => {
  test('transcriptV2 returns the same array and clears the cache', () => {
    const cache = new LeftoverCollapseCache()
    const messages = [
      toolUse('b1', BASH_TOOL_NAME, { command: 'echo one' }, '01'),
      toolResult('b1', '01'),
    ]
    const skipped = collapseReadSearchGroups(messages, bashStubTools, {
      transcriptV2: true,
      cache,
    })
    expect(skipped).toBe(messages)
    const again = collapseReadSearchGroups(messages, bashStubTools, { cache })
    expect(again.some(m => m.type === 'collapsed_read_search')).toBe(true)
  })

  test('expandRows keeps tools and dedupes hook_permission_decision', () => {
    const hook = (id: string): RenderableMessage =>
      ({
        type: 'attachment',
        uuid: `00000000-0000-4000-8000-0000000000${id}`,
        attachment: {
          type: 'hook_permission_decision',
          decision: 'allow',
          hookEvent: 'PreToolUse',
        },
      }) as unknown as RenderableMessage
    const out = collapseReadSearchGroups(
      [
        toolUse('b1', BASH_TOOL_NAME, { command: 'echo one' }, '11'),
        hook('12'),
        hook('13'),
        {
          type: 'assistant',
          uuid: '00000000-0000-4000-8000-000000000014',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
          },
        } as unknown as RenderableMessage,
      ],
      bashStubTools,
      { expandRows: true },
    )
    expect(out.some(m => m.type === 'collapsed_read_search')).toBe(false)
    const hooks = out.filter(
      m =>
        m.type === 'attachment' &&
        m.attachment.type === 'hook_permission_decision',
    )
    expect(hooks).toHaveLength(1)
    expect(out.at(-1)?.type).toBe('assistant')
  })

  test('workshop write stays inside the bash group', () => {
    const out = collapseReadSearchGroups(
      [
        toolUse('b1', BASH_TOOL_NAME, { command: 'echo one' }, '21'),
        toolResult('b1', '21'),
        toolUse(
          'w1',
          FILE_WRITE_TOOL_NAME,
          {
            file_path: '/tmp/yMr-align.workshop.md',
            content: 'a\nb',
          },
          '22',
        ),
        toolUse('b2', BASH_TOOL_NAME, { command: 'echo two' }, '23'),
        toolResult('b2', '23'),
      ],
      bashStubTools,
    )
    expect(out.map(m => m.type)).toEqual(['collapsed_read_search'])
    const group = out[0] as {
      bashCount?: number
      workshopWriteCount?: number
      workshopLinesAdded?: number
    }
    expect(group.bashCount).toBe(2)
    expect(group.workshopWriteCount).toBe(1)
    expect(group.workshopLinesAdded).toBe(2)
  })

  test('a .git workshop path is not a workshop write', () => {
    const info = getSearchExtraToolsOrReadInfo(
      FILE_WRITE_TOOL_NAME,
      { file_path: '/tmp/.git/secret.workshop.md', content: 'x' },
      [],
    )
    expect(info.isWorkshopWrite).toBeUndefined()
    expect(info.isCollapsible).toBe(false)
  })

  test('scratchpad display path follows isScratchpadFile and the deny list', () => {
    const inside = `${getScratchpadDir()}/note.md`
    const denied = `${getScratchpadDir()}/.bashrc`
    const insideInfo = getSearchExtraToolsOrReadInfo(
      FILE_WRITE_TOOL_NAME,
      { file_path: inside, content: 'hi' },
      [],
    )
    const deniedInfo = getSearchExtraToolsOrReadInfo(
      FILE_WRITE_TOOL_NAME,
      { file_path: denied, content: 'hi' },
      [],
    )
    if (isScratchpadEnabled()) {
      expect(insideInfo.isScratchpadWrite).toBe(true)
      expect(deniedInfo.isScratchpadWrite).toBeUndefined()
    } else {
      expect(insideInfo.isCollapsible).toBe(false)
      expect(deniedInfo.isCollapsible).toBe(false)
    }
  })

  test('non-minted MCP is collapsible even without search/read', () => {
    const tools = [
      {
        name: 'mcp__slack__post',
        isMcp: true,
        mcpInfo: { serverName: 'slack', toolName: 'post' },
      },
    ] as unknown as Tools
    const info = getSearchExtraToolsOrReadInfo('mcp__slack__post', {}, tools)
    expect(info.isCollapsible).toBe(true)
    expect(info.mcpServerName).toBe('slack')
    const out = collapseReadSearchGroups(
      [toolUse('m1', 'mcp__slack__post', { query: 'hi' }, '31')],
      tools,
    )
    const group = out[0] as { mcpCallCount?: number; mcpServerNames?: string[] }
    expect(group.mcpCallCount).toBe(1)
    expect(group.mcpServerNames).toEqual(['slack'])
  })

  test('bashEditDiff ejects the bash and decrements its count', () => {
    const diffResult = {
      ...toolResult('b1', '41'),
      toolUseResult: { bashEditDiff: { files: ['a.ts'], moreFiles: 0 } },
    } as RenderableMessage
    const out = collapseReadSearchGroups(
      [
        toolUse('b1', BASH_TOOL_NAME, { command: 'echo one' }, '41'),
        diffResult,
        toolUse('b2', BASH_TOOL_NAME, { command: 'echo two' }, '42'),
        toolResult('b2', '42'),
      ],
      bashStubTools,
    )
    expect(out.map(m => m.type)).toEqual([
      'assistant',
      'user',
      'collapsed_read_search',
    ])
    const group = out[2] as { bashCount?: number }
    expect(group.bashCount).toBe(1)
  })

  test('skipped bashEditDiff stays in the group', () => {
    const diffResult = {
      ...toolResult('b1', '51'),
      toolUseResult: { bashEditDiff: { skipped: true } },
    } as RenderableMessage
    const out = collapseReadSearchGroups(
      [
        toolUse('b1', BASH_TOOL_NAME, { command: 'echo one' }, '51'),
        diffResult,
        toolUse('b2', BASH_TOOL_NAME, { command: 'echo two' }, '52'),
        toolResult('b2', '52'),
      ],
      bashStubTools,
    )
    expect(out.map(m => m.type)).toEqual(['collapsed_read_search'])
    expect((out[0] as { bashCount?: number }).bashCount).toBe(2)
  })

  test('account_memory_recall inside an open group is absorbed', () => {
    const recall = {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-000000000061',
      attachment: {
        type: 'account_memory_recall',
        files: [{ path: 'notes/a.md' }],
        content: 'remember',
      },
    } as unknown as RenderableMessage
    const out = collapseReadSearchGroups(
      [
        toolUse('b1', BASH_TOOL_NAME, { command: 'echo one' }, '61'),
        toolResult('b1', '61'),
        recall,
      ],
      bashStubTools,
    )
    expect(out.map(m => m.type)).toEqual(['collapsed_read_search'])
    const group = out[0] as {
      accountMemoryReadKeys?: string[]
      accountMemoryRecalls?: { paths: string[]; content: unknown }[]
    }
    expect(group.accountMemoryReadKeys).toEqual(['/notes/a.md'])
    expect(group.accountMemoryRecalls?.[0]?.content).toBe('remember')
  })

  test('bwr stashes leading memories onto the following recall', () => {
    const memories = {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-000000000071',
      attachment: {
        type: 'relevant_memories',
        memories: [{ path: 'm.md', content: 'fact', mtimeMs: 1 }],
      },
    } as unknown as RenderableMessage
    const cowork = {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-000000000072',
      attachment: { type: 'cowork_memory_context' },
    } as unknown as RenderableMessage
    const recall = {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-000000000073',
      attachment: {
        type: 'account_memory_recall',
        files: [{ path: 'a.md' }],
        content: 'body',
      },
    } as unknown as RenderableMessage
    const out = collapseReadSearchGroups(
      [memories, cowork, recall],
      bashStubTools,
    )
    expect(out.map(m => m.type)).toEqual(['attachment', 'attachment'])
    expect((out[0] as { attachment: { type?: string } }).attachment.type).toBe(
      'cowork_memory_context',
    )
    const attachment = (out[1] as { attachment: { localRecall?: unknown } })
      .attachment
    expect(attachment.localRecall).toEqual([
      { path: 'm.md', content: 'fact', mtimeMs: 1 },
    ])
  })

  test('teammate_mailbox with text flushes; shutdown_approved stays deferred', () => {
    const mailbox = (text: string, id: string): RenderableMessage =>
      ({
        type: 'attachment',
        uuid: `00000000-0000-4000-8000-0000000000${id}`,
        attachment: {
          type: 'teammate_mailbox',
          messages: [{ from: 'a', text, timestamp: 't' }],
        },
      }) as unknown as RenderableMessage
    const visible = collapseReadSearchGroups(
      [
        toolUse('b1', BASH_TOOL_NAME, { command: 'echo one' }, '81'),
        toolResult('b1', '81'),
        mailbox('hello', '82'),
        toolUse('b2', BASH_TOOL_NAME, { command: 'echo two' }, '83'),
        toolResult('b2', '83'),
      ],
      bashStubTools,
    )
    expect(visible.map(m => m.type)).toEqual([
      'collapsed_read_search',
      'attachment',
      'collapsed_read_search',
    ])
    const shutdown = JSON.stringify({
      type: 'shutdown_approved',
      requestId: '1',
      from: 'a',
      timestamp: 't',
    })
    const hidden = collapseReadSearchGroups(
      [
        toolUse('b1', BASH_TOOL_NAME, { command: 'echo one' }, '84'),
        toolResult('b1', '84'),
        mailbox(shutdown, '85'),
        toolUse('b2', BASH_TOOL_NAME, { command: 'echo two' }, '86'),
        toolResult('b2', '86'),
      ],
      bashStubTools,
    )
    expect(hidden.map(m => m.type)).toEqual([
      'collapsed_read_search',
      'attachment',
    ])
    expect((hidden[0] as { bashCount?: number }).bashCount).toBe(2)
  })

  test('Wcn resume matches a single full walk', () => {
    const cache = new LeftoverCollapseCache()
    const first = [
      toolUse('b1', BASH_TOOL_NAME, { command: 'echo one' }, '91'),
      toolResult('b1', '91'),
    ]
    const extra = toolUse('b2', BASH_TOOL_NAME, { command: 'echo two' }, '92')
    collapseReadSearchGroups(first, bashStubTools, { cache })
    const resumed = collapseReadSearchGroups([...first, extra], bashStubTools, {
      cache,
    })
    const fresh = collapseReadSearchGroups([...first, extra], bashStubTools)
    expect(resumed.map(m => m.type)).toEqual(fresh.map(m => m.type))
    expect((resumed[0] as { bashCount?: number }).bashCount).toBe(
      (fresh[0] as { bashCount?: number }).bashCount,
    )
  })
})
