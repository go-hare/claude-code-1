import { afterEach, describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppStateStore.js'
import { resetCliOwnedConfigsForTests } from '../../services/mcp/cliOwnedConfigs.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import { createServerConfigSession } from '../serverConfigSession.js'
import {
  extractServerConfigEffort,
  extractServerConfigModel,
} from '../deriveServerSessionConfig.js'

afterEach(() => {
  resetCliOwnedConfigsForTests()
})

function makeStores() {
  let state = {
    mcp: {
      clients: [] as MCPServerConnection[],
      tools: [],
      commands: [],
      resources: {},
      resourceTemplates: {},
    },
    toolPermissionContext: {
      alwaysAllowRules: { session: [] as string[] },
      alwaysDenyRules: {},
      alwaysAskRules: {},
      mode: 'default',
    },
    effortValue: undefined as unknown,
  } as unknown as AppState
  return {
    getAppState: () => state,
    setAppState: (f: (prev: AppState) => AppState) => {
      state = f(state)
    },
    getDynamicMcpState: () => ({ clients: [], configs: {} }),
    getState: () => state,
  }
}

describe('densable 2.1.289 sdk-host model/effort extractors', () => {
  test('j_o / W_o extract non-empty strings', () => {
    expect(extractServerConfigModel({ model: 'm', effort: 'high' })).toBe('m')
    expect(extractServerConfigEffort({ model: 'm', effort: 'high' })).toBe(
      'high',
    )
    expect(extractServerConfigModel({ model: '' })).toBeUndefined()
    expect(extractServerConfigEffort({})).toBeUndefined()
  })

  test('RSo ultracode alias maps to catalog wire (not blank effortValue)', async () => {
    const {
      isUltracodeEffortAlias,
      parseEffortValue,
      getUltracodeEffortForModel,
    } = await import('../../utils/effort.js')
    expect(isUltracodeEffortAlias('ultracode')).toBe(true)
    expect(parseEffortValue('ultracode')).toBeUndefined()
    // densable RSo still writes sessionEffort; local catalog-top wire.
    const wire = getUltracodeEffortForModel('claude-opus-4-7')
    expect(wire === 'xhigh' || wire === 'high' || wire === 'max').toBe(true)
  })
})

describe('densable 2.1.289 serverConfigSession model/effort lanes', () => {
  test('apply calls applyModelPick then applyEffortSeed', async () => {
    const stores = makeStores()
    const picks: string[] = []
    const efforts: string[] = []
    const session = createServerConfigSession({
      stores,
      getAppendSystemPrompt: () => undefined,
      setAppendSystemPrompt: () => {},
      sdkHostConfigs: () => ({}),
      applyModelPick: model => {
        picks.push(model)
        return { ok: true }
      },
      applyEffortSeed: effort => {
        efforts.push(effort)
        return { ok: true }
      },
      getSessionEffort: () => stores.getState().effortValue,
      reconnect: async () => ({
        client: {
          name: 'x',
          type: 'failed',
          config: {} as never,
          error: 'x',
        },
        tools: [],
        commands: [],
      }),
    })
    session.apply(
      {
        claude_code_args: { model: 'claude-sonnet', effort: 'high' },
      },
      { bridgeSessionId: 'cse_me' },
    )
    const joins = session.takeFirstTurnJoins()
    await joins.grants
    expect(picks).toEqual(['claude-sonnet'])
    expect(efforts).toEqual(['high'])
    await session.undo()
  })

  test('model pick refuse still seeds effort when sessionEffort unchanged', async () => {
    const stores = makeStores()
    const efforts: string[] = []
    const session = createServerConfigSession({
      stores,
      getAppendSystemPrompt: () => undefined,
      setAppendSystemPrompt: () => {},
      sdkHostConfigs: () => ({}),
      applyModelPick: async () => ({ ok: false as const, error: 'nope' }),
      applyEffortSeed: effort => {
        efforts.push(effort)
        return { ok: true }
      },
      getSessionEffort: () => stores.getState().effortValue,
      reconnect: async () => ({
        client: {
          name: 'x',
          type: 'failed',
          config: {} as never,
          error: 'x',
        },
        tools: [],
        commands: [],
      }),
    })
    session.apply(
      { claude_code_args: { model: 'bad', effort: 'high' } },
      { bridgeSessionId: 'cse_refuse' },
    )
    await session.takeFirstTurnJoins().grants
    // Gold still runs se after oe settles when sessionEffort unchanged —
    // refuse does not change effort, so seed still attempted.
    expect(efforts).toEqual(['high'])
    await session.undo()
  })

  test('takeFirstTurnJoins is one-shot (second call nulls)', async () => {
    const stores = makeStores()
    const session = createServerConfigSession({
      stores,
      getAppendSystemPrompt: () => undefined,
      setAppendSystemPrompt: () => {},
      sdkHostConfigs: () => ({}),
      applyModelPick: () => ({ ok: true }),
      applyEffortSeed: () => ({ ok: true }),
      getSessionEffort: () => stores.getState().effortValue,
      reconnect: async () => ({
        client: {
          name: 'x',
          type: 'failed',
          config: {} as never,
          error: 'x',
        },
        tools: [],
        commands: [],
      }),
    })
    session.apply(
      { claude_code_args: { model: 'm', effort: 'high' } },
      { bridgeSessionId: 'cse_joins' },
    )
    const first = session.takeFirstTurnJoins()
    const second = session.takeFirstTurnJoins()
    expect(second.replyMount).toBeNull()
    expect(second.grants).toBeNull()
    await first.grants
    await session.undo()
  })

  test('sessionEffort mutation during model pick suppresses effort seed', async () => {
    const stores = makeStores()
    const efforts: string[] = []
    let resolveModel!: () => void
    const modelGate = new Promise<void>(resolve => {
      resolveModel = resolve
    })
    const session = createServerConfigSession({
      stores,
      getAppendSystemPrompt: () => undefined,
      setAppendSystemPrompt: () => {},
      sdkHostConfigs: () => ({}),
      applyModelPick: async () => {
        await modelGate
        return { ok: true }
      },
      applyEffortSeed: effort => {
        efforts.push(effort)
        return { ok: true }
      },
      getSessionEffort: () =>
        (stores.getState() as { effortValue?: unknown }).effortValue,
      reconnect: async () => ({
        client: {
          name: 'x',
          type: 'failed',
          config: {} as never,
          error: 'x',
        },
        tools: [],
        commands: [],
      }),
    })
    session.apply(
      { claude_code_args: { model: 'm', effort: 'xhigh' } },
      { bridgeSessionId: 'cse_race' },
    )
    stores.setAppState(prev => ({ ...prev, effortValue: 50 }))
    resolveModel()
    await session.takeFirstTurnJoins().grants
    expect(efforts).toEqual([])
    await session.undo()
  })
})
