/**
 * densable 2.1.251 #2 — Ce/bEn/idt/j8t/jUe/san/K/rbe/tX.
 * Tool frames with parent_tool_use_id are written. System
 * thinking_tokens and non-requesting status go through jUe.
 * task_progress stays a status payload. "foreground subagent"
 * is not part of these functions. v6/St/IN/MLe full nested
 * callees are not in gold.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SDKMessage } from '../../entrypoints/agentSdkTypes.js'
import type { Message } from '../../types/message.js'
import {
  bridgeSdkSessionId,
  eG,
  expandAgentProgressSdkFrames,
  forwardParentToolUseSdkFrame,
  IN,
  isBridgeSdkSynthetic,
  isSubagentToolFrame,
  jd,
  MLe,
  scrubBridgeStatusSdkFrame,
  shouldForwardBridgeStatus,
  shouldForwardSubagentSdkFrame,
} from '../subagentSdkFrames.js'

const framesSrc = readFileSync(
  join(import.meta.dir, '../subagentSdkFrames.ts'),
  'utf8',
)
const runAgentSrc = readFileSync(
  join(
    import.meta.dir,
    '../../../packages/builtin-tools/src/tools/AgentTool/runAgent.ts',
  ),
  'utf8',
)

describe('densable 2.1.251 #2 subagent SDK frames', () => {
  test('bEn is the first tool_use or tool_result block', () => {
    expect(
      isSubagentToolFrame({
        type: 'assistant',
        message: { content: [{ type: 'tool_use' }, { type: 'text' }] },
      }),
    ).toBe(true)
    expect(
      isSubagentToolFrame({
        type: 'user',
        message: { content: [{ type: 'tool_result' }] },
      }),
    ).toBe(true)
    expect(
      isSubagentToolFrame({
        type: 'assistant',
        message: { content: [{ type: 'text' }, { type: 'tool_use' }] },
      }),
    ).toBe(false)
  })

  test('idt forwards tool frames even when text forwarding is off', () => {
    const flags = { enabled: true, forwardText: false }
    const tool = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use' }] },
    }
    const text = {
      type: 'assistant',
      message: { content: [{ type: 'text' }] },
    }
    expect(shouldForwardSubagentSdkFrame(flags, tool)).toBe(true)
    expect(shouldForwardSubagentSdkFrame(flags, text)).toBe(false)
    expect(
      shouldForwardSubagentSdkFrame(
        { enabled: false, forwardText: true },
        tool,
      ),
    ).toBe(false)
  })

  test('Ce writes a tool frame that carries parent_tool_use_id', () => {
    const written: SDKMessage[][] = []
    const frame = {
      type: 'assistant',
      parent_tool_use_id: 'parent-1',
      message: { content: [{ type: 'tool_use', id: 'tu' }] },
    }
    forwardParentToolUseSdkFrame(
      { writeSdkMessages: messages => written.push(messages) },
      frame,
    )
    expect(written).toEqual([[frame]])
  })

  test('text frames are not written when forwardText is off', () => {
    const written: SDKMessage[][] = []
    forwardParentToolUseSdkFrame(
      { writeSdkMessages: messages => written.push(messages) },
      {
        type: 'assistant',
        parent_tool_use_id: 'parent-1',
        message: { content: [{ type: 'text', text: 'hello' }] },
      },
    )
    expect(written).toEqual([])
  })

  test('task_progress is not written as a tool frame', () => {
    const written: SDKMessage[][] = []
    forwardParentToolUseSdkFrame(
      { writeSdkMessages: messages => written.push(messages) },
      {
        type: 'system',
        subtype: 'task_progress',
        parent_tool_use_id: 'parent-1',
      },
    )
    expect(written).toEqual([])
  })

  test('j8t skips requesting status', () => {
    expect(shouldForwardBridgeStatus('requesting')).toBe(false)
    expect(shouldForwardBridgeStatus('compacting')).toBe(true)
    expect(shouldForwardBridgeStatus(null)).toBe(true)
  })

  test('jUe drops compact_error on status frames', () => {
    const scrubbed = scrubBridgeStatusSdkFrame({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      compact_error: 'boom',
    })
    expect(scrubbed.compact_error).toBeUndefined()
    expect(scrubbed.subtype).toBe('status')
  })

  test('Ce writes thinking_tokens system frames', () => {
    const written: SDKMessage[][] = []
    const frame = {
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 12,
    }
    forwardParentToolUseSdkFrame(
      { writeSdkMessages: messages => written.push(messages) },
      frame,
    )
    expect(written).toEqual([[frame]])
  })

  test('Ce writes non-requesting status and strips compact_error', () => {
    const written: SDKMessage[][] = []
    forwardParentToolUseSdkFrame(
      { writeSdkMessages: messages => written.push(messages) },
      {
        type: 'system',
        subtype: 'status',
        status: 'compacting',
        compact_error: 'boom',
      },
    )
    expect(written).toEqual([
      [
        {
          type: 'system',
          subtype: 'status',
          status: 'compacting',
          compact_error: undefined,
        },
      ],
    ])
  })

  test('Ce does not write requesting status', () => {
    const written: SDKMessage[][] = []
    forwardParentToolUseSdkFrame(
      { writeSdkMessages: messages => written.push(messages) },
      {
        type: 'system',
        subtype: 'status',
        status: 'requesting',
      },
    )
    expect(written).toEqual([])
  })

  test('a throwing write is swallowed', () => {
    expect(() =>
      forwardParentToolUseSdkFrame(
        {
          writeSdkMessages: () => {
            throw new Error('bridge down')
          },
        },
        {
          type: 'assistant',
          parent_tool_use_id: 'parent-1',
          message: { content: [{ type: 'tool_use' }] },
        },
      ),
    ).not.toThrow()
  })

  test('K returns the live session id string', () => {
    expect(typeof bridgeSdkSessionId()).toBe('string')
    expect(bridgeSdkSessionId().length).toBeGreaterThan(0)
  })

  test('rbe is true when any synthetic flag is set', () => {
    expect(isBridgeSdkSynthetic({ isMeta: true })).toBe(true)
    expect(isBridgeSdkSynthetic({ isVisibleInTranscriptOnly: true })).toBe(true)
    expect(isBridgeSdkSynthetic({ isCompactSummary: true })).toBe(true)
    expect(isBridgeSdkSynthetic({})).toBeUndefined()
  })

  test('san expands agent_progress with parent_tool_use_id and K session_id', () => {
    const progress = {
      type: 'progress',
      uuid: 'prog-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      parentToolUseID: 'parent-tool-1',
      data: {
        type: 'agent_progress',
        agentType: 'Explore',
        description: 'search',
        message: {
          type: 'assistant',
          uuid: 'asst-1',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tu-1', name: 'Bash', input: {} },
            ],
          },
        },
      },
    } as unknown as Message
    const frames = [...expandAgentProgressSdkFrames(progress)]
    expect(frames).toHaveLength(1)
    const frame = frames[0] as {
      type: string
      parent_tool_use_id: string | null
      session_id: string
      subagent_type?: string
      task_description?: string
      message: { content: { type: string }[] }
    }
    expect(frame.type).toBe('assistant')
    expect(frame.parent_tool_use_id).toBe('parent-tool-1')
    expect(frame.session_id).toBe(bridgeSdkSessionId())
    expect(frame.subagent_type).toBe('Explore')
    expect(frame.task_description).toBe('search')
    expect(frame.message.content[0]?.type).toBe('tool_use')
  })

  test('san expands user tool_result with tool_use_result and rbe', () => {
    const progress = {
      type: 'progress',
      uuid: 'prog-2',
      timestamp: '2026-01-01T00:00:01.000Z',
      parentToolUseID: 'parent-tool-2',
      data: {
        type: 'agent_progress',
        message: {
          type: 'user',
          uuid: 'user-1',
          timestamp: '2026-01-01T00:00:01.000Z',
          isMeta: true,
          toolUseResult: { stdout: 'ok' },
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu-1',
                content: 'ok',
              },
            ],
          },
        },
      },
    } as unknown as Message
    const frames = [...expandAgentProgressSdkFrames(progress)]
    expect(frames).toHaveLength(1)
    const frame = frames[0] as {
      type: string
      parent_tool_use_id: string | null
      isSynthetic?: boolean
      tool_use_result?: unknown
      message: { content: { type: string }[] }
    }
    expect(frame.type).toBe('user')
    expect(frame.parent_tool_use_id).toBe('parent-tool-2')
    expect(frame.isSynthetic).toBe(true)
    expect(frame.tool_use_result).toEqual({ stdout: 'ok' })
    expect(frame.message.content[0]?.type).toBe('tool_result')
  })

  test('boolean type argument is explicit on both cached flag reads', () => {
    const reads = framesSrc.match(
      /getFeatureValue_CACHED_MAY_BE_STALE<boolean>/g,
    )
    expect(reads?.length).toBe(2)
    // gold: phrase is only in schema.describe prose — never a write fn body
    expect(framesSrc).not.toContain('foreground subagent')
    expect(framesSrc).toContain('function bridgeSdkSessionId')
    expect(framesSrc).toContain('function isBridgeSdkSynthetic')
    expect(framesSrc).toContain('function* expandAgentProgressSdkFrames')
    expect(framesSrc).toContain('function forwardParentToolUseSdkFrame')
  })

  test('nested background writes stay gated by forwardSubagentText', () => {
    expect(runAgentSrc).toContain(
      "(message.data as { type?: string })?.type === 'agent_progress' &&",
    )
    const gate = runAgentSrc.indexOf("type === 'agent_progress' &&")
    expect(runAgentSrc.slice(gate, gate + 120)).toContain('forwardSubagentText')
  })

  test('eG title-cases MCP tool names', () => {
    expect(eG('mcp__server__my_tool')).toBe('My Tool')
    expect(eG('plain_name')).toBe('Plain Name')
  })

  test('jd strips cc-memory tags', () => {
    expect(jd('hello')).toBe('hello')
    // gold replace only removes tags; inner text remains
    expect(jd('x <cc-memory filenames="a">y</cc-memory> z')).toBe('x y z')
  })

  test('MLe strips text and thinking via jd', () => {
    const content = [
      { type: 'text', text: 'a <cc-memory>b</cc-memory>' },
      { type: 'thinking', thinking: '<cc-memory>t</cc-memory>' },
      { type: 'tool_use', id: '1', name: 'x' },
    ]
    const out = MLe(content as any)
    expect(out[0]).toEqual({ type: 'text', text: 'a b' })
    expect(out[1]).toEqual({ type: 'thinking', thinking: 't' })
    expect(out[2]).toBe(content[2])
  })

  test('IN emits tool_use_meta when display differs', () => {
    const tools = [
      {
        name: 'mcp__s__do_it',
        mcpInfo: {
          serverName: 's',
          toolName: 'do_it',
          title: 'Do It',
          displayName: 'Server S',
        },
      },
    ]
    expect(
      IN([{ type: 'tool_use', id: 'tu1', name: 'mcp__s__do_it' }], tools),
    ).toEqual([
      {
        id: 'tu1',
        display_name: 'Do It',
        server_display_name: 'Server S',
      },
    ])
    // same display as name → omit
    expect(IN([{ type: 'tool_use', id: 'tu2', name: 'Read' }], [])).toEqual([])
  })

  test('san assistant frames carry tool_use_meta and stripped text', () => {
    const progress = {
      type: 'progress',
      uuid: 'p1',
      timestamp: 't',
      parentToolUseID: 'parent',
      data: {
        type: 'agent_progress',
        agentType: 'Explore',
        description: 'd',
        message: {
          type: 'assistant',
          uuid: 'a1',
          timestamp: 't',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'hi <cc-memory>x</cc-memory>' },
              { type: 'tool_use', id: 'tu', name: 'mcp__s__tool_a' },
            ],
          },
        },
      },
    } as any
    const tools = [
      {
        name: 'mcp__s__tool_a',
        mcpInfo: { serverName: 's', toolName: 'tool_a', title: 'Tool A' },
      },
    ]
    const frames = [...expandAgentProgressSdkFrames(progress, tools)]
    // normalizeMessages (vp) may split multi-block assistant into units
    expect(frames.length).toBeGreaterThanOrEqual(1)
    const withMeta = frames.find(
      (f: any) => Array.isArray(f.tool_use_meta) && f.tool_use_meta.length > 0,
    ) as any
    expect(withMeta?.parent_tool_use_id).toBe('parent')
    expect(withMeta?.tool_use_meta).toEqual([
      { id: 'tu', display_name: 'Tool A', server_display_name: 's' },
    ])
    const withText = frames.find((f: any) =>
      f.message?.content?.some?.(
        (c: any) => c.type === 'text' && typeof c.text === 'string',
      ),
    ) as any
    const textBlock = withText?.message?.content?.find(
      (c: any) => c.type === 'text',
    )
    expect(textBlock?.text).toBe('hi x')
  })
})
