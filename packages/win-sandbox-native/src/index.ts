import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRT_WIN_EXIT_CODES = {
  OK: 0,
  RUNTIME_ERROR: 1,
  USAGE: 2,
  VALIDATION: 3,
  UAC_CANCELLED: 10,
  WFP_ERROR: 19,
} as const

export interface SrtWinCommandSpec {
  exe: string
  prependArgs: string[]
}

export type WindowsSeclogonState =
  | 'running'
  | 'stopped'
  | 'disabled'
  | 'unknown'

export interface WindowsSandboxUserStatus {
  provisioned: boolean
  credPresent: boolean
  realUserSid: string | null
  sandboxUser: string | null
  seclogonState: WindowsSeclogonState
}

export type WindowsWfpState =
  | 'installed'
  | 'absent'
  | 'degraded'
  | 'cannot-read'
  | 'unsupported'

export interface WindowsSandboxWfpStatus {
  state: WindowsWfpState
  allowLoopback: boolean
  sublayerGuid: string | null
  proxyPortRange: [number, number] | null
}

export interface WindowsSandboxStatus {
  user: WindowsSandboxUserStatus
  wfp: WindowsSandboxWfpStatus
}

export type WindowsEgressProbeOutcome = 'blocked' | 'allowed' | 'not-run'

export interface WindowsWfpVerifyOptions {
  target?: string
  timeoutMs?: number
}

export interface WindowsWfpVerifyResult {
  egress_probe: WindowsEgressProbeOutcome
  target: string
  write_restricted_token: boolean
}

export interface WindowsProfileForgetOptions {
  sid?: string
  timeoutMs?: number
}

export interface WindowsProfileForgetResult {
  cleared: boolean
  deferred: boolean
}

export interface WindowsDeniesRequest {
  denyRead: string[]
  denyWrite: string[]
  allowWrite: string[]
  sid?: string
  deadlineMs?: number
}

export interface WindowsDeniesResult {
  inPlace: number
  planted: number
  laid: number
  pushedDown: number
  guarded: number
  extrasSkipped: number
  ms: number
  stands: number
  handedBack: number
}

export interface WindowsMxcUiCapabilities {
  canBlockClipboardRead: boolean
  canBlockClipboardWrite: boolean
  canBlockInputInjection: boolean
}

export interface WindowsMxcProbes {
  baseContainerSupportsDenyPaths: boolean
  baseContainerSupportsIdentitylessLoopbackProxy: boolean
  baseContainerSupportsIngressHostLoopbackAllow: boolean
  uiCapabilities: WindowsMxcUiCapabilities
}

export type WindowsMxcTier =
  | 'none'
  | 'base-container'
  | 'job-restricted'
  | 'appcontainer'
  | 'mxc'

export interface WindowsMxcProbeResult {
  tier: WindowsMxcTier
  needsDaclAugmentation: boolean
  probes: WindowsMxcProbes
  error?: string
}

export interface WindowsSandboxInstallOptions {
  sandboxUser?: string
  realUserSid?: string
  sublayerGuid?: string
  proxyPortRange?: [number, number]
  allowLoopback?: boolean
  timeoutMs?: number
}

export interface WindowsSandboxUninstallOptions {
  sandboxUser?: string
  sublayerGuid?: string
  timeoutMs?: number
}

export interface WindowsSandboxRunOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  proxyPort?: number
  httpProxyUrl?: string
  httpsProxyUrl?: string
  sublayerGuid?: string
  noNet?: boolean
  allowLoopback?: boolean
  blockClipboardRead?: boolean
  blockClipboardWrite?: boolean
  blockInputInjection?: boolean
  timeoutMs?: number
  maxOutputBytes?: number
  stdin?: string
}

export interface WindowsSandboxRunResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  outputLimitExceeded: boolean
  signal: NodeJS.Signals | null
}

