/**
 * Official 2.1.331 Windows Sandbox (`sandboxuser` & `mxc`) Control Plane
 * (Chunks #507, #1866, #2214, #2215)
 *
 * Self-contained, per-`SessionHost` (`HostSlot`) Windows sandbox state,
 * backend resolution, MXC BaseContainer probe validation, pluggable native
 * provider registry (supporting both `packages/win-sandbox-native` and
 * `Bun.ant` or test providers), and pure `node:crypto` persistent X.509 v3 CA
 * generation.
 */

import { execFileSync } from 'node:child_process'
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
} from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  createSrtWinNativeProvider,
  resolveSrtWinBinaryPath,
  SrtWinExecutionError,
  type WindowsSandboxNativeProvider as SrtWinNativeProvider,
  type WindowsSandboxRunOptions as SrtWinRunOptions,
  type WindowsSandboxStatus as SrtWinStatus,
} from '../../../packages/win-sandbox-native/src/index.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { getPlatform, type Platform } from '../platform.js'
import {
  getBootstrapSessionHost,
  hasActiveSessionAls,
  HostSlot,
  type SessionHost,
} from '../sessionHost.js'
import { isSettingSourceEnabled } from '../settings/constants.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'

// ============================================================================
// Official 2.1.331 Constants & Messages
// ============================================================================

export const WINDOWS_SANDBOX_DEFAULT_PROXY_PORT_RANGE = [60080, 60089] as const

export const WINDOWS_BACKEND_UNSET_MESSAGE =
  'sandbox.windows.backend is not set. Whoever manages the sandbox settings can set it to "mxc" (no set-up, PowerShell only, needs Windows 11 24H2 or later with the November 2026 update) or to "sandboxuser" (the sandbox account, set up with claude sandbox install)'

export const WINDOWS_MXC_NOTHING_TO_INSTALL_MESSAGE =
  'Nothing to install: the sandbox uses the MXC backend, which needs no set-up. To use the sandbox account instead, set sandbox.windows.backend to "sandboxuser", start Claude Code again, and run this again.'

export const WINDOWS_MXC_BASH_REFUSAL_MESSAGE =
  'The sandbox\'s MXC backend (sandbox.windows.backend) runs PowerShell commands only, so Bash commands are refused in this session; use the PowerShell tool, and if it is not available, tell the user. Whoever manages the sandbox settings can set sandbox.windows.backend to "sandboxuser" and run claude sandbox install to use the sandbox account backend, which runs Bash commands (with Git for Windows installed), at the next start of Claude Code. Changing sandbox settings is for the user or their administrator to decide, not you.'

/**
 * Windows CreateProcessW maximum command-line content length in UTF-16 code
 * units (32,766 chars + 1 terminating NUL = 32,767-wchar CreateProcessW limit).
 */
export const WINDOWS_ARGV_MAX_LENGTH = 32_766
const WINDOWS_CREATE_PROCESS_MAX_WCHARS = 32_767

const MAX_WINDOWS_CA_CERT_BYTES = 65_536
const DEFAULT_CA_REGENERATE_WITHIN_DAYS = 30
const DEFAULT_CA_VALIDITY_DAYS = 365
const MS_PER_DAY = 86_400_000

// ============================================================================
// Types
// ============================================================================

export type WindowsSandboxBackend = 'sandboxuser' | 'mxc'

export type WindowsSandboxUserStatus = {
  provisioned: boolean
  credPresent: boolean
  realUserSid?: string
  sandboxUser?: string
  seclogonState?:
    | 'running'
    | 'stopped'
    | 'disabled'
    | 'seclogon_disabled'
    | 'unknown'
  profileReadGranted?: boolean
  warnings?: string[]
}

export type WindowsSandboxWfpStatus = {
  state: 'installed' | 'absent' | 'cannot-read' | 'partial'
  allowLoopback?: boolean
  sublayerGuid?: string
  proxyPortRange?: readonly [number, number]
}

export type WindowsSandboxStatus = {
  user: WindowsSandboxUserStatus
  wfp: WindowsSandboxWfpStatus
}

export type WindowsMxcProbeResult = {
  tier?: string
  needsDaclAugmentation?: boolean
  error?: string
  probes?: {
    baseContainerSupportsDenyPaths?: boolean
    baseContainerSupportsIdentitylessLoopbackProxy?: boolean
    baseContainerSupportsIngressHostLoopbackAllow?: boolean
    uiCapabilities?: {
      canBlockClipboardRead?: boolean
      canBlockClipboardWrite?: boolean
      canBlockInputInjection?: boolean
    }
  }
}

export type WindowsInstallOptions = {
  allowLoopback?: boolean
  sublayerGuid?: string
  proxyPortRange?: readonly [number, number]
  timeoutMs?: number
  provider?: WindowsSandboxNativeProvider
  onProgress?: (message: string) => void
}

export type WindowsUninstallOptions = {
  sublayerGuid?: string
  timeoutMs?: number
  provider?: WindowsSandboxNativeProvider
}

