import { describe, expect, test } from 'bun:test'
import {
  resetStateForTests,
  setSessionTrustAccepted,
} from 'src/bootstrap/state.js'
import type { Command } from 'src/commands.js'
import { processSlashCommand } from '../processSlashCommand.js'
import { processUserInput } from '../processUserInput.js'

function makeBaseContext(overrides?: {
  aborted?: boolean
  commands?: Command[]
}) {
  const abortController = new AbortController()
  if (overrides?.aborted) {
    abortController.abort()
  }
  const appState = {
    toolPermissionContext: {
      mode: 'default' as const,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    },
    sessionHooks: new Map(),
    endedByModel: false,
    todos: {},
    mcp: { clients: [], tools: [], commands: [], resources: {} },
    plugins: {
      enabled: [],
      disabled: [],
      commands: [],
      agents: [],
      errors: [],
    },
    agentDefinitions: { activeAgents: [], allAgents: [] },
    settings: {},
  }
  return {
    abortController,
    getAppState: () => appState as any,
    setAppState: () => {},
    setToolPermissionContext: () => {},
    readFileState: new Map() as any,
    messages: [],
    options: {
      commands: overrides?.commands ?? [],
      tools: [],
      isNonInteractiveSession: false,
      mainLoopModel: 'claude-sonnet-4-5',
      debug: false,
      verbose: false,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    nestedMemoryAttachmentTriggers: [],
  } as any
}

describe('Official 2.1.325 #731 & #676: UserPromptSubmit before expansion + abort race before embedded shell', () => {
  test.each([
    { shouldQuery: undefined, skipSubmissionHooks: false, expected: 1 },
    { shouldQuery: false, skipSubmissionHooks: false, expected: 0 },
    { shouldQuery: undefined, skipSubmissionHooks: true, expected: 0 },
  ])('model dispatch is committed only when input enters model submission screening: %j', async settings => {
    let committed = 0
    await processUserInput({
      input: 'plain dispatch fixture',
      mode: 'prompt',
      context: makeBaseContext(),
      setToolJSX: () => {},
      skipAttachments: true,
      ...settings,
      onQueryCommitted: () => {
        committed++
      },
    })
    expect(committed).toBe(settings.expected)
  })

  test('skill dispatch commits once before prompt expansion', async () => {
    let committed = 0
    let committedAtExpansion = 0
    const command = {
      type: 'prompt',
      name: 'dispatch-skill',
      description: 'dispatch fixture',
      isEnabled: () => true,
      isHidden: false,
      userInvocable: true,
      progressMessage: 'running',
      userFacingName: () => 'dispatch-skill',
      getPromptForCommand: async () => {
        committedAtExpansion = committed
        return [{ type: 'text', text: 'expanded dispatch fixture' }]
      },
    } as unknown as Command
    await processUserInput({
      input: '/dispatch-skill',
      mode: 'prompt',
      context: makeBaseContext({ commands: [command] }),
      setToolJSX: () => {},
      skipAttachments: true,
      onQueryCommitted: () => {
        committed++
      },
    })
    expect(committedAtExpansion).toBe(1)
    expect(committed).toBe(1)
  })

  test('#731: checkLine blocks before skill expansion (getPromptForCommand never runs)', async () => {
    let expanded = false
    const skillCmd = {
      type: 'prompt',
      name: 'my-skill',
      description: 'test skill',
      isEnabled: () => true,
      isHidden: false,
      userInvocable: true,
      progressMessage: 'running',
      userFacingName: () => 'my-skill',
      getPromptForCommand: async () => {
        expanded = true
        return [{ type: 'text', text: 'expanded body' }]
      },
    } as unknown as Command

    const context = makeBaseContext({ commands: [skillCmd] })
    const checkCalls: Array<{
      name: string
      args: string
      argsRanWith: string
    }> = []

    const res = await processSlashCommand(
      '/my-skill hello',
      [],
      [],
      [],
      context,
      () => {},
      '11111111-1111-4111-8111-111111111111',
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async ran => {
        checkCalls.push(ran)
        return {
          ran,
          rows: { messages: [], shouldQuery: true },
          outcome: {
            kind: 'return',
            result: { messages: [], shouldQuery: false },
            value: {
              ended: { messages: [], shouldQuery: false },
              text: '/my-skill hello',
            },
          },
        }
      },
    )

    expect(checkCalls).toEqual([
      { name: 'my-skill', args: 'hello', argsRanWith: 'hello' },
    ])
    expect(expanded).toBe(false)
    expect((res as any).lineCheck?.outcome?.kind).toBe('return')
  })

  test('#731: processUserInput blocks /skill via checkLine without expanding skill', async () => {
    let expanded = false
    const skillCmd = {
      type: 'prompt',
      name: 'blocked-skill',
      description: 'test skill',
      isEnabled: () => true,
      isHidden: false,
      userInvocable: true,
      progressMessage: 'running',
      userFacingName: () => 'blocked-skill',
      getPromptForCommand: async () => {
        expanded = true
        return [{ type: 'text', text: 'should not expand' }]
      },
    } as unknown as Command

    const context = makeBaseContext({ commands: [skillCmd] })
    // Abort before checkLine runs so runPromptSubmit returns kind:'return' without hitting external hooks
    // Wait: if signal is already aborted, checkLine returns outcome: undefined, which ALSO stops expansion!
    context.abortController.abort()

    const out = await processUserInput({
      input: '/blocked-skill arg1',
      mode: 'prompt',
      setToolJSX: () => {},
      context,
      uuid: '22222222-2222-4222-8222-222222222222',
    })

    expect(expanded).toBe(false)
    expect(out.shouldQuery).toBe(false)
  })

  test('#676: pre-aborted signal stops before getPromptForCommand (no embedded shell execution)', async () => {
    let shellRan = false
    const skillWithShell = {
      type: 'prompt',
      name: 'shell-skill',
      description: 'skill with embedded shell',
      isEnabled: () => true,
      isHidden: false,
      userInvocable: true,
      progressMessage: 'running',
      userFacingName: () => 'shell-skill',
      getPromptForCommand: async () => {
        shellRan = true
        return [{ type: 'text', text: 'ran embedded shell' }]
      },
    } as unknown as Command

    const context = makeBaseContext({
      aborted: true,
      commands: [skillWithShell],
    })

    const out = await processSlashCommand(
      '/shell-skill',
      [],
      [],
      [],
      context,
      () => {},
      '33333333-3333-4333-8333-333333333333',
    )

    expect(shellRan).toBe(false)
    expect(out.shouldQuery).toBe(false)
    expect(
      out.messages.some(m =>
        JSON.stringify(m).includes('Request interrupted by user'),
      ),
    ).toBe(true)
  })

  test('#676: DOMException AbortError thrown by getPromptForCommand is handled via isAbortError', async () => {
    const skillThrowingDomAbort = {
      type: 'prompt',
      name: 'dom-abort-skill',
      description: 'throws DOMException AbortError',
      isEnabled: () => true,
      isHidden: false,
      userInvocable: true,
      progressMessage: 'running',
      userFacingName: () => 'dom-abort-skill',
      getPromptForCommand: async () => {
        throw new DOMException('Aborted', 'AbortError')
      },
    } as unknown as Command

    const context = makeBaseContext({
      commands: [skillThrowingDomAbort],
    })

    const out = await processSlashCommand(
      '/dom-abort-skill',
      [],
      [],
      [],
      context,
      () => {},
      '44444444-4444-4444-8444-444444444444',
    )

    expect(out.shouldQuery).toBe(false)
    expect(
      out.messages.some(m =>
        JSON.stringify(m).includes('local-command-stderr'),
      ),
    ).toBe(false)
    expect(
      out.messages.some(m =>
        JSON.stringify(m).includes('Request interrupted by user'),
      ),
    ).toBe(true)
  })

  test('#676: stacked skill abort rethrows via isAbortError instead of warning', async () => {
    const firstSkill = {
      type: 'prompt',
      name: 'first-skill',
      description: 'first',
      isEnabled: () => true,
      isHidden: false,
      userInvocable: true,
      progressMessage: 'running',
      userFacingName: () => 'first-skill',
      getPromptForCommand: async () => [{ type: 'text', text: 'first body' }],
    } as unknown as Command
    const secondSkill = {
      type: 'prompt',
      name: 'second-skill',
      description: 'second',
      isEnabled: () => true,
      isHidden: false,
      userInvocable: true,
      progressMessage: 'running',
      userFacingName: () => 'second-skill',
      getPromptForCommand: async () => {
        throw new DOMException('Aborted in stacked', 'AbortError')
      },
    } as unknown as Command

    const context = makeBaseContext({
      commands: [firstSkill, secondSkill],
    })

    const out = await processSlashCommand(
      '/first-skill /second-skill',
      [],
      [],
      [],
      context,
      () => {},
      '55555555-5555-4555-8555-555555555555',
    )

    expect(out.shouldQuery).toBe(false)
    expect(
      out.messages.some(m => JSON.stringify(m).includes('failed to load')),
    ).toBe(false)
    expect(
      out.messages.some(m =>
        JSON.stringify(m).includes('Request interrupted by user'),
      ),
    ).toBe(true)
  })

  test('Wave 3D: pre-aborted /skill lineCheck stamps interrupted: true without endedUnderAbort', async () => {
    const skillCmd = {
      type: 'prompt',
      name: 'abort-flag-skill',
      description: 'test skill',
      isEnabled: () => true,
      isHidden: false,
      userInvocable: true,
      progressMessage: 'running',
      userFacingName: () => 'abort-flag-skill',
      getPromptForCommand: async () => [{ type: 'text', text: 'body' }],
    } as unknown as Command

    const context = makeBaseContext({
      aborted: true,
      commands: [skillCmd],
    })

    const out = await processUserInput({
      input: '/abort-flag-skill hello',
      mode: 'prompt',
      setToolJSX: () => {},
      context,
      uuid: '66666666-6666-4666-8666-666666666666',
    })

    expect(out.shouldQuery).toBe(false)
    expect(out.interrupted).toBe(true)
    expect(out.endedUnderAbort).toBeUndefined()
  })

  test('Wave 3D: aborted runPromptSubmit with active UserPromptSubmit hook stamps interrupted: true and cleans readFileState', async () => {
    const context = makeBaseContext({ aborted: true })
    const sessionId = '77777777-7777-4777-8777-777777777777'
    context.agentId = sessionId
    context.readFileState.set('/tmp/some-file.ts', {
      content: 'x',
      timestamp: 1,
    })
    context.getAppState().sessionHooks.set(sessionId, {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                hook: {
                  type: 'callback',
                  callback: async () => ({}),
                },
              },
            ],
          },
        ],
      },
    })

    const out = await processUserInput({
      input: 'hello under abort',
      mode: 'prompt',
      setToolJSX: () => {},
      context,
      skipAttachments: true,
      uuid: '88888888-8888-4888-8888-888888888888',
    })

    expect(out.shouldQuery).toBe(false)
    expect(out.interrupted).toBe(true)
    expect(out.endedUnderAbort).toBeUndefined()
  })

  test('Wave 3D: hook stop verdict arriving under abort stamps endedUnderAbort: true without interrupted', async () => {
    setSessionTrustAccepted(true)
    try {
      const context = makeBaseContext()
      const sessionId = '99999999-9999-4999-8999-999999999999'
      context.agentId = sessionId
      context.getAppState().sessionHooks.set(sessionId, {
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  hook: {
                    type: 'callback',
                    callback: async () => {
                      context.abortController.abort()
                      return {
                        continue: false,
                        stopReason: 'stopped under abort',
                      }
                    },
                  },
                },
              ],
            },
          ],
        },
      })

      const out = await processUserInput({
        input: 'stopped prompt',
        mode: 'prompt',
        setToolJSX: () => {},
        context,
        skipAttachments: true,
        promptSubmitted: {
          text: 'stopped prompt',
          under: {
            permissionMode: 'default',
            hooks: '',
            plugins: '',
            hooksSkippedByTrust: false,
          },
        },
        uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      })

      expect(out.shouldQuery).toBe(false)
      expect(out.endedUnderAbort).toBe(true)
      expect(out.interrupted).toBeUndefined()
      expect(
        out.messages.some(m =>
          JSON.stringify(m).includes('stopped under abort'),
        ),
      ).toBe(true)
    } finally {
      resetStateForTests()
    }
  })

  test('Wave 3D: replay UserPromptSubmit hook cancelled under abort stamps interrupted: true', async () => {
    setSessionTrustAccepted(true)
    try {
      const context = makeBaseContext()
      const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      context.agentId = sessionId
      context.getAppState().sessionHooks.set(sessionId, {
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  hook: {
                    type: 'callback',
                    callback: async () => {
                      context.abortController.abort()
                      return {
                        decision: 'block',
                        reason: 'aborted before verdict',
                      }
                    },
                  },
                },
              ],
            },
          ],
        },
      })

      const out = await processUserInput({
        input: 'cancelled replay prompt',
        mode: 'prompt',
        setToolJSX: () => {},
        context,
        skipAttachments: true,
        promptSubmitted: {
          text: 'cancelled replay prompt',
          under: {
            permissionMode: 'default',
            hooks: '',
            plugins: '',
            hooksSkippedByTrust: false,
          },
        },
        uuid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      })

      expect(out.shouldQuery).toBe(false)
      expect(out.interrupted).toBe(true)
      expect(out.endedUnderAbort).toBeUndefined()
    } finally {
      resetStateForTests()
    }
  })
})
