import { beforeEach, describe, expect, mock, test } from 'bun:test'

const state = {
  mainLoopModel: null as string | null,
  mainLoopModelForSession: null as string | null,
  effortValue: undefined as string | undefined,
  applyCalls: [] as Array<{ raw: string; persist: boolean }>,
  applyResult: 'Set model to sonnet for this session only',
}

mock.module('../applyModel.js', () => ({
  applyModelSet: async (
    raw: string,
    _ctx: unknown,
    opts: { persistDefault: boolean },
  ) => {
    state.applyCalls.push({ raw, persist: opts.persistDefault })
    return state.applyResult
  },
  formatCurrentModel: (m: string | null, s: string | null, e: unknown) =>
    `Current model: ${m ?? 'default'}${s ? ` session=${s}` : ''}${e ? ` effort=${e}` : ''}`,
  modelUsageText: () =>
    'Usage: /model <name>. Available: sonnet, opus, haiku, default, or a full model ID.',
}))

const { call } = await import('../model-noninteractive.js')

beforeEach(() => {
  state.mainLoopModel = null
  state.mainLoopModelForSession = null
  state.effortValue = undefined
  state.applyCalls = []
  state.applyResult = 'Set model to sonnet for this session only'
})

function ctx() {
  return {
    getAppState: () => ({
      mainLoopModel: state.mainLoopModel,
      mainLoopModelForSession: state.mainLoopModelForSession,
      effortValue: state.effortValue,
    }),
    setAppState: () => {},
  } as never
}

describe('model noninteractive (densable zOy)', () => {
  test('empty shows current + usage', async () => {
    state.mainLoopModel = 'sonnet'
    state.effortValue = 'high'
    const r = await call('', ctx())
    expect(r.type).toBe('text')
    if (r.type === 'text') {
      expect(r.value).toContain('Current model: sonnet')
      expect(r.value).toContain('Usage: /model')
      expect(r.value).toContain('effort=high')
    }
  })

  test('help shows usage only', async () => {
    const r = await call('help', ctx())
    expect(r).toEqual({
      type: 'text',
      value:
        'Usage: /model <name>. Available: sonnet, opus, haiku, default, or a full model ID.',
    })
  })

  test('set uses session-only persistDefault false', async () => {
    const r = await call('sonnet', ctx())
    expect(state.applyCalls).toEqual([{ raw: 'sonnet', persist: false }])
    expect(r).toEqual({
      type: 'text',
      value: 'Set model to sonnet for this session only',
    })
  })
})