export type WindowsSandboxNativeProvider = {
  kind: 'srt-win' | 'bun-ant' | 'custom'
  hasMxcSdk?: boolean
  checkStatus(opts?: { sublayerGuid?: string }): Promise<WindowsSandboxStatus>
  install(opts?: WindowsInstallOptions): Promise<{
    status: number
    stdout: string
    stderr: string
    cancelled?: boolean
  }>
  uninstall(opts?: WindowsUninstallOptions): Promise<{
    status: number
    stdout: string
    stderr: string
    cancelled?: boolean
  }>
  verifyWfp?(opts?: {
    target?: string
    allowLoopback?: boolean
    writeRestrictedToken?: boolean
    timeoutMs?: number
  }): Promise<{
    exitCode?: number
    timedOut?: boolean
    stdout: string
    stderr: string
  }>
  forgetProfileRead?(opts?: {
    sid?: string
    timeoutMs?: number
  }): Promise<{ cleared: number; deferred?: string[] }>
  applyDenies?(req: {
    denyRead: string[]
    denyWrite: string[]
    allowWrite: string[]
    sid?: string
    deadlineMs?: number
  }): Promise<{
    inPlace: number
    planted: number
    laid: number
    pushedDown: number
    guarded: number
    extrasSkipped: number
    ms: number
    stands: number[]
    handedBack: Array<{ id: number; why: string }>
  }>
  probeMxc?(): Promise<WindowsMxcProbeResult>
  spawnSandboxed?(
    command: string,
    opts?: Record<string, unknown>,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

export type WindowsBackendChoice = {
  backend: WindowsSandboxBackend
  unset?: true
  setAside?: string
}

export type WindowsSandboxStartState = {
  windowsBackendAtStart?: WindowsSandboxBackend
  bashRefusedByMxcAtStart?: boolean
  mxcSetAsideLogged?: string
  initFailureReason?: string
  startedOnce: boolean
  installedCaFingerprint?: string
  tlsTerminateAtStart?: boolean
  localConnectionsAtStart?: boolean
  selfExecGrantAttempt?: number
  profileReadWarnings: string[]
  mxcLocalConnectionsWarned?: boolean
}

export type WindowsMxcLastStart =
  | { state: 'refused'; reason: string }
  | { state: 'started' }
  | { state: 'none' }

export type WindowsTlsTerminateCaSource =
  | { source: 'unavailable' }
  | { source: 'trustedPair'; caCertPath?: string; caKeyPath?: string }
  | { source: 'managed'; certPath: string; keyPath: string }

export type EnsurePersistentWindowsCaOptions = {
  dir?: string
  status?: WindowsSandboxStatus
  provider?: WindowsSandboxNativeProvider
  regenerateWithinDays?: number
  validityDays?: number
  nowMs?: number
}

export type EnsurePersistentWindowsCaResult = {
  certPath: string
  keyPath: string
  fingerprint: string
  regenerated: boolean
}

export type WindowsSandboxInstallFlowOptions = {
  provider?: WindowsSandboxNativeProvider
  caDir?: string
  willTlsTerminate?: boolean
  allowLoopback?: boolean
  sublayerGuid?: string
  proxyPortRange?: readonly [number, number]
}

export type WindowsSandboxInstallFlowResult = {
  status: WindowsSandboxStatus & { cancelled?: boolean }
  cancelled: boolean
  wfpVerify?: {
    exitCode?: number
    timedOut?: boolean
    stdout: string
    stderr: string
  }
  ca?: EnsurePersistentWindowsCaResult
}

// ============================================================================
// Error Class (Export #1)
// ============================================================================

export class WindowsSandboxError extends Error {
  readonly code: string
  readonly subcommand?: string

  constructor(code: string, message: string, subcommand?: string) {
    super(message)
    this.name = 'WindowsSandboxError'
    this.code = code
    this.subcommand = subcommand
  }
}

// ============================================================================
// Pluggable Native Provider Registry (Per-SessionHost + Process Default)
// ============================================================================

type BunAntNamespace = {
  mxc?: unknown
  sandbox?: unknown
}

function getBunAnt(): BunAntNamespace | undefined {
  const g = globalThis as { Bun?: { ant?: BunAntNamespace } }
  return g.Bun?.ant
}

type ProviderHostEntry = {
  provider: WindowsSandboxNativeProvider | undefined
  hasOverride: boolean
  autoDiscoveryAttempted: boolean
}

const providerSlotByHost = new HostSlot<ProviderHostEntry>(() => ({
  provider: undefined,
  hasOverride: false,
  autoDiscoveryAttempted: false,
}))

let processDefaultNativeProvider: WindowsSandboxNativeProvider | undefined

/**
 * Register a Windows sandbox native provider (e.g. `packages/win-sandbox-native`,
 * `Bun.ant`, or a mock provider in tests).
 *
 * Inside an active ALS session (`runWithSession` / `runWithNewHostSession`),
 * registration is scoped strictly to that `SessionHost`. Pass `null` to
 * explicitly disable auto-discovery for the current host, or `undefined` to
 * clear the override. Outside ALS (process bootstrap), it sets the process-wide
 * default fallback.
 */
export function registerWindowsSandboxNativeProvider(
  provider: WindowsSandboxNativeProvider | null | undefined,
): void {
  const host = getBootstrapSessionHost()
  if (hasActiveSessionAls()) {
    const entry = providerSlotByHost.of(host)
    if (provider === undefined) {
      entry.provider = undefined
      entry.hasOverride = false
      entry.autoDiscoveryAttempted = false
    } else if (provider === null) {
      entry.provider = undefined
      entry.hasOverride = true
      entry.autoDiscoveryAttempted = true
    } else {
      entry.provider = provider
      entry.hasOverride = true
      entry.autoDiscoveryAttempted = true
    }
    return
  }
  processDefaultNativeProvider = provider ?? undefined
  const entry = providerSlotByHost.peek(host)
  if (entry !== undefined) {
    entry.provider = undefined
    entry.hasOverride = false
    entry.autoDiscoveryAttempted = false
  }
}

/**
 * Resolve the active Windows sandbox native provider for the current (or given)
 * `SessionHost`, falling back to the process-wide default provider.
 */
export function getWindowsSandboxNativeProvider(
  host?: object,
): WindowsSandboxNativeProvider | undefined {
  const targetHost = host ?? getBootstrapSessionHost()
  const entry = providerSlotByHost.peek(targetHost)
  if (entry?.hasOverride) {
    return entry.provider
  }
  return processDefaultNativeProvider
}

function mapSrtWinWfpState(
  state: SrtWinStatus['wfp']['state'],
): WindowsSandboxWfpStatus['state'] {
  switch (state) {
    case 'installed':
      return 'installed'
    case 'absent':
      return 'absent'
    case 'degraded':
      return 'partial'
    case 'unsupported':
      return 'cannot-read'
  }
}

function mapSrtWinStatus(status: SrtWinStatus): WindowsSandboxStatus {
  return {
    user: {
      provisioned: status.user.provisioned,
      credPresent: status.user.credPresent,
      realUserSid: status.user.realUserSid ?? undefined,
      sandboxUser: status.user.sandboxUser ?? undefined,
      seclogonState: status.user.seclogonState,
    },
    wfp: {
      state: mapSrtWinWfpState(status.wfp.state),
      allowLoopback: status.wfp.allowLoopback,
      sublayerGuid: status.wfp.sublayerGuid ?? undefined,
      proxyPortRange: status.wfp.proxyPortRange ?? undefined,
    },
  }
}

function extractStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      out[k] = v
    }
  }
  return out
}

function toSrtWinRunOptions(
  command: string,
  opts?: Record<string, unknown>,
): SrtWinRunOptions {
  const runOpts: SrtWinRunOptions = { command }
  if (!opts) {
    return runOpts
  }
  if (Array.isArray(opts.args)) {
    runOpts.args = opts.args.filter((a): a is string => typeof a === 'string')
  }
  if (typeof opts.cwd === 'string') {
    runOpts.cwd = opts.cwd
  }
  const env = extractStringRecord(opts.env)
  if (env !== undefined) {
    runOpts.env = env
  }
  if (typeof opts.proxyPort === 'number') {
    runOpts.proxyPort = opts.proxyPort
  }
  if (typeof opts.httpProxyUrl === 'string') {
    runOpts.httpProxyUrl = opts.httpProxyUrl
  }
  if (typeof opts.httpsProxyUrl === 'string') {
    runOpts.httpsProxyUrl = opts.httpsProxyUrl
  }
  if (typeof opts.allowLoopback === 'boolean') {
    runOpts.allowLoopback = opts.allowLoopback
  }
  if (typeof opts.blockClipboardRead === 'boolean') {
    runOpts.blockClipboardRead = opts.blockClipboardRead
  }
  if (typeof opts.blockClipboardWrite === 'boolean') {
    runOpts.blockClipboardWrite = opts.blockClipboardWrite
  }
  if (typeof opts.blockInputInjection === 'boolean') {
    runOpts.blockInputInjection = opts.blockInputInjection
  }
  if (typeof opts.timeoutMs === 'number') {
    runOpts.timeoutMs = opts.timeoutMs
  }
  if (typeof opts.stdin === 'string') {
    runOpts.stdin = opts.stdin
  }
  return runOpts
}

/**
 * Adapts a `packages/win-sandbox-native` provider into the control plane's
 * `WindowsSandboxNativeProvider` contract consumed by `SandboxManager` and
 * the `claude sandbox` CLI.
 */
