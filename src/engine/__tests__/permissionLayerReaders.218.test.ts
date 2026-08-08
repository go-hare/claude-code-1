/**
 * densable 2.1.218 #11 — bn/qO/_Kr/YDu/bb/yor permissionLayers consumers.
 */
import { describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/permissions/permissionSetup.js', () => ({
  isBypassPermissionsModeDisabled: () => false,
}))

const {
  applyContextLayers,
  getEffortValueFromLayers,
  getMainLoopModelFromLayers,
  getThinkingConfigFromLayers,
  getToolPermissionContextFromLayers,
  mergeAllowedToolsLayer,
  thinkingConfigFromMaxTokens,
  uniqueStrings,
} = await import('../permissionLayerReaders.js')

function emptyCtx(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'default' as const,
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: true,
    ...overrides,
  }
}

function makeTuc(opts: {
  layers?: Array<Record<string, unknown>>
  mode?: string
  model?: string
  thinking?: { type: string; budgetTokens?: number }
  effort?: unknown
  ultracode?: boolean
}) {
  const toolPermissionContext = emptyCtx({ mode: opts.mode ?? 'default' })
  return {
    options: {
      mainLoopModel: opts.model ?? 'base-model',
      thinkingConfig: opts.thinking ?? { type: 'adaptive' },
    },
    permissionLayers: opts.layers,
    getAppState: () => ({
      toolPermissionContext,
      effortValue: opts.effort,
      ultracode: opts.ultracode === true,
    }),
  } as never
}

describe('uniqueStrings / mergeAllowedToolsLayer densable Mo/Uls', () => {
  test('unique preserve order', () => {
    expect(uniqueStrings(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c'])
  })

  test('mergeAllowedToolsLayer appends command rules', () => {
    const base = emptyCtx({
      alwaysAllowRules: { command: ['Bash(ls:*)'] },
    }) as never
    const next = mergeAllowedToolsLayer(base, ['Bash(git:*)', 'Bash(ls:*)'])
    expect(next.alwaysAllowRules.command).toEqual(['Bash(ls:*)', 'Bash(git:*)'])
  })
})

describe('getToolPermissionContextFromLayers densable bn', () => {
  test('no layers → base context', () => {
    const tuc = makeTuc({ mode: 'acceptEdits' })
    expect(getToolPermissionContextFromLayers(tuc).mode).toBe('acceptEdits')
  })

  test('permission_mode last-wins', () => {
    const tuc = makeTuc({
      mode: 'default',
      layers: [
        { kind: 'permission_mode', mode: 'plan' },
        { kind: 'permission_mode', mode: 'acceptEdits' },
      ],
    })
    expect(getToolPermissionContextFromLayers(tuc).mode).toBe('acceptEdits')
  })

  test('bypassPermissions skipped when not available', () => {
    // force available=false via custom app state
    const tuc2 = {
      options: {
        mainLoopModel: 'base-model',
        thinkingConfig: { type: 'adaptive' },
      },
      getAppState: () => ({
        toolPermissionContext: emptyCtx({
          isBypassPermissionsModeAvailable: false,
        }),
        effortValue: undefined,
        ultracode: false,
      }),
      permissionLayers: [
        { kind: 'permission_mode', mode: 'bypassPermissions' },
      ],
    } as never
    expect(getToolPermissionContextFromLayers(tuc2).mode).toBe('default')
  })

  test('allowed_tools + working_directory last only', () => {
    const tuc = makeTuc({
      layers: [
        { kind: 'allowed_tools', allowedTools: ['Bash(echo:*)'] },
        { kind: 'working_directory', directory: '/old' },
        { kind: 'working_directory', directory: '/new' },
      ],
    })
    const ctx = getToolPermissionContextFromLayers(tuc)
    expect(ctx.alwaysAllowRules.command).toEqual(['Bash(echo:*)'])
    expect(ctx.additionalWorkingDirectories.has('/new')).toBe(true)
    expect(ctx.additionalWorkingDirectories.has('/old')).toBe(false)
  })

  test('avoid_prompts latches shouldAvoidPermissionPrompts', () => {
    const tuc = makeTuc({
      layers: [{ kind: 'avoid_prompts' }],
    })
    expect(
      getToolPermissionContextFromLayers(tuc).shouldAvoidPermissionPrompts,
    ).toBe(true)
  })
})

describe('getMainLoopModelFromLayers densable qO', () => {
  test('last model layer wins', () => {
    const tuc = makeTuc({
      model: 'base',
      layers: [
        { kind: 'model', mainLoopModel: 'opus' },
        { kind: 'model', mainLoopModel: 'sonnet' },
      ],
    })
    expect(getMainLoopModelFromLayers(tuc)).toBe('sonnet')
  })
})

describe('getThinkingConfigFromLayers densable _Kr/YDu', () => {
  test('0 → disabled; positive → enabled budget', () => {
    expect(thinkingConfigFromMaxTokens(0)).toEqual({ type: 'disabled' })
    expect(thinkingConfigFromMaxTokens(8000)).toEqual({
      type: 'enabled',
      budgetTokens: 8000,
    })
  })

  test('last max_thinking_tokens layer wins', () => {
    const tuc = makeTuc({
      thinking: { type: 'adaptive' },
      layers: [
        { kind: 'max_thinking_tokens', maxThinkingTokens: 1000 },
        { kind: 'max_thinking_tokens', maxThinkingTokens: 0 },
      ],
    })
    expect(getThinkingConfigFromLayers(tuc)).toEqual({ type: 'disabled' })
  })
})

describe('getEffortValueFromLayers densable bb', () => {
  test('last effort layer wins', () => {
    const tuc = makeTuc({
      effort: 1,
      layers: [
        { kind: 'effort', effort: 5 },
        { kind: 'effort', effort: 10 },
      ],
    })
    expect(getEffortValueFromLayers(tuc)).toBe(10)
  })
})

describe('applyContextLayers densable yor', () => {
  test('appends layers and projects model + thinking into options', () => {
    const base = makeTuc({ model: 'base', thinking: { type: 'adaptive' } })
    const next = applyContextLayers(base as never, [
      { kind: 'model', mainLoopModel: 'sticky' },
      { kind: 'max_thinking_tokens', maxThinkingTokens: 2048 },
      { kind: 'permission_mode', mode: 'plan' },
    ])
    expect(next.options.mainLoopModel).toBe('sticky')
    expect(next.options.thinkingConfig).toEqual({
      type: 'enabled',
      budgetTokens: 2048,
    })
    expect(next.permissionLayers?.map(l => l.kind)).toEqual([
      'model',
      'max_thinking_tokens',
      'permission_mode',
    ])
  })
})
