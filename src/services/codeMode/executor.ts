/**
 * Code Mode (2.1.323 #1964) JavaScript VM runtime & session resume planner.
 *
 * Allows Claude to write JavaScript that calls its available tools
 * (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, Agent, MCP tools, etc.)
 * through the session's permission pipeline (`canUseTool`) inside a sandboxed
 * Node `vm` context.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import * as vm from 'node:vm'
import { setCwdState } from '../../bootstrap/state.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
} from '../../types/message.js'
import { getAgentContext } from '../../utils/agentContext.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { getCwd } from '../../utils/cwd.js'
import type {
  ManagedPreToolPassResult,
  ToolCallManagedPass,
} from '../../utils/hooks/toolCallManagedPass.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import {
  buildCodeModeMcpStatusDelta,
  CODE_MODE_STATIC_MCP_GUIDANCE,
} from '../../utils/simpleSystemPrompt.js'
import { McpAuthError } from '../mcp/connectionHelpers.js'
import { mcpInfoFromString } from '../mcp/mcpStringUtils.js'
import {
  CODE_MODE_EXPERIMENTAL_NAME,
  CODE_MODE_NAME,
  REPL_MAX_TIMEOUT_MS,
  REPL_POST_SCRIPT_PAUSE_AUTO_MS,
  REPL_SCRIPT_FILENAME,
  REPL_SYNC_RUN_MS,
  REPL_TOOL_CALL_CAP,
} from './constants.js'
import {
  codeModeBeforePin,
  codeModeRefusalReasonText,
  formatCodeModeCommand,
  getCodeModeOptInState,
  isCodeModeEnabled,
  noteReplContextCreated,
  pinCodeMode,
  unpinCodeMode,
} from './optIn.js'

export type CodeModeExecutionResult = {
  result: string
  tool_calls: number
  /** Official 2.1.325 #2315: extra text typed with Yes at permission/plan dialogs. */
  userFeedback?: string[]
  /** Official 2.1.328 #653: tool calls that were still running when the script failed. */
  inFlightAtFailure?: string[]
  /** Official 2.1.328 #576: top-level variables declared in a failed script that remained unset. */
  unsetVariables?: string[]
  /** Inner PreToolUse / PostToolUse hook returned continue: false. */
  hookStoppedContinuation?: boolean
  /** Stop reason from an inner hook that returned continue: false. */
  hookStopReason?: string
  /** Additional context emitted by inner PreToolUse / PostToolUse hooks. */
  hookAdditionalContext?: string[]
  /** Blocking error messages emitted by inner PostToolUse / PreToolUse hooks. */
  hookBlockingErrors?: string[]
}

/**
 * Official 2.1.328 (#651): Live command execution progress events emitted while
 * a Code Mode script runs shell commands.
 */
export type CodeModeProgressEvent =
  | { type: 'command_start'; command: string; toolName: string }
  | {
      type: 'command_output'
      command: string
      chunk: string
      stream: 'stdout' | 'stderr'
    }

/**
 * Official 2.1.327 (#386): Per-script auto-mode verdict tracker so a running
 * Code Mode script keeps its allowed verdict when a second auto-mode-allowed
 * script starts concurrently.
 */
export type AutoScriptVerdictState = 'pending' | 'allowed' | 'blocked' | 'none'

export type AutoScriptRecord = {
  id: string
  state: AutoScriptVerdictState
  blockedReason?: string
}

export class CodeModeAutoVerdictTracker {
  private readonly records = new Map<string, AutoScriptRecord>()
  private unclassifiedCodeRan = false

  registerScript(id: string): AutoScriptRecord {
    const rec: AutoScriptRecord = { id, state: 'pending' }
    this.records.set(id, rec)
    return rec
  }

  markAllowed(id: string): void {
    const rec = this.records.get(id)
    if (rec) rec.state = 'allowed'
  }

  markBlocked(id: string, reason: string): void {
    const rec = this.records.get(id)
    if (rec) {
      rec.state = 'blocked'
      rec.blockedReason = reason
    }
  }

  markUnclassifiedCodeRan(): void {
    this.unclassifiedCodeRan = true
  }

  endScript(id: string): void {
    this.records.delete(id)
  }

  /**
   * Returns true if `id` is allowed to ride its script-level auto-mode verdict.
   * Crucially (#386), another concurrently starting script that is still pending
   * or already allowed does NOT revoke this running script's allowed verdict.
   */
  ridesNow(id: string): boolean {
    if (this.unclassifiedCodeRan) return false
    const rec = this.records.get(id)
    return rec !== undefined && rec.state === 'allowed'
  }
}

/**
 * Official 2.1.328 (#571): Pauseable timer so the 10-minute Code Mode script
 * deadline does NOT count time spent waiting on an interactive permission
 * prompt (outside auto/bypass), a plan approval (`ExitPlanMode`), or a user
 * question (`AskUserQuestion`).
 */
export type PausableCodeModeTimer = {
  pause: () => void
  resume: () => void
  clear: () => void
  isPaused: () => boolean
  getRemainingMs: () => number
}

export function createPausableCodeModeTimer(
  durationMs: number,
  onTimeout: () => void,
  now: () => number = Date.now,
): PausableCodeModeTimer {
  let remainingMs = Math.max(0, durationMs)
  let startedAt = now()
  let pauseDepth = 0
  let cleared = false
  let handle: ReturnType<typeof setTimeout> | undefined

  const arm = () => {
    if (cleared || pauseDepth > 0) return
    startedAt = now()
    handle = setTimeout(() => {
      if (!cleared && pauseDepth === 0) {
        remainingMs = 0
        onTimeout()
      }
    }, remainingMs)
    if (typeof handle.unref === 'function') {
      handle.unref()
    }
  }

  arm()

  return {
    pause() {
      if (cleared) return
      if (pauseDepth === 0) {
        if (handle !== undefined) {
          clearTimeout(handle)
          handle = undefined
        }
        remainingMs = Math.max(0, remainingMs - (now() - startedAt))
      }
      pauseDepth++
    },
    resume() {
      if (cleared || pauseDepth === 0) return
      pauseDepth--
      if (pauseDepth === 0) {
        if (remainingMs <= 0) {
          onTimeout()
        } else {
          arm()
        }
      }
    },
    clear() {
      cleared = true
      if (handle !== undefined) {
        clearTimeout(handle)
        handle = undefined
      }
    },
    isPaused: () => pauseDepth > 0,
    getRemainingMs: () =>
      pauseDepth > 0 || cleared
        ? remainingMs
        : Math.max(0, remainingMs - (now() - startedAt)),
  }
}

export function shouldPauseCodeModeTimerForTool(
  toolName: string,
  permissionMode?: string,
): boolean {
  if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') {
    return true
  }
  return permissionMode !== 'auto' && permissionMode !== 'bypassPermissions'
}

/**
 * Official 2.1.328 (#648): Removed the 750ms post-script pause in auto and
 * bypass-permissions modes.
 */
export function getCodeModePostScriptPauseMs(permissionMode?: string): number {
  if (permissionMode === 'auto' || permissionMode === 'bypassPermissions') {
    return REPL_POST_SCRIPT_PAUSE_AUTO_MS
  }
  return 0
}

/**
 * Official 2.1.328 (#573): Scripts run in the background in auto and
 * bypass-permissions modes whenever Code Mode is active, including sessions
 * resumed via the `claude --resume` picker.
 */
export function shouldRunCodeModeScriptInBackground(
  permissionMode: string | undefined,
  codeModeActive: boolean = isCodeModeEnabled(),
): boolean {
  return (
    codeModeActive &&
    (permissionMode === 'auto' || permissionMode === 'bypassPermissions')
  )
}

/**
 * Official 2.1.328 (#574): Preserve loaded skills, hook context, and
 * permission-approval notes across all scripts in a multi-script reply when
 * resuming a Code Mode session.
 */
export type CodeModeScriptSideEffects = {
  toolUseId: string
  loadedSkills?: string[]
  hookContexts?: string[]
  approvalNotes?: string[]
}

export function mergeCodeModeReplySideEffects(
  scripts: readonly CodeModeScriptSideEffects[],
): {
  loadedSkills: string[]
  hookContexts: string[]
  approvalNotes: string[]
} {
  const skills = new Set<string>()
  const contexts: string[] = []
  const notes: string[] = []
  for (const s of scripts) {
    for (const sk of s.loadedSkills ?? []) skills.add(sk)
    for (const ctx of s.hookContexts ?? []) {
      if (ctx) contexts.push(ctx)
    }
    for (const note of s.approvalNotes ?? []) {
      if (note) notes.push(note)
    }
  }
  return {
    loadedSkills: [...skills],
    hookContexts: contexts,
    approvalNotes: notes,
  }
}

/**
 * Official 2.1.328 (#575): Notice telling Claude that a Code Mode script was
 * cut off when resuming from the picker or in an ask-for-permission mode.
 */
export function buildCodeModeInterruptedScriptNotice(opts?: {
  toolUseId?: string
  permissionMode?: string
  fromPicker?: boolean
}): string {
  const idPart = opts?.toolUseId ? ` (${opts.toolUseId})` : ''
  return `[Code Mode script${idPart} was cut off before it finished. Variables and side effects from that script may be incomplete; check state before continuing.]`
}

/**
 * Official 2.1.328 (#576): Extract top-level declared variable names from a
 * script and inject guards in subsequent scripts so referencing a variable
 * that an earlier failed script never set throws instead of silently yielding
 * `undefined`.
 */
// True column-0 top-level declarations only (no leading whitespace, so indented
// block/function-local declarations are never mistaken for top-level bindings).
const TOP_LEVEL_DECL_RE =
  /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)(?![A-Za-z0-9_$])/gm

const PLAIN_ASSIGN_RE = /(?:^|;)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/gm

export function extractTopLevelDeclaredVars(code: string): string[] {
  const stripped = stripJsCommentsAndStrings(code)
  const vars = new Set<string>()
  for (const match of stripped.matchAll(TOP_LEVEL_DECL_RE)) {
    const name = match[1]
    if (name) vars.add(name)
  }
  return [...vars]
}

export function extractAssignedVars(code: string): string[] {
  const stripped = stripJsCommentsAndStrings(code)
  const vars = new Set<string>()
  for (const match of stripped.matchAll(PLAIN_ASSIGN_RE)) {
    const name = match[1]
    if (name) vars.add(name)
  }
  return [...vars]
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'case',
  'throw',
  'in',
  'instanceof',
  'typeof',
  'void',
  'delete',
  'new',
  'do',
  'else',
  'yield',
  'await',
  'of',
])

const PAREN_STATEMENT_KEYWORDS = new Set(['if', 'while', 'for', 'with'])

function isPrecededByMemberDot(out: string, start: number): boolean {
  let k = start - 1
  while (k >= 0 && /\s/.test(out[k]!)) k--
  return k >= 0 && out[k] === '.'
}

function canPrecedeRegexLiteral(out: string): boolean {
  let j = out.length - 1
  while (j >= 0 && /\s/.test(out[j]!)) j--
  if (j < 0) return true
  const prev = out[j]!
  if (
    (prev === '+' && out[j - 1] === '+') ||
    (prev === '-' && out[j - 1] === '-')
  ) {
    return false
  }
  if ('([{,;?:!~+-*/%^&|=<>'.includes(prev)) {
    return true
  }
  if (prev === ')') {
    let depth = 1
    let k = j - 1
    while (k >= 0 && depth > 0) {
      if (out[k] === ')') depth++
      else if (out[k] === '(') depth--
      k--
    }
    if (depth === 0) {
      while (k >= 0 && /\s/.test(out[k]!)) k--
      if (k >= 0 && /[A-Za-z0-9_$]/.test(out[k]!)) {
        let start = k
        while (start > 0 && /[A-Za-z0-9_$]/.test(out[start - 1]!)) start--
        if (!isPrecededByMemberDot(out, start)) {
          const word = out.slice(start, k + 1)
          if (PAREN_STATEMENT_KEYWORDS.has(word)) return true
        }
      }
    }
    return false
  }
  if (/[A-Za-z0-9_$]/.test(prev)) {
    let start = j
    while (start > 0 && /[A-Za-z0-9_$]/.test(out[start - 1]!)) start--
    if (isPrecededByMemberDot(out, start)) return false
    const word = out.slice(start, j + 1)
    return REGEX_PRECEDING_KEYWORDS.has(word)
  }
  return false
}

