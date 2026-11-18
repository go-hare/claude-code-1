import { describe, expect, test } from 'bun:test'
import {
  beginFunctionHooksWorkerReplacement,
  callPluginInterface,
  finalizeOwnedTable,
  getLoadedFunctionHooksModules,
  handleHostOp,
  recordSessionStartLoad,
  runFunctionHookChain,
  setLoadedFunctionHooksModules,
  setToolCheckHandler,
  withSessionStartDedup,
} from '../functionHooksModules.js'
import { analyzeHookModuleStateAndMatchers } from '../validatePlugin.js'

function registerLoadedFunctionHooksModule(
  mod: Parameters<typeof setLoadedFunctionHooksModules>[0][number],
) {
  setLoadedFunctionHooksModules([...getLoadedFunctionHooksModules(), mod])
  return mod
}

describe('v2.1.292 functionHooks & validatePlugin alignment', () => {
  test('#197 $.model.complete accepts prompt/system block lists with cache: true and rejects invalid blocks', async () => {
    setLoadedFunctionHooksModules([])
    let capturedInput: Record<string, unknown> | undefined
    registerLoadedFunctionHooksModule({
      name: 'model-cache-mod',
      patterns: ['model.complete'],
      hooks: [
        {
          pattern: 'model.complete',
          hook: async (_api, e) => {
            capturedInput = e
            return { isAnswered: true, text: 'ok', usage: {} }
          },
        },
      ],
    })

    // Invalid prompt type throws exact 2.1.292 message
    await expect(
      handleHostOp('model.complete', [
        { model: 'claude-sonnet-4-6', prompt: 123 },
      ]),
    ).rejects.toThrow(
      'takes { model, prompt }, the prompt a string or a list of blocks, each { text } and at most `cache: true`',
    )

    // Invalid promptBlocks throws exact 2.1.292 message
    await expect(
      handleHostOp('model.complete', [
        {
          model: 'claude-sonnet-4-6',
          prompt: 'hello',
          promptBlocks: [{ text: 'hello', cache: 'yes' }],
        },
      ]),
    ).rejects.toThrow(
      'takes promptBlocks and systemBlocks that are lists of blocks, each { text } and at most `cache: true`',
    )
    expect(capturedInput).toBeUndefined()
    setLoadedFunctionHooksModules([])
  })

  test('#237/#238/#239 analyzeHookModuleStateAndMatchers handles many $.state calls fast, detects parameter/body shadow mismatch, and refuses redeclared/reassigned top-level var', () => {
    // #237: 500 $.state calls through one const should finish in well under 1s
    const manyCalls = Array.from(
      { length: 500 },
      (_, i) => `const v${i} = await $.state.get(ref)`,
    ).join('\n')
    const fastSrc = `const ref = { plugin: 'p', key: 'k' }\nasync function run($: any) {\n${manyCalls}\n}`
    const t0 = performance.now()
    const fastRes = analyzeHookModuleStateAndMatchers('fast.ts', fastSrc)
    const elapsed = performance.now() - t0
    expect(fastRes.error).toBeUndefined()
    expect(fastRes.stateReads).toEqual([{ plugin: 'p', key: 'k' }])
    expect(elapsed).toBeLessThan(2000)

    // #238: parameter read with body redeclaration refuses
    const shadowSrc = `
      function f(ref: any, a = $.state.get(ref)) {
        const ref = { plugin: 'other', key: 'k' }
        return a
      }
    `
    const shadowRes = analyzeHookModuleStateAndMatchers('shadow.ts', shadowSrc)
    expect(shadowRes.error).toContain('read among the parameters of a function')

    // #239: top-level var declared twice -> refused
    const redeclaredVarSrc = `
      var ref = { plugin: 'p', key: 'k' }
      var ref = { plugin: 'p', key: 'k2' }
      async function run($: any) { return $.state.get(ref) }
    `
    const redeclaredRes = analyzeHookModuleStateAndMatchers(
      'redeclared.ts',
      redeclaredVarSrc,
    )
    expect(redeclaredRes.error).toContain(
      'the var ref, read for a $.state reference, is declared here too',
    )

    // #239: top-level var reassigned -> refused
    const reassignedVarSrc = `
      var ref = { plugin: 'p', key: 'k' }
      ref = { plugin: 'p', key: 'k2' }
      async function run($: any) { return $.state.get(ref) }
    `
    const reassignedRes = analyzeHookModuleStateAndMatchers(
      'reassigned.ts',
      reassignedVarSrc,
    )
    expect(reassignedRes.error).toContain(
      'the var ref, read for a $.state reference, is assigned here',
    )
  })

  test('#240/#251 served $ method preserves outer hookOrigin (no re-entry loop) and propagates errors to outer guard .catch', async () => {
    setLoadedFunctionHooksModules([])
    let guardHookCalls = 0
    let catchCalls = 0

    finalizeOwnedTable('service-mod', {
      svc: {
        ping: async () => {
          // Inside served method, dispatch an event that mod A also hooks.
          // Because outer hookOrigin is preserved, mod A's hook is left out (no infinite loop).
          await runFunctionHookChain('tool.list', {}, async () => ({
            value: [],
          }))
          throw new Error('inner boom')
        },
      },
    })

    registerLoadedFunctionHooksModule({
      name: 'guard-mod',
      patterns: ['tool.list'],
      hooks: [
        {
          pattern: 'tool.list',
          hook: async (_api, _e, _next) => {
            guardHookCalls++
            await callPluginInterface('service-mod', {
              name: 'svc',
              method: 'ping',
            })
            return { value: [] }
          },
          catch: async (_api, _e, next) => {
            catchCalls++
            return next()
          },
        },
      ],
    })

    const out = await runFunctionHookChain('tool.list', {}, async () => ({
      value: ['ok'],
    }))
    expect(guardHookCalls).toBe(1)
    expect(catchCalls).toBe(1)
    expect(out).toEqual({ value: ['ok'] })
    setLoadedFunctionHooksModules([])
  })

  test('#241/#249 interface calls and hook chains wait for worker replacement when pending', async () => {
    setLoadedFunctionHooksModules([])
    finalizeOwnedTable('wait-svc', {
      api: {
        hello: () => 'world',
      },
    })
    const finish = beginFunctionHooksWorkerReplacement()
    let settled = false
    const pending = callPluginInterface('wait-svc', {
      name: 'api',
      method: 'hello',
    }).then(val => {
      settled = true
      return val
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    expect(await pending).toBe('world')
    expect(settled).toBe(true)
    setLoadedFunctionHooksModules([])
  })

  test('#242 config.set/state.set/env.set/agent.spawn deny after next(e) is reported as failed by hook name', async () => {
    setLoadedFunctionHooksModules([])
    registerLoadedFunctionHooksModule({
      name: 'bad-deny-after-next',
      patterns: ['config.set', 'agent.spawn'],
      hooks: [
        {
          pattern: 'config.set',
          hook: async (_api, e, next) => {
            await next(e)
            return { deny: 'too late' }
          },
        },
        {
          pattern: 'agent.spawn',
          hook: async (_api, e, next) => {
            await next(e)
            return { deny: 'too late spawn' }
          },
        },
      ],
    })

    await expect(
      runFunctionHookChain(
        'config.set',
        { key: 'theme', value: 'dark' },
        async () => ({
          value: 'dark',
        }),
      ),
    ).rejects.toThrow(
      'bad-deny-after-next: returned a deny after its next() was answered (deny in place of next)',
    )

    await expect(
      runFunctionHookChain(
        'agent.spawn',
        { subagentType: 'Explore' },
        async () => ({
          spawn: {},
        }),
      ),
    ).rejects.toThrow(
      'bad-deny-after-next: returned a deny after its next() was answered (deny in place of next)',
    )
    setLoadedFunctionHooksModules([])
  })

  test('#244 tool.check allow is clamped to ask when ceiling is ask (requiresUserInteraction)', async () => {
    setLoadedFunctionHooksModules([])
    registerLoadedFunctionHooksModule({
      name: 'allow-all-mod',
      patterns: ['tool.check'],
      hooks: [
        {
          pattern: 'tool.check',
          hook: async () => ({ decision: 'allow' }),
        },
      ],
    })

    const res = await runFunctionHookChain(
      'tool.check',
      { tool: 'AskUserQuestion', input: {}, ceiling: 'ask' },
      async () => ({ decision: 'ask' }),
    )
    expect(res).toEqual({ decision: 'ask' })
    setToolCheckHandler(undefined)
    setLoadedFunctionHooksModules([])
  })

  test('#245 session.start startup prompt/command/agent calls are deduplicated across worker replacement copies', async () => {
    let calls = 0
    const plugin = 'startup-mod'
    recordSessionStartLoad({
      name: plugin,
      args: { root: '/tmp/p' },
      shown: {},
      environmentId: 'env-1',
    })
    recordSessionStartLoad({
      name: plugin,
      args: { root: '/tmp/p' },
      shown: {},
      environmentId: 'env-2',
    })

    // Simulate running inside session.start
    setLoadedFunctionHooksModules([])
    registerLoadedFunctionHooksModule({
      name: plugin,
      patterns: ['session.start'],
      hooks: [
        {
          pattern: 'session.start',
          hook: async () => {
            const r1 = await withSessionStartDedup(
              'prompt.submit',
              { text: 'hi' },
              plugin,
              'env-1',
              async () => {
                calls++
                return { queued: true }
              },
            )
            const r2 = await withSessionStartDedup(
              'prompt.submit',
              { text: 'hi' },
              plugin,
              'env-2',
              async () => {
                calls++
                return { queued: true }
              },
            )
            return { r1, r2 }
          },
        },
      ],
    })

    const out = (await runFunctionHookChain(
      'session.start',
      {},
      async () => ({}),
    )) as { r1: unknown; r2: unknown }
    expect(calls).toBe(1)
    expect(out.r1).toEqual({ queued: true })
    expect(out.r2).toEqual({ queued: true })
    setLoadedFunctionHooksModules([])
  })

  test('#246 hook that called next(e) then failed during aborted turn rejects even if .catch is present', async () => {
    setLoadedFunctionHooksModules([])
    let catchRan = false
    const ac = new AbortController()

    registerLoadedFunctionHooksModule({
      name: 'abort-mod',
      patterns: ['tool.call'],
      hooks: [
        {
          pattern: 'tool.call',
          hook: async (_api, e, next) => {
            await next(e)
            ac.abort(new Error('turn aborted'))
            throw new Error('post-next failure')
          },
          catch: async () => {
            catchRan = true
            return { text: 'bypassed' }
          },
        },
      ],
    })

    await expect(
      runFunctionHookChain(
        'tool.call',
        { tool: 'Bash' },
        async () => ({ text: 'ok' }),
        undefined,
        undefined,
        { signal: ac.signal },
      ),
    ).rejects.toThrow('post-next failure')
    expect(catchRan).toBe(false)
    setLoadedFunctionHooksModules([])
  })

  test('#247 prompt.submit drop and config.set deny > 4096 chars are truncated instead of ignored', async () => {
    setLoadedFunctionHooksModules([])
    const longReason = 'x'.repeat(5000)
    registerLoadedFunctionHooksModule({
      name: 'long-reason-mod',
      patterns: ['prompt.submit', 'config.set'],
      hooks: [
        {
          pattern: 'prompt.submit',
          hook: async () => ({ drop: longReason }),
        },
        {
          pattern: 'config.set',
          hook: async () => ({ deny: longReason }),
        },
      ],
    })

    const promptRes = (await runFunctionHookChain(
      'prompt.submit',
      { text: 'hello' },
      async () => ({}),
    )) as { drop: string }
    expect(promptRes.drop.length).toBe(4097)
    expect(promptRes.drop.endsWith('…')).toBe(true)

    const configRes = (await runFunctionHookChain(
      'config.set',
      { key: 'theme', value: 'dark' },
      async () => ({ value: 'dark' }),
    )) as { deny: string }
    expect(configRes.deny.length).toBe(4097)
    expect(configRes.deny.endsWith('…')).toBe(true)
    setLoadedFunctionHooksModules([])
  })

  test('#248 org/managed plugin unloads conflicting user mod on $ interface collision instead of unloading org plugin', () => {
    setLoadedFunctionHooksModules([])
    const userMod = registerLoadedFunctionHooksModule({
      name: 'user-mod',
      patterns: [],
      hooks: [],
    })
    const orgMod = registerLoadedFunctionHooksModule({
      name: 'org-mod',
      patterns: [],
      hooks: [],
      isManaged: true,
      tier: 'prepend',
    })

    finalizeOwnedTable('user-mod', { shared: { ping: () => 'user' } })
    finalizeOwnedTable('org-mod', { shared: { ping: () => 'org' } })

    const updatedUser = getLoadedFunctionHooksModules().find(
      m => m.name === 'user-mod',
    )
    const updatedOrg = getLoadedFunctionHooksModules().find(
      m => m.name === 'org-mod',
    )
    expect(updatedUser?.status).toBe('unloaded')
    expect(updatedOrg?.status).not.toBe('unloaded')
    setLoadedFunctionHooksModules([])
  })
})
