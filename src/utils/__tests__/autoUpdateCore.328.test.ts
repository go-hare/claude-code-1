import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as growthbook from 'src/services/analytics/growthbook.js'
import {
  classifyNpmInstallFailure,
  formatAutoUpdatesChannelDisplay,
  getUpdateRestoreFailure,
  getVersionSkipReason,
  isForceDowngradeEnabled,
  mapFailureHintToErrorCode,
  resetAutoUpdateCheckThrottleForTests,
  setUpdateRestoreFailureForTests,
  shouldForceDowngrade,
  shouldSkipVersion,
  shouldThrottleAutoUpdateCheck,
} from '../autoUpdater.js'
import {
  formatAutoUpdaterDisabledReason,
  getAutoUpdaterDisabledReason,
  getGlobalConfig,
  shouldSkipPluginAutoupdate,
} from '../config.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  DOWNLOAD_DEADLINE_MS,
  isRegistrySessionRefusedError,
  RegistrySessionRefusedError,
  STALL_TIMEOUT_MS,
  StallTimeoutError,
} from '../nativeInstaller/download.js'
import { getHomebrewCaskName } from '../nativeInstaller/packageManagers.js'
import {
  fetchHomebrewCaskLatestVersion,
  getPackageManagerManualUpgradeCommand,
  getPackageManagerUpdateLastFailedAt,
  getPackageManagerUpgradeArgs,
  isPackageManagerAutoUpdateOptedIn,
  PACKAGE_MANAGER_FAILURE_COOLDOWN_MS,
  recordPackageManagerUpdateFailure,
  resetPackageManagerUpdateStateForTests,
} from '../packageManagerAutoUpdate.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'
import { SettingsSchema } from '../settings/types.js'
import {
  formatLastUpdateResult,
  getLastUpdateResult,
  getLastUpdateResultPath,
  type LastUpdateResult,
  saveLastUpdateResult,
} from '../updateResult.js'

const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'DISABLE_UPDATES',
  'DISABLE_AUTOUPDATER',
  'FORCE_AUTOUPDATE_PLUGINS',
  'CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE',
  'CLAUDE_CONFIG_DIR',
  'LOCALAPPDATA',
  'NODE_ENV',
] as const

function snapshotEnv(): void {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
  }
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = savedEnv[k]
    }
  }
  getClaudeConfigHomeDir.cache?.clear?.()
}

