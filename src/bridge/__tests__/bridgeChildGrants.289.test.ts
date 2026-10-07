import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import type { ToolPermissionContext } from '../../Tool.js'
import * as realPermissionSetup from '../../utils/permissions/permissionSetup.js'
import * as realSettings from '../../utils/settings/settings.js'
import { growthbookMock } from '../../../tests/mocks/growthbook.js'
import {
  createSettingsMock,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

const growthbookRefreshListeners = new Set<() => void>()
const settingsListeners = new Set<(source?: string, extra?: unknown) => void>()

let flagInline: Record<string, unknown> | null = null

const settingsSnap = snapshotModuleExports(realSettings)
const permissionSetupSnap = snapshotModuleExports(realPermissionSetup)

mock.module('../../services/analytics/growthbook.js', () => ({
  ...growthbookMock(),
  getFeatureValue_CACHED_MAY_BE_STALE: (_gate: string, fallback: unknown) =>
    fallback,
  onGrowthBookRefresh: (listener: () => void) => {
    growthbookRefreshListeners.add(listener)
    return () => {
      growthbookRefreshListeners.delete(listener)
    }
  },
}))

mock.module('../../services/analytics/index.js', () => ({
  logEvent: () => {},
}))

mock.module('../../utils/settings/changeDetector.js', () => ({
  settingsChangeDetector: {
    subscribe: (listener: (source?: string, extra?: unknown) => void) => {
      settingsListeners.add(listener)
      return () => {
        settingsListeners.delete(listener)
      }
    },
    notifyChange: (source: string, extra?: unknown) => {
      for (const listener of [...settingsListeners]) listener(source, extra)
    },
  },
}))

mock.module('../../bootstrap/state.js', () => ({
  getFlagSettingsInline: () => flagInline,
  setFlagSettingsInline: (next: Record<string, unknown> | null) => {
    flagInline = next
  },
}))

mock.module(
  '../../utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getSettingsForSource: ((source: string) => {
      if (source === 'flagSettings') return flagInline ?? undefined
      return undefined
    }) as typeof realSettings.getSettingsForSource,
  }),
)

mock.module(
  '../../utils/permissions/permissionSetup.js',
  createSettingsMock(permissionSetupSnap, {
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
  } as Partial<typeof permissionSetupSnap>),
)

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
  // (e.g. serverConfigSession.289 needing parseToolListFromCLI) do not see
  // incomplete growthbook/settings/permissionSetup.
  mock.module('../../services/analytics/growthbook.js', growthbookMock)
  mock.module(
    '../../utils/settings/settings.js',
    createSettingsMock(settingsSnap),
  )
  mock.module(
    '../../utils/permissions/permissionSetup.js',
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
})