export function adaptSrtWinNativeProvider(
  srtProvider: SrtWinNativeProvider,
  opts?: { hasMxcSdk?: boolean },
): WindowsSandboxNativeProvider {
  return {
    kind: 'srt-win',
    hasMxcSdk: opts?.hasMxcSdk ?? false,

    async checkStatus(): Promise<WindowsSandboxStatus> {
      const status = await srtProvider.checkStatus()
      return mapSrtWinStatus(status)
    },

    async install(installOpts?: WindowsInstallOptions) {
      try {
        const status = await srtProvider.install({
          allowLoopback: installOpts?.allowLoopback,
          sublayerGuid: installOpts?.sublayerGuid,
          proxyPortRange: installOpts?.proxyPortRange
            ? [installOpts.proxyPortRange[0], installOpts.proxyPortRange[1]]
            : undefined,
          timeoutMs: installOpts?.timeoutMs,
        })
        return {
          status: 0,
          stdout: JSON.stringify(status),
          stderr: '',
        }
      } catch (err) {
        if (err instanceof SrtWinExecutionError) {
          return {
            status: err.exitCode ?? 1,
            stdout: err.stdout,
            stderr: err.stderr || err.message,
            ...(err.isUacCancelled ? { cancelled: true } : {}),
          }
        }
        throw err
      }
    },

    async uninstall(uninstallOpts?: WindowsUninstallOptions) {
      try {
        const status = await srtProvider.uninstall({
          sublayerGuid: uninstallOpts?.sublayerGuid,
          timeoutMs: uninstallOpts?.timeoutMs,
        })
        return {
          status: 0,
          stdout: JSON.stringify(status),
          stderr: '',
        }
      } catch (err) {
        if (err instanceof SrtWinExecutionError) {
          return {
            status: err.exitCode ?? 1,
            stdout: err.stdout,
            stderr: err.stderr || err.message,
            ...(err.isUacCancelled ? { cancelled: true } : {}),
          }
        }
        throw err
      }
    },

    async verifyWfp(verifyOpts) {
      try {
        const result = await srtProvider.verifyWfp({
          target: verifyOpts?.target,
          timeoutMs: verifyOpts?.timeoutMs,
        })
        return {
          exitCode: 0,
          timedOut: false,
          stdout: JSON.stringify(result),
          stderr: '',
        }
      } catch (err) {
        if (err instanceof SrtWinExecutionError) {
          return {
            exitCode: err.exitCode ?? 1,
            timedOut: err.timedOut,
            stdout: err.stdout,
            stderr: err.stderr || err.message,
          }
        }
        throw err
      }
    },

    async forgetProfileRead(forgetOpts) {
      const requestedSid = forgetOpts?.sid?.trim()
      if (requestedSid) {
        const status = await srtProvider.checkStatus()
        const realUserSid = status.user.realUserSid?.trim()
        if (
          realUserSid &&
          requestedSid.toUpperCase() === realUserSid.toUpperCase()
        ) {
          throw new WindowsSandboxError(
            'invalid_sid',
            'Refusing to forget profile read for the current user SID',
            'profile',
          )
        }
      }
      // Never pass realUserSid; pass sandbox account context cleanly or let
      // srt-win resolve the provisioned sandbox account SID.
      const resolvedForgetOpts: { sid?: string; timeoutMs?: number } = {}
      if (requestedSid) {
        resolvedForgetOpts.sid = requestedSid
      }
      if (forgetOpts?.timeoutMs !== undefined) {
        resolvedForgetOpts.timeoutMs = forgetOpts.timeoutMs
      }
      const result = await srtProvider.forgetProfileRead(
        Object.keys(resolvedForgetOpts).length > 0
          ? resolvedForgetOpts
          : undefined,
      )
      return {
        cleared: result.cleared ? 1 : 0,
        ...(result.deferred ? { deferred: ['profile_read'] } : {}),
      }
    },

    async applyDenies(req) {
      const status = await srtProvider.checkStatus()
      const realUserSid = status.user.realUserSid?.trim()
      const requestedSid = req.sid?.trim()
      if (
        requestedSid &&
        realUserSid &&
        requestedSid.toUpperCase() === realUserSid.toUpperCase()
      ) {
        throw new WindowsSandboxError(
          'invalid_sid',
          'Refusing to apply sandbox denies to the current user SID',
          'denies',
        )
      }
      // When req.sid is omitted, only use an explicit sandboxUserSid if
      // checkStatus() provides one (and never realUserSid); otherwise omit
      // sid so srt-win resolves the sandbox account SID itself.
      const statusUserRecord = status.user as unknown as Record<string, unknown>
      const statusSandboxSid =
        typeof statusUserRecord.sandboxUserSid === 'string' &&
        statusUserRecord.sandboxUserSid.trim().length > 0
          ? statusUserRecord.sandboxUserSid.trim()
          : undefined
      const resolvedSid =
        requestedSid ||
        (statusSandboxSid &&
        (!realUserSid ||
          statusSandboxSid.toUpperCase() !== realUserSid.toUpperCase())
          ? statusSandboxSid
          : undefined)
      const result = await srtProvider.applyDenies({
        denyRead: req.denyRead,
        denyWrite: req.denyWrite,
        allowWrite: req.allowWrite,
        ...(resolvedSid !== undefined ? { sid: resolvedSid } : {}),
        deadlineMs: req.deadlineMs,
      })
      return {
        inPlace: result.inPlace,
        planted: result.planted,
        laid: result.laid,
        pushedDown: result.pushedDown,
        guarded: result.guarded,
        extrasSkipped: result.extrasSkipped,
        ms: result.ms,
        stands: Array.from({ length: result.stands }, (_, idx) => idx),
        handedBack: Array.from({ length: result.handedBack }, (_, idx) => ({
          id: idx,
          why: 'handed_back',
        })),
      }
    },

    async probeMxc(): Promise<WindowsMxcProbeResult> {
      return srtProvider.probeMxc()
    },

    async spawnSandboxed(command: string, runOpts?: Record<string, unknown>) {
      const result = await srtProvider.spawnSandboxed(
        toSrtWinRunOptions(command, runOpts),
      )
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    },
  }
}

/**
 * Discovers a compiled `srt-win` / `srt-win.exe` binary and constructs an
 * adapted `WindowsSandboxNativeProvider` without mutating global registration.
 */
export function createDefaultWindowsSandboxNativeProvider(opts?: {
  env?: NodeJS.ProcessEnv
  cwd?: string
  hasMxcSdk?: boolean
}): WindowsSandboxNativeProvider | undefined {
  const exe = resolveSrtWinBinaryPath({
    env: opts?.env,
    cwd: opts?.cwd,
  })
  if (!exe) {
    return undefined
  }
  const srtProvider = createSrtWinNativeProvider({
    srtWin: { exe, prependArgs: [] },
    env: opts?.env,
  })
  return adaptSrtWinNativeProvider(srtProvider, {
    hasMxcSdk: opts?.hasMxcSdk,
  })
}

/**
 * Returns the currently registered `WindowsSandboxNativeProvider`, or
 * auto-discovers and registers the compiled `srt-win(.exe)` binary if present.
 */
export function ensureDefaultWindowsSandboxNativeProvider(opts?: {
  env?: NodeJS.ProcessEnv
  cwd?: string
  hasMxcSdk?: boolean
}): WindowsSandboxNativeProvider | undefined {
  const host = getBootstrapSessionHost()
  const entry = providerSlotByHost.peek(host)
  if (entry?.hasOverride) {
    return entry.provider
  }
  const existing = getWindowsSandboxNativeProvider()
  if (existing !== undefined) {
    return existing
  }
  if (opts === undefined && entry?.autoDiscoveryAttempted) {
    return undefined
  }
  const discovered = createDefaultWindowsSandboxNativeProvider(opts)
  if (discovered !== undefined) {
    registerWindowsSandboxNativeProvider(discovered)
  } else if (opts === undefined && hasActiveSessionAls()) {
    providerSlotByHost.of(host).autoDiscoveryAttempted = true
  }
  return discovered
}

// ============================================================================
// Per-SessionHost Start Store (Export #2)
// ============================================================================

