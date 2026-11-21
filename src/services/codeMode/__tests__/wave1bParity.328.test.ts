import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPLTool } from '@claude-code/builtin-tools/tools/REPLTool/REPLTool.js'
import { REPL_TOOL_NAME } from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolUseContext,
} from '../../../Tool.js'
import {
  recordPluginToolListAnswer,
  resetPluginToolListState,
} from '../../../utils/plugins/pluginToolList.js'
import { runWithAgentContext } from '../../../utils/agentContext.js'
import { CODE_MODE_ENV_VAR, REPL_MAIN_THREAD_KEY } from '../constants.js'
import {
  CODE_MODE_HOOK_REWRITE_REFUSAL,
  CODE_MODE_UNICODE_ESCAPE_REFUSAL,
  clearCodeModeVmSession,
  endMainThreadConversation,
  endSubagentRepl,
  executeCodeModeScript,
  getCodeModeAutoVerdictTracker,
  hasUnicodeHexEscape,
  planCodeModeFromSession,
  resetCodeModeRuntimeStateForTests,
  resolveCodeModeEffectiveTools,
  wrapReplToolForCodeMode,
} from '../executor.js'
import {
  doesEngineResultHold,
  engineCheckResult,
  isAsyncReplEnabled,
  isCodeModeEnabled,
  markPollEventWiringForTerminalRun,
  resetCodeModeOptInStateForTests,
  resolveCodeModePrimitiveTools,
  runReplEngineRealmCheck,
  setEngineCheckResultForTests,
  setStandaloneExecutableForTests,
  settleCodeModeOptIn,
  settleCodeModeOptInAtStartup,
} from '../optIn.js'
import {
  formatReplOutputEnvelope,
  lingerForAsyncReplEvents,
  ReplSessions,
  resetReplSessionsForTests,
  waitForNews,
} from '../replSessions.js'

function makeTool(name: string, extra: Partial<Tool> = {}): Tool {
  return {
    name,
    inputSchema: {
      safeParse: (v: unknown) => ({ success: true as const, data: v }),
    },
    description: async () => `${name} description`,
    prompt: async () => `${name} prompt`,
    isEnabled: () => true,
    isConcurrencySafe: () => true,
    isReadOnly: () => name === 'Read' || name === 'Grep' || name === 'Glob',
    userFacingName: () => name,
    call: async () => ({ data: `${name}:ok` }),
    ...extra,
  } as unknown as Tool
}

function makeCtx(
  opts: {
    mode?: 'default' | 'auto' | 'bypassPermissions' | 'plan'
    agentId?: string
    tools?: Tool[]
    mcpTools?: Tool[]
    restricted?: boolean
    toolsKeptByLaunchList?: readonly string[]
    alwaysDenyRules?: Record<string, string[]>
    activeAgents?: Array<{
      agentType: string
      tools?: string[]
      disallowedTools?: string[]
    }>
    autoModeScriptCheckDeferred?: boolean
    inputChangedByHook?: boolean
    serverClassifierInputRewritten?: boolean
  } = {},
): ToolUseContext {
  const permCtx = {
    ...getEmptyToolPermissionContext(),
    mode: opts.mode ?? 'default',
    alwaysDenyRules: opts.alwaysDenyRules ?? {},
    ...(opts.restricted !== undefined ? { restricted: opts.restricted } : {}),
    ...(opts.toolsKeptByLaunchList !== undefined
      ? { toolsKeptByLaunchList: opts.toolsKeptByLaunchList }
      : {}),
  }
  const state = {
    mcp: { tools: opts.mcpTools ?? [], clients: [] },
    toolPermissionContext: permCtx,
    sessionHooks: new Map(),
  }
  return {
    agentId: opts.agentId,
    toolUseId: `toolu_${opts.agentId ?? 'main'}`,
    abortController: new AbortController(),
    options: {
      tools: opts.tools ?? [],
      agentDefinitions: {
        activeAgents: opts.activeAgents ?? [],
        allAgents: opts.activeAgents ?? [],
      },
    },
    getAppState: () => state,
    setAppState: () => {},
    ...(opts.autoModeScriptCheckDeferred
      ? { autoModeScriptCheckDeferred: true }
      : {}),
    ...(opts.inputChangedByHook ? { inputChangedByHook: true } : {}),
    ...(opts.serverClassifierInputRewritten
      ? { serverClassifierInputRewritten: true }
      : {}),
  } as unknown as ToolUseContext
}

