import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildCodeModeDevServerGuidance,
  buildWindowsCodeModeShellGuidance,
} from '../../../constants/prompts.js'
import { shouldSkipUserPromptSubmitForCodeModeScriptOutput } from '../../../utils/hooks.js'
import {
  buildCodeModeMcpStatusDelta,
  CODE_MODE_STATIC_MCP_GUIDANCE,
} from '../../../utils/simpleSystemPrompt.js'
import { buildCodeModeWorkflowGuidance } from '../../../utils/workflowSizeGuideline.js'
import { REPL_POST_SCRIPT_PAUSE_AUTO_MS } from '../constants.js'
import {
  buildCodeModeInterruptedScriptNotice,
  buildConciseCodeModeToolDescription,
  CodeModeAutoVerdictTracker,
  type CodeModeProgressEvent,
  createPausableCodeModeTimer,
  diffCodeModeMcpServerStatus,
  executeCodeModeScript,
  extractTopLevelDeclaredVars,
  findClosestEditMatchHint,
  getCodeModePostScriptPauseMs,
  injectUnsetVarGuards,
  isNoOpCodeModeEdit,
  mergeCodeModeReplySideEffects,
  planCodeModeFromSession,
  resetCodeModeRuntimeStateForTests,
  shouldAttachSmallMentionedFileInCodeMode,
  shouldAutoStartCodeModeTurnAfterCommand,
  shouldPauseCodeModeTimerForTool,
  shouldRunCodeModeScriptInBackground,
  wrapReplToolForCodeMode,
} from '../executor.js'
import {
  resetCodeModeOptInStateForTests,
  setEngineCheckResultForTests,
  settleCodeModeOptIn,
  settleCodeModeOptInAtStartup,
} from '../optIn.js'

afterEach(() => {
  resetCodeModeOptInStateForTests()
  resetCodeModeRuntimeStateForTests()
})

