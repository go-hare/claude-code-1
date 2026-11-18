/**
 * Command semantics configuration for interpreting exit codes in PowerShell.
 *
 * densable 2.1.214 #24 (u9u / Qhs / Lny / Pny / F7r):
 * - External grep/rg/findstr/robocopy always use informational exit codes.
 * - where.exe / fc.exe / diff.exe only when the token has a native .exe
 *   extension AND stdout/stderr is non-empty (bare `where`/`fc`/`diff` are
 *   PowerShell aliases — do not treat alias exit codes as "no match").
 * - git grep / git diff subcommands map to the same informational semantics.
 */

import { COMMON_ALIASES } from 'src/utils/powershell/parser.js'

export type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => {
  isError: boolean
  message?: string
}

/** densable Rny */
const DEFAULT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode !== 0,
  message:
    exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
})

/** densable F7r — exit 0 or 1 is non-error; 1 carries an informational message */
function informationalExit1(messageOn1: string): CommandSemantic {
  return (exitCode, _stdout, _stderr) => ({
    isError: exitCode !== 0 && exitCode !== 1,
    message: exitCode === 1 ? messageOn1 : undefined,
  })
}

/** densable Air */
const NO_MATCHES = informationalExit1('No matches found')
/** densable Dny */
const FILES_DIFFER = informationalExit1('Files differ')

/**
 * densable Pny — always applied (no .exe gate).
 */
const ALWAYS_SEMANTICS: Map<string, CommandSemantic> = new Map([
  ['grep', NO_MATCHES],
  ['rg', NO_MATCHES],
  ['egrep', NO_MATCHES],
  ['fgrep', NO_MATCHES],
  ['findstr', NO_MATCHES],
  [
    'robocopy',
    (exitCode, _stdout, _stderr) => ({
      // densable: isError: e < 0 || e >= 8
      isError: exitCode < 0 || exitCode >= 8,
      message:
        exitCode === 0
          ? 'No files copied (already in sync)'
          : exitCode >= 1 && exitCode < 8
            ? exitCode & 1
              ? 'Files copied successfully'
              : 'Robocopy completed (no errors)'
            : undefined,
    }),
  ],
])

/**
 * densable Lny — only when nativeExt === "exe" AND (stdout||stderr) non-empty.
 */
const NATIVE_EXE_SEMANTICS: Map<string, CommandSemantic> = new Map([
  ['where', informationalExit1('No matching files found')],
  ['fc', FILES_DIFFER],
  ['diff', FILES_DIFFER],
])

/**
 * densable Qhs — base command + optional native extension.
 */
