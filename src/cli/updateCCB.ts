/**
 * `claude update` — Check and install the latest version of Claude Code.
 *
 * Aligns with official Claude Code 2.1.328 (`ne` @316202231) while preserving
 * this fork's `MACRO.PACKAGE_URL` (`@go-hare/claude-code`) and bun/npm global
 * update flow.
 */
import chalk from 'chalk'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logEvent } from '../services/analytics/index.js'
import {
  formatAutoUpdatesChannelDisplay,
  getLatestVersion,
  getMaxVersion,
  type InstallOutcome,
  installGlobalPackage,
  isForceDowngradeEnabledAsync,
  shouldSkipVersion,
} from '../utils/autoUpdater.js'
import {
  getAutoUpdaterDisabledReason,
  getGlobalConfig,
  type InstallMethod,
  type ReleaseChannel,
  saveGlobalConfig,
} from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import { distRoot } from '../utils/distRoot.js'
import { getDoctorDiagnostic } from '../utils/doctorDiagnostic.js'
import { env } from '../utils/env.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { execFileNoThrowWithCwd } from '../utils/execFileNoThrow.js'
import { gracefulShutdown } from '../utils/gracefulShutdown.js'
import {
  installOrUpdateClaudePackage,
  localInstallationExists,
} from '../utils/localInstaller.js'
import { installLatest } from '../utils/nativeInstaller/index.js'
import {
  detectHomebrew,
  getHomebrewCaskName,
  getPackageManager,
  type PackageManager,
} from '../utils/nativeInstaller/packageManagers.js'
import {
  fetchHomebrewCaskLatestVersion,
  getPackageManagerManualUpgradeCommand,
} from '../utils/packageManagerAutoUpdate.js'
import { writeToStdout } from '../utils/process.js'
import { gt, gte, lt, lte } from '../utils/semver.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../utils/settings/settings.js'
import { saveLastUpdateResult } from '../utils/updateResult.js'
import {
  formatCliActionSuccess,
  formatCliError,
  formatCliSuccess,
  formatCliWarning,
} from './cliStatusMarkers.js'

/** Published npm package name (fork: @go-hare/claude-code via MACRO). */
function getPackageName(): string {
  return (
    (typeof MACRO !== 'undefined' && MACRO.PACKAGE_URL) ||
    '@go-hare/claude-code'
  )
}

export const UPDATES_DISABLED_BY_ADMIN_MESSAGE =
  'Updates are disabled by your administrator. Contact your IT team to get the latest version.\n'

export type EffectiveUpdateChannel = 'latest' | 'stable' | 'rc'

/**
 * Official 2.1.328: check whether `DISABLE_UPDATES` blocks manual updates.
 */
export function checkUpdatesDisabledByAdmin(
  envVars: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isEnvTruthy(envVars.DISABLE_UPDATES)) {
    return true
  }
  if (envVars === process.env) {
    const reason = getAutoUpdaterDisabledReason()
    if (reason?.type === 'env' && reason.envVar === 'DISABLE_UPDATES') {
      return true
    }
  }
  return false
}

/**
 * Official 2.1.328: resolve the effective release channel and its display label.
 * Homebrew casks choose their channel by cask name (`claude-code@latest` ->
 * `'latest'`, `claude-code` -> `'stable'`), overriding `autoUpdatesChannel`.
 * `'rc'` is displayed as `'slow'`.
 */
export function resolveEffectiveUpdateChannel(options: {
  settingsChannel?: string
  homebrewCaskName?: string | null
  isHomebrew?: boolean
}): {
  channel: EffectiveUpdateChannel
  displayChannel: string
} {
  const rawSettings = options.settingsChannel
  const settingsChannel: EffectiveUpdateChannel =
    rawSettings === 'stable' || rawSettings === 'rc' ? rawSettings : 'latest'

  let channel: EffectiveUpdateChannel
  if (options.homebrewCaskName) {
    channel =
      options.homebrewCaskName === 'claude-code@latest' ? 'latest' : 'stable'
  } else if (options.isHomebrew) {
    channel = 'stable'
  } else {
    channel = settingsChannel
  }

  return {
    channel,
    displayChannel: formatAutoUpdatesChannelDisplay(channel),
  }
}