function createInitialStartState(): WindowsSandboxStartState {
  return {
    windowsBackendAtStart: undefined,
    bashRefusedByMxcAtStart: undefined,
    mxcSetAsideLogged: undefined,
    initFailureReason: undefined,
    startedOnce: false,
    installedCaFingerprint: undefined,
    tlsTerminateAtStart: undefined,
    localConnectionsAtStart: undefined,
    selfExecGrantAttempt: undefined,
    profileReadWarnings: [],
    mxcLocalConnectionsWarned: undefined,
  }
}

const startStateSlotByHost = new HostSlot<WindowsSandboxStartState>(
  createInitialStartState,
)

export const windowsSandboxStartStore = {
  get(host?: object): WindowsSandboxStartState {
    return startStateSlotByHost.of(host ?? getBootstrapSessionHost())
  },

  peek(host?: object): WindowsSandboxStartState | undefined {
    return startStateSlotByHost.peek(host ?? getBootstrapSessionHost())
  },

  reset(host?: object): void {
    const target = host ?? getBootstrapSessionHost()
    startStateSlotByHost.drop(target)
  },

  markStarted(
    backend: WindowsSandboxBackend,
    opts?: {
      tlsTerminate?: boolean
      localConnections?: boolean
      installedCaFingerprint?: string
      host?: object
    },
  ): void {
    const state = startStateSlotByHost.of(
      opts?.host ?? getBootstrapSessionHost(),
    )
    state.windowsBackendAtStart = backend
    state.startedOnce = true
    state.initFailureReason = undefined
    if (opts?.tlsTerminate !== undefined) {
      state.tlsTerminateAtStart = opts.tlsTerminate
    }
    if (opts?.localConnections !== undefined) {
      state.localConnectionsAtStart = opts.localConnections
    }
    if (opts?.installedCaFingerprint !== undefined) {
      state.installedCaFingerprint = opts.installedCaFingerprint
    }
  },

  markInitFailed(reason: string, host?: object): void {
    const state = startStateSlotByHost.of(host ?? getBootstrapSessionHost())
    state.initFailureReason = reason
  },
}

// ============================================================================
// Trusted Settings Helpers (policySettings > flagSettings > userSettings)
// ============================================================================

function isWindowsPlatform(platform?: Platform | string): boolean {
  const effective = platform ?? getPlatform()
  return effective === 'windows' || effective === 'win32'
}

function trustedWindowsSandboxSources(): Array<
  SettingsJson | null | undefined
> {
  return [
    getSettingsForSource('policySettings'),
    getSettingsForSource('flagSettings'),
    isSettingSourceEnabled('userSettings')
      ? getSettingsForSource('userSettings')
      : null,
  ]
}

function readTrustedWindowsBackendSetting(): WindowsSandboxBackend | undefined {
  for (const src of trustedWindowsSandboxSources()) {
    const backend = src?.sandbox?.windows?.backend
    if (backend === 'sandboxuser' || backend === 'mxc') {
      return backend
    }
  }
  return undefined
}

function readTrustedTlsTerminateSetting():
  | NonNullable<NonNullable<SettingsJson['sandbox']>['network']>['tlsTerminate']
  | undefined {
  for (const src of trustedWindowsSandboxSources()) {
    const tlsTerminate = src?.sandbox?.network?.tlsTerminate
    if (tlsTerminate !== undefined) {
      return tlsTerminate
    }
  }
  return undefined
}

// ============================================================================
// Backend Resolution & MXC Probe (Official tT & _W)
// ============================================================================

export function hasWindowsMxcSdk(
  platformOverride?: Platform | string,
): boolean {
  if (!isWindowsPlatform(platformOverride)) {
    return false
  }
  return (
    getBunAnt()?.mxc !== undefined ||
    getWindowsSandboxNativeProvider()?.hasMxcSdk === true
  )
}

export function hasWindowsSandboxSupport(
  platformOverride?: Platform | string,
): boolean {
  if (!isWindowsPlatform(platformOverride)) {
    return false
  }
  const ant = getBunAnt()
  if (
    getWindowsSandboxNativeProvider() !== undefined ||
    ant?.mxc !== undefined ||
    ant?.sandbox !== undefined
  ) {
    return true
  }
  if (platformOverride === undefined) {
    return ensureDefaultWindowsSandboxNativeProvider() !== undefined
  }
  return false
}

/**
 * Official 2.1.331 `tT()`:
 * Reads `sandbox.windows.backend` from `policySettings`, then `--settings`
 * (`flagSettings`), then enabled `userSettings`. Explicitly ignores
 * `projectSettings` and `localSettings`.
 */
export function resolveWindowsBackendChoice(opts?: {
  platform?: Platform | string
  hasMxcSdk?: boolean
}): WindowsBackendChoice {
  if (!isWindowsPlatform(opts?.platform)) {
    return { backend: 'sandboxuser' }
  }
  const configured = readTrustedWindowsBackendSetting()
  const mxcSdk = opts?.hasMxcSdk ?? hasWindowsMxcSdk(opts?.platform)
  if (configured === undefined) {
    return mxcSdk
      ? { backend: 'mxc', unset: true }
      : { backend: 'sandboxuser', unset: true }
  }
  if (configured === 'mxc' && !mxcSdk) {
    return {
      backend: 'sandboxuser',
      setAside: 'this build of Claude Code does not include the MXC SDK',
    }
  }
  return { backend: configured }
}

/**
 * Official 2.1.331 `_W()`:
 * Validates an MXC BaseContainer probe result against the session's required
 * isolation guarantees. Returns an empty array when all checks pass.
 */
export function validateMxcBaseContainerProbe(
  config: { hasDeniedPaths: boolean; hasNetworkProxy: boolean },
  probe: WindowsMxcProbeResult,
): string[] {
  if (probe.error !== undefined) {
    return [`the probe failed: ${probe.error}`]
  }
  const failures: string[] = []
  if (probe.tier !== 'base-container') {
    failures.push(
      `this host offers MXC tier '${probe.tier ?? 'none'}'; BaseContainer is required`,
    )
  }
  if (probe.needsDaclAugmentation === true) {
    failures.push('the tier needs host ACL changes (DACL augmentation)')
  }
  if (config.hasDeniedPaths && !probe.probes?.baseContainerSupportsDenyPaths) {
    failures.push('BaseContainer cannot enforce denied paths on this host')
  }
  if (
    config.hasNetworkProxy &&
    !probe.probes?.baseContainerSupportsIdentitylessLoopbackProxy
  ) {
    failures.push('BaseContainer cannot confine egress to the host proxy')
  }
  if (
    config.hasNetworkProxy &&
    !probe.probes?.baseContainerSupportsIngressHostLoopbackAllow
  ) {
    failures.push('BaseContainer cannot allow host loopback for the proxy')
  }
  const ui = probe.probes?.uiCapabilities
  if (!ui?.canBlockClipboardRead || !ui?.canBlockClipboardWrite) {
    failures.push('this host cannot block clipboard access')
  }
  if (!ui?.canBlockInputInjection) {
    failures.push('this host cannot block input injection')
  }
  return failures
}

// ============================================================================
// Exports #3–#5: Backend Unset, MXC Set-Aside, MXC Last Start
// ============================================================================

export function isWindowsBackendUnset(opts?: {
  platform?: Platform | string
  hasMxcSdk?: boolean
}): boolean {
  return (
    windowsSandboxStartStore.get().windowsBackendAtStart === undefined &&
    resolveWindowsBackendChoice(opts).unset === true
  )
}

