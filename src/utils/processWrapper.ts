/**
 * Official CLAUDE_CODE_PROCESS_WRAPPER densable (2.1.208 G9 / Hsg / Psg / qCe).
 *
 * Env is an argv list (quoted shell words OR JSON string array), NOT a shell
 * command. When set and valid, self-spawns are prefixed with the launcher so
 * sessions stay under the wrapper (tmux, asdf, mise, custom launchers, …).
 *
 * Windows: env is ignored (platform cannot exec-into Claude Code the same way).
 */

import { accessSync, constants as fsConstants, statSync } from 'fs'
import { isAbsolute, join } from 'path'
import { isInBundledMode } from './bundledMode.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'

export const PROCESS_WRAPPER_ENV_KEY = 'CLAUDE_CODE_PROCESS_WRAPPER'

/** Official Dsg — unquoted shell metacharacters are rejected. */
export const PROCESS_WRAPPER_METACHARS = ';|&$()`<>'

export type ProcessWrapperParseResult = {
  argv: string[]
  error: string | null
  platformIgnored: boolean
  /** Space-joined record for status / diagnostics (quotes when needed). */
  record: string
}

const EMPTY_RESULT: ProcessWrapperParseResult = {
  argv: [],
  error: null,
  platformIgnored: false,
  record: '',
}

function formatError(message: string): ProcessWrapperParseResult {
  return {
    argv: [],
    error: `${PROCESS_WRAPPER_ENV_KEY}: ${message}`,
    platformIgnored: false,
    record: '',
  }
}

/**
 * Official Psg — parse env value to argv list.
 * Accepts JSON `["/path/launcher","--flag"]` or shell-word form with double quotes.
 */
export function parseProcessWrapperValue(raw: string): string[] {
  const t = raw.trim()
  if (t === '') return []

  if (t.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(t)
    } catch {
      throw new Error('value starts with `[` but is not valid JSON')
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every((a): a is string => typeof a === 'string')
    ) {
      throw new Error('JSON form must be an array of strings')
    }
    if (parsed.length > 0 && parsed.some(a => a === '')) {
      if (parsed.every(a => a === '')) return []
      throw new Error(
        'the JSON array contains an empty element — remove it, or fill in the value it was a placeholder for',
      )
    }
    return parsed
  }

  const out: string[] = []
  let cur = ''
  let inToken = false
  let inQuote = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!
    if (inQuote) {
      if (ch === '\\' && (t[i + 1] === '"' || t[i + 1] === '\\')) {
        cur += t[++i]!
      } else if (ch === '"') {
        inQuote = false
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      inQuote = true
      inToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (inToken) {
        out.push(cur)
        cur = ''
        inToken = false
      }
      continue
    }
    if (PROCESS_WRAPPER_METACHARS.includes(ch)) {
      throw new Error(
        'the value contains an unquoted shell metacharacter (one of ; | & $ ( ) ` < >) — it is an argv list, not a shell command',
      )
    }
    cur += ch
    inToken = true
  }
  if (inQuote) throw new Error('unterminated double quote')
  if (inToken) out.push(cur)
  if (out.length > 0 && out.some(s => s === '')) {
    if (out.every(s => s === '')) return []
    throw new Error(
      'the value contains an empty `""` token — remove it, or fill in the value it was a placeholder for',
    )
  }
  return out
}

function quoteRecordToken(token: string): string {
  if (/[\s"]/.test(token)) {
    return `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return token
}

/**
 * Official Hsg densable — validate parsed argv against platform + filesystem.
 * Pure-ish: uses process.execPath / platform and sync fs checks.
 */
export function validateProcessWrapperArgv(
  raw: string,
  opts?: {
    platform?: NodeJS.Platform
    execPath?: string
    claudeBinPath?: string
  },
): ProcessWrapperParseResult {
  const platform = opts?.platform ?? process.platform
  if (platform === 'win32') {
    return {
      argv: [],
      error: null,
      platformIgnored: true,
      record: '',
    }
  }

  let argv: string[]
  try {
    argv = parseProcessWrapperValue(raw)
  } catch (e) {
    return formatError(e instanceof Error ? e.message : String(e))
  }

  if (argv.length === 0) {
    return formatError(
      'the value is set but contains no launcher — unset the variable to run without one, or set it to the absolute path of your launcher',
    )
  }

  const launcher = argv[0]!
  const execPath = opts?.execPath ?? process.execPath
  const claudeBin =
    opts?.claudeBinPath ?? join(getClaudeConfigHomeDir(), 'claude')
  if (launcher === execPath || launcher === claudeBin) {
    return formatError(
      `launcher \`${launcher}\` is Claude Code's own launch path — point ${PROCESS_WRAPPER_ENV_KEY} at your launcher, not at claude`,
    )
  }
  if (!isAbsolute(launcher)) {
    return formatError(
      'the launcher must be an absolute path, not a bare name resolved via PATH',
    )
  }
  try {
    const st = statSync(launcher)
    if (!st.isFile() || (st.mode & 0o111) === 0) {
      return formatError(
        `launcher \`${launcher}\` is not an executable regular file`,
      )
    }
  } catch {
    return formatError(
      `launcher \`${launcher}\` does not exist or is not readable`,
    )
  }

  return {
    argv,
    error: null,
    platformIgnored: false,
    record: argv.map(quoteRecordToken).join(' '),
  }
}

// --- process-level cache (official sUr / Btt / p5i) ---

let cachedRaw: string | undefined
let cachedResult: ProcessWrapperParseResult = EMPTY_RESULT

/**
 * Official sUr — resolve PROCESS_WRAPPER from env with cache + log on new error.
 */
