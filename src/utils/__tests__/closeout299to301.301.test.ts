import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import type { AppState } from '../../state/AppState.js'
import type { AgentId } from '../../types/ids.js'
import type { Message, NormalizedMessage } from '../../types/message.js'
import {
  detectTurnInterruption,
  hasSiblingEndTurnToolResult,
  populateResumedCompactBoundarySavedIn,
} from '../conversationRecovery.js'
import { restoreSessionStateFromLog } from '../sessionRestore.js'

function makeBaseAppState(): AppState {
  return {
    agentNameRegistry: new Map<string, AgentId>(),
    fileHistory: {
      snapshots: [],
      trackedFiles: new Set(),
      snapshotSequence: 0,
    },
    todos: {},
    endedByModel: false,
  } as unknown as AppState
}

describe('#688 restoreSessionStateFromLog rehydrates agentNameRegistry', () => {
  test('rebuilds agentNameRegistry from resumed Agent tool_use + tool_result', () => {
    let state = makeBaseAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }

    const messages = [
      {
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          id: 'msg_1',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_agent_1',
              name: 'Agent',
              input: { name: 'researcher', prompt: 'find files' },
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        toolUseResult: { status: 'completed', agentId: 'a0123456789abcdef' },
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_agent_1',
              content: 'done',
            },
          ],
        },
      },
    ] as unknown as Message[]

    restoreSessionStateFromLog({ messages }, setAppState)
    expect(state.agentNameRegistry.get('researcher')).toBe(
      'a0123456789abcdef' as AgentId,
    )
  })

  test('skips agentNameRegistry rehydration when forkSession is true', () => {
    let state = makeBaseAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }

    const messages = [
      {
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          id: 'msg_1',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_agent_1',
              name: 'Agent',
              input: { name: 'researcher', prompt: 'find files' },
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        toolUseResult: { status: 'completed', agentId: 'a0123456789abcdef' },
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_agent_1',
              content: 'done',
            },
          ],
        },
      },
    ] as unknown as Message[]

    restoreSessionStateFromLog({ messages }, setAppState, {
      forkSession: true,
    })
    expect(state.agentNameRegistry.size).toBe(0)
  })
})

describe('#692 Nxn / Kut endsTurn checks in detectTurnInterruption', () => {
  const prevTerminalTools = process.env.CLAUDE_CODE_TERMINAL_MCP_TOOLS

  afterEach(() => {
    if (prevTerminalTools === undefined) {
      delete process.env.CLAUDE_CODE_TERMINAL_MCP_TOOLS
    } else {
      process.env.CLAUDE_CODE_TERMINAL_MCP_TOOLS = prevTerminalTools
    }
  })

  test('CLAUDE_CODE_TERMINAL_MCP_TOOLS non-error tool_result ends turn', () => {
    process.env.CLAUDE_CODE_TERMINAL_MCP_TOOLS = 'mcp__custom__finish'
    const messages = [
      {
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          id: 'msg_a1',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'mcp__custom__finish',
              input: {},
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' },
          ],
        },
      },
    ] as unknown as NormalizedMessage[]

    expect(detectTurnInterruption(messages)).toEqual({ kind: 'none' })
  })

  test('CLAUDE_CODE_TERMINAL_MCP_TOOLS error tool_result does not end turn', () => {
    process.env.CLAUDE_CODE_TERMINAL_MCP_TOOLS = 'mcp__custom__finish'
    const messages = [
      {
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          id: 'msg_a1',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'mcp__custom__finish',
              input: {},
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              is_error: true,
              content: 'failed',
            },
          ],
        },
      },
    ] as unknown as NormalizedMessage[]

    expect(detectTurnInterruption(messages)).toEqual({
      kind: 'interrupted_turn',
    })
  })

  test('Kut: sibling tool_result with endTurn in same assistant message.id ends turn', () => {
    const messages = [
      {
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          id: 'msg_parallel',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_end', name: 'mcp__a__end', input: {} },
            { type: 'tool_use', id: 'tu_other', name: 'Read', input: {} },
          ],
        },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        mcpMeta: { _meta: { 'claude/endTurn': true } },
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_end', content: 'done' },
          ],
        },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_other', content: 'data' },
          ],
        },
      },
    ] as unknown as NormalizedMessage[]

    expect(hasSiblingEndTurnToolResult(messages, 2)).toBe(true)
    expect(detectTurnInterruption(messages)).toEqual({ kind: 'none' })
  })

  test('Kut: does not cross assistant message.id boundaries', () => {
    const messages = [
      {
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          id: 'msg_prev',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_end', name: 'mcp__a__end', input: {} },
          ],
        },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        mcpMeta: { _meta: { 'claude/endTurn': true } },
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_end', content: 'done' },
          ],
        },
      },
      {
        type: 'assistant',
        uuid: randomUUID(),
        message: {
          id: 'msg_next',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_other', name: 'Read', input: {} },
          ],
        },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_other', content: 'data' },
          ],
        },
      },
    ] as unknown as NormalizedMessage[]

    expect(hasSiblingEndTurnToolResult(messages, 3)).toBe(false)
    expect(detectTurnInterruption(messages)).toEqual({
      kind: 'interrupted_turn',
    })
  })
})

