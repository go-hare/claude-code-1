/**
 * Official 2.1.331 hidden `claude sandbox` (`install`, `status`, `uninstall`)
 * subcommands (`chunk-v92hkbj4.js`).
 */
import type { Command as CommanderCommand } from '@commander-js/extra-typings'
import { errorMessage } from '../../utils/errors.js'
import { getPlatform } from '../../utils/platform.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import {
  checkWindowsSandboxStatusAsync,
  ensureDefaultWindowsSandboxNativeProvider,
  getWindowsMxcLastStart,
  getWindowsMxcSetAside,
  getWindowsSandboxNativeProvider,
  hasWindowsMxcSdk,
  hasWindowsSandboxSupport,
  isWindowsBackendUnset,
  resolveWindowsBackendChoice,
  runWindowsSandboxInstallFlow,
  uninstallWindowsSandbox,
  WINDOWS_BACKEND_UNSET_MESSAGE,
  WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE,
  type WindowsMxcLastStart,
  type WindowsSandboxBackend,
  type WindowsSandboxNativeProvider,
  type WindowsSandboxStatus,
  windowsSandboxStartStore,
} from '../../utils/sandbox/windowsSandbox.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../../utils/settings/settings.js'
import { jsonStringify } from '../../utils/slowOperations.js'

export type SandboxPostureSource = 'forced' | 'policy' | 'settings' | 'off'

export type SandboxInstallResult = {
  status: 'ok' | 'partial' | 'cancelled' | 'unavailable' | 'error'
  message: string
  wfpVerified?: boolean
  caFingerprint?: string
}

export type SandboxUninstallResult = {
  status:
    | 'ok'
    | 'not_installed'
    | 'partial'
    | 'in_use'
    | 'cancelled'
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
  windowsBackend?: WindowsSandboxBackend
  windowsBackendUnset?: boolean
  mxcSetAside?: string
  mxcLastStart?: WindowsMxcLastStart
  windowsStatus?: WindowsSandboxStatus
}

export type RunSandboxInstallOptions = {
  provider?: WindowsSandboxNativeProvider
  onProgress?: (message: string) => void
  timeoutMs?: number
  caDir?: string
  willTlsTerminate?: boolean
  allowLoopback?: boolean
  sublayerGuid?: string
  proxyPortRange?: readonly [number, number]
  autoDiscoverProvider?: boolean
}

export type GetSandboxStatusAsyncOptions = {
  provider?: WindowsSandboxNativeProvider
  sublayerGuid?: string
  autoDiscoverProvider?: boolean
}

export type RunSandboxUninstallOptions = {
  provider?: WindowsSandboxNativeProvider
  sublayerGuid?: string
  timeoutMs?: number
  autoDiscoverProvider?: boolean
}

