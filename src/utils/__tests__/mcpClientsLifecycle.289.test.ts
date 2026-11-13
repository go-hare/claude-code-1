import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import {
  mergeClients,
  preferLiveMcpClients,
} from '../../hooks/useMergedClients.js'
import { McpSessionWiring } from '../sessionSlots.js'

const transpiler = new Bun.Transpiler({ loader: 'ts' })
const replSource = readFileSync(
  new URL('../../screens/REPL.tsx', import.meta.url),
  'utf8',
)
const printSource = readFileSync(
  new URL('../../cli/print.ts', import.meta.url),
  'utf8',
)
const helperSource = readFileSync(
  new URL('../hooks/execMcpToolHook.ts', import.meta.url),
  'utf8',
)

// Exercise the production lifecycle bodies and real accessor slot with inert
// network/React boundaries. No test calls registerClientsAccessor/acquire itself.
function runtime() {
  const wiring = new McpSessionWiring()
  let calls = 0
  let poll: (() => void) | undefined
  const session = {
    mcpSessionWiring: wiring,
    host: {
      mcpProcessWiring: {
        ensureConnectedClient: () => async (client: unknown) => client,
      },
    },
  }
  const connected = (name = 'server') => ({
    name,
    type: 'connected',
    config: { type: 'sdk' },
    capabilities: {},
    client: {
      callTool: async () => {
        calls++
        return { content: [{ type: 'text', text: 'verified' }] }
      },
    },
  })
  const helper = runInNewContext(
    transpiler
      .transformSync(
        helperSource.slice(helperSource.indexOf('const NON_BLOCKING_EVENTS')),
      )
      .replaceAll('export ', '') + '\nexecMcpToolHook',
    {
      getBootstrapSession: () => session,
      delay: async () => {
        poll?.()
      },
      getMcpTimeoutMs: () => 1000,
      isAccountMemoryTool: () => false,
      logForDebugging: () => {},
      errorMessage: (error: Error) => error.message,
      createCombinedAbortSignal: (signal?: AbortSignal) => ({
        signal: signal ?? new AbortController().signal,
        cleanup: () => {},
      }),
    },
  )
  return {
    wiring,
    session,
    connected,
    helper,
    calls: () => calls,
    setPoll: (value: () => void) => {
      poll = value
    },
  }
}

function mountRepl(
  env: ReturnType<typeof runtime>,
  initialMcpClients: unknown[] | undefined,
  getClients: () => unknown[],
) {
  const start = replSource.indexOf(
    '  useEffect(() => {',
    replSource.indexOf('  const store = useAppStateStore();'),
  )
  const end =
    replSource.indexOf('  }, [initialMcpClients, store]);', start) +
    '  }, [initialMcpClients, store]);'.length
  let release: (() => void) | undefined
  runInNewContext(transpiler.transformSync(replSource.slice(start, end)), {
    useEffect: (mount: () => () => void) => {
      release = mount()
    },
    require: () => ({ getBootstrapSession: () => env.session }),
    store: { getState: () => ({ mcp: { clients: getClients() } }) },
    initialMcpClients,
    mergeClients,
    preferLiveMcpClients,
  })
  return () => release?.()
}

function startPrint(
  env: ReturnType<typeof runtime>,
  getClients: () => unknown[],
) {
  const start = printSource.indexOf('  let dynamicMcpState: DynamicMcpState =')
  const end = printSource.indexOf('  // densable 2.1.243 #11', start)
  const production = printSource.slice(start, end)
  const cleanups: Array<() => void> = []
  return runInNewContext(
    transpiler.transformSync(production) +
      '\n({ replaceDynamic: clients => { dynamicMcpState = { ...dynamicMcpState, clients } }, close: () => cleanups.forEach(cleanup => cleanup()) })',
    {
      getBootstrapSession: () => env.session,
      getAppState: () => ({ mcp: { clients: getClients() } }),
      preferLiveMcpClients,
      registerCleanup: (cleanup: () => void) => {
        cleanups.push(cleanup)
      },
      cleanups,
    },
  ) as { replaceDynamic: (clients: unknown[]) => void; close: () => void }
}

