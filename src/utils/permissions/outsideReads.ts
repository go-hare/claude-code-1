import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/constants.js'
import { GLOB_TOOL_NAME } from '@claude-code/builtin-tools/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '@claude-code/builtin-tools/tools/GrepTool/prompt.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import {
  getEnabledSettingSources,
  isSettingSourceEnabled,
} from '../settings/constants.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { SandboxManager } from '../sandbox/sandbox-adapter.js'
import { isAutoModeActive } from './autoModeState.js'
import { isBgSession } from '../concurrentSessions.js'
import { isTeammate } from '../teammate.js'
import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionAskDecision } from '../../types/permissions.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

/** official jx */
export const OUTSIDE_READS_BLOCKED_REASON =
  'Reads outside the working directories are blocked (permissions.blockReadsOutsideWorkingDirectories). Add the directory with /add-dir, or remove that setting.'

export const AUTO_MODE_OUTSIDE_READS_KIND = 'auto_mode_outside_reads' as const

export const OUTSIDE_READS_DIALOG_TITLE = 'Read outside the working directories'
export const OUTSIDE_READS_DIALOG_QUESTION =
  'Allow this read outside the working directories?'

export const OUTSIDE_READS_OPTION_ALLOW =
  'Yes, and keep allowing any reads outside the working directories'
export const OUTSIDE_READS_OPTION_BLOCK =
  'No, and block reads outside the working directories from now on'
export const OUTSIDE_READS_OPTION_ASK_AGAIN = 'No, and ask again next time'
/** densable 2.1.289 — allow this read only; do not latch hasSeen. */
export const OUTSIDE_READS_OPTION_ALLOW_ASK_AGAIN =
  'Yes, but ask again next time'

export const OUTSIDE_READS_CHOICES = [
  'allow',
  'block',
  'ask_again',
  'allow_once',
] as const
export type OutsideReadsChoice = (typeof OUTSIDE_READS_CHOICES)[number]

export const OUTSIDE_READS_OPTION_LABELS: Record<OutsideReadsChoice, string> = {
  allow: OUTSIDE_READS_OPTION_ALLOW,
  block: OUTSIDE_READS_OPTION_BLOCK,
  ask_again: OUTSIDE_READS_OPTION_ASK_AGAIN,
  allow_once: OUTSIDE_READS_OPTION_ALLOW_ASK_AGAIN,
}

const FILE_TOOLS_OFFERING_OUTSIDE_READ_BLOCK = new Set([
  FILE_READ_TOOL_NAME,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
])

/** official tke() */
export function settingsHaveBlockReadsOutsideWorkingDirectories(): boolean {
  return getEnabledSettingSources().some(
    source =>
      getSettingsForSource(source)?.permissions
        ?.blockReadsOutsideWorkingDirectories === true,
  )
}

export function contextBlocksOutsideReads(context: {
  blockReadsOutsideWorkingDirectories?: boolean
}): boolean {
  return context.blockReadsOutsideWorkingDirectories === true
}

export function isOutsideReadFileToolName(toolName: string): boolean {
  return FILE_TOOLS_OFFERING_OUTSIDE_READ_BLOCK.has(toolName)
}

/** official Jnr */
export function outsideReadsExplainer(sandboxFenced: boolean): string {
  return (
    'Auto mode and the sandbox read outside the working directories without asking. Yes or No answers for this read; the rest is for later reads. Block: the file tools refuse reads outside the working directories in every project. ' +
    (sandboxFenced
      ? 'Sandboxed commands lose your home directory (SSH keys, home-installed tools) until you re-open paths with sandbox.filesystem.allowRead.'
      : "The sandbox doesn't enforce it on this machine (off, filesystem rules relaxed, managed read-path lock on, or working directory name has glob characters). Auto mode asks before each shell command it can't check.") +
    ' To undo, remove permissions.blockReadsOutsideWorkingDirectories from your user settings; file tools follow next session, sandboxed commands at once.'
  )
}

/** official go() */
export function outsideReadsDialogPayload(input: {
  toolName: string
  path: string
  sandboxFenced: boolean
}): {
  toolName: string
  path: string
  title: string
  question: string
  explainer: string
  options: Array<{ value: OutsideReadsChoice; label: string }>
} {
  return {
    toolName: input.toolName,
    path: input.path,
    title: OUTSIDE_READS_DIALOG_TITLE,
    question: OUTSIDE_READS_DIALOG_QUESTION,
    explainer: outsideReadsExplainer(input.sandboxFenced),
    options: OUTSIDE_READS_CHOICES.map(value => ({
      value,
      label: OUTSIDE_READS_OPTION_LABELS[value],
    })),
  }
}

export function blockedOutsideReadFileToolMessage(path: string): string {
  return `${path} is outside the working directories; reads outside them are blocked (permissions.blockReadsOutsideWorkingDirectories).`
}

export function blockedOutsideReadUserChoiceMessage(opts?: {
  saveError?: string
  sandboxRefreshed?: boolean
}): string {
  let message =
    'The user chose to block reads outside the working directories (permissions.blockReadsOutsideWorkingDirectories). Ask the user to add the directory with /add-dir, or to remove that setting.'
  if (opts?.saveError) {
    message += ` Tell the user: the setting could not be saved to user settings (${opts.saveError}); the file tools are fenced for this session only, sandboxed commands are not.`
  } else if (opts && opts.sandboxRefreshed === false) {
    message +=
      ' Tell the user: the setting is saved, but sandboxed commands may not be fenced until the settings change is picked up.'
  }
  return message
}

/** official W() ask-again decisionReason.reason */
export const OUTSIDE_READS_ASK_AGAIN_REASON =
  'outside read declined, ask again next time'

