/**
 * Official 2.1.331 hidden `claude sandbox` (`install`, `status`, `uninstall`)
 * subcommands (`chunk-v92hkbj4.js`).
 */
import type { Command as CommanderCommand } from '@commander-js/extra-typings'
import { getPlatform } from '../../utils/platform.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../../utils/settings/settings.js'
import { jsonStringify } from '../../utils/slowOperations.js'

export type SandboxPostureSource = 'forced' | 'policy' | 'settings' | 'off'

export type SandboxInstallResult = {
  status: 'ok' | 'unavailable' | 'error'
  message: string
}

export type SandboxUninstallResult = {
  status:
    | 'ok'
    | 'not_installed'
    | 'partial'
    | 'in_use'
    | 'unavailable'
    | 'error'
  message: string
  leftBehind: string[]
  filtersChecked: boolean
}

export type SandboxStatusPayload = {
  statusVersion: 3
  available: boolean
  installed: boolean
  policyLocked: boolean
  reasons: string[]
  supported: boolean
  enabled: boolean
  enabledSource: SandboxPostureSource
  unavailableReason: string | null
  strictMode: boolean
  strictModeSource: SandboxPostureSource
  filesystemPolicy: Record<string, unknown>
  autoAllowBashIfSandboxed: boolean
  autoAllowBashIfSandboxedSource:
    | 'unsupported'
    | 'policy'
    | 'default'
    | 'settings'
}

function getWindowsSandboxUnavailableReason(): string | null {
  if (getPlatform() !== 'windows') {
    return 'Windows sandbox install is only available on native Windows.'
  }
  if (!SandboxManager.isPlatformInEnabledList()) {
    return 'Sandboxing is disabled for this platform by the enabledPlatforms policy setting.'
  }
  return 'The Windows sandbox is not enabled on this build.'
}

function resolvePostureSource(opts: {
  forced: boolean
  policy: boolean
  settings: boolean
}): SandboxPostureSource {
  if (opts.forced) return 'forced'
  if (opts.policy) return 'policy'
  return opts.settings ? 'settings' : 'off'
}

function isPolicySandboxKeySet(key: string): boolean {
  const policy = getSettingsForSource('policySettings')
  if (!policy?.sandbox || typeof policy.sandbox !== 'object') {
    return false
  }
  return (policy.sandbox as Record<string, unknown>)[key] !== undefined
}

export function getSandboxInstallResult(): SandboxInstallResult {
  const reason = getWindowsSandboxUnavailableReason()
  return {
    status: 'unavailable',
    message: reason ?? 'Windows sandbox install is not available.',
  }
}

export function getSandboxStatusPayload(): SandboxStatusPayload {
  const winUnavailable = getWindowsSandboxUnavailableReason()
  let installState: {
    available: boolean
    installed: boolean
    policyLocked: boolean
    reasons: string[]
  }
  if (winUnavailable) {
    installState = {
      available: false,
      installed: false,
      policyLocked: false,
      reasons: [winUnavailable],
    }
  } else {
    const deps = SandboxManager.checkDependencies()
    installState = {
      available: true,
      installed: deps.errors.length === 0,
      policyLocked: SandboxManager.areSandboxSettingsLockedByPolicy(),
      reasons: deps.errors,
    }
  }

  const settings = getInitialSettings()
  const strictMode = SandboxManager.isStrictSandboxModeConfigured()
  const policyLocked = SandboxManager.areSandboxSettingsLockedByPolicy()
  const enabledInSettings = SandboxManager.isSandboxEnabledInSettings()
  const autoAllowBash = SandboxManager.isAutoAllowBashIfSandboxedEnabled()
  const supported =
    SandboxManager.isSupportedPlatform() &&
    SandboxManager.isPlatformInEnabledList()

  return {
    statusVersion: 3,
    ...installState,
    supported,
    enabled: SandboxManager.isSandboxingEnabled(),
    enabledSource: resolvePostureSource({
      forced: false,
      policy: isPolicySandboxKeySet('enabled'),
      settings: enabledInSettings,
    }),
    unavailableReason: SandboxManager.getSandboxUnavailableReason() ?? null,
    strictMode,
    strictModeSource: resolvePostureSource({
      forced: policyLocked,
      policy: isPolicySandboxKeySet('allowUnsandboxedCommands'),
      settings: strictMode,
    }),
    filesystemPolicy: {},
    autoAllowBashIfSandboxed: autoAllowBash,
    autoAllowBashIfSandboxedSource: !supported
      ? 'unsupported'
      : isPolicySandboxKeySet('autoAllowBashIfSandboxed')
        ? 'policy'
        : settings.sandbox?.autoAllowBashIfSandboxed === undefined
          ? 'default'
          : 'settings',
  }
}

export function getSandboxUninstallResult(): SandboxUninstallResult {
  if (getPlatform() !== 'windows') {
    return {
      status: 'unavailable',
      message:
        'This command applies to native Windows only. On macOS, Linux and WSL the sandbox adds no account or network filters, so there is nothing to remove.',
      leftBehind: [],
      filtersChecked: false,
    }
  }
  return {
    status: 'not_installed',
    message: 'No Windows sandbox installation found on this PC.',
    leftBehind: [],
    filtersChecked: false,
  }
}

export async function sandboxInstallHandler(): Promise<void> {
  const result = getSandboxInstallResult()
  process.stdout.write(`${jsonStringify(result)}\n`)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(result.status === 'ok' ? 0 : 1)
}

export async function sandboxStatusHandler(): Promise<void> {
  const payload = getSandboxStatusPayload()
  process.stdout.write(`${jsonStringify(payload)}\n`)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(0)
}

export async function sandboxUninstallHandler(options: {
  json?: boolean
}): Promise<void> {
  const result = getSandboxUninstallResult()
  const output = options.json
    ? `${jsonStringify(result)}\n`
    : [
        result.message,
        ...(result.leftBehind.length > 0
          ? ['', 'Left behind:', ...result.leftBehind.map(item => `- ${item}`)]
          : []),
        '',
      ].join('\n')
  process.stdout.write(output)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(
    result.status === 'ok' || result.status === 'not_installed' ? 0 : 1,
  )
}

export function registerSandboxCommands(
  program: CommanderCommand,
): CommanderCommand {
  const sandboxCmd = program.command('sandbox', { hidden: true })

  sandboxCmd
    .command('install')
    .description(
      'Install the Windows sandbox user and network filters. Self-elevates (one UAC prompt). Prints a JSON {status, message} result and exits 0 only when status is "ok".',
    )
    .action(async () => {
      await sandboxInstallHandler()
    })

  sandboxCmd
    .command('status')
    .description(
      'Print the effective sandbox posture (enabled, its source, strict mode, filesystem policy, Bash auto-allow) and the Windows install state as one JSON line.',
    )
    .action(async () => {
      await sandboxStatusHandler()
    })

  sandboxCmd
    .command('uninstall')
    .description(
      'Remove the Windows sandbox account and network filters from this PC, then list what stays behind; Windows may ask for administrator approval',
    )
    .option(
      '--json',
      'Print one JSON line: {status, message, leftBehind, filtersChecked}',
    )
    .action(async (options: { json?: boolean }) => {
      await sandboxUninstallHandler(options)
    })

  return sandboxCmd
}
