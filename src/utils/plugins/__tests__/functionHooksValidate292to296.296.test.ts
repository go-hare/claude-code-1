import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  AGENT_SPAWN_HOP_SITE,
  agentSpawnUnappliedWarning,
  assertHookValueDepth,
  beginFunctionHooksWorkerReplacement,
  callPluginInterface,
  createRemoteAutocompleteDispatcher,
  extractAutocompleteToken,
  finalizeOwnedTable,
  FUNCTION_HOOK_EVENTS,
  getCurrentHeldTurnId,
  handleHostOp,
  hasClassicFunctionHook,
  hasMatchingFunctionHook,
  HOOK_DEPTH_LIMIT_MESSAGE,
  HOOK_VM_DEPTH_LIMIT_MESSAGE,
  MAX_HOOK_VALUE_DEPTH,
  MAX_HOOK_VM_DEPTH,
  PROMPT_AUTOCOMPLETE_HOP_SITE,
  runFunctionHookChain,
  runPromptAutocomplete,
  runWorkflowAgentSpawn,
  scanFunctionHookSource,
  setLoadedFunctionHooksModules,
  setToolCallHandler,
  setTurnAbortHandler,
} from '../functionHooksModules.js'
import {
  analyzeHookModuleStateAndMatchers,
  collectReadmeInstallAdvice,
  formatReadmeInstallAdvice,
  validateManifest,
} from '../validatePlugin.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  setLoadedFunctionHooksModules([])
  setToolCallHandler(undefined)
  setTurnAbortHandler(undefined)
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('v2.1.292-296 FunctionHooks & ValidatePlugin alignment', () => {
  test('#196 prompt.autocomplete event, token extraction, hop site, and remote superseding', async () => {
    expect(FUNCTION_HOOK_EVENTS).toContain('prompt.autocomplete')
    expect(FUNCTION_HOOK_EVENTS).toContain('prompt.change')
    expect(FUNCTION_HOOK_EVENTS).toContain('prompt.mention')

    expect(
      extractAutocompleteToken({ text: 'hello ', cursor: 6 }),
    ).toBeUndefined()
    expect(
      extractAutocompleteToken({ text: 'hello /foo', cursor: 10 }),
    ).toEqual({
      text: 'hello /foo',
      cursor: 10,
      token: '/foo',
      start: 6,
    })

    expect(PROMPT_AUTOCOMPLETE_HOP_SITE.check?.({ suggestions: 'bad' })).toBe(
      'no { suggestions } (a list)',
    )
    expect(
      PROMPT_AUTOCOMPLETE_HOP_SITE.check?.({ suggestions: [{ label: 'x' }] }),
    ).toBe('a suggestion without { text } (a string)')

    setLoadedFunctionHooksModules([
      {
        name: 'ac-mod',
        patterns: ['prompt.autocomplete'],
        hooks: [
          {
            pattern: 'prompt.autocomplete',
            hook: async (_api, e, next) => {
              const base = (await next(e)) as { suggestions: unknown[] }
              return {
                suggestions: [
                  ...base.suggestions,
                  {
                    text: '/deploy',
                    label: '  deploy  app ',
                    description: 'Ship',
                  },
                ],
              }
            },
          },
        ],
      },
    ])

    const res = await runPromptAutocomplete({ text: 'run /de', cursor: 7 })
    expect(res).toEqual({
      start: 4,
      suggestions: [
        { text: '/deploy', label: 'deploy app', description: 'Ship' },
      ],
    })

    // Remote composer superseding: waiting ask is superseded when a newer ask arrives
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(r => {
      releaseFirst = r
    })
    let calls = 0
    const dispatcher = createRemoteAutocompleteDispatcher(async tokenInfo => {
      calls += 1
      if (calls === 1) await firstGate
      return { suggestions: [{ text: tokenInfo.token + '!' }] }
    })

    const p1 = dispatcher.ask('client-1', { text: '/a', cursor: 2 })
    const p2 = dispatcher.ask('client-1', { text: '/b', cursor: 2 })
    const p3 = dispatcher.ask('client-1', { text: '/c', cursor: 2 })
    // p2 was queued behind in-flight p1 and overtaken by p3
    expect(await p2).toEqual({ suggestions: [], superseded: true })
    releaseFirst()
    expect(await p1).toEqual({ start: 0, suggestions: [{ text: '/a!' }] })
    expect(await p3).toEqual({ start: 0, suggestions: [{ text: '/c!' }] })
  })

  test('#198 agent.spawn supports workflow agents with run and index and allows refusal', async () => {
    expect(
      agentSpawnUnappliedWarning(
        {
          prompt: 'hi',
          description: 'changed',
          workflow: { run: 'wf-1', index: 0 },
        },
        {
          prompt: 'hi',
          description: 'orig',
          workflow: { run: 'wf-1', index: 0 },
        },
      ),
    ).toBe('`description` does not apply to a workflow agent')

    expect(
      AGENT_SPAWN_HOP_SITE.checkArgument?.(
        {
          prompt: 'hi',
          workflow: { run: 'wf-1', index: 1 },
        },
        {
          prompt: 'hi',
          workflow: { run: 'wf-1', index: 0 },
        },
      ),
    ).toContain('the identity of the spawn and its parent is pinned')

    setLoadedFunctionHooksModules([
      {
        name: 'wf-guard',
        patterns: ['agent.spawn'],
        hooks: [
          {
            pattern: 'agent.spawn',
            hook: async (_api, e, next) => {
              const wf = e.workflow as
                | { run: string; index: number }
                | undefined
              if (wf?.index === 1) {
                return { deny: 'workflow step 1 blocked' }
              }
              return next({ ...e, prompt: `${String(e.prompt)} [checked]` })
            },
          },
        ],
      },
    ])

    const allowed = await runWorkflowAgentSpawn(
      { prompt: 'step 0', workflow: { run: 'wf-1', index: 0 } },
      async passed => ({ ok: true, prompt: passed.prompt }),
    )
    expect(allowed).toEqual({
      ok: true,
      value: { ok: true, prompt: 'step 0 [checked]' },
    })

    const refused = await runWorkflowAgentSpawn(
      { prompt: 'step 1', workflow: { run: 'wf-1', index: 1 } },
      async () => ({ ok: true }),
    )
    expect(refused).toEqual({ ok: false, deny: 'workflow step 1 blocked' })
  })

  test('#305 classic.* events wait for worker replacement instead of being skipped', async () => {
    setLoadedFunctionHooksModules([])
    const finish = beginFunctionHooksWorkerReplacement()

    expect(hasClassicFunctionHook('PreToolUse')).toBe(true)
    expect(hasMatchingFunctionHook('PreToolUse')).toBe(true)

    let settled = false
    const chainPromise = runFunctionHookChain(
      'PreToolUse',
      { tool_name: 'Bash' },
      async () => ({ decision: 'settings-tail' }),
    ).then(res => {
      settled = true
      return res
    })

    await Promise.resolve()
    expect(settled).toBe(false)

    // Replacement finishes with a module hooking classic.PreToolUse
    setLoadedFunctionHooksModules([
      {
        name: 'classic-mod',
        patterns: ['classic.PreToolUse'],
        hooks: [
          {
            pattern: 'classic.PreToolUse',
            hook: async () => ({ decision: 'mod-answered' }),
          },
        ],
      },
    ])
    finish()

    expect(await chainPromise).toEqual({ decision: 'mod-answered' })
    expect(settled).toBe(true)
  })

  test('#352 collectReadmeInstallAdvice & formatReadmeInstallAdvice emit non-fatal advice without changing verdict', async () => {
    const dir = makeTempDir('validate-readme-')
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'cool-plugin', version: '1.0.0' }),
    )
    writeFileSync(join(dir, 'README.md'), '# Cool Plugin\n\nJust a readme.\n')

    const result = await validateManifest(dir)
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])

    const advice = await collectReadmeInstallAdvice(dir, result)
    expect(advice.length).toBe(1)
    expect(advice[0]!.message).toContain(
      'This README has no line that installs "cool-plugin" from a marketplace.',
    )
    expect(advice[0]!.installLine).toBe(
      '/plugin install cool-plugin --marketplace <owner>/<repo>',
    )

    const formatted = formatReadmeInstallAdvice(advice).join('\n')
    expect(formatted).toContain('Advice (does not change the verdict):')
    expect(formatted).toContain(
      '/plugin install cool-plugin --marketplace <owner>/<repo>',
    )

    // Adding the install line suppresses the advice
    writeFileSync(
      join(dir, 'README.md'),
      '# Cool Plugin\n\n```\n/plugin install cool-plugin --marketplace my-org/my-mkt\n```\n',
    )
    const afterAdvice = await collectReadmeInstallAdvice(dir, result)
    expect(afterAdvice).toEqual([])
  })

  test('#381 deeply nested tool input is checked iteratively and refuses > 100000 / > 28000 levels', async () => {
    // Build a 30,000-level nested object iteratively (no stack overflow)
    let deep30k: Record<string, unknown> = { leaf: 1 }
    for (let i = 0; i < 30_000; i++) {
      deep30k = { nested: deep30k }
    }
    expect(() =>
      assertHookValueDepth(deep30k, MAX_HOOK_VALUE_DEPTH),
    ).not.toThrow()
    expect(() => assertHookValueDepth(deep30k, MAX_HOOK_VM_DEPTH)).toThrow(
      HOOK_VM_DEPTH_LIMIT_MESSAGE,
    )

    let deep100kPlus: Record<string, unknown> = { leaf: 1 }
    for (let i = 0; i <= MAX_HOOK_VALUE_DEPTH; i++) {
      deep100kPlus = { nested: deep100kPlus }
    }
    expect(() => assertHookValueDepth(deep100kPlus)).toThrow(
      HOOK_DEPTH_LIMIT_MESSAGE,
    )

    setLoadedFunctionHooksModules([
      {
        name: 'guard-mod',
        patterns: ['tool.call'],
        hooks: [
          {
            pattern: 'tool.call',
            hook: async (_api, e, next) => next(e),
          },
        ],
      },
    ])
    await expect(
      runFunctionHookChain(
        'tool.call',
        { tool: 'Bash', input: deep100kPlus },
        async () => ({
          ok: true,
        }),
      ),
    ).rejects.toThrow(HOOK_DEPTH_LIMIT_MESSAGE)
  })

  test('#399 guard hook .catch is refused during worker replacement instead of letting call pass', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'guard-with-catch',
        patterns: ['tool.call'],
        hooks: [
          {
            pattern: 'tool.call',
            hook: async () => {
              throw new Error('hooks worker exited 1')
            },
            catch: async () => ({ ok: true }),
          },
        ],
      },
    ])

    await expect(
      runFunctionHookChain('tool.call', { tool: 'Bash' }, async () => ({
        ok: true,
      })),
    ).rejects.toThrow('hooks worker exited 1')
  })

  test('#400 code nested > 2000 scopes refuses cleanly in scanFunctionHookSource and analyzeHookModuleStateAndMatchers', () => {
    const deepBlocks = '{'.repeat(2005) + '}'.repeat(2005)
    const src = `export function register(on) { on('prompt.submit', () => ${deepBlocks}) }`

    const scanRes = scanFunctionHookSource(src)
    expect(scanRes.ok).toBe(false)
    expect(scanRes.reason).toContain(
      'code nested too deep to scan: more than 2000 scopes',
    )

    const analysis = analyzeHookModuleStateAndMatchers('deep.ts', src)
    expect(analysis.error).toContain(
      'code nested too deep to scan: more than 2000 scopes',
    )
  })

  test('#451 rebound top-level var error names the line that rebinds it, the cause, and a fix', () => {
    const src = [
      "var ref = { plugin: 'p', key: 'k' }",
      "var ref = { plugin: 'p', key: 'k2' }",
      'async function run($: any) {',
      '  return $.state.get(ref)',
      '}',
    ].join('\n')

    const res = analyzeHookModuleStateAndMatchers('rebound.ts', src)
    expect(res.error).toContain('compiled line 2')
    expect(res.error).toContain(
      'the var ref, read for a $.state reference, is declared here too',
    )
    expect(res.error).toContain('Declare it once')
  })

  test('#460 $.tool.call denied after tool ran reports "ran, and a plugin withheld its result"', async () => {
    let toolRan = 0
    setToolCallHandler(async () => {
      toolRan += 1
      return { text: 'secret output', result: { secret: true } }
    })

    // Denied BEFORE running
    setLoadedFunctionHooksModules([
      {
        name: 'pre-deny',
        patterns: ['tool.call'],
        hooks: [
          {
            pattern: 'tool.call',
            hook: async () => ({ deny: 'blocked before run' }),
          },
        ],
      },
    ])
    await expect(
      handleHostOp(
        'tool.call',
        [{ tool: 'Read', file_path: 'a.txt' }],
        'caller-mod',
      ),
    ).rejects.toThrow('caller-mod: $.tool.call: blocked before run')
    expect(toolRan).toBe(0)

    // Denied AFTER tool ran
    setLoadedFunctionHooksModules([
      {
        name: 'post-deny',
        patterns: ['tool.call'],
        hooks: [
          {
            pattern: 'tool.call',
            hook: async (_api, e, next) => {
              await next(e)
              return { deny: 'output redacted' }
            },
          },
        ],
      },
    ])
    await expect(
      handleHostOp(
        'tool.call',
        [{ tool: 'Read', file_path: 'a.txt' }],
        'caller-mod',
      ),
    ).rejects.toThrow(
      'caller-mod: $.tool.call ran, and a plugin withheld its result: output redacted',
    )
    expect(toolRan).toBe(1)
  })

  test('#509 served $ methods inherit calling agent cwd and held turnId', async () => {
    const agentDir = makeTempDir('agent-cwd-')
    writeFileSync(join(agentDir, 'note.txt'), 'from-agent-dir', 'utf8')

    let abortedTurn: string | undefined
    setTurnAbortHandler(async ({ turnId }) => {
      abortedTurn = turnId
      return undefined
    })

    finalizeOwnedTable('svc-mod', {
      helper: {
        inspect: async () => {
          const cwd = await handleHostOp('session.cwd', [{}], 'svc-mod')
          const text = await handleHostOp(
            'fs.read',
            [{ path: 'note.txt' }],
            'svc-mod',
          )
          const held = getCurrentHeldTurnId()
          await handleHostOp('turn.abort', [{}], 'svc-mod')
          return { cwd, text, held }
        },
      },
    })

    setLoadedFunctionHooksModules([
      {
        name: 'caller-mod',
        patterns: ['tool.call'],
        hooks: [
          {
            pattern: 'tool.call',
            hook: async () =>
              callPluginInterface('svc-mod', {
                name: 'helper',
                method: 'inspect',
              }),
          },
        ],
      },
    ])

    const res = await runFunctionHookChain(
      'tool.call',
      { tool: 'Bash', cwd: agentDir, turnId: 'turn-agent-42' },
      async () => ({ ok: true }),
    )
    expect(res).toEqual({
      cwd: agentDir,
      text: 'from-agent-dir',
      held: 'turn-agent-42',
    })
    expect(abortedTurn).toBe('turn-agent-42')
  })

  test('#510 $.agent.register is refused when called from a reloaded or removed mod hook', async () => {
    let registerPromise: Promise<unknown> | undefined
    let releaseHook!: () => void
    const hookGate = new Promise<void>(r => {
      releaseHook = r
    })

    setLoadedFunctionHooksModules([
      {
        name: 'reloading-mod',
        patterns: ['prompt.submit'],
        hooks: [
          {
            pattern: 'prompt.submit',
            hook: async $ => {
              await hookGate
              const agentNs = $.agent as {
                register: (spec: Record<string, unknown>) => Promise<unknown>
              }
              return agentNs.register({
                name: 'late-agent',
                description: 'too late',
                prompt: 'run',
              })
            },
          },
        ],
      },
    ])

    registerPromise = runFunctionHookChain(
      'prompt.submit',
      { text: 'hi' },
      async () => ({}),
    )

    // Reload the mod with a new module instance (same name) while hook is in-flight
    setLoadedFunctionHooksModules([
      {
        name: 'reloading-mod',
        patterns: ['prompt.submit'],
        hooks: [],
      },
    ])
    releaseHook()

    await expect(registerPromise).rejects.toThrow(
      'reloading-mod: $.agent.register refused: the hooks module that made the call is no longer loaded (it was reloaded or removed)',
    )
  })

  test('#511 $.http.fetch allows HEAD with Content-Length over 4 MiB while still refusing GET', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const headers = new Headers({
        'content-length': String(10 * 1024 * 1024),
      })
      return new Response(init?.method === 'HEAD' ? null : 'ok', {
        status: 200,
        headers,
      })
    }) as unknown as typeof fetch

    try {
      const headRes = await handleHostOp(
        'http.fetch',
        [{ url: 'https://example.com/big.bin', init: { method: 'HEAD' } }],
        'net-mod',
      )
      expect(headRes).toMatchObject({ ok: true, status: 200, text: '' })

      await expect(
        handleHostOp(
          'http.fetch',
          [{ url: 'https://example.com/big.bin', init: { method: 'GET' } }],
          'net-mod',
        ),
      ).rejects.toThrow('over the 4194304-byte limit')
    } finally {
      globalThis.fetch = origFetch
    }
  })
})