export function outsideReadAskAgainMessage(feedback?: string): string {
  return feedback
    ? `The user did not allow this read outside the working directories: ${feedback}`
    : 'The user did not allow this read outside the working directories.'
}

/**
 * official W() DualInk deny without blockOutsideReads → ask (not cancelAndAbort).
 */
export function outsideReadAskAgainDecision(opts?: {
  feedback?: string
  contentBlocks?: ContentBlockParam[]
}): PermissionAskDecision {
  const feedback = opts?.feedback
  return {
    behavior: 'ask',
    message: outsideReadAskAgainMessage(feedback),
    decisionReason: {
      type: 'other',
      reason: OUTSIDE_READS_ASK_AGAIN_REASON,
    },
    ...(opts?.contentBlocks ? { contentBlocks: opts.contentBlocks } : {}),
    ...(feedback ? { userFeedback: feedback } : {}),
  }
}

export function blockedOutsideReadCwdMoveMessage(command: string): string {
  return `${command} moves later reads to a directory outside the working directories, which the read block does not allow without asking (permissions.blockReadsOutsideWorkingDirectories). Add the directory with /add-dir, or remove that setting.`
}

/** official Tfo — latch so the first-ask dialog does not repeat. */
export function markSeenAutoModeOutsideReadPrompt(): void {
  saveGlobalConfig(current =>
    current.hasSeenAutoModeOutsideReadPrompt
      ? current
      : { ...current, hasSeenAutoModeOutsideReadPrompt: true },
  )
}

export function hasSeenAutoModeOutsideReadPrompt(): boolean {
  return getGlobalConfig().hasSeenAutoModeOutsideReadPrompt === true
}

/**
 * official `class Te` — session latch so only one outside-read first-ask
 * is open; a second Read/Grep in the same turn does not stamp.
 */
export class OutsideReadPrompt {
  openToolUseId: string | undefined
  answeredThisSession = false
  get answered(): boolean {
    return this.answeredThisSession
  }
  markAnswered(): void {
    this.answeredThisSession = true
  }
  isOpenElsewhere(toolUseId: string | undefined): boolean {
    return this.openToolUseId !== undefined && this.openToolUseId !== toolUseId
  }
  open(toolUseId: string | undefined): void {
    this.openToolUseId = toolUseId
  }
  closeFor(toolUseId: string | undefined): void {
    if (toolUseId !== undefined && this.openToolUseId === toolUseId) {
      this.openToolUseId = undefined
    }
  }
}

const sessionOutsideReadPrompt = new OutsideReadPrompt()

export function getOutsideReadPrompt(): OutsideReadPrompt {
  return sessionOutsideReadPrompt
}

export function resetOutsideReadPromptForTests(): void {
  sessionOutsideReadPrompt.openToolUseId = undefined
  sessionOutsideReadPrompt.answeredThisSession = false
}

/**
 * official Rfo — session fence + userSettings persist + sandbox refresh.
 */
export function persistBlockReadsOutsideWorkingDirectories(opts?: {
  setSessionToolPermissionContext?: (
    update: (prev: ToolPermissionContext) => ToolPermissionContext,
  ) => void
}): {
  error: Error | null
  sandboxRefreshed: boolean
} {
  opts?.setSessionToolPermissionContext?.(prev => ({
    ...prev,
    blockReadsOutsideWorkingDirectories: true,
  }))
  if (!isSettingSourceEnabled('userSettings')) {
    return {
      error: new Error(
        'user settings are not a setting source of this session',
      ),
      sandboxRefreshed: false,
    }
  }
  try {
    updateSettingsForSource('userSettings', {
      permissions: { blockReadsOutsideWorkingDirectories: true },
    })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return { error, sandboxRefreshed: false }
  }
  try {
    SandboxManager.refreshConfig()
    return { error: null, sandboxRefreshed: true }
  } catch {
    return { error: null, sandboxRefreshed: false }
  }
}

export type OutsideReadFirstPromptContext = {
  mode: string
  shouldAvoidPermissionPrompts?: boolean
  blockReadsOutsideWorkingDirectories?: boolean
  /**
   * densable `g.servedCall` — CCR/remote served permission context.
   * yBt: `if(s.forRemoteExecution===!0||g.servedCall===!0)return!1`
   */
  servedCall?: boolean
}

/**
 * densable xa @ 177386583 — `e==="auto"||e==="plan"&&!s&&Jf()`.
 * yBt calls `xa(g.mode)` so the second arg stays false (plan counts only
 * while auto-mode is active). lL/`getAllowRules` passes `servedCall===true`
 * so a served plan+auto context does **not** take the auto allow-filter path.
 * Not ctn/`isPermissionContextAutoMode` (that one also checks bypass inherit).
 */
export function isAutoModeOrPlanActingAsAuto(
  mode: string,
  servedCall = false,
): boolean {
  if (mode === 'auto') return true
  return mode === 'plan' && servedCall !== true && isAutoModeActive()
}

/**
 * official yBt — first auto-mode outside-read ask (Yes/Block/ask_again).
 * Host/session latch fields live on the caller; this is the permission-layer gate.
 */
