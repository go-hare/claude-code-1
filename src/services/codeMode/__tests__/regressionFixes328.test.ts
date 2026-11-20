import { afterEach, describe, expect, test } from 'bun:test'
import { buildCodeModeDevServerGuidance } from '../../../constants/prompts.js'
import {
  addSessionHook,
  clearSessionHooks,
} from '../../../utils/hooks/sessionHooks.js'
import {
  executeCodeModeScript,
  extractAssignedVars,
  extractTopLevelDeclaredVars,
  injectUnsetVarGuards,
  resetCodeModeRuntimeStateForTests,
  wrapReplToolForCodeMode,
} from '../executor.js'
import {
  resetCodeModeOptInStateForTests,
  settleCodeModeOptIn,
} from '../optIn.js'

afterEach(() => {
  resetCodeModeOptInStateForTests()
  resetCodeModeRuntimeStateForTests()
})

function makeMockContext(sessionId: string, tools: unknown[]) {
  const sessionHooks = new Map()
  let state: Record<string, unknown> = {
    mcp: { tools: [], clients: [] },
    toolPermissionContext: {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    },
    sessionHooks,
  }
  const setAppState = (updater: (prev: typeof state) => typeof state) => {
    state = updater(state)
  }
  return {
    sessionId,
    setAppState,
    getState: () => state,
    ctx: {
      agentId: sessionId,
      toolUseId: `repl-${sessionId}`,
      abortController: new AbortController(),
      options: { tools },
      getAppState: () => state,
      setAppState,
    },
  }
}

