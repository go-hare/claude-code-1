import { spawn, type ChildProcess } from 'child_process'
import { createHmac, randomBytes, randomUUID } from 'crypto'
import { closeSync, ftruncateSync, openSync, writeFileSync } from 'fs'
import { access, open, readdir, readFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { join as posixJoin } from 'path/posix'
import { getSessionId } from 'src/bootstrap/state.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import {
  getClaudeConfigHomeDir,
  isEnvTruthy,
  shouldStripDaemonForceColor,
} from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { getPlatform } from '../platform.js'
import { buildPowerShellInvocationFlags } from '../powershellExecutionPolicy.js'
import { getSessionEnvVars } from '../sessionEnvVars.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { ShellProvider } from './shellProvider.js'

/**
 * densable 2.1.214 Erg — UTF-8 redirect + OutputEncoding + PSStyle PlainText.
 * Prepended to user command unless shouldSkipPowerShellEncodingPreamble.
 * Fixes #23 (non-ASCII / raw ANSI) and #25 (PS 5.1 `>`/`>>` UTF-16LE).
 */
export const POWERSHELL_ENCODING_PREAMBLE =
  "try { $PSDefaultParameterValues['Out-File:Encoding'] = 'utf8' } catch {}; if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') { try { $OutputEncoding = [System.Text.UTF8Encoding]::new() } catch {}; if ($null -ne $PSStyle) { try { $PSStyle.OutputRendering = 'PlainText' } catch {} } }; "

const PLAIN_ASSIGNMENT_RE =
  /^(?:\s*(?:#.*)?|(?:export +|declare -x +)?([A-Za-z_]\w*)=((?:[\w@%+=:,./-]|'[^'\0]*'|"(?:[^"\\$`\0]|\\[^\0])*")*))$/
const UNQUOTE_RE = /'([^']*)'|"((?:[^"\\]|\\.)*)"/g
const HAS_PATH_SEP_RE = /[/\\]/
const HOOK_ENV_FILE_RE =
  /^(setup|sessionstart|cwdchanged|filechanged)-hook-(\d+)\.sh$/
const HOOK_PHASE_ORDER: Record<string, number> = {
  setup: 0,
  sessionstart: 1,
  cwdchanged: 2,
  filechanged: 3,
}

/**
 * #521 SEA `E7i`: Parse a shell env file when it holds only plain assignments
 * (`VAR=val`, `export VAR=val`, `declare -x VAR=val`, blanks, or `#` comments).
 * Returns an empty Map if any line contains arbitrary shell syntax.
 */