export interface WindowsSandboxNativeProvider {
  readonly srtWinCommand: SrtWinCommandSpec
  checkStatus(options?: {
    sublayerGuid?: string
    timeoutMs?: number
  }): Promise<WindowsSandboxStatus>
  install(options?: WindowsSandboxInstallOptions): Promise<WindowsSandboxStatus>
  uninstall(
    options?: WindowsSandboxUninstallOptions,
  ): Promise<WindowsSandboxStatus>
  verifyWfp(options?: WindowsWfpVerifyOptions): Promise<WindowsWfpVerifyResult>
  forgetProfileRead(
    options?: WindowsProfileForgetOptions,
  ): Promise<WindowsProfileForgetResult>
  applyDenies(
    request: WindowsDeniesRequest,
    options?: { timeoutMs?: number },
  ): Promise<WindowsDeniesResult>
  probeMxc(options?: { timeoutMs?: number }): Promise<WindowsMxcProbeResult>
  spawnSandboxed(
    options: WindowsSandboxRunOptions,
  ): Promise<WindowsSandboxRunResult>
}

export interface ResolveSrtWinBinaryOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  execPath?: string
  arch?: string
  /** @deprecated Ignored for security; CWD-based binary resolution is disabled. */
  cwd?: string
}

export interface CreateSrtWinProviderOptions {
  srtWin?: SrtWinCommandSpec
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  defaultTimeoutMs?: number
  maxOutputBytes?: number
}

export class SrtWinExecutionError extends Error {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly command: string
  readonly args: string[]
  readonly timedOut: boolean
  readonly signal: NodeJS.Signals | null

  constructor(params: {
    message: string
    exitCode: number | null
    stdout: string
    stderr: string
    command: string
    args: string[]
    timedOut: boolean
    signal: NodeJS.Signals | null
  }) {
    super(params.message)
    this.name = 'SrtWinExecutionError'
    this.exitCode = params.exitCode
    this.stdout = params.stdout
    this.stderr = params.stderr
    this.command = params.command
    this.args = params.args
    this.timedOut = params.timedOut
    this.signal = params.signal
  }

  get isUacCancelled(): boolean {
    return this.exitCode === SRT_WIN_EXIT_CODES.UAC_CANCELLED
  }

  get isWfpError(): boolean {
    return this.exitCode === SRT_WIN_EXIT_CODES.WFP_ERROR
  }

  get isValidationError(): boolean {
    return this.exitCode === SRT_WIN_EXIT_CODES.VALIDATION
  }
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10 MiB

function isRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function getModuleDir(): string | null {
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return null
  }
}

export function findDistRootFromModuleDir(moduleDir: string): string | null {
  const normalized = moduleDir.replace(/\\/g, '/')
  const segments = normalized.split('/')
  let lastDistSegIdx = -1
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] === 'dist') {
      lastDistSegIdx = i
      break
    }
  }
  if (lastDistSegIdx === -1) {
    return null
  }
  const prefixLen = segments.slice(0, lastDistSegIdx + 1).join('/').length
  return moduleDir.slice(0, prefixLen)
}

/**
 * Resolves the compiled `srt-win` native binary path strictly from trusted locations
 * (never from `cwd` or `PATH`):
 * 1. Explicit `CLAUDE_CODE_SRT_WIN_PATH` (absolute regular file path)
 * 2. Compiled executable adjacent `dirname(execPath)/vendor/win-sandbox/srt-win(.exe)`
 *    and `packageRoot/vendor/win-sandbox/srt-win(.exe)` (matching `ripgrep.ts` for `bun build --compile`)
 * 3. `moduleDir`-relative bundled `dist/vendor/win-sandbox/srt-win(.exe)`
 * 4. `moduleDir`-relative dev `target/release/srt-win(.exe)` and `target/debug/srt-win(.exe)`
 */
