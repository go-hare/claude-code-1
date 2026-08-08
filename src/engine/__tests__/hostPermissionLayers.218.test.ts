/**
 * densable 2.1.218 #11 S8o sticky → permissionLayers (build/merge/seed/apply).
 */
import { describe, expect, test } from 'bun:test'
import {
  applyHostStickyToPrepared,
  applySeedReadStateMap,
  buildHostPermissionLayers,
  hasStickyPermissionLayers,
  mergePermissionLayers,
  type HostStickyControlState,
} from '../hostPermissionLayers.js'
import { createHostEngine } from '../hostEngine.js'

const emptySticky = (): HostStickyControlState => ({
  model: null,
  permissionMode: null,
  maxThinkingTokens: undefined,
  flagSettings: null,
})

describe('buildHostPermissionLayers densable sticky U/W/$/G', () => {
  test('empty sticky → no layers', () => {
    expect(buildHostPermissionLayers({ sticky: emptySticky() })).toEqual([])
    expect(hasStickyPermissionLayers(emptySticky())).toBe(false)
  })

  test('model + permission_mode + max_thinking + flag_settings', () => {
    const layers = buildHostPermissionLayers({
      sticky: {
        model: 'claude-opus-4-7',
        permissionMode: 'acceptEdits',
        maxThinkingTokens: 0,
        flagSettings: { foo: true },
      },
    })
    expect(layers).toEqual([
      { kind: 'model', mainLoopModel: 'claude-opus-4-7' },
      { kind: 'permission_mode', mode: 'acceptEdits' },
      { kind: 'max_thinking_tokens', maxThinkingTokens: 0 },
      { kind: 'flag_settings', settings: { foo: true } },
    ])
  })

  test('hostOwnsPermissionMode omits permission_mode layer (densable D)', () => {
    const layers = buildHostPermissionLayers({
      sticky: {
        model: 'm',
        permissionMode: 'bypassPermissions',
        maxThinkingTokens: undefined,
        flagSettings: null,
      },
      hostOwnsPermissionMode: true,
    })
    expect(layers).toEqual([{ kind: 'model', mainLoopModel: 'm' }])
  })

  test('null/undefined maxThinkingTokens → no layer', () => {
    expect(
      buildHostPermissionLayers({
        sticky: {
          model: null,
          permissionMode: null,
          maxThinkingTokens: null,
          flagSettings: null,
        },
      }),
    ).toEqual([])
    expect(
      buildHostPermissionLayers({
        sticky: {
          model: null,
          permissionMode: null,
          maxThinkingTokens: undefined,
          flagSettings: null,
        },
      }),
    ).toEqual([])
  })
})

describe('mergePermissionLayers', () => {
  test('appends sticky after existing', () => {
    const merged = mergePermissionLayers(
      [{ kind: 'effort', effort: 1 }],
      [{ kind: 'model', mainLoopModel: 'x' }],
    )
    expect(merged).toEqual([
      { kind: 'effort', effort: 1 },
      { kind: 'model', mainLoopModel: 'x' },
    ])
  })

  test('no sticky keeps existing', () => {
    expect(mergePermissionLayers([{ kind: 'effort', effort: 2 }], [])).toEqual([
      { kind: 'effort', effort: 2 },
    ])
    expect(mergePermissionLayers(undefined, [])).toBeUndefined()
  })
})

describe('applySeedReadStateMap densable se', () => {
  test('sets missing and newer timestamp', () => {
    const map = new Map<string, { content?: string; timestamp?: number }>()
    map.set('/a', { content: 'old', timestamp: 1 })
    applySeedReadStateMap(
      map,
      new Map([
        ['/a', { content: 'new', timestamp: 2 }],
        ['/b', { content: 'b', timestamp: 1 }],
        ['/a-stale', { content: 'x', timestamp: 0 }],
      ]),
    )
    // /a-stale not pre-existing → set
    applySeedReadStateMap(
      map,
      new Map([['/c', { content: 'c', timestamp: 5 }]]),
    )
    expect(map.get('/a')?.content).toBe('new')
    expect(map.get('/b')?.content).toBe('b')
    expect(map.get('/c')?.content).toBe('c')

    // older seed does not overwrite
    applySeedReadStateMap(
      map,
      new Map([['/a', { content: 'older', timestamp: 0 }]]),
    )
    expect(map.get('/a')?.content).toBe('new')
  })
})