describe('Wave 327-328 Group 3 — Code Mode (22 items)', () => {
  test('#386: CodeModeAutoVerdictTracker preserves running script verdict when second script starts', () => {
    const tracker = new CodeModeAutoVerdictTracker()
    tracker.registerScript('script-1')
    tracker.markAllowed('script-1')
    expect(tracker.ridesNow('script-1')).toBe(true)

    // Second script starts in auto mode (initially pending, then allowed)
    tracker.registerScript('script-2')
    expect(tracker.ridesNow('script-1')).toBe(true)
    expect(tracker.ridesNow('script-2')).toBe(false)

    tracker.markAllowed('script-2')
    expect(tracker.ridesNow('script-1')).toBe(true)
    expect(tracker.ridesNow('script-2')).toBe(true)

    // Blocked script does not ride, but running allowed script still rides
    tracker.registerScript('script-3')
    tracker.markBlocked('script-3', 'denied')
    expect(tracker.ridesNow('script-3')).toBe(false)
    expect(tracker.ridesNow('script-1')).toBe(true)

    // Unclassified code running revokes riding
    tracker.markUnclassifiedCodeRan()
    expect(tracker.ridesNow('script-1')).toBe(false)
  })

  test('#521: Code Mode no longer refuses startup when an installed mod hooks tool calls', async () => {
    setEngineCheckResultForTests('passed')
    const decision = await settleCodeModeOptInAtStartup({
      env: { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' },
      isFirstPartyProvider: true,
      isModelSupported: true,
      isNonInteractive: false,
      hasFeatureFlags: true,
      isGateOpen: true,
      caveatsAccepted: true,
      lastCheck: async () => 'mods',
    })
    expect(decision.state).toBe('on')

    resetCodeModeOptInStateForTests()
    setEngineCheckResultForTests('passed')
    const decisionAfterThrow = await settleCodeModeOptInAtStartup({
      env: { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' },
      isFirstPartyProvider: true,
      isModelSupported: true,
      isNonInteractive: false,
      hasFeatureFlags: true,
      isGateOpen: true,
      caveatsAccepted: true,
      lastCheck: async () => {
        throw new Error('mod probe boom')
      },
    })
    expect(decisionAfterThrow.state).toBe('on')
  })

  test('#571: Pausable timer freezes during permission prompt / AskUserQuestion / ExitPlanMode', () => {
    let fakeNow = 1000
    let fired = false
    const timer = createPausableCodeModeTimer(
      10_000,
      () => {
        fired = true
      },
      () => fakeNow,
    )
    fakeNow += 3000
    timer.pause()
    expect(timer.isPaused()).toBe(true)
    expect(timer.getRemainingMs()).toBe(7000)

    // 15 minutes pass while user answers prompt — timer must NOT fire or drain
    fakeNow += 900_000
    expect(fired).toBe(false)
    expect(timer.getRemainingMs()).toBe(7000)

    timer.resume()
    expect(timer.isPaused()).toBe(false)
    fakeNow += 2000
    expect(timer.getRemainingMs()).toBe(5000)
    timer.clear()

    expect(shouldPauseCodeModeTimerForTool('AskUserQuestion', 'auto')).toBe(
      true,
    )
    expect(
      shouldPauseCodeModeTimerForTool('ExitPlanMode', 'bypassPermissions'),
    ).toBe(true)
    expect(shouldPauseCodeModeTimerForTool('Bash', 'default')).toBe(true)
    expect(shouldPauseCodeModeTimerForTool('Bash', 'auto')).toBe(false)
    expect(shouldPauseCodeModeTimerForTool('Bash', 'bypassPermissions')).toBe(
      false,
    )
  })

  test('#572: wrapReplToolForCodeMode merges live MCP tools connected mid-session', async () => {
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    const called: string[] = []
    const liveMcpTool = {
      name: 'mcp__late__ping',
      inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
      call: async () => {
        called.push('mcp__late__ping')
        return { data: 'pong' }
      },
    }
    const baseEval = {
      name: 'REPL',
      call: async () => ({ data: 'fallback' }),
    }
    const wrapped = wrapReplToolForCodeMode(baseEval as never, () => [])
    const result = await wrapped.call(
      {
        code: 'const r = await callTool("mcp__late__ping", {}); return r;',
      } as never,
      {
        abortController: new AbortController(),
        options: { tools: [] },
        getAppState: () => ({
          mcp: { tools: [liveMcpTool] },
          toolPermissionContext: { mode: 'auto' },
        }),
      } as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
    )
    expect(called).toEqual(['mcp__late__ping'])
    expect(JSON.stringify(result)).toContain('pong')
  })

  test('#573 & #575: shouldRunCodeModeScriptInBackground and planCodeModeFromSession interrupted script notice', () => {
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    expect(shouldRunCodeModeScriptInBackground('auto', true)).toBe(true)
    expect(shouldRunCodeModeScriptInBackground('bypassPermissions', true)).toBe(
      true,
    )
    expect(shouldRunCodeModeScriptInBackground('default', true)).toBe(false)
    expect(shouldRunCodeModeScriptInBackground('auto', false)).toBe(false)

    const notice = buildCodeModeInterruptedScriptNotice({
      toolUseId: 'toolu_abc',
      permissionMode: 'default',
      fromPicker: true,
    })
    expect(notice).toContain('toolu_abc')
    expect(notice).toContain('cut off')

    // Plan for a session with an unmatched REPL tool_use (interrupted script)
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_cut',
              name: 'REPL',
              input: { code: 'await $`sleep 60`' },
            },
          ],
        },
      },
    ] as never
    const plan = planCodeModeFromSession({
      replMode: true,
      messages,
      permissionMode: 'auto',
      fromPicker: true,
    })
    expect(plan.waitForNextPrompt).toBe(true)
    expect(plan.interruptedScriptNotice).toContain('cut off')
    expect(plan.autoBackgroundEligible).toBe(true)
  })

  test('#574: mergeCodeModeReplySideEffects preserves loaded skills, hook contexts, and approval notes across scripts', () => {
    const merged = mergeCodeModeReplySideEffects([
      {
        toolUseId: 't1',
        loadedSkills: ['skill-a'],
        hookContexts: ['ctx-1'],
        approvalNotes: ['user note 1'],
      },
      {
        toolUseId: 't2',
        loadedSkills: ['skill-a', 'skill-b'],
        hookContexts: ['ctx-2'],
        approvalNotes: ['user note 2'],
      },
    ])
    expect(merged.loadedSkills).toEqual(['skill-a', 'skill-b'])
    expect(merged.hookContexts).toEqual(['ctx-1', 'ctx-2'])
    expect(merged.approvalNotes).toEqual(['user note 1', 'user note 2'])
  })

  test('#576: unset top-level variables from a failed script throw ReferenceError instead of undefined', async () => {
    const vars = extractTopLevelDeclaredVars(
      'const result = await fetch();\nlet count = 0;\nvar flag = true;',
    )
    expect(vars).toEqual(['result', 'count', 'flag'])

    const guarded = injectUnsetVarGuards(
      'return result + 1',
      new Set(['result']),
    )
    expect(guarded).toContain('ReferenceError')
    expect(guarded).toContain('earlier step never set')

    // If redeclared or typeof-checked, no guard injected
    expect(
      injectUnsetVarGuards(
        'const result = 42; return result',
        new Set(['result']),
      ),
    ).not.toContain('ReferenceError')
    expect(
      injectUnsetVarGuards(
        'if (typeof result === "undefined") return 0',
        new Set(['result']),
      ),
    ).not.toContain('ReferenceError')

    // End-to-end across two executeCodeModeScript calls passing unsetVars forward
    const res1 = await executeCodeModeScript({
      code: 'throw new Error("boom before set");\nconst neverSet = 123;',
      invokeTool: async () => ({ content: '' }),
    })
    expect(res1.result).toContain('Error: boom before set')
    expect(res1.unsetVariables).toContain('neverSet')

    const res2 = await executeCodeModeScript({
      code: 'return neverSet;',
      unsetVars: new Set(res1.unsetVariables),
      invokeTool: async () => ({ content: '' }),
    })
    expect(res2.result).toContain('neverSet')
    expect(res2.result).toContain('earlier step never set')
  })

  test('#577: failing shell command with truncated output reports truncation notice on ShellError', async () => {
    const res = await executeCodeModeScript({
      code: 'await $`failing-cmd`',
      invokeTool: async () => ({
        stdout: 'error line\n... [output truncated to 2000 chars] ...',
        stderr: 'fatal error',
        truncated: true,
        exitCode: 1,
      }),
    })
    expect(res.result).toContain('Error:')
    expect(res.result.toLowerCase()).toContain('truncated')
  })

  test('#580: @-mentioned small files remain attachable in Code Mode after script touch', () => {
    expect(
      shouldAttachSmallMentionedFileInCodeMode({
        isCodeMode: true,
        isSmallFile: true,
        previouslyTouchedByScript: true,
      }),
    ).toBe(true)
    expect(
      shouldAttachSmallMentionedFileInCodeMode({
        isCodeMode: true,
        isSmallFile: false,
        previouslyTouchedByScript: true,
      }),
    ).toBe(false)
  })

  test('#581: read-only subagent allowedTools omits write() and edit() helpers in Code Mode', async () => {
    const res = await executeCodeModeScript({
      code: 'return { hasRead: typeof read, hasWrite: typeof write, hasEdit: typeof edit };',
      allowedTools: new Set(['Read']),
      invokeTool: async () => ({ content: 'ok' }),
    })
    expect(res.result).toContain('"hasRead": "function"')
    expect(res.result).toContain('"hasWrite": "undefined"')
    expect(res.result).toContain('"hasEdit": "undefined"')
  })

  test('#582: Esc followed by local command does not auto-start a Code Mode turn', () => {
    expect(
      shouldAutoStartCodeModeTurnAfterCommand({
        interruptedByEsc: true,
        commandName: '/model',
        isLocalCommand: true,
      }),
    ).toBe(false)
    expect(
      shouldAutoStartCodeModeTurnAfterCommand({
        interruptedByEsc: false,
      }),
    ).toBe(true)
  })

  test('#583: buildCodeModeWorkflowGuidance tells Claude to run workflows only when asked + respects size setting', () => {
    const guidance = buildCodeModeWorkflowGuidance('small')
    expect(guidance).toContain('only when the user asks')
    expect(guidance.toLowerCase()).toContain('small')
    const defaultGuidance = buildCodeModeWorkflowGuidance()
    expect(defaultGuidance).toContain('only when the user asks')
  })

  test('#648: post-script pause removed in auto and bypassPermissions modes (0ms)', () => {
    expect(REPL_POST_SCRIPT_PAUSE_AUTO_MS).toBe(0)
    expect(getCodeModePostScriptPauseMs('auto')).toBe(0)
    expect(getCodeModePostScriptPauseMs('bypassPermissions')).toBe(0)
    expect(getCodeModePostScriptPauseMs('default')).toBe(0)
  })

  test('#649: prompt-cache-stable static MCP guidance + dynamic pending/added/removed deltas', () => {
    expect(CODE_MODE_STATIC_MCP_GUIDANCE).toContain('MCP')
    const diff = diffCodeModeMcpServerStatus(
      new Set(['alpha', 'removed-srv']),
      [
        { name: 'alpha', type: 'connected' },
        { name: 'beta', type: 'connected' },
        { name: 'gamma', type: 'pending' },
      ],
    )
    expect(diff.added).toEqual(['beta'])
    expect(diff.removed).toEqual(['removed-srv'])
    expect(diff.pending).toEqual(['gamma'])

    const delta = buildCodeModeMcpStatusDelta({
      pendingServers: diff.pending,
      addedServers: diff.added,
      removedServers: diff.removed,
    })
    expect(delta).toContain('gamma')
    expect(delta).toContain('beta')
    expect(delta).toContain('removed-srv')

    expect(
      buildCodeModeMcpStatusDelta({
        pendingServers: [],
        addedServers: [],
        removedServers: [],
      }),
    ).toBeNull()
  })

  test('#650: concise Code Mode tool descriptions stay compact', () => {
    const longDesc =
      'Reads a file from the local filesystem. ' +
      'This has many extra paragraphs of boilerplate instructions. '.repeat(20)
    const concise = buildConciseCodeModeToolDescription('Read', longDesc)
    expect(concise.length).toBeLessThan(longDesc.length)
    expect(concise.length).toBeLessThanOrEqual(240)
    expect(concise).toContain('Reads a file')
  })

  test('#651: live command progress events fire for command_start and command_output', async () => {
    const events: CodeModeProgressEvent[] = []
    const res = await executeCodeModeScript({
      code: 'await $`echo hello-stream`',
      onProgress: ev => events.push(ev),
      invokeTool: async () => ({
        stdout: 'hello-stream\n',
        stderr: '',
        exitCode: 0,
      }),
    })
    expect(res.result).not.toContain('Error:')
    expect(
      events.some(
        e => e.type === 'command_start' && e.command.includes('hello-stream'),
      ),
    ).toBe(true)
    expect(
      events.some(
        e => e.type === 'command_output' && e.chunk.includes('hello-stream'),
      ),
    ).toBe(true)
  })

  test('#652: no-op edit does not stop script and failed edit includes closest match hint', async () => {
    expect(
      isNoOpCodeModeEdit({
        file_path: 'a.ts',
        old_string: 'const x = 1',
        new_string: 'const x = 1',
      }),
    ).toBe(true)
    expect(
      isNoOpCodeModeEdit({
        file_path: 'a.ts',
        old_string: 'const x = 1',
        new_string: 'const x = 2',
      }),
    ).toBe(false)

    const hint = findClosestEditMatchHint(
      'function greet(name: string) {\n  return `hello ${name}`;\n}\n',
      'function greet(name: string) {\n  return `hello ${user}`;\n}',
    )
    expect(hint).toBeDefined()
    expect(hint).toContain('line')

    // End-to-end: no-op edit succeeds without stopping script
    const res = await executeCodeModeScript({
      code: 'const r = await edit({ file_path: "f.ts", old_string: "abc", new_string: "abc" }); return r;',
      invokeTool: async () => {
        throw new Error('should not invoke underlying Edit tool on no-op')
      },
    })
    expect(res.result).not.toContain('Error:')
    expect(res.result.toLowerCase()).toContain('no')
  })

  test('#653: in-flight tool calls are reported when a script fails', async () => {
    let releaseSlow: (() => void) | undefined
    const slowPromise = new Promise<void>(resolve => {
      releaseSlow = resolve
    })
    const res = await executeCodeModeScript({
      code: 'const p = read({ file_path: "slow.ts" }); throw new Error("fast fail");',
      invokeTool: async () => {
        await slowPromise
        return { content: 'done' }
      },
    })
    releaseSlow?.()
    expect(res.result).toContain('Still running when script failed')
    expect(res.result).toContain('Read')
    expect(res.inFlightAtFailure).toContain('Read')
  })

  test('#654 & #655: dev server background task guidance and Windows Git Bash / PowerShell alias guidance', () => {
    const devAuto = buildCodeModeDevServerGuidance()
    expect(devAuto).toContain('/tasks')
    expect(devAuto).toContain('timeout')
    expect(devAuto).toContain('nohup')

    const winGuidance = buildWindowsCodeModeShellGuidance('win32')
    expect(winGuidance).toContain('Git Bash')
    expect(winGuidance).toContain('PowerShell')
    expect(winGuidance?.toLowerCase()).toContain('alias')
    expect(buildWindowsCodeModeShellGuidance('darwin')).toBeNull()
  })

  test('#663: shouldSkipUserPromptSubmitForCodeModeScriptOutput skips all UserPromptSubmit hooks on script output', () => {
    expect(
      shouldSkipUserPromptSubmitForCodeModeScriptOutput({
        isCodeModeScriptOutput: true,
      }),
    ).toBe(true)
    expect(
      shouldSkipUserPromptSubmitForCodeModeScriptOutput({
        isCodeModeScriptOutput: false,
      }),
    ).toBe(false)
    expect(shouldSkipUserPromptSubmitForCodeModeScriptOutput(undefined)).toBe(
      false,
    )
  })

  test('#581 regression: wrapReplToolForCodeMode hides Write/Edit from read-only subagents even when resolveAvailableTools returns them', async () => {
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    const makeTool = (name: string) => ({
      name,
      inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
      description: async () => `${name} tool description`,
      call: async () => ({ data: `${name}:ok` }),
    })
    const readTool = makeTool('Read')
    const writeTool = makeTool('Write')
    const editTool = makeTool('Edit')
    const baseEval = {
      name: 'REPL',
      prompt: async () => 'Base REPL prompt',
      call: async () => ({ data: 'fallback' }),
    }
    const wrapped = wrapReplToolForCodeMode(baseEval as never, () => [
      readTool as never,
      writeTool as never,
      editTool as never,
    ])

    // Read-only subagent context only has Read in context.options.tools
    const subagentCtx = {
      agentId: 'subagent-readonly',
      abortController: new AbortController(),
      options: { tools: [readTool] },
      getAppState: () => ({
        mcp: { tools: [], clients: [] },
        toolPermissionContext: { mode: 'default', alwaysDenyRules: {} },
      }),
    }
    const resShorthands = (await wrapped.call(
      {
        code: 'return { hasRead: typeof read, hasWrite: typeof write, hasEdit: typeof edit, listed: tools.list() };',
      } as never,
      subagentCtx as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
    )) as { data: { result: string } }
    expect(resShorthands.data.result).toContain('"hasRead": "function"')
    expect(resShorthands.data.result).toContain('"hasWrite": "undefined"')
    expect(resShorthands.data.result).toContain('"hasEdit": "undefined"')
    expect(resShorthands.data.result).not.toContain('"Write"')
    expect(resShorthands.data.result).not.toContain('"Edit"')

    // Direct callTool('Write') must also be refused
    const resCallWrite = (await wrapped.call(
      {
        code: 'await callTool("Write", { file_path: "/tmp/x", content: "hi" });',
      } as never,
      subagentCtx as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
    )) as { data: { result: string } }
    expect(resCallWrite.data.result).toContain(
      'Tool not available in Code Mode: Write',
    )
  })

  test('#576/#649/#650/#651 regression: wrapReplToolForCodeMode wires unsetVars, onProgress, MCP status delta, and concise prompt', async () => {
    setEngineCheckResultForTests('passed')
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    const bashTool = {
      name: 'Bash',
      inputSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
      description: async () =>
        'Runs shell commands safely.\n\nSecond paragraph omitted in concise form.',
      call: async () => ({
        data: { stdout: 'hello\n', stderr: '', exitCode: 0 },
      }),
    }
    const baseEval = {
      name: 'REPL',
      prompt: async () => 'Base REPL prompt',
      call: async () => ({ data: 'fallback' }),
    }
    const wrapped = wrapReplToolForCodeMode(baseEval as never, () => [
      bashTool as never,
    ])

    // #649 & #650: prompt includes concise tool description and static MCP guidance
    const promptText = await wrapped.prompt({
      getToolPermissionContext: async () => ({}) as never,
      tools: [],
      agents: [],
    })
    expect(promptText).toContain('Runs shell commands safely.')
    expect(promptText).not.toContain('Second paragraph omitted')
    expect(promptText).toContain(CODE_MODE_STATIC_MCP_GUIDANCE)

    const progressEvents: unknown[] = []
    const ctx = {
      abortController: new AbortController(),
      options: { tools: [] },
      getAppState: () => ({
        mcp: {
          tools: [],
          clients: [{ name: 'pending-srv', type: 'pending' }],
        },
        toolPermissionContext: { mode: 'auto', alwaysDenyRules: {} },
      }),
    }

    // #651 + #649: onProgress receives command events and result includes pending MCP delta
    const runRes = (await wrapped.call(
      { code: 'const out = await $`echo hi`; return out.stdout;' } as never,
      ctx as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
      (p: unknown) => progressEvents.push(p),
    )) as { data: { result: string } }
    expect(progressEvents.length).toBeGreaterThanOrEqual(1)
    expect(runRes.data.result).toContain('pending-srv')

    // #576: failed script records unset top-level var; next script throws ReferenceError
    const failRes = (await wrapped.call(
      {
        code: 'const neverBound = await Promise.reject(new Error("boom"));',
      } as never,
      ctx as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
    )) as { data: { result: string; unsetVariables?: string[] } }
    expect(failRes.data.unsetVariables).toContain('neverBound')

    const nextRes = (await wrapped.call(
      { code: 'return neverBound + 1;' } as never,
      ctx as never,
      (async () => ({ behavior: 'allow', updatedInput: {} })) as never,
      {} as never,
    )) as { data: { result: string } }
    expect(nextRes.data.result).toContain('earlier step never set')
  })
})