export function resolveSrtWinBinaryPath(
  opts?: ResolveSrtWinBinaryOptions,
): string | null {
  const env = opts?.env ?? process.env
  const platform = opts?.platform ?? process.platform
  const arch = opts?.arch ?? process.arch
  const binName = platform === 'win32' ? 'srt-win.exe' : 'srt-win'

  const envOverride = env.CLAUDE_CODE_SRT_WIN_PATH?.trim()
  if (envOverride && isAbsolute(envOverride) && isRegularFile(envOverride)) {
    return envOverride
  }

  const candidates: string[] = []

  // R3-P0-6: Support `bun build --compile` single-file executables (matching ripgrep.ts)
  const execPath = opts?.execPath ?? process.execPath
  if (execPath) {
    const execDir = dirname(execPath)
    const execPkgRoot = dirname(execDir)
    const execPkgParent = dirname(execPkgRoot)
    candidates.push(
      join(execDir, 'vendor', 'win-sandbox', binName),
      join(execPkgRoot, 'vendor', 'win-sandbox', binName),
    )
    if (platform === 'win32') {
      const platformPkg = `claude-code-win32-${arch}`
      candidates.push(
        join(
          execPkgRoot,
          'node_modules',
          '@go-hare',
          platformPkg,
          'vendor',
          'win-sandbox',
          binName,
        ),
        join(execPkgParent, platformPkg, 'vendor', 'win-sandbox', binName),
        join(
          execPkgParent,
          '@go-hare',
          platformPkg,
          'vendor',
          'win-sandbox',
          binName,
        ),
      )
    }
  }

  const moduleDir = getModuleDir()
  if (moduleDir) {
    const pkgRoot = resolve(moduleDir, '..')
    const repoRootFromPkg = resolve(pkgRoot, '..', '..')
    const distRoot = findDistRootFromModuleDir(moduleDir)

    if (distRoot) {
      candidates.push(join(distRoot, 'vendor', 'win-sandbox', binName))
    }
    candidates.push(
      join(repoRootFromPkg, 'dist', 'vendor', 'win-sandbox', binName),
      join(pkgRoot, 'target', 'release', binName),
      join(
        repoRootFromPkg,
        'packages',
        'win-sandbox-native',
        'target',
        'release',
        binName,
      ),
      join(pkgRoot, 'target', 'debug', binName),
      join(
        repoRootFromPkg,
        'packages',
        'win-sandbox-native',
        'target',
        'debug',
        binName,
      ),
    )
  }

  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    if (isRegularFile(candidate)) {
      return candidate
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBoolean(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): boolean {
  const value = obj[key]
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${context}: expected boolean for '${key}'`)
  }
  return value
}

function readNumber(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = obj[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${context}: expected finite number for '${key}'`)
  }
  return value
}

function readString(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = obj[key]
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${context}: expected string for '${key}'`)
  }
  return value
}

function readNullableString(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): string | null {
  const value = obj[key]
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${context}: expected string or null for '${key}'`)
  }
  return value
}

function parseSeclogonState(raw: string): WindowsSeclogonState {
  if (
    raw === 'running' ||
    raw === 'stopped' ||
    raw === 'disabled' ||
    raw === 'unknown'
  ) {
    return raw
  }
  return 'unknown'
}

function parseWfpState(raw: string): WindowsWfpState {
  if (
    raw === 'installed' ||
    raw === 'absent' ||
    raw === 'degraded' ||
    raw === 'cannot-read' ||
    raw === 'unsupported'
  ) {
    return raw
  }
  return 'unsupported'
}

function parseEgressProbeOutcome(raw: string): WindowsEgressProbeOutcome {
  if (raw === 'blocked' || raw === 'allowed' || raw === 'not-run') {
    return raw
  }
  throw new Error(`Invalid WfpVerifyResponse: unexpected egress_probe '${raw}'`)
}

