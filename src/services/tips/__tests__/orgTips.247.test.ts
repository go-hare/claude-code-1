import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realSettings from 'src/utils/settings/settings.js'
import * as realRemote from 'src/services/remoteManagedSettings/syncCacheState.js'

const settingsSnap = snapshotModuleExports(realSettings)
const remoteSnap = snapshotModuleExports(realRemote)

const sourceSettings: Record<string, { spinnerTipsOverride?: unknown }> = {}
let remoteManaged: { spinnerTipsOverride?: { tipsFile?: string } } | null = null

function settingsMock() {
  return {
    ...settingsSnap,
    getSettingsForSource: (source: string) => sourceSettings[source] ?? null,
  }
}

function remoteMock() {
  return {
    ...remoteSnap,
    getRemoteManagedSettingsSyncFromCache: () => remoteManaged,
  }
}

mock.module('src/utils/settings/settings.ts', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)
mock.module('src/services/remoteManagedSettings/syncCacheState.ts', remoteMock)
mock.module('src/services/remoteManagedSettings/syncCacheState.js', remoteMock)

afterAll(() => {
  mock.module('src/utils/settings/settings.ts', () => ({ ...settingsSnap }))
  mock.module('src/utils/settings/settings.js', () => ({ ...settingsSnap }))
  mock.module('src/services/remoteManagedSettings/syncCacheState.ts', () => ({
    ...remoteSnap,
  }))
  mock.module('src/services/remoteManagedSettings/syncCacheState.js', () => ({
    ...remoteSnap,
  }))
})

import {
  CUSTOM_TIP_ID_PREFIX,
  DEFAULT_ORG_TIP_LABEL,
  loadOrgSpinnerTips,
  ORG_TIP_ID_PREFIX,
  resolveOrgTipsFilePath,
  sanitizeSpinnerTipText,
  shouldExcludeDefaultSpinnerTips,
} from '../orgTips.js'

function resetSources(): void {
  for (const key of Object.keys(sourceSettings)) delete sourceSettings[key]
  remoteManaged = null
}

