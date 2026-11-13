import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// Evaluate the real executor with inert boundaries: no settings, subprocesses,
// API calls, or process-global mock.module registrations are involved.
const source = readFileSync(new URL('../hooks.ts', import.meta.url), 'utf8')
const transpiler = new Bun.Transpiler({ loader: 'ts' })
const helpers = source.slice(
  source.indexOf('function classicResultFields('),
  source.indexOf('/**\n * densable 2.1.248 Eve'),
)
const executor = source.slice(
  source.indexOf('async function* executeHooks('),
  source.indexOf('export type HookOutsideReplResult'),
)

function harness(
  options: {
    type?: 'command' | 'agent' | 'prompt' | 'callback' | 'http' | 'mcp_tool'
    classic?: boolean
    rewrite?: Record<string, unknown>
    hookResult?: Record<string, unknown>
    callbackMetadata?: Record<string, unknown>
    managedHookResult?: Record<string, unknown>
    rawMcpResult?: Record<string, unknown>
  } = {},
) {
  const hook =
    options.type === 'command' || !options.type
      ? { type: 'command', command: 'never-spawned' }
      : { type: options.type, prompt: 'verify' }
  const managedHook = { type: 'callback', managed: true }
  let agentCalls = 0
  let httpTimeout: unknown
  let mcpArguments: unknown[] = []
  const globals = {
    TOOL_HOOK_EXECUTION_TIMEOUT_MS: 600000,
    shouldDisableAllHooksIncludingManaged: () => false,
    isEnvTruthy: () => false,
    process: { env: {} },
    hasMatchingFunctionHook: () => options.classic === true,
    runFunctionHookChain: async (
      _event: unknown,
      event: unknown,
      next: (value: unknown) => Promise<unknown>,
    ) => ({
      ...((await next(event)) as object),
      ...options.rewrite,
    }),
    stripEvalConfinedHookAllow: (value: unknown) => value,
    shouldSkipHookDueToTrust: () => false,
    getSessionId: () => 'main',
    getMatchingHooks: async (
      _state: unknown,
      _id: unknown,
      _event: unknown,
      _input: unknown,
      _tools: unknown,
      tiers: { managedHooksOnly?: boolean },
    ) =>
      tiers?.managedHooksOnly
        ? options.managedHookResult
          ? [{ hook: managedHook }]
          : []
        : [{ hook, ...options.callbackMetadata }],
    isInternalHook: () => false,
    getPluginHookCounts: () => undefined,
    getHookTypeCounts: () => ({}),
    logEvent: () => {},
    jsonStringify: JSON.stringify,
    isBetaTracingEnabled: () => false,
    startHookSpan: () => undefined,
    endHookSpan: () => {},
    getHookDisplayText: () => 'inert hook',
    randomUUID: () => 'isolated',
    logForDebugging: () => {},
    getStatsStore: () => undefined,
    addToTurnHookDuration: () => {},
    createCombinedAbortSignal: () => ({
      signal: new AbortController().signal,
      cleanup: () => {},
    }),
    createAttachmentMessage: (attachment: unknown) => ({
      type: 'attachment',
      attachment,
    }),
    execCommandHook: async () => ({
      status: 2,
      stdout: '',
      stderr: 'test-block',
      output: '',
    }),
    execPromptHook: async () => ({
      hook,
      outcome: 'success',
      ...options.hookResult,
    }),
    execAgentHook: async () => {
      agentCalls++
      return { hook, outcome: 'success' }
    },
    executeHookCallback: async ({ hook: calledHook }: { hook: unknown }) => ({
      hook: calledHook,
      outcome: 'success',
      ...(calledHook === managedHook
        ? options.managedHookResult
        : options.hookResult),
    }),
    execHttpHook: async (...args: unknown[]) => {
      httpTimeout = args[4]
      return { aborted: true }
    },
    execMcpToolHook: async (...args: unknown[]) => {
      mcpArguments = args
      return options.rawMcpResult ?? { ok: true, body: 'plain MCP response' }
    },
    emitHookStarted: () => {},
    emitHookResponse: () => {},
    parseHookOutput: (body: string) => {
      try {
        return { json: JSON.parse(body) }
      } catch {
        return {}
      }
    },
    isAsyncHookJSONOutput: (value: { async?: boolean }) => value.async === true,
    noteHookFailure: () => {},
    wwt: () => '',
    all: async function* (generators: AsyncGenerator[]) {
      for (const generator of generators) yield* generator
    },
    getSessionHookCallback: () => undefined,
    persistHookOutput: async (value: string) => value,
  }
  const execute = runInNewContext(
    transpiler.transformSync(
      helpers +
        source.slice(
          source.indexOf('function processHookJSONOutput('),
          source.indexOf(
            '\n/**',
            source.indexOf('function processHookJSONOutput('),
          ),
        ) +
        executor,
    ) + '\nexecuteHooks',
    globals,
  )
  return {
    agentCalls: () => agentCalls,
    httpTimeout: () => httpTimeout,
    mcpArguments: () => mcpArguments,
    async collect(agentId?: string, event = 'PreToolUse') {
      const results: Array<Record<string, unknown>> = []
      for await (const result of execute({
        hookInput: { hook_event_name: event, tool_name: 'Bash' },
        toolUseID: 'id',
        timeoutMs: 1234,
        toolUseContext: {
          agentId,
          getAppState: () => ({
            sessionHooks: new Map(),
            toolPermissionContext: { mode: 'default' },
          }),
          options: { tools: [], mcpClients: [] },
        },
      }))
        results.push(result)
      return results
    },
  }
}

