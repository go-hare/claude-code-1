/**
 * Official Claude Code 2.1.331 Bash dangerous `rm` variable-path guard
 * (`ZQ`, `Ast`, `Bkn`, `Hkn`, `Ukn`, `HLr`, `KPs`).
 *
 * When a Bash command matches `removalRule: 'variable_path'` or
 * `'var_root_child'`, `rewriteDangerousRmWithGuard` (`Ast`) rewrites the
 * target's variable expansion to `${VAR:?}` so an empty or unset variable fails
 * fast instead of expanding to `/`, `/*`, or `/etc`, etc.
 */

import isEqual from 'lodash-es/isEqual.js'
import { getIsNonInteractiveSession } from 'src/bootstrap/state.js'
import { getFeatureValueWithSource } from 'src/services/analytics/growthbook.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import type {
  PermissionAskDecision,
  PermissionDecisionReason,
} from 'src/types/permissions.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { isDangerousRemovalPath } from 'src/utils/permissions/pathValidation.js'
import { isRemovalWaiverAllowed } from 'src/utils/permissions/permissions.js'
import { getPlatform } from 'src/utils/platform.js'

/** Official `FLr`: GrowthBook gate controlling auto-guarding of `variable_path` rm asks. */
export const DANGEROUS_RM_GUARD_FLAG = 'tengu_purring_naur'

/** Official `bst`: max command length analyzed/rewritten by `Ast` / `Mst`. */
export const MAX_GUARDABLE_RM_COMMAND_LENGTH = 10_000

/** Official `Cst`: max reason string length before switching to generic fallback copy. */
export const MAX_GUARDED_RM_REASON_LENGTH = 300

const SHELL_PLACEHOLDER = '\uE020'
const ESCAPED_DOLLAR_MARKER = '\uE010'
const MAX_INLINE_SHELL_DEPTH = 2
const MAX_INVOCATION_DISPLAY_LENGTH = 120

const LOCAL_HOST_NAMES = new Set(['container', 'this-machine'])

/** Official `FIe`: shell keywords that can precede a command name. */
const SHELL_LEAD_KEYWORDS = new Set([
  'do',
  'then',
  'else',
  'elif',
  'if',
  'while',
  'until',
  '!',
  '{',
  'coproc',
])

/** Official `$Ie`: wrapper binaries/builtins peeled when locating `rm`/`rmdir`. */
const RM_WRAPPER_COMMANDS = new Set([
  'sudo',
  'doas',
  'exec',
  'command',
  'env',
  'nice',
  'nohup',
  'busybox',
  'time',
  'timeout',
  'stdbuf',
  'setsid',
  'ionice',
  'pkexec',
  'runuser',
  'eval',
  'xargs',
])

/** Official `PJe`: POSIX-like shells whose `-c` scripts may contain `rm`. */
const INLINE_SHELL_NAMES = [
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'ash',
  'hush',
  'rbash',
]

/** Official `myn`: top-level root child directories guarded against `$VAR/<dir>`. */
const ROOT_CHILD_DIRS =
  'bin|boot|dev|etc|home|lib|lib32|lib64|libx32|media|mnt|opt|proc|root|run|sbin|srv|sys|tmp|usr|var|snap|nix|lost\\+found|private|cores|Applications|Library|System|Users|Volumes|Windows|ProgramData|cygdrive'