/**
 * Strip JS comments, regex literals, and string/template text (preserving
 * `${...}` interpolation expressions) so unset-var guard detection never fires
 * on strings, regexes, or comments.
 */
function stripJsCommentsAndStrings(code: string): string {
  let out = ''
  const templateBraceDepths: number[] = []
  let i = 0
  const len = code.length
  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    // Line comment
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      out += ' '
      continue
    }
    // Block comment
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') out += '\n'
        i++
      }
      i += 2
      out += ' '
      continue
    }
    // Regex literal (disambiguated from division via preceding token)
    if (ch === '/' && canPrecedeRegexLiteral(out)) {
      i++
      let inCharClass = false
      while (i < len) {
        const rc = code[i]!
        if (rc === '\\') {
          i += 2
          continue
        }
        if (rc === '\n' || rc === '\r') {
          break
        }
        if (rc === '[') {
          inCharClass = true
          i++
          continue
        }
        if (rc === ']') {
          inCharClass = false
          i++
          continue
        }
        if (!inCharClass && rc === '/') {
          i++
          while (i < len && /[a-z]/i.test(code[i]!)) i++
          break
        }
        i++
      }
      out += '""'
      continue
    }
    // Single or double quoted string
    if (ch === "'" || ch === '"') {
      const quote = ch
      i++
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === quote) {
          i++
          break
        }
        i++
      }
      out += '""'
      continue
    }
    // Template literal start or resume after closing `}` of `${...}`
    if (ch === '`') {
      i++
      out += ' '
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          out += '('
          break
        }
        if (code[i] === '`') {
          i++
          out += '""'
          break
        }
        if (code[i] === '\n') out += '\n'
        i++
      }
      continue
    }
    if (templateBraceDepths.length > 0) {
      if (ch === '{') {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
      } else if (ch === '}') {
        const depth = templateBraceDepths[templateBraceDepths.length - 1]!
        if (depth === 0) {
          templateBraceDepths.pop()
          i++
          out += ')'
          // Continue scanning the enclosing template literal
          while (i < len) {
            if (code[i] === '\\') {
              i += 2
              continue
            }
            if (code[i] === '$' && code[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              out += '('
              break
            }
            if (code[i] === '`') {
              i++
              out += '""'
              break
            }
            if (code[i] === '\n') out += '\n'
            i++
          }
          continue
        }
        templateBraceDepths[templateBraceDepths.length - 1] = depth - 1
      }
    }
    out += ch
    i++
  }
  return out
}

const VALID_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function splitTopLevelCommas(inner: string): string[] {
  const parts: string[] = []
  let depthCurly = 0
  let depthSquare = 0
  let depthParen = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (c === '{') depthCurly++
    else if (c === '}') depthCurly--
    else if (c === '[') depthSquare++
    else if (c === ']') depthSquare--
    else if (c === '(') depthParen++
    else if (c === ')') depthParen--
    else if (
      c === ',' &&
      depthCurly === 0 &&
      depthSquare === 0 &&
      depthParen === 0
    ) {
      parts.push(inner.slice(start, i))
      start = i + 1
    }
  }
  parts.push(inner.slice(start))
  return parts
}

function stripTopLevelDefaultRhs(segment: string): string {
  let depthCurly = 0
  let depthSquare = 0
  let depthParen = 0
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (c === '{') depthCurly++
    else if (c === '}') depthCurly--
    else if (c === '[') depthSquare++
    else if (c === ']') depthSquare--
    else if (c === '(') depthParen++
    else if (c === ')') depthParen--
    else if (
      c === '=' &&
      depthCurly === 0 &&
      depthSquare === 0 &&
      depthParen === 0 &&
      segment[i + 1] !== '=' &&
      segment[i + 1] !== '>'
    ) {
      return segment.slice(0, i)
    }
  }
  return segment
}

function findTopLevelColon(segment: string): number {
  let depthCurly = 0
  let depthSquare = 0
  let depthParen = 0
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (c === '{') depthCurly++
    else if (c === '}') depthCurly--
    else if (c === '[') depthSquare++
    else if (c === ']') depthSquare--
    else if (c === '(') depthParen++
    else if (c === ')') depthParen--
    else if (
      c === ':' &&
      depthCurly === 0 &&
      depthSquare === 0 &&
      depthParen === 0
    ) {
      return i
    }
  }
  return -1
}

function collectDestructuringBindings(
  pattern: string,
  isObject: boolean,
  out: Set<string>,
): void {
  const trimmed = pattern.trim()
  if (trimmed.length < 2) return
  const inner = trimmed.slice(1, -1)
  for (const rawPart of splitTopLevelCommas(inner)) {
    let lhs = stripTopLevelDefaultRhs(rawPart).trim()
    if (!lhs) continue
    if (lhs.startsWith('...')) {
      lhs = lhs.slice(3).trim()
    }
    if (isObject) {
      const colonIdx = findTopLevelColon(lhs)
      const target = colonIdx >= 0 ? lhs.slice(colonIdx + 1).trim() : lhs
      if (target.startsWith('{') && target.endsWith('}')) {
        collectDestructuringBindings(target, true, out)
      } else if (target.startsWith('[') && target.endsWith(']')) {
        collectDestructuringBindings(target, false, out)
      } else if (VALID_IDENTIFIER_RE.test(target)) {
        out.add(target)
      }
    } else if (lhs.startsWith('{') && lhs.endsWith('}')) {
      collectDestructuringBindings(lhs, true, out)
    } else if (lhs.startsWith('[') && lhs.endsWith(']')) {
      collectDestructuringBindings(lhs, false, out)
    } else if (VALID_IDENTIFIER_RE.test(lhs)) {
      out.add(lhs)
    }
  }
}

function isBoundInDestructuring(stripped: string, name: string): boolean {
  const declRe = /\b(?:const|let|var)\s*([{[])/g
  let match: RegExpExecArray | null
  while ((match = declRe.exec(stripped)) !== null) {
    const openChar = match[1]!
    const closeChar = openChar === '{' ? '}' : ']'
    const startIdx = match.index + match[0].length - 1
    let depth = 0
    let endIdx = -1
    for (let i = startIdx; i < stripped.length; i++) {
      const c = stripped[i]!
      if (c === openChar) depth++
      else if (c === closeChar) {
        depth--
        if (depth === 0) {
          endIdx = i
          break
        }
      }
    }
    if (endIdx > startIdx) {
      const bindings = new Set<string>()
      collectDestructuringBindings(
        stripped.slice(startIdx, endIdx + 1),
        openChar === '{',
        bindings,
      )
      if (bindings.has(name)) return true
      declRe.lastIndex = endIdx + 1
    }
  }
  return false
}

function isIdentifierShadowedOrBound(stripped: string, name: string): boolean {
  const esc = escapeRegExp(name)
  const idStart = '(?<![A-Za-z0-9_$])'
  const idEnd = '(?![A-Za-z0-9_$])'
  // Redeclared via const/let/var/function/class or destructuring
  if (
    new RegExp(`\\b(?:const|let|var|function|class)\\s+${esc}${idEnd}`).test(
      stripped,
    ) ||
    isBoundInDestructuring(stripped, name)
  ) {
    return true
  }
  // Directly assigned at statement start
  if (new RegExp(`^\\s*${esc}\\s*=(?!=)`, 'm').test(stripped)) {
    return true
  }
  // Checked with typeof
  if (new RegExp(`\\btypeof\\s+${esc}${idEnd}`).test(stripped)) {
    return true
  }
  // Shadowed as arrow parameter (`x => ...` or `(..., x, ...) => ...`),
  // regular function parameter, or catch parameter
  if (
    new RegExp(`(?<![.A-Za-z0-9_$])${esc}\\s*=>`).test(stripped) ||
    new RegExp(`\\([^()]*${idStart}${esc}${idEnd}[^()]*\\)\\s*=>`).test(
      stripped,
    ) ||
    new RegExp(
      `\\bfunction\\b[^{]*\\([^()]*${idStart}${esc}${idEnd}[^()]*\\)`,
    ).test(stripped) ||
    new RegExp(`\\bcatch\\s*\\(\\s*${esc}${idEnd}`).test(stripped)
  ) {
    return true
  }
  return false
}

export function injectUnsetVarGuards(
  code: string,
  unsetVars: ReadonlySet<string>,
): string {
  if (unsetVars.size === 0) return code
  const stripped = stripJsCommentsAndStrings(code)
  const guards: string[] = []
  for (const name of unsetVars) {
    const esc = escapeRegExp(name)
    if (isIdentifierShadowedOrBound(stripped, name)) continue
    const referenced = new RegExp(`(?<![.\\w$])${esc}(?![\\w$:])`).test(
      stripped,
    )
    if (referenced) {
      guards.push(
        `if (typeof ${name} === 'undefined') { throw new ReferenceError(${JSON.stringify(`Nothing ran: it reads a variable (${name}) that an earlier step never set`)}); }`,
      )
    }
  }
  return guards.length > 0 ? `${guards.join('\n')}\n${code}` : code
}

/**
 * Official 2.1.328 (#580): An `@`-mentioned small file must still be attached
 * in Code Mode even if a script previously read or wrote it.
 */
export function shouldAttachSmallMentionedFileInCodeMode(opts: {
  isCodeMode: boolean
  isSmallFile: boolean
  previouslyTouchedByScript: boolean
}): boolean {
  if (!opts.isSmallFile) return false
  if (opts.isCodeMode && opts.previouslyTouchedByScript) {
    return true
  }
  return true
}

/**
 * Official 2.1.328 (#582): Do not auto-start a Claude turn in Code Mode when
 * Esc interrupted a script and was followed by a local slash command (e.g. `/model`).
 */
export function shouldAutoStartCodeModeTurnAfterCommand(opts: {
  interruptedByEsc: boolean
  commandName?: string
  isLocalCommand?: boolean
}): boolean {
  if (
    opts.interruptedByEsc &&
    (opts.isLocalCommand || Boolean(opts.commandName))
  ) {
    return false
  }
  return !opts.interruptedByEsc
}

/**
 * Official 2.1.328 (#649): Diff pending/connected MCP servers for Code Mode
 * dynamic status notices without mutating the static cached system prompt.
 */
export function diffCodeModeMcpServerStatus(
  prevConnected: ReadonlySet<string>,
  currentClients: ReadonlyArray<{ name: string; type: string }>,
): {
  connected: Set<string>
  pending: string[]
  added: string[]
  removed: string[]
} {
  const connected = new Set<string>()
  const pending: string[] = []
  for (const c of currentClients) {
    if (c.type === 'connected') connected.add(c.name)
    else if (c.type === 'pending') pending.push(c.name)
  }
  const added = [...connected].filter(n => !prevConnected.has(n)).sort()
  const removed = [...prevConnected].filter(n => !connected.has(n)).sort()
  return { connected, pending: pending.sort(), added, removed }
}

/**
 * Official 2.1.328 (#650): Shorter token-efficient tool descriptions for Code Mode.
 */
export function buildConciseCodeModeToolDescription(
  toolName: string,
  fullDescription: string,
  maxChars = 160,
): string {
  const firstParagraph = fullDescription.split(/\r?\n\r?\n/)[0]?.trim() ?? ''
  const singleLine = firstParagraph.replace(/\s+/g, ' ')
  if (!singleLine) return toolName
  return singleLine.length > maxChars
    ? `${singleLine.slice(0, maxChars - 1)}…`
    : singleLine
}

/**
 * Official 2.1.328 `Qi` (#652): Edit diagnostics for Code Mode —
 * 1) No-op edits (`old_string === new_string`) return `{ changed: false, noOp: true }`
 *    without throwing or stopping the script.
 * 2) Multiple matches report all matching line numbers.
 * 3) Failed edits find the closest matching window in the file and show the
 *    first differing line (`yours:` vs `file:`) and whether only whitespace differs.
 */
const EDIT_CLOSEST_WIDTH = 160
const EDIT_MAX_MATCH_LINES = 20

function clipEditLine(line: string, offset = 0): string {
  const slice = line.slice(offset)
  const clipped =
    slice.length > EDIT_CLOSEST_WIDTH
      ? `${slice.slice(0, EDIT_CLOSEST_WIDTH)}…`
      : slice
  return JSON.stringify((offset > 0 ? '…' : '') + clipped)
}

function lineBigrams(line: string): Map<string, number> {
  const t = line.trim().slice(0, 400)
  const map = new Map<string, number>()
  for (let i = 0; i + 1 < t.length; i++) {
    const bg = t.slice(i, i + 2)
    map.set(bg, (map.get(bg) ?? 0) + 1)
  }
  return map
}

function bigramOverlap(a: Map<string, number>, b: Map<string, number>): number {
  let score = 0
  for (const [k, v] of a) {
    const bv = b.get(k)
    if (bv !== undefined) score += Math.min(v, bv)
  }
  return score
}

export function findClosestEditMatchHint(
  fileContent: string,
  oldString: string,
): string {
  if (!oldString) return ''
  const parts = fileContent.split(oldString)
  if (parts.length - 1 > 1) {
    const matches: number[] = []
    let line = 1
    const oldLines = oldString.split('\n').length - 1
    for (
      let i = 0;
      i < parts.length - 1 && matches.length < EDIT_MAX_MATCH_LINES;
      i++
    ) {
      line += parts[i]!.split('\n').length - 1 + (i > 0 ? oldLines : 0)
      matches.push(line)
    }
    const extra = parts.length - 1 - matches.length
    return `lines with a match: ${[...new Set(matches)].join(', ')}${extra > 0 ? `, and ${extra} more matches` : ''}`
  }
  if (parts.length - 1 === 1) return ''

  const needleLines = oldString.replace(/\n$/, '').split('\n')
  const fileLines = fileContent.replace(/\n$/, '').split('\n')
  if (fileLines.length === 0) return ''

  const needleBigrams = needleLines.slice(0, 40).map(lineBigrams)
  const fileBigrams = fileLines.map(lineBigrams)
  let bestStart = 0
  let bestScore = -1
  for (let start = 0; start < fileLines.length; start++) {
    let score = 0
    for (
      let j = 0;
      j < needleBigrams.length && start + j < fileLines.length;
      j++
    ) {
      score += bigramOverlap(needleBigrams[j]!, fileBigrams[start + j]!)
    }
    if (score > bestScore) {
      bestScore = score
      bestStart = start
    }
  }

  let diffIdx = needleLines.findIndex((nl, idx) => {
    const fl = fileLines[bestStart + idx] ?? ''
    return needleLines.length === 1
      ? !fl.includes(nl)
      : idx === 0
        ? !fl.endsWith(nl)
        : idx === needleLines.length - 1
          ? !fl.startsWith(nl)
          : fl !== nl
  })
  if (diffIdx === -1) diffIdx = needleLines.length - 1
  const yours = needleLines[diffIdx] ?? ''
  const actual = fileLines[bestStart + diffIdx]
  let common = 0
  while (common < yours.length && yours[common] === actual?.[common]) common++
  const offset = Math.max(0, common - EDIT_CLOSEST_WIDTH / 2)
  const whitespaceOnly =
    actual !== undefined &&
    yours.replace(/\s/g, '') === actual.replace(/\s/g, '')
  return [
    `the closest text differs at line ${bestStart + diffIdx + 1}${whitespaceOnly ? ', only in white space' : ''}`,
    `  yours: ${clipEditLine(yours, offset)}`,
    `  file:  ${actual === undefined ? '(end of file)' : clipEditLine(actual, offset)}`,
  ].join('\n')
}

export function isNoOpCodeModeEdit(input: Record<string, unknown>): boolean {
  return (
    typeof input.old_string === 'string' &&
    typeof input.new_string === 'string' &&
    input.old_string === input.new_string
  )
}

/**
 * Official 2.1.325 #2314: expand leading `~` / `~/` / `~\` against `homedir()`
 * and resolve relative paths against the live working directory (`getCwd()`,
 * which follows `EnterWorktree` / `ExitWorktree`), preventing `~` paths from
 * being written literally inside the project directory.
 */
export function expandCodeModePath(
  rawPath: string,
  cwd: string = getCwd(),
  home: string = homedir(),
): string {
  if (rawPath === '~') {
    return home
  }
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return join(home, rawPath.slice(2))
  }
  if (isAbsolute(rawPath)) {
    return rawPath
  }
  return resolve(cwd, rawPath)
}

const CODE_MODE_PATH_KEYS: ReadonlySet<string> = new Set([
  'file_path',
  'path',
  'notebook_path',
])

const CODE_MODE_PATH_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'NotebookEdit',
])