export function resolveProcessWrapper(
  env: NodeJS.ProcessEnv = process.env,
): ProcessWrapperParseResult {
  const raw = env[PROCESS_WRAPPER_ENV_KEY]
  if (!raw) return EMPTY_RESULT

  // When using non-process env injection, skip process-level cache.
  if (env !== process.env) {
    return validateProcessWrapperArgv(raw)
  }

  const prevError = raw === cachedRaw ? cachedResult.error : null
  if (raw === cachedRaw && prevError === null) {
    return cachedResult
  }
  cachedRaw = raw
  cachedResult = validateProcessWrapperArgv(raw)
  if (cachedResult.error && cachedResult.error !== prevError) {
    logForDebugging(
      `${PROCESS_WRAPPER_ENV_KEY} is set but can't be used — self-spawns that require it will refuse to start rather than run unwrapped: ${cachedResult.error}`,
      { level: 'error' },
    )
  } else if (cachedResult.platformIgnored) {
    logForDebugging(
      `${PROCESS_WRAPPER_ENV_KEY} is set but ignored on Windows — the launcher must exec into Claude Code, which Windows can't do; sessions run unwrapped`,
      { level: 'warn' },
    )
  }
  return cachedResult
}

/** Official J_ — wrapper argv (empty if unset/invalid). */
export function getProcessWrapperArgv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return resolveProcessWrapper(env).argv
}

/** Official $0 for process wrapper — error string or null. */
export function getProcessWrapperError(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return resolveProcessWrapper(env).error
}

/** Official Tj — diagnostic record string. */
export function getProcessWrapperRecord(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveProcessWrapper(env).record
}

/** Clear process-level cache (tests). */
export function resetProcessWrapperCache(): void {
  cachedRaw = undefined
  cachedResult = EMPTY_RESULT
}

/**
 * Official qCe densable — prefix a self-spawn with the process wrapper when set.
 * No-op when wrapper empty or already the same cmd.
 */
export function applyProcessWrapperToLaunch(
  launch: {
    cmd: string
    prefixArgs: string[]
    target?: string
  },
  env: NodeJS.ProcessEnv = process.env,
): {
  cmd: string
  prefixArgs: string[]
  target?: string
} {
  const wrapper = getProcessWrapperArgv(env)
  if (wrapper.length === 0 || launch.cmd === wrapper[0]) {
    return launch
  }
  return {
    cmd: wrapper[0]!,
    prefixArgs: [...wrapper.slice(1), launch.cmd, ...launch.prefixArgs],
    target: launch.target,
  }
}

/**
 * Base self-exec without wrapper (official Mwt simplified for fork).
 * Bundled binary → execPath alone; script mode → execPath + argv[1].
 */
export function getBaseSelfLaunch(): {
  cmd: string
  prefixArgs: string[]
  target: string
} {
  if (isInBundledMode()) {
    return {
      cmd: process.execPath,
      prefixArgs: [],
      target: process.execPath,
    }
  }
  const script = process.argv[1]
  if (!script) {
    return {
      cmd: process.execPath,
      prefixArgs: [],
      target: process.execPath,
    }
  }
  return {
    cmd: process.execPath,
    prefixArgs: [script],
    target: script,
  }
}

/**
 * Official _M densable — base self-launch with process wrapper applied.
 */
export function getSelfLaunch(env: NodeJS.ProcessEnv = process.env): {
  cmd: string
  prefixArgs: string[]
  target: string
} {
  const base = getBaseSelfLaunch()
  const wrapped = applyProcessWrapperToLaunch(base, env)
  return {
    cmd: wrapped.cmd,
    prefixArgs: wrapped.prefixArgs,
    target: wrapped.target ?? base.target,
  }
}

/**
 * Official bj densable — true when wrapper is unset OR first argv is executable.
 * False when misconfigured or not runnable.
 */
export function isProcessWrapperRunnable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (getProcessWrapperError(env) !== null) return false
  const first = getProcessWrapperArgv(env)[0]
  if (!first) return true
  try {
    const st = statSync(first)
    if (!st.isFile()) return false
    accessSync(first, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Official agent_launcher relaunch refuse message when wrapper is set but
 * not runnable (deleted / not executable / misconfigured).
 */
export function formatProcessWrapperRelaunchRefuseMessage(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (isProcessWrapperRunnable(env)) return null
  const err = getProcessWrapperError(env)
  if (err) return err
  const launcher = getProcessWrapperArgv(env)[0]
  if (!launcher) return null
  return `${PROCESS_WRAPPER_ENV_KEY}: launcher \`${launcher}\` was deleted or is not executable — restore it (or fix the setting), then start claude again`
}

/**
 * Official daemon/status densable lines for PROCESS_WRAPPER.
 *
 * When misconfigured: single refuse line.
 * When set and valid: Self-exec line; if launcher became unrunnable, extra refuse.
 * Empty when wrapper unset.
 */
export function formatProcessWrapperStatusLines(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const record = getProcessWrapperRecord(env)
  const error = getProcessWrapperError(env)
  if (!record && !error) return []

  if (error) {
    return [
      `${error} — nothing will run unwrapped: new background sessions are refused unless a background service that validated an earlier value is still serving them (\`claude daemon status\` shows it)`,
    ]
  }

  const launch = getSelfLaunch(env)
  const lines = [
    `Self-exec: \`${[launch.cmd, ...launch.prefixArgs].join(' ')}\` (${PROCESS_WRAPPER_ENV_KEY})`,
  ]
  if (!isProcessWrapperRunnable(env)) {
    lines.push(
      `The launcher \`${launch.cmd}\` cannot run right now (deleted or not executable) — new background sessions are refused until it is restored; a background service that validated it earlier keeps serving its existing sessions (\`claude daemon status\`)`,
    )
  }
  return lines
}
