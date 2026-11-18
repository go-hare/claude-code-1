import { describe, expect, mock, test } from 'bun:test'
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
})