describe('MCP default clients accessor lifecycle', () => {
  test('preferLiveMcpClients keeps the live connected client over a stale pending', () => {
    const pending = { name: 'server', type: 'pending' } as never
    const live = { name: 'server', type: 'connected' } as never
    expect(preferLiveMcpClients([live], [pending])).toEqual([live])
    expect(preferLiveMcpClients([], [pending])).toEqual([pending])
    expect(preferLiveMcpClients([live], [])).toEqual([live])
  })

  test('the production REPL effect acquires and releases through actual React mount', async () => {
    const React = await import('react')
    const { wrappedRender } = await import('@anthropic/ink')
    const { PassThrough } = await import('node:stream')
    const env = runtime()
    let clients: unknown[] = [{ name: 'server', type: 'pending' }]
    const start = replSource.indexOf(
      '  useEffect(() => {',
      replSource.indexOf('  const store = useAppStateStore();'),
    )
    const end =
      replSource.indexOf('  }, [initialMcpClients, store]);', start) +
      '  }, [initialMcpClients, store]);'.length
    let mounted!: () => void
    const ready = new Promise<void>(resolve => {
      mounted = resolve
    })
    const Probe = runInNewContext(
      transpiler.transformSync(
        'function Probe() {\n' +
          replSource.slice(start, end) +
          '\nuseEffect(() => { mounted() }, []); return null\n}',
      ) + '\nProbe',
      {
        useEffect: React.useEffect,
        mounted,
        require: () => ({ getBootstrapSession: () => env.session }),
        store: { getState: () => ({ mcp: { clients } }) },
        initialMcpClients: [],
        mergeClients,
        preferLiveMcpClients,
      },
    )
    const instance = await wrappedRender(React.createElement(Probe), {
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      patchConsole: false,
    })
    try {
      await ready
      env.setPoll(() => {
        clients = [env.connected()]
      })
      expect(
        (
          await env.helper(
            { type: 'mcp_tool', server: 'server', tool: 'verify' },
            'PreToolUse',
            '{}',
          )
        ).ok,
      ).toBe(true)
    } finally {
      instance.unmount()
    }
    expect(env.wiring.clientsFromAccessor()).toBeUndefined()
  })

  test('REPL mount follows pending to connected and releases on unmount', async () => {
    const env = runtime()
    let clients: unknown[] = [{ name: 'server', type: 'pending' }]
    const unmount = mountRepl(env, [], () => clients)
    env.setPoll(() => {
      clients = [env.connected()]
    })
    expect(
      await env.helper(
        { type: 'mcp_tool', server: 'server', tool: 'verify' },
        'PreToolUse',
        '{}',
      ),
    ).toEqual({ ok: true, body: 'verified' })
    expect(env.calls()).toBe(1)
    unmount()
    expect(env.wiring.clientsFromAccessor()).toBeUndefined()
    expect(
      (
        await env.helper(
          { type: 'mcp_tool', server: 'server', tool: 'verify' },
          'SessionEnd',
          '{}',
        )
      ).error,
    ).toContain('no MCP client context')
  })

  test('REPL prefers current store over stale initial clients and tolerates absent initial clients', async () => {
    for (const initial of [undefined, [{ name: 'server', type: 'pending' }]]) {
      const env = runtime()
      const live = env.connected()
      const unmount = mountRepl(env, initial, () => [live])
      expect(env.wiring.clientsFromAccessor()).toEqual([live])
      expect(
        (
          await env.helper(
            { type: 'mcp_tool', server: 'server', tool: 'verify' },
            'PreToolUse',
            '{}',
          )
        ).ok,
      ).toBe(true)
      unmount()
    }
  })

  test('headless run accessor follows app and dynamic replacements and cleanup releases ownership', async () => {
    const env = runtime()
    let clients: unknown[] = [{ name: 'server', type: 'pending' }]
    const run = startPrint(env, () => clients)
    env.setPoll(() => {
      clients = [env.connected()]
    })
    expect(
      (
        await env.helper(
          { type: 'mcp_tool', server: 'server', tool: 'verify' },
          'PreToolUse',
          '{}',
        )
      ).ok,
    ).toBe(true)
    run.replaceDynamic([env.connected('dynamic')])
    expect(
      (
        await env.helper(
          { type: 'mcp_tool', server: 'dynamic', tool: 'verify' },
          'SessionEnd',
          '{}',
        )
      ).ok,
    ).toBe(true)
    run.replaceDynamic([])
    expect(
      (
        await env.helper(
          { type: 'mcp_tool', server: 'dynamic', tool: 'verify' },
          'SessionEnd',
          '{}',
        )
      ).ok,
    ).toBe(false)
    run.close()
    expect(env.wiring.clientsFromAccessor()).toBeUndefined()
    const later = startPrint(env, () => [env.connected('later')])
    expect(
      (
        await env.helper(
          { type: 'mcp_tool', server: 'later', tool: 'verify' },
          'SessionEnd',
          '{}',
        )
      ).ok,
    ).toBe(true)
    later.close()
  })

  test('outside hooks use their own app state with the real helper when another session owns the accessor', async () => {
    const env = runtime()
    const unmount = mountRepl(env, [], () => [env.connected('other-session')])
    const hooks = readFileSync(new URL('../hooks.ts', import.meta.url), 'utf8')
    const body = hooks.slice(
      hooks.indexOf('async function executeHooksOutsideREPL('),
      hooks.indexOf('export async function* executePreToolHooks'),
    )
    const outside = runInNewContext(
      transpiler.transformSync(body) + '\nexecuteHooksOutsideREPL',
      {
        TOOL_HOOK_EXECUTION_TIMEOUT_MS: 600000,
        isEnvTruthy: () => false,
        process: { env: {} },
        shouldDisableAllHooksIncludingManaged: () => false,
        hasMatchingFunctionHook: () => false,
        shouldSkipHookDueToTrust: () => false,
        getSessionId: () => 'main',
        getMatchingHooks: async () => [
          { hook: { type: 'mcp_tool', server: 'own-session', tool: 'verify' } },
        ],
        isInternalHook: () => false,
        getPluginHookCounts: () => undefined,
        getHookTypeCounts: () => ({}),
        logEvent: () => {},
        jsonStringify: JSON.stringify,
        getHookDisplayText: () => 'own-session/verify',
        logForDebugging: () => {},
        execMcpToolHook: env.helper,
        parseHookOutput: () => ({}),
      },
    )
    const results = await outside({
      hookInput: { hook_event_name: 'SessionEnd' },
      timeoutMs: 1000,
      getAppState: () => ({ mcp: { clients: [env.connected('own-session')] } }),
    })
    expect(results).toEqual([
      {
        command: 'own-session/verify',
        succeeded: true,
        blocked: false,
        output: 'verified',
      },
    ])
    expect(env.calls()).toBe(1)
    unmount()
  })

  test('a nested lifecycle cannot clear the owning accessor', () => {
    const env = runtime()
    const live = env.connected()
    const unmount = mountRepl(env, [], () => [live])
    const nested = startPrint(env, () => [])
    nested.close()
    expect(env.wiring.clientsFromAccessor()).toEqual([live])
    unmount()
    expect(env.wiring.clientsFromAccessor()).toBeUndefined()
  })
})