export function getWindowsMxcSetAside(opts?: {
  platform?: Platform | string
  hasMxcSdk?: boolean
}): string | undefined {
  return resolveWindowsBackendChoice(opts).setAside
}

export function getWindowsMxcLastStart(opts?: {
  platform?: Platform | string
  hasMxcSdk?: boolean
}): WindowsMxcLastStart | undefined {
  if (!isWindowsPlatform(opts?.platform)) {
    return undefined
  }
  const state = windowsSandboxStartStore.get()
  const activeBackend =
    state.windowsBackendAtStart ?? resolveWindowsBackendChoice(opts).backend
  if (activeBackend !== 'mxc') {
    return undefined
  }
  if (state.initFailureReason !== undefined) {
    return { state: 'refused', reason: state.initFailureReason }
  }
  if (state.startedOnce) {
    return { state: 'started' }
  }
  return { state: 'none' }
}

// ============================================================================
// Exports #6–#8: Status, Install, Uninstall
// ============================================================================

export async function checkWindowsSandboxStatusAsync(opts?: {
  sublayerGuid?: string
  provider?: WindowsSandboxNativeProvider
}): Promise<WindowsSandboxStatus> {
  const provider = opts?.provider ?? getWindowsSandboxNativeProvider()
  if (!provider) {
    throw new WindowsSandboxError(
      'provider_unavailable',
      'Windows sandbox native provider is not available',
      'status',
    )
  }
  return provider.checkStatus(
    opts?.sublayerGuid !== undefined
      ? { sublayerGuid: opts.sublayerGuid }
      : undefined,
  )
}

export async function installWindowsSandboxAsync(
  opts?: WindowsInstallOptions,
): Promise<WindowsSandboxStatus & { cancelled?: boolean }> {
  const provider = opts?.provider ?? getWindowsSandboxNativeProvider()
  if (!provider) {
    throw new WindowsSandboxError(
      'provider_unavailable',
      'Windows sandbox native provider is not available',
      'install',
    )
  }
  const result = await provider.install(opts)
  const cancelled = result.cancelled === true || result.status === 10
  if (!cancelled && result.status !== 0) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `Windows sandbox install failed with exit code ${result.status}`
    throw new WindowsSandboxError('install_failed', detail, 'install')
  }
  const status = await provider.checkStatus(
    opts?.sublayerGuid !== undefined
      ? { sublayerGuid: opts.sublayerGuid }
      : undefined,
  )
  return cancelled ? { ...status, cancelled: true } : status
}

export async function uninstallWindowsSandbox(
  opts?: WindowsUninstallOptions,
): Promise<{ cancelled?: boolean; stdout: string; stderr: string }> {
  const provider = opts?.provider ?? getWindowsSandboxNativeProvider()
  if (!provider) {
    throw new WindowsSandboxError(
      'provider_unavailable',
      'Windows sandbox native provider is not available',
      'uninstall',
    )
  }
  const result = await provider.uninstall(opts)
  const cancelled = result.cancelled === true || result.status === 10
  if (!cancelled && result.status !== 0) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `Windows sandbox uninstall failed with exit code ${result.status}`
    throw new WindowsSandboxError('uninstall_failed', detail, 'uninstall')
  }
  return cancelled
    ? { cancelled: true, stdout: result.stdout, stderr: result.stderr }
    : { stdout: result.stdout, stderr: result.stderr }
}

// ============================================================================
// Pure node:crypto X.509 v3 Self-Signed RSA-2048 CA Generator
// ============================================================================

function derLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length])
  }
  const bytes: number[] = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining >>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function derTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content])
}

function derSequence(items: Buffer[]): Buffer {
  return derTag(0x30, Buffer.concat(items))
}

function derSet(items: Buffer[]): Buffer {
  return derTag(0x31, Buffer.concat(items))
}

function derInteger(raw: Buffer): Buffer {
  let start = 0
  while (start < raw.length - 1 && raw[start] === 0) {
    start++
  }
  const trimmed = raw.subarray(start)
  const needsLeadingZero = trimmed.length > 0 && (trimmed[0] ?? 0) >= 0x80
  const body = needsLeadingZero
    ? Buffer.concat([Buffer.from([0x00]), trimmed])
    : trimmed
  return derTag(0x02, body)
}

function derBitString(bytes: Buffer, unusedBits = 0): Buffer {
  return derTag(0x03, Buffer.concat([Buffer.from([unusedBits]), bytes]))
}

function derOctetString(bytes: Buffer): Buffer {
  return derTag(0x04, bytes)
}

function derNull(): Buffer {
  return Buffer.from([0x05, 0x00])
}

function derBoolean(value: boolean): Buffer {
  return Buffer.from([0x01, 0x01, value ? 0xff : 0x00])
}

function derUtf8String(value: string): Buffer {
  return derTag(0x0c, Buffer.from(value, 'utf8'))
}

function derExplicit(tagNumber: number, content: Buffer): Buffer {
  return derTag(0xa0 | tagNumber, content)
}

function derOid(oid: string): Buffer {
  const arcs = oid.split('.').map(part => Number.parseInt(part, 10))
  const first = (arcs[0] ?? 0) * 40 + (arcs[1] ?? 0)
  const encoded: number[] = [first]
  for (let i = 2; i < arcs.length; i++) {
    let value = arcs[i] ?? 0
    if (value < 0x80) {
      encoded.push(value)
      continue
    }
    const chunks: number[] = [value & 0x7f]
    value >>= 7
    while (value > 0) {
      chunks.unshift((value & 0x7f) | 0x80)
      value >>= 7
    }
    encoded.push(...chunks)
  }
  return derTag(0x06, Buffer.from(encoded))
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function derTime(date: Date): Buffer {
  const year = date.getUTCFullYear()
  const month = pad2(date.getUTCMonth() + 1)
  const day = pad2(date.getUTCDate())
  const hours = pad2(date.getUTCHours())
  const minutes = pad2(date.getUTCMinutes())
  const seconds = pad2(date.getUTCSeconds())
  if (year >= 1950 && year <= 2049) {
    const yy = pad2(year % 100)
    return derTag(
      0x17,
      Buffer.from(`${yy}${month}${day}${hours}${minutes}${seconds}Z`, 'ascii'),
    )
  }
  const yyyy = String(year).padStart(4, '0')
  return derTag(
    0x18,
    Buffer.from(`${yyyy}${month}${day}${hours}${minutes}${seconds}Z`, 'ascii'),
  )
}

function derToPem(label: string, der: Buffer): string {
  const base64 = der.toString('base64')
  const lines: string[] = []
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64))
  }
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

function readDerTlv(
  buf: Buffer,
  offset: number,
): { tag: number; headerLen: number; contentLen: number; nextOffset: number } {
  if (offset + 2 > buf.length) {
    throw new Error('Truncated DER element')
  }
  const tag = buf[offset]!
  const lenByte = buf[offset + 1]!
  let headerLen = 2
  let contentLen = lenByte
  if ((lenByte & 0x80) !== 0) {
    const numLenBytes = lenByte & 0x7f
    if (
      numLenBytes === 0 ||
      numLenBytes > 4 ||
      offset + 2 + numLenBytes > buf.length
    ) {
      throw new Error('Invalid DER length encoding')
    }
    contentLen = 0
    for (let i = 0; i < numLenBytes; i++) {
      contentLen = (contentLen << 8) | buf[offset + 2 + i]!
    }
    headerLen = 2 + numLenBytes
  }
  const nextOffset = offset + headerLen + contentLen
  if (nextOffset > buf.length) {
    throw new Error('DER element exceeds buffer bounds')
  }
  return { tag, headerLen, contentLen, nextOffset }
}