export type NpmUpdatePlan =
  | {
      action: 'skip_policy'
      targetVersion: string
      cappedByPolicy: boolean
    }
  | {
      action: 'up_to_date'
      targetVersion: string
    }
  | {
      action: 'newer_than_channel'
      targetVersion: string
    }
  | {
      action: 'downgrade'
      targetVersion: string
    }
  | {
      action: 'update'
      targetVersion: string
    }

/**
 * Pure semver/policy decision helper for npm/bun global and local updates.
 * Uses proper semver comparisons (`gt`, `lt`) instead of naive string splits.
 */
export function resolveNpmUpdatePlan(params: {
  currentVersion: string
  latestVersion: string
  maxVersion?: string
  forceDowngradeEnabled?: boolean
  shouldSkip?: (targetVersion: string) => boolean
}): NpmUpdatePlan {
  const {
    currentVersion,
    latestVersion,
    maxVersion,
    forceDowngradeEnabled = false,
    shouldSkip = shouldSkipVersion,
  } = params

  let targetVersion = latestVersion
  let isForcedDowngrade = false

  if (forceDowngradeEnabled && maxVersion && gt(currentVersion, maxVersion)) {
    targetVersion = maxVersion
    isForcedDowngrade = true
  } else if (maxVersion && gt(latestVersion, maxVersion)) {
    logForDebugging(
      `update: maxVersion ${maxVersion} is set, capping update from ${latestVersion} to ${maxVersion}`,
    )
    targetVersion = gt(maxVersion, currentVersion) ? maxVersion : currentVersion
  }

  if (shouldSkip(targetVersion)) {
    return {
      action: 'skip_policy',
      targetVersion,
      cappedByPolicy: targetVersion !== latestVersion,
    }
  }

  if (targetVersion === currentVersion) {
    return { action: 'up_to_date', targetVersion }
  }

  if (!isForcedDowngrade && lt(targetVersion, currentVersion)) {
    return { action: 'newer_than_channel', targetVersion }
  }

  if (isForcedDowngrade) {
    return { action: 'downgrade', targetVersion }
  }

  return { action: 'update', targetVersion }
}

/**
 * Describe why a version was skipped by policy (`minimumVersion` or
 * `requiredMaximumVersion`), matching official 2.1.328 `y1o` copy.
 */
export function formatVersionPolicySkipReason(
  targetVersion: string,
  options?: {
    minimumVersion?: string
    requiredMaximumVersion?: string
  },
): string {
  const minimumVersion =
    options?.minimumVersion ?? getInitialSettings()?.minimumVersion
  if (minimumVersion) {
    try {
      if (!gte(targetVersion, minimumVersion)) {
        return `below your minimumVersion setting (${minimumVersion})`
      }
    } catch {
      // ignore invalid semver
    }
  }
  const requiredMaximumVersion =
    options?.requiredMaximumVersion ??
    getSettingsForSource('policySettings')?.requiredMaximumVersion
  if (requiredMaximumVersion) {
    try {
      if (!lte(targetVersion, requiredMaximumVersion)) {
        return `above your organization's requiredMaximumVersion (${requiredMaximumVersion})`
      }
    } catch {
      // ignore invalid semver
    }
  }
  return 'skipped by your version policy'
}

function getCurrentVersion(): string {
  try {
    const pkgPath = join(distRoot, '..', 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (typeof pkg.version === 'string' && pkg.version) return pkg.version
    }
  } catch {
    // fallback to MACRO.VERSION
  }
  return (typeof MACRO !== 'undefined' && MACRO.VERSION) || '0.0.0'
}

/**
 * Detect whether the current fork installation lives under bun's global store
 * (even when invoked via a node wrapper).
 */
function hasBunGlobalInstallation(): boolean {
  const bunGlobalDir = join(homedir(), '.bun', 'install', 'global')
  return existsSync(
    join(bunGlobalDir, 'node_modules', ...getPackageName().split('/')),
  )
}

