import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AppState } from '../../state/AppStateStore.js'
import { createMessageDisplayTransform } from '../messageDisplayTransform.js'
import {
  hasClassicFunctionHook,
  hasMatchingFunctionHook,
  loadFunctionHooksModules,
  handleHostOp,
  parseFunctionHookPattern,
  scanFunctionHookSource,
  callPluginInterface,
  getRecordedPresses,
  recordPress,
  holdPress,
  invokePress,
  getLivePressEvent,
  PRESS_ANSWER_MS,
  modelCompleteTokenBudget,
  retireFunctionHooksModule,
  runFunctionHookChain,
  setLoadedFunctionHooksModules,
  setOwnedTable,
  finalizeOwnedTable,
  storeResolvedTables,
  getResolvedAnswer,
  getLastInterfaceCallers,
  getCurrentInterfaceCallers,
  isOwnedTableFinalized,
  getOwnedTable,
  setUiAskHostHandler,
  setUiToastShowHandler,
  setAgentSpawnHandler,
  setCommandRunHandler,
  setFunctionHooksAppStateReader,
  setFunctionHooksTurnReader,
  setTurnAbortHandler,
  setPromptSubmitHandler,
  setSessionCompactHandler,
  setToolCallHandler,
  setFunctionHooksToolUseContext,
  getMountedRasterFrames,
  getPluginDrawingTrees,
  getRegisteredPluginAgentDefinitions,
  listBuiltinFunctionHookPlugins,
  evaluateUiRender,
  releasePresses,
  stopFunctionHooksWorker,
  closePluginPane,
  scrollPluginPane,
  getShownPluginPane,
  ABOVE_PROMPT_REQUEST_ID,
  registerPluginScrollSite,
  updatePluginScrollSite,
  unregisterPluginScrollSite,
  getPluginScrollSite,
  noteDrawnElement,
  logUiScrollSettled,
  commitPluginScrollSite,
  dispatchPersonUiScroll,
  uiRenderMatcherNeverRuns,
  uiRenderTreeCheck,
  uiRenderDrawingPlainCheck,
  uiRenderHoverCheck,
  sessionCompactMessagesCheck,
  dispatchClientMessage,
  dispatchClientFault,
  cancelClientMessage,
  enqueueClientMessage,
  getClientMessagesDispatched,
  getPluginFaultRunsSize,
  getPluginFaultRenderStateSize,
  createPromptEditComposer,
} from '../plugins/functionHooksModules.js'
import * as debug from '../debug.js'
import { executePreToolHooks } from '../hooks.js'
import type { ToolUseContext } from '../../Tool.js'
import { getIsInteractive, setIsInteractive } from '../../bootstrap/state.js'

const hookStoreHome = mkdtempSync(join(tmpdir(), 'fh-store-'))
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
process.env.CLAUDE_CONFIG_DIR = hookStoreHome

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  rmSync(hookStoreHome, { recursive: true, force: true })
})

afterEach(async () => {
  setLoadedFunctionHooksModules([])
  setUiAskHostHandler(undefined)
  setUiToastShowHandler(undefined)
  setAgentSpawnHandler(undefined)
  setCommandRunHandler(undefined)
  setFunctionHooksAppStateReader(undefined)
  setTurnAbortHandler(undefined)
  setPromptSubmitHandler(undefined)
  setSessionCompactHandler(undefined)
  setFunctionHooksTurnReader(undefined)
  setToolCallHandler(undefined)
  setFunctionHooksToolUseContext(undefined)
  await stopFunctionHooksWorker()
})