function parseMxcTier(raw: string): WindowsMxcTier {
  if (
    raw === 'none' ||
    raw === 'base-container' ||
    raw === 'job-restricted' ||
    raw === 'appcontainer' ||
    raw === 'mxc'
  ) {
    return raw
  }
  throw new Error(`Invalid MxcProbeResponse: unexpected tier '${raw}'`)
}

function parseStatusResponse(rawJson: string): WindowsSandboxStatus {
  const parsed: unknown = JSON.parse(rawJson)
  if (!isRecord(parsed)) {
    throw new Error('Invalid StatusResponse: expected JSON object')
  }
  const userObj = parsed.user
  const wfpObj = parsed.wfp
  if (!isRecord(userObj) || !isRecord(wfpObj)) {
    throw new Error('Invalid StatusResponse: missing user or wfp object')
  }

  let proxyPortRange: [number, number] | null = null
  const rawRange = wfpObj.proxyPortRange
  if (rawRange !== null && rawRange !== undefined) {
    if (
      !Array.isArray(rawRange) ||
      rawRange.length !== 2 ||
      typeof rawRange[0] !== 'number' ||
      typeof rawRange[1] !== 'number'
    ) {
      throw new Error(
        'Invalid StatusResponse: proxyPortRange must be [number, number] or null',
      )
    }
    proxyPortRange = [rawRange[0], rawRange[1]]
  }

  return {
    user: {
      provisioned: readBoolean(userObj, 'provisioned', 'StatusResponse.user'),
      credPresent: readBoolean(userObj, 'credPresent', 'StatusResponse.user'),
      realUserSid: readNullableString(
        userObj,
        'realUserSid',
        'StatusResponse.user',
      ),
      sandboxUser: readNullableString(
        userObj,
        'sandboxUser',
        'StatusResponse.user',
      ),
      seclogonState: parseSeclogonState(
        readString(userObj, 'seclogonState', 'StatusResponse.user'),
      ),
    },
    wfp: {
      state: parseWfpState(readString(wfpObj, 'state', 'StatusResponse.wfp')),
      allowLoopback: readBoolean(wfpObj, 'allowLoopback', 'StatusResponse.wfp'),
      sublayerGuid: readNullableString(
        wfpObj,
        'sublayerGuid',
        'StatusResponse.wfp',
      ),
      proxyPortRange,
    },
  }
}

function parseWfpVerifyResponse(rawJson: string): WindowsWfpVerifyResult {
  const parsed: unknown = JSON.parse(rawJson)
  if (!isRecord(parsed)) {
    throw new Error('Invalid WfpVerifyResponse: expected JSON object')
  }
  return {
    egress_probe: parseEgressProbeOutcome(
      readString(parsed, 'egress_probe', 'WfpVerifyResponse'),
    ),
    target: readString(parsed, 'target', 'WfpVerifyResponse'),
    write_restricted_token: readBoolean(
      parsed,
      'write_restricted_token',
      'WfpVerifyResponse',
    ),
  }
}

function parseProfileForgetResponse(
  rawJson: string,
): WindowsProfileForgetResult {
  const parsed: unknown = JSON.parse(rawJson)
  if (!isRecord(parsed)) {
    throw new Error('Invalid ProfileForgetResponse: expected JSON object')
  }
  return {
    cleared: readBoolean(parsed, 'cleared', 'ProfileForgetResponse'),
    deferred: readBoolean(parsed, 'deferred', 'ProfileForgetResponse'),
  }
}

function parseDeniesResponse(rawJson: string): WindowsDeniesResult {
  const parsed: unknown = JSON.parse(rawJson)
  if (!isRecord(parsed)) {
    throw new Error('Invalid DeniesResponse: expected JSON object')
  }
  return {
    inPlace: readNumber(parsed, 'inPlace', 'DeniesResponse'),
    planted: readNumber(parsed, 'planted', 'DeniesResponse'),
    laid: readNumber(parsed, 'laid', 'DeniesResponse'),
    pushedDown: readNumber(parsed, 'pushedDown', 'DeniesResponse'),
    guarded: readNumber(parsed, 'guarded', 'DeniesResponse'),
    extrasSkipped: readNumber(parsed, 'extrasSkipped', 'DeniesResponse'),
    ms: readNumber(parsed, 'ms', 'DeniesResponse'),
    stands: readNumber(parsed, 'stands', 'DeniesResponse'),
    handedBack: readNumber(parsed, 'handedBack', 'DeniesResponse'),
  }
}