/** Official `pyn`: variable expansion that becomes `/` or `/*` when empty. */
const EMPTY_VAR_ROOT_TARGET_RE =
  /^[\uE020"']*\$(?:\{[A-Za-z_][A-Za-z0-9_]*(?::?-(?:["']{2}|"?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"?)?)?\}|[A-Za-z_][A-Za-z0-9_]*)[\uE020"']*\\?\/(?:[*?[{]|\$|\/|["']|\uE020|$)/

/** Official `WOr`: positional/special variable expansion that becomes `/` when empty. */
const EMPTY_SPECIAL_VAR_ROOT_TARGET_RE =
  /^[\uE020"']*\$(?:\{(?:[0-9]+|[@*!])(?::?-(?:["']{2}|"?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"?)?)?\}|[0-9@*!])[\uE020"']*\\?\/(?:[*?[{]|\$|\/|["']|\uE020|$)/

/** Official `GOr`: complex parameter expansion whose result cannot be verified. */
const UNREAD_PARAM_EXPANSION_RE =
  /^[\uE020"']*\$\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*])(?:[%#/,^?](?:[^{}]|\{[^{}]*\})*|:[0-9](?:[^{}]|\{[^{}]*\})*|:?\+(?:[^{}]|\{[^{}]*\})*|:?=(?:["']{2}|"?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"?)?|:?[-=]["']?\/[/.]*["']?)\}[\uE020"']*\\?\/(?:[*?[{]|\$|\/|["']|\uE020|$)/

/** Official `zOr`: variable expansion followed by a root child directory (e.g. `$VAR/etc`). */
const VAR_ROOT_CHILD_TARGET_RE = new RegExp(
  String.raw`^[\uE020"']*\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?::?-(?:["']{2}|"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?)?)?\}|([A-Za-z_][A-Za-z0-9_]*))[\uE020"']*\\?\/(${ROOT_CHILD_DIRS})(?:[\\/]+\*+)*\/?[\uE020"']*$`,
  'i',
)

/** Official `syn`: target removes everything under the variable (`$VAR/*`, `"$VAR"/*`). */
const WHOLE_TREE_VAR_TARGET_RE =
  /^("?)\$(?:[A-Za-z_]\w*|[1-9@*!]|\{(?:[A-Za-z_]\w*|[1-9][0-9]*|[@*!])(?::?-)?\})\1\/+\*$/

/** Official `SOr`: simple `$VAR` or `${VAR}` eligible for `${VAR:?}` rewriting. */
const GUARDABLE_VAR_EXPANSION_RE =
  /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*)(?![\w{[:]))/g

const SIMPLE_REDIRECT_RE = String.raw`[ \t]*(?:\d*|&)>>?[ \t]*(?:&\d|[\w./-]+(?![\w./-]))`
const TRAILING_DELIM_RE = String.raw`(?:[ \t]+#|[ \t]*(?:$|[;\n|)]|&(?!>)))`
const TRAILING_FLAGS_AND_REDIRECTS_RE = new RegExp(
  `^(?:[ \\t]+-{1,2}[A-Za-z][A-Za-z-]*|${SIMPLE_REDIRECT_RE})*${TRAILING_DELIM_RE}`,
)
const TRAILING_REDIRECTS_ONLY_RE = new RegExp(
  `^(?:${SIMPLE_REDIRECT_RE})*${TRAILING_DELIM_RE}`,
)

/** Official `wst`: well-known environment variables not rewritten by `Ast`. */
export const WELL_KNOWN_NONEMPTY_ENV_VARS = new Set([
  'HOME',
  'USERPROFILE',
  'HOMEPATH',
  'HOMEDRIVE',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'WINDIR',
  'PROGRAMFILES',
  'PROGRAMW6432',
  'PROGRAMDATA',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'HOMESHARE',
  'XDG_RUNTIME_DIR',
  'PWD',
  'OLDPWD',
  'TMPDIR',
  'TMP',
  'TEMP',
])

const DERIVED_CMD_RE =
  /^\s*(?:(cd|pwd|dirname)(?![A-Za-z0-9_-])|git\s+(rev-parse)\b)/
const VAR_ASSIGN_RE = /(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=/g
const UNSET_RE =
  /(?:^|[;&|({\n]|\b(?:then|do|else|elif)\b|!)[ \t]*unset[ \t]+(?:-[a-z][ \t]+)*((?:[A-Za-z_][A-Za-z0-9_]*[ \t]*)+)/g
const FOR_LOOP_RE =
  /(?:^|[;&|({\n]|\b(?:then|do|else|elif)\b)\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]*)/g
const FUNC_DEF_RE =
  /(?:^|[;&|(\n])[ \t]*(?:function[ \t]+[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*[ \t]*\([ \t]*\))/
const SET_POSITIONAL_RE =
  /(?:^|[;&|(\n])[ \t]*set[ \t]+--[ \t]+(?!["']{2}(?:[\s;&|]|$)|["']?\$)[^\s;&|]/
const INLINE_SHELL_DASH_C_RE = new RegExp(
  String.raw`(?:^|[\s;&|(])(?:[^\s=]*\/)?(?:busybox\s+)?(?:${INLINE_SHELL_NAMES.join('|')})\s+(?:(?:--?|\+)[A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z0-9_][A-Za-z0-9_-]*)?\s+)*-[A-Za-z]*c[A-Za-z]*\s+(?:--\s+)?\$?(["'])`,
  'gi',
)
const FIND_PREDICATE_STOP_RE =
  /^-(?:exec|execdir|ok|okdir|name|iname|path|ipath|regex|prune|type|maxdepth|mindepth|newer|mtime|mmin|size|print0?|delete|o|a|not|and|or)$/

const MASKED_CHARS = ';|&\n\r()` \t'
const MASKED_BASE = 0xe001
const MASKED_CHARS_RE = new RegExp(
  `[\\u${MASKED_BASE.toString(16)}-\\u${(MASKED_BASE + MASKED_CHARS.length - 1).toString(16)}]`,
  'g',
)

export type DangerousRemovalRule =
  | 'variable_path'
  | 'var_root_child'
  | 'variable_path_set_in_command'
  | 'derived_var'
  | 'unparsed_line'
  | 'inline_shell_unchecked'
  | 'critical_path'
  | 'mounted_drive_path'
  | 'multi_level_glob'
  | 'emptyExpansion'

export type DangerousVariableRmMatch = {
  command: 'rm' | 'rmdir'
  target: string
  invocation: string
  reparsed: boolean
  rootChild?: string
  unreadExpansionOf?: string
  assigned?: boolean
  derived?: { becomes: string; value: string }
  removalRule:
    | 'variable_path'
    | 'var_root_child'
    | 'variable_path_set_in_command'
    | 'derived_var'
}

export type GuardedRmRewrite = {
  line: string
  variables: string
  wholeTree: boolean
  nameUsedElsewhere: boolean
}

export type SafetyCheckDecisionReason = Extract<
  PermissionDecisionReason,
  { type: 'safetyCheck' }
> & {
  removalRule?: string
}

export type GuardedPermissionAskDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> = PermissionAskDecision<Input> & {
  judgedInput?: Input
  hostDisplay?: unknown
}

function isEscapedInQuote(
  text: string,
  index: number,
  quote: string | null,
): boolean {
  if (quote === "'") return false
  if (quote === null) return true
  const next = text[index + 1]
  return next === '"' || next === '\\' || next === '$' || next === '`'
}

/** Official `Pce(e, n)`: quote state (`'` | `"` | `null`) at character index `n`. */
export function quoteStateAtIndex(
  text: string,
  index: number,
): "'" | '"' | null {
  let quote: "'" | '"' | null = null
  for (let i = 0; i < index && i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\' && isEscapedInQuote(text, i, quote)) {
      i++
      continue
    }
    if (quote === null) {
      if (ch === '"' || ch === "'") quote = ch
    } else if (ch === quote) {
      quote = null
    }
  }
  return quote
}

/** Official `TW(e, n)`: blank comments (and optionally quoted contents) while keeping indices aligned. */
export function maskShellCommentsAndQuotes(
  text: string,
  maskQuoted: boolean,
): string {
  let out = ''
  let quote: "'" | '"' | null = null
  let inComment = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inComment) {
      if (ch === '\n') {
        inComment = false
        out += ch
      } else {
        out += ' '
      }
      continue
    }
    if (quote === null) {
      if (ch === '\\') {
        out += ch + (text[i + 1] ?? '')
        i++
        continue
      }
      if (ch === '#' && (i === 0 || /[\s;&|()]/.test(text[i - 1]!))) {
        inComment = true
        out += ' '
        continue
      }
      if (ch === '"' || ch === "'") quote = ch
      out += ch
      continue
    }
    if (ch === '\\' && isEscapedInQuote(text, i, quote)) {
      out += maskQuoted ? '  ' : ch + (text[i + 1] ?? '')
      i++
      continue
    }
    if (ch === quote) {
      quote = null
      out += ch
      continue
    }
    out += maskQuoted ? ' ' : ch
  }
  return out
}

function isAlwaysPresumedEnvVar(name: string): boolean {
  return name === 'HOME' || name === 'PWD'
}

function matchVarRootChild(
  token: string,
  mayBeUnset: (name: string) => boolean,
): string | undefined {
  const normalized = token.replace(/\/(?:\.\/)+/g, '/').replace(/\/{2,}/g, '/')
  const match = VAR_ROOT_CHILD_TARGET_RE.exec(normalized)
  if (match === null) return undefined
  const primary = match[1] ?? match[3]
  const fallback = match[2]
  if (!primary) return undefined
  return mayBeUnset(primary) && (fallback === undefined || mayBeUnset(fallback))
    ? match[4]
    : undefined
}

function blankHeredocBodies(command: string): string {
  let text = command
  let masked = maskShellCommentsAndQuotes(text, true)
  const heredocRe = /(?:^|[^<$(])<<(?!<)/g
  for (let m = heredocRe.exec(masked); m !== null; m = heredocRe.exec(masked)) {
    const start = m.index + m[0].length - 2
    const header = /^<<-?\s*\\?["']?([A-Za-z_][A-Za-z0-9_]*)["']?[^\n]*\n/.exec(
      text.slice(start),
    )
    if (header === null) continue
    const bodyStart = start + header[0].length
    const delimiterRe = new RegExp(String.raw`^\t*${header[1]}[ \t]*$`, 'm')
    const endMatch = delimiterRe.exec(text.slice(bodyStart))
    const bodyEnd =
      endMatch === null
        ? text.length
        : bodyStart + endMatch.index + endMatch[0].length
    text =
      text.slice(0, bodyStart) +
      text.slice(bodyStart, bodyEnd).replace(/[^\n]/g, ' ') +
      text.slice(bodyEnd)
    masked = maskShellCommentsAndQuotes(text, true)
    heredocRe.lastIndex = bodyEnd
  }
  return text
}

function joinLineContinuations(command: string): string {
  const masked = maskShellCommentsAndQuotes(command, true)
  let out = command
  for (let i = masked.length - 1; i > 0; i--) {
    if (
      masked[i] === '\n' &&
      masked[i - 1] === '\\' &&
      !(masked[i - 2] === '\\' && command[i - 1] === '\\')
    ) {
      out = out.slice(0, i - 1) + out.slice(i + 1)
    }
  }
  return out
}

function isRootishValue(raw: string): boolean {
  const unquoted = raw
    .replace(/^(["'])([\s\S]*)\1$/, '$2')
    .replace(/(.)\/+$/, '$1')
  const defaultVal = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}$`]*)\}$/.exec(
    unquoted,
  )?.[1]
  return (
    /^\/+$/.test(unquoted) ||
    /(?:^|\/)\.\.?\/*$/.test(unquoted) ||
    /^\$\{?HOME\}?$/.test(unquoted) ||
    (!/[$`]/.test(unquoted) && isDangerousRemovalPath(unquoted)) ||
    (defaultVal !== undefined &&
      defaultVal !== '' &&
      isDangerousRemovalPath(defaultVal))
  )
}

function scanAssignmentValueEnd(text: string, start: number): number {
  const scan = (trackParens: boolean): number | undefined => {
    let i = start
    let depth = 0
    let quote: string | null = null
    for (; i < text.length; i++) {
      const ch = text[i]!
      if (ch === '\\' && (quote === '`' || isEscapedInQuote(text, i, quote))) {
        i++
        continue
      }
      if (quote !== null) {
        if (ch === quote) quote = null
        continue
      }
      if (depth === 0 && (ch === '"' || ch === "'" || ch === '`')) {
        quote = ch
      } else if (
        trackParens &&
        (ch === '(' ||
          (ch === '{' &&
            text[i - 1] === '$' &&
            text[i - 2] !== '$' &&
            text[i - 2] !== '\\'))
      ) {
        depth++
      } else if (trackParens && (ch === ')' || ch === '}') && depth > 0) {
        depth--
      } else if (depth === 0 && /[\s;&|]/.test(ch)) {
        break
      }
    }
    return depth === 0 && quote === null ? i : undefined
  }
  return scan(true) ?? scan(false) ?? text.length
}

function scanPrefixAssignmentChain(
  masked: string,
  start: number,
): { end: number; prefix: boolean } {
  let i = start
  for (;;) {
    while (i < masked.length && (masked[i] === ' ' || masked[i] === '\t')) i++
    if (i >= masked.length || /[;\n)#]/.test(masked[i]!)) {
      return { end: i, prefix: false }
    }
    if (masked[i] === '&' || masked[i] === '|') {
      return { end: i, prefix: masked[i + 1] !== masked[i] }
    }
    const assign = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/.exec(
      masked.slice(i, i + 1024),
    )
    if (assign === null) return { end: i, prefix: true }
    i = scanAssignmentValueEnd(masked, i + assign[0].length)
  }
}

function isSimpleCdAndChain(rest: string): boolean {
  const parts = rest.split('&&')
  return parts[0]!.trim() === '' && parts.slice(1).every(p => !/[;|&]/.test(p))
}

function extractCommandSubstitutionInner(raw: string): string | undefined {
  const trimmed = raw.replace(/^"([\s\S]*)"$/, '$1').replace(/\/+$/, '')
  const backtick = /^`([^`]*)`$/.exec(trimmed)
  if (backtick !== null) return backtick[1]
  if (!trimmed.startsWith('$(')) return undefined
  let depth = 0
  let quote: string | null = null
  for (let i = 1; i < trimmed.length; i++) {
    const ch = trimmed[i]!
    if (ch === '\\' && isEscapedInQuote(trimmed, i, quote)) {
      i++
    } else if (quote !== null) {
      quote = ch === quote ? null : quote
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '(') {
      depth++
    } else if (ch === ')' && --depth === 0) {
      return i === trimmed.length - 1 ? trimmed.slice(2, i) : undefined
    }
  }
  return undefined
}

type AssignmentAnalysis = {
  set: Set<string>
  emptied: Set<string>
  rootValued: Set<string>
  derived: Map<string, { value: string; becomes: string }>
}

/** Official `Mst(e, n)`: analyze variable assignments/unsets/for-loops before `rm`. */
function analyzeAssignments(
  command: string,
  mayBeUnset: (name: string) => boolean,
): AssignmentAnalysis {
  const truncated =
    command.length > MAX_GUARDABLE_RM_COMMAND_LENGTH
      ? command.slice(0, MAX_GUARDABLE_RM_COMMAND_LENGTH)
      : command
  const cleaned = joinLineContinuations(
    blankHeredocBodies(truncated.replace(/[\uE000-\uF8FF]/g, '')),
  )
  const maskedAll = maskShellCommentsAndQuotes(cleaned, true)
  const maskedComments = maskShellCommentsAndQuotes(cleaned, false)
  const lastRmIdx = /(?:^|[\s;&|({])trap\s+(?:--\s+)?\$?'[^']*\brm\b/.test(
    maskedComments,
  )
    ? cleaned.length
    : Math.max(
        ...[...maskedComments.matchAll(/\brm(?:dir)?\b/gi)].map(
          m => m.index ?? -1,
        ),
        -1,
      )

  const setVars = new Set<string>()
  const explicitlyEmptied = new Set<string>()
  const maybeEmptied = new Set<string>()
  const rootValued = new Set<string>()
  const derived = new Map<string, { value: string; becomes: string }>()

  const isUnsetNow = (name: string): boolean =>
    explicitlyEmptied.has(name) ||
    maybeEmptied.has(name) ||
    (!setVars.has(name) && !isAlwaysPresumedEnvVar(name) && mayBeUnset(name))

  type Event = {
    index: number
    names: string[]
    bound: boolean | null
    rootish: boolean
    until: number
  }
  const events: Event[] = [
    ...[...maskedAll.matchAll(UNSET_RE)].map(m => ({
      index: m.index ?? 0,
      names: m[1]!.trim().split(/\s+/),
      bound: false as boolean | null,
      rootish: false,
      until: -1,
    })),
    ...[...maskedAll.matchAll(FOR_LOOP_RE)].map(m => {
      const idx = m.index ?? 0
      const end = idx + m[0].length
      const listRaw = cleaned.slice(end - m[2]!.length, end).trim()
      const boundNonEmpty =
        listRaw !== '' &&
        !/""|''/.test(listRaw) &&
        !/(?:^|\s)"[^"]*[$`][^"]*"(?=\s|$)/.test(listRaw)
      const doneMatch = /[$`]/.test(listRaw)
        ? /\bdone\b/.exec(maskedAll.slice(end))
        : null
      return {
        index: idx,
        names: [m[1]!],
        bound: boundNonEmpty ? true : null,
        rootish:
          boundNonEmpty && !/\s/.test(listRaw) && isRootishValue(listRaw),
        until: doneMatch === null ? -1 : end + doneMatch.index,
      }
    }),
  ]
    .flatMap(ev =>
      ev.until >= 0
        ? [ev, { ...ev, index: ev.until, bound: null, rootish: false }]
        : [ev],
    )
    .filter(ev => ev.index < lastRmIdx)
    .sort((a, b) => a.index - b.index)

  const applyEventsBefore = (limit: number): void => {
    while (events.length > 0 && events[0]!.index < limit) {
      const ev = events.shift()!
      for (const name of ev.names) {
        setVars.delete(name)
        explicitlyEmptied.delete(name)
        maybeEmptied.delete(name)
        rootValued.delete(name)
        derived.delete(name)
        if (ev.bound === true) {
          setVars.add(name)
          if (ev.rootish) rootValued.add(name)
        } else if (ev.bound === false) {
          explicitlyEmptied.add(name)
        }
      }
    }
  }

  let prevEnd = 0
  type ChainState = { end: number; prefix: boolean; conditional: boolean }
  let chainState: ChainState | null = null
  let delimEnd = 0
  let afterOr = false
  let newlineReset = 0
  let scanPos = 0

  VAR_ASSIGN_RE.lastIndex = 0
  for (
    let m = VAR_ASSIGN_RE.exec(maskedAll);
    m !== null && m.index < lastRmIdx;
    m = VAR_ASSIGN_RE.exec(maskedAll)
  ) {
    const varName = m[1]!
    const valueStart = m.index + m[0].length
    const valueEnd = scanAssignmentValueEnd(cleaned, valueStart)
    VAR_ASSIGN_RE.lastIndex = valueEnd
    const assignStart = valueStart - varName.length - 1
    for (; scanPos < assignStart; scanPos++) {
      const ch = maskedAll[scanPos]!
      if (
        ch === '\n' &&
        afterOr &&
        maskedAll.slice(delimEnd, scanPos).trim() === ''
      ) {
        newlineReset = scanPos + 1
        continue
      }
      if (/[;&|(\n]/.test(ch)) {
        delimEnd = scanPos + 1
        afterOr = ch === '|' && maskedAll[scanPos - 1] === '|'
      }
    }
    const stmtStart = Math.max(prevEnd, delimEnd, newlineReset)
    const activeChain: ChainState | null =
      chainState !== null && assignStart < chainState.end ? chainState : null
    const isConditional =
      activeChain !== null
        ? activeChain.conditional
        : delimEnd >= prevEnd && afterOr
    if (
      !/^[\s)]*(?:(?:do|then|else|elif|if|while|until|time|!|\{)\s+)*(?:(?:export|local|declare|typeset|readonly)(?:\s+-\w+)*\s+)?$/.test(
        cleaned.slice(stmtStart, assignStart),
      )
    ) {
      continue
    }
    prevEnd = valueEnd
    const nextChain: ChainState = activeChain ?? {
      ...scanPrefixAssignmentChain(maskedAll, valueEnd),
      conditional: isConditional,
    }
    chainState = nextChain
    if (nextChain.prefix) continue

    applyEventsBefore(assignStart)
    const rawValue = cleaned.slice(valueStart, valueEnd)
    const cmdSub = extractCommandSubstitutionInner(rawValue)
    let derivedBecomes: string | undefined
    if (cmdSub !== undefined) {
      const derivedMatch = DERIVED_CMD_RE.exec(cmdSub)
      if (derivedMatch?.[2] === 'rev-parse') {
        derivedBecomes = 'prints a git value such as the repository root'
      } else if (derivedMatch?.[1] === 'pwd') {
        derivedBecomes = 'prints the current directory'
      } else if (
        derivedMatch?.[1] === 'dirname' ||
        derivedMatch?.[1] === 'cd'
      ) {
        const argMatch = /^\s*(?:cd|dirname)\s+(?:--?\w*\s+)*([^\s;&|]*)/.exec(
          cmdSub,
        )
        const arg = argMatch?.[1]
        const parentOf = (p: string): string =>
          p.replace(/\/+[^/]*\/*$/, '') || (p.startsWith('/') ? '/' : '.')
        const safeStatic =
          argMatch !== null &&
          arg !== undefined &&
          arg !== '' &&
          !/[$`]/.test(arg) &&
          !/^(?:""|'')$/.test(arg) &&
          (derivedMatch[1] === 'dirname'
            ? !isDangerousRemovalPath(
                parentOf(arg.replace(/^(["'])(.*)\1$/, '$2')),
              )
            : isSimpleCdAndChain(cmdSub.slice(argMatch[0].length)))
        if (!safeStatic) {
          derivedBecomes =
            derivedMatch[1] === 'dirname'
              ? arg !== undefined && arg !== '' && !/[$`]/.test(arg)
                ? `prints ${parentOf(arg.replace(/^(["'])(.*)\1$/, '$2'))}`
                : 'prints the current directory (as `.`) when its input is empty'
              : 'prints the current directory when its input is empty (`cd ""` stays put)'
        }
      }
    } else if (!/[$`]/.test(rawValue) || /^"?\$\{?[A-Za-z_]/.test(rawValue)) {
      const child = matchVarRootChild(rawValue, isUnsetNow)
      if (child !== undefined) {
        derivedBecomes = `is /${child} when the variable in it is empty`
      } else if (EMPTY_VAR_ROOT_TARGET_RE.test(rawValue)) {
        derivedBecomes =
          'is the filesystem root when the variable in it is empty'
      }
    }

    const copiedFrom = /^"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?\/*$/.exec(
      rawValue,
    )?.[1]
    const inheritedDerived =
      copiedFrom === 'PWD'
        ? { value: rawValue, becomes: 'is the current directory' }
        : copiedFrom === undefined
          ? undefined
          : derived.get(copiedFrom)
    if (derivedBecomes !== undefined) {
      derived.set(varName, { value: rawValue, becomes: derivedBecomes })
    } else if (inheritedDerived !== undefined) {
      derived.set(varName, inheritedDerived)
    } else if (!isConditional) {
      derived.delete(varName)
    }

    const refVar =
      /^"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?(?:\/[^\s"'$`]*)?"?$/.exec(
        rawValue,
      )?.[1]
    const hasDotDot = /(?:^|\/)\.\.(?:\/|$)/.test(rawValue.replace(/["']/g, ''))
    const isEmptyLiteral = /^(?:""|''|\(\s*\))?$/.test(rawValue)
    const staticSegment = /\/([^\s/$`"')}]+)"?$/.exec(rawValue)?.[1]
    const defaultValue = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^\s}$`]+)\}"?$/.exec(
      rawValue.replace(/^"/, ''),
    )?.[1]
    const unsafeDefault =
      defaultValue === undefined ||
      /^(?:|\/+|(?:[^/]*\/)*\.\.?\/*)$/.test(
        defaultValue.replace(/^(["'])([\s\S]*)\1$/, '$2'),
      )
    const isNonEmpty =
      (!hasDotDot &&
        staticSegment !== undefined &&
        !/^[.?*[\]{}]+$/.test(staticSegment)) ||
      !unsafeDefault ||
      (refVar !== undefined && !hasDotDot
        ? !isUnsetNow(refVar)
        : !isEmptyLiteral && !/[$`]/.test(rawValue))

    const wasSet = setVars.has(varName)
    const wasRoot = rootValued.has(varName)
    setVars.delete(varName)
    explicitlyEmptied.delete(varName)
    maybeEmptied.delete(varName)
    rootValued.delete(varName)
    if (isNonEmpty && isConditional) {
      if (wasSet) {
        setVars.add(varName)
        if (wasRoot || isRootishValue(rawValue)) rootValued.add(varName)
      } else {
        maybeEmptied.add(varName)
      }
    } else if (isNonEmpty) {
      setVars.add(varName)
      if (
        isRootishValue(rawValue) ||
        (refVar !== undefined && rootValued.has(refVar))
      ) {
        rootValued.add(varName)
      }
    } else if (isEmptyLiteral) {
      explicitlyEmptied.add(varName)
    } else {
      maybeEmptied.add(varName)
    }
  }

  applyEventsBefore(Number.POSITIVE_INFINITY)
  return {
    set: setVars,
    emptied: new Set([...explicitlyEmptied, ...maybeEmptied]),
    rootValued,
    derived,
  }
}

function stripTrailingGlobAndSlash(token: string): string {
  let end = token.length
  while (end > 0 && /[\uE020"']/.test(token[end - 1]!)) end--
  let cut = end
  while (cut > 0 && /[/*.]/.test(token[cut - 1]!)) cut--
  return cut < end && token[cut] === '/' ? token.slice(0, cut) : token
}

function extractLeadingVarName(token: string): string | undefined {
  const m =
    /^[\uE020"']*\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?::?[?-][^}]*)?\}|([A-Za-z_][A-Za-z0-9_]*))[\uE020"']*$/.exec(
      token,
    )
  return m === null ? undefined : (m[1] ?? m[2])
}

function parseRmCommandWord(word: string): 'rm' | 'rmdir' | null {
  const base = word
    .replace(/[<>].*$/, '')
    .replace(/^\\/, '')
    .replace(/^[^\s=]*\//, '')
    .toLowerCase()
  return base === 'rm' ? 'rm' : base === 'rmdir' ? 'rmdir' : null
}

function maskQuotedDelimiters(segment: string): string {
  if (
    !segment.includes('"') &&
    !segment.includes("'") &&
    !/\\[ \t]/.test(segment)
  ) {
    return segment
  }
  if (quoteStateAtIndex(segment, segment.length) !== null) return segment
  let out = ''
  let quote: "'" | '"' | null = null
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!
    if (ch === '\\' && isEscapedInQuote(segment, i, quote)) {
      const next = segment[i + 1] ?? ''
      const mapped = quote === null ? MASKED_CHARS.indexOf(next) : -1
      out +=
        ch +
        (mapped !== -1 && (next === ' ' || next === '\t')
          ? String.fromCharCode(MASKED_BASE + mapped)
          : next)
      i++
      continue
    }
    if (quote === null) {
      if (ch === '"' || ch === "'") quote = ch
      out += ch
      continue
    }
    if (ch === quote) {
      quote = null
      out += ch
      continue
    }
    const mapped = MASKED_CHARS.indexOf(ch)
    out += mapped === -1 ? ch : String.fromCharCode(MASKED_BASE + mapped)
  }
  return out
}

function unmaskDelimiters(text: string): string {
  return text.replace(
    MASKED_CHARS_RE,
    ch => MASKED_CHARS[ch.charCodeAt(0) - MASKED_BASE] ?? ch,
  )
}

function stripQuotesAndUnmask(text: string): string {
  return unmaskDelimiters(text.replace(/['"]/g, ''))
}

function stripUnescapedTrailingParens(token: string): string {
  return token.replace(/(^|[^\\])\)+$/, '$1')
}

function formatDisplayTokens(tokens: string[]): string {
  return unmaskDelimiters(tokens.join(' '))
    .replaceAll(SHELL_PLACEHOLDER, '$(…)')
    .replace(/[\s\p{Cc}]+/gu, ' ')
}

function truncateDisplay(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit)
}

type RmCommandTokens = {
  command: 'rm' | 'rmdir'
  word: string
  tokens: string[]
  reparsed: boolean
}

function extractRmCommandFromSegment(
  segment: string,
  evalStrings: boolean,
): RmCommandTokens | null {
  const parts = segment.split(/\s+/).filter(t => t !== '')
  let idx = 0
  while (idx < parts.length) {
    const tok = parts[idx]!
    if (parseRmCommandWord(tok) !== null) break
    if (
      SHELL_LEAD_KEYWORDS.has(tok.toLowerCase()) ||
      /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(tok) ||
      /^[$\uE020]/.test(tok)
    ) {
      idx++
    } else if (/^[\d&]*[<>]/.test(tok)) {
      idx++
      if (/^(?:[0-9]+|&)?(?:>>?[|&]?|<<?<?|<>)$/.test(tok)) idx++
    } else {
      break
    }
  }
  const baseName = (tok: string): string =>
    tok
      .replace(/^\\/, '')
      .replace(/^[^\s=]*\//, '')
      .toLowerCase()
  let reparsed = false
  const stripEvalQuote = (tok: string): string =>
    evalStrings && reparsed ? tok.replace(/^\$?['"]/, '') : tok
  const isWrapper = (tok: string): boolean => {
    const b = baseName(stripEvalQuote(tok))
    return RM_WRAPPER_COMMANDS.has(b) || (evalStrings && b === 'trap')
  }
  while (idx < parts.length && isWrapper(parts[idx]!)) {
    const b = baseName(stripEvalQuote(parts[idx]!))
    reparsed ||= b === 'eval' || b === 'trap'
    idx++
    while (idx < parts.length) {
      const cur = stripEvalQuote(parts[idx]!)
      if (parseRmCommandWord(cur) !== null || isWrapper(cur)) break
      if (/^[\d&]*[<>]/.test(cur)) {
        idx++
        if (/^(?:[0-9]+|&)?(?:>>?[|&]?|<<?<?|<>)$/.test(cur)) idx++
        continue
      }
      if (cur.startsWith('-')) {
        idx++
        const next =
          parts[idx] === undefined ? undefined : stripEvalQuote(parts[idx]!)
        if (
          next !== undefined &&
          !next.startsWith('-') &&
          !next.includes('=') &&
          parseRmCommandWord(next) === null &&
          !isWrapper(next)
        ) {
          idx++
        }
        continue
      }
      if (
        /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(cur) ||
        /^\d/.test(cur) ||
        /^[$\uE020]/.test(cur)
      ) {
        idx++
        continue
      }
      break
    }
  }
  const cmd =
    idx < parts.length ? parseRmCommandWord(stripEvalQuote(parts[idx]!)) : null
  if (cmd === null) return null
  return {
    command: cmd,
    word: parts[idx]!,
    tokens: parts.slice(idx + 1),
    reparsed,
  }
}

type DetectionContext = {
  mayBeUnset: (name: string) => boolean
  derived: Map<string, { value: string; becomes: string }>
  assigned: Set<string>
  evalStrings: boolean
  skipAssignedOriginalHits?: boolean
}

function inspectRmTokens(
  cmdInfo: RmCommandTokens,
  allowPositional: boolean,
  inDoubleQuotes: boolean,
  reparsed: boolean,
  ctx: DetectionContext,
): DangerousVariableRmMatch | null {
  const { command, tokens } = cmdInfo
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!.replace(/[)\]}]+$/, '')
    if (
      raw === '' ||
      raw.startsWith('-') ||
      (!inDoubleQuotes && /^'[^']*\$/.test(raw))
    ) {
      continue
    }
    if (/^[\d&]*[<>]/.test(raw)) {
      if (/^(?:[0-9]+|&)?(?:>>?[|&]?|<<?<?|<>)$/.test(raw)) i++
      continue
    }
    const derivedHit = ctx.derived.get(
      extractLeadingVarName(stripTrailingGlobAndSlash(raw)) ?? '',
    )
    const rootChild = matchVarRootChild(raw, ctx.mayBeUnset)
    const rootVarHit =
      EMPTY_VAR_ROOT_TARGET_RE.test(raw) ||
      (allowPositional && EMPTY_SPECIAL_VAR_ROOT_TARGET_RE.test(raw))
    const varNameMatch = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/.exec(raw)?.[1] ?? ''
    const isAssigned = ctx.assigned.has(varNameMatch)
    if (rootVarHit && ctx.skipAssignedOriginalHits === true && isAssigned) {
      continue
    }
    const unreadMatch = UNREAD_PARAM_EXPANSION_RE.exec(raw)?.[1]
    const unreadExpansionOf =
      ctx.evalStrings &&
      unreadMatch !== undefined &&
      !ctx.assigned.has(unreadMatch) &&
      unreadMatch !== 'HOME' &&
      (allowPositional || /^[A-Za-z_]/.test(unreadMatch))
        ? unreadMatch
        : undefined
    if (
      rootVarHit ||
      rootChild !== undefined ||
      derivedHit !== undefined ||
      unreadExpansionOf !== undefined
    ) {
      const target = formatDisplayTokens([
        stripUnescapedTrailingParens(tokens[i]!),
      ])
      const invTokens = [
        cmdInfo.word,
        ...tokens.slice(0, -1),
        stripUnescapedTrailingParens(tokens.at(-1) ?? ''),
      ]
      const fullInv = formatDisplayTokens(invTokens)
      let invocation = fullInv
      if (fullInv.length > MAX_INVOCATION_DISPLAY_LENGTH) {
        const prefix = truncateDisplay(fullInv, MAX_INVOCATION_DISPLAY_LENGTH)
        invocation =
          formatDisplayTokens(invTokens.slice(0, i + 2)).length <=
          MAX_INVOCATION_DISPLAY_LENGTH
            ? `${prefix}…`
            : `${prefix}… ${target}`
      }
      const removalRule: DangerousVariableRmMatch['removalRule'] =
        derivedHit !== undefined
          ? 'derived_var'
          : unreadExpansionOf !== undefined
            ? 'variable_path'
            : rootChild !== undefined
              ? 'var_root_child'
              : rootVarHit && isAssigned
                ? 'variable_path_set_in_command'
                : 'variable_path'
      return {
        command,
        target,
        invocation,
        reparsed: reparsed || cmdInfo.reparsed,
        ...(rootChild !== undefined ? { rootChild } : {}),
        ...(unreadExpansionOf !== undefined ? { unreadExpansionOf } : {}),
        ...(rootVarHit && isAssigned ? { assigned: true } : {}),
        ...(derivedHit !== undefined
          ? {
              derived: {
                becomes: derivedHit.becomes,
                value: (() => {
                  const normalized = derivedHit.value.replace(
                    /[\s\p{Cc}]+/gu,
                    ' ',
                  )
                  return normalized.length > MAX_INVOCATION_DISPLAY_LENGTH
                    ? `${truncateDisplay(normalized, MAX_INVOCATION_DISPLAY_LENGTH)}…`
                    : normalized
                })(),
              },
            }
          : {}),
        removalRule,
      }
    }
  }
  return null
}

function scanInlineShellSegment(
  segment: string,
  allowPositional: boolean,
  depth: number,
  ctx: DetectionContext,
): DangerousVariableRmMatch | null {
  const balancedQuotes = quoteStateAtIndex(segment, segment.length) === null
  for (const m of segment.matchAll(INLINE_SHELL_DASH_C_RE)) {
    const startIdx = m.index ?? 0
    if (balancedQuotes && quoteStateAtIndex(segment, startIdx) !== null) {
      continue
    }
    const openQuote = m[1]!
    let cursor = startIdx + m[0].length - 1
    let quote: "'" | '"' | null = null
    const chunks: Array<{ q: "'" | '"' | null; text: string }> = []
    let buf = ''
    for (; cursor < segment.length; cursor++) {
      const ch = segment[cursor]!
      if (ch === '\\' && isEscapedInQuote(segment, cursor, quote)) {
        buf += ch + (segment[cursor + 1] ?? '')
        cursor++
        continue
      }
      if (quote === null) {
        if (/\s/.test(ch)) break
        if (ch === '"' || ch === "'") {
          if (buf !== '') {
            chunks.push({ q: quote, text: buf })
            buf = ''
          }
          quote = ch
          continue
        }
      } else if (ch === quote) {
        chunks.push({ q: quote, text: buf })
        buf = ''
        quote = null
        continue
      }
      buf += ch
    }
    if (buf !== '') chunks.push({ q: quote, text: buf })

    const decoded = unmaskDelimiters(
      chunks
        .map(c =>
          c.q === '"'
            ? c.text
                .replace(/\\(["\\$`])/g, (_all, esc: string) =>
                  esc === '$' ? ESCAPED_DOLLAR_MARKER : esc,
                )
                .replace(/\uE010(?=[A-Za-z_]|\{[A-Za-z_])/g, '$')
                .replace(/\\+(?=\$)/g, '')
            : c.q === "'"
              ? `'${c.text}'`
              : c.text,
        )
        .join(''),
    )
    const afterArgs = segment
      .slice(cursor)
      .replace(/\\ /g, '\uE022')
      .replace(/(?:^|\s)[\d&]*(?:>>?[|&]?|<<?<?|<>|&>)(?:\S+|\s+\S+)/g, ' ')
      .replace(/\s*(?:\\;|\\|\+)\s*$/, '')
      .trim()
    const hasExtraPositionalArgs =
      (afterArgs !== '' && afterArgs.split(/\s+/).length >= 2) ||
      /(?:^|\s)xargs(?:\s+(?!-[In]\b)\S+)*\s*$/.test(segment.slice(0, startIdx))

    let scriptBody = decoded
    let nextAllowPositional: boolean
    if (openQuote === '"') {
      if (!hasExtraPositionalArgs) {
        scriptBody = scriptBody.replaceAll(ESCAPED_DOLLAR_MARKER, '$')
      }
      nextAllowPositional = allowPositional || !hasExtraPositionalArgs
    } else {
      scriptBody = scriptBody.replace(/^'([\s\S]*)'$/, '$1')
      nextAllowPositional = !hasExtraPositionalArgs
    }

    const nested = scanShellFragment(
      scriptBody,
      nextAllowPositional,
      depth,
      true,
      openQuote === '"',
      ctx,
    )
    if (nested !== null) {
      return {
        ...nested,
        target: nested.target.replaceAll(ESCAPED_DOLLAR_MARKER, '\\$'),
        invocation: nested.invocation.replaceAll(ESCAPED_DOLLAR_MARKER, '\\$'),
      }
    }
  }
  return null
}

/** Official `Tst`: scan a shell fragment for variable-path `rm`/`rmdir` invocations. */
function scanShellFragment(
  fragment: string,
  allowPositional: boolean,
  depth: number,
  respectQuotes: boolean,
  inDoubleQuotes: boolean,
  ctx: DetectionContext,
): DangerousVariableRmMatch | null {
  const joined = fragment.replace(/\\\r?\n/g, ' ')
  let work = (respectQuotes ? maskQuotedDelimiters(joined) : joined)
    .replace(/(?<!\\)`[^`]*`/g, SHELL_PLACEHOLDER)
    .trimStart()
  while (work.startsWith('(') || work.startsWith('{')) {
    work = work.slice(1).trimStart()
  }
  for (let prev = ''; prev !== work; ) {
    prev = work
    work = work
      .replace(/\$\([^()]*\)/g, SHELL_PLACEHOLDER)
      .replace(/(?<![$\\])\([^()]*(?<!\\)\)/g, SHELL_PLACEHOLDER)
  }
  work = work.replace(/(?<![<>&])&(?![<>&])/g, ';')

  for (const part of work.split(/[;|\n\r]|&&/)) {
    const trimmed = part.replace(/^[\s\uE020]+/, '')
    const mainCmd = extractRmCommandFromSegment(trimmed, ctx.evalStrings)
    const candidates: RmCommandTokens[] = mainCmd === null ? [] : [mainCmd]

    for (const execMatch of trimmed.matchAll(
      /(?:^|\s)-(?:exec|ok)(?:dir)?\s+/g,
    )) {
      if (candidates.length >= 8) break
      const afterExec = trimmed.slice(
        (execMatch.index ?? 0) + execMatch[0].length,
      )
      const execCmd = extractRmCommandFromSegment(afterExec, ctx.evalStrings)
      if (execCmd !== null) {
        let sawDoubleDash = false
        const stopAt = execCmd.tokens.findIndex((tok, idx, arr) => {
          const clean = stripQuotesAndUnmask(tok)
          if (clean === '--') sawDoubleDash = true
          return (
            clean === '\\;' ||
            clean === ';' ||
            clean === '\\' ||
            (clean === '+' &&
              stripQuotesAndUnmask(arr[idx - 1] ?? '') === '{}') ||
            (!sawDoubleDash && FIND_PREDICATE_STOP_RE.test(clean))
          )
        })
        candidates.push(
          stopAt === -1
            ? execCmd
            : { ...execCmd, tokens: execCmd.tokens.slice(0, stopAt) },
        )
      }
    }

    for (const cand of candidates) {
      const hit = inspectRmTokens(
        cand,
        allowPositional,
        inDoubleQuotes,
        !respectQuotes || inDoubleQuotes,
        ctx,
      )
      if (hit !== null) return hit
    }

    if (respectQuotes && depth < MAX_INLINE_SHELL_DEPTH) {
      const inlineHit = scanInlineShellSegment(
        trimmed,
        depth === 0 || allowPositional,
        depth + 1,
        ctx,
      )
      if (inlineHit !== null) return inlineHit
    }
  }
  return null
}

/**
 * Official `ZQ(e, n)`: detect possibly-empty variable-path or root-child `rm`/`rmdir`.
 */
export function detectDangerousVariableRm(
  command: string,
  options?: {
    mayBeUnset: (name: string) => boolean
    wholeCommand?: string
    skipAssignedOriginalHits?: boolean
  },
): DangerousVariableRmMatch | null {
  if (!command.includes('$') || !/\brm(?:dir)?\b/i.test(command)) {
    return null
  }
  const cleaned = command.replace(/[\uE000-\uF8FF]/g, '')
  let ctx: DetectionContext = {
    mayBeUnset: () => false,
    derived: new Map(),
    assigned: new Set(),
    evalStrings: false,
  }
  if (options !== undefined) {
    const { set, emptied, rootValued, derived } = analyzeAssignments(
      options.wholeCommand ?? cleaned,
      options.mayBeUnset,
    )
    ctx = {
      mayBeUnset: name =>
        emptied.has(name) ||
        (!set.has(name) &&
          !isAlwaysPresumedEnvVar(name) &&
          options.mayBeUnset(name)),
      derived,
      assigned: new Set([...set].filter(name => !rootValued.has(name))),
      evalStrings: true,
      skipAssignedOriginalHits: options.skipAssignedOriginalHits,
    }
  }
  const allowPositional =
    !FUNC_DEF_RE.test(maskShellCommentsAndQuotes(cleaned, true)) &&
    !SET_POSITIONAL_RE.test(maskShellCommentsAndQuotes(cleaned, false))
  // Official `Uw(e)` returns raw quote-preserving slices (never strips quotes);
  // `scanShellFragment` itself splits top-level `;|&\n\r` with `maskQuotedDelimiters`.
  const commands = [cleaned]
  for (const part of commands) {
    const hit = scanShellFragment(part, allowPositional, 0, true, false, ctx)
    if (hit !== null) return hit
  }
  for (const part of commands) {
    const hit = scanShellFragment(part, false, 0, false, false, ctx)
    if (hit !== null) return hit
  }
  return null
}

/** Official `iyn`: true when the invocation is a recursive `rm` (`-r`/`-R`/`--recursive`). */
export function isRecursiveRmInvocation({
  command,
  invocation,
}: {
  command: 'rm' | 'rmdir'
  invocation: string
}): boolean {
  const stripped = invocation.replace(/"[^"]*"|'[^']*'/g, '""')
  const doubleDashIdx = stripped.indexOf(' -- ')
  const beforeDoubleDash =
    doubleDashIdx === -1 ? stripped : stripped.slice(0, doubleDashIdx)
  return command === 'rm' && /\s(?:--r|-[a-zA-Z]*[rR])/.test(beforeDoubleDash)
}

/** Official `vOr`: target is the sole positional argument to `rm` (only flags/redirects around it). */
function isSoleGuardableRmTarget(
  command: string,
  { invocation, target }: { invocation: string; target: string },
): boolean {
  const invTargetIdx = invocation.indexOf(target)
  if (invTargetIdx === -1) return false
  const flagsBefore = invocation
    .slice(0, invTargetIdx)
    .trim()
    .split(/\s+/)
    .slice(1)
  const validFlags = flagsBefore.every(
    (tok, idx) =>
      /^(?:--|-{1,2}[A-Za-z][A-Za-z-]*)$/.test(tok) &&
      (tok !== '--' || idx === flagsBefore.length - 1),
  )
  if (!validFlags) return false
  const cmdTargetIdx = command.indexOf(target)
  if (cmdTargetIdx === -1) return false
  const trailing = command.slice(cmdTargetIdx + target.length)
  return (
    flagsBefore.includes('--')
      ? TRAILING_REDIRECTS_ONLY_RE
      : TRAILING_FLAGS_AND_REDIRECTS_RE
  ).test(trailing)
}

/**
 * Official `Ast(e)`: rewrite a recursive `rm` targeting an unguarded variable
 * (`$VAR/*`, `"$VAR"/*`, `$VAR/etc`, etc.) so every variable uses `${VAR:?}`.
 * Returns `undefined` if the command cannot be safely and unambiguously guarded.
 */
export function rewriteDangerousRmWithGuard(
  command: string,
): GuardedRmRewrite | undefined {
  const mayBeUnset = () => true
  if (
    command.length > MAX_GUARDABLE_RM_COMMAND_LENGTH ||
    /<<|\$'|\bxargs\b/.test(command)
  ) {
    return undefined
  }
  const hit = detectDangerousVariableRm(command, { mayBeUnset })
  if (
    hit === null ||
    !isRecursiveRmInvocation(hit) ||
    hit.reparsed ||
    hit.assigned === true ||
    hit.derived !== undefined ||
    /['\\`]|\.\./.test(hit.target) ||
    quoteStateAtIndex(
      maskShellCommentsAndQuotes(command, false),
      command.indexOf(hit.target),
    ) !== null ||
    !isSoleGuardableRmTarget(command, hit)
  ) {
    return undefined
  }

  const varNames: string[] = []
  const guardedTarget = hit.target.replace(
    GUARDABLE_VAR_EXPANSION_RE,
    (_whole, braced: string | undefined, bare: string | undefined) => {
      const name = (braced ?? bare)!
      varNames.push(name)
      return `\${${name}:?}`
    },
  )

  if (
    guardedTarget.replace(/\$\{[A-Za-z0-9_]+:\?\}/g, '').includes('$') ||
    varNames.some(
      name =>
        WELL_KNOWN_NONEMPTY_ENV_VARS.has(name.toUpperCase()) ||
        command.includes(`\${${name}:?}`),
    )
  ) {
    return undefined
  }

  const rewrittenLine = command.replace(hit.target, () => guardedTarget)
  if (detectDangerousVariableRm(rewrittenLine, { mayBeUnset }) !== null) {
    return undefined
  }

  const uniqueNames = [...new Set(varNames)]
  const withoutTarget = command.replace(hit.target, () => '')
  return {
    line: rewrittenLine,
    variables: uniqueNames.map(name => `$${name}`).join(' or '),
    wholeTree: WHOLE_TREE_VAR_TARGET_RE.test(hit.target),
    nameUsedElsewhere: varNames.some(name =>
      new RegExp(`\\$\\{?${name}\\b`).test(withoutTarget),
    ),
  }
}

/** Official `Bkn(e)`: guarded command line for a Bash command, or `undefined`. */
export function getGuardedRmLine(command: string): string | undefined {
  return rewriteDangerousRmWithGuard(command)?.line
}

/** Official `Hkn(e, n, r)`: replace `reason` on the matching `safetyCheck` inside a decisionReason tree. */
export function replaceSafetyCheckReason(
  decisionReason: PermissionDecisionReason,
  targetReason: PermissionDecisionReason,
  nextReasonText: string,
): PermissionDecisionReason {
  if (decisionReason === targetReason) {
    return {
      ...targetReason,
      reason: nextReasonText,
    } as PermissionDecisionReason
  }
  if (decisionReason.type === 'subcommandResults') {
    return {
      ...decisionReason,
      reasons: new Map(
        [...decisionReason.reasons].map(([subCmd, subResult]) => [
          subCmd,
          subResult.decisionReason === undefined
            ? subResult
            : {
                ...subResult,
                decisionReason: replaceSafetyCheckReason(
                  subResult.decisionReason,
                  targetReason,
                  nextReasonText,
                ),
              },
        ]),
      ),
    }
  }
  return decisionReason
}

/** Official `Gc(e)`: true when input targets a non-local attached machine via `_host`. */
function targetsAttachedRemoteMachine(input: Record<string, unknown>): boolean {
  if (!('_host' in input)) return false
  const raw = input._host
  if (typeof raw !== 'string') return false
  const trimmed = raw.trim()
  return trimmed !== '' && !LOCAL_HOST_NAMES.has(trimmed)
}

/** Official `Yu()` helper: true for Anthropic-managed remote cloud sessions. */
function isAnthropicCloudEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isEnvTruthy(env.CLAUDE_CODE_REMOTE) &&
    env.CLAUDE_CODE_ENVIRONMENT_KIND === 'anthropic_cloud'
  )
}

/**
 * Official `HLr()`: returns true when running non-interactively in an Anthropic
 * cloud environment and GrowthBook `tengu_purring_naur` === `'variable_path'`.
 */
export function isDangerousRmGuardEnabled(opts?: {
  isNonInteractive?: boolean
  env?: NodeJS.ProcessEnv
  flagValue?: unknown
}): boolean {
  const isNonInteractive =
    opts?.isNonInteractive ?? getIsNonInteractiveSession()
  if (!isNonInteractive || !isAnthropicCloudEnvironment(opts?.env)) {
    return false
  }
  const value =
    opts?.flagValue !== undefined
      ? opts.flagValue
      : getFeatureValueWithSource<string>(DANGEROUS_RM_GUARD_FLAG, 'off').value
  return value === 'variable_path'
}

/**
 * Official `Ukn(e, n, r, g = false)`:
 * When `removalReason.removalRule` is `'variable_path'` or `'var_root_child'`,
 * rewrite the `rm` command with `${VAR:?}`, emit `tengu_bash_dangerous_rm_guarded`,
 * and attach `updatedInput`, `judgedInput`, and the official explanation copy.
 */
export function tryGuardDangerousRmAsk<
  Input extends { command?: unknown; [key: string]: unknown },
>(
  input: Input,
  askResult: GuardedPermissionAskDecision<Input>,
  removalReason: SafetyCheckDecisionReason,
  force = false,
  opts?: {
    isGateEnabled?: () => boolean
    emitEvent?: (name: string, payload: Record<string, never>) => void
  },
): GuardedPermissionAskDecision<Input> | undefined {
  const { command } = input
  if (
    typeof command !== 'string' ||
    askResult.decisionReason === undefined ||
    askResult.hostDisplay !== undefined ||
    (askResult.updatedInput !== undefined &&
      !isEqual(askResult.updatedInput, input)) ||
    targetsAttachedRemoteMachine(input) ||
    (removalReason.removalRule !== 'variable_path' &&
      removalReason.removalRule !== 'var_root_child') ||
    !(force || (opts?.isGateEnabled ?? isDangerousRmGuardEnabled)())
  ) {
    return undefined
  }

  const rewritten = rewriteDangerousRmWithGuard(command)
  if (rewritten === undefined || (rewritten.nameUsedElsewhere && !force)) {
    return undefined
  }

  const updatedInput = { ...input, command: rewritten.line }
  if (opts?.emitEvent) {
    opts.emitEvent('tengu_bash_dangerous_rm_guarded', {})
  } else {
    logEvent('tengu_bash_dangerous_rm_guarded', {})
  }

  const { variables, wholeTree, nameUsedElsewhere } = rewritten
  const whatRemoves = wholeTree
    ? 'this rm removes everything under it'
    : 'this rm removes the path it names'
  const lead = 'Dangerous rm operation on possibly-empty variable path'
  const elsewhereNote = nameUsedElsewhere
    ? ' Steps that still run see an empty value.'
    : ''
  const detailedReason = `${lead}. If ${variables} holds a wrong path, even /, ${whatRemoves}. Claude Code added a check to this rm, so if ${variables} is empty or unset, this rm doesn't run and later steps may stop too.${elsewhereNote}`
  const finalReason =
    detailedReason.length <= MAX_GUARDED_RM_REASON_LENGTH
      ? detailedReason
      : `${lead}. If a variable here holds a wrong path, even /, ${whatRemoves}. Claude Code added a check to this rm, so if one is empty or unset, this rm doesn't run and later steps may stop too.${elsewhereNote}`

  return {
    ...askResult,
    updatedInput,
    judgedInput: input,
    decisionReason: replaceSafetyCheckReason(
      askResult.decisionReason,
      removalReason,
      finalReason,
    ),
  }
}

/**
 * Official 2.1.331 `KPs(e)`: startup/security notice describing whether
 * `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS` has any effect on
 * dangerous `rm` commands in this session.
 */
export function getDangerousRmBypassWaiverNotice(
  toolPermissionContext: ToolPermissionContext,
  opts?: {
    env?: NodeJS.ProcessEnv
    context?: Pick<ToolUseContext, 'getAppState'>
    /** Official `jTe().lifts !== undefined`: whether chrome-floor waiver lifts are configured. */
    hasChromeFloorLifts?: boolean
    /** Override `isRemovalWaiverAllowed` result for deterministic testing. */
    removalWaiverAllowed?: boolean
    /** Official `FTe() && !(wkn('hklm') && wkn('hkcu'))` Windows registry readability check. */
    isWindows?: boolean
    windowsRegistryReadable?: boolean
  },
): string | undefined {
  const env = opts?.env ?? process.env
  if (
    !isEnvTruthy(env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS) ||
    isEnvTruthy(env.CLAUDE_CODE_CHILD_SESSION) ||
    (toolPermissionContext.mode !== 'bypassPermissions' &&
      !toolPermissionContext.isBypassPermissionsModeAvailable)
  ) {
    return undefined
  }
  const waiverAllowed =
    opts?.removalWaiverAllowed !== undefined
      ? opts.removalWaiverAllowed
      : isRemovalWaiverAllowed(toolPermissionContext, opts?.context)
  if (!waiverAllowed) {
    return opts?.hasChromeFloorLifts
      ? 'CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS has no effect on dangerous rm commands in this session: they keep their usual checks.'
      : 'CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS has no effect in this session: dangerous rm commands keep their usual checks.'
  }
  const isWindows = opts?.isWindows ?? getPlatform() === 'windows'
  if (isWindows && opts?.windowsRegistryReadable === false) {
    return "CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS has no effect while the Windows registry cannot be read for managed settings: dangerous rm commands keep their usual checks, and can run without a prompt in bypass permissions mode if the registry later becomes readable. If you didn't set it, check your shell profile."
  }
  return "CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS is set, so dangerous rm commands can run without a prompt in bypass permissions mode once managed settings and plugin hooks have loaded. If you didn't set it, check your shell profile."
}