describe('densable 2.1.247 #2 spinnerTipsOverride nt/Ae/Z', () => {
  test('Z collapses whitespace and strips invisible', () => {
    expect(sanitizeSpinnerTipText('  hello\n\tworld  ')).toBe('hello world')
    expect(sanitizeSpinnerTipText('\u200bhi')).toBe('hi')
    expect(sanitizeSpinnerTipText('\u0007')).toBe('')
  })

  test('Ae accepts absolute and ~/ ; rejects relative and UNC', () => {
    expect(resolveOrgTipsFilePath('tips.json')).toBeUndefined()
    expect(
      resolveOrgTipsFilePath('\\\\server\\share\\tips.json'),
    ).toBeUndefined()
    expect(resolveOrgTipsFilePath('//server/share/tips.json')).toBeUndefined()
    const abs = join(tmpdir(), 'org-tips.json')
    const resolvedAbs = resolveOrgTipsFilePath(abs)
    expect(resolvedAbs).toBeDefined()
    expect(resolvedAbs?.toLowerCase().includes('org-tips.json')).toBe(true)
    const home = resolveOrgTipsFilePath('~/org-tips.json')
    expect(home).toBeDefined()
    expect(home?.includes('org-tips.json')).toBe(true)
  })

  test('trusted object tips use org-tip: id, cooldown, clamped priority', async () => {
    resetSources()
    sourceSettings.userSettings = {
      spinnerTipsOverride: {
        label: 'Org',
        tips: [
          {
            id: 'cache-hint',
            text: 'Use prompt cache',
            cooldownSessions: 12,
            priority: 99,
          },
        ],
      },
    }
    const { tips, trustedCount } = await loadOrgSpinnerTips({})
    expect(trustedCount).toBe(1)
    expect(tips[0]?.id).toBe(`${ORG_TIP_ID_PREFIX}cache-hint`)
    expect(tips[0]?.label).toBe('Org')
    expect(tips[0]?.cooldownSessions).toBe(12)
    expect(tips[0]?.priority).toBe(10)
    expect(tips[0]?.providerAgnostic).toBe(true)
    expect(await tips[0]!.content()).toBe('Use prompt cache')
  })

  test('trusted strings keep custom-tip- N; project objects are ignored', async () => {
    resetSources()
    sourceSettings.userSettings = {
      spinnerTipsOverride: { tips: ['from user'] },
    }
    sourceSettings.projectSettings = {
      spinnerTipsOverride: {
        tips: ['from project', { id: 'nope', text: 'ignored' }],
        label: 'ProjectLabel',
        tipsFile: '/tmp/ignored.json',
      },
    }
    const { tips, trustedCount } = await loadOrgSpinnerTips({})
    expect(trustedCount).toBe(1)
    expect(tips.map(t => t.id)).toEqual([
      `${CUSTOM_TIP_ID_PREFIX}0`,
      `${CUSTOM_TIP_ID_PREFIX}1`,
    ])
    expect(tips[0]?.label).toBe(DEFAULT_ORG_TIP_LABEL)
    expect(tips[1]?.label).toBe(DEFAULT_ORG_TIP_LABEL)
    expect(await tips[1]!.content()).toBe('from project')
  })

  test('rt is true only for trusted excludeDefault plus tips or tipsFile', () => {
    resetSources()
    sourceSettings.projectSettings = {
      spinnerTipsOverride: { excludeDefault: true, tips: ['x'] },
    }
    expect(shouldExcludeDefaultSpinnerTips()).toBe(false)
    sourceSettings.userSettings = {
      spinnerTipsOverride: { excludeDefault: true, tips: ['x'] },
    }
    expect(shouldExcludeDefaultSpinnerTips()).toBe(true)
  })

  test('tipsFile loads JSON array; remote managed path is ignored', async () => {
    resetSources()
    const dir = mkdtempSync(join(tmpdir(), 'org-tips-'))
    const file = join(dir, 'tips.json')
    writeFileSync(
      file,
      JSON.stringify(['file tip a', { id: 'b', text: 'file tip b' }]),
    )
    sourceSettings.policySettings = {
      spinnerTipsOverride: { tipsFile: file },
    }
    const loaded = await loadOrgSpinnerTips({})
    expect(loaded.tips.map(t => t.id)).toEqual([
      'org-tip:file:0',
      `${ORG_TIP_ID_PREFIX}b`,
    ])
    expect(await loaded.tips[0]!.content()).toBe('file tip a')

    remoteManaged = { spinnerTipsOverride: { tipsFile: file } }
    const ignored = await loadOrgSpinnerTips({})
    expect(ignored.tips).toEqual([])
  })

  test('drops empty, oversize, bad id, and duplicate ids', async () => {
    resetSources()
    sourceSettings.userSettings = {
      spinnerTipsOverride: {
        tips: [
          '   ',
          'x'.repeat(501),
          { id: 'bad id', text: 'nope' },
          { id: 'keep', text: 'first' },
          { id: 'keep', text: 'second' },
        ],
      },
    }
    const { tips } = await loadOrgSpinnerTips({})
    expect(tips.map(t => t.id)).toEqual([`${ORG_TIP_ID_PREFIX}keep`])
    expect(await tips[0]!.content()).toBe('first')
  })

  test('Pi filters org tips by cooldown before excludeDefault / append', () => {
    const registry = readFileSync(
      join(import.meta.dir, '../tipRegistry.ts'),
      'utf8',
    )
    const pi = registry.slice(
      registry.indexOf('export async function getRelevantTips'),
    )
    expect(pi).toContain('trustedCount')
    expect(pi).toContain(
      'getSessionsSinceLastShown(tip.id) >= tip.cooldownSessions',
    )
    expect(pi).toContain(
      'shouldExcludeDefaultSpinnerTips() && trustedCount > 0',
    )
    expect(pi).toContain('return [...filtered, ...orgTips]')
    expect(pi).not.toContain('return [...filtered, ...customTips]')
    expect(pi).toContain('failedTipIds')
    expect(pi).toContain('tip.providerAgnostic')
    expect(pi).toContain('advertisedCommandAllowed(tip.advertisedCommand)')
    expect(registry).toContain("getAPIProvider() !== 'firstParty'")
    expect(registry).toContain('isFirstPartyAnthropicBaseUrl()')
    expect(registry).toContain('getIsRemoteMode()')
    expect(registry).toContain('filterCommandsForRemoteMode')
    expect(registry).toContain('getBuiltinCommands')
    expect(pi).toContain('loadOrgSpinnerTips(host)')
    expect(pi).toContain('getMarketplacePluginTips(context.storageV5)')
    expect(pi).toContain('context.session.host')
    expect(pi).not.toContain('getReplDiffHost')
    expect(registry).not.toContain('?? getReplDiffHost()')
    expect(registry).toContain('class SpinnerTipHostState')
    expect(registry).not.toContain('ORG_TIPS_CACHE_OWNER')
    expect(registry).not.toContain('if (!tip.isRelevant)')
    expect(registry).toContain('return await tip.isRelevant(context)')
  })

  test('marketplace declared tips advertise /plugin and are provider-agnostic', () => {
    const src = readFileSync(
      join(import.meta.dir, '../marketplacePluginTips.ts'),
      'utf8',
    )
    expect(src).toContain("advertisedCommand: 'plugin'")
    expect(src).toContain('providerAgnostic: true')
    expect(src).toContain('getMarketplaceCacheOnly(')
    expect(src).toContain('getKnown(ctx?.storageV5)')
  })
})