function parseMxcProbeResponse(rawJson: string): WindowsMxcProbeResult {
  const parsed: unknown = JSON.parse(rawJson)
  if (!isRecord(parsed)) {
    throw new Error('Invalid MxcProbeResponse: expected JSON object')
  }
  const probesObj = parsed.probes
  if (!isRecord(probesObj)) {
    throw new Error('Invalid MxcProbeResponse: missing probes object')
  }
  const uiObj = probesObj.uiCapabilities
  if (!isRecord(uiObj)) {
    throw new Error('Invalid MxcProbeResponse: missing uiCapabilities object')
  }

  const result: WindowsMxcProbeResult = {
    tier: parseMxcTier(readString(parsed, 'tier', 'MxcProbeResponse')),
    needsDaclAugmentation: readBoolean(
      parsed,
      'needsDaclAugmentation',
      'MxcProbeResponse',
    ),
    probes: {
      baseContainerSupportsDenyPaths: readBoolean(
        probesObj,
        'baseContainerSupportsDenyPaths',
        'MxcProbeResponse.probes',
      ),
      baseContainerSupportsIdentitylessLoopbackProxy: readBoolean(
        probesObj,
        'baseContainerSupportsIdentitylessLoopbackProxy',
        'MxcProbeResponse.probes',
      ),
      baseContainerSupportsIngressHostLoopbackAllow: readBoolean(
        probesObj,
        'baseContainerSupportsIngressHostLoopbackAllow',
        'MxcProbeResponse.probes',
      ),
      uiCapabilities: {
        canBlockClipboardRead: readBoolean(
          uiObj,
          'canBlockClipboardRead',
          'MxcProbeResponse.probes.uiCapabilities',
        ),
        canBlockClipboardWrite: readBoolean(
          uiObj,
          'canBlockClipboardWrite',
          'MxcProbeResponse.probes.uiCapabilities',
        ),
        canBlockInputInjection: readBoolean(
          uiObj,
          'canBlockInputInjection',
          'MxcProbeResponse.probes.uiCapabilities',
        ),
      },
    },
  }

  if (typeof parsed.error === 'string') {
    result.error = parsed.error
  }

  return result
}

interface ExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  outputLimitExceeded: boolean
  signal: NodeJS.Signals | null
}

