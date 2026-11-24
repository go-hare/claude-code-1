import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import {
  deserializeMessagesWithInterruptDetection,
  loadConversationForResume,
  SESSION_ENDED_TOOL_RESULT_MESSAGE,
} from '../conversationRecovery.js'
import { createAssistantMessage, createUserMessage } from '../messages.js'
import type { LogOption } from '../../types/logs.js'

const prevShowsCutOff = process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS

afterEach(() => {
  if (prevShowsCutOff === undefined) {
    delete process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS
  } else {
    process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS = prevShowsCutOff
  }
})

describe('Wave 3 recovery & interrupted tool call alignment (#1007, #1166)', () => {
  test('#1166 SESSION_ENDED_TOOL_RESULT_MESSAGE matches official YR copy', () => {
    expect(SESSION_ENDED_TOOL_RESULT_MESSAGE).toBe(
      "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]",
    )
  })

  test('#1166 rewrites interruptedByShutdown tool_result blocks to YR during deserialize (2.1.328 Uqn MCP-only)', () => {
    const assistantMsg = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'mcp__srv__run',
          input: { command: 'ls' },
        },
      ],
    })
    const shutdownResult = createUserMessage({
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: '[Request interrupted by user for tool use]',
          is_error: true,
        },
      ],
      interruptedByShutdown: true,
    })

    const res = deserializeMessagesWithInterruptDetection([
      assistantMsg,
      shutdownResult,
    ])
    const userMsg = res.messages.find(m => m.type === 'user')
    expect(userMsg).toBeDefined()
    if (userMsg?.type === 'user' && Array.isArray(userMsg.message?.content)) {
      const block = userMsg.message.content[0] as {
        type: string
        content?: string
      }
      expect(block.type).toBe('tool_result')
      expect(block.content).toBe(SESSION_ENDED_TOOL_RESULT_MESSAGE)
    }
  })

  test('#1166 CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS=1 synthesizes [Tool call interrupted: ...] for cut-off tool_use', () => {
    process.env.CLAUDE_CODE_RESUME_SHOWS_CUT_OFF_CALLS = '1'
    const userPrompt = createUserMessage({ content: 'run ls' })
    const assistantCutOff = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_cutoff',
          name: 'Bash',
          input: { command: 'ls' },
        },
      ],
    })

    const res = deserializeMessagesWithInterruptDetection([
      userPrompt,
      assistantCutOff,
    ])
    const synthesized = res.messages.find(
      m =>
        m.type === 'user' &&
        Array.isArray(m.message?.content) &&
        m.message.content.some(
          b => b.type === 'tool_result' && b.tool_use_id === 'toolu_cutoff',
        ),
    )
    expect(synthesized).toBeDefined()
    if (
      synthesized?.type === 'user' &&
      Array.isArray(synthesized.message?.content)
    ) {
      const block = synthesized.message.content[0] as {
        type: string
        content?: string
        is_error?: boolean
      }
      expect(block.is_error).toBe(true)
      expect(block.content).toBe(SESSION_ENDED_TOOL_RESULT_MESSAGE)
    }
  })

  test('#1007 loadConversationForResume invokes onSessionResolved when sessionId is resolved', async () => {
    const sid = randomUUID()
    const userMsg = {
      ...createUserMessage({ content: 'hi' }),
      sessionId: sid,
      cwd: '/tmp',
      userType: 'external',
      timestamp: new Date().toISOString(),
      version: '2.1.325',
    }
    const log: LogOption = {
      date: new Date().toISOString(),
      messages: [userMsg],
      fullPath: '/tmp/nonexistent-transcript.jsonl',
      value: 0,
      created: new Date(),
      modified: new Date(),
      firstPrompt: 'hi',
      messageCount: 1,
      isSidechain: false,
    }

    const calls: Array<{ sessionId: string; transcriptPath?: string }> = []
    const result = await loadConversationForResume(log, undefined, {
      replyOnResume: true,
      onSessionResolved: resolved => {
        calls.push(resolved)
      },
    })

    expect(result).not.toBeNull()
    expect(calls).toEqual([
      { sessionId: sid, transcriptPath: '/tmp/nonexistent-transcript.jsonl' },
    ])
  })
})
