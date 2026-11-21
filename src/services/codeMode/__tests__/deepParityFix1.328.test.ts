import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UUID } from 'node:crypto'
import { bashToolHasPermission } from '../../../../packages/builtin-tools/src/tools/BashTool/bashPermissions.js'
import { BashTool } from '../../../../packages/builtin-tools/src/tools/BashTool/BashTool.js'
import { isSandboxAutoAllowSuspendedInLayers } from '../../../engine/hostPermissionLayers.js'
import type { ToolUseContext } from '../../../Tool.js'
import {
  hasPermissionsToUseTool,
  isSandboxAutoAllowSuspended,
} from '../../../utils/permissions/permissions.js'
import { SandboxManager } from '../../../utils/sandbox/sandbox-adapter.js'
import {
  clearSessionMetadata,
  getCurrentSessionReplMode,
  loadAllLogsFromSessionFile,
  loadTranscriptFromFile,
  restoreSessionMetadata,
  saveReplMode,
} from '../../../utils/sessionStorage.js'
import { fetchToolsForClient } from '../../mcp/client.js'
import {
  applyCodeModePlan,
  clearCodeModeVmSession,
  CodeModeAutoVerdictTracker,
  executeCodeModeScript,
  getCodeModeAutoVerdictTracker,
  inferReplModeFromMessages,
  instrumentCodeModeLoops,
  planCodeModeFromSession,
  resetCodeModeRuntimeStateForTests,
  wrapReplToolForCodeMode,
} from '../executor.js'
import {
  pinCodeMode,
  resetCodeModeOptInStateForTests,
  setEngineCheckResultForTests,
  settleCodeModeOptIn,
} from '../optIn.js'

const tempDirs: string[] = []