function extractSpkiBitStringBytes(spkiDer: Buffer): Buffer {
  // SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
  const outer = readDerTlv(spkiDer, 0)
  if (outer.tag !== 0x30) {
    throw new Error('Expected SPKI outer SEQUENCE')
  }
  const alg = readDerTlv(spkiDer, outer.headerLen)
  if (alg.tag !== 0x30) {
    throw new Error('Expected SPKI AlgorithmIdentifier SEQUENCE')
  }
  const bitStr = readDerTlv(spkiDer, alg.nextOffset)
  if (bitStr.tag !== 0x03 || bitStr.contentLen < 1) {
    throw new Error('Expected SPKI subjectPublicKey BIT STRING')
  }
  // Skip tag, length, and unused-bits byte per RFC 5280 §4.2.1.2.
  return spkiDer.subarray(
    alg.nextOffset + bitStr.headerLen + 1,
    bitStr.nextOffset,
  )
}

function generateSelfSignedCaCertAndKey(opts: {
  nowMs: number
  validityDays: number
}): { certPem: string; keyPem: string; notBefore: Date; notAfter: Date } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  const serialRaw = randomBytes(16)
  serialRaw[0] = ((serialRaw[0] ?? 0) & 0x7f) | 0x01

  // Backdate notBefore slightly to tolerate minor clock skew.
  const notBefore = new Date(opts.nowMs - 5 * 60_000)
  const notAfter = new Date(opts.nowMs + opts.validityDays * MS_PER_DAY)

  const sha256WithRsaAlgId = derSequence([
    derOid('1.2.840.113549.1.1.11'),
    derNull(),
  ])

  const dn = derSequence([
    derSet([
      derSequence([
        derOid('2.5.4.3'),
        derUtf8String('Claude Code Windows Sandbox CA'),
      ]),
    ]),
  ])

  // basicConstraints (2.5.29.19): critical=TRUE, CA=TRUE
  const basicConstraintsExt = derSequence([
    derOid('2.5.29.19'),
    derBoolean(true),
    derOctetString(derSequence([derBoolean(true)])),
  ])

  // keyUsage (2.5.29.15): critical=TRUE, keyCertSign (bit 5) | cRLSign (bit 6)
  const keyUsageExt = derSequence([
    derOid('2.5.29.15'),
    derBoolean(true),
    derOctetString(derBitString(Buffer.from([0x06]), 1)),
  ])

  // subjectKeyIdentifier (2.5.29.14): non-critical (RFC 5280 §4.2.1.2),
  // SHA-1 of SubjectPublicKeyInfo BIT STRING contents wrapped in OCTET STRING.
  const skiDigest = createHash('sha1')
    .update(extractSpkiBitStringBytes(publicKey))
    .digest()
  const subjectKeyIdentifierExt = derSequence([
    derOid('2.5.29.14'),
    derOctetString(derOctetString(skiDigest)),
  ])

  const tbsCertificate = derSequence([
    derExplicit(0, derInteger(Buffer.from([0x02]))), // version = v3 (2)
    derInteger(serialRaw),
    sha256WithRsaAlgId,
    dn,
    derSequence([derTime(notBefore), derTime(notAfter)]),
    dn,
    publicKey,
    derExplicit(
      3,
      derSequence([basicConstraintsExt, keyUsageExt, subjectKeyIdentifierExt]),
    ),
  ])

  const signatureBytes = sign('sha256', tbsCertificate, privateKey)
  const certDer = derSequence([
    tbsCertificate,
    sha256WithRsaAlgId,
    derBitString(signatureBytes, 0),
  ])

  return {
    certPem: derToPem('CERTIFICATE', certDer),
    keyPem: privateKey,
    notBefore,
    notAfter,
  }
}

function getDefaultWindowsCaDir(): string {
  const programData = process.env.ProgramData || 'C:\\ProgramData'
  return join(programData, 'claude-sandbox-runtime', 'ca')
}

function computeBufferSha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

const WINDOWS_USER_SID_RE = /^S-1-5-21-\d+-\d+-\d+-\d+$/

function writeFileAtomically(
  targetPath: string,
  content: string,
  mode: number,
  beforeRename?: (tmpPath: string) => void,
): void {
  const tmpPath = `${targetPath}.tmp.${process.pid}.${randomBytes(12).toString('hex')}`
  try {
    writeFileSync(tmpPath, content, { encoding: 'utf8', mode, flag: 'wx' })
    beforeRename?.(tmpPath)
    renameSync(tmpPath, targetPath)
  } catch (err) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // Ignore cleanup errors for partial temp file.
    }
    throw err
  }
}

export function buildWindowsKeyFileIcaclsArgs(
  keyPath: string,
  realUserSid?: string,
): string[] {
  const args = [
    keyPath,
    '/inheritance:r',
    '/grant:r',
    '*S-1-5-18:F',
    '/grant:r',
    '*S-1-5-32-544:F',
  ]
  if (realUserSid && WINDOWS_USER_SID_RE.test(realUserSid)) {
    args.push('/grant:r', `*${realUserSid}:F`)
  }
  return args
}