describe('densable 289 hook dispatch', () => {
  test('HTTP gets the caller timeout and MCP helper receives execution context', async () => {
    const http = harness({ type: 'http' })
    await http.collect()
    expect(http.httpTimeout()).toBe(1234)
    const mcp = harness({ type: 'mcp_tool' })
    const results = await mcp.collect()
    expect(mcp.mcpArguments()).toHaveLength(6)
    expect(mcp.mcpArguments()[1]).toBe('PreToolUse')
    expect(mcp.mcpArguments()[3]).toEqual([])
    expect(mcp.mcpArguments()[5]).toBe(1234)
    expect(
      results.some(
        result =>
          (result.message as { attachment?: { stdout?: string } } | undefined)
            ?.attachment?.stdout === 'plain MCP response',
      ),
    ).toBe(true)
  })

  test('MCP raw JSON follows the shared output processing and withheld PreToolUse blocks', async () => {
    const instance = harness({
      type: 'mcp_tool',
      rawMcpResult: {
        ok: true,
        body: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            updatedToolOutput: false,
            classifierContext: 'mcp assertion',
          },
        }),
      },
    })
    const results = await instance.collect(undefined, 'PostToolUse')
    expect(results.some(result => result.updatedToolOutput === false)).toBe(
      true,
    )
    expect(results.find(result => result.classifierContexts)).toMatchObject({
      pairedRewrite: 'direct',
      classifierContexts: [{ value: 'mcp assertion', hostPrincipal: false }],
    })
    const withheld = await harness({
      type: 'mcp_tool',
      rawMcpResult: {
        ok: false,
        body: '',
        withheld: true,
        error: 'permission unavailable',
      },
    }).collect()
    expect(withheld.some(result => result.blockingError)).toBe(true)
  })

  test('JSON output preserves generic falsey values and marks legacy falsey rewrites suppressed', () => {
    const start = source.indexOf('function processHookJSONOutput(')
    const body = source.slice(start, source.indexOf('\n/**', start))
    const parse = runInNewContext(
      transpiler.transformSync(body) + '\nprocessHookJSONOutput',
      {
        createAttachmentMessage: (attachment: unknown) => ({
          type: 'attachment',
          attachment,
        }),
      },
    )
    for (const value of [null, false, 0, '']) {
      const result = parse({
        json: {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            updatedToolOutput: value,
            updatedMCPToolOutput: value,
            classifierContext: 'assertion',
          },
        },
        hookEvent: 'PostToolUse',
        hookName: 'PostToolUse:Bash',
        command: 'inert',
        toolUseID: 'id',
      })
      expect(result.updatedToolOutput).toBe(value)
      expect(result.updatedMCPToolOutput).toBeUndefined()
      expect(result.legacyMcpRewriteSuppressed).toBe(true)
      expect(result.classifierContext).toBe('assertion')
    }
  })

  test('command arguments and MCP input participate in equality', () => {
    const settings = readFileSync(
      new URL('../hooks/hooksSettings.ts', import.meta.url),
      'utf8',
    )
    const body = settings.slice(
      settings.indexOf('export function isHookEqual('),
      settings.indexOf('/** Get the display text'),
    )
    const equal = runInNewContext(
      transpiler.transformSync(body).replace('export ', '') + '\nisHookEqual',
      { DEFAULT_HOOK_SHELL: 'bash' },
    )
    expect(
      equal(
        { type: 'command', command: 'inert', args: ['one'] },
        { type: 'command', command: 'inert', args: ['two'] },
      ),
    ).toBe(false)
    expect(
      equal(
        { type: 'command', command: 'inert' },
        { type: 'command', command: 'inert', args: [] },
      ),
    ).toBe(false)
    expect(
      equal(
        {
          type: 'mcp_tool',
          server: 'local',
          tool: 'verify',
          input: { value: 1 },
        },
        {
          type: 'mcp_tool',
          server: 'local',
          tool: 'verify',
          input: { value: 2 },
        },
      ),
    ).toBe(false)
  })

  test('policy disableAll filters configured sources while retaining SDK callbacks', () => {
    const sdk = { type: 'callback' }
    const body = source.slice(
      source.indexOf('function getHooksConfig('),
      source.indexOf('/**\n * Lightweight existence check'),
    )
    const configure = runInNewContext(
      transpiler.transformSync(body) + '\ngetHooksConfig',
      {
        getSettingsForSource: () => ({ disableAllHooks: true }),
        shouldDisableAllHooksIncludingManaged: () => true,
        shouldAllowManagedHooksOnly: () => false,
        getHooksConfigFromSnapshot: () => ({
          Stop: [{ hooks: [{ type: 'command', command: 'inert' }] }],
        }),
        getRegisteredHooks: () => ({
          Stop: [
            { hooks: [sdk] },
            { pluginRoot: '/inert', hooks: [{ type: 'command' }] },
          ],
        }),
        getMainThreadAgentHooks: () => {
          throw new Error('frontmatter must be filtered')
        },
        getSessionHooks: () => {
          throw new Error('session hooks must be filtered')
        },
      },
    )
    expect(configure({}, 'main', 'Stop')).toEqual([{ hooks: [sdk] }])
  })

  test('five tool hook producers attach MCP metadata and post hooks carry duration', async () => {
    const producers =
      source.slice(
        source.indexOf('function getToolHookMcpMetadata('),
        source.indexOf('export async function executeNotificationHooks('),
      ) +
      source.slice(
        source.indexOf('export async function* executePermissionRequestHooks'),
        source.indexOf('export async function executeConfigChangeHooks'),
      )
    const captured: Array<Record<string, unknown>> = []
    const api = runInNewContext(
      transpiler.transformSync(producers).replaceAll('export ', '') +
        '\n({ executePreToolHooks, executePostToolHooks, executePostToolUseFailureHooks, executePermissionDeniedHooks, executePermissionRequestHooks })',
      {
        TOOL_HOOK_EXECUTION_TIMEOUT_MS: 600000,
        findToolByName: () => ({ mcpInfo: { serverName: 'sdk-server' } }),
        ownerOfPluginToolServerKey: () => undefined,
        createBaseHookInput: () => ({}),
        getSessionId: () => 'main',
        hasHookForEvent: () => true,
        logForDebugging: () => {},
        executeHooks: async function* ({
          hookInput,
        }: {
          hookInput: Record<string, unknown>
        }) {
          captured.push(hookInput)
          yield* []
        },
      },
    )
    const context = {
      getAppState: () => ({}),
      options: {
        tools: [],
        mcpClients: [{ name: 'sdk-server', config: { type: 'sdk' } }],
      },
    }
    const drain = async (generator: AsyncGenerator) => {
      for await (const _ of generator) {
      }
    }
    await drain(
      api.executePreToolHooks('mcp__sdk-server__verify', 'id', {}, context),
    )
    await drain(
      api.executePostToolHooks(
        'mcp__sdk-server__verify',
        'id',
        {},
        {},
        context,
        undefined,
        undefined,
        undefined,
        42,
      ),
    )
    await drain(
      api.executePostToolUseFailureHooks(
        'mcp__sdk-server__verify',
        'id',
        {},
        'failure',
        context,
        false,
        undefined,
        undefined,
        undefined,
        43,
      ),
    )
    await drain(
      api.executePermissionDeniedHooks(
        'mcp__sdk-server__verify',
        'id',
        {},
        'denied',
        context,
      ),
    )
    await drain(
      api.executePermissionRequestHooks(
        'mcp__sdk-server__verify',
        'id',
        {},
        context,
      ),
    )
    expect(captured).toHaveLength(5)
    for (const input of captured)
      expect(input.mcp_server).toEqual({ name: 'sdk-server', source: 'sdk' })
    expect(captured[1]?.duration_ms).toBe(42)
    expect(captured[2]?.duration_ms).toBe(43)
  })

  test('outside MCP invokes the raw helper without a tool context and retains no-context errors', async () => {
    const body = source.slice(
      source.indexOf('async function executeHooksOutsideREPL('),
      source.indexOf('export async function* executePreToolHooks'),
    )
    let args: unknown[] = []
    let raw: Record<string, unknown> = {
      ok: true,
      body: 'outside MCP response',
    }
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
          { hook: { type: 'mcp_tool', server: 'test', tool: 'verify' } },
        ],
        isInternalHook: () => false,
        getPluginHookCounts: () => undefined,
        getHookTypeCounts: () => ({}),
        logEvent: () => {},
        jsonStringify: JSON.stringify,
        getHookDisplayText: () => 'test/verify',
        logForDebugging: () => {},
        execMcpToolHook: async (...values: unknown[]) => {
          args = values
          return raw
        },
        parseHookOutput: () => ({}),
      },
    )
    const results = await outside({
      hookInput: { hook_event_name: 'SessionEnd' },
      timeoutMs: 4321,
    })
    expect(args[3]).toBeUndefined()
    expect(args[5]).toBe(4321)
    expect(results).toEqual([
      {
        command: 'test/verify',
        succeeded: true,
        output: 'outside MCP response',
        blocked: false,
      },
    ])
    raw = { ok: false, body: '', error: 'No MCP context available' }
    expect(
      await outside({
        hookInput: { hook_event_name: 'SessionEnd' },
        timeoutMs: 4321,
      }),
    ).toEqual([
      {
        command: 'test/verify',
        succeeded: false,
        output: 'No MCP context available',
        blocked: false,
      },
    ])
  })

  test('outside classic next preserves commands and permits a middleware block', async () => {
    const body = source.slice(
      source.indexOf('async function executeHooksOutsideREPL('),
      source.indexOf('export async function* executePreToolHooks'),
    )
    // The tail is empty in this fixture; classic must still run for classic-only events.
    let calls = 0
    const outside = runInNewContext(
      transpiler.transformSync(body) + '\nexecuteHooksOutsideREPL',
      {
        TOOL_HOOK_EXECUTION_TIMEOUT_MS: 600000,
        isEnvTruthy: () => false,
        process: { env: {} },
        shouldDisableAllHooksIncludingManaged: () => false,
        hasMatchingFunctionHook: () => true,
        runFunctionHookChain: async (
          _name: string,
          event: unknown,
          next: (input: unknown) => Promise<object>,
        ) => {
          calls++
          return { ...(await next(event)), block: 'middleware block' }
        },
        shouldSkipHookDueToTrust: () => false,
        getSessionId: () => 'main',
        getMatchingHooks: async () => [],
      },
    )
    const results = await outside({
      hookInput: { hook_event_name: 'SessionEnd' },
      timeoutMs: 100,
    })
    expect(calls).toBe(1)
    expect(results).toEqual([
      {
        command: 'classic.SessionEnd hook',
        succeeded: false,
        blocked: true,
        output: 'middleware block',
      },
    ])
  })
  test('classic next preserves the actual settings blocking result', async () => {
    const plain = await harness().collect()
    const chained = await harness({ classic: true }).collect()
    expect(plain.some(result => result.blockingError)).toBe(true)
    const stable = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, item) =>
          key === 'timestamp' ? undefined : item,
        ),
      )
    expect(stable(chained)).toEqual(stable(plain))
  })

  test('classic replaces only the fields changed after next', async () => {
    const results = await harness({
      type: 'callback',
      classic: true,
      hookResult: {
        additionalContext: 'original',
        updatedToolOutput: false,
        classifierContext: 'retained',
      },
      rewrite: { additionalContext: ['replacement'] },
    }).collect(undefined, 'PostToolUse')
    expect(
      results
        .filter(result => result.additionalContexts)
        .map(result => result.additionalContexts),
    ).toEqual([['replacement']])
    expect(results.some(result => result.updatedToolOutput === false)).toBe(
      true,
    )
    expect(results.some(result => result.classifierContexts)).toBe(true)
  })

  test('managed results survive middleware and managed denials cannot be bypassed', async () => {
    const denied = await harness({
      type: 'callback',
      classic: true,
      managedHookResult: {
        permissionBehavior: 'deny',
        hookPermissionDecisionReason: 'managed denial',
      },
      rewrite: { permissionDecision: 'allow' },
    }).collect()
    expect(denied.some(result => result.permissionBehavior === 'deny')).toBe(
      true,
    )
    expect(denied.some(result => result.permissionBehavior === 'allow')).toBe(
      false,
    )
    const contexts = await harness({
      type: 'callback',
      classic: true,
      managedHookResult: { additionalContext: 'managed' },
      hookResult: { additionalContext: 'core' },
    }).collect()
    expect(
      contexts
        .filter(result => result.additionalContexts)
        .map(result => result.additionalContexts),
    ).toEqual([['managed'], ['core']])
  })

  test('agent hooks execute without an unrelated messages argument', async () => {
    const instance = harness({ type: 'agent' })
    await instance.collect()
    expect(instance.agentCalls()).toBe(1)
  })

  test('hook-agent contexts cannot recursively launch prompt or agent hooks', async () => {
    for (const type of ['agent', 'prompt'] as const) {
      const instance = harness({ type })
      await instance.collect('hook-agent-parent', 'SubagentStop')
      expect(instance.agentCalls()).toBe(0)
    }
  })

  test('prompt impossible and timeout results retain their originating hook', async () => {
    const blocked = await harness({
      type: 'prompt',
      hookResult: {
        outcome: 'blocking',
        blockingError: { blockingError: 'unreachable', command: 'verify' },
        impossible: true,
      },
    }).collect(undefined, 'Stop')
    expect(blocked.find(result => result.blockingError)).toMatchObject({
      impossible: true,
      hook: { type: 'prompt', prompt: 'verify' },
    })
    const timedOut = await harness({
      type: 'prompt',
      hookResult: { outcome: 'cancelled' },
    }).collect(undefined, 'Stop')
    expect(timedOut.find(result => result.timedOut)).toMatchObject({
      hook: { type: 'prompt', prompt: 'verify' },
    })
  })

  test('PermissionRequest does not dispatch an unsupported agent hook', async () => {
    const instance = harness({ type: 'agent' })
    await instance.collect(undefined, 'PermissionRequest')
    expect(instance.agentCalls()).toBe(0)
  })

  test('generic falsey rewrites supersede legacy rewrites and pair classifier context', async () => {
    const results = await harness({
      type: 'callback',
      hookResult: {
        updatedToolOutput: null,
        updatedMCPToolOutput: 'legacy',
        classifierContext: 'assertion',
      },
    }).collect(undefined, 'PostToolUse')
    expect(
      results.some(
        result =>
          'updatedToolOutput' in result && result.updatedToolOutput === null,
      ),
    ).toBe(true)
    expect(results.some(result => 'updatedMCPToolOutput' in result)).toBe(false)
    expect(results.find(result => result.classifierContexts)).toMatchObject({
      pairedRewrite: 'direct',
      classifierContexts: [{ value: 'assertion', hostPrincipal: true }],
    })
  })

  test('plugin callbacks cannot claim host provenance and cap surrogate pairs safely', async () => {
    const results = await harness({
      type: 'callback',
      callbackMetadata: { pluginRoot: '/inert' },
      hookResult: {
        classifierContext: 'x'.repeat(1999) + String.fromCodePoint(0x1f430),
      },
    }).collect(undefined, 'PostToolUse')
    expect(results.find(result => result.classifierContexts)).toMatchObject({
      pairedRewrite: 'none',
      classifierContexts: [{ value: 'x'.repeat(1999), hostPrincipal: false }],
    })
  })
})