afterEach(() => {
  resetCodeModeOptInStateForTests()
  resetCodeModeRuntimeStateForTests()
  resetReplSessionsForTests()
  clearCodeModeVmSession()
  resetPluginToolListState()
  delete process.env[CODE_MODE_ENV_VAR]
  delete process.env.CLAUDE_CODE_ASYNC_REPL
})

describe('Wave 1B Parity (Official 2.1.328)', () => {
  test('P0-11: REPLTool.checkPermissions returns passthrough in auto mode and allow otherwise', async () => {
    const input = { code: '1 + 1' }
    const autoRes = await REPLTool.checkPermissions(
      input,
      makeCtx({ mode: 'auto' }),
    )
    expect(autoRes).toEqual({
      behavior: 'passthrough',
      message: `${REPL_TOOL_NAME} script requires classifier review.`,
    })

    for (const mode of ['default', 'bypassPermissions', 'plan'] as const) {
      const res = await REPLTool.checkPermissions(input, makeCtx({ mode }))
      expect(res).toEqual({
        behavior: 'allow',
        updatedInput: input,
      })
    }
  })

  test('P0-11: wrapReplToolForCodeMode refuses \\uXXXX escapes and hook rewrites in auto mode, and checks deferred/unchecked scripts', async () => {
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })

    expect(hasUnicodeHexEscape('const x = "\\u0061"')).toBe(true)
    // Official ilo() explicitly allows \u{...} code-point escapes and \xNN
    expect(hasUnicodeHexEscape('const x = "\\u{1f600}"')).toBe(false)
    expect(hasUnicodeHexEscape('const x = "plain ascii"')).toBe(false)

    const echoTool = makeTool('Echo')
    const wrapped = wrapReplToolForCodeMode(REPLTool, () => [echoTool])

    // 1. \uXXXX refused in auto mode (both checkPermissions and call)
    const unicodeCheck = await wrapped.checkPermissions?.(
      { code: 'const x = "\\u0061"; x' },
      makeCtx({ mode: 'auto', tools: [echoTool] }),
    )
    expect(unicodeCheck?.behavior).toBe('deny')
    if (unicodeCheck?.behavior === 'deny') {
      expect(unicodeCheck.message).toBe(CODE_MODE_UNICODE_ESCAPE_REFUSAL)
    }

    let innerCalled = false
    const unicodeCall = (await wrapped.call(
      { code: 'const x = "\\u0061"; await callTool("Echo", {}); x' },
      makeCtx({ mode: 'auto', tools: [echoTool] }),
      (async (_t: unknown, inp: unknown) => {
        innerCalled = true
        return { behavior: 'allow', updatedInput: inp }
      }) as never,
      { message: { id: 'm-u1' } } as never,
    )) as { data: { result: string } }
    expect(innerCalled).toBe(false)
    expect(unicodeCall.data.result).toContain(CODE_MODE_UNICODE_ESCAPE_REFUSAL)

    // Allowed in default mode
    const unicodeDefaultCheck = await wrapped.checkPermissions?.(
      { code: 'const x = "\\u0061"; x' },
      makeCtx({ mode: 'default', tools: [echoTool] }),
    )
    expect(unicodeDefaultCheck?.behavior).toBe('allow')

    // 2. Hook rewrite refused in auto mode
    const hookRewriteCheck = await wrapped.checkPermissions?.(
      { code: '1 + 1' },
      makeCtx({
        mode: 'auto',
        tools: [echoTool],
        inputChangedByHook: true,
      }),
    )
    expect(hookRewriteCheck?.behavior).toBe('deny')
    if (hookRewriteCheck?.behavior === 'deny') {
      expect(hookRewriteCheck.message).toBe(CODE_MODE_HOOK_REWRITE_REFUSAL)
    }

    const hookRewriteCall = (await wrapped.call(
      { code: 'await callTool("Echo", {})' },
      makeCtx({
        mode: 'auto',
        tools: [echoTool],
        serverClassifierInputRewritten: true,
      }),
      (async (_t: unknown, inp: unknown) => ({
        behavior: 'allow',
        updatedInput: inp,
      })) as never,
      { message: { id: 'm-u2' } } as never,
    )) as { data: { result: string } }
    expect(hookRewriteCall.data.result).toContain(
      CODE_MODE_HOOK_REWRITE_REFUSAL,
    )

    // 3. Deferred check passes wrapped REPL tool (with checkPermissions) into canUseTool
    const checkedToolNames: string[] = []
    let sawWrappedPermNote = false
    await wrapped.call(
      { code: 'return await callTool("Echo", {});' },
      makeCtx({
        mode: 'auto',
        tools: [echoTool],
        autoModeScriptCheckDeferred: true,
      }),
      (async (
        tool: Tool,
        inp: Record<string, unknown>,
        ctx: ToolUseContext,
      ) => {
        if (ctx.replScriptCheckNow) {
          checkedToolNames.push(tool.name)
          sawWrappedPermNote = typeof tool.permissionNote === 'function'
          return {
            behavior: 'allow',
            updatedInput: inp,
            decisionReason: {
              type: 'classifier',
              classifier: 'auto',
              reason: 'ok',
            },
          }
        }
        return { behavior: 'allow', updatedInput: inp }
      }) as never,
      { message: { id: 'm-u3' } } as never,
    )
    expect(checkedToolNames).toEqual([REPL_TOOL_NAME])
    expect(sawWrappedPermNote).toBe(true)
  })

  test('P0-12: AsyncLocalStorage isolates concurrent detached evals on the SAME VM sessionKey with zero global clobbering', async () => {
    const eval1Calls: string[] = []
    const eval2Calls: string[] = []
    let releaseEval1!: () => void
    const eval1Gate = new Promise<void>(resolve => {
      releaseEval1 = resolve
    })
    let eval1EnteredTool!: () => void
    const eval1InTool = new Promise<void>(resolve => {
      eval1EnteredTool = resolve
    })

    const eval1Promise = executeCodeModeScript({
      sessionKey: 'als-shared-vm',
      allowedTools: new Set(['SlowTool', 'OnlyEval1']),
      code: `
        const sharedFromEval1 = 42;
        console.log('eval1-start');
        let timerFired = false;
        setTimeout(() => { timerFired = true; }, 15);
        await callTool('SlowTool', {});
        const only1 = await callTool('OnlyEval1', {});
        console.log('eval1-end');
        return { only1, timerFired, listed: tools.list() };
      `,
      invokeTool: async name => {
        eval1Calls.push(name)
        if (name === 'SlowTool') {
          eval1EnteredTool()
          await eval1Gate
          return 'slow-ok'
        }
        return `e1:${name}`
      },
    })

    // Wait until Eval 1 is suspended inside `await callTool('SlowTool')`
    await eval1InTool

    // Run Eval 2 concurrently on the EXACT SAME `sessionKey`!
    const eval2Res = await executeCodeModeScript({
      sessionKey: 'als-shared-vm',
      allowedTools: new Set(['FastTool', 'OnlyEval2']),
      code: `
        console.log('eval2-start');
        const fast = await callTool('FastTool', {});
        const only2 = await callTool('OnlyEval2', {});
        let deniedEval1Tool = '';
        try {
          await callTool('OnlyEval1', {});
        } catch (e) {
          deniedEval1Tool = e.message;
        }
        console.log('eval2-end');
        return {
          sharedFromEval1,
          fast,
          only2,
          deniedEval1Tool,
          listed: tools.list(),
        };
      `,
      invokeTool: async name => {
        eval2Calls.push(name)
        await new Promise(r => setTimeout(r, 10))
        return `e2:${name}`
      },
    })

    // Eval 2 finished while Eval 1 is still awaiting SlowTool.
    // Let Eval 1's timer settle and release SlowTool.
    await new Promise(r => setTimeout(r, 30))
    releaseEval1()
    const eval1Res = await eval1Promise

    // Both saw ONLY their own logs and ONLY their own invokeTool callbacks
    expect(eval1Calls).toEqual(['SlowTool', 'OnlyEval1'])
    expect(eval2Calls).toEqual(['FastTool', 'OnlyEval2'])

    expect(eval1Res.result).toContain('eval1-start')
    expect(eval1Res.result).toContain('eval1-end')
    expect(eval1Res.result).not.toContain('eval2-')
    expect(eval1Res.result).toContain('"only1": "e1:OnlyEval1"')
    expect(eval1Res.result).toContain('"timerFired": true')
    expect(eval1Res.result).toContain('"OnlyEval1"')
    expect(eval1Res.result).not.toContain('"OnlyEval2"')

    expect(eval2Res.result).toContain('eval2-start')
    expect(eval2Res.result).toContain('eval2-end')
    expect(eval2Res.result).not.toContain('eval1-')
    expect(eval2Res.result).toContain('"sharedFromEval1": 42')
    expect(eval2Res.result).toContain('"only2": "e2:OnlyEval2"')
    expect(eval2Res.result).toContain(
      'Tool not available in Code Mode: OnlyEval1',
    )
    expect(eval2Res.result).toContain('"OnlyEval2"')
    expect(eval2Res.result).not.toContain('"OnlyEval1"')
  })

  test('P1-#34: resolveCodeModeEffectiveTools enforces --tools, --restricted, plugin tool.list, org-blocked MCP, and subagent scoped disallowedTools', async () => {
    const readTool = makeTool('Read')
    const writeTool = makeTool('Write')
    const bashTool = makeTool('Bash', {
      enablesCodeExecution: true,
    } as Partial<Tool>)
    const grepTool = makeTool('Grep')
    const webFetchTool = makeTool('WebFetch')
    const liveMcpOk = makeTool('mcp__good__ping', { isMcp: true })
    const liveMcpBlocked = makeTool('mcp__orgbad__exec', {
      isMcp: true,
      mcpInfo: {
        serverName: 'orgbad',
        toolName: 'exec',
        effectiveMaxPermission: 'blocked',
      },
    } as Partial<Tool>)
    const liveMcpDenied = makeTool('mcp__danger__drop', { isMcp: true })
    const allBase = [readTool, writeTool, bashTool, grepTool, webFetchTool]

    // 1. --tools launch list restricts available tools
    const byLaunchList = resolveCodeModeEffectiveTools(
      REPL_TOOL_NAME,
      () => allBase,
      makeCtx({
        toolsKeptByLaunchList: Object.freeze(['Read', 'Grep']),
        mcpTools: [liveMcpOk, liveMcpBlocked],
      }),
    )
    expect(byLaunchList.map(t => t.name)).toEqual([
      'Read',
      'Grep',
      'mcp__good__ping',
    ])

    // 2. --restricted removes code-execution & WebFetch tools
    const byRestricted = resolveCodeModeEffectiveTools(
      REPL_TOOL_NAME,
      () => allBase,
      makeCtx({ restricted: true }),
    )
    expect(byRestricted.map(t => t.name)).not.toContain('Bash')
    expect(byRestricted.map(t => t.name)).not.toContain('WebFetch')
    expect(byRestricted.map(t => t.name)).toContain('Read')
    expect(byRestricted.map(t => t.name)).toContain('Grep')

    // 3. Plugin tool.list filter removes tools cleanly
    recordPluginToolListAnswer(
      ['Read', 'Write', 'Bash', 'Grep'],
      ['Read', 'Write', 'Bash'],
    )
    const byPlugin = resolveCodeModeEffectiveTools(
      REPL_TOOL_NAME,
      () => allBase,
      makeCtx({ mcpTools: [liveMcpOk, liveMcpBlocked] }),
    )
    expect(byPlugin.map(t => t.name)).not.toContain('Grep')
    expect(byPlugin.map(t => t.name)).not.toContain('mcp__orgbad__exec')
    expect(byPlugin.map(t => t.name)).toContain('mcp__good__ping')
    resetPluginToolListState()

    // 4. Subagent with scoped disallowedTools ("Bash(rm:*)") keeps Bash,
    // drops whole-tool "Write" and MCP server "mcp__danger", and includes liveMcpOk
    const subagentTools = runWithAgentContext(
      {
        agentId: 'sub-1',
        agentType: 'subagent',
        subagentName: 'custom-worker',
      },
      () =>
        resolveCodeModeEffectiveTools(
          REPL_TOOL_NAME,
          () => allBase,
          makeCtx({
            agentId: 'sub-1',
            mcpTools: [liveMcpOk, liveMcpBlocked, liveMcpDenied],
            activeAgents: [
              {
                agentType: 'custom-worker',
                disallowedTools: ['Bash(rm:*)', 'Write', 'mcp__danger'],
              },
            ],
          }),
        ),
    )
    const subNames = subagentTools.map(t => t.name)
    expect(subNames).toContain('Bash')
    expect(subNames).toContain('Read')
    expect(subNames).toContain('Grep')
    expect(subNames).toContain('mcp__good__ping')
    expect(subNames).not.toContain('Write')
    expect(subNames).not.toContain('mcp__orgbad__exec')
    expect(subNames).not.toContain('mcp__danger__drop')

    // 5. src/tools.ts primitive resolver filters org-blocked MCP & deny rules
    await import('../../../tools.js')
    const resolvedPrimitives = resolveCodeModePrimitiveTools(
      [readTool, liveMcpOk, liveMcpBlocked],
      {
        ...getEmptyToolPermissionContext(),
        alwaysDenyRules: { userSettings: ['Read'] },
      },
    )
    expect(resolvedPrimitives.map(t => t.name)).toContain('mcp__good__ping')
    expect(resolvedPrimitives.map(t => t.name)).not.toContain('Read')
    expect(resolvedPrimitives.map(t => t.name)).not.toContain(
      'mcp__orgbad__exec',
    )
  })

  test('P1-#35: engineCheckResult has no silent coercion, honors standalone executable override (vh), and removes CLAUDE_CODE_ASYNC_REPL', async () => {
    const raw = runReplEngineRealmCheck()
    expect(engineCheckResult()).toBe(raw)

    // Force non-passed realm probe -> refused with 'engine' and disabled
    setEngineCheckResultForTests('both')
    expect(doesEngineResultHold('both')).toBe(true)
    const refused = await settleCodeModeOptInAtStartup({
      env: { [CODE_MODE_ENV_VAR]: '1' },
      shellEnv: { [CODE_MODE_ENV_VAR]: '1' },
      isFirstPartyProvider: true,
      isModelSupported: true,
      hasFeatureFlags: true,
      isGateOpen: true,
      caveatsAccepted: true,
    })
    expect(refused).toEqual({ state: 'refused', why: 'engine' })
    expect(isCodeModeEnabled()).toBe(false)

    // Standalone executable override (official vh()) lifts holdoff
    resetCodeModeOptInStateForTests()
    setEngineCheckResultForTests('both')
    setStandaloneExecutableForTests(true)
    expect(doesEngineResultHold('both')).toBe(false)
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    expect(isCodeModeEnabled()).toBe(true)

    // CLAUDE_CODE_ASYNC_REPL is NOT honored
    markPollEventWiringForTerminalRun()
    expect(isAsyncReplEnabled()).toBe(true)
    process.env.CLAUDE_CODE_ASYNC_REPL = '0'
    expect(isAsyncReplEnabled()).toBe(true)
    resetCodeModeOptInStateForTests()
    process.env.CLAUDE_CODE_ASYNC_REPL = '1'
    expect(isAsyncReplEnabled()).toBe(false)
  })

  test('P1-#36: endMainThreadConversation clears ONLY main VM/queue/tracker while preserving subagents, and endSubagentRepl isolates per agentId', async () => {
    await executeCodeModeScript({
      sessionKey: REPL_MAIN_THREAD_KEY,
      code: 'const mainSecret = 111;',
      invokeTool: async () => ({}),
    })
    await executeCodeModeScript({
      sessionKey: 'sub-alpha',
      code: 'const alphaSecret = 222;',
      invokeTool: async () => ({}),
    })
    await executeCodeModeScript({
      sessionKey: 'sub-beta',
      code: 'const betaSecret = 333;',
      invokeTool: async () => ({}),
    })

    const tracker = getCodeModeAutoVerdictTracker()
    tracker.registerScript('tu-main-1')
    tracker.addDeferredCheck({
      id: 'tu-main-1',
      code: '1+1',
      toolUseId: 'tu-main-1',
      runCheck: async () => ({ behavior: 'allow', updatedInput: {} }),
      stop: () => {},
    })
    expect(tracker.inUse()).toBe(true)
    expect(tracker.getRecord('tu-main-1')).toBeDefined()

    const queued = [
      {
        mode: 'poll-event',
        pollEvent: { kind: 'repl-eval', envelope: '<repl-output eval="1"/>' },
      },
      {
        mode: 'poll-event',
        agentId: 'sub-alpha',
        pollEvent: { kind: 'repl-eval', envelope: '<repl-output eval="2"/>' },
      },
      {
        mode: 'poll-event',
        agentId: 'sub-beta',
        pollEvent: { kind: 'repl-eval', envelope: '<repl-output eval="3"/>' },
      },
    ]
    const queueOverride = {
      removeByFilter: (
        predicate: (cmd: (typeof queued)[number]) => boolean,
      ) => {
        const removed: typeof queued = []
        for (let i = queued.length - 1; i >= 0; i--) {
          if (predicate(queued[i]!)) {
            removed.push(queued.splice(i, 1)[0]!)
          }
        }
        return removed
      },
    }

    // Main-thread clear MUST NOT disturb sub-alpha or sub-beta
    endMainThreadConversation('the conversation was cleared', [], queueOverride)
    expect(tracker.inUse()).toBe(false)
    expect(tracker.getRecord('tu-main-1')).toBeUndefined()
    expect(queued.map(q => q.agentId)).toEqual(['sub-alpha', 'sub-beta'])

    const mainAfter = await executeCodeModeScript({
      sessionKey: REPL_MAIN_THREAD_KEY,
      code: 'mainSecret',
      invokeTool: async () => ({}),
    })
    expect(mainAfter.result).toContain('ReferenceError')

    const alphaAfterMainClear = await executeCodeModeScript({
      sessionKey: 'sub-alpha',
      code: 'alphaSecret',
      invokeTool: async () => ({}),
    })
    expect(alphaAfterMainClear.result).toBe('222')

    // endSubagentRepl('sub-alpha') clears ONLY sub-alpha, leaving sub-beta intact
    endSubagentRepl('sub-alpha', queueOverride)
    expect(queued.map(q => q.agentId)).toEqual(['sub-beta'])

    const alphaAfterEnd = await executeCodeModeScript({
      sessionKey: 'sub-alpha',
      code: 'alphaSecret',
      invokeTool: async () => ({}),
    })
    expect(alphaAfterEnd.result).toContain('ReferenceError')

    const betaAfterAlphaEnd = await executeCodeModeScript({
      sessionKey: 'sub-beta',
      code: 'betaSecret',
      invokeTool: async () => ({}),
    })
    expect(betaAfterAlphaEnd.result).toBe('333')

    // /clear conversation.ts uses endMainThreadConversation + permission waits + forfeitAllChatPins
    const clearSrc = readFileSync(
      join(import.meta.dir, '../../../commands/clear/conversation.ts'),
      'utf8',
    )
    expect(clearSrc).toContain('endMainThreadConversation(')
    expect(clearSrc).not.toContain('clearCodeModeVmSession(')
    expect(clearSrc).toContain('clearAgentPermissionWaits(')
    expect(clearSrc).toContain('forfeitAllChatPins(')
  })

  test('P1-#37: formatReplOutputEnvelope escapes XML and includes logs, and waitForNews / lingerForAsyncReplEvents settle cleanly', async () => {
    expect(
      formatReplOutputEnvelope({
        evalId: 7,
        ms: 42.4,
        result: 'a < b & c > d',
        logs: ['step <1>', ''],
      }),
    ).toBe(
      '<repl-output eval="7" ms="42">\n<log>step &lt;1&gt;</log>\n<log/>\n<result>a &lt; b &amp; c &gt; d</result>\n</repl-output>',
    )

    // waitForNews resolves quickly when news arrives and nothingToLingerFor returns true
    const news: string[] = []
    const listeners = new Set<() => void>()
    const ac = new AbortController()
    const waitPromise = waitForNews({
      news: () => news,
      subscribe: fn => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      signal: ac.signal,
      nothingToLingerFor: () => news.length > 0,
      debounceMs: 25,
      maxWaitMs: 200,
    })
    setTimeout(() => {
      news.push('settled-1')
      for (const fn of listeners) fn()
    }, 10)
    await waitPromise
    expect(news).toEqual(['settled-1'])

    // lingerForAsyncReplEvents reports pending detached eval status after news debounces
    const sessions = new ReplSessions()
    let release!: (v: string) => void
    const pendingGate = new Promise<string>(resolve => {
      release = resolve
    })
    const handle = sessions.dispatch(
      'linger-key',
      () => pendingGate,
      { signal: ac.signal, detachAfterMs: 10, deliver: () => {} },
      'slow()',
    )
    await new Promise(r => setTimeout(r, 25))
    const lingerNews: string[] = []
    const lingerListeners = new Set<() => void>()
    let reportedCount = 0
    const lingerPromise = lingerForAsyncReplEvents({
      key: 'linger-key',
      sessions,
      signal: ac.signal,
      getNews: () => lingerNews,
      subscribe: fn => {
        lingerListeners.add(fn)
        return () => lingerListeners.delete(fn)
      },
      onPendingStatus: pending => {
        reportedCount = pending.length
      },
      debounceMs: 15,
      maxWaitMs: 40,
    })
    setTimeout(() => {
      lingerNews.push('other-event')
      for (const fn of lingerListeners) fn()
    }, 10)
    await lingerPromise
    expect(reportedCount).toBe(1)
    release('done')
    await handle.ended
  })

  test('P2-#12: planCodeModeFromSession refusal references CLAUDE_CODE_EXPERIMENTAL_CODE_MODE (not CLAUDE_CODE_REPL)', () => {
    const plan = planCodeModeFromSession({
      replMode: true,
      sessionId: 'sess-env-check',
    })
    expect(plan.refused).toContain('CLAUDE_CODE_EXPERIMENTAL_CODE_MODE')
    expect(plan.refused).not.toContain('CLAUDE_CODE_REPL=')
  })
})