async function installGlobalViaBunOrNpm(
  targetVersion: string,
): Promise<InstallOutcome> {
  // When not running under Bun, preserve fork's bun global install detection
  // if the package is installed in ~/.bun/install/global and `bun` is on PATH.
  if (!env.isRunningWithBun() && hasBunGlobalInstallation()) {
    const bunCheck = await execFileNoThrowWithCwd('bun', ['--version'], {
      cwd: homedir(),
    })
    if (bunCheck.code === 0) {
      const result = await execFileNoThrowWithCwd(
        'bun',
        ['install', '-g', `${getPackageName()}@${targetVersion}`],
        { cwd: homedir(), timeout: 120_000 },
      )
      if (result.code === 0) {
        saveGlobalConfig(current => ({
          ...current,
          installMethod: 'global',
        }))
        return { status: 'success' }
      }
      const combined = `${result.stdout} ${result.stderr}`
      if (/\b(EACCES|EPERM|permission denied)\b/i.test(combined)) {
        return { status: 'no_permissions' }
      }
      return { status: 'install_failed' }
    }
  }
  return installGlobalPackage(targetVersion)
}

function getPackageManagerLabel(pm: PackageManager): string {
  switch (pm) {
    case 'homebrew':
      return 'Homebrew'
    case 'winget':
      return 'winget'
    case 'apk':
      return 'apk'
    case 'mise':
      return 'mise'
    case 'asdf':
      return 'asdf'
    case 'pacman':
      return 'pacman'
    case 'deb':
      return 'deb'
    case 'rpm':
      return 'rpm'
    default:
      return 'a package manager'
  }
}

export type UpdateCCBDeps = {
  exit?: (code: number) => Promise<void>
  writeStdout?: (text: string) => void
}