/**
 * Official 2.1.325 #2314: normalize path arguments (`~` expansion + live
 * worktree cwd resolution) for file-oriented tools called from Code Mode.
 */
export function normalizeCodeModeToolInput(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string = getCwd(),
  home: string = homedir(),
): Record<string, unknown> {
  if (!CODE_MODE_PATH_TOOLS.has(toolName)) {
    return input
  }
  let changed = false
  const next: Record<string, unknown> = { ...input }
  for (const key of CODE_MODE_PATH_KEYS) {
    const val = next[key]
    if (typeof val === 'string' && val.length > 0) {
      const expanded = expandCodeModePath(val, cwd, home)
      if (expanded !== val) {
        next[key] = expanded
        changed = true
      }
    }
  }
  return changed ? next : input
}

/**
 * Official 2.1.325 #2314: extract a worktree path from an `EnterWorktree`
 * tool result so Code Mode follows the newly entered worktree immediately.
 */
export function extractEnteredWorktreePath(
  toolName: string,
  data: unknown,
): string | undefined {
  if (toolName !== 'EnterWorktree' || !data || typeof data !== 'object') {
    return undefined
  }
  const rec = data as Record<string, unknown>
  if (typeof rec.worktreePath === 'string' && rec.worktreePath.length > 0) {
    return rec.worktreePath
  }
  if (typeof rec.path === 'string' && rec.path.length > 0) {
    return rec.path
  }
  return undefined
}

/**
 * Official 2.1.325 #2314: when an MCP tool call inside Code Mode fails with an
 * expired sign-in (`McpAuthError`), mark that MCP server as `needs-auth` in
 * AppState so `/mcp` reflects its expired status instead of showing `connected`.
 */
export function syncExpiredMcpAuthInCodeMode(
  toolName: string,
  error: unknown,
  setAppState: ToolUseContext['setAppState'],
): string | undefined {
  const serverName =
    error instanceof McpAuthError
      ? error.serverName
      : error instanceof Error &&
          /requires re-authorization|token expired|needs-auth/i.test(
            error.message,
          )
        ? mcpInfoFromString(toolName)?.serverName
        : undefined
  if (!serverName) return undefined
  setAppState(prev => {
    const idx = prev.mcp.clients.findIndex(c => c.name === serverName)
    if (idx === -1) return prev
    const existing = prev.mcp.clients[idx]!
    if (existing.type === 'needs-auth') return prev
    const nextClients = [...prev.mcp.clients]
    nextClients[idx] = {
      name: existing.name,
      type: 'needs-auth',
      config: existing.config,
    }
    return {
      ...prev,
      mcp: {
        ...prev.mcp,
        clients: nextClients,
      },
    }
  })
  return serverName
}

/**
 * Official 2.1.325 #2315: extract words typed by the user alongside a "Yes"
 * permission approval or plan approval (`ExitPlanMode`) so Code Mode forwards
 * them back to Claude.
 */
export function extractApprovalUserFeedback(
  permission: unknown,
  toolResultData?: unknown,
): string | undefined {
  const parts: string[] = []
  if (permission && typeof permission === 'object') {
    const p = permission as Record<string, unknown>
    for (const key of [
      'userFeedback',
      'approvalFeedback',
      'feedback',
    ] as const) {
      const v = p[key]
      if (typeof v === 'string' && v.trim().length > 0) {
        parts.push(v.trim())
      }
    }
    // Some permission dialogs carry typed allow-with-message on `message`
    if (
      p.behavior === 'allow' &&
      typeof p.message === 'string' &&
      p.message.trim().length > 0
    ) {
      parts.push(p.message.trim())
    }
  }
  if (toolResultData && typeof toolResultData === 'object') {
    const d = toolResultData as Record<string, unknown>
    for (const key of ['userFeedback', 'feedback', 'approvalNote'] as const) {
      const v = d[key]
      if (typeof v === 'string' && v.trim().length > 0) {
        parts.push(v.trim())
      }
    }
  }
  if (parts.length === 0) return undefined
  return [...new Set(parts)].join('\n')
}

export type CodeModeToolInvoker = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<unknown>

export type ExecuteCodeModeScriptOptions = {
  code: string
  invokeTool: CodeModeToolInvoker
  timeoutMs?: number
  toolCallCap?: number
  signal?: AbortSignal
  shellKind?: 'bash' | 'powershell'
  /** Official 2.1.328 #581: restrict exposed primitive helpers (e.g. omit write/edit for read-only subagents). */
  allowedTools?: ReadonlySet<string>
  /** Official 2.1.328 #576: top-level variables declared in earlier failed scripts that remained unset. */
  unsetVars?: ReadonlySet<string>
  /** Official 2.1.328 #651: live progress callback for commands and streaming output. */
  onProgress?: (event: CodeModeProgressEvent) => void
  /** Official 2.1.328 #571: permission mode used to decide whether tool waits pause the script clock. */
  permissionMode?: string
  /** Optional cache lookup for already-read file contents (used for Edit closest-match hints without prompting). */
  getCachedFileContent?: (filePath: string) => string | undefined
}

const PRIMITIVE_SHORTHAND_MAP: ReadonlyArray<readonly [string, string]> = [
  ['read', 'Read'],
  ['write', 'Write'],
  ['edit', 'Edit'],
  ['glob', 'Glob'],
  ['grep', 'Grep'],
  ['bash', 'Bash'],
  ['notebookEdit', 'NotebookEdit'],
  ['agent', 'Agent'],
]