function execSrtWin(params: {
  spec: SrtWinCommandSpec
  args: string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes: number
  stdin?: string
}): Promise<ExecResult> {
  const fullArgs = [...params.spec.prependArgs, ...params.args]
  const maxBytes = Math.max(1, params.maxOutputBytes)
  const killGraceMs = Math.min(
    1500,
    Math.max(50, Math.floor(params.timeoutMs / 2)),
  )

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(params.spec.exe, fullArgs, {
      env: params.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let bufferedBytes = 0
    let timedOut = false
    let outputLimitExceeded = false
    let exited = false
    let exitCodeObserved: number | null = null
    let exitSignalObserved: NodeJS.Signals | null = null
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | null = null

    const cleanupTimers = () => {
      clearTimeout(timer)
      if (killTimer !== null) {
        clearTimeout(killTimer)
        killTimer = null
      }
    }

    const destroyStreams = () => {
      try {
        child.stdout.destroy()
      } catch {
        // Ignore stream destroy race
      }
      try {
        child.stderr.destroy()
      } catch {
        // Ignore stream destroy race
      }
      try {
        child.stdin.destroy()
      } catch {
        // Ignore stream destroy race
      }
    }

    const settleResolve = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      if (settled) return
      settled = true
      cleanupTimers()
      resolvePromise({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        outputLimitExceeded,
        signal,
      })
    }

    const killChildWithEscalation = () => {
      if (exited) {
        destroyStreams()
        settleResolve(exitCodeObserved, exitSignalObserved)
        return
      }
      try {
        child.kill('SIGTERM')
      } catch {
        // Ignore kill race
      }
      if (killTimer === null) {
        killTimer = setTimeout(() => {
          killTimer = null
          if (!settled) {
            try {
              child.kill('SIGKILL')
            } catch {
              // Ignore kill race
            }
          }
        }, killGraceMs)
        killTimer.unref()
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      killChildWithEscalation()
    }, params.timeoutMs)
    timer.unref()

    const appendChunk = (target: Buffer[], chunk: Buffer) => {
      if (outputLimitExceeded || settled) {
        return
      }
      if (bufferedBytes + chunk.length > maxBytes) {
        const remaining = maxBytes - bufferedBytes
        if (remaining > 0) {
          target.push(chunk.subarray(0, remaining))
          bufferedBytes = maxBytes
        }
        outputLimitExceeded = true
        killChildWithEscalation()
        return
      }
      target.push(chunk)
      bufferedBytes += chunk.length
    }

    child.stdout.on('data', (chunk: Buffer) => {
      appendChunk(stdoutChunks, chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      appendChunk(stderrChunks, chunk)
    })

    child.on('error', (err: Error) => {
      if (settled) return
      settled = true
      cleanupTimers()
      rejectPromise(
        new SrtWinExecutionError({
          message: `Failed to execute '${params.spec.exe}': ${err.message}`,
          exitCode: null,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          command: params.spec.exe,
          args: fullArgs,
          timedOut,
          signal: null,
        }),
      )
    })

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      exited = true
      exitCodeObserved = code
      exitSignalObserved = signal
      // On timeout or output cap abort, resolve immediately on 'exit' without
      // waiting indefinitely on 'close' in case a grandchild still holds stdio open.
      if (timedOut || outputLimitExceeded) {
        destroyStreams()
        settleResolve(code, signal)
      }
    })

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      settleResolve(code, signal)
    })

    // Prevent unhandled EPIPE error if child exits before stdin write finishes.
    child.stdin.on('error', () => {})
    if (params.stdin !== undefined) {
      child.stdin.write(params.stdin, 'utf8')
    }
    child.stdin.end()
  })
}

async function execSrtWinChecked(params: {
  spec: SrtWinCommandSpec
  args: string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes: number
  stdin?: string
}): Promise<string> {
  const result = await execSrtWin(params)
  if (result.timedOut || result.outputLimitExceeded || result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    const reason = result.timedOut
      ? `srt-win timed out after ${params.timeoutMs}ms`
      : result.outputLimitExceeded
        ? `srt-win output exceeded limit of ${params.maxOutputBytes} bytes`
        : `srt-win exited with code ${result.exitCode ?? 'null'}${detail ? `: ${detail}` : ''}`
    throw new SrtWinExecutionError({
      message: reason,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      command: params.spec.exe,
      args: [...params.spec.prependArgs, ...params.args],
      timedOut: result.timedOut,
      signal: result.signal,
    })
  }
  return result.stdout.trim()
}

const SENSITIVE_ENV_KEY_RE =
  /^(?:SRT_WIN_SANDBOX_PASSWORD|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|AZURE_CLIENT_SECRET|GCP_SERVICE_ACCOUNT_KEY)$|_(?:API_KEY|SECRET_KEY|ACCESS_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)$/i