describe('applyHostStickyToPrepared', () => {
  test('injects permissionLayers + options.mainLoopModel/thinking + seeds', () => {
    const readFileState = new Map<
      string,
      { content?: string; timestamp?: number }
    >()
    const prepared = {
      toolUseContext: {
        options: {
          mainLoopModel: 'base',
          thinkingConfig: { type: 'adaptive' },
        },
        readFileState,
        permissionLayers: [{ kind: 'effort', effort: 3 }],
      },
    }
    const out = applyHostStickyToPrepared(
      prepared,
      {
        model: 'sticky-model',
        permissionMode: 'plan',
        maxThinkingTokens: 8000,
        flagSettings: { k: 1 },
      },
      new Map([['/seed', { content: 's', timestamp: 9 }]]),
    )
    const tuc = out.toolUseContext as {
      permissionLayers: Array<{ kind: string }>
      options: {
        mainLoopModel: string
        thinkingConfig: { type: string; budgetTokens?: number }
      }
      readFileState: Map<string, { content?: string }>
    }
    expect(tuc.permissionLayers.map(l => l.kind)).toEqual([
      'effort',
      'model',
      'permission_mode',
      'max_thinking_tokens',
      'flag_settings',
    ])
    expect(tuc.options.mainLoopModel).toBe('sticky-model')
    // densable yor/YDu projection of sticky max_thinking_tokens
    expect(tuc.options.thinkingConfig).toEqual({
      type: 'enabled',
      budgetTokens: 8000,
    })
    expect(tuc.readFileState.get('/seed')?.content).toBe('s')
  })

  test('sticky maxThinkingTokens 0 projects thinkingConfig disabled', () => {
    const out = applyHostStickyToPrepared(
      {
        toolUseContext: {
          options: { thinkingConfig: { type: 'adaptive' } },
          readFileState: new Map(),
        },
      },
      {
        model: null,
        permissionMode: null,
        maxThinkingTokens: 0,
        flagSettings: null,
      },
      new Map(),
    )
    const tuc = out.toolUseContext as {
      options: { thinkingConfig: { type: string } }
    }
    expect(tuc.options.thinkingConfig).toEqual({ type: 'disabled' })
  })
})

describe('createHostEngine Me applies sticky layers', () => {
  test('setModel + setPermissionMode land on runTurn prepared', async () => {
    const seen: Array<unknown> = []
    const engine = createHostEngine({
      prepareTurn: async intent => ({
        toolUseContext: {
          options: {},
          readFileState: new Map(),
          abortController: new AbortController(),
        },
        intent,
      }),
      runTurn: async function* (prepared) {
        seen.push(prepared)
        yield { type: 'result', subtype: 'success', is_error: false }
        return { reason: 'completed' }
      },
    })

    await engine.setModel('claude-sonnet-4-6')
    await engine.setPermissionMode('acceptEdits')
    await engine.setMaxThinkingTokens(1024)
    await engine.applyFlagSettings({ a: 1 })

    const stream = (async function* () {
      yield {
        type: 'turn',
        uuid: 't1',
        message: { role: 'user', content: 'hi' },
      }
    })()
    // drain engine while feeding streamInput
    const drain = (async () => {
      for await (const _ of engine) {
        /* consume */
      }
    })()
    await engine.streamInput(stream)
    await drain

    expect(seen).toHaveLength(1)
    const tuc = (
      seen[0] as {
        toolUseContext: {
          permissionLayers: Array<{
            kind: string
            mainLoopModel?: string
            mode?: string
          }>
        }
      }
    ).toolUseContext
    expect(
      tuc.permissionLayers.some(
        l => l.kind === 'model' && l.mainLoopModel === 'claude-sonnet-4-6',
      ),
    ).toBe(true)
    expect(
      tuc.permissionLayers.some(
        l => l.kind === 'permission_mode' && l.mode === 'acceptEdits',
      ),
    ).toBe(true)
    expect(
      tuc.permissionLayers.some(l => l.kind === 'max_thinking_tokens'),
    ).toBe(true)
    expect(tuc.permissionLayers.some(l => l.kind === 'flag_settings')).toBe(
      true,
    )
  })
})