function hardenWindowsKeyFileAcl(keyPath: string, realUserSid?: string): void {
  if (process.platform !== 'win32') {
    return
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const icaclsPath = join(systemRoot, 'System32', 'icacls.exe')
  try {
    execFileSync(
      icaclsPath,
      buildWindowsKeyFileIcaclsArgs(keyPath, realUserSid),
      {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5_000,
      },
    )
  } catch (err) {
    logForDebugging(
      `[sandbox] Best-effort icacls.exe ACL tightening on Windows CA key failed: ${errorMessage(err)}`,
      { level: 'warn' },
    )
  }
}

type WindowsCaMetadata = {
  fingerprint: string
  createdAt: string
  expiresAt: string
}

// ============================================================================
// Exports #9–#11: Persistent Windows CA & TLS Termination CA Source
// ============================================================================

export async function ensurePersistentWindowsCa(
  opts?: EnsurePersistentWindowsCaOptions,
): Promise<EnsurePersistentWindowsCaResult> {
  const status =
    opts?.status ??
    (await checkWindowsSandboxStatusAsync({ provider: opts?.provider }))
  if (!status.user.provisioned || !status.user.credPresent) {
    throw new WindowsSandboxError(
      'sandbox_user_not_provisioned',
      'Windows sandbox user is not provisioned or credentials are missing; run `claude sandbox install` first.',
      'ca',
    )
  }

  const dir = opts?.dir ?? getDefaultWindowsCaDir()
  const certPath = join(dir, 'cert.pem')
  const keyPath = join(dir, 'key.pem')
  const metaPath = join(dir, 'ca.json')
  const regenerateWithinDays =
    opts?.regenerateWithinDays ?? DEFAULT_CA_REGENERATE_WITHIN_DAYS
  const validityDays = opts?.validityDays ?? DEFAULT_CA_VALIDITY_DAYS
  const nowMs = opts?.nowMs ?? Date.now()

  if (existsSync(metaPath) && existsSync(certPath) && existsSync(keyPath)) {
    try {
      const certBytes = readBoundedFileBytes(
        certPath,
        MAX_WINDOWS_CA_CERT_BYTES,
      )
      const keyBytes = readBoundedFileBytes(keyPath, MAX_WINDOWS_CA_CERT_BYTES)
      const metaBytes = readBoundedFileBytes(
        metaPath,
        MAX_WINDOWS_CA_CERT_BYTES,
      )
      if (
        certBytes !== undefined &&
        keyBytes !== undefined &&
        metaBytes !== undefined &&
        certBytes.length > 0 &&
        keyBytes.length > 0 &&
        metaBytes.length > 0
      ) {
        const meta = JSON.parse(
          metaBytes.toString('utf8'),
        ) as Partial<WindowsCaMetadata>
        const parsedCert = new X509Certificate(certBytes)
        const privateKey = createPrivateKey(keyBytes)
        const validFromMs = Date.parse(parsedCert.validFrom)
        const certExpiresMs = Date.parse(parsedCert.validTo)
        const metaExpiresMs =
          typeof meta.expiresAt === 'string'
            ? Date.parse(meta.expiresAt)
            : Number.NaN
        const effectiveExpiresMs = Number.isFinite(certExpiresMs)
          ? certExpiresMs
          : metaExpiresMs
        const actualFingerprint = computeBufferSha256Hex(certBytes)
        if (
          parsedCert.ca &&
          parsedCert.checkPrivateKey(privateKey) &&
          Number.isFinite(validFromMs) &&
          validFromMs <= nowMs &&
          Number.isFinite(effectiveExpiresMs) &&
          effectiveExpiresMs - nowMs > regenerateWithinDays * MS_PER_DAY &&
          (meta.fingerprint === undefined ||
            meta.fingerprint.toLowerCase() === actualFingerprint.toLowerCase())
        ) {
          windowsSandboxStartStore.get().installedCaFingerprint =
            actualFingerprint
          return {
            certPath,
            keyPath,
            fingerprint: actualFingerprint,
            regenerated: false,
          }
        }
      }
    } catch {
      // Existing CA files are unreadable, oversized, mismatched, corrupt, or expired; regenerate below.
    }
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const generated = generateSelfSignedCaCertAndKey({ nowMs, validityDays })
  const fingerprint = computeBufferSha256Hex(generated.certPem)
  const metadata: WindowsCaMetadata = {
    fingerprint,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: generated.notAfter.toISOString(),
  }

  writeFileAtomically(keyPath, generated.keyPem, 0o600, tmpPath => {
    hardenWindowsKeyFileAcl(tmpPath, status.user.realUserSid)
  })
  writeFileAtomically(certPath, generated.certPem, 0o644)
  writeFileAtomically(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 0o644)

  windowsSandboxStartStore.get().installedCaFingerprint = fingerprint
  return {
    certPath,
    keyPath,
    fingerprint,
    regenerated: true,
  }
}

export function resolveWindowsTlsTerminateCaSource(opts?: {
  platform?: Platform | string
  hasMxcSdk?: boolean
  provider?: WindowsSandboxNativeProvider
  caDir?: string
}): WindowsTlsTerminateCaSource {
  const state = windowsSandboxStartStore.get()
  const activeBackend =
    state.windowsBackendAtStart ?? resolveWindowsBackendChoice(opts).backend
  if (activeBackend === 'mxc') {
    return { source: 'unavailable' }
  }
  const tlsTerminate = readTrustedTlsTerminateSetting()
  if (
    tlsTerminate?.caCertPath !== undefined ||
    tlsTerminate?.caKeyPath !== undefined
  ) {
    return {
      source: 'trustedPair',
      caCertPath: tlsTerminate.caCertPath,
      caKeyPath: tlsTerminate.caKeyPath,
    }
  }
  if ((opts?.provider ?? getWindowsSandboxNativeProvider()) !== undefined) {
    const dir = opts?.caDir ?? getDefaultWindowsCaDir()
    return {
      source: 'managed',
      certPath: join(dir, 'cert.pem'),
      keyPath: join(dir, 'key.pem'),
    }
  }
  return { source: 'unavailable' }
}

/**
 * Official 2.1.331 `willSandboxTlsTerminate`:
 * True when `sandbox.network.tlsTerminate` is configured from a trusted source
 * and (on Windows) a usable CA source is available.
 */
export function willSandboxTlsTerminate(opts?: {
  platform?: Platform | string
  hasMxcSdk?: boolean
  provider?: WindowsSandboxNativeProvider
  caDir?: string
}): boolean {
  const tlsTerminate = readTrustedTlsTerminateSetting()
  if (tlsTerminate === undefined) {
    return false
  }
  if (isWindowsPlatform(opts?.platform)) {
    return resolveWindowsTlsTerminateCaSource(opts).source !== 'unavailable'
  }
  return true
}

function readBoundedFileBytes(
  filePath: string,
  maxBytes: number,
): Buffer | undefined {
  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes) {
      return undefined
    }
    const buf = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < stat.size) {
      const n = readSync(fd, buf, offset, stat.size - offset, offset)
      if (n <= 0) break
      offset += n
    }
    return offset === stat.size ? buf : buf.subarray(0, offset)
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // Ignore close errors.
      }
    }
  }
}

/**
 * Official 2.1.331 `REs`:
 * Reads the active CA `cert.pem` (capped at 65,536 bytes), computes its SHA-256
 * hex digest, and compares it against `expectedFingerprint`. Returns `true`
 * when no CA source is configured or the file is unreadable.
 */
export function isInstalledWindowsTlsCaCurrent(
  expectedFingerprint: string,
  opts?: {
    certPath?: string
    caDir?: string
    platform?: Platform | string
    hasMxcSdk?: boolean
    provider?: WindowsSandboxNativeProvider
  },
): boolean {
  let certPath = opts?.certPath
  if (certPath === undefined) {
    const source = resolveWindowsTlsTerminateCaSource(opts)
    if (source.source === 'unavailable') {
      return true
    }
    if (source.source === 'trustedPair') {
      if (!source.caCertPath) {
        return true
      }
      certPath = source.caCertPath
    } else {
      certPath = source.certPath
    }
  }
  const certBytes = readBoundedFileBytes(certPath, MAX_WINDOWS_CA_CERT_BYTES)
  if (certBytes === undefined) {
    return true
  }
  return (
    computeBufferSha256Hex(certBytes).toLowerCase() ===
    expectedFingerprint.toLowerCase()
  )
}

// ============================================================================
// Exports #12–#15: Profile Forget, Argv Limit, Launch Exit Classifier, Local Connections
// ============================================================================

export async function forgetWindowsProfileReadAsync(opts?: {
  timeoutMs?: number
  provider?: WindowsSandboxNativeProvider
}): Promise<{ cleared: number; deferred?: string[] }> {
  const provider = opts?.provider ?? getWindowsSandboxNativeProvider()
  if (!provider?.forgetProfileRead) {
    throw new WindowsSandboxError(
      'profile_forget_failed',
      'Windows sandbox native provider does not support forgetProfileRead',
      'profile',
    )
  }
  try {
    return await provider.forgetProfileRead(
      opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : undefined,
    )
  } catch (err) {
    if (err instanceof WindowsSandboxError) {
      throw err
    }
    throw new WindowsSandboxError(
      'profile_forget_failed',
      errorMessage(err),
      'profile',
    )
  }
}

function quoteWindowsArgUtf16Length(arg: string): number {
  if (arg.length === 0) {
    return 2
  }
  if (!/[\s"]/.test(arg)) {
    return arg.length
  }
  let len = 2
  let pendingBackslashes = 0
  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i]
    if (ch === '\\') {
      pendingBackslashes++
    } else if (ch === '"') {
      len += pendingBackslashes * 2 + 2
      pendingBackslashes = 0
    } else {
      len += pendingBackslashes + 1
      pendingBackslashes = 0
    }
  }
  len += pendingBackslashes * 2
  return len
}