export function shouldOfferBlockOutsideReads(opts: {
  toolName: string
  hasPath: boolean
  behavior: string
  decisionReasonType?: string
  context: OutsideReadFirstPromptContext
  isNonInteractiveSession?: boolean
  toolUseId?: string
  /** densable `s.forRemoteExecution` — remote-agent permission check. */
  forRemoteExecution?: boolean
}): boolean {
  if (opts.behavior !== 'ask' || opts.decisionReasonType !== 'workingDir') {
    return false
  }
  if (!isOutsideReadFileToolName(opts.toolName) || !opts.hasPath) {
    return false
  }
  const { context } = opts
  // gold yBt: if(!xa(g.mode)||…) — plan + Jf() (auto-mode active) stamps DualInk
  if (!isAutoModeOrPlanActingAsAuto(context.mode)) return false
  if (context.shouldAvoidPermissionPrompts) return false
  if (context.blockReadsOutsideWorkingDirectories === true) return false
  // gold yBt: if(s.forRemoteExecution===!0||g.servedCall===!0)return!1
  // DualInk first-ask is local TTY only — remote/CCR has its own relay.
  if (opts.forRemoteExecution === true || context.servedCall === true) {
    return false
  }
  if (opts.isNonInteractiveSession) return false
  // gold yBt: if(Et()||QCe()) return false. Et = session kind bg; QCe = swarm worker.
  if (isBgSession() || isTeammate()) return false
  if (!isSettingSourceEnabled('userSettings')) return false
  const prompt = getOutsideReadPrompt()
  // gold yBt: !isOpenElsewhere(toolUseId) && !answered && !hasSeen
  if (prompt.isOpenElsewhere(opts.toolUseId)) return false
  if (prompt.answered) return false
  if (hasSeenAutoModeOutsideReadPrompt()) return false
  return true
}

// ---------------------------------------------------------------------------
// Official 2.1.327 (#503 / #504, SEA `SFn`, `YO`, `ov`, `dte`, `ebr`, `KYr`, `zYr`, `UYr`):
// Bash outside-read & Read/Edit deny enforcement under
// `permissions.blockReadsOutsideWorkingDirectories`.
// ---------------------------------------------------------------------------

/** Official `SFn` — interpreters and their inline-code execution flags. */
export const INTERPRETER_INLINE_CODE_FLAGS: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  ['python', new Set(['-c'])],
  ['node', new Set(['-e', '--eval', '-p', '--print'])],
  ['nodejs', new Set(['-e', '--eval', '-p', '--print'])],
  ['bun', new Set(['-e', '--eval', '-p', '--print'])],
  ['perl', new Set(['-e', '-E'])],
  ['ruby', new Set(['-e'])],
  ['php', new Set(['-r'])],
  ['bash', new Set(['-c'])],
  ['sh', new Set(['-c'])],
  ['zsh', new Set(['-c'])],
  ['dash', new Set(['-c'])],
  ['ksh', new Set(['-c'])],
  ['lua', new Set(['-e'])],
  ['luajit', new Set(['-e'])],
  ['tsx', new Set(['-e', '--eval', '-p', '--print'])],
  ['deno', new Set(['eval'])],
  ['Rscript', new Set(['-e'])],
  ['julia', new Set(['-e', '-E'])],
  ['osascript', new Set(['-e'])],
])

/** Official `qYr` — safe commands that do not read file arguments. */
const SAFE_NO_FILE_READ_COMMANDS = new Set([
  'echo',
  'printf',
  'test',
  '[',
  '[[',
  'true',
  'false',
  'which',
  'type',
  'basename',
  'dirname',
  'df',
])

const SAFE_ENV_ASSIGN_NAMES = new Set([
  'CI',
  'TERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'COLORTERM',
  'CLICOLOR',
  'CLICOLOR_FORCE',
  'TZ',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'LC_COLLATE',
  'LC_NUMERIC',
  'LC_TIME',
  'DEBUG',
  'VERBOSE',
  'QUIET',
  'NODE_ENV',
  'RUST_LOG',
  'RUST_BACKTRACE',
  'GOFLAGS',
  'CGO_ENABLED',
  'GOOS',
  'GOARCH',
  'PYTHONDONTWRITEBYTECODE',
  'PYTHONUNBUFFERED',
  'GIT_PAGER',
  'PAGER',
  'COLUMNS',
  'LINES',
])

/** Official `YO`: true when a decisionReason is an outsideReadsBlocked safety check. */
export function isOutsideReadsBlockedReason(
  reason: { type?: string; circuitBreaker?: string } | undefined,
): boolean {
  return (
    reason?.type === 'safetyCheck' &&
    reason.circuitBreaker === 'outsideReadsBlocked'
  )
}

/** Official `ov(cmd)`: ask decision for runtime-computed paths under read block. */
export function buildOutsideReadRuntimePathAsk(
  commandName: string,
): PermissionAskDecision {
  const reason = `${commandName} names a path that is computed at run time, which cannot be checked against the read block (permissions.blockReadsOutsideWorkingDirectories)`
  return {
    behavior: 'ask',
    message: reason,
    decisionReason: {
      type: 'safetyCheck',
      reason,
      classifierApprovable: false,
      circuitBreaker: 'outsideReadsBlocked',
    } as PermissionAskDecision['decisionReason'],
  }
}

/** Official `dte(msg)`: ask decision for unanalyzable commands under read block. */
export function buildOutsideReadUnanalyzableAsk(
  message: string,
): PermissionAskDecision {
  const reason = `${message}; under the read block (permissions.blockReadsOutsideWorkingDirectories) a command the shell parser cannot analyze asks the person`
  return {
    behavior: 'ask',
    message: reason,
    decisionReason: {
      type: 'safetyCheck',
      reason,
      classifierApprovable: false,
      circuitBreaker: 'outsideReadsBlocked',
    } as PermissionAskDecision['decisionReason'],
    suggestions: [],
  }
}

/** Official `ebr()`: ask decision for non-allowlisted sed scripts under read block. */
export function buildOutsideReadSedAsk(): PermissionAskDecision {
  const reason =
    'This sed script is not on the allowlist and can read or write any file, which cannot be checked against the read block (permissions.blockReadsOutsideWorkingDirectories)'
  return {
    behavior: 'ask',
    message: reason,
    decisionReason: {
      type: 'safetyCheck',
      reason,
      classifierApprovable: false,
      circuitBreaker: 'outsideReadsBlocked',
    } as PermissionAskDecision['decisionReason'],
  }
}

