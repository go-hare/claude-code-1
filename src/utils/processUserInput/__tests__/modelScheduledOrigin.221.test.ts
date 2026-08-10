/**
 * densable 2.1.221 — modelScheduledOrigin + skipSlashCommands fire stamp
 * re-opens model-invocable slash commands (e.g. /loop re-entry).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { logMock } from '../../../../tests/mocks/log'
import { debugMock } from '../../../../tests/mocks/debug'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

// Avoid builtInCommandNames → getCommands → login auth during slash path.
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

const prevKey = process.env.ANTHROPIC_API_KEY
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = prevKey || 'test-key-for-modelScheduled'
})
afterAll(() => {
  if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = prevKey
})

import type { Command } from 'src/commands.js'
import { processUserInput } from '../processUserInput.js'

function makeLoopCommand(
  overrides: Partial<Command> & { name?: string } = {},
): Command {
  return {
    type: 'prompt',
    name: overrides.name ?? 'loop',
    description: 'loop skill',
    contentLength: 0,
    progressMessage: 'looping',
    source: 'bundled',
    disableModelInvocation: (overrides as { disableModelInvocation?: boolean })
      .disableModelInvocation,
    async getPromptForCommand(args, context) {
      const opts = (
        context as {
          options?: { modelScheduledOrigin?: boolean }
        }
      ).options
      return [
        {
          type: 'text',
          text: opts?.modelScheduledOrigin
            ? `scheduled:${args}`
            : `user:${args}`,
        },
      ]
    },
    ...overrides,
  } as Command
}

function makeContext(commands: Command[]) {
  return {
    messages: [],
    options: {
      commands,
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
      endedByModel: false,
      ultraplanSessionUrl: undefined,
      ultraplanLaunching: false,
      sessionHooks: new Map(),
    }),
    setAppState: () => {},
    setToolPermissionContext: () => {},
  } as any
}

function userTexts(
  messages: Array<{ type?: string; message?: { content?: unknown } }>,
): string[] {
  return messages.flatMap(m => {
    if (m.type !== 'user') return []
    const c = m.message?.content
    if (typeof c === 'string') return [c]
    if (Array.isArray(c)) {
      return c
        .filter(
          (b): b is { type: 'text'; text: string } =>
            !!b &&
            typeof b === 'object' &&
            (b as { type?: string }).type === 'text',
        )
        .map(b => b.text)
    }
    return []
  })
}

describe('densable modelScheduledOrigin fire stamp', () => {
  test('skipSlash alone treats /loop as plain text', async () => {
    const result = await processUserInput({
      input: '/loop check the deploy',
      mode: 'prompt',
      setToolJSX: () => {},
      context: makeContext([makeLoopCommand()]),
      skipSlashCommands: true,
      isMeta: true,
    })
    const texts = userTexts(result.messages)
    expect(texts.join('\n')).toContain('/loop check the deploy')
    expect(texts.join('\n')).not.toContain('scheduled:')
    expect(texts.join('\n')).not.toContain('user:check')
  })

  test('skipSlash + modelScheduledOrigin re-opens /loop skill', async () => {
    const result = await processUserInput({
      input: '/loop check the deploy',
      mode: 'prompt',
      setToolJSX: () => {},
      context: makeContext([makeLoopCommand()]),
      skipSlashCommands: true,
      modelScheduledOrigin: true,
      wakeupSource: 'schedule_wakeup',
      isMeta: true,
    })
    const texts = userTexts(result.messages)
    expect(texts.some(t => t.includes('scheduled:check the deploy'))).toBe(true)
  })

  test('disableModelInvocation skill stays plain text under modelScheduledOrigin', async () => {
    const locked = makeLoopCommand({
      name: 'secret',
      disableModelInvocation: true,
      async getPromptForCommand() {
        return [{ type: 'text' as const, text: 'should-not-run' }]
      },
    })
    const result = await processUserInput({
      input: '/secret args',
      mode: 'prompt',
      setToolJSX: () => {},
      context: makeContext([locked]),
      skipSlashCommands: true,
      modelScheduledOrigin: true,
      isMeta: true,
    })
    const joined = userTexts(result.messages).join('\n')
    expect(joined).toContain('/secret args')
    expect(joined).not.toContain('should-not-run')
  })

  test('prepared RZn + /loop body still re-opens slash (no value overwrite)', async () => {
    const { SCHEDULED_TASK_DISCLAIMER_PREFIX } = await import(
      '../../scheduledTaskDisclaimer.js'
    )
    const prepared = `${SCHEDULED_TASK_DISCLAIMER_PREFIX}/loop check the deploy`
    const result = await processUserInput({
      input: prepared,
      mode: 'prompt',
      setToolJSX: () => {},
      context: makeContext([makeLoopCommand()]),
      skipSlashCommands: true,
      modelScheduledOrigin: true,
      wakeupSource: 'schedule_wakeup',
      isMeta: true,
    })
    const texts = userTexts(result.messages)
    expect(texts.some(t => t.includes('scheduled:check the deploy'))).toBe(true)
  })
})