export async function updateCCB(deps?: UpdateCCBDeps): Promise<void> {
  const exit = deps?.exit ?? (code => gracefulShutdown(code))
  const out = deps?.writeStdout ?? writeToStdout

  if (checkUpdatesDisabledByAdmin()) {
    out(UPDATES_DISABLED_BY_ADMIN_MESSAGE)
    await exit(0)
    return
  }

  logEvent('tengu_update_check', {})
  const currentVersion = getCurrentVersion()
  writeToStdout(`Current version: ${currentVersion}\n`)

  const homebrewCaskName = getHomebrewCaskName()
  const { channel, displayChannel } = resolveEffectiveUpdateChannel({
    settingsChannel: getInitialSettings()?.autoUpdatesChannel,
    homebrewCaskName,
    isHomebrew: detectHomebrew(),
  })
  const npmChannel: ReleaseChannel = channel === 'stable' ? 'stable' : 'latest'

  writeToStdout(`Checking for updates to ${displayChannel} version…\n`)
  logForDebugging('update: Starting update check')
  logForDebugging('update: Running diagnostic')

  const diagnostic = await getDoctorDiagnostic()
  logForDebugging(`update: Installation type: ${diagnostic.installationType}`)
  logForDebugging(
    `update: Config install method: ${diagnostic.configInstallMethod}`,
  )

  if (diagnostic.multipleInstallations.length > 1) {
    writeToStdout('\n')
    writeToStdout(
      chalk.yellow(
        formatCliWarning('Multiple installations found', 'Warning: '),
      ) + '\n',
    )
    for (const inst of diagnostic.multipleInstallations) {
      const running =
        diagnostic.installationType === inst.type ? ' (currently running)' : ''
      writeToStdout(`- ${inst.type} at ${inst.path}${running}\n`)
    }
  }

  if (diagnostic.warnings.length > 0) {
    writeToStdout('\n')
    for (const warning of diagnostic.warnings) {
      logForDebugging(`update: Warning detected: ${warning.issue}`)
      writeToStdout(
        chalk.yellow(formatCliWarning(`${warning.issue}\n`, 'Warning: ')),
      )
      writeToStdout(chalk.bold(`Fix: ${warning.fix.replaceAll('`', '')}\n`))
    }
  }

  const config = getGlobalConfig()
  if (
    !config.installMethod &&
    diagnostic.installationType !== 'package-manager'
  ) {
    writeToStdout('\n')
    writeToStdout('Saving the installation method…\n')
    let method: InstallMethod = 'unknown'
    switch (diagnostic.installationType) {
      case 'npm-local':
        method = 'local'
        break
      case 'native':
        method = 'native'
        break
      case 'npm-global':
        method = 'global'
        break
      default:
        method = 'unknown'
    }
    saveGlobalConfig(prev => ({ ...prev, installMethod: method }))
    writeToStdout(`Installation method set to: ${method}\n`)
  }

  // Development builds cannot be updated
  if (diagnostic.installationType === 'development') {
    writeToStdout('\n')
    writeToStdout(
      chalk.yellow(
        formatCliWarning("Development builds can't be updated", 'Warning: '),
      ) + '\n',
    )
    await gracefulShutdown(1)
    return
  }

  // Package-manager installations: show manual upgrade command
  if (diagnostic.installationType === 'package-manager') {
    const pm = await getPackageManager()
    const upgradeCmd = getPackageManagerManualUpgradeCommand(
      pm,
      homebrewCaskName,
    )
    writeToStdout('\n')
    writeToStdout(`Claude is managed by ${getPackageManagerLabel(pm)}.\n`)

    let latestForPm: string | null = null
    if (pm === 'homebrew') {
      const [brewLatest, npmLatest] = await Promise.all([
        fetchHomebrewCaskLatestVersion(homebrewCaskName ?? 'claude-code'),
        getLatestVersion(npmChannel),
      ])
      latestForPm = brewLatest ?? npmLatest
    } else if (pm !== 'unknown') {
      latestForPm = await getLatestVersion(npmChannel)
    }

    if (pm === 'unknown') {
      writeToStdout('Use your package manager to update.\n')
    } else if (!latestForPm) {
      writeToStdout(
        formatCliWarning(
          pm === 'homebrew'
            ? "Couldn't check for updates (network check skipped or unavailable).\n"
            : "Couldn't check for updates (no usable answer from npm).\n",
          '',
        ),
      )
      writeToStdout('To update manually, run:\n')
      writeToStdout(chalk.bold(`  ${upgradeCmd}`) + '\n')
    } else if (!gte(currentVersion, latestForPm)) {
      writeToStdout(`Update available: ${currentVersion} → ${latestForPm}\n`)
      writeToStdout('\n')
      writeToStdout('To update, run:\n')
      writeToStdout(chalk.bold(`  ${upgradeCmd}`) + '\n')
    } else {
      writeToStdout('Claude is up to date!\n')
    }

    if (pm === 'homebrew' && homebrewCaskName !== 'claude-code@latest') {
      writeToStdout('\n')
      writeToStdout(
        chalk.dim(
          'Tip: For more frequent updates, use the claude-code@latest cask:\n',
        ),
      )
      writeToStdout(
        chalk.dim(
          `  brew uninstall --cask ${homebrewCaskName ?? 'claude-code'} && brew install --cask claude-code@latest`,
        ) + '\n',
      )
    }

    await gracefulShutdown(0)
    return
  }

  // Warn and sync installMethod if config disagrees with running installation
  if (config.installMethod && diagnostic.configInstallMethod !== 'not set') {
    const methodMap: Partial<Record<string, InstallMethod>> = {
      'npm-local': 'local',
      'npm-global': 'global',
      native: 'native',
      unknown: 'unknown',
    }
    const actualMethod = methodMap[diagnostic.installationType]
    if (
      actualMethod &&
      actualMethod !== diagnostic.configInstallMethod &&
      diagnostic.configInstallMethod !== 'unknown'
    ) {
      writeToStdout('\n')
      writeToStdout(
        chalk.yellow(
          formatCliWarning(
            "Config doesn't match this installation",
            'Warning: ',
          ),
        ) + '\n',
      )
      writeToStdout(
        `Config expects: ${diagnostic.configInstallMethod} installation\n`,
      )
      writeToStdout(`Currently running: ${diagnostic.installationType}\n`)
      writeToStdout(
        chalk.yellow(
          `Updating the ${diagnostic.installationType} installation you're using`,
        ) + '\n',
      )
      saveGlobalConfig(prev => ({ ...prev, installMethod: actualMethod }))
      writeToStdout(`Installation method set to: ${actualMethod}\n`)
    }
  }

  // Native installation
  if (diagnostic.installationType === 'native') {
    logForDebugging(
      'update: Detected native installation, using native updater',
    )
    try {
      const result = await installLatest(channel, false)
      if (result.lockFailed) {
        const pidSuffix = result.lockHolderPid
          ? ` (PID ${result.lockHolderPid})`
          : ''
        writeToStdout(
          chalk.yellow(
            formatCliWarning(
              `Another Claude process${pidSuffix} is running. Try again in a moment.`,
              '',
            ),
          ) + '\n',
        )
        await gracefulShutdown(0)
        return
      }
      if (!result.latestVersion) {
        process.stderr.write(formatCliError("Couldn't check for updates\n", ''))
        await gracefulShutdown(1)
        return
      }
      if (result.wasUpdated && result.latestVersion !== currentVersion) {
        writeToStdout(
          chalk.green(
            formatCliActionSuccess(
              `Successfully updated from ${currentVersion} to version ${result.latestVersion}`,
              '',
            ),
          ) + '\n',
        )
      } else if (
        'skippedUnverifiedRelease' in result &&
        result.skippedUnverifiedRelease
      ) {
        writeToStdout(
          chalk.yellow(
            formatCliWarning(
              `Update target ${result.latestVersion} (from @${channel} or a server-side override) predates release-signature enforcement; staying on ${currentVersion}. Run \`claude install ${result.latestVersion}\` to switch to it explicitly.`,
              '',
            ),
          ) + '\n',
        )
      } else {
        writeToStdout(
          chalk.green(
            formatCliSuccess(
              `Claude Code is up to date (${currentVersion})`,
              '',
            ),
          ) + '\n',
        )
      }
      await gracefulShutdown(0)
      return
    } catch (error) {
      process.stderr.write(
        formatCliError('Failed to install native update\n', 'Error: '),
      )
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      )
      process.stderr.write('Try running "claude doctor" for diagnostics\n')
      await gracefulShutdown(1)
      return
    }
  }

  // npm-local / npm-global / unknown (including fork npm/bun global installs)
  const packageName = getPackageName()
  logForDebugging('update: Checking npm registry for latest version')
  logForDebugging(`update: Package URL: ${packageName}`)

  const latestVersion = await getLatestVersion(npmChannel)
  logForDebugging(
    `update: Latest version from npm: ${latestVersion || 'FAILED'}`,
  )

  if (!latestVersion) {
    process.stderr.write(
      chalk.red(formatCliError("Couldn't check for updates", '')) + '\n',
    )
    process.stderr.write(
      "Couldn't get the latest version from the npm registry\n",
    )
    process.stderr.write('\n')
    process.stderr.write('Possible causes:\n')
    process.stderr.write('  • Network problems\n')
    process.stderr.write('  • npm registry is unreachable\n')
    process.stderr.write('  • Corporate proxy/firewall blocking npm\n')
    process.stderr.write('\n')
    process.stderr.write('Try:\n')
    process.stderr.write('  • Check your internet connection\n')
    process.stderr.write('  • Run with --debug for details\n')
    process.stderr.write(
      `  • Manually check: npm view ${packageName} version\n`,
    )
    process.stderr.write('  • Check if you need to log in: npm whoami\n')
    await gracefulShutdown(1)
    return
  }

  // Official 2.1.328 `Ldt()`: await async GrowthBook init before reading
  // `external_force_downgrade` so cold CLI `claude update` never reads stale false.
  const [maxVersion, forceDowngradeEnabled] = await Promise.all([
    getMaxVersion(),
    isForceDowngradeEnabledAsync(),
  ])

  const plan = resolveNpmUpdatePlan({
    currentVersion,
    latestVersion,
    maxVersion,
    forceDowngradeEnabled,
    shouldSkip: shouldSkipVersion,
  })

  if (plan.action === 'skip_policy') {
    const reason = formatVersionPolicySkipReason(plan.targetVersion)
    const prefix = plan.cappedByPolicy
      ? `The update target is capped at ${plan.targetVersion} by a server-side version policy`
      : `The ${displayChannel} channel is at ${plan.targetVersion}`
    writeToStdout(
      chalk.yellow(
        formatCliWarning(
          `${prefix}, which is ${reason}. Staying on ${currentVersion}.`,
          '',
        ),
      ) + '\n',
    )
    await gracefulShutdown(0)
    return
  }

  if (plan.action === 'up_to_date') {
    writeToStdout(
      chalk.green(
        formatCliSuccess(`Claude Code is up to date (${currentVersion})`, ''),
      ) + '\n',
    )
    await gracefulShutdown(0)
    return
  }

  if (plan.action === 'newer_than_channel') {
    writeToStdout(
      chalk.yellow(
        `You're running ${currentVersion}, which is newer than the ${displayChannel} channel's ${plan.targetVersion}. Skipping update. To switch back to the channel version, run claude install ${plan.targetVersion}.`,
      ) + '\n',
    )
    await gracefulShutdown(0)
    return
  }

  const isForcedDowngrade = plan.action === 'downgrade'
  if (isForcedDowngrade) {
    writeToStdout(
      chalk.yellow(
        `Downgrading to ${plan.targetVersion} (current: ${currentVersion}) — required by a server-side version policy.`,
      ) + '\n',
    )
  } else {
    writeToStdout(
      `New version available: ${plan.targetVersion} (current: ${currentVersion})\n`,
    )
  }
  writeToStdout('Installing update…\n')

  let useLocalUpdate = false
  let updateMethodLabel = ''
  switch (diagnostic.installationType) {
    case 'npm-local':
      useLocalUpdate = true
      updateMethodLabel = 'local'
      break
    case 'npm-global':
      useLocalUpdate = false
      updateMethodLabel = 'global'
      break
    case 'unknown': {
      const hasLocal = await localInstallationExists()
      useLocalUpdate = hasLocal
      updateMethodLabel = hasLocal ? 'local' : 'global'
      writeToStdout(
        chalk.yellow(
          formatCliWarning(
            "Couldn't tell how Claude Code was installed",
            'Warning: ',
          ),
        ) + '\n',
      )
      writeToStdout(
        `Trying ${updateMethodLabel} update based on installed files…\n`,
      )
      break
    }
    default:
      process.stderr.write(
        formatCliError(
          `Can't update ${diagnostic.installationType} installation\n`,
          'Error: ',
        ),
      )
      await gracefulShutdown(1)
      return
  }

  writeToStdout(`Updating the ${updateMethodLabel} installation…\n`)
  logForDebugging(`update: Update method determined: ${updateMethodLabel}`)
  logForDebugging(`update: useLocalUpdate: ${useLocalUpdate}`)

  const outcome: InstallOutcome = useLocalUpdate
    ? await installOrUpdateClaudePackage(npmChannel, plan.targetVersion)
    : await installGlobalViaBunOrNpm(plan.targetVersion)

  logForDebugging(`update: Installation status: ${outcome.status}`)

  if (outcome.status !== 'in_progress') {
    saveLastUpdateResult({
      timestamp: new Date().toISOString(),
      path: useLocalUpdate ? 'npm-local' : 'npm-global',
      outcome: outcome.status === 'success' ? 'success' : 'failed',
      status: outcome.status,
      version_from: currentVersion,
      version_to: plan.targetVersion,
      error_code: outcome.failureHint ?? null,
    })
  }

  switch (outcome.status) {
    case 'success':
      writeToStdout(
        chalk.green(
          formatCliActionSuccess(
            isForcedDowngrade
              ? `Successfully downgraded from ${currentVersion} to version ${plan.targetVersion}`
              : `Successfully updated from ${currentVersion} to version ${plan.targetVersion}`,
            '',
          ),
        ) + '\n',
      )
      await gracefulShutdown(0)
      return

    case 'no_permissions':
      process.stderr.write(
        formatCliError('No permission to install the update\n', 'Error: '),
      )
      if (useLocalUpdate) {
        process.stderr.write('Try manually updating with:\n')
        process.stderr.write(
          `  cd ~/.claude/local && npm update ${packageName}\n`,
        )
      } else {
        process.stderr.write('Try running with sudo or fix npm permissions\n')
        process.stderr.write(
          'Or switch to the native installation: claude install\n',
        )
      }
      await gracefulShutdown(1)
      return

    case 'in_progress':
      writeToStdout(
        chalk.yellow(
          formatCliWarning(
            'Another Claude process is installing an update. Try again in a moment.',
            '',
          ),
        ) + '\n',
      )
      await gracefulShutdown(0)
      return

    default:
      if (outcome.failureHint === 'windows_running_exe_lock') {
        process.stderr.write(
          formatCliError(
            "Couldn't update because claude.exe is in use. Close other Claude Code sessions (including VS Code), then run claude update again, or run claude doctor.\n",
            'Error: ',
          ),
        )
      } else {
        process.stderr.write(
          formatCliError("Couldn't install the update\n", 'Error: '),
        )
        process.stderr.write('Try manually updating with:\n')
        process.stderr.write(
          chalk.bold(`  npm install -g ${packageName}@${plan.targetVersion}`) +
            '\n',
        )
      }
      await gracefulShutdown(1)
      return
  }
}