describe('#870 populateResumedCompactBoundarySavedIn', () => {
  const prevGc = process.env.CLAUDE_CODE_TRANSCRIPT_LOCAL_GC

  afterEach(() => {
    if (prevGc === undefined) {
      delete process.env.CLAUDE_CODE_TRANSCRIPT_LOCAL_GC
    } else {
      process.env.CLAUDE_CODE_TRANSCRIPT_LOCAL_GC = prevGc
    }
  })

  test('populates leadsToSummary=true and savedIn when transcriptPath matches', () => {
    const transcriptPath = '/tmp/session-123.jsonl'
    const messages = [
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: randomUUID(),
        compactMetadata: { trigger: 'auto', preTokens: 10000 },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        isCompactSummary: true,
        message: {
          role: 'user',
          content: `Summary text\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcriptPath}`,
        },
      },
    ] as unknown as Message[]

    populateResumedCompactBoundarySavedIn(messages, transcriptPath)
    const meta = (
      messages[0] as unknown as {
        compactMetadata: { leadsToSummary?: boolean; savedIn?: string }
      }
    ).compactMetadata
    expect(meta.leadsToSummary).toBe(true)
    expect(meta.savedIn).toBe(transcriptPath)
  })

  test('omits savedIn when transcriptPath does not match or GC is enabled', () => {
    const messages = [
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: randomUUID(),
        compactMetadata: { trigger: 'auto', preTokens: 10000 },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        isCompactSummary: true,
        message: {
          role: 'user',
          content:
            'Summary text\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /tmp/other.jsonl',
        },
      },
    ] as unknown as Message[]

    populateResumedCompactBoundarySavedIn(messages, '/tmp/current.jsonl')
    const meta = (
      messages[0] as unknown as {
        compactMetadata: { leadsToSummary?: boolean; savedIn?: string }
      }
    ).compactMetadata
    expect(meta.leadsToSummary).toBe(true)
    expect(meta.savedIn).toBeUndefined()
  })

  test('sets leadsToSummary=false when no compact summary follows boundary', () => {
    const messages = [
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: randomUUID(),
        compactMetadata: { trigger: 'manual', preTokens: 5000 },
      },
      {
        type: 'user',
        uuid: randomUUID(),
        message: { role: 'user', content: 'hello' },
      },
    ] as unknown as Message[]

    populateResumedCompactBoundarySavedIn(messages, '/tmp/current.jsonl')
    const meta = (
      messages[0] as unknown as {
        compactMetadata: { leadsToSummary?: boolean; savedIn?: string }
      }
    ).compactMetadata
    expect(meta.leadsToSummary).toBe(false)
    expect(meta.savedIn).toBeUndefined()
  })
})
