/**
 * densable 2.1.246 #54 — maxTurns stop is PARTIAL + SendMessage continue hint.
 * Abort edge locked: query still yields; runAgent skips event+yield when aborted.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { mock, describe, expect, test } from 'bun:test'
import { debugMock } from '../../../../../../tests/mocks/debug'
import {
  MAX_TURNS_PARTIAL_PREFIX,
  ONE_SHOT_BUILTIN_AGENT_TYPES,
} from '../constants.js'
import { SEND_MESSAGE_TOOL_NAME } from '../../SendMessageTool/constants.js'
import { bunBundleMock } from '../../../../../../tests/mocks/bunBundle.js'

import { analyticsMock } from '../../../../../../tests/mocks/analytics.js'
mock.module('bun:bundle', bunBundleMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/services/analytics/index.js', analyticsMock)

const { readMaxTurnsReached, finalizeAgentTool } = await import(
  '../agentToolUtils.js'
)

function usage() {
  return {
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    server_tool_use: null,
    service_tier: null,
    cache_creation: null,
  }
}

function assistantText(text: string) {
  return {
    type: 'assistant' as const,
    uuid: 'a1',
    message: {
      id: 'msg_1',
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }],
      usage: usage(),
    },
  }
}

function assistantToolUseOnly() {
  return {
    type: 'assistant' as const,
    uuid: 'a2',
    message: {
      id: 'msg_2',
      role: 'assistant' as const,
      content: [
        {
          type: 'tool_use' as const,
          id: 't1',
          name: 'Bash',
          input: {},
        },
      ],
      usage: usage(),
    },
  }
}

function maxTurnsAttachment(maxTurns: number) {
  return {
    type: 'attachment' as const,
    uuid: 'att_1',
    attachment: {
      type: 'max_turns_reached' as const,
      maxTurns,
      turnCount: maxTurns + 1,
    },
  }
}

describe('densable 2.1.246 #54 maxTurns partial', () => {
  test('btr reads trailing max_turns_reached', () => {
    expect(
      readMaxTurnsReached([
        assistantText('done so far') as never,
        maxTurnsAttachment(8) as never,
      ]),
    ).toBe(8)
  })

  test('btr stops at a later assistant', () => {
    expect(
      readMaxTurnsReached([
        maxTurnsAttachment(8) as never,
        assistantText('after') as never,
      ]),
    ).toBeUndefined()
  })

  test('finalize prepends PARTIAL banner + SendMessage hint', () => {
    const result = finalizeAgentTool(
      [assistantText('halfway') as never, maxTurnsAttachment(3) as never],
      'agent-1',
      {
        prompt: 'go',
        resolvedAgentModel: 'claude-test',
        isBuiltInAgent: false,
        startTime: Date.now() - 10,
        agentType: 'general-purpose',
        isAsync: false,
      },
      { suppressTelemetry: true },
    )
    const banner = result.content[0]
    expect(banner?.type).toBe('text')
    if (banner?.type !== 'text') return
    expect(banner.text).toContain(`${MAX_TURNS_PARTIAL_PREFIX}3-turn limit`)
    expect(banner.text).toContain('PARTIAL output')
    expect(banner.text).toContain(
      `Send the agent a message (${SEND_MESSAGE_TOOL_NAME}) to let it continue from where it stopped.`,
    )
    expect(result.content[1]).toEqual({ type: 'text', text: 'halfway' })
  })

  test('one-shot Explore/Plan omit the SendMessage continue hint', () => {
    expect(ONE_SHOT_BUILTIN_AGENT_TYPES.has('Explore')).toBe(true)
    const result = finalizeAgentTool(
      [assistantText('notes') as never, maxTurnsAttachment(2) as never],
      'agent-2',
      {
        prompt: 'explore',
        resolvedAgentModel: 'claude-test',
        isBuiltInAgent: true,
        startTime: Date.now() - 10,
        agentType: 'Explore',
        isAsync: false,
      },
      { suppressTelemetry: true },
    )
    const banner = result.content[0]
    expect(banner?.type).toBe('text')
    if (banner?.type !== 'text') return
    expect(banner.text).toContain('PARTIAL output')
    expect(banner.text).not.toContain('Send the agent a message')
  })

  test('finalize prepends PARTIAL banner when the agent has no text', () => {
    const result = finalizeAgentTool(
      [assistantToolUseOnly() as never, maxTurnsAttachment(4) as never],
      'agent-3',
      {
        prompt: 'go',
        resolvedAgentModel: 'claude-test',
        isBuiltInAgent: false,
        startTime: Date.now() - 10,
        agentType: 'general-purpose',
        isAsync: false,
      },
      { suppressTelemetry: true },
    )
    expect(result.content).toHaveLength(1)
    const banner = result.content[0]
    expect(banner?.type).toBe('text')
    if (banner?.type !== 'text') return
    expect(banner.text).toContain(`${MAX_TURNS_PARTIAL_PREFIX}4-turn limit`)
    expect(banner.text).toContain('PARTIAL output')
    expect(banner.text).toContain(
      `Send the agent a message (${SEND_MESSAGE_TOOL_NAME}) to let it continue from where it stopped.`,
    )
  })

  test('source-locks abort skip + query abort_tools yield', () => {
    const runAgent = readFileSync(
      join(import.meta.dir, '../runAgent.ts'),
      'utf8',
    )
    const query = readFileSync(
      join(import.meta.dir, '../../../../../../src/query.ts'),
      'utf8',
    )
    expect(runAgent).toContain('densable 2.1.246 #54 runAgent @214524275')
    expect(runAgent).toContain('if (!agentAbortController.signal.aborted)')
    expect(runAgent).toContain("logEvent('tengu_agent_max_turns_reached'")
    expect(query).toContain('densable 2.1.246 #54 query @214424458')
    expect(query).toContain("type: 'max_turns_reached'")
    expect(query).toContain("return { reason: 'aborted_tools' }")
  })
})