export function parsePlainEnvAssignments(
  script: string,
  platform: string = getPlatform(),
): Map<string, string> {
  const result = new Map<string, string>()
  for (const rawLine of script.split('\n')) {
    const match = PLAIN_ASSIGNMENT_RE.exec(rawLine.trimEnd())
    if (match === null) {
      logForDebugging('Session environment is not all plain assignments')
      return new Map()
    }
    const [, key, rawVal] = match
    if (key === undefined || rawVal === undefined) continue
    const val = rawVal.replace(
      UNQUOTE_RE,
      (_, single: string | undefined, dbl: string | undefined) =>
        single ?? dbl?.replace(/\\([$`"\\])/g, '$1') ?? '',
    )
    if (platform === 'windows' && HAS_PATH_SEP_RE.test(val)) {
      result.delete(key)
    } else {
      result.set(key, val)
    }
  }
  return result
}

async function readPlainSessionEnvAssignments(): Promise<Map<string, string>> {
  const parts: string[] = []
  const envFile = process.env.CLAUDE_ENV_FILE
  if (envFile) {
    try {
      const content = (await readFile(envFile, 'utf8')).trim()
      if (content) parts.push(content)
    } catch (e) {
      if (getErrnoCode(e) !== 'ENOENT') {
        logForDebugging(`Failed to read CLAUDE_ENV_FILE: ${String(e)}`)
      }
    }
  }
  const sessionEnvDir = join(
    getClaudeConfigHomeDir(),
    'session-env',
    getSessionId(),
  )
  try {
    const files = (await readdir(sessionEnvDir))
      .filter(f => HOOK_ENV_FILE_RE.test(f))
      .sort((a, b) => {
        const ma = a.match(HOOK_ENV_FILE_RE)
        const mb = b.match(HOOK_ENV_FILE_RE)
        const pa = HOOK_PHASE_ORDER[ma?.[1] ?? ''] ?? 99
        const pb = HOOK_PHASE_ORDER[mb?.[1] ?? ''] ?? 99
        if (pa !== pb) return pa - pb
        return parseInt(ma?.[2] || '0', 10) - parseInt(mb?.[2] || '0', 10)
      })
    for (const file of files) {
      try {
        const content = (
          await readFile(join(sessionEnvDir, file), 'utf8')
        ).trim()
        if (content) parts.push(content)
      } catch (e) {
        if (getErrnoCode(e) !== 'ENOENT') {
          logForDebugging(`Failed to read hook env file ${file}: ${String(e)}`)
        }
      }
    }
  } catch (e) {
    if (getErrnoCode(e) !== 'ENOENT') {
      logForDebugging(`Failed to list session-env dir: ${String(e)}`)
    }
  }
  if (parts.length === 0) return new Map()
  return parsePlainEnvAssignments(parts.join('\n'))
}

/**
 * densable Arg — default child env for PowerShell tool (#22 Python stdin).
 * Applied only when the process env does not already define the key.
 */
export const POWERSHELL_DEFAULT_ENV: Readonly<Record<string, string>> = {
  PYTHONIOENCODING: 'utf-8:surrogateescape',
  NO_COLOR: '1',
}

/**
 * densable vrg — skip Erg when the command already opens with a statement
 * form that must be the first token (using / param / begin… / type literal).
 */
export function shouldSkipPowerShellEncodingPreamble(command: string): boolean {
  let i = 0
  for (;;) {
    while (i < command.length && /[\s;]/.test(command[i]!)) i++
    if (command[i] === '#') {
      while (i < command.length && command[i] !== '\n') i++
      continue
    }
    if (command.startsWith('<#', i)) {
      const end = command.indexOf('#>', i + 2)
      i = end === -1 ? command.length : end + 2
      continue
    }
    break
  }
  const rest = command.slice(i)
  return (
    /^using\s+(namespace|module|assembly)\b/i.test(rest) ||
    /^param\s*\(/i.test(rest) ||
    /^(begin|process|end|clean|dynamicparam)\s*\{/i.test(rest) ||
    (/^\[\w/.test(rest) && !/^\[[\w.]+\]::/.test(rest))
  )
}

/**
 * PowerShell invocation flags + command. Shared by the provider's getSpawnArgs
 * and the hook spawn path in hooks.ts so the flag set stays in one place.
 * Official: inject -ExecutionPolicy Bypass unless
 * CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY is set.
 */
export function buildPowerShellArgs(cmd: string): string[] {
  return [...buildPowerShellInvocationFlags(), '-Command', cmd]
}

/**
 * Base64-encode a string as UTF-16LE for PowerShell's -EncodedCommand.
 * Same encoding the parser uses (parser.ts toUtf16LeBase64). The output
 * is [A-Za-z0-9+/=] only — survives ANY shell-quoting layer, including
 * @anthropic-ai/sandbox-runtime's shellquote.quote() which would otherwise
 * corrupt !$? to \!$? when re-wrapping a single-quoted string in double
 * quotes. Review 2964609818.
 */
function encodePowerShellCommand(psCommand: string): string {
  return Buffer.from(psCommand, 'utf16le').toString('base64')
}

export function createPowerShellProvider(shellPath: string): ShellProvider {
  let currentSandboxTmpDir: string | undefined

  return {
    type: 'powershell' as ShellProvider['type'],
    shellPath,
    detached: false,
    // densable 2.1.214 #21 — child waiting on stdin must not hang the tool
    stdin: 'ignore',

    async buildExecCommand(
      command: string,
      opts: {
        id: number | string
        sandboxTmpDir?: string
        useSandbox: boolean
      },
    ): Promise<{ commandString: string; cwdFilePath: string }> {
      // Stash sandboxTmpDir for getEnvironmentOverrides (mirrors bashProvider)
      currentSandboxTmpDir = opts.useSandbox ? opts.sandboxTmpDir : undefined

      // When sandboxed, tmpdir() is not writable — the sandbox only allows
      // writes to sandboxTmpDir. Put the cwd tracking file there so the
      // inner pwsh can actually write it. Only applies on Linux/macOS/WSL2;
      // on Windows native, sandbox is never enabled so this branch is dead.
      const cwdFilePath =
        opts.useSandbox && opts.sandboxTmpDir
          ? (getPlatform() === 'windows' ? join : posixJoin)(
              opts.sandboxTmpDir,
              `claude-pwd-ps-${opts.id}`,
            )
          : join(tmpdir(), `claude-pwd-ps-${opts.id}`)
      // densable nnt — single-quote path for PS literal (escape ' as '')
      const escapedCwdFilePath = cwdFilePath.replace(/'/g, "''")
      // Exit-code capture: prefer $LASTEXITCODE when a native exe ran.
      // densable: FullLanguage uses $host.SetShouldExit; constrained uses exit.
      const cwdTracking = `\n; $_ec = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }\n; (Get-Location).Path | Out-File -FilePath '${escapedCwdFilePath}' -Encoding utf8 -NoNewline\n; if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') { $host.SetShouldExit($_ec) } else { exit $_ec }`
      // densable: l = (vrg(r) ? "" : Erg) + r + s
      const preamble = shouldSkipPowerShellEncodingPreamble(command)
        ? ''
        : POWERSHELL_ENCODING_PREAMBLE
      const psCommand = preamble + command + cwdTracking

      // Sandbox wraps the returned commandString as `<binShell> -c '<cmd>'` —
      // hardcoded `-c`, no way to inject -NoProfile -NonInteractive. So for
      // the sandbox path, build a command that itself invokes pwsh with the
      // full flag set. Shell.ts passes /bin/sh as the sandbox binShell,
      // producing: bwrap ... sh -c 'pwsh -NoProfile ... -EncodedCommand ...'.
      // The non-sandbox path returns the bare PS command; getSpawnArgs() adds
      // the flags via buildPowerShellArgs().
      //
      // densable: EncodedCommand only when sandboxed AND not windows.
      // -EncodedCommand (base64 UTF-16LE), not -Command: the sandbox runtime
      // applies its OWN shellquote.quote() on top of whatever we build.
      const commandString =
        opts.useSandbox && getPlatform() !== 'windows'
          ? [
              `'${shellPath.replace(/'/g, `'\\''`)}'`,
              ...buildPowerShellInvocationFlags(),
              '-EncodedCommand',
              encodePowerShellCommand(psCommand),
            ].join(' ')
          : psCommand

      return { commandString, cwdFilePath }
    },

    getSpawnArgs(commandString: string): string[] {
      return buildPowerShellArgs(commandString)
    },

    async getEnvironmentOverrides(): Promise<Record<string, string>> {
      const env: Record<string, string> = {}
      const settingsEnv = getSettings_DEPRECATED()?.env ?? {}
      // #521 SEA E7i: Load plain env assignments from CLAUDE_ENV_FILE / hooks
      // before checking FORCE_COLOR and before /env overrides.
      const plainHookEnv = await readPlainSessionEnvAssignments()
      // densable Arg defaults — only when not already present on process.env.
      // #383 SEA: Skip NO_COLOR when FORCE_COLOR is explicitly set (ignoring
      // daemon-injected FORCE_COLOR=3 unless configured in settings.env).
      const forceColorPresent =
        (process.env.FORCE_COLOR !== undefined &&
          !shouldStripDaemonForceColor(settingsEnv)) ||
        plainHookEnv.has('FORCE_COLOR') ||
        getSessionEnvVars().has('FORCE_COLOR')
      for (const [key, value] of Object.entries(POWERSHELL_DEFAULT_ENV)) {
        if (process.env[key] !== undefined) continue
        if (key === 'NO_COLOR' && forceColorPresent) continue
        env[key] = value
      }
      for (const [key, value] of plainHookEnv) {
        env[key] = value
      }
      // Apply session env vars set via /env (child processes only, not
      // the REPL). Without this, `/env PATH=...` affects Bash tool
      // commands but not PowerShell — so PyCharm users with a stripped
      // PATH can't self-rescue.
      // Ordering: session vars after Arg & CLAUDE_ENV_FILE so /env can override;
      // sandbox TMPDIR still wins last.
      for (const [key, value] of getSessionEnvVars()) {
        env[key] = value
      }
      if (currentSandboxTmpDir) {
        // PowerShell on Linux/macOS honors TMPDIR for [System.IO.Path]::GetTempPath()
        env.TMPDIR = currentSandboxTmpDir
        env.CLAUDE_CODE_TMPDIR = currentSandboxTmpDir
      }
      return env
    },
  }
}

// ============================================================================
// Official 2.1.327 #487 (`jco` / `WEa` / `qco` / `zco` @298070200):
// Pre-warm a waiting PowerShell process on Windows to save ~0.5s per command.
// ============================================================================

export const PS_HANDOVER_PATH_ENV = 'CLAUDE_CODE_PS_HANDOVER_PATH'
export const PS_HANDOVER_KEY_ENV = 'CLAUDE_CODE_PS_HANDOVER_KEY'
const STARTING_MARK_SUFFIX = '.starting'
const WAITING_PS_MAX_AGE_MS = 120_000
const WAITING_PS_READY_TIMEOUT_MS = 10_000
const WAITING_PS_HANDOVER_CLEANUP_DELAY_MS = 5_000
export const MAX_UNFIT_WAITING_PS = 4
export const MAX_FAILED_WAITING_PS = 3
const MAX_IDLE_SKIP_POWERSHELLS = 16

const VOLATILE_HANDOVER_ENV_KEYS = new Set([
  PS_HANDOVER_PATH_ENV,
  PS_HANDOVER_KEY_ENV,
])

export type WaitingPowerShellLaunch = {
  powershellPath: string
  cwd: string
  env: Record<string, string | undefined>
}

export type WaitingPowerShellDiscardReason = 'unused' | 'unfit' | 'ended_early'

export type PowerShellHeadStartState = {
  isPowerShellHeadStartAsked: boolean
  lastPowerShellLaunch: WaitingPowerShellLaunch | undefined
  waitingPowerShell: WaitingPowerShell | undefined
  isStartingWaitingPowerShell: boolean
  unfitWaitingPowerShells: number
  failedWaitingPowerShells: number
  idleWaitingPowerShells: number
  powerShellStartsToSkip: number
  commandsEnded: number
}

const headStartStateByHost = new HostSlot<PowerShellHeadStartState>(() => ({
  isPowerShellHeadStartAsked: false,
  lastPowerShellLaunch: undefined,
  waitingPowerShell: undefined,
  isStartingWaitingPowerShell: false,
  unfitWaitingPowerShells: 0,
  failedWaitingPowerShells: 0,
  idleWaitingPowerShells: 0,
  powerShellStartsToSkip: 0,
  commandsEnded: 0,
}))

function getHeadStartState(): PowerShellHeadStartState {
  return headStartStateByHost.of(getBootstrapSessionHost())
}

/** Official `uSe`: stable JSON fingerprint of launch env excluding volatile keys. */
export function normalizeWaitingPowerShellEnv(
  env: Record<string, string | undefined>,
): string {
  return JSON.stringify(
    Object.entries(env)
      .filter(([k, v]) => v !== undefined && !VOLATILE_HANDOVER_ENV_KEYS.has(k))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
}

/** Official `Uco`: true iff two PowerShell launches have matching executable, cwd, and env. */
export function waitingPowerShellLaunchesMatch(
  a: WaitingPowerShellLaunch,
  b: WaitingPowerShellLaunch,
): boolean {
  return (
    a.powershellPath === b.powershellPath &&
    a.cwd === b.cwd &&
    normalizeWaitingPowerShellEnv(a.env) ===
      normalizeWaitingPowerShellEnv(b.env)
  )
}

/** Compute uppercase SHA-256 HMAC protecting the handover script file. */
export function computePowerShellHandOverHmac(
  keyHex: string,
  payload: string,
): string {
  return createHmac('sha256', keyHex)
    .update(payload)
    .digest('hex')
    .toUpperCase()
}

/**
 * Bootstrap script run by a waiting PowerShell process: removes the `.starting`
 * sentinel once the PS runtime is initialized, polls the handover file until
 * the host writes `<HMAC>\n<script>`, verifies HMAC-SHA256, and executes it.
 */
export function buildWaitingPowerShellBootstrapScript(): string {
  return [
    `$__ccPath = $env:${PS_HANDOVER_PATH_ENV}`,
    `$__ccKey = $env:${PS_HANDOVER_KEY_ENV}`,
    `Remove-Item Env:${PS_HANDOVER_PATH_ENV}, Env:${PS_HANDOVER_KEY_ENV} -ErrorAction SilentlyContinue`,
    `Remove-Item -LiteralPath ($__ccPath + '${STARTING_MARK_SUFFIX}') -Force -ErrorAction SilentlyContinue`,
    `$__ccDeadline = [DateTime]::UtcNow.AddMilliseconds(${WAITING_PS_MAX_AGE_MS})`,
    `while ($true) {`,
    `  if ([DateTime]::UtcNow -ge $__ccDeadline) { exit 0 }`,
    `  if (-not (Test-Path -LiteralPath $__ccPath)) { exit 0 }`,
    `  $__ccRaw = ''`,
    `  try { $__ccFs = [System.IO.File]::Open($__ccPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)); $__ccSr = $null; try { $__ccSr = [System.IO.StreamReader]::new($__ccFs, [System.Text.Encoding]::UTF8); $__ccRaw = $__ccSr.ReadToEnd() } finally { if ($null -ne $__ccSr) { $__ccSr.Dispose() }; $__ccFs.Dispose() } } catch { $__ccRaw = '' }`,
    `  if ($__ccRaw.Length -gt 0) { break }`,
    `  Start-Sleep -Milliseconds 10`,
    `}`,
    `$__ccNl = $__ccRaw.IndexOf([char]10)`,
    `if ($__ccNl -lt 0) { exit 1 }`,
    `$__ccSig = $__ccRaw.Substring(0, $__ccNl).Trim()`,
    `$__ccBody = $__ccRaw.Substring($__ccNl + 1)`,
    `$__ccHmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($__ccKey))`,
    `$__ccCalc = ([BitConverter]::ToString($__ccHmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($__ccBody))) -replace '-', '').ToUpperInvariant()`,
    `if ($__ccCalc -ne $__ccSig) { exit 1 }`,
    `Remove-Variable __ccPath, __ccKey, __ccDeadline, __ccFs, __ccSr, __ccRaw, __ccNl, __ccSig, __ccHmac, __ccCalc -ErrorAction SilentlyContinue`,
    `$Error.Clear()`,
    `Invoke-Expression -Command ($__ccBody + [char]10 + 'if (-not $? -and -not (Test-Path variable:_ec)) { $host.SetShouldExit(1) }')`,
  ].join('; ')
}

export class WaitingPowerShell {
  readonly taskId: string
  readonly outputPath: string
  readonly handOverFile: { path: string; key: string; fd: number }
  readonly launch: WaitingPowerShellLaunch
  readonly child: ChildProcess
  readonly startedAt: number
  private readonly state: PowerShellHeadStartState
  private readonly waitLimit: ReturnType<typeof setTimeout>
  private readonly unregisterCleanup: () => void
  private readonly commandsEndedAtStart: number
  private isSettled = false
  private errorOrExitCounted = false
  private hitWaitLimit = false
  private isHandOverFileOpen = true

  constructor(
    taskId: string,
    outputPath: string,
    handOverFile: { path: string; key: string; fd: number },
    launch: WaitingPowerShellLaunch,
    child: ChildProcess,
    state: PowerShellHeadStartState = getHeadStartState(),
    now: () => number = Date.now,
  ) {
    this.taskId = taskId
    this.outputPath = outputPath
    this.handOverFile = handOverFile
    this.launch = launch
    this.child = child
    this.state = state
    this.startedAt = now()
    this.commandsEndedAtStart = state.commandsEnded
    this.unregisterCleanup = registerCleanup(() => this.discard('unused'))
    this.waitLimit = setTimeout(() => {
      this.hitWaitLimit = true
      this.state.powerShellStartsToSkip = Math.min(
        2 ** ++this.state.idleWaitingPowerShells - 1,
        MAX_IDLE_SKIP_POWERSHELLS,
      )
      void this.discard('unused')
    }, WAITING_PS_MAX_AGE_MS)
    this.waitLimit.unref()
    if (child.listenerCount('error') === 0) {
      child.once('error', () => {
        void this.handleSpawnError()
      })
    }
    child.once('exit', () => {
      if (!this.isSettled && !this.errorOrExitCounted) {
        this.errorOrExitCounted = true
        this.state.failedWaitingPowerShells++
      }
      this.settle()
      this.removeHandOverFiles()
    })
  }

  async handleSpawnError(): Promise<void> {
    if (!this.isSettled && !this.errorOrExitCounted) {
      this.errorOrExitCounted = true
      this.state.failedWaitingPowerShells++
    }
    await this.discard('ended_early')
  }

  get startingMarkPath(): string {
    return this.handOverFile.path + STARTING_MARK_SUFFIX
  }

  isAlive(): boolean {
    return (
      this.child.pid !== undefined &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    )
  }

  hasWaitedTooLong(now: () => number = Date.now): boolean {
    return now() - this.startedAt >= WAITING_PS_MAX_AGE_MS || this.hitWaitLimit
  }

  isWaiting(now: () => number = Date.now): boolean {
    return !this.isSettled && this.isAlive() && !this.hasWaitedTooLong(now)
  }

  isIn(cwd: string): boolean {
    return cwd === this.launch.cwd
  }

  stopWaitLimit(): void {
    clearTimeout(this.waitLimit)
  }

  hasOutlastedACommand(): boolean {
    return this.commandsEndedAtStart !== this.state.commandsEnded
  }

  async isReady(signal?: AbortSignal): Promise<boolean> {
    while (!this.isSettled && this.isAlive() && signal?.aborted !== true) {
      const markExists = await access(this.startingMarkPath).then(
        () => true,
        () => false,
      )
      if (!markExists) {
        return access(this.handOverFile.path).then(
          () => true,
          () => false,
        )
      }
      if (Date.now() - this.startedAt > WAITING_PS_READY_TIMEOUT_MS) {
        return false
      }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return false
  }

  /** Official `jco.fits`: verify the waiting process matches launch & script constraints. */
  fits(launch: WaitingPowerShellLaunch, script: string): boolean {
    if (!this.isAlive() || this.hasOutlastedACommand()) {
      void this.discard('unused')
      return false
    }
    const ok =
      waitingPowerShellLaunchesMatch(launch, this.launch) &&
      !script.includes('\x00')
    if (!ok) {
      this.state.unfitWaitingPowerShells++
      void this.discard('unfit')
    }
    return ok
  }

  /** Official `jco.handOver`: write HMAC-signed script into handover file and transfer child. */
  handOver(
    env: Record<string, string | undefined>,
    script: string,
  ): ChildProcess {
    if (
      this.isSettled ||
      !this.isAlive() ||
      normalizeWaitingPowerShellEnv(env) !==
        normalizeWaitingPowerShellEnv(this.launch.env)
    ) {
      throw new Error(
        "This command didn't run. Its shell ended, or its environment changed, as it was starting. Run it again.",
      )
    }
    const sig = computePowerShellHandOverHmac(this.handOverFile.key, script)
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- atomic handover write to open fd
      writeFileSync(this.handOverFile.fd, `${sig}\n${script}`)
    } catch (err) {
      logForDebugging(`The hand-over to a waiting PowerShell failed: ${err}`)
      this.wipeHandOverFile()
      this.state.failedWaitingPowerShells = MAX_FAILED_WAITING_PS
      void this.discard('ended_early')
      throw new Error(
        "This command couldn't be handed to the shell, and the shell was ended. Check whether the command had begun, then run it again.",
      )
    }
    this.state.failedWaitingPowerShells = 0
    this.state.idleWaitingPowerShells = 0
    const cleanupTimer = setTimeout(
      () => this.removeHandOverFiles(),
      WAITING_PS_HANDOVER_CLEANUP_DELAY_MS,
    )
    cleanupTimer.unref()
    this.settle()
    return this.child
  }

  async discard(_reason: WaitingPowerShellDiscardReason): Promise<void> {
    if (this.isSettled) return
    this.settle()
    if (this.isAlive()) {
      try {
        this.child.kill()
      } catch {
        // ignore kill errors
      }
    }
    this.removeHandOverFiles()
    await unlink(this.outputPath).catch(() => {})
  }

  private settle(): void {
    if (this.isSettled) return
    this.isSettled = true
    clearTimeout(this.waitLimit)
    this.unregisterCleanup()
  }

  private removeHandOverFiles(): void {
    this.wipeHandOverFile()
    for (const p of [this.handOverFile.path, this.startingMarkPath]) {
      void unlink(p).catch(() => {})
    }
  }

  private wipeHandOverFile(): void {
    if (!this.isHandOverFileOpen) return
    this.isHandOverFileOpen = false
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- scrub handover fd on teardown
      ftruncateSync(this.handOverFile.fd, 0)
    } catch {
      // ignore truncate errors
    }
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- close handover fd on teardown
      closeSync(this.handOverFile.fd)
    } catch {
      // ignore close errors
    }
  }
}

/** Official `zco`: remember the most recent Windows PowerShell launch configuration. */
export function recordPowerShellCommandLaunch(
  launch: WaitingPowerShellLaunch,
): void {
  const headStartState = getHeadStartState()
  const prev = headStartState.lastPowerShellLaunch
  if (prev !== undefined && waitingPowerShellLaunchesMatch(prev, launch)) {
    headStartState.unfitWaitingPowerShells = 0
  }
  headStartState.lastPowerShellLaunch = launch
}

export function markPowerShellCommandEnded(): void {
  getHeadStartState().commandsEnded++
}

export type StartWaitingPowerShellOptions = {
  taskId: string
  outputPath: string
  sandboxEnabled: boolean
  platform?: ReturnType<typeof getPlatform>
}

/**
 * Official 2.1.327 #487 (`WEa`): spawn a pre-warmed waiting PowerShell process
 * on Windows when head-start is enabled and sandbox is off.
 */
export async function startWaitingPowerShell(
  opts: StartWaitingPowerShellOptions,
): Promise<boolean> {
  const headStartState = getHeadStartState()
  headStartState.isPowerShellHeadStartAsked = true
  const platform = opts.platform ?? getPlatform()
  if (platform !== 'windows') return false
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_SHELL_HEAD_START)) {
    return false
  }
  if (opts.sandboxEnabled) return false
  const launch = headStartState.lastPowerShellLaunch
  if (
    launch === undefined ||
    headStartState.isStartingWaitingPowerShell ||
    headStartState.waitingPowerShell?.isWaiting() === true ||
    headStartState.unfitWaitingPowerShells >= MAX_UNFIT_WAITING_PS ||
    headStartState.failedWaitingPowerShells >= MAX_FAILED_WAITING_PS
  ) {
    return false
  }
  if (headStartState.powerShellStartsToSkip > 0) {
    headStartState.powerShellStartsToSkip--
    return false
  }
  headStartState.isStartingWaitingPowerShell = true
  let outputHandle: Awaited<ReturnType<typeof open>> | undefined
  let handOverPath: string | undefined
  let handOverFd: number | undefined
  try {
    await headStartState.waitingPowerShell?.discard('unused')
    headStartState.waitingPowerShell = undefined
    outputHandle = await open(opts.outputPath, 'wx')
    handOverPath = join(tmpdir(), `claude-ps-handover-${randomUUID()}`)
    const key = randomBytes(32).toString('hex')
    // eslint-disable-next-line custom-rules/no-sync-fs -- exclusive handover file creation
    handOverFd = openSync(handOverPath, 'wx')
    // eslint-disable-next-line custom-rules/no-sync-fs -- create starting sentinel
    writeFileSync(handOverPath + STARTING_MARK_SUFFIX, '', { flag: 'wx' })
    const bootstrapScript = buildWaitingPowerShellBootstrapScript()
    const env: NodeJS.ProcessEnv = {
      ...launch.env,
      [PS_HANDOVER_PATH_ENV]: handOverPath,
      [PS_HANDOVER_KEY_ENV]: key,
    }
    const child = spawn(
      launch.powershellPath,
      buildPowerShellArgs(bootstrapScript),
      {
        cwd: launch.cwd,
        env,
        stdio: ['ignore', outputHandle.fd, outputHandle.fd],
        detached: false,
        windowsHide: true,
      },
    )
    let waiting: WaitingPowerShell | undefined
    child.once('error', err => {
      logForDebugging(`Waiting PowerShell process error: ${err}`)
      if (waiting !== undefined) {
        void waiting.handleSpawnError()
      } else {
        headStartState.failedWaitingPowerShells++
      }
    })
    void outputHandle.close().catch(() => {})
    outputHandle = undefined
    waiting = new WaitingPowerShell(
      opts.taskId,
      opts.outputPath,
      { path: handOverPath, key, fd: handOverFd },
      launch,
      child,
      headStartState,
    )
    headStartState.waitingPowerShell = waiting
    handOverFd = undefined
    handOverPath = undefined
    return true
  } catch (err) {
    headStartState.failedWaitingPowerShells++
    logForDebugging(`A PowerShell could not be started ahead: ${err}`)
    return false
  } finally {
    headStartState.isStartingWaitingPowerShell = false
    if (outputHandle !== undefined) {
      await outputHandle.close().catch(() => {})
      await unlink(opts.outputPath).catch(() => {})
    }
    if (handOverFd !== undefined) {
      try {
        // eslint-disable-next-line custom-rules/no-sync-fs -- cleanup on error
        closeSync(handOverFd)
      } catch {
        // ignore
      }
    }
    if (handOverPath !== undefined) {
      await unlink(handOverPath).catch(() => {})
      await unlink(handOverPath + STARTING_MARK_SUFFIX).catch(() => {})
    }
  }
}

/** Official `qco`: claim the waiting PowerShell if it is in `cwd` and ready. */
export async function takeWaitingPowerShell(
  cwd: string,
  signal?: AbortSignal,
): Promise<WaitingPowerShell | undefined> {
  const headStartState = getHeadStartState()
  const waiting = headStartState.waitingPowerShell
  if (waiting === undefined || !waiting.isIn(cwd)) return undefined
  headStartState.waitingPowerShell = undefined
  waiting.stopWaitLimit()
  if (waiting.hasWaitedTooLong() || waiting.hasOutlastedACommand()) {
    await waiting.discard('unused')
    return undefined
  }
  if (await waiting.isReady(signal)) {
    return waiting
  }
  if (!signal?.aborted && waiting.isAlive()) {
    headStartState.failedWaitingPowerShells = MAX_FAILED_WAITING_PS
  }
  await waiting.discard(signal?.aborted ? 'unused' : 'ended_early')
  return undefined
}

export function getWaitingPowerShellState(): Readonly<PowerShellHeadStartState> {
  return getHeadStartState()
}

export async function resetWaitingPowerShellForTesting(): Promise<void> {
  const headStartState = getHeadStartState()
  const existing = headStartState.waitingPowerShell
  headStartState.waitingPowerShell = undefined
  await existing?.discard('unused')
  headStartState.isPowerShellHeadStartAsked = false
  headStartState.lastPowerShellLaunch = undefined
  headStartState.isStartingWaitingPowerShell = false
  headStartState.unfitWaitingPowerShells = 0
  headStartState.failedWaitingPowerShells = 0
  headStartState.idleWaitingPowerShells = 0
  headStartState.powerShellStartsToSkip = 0
  headStartState.commandsEnded = 0
}