/**
 * Computes the Windows `CreateProcessW` UTF-16 command-line length (excluding
 * the terminating NUL) for `command` plus optional `args`, accounting for
 * Windows CRT argument quoting and inter-argument space separators.
 */
export function estimateWindowsCommandLineUtf16Length(
  command: string,
  args?: readonly unknown[],
): number {
  let total = quoteWindowsArgUtf16Length(command)
  if (Array.isArray(args)) {
    for (const item of args) {
      if (typeof item === 'string') {
        total += 1 + quoteWindowsArgUtf16Length(item)
      }
    }
  }
  return total
}

export function isWindowsCommandLineTooLong(
  command: string,
  args?: readonly unknown[],
): boolean {
  return (
    estimateWindowsCommandLineUtf16Length(command, args) + 1 >
    WINDOWS_CREATE_PROCESS_MAX_WCHARS
  )
}

export function windowsArgvTooLongError(opts?: {
  hasAddedDenies?: boolean
}): WindowsSandboxError {
  const base =
    'The sandboxed command is too long for Windows to launch (exceeds the 32,767-character CreateProcess command-line limit). Write the script or long arguments to a file in the working directory and run that file instead.'
  const message = opts?.hasAddedDenies
    ? `${base} Additional sandbox deny rules also consume command-line space; removing unnecessary deny rules or running the command from a script file avoids this limit.`
    : base
  return new WindowsSandboxError('argv_too_long', message, 'run')
}

export function classifyWindowsSandboxLaunchExit(
  exitCode: number | null | undefined,
  stderr: string,
): string | undefined {
  const lower = stderr.toLowerCase()
  if (exitCode === 1 && lower.includes('0x80070005')) {
    windowsSandboxStartStore.get().selfExecGrantAttempt = undefined
    return 'Windows denied the sandbox account access to the executable (0x80070005). Self-executable grant state has been reset; retry the command, or run `claude sandbox install` if the error persists.'
  }
  if (
    lower.includes('createprocesssecurityenvironment') &&
    lower.includes('0x80070003')
  ) {
    return 'Windows sandbox failed in CreateProcessSecurityEnvironment (0x80070003): a broken symbolic link, missing drive, or removed folder could not be resolved. Verify that the working directory and referenced paths exist and try again.'
  }
  if (
    exitCode === 19 &&
    (lower.includes('wfp') || lower.includes('filtering platform'))
  ) {
    return 'Windows Filtering Platform (WFP) sandbox network enforcement failed (exit 19). Run `claude sandbox install` as an administrator to repair the WFP sublayer and rules.'
  }
  if (
    lower.includes('seclogon_disabled') ||
    ((lower.includes('seclogon') || lower.includes('secondary logon')) &&
      (lower.includes('disabled') ||
        lower.includes('1058') ||
        lower.includes('cannot be started') ||
        lower.includes('not running')))
  ) {
    return 'The Windows Secondary Logon service (seclogon) is disabled or stopped, which is required by the sandboxuser backend. Enable and start Secondary Logon (`sc config seclogon start= demand` then `sc start seclogon`) and retry.'
  }
  return undefined
}

export function areWindowsLocalConnectionsOn(opts?: {
  platform?: Platform | string
  hasMxcSdk?: boolean
}): boolean {
  const policySandbox = getSettingsForSource('policySettings')?.sandbox
  const flagSandbox = getSettingsForSource('flagSettings')?.sandbox
  const adminMandated =
    policySandbox?.enabled === true ||
    policySandbox?.failIfUnavailable === true ||
    policySandbox?.allowUnsandboxedCommands === false ||
    flagSandbox?.allowUnsandboxedCommands === false

  let rawAllowed: boolean
  if (policySandbox?.network?.allowLocalBinding !== undefined) {
    rawAllowed = policySandbox.network.allowLocalBinding === true
  } else if (adminMandated) {
    const mergedAllow =
      getSettings_DEPRECATED()?.sandbox?.network?.allowLocalBinding
    if (mergedAllow === false) {
      rawAllowed = false
    } else {
      let trustedAllow: boolean | undefined
      for (const src of trustedWindowsSandboxSources()) {
        const val = src?.sandbox?.network?.allowLocalBinding
        if (val !== undefined) {
          trustedAllow = val
          break
        }
      }
      rawAllowed = trustedAllow === true
    }
  } else {
    rawAllowed =
      getSettings_DEPRECATED()?.sandbox?.network?.allowLocalBinding === true
  }

  const state = windowsSandboxStartStore.get()
  const activeBackend =
    state.windowsBackendAtStart ?? resolveWindowsBackendChoice(opts).backend
  if (isWindowsPlatform(opts?.platform) && activeBackend === 'mxc') {
    if (rawAllowed && !state.mxcLocalConnectionsWarned) {
      state.mxcLocalConnectionsWarned = true
      logForDebugging(
        '[sandbox] sandbox.network.allowLocalBinding is ignored on the Windows MXC backend; local connections remain disabled',
        { level: 'warn' },
      )
    }
    return false
  }
  return rawAllowed
}

// ============================================================================
// Official Chunk #2214 (`QVo`): Deduplicated Per-Host Install Flow
// ============================================================================

const installFlowSlotByHost = new HostSlot<{
  inFlight?: Promise<WindowsSandboxInstallFlowResult>
}>(() => ({}))

export function runWindowsSandboxInstallFlow(
  host?: SessionHost | object,
  onProgress?: (message: string) => void,
  timeoutMs?: number,
  opts?: WindowsSandboxInstallFlowOptions,
): Promise<WindowsSandboxInstallFlowResult> {
  const targetHost = host ?? getBootstrapSessionHost()
  const slot = installFlowSlotByHost.of(targetHost)
  if (slot.inFlight !== undefined) {
    return slot.inFlight
  }

  let settled = false
  let promise: Promise<WindowsSandboxInstallFlowResult> | undefined
  promise = (async (): Promise<WindowsSandboxInstallFlowResult> => {
    try {
      const provider =
        opts?.provider ?? getWindowsSandboxNativeProvider(targetHost)
      const allowLoopback =
        opts?.allowLoopback ?? areWindowsLocalConnectionsOn()
      onProgress?.('Installing Windows sandbox account and WFP rules...')
      const status = await installWindowsSandboxAsync({
        allowLoopback,
        sublayerGuid: opts?.sublayerGuid,
        proxyPortRange: opts?.proxyPortRange,
        timeoutMs,
        provider,
        onProgress,
      })

      if (status.cancelled) {
        return { status, cancelled: true }
      }

      let wfpVerify: WindowsSandboxInstallFlowResult['wfpVerify']
      if (provider?.verifyWfp) {
        onProgress?.('Verifying Windows Filtering Platform (WFP) rules...')
        wfpVerify = await provider.verifyWfp({
          allowLoopback,
          timeoutMs,
        })
      }

      let ca: EnsurePersistentWindowsCaResult | undefined
      const shouldEnsureCa =
        opts?.willTlsTerminate ??
        willSandboxTlsTerminate({ provider, caDir: opts?.caDir })
      if (shouldEnsureCa) {
        onProgress?.('Ensuring persistent Windows sandbox TLS CA...')
        ca = await ensurePersistentWindowsCa({
          dir: opts?.caDir,
          status,
          provider,
        })
      }

      return {
        status,
        cancelled: false,
        wfpVerify,
        ca,
      }
    } finally {
      settled = true
      if (slot.inFlight === promise) {
        slot.inFlight = undefined
      }
    }
  })()

  if (!settled) {
    slot.inFlight = promise
  }
  return promise
}