describe('official 2.1.328 auto-update core alignment', () => {
  beforeEach(() => {
    snapshotEnv()
    delete process.env.DISABLE_UPDATES
    delete process.env.DISABLE_AUTOUPDATER
    delete process.env.FORCE_AUTOUPDATE_PLUGINS
    delete process.env.CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    delete process.env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE
    process.env.NODE_ENV = 'test'
    resetAutoUpdateCheckThrottleForTests()
    resetPackageManagerUpdateStateForTests()
    setUpdateRestoreFailureForTests(null)
    resetSettingsCache()
  })

  afterEach(() => {
    restoreEnv()
    resetAutoUpdateCheckThrottleForTests()
    resetPackageManagerUpdateStateForTests()
    setUpdateRestoreFailureForTests(null)
    resetSettingsCache()
  })

  describe('DISABLE_UPDATES and formatAutoUpdaterDisabledReason', () => {
    test('DISABLE_UPDATES takes precedence over DISABLE_AUTOUPDATER and NODE_ENV=development', () => {
      process.env.DISABLE_UPDATES = '1'
      process.env.DISABLE_AUTOUPDATER = '1'
      process.env.NODE_ENV = 'development'
      expect(getAutoUpdaterDisabledReason()).toEqual({
        type: 'env',
        envVar: 'DISABLE_UPDATES',
      })
    })

    test('formatAutoUpdaterDisabledReason formats env reasons as "set by env: <VAR>"', () => {
      expect(
        formatAutoUpdaterDisabledReason({
          type: 'env',
          envVar: 'DISABLE_UPDATES',
        }),
      ).toBe('set by env: DISABLE_UPDATES')
      expect(
        formatAutoUpdaterDisabledReason({
          type: 'env',
          envVar: 'DISABLE_AUTOUPDATER',
        }),
      ).toBe('set by env: DISABLE_AUTOUPDATER')
      expect(formatAutoUpdaterDisabledReason({ type: 'development' })).toBe(
        'development build',
      )
      expect(formatAutoUpdaterDisabledReason({ type: 'config' })).toBe('config')
    })

    test('shouldSkipPluginAutoupdate honors CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST', () => {
      const globalConfig = getGlobalConfig()
      const prevAutoUpdates = globalConfig.autoUpdates
      try {
        globalConfig.autoUpdates = true
        setSessionSettingsCache({ settings: {}, errors: [] })
        setCachedSettingsForSource('userSettings', {})
        setCachedSettingsForSource('policySettings', null)
        setCachedSettingsForSource('flagSettings', null)
        setCachedSettingsForSource('projectSettings', null)
        setCachedSettingsForSource('localSettings', null)

        // Without host pin flag, DISABLE_AUTOUPDATER skips plugin autoupdate
        process.env.DISABLE_AUTOUPDATER = '1'
        expect(shouldSkipPluginAutoupdate()).toBe(true)

        // With host pin flag, IDE-hosted session still auto-updates plugins
        process.env.CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST = '1'
        expect(shouldSkipPluginAutoupdate()).toBe(false)

        // DISABLE_UPDATES still blocks plugins even under host pin
        process.env.DISABLE_UPDATES = '1'
        expect(shouldSkipPluginAutoupdate()).toBe(true)
        delete process.env.DISABLE_UPDATES

        // User settings env disabling auto-updater still blocks plugins under host pin
        setCachedSettingsForSource('userSettings', {
          env: { DISABLE_AUTOUPDATER: 'true' },
        })
        expect(shouldSkipPluginAutoupdate()).toBe(true)

        // FORCE_AUTOUPDATE_PLUGINS overrides everything
        process.env.FORCE_AUTOUPDATE_PLUGINS = '1'
        expect(shouldSkipPluginAutoupdate()).toBe(false)
      } finally {
        globalConfig.autoUpdates = prevAutoUpdates
      }
    })
  })

  describe('updateResult.ts save / load / format', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'cc-update-result-'))
      process.env.CLAUDE_CONFIG_DIR = tempDir
      getClaudeConfigHomeDir.cache?.clear?.()
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    test('returns null when no update result file exists', () => {
      expect(getLastUpdateResult()).toBeNull()
    })

    test('saves and loads a valid LastUpdateResult atomically', () => {
      const sample: LastUpdateResult = {
        timestamp: '2026-11-20T03:00:00.000Z',
        path: 'native',
        outcome: 'success',
        status: 'success',
        version_from: '2.1.327',
        version_to: '2.1.328',
        error_code: null,
      }
      saveLastUpdateResult(sample)
      expect(getLastUpdateResult()).toEqual(sample)
    })

    test('returns null on invalid schema or corrupt JSON', () => {
      writeFileSync(getLastUpdateResultPath(), '{not-json', 'utf8')
      expect(getLastUpdateResult()).toBeNull()

      writeFileSync(
        getLastUpdateResultPath(),
        JSON.stringify({ outcome: 'unknown-outcome', path: 'bogus' }),
        'utf8',
      )
      expect(getLastUpdateResult()).toBeNull()
    })

    test('formatLastUpdateResult matches official E() formatting', () => {
      expect(formatLastUpdateResult(null)).toBe('none recorded')
      expect(formatLastUpdateResult(undefined)).toBe('none recorded')
      expect(
        formatLastUpdateResult({
          timestamp: '2026-11-20T03:00:00.000Z',
          path: 'native',
          outcome: 'success',
          status: 'success',
          version_from: '2.1.327',
          version_to: '2.1.328',
          error_code: null,
        }),
      ).toBe('success → 2.1.328 (2026-11-20)')
      expect(
        formatLastUpdateResult({
          timestamp: '2026-11-20T03:00:00.000Z',
          path: 'npm-global',
          outcome: 'success',
          status: 'success',
          version_from: '2.1.327',
          version_to: null,
          error_code: null,
        }),
      ).toBe('success (2026-11-20)')
      expect(
        formatLastUpdateResult({
          timestamp: '2026-11-20T03:00:00.000Z',
          path: 'npm-global',
          outcome: 'failed',
          status: 'no_permissions',
          version_from: '2.1.327',
          version_to: null,
          error_code: 'update_apply_no_permissions',
        }),
      ).toBe('failed (no_permissions) — 2026-11-20')
    })
  })

  describe('shouldThrottleAutoUpdateCheck', () => {
    test('allows first check, throttles within 5 minutes, allows after 5 minutes or reset', () => {
      let now = 1_000_000
      const nowSpy = spyOn(Date, 'now').mockImplementation(() => now)
      try {
        expect(shouldThrottleAutoUpdateCheck()).toBe(false)
        now += 60_000
        expect(shouldThrottleAutoUpdateCheck()).toBe(true)
        now += 239_999
        expect(shouldThrottleAutoUpdateCheck()).toBe(true)
        now += 1
        expect(shouldThrottleAutoUpdateCheck()).toBe(false)

        resetAutoUpdateCheckThrottleForTests()
        expect(shouldThrottleAutoUpdateCheck()).toBe(false)
      } finally {
        nowSpy.mockRestore()
      }
    })
  })

  describe('shouldSkipVersion with minimumVersion and policySettings.requiredMaximumVersion', () => {
    test('skips versions below minimumVersion and above policySettings.requiredMaximumVersion', () => {
      setSessionSettingsCache({
        settings: { minimumVersion: '2.1.300' },
        errors: [],
      })
      setCachedSettingsForSource('policySettings', {
        requiredMaximumVersion: '2.1.325',
      })

      expect(shouldSkipVersion('2.1.299')).toBe(true)
      expect(getVersionSkipReason('2.1.299')).toContain('minimumVersion')

      expect(shouldSkipVersion('2.1.320')).toBe(false)
      expect(shouldSkipVersion('2.1.325')).toBe(false)

      expect(shouldSkipVersion('2.1.326')).toBe(true)
      expect(getVersionSkipReason('2.1.326')).toContain(
        'requiredMaximumVersion',
      )

      // Invalid target semver constrains nothing (returns false / null)
      expect(shouldSkipVersion('not-a-semver')).toBe(false)
      expect(getVersionSkipReason('not-a-semver')).toBeNull()
    })
  })

  describe('formatAutoUpdatesChannelDisplay, force downgrade, and restore failure', () => {
    test('maps rc to slow and defaults undefined to latest', () => {
      expect(formatAutoUpdatesChannelDisplay('rc')).toBe('slow')
      expect(formatAutoUpdatesChannelDisplay('stable')).toBe('stable')
      expect(formatAutoUpdatesChannelDisplay('latest')).toBe('latest')
      expect(formatAutoUpdatesChannelDisplay(undefined)).toBe('latest')
    })

    test('isForceDowngradeEnabled reads GrowthBook external_force_downgrade', () => {
      const gbSpy = spyOn(
        growthbook,
        'getFeatureValue_CACHED_MAY_BE_STALE',
      ).mockReturnValue({} as never)
      try {
        expect(isForceDowngradeEnabled()).toBe(false)
        gbSpy.mockReturnValue({
          external: '2.1.320',
          external_force_downgrade: true,
        } as never)
        expect(isForceDowngradeEnabled()).toBe(true)
        expect(shouldForceDowngrade('2.1.328', '2.1.320')).toBe(true)
        expect(shouldForceDowngrade('2.1.320', '2.1.320')).toBe(false)
      } finally {
        gbSpy.mockRestore()
      }
    })

    test('getUpdateRestoreFailure & classifyNpmInstallFailure native_binary_missing', () => {
      expect(getUpdateRestoreFailure()).toBeNull()
      setUpdateRestoreFailureForTests({
        originalPath: 'C:\\npm\\claude.exe',
        preservedPath: 'C:\\npm\\claude.exe.old.123',
      })
      expect(getUpdateRestoreFailure()).toEqual({
        originalPath: 'C:\\npm\\claude.exe',
        preservedPath: 'C:\\npm\\claude.exe.old.123',
      })

      expect(
        classifyNpmInstallFailure(
          '[postinstall] Native package "@anthropic-ai/claude-code-darwin-arm64" not found',
          'darwin',
        ),
      ).toEqual({
        status: 'install_failed',
        failureHint: 'native_binary_missing',
      })
      expect(mapFailureHintToErrorCode('native_binary_missing')).toBe(
        'update_apply_native_binary_missing',
      )
      expect(mapFailureHintToErrorCode('registry_session_refused')).toBe(
        'update_session_refused',
      )
    })
  })

  describe('getHomebrewCaskName', () => {
    const origExecPath = process.execPath

    afterEach(() => {
      Object.defineProperty(process, 'execPath', {
        value: origExecPath,
        configurable: true,
        writable: true,
      })
    })

    test('extracts cask name from Caskroom path and returns null otherwise', () => {
      Object.defineProperty(process, 'execPath', {
        value: '/opt/homebrew/Caskroom/claude-code/2.1.328/claude',
        configurable: true,
        writable: true,
      })
      expect(getHomebrewCaskName()).toBe('claude-code')

      Object.defineProperty(process, 'execPath', {
        value: '/opt/homebrew/Caskroom/claude-code@latest/2.1.328/claude',
        configurable: true,
        writable: true,
      })
      expect(getHomebrewCaskName()).toBe('claude-code@latest')

      Object.defineProperty(process, 'execPath', {
        value: '/usr/local/bin/claude',
        configurable: true,
        writable: true,
      })
      expect(getHomebrewCaskName()).toBeNull()
    })
  })

  describe('packageManagerAutoUpdate', () => {
    test('opt-in flag, cooldown constant, and failure tracking', () => {
      expect(PACKAGE_MANAGER_FAILURE_COOLDOWN_MS).toBe(1_800_000)
      expect(isPackageManagerAutoUpdateOptedIn()).toBe(false)

      process.env.CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE = '1'
      expect(isPackageManagerAutoUpdateOptedIn()).toBe(true)

      expect(getPackageManagerUpdateLastFailedAt()).toBe(0)
      recordPackageManagerUpdateFailure(123_456)
      expect(getPackageManagerUpdateLastFailedAt()).toBe(123_456)
      resetPackageManagerUpdateStateForTests()
      expect(getPackageManagerUpdateLastFailedAt()).toBe(0)
    })

    test('getPackageManagerUpgradeArgs and getPackageManagerManualUpgradeCommand', () => {
      expect(getPackageManagerUpgradeArgs('homebrew', null)).toEqual([
        'brew',
        'upgrade',
        '--cask',
        'claude-code',
      ])
      expect(
        getPackageManagerUpgradeArgs('homebrew', 'claude-code@latest'),
      ).toEqual(['brew', 'upgrade', '--cask', 'claude-code@latest'])

      delete process.env.LOCALAPPDATA
      expect(getPackageManagerUpgradeArgs('winget')).toEqual([
        'winget',
        'upgrade',
        '--id',
        'Anthropic.ClaudeCode',
        '--exact',
        '--silent',
        '--disable-interactivity',
      ])

      process.env.LOCALAPPDATA = '/Users/test/AppData/Local'
      expect(getPackageManagerUpgradeArgs('winget')?.[0]).toBe(
        join(
          '/Users/test/AppData/Local',
          'Microsoft',
          'WindowsApps',
          'winget.exe',
        ),
      )

      expect(getPackageManagerUpgradeArgs('mise')).toBeNull()
      expect(getPackageManagerUpgradeArgs('apk')).toBeNull()

      expect(getPackageManagerManualUpgradeCommand('homebrew')).toBe(
        'brew upgrade claude-code',
      )
      expect(
        getPackageManagerManualUpgradeCommand('homebrew', 'claude-code@latest'),
      ).toBe('brew upgrade claude-code@latest')
      expect(getPackageManagerManualUpgradeCommand('winget')).toBe(
        'winget upgrade Anthropic.ClaudeCode',
      )
      expect(getPackageManagerManualUpgradeCommand('mise')).toBe(
        'mise upgrade claude',
      )
      expect(getPackageManagerManualUpgradeCommand('apk')).toBe(
        'apk upgrade claude-code',
      )
      expect(getPackageManagerManualUpgradeCommand('unknown')).toBe(
        'your package manager update command',
      )
    })

    test('fetchHomebrewCaskLatestVersion parses valid semver and rejects invalid', async () => {
      const getSpy = spyOn(axios, 'get').mockResolvedValueOnce({
        data: { version: '2.1.328' },
      } as never)
      try {
        const version = await fetchHomebrewCaskLatestVersion('claude-code')
        expect(version).toBe('2.1.328')
        expect(getSpy).toHaveBeenCalledWith(
          'https://formulae.brew.sh/api/cask/claude-code.json',
          { timeout: 5000, responseType: 'json' },
        )
      } finally {
        getSpy.mockRestore()
      }

      const badSpy = spyOn(axios, 'get').mockResolvedValueOnce({
        data: { version: 'not-semver' },
      } as never)
      try {
        expect(await fetchHomebrewCaskLatestVersion('claude-code')).toBeNull()
      } finally {
        badSpy.mockRestore()
      }
    })
  })

  describe('settings schema & nativeInstaller download constants', () => {
    test('SettingsSchema accepts rc channel and requiredMinimumVersion/requiredMaximumVersion', () => {
      const parsed = SettingsSchema().safeParse({
        autoUpdatesChannel: 'rc',
        requiredMinimumVersion: '2.1.300',
        requiredMaximumVersion: '2.1.330',
      })
      expect(parsed.success).toBe(true)
    })

    test('nativeInstaller download timeouts and RegistrySessionRefusedError', () => {
      expect(STALL_TIMEOUT_MS).toBe(120_000)
      expect(DOWNLOAD_DEADLINE_MS).toBe(600_000)
      expect(new StallTimeoutError().message).toContain('120 seconds')

      const err = new RegistrySessionRefusedError('session refused')
      expect(isRegistrySessionRefusedError(err)).toBe(true)
      expect(isRegistrySessionRefusedError(new Error('other'))).toBe(false)
    })
  })
})
