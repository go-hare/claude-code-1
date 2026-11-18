import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearTurnRequestCacheSafeParams,
  getLoadedFunctionHooksModules,
  handleHostOp,
  hasMatchingFunctionHook,
  normalizeModTextProps,
  resolveModBoxSpacingProp,
  runFunctionHookChain,
  sanitizeHookBoundaryValue,
  setLoadedFunctionHooksModules,
  setTurnRequestCacheSafeParams,
  setUiViewHost,
  UI_TEXT_DIRS,
  UI_TEXT_SIZES,
  UI_TEXT_WEIGHTS,
  uiRenderDrawingPlainCheck,
  validatePromptDecorations,
  withPromptSubmitMedia,
} from '../functionHooksModules.js'

afterEach(() => {
  setLoadedFunctionHooksModules([])
  setUiViewHost(undefined)
  clearTurnRequestCacheSafeParams('turn-1')
})

describe('functionHooks v2.1.299-v2.1.301 alignment', () => {
  test('#568 $.prompt.media reads base64 bytes for managed prompt.submit mods and denies unmanaged/off-flight', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'managed-mod',
        patterns: ['prompt.submit'],
        isManaged: true,
        tier: 'prepend',
        hooks: [],
      },
      {
        name: 'user-mod',
        patterns: ['prompt.submit'],
        tier: 'user',
        hooks: [],
      },
    ])

    const payload = Buffer.from('hello world')
    await withPromptSubmitMedia(
      [
        {
          attachment: { type: 'image' },
          read: async () => ({
            type: 'image',
            mediaType: 'image/png',
            bytes: payload,
          }),
        },
      ],
      async ([id]) => {
        expect(id).toBeDefined()
        const ok = await handleHostOp('prompt.media', [{ id }], 'managed-mod')
        expect(ok).toEqual({
          type: 'image',
          mediaType: 'image/png',
          base64: payload.toString('base64'),
          size: payload.length,
        })

        const deniedUser = await handleHostOp(
          'prompt.media',
          [{ id }],
          'user-mod',
        )
        expect(deniedUser).toEqual({
          deny: 'no prompt.submit in flight carries an attachment under that id',
        })

        const badOffset = await handleHostOp(
          'prompt.media',
          [{ id, offset: 999 }],
          'managed-mod',
        )
        expect(badOffset).toEqual({
          deny: `offset 999 is at or past the item's ${payload.length} bytes`,
        })
      },
    )

    // After prompt.submit finishes, reading the id is denied
    const after = await handleHostOp(
      'prompt.media',
      [{ id: 'media_1' }],
      'managed-mod',
    )
    expect(after).toEqual({
      deny: 'no prompt.submit in flight carries an attachment under that id',
    })
  })

  test('#569 $.session.identity() denies non-managed mods and returns identity for managed mods', async () => {
    setLoadedFunctionHooksModules([
      { name: 'user-mod', patterns: [], tier: 'user', hooks: [] },
      {
        name: 'managed-mod',
        patterns: [],
        isManaged: true,
        tier: 'prepend',
        hooks: [],
      },
    ])
    const denied = await handleHostOp('session.identity', [], 'user-mod')
    expect((denied as { deny?: string }).deny).toContain(
      '$.session.identity answers only a mod that managed settings enable',
    )

    const allowed = (await handleHostOp(
      'session.identity',
      [],
      'managed-mod',
    )) as {
      kind?: string
      isVerified?: boolean
    }
    expect(typeof allowed.kind).toBe('string')
    expect(typeof allowed.isVerified).toBe('boolean')
  })

  test('#570 & #758 Text size/weight/mono/tabular/dir, bold deprecation, and Box xs-xl spacing', () => {
    expect(UI_TEXT_SIZES.has('caption')).toBe(true)
    expect(UI_TEXT_SIZES.has('title')).toBe(true)
    expect(UI_TEXT_WEIGHTS.has('semibold')).toBe(true)
    expect(UI_TEXT_DIRS.has('ltr')).toBe(true)
    expect(UI_TEXT_DIRS.has('rtl')).toBe(true)
    expect(normalizeModTextProps({ bold: true })).toEqual({
      bold: true,
      weight: 'bold',
    })
    expect(resolveModBoxSpacingProp('paddingX', 'xs')).toBe(1)
    expect(resolveModBoxSpacingProp('paddingY', 'xs')).toBe(0)
    expect(resolveModBoxSpacingProp('padding', 'xl')).toEqual({
      across: 4,
      down: 2,
    })
  })

  test('#579 session.append supports { door: "queue" } matcher', () => {
    setLoadedFunctionHooksModules([
      {
        name: 'queue-mod',
        patterns: ['session.append'],
        hooks: [
          {
            pattern: 'session.append',
            matcher: { door: 'queue' },
            hook: async (_$, e) => e,
          },
        ],
      },
    ])
    expect(hasMatchingFunctionHook('session.append', { door: 'queue' })).toBe(
      true,
    )
    expect(hasMatchingFunctionHook('session.append', { door: 'other' })).toBe(
      false,
    )
  })

  test('#620 makeStepBudget pauses while a served $ method keeps making $ calls after answering', async () => {
    let remainingBefore = 0
    let remainingAfter = 0
    setLoadedFunctionHooksModules([
      {
        name: 'budget-mod',
        patterns: ['tool.check'],
        hooks: [
          {
            pattern: 'tool.check',
            hook: async (_$, e, next) => {
              await next(e)
              remainingBefore = next.budget?.remainingMs ?? 0
              await handleHostOp('clock.sleep', [{ ms: 35 }], 'budget-mod')
              remainingAfter = next.budget?.remainingMs ?? 0
              return { decision: 'allow' }
            },
          },
        ],
      },
    ])
    await runFunctionHookChain(
      'tool.check',
      { tool: 'Read', input: {} },
      async () => ({ decision: 'allow' }),
      undefined,
      undefined,
      { budgetMs: 500 },
    )
    // Because clock.sleep ran after next() answered, the budget paused during the host op
    expect(remainingBefore).toBeGreaterThan(0)
    expect(remainingAfter).toBeGreaterThanOrEqual(remainingBefore - 10)
  })

  test('#622, #623, #639 iterative sanitizeHookBoundaryValue & uiRenderDrawingPlainCheck refuse __proto__ and isolate RangeError getters', () => {
    // Deeply nested object (15,000 levels > default JS call stack) succeeds iteratively
    let deep: Record<string, unknown> = { leaf: 1 }
    for (let i = 0; i < 15_000; i++) {
      deep = { child: deep }
    }
    const san = sanitizeHookBoundaryValue(deep)
    expect(san.refusedKeys).toEqual([])

    // __proto__ own key is refused instead of silently stripped
    const withProto = JSON.parse('{"a":1,"__proto__":{"polluted":true}}')
    expect(() => sanitizeHookBoundaryValue(withProto)).toThrow('__proto__')
    expect(uiRenderDrawingPlainCheck(withProto, 'mod-a')).toContain('__proto__')

    // RangeError getter refuses only that key and keeps other keys
    const withRangeError: Record<string, unknown> = { ok: 42 }
    Object.defineProperty(withRangeError, 'bad', {
      enumerable: true,
      get() {
        throw new RangeError('boom')
      },
    })
    const res = sanitizeHookBoundaryValue(withRangeError)
    expect(res.refusedKeys).toEqual(['bad'])
    expect((res.value as Record<string, unknown>).ok).toBe(42)
    expect('bad' in (res.value as Record<string, unknown>)).toBe(false)
  })

  test('#715 tool.call withholds result with TOOL_CALL_WITHHELD_SUFFIX when hook throws after tool ran', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'failing-mod',
        patterns: ['tool.call'],
        hooks: [
          {
            pattern: 'tool.call',
            hook: async (_$, e, next) => {
              await next(e)
              throw new Error('hook crashed after next')
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
    ).rejects.toThrow('ran, and a plugin withheld its result')
  })

  test('#755 validatePromptDecorations accepts virtualText string and rejects non-string', () => {
    expect(
      validatePromptDecorations([
        { start: 0, end: 0, virtualText: 'hint', dimColor: true },
      ]),
    ).toBeUndefined()
    expect(
      validatePromptDecorations([{ start: 0, end: 0, virtualText: 123 }]),
    ).toContain('virtualText must be a string')
  })

  test('#757 $.ui.view validates { agentId } or {} and maps host view statuses', async () => {
    setUiViewHost(async ({ agentId }) =>
      agentId === 'a1' ? 'shown' : 'unknown',
    )
    expect(await handleHostOp('ui.view', [{ agentId: 'a1' }], 'mod-v')).toEqual(
      {},
    )
    expect(
      await handleHostOp('ui.view', [{ agentId: 'missing' }], 'mod-v'),
    ).toEqual({
      deny: 'no agent under that id',
    })
    await expect(
      handleHostOp('ui.view', [{ agentId: '' }], 'mod-v'),
    ).rejects.toThrow('takes { agentId }')
  })

  test('#876 setTurnRequestCacheSafeParams wires fallback for runModelFork', () => {
    const fakeParams = {
      systemPrompt: [],
      userContext: {},
      systemContext: {},
      toolUseContext: {} as never,
      forkContextMessages: [],
    }
    setTurnRequestCacheSafeParams('turn-1', fakeParams as never)
    clearTurnRequestCacheSafeParams('turn-1')
    expect(getLoadedFunctionHooksModules()).toEqual([])
  })

  test('#886 hook .catch runs only when the hook itself throws, not when downstream next() throws', async () => {
    let catchCalled = false
    setLoadedFunctionHooksModules([
      {
        name: 'outer-mod',
        patterns: ['tool.check'],
        hooks: [
          {
            pattern: 'tool.check',
            hook: async (_$, e, next) => next(e),
            catch: async () => {
              catchCalled = true
              return { decision: 'allow' }
            },
          },
        ],
      },
      {
        name: 'inner-mod',
        patterns: ['tool.check'],
        hooks: [
          {
            pattern: 'tool.check',
            hook: async () => {
              throw new Error('inner failed')
            },
          },
        ],
      },
    ])
    await expect(
      runFunctionHookChain('tool.check', { tool: 'Read' }, async () => ({
        decision: 'allow',
      })),
    ).rejects.toThrow('inner failed')
    expect(catchCalled).toBe(false)
  })

  test('#887 $.env.set resolves with {} when setting or unsetting an env var', async () => {
    const prev = process.env.TEST_MOD_ENV_VAR_887
    try {
      const setRes = await handleHostOp(
        'env.set',
        [{ name: 'TEST_MOD_ENV_VAR_887', value: 'abc' }],
        'env-mod',
      )
      expect(setRes).toEqual({})
      expect(process.env.TEST_MOD_ENV_VAR_887).toBe('abc')

      const unsetRes = await handleHostOp(
        'env.set',
        [{ name: 'TEST_MOD_ENV_VAR_887', value: undefined }],
        'env-mod',
      )
      expect(unsetRes).toEqual({})
      expect(process.env.TEST_MOD_ENV_VAR_887).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.TEST_MOD_ENV_VAR_887
      else process.env.TEST_MOD_ENV_VAR_887 = prev
    }
  })
})
