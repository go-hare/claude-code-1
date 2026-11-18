import { readdir, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { join as posixJoin } from 'path/posix'
import { getSessionId } from 'src/bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import {
  getClaudeConfigHomeDir,
  shouldStripDaemonForceColor,
} from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { getPlatform } from '../platform.js'
import { buildPowerShellInvocationFlags } from '../powershellExecutionPolicy.js'
import { getSessionEnvVars } from '../sessionEnvVars.js'
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
