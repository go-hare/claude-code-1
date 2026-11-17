import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import type { ToolPermissionContext } from '../../Tool.js'
import * as realBootstrap from '../../bootstrap/state.js'
import * as realChangeDetector from '../../utils/settings/changeDetector.js'
import * as realPermissionSetup from '../../utils/permissions/permissionSetup.js'
import * as realSettings from '../../utils/settings/settings.js'
import {
  analyticsMock,
  restoreAnalyticsMock,
} from '../../../tests/mocks/analytics.js'
import { growthbookMock } from '../../../tests/mocks/growthbook.js'
import {
  createSettingsMock,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

const growthbookRefreshListeners = new Set<() => void>()
const settingsListeners = new Set<(source?: string, extra?: unknown) => void>()

let flagInline: Record<string, unknown> | null = null

const bootstrapSnap = snapshotModuleExports(realBootstrap)
const changeSnap = snapshotModuleExports(realChangeDetector)
const settingsSnap = snapshotModuleExports(realSettings)
const permissionSetupSnap = snapshotModuleExports(realPermissionSetup)

function subscribeSettingsChange(
  listener: (source?: string, extra?: unknown) => void,
) {
  settingsListeners.add(listener)
  return () => {
    settingsListeners.delete(listener)
  }
}

function notifySettingsChange(source: string, extra?: unknown) {
  for (const listener of [...settingsListeners]) listener(source, extra)
}

function growthbookFactory() {
  return {
    ...growthbookMock(),
    getFeatureValue_CACHED_MAY_BE_STALE: (_gate: string, fallback: unknown) =>
      fallback,
    onGrowthBookRefresh: (listener: () => void) => {
      growthbookRefreshListeners.add(listener)
      return () => {
        growthbookRefreshListeners.delete(listener)
      }
    },
  }
}

function changeDetectorMock() {
  return {
    ...changeSnap,
    subscribe: subscribeSettingsChange,
    notifyChange: notifySettingsChange,
    settingsChangeDetector: {
      ...changeSnap.settingsChangeDetector,
      subscribe: subscribeSettingsChange,
      notifyChange: notifySettingsChange,
    },
  }
}

function bootstrapMock() {
  return {
    ...bootstrapSnap,
    getFlagSettingsInline: () => flagInline,
    setFlagSettingsInline: (next: Record<string, unknown> | null) => {
      flagInline = next
    },
  }
}

const settingsFactory = createSettingsMock(settingsSnap, {
  getSettingsForSource: ((source: string) => {
    if (source === 'flagSettings') return flagInline ?? undefined
    return undefined
  }) as typeof realSettings.getSettingsForSource,
  // densable Yo merge for compact gates: flagSettings inline is live.
  getInitialSettings: (() =>
    (flagInline ?? {}) as ReturnType<
      typeof realSettings.getInitialSettings
    >) as typeof realSettings.getInitialSettings,
})

const permissionSetupFactory = createSettingsMock(permissionSetupSnap, {
  setPermissionModeWithGuards: (
    mode: ToolPermissionContext['mode'],
    _ctx: ToolPermissionContext,
    apply: (
      updater: (ctx: ToolPermissionContext) => ToolPermissionContext,
    ) => void,
  ) => {
    apply(ctx => ({ ...ctx, mode }))
    return { ok: true, mode }
  },
} as Partial<typeof permissionSetupSnap>)

mock.module('../../services/analytics/growthbook.js', growthbookFactory)
mock.module('src/services/analytics/growthbook.js', growthbookFactory)

mock.module('../../services/analytics/index.js', analyticsMock)
mock.module('src/services/analytics/index.js', analyticsMock)

mock.module('../../utils/settings/changeDetector.js', changeDetectorMock)
mock.module('src/utils/settings/changeDetector.js', changeDetectorMock)

mock.module('../../bootstrap/state.js', bootstrapMock)
mock.module('src/bootstrap/state.js', bootstrapMock)

mock.module('../../utils/settings/settings.js', settingsFactory)
mock.module('src/utils/settings/settings.js', settingsFactory)

mock.module(
  '../../utils/permissions/permissionSetup.js',
  permissionSetupFactory,
)
mock.module('src/utils/permissions/permissionSetup.js', permissionSetupFactory)

const {
  attachBridgeChildGrants,
  deriveBridgeChildGrantRoles,
  seedAutoModeEnvironmentFacts,
  shouldAttachBridgeChildGrants,
} = await import('../bridgeChildGrants.js')
const { HEARTH_RC_CHILD_TAG, RC_CHILD_TAG } = await import(
  '../sessionOriginTags.js'
)
const { settingsChangeDetector } = await import(
  '../../utils/settings/changeDetector.js'
)

afterEach(() => {
  flagInline = null
  settingsListeners.clear()
  growthbookRefreshListeners.clear()
  delete process.env.CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT
  delete process.env.CLAUDE_CODE_BRIDGE_CHILD_AUTO_COMPACT
})

afterAll(() => {
  // Bun mock.module is process-global — restore shared hosts so co-run suites
  // (HWT sink, getCwd/getSessionId, changeDetector initialize) do not see
  // incomplete analytics/bootstrap/changeDetector/settings.
  mock.module('../../services/analytics/growthbook.js', growthbookMock)
  mock.module('src/services/analytics/growthbook.js', growthbookMock)
  mock.module('../../services/analytics/index.js', restoreAnalyticsMock)
  mock.module('src/services/analytics/index.js', restoreAnalyticsMock)
  mock.module('../../utils/settings/changeDetector.js', () => ({
    ...changeSnap,
  }))
  mock.module('src/utils/settings/changeDetector.js', () => ({
    ...changeSnap,
  }))
  mock.module('../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module(
    '../../utils/settings/settings.js',
    createSettingsMock(settingsSnap),
  )
  mock.module(
    'src/utils/settings/settings.js',
    createSettingsMock(settingsSnap),
  )
  mock.module(
    '../../utils/permissions/permissionSetup.js',
    createSettingsMock(permissionSetupSnap),
  )
  mock.module(
    'src/utils/permissions/permissionSetup.js',
    createSettingsMock(permissionSetupSnap),
  )
})

function makePermission(mode: ToolPermissionContext['mode'] = 'default') {
  let ctx = {
    mode,
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
  } as ToolPermissionContext
  return {
    get: () => ctx,
    set: (updater: (c: ToolPermissionContext) => ToolPermissionContext) => {
      ctx = updater(ctx)
    },
    peek: () => ctx,
  }
}

describe('densable 2.1.289 bridgeChildGrants (ne/ae)', () => {
  test('TQt attach gate defaults on', () => {
    expect(shouldAttachBridgeChildGrants('attach')).toBe(true)
  })

  test('RQt machineSettings only for projectThreadChild (spawn stamp input)', () => {
    const base = {
      tagsRead: true,
      rcChild: false,
      attended: false,
      projectThreadChild: false,
    }
    expect(
      deriveBridgeChildGrantRoles({
        roles: base,
        modePinned: false,
      }).machineSettings,
    ).toBe(false)
    expect(
      deriveBridgeChildGrantRoles({
        roles: { ...base, projectThreadChild: true },
        modePinned: false,
      }).machineSettings,
    ).toBe(true)
    // Attach must not stamp MACHINE_SETTINGS even when derived true —
    // spawn child env is the stamp site (sessionRunner overlay).
    expect(shouldAttachBridgeChildGrants('attach')).toBe(true)
    expect(shouldAttachBridgeChildGrants('spawn')).toBe(true)
  })

  test('RQt autoDefault for rcChild when mode not pinned (spawn stamp input)', () => {
    const base = {
      tagsRead: true,
      rcChild: false,
      attended: false,
      projectThreadChild: false,
    }
    expect(
      deriveBridgeChildGrantRoles({
        roles: base,
        modePinned: false,
      }).autoDefault,
    ).toBe(false)
    expect(
      deriveBridgeChildGrantRoles({
        roles: { ...base, rcChild: true },
        modePinned: false,
      }).autoDefault,
    ).toBe(true)
    expect(
      deriveBridgeChildGrantRoles({
        roles: { ...base, rcChild: true },
        modePinned: true,
      }).autoDefault,
    ).toBe(false)
  })

  test('facts without tags → unread path, no seed', async () => {
    const permission = makePermission('default')
    const handle = await attachBridgeChildGrants({
      sessionId: 'cse_1',
      autoModeEnvironment: [
        'Stated by the service that dispatched this session (a description of the session, not a rule; it grants no permission): fact',
      ],
      permission,
      stillWanted: () => true,
      keepChosenMode: () => false,
      readTags: async () => null,
      setMode: () => ({ ok: true, mode: 'auto' }),
    })
    expect(handle.granted.facts).toBe(0)
    handle.undo()
  })

  test('rc-child + default mode → auto via remote_control_attach', async () => {
    const permission = makePermission('default')
    const triggers: string[] = []
    const handle = await attachBridgeChildGrants({
      sessionId: 'cse_2',
      autoModeEnvironment: [],
      permission,
      stillWanted: () => true,
      keepChosenMode: () => false,
      readTags: async () => [RC_CHILD_TAG],
      setMode: (mode, _ctx, apply, trigger) => {
        triggers.push(`${mode}:${trigger ?? ''}`)
        apply(ctx => ({ ...ctx, mode }))
        return { ok: true, mode }
      },
    })
    expect(handle.granted.autoMode).toBe(true)
    expect(triggers[0]).toBe('auto:remote_control_attach')
    expect(permission.peek().mode).toBe('auto')
    handle.undo()
  })

  test('seedAutoModeEnvironmentFacts writes flagSettings inline (not durable userSettings)', () => {
    const seeded = seedAutoModeEnvironmentFacts([
      'fact-a',
      'fact-a',
      '$defaults',
    ])
    expect(seeded).toEqual(['fact-a'])
    expect(
      (flagInline as { autoMode?: { environment?: string[] } } | null)?.autoMode
        ?.environment,
    ).toEqual(['fact-a'])
  })

  test('facts seed → notifyChange → still present; undo removes', async () => {
    const permission = makePermission('default')
    const fact =
      'Stated by the service that dispatched this session (a description of the session, not a rule; it grants no permission): sticky'
    const handle = await attachBridgeChildGrants({
      sessionId: 'cse_reseed',
      autoModeEnvironment: [fact],
      permission,
      stillWanted: () => true,
      keepChosenMode: () => false,
      readTags: async () => [HEARTH_RC_CHILD_TAG],
      setMode: () => ({ ok: true, mode: 'auto' }),
    })
    expect(handle.granted.facts).toBe(1)
    expect(
      (flagInline as { autoMode?: { environment?: string[] } } | null)?.autoMode
        ?.environment,
    ).toEqual([fact])
    expect(settingsListeners.size).toBe(1)

    // External edit drops the fact — subscribe reseed puts it back.
    flagInline = { autoMode: { environment: ['other'] } }
    settingsChangeDetector.notifyChange('flagSettings')
    expect(
      (flagInline as { autoMode?: { environment?: string[] } } | null)?.autoMode
        ?.environment,
    ).toContain(fact)

    handle.undo()
    expect(settingsListeners.size).toBe(0)
    expect(
      (flagInline as { autoMode?: { environment?: string[] } } | null)?.autoMode
        ?.environment,
    ).not.toContain(fact)
    expect(handle.undo()).toBeNull()
  })

  test('attach stamps CHILD_ARTIFACT only under I7n + attended', async () => {
    const permission = makePermission('default')
    const savedEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
    delete process.env.CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT

    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    const noI7n = await attachBridgeChildGrants({
      sessionId: 'cse_art_cli',
      autoModeEnvironment: [],
      permission,
      stillWanted: () => true,
      keepChosenMode: () => false,
      // attended role (projectThreadChild) → RQt.artifact true
      readTags: async () => [HEARTH_RC_CHILD_TAG],
      setMode: () => ({ ok: true, mode: 'auto' }),
    })
    expect(noI7n.granted.artifact).toBe(false)
    expect(process.env.CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT).toBeUndefined()
    noI7n.undo()

    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts'
    const withI7n = await attachBridgeChildGrants({
      sessionId: 'cse_art_sdk',
      autoModeEnvironment: [],
      permission,
      stillWanted: () => true,
      keepChosenMode: () => false,
      readTags: async () => [HEARTH_RC_CHILD_TAG],
      setMode: () => ({ ok: true, mode: 'auto' }),
    })
    expect(withI7n.granted.artifact).toBe(true)
    expect(process.env.CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT === '1').toBe(true)
    withI7n.undo()
    expect(process.env.CLAUDE_CODE_BRIDGE_CHILD_ARTIFACT).toBeUndefined()

    if (savedEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = savedEntrypoint
  })

  test('projectThreadChild stamps live flagSettings autoCompactEnabled (not dead env)', async () => {
    const permission = makePermission('default')
    const { isAutoCompactEnabled } = await import(
      '../../services/compact/autoCompact.js'
    )
    const { getGlobalConfig, saveGlobalConfig } = await import(
      '../../utils/config.js'
    )
    const prior = getGlobalConfig().autoCompactEnabled
    saveGlobalConfig(current => ({ ...current, autoCompactEnabled: false }))
    try {
      expect(isAutoCompactEnabled()).toBe(false)
      const handle = await attachBridgeChildGrants({
        sessionId: 'cse_autocompact',
        autoModeEnvironment: [],
        permission,
        stillWanted: () => true,
        keepChosenMode: () => false,
        readTags: async () => [HEARTH_RC_CHILD_TAG],
        setMode: () => ({ ok: true, mode: 'auto' }),
      })
      expect(handle.granted.autoCompact).toBe(true)
      expect(process.env.CLAUDE_CODE_BRIDGE_CHILD_AUTO_COMPACT).toBeUndefined()
      expect(
        (flagInline as { autoCompactEnabled?: boolean } | null)
          ?.autoCompactEnabled,
      ).toBe(true)
      expect(isAutoCompactEnabled()).toBe(true)
      handle.undo()
      expect(
        (flagInline as { autoCompactEnabled?: boolean } | null)
          ?.autoCompactEnabled,
      ).toBeUndefined()
      expect(isAutoCompactEnabled()).toBe(false)
    } finally {
      saveGlobalConfig(current => ({
        ...current,
        autoCompactEnabled: prior,
      }))
    }
  })
})