const TIMEOUT_FLAG_VALUE_RE = /^[A-Za-z0-9_.+-]+$/

/** Official `qft`: skip GNU timeout flags and return the duration token index. */
function skipTimeoutFlags(argv: readonly string[]): number {
  let i = 1
  while (i < argv.length) {
    const arg = argv[i]!
    const next = argv[i + 1]
    if (
      arg === '--foreground' ||
      arg === '--preserve-status' ||
      arg === '--verbose'
    ) {
      i++
    } else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) {
      i++
    } else if (
      (arg === '--kill-after' || arg === '--signal') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    ) {
      i += 2
    } else if (arg === '--') {
      i++
      break
    } else if (arg.startsWith('--')) {
      return -1
    } else if (arg === '-v') {
      i++
    } else if (
      (arg === '-k' || arg === '-s') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    ) {
      i += 2
    } else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) {
      i++
    } else if (arg.startsWith('-')) {
      return -1
    } else {
      break
    }
  }
  return i
}

/** Official `H1r`: skip stdbuf flags and return wrapped command index. */
function skipStdbufFlags(argv: readonly string[]): number {
  let i = 1
  while (i < argv.length) {
    const arg = argv[i]!
    if (/^-[ioe]$/.test(arg) && argv[i + 1]) {
      i += 2
    } else if (/^-[ioe]./.test(arg)) {
      i++
    } else if (/^--(input|output|error)=/.test(arg)) {
      i++
    } else if (arg.startsWith('-')) {
      return -1
    } else {
      break
    }
  }
  return i > 1 && i < argv.length ? i : -1
}

/** Official `B1r`: skip env flags & VAR=val assignments and return wrapped command index. */
function skipEnvFlags(argv: readonly string[]): number {
  let i = 1
  while (i < argv.length) {
    const arg = argv[i]!
    if (arg.includes('=') && !arg.startsWith('-')) {
      i++
    } else if (arg === '-i' || arg === '-0' || arg === '-v') {
      i++
    } else if (arg === '-u' && argv[i + 1]) {
      i += 2
    } else if (arg === '--') {
      i++
      break
    } else if (arg.startsWith('-')) {
      return -1
    } else {
      break
    }
  }
  return i < argv.length ? i : -1
}

const DANGEROUS_GIT_CONFIG_EXACT_KEYS = new Set([
  'core.fsmonitor',
  'core.sshcommand',
  'core.pager',
  'core.editor',
  'core.askpass',
  'core.hookspath',
  'core.attributesfile',
  'core.excludesfile',
  'core.alternate',
  'diff.external',
  'credential.helper',
  'sequence.editor',
  'include.path',
  'uploadpack.packobjectshook',
  'gpg.program',
  'gpg.ssh.program',
  'gpg.x509.program',
  'http.cookiefile',
  'http.sslcainfo',
  'http.sslcapath',
  'http.sslcert',
  'http.sslkey',
  'commit.template',
  'blame.ignorerevsfile',
  'mailmap.file',
  'mailmap.blob',
])

function isDangerousGitConfigOverride(key: string, value: string): boolean {
  if (value.trimStart().startsWith('!')) return true
  const lower = key.toLowerCase()
  if (DANGEROUS_GIT_CONFIG_EXACT_KEYS.has(lower)) return true
  if (lower.startsWith('pager.')) {
    const trimmed = value.trim().toLowerCase()
    return trimmed !== 'false' && trimmed !== 'true'
  }
  return (
    /^(?:alias|filter|difftool|mergetool|includeif)\./.test(lower) ||
    /^diff\.[^.]+\.(?:textconv|command)$/.test(lower)
  )
}

