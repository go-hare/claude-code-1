import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getOriginalCwd,
  setAdditionalDirectoriesForClaudeMd,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../../bootstrap/state.js'
import {
  _resetOutsideReadBlockLatchForTests,
  isBlockReadsOutsideWorkingDirectoriesLatched,
} from '../../../memdir/paths.js'
import type { AppState } from '../../../state/AppState.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import * as claudemd from '../../claudemd.js'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import {
  applySettingsChange,
  reconcileAdditionalDirectories,
} from '../applySettingsChange.js'
import * as mdmSettings from '../mdm/settings.js'
import {
  managedRereadInFlight,
  rereadManagedSettingsIfNeeded,
  resetManagedRereadStateForTesting,
} from '../settings.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
} from '../settingsCache.js'

function makeContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

describe('Wave 1C: settings.ts rereadManagedSettingsIfNeeded [P1-#25]', () => {
  beforeEach(() => {
    resetManagedRereadStateForTesting()
    mdmSettings.clearMdmSettingsCache()
    resetSettingsCache()
  })

  afterEach(() => {
    resetManagedRereadStateForTesting()
    mdmSettings.clearMdmSettingsCache()
    resetSettingsCache()
  })

  test('clears in-flight promise in finally and does not compare merged policySettings against file-only slice', async () => {
    // Populate MDM policySettings while no managed-settings.json file exists on disk
    mdmSettings.setMdmSettingsCache(
      { settings: { forceLoginMethod: 'claudeai' }, errors: [] },
      { settings: {}, errors: [] },
    )
    resetSettingsCache()

    const firstChanged = await rereadManagedSettingsIfNeeded()
    // Comparing file-vs-file (null vs null) should NOT falsely report changed
    expect(firstChanged).toBe(false)
    // In-flight MUST be cleared in finally (never latched to Promise.resolve(false))
    expect(managedRereadInFlight()).toBeUndefined()

    // Subsequent call executes cleanly too
    const secondChanged = await rereadManagedSettingsIfNeeded()
    expect(secondChanged).toBe(false)
    expect(managedRereadInFlight()).toBeUndefined()
  })

  test('refreshes OS MDM when prior MDM load had a retryable unread failure', async () => {
    mdmSettings.setMdmSettingsCache(
      {
        settings: {},
        errors: [
          {
            path: 'mdm',
            message: 'plutil timed out',
            unreadCause: 'timeout',
          },
        ],
      },
      { settings: {}, errors: [] },
    )
    resetSettingsCache()

    const refreshSpy = spyOn(
      mdmSettings,
      'refreshMdmSettings',
    ).mockResolvedValueOnce({
      mdm: {
        settings: { disableBypassPermissionsMode: 'disable' },
        errors: [],
      },
      hkcu: { settings: {}, errors: [] },
    })

    try {
      const changed = await rereadManagedSettingsIfNeeded()
      expect(refreshSpy).toHaveBeenCalledTimes(1)
      expect(changed).toBe(true)
      expect(mdmSettings.getMdmSettings().settings).toEqual({
        disableBypassPermissionsMode: 'disable',
      })
      expect(managedRereadInFlight()).toBeUndefined()
    } finally {
      refreshSpy.mockRestore()
    }
  })
})

describe('Wave 1C: applySettingsChange.ts [P0-15 & P1-#20]', () => {
  const savedCwd = getOriginalCwd()
  const tempDirs: string[] = []

  beforeEach(() => {
    _resetOutsideReadBlockLatchForTests()
    resetSettingsCache()
    setAdditionalDirectoriesForClaudeMd([])
  })

  afterEach(() => {
    _resetOutsideReadBlockLatchForTests()
    resetSettingsCache()
    setAdditionalDirectoriesForClaudeMd([])
    setOriginalCwd(savedCwd)
    setCwdState(savedCwd)
    setProjectRoot(savedCwd)
    for (const d of tempDirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('reconcileAdditionalDirectories stamps repo-only dirs as projectSettings and trusted dirs as localSettings', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wave1c-reconcile-')))
    tempDirs.push(dir)
    const repoOnlyDir = join(dir, 'repo-extra')
    const userDir = join(dir, 'user-extra')
    mkdirSync(repoOnlyDir, { recursive: true })
    mkdirSync(userDir, { recursive: true })

    setOriginalCwd(dir)
    setCwdState(dir)
    setProjectRoot(dir)

    setCachedSettingsForSource('projectSettings', {
      permissions: { additionalDirectories: [repoOnlyDir] },
    })
    setCachedSettingsForSource('userSettings', {
      permissions: { additionalDirectories: [userDir] },
    })

    const next = reconcileAdditionalDirectories(
      makeContext(),
      [],
      [repoOnlyDir, userDir],
      'projectSettings',
    )

    expect(next.additionalWorkingDirectories.get(repoOnlyDir)?.source).toBe(
      'projectSettings',
    )
    expect(next.additionalWorkingDirectories.get(userDir)?.source).toBe(
      'localSettings',
    )
  })

  test('applySettingsChange latches blockReadsOutsideWorkingDirectories, applies denyInsteadOfPrompting, recomputes awaySummaryEnabled, and clears memory caches', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wave1c-apply-')))
    const cfgDir = realpathSync(mkdtempSync(join(tmpdir(), 'wave1c-cfg-')))
    tempDirs.push(dir, cfgDir)
    writeFileSync(join(dir, 'CLAUDE.md'), 'hello')
    writeFileSync(
      join(cfgDir, 'settings.json'),
      JSON.stringify({
        awaySummaryEnabled: false,
        permissions: {
          blockReadsOutsideWorkingDirectories: true,
          denyInsteadOfPrompting: true,
        },
      }),
    )
    setOriginalCwd(dir)
    setCwdState(dir)
    setProjectRoot(dir)

    const savedConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = cfgDir
    getClaudeConfigHomeDir.cache?.clear?.()
    resetSettingsCache()

    const clearSpy = spyOn(claudemd, 'clearMemoryFileCaches')
    let state = {
      settings: {},
      settingsEffortTable: undefined,
      toolPermissionContext: makeContext(),
      awaySummaryEnabled: true,
      ultracode: false,
    } as unknown as AppState

    try {
      applySettingsChange('userSettings', updater => {
        state = updater(state)
      })

      expect(
        state.toolPermissionContext.blockReadsOutsideWorkingDirectories,
      ).toBe(true)
      expect(isBlockReadsOutsideWorkingDirectoriesLatched()).toBe(true)
      expect(state.toolPermissionContext.denyInsteadOfPrompting).toBe(true)
      expect(state.toolPermissionContext.shouldAvoidPermissionPrompts).toBe(
        true,
      )
      expect(state.awaySummaryEnabled).toBe(false)
      expect(clearSpy).toHaveBeenCalled()
    } finally {
      clearSpy.mockRestore()
      if (savedConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = savedConfigDir
      }
      getClaudeConfigHomeDir.cache?.clear?.()
      resetSettingsCache()
    }
  })
})
