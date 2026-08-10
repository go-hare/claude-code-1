/**
 * densable 2.1.214 — endedByModel gate must allow typed /clear (and aliases)
 * so clearConversation can reset the lock. UI: "… (or /clear) to continue."
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../../tests/mocks/log'
import { debugMock } from '../../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

const prevKey = process.env.ANTHROPIC_API_KEY
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = prevKey || 'test-key-for-endedByModel'
})
afterAll(() => {
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = prevKey
})

import {
  isEndedByModelClearEscape,
  processUserInput,
} from '../processUserInput.js'

describe('isEndedByModelClearEscape', () => {
  test('accepts /clear and aliases', () => {
    expect(isEndedByModelClearEscape('/clear')).toBe(true)
    expect(isEndedByModelClearEscape('/clear ')).toBe(true)
    expect(isEndedByModelClearEscape('  /reset')).toBe(true)
    expect(isEndedByModelClearEscape('/new')).toBe(true)
    expect(isEndedByModelClearEscape('/CLEAR')).toBe(true)
  })

  test('rejects other input and other slash commands', () => {
    expect(isEndedByModelClearEscape('hello')).toBe(false)
    expect(isEndedByModelClearEscape('/help')).toBe(false)
    expect(isEndedByModelClearEscape('/fork')).toBe(false)
    expect(isEndedByModelClearEscape(null)).toBe(false)
    expect(isEndedByModelClearEscape(undefined)).toBe(false)
  })
})

describe('processUserInput endedByModel gate', () => {
  function makeContext(endedByModel: boolean) {
    return {
      messages: [],
      options: {
        commands: [
          {
            type: 'local',
            name: 'clear',
            description: 'clear',
            aliases: ['reset', 'new'],
            supportsNonInteractive: false,
            async call() {
              return { type: 'text', value: 'cleared' }
            },
          },
        ],
        debug: false,
        mainLoopModel: 'claude-sonnet-4-5',
        tools: [],
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [] },
      },
      abortController: new AbortController(),
      readFileState: new Map(),
      getAppState: () => ({
        toolPermissionContext: { mode: 'default' },
        endedByModel,
        ultraplanSessionUrl: undefined,
        ultraplanLaunching: false,
        sessionHooks: new Map(),
      }),
      setAppState: () => {},
      setToolPermissionContext: () => {},
    } as any
  }

  test('plain text is refused with session-ended warning', async () => {
    const result = await processUserInput({
      input: 'keep talking',
      mode: 'prompt',
      setToolJSX: () => {},
      context: makeContext(true),
    })
    expect(result.shouldQuery).toBe(false)
    expect(result.resultText).toContain('/clear')
    expect(result.resultText).toContain('ended this conversation')
  })

  test('unrelated slash is still refused (no broad slash allowlist)', async () => {
    const result = await processUserInput({
      input: '/help',
      mode: 'prompt',
      setToolJSX: () => {},
      context: makeContext(true),
    })
    expect(result.shouldQuery).toBe(false)
    expect(result.resultText).toContain('/clear')
  })

  test('/clear escapes the gate (does not return session-ended warning)', async () => {
    const result = await processUserInput({
      input: '/clear',
      mode: 'prompt',
      setToolJSX: () => {},
      context: makeContext(true),
    })
    // Must not short-circuit with the EndConversation warning.
    const joined = [
      result.resultText ?? '',
      ...result.messages.map(m => {
        if (m.type === 'system' && 'content' in m) {
          return String((m as { content?: unknown }).content ?? '')
        }
        if (m.type === 'user' && m.message) {
          const c = m.message.content
          return typeof c === 'string' ? c : JSON.stringify(c)
        }
        return ''
      }),
    ].join('\n')
    expect(joined).not.toContain('ended this conversation')
  })
})
