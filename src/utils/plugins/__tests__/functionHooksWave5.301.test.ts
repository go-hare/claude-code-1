import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  AGENT_SPAWN_HOP_SITE,
  clearPersonalPluginEnvSetKeysForReset,
  dropPersonalPluginEnvSetIfMatches,
  getHookedMergeState,
  getPersonalPluginEnvSetKeys,
  handleHostOp,
  hasPersonalPluginEnvChangeForKeys,
  onSettingsChangedForMerge,
  raiseEngineSettingsMerge,
  resetHookedMergeState,
  runFunctionHookChain,
  setFunctionHooksHost,
  setLoadedFunctionHooksModules,
  withPersonalPluginEnvIsolated,
  type FunctionHookFailedReport,
} from '../functionHooksModules.js'

describe('#614, #683, #696 functionHooksModules alignments', () => {
  const envBackup: Record<string, string | undefined> = {}
  const TEST_ENV_KEY = 'TEST_CLAUDE_696_PLUGIN_VAR'

  beforeEach(() => {
    envBackup[TEST_ENV_KEY] = process.env[TEST_ENV_KEY]
    delete process.env[TEST_ENV_KEY]
    clearPersonalPluginEnvSetKeysForReset()
    resetHookedMergeState()
    setLoadedFunctionHooksModules([])
  })

  afterEach(() => {
    if (envBackup[TEST_ENV_KEY] === undefined) {
      delete process.env[TEST_ENV_KEY]
    } else {
      process.env[TEST_ENV_KEY] = envBackup[TEST_ENV_KEY]
    }
    clearPersonalPluginEnvSetKeysForReset()
    resetHookedMergeState()
    setLoadedFunctionHooksModules([])
    setFunctionHooksHost({ log() {}, hookFailed() {} })
  })

  test('#614 tracks askedOf/askedAbout and skips re-raise when unchanged', async () => {
    setLoadedFunctionHooksModules([
      {
        name: 'plugin-a',
        root: '/tmp/plugin-a',
        environmentId: 'env-1',
        patterns: ['settings.read'],
        hooks: [
          { pattern: 'settings.read', hook: async (_$, e, next) => next(e) },
        ],
      },
    ])
    getHookedMergeState().computed = { model: 'sonnet' }

    let calls = 0
    await raiseEngineSettingsMerge('initial', {
      engineMergeRead: async () => {
        calls += 1
        return []
      },
      settingsReadPlugins: () => ['plugin-a'],
    })
    expect(calls).toBe(1)
    expect(getHookedMergeState().askedOf).toBe(JSON.stringify(['env-1']))

    await raiseEngineSettingsMerge('second', {
      engineMergeRead: async () => {
        calls += 1
        return []
      },
      settingsReadPlugins: () => ['plugin-a'],
    })
    expect(calls).toBe(1)
  })

  test('#614 detects oscillating settings.read answers across plugin reloads and marks key unsettled', async () => {
    let pluginReloaded = false
    const setPluginEnv = (envId: string) => {
      setLoadedFunctionHooksModules([
        {
          name: 'osc-plugin',
          root: '/tmp/osc-plugin',
          environmentId: envId,
          patterns: ['settings.read'],
          hooks: [
            { pattern: 'settings.read', hook: async (_$, e, next) => next(e) },
          ],
        },
      ])
    }
    setPluginEnv('env-1')

    // Pass 1: hook answers model='haiku'; notifyChange reloads plugin to env-2
    await raiseEngineSettingsMerge('pass-1', {
      engineMergeRead: async () => [
        { key: 'model', value: 'haiku', source: 'userSettings' },
      ],
      settingsReadPlugins: () => ['osc-plugin'],
      notifyChange: () => {
        pluginReloaded = true
        setPluginEnv('env-2')
      },
    })
    expect(pluginReloaded).toBe(true)
    expect(getHookedMergeState().answers?.values.get('model')).toBe('haiku')
    expect(getHookedMergeState().visited.length).toBe(1)

    // Pass 2: hook answers model='opus'; notifyChange reloads back to env-1
    await raiseEngineSettingsMerge('pass-2', {
      engineMergeRead: async () => [
        { key: 'model', value: 'opus', source: 'userSettings' },
      ],
      settingsReadPlugins: () => ['osc-plugin'],
      notifyChange: () => {
        setPluginEnv('env-1')
      },
    })
    expect(getHookedMergeState().answers?.values.get('model')).toBe('opus')
    expect(getHookedMergeState().visited.length).toBe(2)

    // Pass 3: hook answers model='haiku' again -> matches visited fingerprint -> unsettled!
    await raiseEngineSettingsMerge('pass-3', {
      engineMergeRead: async () => [
        { key: 'model', value: 'haiku', source: 'userSettings' },
      ],
      settingsReadPlugins: () => ['osc-plugin'],
    })
    const state = getHookedMergeState()
    expect(state.unsettled.has('model')).toBe(true)
    expect(state.answers?.values.has('model')).toBe(false)
    expect(state.answers?.errors[0]?.message).toContain(
      'model never settles under a settings.read hook (one of: osc-plugin)',
    )

    // onSettingsChangedForMerge clears unsettled when not announcing
    await onSettingsChangedForMerge({
      engineMergeRead: async () => [],
      settingsReadPlugins: () => ['osc-plugin'],
    })
    expect(getHookedMergeState().unsettled.size).toBe(0)
  })

  test('#683 emits unappliedArgument hookFailed report when agent.spawn hook rewrites prompt/model on resume', async () => {
    const reports: FunctionHookFailedReport[] = []
    setFunctionHooksHost({
      log: () => {},
      hookFailed: report => reports.push(report),
    })

    setLoadedFunctionHooksModules([
      {
        name: 'spawn-rewriter',
        root: '/tmp/spawn-rewriter',
        environmentId: 'spawn-rewriter#1',
        patterns: ['agent.spawn'],
        hooks: [
          {
            pattern: 'agent.spawn',
            hook: async (_$, e, next) => {
              const ev = e as Record<string, unknown>
              return next({ ...ev, prompt: 'rewritten', model: 'haiku' })
            },
          },
        ],
      },
    ])

    let seenByBottom: Record<string, unknown> | undefined
    await runFunctionHookChain(
      'agent.spawn',
      {
        prompt: 'original prompt',
        model: 'sonnet',
        resume: 'agent-123',
      },
      async (ev: Record<string, unknown>) => {
        seenByBottom = ev
        return { agentId: 'agent-123', model: 'sonnet' }
      },
      undefined,
      undefined,
      { site: AGENT_SPAWN_HOP_SITE },
    )

    expect(seenByBottom?.prompt).toBe('original prompt')
    expect(seenByBottom?.model).toBe('sonnet')
    expect(reports.length).toBe(1)
    expect(reports[0]?.plugin).toBe('spawn-rewriter')
    expect(reports[0]?.event).toBe('agent.spawn')
    expect(reports[0]?.effect).toBe('the rest of its rewrite went on')
    expect(reports[0]?.skip).toEqual({
      kind: 'unapplied',
      why: "`prompt`, `model` were ignored: a hook can only refuse a resumed agent's run",
    })
  })

  test('#696 tracks personal plugin $.env.set writes and isolates them cleanly', async () => {
    process.env[TEST_ENV_KEY] = 'initial-value'
    setLoadedFunctionHooksModules([
      {
        name: 'personal-plugin',
        root: '/tmp/personal-plugin',
        pluginStorageId: 'personal-plugin@local',
        tier: 'user',
        patterns: [],
        hooks: [],
      },
      {
        name: 'managed-plugin',
        root: '/tmp/managed-plugin',
        isManaged: true,
        tier: 'prepend',
        patterns: [],
        hooks: [],
      },
    ])

    await handleHostOp(
      'env.set',
      [{ name: TEST_ENV_KEY, value: 'plugin-override' }],
      'personal-plugin',
    )

    expect(process.env[TEST_ENV_KEY]).toBe('plugin-override')
    expect(getPersonalPluginEnvSetKeys()).toEqual([TEST_ENV_KEY])
    expect(hasPersonalPluginEnvChangeForKeys([TEST_ENV_KEY])).toBe(true)

    let insideIsolated: string | undefined
    withPersonalPluginEnvIsolated(() => {
      insideIsolated = process.env[TEST_ENV_KEY]
    })
    expect(insideIsolated).toBe('initial-value')
    expect(process.env[TEST_ENV_KEY]).toBe('plugin-override')

    // allowWriter lets that specific writer pass through unisolated
    let insideAllowed: string | undefined
    withPersonalPluginEnvIsolated(
      () => {
        insideAllowed = process.env[TEST_ENV_KEY]
      },
      writer => writer === 'personal-plugin@local',
    )
    expect(insideAllowed).toBe('plugin-override')

    // Managed plugin overwrite clears personal tracking
    await handleHostOp(
      'env.set',
      [{ name: TEST_ENV_KEY, value: 'managed-value' }],
      'managed-plugin',
    )
    expect(process.env[TEST_ENV_KEY]).toBe('managed-value')
    expect(getPersonalPluginEnvSetKeys()).toEqual([])

    // Setting again from personal plugin, then dropping when settings env matches
    await handleHostOp(
      'env.set',
      [{ name: TEST_ENV_KEY, value: 'from-plugin-again' }],
      'personal-plugin',
    )
    expect(getPersonalPluginEnvSetKeys()).toEqual([TEST_ENV_KEY])
    dropPersonalPluginEnvSetIfMatches({ [TEST_ENV_KEY]: 'from-plugin-again' })
    expect(getPersonalPluginEnvSetKeys()).toEqual([])
  })
})
