import { afterEach, describe, expect, test } from 'bun:test'
import {
  CODE_MODE_DOCS_URL,
  CODE_MODE_ENV_VAR,
  codeModeRefusalReasonText,
  engineCheckResult,
  executeCodeModeScript,
  getCodeModeOptInState,
  hideCodeModeOnlyTools,
  isCodeModeDisabledByOrgOrManaged,
  isCodeModeEnabled,
  planCodeModeFromSession,
  resetCodeModeOptInStateForTests,
  runReplEngineRealmCheck,
  setEngineCheckResultForTests,
  settleCodeModeOptInAtStartup,
  wrapReplToolForCodeMode,
} from '../index.js'

describe('Wave 323 #1964: Experimental Code Mode', () => {
  afterEach(() => {
    resetCodeModeOptInStateForTests()
    delete process.env[CODE_MODE_ENV_VAR]
  })

  test('settles opt-in on when CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 and gates pass', async () => {
    setEngineCheckResultForTests('passed')
    const decision = await settleCodeModeOptInAtStartup({
      env: { [CODE_MODE_ENV_VAR]: '1' },
      shellEnv: { [CODE_MODE_ENV_VAR]: '1' },
      isFirstPartyProvider: true,
      isModelSupported: true,
      hasFeatureFlags: true,
      isGateOpen: true,
      caveatsAccepted: true,
    })
    expect(decision).toEqual({ state: 'on', source: 'shell' })
    expect(isCodeModeEnabled()).toBe(true)
    expect(getCodeModeOptInState()).toEqual({ state: 'on', source: 'shell' })
  })

  test('refuses when disabled by org or managed settings and surfaces official refusal text', async () => {
    expect(
      isCodeModeDisabledByOrgOrManaged({
        orgDisabled: true,
      }),
    ).toBe(true)
    expect(
      isCodeModeDisabledByOrgOrManaged({
        managedSettingsEnv: { [CODE_MODE_ENV_VAR]: '0' },
      }),
    ).toBe(true)

    const decision = await settleCodeModeOptInAtStartup({
      env: { [CODE_MODE_ENV_VAR]: '1' },
      shellEnv: { [CODE_MODE_ENV_VAR]: '1' },
      orgDisabled: true,
      isFirstPartyProvider: true,
      isModelSupported: true,
      hasFeatureFlags: true,
      isGateOpen: true,
      caveatsAccepted: true,
    })
    expect(decision).toEqual({ state: 'refused', why: 'admin' })
    expect(isCodeModeEnabled()).toBe(false)
    expect(codeModeRefusalReasonText('admin')).toContain(
      "organization's settings don't allow it",
    )
    expect(CODE_MODE_DOCS_URL).toBe('https://code.claude.com/docs/en/code-mode')
  })

  test('engine check reflects real probe and JS VM executor invokes primitive tools and enforces toolCallCap', async () => {
    expect(engineCheckResult()).toBe(runReplEngineRealmCheck())
    setEngineCheckResultForTests('passed')
    expect(engineCheckResult()).toBe('passed')

    const calls: Array<{ name: string; input: Record<string, unknown> }> = []
    const res = await executeCodeModeScript({
      code: `
        const a = await read({ file_path: '/tmp/a.txt' });
        const b = await callTool('Grep', { pattern: 'foo' });
        console.log('done', a.ok);
        return { a, b };
      `,
      invokeTool: async (name, input) => {
        calls.push({ name, input })
        return { ok: true, name }
      },
    })
    expect(res.tool_calls).toBe(2)
    expect(calls.map(c => c.name)).toEqual(['Read', 'Grep'])
    expect(res.result).toContain('done true')
    expect(res.result).toContain('"Grep"')

    const capped = await executeCodeModeScript({
      code: `
        await read({ file_path: '1' });
        await read({ file_path: '2' });
      `,
      toolCallCap: 1,
      invokeTool: async () => 'ok',
    })
    expect(capped.result).toMatch(/Error:.*cap|limit/i)
  })

  test('hideCodeModeOnlyTools hides primitive tools when Code Mode is on and planCodeModeFromSession refuses resuming Code Mode when off', async () => {
    const fakeRepl = {
      name: 'REPL',
      call: async () => ({ data: { result: 'fallback', tool_calls: 0 } }),
    }
    const fakeRead = { name: 'Read' }
    const wrapped = wrapReplToolForCodeMode(fakeRepl as never, () => [])
    expect(wrapped.name).toBe('REPL')

    const plan = planCodeModeFromSession({
      replMode: true,
      sessionId: 'sess-1',
    })
    expect(plan.refused).toContain('Code Mode')

    setEngineCheckResultForTests('passed')
    await settleCodeModeOptInAtStartup({
      env: { [CODE_MODE_ENV_VAR]: '1' },
      shellEnv: { [CODE_MODE_ENV_VAR]: '1' },
      isFirstPartyProvider: true,
      isModelSupported: true,
      hasFeatureFlags: true,
      isGateOpen: true,
      caveatsAccepted: true,
    })
    expect(
      hideCodeModeOnlyTools([fakeRepl, fakeRead]).map(t => t.name),
    ).toContain('REPL')
  })

  test('#1964: executeCodeModeScript cleans up abort listener and suppresses late rejection after timeout/abort', async () => {
    // 1. Abort listener is removed when script completes normally
    const ac = new AbortController()
    let added = 0
    let removed = 0
    const origAdd = ac.signal.addEventListener.bind(ac.signal)
    const origRemove = ac.signal.removeEventListener.bind(ac.signal)
    ac.signal.addEventListener = ((...args: unknown[]) => {
      if (args[0] === 'abort') added++
      return (origAdd as (...a: unknown[]) => void)(...args)
    }) as typeof ac.signal.addEventListener
    ac.signal.removeEventListener = ((...args: unknown[]) => {
      if (args[0] === 'abort') removed++
      return (origRemove as (...a: unknown[]) => void)(...args)
    }) as typeof ac.signal.removeEventListener

    const ok = await executeCodeModeScript({
      code: 'return 42',
      signal: ac.signal,
      invokeTool: async () => 'ok',
    })
    expect(ok.result).toBe('42')
    expect(added).toBe(1)
    expect(removed).toBe(1)

    // 2. Late rejection after abort does not trigger unhandledRejection
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      let rejectPending: ((err: Error) => void) | undefined
      const abortCtrl = new AbortController()
      const resPromise = executeCodeModeScript({
        code: 'await callTool("SlowTool", {}); return "done"',
        signal: abortCtrl.signal,
        invokeTool: () =>
          new Promise<unknown>((_resolve, reject) => {
            rejectPending = reject
          }),
      })
      await new Promise(r => setTimeout(r, 10))
      abortCtrl.abort()
      const res = await resPromise
      expect(res.result).toContain('aborted')
      // Now reject the underlying tool call after abort already settled
      rejectPending?.(new Error('late tool failure'))
      await new Promise(r => setTimeout(r, 20))
      expect(unhandled).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