afterEach(() => {
  resetCodeModeOptInStateForTests()
  resetCodeModeRuntimeStateForTests()
  clearSessionMetadata()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeMockToolContext(opts: {
  agentId?: string
  toolUseId?: string
  mode?: 'default' | 'auto' | 'bypassPermissions' | 'plan'
  tools?: unknown[]
  autoModeClassified?: boolean
  autoModeScriptCheckDeferred?: boolean
}) {
  const state = {
    mcp: { tools: [], clients: [] },
    toolPermissionContext: {
      mode: opts.mode ?? 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: opts.mode === 'bypassPermissions',
    },
    sessionHooks: new Map(),
  }
  return {
    agentId: opts.agentId,
    toolUseId: opts.toolUseId ?? `repl-${opts.agentId ?? 'main'}`,
    abortController: new AbortController(),
    options: { tools: opts.tools ?? [] },
    getAppState: () => state,
    setAppState: () => {},
    ...(opts.autoModeClassified ? { autoModeClassified: true } : {}),
    ...(opts.autoModeScriptCheckDeferred
      ? { autoModeScriptCheckDeferred: true }
      : {}),
  }
}

describe('Deep Parity Fix 1 — All 7 Verified P1 Bugs (Official 2.1.328)', () => {
  test('P1 #1: per-agent persistent VM context reuses const/let/var/function/class bindings across turns while isolating different agents', async () => {
    // 1. Direct executeCodeModeScript with sessionKey
    const r1 = await executeCodeModeScript({
      sessionKey: 'agent-alpha',
      code: 'const a = 1; let b = 2; function add(x) { return x + a + b; }',
      invokeTool: async () => ({}),
    })
    expect(r1.result).not.toContain('Error:')

    const r2 = await executeCodeModeScript({
      sessionKey: 'agent-alpha',
      code: 'add(10)',
      invokeTool: async () => ({}),
    })
    expect(r2.result).toBe('13')

    // Class + mutation persistence
    const r3 = await executeCodeModeScript({
      sessionKey: 'agent-alpha',
      code: 'b = 5; class Box { constructor(v) { this.v = v; } }\nnew Box(add(10)).v',
      invokeTool: async () => ({}),
    })
    expect(r3.result).toBe('16')

    const r4 = await executeCodeModeScript({
      sessionKey: 'agent-alpha',
      code: 'new Box(20).v + b',
      invokeTool: async () => ({}),
    })
    expect(r4.result).toBe('25')

    // Different agent must stay isolated
    const rOther = await executeCodeModeScript({
      sessionKey: 'agent-beta',
      code: 'add(10)',
      invokeTool: async () => ({}),
    })
    expect(rOther.result).toContain('ReferenceError')

    // Clearing agent-alpha resets its VM context cleanly
    clearCodeModeVmSession('agent-alpha')
    const rAfterClear = await executeCodeModeScript({
      sessionKey: 'agent-alpha',
      code: 'add(10)',
      invokeTool: async () => ({}),
    })
    expect(rAfterClear.result).toContain('ReferenceError')

    // 2. End-to-end through wrapReplToolForCodeMode (including top-level return + await fallback)
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    const echoTool = {
      name: 'Echo',
      inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
      call: async (inp: { n: number }) => ({ data: inp.n }),
    }
    const wrapped = wrapReplToolForCodeMode(
      { name: 'REPL', call: async () => ({ data: 'fallback' }) } as never,
      () => [echoTool as never],
    )
    const allowAll = (async (_t: unknown, inp: unknown) => ({
      behavior: 'allow',
      updatedInput: inp,
    })) as never
    const ctxA = makeMockToolContext({
      agentId: 'wrap-agent-A',
      tools: [echoTool],
    })
    const ctxB = makeMockToolContext({
      agentId: 'wrap-agent-B',
      tools: [echoTool],
    })

    const w1 = (await wrapped.call(
      {
        code: 'const x = await callTool("Echo", { n: 7 }); function doubleX() { return x * 2; } return x;',
      } as never,
      ctxA as never,
      allowAll,
      { message: { id: 'm1' } } as never,
    )) as { data: { result: string } }
    expect(w1.data.result).toBe('7')

    const w2 = (await wrapped.call(
      { code: 'doubleX() + x' } as never,
      ctxA as never,
      allowAll,
      { message: { id: 'm2' } } as never,
    )) as { data: { result: string } }
    expect(w2.data.result).toBe('21')

    const wB = (await wrapped.call(
      { code: 'doubleX()' } as never,
      ctxB as never,
      allowAll,
      { message: { id: 'm3' } } as never,
    )) as { data: { result: string } }
    expect(wB.data.result).toContain('ReferenceError')

    // Partial failure keeps already-assigned vars usable while guarding unset vars
    const wFail = (await wrapped.call(
      {
        code: 'const assignedOk = 99;\nthrow new Error("mid-fail");\nconst neverReached = 1;',
      } as never,
      ctxA as never,
      allowAll,
      { message: { id: 'm4' } } as never,
    )) as { data: { result: string; unsetVariables?: string[] } }
    expect(wFail.data.unsetVariables).toEqual(['neverReached'])

    const wReadOk = (await wrapped.call(
      { code: 'assignedOk + 1' } as never,
      ctxA as never,
      allowAll,
      { message: { id: 'm5' } } as never,
    )) as { data: { result: string } }
    expect(wReadOk.data.result).toBe('100')

    const wReadUnset = (await wrapped.call(
      { code: 'neverReached + 1' } as never,
      ctxA as never,
      allowAll,
      { message: { id: 'm6' } } as never,
    )) as { data: { result: string } }
    expect(wReadUnset.data.result).toContain('earlier step never set')
  })

  test('P1 #2a: first tool wait pauses script timeout timer immediately (does not time out while awaiting tool in default mode)', async () => {
    const invoked: string[] = []
    const res = await executeCodeModeScript({
      code: 'const out = await callTool("SlowPrompt", {}); out',
      timeoutMs: 100,
      permissionMode: 'default',
      invokeTool: async name => {
        invoked.push(name)
        await new Promise(r => setTimeout(r, 200))
        return 'approved-after-200ms'
      },
    })
    expect(invoked).toEqual(['SlowPrompt'])
    expect(res.result).toBe('approved-after-200ms')
  })

  test('P1 #2b: post-timeout zombie tool execution is prevented (strictly ["Slow"], NEVER ["Slow", "Later"])', async () => {
    const invoked: string[] = []
    let slowAborted = false

    const res = await executeCodeModeScript({
      code: `
        try {
          await callTool("Slow", {});
        } catch (e) {
          // Even if the script catches the rejection, Later must NEVER run!
        }
        await callTool("Later", {});
      `,
      timeoutMs: 100,
      permissionMode: 'auto',
      invokeTool: async (name, _input, execSignal) => {
        invoked.push(name)
        if (name === 'Slow') {
          execSignal?.addEventListener('abort', () => {
            slowAborted = true
          })
          await new Promise(r => setTimeout(r, 150))
          return 'slow-done'
        }
        return 'later-done'
      },
    })

    expect(res.result).toContain('Code Mode script timed out after 100ms')
    expect(res.inFlightAtFailure).toEqual(['Slow'])
    expect(slowAborted).toBe(true)

    // Wait 300ms after executeCodeModeScript returns to ensure background
    // continuations NEVER launch "Later"
    await new Promise(r => setTimeout(r, 300))
    expect(invoked).toEqual(['Slow'])
  })

  test('P1 #3: synchronous loops after await are instrumented with __checkBudget() and terminate within timeout', async () => {
    // Instrumentor skips strings, comments, regex literals, and property names
    const safeSample = `
      const s = "while (true) {} for (;;) {}";
      // while (true) {}
      const r = /while \\(true\\)/g;
      const obj = { while: 1, for: 2, do: 3 };
      obj.for;
    `
    expect(instrumentCodeModeLoops(safeSample)).not.toContain('__checkBudget')

    // Live repro 1: `await fastTool(); while (true) {}`
    const t0 = Date.now()
    const whileRes = await executeCodeModeScript({
      code: 'await callTool("Fast", {}); while (true) {}',
      timeoutMs: 100,
      permissionMode: 'auto',
      invokeTool: async () => 'fast-ok',
    })
    const elapsed1 = Date.now() - t0
    expect(whileRes.result).toContain('Code Mode script timed out after 100ms')
    expect(elapsed1).toBeLessThan(1500)

    // Live repro 2: `await fastTool(); for (;;) {}`
    const forRes = await executeCodeModeScript({
      code: 'await callTool("Fast", {}); for (;;) {}',
      timeoutMs: 100,
      permissionMode: 'auto',
      invokeTool: async () => 'fast-ok',
    })
    expect(forRes.result).toContain('Code Mode script timed out after 100ms')

    // Live repro 3: `await fastTool(); do {} while (true)` and single-statement `while (true);`
    const doRes = await executeCodeModeScript({
      code: 'await callTool("Fast", {}); do {} while (true);',
      timeoutMs: 100,
      permissionMode: 'auto',
      invokeTool: async () => 'fast-ok',
    })
    expect(doRes.result).toContain('Code Mode script timed out after 100ms')

    const singleStmtRes = await executeCodeModeScript({
      code: 'let n = 0; await callTool("Fast", {}); while (true) n++;',
      timeoutMs: 100,
      permissionMode: 'auto',
      invokeTool: async () => 'fast-ok',
    })
    expect(singleStmtRes.result).toContain(
      'Code Mode script timed out after 100ms',
    )
  })

  test('P1 #4: inner Skill tool forwards body/output, newMessages, contextModifier, and contextLayers to outer REPLTool result', async () => {
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })

    const observedModelsInLaterTool: Array<string | undefined> = []
    const skillTool = {
      name: 'Skill',
      inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
      call: async (inp: { skill: string }) => ({
        data: {
          success: true,
          commandName: inp.skill,
          allowedTools: ['Bash(git *)'],
          model: 'claude-opus-4-6',
        },
        newMessages: [
          {
            type: 'user',
            message: {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'SKILL INSTRUCTIONS: inspect git status before editing.',
                },
              ],
            },
          },
        ],
        contextModifier: (ctx: ToolUseContext) => ({
          ...ctx,
          options: {
            ...ctx.options,
            mainLoopModel: 'claude-opus-4-6',
          },
          permissionLayers: [
            ...(ctx.permissionLayers ?? []),
            { kind: 'allowed_tools' as const, allowedTools: ['Bash(git *)'] },
          ],
        }),
        contextLayers: [{ kind: 'effort' as const, effort: 'high' }],
      }),
    }
    const probeTool = {
      name: 'Probe',
      inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
      call: async (_inp: unknown, ctx: ToolUseContext) => {
        observedModelsInLaterTool.push(ctx.options?.mainLoopModel)
        return { data: 'probed' }
      },
    }

    const wrapped = wrapReplToolForCodeMode(
      { name: 'REPL', call: async () => ({ data: 'fallback' }) } as never,
      () => [skillTool as never, probeTool as never],
    )
    const ctx = makeMockToolContext({
      agentId: 'skill-agent',
      tools: [skillTool, probeTool],
    })
    ;(ctx.options as Record<string, unknown>).mainLoopModel =
      'claude-sonnet-4-6'

    const res = (await wrapped.call(
      {
        code: `
          const sk = await callTool("Skill", { skill: "review-pr" });
          await callTool("Probe", {});
          return sk;
        `,
      } as never,
      ctx as never,
      (async (_t: unknown, inp: unknown) => ({
        behavior: 'allow',
        updatedInput: inp,
      })) as never,
      { message: { id: 'm-skill' } } as never,
    )) as {
      data: { result: string }
      newMessages?: Array<{ type: string; message?: { content?: unknown } }>
      contextModifier?: (ctx: ToolUseContext) => ToolUseContext
      contextLayers?: Array<{ kind: string; effort?: unknown }>
    }

    // 1. Script received the skill's body along with metadata
    expect(res.data.result).toContain('review-pr')
    expect(res.data.result).toContain(
      'SKILL INSTRUCTIONS: inspect git status before editing.',
    )
    // 2. Outer ToolResult forwards newMessages
    expect(res.newMessages).toBeDefined()
    expect(JSON.stringify(res.newMessages)).toContain(
      'SKILL INSTRUCTIONS: inspect git status before editing.',
    )
    // 3. Outer ToolResult forwards composed contextModifier
    expect(typeof res.contextModifier).toBe('function')
    const updatedOuter = res.contextModifier!(ctx as never)
    expect(updatedOuter.options.mainLoopModel).toBe('claude-opus-4-6')
    expect(
      updatedOuter.permissionLayers?.some(l => l.kind === 'allowed_tools'),
    ).toBe(true)
    // 4. Outer ToolResult forwards contextLayers
    expect(res.contextLayers).toEqual([{ kind: 'effort', effort: 'high' }])
    // 5. Subsequent inner call in the same script saw the updated model immediately
    expect(observedModelsInLaterTool).toEqual(['claude-opus-4-6'])
  })

  test('P1 #5: MCP client prefers context.toolUseId over outer parentMessage tool_use id for _meta and progress', async () => {
    const capturedCalls: Array<{
      params: Record<string, unknown>
    }> = []
    const progressIds: string[] = []

    const fakeConnectedClient = {
      type: 'connected' as const,
      name: 'demo-srv',
      config: { type: 'sdk' as const, name: 'demo-srv' },
      capabilities: { tools: {} },
      client: {
        request: async (req: { method: string; params?: unknown }) => {
          if (req.method === 'tools/list') {
            return {
              tools: [
                {
                  name: 'ping',
                  description: 'ping tool',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
            }
          }
          if (req.method === 'tools/call') {
            capturedCalls.push({
              params: (req.params ?? {}) as Record<string, unknown>,
            })
            return {
              content: [{ type: 'text', text: 'pong' }],
              isError: false,
            }
          }
          return {}
        },
        callTool: async (params: Record<string, unknown>) => {
          capturedCalls.push({ params })
          return {
            content: [{ type: 'text', text: 'pong' }],
            isError: false,
          }
        },
      },
      cleanup: async () => {},
    }

    const mcpTools = await fetchToolsForClient(fakeConnectedClient as never)
    expect(mcpTools.length).toBe(1)
    const pingTool = mcpTools[0]!

    const parentMessage = {
      type: 'assistant',
      message: {
        id: 'msg-parent',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_outer_repl_001',
            name: 'REPL',
            input: {},
          },
        ],
      },
    }

    const innerCtx = {
      ...makeMockToolContext({ toolUseId: 'toolu_inner_mcp_042' }),
      options: { tools: [], isNonInteractiveSession: true },
    }

    await pingTool.call(
      {} as never,
      innerCtx as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      parentMessage as never,
      ((p: { toolUseID?: string }) => {
        if (p.toolUseID) progressIds.push(p.toolUseID)
      }) as never,
    )

    expect(capturedCalls.length).toBe(1)
    const sentMeta = capturedCalls[0]!.params._meta as
      | Record<string, unknown>
      | undefined
    expect(sentMeta?.['claudecode/toolUseId']).toBe('toolu_inner_mcp_042')
    expect(progressIds.length).toBeGreaterThanOrEqual(1)
    expect(progressIds.every(id => id === 'toolu_inner_mcp_042')).toBe(true)

    // Fallback when context.toolUseId is undefined -> parentMessage's first tool_use id
    const fallbackCtx = {
      ...makeMockToolContext({}),
      toolUseId: undefined,
      options: { tools: [], isNonInteractiveSession: true },
    }
    const fallbackProgressIds: string[] = []
    await pingTool.call(
      {} as never,
      fallbackCtx as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      parentMessage as never,
      ((p: { toolUseID?: string }) => {
        if (p.toolUseID) fallbackProgressIds.push(p.toolUseID)
      }) as never,
    )
    const fallbackMeta = capturedCalls[1]!.params._meta as
      | Record<string, unknown>
      | undefined
    expect(fallbackMeta?.['claudecode/toolUseId']).toBe('toolu_outer_repl_001')
    expect(fallbackProgressIds.every(id => id === 'toolu_outer_repl_001')).toBe(
      true,
    )
  })

  test('P1 #6a: sandbox_auto_allow_suspended layer is consumed by permissions.ts and bashPermissions.ts', async () => {
    const layersWithSuspend = [
      { kind: 'sandbox_auto_allow_suspended' as const, allowOnly: true },
    ]
    expect(isSandboxAutoAllowSuspendedInLayers(layersWithSuspend)).toBe(true)
    expect(
      isSandboxAutoAllowSuspendedInLayers(layersWithSuspend, {
        ignoreAllowOnly: true,
      }),
    ).toBe(false)
    expect(isSandboxAutoAllowSuspendedInLayers([])).toBe(false)

    const basePermCtx = {
      mode: 'default' as const,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: { userSettings: ['Bash'] },
      isBypassPermissionsModeAvailable: false,
    }
    expect(
      isSandboxAutoAllowSuspended(basePermCtx as never, {
        permissionLayers: layersWithSuspend,
      }),
    ).toBe(true)
    expect(
      isSandboxAutoAllowSuspended(basePermCtx as never, {
        permissionLayers: [],
      }),
    ).toBe(false)

    const s1 = spyOn(SandboxManager, 'isSandboxingEnabled').mockReturnValue(
      true,
    )
    const s2 = spyOn(
      SandboxManager,
      'isAutoAllowBashIfSandboxedEnabled',
    ).mockReturnValue(true)
    const s3 = spyOn(
      SandboxManager,
      'areUnsandboxedCommandsAllowed',
    ).mockReturnValue(false)
    try {
      const ctxWithAskAndSuspend = {
        abortController: new AbortController(),
        options: { tools: [BashTool] },
        permissionLayers: layersWithSuspend,
        getAppState: () => ({
          toolPermissionContext: basePermCtx,
        }),
        setAppState: () => {},
      }
      const permDecision = await hasPermissionsToUseTool(
        BashTool as never,
        { command: 'echo hello' },
        ctxWithAskAndSuspend as never,
        {} as never,
        'toolu_suspend_check',
      )
      // Because sandbox_auto_allow_suspended is active, whole-tool Bash ask rule MUST NOT be bypassed
      expect(permDecision.behavior).toBe('ask')

      // And bashToolHasPermission directly MUST NOT sandbox-auto-allow a mutating command when suspended
      const noAskPermCtx = {
        ...basePermCtx,
        alwaysAskRules: {},
      }
      const bashResSuspended = await bashToolHasPermission(
        { command: 'touch /tmp/sandbox-suspend-probe' } as never,
        {
          ...ctxWithAskAndSuspend,
          getAppState: () => ({ toolPermissionContext: noAskPermCtx }),
        } as never,
      )
      expect(bashResSuspended.behavior).not.toBe('allow')

      const bashResNormal = await bashToolHasPermission(
        { command: 'touch /tmp/sandbox-suspend-probe' } as never,
        {
          ...ctxWithAskAndSuspend,
          permissionLayers: [],
          getAppState: () => ({ toolPermissionContext: noAskPermCtx }),
        } as never,
      )
      expect(bashResNormal.behavior).toBe('allow')
    } finally {
      s1.mockRestore()
      s2.mockRestore()
      s3.mockRestore()
    }
  })

  test('P1 #6b: auto mode uses deferred verdict + stop chain instead of unconditionally allowing unclassified scripts', async () => {
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })

    // 1. Unclassified auto script MUST NOT unconditionally ride auto verdict
    const seenContexts: Array<{
      replScriptInner?: boolean
      hasSuspendLayer?: boolean
    }> = []
    const echoTool = {
      name: 'Echo',
      inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
      call: async (inp: { n: number }) => ({ data: `echo:${inp.n}` }),
    }
    const wrapped = wrapReplToolForCodeMode(
      { name: 'REPL', call: async () => ({ data: 'fallback' }) } as never,
      () => [echoTool as never],
    )

    const unclassifiedCtx = makeMockToolContext({
      agentId: 'auto-unclassified',
      mode: 'auto',
      tools: [echoTool],
    })
    await wrapped.call(
      { code: 'await callTool("Echo", { n: 1 });' } as never,
      unclassifiedCtx as never,
      (async (_t: unknown, inp: unknown, ctx: ToolUseContext) => {
        seenContexts.push({
          replScriptInner: (ctx as { replScriptInner?: boolean })
            .replScriptInner,
          hasSuspendLayer: isSandboxAutoAllowSuspendedInLayers(
            ctx.permissionLayers,
          ),
        })
        return { behavior: 'allow', updatedInput: inp }
      }) as never,
      { message: { id: 'm-auto-1' } } as never,
    )
    expect(seenContexts[0]).toEqual({
      replScriptInner: undefined,
      hasSuspendLayer: true,
    })

    // 2. Deferred auto script: classifier DENY fires stop chain -> blocks first tool AND stops second tool
    resetCodeModeRuntimeStateForTests()
    const executedTools: string[] = []
    const classifierCalls: Array<{
      toolName: string
      replScriptCheckNow?: boolean
    }> = []
    const trackedTool = {
      name: 'Tracked',
      inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
      call: async (inp: { step: string }) => {
        executedTools.push(inp.step)
        return { data: inp.step }
      },
    }
    const deferredDenyCtx = makeMockToolContext({
      agentId: 'auto-deferred-deny',
      mode: 'auto',
      tools: [trackedTool],
      autoModeScriptCheckDeferred: true,
    })
    const wrappedDeferred = wrapReplToolForCodeMode(
      { name: 'REPL', call: async () => ({ data: 'fallback' }) } as never,
      () => [trackedTool as never],
    )
    const denyRes = (await wrappedDeferred.call(
      {
        code: `
          try { await callTool("Tracked", { step: "first" }); } catch {}
          await callTool("Tracked", { step: "second" });
        `,
      } as never,
      deferredDenyCtx as never,
      (async (tool: { name: string }, inp: unknown, ctx: ToolUseContext) => {
        const isDeferredCheck = (ctx as { replScriptCheckNow?: boolean })
          .replScriptCheckNow
        classifierCalls.push({
          toolName: tool.name,
          replScriptCheckNow: isDeferredCheck,
        })
        if (isDeferredCheck) {
          return {
            behavior: 'deny',
            message: 'dangerous script blocked by auto classifier',
            decisionReason: {
              type: 'classifier',
              classifier: 'auto',
              reason: 'dangerous',
            },
          }
        }
        return { behavior: 'allow', updatedInput: inp }
      }) as never,
      { message: { id: 'm-auto-deny' } } as never,
    )) as { data: { result: string } }

    expect(classifierCalls).toEqual([
      { toolName: 'REPL', replScriptCheckNow: true },
    ])
    expect(executedTools).toEqual([])
    expect(denyRes.data.result).toContain('Auto mode blocked')

    // 3. Deferred auto script: classifier ALLOW transitions to riding verdict
    resetCodeModeRuntimeStateForTests()
    const allowChecks: Array<{
      toolName: string
      replScriptCheckNow?: boolean
      replScriptInner?: boolean
    }> = []
    const deferredAllowCtx = makeMockToolContext({
      agentId: 'auto-deferred-allow',
      mode: 'auto',
      tools: [trackedTool],
      autoModeScriptCheckDeferred: true,
    })
    const allowRes = (await wrappedDeferred.call(
      {
        code: 'await callTool("Tracked", { step: "ok1" }); await callTool("Tracked", { step: "ok2" });',
      } as never,
      deferredAllowCtx as never,
      (async (tool: { name: string }, inp: unknown, ctx: ToolUseContext) => {
        const isDeferredCheck = (ctx as { replScriptCheckNow?: boolean })
          .replScriptCheckNow
        allowChecks.push({
          toolName: tool.name,
          replScriptCheckNow: isDeferredCheck,
          replScriptInner: (ctx as { replScriptInner?: boolean })
            .replScriptInner,
        })
        if (isDeferredCheck) {
          return {
            behavior: 'allow',
            updatedInput: inp,
            decisionReason: {
              type: 'classifier',
              classifierAllowed: true,
            },
          }
        }
        return { behavior: 'allow', updatedInput: inp }
      }) as never,
      { message: { id: 'm-auto-allow' } } as never,
    )) as { data: { result: string } }

    expect(allowRes.data.result).not.toContain('Error:')
    expect(executedTools).toEqual(['ok1', 'ok2'])
    expect(allowChecks[0]).toEqual({
      toolName: 'REPL',
      replScriptCheckNow: true,
      replScriptInner: undefined,
    })
    expect(allowChecks[1]?.replScriptInner).toBe(true)
    expect(allowChecks[2]?.replScriptInner).toBe(true)

    // Verify tracker API directly as well
    const tracker = new CodeModeAutoVerdictTracker()
    expect(tracker.inUse()).toBe(false)
    expect(getCodeModeAutoVerdictTracker()).toBeDefined()
  })

  test('P1 #7: replMode is inferred from historical successful REPL calls on resume AND persisted/restored via sessionStorage', async () => {
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })

    const replTranscript = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_repl_1',
              name: 'REPL',
              input: { code: '1 + 1' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_repl_1',
              content: '<repl-output>2</repl-output>',
              is_error: false,
            },
          ],
        },
      },
    ]

    const unavailableReplTranscript = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_repl_err',
              name: 'REPL',
              input: { code: '1 + 1' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_repl_err',
              content: '<tool_use_error>Error: No such tool available: REPL',
              is_error: true,
            },
          ],
        },
      },
    ]

    const ordinaryToolTranscript = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_bash_1',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_bash_1',
              content: 'README.md',
              is_error: false,
            },
          ],
        },
      },
    ]

    expect(inferReplModeFromMessages(replTranscript)).toBe(true)
    expect(inferReplModeFromMessages(unavailableReplTranscript)).toBeUndefined()
    expect(inferReplModeFromMessages(ordinaryToolTranscript)).toBe(false)

    // When restore record omits `replMode`, planCodeModeFromSession infers it from REPL calls!
    const notices: string[] = []
    pinCodeMode(false)
    const inferredPlan = planCodeModeFromSession(
      {
        messages: replTranscript,
      },
      msg => notices.push(msg),
    )
    expect(inferredPlan.unpin).toBe(true)
    expect(inferredPlan.switched).toBe(true)
    expect(notices).toEqual([])

    applyCodeModePlan(inferredPlan)
    expect(getCurrentSessionReplMode()).toBe(true)

    // Explicit replMode: false wins over messages
    const explicitFalsePlan = planCodeModeFromSession({
      replMode: false,
      messages: replTranscript,
    })
    expect(explicitFalsePlan.pin).toBe(false)

    // Session metadata save / clear / restore round-trip
    saveReplMode(false)
    expect(getCurrentSessionReplMode()).toBe(false)
    clearSessionMetadata()
    expect(getCurrentSessionReplMode()).toBeUndefined()
    restoreSessionMetadata({ replMode: true })
    expect(getCurrentSessionReplMode()).toBe(true)

    // JSONL transcript persistence round-trip (`type: 'repl-mode'`)
    const dir = mkdtempSync(join(tmpdir(), 'codemode-repl-mode-'))
    tempDirs.push(dir)
    const sid = '11111111-2222-3333-4444-555555555555' as UUID
    const u1 = 'aaaaaaaa-1111-2222-3333-444444444444' as UUID
    const sessionFile = join(dir, `${sid}.jsonl`)
    const lines = [
      JSON.stringify({
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        timestamp: new Date().toISOString(),
        cwd: dir,
        isSidechain: false,
        userType: 'external',
        version: '2.1.328',
        message: { role: 'user', content: 'hello' },
      }),
      JSON.stringify({
        type: 'repl-mode',
        replMode: true,
        sessionId: sid,
      }),
    ]
    writeFileSync(sessionFile, `${lines.join('\n')}\n`, 'utf8')
    const loaded = (await loadTranscriptFromFile(sessionFile)) as
      | ({ replMode?: boolean } & Record<string, unknown>)
      | null
    expect(loaded).not.toBeNull()
    expect(loaded?.replMode).toBe(true)

    const allLogs = (await loadAllLogsFromSessionFile(sessionFile)) as Array<
      { replMode?: boolean } & Record<string, unknown>
    >
    expect(allLogs.length).toBe(1)
    expect(allLogs[0]?.replMode).toBe(true)
  })
})