// Official 2.1.326 #293 (`shell.prelude.js`): `$` shell helper refusal constants & patterns.
const SHELL_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const PS_TYPOGRAPHIC_QUOTE_RE = /[\u2018-\u201F]/
const BEFORE_WORDS_BASH =
  /(?:^|(?:^|[^\\])[ \t\n;&|(])(?:-[\w.-]*=?)?(?:\\\n)*$/
const BEFORE_WORDS_PS = /(?:^|(?:^|[^`])[ \t\n;&|(])(?:-[\w.-]*=?)?(?:`\r?\n)*$/
const BEFORE_TARGET_BASH =
  /(?:^|[^\\])(?:\\\\)*(?:<<-|[<>]&?[|!]?)(?:[ \t]|\\\n)*(?:-[\w.-]*=?(?:\\\n)*)?$/
const BEFORE_TARGET_PS = /[<>](?:[ \t]|`\r?\n)*(?:-[\w.-]*=?(?:`\r?\n)*)?$/

const ABSENT_ADVICE =
  ".\nFind out why first: an earlier script may have stopped before assigning the variable, or a field or regex group is missing. If the argument is optional, write ${x ?? []} to omit it or ${x ?? ''} for an empty one. Inside a word such as ${x}/build both leave /build, so check x instead."
const UNWRITTEN_RAW =
  'an object with a raw field, but not a one-key {raw: ...} literal written in a script and unchanged since.\nIt may be outside data, such as parsed JSON, where a string was expected, or a literal whose raw field was set again, so check the value first. ${x.raw} passes its text as one quoted argument. The {raw: ...} form is only for shell text that the script wrote itself: build that string first, then wrap it once.'
const NOT_ONE_WORD =
  "an array, in a place that seems to take one word: it continues a word, as after NAME= or a quote mark, or it follows a redirect such as > or <.\nThe other items could run as the command or become its arguments. The value may be outside data, such as parsed JSON, where a string was expected, so check it first. With no quotes of your own around them, ${x} after a space passes one argument per item, ${x.join(' ')} passes one word, and ${x.map(s => 'dir/' + s)} puts a prefix on each item. For a file's text, use write() in place of a here-document."
const NO_TARGET =
  'an empty array, so the redirect before it has no file or takes the next word.\nCheck the value first.'

const SHOWN_EACH_SIDE = 60

export function quoteCodeModeShellArg(
  value: unknown,
  shellKind: 'bash' | 'powershell' = 'bash',
): string {
  const str = String(value)
  if (shellKind === 'powershell') {
    const match = PS_TYPOGRAPHIC_QUOTE_RE.exec(str)
    if (match !== null) {
      const hex = (match[0]!.codePointAt(0) ?? 0)
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')
      throw new Error(
        `$ cannot quote this value for PowerShell: it contains U+${hex}, a typographic quote (U+2018-U+201F) that PowerShell's tokenizer can take for a quote delimiter; remove or replace that character`,
      )
    }
    return `'${str.replaceAll("'", "''")}'`
  }
  return `'${str.replaceAll("'", "'\\''")}'`
}

/**
 * Official 2.1.326 #293: validates `.env()` passed to Code Mode's `$` shell
 * helper and formats the shell export prefix. Throws before anything runs if
 * `.env()` receives a string/array or a key that is not a valid shell var name.
 */
export function buildCodeModeShellEnvPrefix(
  env: unknown,
  shellKind: 'bash' | 'powershell' = 'bash',
): string {
  if (env === undefined || env === null) return ''
  if (typeof env === 'string' || Array.isArray(env)) {
    throw new Error(
      `$ did not run this command: .env() takes an object of variable names and values, and this call gave it ${Array.isArray(env) ? 'an array' : 'a string'}. Pass an object like { NAME: "value" }.`,
    )
  }
  if (typeof env !== 'object') {
    throw new Error(
      `$ did not run this command: .env() takes an object of variable names and values. Pass an object like { NAME: "value" }.`,
    )
  }
  const record = env as Record<string, unknown>
  const names = Object.keys(record)
  for (const name of names) {
    if (!SHELL_ENV_KEY_PATTERN.test(name)) {
      const cp = name.codePointAt(79)
      const end = cp !== undefined && cp > 0xffff ? 79 : 80
      const shown = name.length > 80 ? `${name.slice(0, end)}...` : name
      throw new Error(
        `$ did not run this command: the .env() key ${JSON.stringify(shown)} is not a shell variable name (ASCII letters, digits and underscores, not starting with a digit). $ writes each key into the command unquoted, so a key like this could change the command. Rename the key.`,
      )
    }
  }
  if (names.length === 0) return ''
  if (shellKind === 'powershell') {
    return `${names.map(k => `$env:${k} = ${quoteCodeModeShellArg(record[k], 'powershell')};`).join(' ')} `
  }
  return `export ${names.map(k => `${k}=${quoteCodeModeShellArg(record[k], 'bash')}`).join(' ')}; `
}

/**
 * Official 2.1.326 #293: renders a `` $`...` `` template literal into a shell
 * command string, refusing `undefined`/`null`, unverified `{ raw }` objects,
 * arrays in non-word-boundary or redirect positions, and PowerShell typographic
 * quotes — throwing an Error before anything runs.
 */
export function renderCodeModeShellTemplate(
  strings: readonly string[] & { raw?: readonly string[] },
  values: readonly unknown[],
  options: {
    shellKind?: 'bash' | 'powershell'
    mayLeaveUnquoted?: (value: object) => boolean
  } = {},
): string {
  const shellKind = options.shellKind ?? 'bash'
  const mayLeaveUnquoted = options.mayLeaveUnquoted ?? (() => false)
  const beforeWords =
    shellKind === 'powershell' ? BEFORE_WORDS_PS : BEFORE_WORDS_BASH
  const beforeTarget =
    shellKind === 'powershell' ? BEFORE_TARGET_PS : BEFORE_TARGET_BASH

  const lift = (s: string) =>
    s.replace(/\\\\|\\(\$\{|`)/g, (m, g: string | undefined) =>
      g === undefined ? m : g,
    )
  const rawArr =
    Array.isArray(strings.raw) &&
    strings.raw.length === strings.length &&
    strings.raw.every(x => typeof x === 'string')
      ? strings.raw
      : undefined
  const textAt = (i: number) =>
    rawArr === undefined ? String(strings[i] ?? '') : lift(rawArr[i] ?? '')

  const renderPiece = (
    v: unknown,
    soFar: { shape: string },
  ): string | { why: string; path: string } => {
    if (v === undefined || v === null) {
      return { why: `${String(v)}${ABSENT_ADVICE}`, path: '' }
    }
    if (
      typeof v === 'number' ||
      typeof v === 'bigint' ||
      typeof v === 'boolean'
    ) {
      soFar.shape = '%'
      return String(v)
    }
    if (Array.isArray(v)) {
      const items = v.slice()
      if (items.length !== 1 && beforeTarget.test(soFar.shape)) {
        return {
          why: items.length > 1 ? NOT_ONE_WORD : NO_TARGET,
          path: '',
        }
      }
      if (items.length > 1 && !beforeWords.test(soFar.shape)) {
        return { why: NOT_ONE_WORD, path: '' }
      }
      let words = ''
      for (let i = 0; i < items.length; i++) {
        soFar.shape += i === 0 ? '' : ' '
        const word = renderPiece(items[i], soFar)
        if (typeof word !== 'string') {
          return { why: word.why, path: `[${i}]${word.path}` }
        }
        words += (i === 0 ? '' : ' ') + word
      }
      return words
    }
    if (
      typeof v === 'object' &&
      v !== null &&
      Object.hasOwn(v, 'raw') &&
      typeof (v as { raw?: unknown }).raw === 'string'
    ) {
      const rawText = (v as { raw: string }).raw
      soFar.shape += rawText
      return mayLeaveUnquoted(v) ? rawText : { why: UNWRITTEN_RAW, path: '' }
    }
    if (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as { stdout?: unknown }).stdout === 'string' &&
      'exitCode' in v
    ) {
      soFar.shape = '%'
      return quoteCodeModeShellArg(
        (v as unknown as { stdout: string }).stdout.replace(/\n$/, ''),
        shellKind,
      )
    }
    soFar.shape = '%'
    return quoteCodeModeShellArg(v, shellKind)
  }

  let cmd = textAt(0)
  const soFar = { shape: cmd }
  for (let i = 0; i < values.length; i++) {
    const word = renderPiece(values[i], soFar)
    if (typeof word !== 'string') {
      let before = textAt(0)
      for (let j = 1; j <= i; j++) before += '${}' + textAt(j)
      let after = textAt(i + 1)
      for (let j = i + 2; j <= values.length; j++) after += '${}' + textAt(j)
      const shown =
        (before.length > SHOWN_EACH_SIDE ? '...' : '') +
        before.slice(-SHOWN_EACH_SIDE) +
        '${?}' +
        after.slice(0, SHOWN_EACH_SIDE) +
        (after.length > SHOWN_EACH_SIDE ? '...' : '')
      throw new Error(
        `$ did not run this command: ${word.path === '' ? '' : `item ${word.path} of `}\${} value ${i + 1} of ${values.length} (the \${?} in ${JSON.stringify(shown)}) is ${word.why}`,
      )
    }
    const next = textAt(i + 1)
    cmd += word + next
    soFar.shape += next
  }
  return cmd
}

/**
 * Official 2.1.326 #232: checks whether a prefixed shell command (from `$`'s
 * `.cwd()` / `.env()`) hides a `dangerousRemoval` circuit breaker that would
 * trigger on the unprefixed written command, returning a refusal string if so.
 */
export async function checkPrefixedCodeModeShellCommand(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolUseContext,
): Promise<string | undefined> {
  const command = typeof input.command === 'string' ? input.command : undefined
  if (!command || typeof tool.checkPermissions !== 'function') return undefined
  // Extract written body when prefixed with Bash (`cd ... && `, `export ...; `)
  // or PowerShell (`Set-Location -LiteralPath '...' -ErrorAction Stop; `, `$env:K = '...'; `).
  const isPowerShell = tool.name === 'PowerShell'
  const prefixMatch = isPowerShell
    ? /^(?:Set-Location -LiteralPath '(?:[^']|'')*' -ErrorAction Stop;\s*)?(?:(?:\$env:[A-Za-z_][A-Za-z0-9_]* = '(?:[^']|'')*';\s*)+)?([\s\S]+)$/.exec(
        command,
      )
    : /^(?:cd\s+'(?:[^']|'\\'')*'\s*&&\s*)?(?:export\s+(?:[A-Za-z_][A-Za-z0-9_]*='(?:[^']|'\\'')*'\s*)+;\s*)?([\s\S]+)$/.exec(
        command,
      )
  const written = prefixMatch?.[1]
  const removalRe = isPowerShell
    ? /\b(?:r\W*m|remove-item|del|ri|rd|rmdir|erase)\b/i
    : /\br\W*m/i
  if (!written || written === command || !removalRe.test(written)) {
    return undefined
  }
  try {
    const res = await tool.checkPermissions(
      { ...input, command: written } as never,
      context,
    )
    const reason = (
      res as {
        decisionReason?: { circuitBreaker?: string; reason?: string }
      }
    )?.decisionReason
    if (reason?.circuitBreaker === 'dangerousRemoval' && reason.reason) {
      return `This command was not run. ${reason.reason}.\nIf you mean to remove it, write the full path in the command itself, not a shell variable or a relative path. The command then gets the normal permission check.`
    }
  } catch {
    // Best-effort check; fail open only if checkPermissions itself isn't applicable
  }
  return undefined
}

function formatValueForOutput(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Executes a JavaScript snippet inside an isolated VM context, exposing async
 * bindings for primitive tools and `callTool(name, input)`.
 */
export async function executeCodeModeScript(
  options: ExecuteCodeModeScriptOptions,
): Promise<CodeModeExecutionResult> {
  const {
    code,
    invokeTool,
    timeoutMs = REPL_SYNC_RUN_MS,
    toolCallCap = REPL_TOOL_CALL_CAP,
    signal,
    shellKind = 'bash',
    allowedTools,
    unsetVars,
    onProgress,
    permissionMode,
    getCachedFileContent,
  } = options

  noteReplContextCreated()

  const clampedTimeout = Math.max(100, Math.min(timeoutMs, REPL_MAX_TIMEOUT_MS))
  const logs: string[] = []
  let toolCalls = 0
  let nextCallSeq = 0
  // Official 2.1.328 (#653): track in-flight tool calls so failures report
  // which tool calls were still running when the script failed.
  const inFlightCalls = new Map<number, string>()
  const scriptReadCache = new Map<string, string>()
  let timerRef: PausableCodeModeTimer | undefined

  const guardedCall = async (
    toolName: string,
    input: Record<string, unknown> = {},
  ): Promise<unknown> => {
    if (signal?.aborted) {
      throw new Error('Code Mode script aborted')
    }
    if (
      allowedTools &&
      !toolName.startsWith('mcp__') &&
      !allowedTools.has(toolName)
    ) {
      throw new Error(`Tool not available in Code Mode: ${toolName}`)
    }
    if (++toolCalls > toolCallCap) {
      throw new Error(
        `Code Mode tool call limit reached (${toolCallCap} calls)`,
      )
    }
    // Official 2.1.328 (#652): an edit that changes nothing no longer stops a script.
    if (toolName === 'Edit' && isNoOpCodeModeEdit(input)) {
      return {
        filePath: typeof input.file_path === 'string' ? input.file_path : '',
        changed: false,
        noOp: true,
      }
    }
    const callId = ++nextCallSeq
    const callLabel =
      (toolName === 'Bash' || toolName === 'PowerShell') &&
      typeof input.command === 'string'
        ? `${toolName}(${JSON.stringify(input.command.slice(0, 60))})`
        : toolName
    inFlightCalls.set(callId, callLabel)
    // Official 2.1.328 (#571): pause the script timer while waiting on prompts
    // outside auto/bypass mode, plan approvals, or questions.
    const shouldPause = shouldPauseCodeModeTimerForTool(
      toolName,
      permissionMode,
    )
    if (shouldPause) timerRef?.pause()
    try {
      const result = await invokeTool(toolName, input)
      if (toolName === 'Read' && typeof input.file_path === 'string') {
        const readContent =
          result &&
          typeof result === 'object' &&
          'file' in result &&
          typeof (result as { file?: { content?: unknown } }).file?.content ===
            'string'
            ? (result as { file: { content: string } }).file.content
            : result &&
                typeof result === 'object' &&
                'content' in result &&
                typeof (result as { content?: unknown }).content === 'string'
              ? (result as { content: string }).content
              : undefined
        if (readContent !== undefined) {
          scriptReadCache.set(input.file_path, readContent)
        }
      } else if (
        toolName === 'Write' &&
        typeof input.file_path === 'string' &&
        typeof input.content === 'string'
      ) {
        scriptReadCache.set(input.file_path, input.content)
      }
      return result
    } catch (err) {
      // Official 2.1.328 (#652): on failed Edit, attach closest-match hint only
      // from already-cached readable content (never invoke Read, which could
      // bypass allowedTools or trigger a Read permission prompt).
      if (
        toolName === 'Edit' &&
        typeof input.file_path === 'string' &&
        typeof input.old_string === 'string' &&
        err instanceof Error &&
        /not found|multiple|match/i.test(err.message) &&
        (!allowedTools || allowedTools.has('Read'))
      ) {
        const content =
          scriptReadCache.get(input.file_path) ??
          getCachedFileContent?.(input.file_path)
        if (content !== undefined) {
          const hint = findClosestEditMatchHint(content, input.old_string)
          if (hint) {
            throw new Error(`${err.message}\n${hint}`)
          }
        }
      }
      throw err
    } finally {
      if (shouldPause) timerRef?.resume()
      inFlightCalls.delete(callId)
    }
  }

  // Official 2.1.326 #293: `$` shell helper exposed in Code Mode VM sandbox.
  // Refuses invalid interpolated values, non-literal `{ raw }`, arrays in
  // non-word-boundary / redirect positions, PowerShell typographic quotes, and
  // invalid `.env()` keys BEFORE invoking Bash/PowerShell (nothing runs).
  const startShellCommand = (command: string, initialTimeout?: number) => {
    let nothrow = false
    let ms = initialTimeout
    let cwdVal: string | undefined
    let envVal: unknown
    const p = (async () => {
      await Promise.resolve()
      let cmd = String(command)
      if (envVal !== undefined) {
        cmd = buildCodeModeShellEnvPrefix(envVal, shellKind) + cmd
      }
      if (cwdVal !== undefined) {
        const quotedCwd = quoteCodeModeShellArg(cwdVal, shellKind)
        cmd =
          (shellKind === 'powershell'
            ? `Set-Location -LiteralPath ${quotedCwd} -ErrorAction Stop; `
            : `cd ${quotedCwd} && `) + cmd
      }
      const shellToolName = shellKind === 'powershell' ? 'PowerShell' : 'Bash'
      // Official 2.1.328 (#651): surface the running command while it executes.
      onProgress?.({
        type: 'command_start',
        command: cmd,
        toolName: shellToolName,
      })
      const rawRes = await guardedCall(shellToolName, {
        command: cmd,
        ...(typeof ms === 'number' ? { timeout: ms } : {}),
      })
      const rec =
        rawRes && typeof rawRes === 'object'
          ? (rawRes as Record<string, unknown>)
          : {}
      const stdout = typeof rec.stdout === 'string' ? rec.stdout : ''
      const stderr = typeof rec.stderr === 'string' ? rec.stderr : ''
      if (stdout) {
        onProgress?.({
          type: 'command_output',
          command: cmd,
          chunk: stdout,
          stream: 'stdout',
        })
      }
      if (stderr) {
        onProgress?.({
          type: 'command_output',
          command: cmd,
          chunk: stderr,
          stream: 'stderr',
        })
      }
      const exitCode =
        typeof rec.exitCode === 'number'
          ? rec.exitCode
          : typeof rec.code === 'number'
            ? rec.code
            : 0
      const outputWasCut =
        rec.truncated === true ||
        rec.middleCut === true ||
        rec.spillFileCut === true ||
        stdout.includes('characters truncated') ||
        typeof rec.persistedOutputPath === 'string'
      const out = {
        stdout,
        stderr,
        exitCode,
        ...(outputWasCut ? { truncated: true } : {}),
        text: () => stdout,
        lines: () => stdout.split('\n'),
        json: () => JSON.parse(stdout),
      }
      if (exitCode !== 0 && !nothrow) {
        // Official 2.1.328 (#577): explicitly tell Code Mode scripts when a
        // failing command's long output was cut/truncated.
        const cutNotice = outputWasCut
          ? '\nNote: the command failed, and its output was too long to keep whole, so stdout has a "characters truncated" line where the middle was cut out.'
          : ''
        const err = new Error(
          `Command failed with exit code ${exitCode}${stderr ? `:\n${stderr}` : ''}${cutNotice}`,
        )
        err.name = 'ShellError'
        throw err
      }
      return out
    })()
    void p.catch(() => {})
    const shellPromise = p as Promise<{
      stdout: string
      stderr: string
      exitCode: number
      text: () => string
      lines: () => string[]
      json: () => unknown
    }> & {
      nothrow: () => typeof shellPromise
      throws: (on: boolean) => typeof shellPromise
      quiet: () => typeof shellPromise
      timeout: (n: number) => typeof shellPromise
      cwd: (d: string) => typeof shellPromise
      env: (e: unknown) => typeof shellPromise
      text: () => Promise<string>
      lines: () => Promise<string[]>
      json: () => Promise<unknown>
    }
    shellPromise.nothrow = () => {
      nothrow = true
      return shellPromise
    }
    shellPromise.throws = (on: boolean) => {
      nothrow = !on
      return shellPromise
    }
    shellPromise.quiet = () => shellPromise
    shellPromise.timeout = (n: number) => {
      ms = n
      return shellPromise
    }
    shellPromise.cwd = (d: string) => {
      cwdVal = String(d)
      return shellPromise
    }
    shellPromise.env = (e: unknown) => {
      envVal = e
      return shellPromise
    }
    shellPromise.text = () => p.then(o => o.stdout)
    shellPromise.lines = () => p.then(o => o.stdout.split('\n'))
    shellPromise.json = () => p.then(o => JSON.parse(o.stdout))
    return shellPromise
  }

  const dollarHelper = Object.assign(
    (first: unknown, ...values: unknown[]) => {
      if (Array.isArray(first) && Object.hasOwn(first, 'raw')) {
        const rendered = renderCodeModeShellTemplate(
          first as readonly string[] & { raw?: readonly string[] },
          values,
          { shellKind },
        )
        return startShellCommand(rendered)
      }
      return startShellCommand(
        String(first),
        typeof values[0] === 'number' ? values[0] : undefined,
      )
    },
    {
      escape: (s: unknown) => quoteCodeModeShellArg(s, shellKind),
    },
  )

  const sandbox: Record<string, unknown> = {
    console: {
      log: (...args: unknown[]) =>
        logs.push(args.map(a => formatValueForOutput(a)).join(' ')),
      warn: (...args: unknown[]) =>
        logs.push(args.map(a => formatValueForOutput(a)).join(' ')),
      error: (...args: unknown[]) =>
        logs.push(args.map(a => formatValueForOutput(a)).join(' ')),
    },
    callTool: guardedCall,
    $: dollarHelper,
    JSON,
    Math,
    Date,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    Promise,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  }

  // Official 2.1.328 (#581): Only expose primitive shorthands (especially
  // `write()` and `edit()`) when the current agent/subagent actually has those
  // tools available.
  const exposedTools: string[] = []
  for (const [fnName, toolName] of PRIMITIVE_SHORTHAND_MAP) {
    if (allowedTools && !allowedTools.has(toolName)) {
      continue
    }
    exposedTools.push(toolName)
    sandbox[fnName] = (input: Record<string, unknown> = {}) =>
      guardedCall(toolName, input)
  }
  sandbox.tools = {
    list: () => (allowedTools ? [...allowedTools] : [...exposedTools]),
  }

  const context = vm.createContext(sandbox)
  // Official 2.1.328 (#576): guard references to top-level variables declared
  // by an earlier failed script that were never set.
  const guardedCode = unsetVars ? injectUnsetVarGuards(code, unsetVars) : code
  const wrappedSource = `(async () => {\n${guardedCode}\n})()`

  try {
    const script = new vm.Script(wrappedSource, {
      filename: REPL_SCRIPT_FILENAME,
    })
    const runPromise = Promise.resolve(
      script.runInContext(context, { timeout: clampedTimeout }),
    )
    // Suppress unhandledRejection if runPromise rejects after timeout/abort wins the race.
    void runPromise.catch(() => {})

    let onAbort: (() => void) | undefined
    const raced = await Promise.race([
      runPromise,
      new Promise<never>((_resolve, reject) => {
        timerRef = createPausableCodeModeTimer(clampedTimeout, () => {
          reject(
            new Error(`Code Mode script timed out after ${clampedTimeout}ms`),
          )
        })
      }),
      ...(signal
        ? [
            new Promise<never>((_resolve, reject) => {
              if (signal.aborted) {
                reject(new Error('Code Mode script aborted'))
                return
              }
              onAbort = () => reject(new Error('Code Mode script aborted'))
              signal.addEventListener('abort', onAbort, { once: true })
            }),
          ]
        : []),
    ]).finally(() => {
      timerRef?.clear()
      timerRef = undefined
      if (onAbort !== undefined) {
        signal?.removeEventListener('abort', onAbort)
      }
    })

    const outputParts: string[] = [...logs]
    if (raced !== undefined) {
      outputParts.push(formatValueForOutput(raced))
    }
    return {
      result: outputParts.join('\n') || '(completed with no output)',
      tool_calls: toolCalls,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const prefix = logs.length > 0 ? `${logs.join('\n')}\n` : ''
    // Official 2.1.328 (#653): report which tool calls were still running when
    // the script failed.
    const stillRunning = [...inFlightCalls.values()]
    const runningSuffix =
      stillRunning.length > 0
        ? `\nStill running when script failed: ${stillRunning.join(', ')}`
        : ''
    // Official 2.1.328 (#576): record declared top-level variables that may
    // have remained unset so subsequent scripts don't silently read `undefined`.
    const unsetVariables = extractTopLevelDeclaredVars(code)
    return {
      result: `${prefix}Error: ${message}${runningSuffix}`,
      tool_calls: toolCalls,
      ...(stillRunning.length > 0 ? { inFlightAtFailure: stillRunning } : {}),
      ...(unsetVariables.length > 0 ? { unsetVariables } : {}),
    }
  }
}

const CODE_MODE_VISIBLE_TOOL_NAMES = new Set([
  'REPL',
  'Eval',
  'StructuredOutput',
])

const codeModeAutoVerdictTracker = new CodeModeAutoVerdictTracker()
const sessionUnsetVarsByKey = new Map<string, Set<string>>()
let codeModeScriptSeq = 0

export function getCodeModeAutoVerdictTracker(): CodeModeAutoVerdictTracker {
  return codeModeAutoVerdictTracker
}

export function resetCodeModeRuntimeStateForTests(): void {
  sessionUnsetVarsByKey.clear()
  codeModeScriptSeq = 0
}

function getDeniedToolNamesFromPermissionContext(
  toolPermissionContext: unknown,
): Set<string> {
  const denied = new Set<string>()
  if (!toolPermissionContext || typeof toolPermissionContext !== 'object') {
    return denied
  }
  const alwaysDenyRules = (
    toolPermissionContext as {
      alwaysDenyRules?: Record<string, readonly string[] | undefined>
    }
  ).alwaysDenyRules
  if (!alwaysDenyRules || typeof alwaysDenyRules !== 'object') {
    return denied
  }
  for (const rules of Object.values(alwaysDenyRules)) {
    if (!Array.isArray(rules)) continue
    for (const rule of rules) {
      if (typeof rule !== 'string') continue
      const trimmed = rule.trim()
      if (trimmed.length > 0 && !trimmed.includes('(')) {
        denied.add(trimmed)
      }
    }
  }
  return denied
}

function resolveCodeModeEffectiveTools(
  baseReplToolName: string,
  resolveAvailableTools: () => readonly Tool[],
  context: ToolUseContext,
): Tool[] {
  const appState = context.getAppState?.()
  const deniedToolNames = getDeniedToolNamesFromPermissionContext(
    appState?.toolPermissionContext,
  )
  const contextTools = context.options?.tools
  const liveMcpTools = appState?.mcp?.tools ?? []
  const hasExplicitPrimitiveTools =
    Array.isArray(contextTools) &&
    contextTools.some(
      t =>
        !CODE_MODE_VISIBLE_TOOL_NAMES.has(t.name) &&
        t.name !== baseReplToolName,
    )

  let rawTools: readonly Tool[]
  if (context.agentId !== undefined) {
    if (hasExplicitPrimitiveTools) {
      // Restricted/read-only subagent with an explicit tool pool: never union
      // `resolveAvailableTools()` (which always includes Write/Edit).
      rawTools = contextTools
    } else {
      const agentCtx = getAgentContext()
      const subagentName =
        agentCtx?.agentType === 'subagent' ? agentCtx.subagentName : undefined
      const activeAgents = context.options?.agentDefinitions?.activeAgents
      const agentDef =
        subagentName && Array.isArray(activeAgents)
          ? activeAgents.find(a => a.agentType === subagentName)
          : undefined
      if (agentDef) {
        const disallowed = new Set(
          (agentDef.disallowedTools ?? []).map(spec => spec.split('(')[0]!),
        )
        const allowList =
          agentDef.tools &&
          !(agentDef.tools.length === 1 && agentDef.tools[0] === '*')
            ? new Set(agentDef.tools)
            : undefined
        rawTools = resolveAvailableTools().filter(t => {
          if (disallowed.has(t.name)) return false
          if (allowList && !allowList.has(t.name)) return false
          return true
        })
      } else if (Array.isArray(contextTools)) {
        rawTools = contextTools
      } else {
        rawTools = []
      }
    }
  } else if (hasExplicitPrimitiveTools) {
    // Explicit restricted tool list on main thread (e.g. `--tools Read,Grep`)
    rawTools = [...contextTools, ...liveMcpTools]
  } else {
    // Main thread with Code Mode hiding primitives from `context.options.tools`
    rawTools = [
      ...resolveAvailableTools(),
      ...(contextTools ?? []),
      ...liveMcpTools,
    ]
  }

  const seen = new Set<string>()
  const deduped: Tool[] = []
  for (const tool of rawTools) {
    if (deniedToolNames.has(tool.name) || seen.has(tool.name)) continue
    seen.add(tool.name)
    deduped.push(tool)
  }
  return deduped
}

/**
 * Wraps the base `REPLTool` so that when Code Mode is active, `call()` executes
 * JavaScript in the VM sandbox and routes every nested tool invocation through
 * `canUseTool` + the target tool's `call()` implementation.
 */
export function wrapReplToolForCodeMode(
  baseReplTool: Tool,
  resolveAvailableTools: () => readonly Tool[],
): Tool {
  let prevConnectedMcpServers = new Set<string>()

  return {
    ...baseReplTool,
    async prompt(options) {
      const basePrompt = await baseReplTool.prompt(options)
      if (!isCodeModeEnabled()) {
        return basePrompt
      }
      const available = resolveAvailableTools().filter(
        t => t.name !== baseReplTool.name,
      )
      const conciseLines = await Promise.all(
        available.map(async t => {
          const rawDesc =
            typeof t.description === 'function'
              ? await t.description({} as never, {
                  isNonInteractiveSession: false,
                  toolPermissionContext: {
                    mode: 'default',
                    additionalWorkingDirectories: new Map(),
                    alwaysAllowRules: {},
                    alwaysDenyRules: {},
                    alwaysAskRules: {},
                    isBypassPermissionsModeAvailable: false,
                  },
                  tools: available,
                })
              : ''
          return `- ${t.name}: ${buildConciseCodeModeToolDescription(t.name, rawDesc)}`
        }),
      )
      const toolsBlock =
        conciseLines.length > 0
          ? `\n\nAvailable Code Mode tools:\n${conciseLines.join('\n')}`
          : ''
      return `${basePrompt}${toolsBlock}\n\n${CODE_MODE_STATIC_MCP_GUIDANCE}`
    },
    async call(
      input: { code: string },
      context: ToolUseContext,
      canUseTool: CanUseToolFn,
      parentMessage: AssistantMessage,
      onProgress?: Parameters<Tool['call']>[4],
    ) {
      if (!isCodeModeEnabled()) {
        return await baseReplTool.call(
          input as never,
          context,
          canUseTool,
          parentMessage,
          onProgress,
        )
      }

      const collectedFeedback: string[] = []
      let activeCwd = getCwd()
      const currentPermissionMode =
        context.getAppState?.()?.toolPermissionContext?.mode
      const scriptId = context.toolUseId ?? `repl-${++codeModeScriptSeq}`
      const unsetKey = context.agentId ?? 'main'
      const priorUnsetVars = sessionUnsetVarsByKey.get(unsetKey)

      // Official 2.1.327 (#386): register per-script auto-mode verdict so
      // concurrent auto-allowed scripts do not revoke one another's verdict.
      codeModeAutoVerdictTracker.registerScript(scriptId)
      if (
        currentPermissionMode === 'auto' ||
        currentPermissionMode === 'bypassPermissions'
      ) {
        codeModeAutoVerdictTracker.markAllowed(scriptId)
      }

      // Official 2.1.328 (#581): compute the tool names allowed for this
      // session/subagent without unconditionally unioning Write/Edit into
      // restricted or read-only subagents.
      const initialTools = resolveCodeModeEffectiveTools(
        baseReplTool.name,
        resolveAvailableTools,
        context,
      )
      const allowedToolNames =
        initialTools.length > 0 ||
        context.agentId !== undefined ||
        Array.isArray(context.options?.tools)
          ? new Set(initialTools.map(t => t.name))
          : undefined

      let scriptHookHalted = false
      let scriptHookStopReason: string | undefined
      let innerCallSeq = 0
      const CODE_MODE_HOOK_HALT_REFUSAL =
        "This tool call did not run. A hook returned continue: false for another tool call from the same piece of code, so every further tool call from it is refused. The hook's reason is sent with that code's result."
      // Official 2.1.328 (@325273887): inner hook feedback attachment types
      // surfaced on the Code Mode script result via ToolResult.newMessages.
      const CODE_MODE_HOOK_FEEDBACK_TYPES = new Set([
        'hook_blocking_error',
        'hook_additional_context',
        'hook_stopped_continuation',
        'hook_system_message',
      ])
      const collectedHookMessages: AttachmentMessage[] = []
      const extractHookAttachmentMessage = (
        entry: unknown,
      ): AttachmentMessage | undefined => {
        if (!entry || typeof entry !== 'object') return undefined
        const obj = entry as { type?: string; message?: unknown }
        if (obj.type === 'attachment' && 'attachment' in obj) {
          return obj as AttachmentMessage
        }
        if (
          obj.message &&
          typeof obj.message === 'object' &&
          (obj.message as { type?: string }).type === 'attachment' &&
          'attachment' in (obj.message as object)
        ) {
          return obj.message as AttachmentMessage
        }
        return undefined
      }
      const recordHookFeedbackMessage = (
        msg: AttachmentMessage | undefined,
      ): void => {
        if (!msg || msg.type !== 'attachment') return
        const att = msg.attachment as {
          type?: string
          message?: string
        }
        if (!att?.type || !CODE_MODE_HOOK_FEEDBACK_TYPES.has(att.type)) return
        if (att.type === 'hook_stopped_continuation') {
          if (scriptHookHalted && scriptHookStopReason !== undefined) {
            return
          }
          scriptHookHalted = true
          if (typeof att.message === 'string' && att.message.length > 0) {
            scriptHookStopReason = att.message
          }
          if (
            !collectedHookMessages.some(
              m => m.attachment.type === 'hook_stopped_continuation',
            )
          ) {
            collectedHookMessages.push(msg)
          }
          return
        }
        collectedHookMessages.push(msg)
      }

      let execution: CodeModeExecutionResult
      try {
        execution = await executeCodeModeScript({
          code: input.code,
          signal: context.abortController.signal,
          allowedTools: allowedToolNames,
          unsetVars: priorUnsetVars,
          permissionMode: currentPermissionMode,
          getCachedFileContent:
            !allowedToolNames || allowedToolNames.has('Read')
              ? filePath => {
                  const normalized = normalizeCodeModeToolInput(
                    'Read',
                    { file_path: filePath },
                    activeCwd,
                  )
                  const resolvedPath =
                    typeof normalized.file_path === 'string'
                      ? normalized.file_path
                      : filePath
                  const entry =
                    context.readFileState?.get(resolvedPath) ??
                    context.readFileState?.get(filePath)
                  return typeof entry?.content === 'string' &&
                    entry.content.length > 0
                    ? entry.content
                    : undefined
                }
              : undefined,
          onProgress: onProgress
            ? event => {
                onProgress({
                  toolUseID: context.toolUseId ?? 'repl',
                  data: { type: 'code_mode_progress', event } as never,
                })
              }
            : undefined,
          invokeTool: async (toolName, rawInput) => {
            if (scriptHookHalted) {
              throw new Error(CODE_MODE_HOOK_HALT_REFUSAL)
            }
            // Official 2.1.328 (#572 & #581): re-resolve live MCP tools on main
            // thread while continuing to enforce restricted/subagent tool pools.
            const allTools = resolveCodeModeEffectiveTools(
              baseReplTool.name,
              resolveAvailableTools,
              context,
            )
            const target = allTools.find(
              t => t.name === toolName && t.name !== baseReplTool.name,
            )
            if (!target) {
              throw new Error(`Tool not available in Code Mode: ${toolName}`)
            }
            // Official 2.1.325 #2314: always read live cwd (follows EnterWorktree)
            // and expand `~` / relative paths against it before schema validation.
            activeCwd = getCwd() || activeCwd
            const normalizedInput = normalizeCodeModeToolInput(
              toolName,
              rawInput,
              activeCwd,
            )
            const parsed = target.inputSchema.safeParse(normalizedInput)
            if (!parsed.success) {
              throw new Error(
                `Invalid input for ${toolName}: ${parsed.error.message}`,
              )
            }
            // Official 2.1.326 #232: run tool.validateInput before canUseTool,
            // check prefixed shell commands for dangerousRemoval circuit breakers,
            // and suspend sandbox auto-allow on inner Code Mode calls so more
            // sandboxed commands go through normal permission checks / ask / refuse.
            if (typeof target.validateInput === 'function') {
              const validation = await target.validateInput(
                parsed.data as never,
                context,
              )
              if (validation && validation.result === false) {
                throw new Error(
                  validation.message ?? `Invalid input for ${toolName}`,
                )
              }
            }
            if (toolName === 'Bash' || toolName === 'PowerShell') {
              const prefixedRefusal = await checkPrefixedCodeModeShellCommand(
                target,
                parsed.data as Record<string, unknown>,
                context,
              )
              if (prefixedRefusal !== undefined) {
                throw new Error(prefixedRefusal)
              }
            }

            const innerToolUseId = `${context.toolUseId ?? 'repl'}:${toolName}:${++innerCallSeq}`
            const defaultPermissionContext = {
              mode: 'default' as const,
              additionalWorkingDirectories: new Map(),
              alwaysAllowRules: {},
              alwaysDenyRules: {},
              alwaysAskRules: {},
              isBypassPermissionsModeAvailable: false,
            }
            const safeGetAppState: ToolUseContext['getAppState'] =
              typeof context.getAppState === 'function'
                ? () => {
                    const st = context.getAppState()
                    if (st?.toolPermissionContext && st?.sessionHooks) return st
                    return {
                      ...st,
                      ...(st?.toolPermissionContext
                        ? {}
                        : { toolPermissionContext: defaultPermissionContext }),
                      ...(st?.sessionHooks ? {} : { sessionHooks: new Map() }),
                    }
                  }
                : () =>
                    ({
                      toolPermissionContext: defaultPermissionContext,
                      sessionHooks: new Map(),
                    }) as ReturnType<ToolUseContext['getAppState']>

            const innerHookContext: ToolUseContext = {
              ...context,
              toolUseId: innerToolUseId,
              options: context.options ?? ({} as ToolUseContext['options']),
              getAppState: safeGetAppState,
            }
            const hooksActive =
              innerHookContext.options.settingsHooksOff !== true &&
              innerHookContext.options.bareFork !== true
            const messageId = parentMessage?.message?.id ?? ''
            const requestId = parentMessage?.requestId

            let currentInput = parsed.data as Record<string, unknown>
            let managedPrePassRan = false
            let hookPermissionResult: PermissionResult | undefined
            let shouldPreventContinuation = false
            let stopReason: string | undefined

            // Lazy-load hook & permission modules to avoid static import cycles
            // (hooks.ts -> settings/tools -> codeMode/executor.ts).
            const [
              hooksMod,
              toolHooksMod,
              managedPassMod,
              functionHooksHopMod,
              mcpUtilsMod,
            ] = await Promise.all([
              import('../../utils/hooks.js'),
              import('../tools/toolHooks.js'),
              import('../../utils/hooks/toolCallManagedPass.js'),
              import('../../utils/plugins/functionHooksHop.js'),
              import('../mcp/utils.js'),
            ])
            const { executePreToolHooks } = hooksMod
            const {
              collectManagedOnlyPostToolUse,
              resolveHookPermissionDecision,
              runPostToolUseFailureHooks,
              runPostToolUseHooks,
              runPreToolUseHooks,
            } = toolHooksMod
            const { shouldPreserveManagedToolHookPass } = managedPassMod
            const { pinValue } = functionHooksHopMod
            const { isMcpTool } = mcpUtilsMod

            // Official 2.1.328 (@325454468 / @325274402): wire full PreToolUse
            // hooks (including managed pre-pass, updatedInput, and continue:false
            // halting subsequent inner calls in the script) before permission/call.
            if (hooksActive) {
              const managedMode = safeGetAppState().toolPermissionContext.mode
              const managedResult: ManagedPreToolPassResult = {}
              const managedReplayYields: unknown[] = []
              for await (const item of executePreToolHooks(
                target.name,
                innerToolUseId,
                currentInput,
                innerHookContext,
                managedMode,
                innerHookContext.abortController.signal,
                undefined,
                undefined,
                target.getToolUseSummary?.(currentInput),
                { managedHooksOnly: true },
              )) {
                if (item.preventContinuation) {
                  const reason =
                    item.stopReason || 'Execution stopped by PreToolUse hook'
                  scriptHookHalted = true
                  if (!innerHookContext.abortController.signal.aborted) {
                    recordHookFeedbackMessage(
                      createAttachmentMessage({
                        type: 'hook_stopped_continuation',
                        message: reason,
                        hookName: `PreToolUse:${target.name}`,
                        toolUseID: innerToolUseId,
                        hookEvent: 'PreToolUse',
                      }),
                    )
                  }
                  throw new Error(reason)
                }
                if (item.blockingError) {
                  const msg =
                    item.blockingError.blockingError ||
                    `PreToolUse hook blocked ${toolName}`
                  managedResult.deny = msg
                  throw new Error(msg)
                }
                if (item.permissionBehavior === 'deny') {
                  const msg =
                    item.hookPermissionDecisionReason ||
                    `PreToolUse hook denied ${toolName}`
                  managedResult.deny = msg
                  throw new Error(msg)
                }
                if (item.permissionBehavior === 'ask') {
                  managedResult.ask =
                    item.hookPermissionDecisionReason ||
                    `PreToolUse hook requires confirmation for ${toolName}`
                } else if (item.permissionBehavior === 'allow') {
                  managedResult.allow = true
                }
                if (item.updatedInput !== undefined) {
                  const parsedUpdated = target.inputSchema.safeParse(
                    item.updatedInput,
                  )
                  const remainingIssues = parsedUpdated.success
                    ? []
                    : parsedUpdated.error.issues.filter(
                        issue => issue.code !== 'unrecognized_keys',
                      )
                  if (!parsedUpdated.success && remainingIssues.length > 0) {
                    throw new Error(
                      `PreToolUse hook for ${toolName} returned updatedInput that failed schema validation`,
                    )
                  }
                  currentInput = normalizeCodeModeToolInput(
                    toolName,
                    item.updatedInput,
                    activeCwd,
                  )
                  managedResult.updatedInput = currentInput
                }
                if (item.additionalContexts?.length) {
                  managedResult.additionalContext = [
                    ...(managedResult.additionalContext ?? []),
                    ...item.additionalContexts,
                  ]
                }
                const {
                  permissionBehavior,
                  hookPermissionDecisionReason: _reason,
                  blockingError: _blocking,
                  updatedInput: _input,
                  additionalContexts: _contexts,
                  ...rest
                } = item as Record<string, unknown>
                if (permissionBehavior === 'defer') {
                  managedReplayYields.push({
                    permissionBehavior,
                    hookSource: rest.hookSource,
                  })
                }
                if (Object.keys(rest).some(key => key !== 'hookSource')) {
                  managedReplayYields.push(rest)
                }
              }
              const managedPass: ToolCallManagedPass = {
                toolUseId: innerToolUseId,
                input: currentInput,
                inputKey: () => pinValue(currentInput),
                pass: { result: managedResult, yields: managedReplayYields },
              }
              innerHookContext.managedPass = managedPass
              managedPrePassRan = true

              for await (const hookRes of runPreToolUseHooks(
                innerHookContext,
                target,
                currentInput,
                innerToolUseId,
                messageId,
                requestId,
                undefined,
                undefined,
              )) {
                switch (hookRes.type) {
                  case 'message':
                    recordHookFeedbackMessage(
                      extractHookAttachmentMessage(hookRes.message),
                    )
                    break
                  case 'additionalContext':
                    recordHookFeedbackMessage(
                      extractHookAttachmentMessage(hookRes.message),
                    )
                    break
                  case 'hookPermissionResult':
                    if (
                      hookPermissionResult?.behavior !== 'deny' ||
                      hookRes.hookPermissionResult.behavior === 'deny'
                    ) {
                      hookPermissionResult = hookRes.hookPermissionResult
                    }
                    break
                  case 'hookUpdatedInput':
                    currentInput = normalizeCodeModeToolInput(
                      toolName,
                      hookRes.updatedInput,
                      activeCwd,
                    )
                    break
                  case 'preventContinuation':
                    if (hookRes.shouldPreventContinuation) {
                      shouldPreventContinuation = true
                      scriptHookHalted = true
                    }
                    break
                  case 'stopReason':
                    stopReason = hookRes.stopReason
                    break
                  case 'stop': {
                    const reason =
                      hookRes.stopReason ??
                      stopReason ??
                      'Execution stopped by PreToolUse hook'
                    if (shouldPreventContinuation || hookRes.stopReason) {
                      scriptHookHalted = true
                      if (!innerHookContext.abortController.signal.aborted) {
                        recordHookFeedbackMessage(
                          createAttachmentMessage({
                            type: 'hook_stopped_continuation',
                            message: reason,
                            hookName: `PreToolUse:${target.name}`,
                            toolUseID: innerToolUseId,
                            hookEvent: 'PreToolUse',
                          }),
                        )
                      }
                    }
                    throw new Error(reason)
                  }
                  case 'defer':
                    throw new Error(
                      `PreToolUse hook ${hookRes.hookName} returned permissionDecision=defer, which is not supported inside Code Mode`,
                    )
                }
              }
              if (shouldPreventContinuation) {
                const reason =
                  stopReason ?? 'Execution stopped by PreToolUse hook'
                scriptHookHalted = true
                if (!innerHookContext.abortController.signal.aborted) {
                  recordHookFeedbackMessage(
                    createAttachmentMessage({
                      type: 'hook_stopped_continuation',
                      message: reason,
                      hookName: `PreToolUse:${target.name}`,
                      toolUseID: innerToolUseId,
                      hookEvent: 'PreToolUse',
                    }),
                  )
                }
                throw new Error(reason)
              }
            }

            const ridesAutoVerdict =
              codeModeAutoVerdictTracker.ridesNow(scriptId)
            const innerPermissionContext: ToolUseContext = {
              ...innerHookContext,
              permissionLayers: [
                ...(context.permissionLayers ?? []),
                {
                  kind: 'sandbox_auto_allow_suspended' as never,
                  allowOnly: true,
                  ridesAutoVerdict,
                } as never,
              ],
            }
            const resolved = await resolveHookPermissionDecision(
              hookPermissionResult,
              target,
              currentInput,
              innerPermissionContext,
              canUseTool,
              parentMessage,
              innerToolUseId,
            )
            const permission = resolved.decision
            if (permission.behavior !== 'allow') {
              if (currentPermissionMode === 'auto') {
                codeModeAutoVerdictTracker.markBlocked(
                  scriptId,
                  permission.message ?? `Permission denied for ${toolName}`,
                )
              }
              throw new Error(
                permission.message ?? `Permission denied for ${toolName}`,
              )
            }
            const finalInput = normalizeCodeModeToolInput(
              toolName,
              (permission.updatedInput as
                | Record<string, unknown>
                | undefined) ?? resolved.input,
              activeCwd,
            )
            const callStartMs = Date.now()
            let out: { data: unknown }
            try {
              out = await target.call(
                finalInput as never,
                innerHookContext,
                canUseTool,
                parentMessage,
              )
            } catch (callErr) {
              // Official 2.1.325 #2314: sync expired MCP server auth to /mcp.
              syncExpiredMcpAuthInCodeMode(
                toolName,
                callErr,
                context.setAppState,
              )
              if (hooksActive) {
                const errText =
                  callErr instanceof Error ? callErr.message : String(callErr)
                try {
                  for await (const failureRes of runPostToolUseFailureHooks(
                    innerHookContext,
                    target,
                    innerToolUseId,
                    messageId,
                    finalInput,
                    errText,
                    innerHookContext.abortController.signal.aborted,
                    requestId,
                    undefined,
                    undefined,
                    Date.now() - callStartMs,
                  )) {
                    if ('message' in failureRes) {
                      recordHookFeedbackMessage(
                        extractHookAttachmentMessage(failureRes.message),
                      )
                    }
                  }
                } catch {
                  // Never swallow the underlying tool error
                }
              }
              throw callErr
            }
            const callDurationMs = Date.now() - callStartMs
            if (hooksActive) {
              let hookData = out.data
              for await (const postRes of runPostToolUseHooks(
                innerHookContext,
                target,
                innerToolUseId,
                messageId,
                finalInput,
                hookData,
                requestId,
                undefined,
                undefined,
                callDurationMs,
              )) {
                if ('message' in postRes) {
                  recordHookFeedbackMessage(
                    extractHookAttachmentMessage(postRes.message),
                  )
                }
                if (
                  'updatedToolOutput' in postRes &&
                  (isMcpTool(target) ||
                    target.outputSchema?.safeParse(postRes.updatedToolOutput)
                      ?.success !== false)
                ) {
                  hookData = postRes.updatedToolOutput
                }
              }
              if (
                managedPrePassRan &&
                (shouldPreserveManagedToolHookPass(innerHookContext, target) ||
                  target.preserveToolUseResultInSubagents === true)
              ) {
                const managedPost = await collectManagedOnlyPostToolUse({
                  tool: target,
                  toolUseID: innerToolUseId,
                  toolInput: finalInput,
                  output: hookData,
                  toolUseContext: innerHookContext,
                  durationMs: callDurationMs,
                })
                if (
                  managedPost.rewritten &&
                  (isMcpTool(target) ||
                    target.outputSchema?.safeParse(managedPost.output)
                      ?.success !== false)
                ) {
                  hookData = managedPost.output
                }
                for (const m of managedPost.messages) {
                  recordHookFeedbackMessage(extractHookAttachmentMessage(m))
                }
              }
              out = { ...out, data: hookData }
            }
            // Official 2.1.325 #2314: follow newly entered worktree immediately.
            const enteredWorktree = extractEnteredWorktreePath(
              toolName,
              out.data,
            )
            if (enteredWorktree) {
              activeCwd = enteredWorktree
              setCwdState(enteredWorktree)
            }
            // Official 2.1.325 #2315: forward words typed with Yes at permission
            // dialog or plan approval back to Claude.
            const feedback = extractApprovalUserFeedback(permission, out.data)
            if (feedback) {
              collectedFeedback.push(feedback)
            }
            return out.data
          },
        })
      } finally {
        codeModeAutoVerdictTracker.endScript(scriptId)
      }

      // Official 2.1.328 (#576): track top-level variables declared in a failed
      // script so subsequent scripts guard against silently reading `undefined`.
      if (execution.unsetVariables && execution.unsetVariables.length > 0) {
        const nextSet = new Set(priorUnsetVars)
        for (const v of execution.unsetVariables) {
          nextSet.add(v)
        }
        sessionUnsetVarsByKey.set(unsetKey, nextSet)
      } else if (priorUnsetVars && priorUnsetVars.size > 0) {
        const newlySet = [
          ...extractTopLevelDeclaredVars(input.code),
          ...extractAssignedVars(input.code),
        ]
        for (const v of newlySet) {
          priorUnsetVars.delete(v)
        }
        if (priorUnsetVars.size === 0) {
          sessionUnsetVarsByKey.delete(unsetKey)
        }
      }

      // Official 2.1.328 (#648): post-script pause (0ms in auto/bypass/default).
      const postPauseMs = getCodeModePostScriptPauseMs(currentPermissionMode)
      if (postPauseMs > 0) {
        await new Promise<void>(r => setTimeout(r, postPauseMs))
      }

      // Official 2.1.328 (#649): dynamic MCP status delta without mutating the
      // static prompt-cached system prompt.
      const mcpClients = context.getAppState?.()?.mcp?.clients
      let mcpDeltaNotice: string | null = null
      if (Array.isArray(mcpClients) && mcpClients.length > 0) {
        const diff = diffCodeModeMcpServerStatus(
          prevConnectedMcpServers,
          mcpClients,
        )
        const hadPrev = prevConnectedMcpServers.size > 0
        prevConnectedMcpServers = diff.connected
        mcpDeltaNotice = buildCodeModeMcpStatusDelta({
          pendingServers: diff.pending,
          addedServers: hadPrev ? diff.added : undefined,
          removedServers: hadPrev ? diff.removed : undefined,
        })
      }

      const trailingBlocks: string[] = []
      if (collectedFeedback.length > 0) {
        trailingBlocks.push(
          collectedFeedback.map(f => `[User feedback]: ${f}`).join('\n'),
        )
      }
      if (mcpDeltaNotice) {
        trailingBlocks.push(mcpDeltaNotice)
      }

      const hookAdditionalContexts: string[] = []
      const hookBlockingErrors: string[] = []
      for (const msg of collectedHookMessages) {
        const att = msg.attachment as {
          type?: string
          content?: unknown
          blockingError?: { blockingError?: string }
        }
        if (
          att.type === 'hook_additional_context' &&
          Array.isArray(att.content)
        ) {
          for (const entry of att.content) {
            if (typeof entry === 'string' && entry.length > 0) {
              hookAdditionalContexts.push(entry)
            }
          }
        } else if (
          att.type === 'hook_blocking_error' &&
          typeof att.blockingError?.blockingError === 'string' &&
          att.blockingError.blockingError.length > 0
        ) {
          hookBlockingErrors.push(att.blockingError.blockingError)
        }
      }

      const resultData: CodeModeExecutionResult = {
        ...execution,
        ...(trailingBlocks.length > 0
          ? {
              result: execution.result
                ? `${execution.result}\n\n${trailingBlocks.join('\n\n')}`
                : trailingBlocks.join('\n\n'),
            }
          : {}),
        ...(collectedFeedback.length > 0
          ? { userFeedback: collectedFeedback }
          : {}),
        ...(scriptHookHalted ? { hookStoppedContinuation: true } : {}),
        ...(scriptHookStopReason !== undefined
          ? { hookStopReason: scriptHookStopReason }
          : {}),
        ...(hookAdditionalContexts.length > 0
          ? { hookAdditionalContext: hookAdditionalContexts }
          : {}),
        ...(hookBlockingErrors.length > 0 ? { hookBlockingErrors } : {}),
      }

      return {
        data: resultData,
        ...(collectedHookMessages.length > 0
          ? { newMessages: collectedHookMessages }
          : {}),
      }
    },
  }
}

export type CodeModeResumePlan = {
  pin?: boolean
  unpin?: boolean
  switched: boolean
  refused?: string
  refusedWhy?: string
  /**
   * Official 2.1.325 #2316: true when the resumed session ended mid-Code Mode
   * script — the host MUST wait for the user's next prompt instead of
   * auto-continuing the turn on resume.
   */
  waitForNextPrompt?: boolean
  /**
   * Official 2.1.328 #575: notice delivered to Claude when a Code Mode script
   * was cut off before finishing (including on picker resume or ask-permission mode).
   */
  interruptedScriptNotice?: string
  /**
   * Official 2.1.328 #573: true when resumed Code Mode session is eligible to
   * run scripts in the background in auto/bypass-permissions mode.
   */
  autoBackgroundEligible?: boolean
}

type ResumedTranscriptMessageLike = {
  type?: string
  message?: {
    role?: string
    content?: unknown
  }
}

/**
 * Official 2.1.325 #2316: detect whether a resumed session's transcript ended
 * while a Code Mode (`REPL`) script was still in flight (an assistant
 * `tool_use` for `REPL` with no completed `tool_result`, or a trailing
 * interrupted `REPL` tool_result). When true, resuming must NOT auto-start a
 * model turn — it must wait for the user's next prompt.
 */
export function didSessionEndDuringCodeModeScript(
  messages: readonly ResumedTranscriptMessageLike[] | undefined,
): boolean {
  if (!messages || messages.length === 0) return false
  const pendingReplToolUseIds = new Set<string>()
  let lastMeaningfulWasInterruptedRepl = false

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === 'object' &&
            (block as { type?: unknown }).type === 'tool_use' &&
            (block as { name?: unknown }).name === 'REPL' &&
            typeof (block as { id?: unknown }).id === 'string'
          ) {
            pendingReplToolUseIds.add((block as { id: string }).id)
          }
        }
      }
      lastMeaningfulWasInterruptedRepl = false
    } else if (msg.type === 'user') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        let sawReplResult = false
        let sawInterruptedRepl = false
        let sawNonResultUserText = false
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          const rec = block as {
            type?: unknown
            tool_use_id?: unknown
            is_error?: unknown
            content?: unknown
          }
          if (
            rec.type === 'tool_result' &&
            typeof rec.tool_use_id === 'string'
          ) {
            if (pendingReplToolUseIds.has(rec.tool_use_id)) {
              sawReplResult = true
              pendingReplToolUseIds.delete(rec.tool_use_id)
              const text =
                typeof rec.content === 'string'
                  ? rec.content
                  : JSON.stringify(rec.content ?? '')
              if (
                rec.is_error === true &&
                /interrupt|abort|ended/i.test(text)
              ) {
                sawInterruptedRepl = true
              }
            }
          } else if (rec.type === 'text') {
            sawNonResultUserText = true
          }
        }
        if (sawNonResultUserText) {
          lastMeaningfulWasInterruptedRepl = false
        } else if (sawReplResult) {
          lastMeaningfulWasInterruptedRepl = sawInterruptedRepl
        }
      } else if (typeof content === 'string' && content.trim().length > 0) {
        lastMeaningfulWasInterruptedRepl = false
      }
    }
  }

  return pendingReplToolUseIds.size > 0 || lastMeaningfulWasInterruptedRepl
}

/**
 * Official `planCodeModeFromSession` (`chunk-w140y4g2`): determines how to
 * reconcile the current Code Mode opt-in state with a resumed session's
 * `replMode` flag, and whether to wait for the user's next prompt (#2316).
 */
export function planCodeModeFromSession(
  session: {
    replMode?: boolean
    sessionId?: string
    headless?: boolean
    withinSession?: boolean
    permissionMode?: string
    fromPicker?: boolean
    messages?: readonly ResumedTranscriptMessageLike[]
  },
  onNotice?: (message: string) => void,
): CodeModeResumePlan {
  const canRun = codeModeBeforePin()
  const isResumedCodeMode = session.replMode === true
  const waitForNextPrompt =
    isResumedCodeMode && didSessionEndDuringCodeModeScript(session.messages)
  const interruptedScriptNotice = waitForNextPrompt
    ? buildCodeModeInterruptedScriptNotice({
        permissionMode: session.permissionMode,
        fromPicker: session.fromPicker,
      })
    : undefined
  const autoBackgroundEligible =
    isResumedCodeMode &&
    shouldRunCodeModeScriptInBackground(session.permissionMode, true)

  if (!canRun) {
    if (!isResumedCodeMode) {
      return { pin: undefined, switched: false }
    }
    const optIn = getCodeModeOptInState()
    const base = `This session was started in ${CODE_MODE_EXPERIMENTAL_NAME}`
    if (optIn.state === 'refused') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which ${codeModeRefusalReasonText(optIn.why)}, so it can't be resumed.`,
        refusedWhy: `opt_in_refused_${optIn.why}`,
      }
    }
    if (optIn.state === 'not_asked' && optIn.turnedOffIn === 'managed') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which your organization's settings don't allow, so it can't be resumed.`,
        refusedWhy: 'opt_in_off_managed',
      }
    }
    const resumeArg = session.sessionId
      ? `--resume ${session.sessionId}`
      : undefined
    return {
      pin: undefined,
      switched: false,
      refused: `${base}, which is off, so it can't be resumed.\nTo resume it, ${session.withinSession ? 'exit and ' : ''}${formatCodeModeCommand(1, resumeArg, 'step')}.`,
      refusedWhy: session.headless ? 'not_asked_headless' : 'not_asked',
    }
  }

  const currentlyOn = isCodeModeEnabled()
  if (!isResumedCodeMode) {
    onNotice?.(
      `${CODE_MODE_NAME} is on, but this session isn't using it, so it continues with the ordinary tools. New sessions use ${CODE_MODE_NAME}.`,
    )
    return currentlyOn
      ? { pin: false, switched: true }
      : { pin: undefined, switched: false }
  }
  return currentlyOn
    ? {
        pin: undefined,
        switched: false,
        ...(waitForNextPrompt ? { waitForNextPrompt: true } : {}),
        ...(interruptedScriptNotice ? { interruptedScriptNotice } : {}),
        ...(autoBackgroundEligible ? { autoBackgroundEligible: true } : {}),
      }
    : {
        pin: undefined,
        unpin: true,
        switched: true,
        ...(waitForNextPrompt ? { waitForNextPrompt: true } : {}),
        ...(interruptedScriptNotice ? { interruptedScriptNotice } : {}),
        ...(autoBackgroundEligible ? { autoBackgroundEligible: true } : {}),
      }
}

/**
 * Official `applyCodeModePlan`: pins or unpins Code Mode for a resumed session.
 */
export function applyCodeModePlan(plan: CodeModeResumePlan): void {
  if (plan.unpin) {
    unpinCodeMode()
  } else if (plan.pin !== undefined) {
    pinCodeMode(plan.pin)
  }
}

/**
 * Official `cloudMoveRefusal`: blocks moving an active Code Mode session to the cloud.
 */
export function cloudMoveRefusal(): string | undefined {
  if (isCodeModeEnabled()) {
    return `This session was started in ${CODE_MODE_EXPERIMENTAL_NAME}, which the move to the cloud can't carry yet, so it can't continue in the cloud.`
  }
  return undefined
}