export function parseNativeCommandToken(segment: string): {
  base: string
  nativeExt: 'exe' | 'cmd' | 'bat' | null
  hadNativeExt: boolean
} {
  const stripped = segment.trim().replace(/^[&.]\s+/, '')
  const quoted = /^"([^"]*)"|^'([^']*)'/.exec(stripped)
  const firstToken =
    quoted?.[1] ??
    quoted?.[2] ??
    (stripped.split(/\s+/)[0] || '').replace(/^["']|["']$/g, '')
  const basename = (firstToken.split(/[\\/]/).pop() || firstToken).toLowerCase()
  const nativeExt =
    (['exe', 'cmd', 'bat'] as const).find(ext =>
      basename.endsWith(`.${ext}`),
    ) ?? null
  return {
    base: nativeExt
      ? basename.slice(0, -(nativeExt.length + 1))
      : basename.replace(/\.exe$/, ''),
    nativeExt,
    hadNativeExt: nativeExt !== null,
  }
}

/** SEA `Hds` (@292279392) — formatting/pass-through cmdlets at tail of a pipeline */
const FORMAT_PASSTHROUGH_CMDLETS = new Set([
  'select-object',
  'sort-object',
  'group-object',
  'get-unique',
  'format-table',
  'format-list',
  'format-wide',
  'out-string',
  'out-host',
])

/**
 * SEA `S5n` (@292279597) — split PowerShell command into segments, tracking
 * `&&` gating and walking back past formatting cmdlets at the tail of a pipeline.
 */
export function splitCommandSegments(command: string): {
  segment: string
  andGated: boolean
  feeder: string | undefined
} {
  const segments: Array<{ text: string; andGated: boolean; piped: boolean }> =
    []
  let start = 0
  let andGated = false
  let piped = false
  let canWalkPipe = true
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (inSingle) {
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '`') {
        i++
        continue
      }
      if (ch === '"') inDouble = false
      continue
    }
    // # after space/tab/start/newline starts a comment to EOL
    if (
      ch === '#' &&
      (i === 0 ||
        command[i - 1] === ' ' ||
        command[i - 1] === '\t' ||
        command[i - 1] === '\n' ||
        command[i - 1] === '\r')
    ) {
      segments.push({ text: command.slice(start, i), andGated, piped })
      while (
        i + 1 < command.length &&
        command[i + 1] !== '\n' &&
        command[i + 1] !== '\r'
      ) {
        i++
      }
      start = i + 1
      piped = false
      continue
    }
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (
      ch === '(' ||
      ch === ')' ||
      ch === '{' ||
      ch === '}' ||
      (ch === '>' && command.slice(i - 1, i + 3) !== '2>&1')
    ) {
      canWalkPipe = false
    }
    if (ch === ';' || ch === '|' || ch === '\n' || ch === '\r') {
      if (ch === '|' && command[i + 1] === '|') {
        canWalkPipe = false
      }
      segments.push({ text: command.slice(start, i), andGated, piped })
      start = i + 1
      piped = ch === '|'
      if (!piped) andGated = false
      continue
    }
    if (ch === '&') {
      if (command[i + 1] === '&') {
        segments.push({ text: command.slice(start, i), andGated, piped })
        i++
        start = i + 1
        andGated = true
        piped = false
        canWalkPipe = false
        continue
      }
      const prev = command[i - 1]
      if (
        (prev === ' ' || prev === '\t') &&
        command.slice(start, i).trim() !== ''
      ) {
        segments.push({ text: command.slice(start, i), andGated, piped })
        start = i + 1
        andGated = false
        piped = false
      }
    }
  }
  segments.push({ text: command.slice(start), andGated, piped })
  const lastIdx = segments.findLastIndex(s => s.text.trim())
  const last = segments[lastIdx]
  if (!last) {
    return { segment: command, andGated: false, feeder: undefined }
  }
  let idx = lastIdx
  while (canWalkPipe && idx > 0 && segments[idx]!.piped) {
    const cmd =
      /^\s*([\w-]+)(?=\s|$)/.exec(segments[idx]!.text)?.[1]?.toLowerCase() ?? ''
    const canonical = COMMON_ALIASES[cmd]?.toLowerCase() ?? cmd
    if (!FORMAT_PASSTHROUGH_CMDLETS.has(canonical)) break
    idx--
  }
  const feederText = segments[idx]!.text
  return {
    segment: last.text,
    andGated: last.andGated,
    feeder: idx !== lastIdx && feederText.trim() ? feederText : undefined,
  }
}

/**
 * densable Mny — last pipeline/statement segment drives exit code.
 * Respects single/double quotes and PowerShell backticks inside doubles.
 */
export function lastCommandSegment(command: string): string {
  return splitCommandSegments(command).segment
}

/** densable Ony — first non-flag token after `git` */
function gitSubcommand(segment: string): string | null {
  const stripped = segment.trim().replace(/^[&.]\s+/, '')
  const tokens = stripped.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  // skip git / path-to-git.exe
  let i = 0
  if (tokens.length === 0) return null
  i = 1
  while (i < tokens.length) {
    const t = tokens[i]!.replace(/^["']|["']$/g, '')
    if (t.startsWith('-')) {
      // git -C path … / --git-dir=…
      if (t === '-C' || t === '--git-dir' || t === '--work-tree') {
        i += 2
        continue
      }
      i++
      continue
    }
    return t.toLowerCase()
  }
  return null
}

/**
 * SEA `tks` + `R5n` (@292289201) — interpret PowerShell command result.
 */
export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): {
  isError: boolean
  message?: string
} {
  const split = splitCommandSegments(command)
  const hasOutput = stdout.trim() !== '' || stderr.trim() !== ''
  const segment = (hasOutput ? undefined : split.feeder) ?? split.segment
  const { base, nativeExt } = parseNativeCommandToken(segment)

  let result: { isError: boolean; message?: string } | undefined
  if (base === 'git') {
    const sub = gitSubcommand(segment)
    if (sub === 'grep') result = NO_MATCHES(exitCode, stdout, stderr)
    else if (sub === 'diff') result = FILES_DIFFER(exitCode, stdout, stderr)
  }

  if (!result) {
    const nativeSemantic =
      nativeExt === 'exe' && hasOutput
        ? NATIVE_EXE_SEMANTICS.get(base)
        : undefined
    const semantic =
      nativeSemantic ?? ALWAYS_SEMANTICS.get(base) ?? DEFAULT_SEMANTIC
    result = semantic(exitCode, stdout, stderr)
  }

  if (exitCode === 0 || result.isError) return result
  if (split.andGated) {
    return DEFAULT_SEMANTIC(exitCode, stdout, stderr)
  }
  return result
}