describe('function-hooks classic pattern', () => {
  test('scan rejects a bad on("…") literal before load', () => {
    const scanned = scanFunctionHookSource(
      `export function register(on) { on("not-an-event", () => {}) }`,
    )
    expect(scanned.ok).toBe(false)
    expect(
      scanFunctionHookSource(
        `export function register(on) { on("classic.MessageDisplay", () => {}) }`,
      ).patterns,
    ).toEqual(['classic.MessageDisplay'])
  })

  test('host http.fetch / process.run / ui.ask', async () => {
    await expect(handleHostOp('ui.ask', ['pick', ['a', 'b']])).rejects.toThrow(
      "takes the AskUserQuestion tool's input",
    )
    await expect(
      handleHostOp('ui.ask', [
        {
          questions: [
            {
              question: 'pick',
              options: [{ label: 'a', description: '' }],
            },
          ],
        },
      ]),
    ).rejects.toThrow("takes the AskUserQuestion tool's input")
    await expect(
      handleHostOp('ui.ask', [
        {
          tool: 'Bash',
          questions: [
            {
              question: 'pick',
              options: [{ label: 'a', description: '' }],
            },
          ],
        },
      ]),
    ).rejects.toThrow("takes the AskUserQuestion tool's input")
    const hostAsk = await handleHostOp('ui.ask', [
      {
        tool: 'AskUserQuestion',
        questions: [
          {
            question: 'pick',
            header: 'Plugin',
            options: [
              { label: 'a', description: '' },
              { label: 'b', description: '' },
            ],
          },
        ],
      },
    ])
    expect(hostAsk).toEqual({ result: { answers: { pick: 'a' } } })
    setUiAskHostHandler(async () => ({ deny: 'the dialog was dismissed' }))
    expect(
      await handleHostOp('ui.ask', [
        {
          tool: 'AskUserQuestion',
          questions: [
            {
              question: 'pick',
              options: [
                { label: 'a', description: '' },
                { label: 'b', description: '' },
              ],
            },
          ],
        },
      ]),
    ).toEqual({ deny: 'the dialog was dismissed' })
    await expect(
      callPluginInterface('demo', { name: 'ui', method: 'ask' }, ['pick']),
    ).rejects.toThrow('no answer (the dialog was dismissed)')
    setUiAskHostHandler(undefined)
    await expect(handleHostOp('model.complete', [{}])).rejects.toThrow(
      'takes { model, prompt }',
    )
    await expect(handleHostOp('mcp.call', [{}])).rejects.toThrow(
      'takes { server, tool, args? }',
    )
    const ran = await handleHostOp('process.run', [
      ['node', '-e', 'process.stdout.write("ok")'],
    ])
    expect((ran as { stdout?: string }).stdout).toBe('ok')
    const ranBag = await handleHostOp('process.run', [
      { argv: ['node', '-e', 'process.stdout.write("bag")'] },
    ])
    expect((ranBag as { stdout?: string }).stdout).toBe('bag')
    const dir = mkdtempSync(join(tmpdir(), 'fn-hooks-fs-'))
    await handleHostOp('fs.write', [join(dir, 'a.txt'), 'hello'])
    expect(await handleHostOp('fs.read', [join(dir, 'a.txt')])).toBe('hello')
    expect(await handleHostOp('fs.list', [dir])).toEqual(['a.txt'])
    const st = (await handleHostOp('fs.stat', [join(dir, 'a.txt')])) as {
      isFile?: boolean
    }
    expect(st.isFile).toBe(true)
  })

  test('cLo is an exact classic.<event> pattern', () => {
    expect(hasClassicFunctionHook('MessageDisplay')).toBe(false)
    setLoadedFunctionHooksModules([
      { name: 'demo', patterns: ['classic.*', 'tool.call'] },
    ])
    expect(hasClassicFunctionHook('MessageDisplay')).toBe(false)
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: ['classic.MessageDisplay'],
        hooks: [{ pattern: 'classic.MessageDisplay', hook: () => undefined }],
      },
    ])
    expect(hasClassicFunctionHook('MessageDisplay')).toBe(true)
  })

  test('rejects a pattern that selects nothing or is not an event', () => {
    expect(parseFunctionHookPattern('!*').ok).toBe(false)
    expect(parseFunctionHookPattern('!!*').ok).toBe(false)
    expect(parseFunctionHookPattern('not-an-event').ok).toBe(false)
    expect(parseFunctionHookPattern('classic.MessageDisplay').ok).toBe(true)
    expect(parseFunctionHookPattern('classic.*').ok).toBe(true)
    expect(parseFunctionHookPattern('vendor.custom').ok).toBe(true)
  })

  test('register(on) records classic.MessageDisplay and skips a bad module', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fn-hooks-'))
    mkdirSync(join(dir, 'hooks'))
    writeFileSync(
      join(dir, 'hooks/register.ts'),
      `export function register(on) {
        on('classic.MessageDisplay', () => {})
        on('tool.call', { tool: 'Bash' }, () => {})
      }\n`,
    )
    const bad = mkdtempSync(join(tmpdir(), 'fn-hooks-bad-'))
    mkdirSync(join(bad, 'hooks'))
    writeFileSync(
      join(bad, 'hooks/register.ts'),
      `export function register(on) { on('nope', () => {}) }\n`,
    )
    const sibling = join(dir, 'hooks/local.ts')
    writeFileSync(sibling, `export const label = 'local'\n`)
    writeFileSync(
      join(dir, 'hooks/register.ts'),
      `import { label } from './local.ts'
      export function register(on) {
        if (label !== 'local') throw new Error('import failed')
        if (typeof process !== 'undefined') throw new Error('host leaked')
        on('classic.MessageDisplay', () => {})
        on('tool.call', { tool: 'Bash' }, () => {})
      }\n`,
    )
    await loadFunctionHooksModules([
      { name: 'bad', path: bad },
      { name: 'demo', path: dir },
    ])
    expect(hasClassicFunctionHook('MessageDisplay')).toBe(true)
  })

  test('a wildcard matches without counting as cLo, and the hook runs', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'wild',
        patterns: ['classic.*'],
        hooks: [
          {
            pattern: 'classic.*',
            hook: async (api, event, next) => {
              const current = (await next()) as { delta: string }
              return {
                ...current,
                delta: current.delta.toUpperCase(),
                plugin: (api.plugin as { name?: string } | undefined)?.name,
              }
            },
          },
        ],
      },
    ])
    expect(hasClassicFunctionHook('MessageDisplay')).toBe(false)
    expect(hasMatchingFunctionHook('MessageDisplay')).toBe(true)
    const value = await runFunctionHookChain(
      'MessageDisplay',
      { delta: 'ab', tool: 'Read' },
      async event => event,
    )
    expect(value).toEqual({ delta: 'AB', tool: 'Read', plugin: 'wild' })
  })

  test('gold Rze: executePreToolHooks runs classic.PreToolUse then QLn', async () => {
    const prevInteractive = getIsInteractive()
    setIsInteractive(false)
    let ran = 0
    setLoadedFunctionHooksModules([
      {
        name: 'pre',
        patterns: ['classic.PreToolUse'],
        hooks: [
          {
            pattern: 'classic.PreToolUse',
            hook: async (_api, event) => {
              ran++
              return { ...event, permissionBehavior: 'allow' }
            },
          },
        ],
      },
    ])
    expect(hasMatchingFunctionHook('PreToolUse')).toBe(true)
    const ctx = {
      getAppState: () =>
        ({ sessionHooks: new Map() }) as unknown as ReturnType<
          ToolUseContext['getAppState']
        >,
      abortController: new AbortController(),
    } as unknown as ToolUseContext
    const yielded: Array<{ permissionBehavior?: string }> = []
    const confined: Array<{ permissionBehavior?: string }> = []
    try {
      for await (const result of executePreToolHooks(
        'Bash',
        'tu_1',
        { command: 'ls' },
        ctx,
      )) {
        yielded.push(result)
      }
      expect(ran).toBe(1)
      expect(yielded.some(r => r.permissionBehavior === 'allow')).toBe(true)

      process.env.CLAUDE_CODE_EVAL_CONFINED = '1'
      ran = 0
      for await (const result of executePreToolHooks(
        'Bash',
        'tu_2',
        { command: 'ls' },
        ctx,
      )) {
        confined.push(result)
      }
      expect(ran).toBe(1)
      expect(confined.some(r => r.permissionBehavior === 'allow')).toBe(false)
    } finally {
      delete process.env.CLAUDE_CODE_EVAL_CONFINED
      setIsInteractive(prevInteractive)
    }
  })

  test('gold tVn: matcher { tool } hits executePreToolHooks payload', async () => {
    const prevInteractive = getIsInteractive()
    setIsInteractive(false)
    let bash = 0
    let read = 0
    setLoadedFunctionHooksModules([
      {
        name: 'pre',
        patterns: ['classic.PreToolUse'],
        hooks: [
          {
            pattern: 'classic.PreToolUse',
            matcher: { tool: 'Bash' },
            hook: async (_api, event) => {
              bash++
              return event
            },
          },
          {
            pattern: 'classic.PreToolUse',
            matcher: { tool: 'Read' },
            hook: async (_api, event) => {
              read++
              return event
            },
          },
        ],
      },
    ])
    const ctx = {
      getAppState: () =>
        ({ sessionHooks: new Map() }) as unknown as ReturnType<
          ToolUseContext['getAppState']
        >,
      abortController: new AbortController(),
    } as unknown as ToolUseContext
    try {
      for await (const _ of executePreToolHooks(
        'Bash',
        'tu_bash',
        { command: 'ls' },
        ctx,
      )) {
        // drain
      }
      expect(bash).toBe(1)
      expect(read).toBe(0)
    } finally {
      setIsInteractive(prevInteractive)
    }
  })

  test('a matcher that misses the event is not called', async () => {
    let calls = 0
    setLoadedFunctionHooksModules([
      {
        name: 'filtered',
        root: '/plugins/filtered',
        patterns: ['classic.MessageDisplay'],
        hooks: [
          {
            pattern: 'classic.MessageDisplay',
            matcher: { tool: 'Bash' },
            hook: async () => {
              calls++
              return { delta: 'no' }
            },
          },
        ],
      },
    ])
    const value = await runFunctionHookChain(
      'MessageDisplay',
      { delta: 'ab', tool: 'Read' },
      async event => event,
    )
    expect(calls).toBe(0)
    expect(value).toEqual({ delta: 'ab', tool: 'Read' })
  })

  test('claude-code and $.state are available inside the module', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fn-hooks-api-'))
    mkdirSync(join(dir, 'hooks'))
    writeFileSync(
      join(dir, 'hooks/register.ts'),
      `import { atom, read, update } from 'claude-code'
      const slot = atom({ plugin: 'demo', key: 'note' }, '')
      export async function register(on) {
        on('classic.MessageDisplay', async ($, event, next) => {
          await update($, slot, () => 'kept')
          const stored = await read($, slot)
          await $.state.set({ plugin: 'demo', key: 'note' }, stored)
          const got = await $.state.get({ plugin: 'demo', key: 'note' })
          if (got?.value !== 'kept') throw new Error('state missing')
          if ($.flag.value('NO_SUCH_FLAG', false) !== false) throw new Error('flag')
          $.ui.log('hello')
          return next()
        })
      }\n`,
    )
    await loadFunctionHooksModules([{ name: 'demo', path: dir }])
    const value = await runFunctionHookChain(
      'MessageDisplay',
      { delta: 'ab' },
      async event => event,
    )
    expect(value).toEqual({ delta: 'ab' })
  })

  test('retire waits out in-flight calls then drops the module', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: ['classic.MessageDisplay'],
        hooks: [
          {
            pattern: 'classic.MessageDisplay',
            hook: async (_api, event, next) => {
              await held
              return next()
            },
          },
        ],
      },
    ])
    const running = runFunctionHookChain(
      'MessageDisplay',
      { delta: 'ab' },
      async event => event,
    )
    const retiring = retireFunctionHooksModule('demo')
    expect(hasMatchingFunctionHook('MessageDisplay')).toBe(true)
    release()
    await running
    await retiring
    expect(hasMatchingFunctionHook('MessageDisplay')).toBe(false)
    expect(hasClassicFunctionHook('MessageDisplay')).toBe(false)
  })

  test('on().catch runs when the hook throws', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: ['classic.MessageDisplay'],
        hooks: [
          {
            pattern: 'classic.MessageDisplay',
            hook: async () => {
              throw new Error('boom')
            },
            catch: async (_api, event) => ({
              ...event,
              delta: 'caught',
            }),
          },
        ],
      },
    ])
    const value = await runFunctionHookChain(
      'MessageDisplay',
      { delta: 'ab' },
      async event => event,
    )
    expect(value).toEqual({ delta: 'caught' })
  })

  test('callInterface uses a built table then the core $', async () => {
    setOwnedTable('demo', {
      greet: { hello: () => 'hi' },
    })
    expect(
      await callPluginInterface('demo', { name: 'greet', method: 'hello' }),
    ).toBe('hi')
    const cwd = await callPluginInterface('demo', {
      name: 'session',
      method: 'cwd',
    })
    expect(typeof cwd).toBe('string')
    await expect(
      callPluginInterface('demo', { name: 'ui', method: 'ask' }, ['']),
    ).rejects.toThrow('takes the question first')
    await expect(
      callPluginInterface('demo', { name: 'ui', method: 'ask' }, [
        'pick',
        ['a', 'b', 'c', 'd', 'e'],
      ]),
    ).rejects.toThrow('takes at most 4 options')
    expect(
      await callPluginInterface('demo', { name: 'ui', method: 'ask' }, [
        'pick',
        ['a', 'b'],
      ]),
    ).toBe('a')
    expect(
      await callPluginInterface('demo', { name: 'ui', method: 'ask' }, [
        'pick',
        { options: ['a'], header: 'PluginNameTooLong' },
      ]),
    ).toBe('a')
    await expect(
      callPluginInterface('demo', { name: 'model', method: 'complete' }, [{}]),
    ).rejects.toThrow('takes { model, prompt }')
    await expect(
      callPluginInterface('demo', { name: 'mcp', method: 'call' }, [
        'nope',
        'tool',
      ]),
    ).rejects.toThrow('no connected MCP tool')
    recordPress('demo', { id: 1 }, { key: 'return' })
    expect(getRecordedPresses().at(-1)).toEqual({
      environmentId: 'demo',
      handle: { id: 1 },
      event: { key: 'return' },
    })
  })

  test('an exact classic.MessageDisplay module replaces the preview', () => {
    const display: Array<string | null> = []
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: ['classic.MessageDisplay'],
        hooks: [{ pattern: 'classic.MessageDisplay', hook: () => undefined }],
      },
    ])
    const transform = createMessageDisplayTransform({
      getAppState: () => ({ sessionHooks: new Map() }) as unknown as AppState,
      onStreamingDisplay: value => display.push(value),
      onStreamingRewrite: () => {},
      onMessageDisplay: () => {},
    })
    transform.begin('msg')
    expect(display).toEqual([''])
  })

  test('$.agent list / register / spawn', async () => {
    await expect(
      callPluginInterface('demo', { name: 'agent', method: 'register' }, [{}]),
    ).rejects.toThrow(
      'takes { name, description, prompt, ... }; name is letters, digits, _ or - (up to 64)',
    )
    await expect(
      handleHostOp('agent.register', [
        { name: 'reviewer', prompt: 'review the diff' },
      ]),
    ).rejects.toThrow('needs a description')
    await expect(
      handleHostOp('agent.register', [
        { name: 'reviewer', description: 'reviews PRs' },
      ]),
    ).rejects.toThrow('prompt is a non-empty string')
    expect(
      await callPluginInterface('demo', { name: 'agent', method: 'register' }, [
        { name: 'reviewer', description: 'reviews PRs', prompt: 'review' },
      ]),
    ).toEqual({ agent: 'demo:reviewer' })
    expect(
      await callPluginInterface('demo', { name: 'agent', method: 'register' }, [
        { name: 'reviewer', description: 'reviews PRs', prompt: 'review' },
      ]),
    ).toEqual({ agent: 'demo:reviewer' })
    const defs = getRegisteredPluginAgentDefinitions()
    expect(defs.some(d => d.agentType === 'demo:reviewer')).toBe(true)
    setFunctionHooksAppStateReader(
      () =>
        ({
          tasks: {
            a1: {
              type: 'local_agent',
              id: 'a1',
              agentId: 'a1',
              agentType: 'general-purpose',
              status: 'running',
              description: 'review',
              parentAgentId: 'main',
              name: 'reviewer',
            },
          },
        }) as unknown as AppState,
    )
    expect(await handleHostOp('agent.list', [{}])).toEqual([
      {
        id: 'a1',
        description: 'review',
        type: 'general-purpose',
        status: 'running',
        parentId: 'main',
        name: 'reviewer',
      },
    ])

    // densable PAt/GTe:
    // - local_agent running+isIdle → waiting (PAt uses isIdle as waiting signal)
    // - teammate running+isIdle (no plan approval) → idle; GTe upgrades idle→waiting
    //   when backgrounded local_bash/monitor_* is attached
    // - completed+non-idle-window keepalive → waiting
    // - teammate awaitingPlanApproval → waiting
    setFunctionHooksAppStateReader(
      () =>
        ({
          tasks: {
            localIdle: {
              type: 'local_agent',
              id: 'localIdle',
              agentId: 'localIdle',
              agentType: 'general-purpose',
              status: 'running',
              isIdle: true,
              description: 'local idle → waiting',
            },
            mateIdle: {
              type: 'in_process_teammate',
              id: 'mateIdle',
              agentId: 'mateIdle',
              agentType: 'general-purpose',
              status: 'running',
              isIdle: true,
              awaitingPlanApproval: false,
              description: 'teammate idle',
              identity: { agentName: 'mate-idle' },
            },
            mateBg: {
              type: 'in_process_teammate',
              id: 'mateBg',
              agentId: 'mateBg',
              agentType: 'general-purpose',
              status: 'running',
              isIdle: true,
              awaitingPlanApproval: false,
              description: 'teammate idle + bg bash',
              identity: { agentName: 'mate-bg' },
            },
            bash1: {
              type: 'local_bash',
              id: 'bash1',
              agentId: 'mateBg',
              status: 'running',
              isBackgrounded: true,
              description: 'bg',
            },
            park1: {
              type: 'local_agent',
              id: 'park1',
              agentId: 'park1',
              agentType: 'general-purpose',
              status: 'completed',
              keepaliveReasons: new Set(['agent:child']),
              description: 'parked',
            },
            idleWindow: {
              type: 'local_agent',
              id: 'idleWindow',
              agentId: 'idleWindow',
              agentType: 'general-purpose',
              status: 'completed',
              keepaliveReasons: new Set(['flag:idle-window']),
              description: 'idle-window only',
            },
            mate1: {
              type: 'in_process_teammate',
              id: 'mate1',
              agentId: 'mate1',
              agentType: 'general-purpose',
              status: 'running',
              awaitingPlanApproval: true,
              description: 'plan wait',
              identity: { agentName: 'mate' },
            },
          },
        }) as unknown as AppState,
    )
    const remapped = (await handleHostOp('agent.list', [{}])) as Array<{
      id: string
      status: string
    }>
    expect(remapped.find(a => a.id === 'localIdle')?.status).toBe('waiting')
    expect(remapped.find(a => a.id === 'mateIdle')?.status).toBe('idle')
    expect(remapped.find(a => a.id === 'mateBg')?.status).toBe('waiting')
    expect(remapped.find(a => a.id === 'park1')?.status).toBe('waiting')
    expect(remapped.find(a => a.id === 'idleWindow')?.status).toBe('idle')
    expect(remapped.find(a => a.id === 'mate1')?.status).toBe('waiting')

    await expect(
      callPluginInterface('demo', { name: 'agent', method: 'spawn' }, [{}]),
    ).rejects.toThrow('takes { prompt, ... } (a non-empty prompt)')
    await expect(handleHostOp('agent.spawn', [{}])).rejects.toThrow(
      "takes the Agent tool's input",
    )
    setAgentSpawnHandler(async input => ({
      result: { agentId: 'spawned-1', resolvedModel: 'haiku' },
      captured: input,
    }))
    expect(
      await callPluginInterface('demo', { name: 'agent', method: 'spawn' }, [
        { prompt: 'look at src', model: 'sonnet' },
      ]),
    ).toEqual({ model: 'haiku', agentId: 'spawned-1' })
    setFunctionHooksAppStateReader(
      () =>
        ({
          tasks: {
            'spawned-1': {
              type: 'local_agent',
              id: 'spawned-1',
              agentId: 'spawned-1',
              agentType: 'general-purpose',
              status: 'running',
              description: 'look at src',
            },
          },
        }) as unknown as AppState,
    )
    expect(await handleHostOp('agent.list', [{}])).toEqual([
      {
        id: 'spawned-1',
        description: 'look at src',
        type: 'general-purpose',
        status: 'running',
        spawnedBy: 'demo',
      },
    ])
    setAgentSpawnHandler(async () => ({
      isError: true,
      text: 'blocked',
    }))
    expect(
      await callPluginInterface('demo', { name: 'agent', method: 'spawn' }, [
        { prompt: 'look at src' },
      ]),
    ).toEqual({ deny: 'blocked' })
    expect(
      await callPluginInterface('demo', { name: 'agent', method: 'register' }, [
        {
          name: 'reviewer-plus',
          description: 'reviews PRs',
          prompt: 'review',
          effort: 'high',
          permissionMode: 'plan',
          memory: 'project',
          isolation: 'worktree',
        },
      ]),
    ).toEqual({ agent: 'demo:reviewer-plus' })
    const leftover = getRegisteredPluginAgentDefinitions().find(
      d => d.agentType === 'demo:reviewer-plus',
    )
    expect(leftover?.effort).toBe('high')
    expect(leftover?.permissionMode).toBe('plan')
    expect(leftover?.memory).toBe('project')
    expect(leftover?.isolation).toBe('worktree')
  })

  test('$.command register reject; run missing; register+run queued string', async () => {
    await expect(
      callPluginInterface('demo', { name: 'command', method: 'register' }, [
        {},
      ]),
    ).rejects.toThrow(
      'takes { name, description, argumentHint?, immediate? }; name is letters, digits, _ or - (up to 64)',
    )
    await expect(
      callPluginInterface('demo', { name: 'command', method: 'register' }, [
        { name: 'ship', description: '' },
      ]),
    ).rejects.toThrow('needs a description (what the menu shows)')
    await expect(
      callPluginInterface('demo', { name: 'command', method: 'run' }, [
        { command: 'ship' },
      ]),
    ).rejects.toThrow('no command named /ship in this session')
    expect(
      await callPluginInterface(
        'demo',
        { name: 'command', method: 'register' },
        [{ name: 'ship', description: 'ship it', argumentHint: '[env]' }],
      ),
    ).toEqual({ command: 'ship' })
    expect(
      await callPluginInterface(
        'demo',
        { name: 'command', method: 'register' },
        [{ name: 'ship', description: 'ship it', argumentHint: '[env]' }],
      ),
    ).toEqual({ command: 'ship' })
    await expect(
      callPluginInterface('other', { name: 'command', method: 'register' }, [
        { name: 'ship', description: 'other ship' },
      ]),
    ).rejects.toThrow('"/ship" refused: the plugin demo registered it already')
    expect(await handleHostOp('command.list', [{}])).toEqual([
      { command: 'ship', description: 'ship it', argumentHint: '[env]' },
    ])
    expect(
      await callPluginInterface('demo', { name: 'command', method: 'run' }, [
        { command: 'ship' },
      ]),
    ).toEqual({ queued: true, value: '/ship' })
    expect(
      await callPluginInterface('demo', { name: 'command', method: 'run' }, [
        { command: 'ship', args: 'prod' },
      ]),
    ).toEqual({ queued: true, value: '/ship prod' })
  })

  test('register name reject', async () => {
    await expect(
      callPluginInterface('demo', { name: 'tool', method: 'register' }, [{}]),
    ).rejects.toThrow(
      'takes { name, description, inputSchema? }; name is letters, digits, _ or - (up to 64)',
    )
    await expect(
      handleHostOp('tool.register', [{ name: 'bad name', description: 'x' }]),
    ).rejects.toThrow('name is letters, digits, _ or - (up to 64)')
  })

  test('call Agent reserved', async () => {
    await expect(
      handleHostOp('tool.call', [{ tool: 'Agent', prompt: 'go' }]),
    ).rejects.toThrow('runs the Agent tool: that is $.agent.spawn')
    await expect(
      callPluginInterface('demo', { name: 'tool', method: 'call' }, [
        { tool: 'AskUserQuestion' },
      ]),
    ).rejects.toThrow('runs the AskUserQuestion tool: that is $.ui.ask')
  })

  test('call missing tool', async () => {
    expect(
      await handleHostOp('tool.call', [{ tool: 'Read', file_path: 'a' }]),
    ).toEqual({
      isError: true,
      text: 'no tool named "Read" in this session',
    })
  })

  test('check missing tool', async () => {
    setFunctionHooksAppStateReader(
      () =>
        ({
          tools: [{ name: 'Bash' }],
        }) as unknown as AppState,
    )
    await expect(
      handleHostOp('tool.check', [{ tool: 'Read', input: {} }]),
    ).rejects.toThrow('no tool named "Read"')
  })

  test('list empty', async () => {
    expect(await handleHostOp('tool.list', [{}])).toEqual([])
    expect(
      await callPluginInterface('demo', { name: 'tool', method: 'list' }),
    ).toEqual([])
  })

  test('turn.abort empty, store set/get, prompt.submit empty reject', async () => {
    await expect(
      callPluginInterface('demo', { name: 'turn', method: 'abort' }, [{}]),
    ).rejects.toThrow(
      '$.turn.abort takes { turnId } (the id turn.start carried)',
    )
    await expect(
      callPluginInterface('demo', { name: 'turn', method: 'abort' }, [
        { turnId: '' },
      ]),
    ).rejects.toThrow(
      '$.turn.abort takes { turnId } (the id turn.start carried)',
    )
    await expect(
      handleHostOp('turn.abort', [{ turnId: 't1' }], 'demo'),
    ).rejects.toThrow('no turn is running (asked for t1)')
    setTurnAbortHandler(async ({ turnId }) => ({ aborted: turnId }))
    expect(
      await callPluginInterface('demo', { name: 'turn', method: 'abort' }, [
        { turnId: 't1' },
      ]),
    ).toEqual({ aborted: 't1' })
    setTurnAbortHandler(undefined)

    await callPluginInterface('demo', { name: 'store', method: 'set' }, [
      'note',
      'kept',
    ])
    expect(
      await callPluginInterface('demo', { name: 'store', method: 'get' }, [
        'note',
      ]),
    ).toBe('kept')
    expect(
      await callPluginInterface('demo', { name: 'store', method: 'get' }, [
        'missing',
      ]),
    ).toBeUndefined()
    expect(
      await callPluginInterface('demo', { name: 'store', method: 'keys' }, []),
    ).toEqual(['note'])
    await callPluginInterface('demo', { name: 'store', method: 'delete' }, [
      'note',
    ])
    expect(
      await callPluginInterface('demo', { name: 'store', method: 'keys' }, []),
    ).toEqual([])

    await expect(
      callPluginInterface('demo', { name: 'prompt', method: 'submit' }, [
        { text: '   ' },
      ]),
    ).rejects.toThrow('$.prompt.submit takes { text } (a non-empty prompt)')
    expect(
      await callPluginInterface('demo', { name: 'prompt', method: 'read' }, []),
    ).toEqual({ text: '' })
    await callPluginInterface('demo', { name: 'prompt', method: 'fill' }, [
      { text: 'draft' },
    ])
    expect(
      await callPluginInterface('demo', { name: 'prompt', method: 'read' }, []),
    ).toEqual({ text: 'draft' })
    expect(
      await callPluginInterface('demo', { name: 'prompt', method: 'submit' }, [
        { text: 'go' },
      ]),
    ).toEqual({ ok: true })
    await expect(
      callPluginInterface('demo', { name: 'prompt', method: 'submit' }, [
        { text: 'go', attachments: [{}] },
      ]),
    ).rejects.toThrow(
      '$.prompt.submit takes text alone; attachments cannot be submitted',
    )
    await expect(
      handleHostOp(
        'prompt.submit',
        [{ text: 'go', attachments: [{}] }],
        'demo',
      ),
    ).rejects.toThrow(
      'prompt.submit: takes text alone; attachments cannot be submitted (host check)',
    )
    // densable Boo: empty → slash → attachments. Slash wins when both are wrong.
    await expect(
      callPluginInterface('demo', { name: 'prompt', method: 'submit' }, [
        { text: '/foo', attachments: [{}] },
      ]),
    ).rejects.toThrow(
      '$.prompt.submit submits a prompt to the model; a text beginning with / would run a command as the user; run one with $.command.run({ command })',
    )
    await expect(
      callPluginInterface('demo', { name: 'prompt', method: 'submit' }, [
        { text: '/foo' },
      ]),
    ).rejects.toThrow('a text beginning with / would run a command as the user')

    const timer = (await callPluginInterface(
      'demo',
      { name: 'clock', method: 'after' },
      [10, () => {}],
    )) as { cancel: () => void }
    expect(typeof timer.cancel).toBe('function')
    timer.cancel()
  })

  test('config / settings / ui / session host ops', async () => {
    await expect(
      callPluginInterface('demo', { name: 'config', method: 'set' }, [{}]),
    ).rejects.toThrow(
      'takes { key, value } (the key as $.config.list names it; the value a boolean, a string, a number or a list of strings)',
    )
    await expect(
      handleHostOp('config.set', [{ key: '', value: true }]),
    ).rejects.toThrow(
      'takes { key, value } (the key as $.config.list names it)',
    )
    expect(
      await callPluginInterface('demo', { name: 'config', method: 'set' }, [
        { key: 'theme', value: 'dark' },
      ]),
    ).toBeUndefined()
    const listed = (await handleHostOp('config.list', [{}])) as string[]
    expect(listed).toContain('theme')
    await expect(
      callPluginInterface('demo', { name: 'settings', method: 'set' }, [
        { source: 'userSettings', key: 'demoKey', value: 'on' },
      ]),
    ).rejects.toThrow('has no method set')
    await expect(
      handleHostOp('settings.read', [{ source: 'nope' }]),
    ).rejects.toThrow(
      'takes { source } naming one of userSettings, projectSettings, localSettings, flagSettings, policySettings',
    )
    await expect(
      callPluginInterface('demo', { name: 'session', method: 'usage' }, [
        { foo: 1 },
      ]),
    ).rejects.toThrow('takes { breakdown, columns } or nothing (not foo)')
    await expect(
      callPluginInterface('demo', { name: 'prompt', method: 'submit' }, [
        { text: '/help' },
      ]),
    ).rejects.toThrow(
      'submits a prompt to the model; a text beginning with / would run a command as the user; run one with $.command.run({ command })',
    )
    await expect(
      callPluginInterface('demo', { name: 'ui', method: 'open' }, [{}]),
    ).rejects.toThrow('id is 1 to 64 of letters, digits, _ or -')
    expect(
      await callPluginInterface('demo', { name: 'ui', method: 'open' }, [
        { id: 'pane_1', title: 'Demo' },
      ]),
    ).toEqual({ isPlaced: true })
    // densable b: open without focus:true does not write focusedId.
    expect(
      await callPluginInterface('demo', { name: 'ui', method: 'panes' }, []),
    ).toEqual([
      {
        id: 'pane_1',
        title: 'Demo',
        isShown: true,
        isFocused: false,
        isPlaced: true,
      },
    ])
    await expect(
      handleHostOp('interface.call', [{ name: 'x', method: 'y' }]),
    ).rejects.toThrow('takes { owner, name, method, args }')
    expect(await handleHostOp('ui.log', [{ text: 'hello' }])).toBeUndefined()
    const shown: Array<{ plugin: string; text: string; timeoutMs?: number }> =
      []
    setUiToastShowHandler(toast => {
      shown.push(toast)
    })
    expect(
      await handleHostOp('ui.toast', [{ text: 'hi' }], 'demo'),
    ).toBeUndefined()
    expect(shown).toEqual([{ plugin: 'demo', text: 'hi' }])
    await expect(
      handleHostOp('ui.toast', [{ text: 'hi', timeoutMs: 0 }], 'demo'),
    ).rejects.toThrow('timeoutMs is a whole number of ms, 1 to 60000')
    expect(await handleHostOp('ui.status', [{}])).toBeUndefined()
    await expect(handleHostOp('ui.notice', [{}])).rejects.toThrow(
      'takes the tool_use_id of an open call',
    )
    expect(
      await handleHostOp('ui.notice', [
        { tool_use_id: 'toolu_1', text: 'note' },
      ]),
    ).toBeUndefined()
    await expect(
      callPluginInterface('demo', { name: 'session', method: 'compact' }, [
        { instructions: 1 },
      ]),
    ).rejects.toThrow('takes { instructions } (a string) or nothing')
    await expect(
      callPluginInterface('demo', { name: 'session', method: 'compact' }, [
        { instructions: 'keep the last turn' },
      ]),
    ).rejects.toThrow(
      '$.session.compact is not available in this mode: no session is bound in this process',
    )
    await expect(
      callPluginInterface('demo', { name: 'session', method: 'send' }, [{}]),
    ).rejects.toThrow('takes { to, text }')
    expect(
      await callPluginInterface('demo', { name: 'session', method: 'send' }, [
        { to: 'peer', text: 'hello' },
      ]),
    ).toEqual({
      isDelivered: false,
      reason:
        'this session has no SendMessage tool (messaging between sessions and agents is not on here)',
    })
    expect(await handleHostOp('plugin.register', [{}])).toEqual({
      allow: true,
    })
  })

  test('audio.play clip check, audio.speak empty, fs.ancestors names', async () => {
    await expect(
      callPluginInterface('demo', { name: 'audio', method: 'play' }, []),
    ).rejects.toThrow('clip must be { asset }, { url } or { base64, mime }')
    await expect(
      callPluginInterface('demo', { name: 'audio', method: 'speak' }, ['']),
    ).rejects.toThrow('text must be a non-empty string')
    await expect(handleHostOp('fs.ancestors', [{}])).rejects.toThrow(
      'takes names, a list of relative .md file names',
    )
    const found = (await handleHostOp('fs.ancestors', [
      { names: ['CLAUDE.md'] },
    ])) as unknown[]
    expect(Array.isArray(found)).toBe(true)
  })

  test('unknown host op throws reading run; worker call.args; press handler', async () => {
    await expect(handleHostOp('settings.set', [{}], 'demo')).rejects.toThrow(
      "Cannot read properties of undefined (reading 'run')",
    )
    await expect(handleHostOp('nope.nope', [{}])).rejects.toThrow(
      "Cannot read properties of undefined (reading 'run')",
    )
    await expect(invokePress('demo', 1, { key: 'a' })).rejects.toThrow(
      'ui.press/ui.input/ui.select: no handler is held under handle',
    )
    expect(getLivePressEvent()).toBeUndefined()
    expect(PRESS_ANSWER_MS).toBe(10_000)
    let seen: unknown
    let liveDuring: ReturnType<typeof getLivePressEvent>
    const pressEvent = { key: 'a' }
    holdPress('demo', 1, event => {
      seen = event
      liveDuring = getLivePressEvent()
    })
    await invokePress('demo', 1, pressEvent)
    // densable cloneIn is identity — same reference reaches the held handler
    expect(seen).toBe(pressEvent)
    // densable fe/ze: answering ALS is live during handler, cleared after
    expect(liveDuring).toBe('ui.press')
    expect(getLivePressEvent()).toBeUndefined()
    let liveInput: ReturnType<typeof getLivePressEvent>
    holdPress('demo', 2, () => {
      liveInput = getLivePressEvent()
    })
    await invokePress('demo', 2, { kind: 'text' })
    expect(liveInput).toBe('ui.input')
    expect(getLivePressEvent()).toBeUndefined()
    let liveSelect: ReturnType<typeof getLivePressEvent>
    holdPress('demo', 3, () => {
      liveSelect = getLivePressEvent()
    })
    await invokePress('demo', 3, { value: 'opt' })
    expect(liveSelect).toBe('ui.select')
    expect(getLivePressEvent()).toBeUndefined()
    expect(
      await callPluginInterface('demo', { name: 'store', method: 'set' }, [
        'k',
        1,
      ]),
    ).toBeUndefined()
    expect(
      await callPluginInterface('demo', { name: 'store', method: 'get' }, [
        'k',
      ]),
    ).toBe(1)
  })

  test('clock.sleep abort → wait aborted; model.complete maxTokens past; mcp.call l_t+refuse', async () => {
    await expect(
      handleHostOp('clock.sleep', [{ ms: -1 }], 'demo'),
    ).rejects.toThrow(
      'takes { ms }, a non-negative number of milliseconds (got -1)',
    )
    // densable SNo: Error reason is kept; only undefined/non-Error → "wait aborted"
    const aborted = new AbortController()
    aborted.abort()
    await expect(
      handleHostOp('clock.sleep', [{ ms: 50, signal: aborted.signal }], 'demo'),
    ).rejects.toThrow() // platform AbortError / "The operation was aborted."
    const withReason = new AbortController()
    withReason.abort(new Error('custom abort'))
    await expect(
      handleHostOp(
        'clock.sleep',
        [{ ms: 50, signal: withReason.signal }],
        'demo',
      ),
    ).rejects.toThrow('custom abort')
    const bare = {
      aborted: true,
      reason: undefined,
      addEventListener() {},
      removeEventListener() {},
    }
    await expect(
      handleHostOp('clock.sleep', [{ ms: 50, signal: bare }], 'demo'),
    ).rejects.toThrow('wait aborted')

    await expect(
      handleHostOp(
        'model.complete',
        [{ model: 'claude-opus-4-6', prompt: 'hi', maxTokens: 999_999 }],
        'demo',
      ),
    ).rejects.toThrow(
      /maxTokens 999999 is past what claude-opus-4-6 can produce in one reply \(\d+\)/,
    )

    // densable BEe Cae/Ee: accepts-disabled list → Ee=0; else → Ee=2048 overhead
    // before capping at upperLimit. Past-throw above stays on raw maxTokens.
    expect(modelCompleteTokenBudget('claude-opus-4-6', 1024, 64_000)).toEqual({
      thinkingOverride: false,
      thinkingOverhead: 0,
      maxOutputTokens: 1024,
    })
    expect(
      modelCompleteTokenBudget('claude-opus-4-6', undefined, 64_000),
    ).toEqual({
      thinkingOverride: false,
      thinkingOverhead: 0,
      maxOutputTokens: 1024,
    })
    expect(modelCompleteTokenBudget('claude-fable-5', 1024, 64_000)).toEqual({
      thinkingOverride: undefined,
      thinkingOverhead: 2048,
      maxOutputTokens: 3072,
    })
    expect(
      modelCompleteTokenBudget('claude-fable-5', undefined, 64_000),
    ).toEqual({
      thinkingOverride: undefined,
      thinkingOverhead: 2048,
      maxOutputTokens: 3072,
    })
    expect(modelCompleteTokenBudget('claude-fable-5', 63_000, 64_000)).toEqual({
      thinkingOverride: undefined,
      thinkingOverhead: 2048,
      maxOutputTokens: 64_000,
    })

    setFunctionHooksAppStateReader(
      () =>
        ({
          mcp: {
            clients: [],
            tools: [
              {
                name: 'mcp__demo_server__ping',
                mcpInfo: { serverName: 'demo-server', toolName: 'ping' },
              },
            ],
            commands: [],
            resources: {},
            resourceTemplates: {},
          },
          tools: [{ name: 'mcp__demo_server__ping' }],
        }) as unknown as AppState,
    )
    setToolCallHandler(async () => ({ deny: 'blocked by policy' }))
    await expect(
      handleHostOp(
        'mcp.call',
        [{ server: 'demo-server', tool: 'ping', args: {} }],
        'demo',
      ),
    ).rejects.toThrow(
      '$.mcp.call(demo-server, ping) refused: blocked by policy',
    )
    setToolCallHandler(async () => ({
      content: [{ type: 'text', text: 'pong' }],
      isError: false,
    }))
    expect(
      await handleHostOp(
        'mcp.call',
        [{ server: 'demo-server', tool: 'ping' }],
        'demo',
      ),
    ).toEqual({
      content: [{ type: 'text', text: 'pong' }],
      isError: false,
    })
    // densable XL shared path: tool.call also maps handler through XL/xxr
    expect(
      await handleHostOp(
        'tool.call',
        [{ tool: 'mcp__demo_server__ping', x: 1 }],
        'demo',
      ),
    ).toEqual({
      result: [{ type: 'text', text: 'pong' }],
      text: 'pong',
    })
    let handlerCalls = 0
    setToolCallHandler(async () => {
      handlerCalls += 1
      return { text: 'from-handler' }
    })
    setFunctionHooksToolUseContext({
      getToolUseContext: () => ({
        options: { tools: [{ name: 'mcp__demo_server__ping' }] },
      }),
      canUseTool: async () => ({ behavior: 'deny', message: 'nope' }),
    })
    // densable XL: bound session tools take $3; a listing-only tool yields
    // gold "produced no result" instead of the handler stand-in.
    await expect(
      handleHostOp('tool.call', [{ tool: 'mcp__demo_server__ping' }], 'demo'),
    ).rejects.toThrow('produced no result')
    expect(handlerCalls).toBe(0)
    setFunctionHooksToolUseContext(undefined)
    setToolCallHandler(async () => ({
      content: [{ type: 'text', text: 'pong' }],
      isError: false,
    }))
    const warnSpy = (...args: unknown[]) => {
      warnMessages.push(args.map(String).join(' '))
    }
    const warnMessages: string[] = []
    const previousWarn = console.warn
    console.warn = warnSpy as typeof console.warn
    try {
      await expect(
        handleHostOp('mcp.call', [{ server: 'missing', tool: 'nope' }], 'demo'),
      ).rejects.toThrow(
        '$.mcp.call: no connected MCP tool "nope" on a server named "missing"',
      )
    } finally {
      console.warn = previousWarn
    }
    // densable a_t: log servers-with-tools BEFORE throw (throw string unchanged)
    expect(warnMessages.join('\n')).toContain(
      '$.mcp.call (demo): no tool "nope" on a server named "missing"; servers with tools: demo_server',
    )
  })

  test('session.messages check; turns counts users; callers; finalize freeze', async () => {
    await expect(
      callPluginInterface('demo', { name: 'session', method: 'messages' }, [
        { foo: 1 },
      ]),
    ).rejects.toThrow('takes { agentId, as } or nothing (not foo)')
    setFunctionHooksAppStateReader(
      () =>
        ({
          messages: [
            { type: 'user', isMeta: true },
            { type: 'user' },
            { type: 'assistant' },
            { type: 'user', isVirtual: true },
          ],
        }) as unknown as AppState,
    )
    expect(await handleHostOp('session.turns', [{}])).toBe(1)
    expect(await handleHostOp('session.messages', [{}])).toHaveLength(4)
    expect(
      await handleHostOp('session.messages', [{ agentId: 'gone' }]),
    ).toEqual({
      deny: 'no conversation of agent gone in this session: not one of its agents, running in another process, or finished with no saved transcript this session reads back',
    })
    setFunctionHooksAppStateReader(
      () =>
        ({
          tools: [
            {
              name: 'Read',
              description: 'fallback',
              prompt: async () => 'Reads a file',
              isMcp: true,
            },
          ],
        }) as unknown as AppState,
    )
    expect(await handleHostOp('tool.list', [{}])).toEqual([
      { name: 'Read', description: 'Reads a file', mcp: true },
    ])
    finalizeOwnedTable(
      'demo',
      {
        custom: {
          ping: async () => 'pong',
        },
      },
      { quiet: 'gate' },
    )
    expect(isOwnedTableFinalized('demo')).toBe(true)
    expect(Object.isFrozen(getOwnedTable('demo'))).toBe(true)
    expect(
      await callPluginInterface(
        'demo',
        { name: 'custom', method: 'ping' },
        [],
        [7, 9],
      ),
    ).toBe('pong')
    expect(getLastInterfaceCallers()).toEqual([7, 9])
    expect(getCurrentInterfaceCallers()).toEqual([7, 9])
    await expect(() =>
      finalizeOwnedTable('demo', { again: { x: async () => 1 } }),
    ).toThrow('$ is already built')
    storeResolvedTables('demo', [
      { surface: 'terminal', component: 'Pane', answer: { ok: true } },
    ])
    expect(getResolvedAnswer('demo', 'terminal', 'Pane')).toEqual({ ok: true })
    await expect(
      callPluginInterface('demo', { name: 'quiet', method: 'run' }, []),
    ).rejects.toThrow('$.quiet.run: removed by plugin `gate`')
    await expect(
      callPluginInterface('demo', { name: 'quiet', method: 'ping' }, []),
    ).rejects.toThrow('$.quiet.ping: removed by plugin `gate`')
  })

  test('model.fork nothing-to-fork; compact running turn; send via SendMessage', async () => {
    expect(
      await handleHostOp('model.fork', [{ prompt: 'continue' }], 'demo'),
    ).toEqual({ isAnswered: false, reason: 'nothing-to-fork' })
    setFunctionHooksTurnReader(() => ({ turnId: 't1' }))
    await expect(
      handleHostOp('session.compact', [{ instructions: '' }], 'demo'),
    ).rejects.toThrow(
      '$.session.compact: a turn is running (t1); the conversation compacts between turns, so call it from turn.complete or later',
    )
    setFunctionHooksTurnReader(undefined)
    setSessionCompactHandler(async () => ({ compacted: true }))
    expect(
      await handleHostOp('session.compact', [{ instructions: 'keep' }], 'demo'),
    ).toEqual({ compacted: true })
    await expect(
      handleHostOp(
        'session.compact',
        [{ instructions: 'keep', messages: [] }],
        'demo',
      ),
    ).rejects.toThrow('an empty messages (a compaction leaves at least one)')
    setFunctionHooksAppStateReader(
      () =>
        ({
          tools: [{ name: 'SendMessage' }],
        }) as unknown as AppState,
    )
    setToolCallHandler(async () => ({ result: { success: true } }))
    expect(
      await handleHostOp(
        'session.send',
        [{ to: 'peer', text: 'hello' }],
        'demo',
      ),
    ).toEqual({ isDelivered: true })
  })

  test('ui.scroll/focus after open+blit; copy OSC-52; AskUserQuestion matcher', async () => {
    expect(await handleHostOp('ui.open', [{ id: 'pane_1' }], 'demo')).toEqual({
      isPlaced: true,
    })
    // densable blit needs a prior Raster/Image mount (ui.resolve walk → ILo/HLo)
    expect(
      await handleHostOp(
        'ui.blit',
        [{ requestId: 'pane_1', key: 'k', cells: 'xx' }],
        'demo',
      ),
    ).toEqual({
      deny: 'no Raster of its own is mounted under key "k" in pane_1',
    })
    await handleHostOp(
      'ui.resolve',
      [
        {
          surface: 'terminal',
          component: 'Pane',
          requestId: 'pane_1',
          children: {
            type: 'Raster',
            key: 'k',
            requestId: 'pane_1',
            columns: 2,
            rows: 1,
          },
        },
      ],
      'demo',
    )
    expect(
      await handleHostOp(
        'ui.blit',
        [{ requestId: 'pane_1', key: 'k', cells: 'xx' }],
        'demo',
      ),
    ).toEqual({
      deny: 'cells must be the base64 of 2 cells of 12 bytes (32 characters for 2x1)',
    })
    expect(
      await handleHostOp(
        'ui.blit',
        [
          {
            requestId: 'pane_1',
            key: 'k',
            cells: 'IAAAAAAAAAEAAAABIAAAAAAAAAEAAAAB',
          },
        ],
        'demo',
      ),
    ).toEqual({})
    expect(
      await handleHostOp(
        'ui.blit',
        [{ requestId: 'pane_1', key: 'k', cells: 'xx', columns: 9, rows: 9 }],
        'demo',
      ),
    ).toEqual({
      deny: 'the mounted Raster is 2x1, not 9x9; a resize is a redraw (ui.invalidate)',
    })
    const frames = getMountedRasterFrames()
    expect(
      frames.some(frame => frame.requestId === 'pane_1' && frame.ansi !== ''),
    ).toBe(true)
    await handleHostOp(
      'ui.resolve',
      [
        {
          surface: 'terminal',
          component: 'Pane',
          requestId: 'pane_1',
          children: {
            type: 'Image',
            key: 'img',
            requestId: 'pane_1',
            columns: 2,
            rows: 1,
          },
        },
      ],
      'demo',
    )
    expect(
      await handleHostOp(
        'ui.blit',
        [{ requestId: 'pane_1', key: 'img', source: { png: 'xx' } }],
        'demo',
      ),
    ).toEqual({
      deny: 'source.png must be standard padded base64',
    })
    expect(
      await handleHostOp(
        'ui.blit',
        [{ requestId: 'pane_1', key: 'img', source: { url: 'https://x' } }],
        'demo',
      ),
    ).toEqual({
      deny: 'source must be { png }, { rgba, width, height }, { file, format } or { shm, format, width, height }',
    })
    expect(
      await handleHostOp('ui.scroll', [{ to: 'start', in: 'pane_1' }], 'demo'),
    ).toEqual({})
    expect(
      await handleHostOp(
        'ui.focus',
        [{ requestId: 'pane_1', key: 'k' }],
        'demo',
      ),
    ).toEqual({})
    expect(await handleHostOp('ui.panes', [{}], 'demo')).toEqual([
      {
        id: 'pane_1',
        title: 'pane_1',
        isShown: true,
        isFocused: true,
        isPlaced: true,
      },
    ])
    expect(
      await handleHostOp(
        'ui.focus',
        [{ requestId: 'pane_1', key: 'missing' }],
        'demo',
      ),
    ).toEqual({ deny: 'no element of its own is drawn under that key' })
    expect(
      await handleHostOp('ui.copy', [{ text: 'hi', surface: 'terminal' }]),
    ).toEqual({ isCopied: true })
    // densable Jko stamps Y7()[0]; no Ink on stdout → still no-surface.
    expect(await handleHostOp('ui.copy', [{ text: 'hi' }])).toEqual({
      isCopied: false,
      reason: 'no-surface',
    })
    const copySrc = readFileSync(
      join(import.meta.dir, '../plugins/functionHooksModules.ts'),
      'utf8',
    )
    expect(copySrc).toContain('function stampUiCopy')
    expect(copySrc).toContain('input.surface ?? attachedCopySurfaces()[0]')
    expect(copySrc).toContain(
      'no surface draws (none attached); nothing copied',
    )
    expect(copySrc).toContain('no client there took it; nothing copied')
    expect(copySrc).toContain('over the write bound')
    {
      let box = { text: 'hi', cursor: 2 }
      const composer = createPromptEditComposer({
        read: () => box,
        commit: next => {
          box = next
        },
      })
      composer.setHooked(true)
      composer.record({
        before: { text: 'h', cursor: 1 },
        after: { text: 'hi', cursor: 2 },
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(box).toEqual({ text: 'hi', cursor: 2 })
      composer.dispose()
    }
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: ['classic.ui.render'],
        hooks: [
          {
            pattern: 'classic.ui.render',
            matcher: { component: 'AskUserQuestion' },
            hook: () => {
              throw new Error('engine-alone matcher must not run')
            },
          },
        ],
      },
    ])
    expect(
      await runFunctionHookChain(
        'ui.render',
        { component: 'AskUserQuestion' },
        async () => 'tail',
      ),
    ).toBe('tail')
    expect(
      scanFunctionHookSource(
        'export function register(on) { on("ui.render", { component: "AskUserQuestion" }, () => {}) }',
      ).ok,
    ).toBe(true)
  })

  test('densable 2.1.289 SITE_RULES unique English', () => {
    expect(uiRenderTreeCheck({ type: 'Box' })).toBeUndefined()
    expect(uiRenderTreeCheck('nope')).toBe(
      'something that is not a tree element',
    )
    expect(sessionCompactMessagesCheck([])).toBe(
      'an empty messages (a compaction leaves at least one)',
    )
    expect(sessionCompactMessagesCheck('nope')).toBe(
      'messages that are not a list',
    )
    expect(sessionCompactMessagesCheck([{ role: 'user' }])).toBeUndefined()
    const never = uiRenderMatcherNeverRuns({
      component: 'AbovePrompt',
      surface: 'mobile',
    })
    expect(never).toContain('AbovePrompt is raised on')
    expect(never).toContain('; this hook names mobile')
    expect(never).toContain(', so it never runs')
    expect(uiRenderMatcherNeverRuns({ component: 'UserMessag' })).toBe(
      'no component is named UserMessag (did you mean UserMessage?), so it never runs',
    )
  })

  test('densable drawing-plainness unique English', () => {
    expect(
      uiRenderDrawingPlainCheck({ type: 'Box', props: {} }, 'demo'),
    ).toBeUndefined()
    expect(
      uiRenderDrawingPlainCheck(new Proxy({ type: 'Box' }, {}), 'demo'),
    ).toContain('returned a drawing that holds a Proxy')
    expect(
      uiRenderDrawingPlainCheck({ type: 'Box', extra: () => {} }, 'demo'),
    ).toContain('returned a drawing with a function where plain data goes')
    expect(
      uiRenderDrawingPlainCheck({ type: 'Button', onPress: () => {} }, 'demo'),
    ).toBeUndefined()
    expect(
      uiRenderDrawingPlainCheck({ type: 'Box', extra: new Date() }, 'demo'),
    ).toContain('not plain data (a class instance)')
  })

  test('densable q9n hover-prop deny unique English', () => {
    const keyed = (
      hover: Record<string, unknown>,
      inner?: Record<string, unknown>,
    ) => ({
      type: 'Box',
      props: { key: 'k' },
      children: [{ type: 'Box', hover, ...(inner ?? {}) }],
    })
    expect(uiRenderHoverCheck(keyed({ color: 'red' }))).toBe(
      'Box hover prop "color" is not allowed',
    )
    expect(uiRenderHoverCheck(keyed({ display: 'none' }))).toContain(
      'would hide it under the pointer',
    )
    expect(
      uiRenderHoverCheck(
        keyed({ display: 'flex' }, { props: { display: 'flex' } }),
      ),
    ).toContain('this Box is already shown')
    expect(uiRenderHoverCheck(keyed({ borderStyle: 'single' }))).toContain(
      'give the Box a borderStyle for the hover to restyle',
    )
    expect(uiRenderHoverCheck(keyed({ top: 1 }))).toContain(
      'a hover moves only a Box drawn position "absolute"',
    )
    expect(
      uiRenderHoverCheck({
        type: 'Box',
        hover: { display: 'flex' },
        props: { display: 'none' },
      }),
    ).toContain('hover has no Box with a key around it')
    expect(
      uiRenderHoverCheck({
        type: 'Box',
        props: { key: 'self', display: 'none' },
        hover: { display: 'flex' },
      }),
    ).toContain('hover is scoped to a keyed Box drawn display "none"')
    expect(
      uiRenderHoverCheck({
        type: 'Box',
        props: { key: 'outer', display: 'none' },
        children: [
          {
            type: 'Box',
            hover: { display: 'flex' },
          },
        ],
      }),
    ).toContain('hover is scoped to a keyed Box drawn display "none"')
    expect(
      uiRenderHoverCheck({
        type: 'Box',
        hover: { scope: '' },
      }),
    ).toContain('hover scope')
    expect(
      uiRenderHoverCheck({
        type: 'Box',
        hover: { scope: '' },
      }),
    ).toContain('is not a string of 1 to 64 characters')
  })

  test('agent.spawn hook that never nexts is wis/Rat refuse', async () => {
    let launched = 0
    setAgentSpawnHandler(async () => {
      launched += 1
      return { result: { agentId: 'spawned-hook' } }
    })
    setLoadedFunctionHooksModules([
      {
        name: 'blocker',
        patterns: ['agent.spawn'],
        hooks: [
          {
            pattern: 'agent.spawn',
            hook: () => ({ deny: 'nope' }),
          },
        ],
      },
    ])
    expect(
      await handleHostOp(
        'agent.spawn',
        [{ tool: 'Agent', prompt: 'go' }],
        'demo',
      ),
    ).toEqual({ deny: 'nope' })
    expect(launched).toBe(0)

    setLoadedFunctionHooksModules([
      {
        name: 'silent',
        patterns: ['agent.spawn'],
        hooks: [
          {
            pattern: 'agent.spawn',
            hook: () => ({ text: 'held' }),
          },
        ],
      },
    ])
    expect(
      await handleHostOp(
        'agent.spawn',
        [{ tool: 'Agent', prompt: 'go' }],
        'demo',
      ),
    ).toEqual({
      deny: 'agent.spawn: a hook answered without passing the spawn on',
    })
    expect(launched).toBe(0)

    setLoadedFunctionHooksModules([
      {
        name: 'pass',
        patterns: ['agent.spawn'],
        hooks: [
          {
            pattern: 'agent.spawn',
            hook: (_api, event, next) => next(event),
          },
        ],
      },
    ])
    expect(
      await handleHostOp(
        'agent.spawn',
        [{ tool: 'Agent', prompt: 'go' }],
        'demo',
      ),
    ).toEqual({ result: { agentId: 'spawned-hook' } })
    expect(launched).toBe(1)
  })

  test('dispatchClientMessage runs ui.message then core {} (N1t)', async () => {
    const seen: unknown[] = []
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: ['ui.message'],
        hooks: [
          {
            pattern: 'ui.message',
            hook: (_api, event, next) => {
              seen.push(event)
              return next(event)
            },
          },
        ],
      },
    ])
    expect(
      await dispatchClientMessage({
        plugin: 'demo',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'pane_1',
        element: 'k',
        module: './board',
        data: { ping: 1 },
      }),
    ).toEqual({})
    expect(seen).toEqual([
      {
        surface: 'terminal',
        component: 'Pane',
        requestId: 'pane_1',
        element: 'k',
        module: './board',
        data: { ping: 1 },
      },
    ])
  })

  test('dispatchClientMessage N1t {only: owning plugin} then core {}', async () => {
    const seen: string[] = []
    setLoadedFunctionHooksModules([
      {
        name: 'owner',
        patterns: ['ui.message'],
        hooks: [
          {
            pattern: 'ui.message',
            hook: async (_api, _event, next) => {
              seen.push('owner')
              const onward = await next()
              seen.push(`owner-next:${JSON.stringify(onward)}`)
              return { from: 'owner', next: onward }
            },
          },
        ],
      },
      {
        name: 'other',
        patterns: ['ui.message'],
        hooks: [
          {
            pattern: 'ui.message',
            hook: () => {
              seen.push('other')
              return { from: 'other', leaked: true }
            },
          },
        ],
      },
      {
        name: 'star',
        patterns: ['*'],
        hooks: [
          {
            pattern: '*',
            hook: () => {
              seen.push('star')
              return { from: 'star' }
            },
          },
        ],
      },
    ])
    expect(
      await dispatchClientMessage({
        plugin: 'owner',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'pane_1',
        element: 'board',
        module: './board',
        data: { ping: 1 },
      }),
    ).toEqual({ from: 'owner', next: {} })
    expect(seen).toEqual(['owner', 'owner-next:{}'])
  })

  test('dispatchClientMessage N1t throw rejects (Wbr warn is drain)', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'owner',
        patterns: ['ui.message'],
        hooks: [
          {
            pattern: 'ui.message',
            hook: () => {
              throw new Error('boom')
            },
          },
        ],
      },
    ])
    await expect(
      dispatchClientMessage({
        plugin: 'owner',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'pane_1',
        element: 'board',
        module: './board',
        data: { ping: 1 },
      }),
    ).rejects.toThrow('boom')
  })

  test('enqueueClientMessage cancel(e.id) drops pending Wbr post', async () => {
    const seen: unknown[] = []
    setLoadedFunctionHooksModules([
      {
        name: 'owner',
        patterns: ['ui.message'],
        hooks: [
          {
            pattern: 'ui.message',
            hook: (_api, event) => {
              seen.push(event)
              return { from: 'owner' }
            },
          },
        ],
      },
    ])
    let replied: unknown
    enqueueClientMessage(
      {
        id: 'owner terminal pane_1 board',
        plugin: 'owner',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'pane_1',
        element: 'board',
        module: './board',
        data: { ping: 1 },
      },
      value => {
        replied = value
      },
    )
    cancelClientMessage('owner terminal pane_1 board')
    await Bun.sleep(20)
    expect(seen).toEqual([])
    expect(replied).toBeUndefined()
  })

  test('enqueueClientMessage last-write-wins by instance id then N1t', async () => {
    const seen: unknown[] = []
    setLoadedFunctionHooksModules([
      {
        name: 'owner',
        patterns: ['ui.message'],
        hooks: [
          {
            pattern: 'ui.message',
            hook: (_api, event) => {
              seen.push(event.data)
              return { from: 'owner' }
            },
          },
        ],
      },
    ])
    const replies: unknown[] = []
    enqueueClientMessage(
      {
        id: 'inst',
        plugin: 'owner',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'pane_1',
        element: 'board',
        module: './board',
        data: { n: 1 },
      },
      value => {
        replies.push(value)
      },
    )
    enqueueClientMessage(
      {
        id: 'inst',
        plugin: 'owner',
        surface: 'terminal',
        component: 'Pane',
        requestId: 'pane_1',
        element: 'board',
        module: './board',
        data: { n: 2 },
      },
      value => {
        replies.push(value)
      },
    )
    await Bun.sleep(20)
    expect(seen).toEqual([{ n: 2 }])
    expect(replies).toEqual([{ from: 'owner' }])
    expect(getClientMessagesDispatched()).toBeGreaterThanOrEqual(1)
  })

  test('runFunctionHookChain {only} skips other plugins for ui.fault (dO)', async () => {
    const seen: string[] = []
    setLoadedFunctionHooksModules([
      {
        name: 'owner',
        patterns: ['ui.fault'],
        hooks: [
          {
            pattern: 'ui.fault',
            hook: (_api, _event, next) => {
              seen.push('owner')
              return next()
            },
          },
        ],
      },
      {
        name: 'other',
        patterns: ['ui.fault'],
        hooks: [
          {
            pattern: 'ui.fault',
            hook: () => {
              seen.push('other')
              return { leaked: true }
            },
          },
        ],
      },
    ])
    expect(
      await runFunctionHookChain(
        'ui.fault',
        { element: 'k', phase: 'render' },
        async () => ({ core: true }),
        'owner',
      ),
    ).toEqual({ core: true })
    expect(seen).toEqual(['owner'])
  })

  test('dispatchClientFault dO logs settle even with no ui.fault hook', async () => {
    setLoadedFunctionHooksModules([{ name: 'owner', patterns: [] }])
    const logs: string[] = []
    const spy = spyOn(debug, 'logForDebugging').mockImplementation(msg => {
      logs.push(String(msg))
    })
    try {
      expect(
        await dispatchClientFault({
          plugin: 'owner',
          surface: 'terminal',
          component: 'Pane',
          requestId: 'pane_1',
          element: 'board',
          module: './board',
          phase: 'render',
          reason: 'boom',
        }),
      ).toEqual({})
      expect(logs.some(line => line.includes('Client rejection'))).toBe(true)
      const settle = logs.find(line => line.includes('dispatched, settled in'))
      expect(settle).toMatch(
        /^ui\.fault owner\/board \(\.\/board\) in Pane from terminal, render: dispatched, settled in \d+\.\d+ms$/,
      )
    } finally {
      spy.mockRestore()
    }
  })

  test('dispatchClientFault throw rejects (reporter logs chain-threw)', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'owner',
        patterns: ['ui.fault'],
        hooks: [
          {
            pattern: 'ui.fault',
            hook: () => {
              throw new Error('boom')
            },
          },
        ],
      },
    ])
    const logs: string[] = []
    const spy = spyOn(debug, 'logForDebugging').mockImplementation(msg => {
      logs.push(String(msg))
    })
    try {
      await expect(
        dispatchClientFault({
          plugin: 'owner',
          surface: 'terminal',
          component: 'Pane',
          requestId: 'pane_1',
          element: 'board',
          module: './board',
          phase: 'load',
          reason: 'boom',
        }),
      ).rejects.toThrow('boom')
      expect(logs.some(line => line.includes('dispatched, settled in'))).toBe(
        false,
      )
    } finally {
      spy.mockRestore()
    }
  })

  test('dispatchClientFault cO records faultRuns; sO skips same Lue', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'owner',
        patterns: ['ui.fault'],
        hooks: [
          {
            pattern: 'ui.fault',
            hook: (_api, _event, next) => next(),
          },
        ],
      },
    ])
    expect(getPluginFaultRunsSize()).toBe(0)
    expect(getPluginFaultRenderStateSize()).toBe(0)
    await dispatchClientFault({
      plugin: 'owner',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pane_1',
      element: 'board',
      module: './board',
      phase: 'render',
      reason: 'boom',
    })
    expect(getPluginFaultRunsSize()).toBe(1)
    expect(getPluginFaultRenderStateSize()).toBe(1)
    await dispatchClientFault({
      plugin: 'owner',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pane_1',
      element: 'board',
      module: './board',
      phase: 'render',
      reason: 'boom',
    })
    expect(getPluginFaultRunsSize()).toBe(1)
    expect(getPluginFaultRenderStateSize()).toBe(1)
    await dispatchClientFault({
      plugin: 'owner',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pane_2',
      element: 'board',
      module: './board',
      phase: 'render',
      reason: 'boom',
    })
    expect(getPluginFaultRunsSize()).toBe(2)
    expect(getPluginFaultRenderStateSize()).toBe(2)
  })

  test('ui.resolve returns the constructor table after di (yOt, not classic)', async () => {
    await expect(
      handleHostOp('ui.resolve', [{ surface: 'nope', component: 'Pane' }]),
    ).rejects.toThrow(
      'ui.resolve: takes a ui.render argument (e.surface names the surface) (host check)',
    )
    await expect(
      handleHostOp('ui.resolve', [
        { surface: 'terminal', component: 'NotAComponent' },
      ]),
    ).rejects.toThrow(
      'ui.resolve: takes a ui.render argument (e.component "NotAComponent" is not a component the engine draws) (host check)',
    )
    const resolved = await handleHostOp(
      'ui.resolve',
      [
        {
          surface: 'terminal',
          component: 'Pane',
          requestId: 'pane_ctor',
          children: {
            type: 'Raster',
            key: 'k',
            requestId: 'pane_ctor',
            columns: 1,
            rows: 1,
          },
        },
      ],
      'demo',
    )
    const table = resolved as {
      Box?: unknown
      Text?: unknown
      Raster?: (props?: Record<string, unknown>) => unknown
    }
    expect(typeof table.Box).toBe('function')
    expect(typeof table.Text).toBe('function')
    expect(typeof table.Raster).toBe('function')
    expect(table.Raster?.({ key: 'k', columns: 1, rows: 1 })).toEqual({
      type: 'Raster',
      props: { key: 'k', columns: 1, rows: 1 },
    })
    expect(
      await handleHostOp(
        'ui.blit',
        [{ requestId: 'pane_ctor', key: 'k', cells: 'xx' }],
        'demo',
      ),
    ).toEqual({
      deny: 'cells must be the base64 of 1 cells of 12 bytes (16 characters for 1x1)',
    })
    storeResolvedTables('demo', [
      {
        surface: 'terminal',
        component: 'Pane',
        answer: { fromWorker: true },
      },
    ])
    expect(
      await handleHostOp(
        'ui.resolve',
        [{ surface: 'terminal', component: 'Pane' }],
        'demo',
      ),
    ).toEqual({ fromWorker: true })
    expect(getResolvedAnswer('demo', 'terminal', 'Pane')).toEqual({
      fromWorker: true,
    })
  })

  test('plugin.register vSt: core admits; a hook can refuse', async () => {
    expect(await handleHostOp('plugin.register', [{}])).toEqual({
      allow: true,
    })
    setLoadedFunctionHooksModules([
      {
        name: 'gate',
        patterns: ['plugin.register'],
        hooks: [
          {
            pattern: 'plugin.register',
            hook: () => ({ refuse: 'not this plugin' }),
          },
        ],
      },
    ])
    expect(await handleHostOp('plugin.register', [{ name: 'demo' }])).toEqual({
      by: 'gate',
      reason: 'not this plugin',
    })
  })

  test('state.get missing key is { value, version: 0 }; blit Image deny', async () => {
    expect(
      await handleHostOp('state.get', [{ plugin: 'demo', key: 'gone' }]),
    ).toEqual({ value: undefined, version: 0 })
    expect(
      await handleHostOp(
        'ui.blit',
        [
          {
            requestId: 'r1',
            key: 'img',
            source: { url: 'https://example.com/a.png' },
          },
        ],
        'demo',
      ),
    ).toEqual({
      deny: 'no Image of its own is mounted under key "img" in r1',
    })
  })

  test('listBuiltinFunctionHookPlugins reads vendor/claude-code-mods/mods', () => {
    expect(Array.isArray(listBuiltinFunctionHookPlugins())).toBe(true)
  })

  test('builtin agents-md register.ts is plain JS the VM can load', async () => {
    const previous = process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
    process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = '1'
    try {
      const plugins = listBuiltinFunctionHookPlugins()
      const agents = plugins.find(plugin => plugin.name === 'builtin:agents-md')
      expect(agents).toBeDefined()
      await loadFunctionHooksModules(
        plugins.filter(p => p.name === 'builtin:agents-md'),
      )
      expect(hasMatchingFunctionHook('prompt.context')).toBe(true)
      expect(hasMatchingFunctionHook('session.start')).toBe(true)
    } finally {
      if (previous === undefined)
        delete process.env.CLAUDE_CODE_HOOKS_SAME_THREAD
      else process.env.CLAUDE_CODE_HOOKS_SAME_THREAD = previous
    }
  })

  test('evaluateUiRender stores the hook tree on the xI site', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: ['ui.render'],
        hooks: [
          {
            pattern: 'ui.render',
            matcher: { component: 'Pane' },
            hook: (_api, event) => ({
              type: 'Raster',
              props: {
                key: 'k',
                columns: 2,
                rows: 1,
              },
              requestId: String(
                (event as { requestId?: unknown }).requestId ?? 'pane_1',
              ),
            }),
          },
        ],
      },
    ])
    const tree = await evaluateUiRender({
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pane_1',
      props: {},
    })
    expect(tree).toEqual(
      expect.objectContaining({
        type: 'Raster',
        raster: { plugin: 'demo' },
      }),
    )
    expect(
      getPluginDrawingTrees().some(
        drawing =>
          drawing.component === 'Pane' && drawing.requestId === 'pane_1',
      ),
    ).toBe(true)
  })

  test('evaluateUiRender refuses something that is not a tree element', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: ['ui.render'],
        hooks: [
          {
            pattern: 'ui.render',
            matcher: { component: 'Pane' },
            hook: () => 'not-a-tree',
          },
        ],
      },
    ])
    await expect(
      evaluateUiRender({
        surface: 'terminal',
        component: 'Pane',
        requestId: 'pane_tree',
        props: {},
      }),
    ).rejects.toThrow('something that is not a tree element')
  })

  test('densable leftover unique English: refuse / Buttons / AskUserQuestion rewrite', async () => {
    const src = readFileSync(
      join(import.meta.dir, '../plugins/functionHooksModules.ts'),
      'utf8',
    )
    expect(src).toContain('refused: ${problem}; the engine drew its own')
    expect(src).toContain('drew Buttons but is not loaded; nothing to release')
    expect(src).toContain(
      "rewritten questions do not match the tool's input schema",
    )
    expect(src).toContain('a rewrite may relabel the questions but not')
    const panes = readFileSync(
      join(import.meta.dir, '../../components/PluginRasterPanes.tsx'),
      'utf8',
    )
    expect(panes).toContain('): site failed:')

    setLoadedFunctionHooksModules([])
    releasePresses('gone', ['h1'], { component: 'Pane', requestId: 'pane_1' })

    const original = [
      {
        question: 'A',
        options: [{ label: '1', preview: 'p' }],
      },
    ]
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: ['ui.render'],
        hooks: [
          {
            pattern: 'ui.render',
            hook: () => ({
              type: 'AskUserQuestion',
              props: {
                questions: [
                  {
                    question: 'A',
                    options: [{ label: '2', preview: 'p' }],
                  },
                ],
              },
            }),
          },
        ],
      },
    ])
    const tree = await evaluateUiRender({
      surface: 'terminal',
      component: 'AskUserQuestion',
      requestId: 'ask_1',
      props: { questions: original },
    })
    expect(tree).toEqual(
      expect.objectContaining({
        type: 'AskUserQuestion',
        props: expect.objectContaining({ questions: original }),
      }),
    )
  })

  test('Client acquire fails gold when the plugin loaded no surface module', async () => {
    const { acquirePluginClient } = await import(
      '../plugins/functionHooksClient.js'
    )
    setLoadedFunctionHooksModules([
      {
        name: 'demo',
        patterns: [],
        hooks: [],
      },
    ])
    const instance = acquirePluginClient({
      plugin: 'demo',
      key: 'board',
      module: './board',
    })
    await new Promise(resolve => setImmediate(resolve))
    const snap = instance.getSnapshot()
    expect(snap.status).toBe('failed')
    if (snap.status === 'failed') {
      expect(snap.text).toBe(
        'demo: Client ./board: Client: the plugin loaded no surface module (its hooks module builds no Client from a literal path), so nothing can draw its Clients',
      )
    }
    instance.release()
  })

  test('le sanitizes control characters and caps at 500', async () => {
    const { sanitizeClientFailMessage } = await import(
      '../plugins/functionHooksClient.js'
    )
    const dirty =
      'line' +
      '\n' +
      String.fromCharCode(0) +
      String.fromCharCode(7) +
      String.fromCharCode(11) +
      String.fromCharCode(27) +
      String.fromCodePoint(0x10eeee) +
      'end'
    const cleaned = sanitizeClientFailMessage(dirty)
    expect(cleaned.includes('\n')).toBe(false)
    expect(cleaned.includes(String.fromCharCode(0))).toBe(false)
    expect(cleaned.includes(String.fromCharCode(7))).toBe(false)
    expect(cleaned.includes(String.fromCharCode(11))).toBe(false)
    expect(cleaned.includes(String.fromCharCode(27))).toBe(false)
    expect(cleaned.includes(String.fromCodePoint(0x10eeee))).toBe(false)
    expect(cleaned).toBe('line      end')
    expect(sanitizeClientFailMessage('a'.repeat(501)).length).toBe(501)
    expect(sanitizeClientFailMessage('a'.repeat(501)).endsWith('…')).toBe(true)
  })

  test('oA inline rows gold share and chosen clamp', async () => {
    const { pluginPaneInlineRows } = await import(
      '../../components/PluginRasterPanes.js'
    )
    expect(pluginPaneInlineRows(30, 'inline')).toBe(10)
    expect(pluginPaneInlineRows(30, 'fullscreen')).toBe(10)
    expect(pluginPaneInlineRows(30, 'inline', 2)).toBe(5)
    expect(pluginPaneInlineRows(30, 'inline', 40)).toBe(19)
    expect(pluginPaneInlineRows(30, 'inline', null, 7)).toBe(7)
    expect(pluginPaneInlineRows(30, 'inline', 10, 7)).toBe(10)
    expect(pluginPaneInlineRows(30, 'inline', null, 40)).toBe(19)
  })

  test('$q Wq jq typed and nav keys', async () => {
    const { pluginInputIsTyped, pluginInputIsNav, pluginInputHoldsControl } =
      await import('../../components/PluginRasterPanes.js')
    const none = {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      pageDown: false,
      pageUp: false,
      wheelUp: false,
      wheelDown: false,
      home: false,
      end: false,
      return: false,
      escape: false,
      ctrl: false,
      shift: false,
      fn: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      super: false,
    }
    expect(pluginInputIsTyped('a', none)).toBe(true)
    expect(pluginInputIsTyped('', none)).toBe(false)
    expect(pluginInputIsTyped('a', { ...none, ctrl: true })).toBe(false)
    expect(pluginInputIsTyped('a', { ...none, return: true })).toBe(false)
    expect(pluginInputHoldsControl('\n')).toBe(false)
    expect(pluginInputHoldsControl(String.fromCharCode(0))).toBe(true)
    expect(pluginInputHoldsControl('a')).toBe(false)
    expect(pluginInputIsNav('', { ...none, leftArrow: true })).toBe(true)
    expect(pluginInputIsNav('a', { ...none, ctrl: true })).toBe(true)
    expect(pluginInputIsNav('c', { ...none, ctrl: true })).toBe(false)
    const panes = readFileSync(
      join(import.meta.dir, '../../components/PluginRasterPanes.tsx'),
      'utf8',
    )
    expect(panes.includes('pluginInputIsTyped')).toBe(true)
    expect(panes.includes('inputFields.edit(held')).toBe(true)
  })

  test('invokePress returns the handler value for ui.select reply', async () => {
    holdPress('demo', 9, () => ({ value: 'picked' }))
    await expect(invokePress('demo', 9, { value: 'a' })).resolves.toEqual({
      value: 'picked',
    })
  })

  test('Client acquire stamps held press and runHeld', async () => {
    const { acquirePluginClient } = await import(
      '../plugins/functionHooksClient.js'
    )
    const dir = mkdtempSync(join(tmpdir(), 'surf-held-'))
    const modPath = join(dir, 'board.js')
    const source = `export function Board(props, surface) {
  return surface.elements.Button({ label: 'go', onPress() {} })
}
`
    writeFileSync(modPath, source)
    setLoadedFunctionHooksModules([
      {
        name: 'heldplug',
        root: dir,
        patterns: [],
        hooks: [],
        surfaceModules: [
          {
            module: './board',
            modulePath: modPath,
            component: 'Board',
            source,
          },
        ],
      },
    ])
    const instance = acquirePluginClient({
      plugin: 'heldplug',
      key: 'k',
      module: './board',
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (instance.getSnapshot().status !== 'loading') break
    }
    const snap = instance.getSnapshot()
    expect(snap.status).toBe('drawn')
    if (snap.status === 'drawn') {
      const tree = snap.tree as {
        type?: string
        press?: { plugin?: string; handle?: unknown }
      }
      expect(tree.type).toBe('Button')
      expect(tree.press?.plugin).toBe('heldplug')
      expect(typeof tree.press?.handle).toBe('number')
    }
    instance.runHeld(1, { kind: 'press' })
    instance.dropHeld([1])
    instance.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('Ta leaves host instanceof Error; thrown Board fails the snapshot', async () => {
    const { acquirePluginClient } = await import(
      '../plugins/functionHooksClient.js'
    )
    const dir = mkdtempSync(join(tmpdir(), 'surf-ta-'))
    const modPath = join(dir, 'board.js')
    const source = `export function Board() { throw new Error('surface-boom') }
`
    writeFileSync(modPath, source)
    setLoadedFunctionHooksModules([
      {
        name: 'taplug',
        root: dir,
        patterns: [],
        hooks: [],
        surfaceModules: [
          {
            module: './board',
            modulePath: modPath,
            component: 'Board',
            source,
          },
        ],
      },
    ])
    const instance = acquirePluginClient({
      plugin: 'taplug',
      key: 'k',
      module: './board',
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (instance.getSnapshot().status !== 'loading') break
    }
    let hostErr: Error | undefined
    let constructThrew: unknown
    try {
      hostErr = new Error('host')
    } catch (err) {
      constructThrew = err
    }
    expect(constructThrew).toBeUndefined()
    expect(hostErr instanceof Error).toBe(true)
    const snap = instance.getSnapshot()
    expect(snap.status).toBe('failed')
    if (snap.status === 'failed') {
      expect(snap.text).toContain('surface-boom')
    }
    instance.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('ro typeahead miss does not open; hit opens on the match', async () => {
    const { pluginSelectTypeaheadNext } = await import(
      '../../components/PluginRasterPanes.js'
    )
    const focused = {
      plugin: 'demo',
      handle: 1,
      element: 'sel',
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
      ],
    }
    expect(pluginSelectTypeaheadNext(null, focused, 'z')).toBeNull()
    const hit = pluginSelectTypeaheadNext(null, focused, 'b')
    expect(hit).toEqual({
      plugin: 'demo',
      handle: 1,
      element: 'sel',
      options: focused.options,
      highlight: 1,
    })
    const open = {
      plugin: 'demo',
      handle: 1,
      highlight: 1,
      element: 'sel',
      options: focused.options,
    }
    expect(pluginSelectTypeaheadNext(open, focused, 'z')).toEqual(open)
  })

  test('XP maps Input/Select to AbovePrompt*; else the site', async () => {
    const { pluginFieldContext } = await import(
      '../../components/PluginRasterPanes.js'
    )
    expect(pluginFieldContext('Input', 'Pane')).toBe('AbovePromptInput')
    expect(pluginFieldContext('Select', 'AbovePrompt')).toBe(
      'AbovePromptSelect',
    )
    expect(pluginFieldContext(undefined, 'Pane')).toBe('Pane')
    expect(pluginFieldContext('Button', 'Pane')).toBe('Pane')
  })

  test('tMe cloneIn drops functions from Client props', async () => {
    const { acquirePluginClient } = await import(
      '../plugins/functionHooksClient.js'
    )
    const dir = mkdtempSync(join(tmpdir(), 'surf-tme-'))
    const modPath = join(dir, 'board.js')
    const source = `export function Board(props) {
  return { type: 'Box', children: [
    typeof props.fn,
    props.keep,
    Object.prototype.hasOwnProperty.call(props, '__proto__') ? 'has-proto' : 'no-proto',
  ] }
}
`
    writeFileSync(modPath, source)
    setLoadedFunctionHooksModules([
      {
        name: 'tmeplug',
        root: dir,
        patterns: [],
        hooks: [],
        surfaceModules: [
          {
            module: './board',
            modulePath: modPath,
            component: 'Board',
            source,
          },
        ],
      },
    ])
    const instance = acquirePluginClient({
      plugin: 'tmeplug',
      key: 'k',
      module: './board',
      props: { fn: () => 'nope', keep: 'yes', ['__proto__']: { evil: true } },
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (instance.getSnapshot().status !== 'loading') break
    }
    const snap = instance.getSnapshot()
    expect(snap.status).toBe('drawn')
    if (snap.status === 'drawn') {
      expect(snap.tree).toEqual({
        type: 'Box',
        children: ['undefined', 'yes', 'no-proto'],
      })
    }
    instance.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('PaneField close and Pane scroll gold host half', async () => {
    await handleHostOp('ui.open', [{ id: 'pane_close' }], 'demo')
    expect(getShownPluginPane()?.id).toBe('pane_close')
    await closePluginPane()
    expect(getShownPluginPane()).toBeUndefined()
    await handleHostOp('ui.open', [{ id: 'pane_scroll' }], 'demo')
    scrollPluginPane('down')
    expect(getShownPluginPane()?.offset).toBeGreaterThanOrEqual(0)
    await closePluginPane('pane_scroll')
  })

  test('register/update/unregisterPluginScrollSite Ide HAVE', () => {
    const registered = registerPluginScrollSite(
      'band-owner',
      ABOVE_PROMPT_REQUEST_ID,
      'AbovePrompt',
      {
        offset: 1,
        maxOffset: 4,
        bodyRows: 8,
        contentRows: 12,
      },
    )
    expect(registered).toEqual({
      plugin: 'band-owner',
      owner: 'band-owner',
      requestId: ABOVE_PROMPT_REQUEST_ID,
      component: 'AbovePrompt',
      offset: 1,
      maxOffset: 4,
      bodyRows: 8,
      contentRows: 12,
      keyCount: 0,
      followEnd: false,
    })
    expect(
      getPluginScrollSite('band-owner', ABOVE_PROMPT_REQUEST_ID, 'AbovePrompt'),
    ).toMatchObject({
      component: 'AbovePrompt',
      owner: 'band-owner',
      offset: 1,
      maxOffset: 4,
      bodyRows: 8,
      contentRows: 12,
      followEnd: false,
    })
    expect(
      updatePluginScrollSite(
        'band-owner',
        ABOVE_PROMPT_REQUEST_ID,
        {
          offset: 3,
          maxOffset: 5,
          bodyRows: 9,
          contentRows: 14,
        },
        'AbovePrompt',
      ),
    ).toMatchObject({
      offset: 3,
      maxOffset: 5,
      bodyRows: 9,
      contentRows: 14,
    })
    noteDrawnElement('band-owner', ABOVE_PROMPT_REQUEST_ID, 'box-a')
    expect(
      getPluginScrollSite('band-owner', ABOVE_PROMPT_REQUEST_ID, 'AbovePrompt')
        ?.keyCount,
    ).toBe(1)
    expect(
      getPluginScrollSite('band-owner', ABOVE_PROMPT_REQUEST_ID, 'AbovePrompt')
        ?.component,
    ).toBe('AbovePrompt')
    unregisterPluginScrollSite(
      'band-owner',
      ABOVE_PROMPT_REQUEST_ID,
      'AbovePrompt',
    )
    expect(
      getPluginScrollSite('band-owner', ABOVE_PROMPT_REQUEST_ID, 'AbovePrompt'),
    ).toBeUndefined()
    expect(
      updatePluginScrollSite(
        'band-owner',
        ABOVE_PROMPT_REQUEST_ID,
        {
          offset: 0,
        },
        'AbovePrompt',
      ),
    ).toBeUndefined()
  })

  test('logUiScrollSettled / commitPluginScrollSite / dispatchPersonUiScroll Hde QLt HAVE', async () => {
    expect(commitPluginScrollSite('missing', 'above-prompt', 2)).toEqual({
      deny: 'no such site',
    })
    registerPluginScrollSite(
      'band-owner',
      ABOVE_PROMPT_REQUEST_ID,
      'AbovePrompt',
      {
        offset: 0,
        maxOffset: 4,
        bodyRows: 8,
        contentRows: 12,
      },
    )
    expect(
      commitPluginScrollSite(
        'band-owner',
        ABOVE_PROMPT_REQUEST_ID,
        9,
        {
          kind: 'person',
        },
        'AbovePrompt',
      ),
    ).toEqual({})
    expect(
      getPluginScrollSite('band-owner', ABOVE_PROMPT_REQUEST_ID, 'AbovePrompt')
        ?.offset,
    ).toBe(4)

    const settled = await logUiScrollSettled(
      'ui.scroll AbovePrompt above-prompt',
      Promise.reject(new Error('boom')),
    )
    expect(settled).toBeUndefined()

    const moved = await dispatchPersonUiScroll({
      component: 'AbovePrompt',
      requestId: ABOVE_PROMPT_REQUEST_ID,
      offset: 2,
      by: -2,
      bodyRows: 7,
      contentRows: 11,
      plugin: 'band-owner',
    })
    expect(moved).toEqual({})
    expect(
      getPluginScrollSite('band-owner', ABOVE_PROMPT_REQUEST_ID, 'AbovePrompt'),
    ).toMatchObject({
      offset: 2,
      bodyRows: 7,
      contentRows: 11,
    })

    // densable Fj(component, requestId) — person origin still commits even if
    // the caller plugin string differs; Sat only denies foreign plugin origin.
    const ghostPerson = await dispatchPersonUiScroll({
      component: 'AbovePrompt',
      requestId: ABOVE_PROMPT_REQUEST_ID,
      offset: 1,
      by: 1,
      bodyRows: 7,
      contentRows: 11,
      plugin: 'ghost',
    })
    expect(ghostPerson).toEqual({})
    expect(
      getPluginScrollSite('band-owner', ABOVE_PROMPT_REQUEST_ID, 'AbovePrompt')
        ?.offset,
    ).toBe(1)

    const denied = await dispatchPersonUiScroll({
      component: 'AbovePrompt',
      requestId: 'missing-req',
      offset: 1,
      by: 1,
      bodyRows: 7,
      contentRows: 11,
      plugin: 'ghost',
    })
    expect(denied).toEqual({ deny: 'no such site' })

    const src = readFileSync(
      join(import.meta.dir, '../plugins/functionHooksModules.ts'),
      'utf8',
    )
    expect(src).toContain('export function logUiScrollSettled')
    expect(src).toContain('export function commitPluginScrollSite')
    expect(src).toContain('export function dispatchPersonUiScroll')
    expect(src).toContain("runFunctionHookChain('ui.scroll'")
    expect(src).not.toMatch(
      /\bexport\s+(?:const|function|let|class|var)\s+Hde\b/,
    )
    expect(src).not.toMatch(
      /\bexport\s+(?:const|function|let|class|var)\s+QLt\b/,
    )
    expect(src).not.toMatch(
      /\bexport\s+(?:const|function|let|class|var)\s+Ide\b/,
    )
    unregisterPluginScrollSite('band-owner', ABOVE_PROMPT_REQUEST_ID)
  })

  test('defaultBindings Pane and PaneField match gold chords', () => {
    const bindings = readFileSync(
      join(import.meta.dir, '../../keybindings/defaultBindings.ts'),
      'utf8',
    )
    expect(bindings.includes("context: 'Pane'")).toBe(true)
    expect(bindings.includes("context: 'PaneField'")).toBe(true)
    expect(bindings.includes("'ctrl+x x': 'pane:close'")).toBe(true)
    expect(bindings.includes("up: 'pane:scrollUp'")).toBe(true)
    const runtime = readFileSync(
      join(import.meta.dir, '../plugins/functionHooksSurfaceRuntime.ts'),
      'utf8',
    )
    expect(runtime.includes('\\`this\\`')).toBe(true)
  })

  test('aTt ui.close hook can keep the pane open', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'keep',
        patterns: ['ui.close'],
        hooks: [
          {
            pattern: 'ui.close',
            hook: () => ({ kept: true }),
          },
        ],
      },
    ])
    await handleHostOp('ui.open', [{ id: 'kept' }], 'keep')
    expect(getShownPluginPane()?.id).toBe('kept')
    await closePluginPane()
    expect(getShownPluginPane()?.id).toBe('kept')
    setLoadedFunctionHooksModules([
      {
        name: 'pass',
        patterns: ['ui.close'],
        hooks: [
          {
            pattern: 'ui.close',
            hook: (_api, event, next) => next(event),
          },
        ],
      },
    ])
    await handleHostOp('ui.open', [{ id: 'gone' }], 'pass')
    await closePluginPane()
    expect(getShownPluginPane()).toBeUndefined()
  })

  test('$q isAhead is held vs rendered focus', async () => {
    const { pluginKeysAreAhead } = await import(
      '../../components/PluginRasterPanes.js'
    )
    const a = { plugin: 'p', handle: 1 }
    expect(
      pluginKeysAreAhead(
        { focused: a, select: null },
        { focused: a, select: null },
      ),
    ).toBe(false)
    expect(
      pluginKeysAreAhead(
        { focused: a, select: null },
        { focused: null, select: null },
      ),
    ).toBe(true)
  })

  test('jxr relative import loads; bare import is Cvo', async () => {
    const { acquirePluginClient } = await import(
      '../plugins/functionHooksClient.js'
    )
    const dir = mkdtempSync(join(tmpdir(), 'surf-jxr-'))
    const depPath = join(dir, 'dep.js')
    const boardPath = join(dir, 'board.js')
    writeFileSync(depPath, 'export const n = 1\n')
    const source = `import { n } from './dep.js'
export function Board() { return { type: 'Box', children: [String(n)] } }
`
    writeFileSync(boardPath, source)
    setLoadedFunctionHooksModules([
      {
        name: 'jxrplug',
        root: dir,
        patterns: [],
        hooks: [],
        surfaceModules: [
          {
            module: './board',
            modulePath: boardPath,
            component: 'Board',
            source,
          },
        ],
      },
    ])
    const instance = acquirePluginClient({
      plugin: 'jxrplug',
      key: 'k',
      module: './board',
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (instance.getSnapshot().status !== 'loading') break
    }
    const snap = instance.getSnapshot()
    expect(snap.status).toBe('drawn')
    if (snap.status === 'drawn') {
      expect(snap.tree).toEqual({ type: 'Box', children: ['1'] })
    }
    instance.release()
    const barePath = join(dir, 'bare.js')
    const bare = `import fs from 'fs'
export function Board() { return { type: 'Box' } }
`
    writeFileSync(barePath, bare)
    setLoadedFunctionHooksModules([
      {
        name: 'bareplug',
        root: dir,
        patterns: [],
        hooks: [],
        surfaceModules: [
          {
            module: './bare',
            modulePath: barePath,
            component: 'Board',
            source: bare,
          },
        ],
      },
    ])
    const bad = acquirePluginClient({
      plugin: 'bareplug',
      key: 'k',
      module: './bare',
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (bad.getSnapshot().status !== 'loading') break
    }
    const failed = bad.getSnapshot()
    expect(failed.status).toBe('failed')
    if (failed.status === 'failed') {
      expect(failed.text).toContain('cannot import "fs"')
      expect(failed.text).toContain('claude-code')
    }
    bad.release()
    const kitPath = join(dir, 'kit.js')
    const kit = `import { atom, read, update } from 'claude-code'
export function Board() {
  const a = atom(2)
  update(a, n => n + 1)
  return { type: 'Box', children: [String(read(a))] }
}
`
    writeFileSync(kitPath, kit)
    setLoadedFunctionHooksModules([
      {
        name: 'kitplug',
        root: dir,
        patterns: [],
        hooks: [],
        surfaceModules: [
          {
            module: './kit',
            modulePath: kitPath,
            component: 'Board',
            source: kit,
          },
        ],
      },
    ])
    const kitInst = acquirePluginClient({
      plugin: 'kitplug',
      key: 'k',
      module: './kit',
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (kitInst.getSnapshot().status !== 'loading') break
    }
    const kitSnap = kitInst.getSnapshot()
    expect(kitSnap.status).toBe('drawn')
    if (kitSnap.status === 'drawn') {
      expect(kitSnap.tree).toEqual({ type: 'Box', children: ['3'] })
    }
    const freezePath = join(dir, 'freeze.js')
    const freezeSrc = `import { atom, read } from 'claude-code'
export function Board() {
  const a = atom({ n: 1 })
  let froze = false
  try { a.get().n = 2 } catch { froze = true }
  return { type: 'Box', children: [String(read(a).n), froze ? 'frozen' : 'open'] }
}
`
    writeFileSync(freezePath, freezeSrc)
    setLoadedFunctionHooksModules([
      {
        name: 'freezeplug',
        root: dir,
        patterns: [],
        hooks: [],
        surfaceModules: [
          {
            module: './freeze',
            modulePath: freezePath,
            component: 'Board',
            source: freezeSrc,
          },
        ],
      },
    ])
    const freezeInst = acquirePluginClient({
      plugin: 'freezeplug',
      key: 'k',
      module: './freeze',
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (freezeInst.getSnapshot().status !== 'loading') break
    }
    const freezeSnap = freezeInst.getSnapshot()
    expect(freezeSnap.status).toBe('drawn')
    if (freezeSnap.status === 'drawn') {
      expect(freezeSnap.tree).toEqual({
        type: 'Box',
        children: ['1', 'frozen'],
      })
    }
    freezeInst.release()
    kitInst.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('$q contextNow XP maps Select to AbovePromptSelect', async () => {
    const { pluginFieldContext } = await import(
      '../../components/PluginRasterPanes.js'
    )
    expect(pluginFieldContext('Select', 'Pane')).toBe('AbovePromptSelect')
    expect(pluginFieldContext('Input', 'Pane')).toBe('AbovePromptInput')
    expect(pluginFieldContext(undefined, 'Pane')).toBe('Pane')
    const panes = readFileSync(
      join(import.meta.dir, '../../components/PluginRasterPanes.tsx'),
      'utf8',
    )
    expect(panes.includes('contextNow')).toBe(true)
    expect(panes.includes('contextRendered')).toBe(true)
  })

  test('Avo continues past a directory to index.js', async () => {
    const { acquirePluginClient } = await import(
      '../plugins/functionHooksClient.js'
    )
    const dir = mkdtempSync(join(tmpdir(), 'surf-avo-'))
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'index.js'), 'export const n = 8\n')
    const source = `import { n } from './sub'
export function Board() { return { type: 'Box', children: [String(n)] } }
`
    const boardPath = join(dir, 'board.js')
    writeFileSync(boardPath, source)
    setLoadedFunctionHooksModules([
      {
        name: 'avoplug',
        root: dir,
        patterns: [],
        hooks: [],
        surfaceModules: [
          {
            module: './board',
            modulePath: boardPath,
            component: 'Board',
            source,
          },
        ],
      },
    ])
    const instance = acquirePluginClient({
      plugin: 'avoplug',
      key: 'k',
      module: './board',
    })
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setImmediate(resolve))
      if (instance.getSnapshot().status !== 'loading') break
    }
    const snap = instance.getSnapshot()
    expect(snap.status).toBe('drawn')
    if (snap.status === 'drawn') {
      expect(snap.tree).toEqual({ type: 'Box', children: ['8'] })
    }
    instance.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('MNo rewrites Client module literals to posix plugin-root paths', async () => {
    const { rewriteClientModuleLiterals } = await import(
      '../plugins/functionHooksClient.js'
    )
    const root = '/plug'
    const file = join(root, 'hooks.js')
    const out = rewriteClientModuleLiterals(
      'Client({ module: "./board.tsx", key: "k" })',
      file,
      root,
    )
    expect(out).toContain('"board.tsx"')
    expect(out).not.toContain('"./board.tsx"')
    const nested = rewriteClientModuleLiterals(
      'h(Client, { module: "./nested.js" })',
      join(root, 'ui', 'pane.js'),
      root,
    )
    expect(nested).toContain('"ui/nested.js"')
    expect(
      rewriteClientModuleLiterals(
        'notClient({ module: "./board.tsx" })',
        file,
        root,
      ),
    ).toContain('"./board.tsx"')
    expect(
      rewriteClientModuleLiterals(
        '// Client\nconst x = { module: "./board.tsx" }',
        file,
        root,
      ),
    ).toContain('"./board.tsx"')
    expect(
      rewriteClientModuleLiterals(
        '/* Client({ module: "./board.tsx" }) */',
        file,
        root,
      ),
    ).toContain('"./board.tsx"')
    expect(
      rewriteClientModuleLiterals(
        'const u = "https://ex"; Client({ module: "./board.tsx" })',
        file,
        root,
      ),
    ).toContain('"board.tsx"')
    expect(
      rewriteClientModuleLiterals(
        'const s = "see // here"; Client({ module: "./board.tsx" })',
        file,
        root,
      ),
    ).toContain('"board.tsx"')
    expect(
      rewriteClientModuleLiterals(
        '// header\nClient({ module: "./board.tsx" })',
        file,
        root,
      ),
    ).toContain('"board.tsx"')
    expect(
      rewriteClientModuleLiterals(
        'const u = "https://ex"; // note\nClient({ module: "./board.tsx" })',
        file,
        root,
      ),
    ).toContain('"board.tsx"')
  })

  test('$q XP site is Pane vs AbovePrompt', async () => {
    const { pluginFieldContext } = await import(
      '../../components/PluginRasterPanes.js'
    )
    expect(pluginFieldContext(undefined, 'Pane')).toBe('Pane')
    expect(pluginFieldContext(undefined, 'AbovePrompt')).toBe('AbovePrompt')
    expect(pluginFieldContext('Input', 'AbovePrompt')).toBe('AbovePromptInput')
    expect(pluginFieldContext('Select', 'Pane')).toBe('AbovePromptSelect')
    const panes = readFileSync(
      join(import.meta.dir, '../../components/PluginRasterPanes.tsx'),
      'utf8',
    )
    expect(panes).toContain("'AbovePrompt'")
    expect(panes).toContain('bandInputFocusHost')
    expect(panes).toContain('function landBandInputFocus')
    expect(panes).not.toContain('bandFieldBridge')
    expect(panes).not.toContain('registerBandFieldBridge')
    expect(
      panes.includes(
        "rebuild(drawn, pane.plugin, pane.id, undefined, 'Pane', paneFocusables, paneSelect, paneInput)",
      ),
    ).toBe(true)
  })
})

describe('densable 2.1.289 ui.toast show + worker environments', () => {
  test('REPL wires budgets.toasts.show analog', () => {
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain('setUiToastShowHandler')
    expect(repl).toContain('$.ui.toast: shown as')
    expect(repl).toContain('plugin-toast-${randomUUID()}')
    expect(repl).toContain('timeoutMs: toast.timeoutMs ?? 4000')
    expect(repl).toContain('${toast.plugin}: ${toast.text}')
  })

  test('worker dispatch passes message.environments into the chain', () => {
    const worker = readFileSync(
      join(import.meta.dir, '../plugins/functionHooksWorker.ts'),
      'utf8',
    )
    const modules = readFileSync(
      join(import.meta.dir, '../plugins/functionHooksModules.ts'),
      'utf8',
    )
    expect(worker).toContain('message.environments')
    expect(modules).toContain(
      'environments !== undefined && !environments.includes(mod.name)',
    )
    expect(modules).toContain('HOOKS_WORKER_OVERRUN_CAP = 2')
    expect(modules).toContain('clearOverruns')
    expect(modules).toContain('this.overruns.delete(plugin)')
    expect(modules).toContain(
      'ignored its signal ${count} times in a row: a runaway plugin in the hooks worker',
    )
    expect(modules).toContain('job.failed.add(plugin)')
    expect(modules).toContain('job.environments.some')
    expect(modules).toContain('!job.failed.has(plugin)')
    expect(modules).toContain("message.type === 'hook_failed'")
    expect(worker).toContain("type: 'hook_failed'")
    expect(worker).toContain('setFunctionHooksHost')
    expect(worker).toContain('hookFailed:')
    expect(modules).toContain('the rest of its rewrite went on')
    expect(modules).toContain('hook skipped:')
    expect(modules).toContain('${event} hook:')
    expect(modules).toContain("event === 'engine.create'")
    expect(modules).toContain('if (s !== 1) return')
    expect(modules).toContain(
      "`${plugin}#${environmentId ?? ''} ${event} ${kind}`",
    )
    expect(modules).toContain('#${environmentId')
    expect(modules).toContain('skipPersistOnce')
    expect(modules).toContain('${plugin}: ${h}')
    expect(modules.indexOf('noteHookSkipFirst(report)')).toBeLessThan(
      modules.indexOf('job.failed.add(plugin)'),
    )
  })
})