function getWindowsSandboxUnavailableReason(): string | null {
  if (getPlatform() !== 'windows') {
    return 'Windows sandbox install is only available on native Windows.'
  }
  if (!SandboxManager.isPlatformInEnabledList()) {
    return 'Sandboxing is disabled for this platform by the enabledPlatforms policy setting.'
  }
  if (hasWindowsSandboxSupport()) {
    return null
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

function buildFilesystemPolicy(): Record<string, unknown> {
  try {
    const readCfg = SandboxManager.getFsReadConfig()
    const writeCfg = SandboxManager.getFsWriteConfig()
    return {
      denyRead: readCfg.denyOnly ?? [],
      allowRead: readCfg.allowWithinDeny ?? [],
      allowWrite: writeCfg.allowOnly ?? [],
      denyWrite: writeCfg.denyWithinAllow ?? [],
    }
  } catch {
    return {}
  }
}

function resolveNativeProvider(opts?: {
  provider?: WindowsSandboxNativeProvider
  autoDiscoverProvider?: boolean
}): WindowsSandboxNativeProvider | undefined {
  if (opts?.provider !== undefined) {
    return opts.provider
  }
  const registered = getWindowsSandboxNativeProvider()
  if (registered !== undefined) {
    return registered
  }
  if (opts?.autoDiscoverProvider !== false) {
    return ensureDefaultWindowsSandboxNativeProvider()
  }
  return undefined
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

type WfpVerifyEvaluation = {
  verified: boolean
  reason?: string
}

function evaluateWfpVerifyResult(
  wfpVerify: NonNullable<
    Awaited<ReturnType<typeof runWindowsSandboxInstallFlow>>['wfpVerify']
  >,
): WfpVerifyEvaluation {
  if (wfpVerify.timedOut) {
    return {
      verified: false,
      reason: 'WFP egress verification timed out',
    }
  }
  if (wfpVerify.exitCode !== 0) {
    return {
      verified: false,
      reason: `WFP egress verification failed (exit code ${wfpVerify.exitCode ?? 'unknown'})`,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(wfpVerify.stdout)
  } catch {
    return {
      verified: false,
      reason:
        'WFP egress verification returned invalid JSON; rerun `claude sandbox install` as an administrator',
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      verified: false,
      reason:
        'WFP egress verification returned an unexpected payload; rerun `claude sandbox install` as an administrator',
    }
  }
  const obj = parsed as Record<string, unknown>
  if (obj.egress_probe !== 'blocked') {
    const probeLabel =
      typeof obj.egress_probe === 'string' ? `"${obj.egress_probe}"` : 'missing'
    return {
      verified: false,
      reason: `WFP egress probe reported ${probeLabel} instead of "blocked"; verify Windows Filtering Platform rules and rerun \`claude sandbox install\` as an administrator`,
    }
  }
  if (obj.write_restricted_token === false) {
    return {
      verified: false,
      reason:
        'WFP verification reported write_restricted_token=false; sandbox token restriction is not active',
    }
  }
  return { verified: true }
}

export async function runSandboxInstallAsync(
  opts?: RunSandboxInstallOptions,
): Promise<SandboxInstallResult> {
  if (getPlatform() !== 'windows') {
    return {
      status: 'unavailable',
      message: 'Windows sandbox install is only available on native Windows.',
    }
  }
  if (!SandboxManager.isPlatformInEnabledList()) {
    return {
      status: 'unavailable',
      message:
        'Sandboxing is disabled for this platform by the enabledPlatforms policy setting.',
    }
  }

  const provider = resolveNativeProvider(opts)
  const effectiveHasMxcSdk = provider?.hasMxcSdk ?? hasWindowsMxcSdk()
  const backendChoice = resolveWindowsBackendChoice({
    hasMxcSdk: effectiveHasMxcSdk,
  })
  const activeBackend =
    windowsSandboxStartStore.get().windowsBackendAtStart ??
    backendChoice.backend

  if (isWindowsBackendUnset({ hasMxcSdk: effectiveHasMxcSdk })) {
    return {
      status: 'unavailable',
      message: WINDOWS_BACKEND_UNSET_MESSAGE,
    }
  }
  if (activeBackend === 'mxc') {
    return {
      status: 'ok',
      message: WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE,
    }
  }

  if (!provider) {
    return {
      status: 'unavailable',
      message: 'The Windows sandbox is not enabled on this build.',
    }
  }

  try {
    const flow = await runWindowsSandboxInstallFlow(
      undefined,
      opts?.onProgress,
      opts?.timeoutMs,
      {
        provider,
        caDir: opts?.caDir,
        willTlsTerminate: opts?.willTlsTerminate,
        allowLoopback: opts?.allowLoopback,
        sublayerGuid: opts?.sublayerGuid,
        proxyPortRange: opts?.proxyPortRange,
      },
    )
    if (flow.cancelled) {
      return {
        status: 'cancelled',
        message:
          'Windows sandbox installation was cancelled at the administrator prompt.',
      }
    }
    const userReady =
      flow.status.user.provisioned && flow.status.user.credPresent
    const wfpReady = flow.status.wfp.state === 'installed'
    const wfpVerifyEval =
      flow.wfpVerify === undefined
        ? undefined
        : evaluateWfpVerifyResult(flow.wfpVerify)
    const wfpVerified = wfpVerifyEval?.verified

    if (userReady && wfpReady && wfpVerified !== false) {
      return {
        status: 'ok',
        message: 'Windows sandbox installed successfully.',
        ...(wfpVerified !== undefined ? { wfpVerified } : {}),
        ...(flow.ca ? { caFingerprint: flow.ca.fingerprint } : {}),
      }
    }

    const partialReasons: string[] = []
    if (!flow.status.user.provisioned) {
      partialReasons.push('sandbox user was not provisioned')
    } else if (!flow.status.user.credPresent) {
      partialReasons.push('sandbox user credentials are missing')
    }
    if (!wfpReady) {
      partialReasons.push(`WFP filters state is "${flow.status.wfp.state}"`)
    }
    if (wfpVerifyEval?.verified === false) {
      partialReasons.push(
        wfpVerifyEval.reason ?? 'WFP egress verification failed',
      )
    }
    return {
      status: 'partial',
      message: `Windows sandbox installation is incomplete: ${partialReasons.join('; ')}.`,
      ...(wfpVerified !== undefined ? { wfpVerified } : {}),
      ...(flow.ca ? { caFingerprint: flow.ca.fingerprint } : {}),
    }
  } catch (err) {
    return {
      status: 'error',
      message: errorMessage(err),
    }
  }
}

export async function getSandboxStatusPayloadAsync(
  opts?: GetSandboxStatusAsyncOptions,
): Promise<SandboxStatusPayload> {
  const platform = getPlatform()
  const settings = getInitialSettings()
  const strictMode = SandboxManager.isStrictSandboxModeConfigured()
  const policyLocked = SandboxManager.areSandboxSettingsLockedByPolicy()
  const enabledInSettings = SandboxManager.isSandboxEnabledInSettings()
  const autoAllowBash = SandboxManager.isAutoAllowBashIfSandboxedEnabled()
  const filesystemPolicy = buildFilesystemPolicy()

  let installState: {
    available: boolean
    installed: boolean
    policyLocked: boolean
    reasons: string[]
  }
  let resolvedProvider: WindowsSandboxNativeProvider | undefined
  let windowsBackend: WindowsSandboxBackend | undefined
  let windowsBackendUnset: boolean | undefined
  let mxcSetAside: string | undefined
  let mxcLastStart: WindowsMxcLastStart | undefined
  let windowsStatus: WindowsSandboxStatus | undefined

  if (platform !== 'windows') {
    installState = {
      available: false,
      installed: false,
      policyLocked: false,
      reasons: ['Windows sandbox install is only available on native Windows.'],
    }
  } else {
    resolvedProvider = resolveNativeProvider(opts)
    const effectiveHasMxcSdk = resolvedProvider?.hasMxcSdk ?? hasWindowsMxcSdk()
    const backendChoice = resolveWindowsBackendChoice({
      hasMxcSdk: effectiveHasMxcSdk,
    })
    windowsBackend =
      windowsSandboxStartStore.get().windowsBackendAtStart ??
      backendChoice.backend
    windowsBackendUnset = isWindowsBackendUnset({
      hasMxcSdk: effectiveHasMxcSdk,
    })
    mxcSetAside = getWindowsMxcSetAside({ hasMxcSdk: effectiveHasMxcSdk })
    mxcLastStart = getWindowsMxcLastStart({ hasMxcSdk: effectiveHasMxcSdk })

    if (!SandboxManager.isPlatformInEnabledList()) {
      installState = {
        available: false,
        installed: false,
        policyLocked,
        reasons: [
          'Sandboxing is disabled for this platform by the enabledPlatforms policy setting.',
        ],
      }
    } else if (windowsBackend === 'mxc' && !windowsBackendUnset) {
      const refusedReason =
        mxcLastStart?.state === 'refused' ? mxcLastStart.reason : undefined
      installState = {
        available: true,
        installed: refusedReason === undefined,
        policyLocked,
        reasons: refusedReason !== undefined ? [refusedReason] : [],
      }
    } else if (!resolvedProvider) {
      const reasons = ['The Windows sandbox is not enabled on this build.']
      if (windowsBackendUnset) {
        reasons.push(WINDOWS_BACKEND_UNSET_MESSAGE)
      }
      installState = {
        available: false,
        installed: false,
        policyLocked,
        reasons,
      }
    } else {
      try {
        windowsStatus = await checkWindowsSandboxStatusAsync({
          provider: resolvedProvider,
          sublayerGuid: opts?.sublayerGuid,
        })
        const reasons: string[] = []
        if (windowsBackendUnset) {
          reasons.push(WINDOWS_BACKEND_UNSET_MESSAGE)
        }
        if (!windowsStatus.user.provisioned) {
          reasons.push('Windows sandbox user is not provisioned.')
        } else if (!windowsStatus.user.credPresent) {
          reasons.push('Windows sandbox user credentials are missing.')
        }
        if (windowsStatus.wfp.state !== 'installed') {
          reasons.push(
            `Windows Filtering Platform (WFP) rules state is "${windowsStatus.wfp.state}".`,
          )
        }
        if (
          windowsStatus.user.seclogonState === 'disabled' ||
          windowsStatus.user.seclogonState === 'seclogon_disabled'
        ) {
          reasons.push(
            'Windows Secondary Logon service (seclogon) is disabled.',
          )
        }
        const installed =
          windowsStatus.user.provisioned &&
          windowsStatus.user.credPresent &&
          windowsStatus.wfp.state === 'installed'
        installState = {
          available: true,
          installed,
          policyLocked,
          reasons,
        }
      } catch (err) {
        installState = {
          available: true,
          installed: false,
          policyLocked,
          reasons: [errorMessage(err)],
        }
      }
    }
  }

  const platformInEnabledList = SandboxManager.isPlatformInEnabledList()
  const platformSupported =
    platform === 'windows'
      ? resolvedProvider !== undefined || SandboxManager.isSupportedPlatform()
      : SandboxManager.isSupportedPlatform()
  const supported = platformSupported && platformInEnabledList
  const unavailableReason =
    platform === 'windows' && resolvedProvider !== undefined
      ? !enabledInSettings
        ? null
        : !platformInEnabledList
          ? `sandbox.enabled is set but ${platform} is not in sandbox.enabledPlatforms`
          : windowsBackendUnset
            ? WINDOWS_BACKEND_UNSET_MESSAGE
            : null
      : (SandboxManager.getSandboxUnavailableReason() ?? null)

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
    unavailableReason,
    strictMode,
    strictModeSource: resolvePostureSource({
      forced: policyLocked,
      policy: isPolicySandboxKeySet('allowUnsandboxedCommands'),
      settings: strictMode,
    }),
    filesystemPolicy,
    autoAllowBashIfSandboxed: autoAllowBash,
    autoAllowBashIfSandboxedSource: !supported
      ? 'unsupported'
      : isPolicySandboxKeySet('autoAllowBashIfSandboxed')
        ? 'policy'
        : settings.sandbox?.autoAllowBashIfSandboxed === undefined
          ? 'default'
          : 'settings',
    ...(windowsBackend !== undefined ? { windowsBackend } : {}),
    ...(windowsBackendUnset !== undefined ? { windowsBackendUnset } : {}),
    ...(mxcSetAside !== undefined ? { mxcSetAside } : {}),
    ...(mxcLastStart !== undefined ? { mxcLastStart } : {}),
    ...(windowsStatus !== undefined ? { windowsStatus } : {}),
  }
}

export async function runSandboxUninstallAsync(
  opts?: RunSandboxUninstallOptions,
): Promise<SandboxUninstallResult> {
  if (getPlatform() !== 'windows') {
    return {
      status: 'unavailable',
      message:
        'This command applies to native Windows only. On macOS, Linux and WSL the sandbox adds no account or network filters, so there is nothing to remove.',
      leftBehind: [],
      filtersChecked: false,
    }
  }

  const provider = resolveNativeProvider(opts)
  if (!provider) {
    return {
      status: 'unavailable',
      message: 'The Windows sandbox is not enabled on this build.',
      leftBehind: [],
      filtersChecked: false,
    }
  }

  try {
    const before = await checkWindowsSandboxStatusAsync({
      provider,
      sublayerGuid: opts?.sublayerGuid,
    })
    const userPresent = before.user.provisioned || before.user.credPresent
    const wfpPresent =
      before.wfp.state === 'installed' || before.wfp.state === 'partial'
    const filtersChecked = before.wfp.state !== 'cannot-read'

    if (!userPresent && !wfpPresent) {
      return {
        status: 'not_installed',
        message: 'No Windows sandbox installation found on this PC.',
        leftBehind: [],
        filtersChecked,
      }
    }

    const result = await uninstallWindowsSandbox({
      provider,
      sublayerGuid: opts?.sublayerGuid,
      timeoutMs: opts?.timeoutMs,
    })
    if (result.cancelled) {
      return {
        status: 'cancelled',
        message:
          'Windows sandbox uninstall was cancelled at the administrator prompt.',
        leftBehind: [],
        filtersChecked,
      }
    }

    const after = await checkWindowsSandboxStatusAsync({
      provider,
      sublayerGuid: opts?.sublayerGuid,
    })
    const leftBehind: string[] = []
    if (after.user.provisioned) {
      leftBehind.push(
        `Windows sandbox account (${after.user.sandboxUser ?? 'sandbox user'})`,
      )
    }
    if (after.user.credPresent) {
      leftBehind.push('Windows sandbox stored credentials')
    }
    if (after.wfp.state === 'installed' || after.wfp.state === 'partial') {
      leftBehind.push('Windows Filtering Platform (WFP) network filters')
    }
    const afterFiltersChecked = after.wfp.state !== 'cannot-read'
    if (leftBehind.length > 0) {
      return {
        status: 'partial',
        message:
          'Windows sandbox uninstall completed partially; some artifacts remain.',
        leftBehind,
        filtersChecked: afterFiltersChecked,
      }
    }
    return {
      status: 'ok',
      message: 'Windows sandbox account and network filters have been removed.',
      leftBehind: [],
      filtersChecked: afterFiltersChecked,
    }
  } catch (err) {
    return {
      status: 'error',
      message: errorMessage(err),
      leftBehind: [],
      filtersChecked: false,
    }
  }
}

export async function sandboxInstallHandler(): Promise<void> {
  const result = await runSandboxInstallAsync()
  process.stdout.write(`${jsonStringify(result)}\n`)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(result.status === 'ok' ? 0 : 1)
}

export async function sandboxStatusHandler(): Promise<void> {
  const payload = await getSandboxStatusPayloadAsync()
  process.stdout.write(`${jsonStringify(payload)}\n`)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(0)
}

export async function sandboxUninstallHandler(options: {
  json?: boolean
}): Promise<void> {
  const result = await runSandboxUninstallAsync()
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
