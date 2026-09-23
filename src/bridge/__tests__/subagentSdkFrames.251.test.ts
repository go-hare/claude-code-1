/**
 * densable 2.1.251 #2 — Ce/bEn/idt. Tool frames with parent_tool_use_id
 * are written. task_progress stays a status payload. "foreground subagent"
 * is not part of these functions. j8t/jUe bodies are not in the gold excerpt.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SDKMessage } from '../../entrypoints/agentSdkTypes.js'
import {
  forwardParentToolUseSdkFrame,
  isSubagentToolFrame,
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

  test('boolean type argument is explicit on both cached flag reads', () => {
    const reads = framesSrc.match(
      /getFeatureValue_CACHED_MAY_BE_STALE<boolean>/g,
    )
    expect(reads?.length).toBe(2)
    expect(framesSrc).not.toContain('foreground subagent')
  })

  test('nested background writes stay gated by forwardSubagentText', () => {
    expect(runAgentSrc).toContain(
      "(message.data as { type?: string })?.type === 'agent_progress' &&",
    )
    const gate = runAgentSrc.indexOf("type === 'agent_progress' &&")
    expect(runAgentSrc.slice(gate, gate + 120)).toContain('forwardSubagentText')
  })
})