describe('Regression fixes — Code Mode P0 #1, P1 #8, P2 #9', () => {
  test('P0 #1: wrapReplToolForCodeMode runs PreToolUse (updatedInput, deny, continue:false halt), PostToolUse (updatedToolOutput), and PostToolUseFailure hooks on inner calls', async () => {
    settleCodeModeOptIn({ state: 'on', source: 'shell' })

    const receivedInputs: unknown[] = []
    const failureEvents: Array<{ toolName: string; error: string }> = []
    const echoTool = {
      name: 'EchoTool',
      inputSchema: {
        safeParse: (v: unknown) => ({ success: true as const, data: v }),
      },
      call: async (inp: { text?: string; shouldFail?: boolean }) => {
        receivedInputs.push(inp)
        if (inp.shouldFail) {
          throw new Error('inner-boom')
        }
        return { data: `echo:${inp.text ?? ''}` }
      },
    }
    const baseRepl = {
      name: 'REPL',
      call: async () => ({ data: 'fallback' }),
    }
    const wrapped = wrapReplToolForCodeMode(baseRepl as never, () => [
      echoTool as never,
    ])

    // 1. PreToolUse updatedInput + PostToolUse updatedToolOutput
    {
      const { sessionId, setAppState, ctx } = makeMockContext(
        'cm-hook-rewrite',
        [echoTool],
      )
      addSessionHook(
        setAppState as never,
        sessionId,
        'PreToolUse',
        'EchoTool',
        {
          type: 'callback',
          callback: async () => ({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              updatedInput: { text: 'rewritten-by-pre' },
            },
          }),
        } as never,
      )
      addSessionHook(
        setAppState as never,
        sessionId,
        'PostToolUse',
        'EchoTool',
        {
          type: 'callback',
          callback: async () => ({
            hookSpecificOutput: {
              hookEventName: 'PostToolUse' as const,
              updatedToolOutput: 'rewritten-by-post',
            },
          }),
        } as never,
      )
      try {
        const res = (await wrapped.call(
          {
            code: 'return await callTool("EchoTool", { text: "original" });',
          } as never,
          ctx as never,
          (async (_t: unknown, inp: unknown) => ({
            behavior: 'allow',
            updatedInput: inp,
          })) as never,
          { message: { id: 'm1' } } as never,
        )) as { data: { result: string } }
        expect(receivedInputs.at(-1)).toEqual({ text: 'rewritten-by-pre' })
        expect(res.data.result).toBe('rewritten-by-post')
      } finally {
        clearSessionHooks(setAppState as never, sessionId)
      }
    }

    // 2. PreToolUse continue:false halts subsequent inner calls in the same script
    {
      const callsBefore = receivedInputs.length
      const { sessionId, setAppState, ctx } = makeMockContext('cm-hook-halt', [
        echoTool,
      ])
      addSessionHook(
        setAppState as never,
        sessionId,
        'PreToolUse',
        'EchoTool',
        {
          type: 'callback',
          callback: async () => ({
            continue: false,
            stopReason: 'halted-by-policy',
          }),
        } as never,
      )
      try {
        const res = (await wrapped.call(
          {
            code: `
              let firstErr = '';
              let secondErr = '';
              try { await callTool("EchoTool", { text: "first" }); } catch (e) { firstErr = e.message; }
              try { await callTool("EchoTool", { text: "second" }); } catch (e) { secondErr = e.message; }
              return { firstErr, secondErr };
            `,
          } as never,
          ctx as never,
          (async (_t: unknown, inp: unknown) => ({
            behavior: 'allow',
            updatedInput: inp,
          })) as never,
          { message: { id: 'm2' } } as never,
        )) as { data: { result: string } }
        expect(receivedInputs.length).toBe(callsBefore)
        expect(res.data.result).toContain('halted-by-policy')
        expect(res.data.result).toContain(
          'every further tool call from it is refused',
        )
      } finally {
        clearSessionHooks(setAppState as never, sessionId)
      }
    }

    // 3. PostToolUseFailure runs when inner tool throws
    {
      const { sessionId, setAppState, ctx } = makeMockContext(
        'cm-hook-failure',
        [echoTool],
      )
      addSessionHook(
        setAppState as never,
        sessionId,
        'PostToolUseFailure',
        'EchoTool',
        {
          type: 'callback',
          callback: async (input: unknown) => {
            const failInput = input as { tool_name: string; error: string }
            failureEvents.push({
              toolName: failInput.tool_name,
              error: failInput.error,
            })
            return {}
          },
        } as never,
      )
      try {
        const res = (await wrapped.call(
          {
            code: 'await callTool("EchoTool", { shouldFail: true });',
          } as never,
          ctx as never,
          (async (_t: unknown, inp: unknown) => ({
            behavior: 'allow',
            updatedInput: inp,
          })) as never,
          { message: { id: 'm3' } } as never,
        )) as { data: { result: string } }
        expect(res.data.result).toContain('inner-boom')
        expect(failureEvents).toEqual([
          { toolName: 'EchoTool', error: 'inner-boom' },
        ])
      } finally {
        clearSessionHooks(setAppState as never, sessionId)
      }
    }
  })

  test('P1 #8a: TOP_LEVEL_DECL_RE only captures column-0 decls and injectUnsetVarGuards ignores shadowed params/strings/comments', () => {
    const vars = extractTopLevelDeclaredVars(
      [
        'const topA = 1;',
        'function f() {',
        '  const nestedB = 2;',
        '  if (true) {',
        '    let nestedC = 3;',
        '  }',
        '}',
        'var topD = 4;',
      ].join('\n'),
    )
    expect(vars).toEqual(['topA', 'topD'])

    const unset = new Set(['data'])
    // Strings and comments must NOT trigger guards
    expect(injectUnsetVarGuards('return "data is ok";', unset)).not.toContain(
      'ReferenceError',
    )
    expect(
      injectUnsetVarGuards('// data was earlier\nreturn 1;', unset),
    ).not.toContain('ReferenceError')
    // Arrow params and function params must NOT trigger guards
    expect(
      injectUnsetVarGuards('return [1, 2].map(data => data + 1);', unset),
    ).not.toContain('ReferenceError')
    expect(
      injectUnsetVarGuards('return [1, 2].map((data, i) => data + i);', unset),
    ).not.toContain('ReferenceError')
    expect(
      injectUnsetVarGuards('function run(data) { return data; }', unset),
    ).not.toContain('ReferenceError')
    // True free references and template interpolations MUST still trigger guards
    expect(injectUnsetVarGuards('return data + 1;', unset)).toContain(
      'ReferenceError',
    )
    expect(injectUnsetVarGuards('return `val=${data}`;', unset)).toContain(
      'ReferenceError',
    )
  })

  test('P1 #8b: failed Edit does NOT invoke Read tool; uses cached content only when Read is allowed', async () => {
    const invoked: string[] = []
    const resWithoutCache = await executeCodeModeScript({
      code: 'await edit({ file_path: "/tmp/a.ts", old_string: "const x = 1", new_string: "const x = 2" });',
      allowedTools: new Set(['Edit']),
      getCachedFileContent: () => 'const x = 10;\n',
      invokeTool: async name => {
        invoked.push(name)
        throw new Error('old_string not found in file')
      },
    })
    expect(invoked).toEqual(['Edit'])
    expect(resWithoutCache.result).toContain('old_string not found')
    // Read is not in allowedTools, so no hint computed from cache
    expect(resWithoutCache.result).not.toContain('Closest match')

    const invoked2: string[] = []
    const resWithCache = await executeCodeModeScript({
      code: 'await edit({ file_path: "/tmp/a.ts", old_string: "const count = 20;", new_string: "const count = 30;" });',
      allowedTools: new Set(['Edit', 'Read']),
      getCachedFileContent: () => 'const count = 10;\n',
      invokeTool: async name => {
        invoked2.push(name)
        throw new Error('old_string not found in file')
      },
    })
    // Must NEVER call invokeTool('Read', ...)
    expect(invoked2).toEqual(['Edit'])
    expect(resWithCache.result).toContain('const count = 10;')
  })

  test('P2 #9: buildCodeModeDevServerGuidance adapts to backgroundTasksDisabled and active mode', () => {
    const disabled = buildCodeModeDevServerGuidance('auto', true)
    expect(disabled).toContain('without awaiting it')
    expect(disabled).not.toContain('/tasks')

    const autoMode = buildCodeModeDevServerGuidance('auto', false)
    expect(autoMode).toContain('auto or bypass-permissions mode')
    expect(autoMode).toContain('/tasks')

    const defaultMode = buildCodeModeDevServerGuidance('default', false)
    expect(defaultMode).not.toContain('auto or bypass-permissions mode')
    expect(defaultMode).toContain('/tasks')
  })

  test('BH2-P1-6: inner PostToolUse continue:false/stopReason, PreToolUse additionalContext, and PostToolUse hook_additional_context/hook_blocking_error surface on script result', async () => {
    settleCodeModeOptIn({ state: 'on', source: 'shell' })

    let callCount = 0
    const echoTool = {
      name: 'EchoTool',
      inputSchema: {
        safeParse: (v: unknown) => ({ success: true as const, data: v }),
      },
      call: async (inp: { text?: string }) => {
        callCount++
        return { data: `echo:${inp.text ?? ''}` }
      },
    }
    const baseRepl = {
      name: 'REPL',
      call: async () => ({ data: 'fallback' }),
    }
    const wrapped = wrapReplToolForCodeMode(baseRepl as never, () => [
      echoTool as never,
    ])

    // 1. PreToolUse additionalContext + PostToolUse additionalContext + PostToolUse blockingError
    {
      const { sessionId, setAppState, ctx } = makeMockContext(
        'cm-hook-feedback',
        [echoTool],
      )
      addSessionHook(
        setAppState as never,
        sessionId,
        'PreToolUse',
        'EchoTool',
        {
          type: 'callback',
          callback: async () => ({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              additionalContext: 'pre-ctx-note',
            },
          }),
        } as never,
      )
      addSessionHook(
        setAppState as never,
        sessionId,
        'PostToolUse',
        'EchoTool',
        {
          type: 'callback',
          callback: async () => ({
            decision: 'block' as const,
            reason: 'post-block-reason',
            hookSpecificOutput: {
              hookEventName: 'PostToolUse' as const,
              additionalContext: 'post-ctx-note',
            },
          }),
        } as never,
      )
      try {
        const res = (await wrapped.call(
          {
            code: 'return await callTool("EchoTool", { text: "ok" });',
          } as never,
          ctx as never,
          (async (_t: unknown, inp: unknown) => ({
            behavior: 'allow',
            updatedInput: inp,
          })) as never,
          { message: { id: 'm-fb' } } as never,
        )) as {
          data: {
            result: string
            hookAdditionalContext?: string[]
            hookBlockingErrors?: string[]
          }
          newMessages?: Array<{
            type: string
            attachment?: { type: string }
          }>
        }
        expect(res.data.hookAdditionalContext).toEqual([
          'pre-ctx-note',
          'post-ctx-note',
        ])
        expect(res.data.hookBlockingErrors).toEqual(['post-block-reason'])
        const attTypes = (res.newMessages ?? []).map(m => m.attachment?.type)
        expect(attTypes).toContain('hook_additional_context')
        expect(attTypes).toContain('hook_blocking_error')
      } finally {
        clearSessionHooks(setAppState as never, sessionId)
      }
    }

    // 2. PostToolUse continue:false halts subsequent inner calls AND surfaces hook_stopped_continuation
    {
      const callsBefore = callCount
      const { sessionId, setAppState, ctx } = makeMockContext('cm-post-halt', [
        echoTool,
      ])
      addSessionHook(
        setAppState as never,
        sessionId,
        'PostToolUse',
        'EchoTool',
        {
          type: 'callback',
          callback: async () => ({
            continue: false,
            stopReason: 'stopped-after-post',
          }),
        } as never,
      )
      try {
        const res = (await wrapped.call(
          {
            code: `
              const first = await callTool("EchoTool", { text: "one" });
              let secondErr = '';
              try { await callTool("EchoTool", { text: "two" }); } catch (e) { secondErr = e.message; }
              return { first, secondErr };
            `,
          } as never,
          ctx as never,
          (async (_t: unknown, inp: unknown) => ({
            behavior: 'allow',
            updatedInput: inp,
          })) as never,
          { message: { id: 'm-post-halt' } } as never,
        )) as {
          data: {
            result: string
            hookStoppedContinuation?: boolean
            hookStopReason?: string
          }
          newMessages?: Array<{
            type: string
            attachment?: { type: string; message?: string }
          }>
        }
        // Only first call ran; second was halted
        expect(callCount).toBe(callsBefore + 1)
        expect(res.data.result).toContain(
          'every further tool call from it is refused',
        )
        expect(res.data.hookStoppedContinuation).toBe(true)
        expect(res.data.hookStopReason).toBe('stopped-after-post')
        const stopAtt = (res.newMessages ?? []).find(
          m => m.attachment?.type === 'hook_stopped_continuation',
        )
        expect(stopAtt?.attachment?.message).toBe('stopped-after-post')
      } finally {
        clearSessionHooks(setAppState as never, sessionId)
      }
    }
  })

  test('BH2-P1-7: $-ending identifiers, regex literals containing quotes, and plain assignment unset clearing', async () => {
    // 1. $-ending identifiers
    expect(extractTopLevelDeclaredVars('const x$ = 1;\nlet y$ = 2;')).toEqual([
      'x$',
      'y$',
    ])
    expect(
      injectUnsetVarGuards('const x$ = 1;\nreturn x$;', new Set(['x$'])),
    ).not.toContain('ReferenceError')
    expect(
      injectUnsetVarGuards(
        'if (typeof x$ === "undefined") {}',
        new Set(['x$']),
      ),
    ).not.toContain('ReferenceError')
    expect(
      injectUnsetVarGuards('const fn = (x$) => x$;', new Set(['x$'])),
    ).not.toContain('ReferenceError')
    expect(injectUnsetVarGuards('return x$ + 1;', new Set(['x$']))).toContain(
      'ReferenceError',
    )

    // 2. Regex literal containing a single quote must NOT swallow the rest of the file
    expect(
      injectUnsetVarGuards(
        "const re = /'/;\nreturn unsetVar;",
        new Set(['unsetVar']),
      ),
    ).toContain('ReferenceError')
    expect(
      injectUnsetVarGuards(
        "const ok = /'[/]'/.test(s);\nreturn unsetVar;",
        new Set(['unsetVar']),
      ),
    ).toContain('ReferenceError')
    // Division after identifier must still work without swallowing code
    expect(
      injectUnsetVarGuards(
        'const q = a / b / c;\nreturn unsetVar;',
        new Set(['unsetVar']),
      ),
    ).toContain('ReferenceError')

    // 3. Plain assignment clears sessionUnsetVarsByKey across script runs
    expect(
      extractAssignedVars('foo = 42;\n// bar = 1\nconst s = "baz = 2";'),
    ).toEqual(['foo'])

    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    const baseRepl = {
      name: 'REPL',
      call: async () => ({ data: 'fallback' }),
    }
    const wrapped = wrapReplToolForCodeMode(baseRepl as never, () => [])
    const { ctx } = makeMockContext('cm-plain-assign', [])
    const allowAll = (async (_t: unknown, inp: unknown) => ({
      behavior: 'allow',
      updatedInput: inp,
    })) as never

    // Script 1 declares foo at top level and throws -> foo recorded as unset
    const r1 = (await wrapped.call(
      { code: 'let foo;\nthrow new Error("fail-step-1");' } as never,
      ctx as never,
      allowAll,
      { message: { id: 'm-a1' } } as never,
    )) as { data: { unsetVariables?: string[] } }
    expect(r1.data.unsetVariables).toContain('foo')

    // Script 2 sets foo via plain assignment -> clears foo from unset set
    await wrapped.call(
      { code: 'foo = 123;\nreturn foo;' } as never,
      ctx as never,
      allowAll,
      { message: { id: 'm-a2' } } as never,
    )

    // Script 3 reads typeof/uses foo without re-declaring -> no stale unset-var ReferenceError
    const r3 = (await wrapped.call(
      { code: 'return typeof foo === "undefined" ? "ok" : foo;' } as never,
      ctx as never,
      allowAll,
      { message: { id: 'm-a3' } } as never,
    )) as { data: { result: string } }
    expect(r3.data.result).not.toContain('earlier step never set')
  })

  test('D-P1-5 + D-P2-8: template 2nd interpolation regex, keyword member-access division, stripped extractTopLevelDeclaredVars, and destructuring default RHS', () => {
    const unset = new Set(['unsetVar'])

    // 1. 2nd template interpolation starting with regex literal containing a quote
    expect(
      injectUnsetVarGuards(
        "const s = `${x} ${/'/g}`;\nreturn unsetVar;",
        unset,
      ),
    ).toContain('ReferenceError')

    // 2. Keyword member-access division (`obj.in / unsetVar / 2`) must NOT lex as regex literal
    expect(
      injectUnsetVarGuards(
        'const v = obj.in / unsetVar / 2;\nreturn v;',
        unset,
      ),
    ).toContain('ReferenceError')
    // Parenthesized expression division stays division, while `if (...) /re/` lexes as regex
    expect(
      injectUnsetVarGuards(
        'const v = (a + b) / unsetVar / 2;\nreturn v;',
        unset,
      ),
    ).toContain('ReferenceError')
    expect(
      injectUnsetVarGuards("if (cond) /'/.test(s);\nreturn unsetVar;", unset),
    ).toContain('ReferenceError')

    // 3. extractTopLevelDeclaredVars scans stripped source so multiline templates & block comments don't yield phantom vars
    const vars = extractTopLevelDeclaredVars(
      [
        '/*',
        'const phantomComment = 1;',
        'let phantomComment2 = 2;',
        '*/',
        'const tpl = `',
        'const phantomTpl = 3;',
        'var phantomTpl2 = 4;',
        '`;',
        'const realVar = 5;',
      ].join('\n'),
    )
    expect(vars).toEqual(['tpl', 'realVar'])

    // 4. Destructuring default RHS (`const { a = unsetVar } = obj`, `const [a = unsetVar] = arr`, `const { unsetVar: alias } = obj`)
    //    must NOT treat `unsetVar` as bound, while true destructuring bindings MUST still count as bound
    expect(
      injectUnsetVarGuards('const { a = unsetVar } = obj;\nreturn a;', unset),
    ).toContain('ReferenceError')
    expect(
      injectUnsetVarGuards('const [a = unsetVar] = arr;\nreturn a;', unset),
    ).toContain('ReferenceError')
    expect(
      injectUnsetVarGuards(
        'const { a: { b = unsetVar } } = obj;\nreturn b;',
        unset,
      ),
    ).toContain('ReferenceError')
    expect(
      injectUnsetVarGuards(
        'const { unsetVar: alias } = obj;\nreturn unsetVar;',
        unset,
      ),
    ).toContain('ReferenceError')
    expect(
      injectUnsetVarGuards(
        'const { unsetVar = 1 } = obj;\nreturn unsetVar;',
        unset,
      ),
    ).not.toContain('ReferenceError')
    expect(
      injectUnsetVarGuards(
        'const { a: unsetVar } = obj;\nreturn unsetVar;',
        unset,
      ),
    ).not.toContain('ReferenceError')
    expect(
      injectUnsetVarGuards(
        'const { ...unsetVar } = obj;\nreturn unsetVar;',
        unset,
      ),
    ).not.toContain('ReferenceError')
  })
})
