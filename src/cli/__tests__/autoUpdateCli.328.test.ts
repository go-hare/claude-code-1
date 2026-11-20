import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeInstallChannelTarget,
  shouldSuggestForceForInstallError,
} from '../../commands/install.js'
import { formatAutoUpdatesChannelDisplay } from '../../utils/autoUpdater.js'
import type { DiagnosticInfo } from '../../utils/doctorDiagnostic.js'
import { formatLastUpdateResult } from '../../utils/updateResult.js'
import { formatDoctorSummaryLines, installHandler } from '../handlers/util.js'
import {
  checkUpdatesDisabledByAdmin,
  formatVersionPolicySkipReason,
  resolveEffectiveUpdateChannel,
  resolveNpmUpdatePlan,
  UPDATES_DISABLED_BY_ADMIN_MESSAGE,
  updateCCB,
} from '../updateCCB.js'

const originalDisableUpdates = process.env.DISABLE_UPDATES

afterEach(() => {
  if (originalDisableUpdates === undefined) {
    delete process.env.DISABLE_UPDATES
  } else {
    process.env.DISABLE_UPDATES = originalDisableUpdates
  }
})

describe('2.1.328 auto-update CLI alignment', () => {
  describe('DISABLE_UPDATES enforcement', () => {
    test('checkUpdatesDisabledByAdmin detects truthy DISABLE_UPDATES env values', () => {
      expect(checkUpdatesDisabledByAdmin({ DISABLE_UPDATES: '1' })).toBe(true)
      expect(checkUpdatesDisabledByAdmin({ DISABLE_UPDATES: 'true' })).toBe(
        true,
      )
      expect(checkUpdatesDisabledByAdmin({ DISABLE_UPDATES: '0' })).toBe(false)
      expect(checkUpdatesDisabledByAdmin({})).toBe(false)
    })

    test('updateCCB prints admin refusal message and exits 0 when DISABLE_UPDATES=1', async () => {
      process.env.DISABLE_UPDATES = '1'
      const stdoutChunks: string[] = []
      const exitCodes: number[] = []

      await updateCCB({
        writeStdout: text => stdoutChunks.push(text),
        exit: async code => {
          exitCodes.push(code)
        },
      })

      expect(stdoutChunks.join('')).toBe(UPDATES_DISABLED_BY_ADMIN_MESSAGE)
      expect(exitCodes).toEqual([0])
    })

    test('installHandler prints admin refusal message and exits 0 when DISABLE_UPDATES=1', async () => {
      process.env.DISABLE_UPDATES = '1'
      const stdoutChunks: string[] = []
      const exitCodes: Array<number | string | undefined> = []

      const writeSpy = spyOn(process.stdout, 'write').mockImplementation(((
        chunk: string | Uint8Array,
      ) => {
        stdoutChunks.push(
          typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(),
        )
        return true
      }) as typeof process.stdout.write)
      const exitSpy = spyOn(process, 'exit').mockImplementation(((
        code?: number | string,
      ) => {
        exitCodes.push(code)
        return undefined as never
      }) as typeof process.exit)

      try {
        await installHandler('latest', {})
      } finally {
        writeSpy.mockRestore()
        exitSpy.mockRestore()
      }

      expect(stdoutChunks.join('')).toBe(UPDATES_DISABLED_BY_ADMIN_MESSAGE)
      expect(exitCodes).toEqual([0])
    })
  })

  describe('channel resolution & rc -> slow display', () => {
    test('resolveEffectiveUpdateChannel maps rc -> slow and respects Homebrew cask overrides', () => {
      expect(resolveEffectiveUpdateChannel({ settingsChannel: 'rc' })).toEqual({
        channel: 'rc',
        displayChannel: 'slow',
      })
      expect(
        resolveEffectiveUpdateChannel({ settingsChannel: 'stable' }),
      ).toEqual({
        channel: 'stable',
        displayChannel: 'stable',
      })
      expect(resolveEffectiveUpdateChannel({})).toEqual({
        channel: 'latest',
        displayChannel: 'latest',
      })
      // Homebrew cask name takes precedence over settings
      expect(
        resolveEffectiveUpdateChannel({
          settingsChannel: 'latest',
          homebrewCaskName: 'claude-code',
          isHomebrew: true,
        }),
      ).toEqual({
        channel: 'stable',
        displayChannel: 'stable',
      })
      expect(
        resolveEffectiveUpdateChannel({
          settingsChannel: 'stable',
          homebrewCaskName: 'claude-code@latest',
          isHomebrew: true,
        }),
      ).toEqual({
        channel: 'latest',
        displayChannel: 'latest',
      })
      expect(
        resolveEffectiveUpdateChannel({
          settingsChannel: 'latest',
          homebrewCaskName: null,
          isHomebrew: true,
        }),
      ).toEqual({
        channel: 'stable',
        displayChannel: 'stable',
      })
    })

    test('formatAutoUpdatesChannelDisplay maps rc -> slow', () => {
      expect(formatAutoUpdatesChannelDisplay('rc')).toBe('slow')
      expect(formatAutoUpdatesChannelDisplay('stable')).toBe('stable')
      expect(formatAutoUpdatesChannelDisplay('latest')).toBe('latest')
      expect(formatAutoUpdatesChannelDisplay(undefined)).toBe('latest')
    })

    test('doctor summary formats rc channel as slow and renders Last update attempt', () => {
      const baseDiagnostic: DiagnosticInfo = {
        installationType: 'npm-global',
        version: '2.1.328',
        installationPath: '/usr/local/bin/claude',
        invokedBinary: '/usr/local/bin/claude',
        configInstallMethod: 'global',
        autoUpdates: 'enabled',
        hasUpdatePermissions: true,
        lastUpdateResult: null,
        multipleInstallations: [],
        warnings: [],
        ripgrepStatus: {
          working: true,
          mode: 'embedded',
          systemPath: null,
          note: null,
        },
      }

      const linesNone = formatDoctorSummaryLines(baseDiagnostic, 'rc')
      expect(linesNone).toContain('Auto-update channel: slow')
      expect(linesNone).toContain('Last update attempt: none recorded')

      const linesSuccess = formatDoctorSummaryLines(
        {
          ...baseDiagnostic,
          lastUpdateResult: {
            timestamp: '2026-11-20T03:00:00.000Z',
            path: 'npm-global',
            outcome: 'success',
            status: 'success',
            version_from: '2.1.327',
            version_to: '2.1.328',
            error_code: null,
          },
        },
        'stable',
      )
      expect(linesSuccess).toContain('Auto-update channel: stable')
      expect(linesSuccess).toContain(
        'Last update attempt: success → 2.1.328 (2026-11-20)',
      )

      const linesFailed = formatDoctorSummaryLines(
        {
          ...baseDiagnostic,
          lastUpdateResult: {
            timestamp: '2026-11-20T03:00:00.000Z',
            path: 'native',
            outcome: 'failed',
            status: 'install_failed',
            version_from: '2.1.327',
            version_to: '2.1.328',
            error_code: 'windows_running_exe_lock',
          },
        },
        'latest',
      )
      expect(linesFailed).toContain(
        'Last update attempt: failed (install_failed) — 2026-11-20',
      )
      expect(formatLastUpdateResult(undefined)).toBe('none recorded')
    })

    test('Doctor.tsx uses formatAutoUpdatesChannelDisplay and formatLastUpdateResult', () => {
      const doctorSrc = readFileSync(
        join(import.meta.dir, '../../screens/Doctor.tsx'),
        'utf8',
      )
      expect(doctorSrc).toContain(
        'Auto-update channel: {formatAutoUpdatesChannelDisplay(autoUpdatesChannel)}',
      )
      expect(doctorSrc).toContain(
        'Last update attempt: {formatLastUpdateResult(diagnostic.lastUpdateResult)}',
      )
    })
  })

  describe('semver comparison & policy skip in updateCCB', () => {
    test('uses proper semver ordering for multi-digit and prerelease versions', () => {
      expect(
        resolveNpmUpdatePlan({
          currentVersion: '2.1.9',
          latestVersion: '2.1.10',
          shouldSkip: () => false,
        }),
      ).toEqual({ action: 'update', targetVersion: '2.1.10' })

      expect(
        resolveNpmUpdatePlan({
          currentVersion: '2.1.10',
          latestVersion: '2.1.9',
          shouldSkip: () => false,
        }),
      ).toEqual({ action: 'newer_than_channel', targetVersion: '2.1.9' })

      expect(
        resolveNpmUpdatePlan({
          currentVersion: '2.1.328-rc.1',
          latestVersion: '2.1.328',
          shouldSkip: () => false,
        }),
      ).toEqual({ action: 'update', targetVersion: '2.1.328' })

      expect(
        resolveNpmUpdatePlan({
          currentVersion: '2.1.328',
          latestVersion: '2.1.328',
          shouldSkip: () => false,
        }),
      ).toEqual({ action: 'up_to_date', targetVersion: '2.1.328' })
    })

    test('caps updates at maxVersion and supports forced downgrade when enabled', () => {
      expect(
        resolveNpmUpdatePlan({
          currentVersion: '2.1.320',
          latestVersion: '2.1.330',
          maxVersion: '2.1.325',
          forceDowngradeEnabled: false,
          shouldSkip: () => false,
        }),
      ).toEqual({ action: 'update', targetVersion: '2.1.325' })

      expect(
        resolveNpmUpdatePlan({
          currentVersion: '2.1.328',
          latestVersion: '2.1.330',
          maxVersion: '2.1.325',
          forceDowngradeEnabled: false,
          shouldSkip: () => false,
        }),
      ).toEqual({ action: 'up_to_date', targetVersion: '2.1.328' })

      expect(
        resolveNpmUpdatePlan({
          currentVersion: '2.1.328',
          latestVersion: '2.1.330',
          maxVersion: '2.1.325',
          forceDowngradeEnabled: true,
          shouldSkip: () => false,
        }),
      ).toEqual({ action: 'downgrade', targetVersion: '2.1.325' })
    })

    test('honors shouldSkipVersion for minimumVersion and requiredMaximumVersion', () => {
      expect(
        resolveNpmUpdatePlan({
          currentVersion: '2.1.328',
          latestVersion: '2.1.320',
          shouldSkip: v => v === '2.1.320',
        }),
      ).toEqual({
        action: 'skip_policy',
        targetVersion: '2.1.320',
        cappedByPolicy: false,
      })

      expect(
        resolveNpmUpdatePlan({
          currentVersion: '2.1.320',
          latestVersion: '2.1.335',
          maxVersion: '2.1.330',
          shouldSkip: v => v === '2.1.330',
        }),
      ).toEqual({
        action: 'skip_policy',
        targetVersion: '2.1.330',
        cappedByPolicy: true,
      })

      expect(
        formatVersionPolicySkipReason('2.1.320', {
          minimumVersion: '2.1.328',
        }),
      ).toBe('below your minimumVersion setting (2.1.328)')

      expect(
        formatVersionPolicySkipReason('2.1.330', {
          requiredMaximumVersion: '2.1.325',
        }),
      ).toBe("above your organization's requiredMaximumVersion (2.1.325)")
    })
  })

  describe('install.tsx rc -> stable normalization & copy alignment', () => {
    test('normalizeInstallChannelTarget maps rc -> stable and ignores explicit versions', () => {
      expect(normalizeInstallChannelTarget('rc')).toBe('stable')
      expect(normalizeInstallChannelTarget('stable')).toBe('stable')
      expect(normalizeInstallChannelTarget('latest')).toBe('latest')
      expect(normalizeInstallChannelTarget('2.1.328')).toBeNull()
      expect(normalizeInstallChannelTarget(undefined)).toBeNull()
    })

    test('shouldSuggestForceForInstallError hides --force hint for ManifestSignatureError', () => {
      const sigErr = new Error('Release verification failed')
      sigErr.name = 'ManifestSignatureError'
      expect(shouldSuggestForceForInstallError(sigErr)).toBe(false)
      expect(
        shouldSuggestForceForInstallError(new Error('network error')),
      ).toBe(true)
    })

    test('install.tsx uses official copy, Unicode ellipsis, and no artificial setTimeout delays', () => {
      const installSrc = readFileSync(
        join(import.meta.dir, '../../commands/install.tsx'),
        'utf8',
      )
      expect(installSrc).toContain('Checking installation…')
      expect(installSrc).toContain(
        'Installing Claude Code native build {state.version}…',
      )
      expect(installSrc).toContain('Setting up launcher and shell integration…')
      expect(installSrc).toContain("Couldn't install Claude Code")
      expect(installSrc).toContain('state.forceMayHelp')
      expect(installSrc).not.toContain('setTimeout(')
    })
  })

  describe('ManageMarketplaces.tsx auto-update copy alignment', () => {
    test('uses official 2.1.328 Turn on/off auto-update and footer copy', () => {
      const manageSrc = readFileSync(
        join(import.meta.dir, '../../commands/plugin/ManageMarketplaces.tsx'),
        'utf8',
      )
      expect(manageSrc).toContain(
        "marketplace.autoUpdate ? 'Turn off auto-update' : 'Turn on auto-update'",
      )
      expect(manageSrc).toContain(
        'Auto-update is on for this marketplace and its installed plugins.',
      )
      expect(manageSrc).not.toContain("'Disable auto-update'")
      expect(manageSrc).not.toContain("'Enable auto-update'")
    })
  })
})