function isSafeExplicitEnvOverride(key: string, value: string): boolean {
  if (
    !key ||
    key.includes('=') ||
    key.includes('\0') ||
    key.includes('\r') ||
    key.includes('\n') ||
    value.includes('\0')
  ) {
    return false
  }
  if (key.toUpperCase().startsWith('SRT_WIN_TEST_')) {
    return false
  }
  return !SENSITIVE_ENV_KEY_RE.test(key)
}

export function createSrtWinNativeProvider(
  options?: CreateSrtWinProviderOptions,
): WindowsSandboxNativeProvider {
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options?.env ?? {}),
  }
  const defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const defaultMaxOutputBytes =
    options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

  let srtWinCommand: SrtWinCommandSpec
  if (options?.srtWin !== undefined) {
    srtWinCommand = options.srtWin
  } else {
    const resolvedExe = resolveSrtWinBinaryPath({
      env: baseEnv,
      platform: options?.platform,
    })
    if (!resolvedExe) {
      throw new SrtWinExecutionError({
        message: 'srt-win binary not found',
        exitCode: null,
        stdout: '',
        stderr: '',
        command: 'srt-win',
        args: [],
        timedOut: false,
        signal: null,
      })
    }
    srtWinCommand = {
      exe: resolvedExe,
      prependArgs: [],
    }
  }

  return {
    srtWinCommand,

    async checkStatus(opts) {
      const args = ['status']
      if (opts?.sublayerGuid !== undefined) {
        args.push('--sublayer-guid', opts.sublayerGuid)
      }
      const stdout = await execSrtWinChecked({
        spec: srtWinCommand,
        args,
        env: baseEnv,
        timeoutMs: opts?.timeoutMs ?? defaultTimeoutMs,
        maxOutputBytes: defaultMaxOutputBytes,
      })
      return parseStatusResponse(stdout)
    },

    async install(opts) {
      const args = ['install']
      if (opts?.sandboxUser !== undefined) {
        args.push('--user', opts.sandboxUser)
      }
      if (opts?.realUserSid !== undefined) {
        args.push('--sid', opts.realUserSid)
      }
      if (opts?.sublayerGuid !== undefined) {
        args.push('--sublayer-guid', opts.sublayerGuid)
      }
      if (opts?.proxyPortRange !== undefined) {
        args.push(
          '--proxy-port-range',
          `${opts.proxyPortRange[0]}-${opts.proxyPortRange[1]}`,
        )
      }
      if (opts?.allowLoopback === false) {
        args.push('--no-allow-loopback')
      } else if (opts?.allowLoopback === true) {
        args.push('--allow-loopback')
      }

      const stdout = await execSrtWinChecked({
        spec: srtWinCommand,
        args,
        env: baseEnv,
        timeoutMs: opts?.timeoutMs ?? defaultTimeoutMs,
        maxOutputBytes: defaultMaxOutputBytes,
      })
      return parseStatusResponse(stdout)
    },

    async uninstall(opts) {
      const args = ['uninstall']
      if (opts?.sandboxUser !== undefined) {
        args.push('--user', opts.sandboxUser)
      }
      if (opts?.sublayerGuid !== undefined) {
        args.push('--sublayer-guid', opts.sublayerGuid)
      }

      const stdout = await execSrtWinChecked({
        spec: srtWinCommand,
        args,
        env: baseEnv,
        timeoutMs: opts?.timeoutMs ?? defaultTimeoutMs,
        maxOutputBytes: defaultMaxOutputBytes,
      })
      return parseStatusResponse(stdout)
    },

    async verifyWfp(opts) {
      const args = ['wfp', 'verify']
      if (opts?.target !== undefined) {
        args.push('--target', opts.target)
      }
      const stdout = await execSrtWinChecked({
        spec: srtWinCommand,
        args,
        env: baseEnv,
        timeoutMs: opts?.timeoutMs ?? defaultTimeoutMs,
        maxOutputBytes: defaultMaxOutputBytes,
      })
      return parseWfpVerifyResponse(stdout)
    },

    async forgetProfileRead(opts) {
      const args = ['profile', 'forget']
      if (opts?.sid !== undefined) {
        args.push('--sid', opts.sid)
      }
      const stdout = await execSrtWinChecked({
        spec: srtWinCommand,
        args,
        env: baseEnv,
        timeoutMs: opts?.timeoutMs ?? defaultTimeoutMs,
        maxOutputBytes: defaultMaxOutputBytes,
      })
      return parseProfileForgetResponse(stdout)
    },

    async applyDenies(request, opts) {
      const args = ['denies']
      if (request.sid !== undefined) {
        args.push('--sid', request.sid)
      }
      if (request.deadlineMs !== undefined) {
        args.push('--deadline-ms', String(request.deadlineMs))
      }
      const stdout = await execSrtWinChecked({
        spec: srtWinCommand,
        args,
        env: baseEnv,
        timeoutMs: opts?.timeoutMs ?? defaultTimeoutMs,
        maxOutputBytes: defaultMaxOutputBytes,
        stdin: JSON.stringify(request),
      })
      return parseDeniesResponse(stdout)
    },

    async probeMxc(opts) {
      const stdout = await execSrtWinChecked({
        spec: srtWinCommand,
        args: ['probe-mxc'],
        env: baseEnv,
        timeoutMs: opts?.timeoutMs ?? defaultTimeoutMs,
        maxOutputBytes: defaultMaxOutputBytes,
      })
      return parseMxcProbeResponse(stdout)
    },

    async spawnSandboxed(opts) {
      const args = ['run']
      if (opts.cwd !== undefined) {
        args.push('--cwd', opts.cwd)
      }
      if (opts.proxyPort !== undefined) {
        args.push('--proxy-port', String(opts.proxyPort))
      }
      if (opts.httpProxyUrl !== undefined) {
        args.push('--http-proxy', opts.httpProxyUrl)
      }
      if (opts.httpsProxyUrl !== undefined) {
        args.push('--https-proxy', opts.httpsProxyUrl)
      }
      if (opts.sublayerGuid !== undefined) {
        args.push('--sublayer-guid', opts.sublayerGuid)
      }
      if (opts.noNet === true) {
        args.push('--no-net')
      }
      if (opts.env !== undefined) {
        for (const [k, v] of Object.entries(opts.env)) {
          if (isSafeExplicitEnvOverride(k, v)) {
            args.push('--env', `${k}=${v}`)
          }
        }
      }
      if (opts.allowLoopback === false) {
        args.push('--no-allow-loopback')
      } else if (opts.allowLoopback === true) {
        args.push('--allow-loopback')
      }
      if (opts.blockClipboardRead === false) {
        args.push('--allow-clipboard-read')
      } else if (opts.blockClipboardRead === true) {
        args.push('--block-clipboard-read')
      }
      if (opts.blockClipboardWrite === false) {
        args.push('--allow-clipboard-write')
      } else if (opts.blockClipboardWrite === true) {
        args.push('--block-clipboard-write')
      }
      if (opts.blockInputInjection === false) {
        args.push('--allow-input-injection')
      } else if (opts.blockInputInjection === true) {
        args.push('--block-input-injection')
      }
      args.push('--', opts.command, ...(opts.args ?? []))

      const mergedEnv: NodeJS.ProcessEnv = {
        ...baseEnv,
        ...(opts.env ?? {}),
      }

      const result = await execSrtWin({
        spec: srtWinCommand,
        args,
        env: mergedEnv,
        timeoutMs: opts.timeoutMs ?? defaultTimeoutMs,
        maxOutputBytes: opts.maxOutputBytes ?? defaultMaxOutputBytes,
        stdin: opts.stdin,
      })

      return {
        exitCode: result.outputLimitExceeded
          ? 1
          : (result.exitCode ?? (result.timedOut ? 124 : 1)),
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        outputLimitExceeded: result.outputLimitExceeded,
        signal: result.signal,
      }
    },
  }
}