const LOCALE_ENV_ASSIGN_NAMES = new Set(['LANG', 'LC_ALL', 'LC_CTYPE'])
const SAFE_LOCALE_ENV_VALUE_RE =
  /^(['"]?)(C|POSIX|UTF-?8|[\w-]+\.UTF-?8(@\w+)?)\1$/i
const UNSAFE_ENV_ASSIGN_PATH_RE =
  /^[.~]*[/\\]|[/\\][/\\]|:[/\\.]|(?:^|[/\\])\.\.(?:[/\\]|$)/

/**
 * Official 2.1.328 (`M1` / `TNe`): allow a safe env-var assignment only when
 * both the variable name is allowlisted AND its value is non-path-like (no `/`,
 * `\`, `..`, `~`, or shell metacharacters; locale vars must match a safe locale).
 * `TZ` may contain a single IANA region slash (e.g. `America/New_York`) as long
 * as it is not path-like (`UNSAFE_ENV_ASSIGN_PATH_RE`, `..`, `~`).
 */
function isSafeOutsideReadsEnvAssignment(name: string, value: string): boolean {
  if (!SAFE_ENV_ASSIGN_NAMES.has(name)) return false
  if (/[`$(){}|;&<>!*?[\]\n\r]/.test(value)) return false
  if (
    LOCALE_ENV_ASSIGN_NAMES.has(name) &&
    !SAFE_LOCALE_ENV_VALUE_RE.test(value) &&
    !(name === 'LANG' && (value === '' || value === '""' || value === "''"))
  ) {
    return false
  }
  const unquoted = value.replaceAll('"', '').replaceAll("'", '')
  if (
    UNSAFE_ENV_ASSIGN_PATH_RE.test(unquoted) ||
    unquoted.includes('..') ||
    unquoted.includes('~')
  ) {
    return false
  }
  if (name !== 'TZ' && /[/\\]/.test(unquoted)) {
    return false
  }
  return true
}

function hasUnsafeEnvAssignmentToken(tokens: readonly string[]): boolean {
  for (const arg of tokens) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(arg)
    if (
      m !== null &&
      !isSafeOutsideReadsEnvAssignment(m[1]!, arg.slice(m[0].length))
    ) {
      return true
    }
  }
  return false
}

function stripOutsideReadsWrapperCommandsWithMeta(argv: readonly string[]): {
  stripped: string[]
  hasUnsafeEnvAssignment: boolean
} {
  let current = [...argv]
  let hasUnsafeEnvAssignment = false
  for (;;) {
    while (current.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(current[0]!)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(current[0]!)
      if (
        m !== null &&
        !isSafeOutsideReadsEnvAssignment(m[1]!, current[0]!.slice(m[0].length))
      ) {
        hasUnsafeEnvAssignment = true
      }
      current = current.slice(1)
    }
    const baseName = current[0]?.replace(/^.*[\\/]/, '')
    const wrapper =
      baseName === 'time' ||
      baseName === 'nohup' ||
      baseName === 'timeout' ||
      baseName === 'nice' ||
      baseName === 'stdbuf' ||
      baseName === 'env' ||
      baseName === 'command'
        ? baseName
        : current[0]
    if (wrapper === 'time' || wrapper === 'nohup') {
      const nextIdx = current[1] === '--' ? 2 : 1
      if (nextIdx >= current.length) {
        return { stripped: current, hasUnsafeEnvAssignment }
      }
      current = current.slice(nextIdx)
    } else if (wrapper === 'timeout') {
      const durIdx = skipTimeoutFlags(current)
      if (
        durIdx < 0 ||
        !current[durIdx] ||
        !/^\d+(?:\.\d+)?[smhd]?$/.test(current[durIdx]!)
      ) {
        return { stripped: current, hasUnsafeEnvAssignment }
      }
      if (durIdx + 1 >= current.length) {
        return { stripped: current, hasUnsafeEnvAssignment }
      }
      current = current.slice(durIdx + 1)
    } else if (wrapper === 'nice') {
      let nextIdx: number
      if (current[1] === '-n' && current[2] && /^-?\d+$/.test(current[2])) {
        nextIdx = current[3] === '--' ? 4 : 3
      } else if (current[1] && /^-\d+$/.test(current[1])) {
        nextIdx = current[2] === '--' ? 3 : 2
      } else {
        nextIdx = current[1] === '--' ? 2 : 1
      }
      if (nextIdx >= current.length) {
        return { stripped: current, hasUnsafeEnvAssignment }
      }
      current = current.slice(nextIdx)
    } else if (wrapper === 'stdbuf') {
      const nextIdx = skipStdbufFlags(current)
      if (nextIdx < 0) return { stripped: current, hasUnsafeEnvAssignment }
      current = current.slice(nextIdx)
    } else if (wrapper === 'env') {
      const nextIdx = skipEnvFlags(current)
      const envArgSlice =
        nextIdx >= 0 ? current.slice(1, nextIdx) : current.slice(1)
      if (
        hasUnsafeEnvAssignmentToken(envArgSlice) ||
        envArgSlice.some(a => a === '-S' || a.startsWith('--split-string'))
      ) {
        hasUnsafeEnvAssignment = true
      }
      if (nextIdx < 0) return { stripped: current, hasUnsafeEnvAssignment }
      current = current.slice(nextIdx)
    } else if (wrapper === 'command') {
      let nextIdx = 1
      while (
        current[nextIdx] !== undefined &&
        /^-p+$/.test(current[nextIdx]!)
      ) {
        nextIdx++
      }
      if (current[nextIdx] === '--') nextIdx++
      if (nextIdx >= current.length || current[nextIdx]!.startsWith('-')) {
        return { stripped: current, hasUnsafeEnvAssignment }
      }
      current = current.slice(nextIdx)
    } else if (current[0] === 'builtin') {
      const nextIdx = current[1] === '--' ? 2 : 1
      if (nextIdx >= current.length) {
        return { stripped: current, hasUnsafeEnvAssignment }
      }
      current = current.slice(nextIdx)
    } else if (current[0] === 'noglob') {
      if (current.length <= 1) {
        return { stripped: current, hasUnsafeEnvAssignment }
      }
      current = current.slice(1)
    } else {
      return { stripped: current, hasUnsafeEnvAssignment }
    }
  }
}

/**
 * Official 2.1.328 `r$`: strip wrapper commands (`env`, `timeout`, `nice`,
 * `nohup`, `time`, `command`, `stdbuf`, `builtin`, `noglob`) and leading
 * `VAR=val` assignments so interpreter/`xargs`/`git` checks cannot be bypassed.
 */
export function stripOutsideReadsWrapperCommands(
  argv: readonly string[],
): string[] {
  return stripOutsideReadsWrapperCommandsWithMeta(argv).stripped
}

/**
 * Official 2.1.328 (`UYr`): returns true when `argv` invokes a code interpreter
 * (`INTERPRETER_INLINE_CODE_FLAGS`) in stdin-reading mode (`-` or only option
 * flags / no script file argument). Used by compound stdin checks (`<<`, `<<<`,
 * or piped stdin `idx > 0 && command.includes('|')`).
 */
export function isStdinCodeInterpreterArgv(argv: readonly string[]): boolean {
  const stripped = stripOutsideReadsWrapperCommands(argv)
  const cmd = stripped[0]
  if (cmd === undefined) return false
  const base = cmd.slice(cmd.lastIndexOf('/') + 1).replace(/[\d.]+$/, '')
  if (!INTERPRETER_INLINE_CODE_FLAGS.has(base)) return false
  const args = stripped.slice(1)
  if (args.includes('-')) return true
  return args.every(a => a.startsWith('-'))
}

/**
 * Official 2.1.327 (#503 / #504, SEA `KYr` + `zYr` + `UYr`):
 * Inspect a Bash subcommand's argv under `permissions.blockReadsOutsideWorkingDirectories`:
 * - Returns `deny` immediately if any named path falls under a Read or Edit deny rule (#504)
 * - Returns `ask` with `circuitBreaker: 'outsideReadsBlocked'` (bypassImmune,
 *   not classifier-routed) for inline interpreter code, stdin execution, `xargs`,
 *   unsafe `env` assignments, runtime-computed paths, globs with `..`/`**`, or
 *   existing paths outside working directories (#503).
 */
export function checkBashArgvUnderOutsideReadsBlock(
  argv: readonly string[],
  cwd: string,
  context: ToolPermissionContext,
  opts?: {
    hasCdInCompound?: boolean
    sandboxFenced?: boolean
    knownPathHandledCommands?: ReadonlySet<string>
  },
):
  | PermissionAskDecision
  | {
      behavior: 'deny'
      message: string
      decisionReason?: unknown
    }
  | undefined {
  if (context.blockReadsOutsideWorkingDirectories !== true) {
    return undefined
  }
  if (argv.length === 0) return undefined

  const sandboxFenced = opts?.sandboxFenced === true

  // Strip leading env-var assignments and wrapper commands (`r$`), also
  // catching unsafe `env VAR=val` assignments hidden behind wrappers like
  // `time env LD_PRELOAD=... ls` or `nice env ...`.
  const { stripped, hasUnsafeEnvAssignment } =
    stripOutsideReadsWrapperCommandsWithMeta(argv)
  if (!sandboxFenced && hasUnsafeEnvAssignment) {
    return buildOutsideReadUnanalyzableAsk(
      'An environment variable assignment outside the safe list cannot be checked against the read block',
    )
  }

  const cmd = stripped[0]
  if (cmd === undefined) return undefined
  const base = cmd.slice(cmd.lastIndexOf('/') + 1)

  // Lazy require to avoid circular import between outsideReads and pathValidation/fs
  const { existsSync } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('fs') as typeof import('fs')
  const { isAbsolute, resolve } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('path') as typeof import('path')
  const { getPathsForPermissionCheck } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../fsOperations.js') as typeof import('../fsOperations.js')
  const { expandTilde, hasGlobBeforeDotDot } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./pathValidation.js') as typeof import('./pathValidation.js')
  const { matchingRuleForInput, pathInOutsideReadFenceWorkingPath } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./filesystem.js') as typeof import('./filesystem.js')

  const hasExpansion = (token: string): boolean =>
    /\$(?:\{|\(|[A-Za-z_@*#?!0-9])|`/.test(token)
  const isUnc = (p: string): boolean =>
    p.startsWith('//') || p.startsWith('\\\\')
  const hasGlob = (p: string): boolean => /[*?[\]]/.test(p)
  const hasPathTraversal = (p: string): boolean =>
    /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p)

  const findReadOrEditDenyRule = (targetPath: string) => {
    for (const candidatePath of getPathsForPermissionCheck(targetPath)) {
      const rule =
        matchingRuleForInput(candidatePath, context, 'read', 'deny') ??
        matchingRuleForInput(candidatePath, context, 'edit', 'deny')
      if (rule !== null) return rule
    }
    return null
  }

  const checkNamedPath = (
    cmdLabel: string,
    rawToken: string,
  ):
    | PermissionAskDecision
    | { behavior: 'deny'; message: string; decisionReason?: unknown }
    | undefined => {
    if (rawToken === '') return undefined
    if (hasExpansion(rawToken)) {
      return buildOutsideReadRuntimePathAsk(cmdLabel)
    }
    if (
      rawToken.startsWith('~') &&
      rawToken !== '~' &&
      !rawToken.startsWith('~/')
    ) {
      return buildOutsideReadRuntimePathAsk(cmdLabel)
    }
    const expanded = expandTilde(rawToken)
    if (isUnc(expanded)) {
      return buildOutsideReadRuntimePathAsk(cmdLabel)
    }
    if (opts?.hasCdInCompound && !isAbsolute(expanded)) {
      return buildOutsideReadRuntimePathAsk(cmdLabel)
    }
    let pathToCheck = expanded
    if (hasGlob(expanded)) {
      const firstGlob = expanded.search(/[*?[\]]/)
      const prefix = expanded.slice(0, firstGlob)
      const lastSlash = Math.max(
        prefix.lastIndexOf('/'),
        prefix.lastIndexOf('\\'),
      )
      let dirPart: string
      if (prefix.endsWith('/') || prefix.endsWith('\\')) {
        dirPart = prefix
      } else if (lastSlash === -1) {
        dirPart = '.'
      } else {
        const sliced = prefix.slice(0, lastSlash)
        dirPart =
          sliced === ''
            ? prefix[lastSlash]!
            : /^[A-Za-z]:$/.test(sliced)
              ? `${sliced}${prefix[lastSlash]!}`
              : sliced
      }
      pathToCheck = dirPart
      const resolvedDir = isAbsolute(dirPart) ? dirPart : resolve(cwd, dirPart)
      const denyRule = findReadOrEditDenyRule(resolvedDir)
      if (denyRule !== null) {
        return {
          behavior: 'deny',
          message: `${cmdLabel} in '${resolvedDir}' was blocked by a deny rule`,
          decisionReason: { type: 'rule', rule: denyRule },
        }
      }
      if (hasPathTraversal(expanded) || hasGlobBeforeDotDot(expanded)) {
        return buildOutsideReadRuntimePathAsk(cmdLabel)
      }
    }
    const resolvedPath = isAbsolute(pathToCheck)
      ? pathToCheck
      : resolve(cwd, pathToCheck)
    const denyRule = findReadOrEditDenyRule(resolvedPath)
    if (denyRule !== null) {
      return {
        behavior: 'deny',
        message: `${cmdLabel} in '${resolvedPath}' was blocked by a deny rule`,
        decisionReason: { type: 'rule', rule: denyRule },
      }
    }
    // Check if path exists (or has `..` traversal) before enforcing outside-working-dir ask
    let exists = false
    try {
      exists = existsSync(resolvedPath)
    } catch {
      exists = false
    }
    if (!hasPathTraversal(pathToCheck) && !exists) {
      return undefined
    }
    if (!pathInOutsideReadFenceWorkingPath(resolvedPath, context)) {
      return {
        behavior: 'ask',
        message: `${cmdLabel} names '${resolvedPath}', outside the working directories, which the read block does not allow without asking (permissions.blockReadsOutsideWorkingDirectories). Add the directory with /add-dir, or remove that setting.`,
        decisionReason: {
          type: 'safetyCheck',
          reason: OUTSIDE_READS_BLOCKED_REASON,
          classifierApprovable: false,
          circuitBreaker: 'outsideReadsBlocked',
        } as PermissionAskDecision['decisionReason'],
      }
    }
    return undefined
  }

  // `git`: check path-bearing flags (`-C`, `--git-dir`, `--work-tree`, `--file`, `-f`),
  // `-c key=value` / `--config-env=...` overrides, AND remaining positional /
  // flag-value args (e.g. `git grep --no-index root /etc/passwd`,
  // `git diff --no-index /etc/passwd /tmp/x`, `git log -- /etc/passwd`), while
  // skipping the git subcommand token (`status`, `log`, `diff`, `commit`, etc.),
  // non-path message/pattern flags (`-m`, `--message`, `--grep`, `--format`,
  // `--pretty`, `-S`, `-G`, `-L`, `-e` on `git grep`), and `git grep`'s search
  // pattern positional argument.
  if (base === 'git') {
    const GIT_NON_PATH_VALUE_FLAGS = new Set([
      '-m',
      '--message',
      '--grep',
      '--format',
      '--pretty',
      '--date',
      '-S',
      '-G',
      '-L',
      '--author',
      '--committer',
      '--since',
      '--until',
      '--after',
      '--before',
    ])
    const GIT_NON_PATH_EQ_PREFIXES = [
      '--message=',
      '--grep=',
      '--format=',
      '--pretty=',
      '--date=',
      '--author=',
      '--committer=',
      '--since=',
      '--until=',
      '--after=',
      '--before=',
    ]
    let firstAsk: PermissionAskDecision | undefined
    const checkGitCandidate = (
      cand: string,
    ):
      | { behavior: 'deny'; message: string; decisionReason?: unknown }
      | undefined => {
      const res = checkNamedPath(base, cand)
      if (!res) return undefined
      if (res.behavior === 'deny') return res
      firstAsk ??= res
      return undefined
    }

    let subcommand: string | null = null
    let afterDoubleDash = false
    let gitGrepPatternSeen = false

    for (let i = 1; i < stripped.length; i++) {
      const arg = stripped[i]!
      if (arg === '') continue
      if (!afterDoubleDash && arg === '--') {
        afterDoubleDash = true
        continue
      }
      if (!afterDoubleDash) {
        if (
          (arg === '-C' ||
            arg === '--git-dir' ||
            arg === '--work-tree' ||
            arg === '--file' ||
            arg === '-f') &&
          stripped[i + 1] !== undefined
        ) {
          const deny = checkGitCandidate(stripped[i + 1]!)
          if (deny) return deny
          if (subcommand === 'grep' && (arg === '-f' || arg === '--file')) {
            gitGrepPatternSeen = true
          }
          i++
          continue
        }
        if (/^--(git-dir|work-tree|file)=/.test(arg)) {
          const deny = checkGitCandidate(arg.slice(arg.indexOf('=') + 1))
          if (deny) return deny
          if (subcommand === 'grep' && arg.startsWith('--file=')) {
            gitGrepPatternSeen = true
          }
          continue
        }
        if (
          (arg.startsWith('-C') ||
            (subcommand === 'grep' && arg.startsWith('-f'))) &&
          arg.length > 2
        ) {
          const deny = checkGitCandidate(arg.slice(2))
          if (deny) return deny
          if (subcommand === 'grep' && arg.startsWith('-f')) {
            gitGrepPatternSeen = true
          }
          continue
        }
        if (arg === '--config-env' || arg.startsWith('--config-env=')) {
          const spec =
            arg === '--config-env'
              ? (stripped[++i] ?? '')
              : arg.slice('--config-env='.length)
          if (spec) {
            const eqIdx = spec.indexOf('=')
            if (eqIdx > 0) {
              const deny = checkGitCandidate(spec.slice(eqIdx + 1))
              if (deny) return deny
            }
          }
          if (!sandboxFenced) {
            firstAsk ??= buildOutsideReadRuntimePathAsk(base)
          }
          continue
        }
        if (
          (arg === '-c' && stripped[i + 1] !== undefined) ||
          (arg.startsWith('-c') && arg.length > 2)
        ) {
          const spec = arg === '-c' ? stripped[++i]! : arg.slice(2)
          if (hasExpansion(spec)) {
            firstAsk ??= buildOutsideReadRuntimePathAsk(base)
            continue
          }
          const eqIdx = spec.indexOf('=')
          if (eqIdx > 0) {
            const key = spec.slice(0, eqIdx).trim()
            const val = spec.slice(eqIdx + 1)
            const deny = checkGitCandidate(val)
            if (deny) return deny
            if (!sandboxFenced && isDangerousGitConfigOverride(key, val)) {
              firstAsk ??= buildOutsideReadUnanalyzableAsk(
                `git -c ${key}=... can execute external commands or read external config, which cannot be checked against the read block`,
              )
            }
          } else {
            const deny = checkGitCandidate(spec)
            if (deny) return deny
          }
          continue
        }
        if (
          GIT_NON_PATH_VALUE_FLAGS.has(arg) ||
          (subcommand === 'grep' && (arg === '-e' || arg === '--regexp'))
        ) {
          if (subcommand === 'grep' && (arg === '-e' || arg === '--regexp')) {
            gitGrepPatternSeen = true
          }
          if (stripped[i + 1] !== undefined) {
            i++
          }
          continue
        }
        if (
          GIT_NON_PATH_EQ_PREFIXES.some(p => arg.startsWith(p)) ||
          (subcommand === 'grep' && arg.startsWith('--regexp='))
        ) {
          if (subcommand === 'grep' && arg.startsWith('--regexp=')) {
            gitGrepPatternSeen = true
          }
          continue
        }
        if (
          arg.length > 2 &&
          !arg.startsWith('--') &&
          (arg.startsWith('-m') ||
            arg.startsWith('-S') ||
            arg.startsWith('-G') ||
            arg.startsWith('-L') ||
            (subcommand === 'grep' && arg.startsWith('-e')))
        ) {
          if (subcommand === 'grep' && arg.startsWith('-e')) {
            gitGrepPatternSeen = true
          }
          continue
        }
        if (subcommand === null && !arg.startsWith('-')) {
          subcommand = arg
          continue
        }
        if (
          subcommand === 'grep' &&
          !arg.startsWith('-') &&
          !gitGrepPatternSeen
        ) {
          gitGrepPatternSeen = true
          continue
        }
        if (arg.startsWith('-')) {
          const eqIdx = arg.indexOf('=')
          if (eqIdx > 0) {
            const val = arg.slice(eqIdx + 1)
            if (hasExpansion(val)) {
              firstAsk ??= buildOutsideReadRuntimePathAsk(base)
            } else {
              const deny = checkGitCandidate(val)
              if (deny) return deny
            }
          }
          continue
        }
      }

      if (hasExpansion(arg)) {
        firstAsk ??= buildOutsideReadRuntimePathAsk(base)
        continue
      }
      const eqIdx = arg.indexOf('=')
      const candidates =
        !afterDoubleDash &&
        eqIdx > 0 &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(arg.slice(0, eqIdx))
          ? [arg, arg.slice(eqIdx + 1)]
          : [arg]
      for (const cand of candidates) {
        const deny = checkGitCandidate(cand)
        if (deny) return deny
      }
    }
    return firstAsk
  }

  if (
    SAFE_NO_FILE_READ_COMMANDS.has(base) ||
    opts?.knownPathHandledCommands?.has(cmd) ||
    opts?.knownPathHandledCommands?.has(base)
  ) {
    return undefined
  }

  // Interpreters (`SFn`) running inline code or stdin (`-`)
  const interpKey = base.replace(/[\d.]+$/, '')
  const inlineFlags = INTERPRETER_INLINE_CODE_FLAGS.get(interpKey)
  if (!sandboxFenced && inlineFlags !== undefined) {
    const args = stripped.slice(1)
    const runsInline = args.some(
      arg =>
        inlineFlags.has(arg) ||
        Array.from(inlineFlags).some(flag =>
          flag.startsWith('--')
            ? arg.startsWith(`${flag}=`)
            : arg.startsWith('-') &&
              !arg.startsWith('--') &&
              arg.length > 2 &&
              arg.includes(flag.slice(1)),
        ),
    )
    if (runsInline) {
      return buildOutsideReadUnanalyzableAsk(
        `${base} runs inline code, which cannot be checked against the read block`,
      )
    }
    if (args.includes('-')) {
      return buildOutsideReadUnanalyzableAsk(
        `${base} runs code from stdin, which cannot be checked against the read block`,
      )
    }
  }

  if (base === 'xargs') {
    return buildOutsideReadRuntimePathAsk(base)
  }

  // Shell code-execution builtins (`eval`, `source`, `.`) cannot be statically
  // checked against the read block (covers legacy parse-unavailable fallback as
  // well as direct argv inspection).
  if (
    !sandboxFenced &&
    (base === 'eval' || base === 'source' || base === '.')
  ) {
    return buildOutsideReadUnanalyzableAsk(
      `${base} executes shell code dynamically, which cannot be checked against the read block`,
    )
  }

  // Inspect remaining arguments for Read/Edit deny rules (#504) and outside paths (#503)
  let firstAsk: PermissionAskDecision | undefined
  for (const arg of stripped.slice(1)) {
    if (arg === '') continue
    if (hasExpansion(arg)) {
      firstAsk ??= buildOutsideReadRuntimePathAsk(base)
      continue
    }
    const eqIdx = arg.indexOf('=')
    const candidates = arg.startsWith('-')
      ? eqIdx > 0
        ? [arg.slice(eqIdx + 1)]
        : !arg.startsWith('--') && arg.length > 2
          ? [arg.slice(2)]
          : []
      : eqIdx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(arg.slice(0, eqIdx))
        ? [arg, arg.slice(eqIdx + 1)]
        : [arg]
    for (const cand of candidates) {
      const res = checkNamedPath(base, cand)
      if (!res) continue
      if (res.behavior === 'deny') return res
      firstAsk ??= res
    }
  }
  return firstAsk
}
