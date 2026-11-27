/**
 * Code Mode (2.1.323 #1964) JavaScript VM runtime & session resume planner.
 *
 * Allows Claude to write JavaScript that calls its available tools
 * (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, Agent, MCP tools, etc.)
 * through the session's permission pipeline (`canUseTool`) inside a sandboxed
 * Node `vm` context.
 */
import {
  isReplModeEnabled,
  REPL_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import type { REPLMediaBlock } from '@claude-code/builtin-tools/tools/REPLTool/REPLTool.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { types as utilTypes } from 'node:util'
import * as vm from 'node:vm'
import { getMainThreadAgentId, setCwdState } from '../../bootstrap/state.js'
import type { HostPermissionLayer } from '../../engine/hostPermissionLayers.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  consumeRemoteNativeToolLocallyChecked,
  createDefaultCanUseTool,
  getRemoteNativeToolCheck,
  getRemoteNativeToolRunner,
  resolveToolUseContext,
  type Tool,
  type ToolPermissionContext,
  type ToolResult,
  type ToolUseContext,
} from '../../Tool.js'
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
import { getDenyRuleForTool } from '../../utils/permissions/permissions.js'
import {
  applyPluginToolListDenyRules,
  applyPluginToolListFilter,
} from '../../utils/plugins/pluginToolList.js'
import {
  restrictedAlwaysCodeRunningNames,
  restrictedDenyToolNames,
} from '../../utils/restricted.js'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../utils/sessionHost.js'
import { saveReplMode } from '../../utils/sessionStorage.js'
import {
  buildCodeModeMcpStatusDelta,
  CODE_MODE_STATIC_MCP_GUIDANCE,
} from '../../utils/simpleSystemPrompt.js'
import { McpAuthError } from '../mcp/connectionHelpers.js'
import { mcpInfoFromString } from '../mcp/mcpStringUtils.js'
import {
  CODE_MODE_ENV_VAR,
  CODE_MODE_EXPERIMENTAL_NAME,
  CODE_MODE_NAME,
  REPL_DETACH_AFTER_MS,
  REPL_MAIN_THREAD_KEY,
  REPL_MAX_TIMEOUT_MS,
  REPL_PART_CAP,
  REPL_POST_SCRIPT_PAUSE_AUTO_MS,
  REPL_SCRIPT_FILENAME,
  REPL_SETTLE_WINDOW_MS,
  REPL_SYNC_RUN_MS,
  REPL_TOOL_CALL_CAP,
  REPL_UNAWAITED_PROMISE_ERROR,
  REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
} from './constants.js'
import * as optInModule from './optIn.js'
import {
  codeModeBeforePin,
  codeModeRefusalReasonText,
  formatCodeModeCommand,
  getCodeModeOptInState,
  hasCodeModeBeenUsed,
  isCodeModeAccepted,
  isCodeModeEnabled,
  noteReplContextCreated,
  pinCodeMode,
  unpinCodeMode,
} from './optIn.js'
import {
  createReplCodec,
  decodeReplWireValue,
  formatThrownErrorHeader,
  mapReplPlainErrorLine,
  type ReplDosLimits,
  ReplHostCallValidationError,
  type ReplPlainErrorLine,
  ReplTurnCallBudget,
  type ResolvedReplDosLimits,
  resolveReplDosLimits,
  safeParseWithCircularTransformGuard,
  summarizeReplErrorLine,
} from './replDosGuards.js'
import {
  ASYNC_REPL_MAX_EVALS,
  formatReplOutputEnvelope,
  getReplSessions,
  NO_EVALS,
  type ReplEvalAccess,
} from './replSessions.js'

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
  /** Official 2.1.328 (`cs.mapToolResultToToolResultBlockParam`): media blocks (images/documents) returned by inner tools. */
  media?: REPLMediaBlock[]
  /** Official 2.1.328: async REPL eval ID assigned by ReplSessions. */
  evalId?: number
  /** Official 2.1.328: elapsed milliseconds for async REPL eval. */
  ms?: number
  /** Official 2.1.328: true when the eval was dispatched asynchronously past the settle window (or rejected by cap). */
  asyncDispatched?: boolean
  /** Official 2.1.331 (`o$a` / `Sei`): concise user-facing line replacing a verbose REPL TypeError. */
  plainErrorLine?: ReplPlainErrorLine
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
 * Official 2.1.327 (#386) & 2.1.328 (`J.scriptChecks`): Per-script auto-mode
 * verdict tracker with deferred script classification and a stop chain so:
 * - A running Code Mode script keeps its allowed verdict when a second
 *   auto-mode-allowed script starts concurrently (#386).
 * - Scripts deferred in `auto` mode (`autoModeScriptCheckDeferred`) remain
 *   `unchecked` until an inner tool call needs a verdict, at which point
 *   `awaitVerdict` runs the deferred script check once for the queued batch.
 * - If the classifier/monitor blocks the batch, every queued script's `stop()`
 *   callback fires (aborting in-flight scripts immediately) and subsequent
 *   calls are refused.
 */
export type AutoScriptVerdictState =
  | 'pending'
  | 'unchecked'
  | 'allowed'
  | 'blocked'
  | 'atLimit'
  | 'none'

export type AutoScriptRecord = {
  id: string
  state: AutoScriptVerdictState
  blockedReason?: string
  blockedDecision?: PermissionResult
}

export type DeferredAutoScriptCheckEntry = {
  id: string
  code: string
  toolUseId: string
  runCheck: (
    combinedCode: string,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
  ) => Promise<PermissionResult>
  stop: (
    message: string,
    batchSize: number,
    cause: 'classifier' | 'monitor',
  ) => void
}

export type AutoScriptAwaitVerdictResult =
  | { kind: 'ride' }
  | { kind: 'checkCall' }
  | { kind: 'blocked'; decision: PermissionResult }

/**
 * Official 2.1.328 (`Md`): map a deferred script check's `PermissionResult` to
 * its `AutoScriptVerdictState`.
 */
export function classifyAutoModeScriptDecision(
  decision: PermissionResult,
): AutoScriptVerdictState {
  const reason = decision.decisionReason as
    | {
        type?: string
        classifierAllowed?: boolean
        denialLimitRun?: boolean
        monitorBlocked?: boolean
        reason?: string
      }
    | undefined
  if (decision.behavior === 'allow') {
    if (reason?.type === 'mode' && reason.denialLimitRun === true) {
      return 'atLimit'
    }
    if (reason?.type === 'classifier' && reason.classifierAllowed === true) {
      return 'allowed'
    }
    // Plain allow from classifier / test stub without denialLimitRun
    if (reason?.type === 'classifier' || reason === undefined) {
      return 'allowed'
    }
    return 'none'
  }
  if (decision.behavior === 'ask') {
    const hasDenialLimitFallback =
      'denialLimitFallback' in decision &&
      (decision as { denialLimitFallback?: unknown }).denialLimitFallback !==
        undefined
    return hasDenialLimitFallback || reason?.type === 'classifier'
      ? 'atLimit'
      : 'none'
  }
  if (decision.behavior === 'deny') {
    if (reason?.type === 'classifier' && reason.monitorBlocked === true) {
      return 'blocked'
    }
    return 'blocked'
  }
  return 'none'
}

export function formatAutoModeScriptBlockedMessage(
  reason: string,
  batchSize: number,
  cause: 'classifier' | 'monitor' = 'classifier',
): string {
  const otherCount = Math.max(0, batchSize - 1)
  const batchSuffix =
    otherCount > 0
      ? ` (along with ${otherCount} other ${otherCount === 1 ? 'script' : 'scripts'} in this REPL that it had not checked yet)`
      : ''
  const prefix =
    cause === 'monitor'
      ? "The API's escape monitor blocked this Code Mode script"
      : 'Auto mode blocked this Code Mode script'
  return `${prefix}${batchSuffix}: ${reason}`
}

export class CodeModeAutoVerdictTracker {
  private readonly records = new Map<string, AutoScriptRecord>()
  private readonly unchecked: DeferredAutoScriptCheckEntry[] = []
  private inFlight: Promise<{ settled: boolean; error?: unknown }> | undefined
  private unclassifiedCodeRan = false
  private everAdded = false

  registerScript(
    id: string,
    initialState: AutoScriptVerdictState = 'pending',
  ): AutoScriptRecord {
    const rec: AutoScriptRecord = { id, state: initialState }
    this.records.set(id, rec)
    return rec
  }

  getRecord(id: string): AutoScriptRecord | undefined {
    return this.records.get(id)
  }

  inUse(): boolean {
    return this.everAdded
  }

  hasUnclassifiedCodeRan(): boolean {
    return this.unclassifiedCodeRan
  }

  hasUnchecked(): boolean {
    return this.unchecked.length > 0
  }

  addDeferredCheck(entry: DeferredAutoScriptCheckEntry): AutoScriptRecord {
    this.everAdded = true
    const rec = this.records.get(entry.id) ?? this.registerScript(entry.id)
    rec.state = 'unchecked'
    this.unchecked.push(entry)
    return rec
  }

  markAllowed(id: string): void {
    const rec = this.records.get(id)
    if (rec) rec.state = 'allowed'
  }

  markBlocked(id: string, reason: string, decision?: PermissionResult): void {
    const rec = this.records.get(id)
    if (rec) {
      rec.state = 'blocked'
      rec.blockedReason = reason
      if (decision) rec.blockedDecision = decision
    }
  }

  markUnclassifiedCodeRan(): void {
    this.unclassifiedCodeRan = true
  }

  dropUnchecked(): void {
    for (const entry of this.unchecked.splice(0)) {
      const rec = this.records.get(entry.id)
      if (rec && rec.state === 'unchecked') {
        rec.state = 'none'
      }
    }
  }

  endScript(id: string): void {
    // Official `J.scriptChecks.ended`: neutralize stop callback on any queued
    // deferred entry for an already-finished script.
    for (const entry of this.unchecked) {
      if (entry.id === id) {
        entry.stop = () => {}
      }
    }
    this.records.delete(id)
  }

  reset(): void {
    this.records.clear()
    this.unchecked.length = 0
    this.inFlight = undefined
    this.unclassifiedCodeRan = false
    this.everAdded = false
  }

  /**
   * Returns true if `id` is allowed to ride its script-level auto-mode verdict.
   * Crucially (#386), another concurrently starting script that is still pending
   * or already allowed does NOT revoke this running script's allowed verdict.
   */
  ridesNow(id: string): boolean {
    if (this.unclassifiedCodeRan) return false
    if (this.unchecked.length > 0) return false
    const rec = this.records.get(id)
    return rec !== undefined && rec.state === 'allowed'
  }

  /**
   * Official 2.1.328 (`scriptChecks.awaitVerdict`): resolve any queued deferred
   * script checks before an inner tool runs. On deny/block, fires every queued
   * script's `stop` callback so running scripts abort immediately and no
   * further inner tools execute.
   */
  async awaitVerdict(
    id: string,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
  ): Promise<AutoScriptAwaitVerdictResult> {
    for (;;) {
      const rec = this.records.get(id)
      if (rec?.state === 'blocked' && rec.blockedDecision !== undefined) {
        return { kind: 'blocked', decision: rec.blockedDecision }
      }
      if (this.unclassifiedCodeRan) {
        return { kind: 'checkCall' }
      }
      if (this.unchecked.length === 0) {
        return rec?.state === 'allowed'
          ? { kind: 'ride' }
          : { kind: 'checkCall' }
      }
      if (context.abortController?.signal?.aborted) {
        throw new Error('Code Mode script aborted')
      }
      const isLeader = this.inFlight === undefined
      const checkPromise = (this.inFlight ??= this.runBatchCheck(
        context,
        canUseTool,
      ).finally(() => {
        this.inFlight = undefined
      }))
      const outcome = await checkPromise
      if (outcome.settled) continue
      if (isLeader && outcome.error !== undefined) {
        throw outcome.error
      }
      return { kind: 'checkCall' }
    }
  }

  private async runBatchCheck(
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
  ): Promise<{ settled: boolean; error?: unknown }> {
    const batch = this.unchecked.slice()
    const latest = batch.at(-1)
    if (!latest) return { settled: true }
    const combinedCode =
      batch.length === 1
        ? latest.code
        : batch.map((e, i) => `// script ${i + 1}\n${e.code}`).join('\n\n')
    let decision: PermissionResult
    try {
      decision = await latest.runCheck(combinedCode, context, canUseTool)
    } catch (err) {
      return { settled: false, error: err }
    }
    this.unchecked.splice(0, batch.length)
    const verdictState = classifyAutoModeScriptDecision(decision)
    const reasonObj = decision.decisionReason as
      | { type?: string; monitorBlocked?: boolean }
      | undefined
    const cause: 'classifier' | 'monitor' =
      decision.behavior === 'deny' &&
      reasonObj?.type === 'classifier' &&
      reasonObj.monitorBlocked === true
        ? 'monitor'
        : 'classifier'

    for (const entry of batch) {
      const rec = this.records.get(entry.id)
      if (rec) {
        rec.state = verdictState
        if (verdictState === 'blocked' && decision.behavior === 'deny') {
          rec.blockedReason = decision.message
          rec.blockedDecision = decision
        }
      }
      if (verdictState === 'blocked' && decision.behavior === 'deny') {
        try {
          entry.stop(
            decision.message || 'Blocked by auto mode',
            batch.length,
            cause,
          )
        } catch {
          // Stop callback failure must not prevent stopping remaining scripts in the batch
        }
      }
    }
    if (verdictState !== 'allowed') {
      this.unclassifiedCodeRan = true
      this.dropUnchecked()
    }
    return { settled: true }
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
  execSignal?: AbortSignal,
) => Promise<unknown>

export type ExecuteCodeModeScriptOptions = {
  code: string
  invokeTool: CodeModeToolInvoker
  timeoutMs?: number
  toolCallCap?: number
  signal?: AbortSignal
  shellKind?: 'bash' | 'powershell'
  /** Official 2.1.328: per-agent/session VM key for persistent VM context reuse across turns. */
  sessionKey?: string
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
  /** Optional list of all available tool names to expose as PascalCase globals inside the VM. */
  availableToolNames?: readonly string[]
  /** Optional tool metadata for `searchTools()` and `describeTool()` helpers inside the VM. */
  toolDescriptors?: ReadonlyArray<{ name: string; description: string }>
  /** Official 2.1.328: eval ID for `self.running()` self-identification inside the VM. */
  evalId?: number
  /** Official 2.1.331: optional overrides for REPL host-call DoS & input validation limits. */
  dosLimits?: ReplDosLimits
}

const PRIMITIVE_SHORTHAND_MAP: ReadonlyArray<readonly [string, string]> = [
  ['read', 'Read'],
  ['write', 'Write'],
  ['edit', 'Edit'],
  ['glob', 'Glob'],
  ['grep', 'Grep'],
  ['bash', 'Bash'],
  ['powerShell', 'PowerShell'],
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

/**
 * Official 2.1.328 (`On`/`Dr`/`REPL_PART_CAP`): cap long output parts at 30,000
 * characters using a 60% head / 40% tail elision so giant outputs don't blow up
 * context.
 */
export function elideReplOutputPart(
  text: string,
  cap: number = REPL_PART_CAP,
): string {
  if (text.length <= cap) return text
  const headLen = Math.floor(cap * 0.6)
  const tailLen = Math.max(0, cap - headLen)
  const omitted = text.length - headLen - tailLen
  return `${text.slice(0, headLen)}\n... [${omitted} characters elided] ...\n${text.slice(text.length - tailLen)}`
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

type RealmBridge = {
  cloneToRealm: (val: unknown) => unknown
  makeError: (message: string, name?: string) => Error
  wrapSyncHostFn: (fn: (...args: unknown[]) => unknown) => unknown
  wrapIdentityHostFn: (fn: (...args: unknown[]) => unknown) => unknown
  wrapAsyncHostFn: (fn: (...args: unknown[]) => unknown) => unknown
  createRealmObj: (
    entries: ReadonlyArray<readonly [string, unknown]>,
  ) => unknown
  createNullProtoObj: (
    entries: ReadonlyArray<readonly [string, unknown]>,
  ) => unknown
  createDollarFn: (
    dispatchHost: (
      first: unknown,
      values: unknown[],
    ) => (
      nothrow: boolean,
      ms: number | undefined,
      cwd: string | undefined,
      env: unknown,
    ) => Promise<Record<string, unknown>>,
    escapeHost: (s: unknown) => string,
  ) => unknown
  realmObjectPrototype: object
  realmArrayPrototype: object
}

const REALM_BRIDGE_INIT_SOURCE = `(() => {
  const _Object = Object;
  const _Array = Array;
  const _Error = Error;
  const _TypeError = TypeError;
  const _RangeError = RangeError;
  const _Promise = Promise;
  const _Map = Map;
  const _Set = Set;
  const _RegExp = RegExp;
  const _Date = Date;
  const _Uint8Array = Uint8Array;
  const _WeakMap = WeakMap;
  const _JSON = JSON;
  const _keys = _Object.keys;
  const _getPrototypeOf = _Object.getPrototypeOf;
  const _defineProperty = _Object.defineProperty;
  const _create = _Object.create;
  const _isArray = _Array.isArray;
  const _toString = _Object.prototype.toString;

  // Official 2.1.331 (kernel.prelude.js): throw a helpful TypeError when an
  // unawaited Promise is coerced to a string instead of yielding "[object Promise]".
  _defineProperty(_Promise.prototype, 'toString', {
    value: function () {
      throw new _TypeError(${JSON.stringify(REPL_UNAWAITED_PROMISE_ERROR)});
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });

  const makeError = (message, name) => {
    const msg = typeof message === 'string' ? message : String(message ?? '');
    let err;
    if (name === 'RangeError') err = new _RangeError(msg);
    else if (name === 'TypeError') err = new _TypeError(msg);
    else {
      err = new _Error(msg);
      if (typeof name === 'string' && name.length > 0 && name !== 'Error') {
        err.name = name;
      }
    }
    return err;
  };

  const errInfo = (err) => {
    let msg;
    if (err && typeof err === 'object' && typeof err.message === 'string') {
      msg = err.message;
    } else {
      try {
        msg = String(err);
      } catch {
        msg = '<unprintable thrown value>';
      }
    }
    return {
      msg,
      name: err && typeof err === 'object' && typeof err.name === 'string' ? err.name : 'Error',
    };
  };

  const cloneToRealm = (val, seen) => {
    if (val === null || val === undefined) return val;
    const t = typeof val;
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') {
      return val;
    }
    if (t === 'function') return undefined;
    if (!seen) seen = new _WeakMap();
    if (seen.has(val)) return seen.get(val);

    const tag = _toString.call(val);
    if (tag === '[object Date]' && typeof val.getTime === 'function') {
      const d = new _Date(val.getTime());
      seen.set(val, d);
      return d;
    }
    if (tag === '[object RegExp]' && typeof val.source === 'string') {
      const r = new _RegExp(val.source, typeof val.flags === 'string' ? val.flags : '');
      seen.set(val, r);
      return r;
    }
    if (typeof val.byteLength === 'number' && typeof val.length === 'number' && typeof val.subarray === 'function') {
      const u = new _Uint8Array(val.length);
      for (let i = 0; i < val.length; i++) u[i] = val[i];
      seen.set(val, u);
      return u;
    }
    if (val instanceof _Error || tag === '[object Error]') {
      const info = errInfo(val);
      const e = makeError(info.msg, info.name);
      seen.set(val, e);
      return e;
    }
    if (tag === '[object Map]' && typeof val.forEach === 'function') {
      const m = new _Map();
      seen.set(val, m);
      val.forEach((v, k) => m.set(cloneToRealm(k, seen), cloneToRealm(v, seen)));
      return m;
    }
    if (tag === '[object Set]' && typeof val.forEach === 'function') {
      const s = new _Set();
      seen.set(val, s);
      val.forEach((v) => s.add(cloneToRealm(v, seen)));
      return s;
    }
    if (_isArray(val)) {
      const arr = new _Array(val.length);
      seen.set(val, arr);
      for (let i = 0; i < val.length; i++) {
        arr[i] = cloneToRealm(val[i], seen);
      }
      return arr;
    }
    const obj = _getPrototypeOf(val) === null ? _create(null) : {};
    seen.set(val, obj);
    const keys = _keys(val);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = val[k];
      if (typeof v !== 'function') {
        obj[k] = cloneToRealm(v, seen);
      }
    }
    return obj;
  };

  const wrapSyncHostFn = (fn) => function (...args) {
    try {
      return cloneToRealm(fn.apply(this, args));
    } catch (err) {
      const info = errInfo(err);
      throw makeError(info.msg, info.name);
    }
  };

  const wrapIdentityHostFn = (fn) => function (...args) {
    try {
      return fn.apply(this, args);
    } catch (err) {
      const info = errInfo(err);
      throw makeError(info.msg, info.name);
    }
  };

  const wrapAsyncHostFn = (fn) => function (...args) {
    return new _Promise((resolve, reject) => {
      let res;
      try {
        res = fn.apply(this, args);
      } catch (err) {
        const info = errInfo(err);
        reject(makeError(info.msg, info.name));
        return;
      }
      if (res && typeof res.then === 'function') {
        res.then(
          (val) => resolve(cloneToRealm(val)),
          (err) => {
            const info = errInfo(err);
            reject(makeError(info.msg, info.name));
          },
        );
      } else {
        resolve(cloneToRealm(res));
      }
    });
  };

  const createRealmObj = (entries) => {
    const obj = {};
    for (let i = 0; i < entries.length; i++) {
      obj[entries[i][0]] = entries[i][1];
    }
    return obj;
  };

  const createNullProtoObj = (entries) => {
    const obj = _create(null);
    for (let i = 0; i < entries.length; i++) {
      obj[entries[i][0]] = entries[i][1];
    }
    return obj;
  };

  const createShellPromise = (runHost) => {
    const opts = { nothrow: false, ms: undefined, cwd: undefined, env: undefined };
    const p = new _Promise((resolve, reject) => {
      _Promise.resolve().then(() => {
        let res;
        try {
          res = runHost(opts.nothrow, opts.ms, opts.cwd, opts.env);
        } catch (err) {
          const info = errInfo(err);
          reject(makeError(info.msg, info.name));
          return;
        }
        res.then(
          (rawOut) => {
            const out = cloneToRealm(rawOut);
            out.text = function () { return out.stdout; };
            out.lines = function () { return out.stdout.split('\\n'); };
            out.json = function () { return _JSON.parse(out.stdout); };
            resolve(out);
          },
          (err) => {
            const info = errInfo(err);
            reject(makeError(info.msg, info.name));
          },
        );
      });
    });
    p.nothrow = function () { opts.nothrow = true; return p; };
    p.throws = function (on) { opts.nothrow = !on; return p; };
    p.quiet = function () { return p; };
    p.timeout = function (n) { opts.ms = n; return p; };
    p.cwd = function (d) { opts.cwd = String(d); return p; };
    p.env = function (e) { opts.env = e; return p; };
    p.text = function () { return p.then((o) => o.stdout); };
    p.lines = function () { return p.then((o) => o.stdout.split('\\n')); };
    p.json = function () { return p.then((o) => _JSON.parse(o.stdout)); };
    return p;
  };

  const createDollarFn = (dispatchHost, escapeHost) => {
    const fn = function (first, ...values) {
      let handle;
      try {
        handle = dispatchHost(first, values);
      } catch (err) {
        const info = errInfo(err);
        throw makeError(info.msg, info.name);
      }
      return createShellPromise(handle);
    };
    fn.escape = wrapSyncHostFn(escapeHost);
    return fn;
  };

  return {
    cloneToRealm,
    makeError,
    wrapSyncHostFn,
    wrapIdentityHostFn,
    wrapAsyncHostFn,
    createRealmObj,
    createNullProtoObj,
    createDollarFn,
    realmObjectPrototype: _Object.prototype,
    realmArrayPrototype: _Array.prototype,
  };
})()`

type CodeModeTurnState = {
  bound: number
  deadline: number
  lastClock: number
  stride: number
  left: number
  rest: number
  budget: number
  stopped: boolean
  budgetStopped: boolean
  clockStops: number
  budgetStops: number
}

type CodeModeShellRunner = (
  nothrow: boolean,
  msOverride: number | undefined,
  cwdVal: string | undefined,
  envVal: unknown,
) => Promise<Record<string, unknown>>

type CodeModeEvalBinding = {
  outside: boolean
  ended: boolean
  noMoreCalls: boolean
  shellKind: 'bash' | 'powershell'
  logs: string[]
  turnState: CodeModeTurnState
  clampedTimeout: number
  timers: Set<number>
  allowedTools: ReadonlySet<string> | undefined
  exposedTools: string[]
  toolDescriptors: ReadonlyArray<{ name: string; description: string }>
  evalsAccess: ReplEvalAccess
  dosLimits: ResolvedReplDosLimits
  turnCallBudget: ReplTurnCallBudget
  isStopped: () => boolean
  getStopMessage: () => string
  guardedCall: (toolName: unknown, input?: unknown) => Promise<unknown>
  dispatchDollar: (first: unknown, values: unknown[]) => CodeModeShellRunner
}

type CodeModeTimerEntry = {
  owner: CodeModeEvalBinding
  clear: () => void
}

type PersistentCodeModeVmSession = {
  sandbox: Record<string, unknown>
  context: vm.Context
  bridge: RealmBridge
  /** Official `Go`/`Tl` AsyncLocalStorage holding per-eval bindings so concurrent/detached evals never clobber shared sandbox globals. */
  currentCall: AsyncLocalStorage<CodeModeEvalBinding>
  /** Official `L` outside-eval fallback binding when no active eval store is present. */
  outsideBinding: CodeModeEvalBinding
  /** Session-wide timer table (per-eval timers tracked in `binding.timers`). */
  timers: {
    nextId: number
    armed: Map<number, CodeModeTimerEntry>
  }
  /** Tool global names already sealed and bound onto `sandbox` once. */
  boundToolNames: Set<string>
  /** Clear every armed timer owned by any eval in this VM session. */
  clearAllTimers: () => void
  /** Tracks `{ raw: "..." }` literals written directly in script source and their original string value. */
  rawLiteralValues: WeakMap<object, string>
  /** Per-session randomized non-enumerable identifier for marking script-authored `{ raw }` literals. */
  rawLiteralMarkerName: string
  /** Console ring buffer persisted across turns in this VM session. */
  consoleBuffer: string[]
  consoleDropped: number
}

const MAX_PERSISTENT_VM_SESSIONS = 32

type CodeModeExecutorSessionState = {
  persistentVmSessionsByKey: Map<string, PersistentCodeModeVmSession>
  codeModeAutoVerdictTracker: CodeModeAutoVerdictTracker
  sessionUnsetVarsByKey: Map<string, Set<string>>
  codeModeScriptSeq: number
}

const codeModeExecutorSessionSlot =
  new RootSessionSlot<CodeModeExecutorSessionState>(() => ({
    persistentVmSessionsByKey: new Map<string, PersistentCodeModeVmSession>(),
    codeModeAutoVerdictTracker: new CodeModeAutoVerdictTracker(),
    sessionUnsetVarsByKey: new Map<string, Set<string>>(),
    codeModeScriptSeq: 0,
  }))

function getExecutorSessionState(): CodeModeExecutorSessionState {
  return codeModeExecutorSessionSlot.of(getBootstrapSession())
}

let cachedReplTranspiler:
  | { transformSync: (code: string) => string }
  | null
  | undefined

function getReplTranspiler(): {
  transformSync: (code: string) => string
} | null {
  if (cachedReplTranspiler !== undefined) return cachedReplTranspiler
  const bunGlobal = (
    globalThis as unknown as {
      Bun?: {
        Transpiler?: new (opts: {
          loader: string
          replMode: boolean
          macro: boolean
        }) => { transformSync: (code: string) => string }
      }
    }
  ).Bun
  if (typeof bunGlobal?.Transpiler === 'function') {
    cachedReplTranspiler = new bunGlobal.Transpiler({
      loader: 'js',
      replMode: true,
      macro: false,
    })
  } else {
    cachedReplTranspiler = null
  }
  return cachedReplTranspiler
}

/**
 * Per-turn step budget, mirroring official `ur()` (REPL step budget) and the
 * stride allocator in `Uc`. A turn is the code from the script's start, a tool
 * call's result, or a timer's firing until the next tool call's result/timer.
 */
const CODE_MODE_STEP_BUDGET = 50_000_000
const CODE_MODE_STRIDE_CLOCK_MS = 25
const CODE_MODE_MAX_STRIDE = 1_000

function makeTurnState(): CodeModeTurnState {
  return {
    bound: 0,
    deadline: 0,
    lastClock: 0,
    stride: 1,
    left: 0,
    rest: 0,
    budget: CODE_MODE_STEP_BUDGET,
    stopped: false,
    budgetStopped: false,
    clockStops: 0,
    budgetStops: 0,
  }
}

/**
 * Official 2.1.328 (`Go`/`Uc`/`Mr`): start a new turn — the script's own run
 * time, excluding time spent inside tool calls. `boundMs` is the wall clock.
 */
function startCodeModeTurn(
  turnState: CodeModeTurnState,
  boundMs: number,
): void {
  const s = turnState
  const now = Date.now()
  s.bound = boundMs
  s.deadline = now + boundMs
  s.lastClock = now
  s.stride = 1
  s.rest = s.budget
  s.stopped = false
  s.budgetStopped = false
  s.left = 0
}

/**
 * Official 2.1.328 (the counter returned by `Uc`'s injected shim): charge one
 * step. Throws a RangeError when the turn's wall clock or step budget runs out.
 * Tool-call wait time is excluded because the turn is only re-armed on resume.
 */
function chargeCodeModeStep(turnState: CodeModeTurnState): void {
  const s = turnState
  if (s.bound === 0) return
  s.left--
  if (s.left > 0) return
  if (s.rest <= 0) {
    s.left = 0
    if (!s.budgetStopped) {
      s.budgetStopped = true
      s.budgetStops++
    }
    throw new RangeError(
      `REPL: a turn ran ${s.budget} steps, its budget (a step is one pass through a loop or one call of a function), and was stopped. A turn is the code that runs from the script's start, a tool call's result or a timer's firing until the next tool call's result or timer. End the loop, or await a tool call or a timer in it.`,
    )
  }
  const now = Date.now()
  if (now > s.deadline) {
    s.left = 0
    if (!s.stopped) {
      s.stopped = true
      s.clockStops++
    }
    // Surface the same wall-clock timeout the deadline timer reports — the
    // script overran its bound; keep the canonical "timed out after Xms" text
    // so callers see one consistent stop reason.
    throw new RangeError(`Code Mode script timed out after ${s.bound}ms`)
  }
  const stride =
    now - s.lastClock >= CODE_MODE_STRIDE_CLOCK_MS
      ? 1
      : s.stride < CODE_MODE_MAX_STRIDE
        ? s.stride * 2
        : CODE_MODE_MAX_STRIDE
  s.lastClock = now
  s.stride = stride
  const take = stride < s.rest ? stride : s.rest
  s.rest -= take
  s.left = take - 1
}

const CONSOLE_RING_BUFFER_MAX = 500

function makeOutsideEvalBinding(): CodeModeEvalBinding {
  const unavailable = async (toolName: string): Promise<never> => {
    throw new Error(`${toolName} is not available outside a REPL eval`)
  }
  return {
    outside: true,
    ended: true,
    noMoreCalls: true,
    shellKind: 'bash',
    logs: [],
    turnState: makeTurnState(),
    clampedTimeout: REPL_SYNC_RUN_MS,
    timers: new Set(),
    allowedTools: undefined,
    exposedTools: [],
    toolDescriptors: [],
    evalsAccess: NO_EVALS,
    dosLimits: resolveReplDosLimits(),
    turnCallBudget: new ReplTurnCallBudget(),
    isStopped: () => false,
    getStopMessage: () => 'Code Mode script aborted',
    guardedCall: toolName => unavailable(String(toolName)),
    dispatchDollar: () => async () => unavailable('Bash'),
  }
}

function getCurrentEvalBinding(
  session: PersistentCodeModeVmSession,
): CodeModeEvalBinding {
  return session.currentCall.getStore() ?? session.outsideBinding
}

function clearTimersForEvalBinding(
  session: PersistentCodeModeVmSession,
  binding: CodeModeEvalBinding,
): void {
  for (const id of binding.timers) {
    const entry = session.timers.armed.get(id)
    if (entry !== undefined) {
      entry.clear()
      session.timers.armed.delete(id)
    }
  }
  binding.timers.clear()
}

function ensureToolGlobalBound(
  session: PersistentCodeModeVmSession,
  globalName: string,
  canonicalToolName: string,
): void {
  if (session.boundToolNames.has(globalName)) return
  session.boundToolNames.add(globalName)
  session.sandbox[globalName] = sealAsyncForRealm(
    session,
    (input: unknown = {}) =>
      getCurrentEvalBinding(session).guardedCall(canonicalToolName, input),
  )
}

function createCodeModeVmSession(): PersistentCodeModeVmSession {
  // Official `Go`/`$c`/`Tl`: the realm starts from a null-prototype sandbox and
  // exposes ONLY realm-sealed bridge objects/functions — no host intrinsics.
  // All per-eval globals are bound ONCE here and dispatch through
  // `AsyncLocalStorage` (`session.currentCall.getStore() ?? outsideBinding`)
  // so concurrent/detached evals sharing one VM never clobber each other.
  const sandbox: Record<string, unknown> = { __proto__: null } as Record<
    string,
    unknown
  >
  const rawLiteralValues = new WeakMap<object, string>()
  const rawLiteralMarkerName = `__cm_raw_${randomBytes(6).toString('hex')}`
  const currentCall = new AsyncLocalStorage<CodeModeEvalBinding>()
  const outsideBinding = makeOutsideEvalBinding()
  const timers: PersistentCodeModeVmSession['timers'] = {
    nextId: 1,
    armed: new Map(),
  }
  const clearAllTimers = (): void => {
    for (const entry of timers.armed.values()) {
      entry.clear()
      entry.owner.timers.clear()
    }
    timers.armed.clear()
  }

  const session: PersistentCodeModeVmSession = {
    sandbox,
    context: undefined as unknown as vm.Context,
    bridge: undefined as unknown as RealmBridge,
    currentCall,
    outsideBinding,
    timers,
    boundToolNames: new Set(),
    clearAllTimers,
    rawLiteralValues,
    rawLiteralMarkerName,
    consoleBuffer: [],
    consoleDropped: 0,
  }
  const getBinding = (): CodeModeEvalBinding => getCurrentEvalBinding(session)

  // Official `kee({...},{codeGeneration:{strings:false}}): eval() and
  // `new Function()` are disabled inside the realm — script code can only run
  // through the instrumented transform, so it cannot bypass `__checkBudget`.
  session.context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  })
  // Initialize realm-side bridge capturing realm intrinsics before any user code runs.
  session.bridge = new vm.Script(REALM_BRIDGE_INIT_SOURCE, {
    filename: 'code-mode-realm-init.js',
  }).runInContext(session.context) as RealmBridge

  // Official `jc`/`Uc`: instrumented loops & functions call `__checkBudget` —
  // expose it ONCE as a realm-sealed callable dispatching to the active eval.
  Object.defineProperty(sandbox, '__checkBudget', {
    value: session.bridge.wrapSyncHostFn(() => {
      const active = getBinding()
      chargeCodeModeStep(active.turnState)
      if (active.isStopped()) {
        throw new Error(active.getStopMessage())
      }
    }),
    writable: false,
    enumerable: false,
    configurable: false,
  })

  // Official `zc`/`fr`: mark single-key `{ raw: expr }` literals written directly
  // in script source so `$` can distinguish them from external/parsed objects.
  Object.defineProperty(sandbox, rawLiteralMarkerName, {
    value: session.bridge.wrapIdentityHostFn((val: unknown) => {
      if (
        val !== null &&
        typeof val === 'object' &&
        Object.keys(val).length === 1 &&
        Object.hasOwn(val, 'raw') &&
        typeof (val as { raw?: unknown }).raw === 'string'
      ) {
        rawLiteralValues.set(val, (val as { raw: string }).raw)
      }
      return val
    }),
    writable: false,
    enumerable: false,
    configurable: false,
  })

  const assertTextWithinLimit = (text: string): string => {
    if (text.length > getBinding().dosLimits.mostTextChars) {
      throw new ReplHostCallValidationError(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    }
    return text
  }

  // Official `Tl`: expose `atob` / `btoa` as realm-sealed sync functions.
  sandbox.atob = session.bridge.wrapSyncHostFn((input: unknown) =>
    Buffer.from(assertTextWithinLimit(String(input)), 'base64').toString(
      'binary',
    ),
  )
  sandbox.btoa = session.bridge.wrapSyncHostFn((input: unknown) =>
    Buffer.from(assertTextWithinLimit(String(input)), 'binary').toString(
      'base64',
    ),
  )

  // Official `Tl`: timers bound ONCE, tracking ownership per eval binding and
  // re-entering `currentCall.run(owner, ...)` when the timer fires.
  const armTimer = (
    cb: unknown,
    delayMs: unknown,
    args: unknown[],
    repeat: boolean,
  ): number => {
    if (typeof cb !== 'function') {
      throw new TypeError(
        `${repeat ? 'setInterval' : 'setTimeout'} callback must be a function`,
      )
    }
    const owner = getBinding()
    if (owner.ended) return 0
    const id = timers.nextId++
    const ms = repeat
      ? Math.max(10, Number(delayMs) || 10)
      : Math.max(0, Number(delayMs) || 0)
    const fire = (): void => {
      if (!repeat) {
        owner.timers.delete(id)
        timers.armed.delete(id)
      }
      if (owner.ended || owner.isStopped()) {
        if (repeat) {
          const entry = timers.armed.get(id)
          entry?.clear()
          owner.timers.delete(id)
          timers.armed.delete(id)
        }
        return
      }
      currentCall.run(owner, () => {
        startCodeModeTurn(owner.turnState, owner.clampedTimeout)
        owner.turnCallBudget.reset()
        try {
          ;(cb as (...a: unknown[]) => unknown)(...args)
        } catch {
          // Unhandled timer errors must not crash host process
        }
      })
    }
    const handle = repeat ? setInterval(fire, ms) : setTimeout(fire, ms)
    if (typeof handle.unref === 'function') handle.unref()
    const clear = repeat
      ? () => clearInterval(handle)
      : () => clearTimeout(handle)
    owner.timers.add(id)
    timers.armed.set(id, { owner, clear })
    return id
  }
  const clearTimerById = (id: unknown): void => {
    const numId = typeof id === 'number' ? id : Number(id)
    const entry = timers.armed.get(numId)
    if (entry === undefined) return
    entry.clear()
    entry.owner.timers.delete(numId)
    timers.armed.delete(numId)
  }
  sandbox.setTimeout = sealForRealm(
    session,
    (cb: unknown, delayMs?: unknown, ...args: unknown[]) =>
      armTimer(cb, delayMs, args, false),
  )
  sandbox.clearTimeout = sealForRealm(session, clearTimerById)
  sandbox.setInterval = sealForRealm(
    session,
    (cb: unknown, delayMs?: unknown, ...args: unknown[]) =>
      armTimer(cb, delayMs, args, true),
  )
  sandbox.clearInterval = sealForRealm(session, clearTimerById)

  // Official `Tl`/`St(e,"console",...)`: bound ONCE; writes to active eval's
  // `logs` plus session-wide ring buffer.
  const pushLog = (...args: unknown[]): void => {
    const line = assertTextWithinLimit(
      args.map(a => formatValueForOutput(a)).join(' '),
    )
    getBinding().logs.push(line)
    session.consoleBuffer.push(line)
    if (session.consoleBuffer.length > CONSOLE_RING_BUFFER_MAX) {
      session.consoleBuffer.shift()
      session.consoleDropped++
    }
  }
  const sealedPushLog = sealForRealm(session, pushLog)
  sandbox.console = session.bridge.createRealmObj([
    ['log', sealedPushLog],
    ['warn', sealedPushLog],
    ['error', sealedPushLog],
    ['info', sealedPushLog],
    ['debug', sealedPushLog],
    [
      'tail',
      sealForRealm(session, (n?: unknown) => {
        const count =
          typeof n === 'number' && Number.isFinite(n) && n >= 0
            ? Math.floor(n)
            : 20
        return session.consoleBuffer.slice(-count)
      }),
    ],
    ['buffer', sealForRealm(session, () => [...session.consoleBuffer])],
    ['dropped', sealForRealm(session, () => session.consoleDropped)],
  ])
  sandbox.log = sealedPushLog

  // Official `Tl`: realm-sealed `self.running()` bound ONCE, dispatching via ALS.
  const sealedRunningHandle = session.bridge.createRealmObj([
    ['list', sealForRealm(session, () => getBinding().evalsAccess.list())],
    [
      'abort',
      sealForRealm(session, (targetId: unknown) =>
        getBinding().evalsAccess.abort(Number(targetId)),
      ),
    ],
  ])
  sandbox.running = session.bridge.wrapIdentityHostFn(() => sealedRunningHandle)
  sandbox.self = sandbox
  sandbox.preview = sealForRealm(
    session,
    (value: unknown, maxChars: unknown = 2000) => {
      const limit =
        typeof maxChars === 'number' &&
        Number.isFinite(maxChars) &&
        maxChars > 0
          ? Math.floor(maxChars)
          : 2000
      return elideReplOutputPart(formatValueForOutput(value), limit)
    },
  )

  sandbox.callTool = sealAsyncForRealm(
    session,
    (toolName: unknown, input: unknown = {}) =>
      getBinding().guardedCall(toolName, input),
  )
  sandbox.$ = session.bridge.createDollarFn(
    (first: unknown, values: unknown[]) =>
      getBinding().dispatchDollar(first, values),
    (s: unknown) => quoteCodeModeShellArg(s, getBinding().shellKind),
  )

  sandbox.searchTools = sealForRealm(
    session,
    (query: unknown, limit: unknown = 10) => {
      const q = assertTextWithinLimit(String(query ?? ''))
        .toLowerCase()
        .trim()
      const max =
        typeof limit === 'number' && Number.isFinite(limit) && limit > 0
          ? Math.floor(limit)
          : 10
      return getBinding()
        .toolDescriptors.filter(
          d =>
            !q ||
            d.name.toLowerCase().includes(q) ||
            d.description.toLowerCase().includes(q),
        )
        .slice(0, max)
        .map(d => ({ name: d.name, description: d.description }))
    },
  )
  sandbox.describeTool = sealForRealm(session, (name: unknown) => {
    const targetName = assertTextWithinLimit(String(name ?? ''))
    const found = getBinding().toolDescriptors.find(d => d.name === targetName)
    return found ? { name: found.name, description: found.description } : null
  })
  sandbox.tools = session.bridge.createRealmObj([
    [
      'list',
      sealForRealm(session, () => {
        const b = getBinding()
        return b.allowedTools ? [...b.allowedTools] : [...b.exposedTools]
      }),
    ],
  ])

  return session
}

/**
 * Seal a sync host function for realm exposure (official `o.fn`/`St(e,name,o.fn)`).
 */
function sealForRealm(
  session: PersistentCodeModeVmSession,
  fn: (...args: never[]) => unknown,
): unknown {
  return session.bridge.wrapSyncHostFn(fn as (...args: unknown[]) => unknown)
}

/**
 * Seal an async host function for realm exposure so returned Promises, resolved
 * values, and rejected Errors all belong to the VM realm.
 */
function sealAsyncForRealm(
  session: PersistentCodeModeVmSession,
  fn: (...args: never[]) => unknown,
): unknown {
  return session.bridge.wrapAsyncHostFn(fn as (...args: unknown[]) => unknown)
}

function getOrCreatePersistentVmSession(
  sessionKey: string,
): PersistentCodeModeVmSession {
  const { persistentVmSessionsByKey, sessionUnsetVarsByKey } =
    getExecutorSessionState()
  const existing = persistentVmSessionsByKey.get(sessionKey)
  if (existing) {
    // Refresh LRU order
    persistentVmSessionsByKey.delete(sessionKey)
    persistentVmSessionsByKey.set(sessionKey, existing)
    return existing
  }
  if (persistentVmSessionsByKey.size >= MAX_PERSISTENT_VM_SESSIONS) {
    const oldestKey = persistentVmSessionsByKey.keys().next().value
    if (oldestKey !== undefined) {
      persistentVmSessionsByKey.get(oldestKey)?.clearAllTimers()
      persistentVmSessionsByKey.delete(oldestKey)
      sessionUnsetVarsByKey.delete(oldestKey)
    }
  }
  const created = createCodeModeVmSession()
  persistentVmSessionsByKey.set(sessionKey, created)
  getReplSessions().set(sessionKey, created)
  return created
}

/**
 * Clear persistent Code Mode VM context(s) and unset-var tracking (on session
 * reset, clear, or eviction).
 */
export function clearCodeModeVmSession(sessionKey?: string): void {
  const { persistentVmSessionsByKey, sessionUnsetVarsByKey } =
    getExecutorSessionState()
  if (sessionKey !== undefined) {
    persistentVmSessionsByKey.get(sessionKey)?.clearAllTimers()
    persistentVmSessionsByKey.delete(sessionKey)
    sessionUnsetVarsByKey.delete(sessionKey)
    const sessions = getReplSessions()
    sessions.clear([sessionKey])
    sessions.release(sessionKey)
  } else {
    for (const s of persistentVmSessionsByKey.values()) {
      s.clearAllTimers()
    }
    persistentVmSessionsByKey.clear()
    sessionUnsetVarsByKey.clear()
    getReplSessions().clear()
  }
}

type PollEventQueueCommandLike = {
  mode?: string
  agentId?: string
  pollEvent?: {
    kind?: string
    envelope?: string
    settleDropped?: (err: Error) => void
  }
}

function settleDroppedPollEvents(
  removed: readonly PollEventQueueCommandLike[],
  reason: string,
): void {
  for (const cmd of removed) {
    cmd.pollEvent?.settleDropped?.(
      new Error(`poll event discarded undelivered: ${reason}`),
    )
  }
}

function extractEvalIdFromPollEnvelope(
  envelope: string | undefined,
): number | undefined {
  if (!envelope) return undefined
  const m = /\beval="(\d+)"/.exec(envelope)
  if (!m) return undefined
  const id = Number(m[1])
  return Number.isFinite(id) ? id : undefined
}

function isMainThreadPollCommand(cmd: PollEventQueueCommandLike): boolean {
  if (cmd.agentId === undefined) return true
  try {
    return cmd.agentId === getMainThreadAgentId()
  } catch {
    return false
  }
}

/**
 * Official `endMainThreadConversation` (`chunk@313694282.js @8309`):
 * Clears ONLY the main-thread (`REPL_MAIN_THREAD_KEY`) Code Mode VM session
 * and `ReplSessions` entry (preserving surviving background subagents' VMs!),
 * removes main-thread Code Mode `poll-event` items from the message queue,
 * and resets `codeModeAutoVerdictTracker`.
 */
export function endMainThreadConversation(
  reason = 'the conversation was cleared',
  keepToolUseIds: readonly string[] = [],
  queueOverride?: {
    removeByFilter: (
      predicate: (cmd: PollEventQueueCommandLike) => boolean,
    ) => PollEventQueueCommandLike[]
  },
): void {
  const {
    persistentVmSessionsByKey,
    sessionUnsetVarsByKey,
    codeModeAutoVerdictTracker,
  } = getExecutorSessionState()
  const sessions = getReplSessions()
  const hasMainState =
    isCodeModeAccepted() ||
    hasCodeModeBeenUsed() ||
    persistentVmSessionsByKey.has(REPL_MAIN_THREAD_KEY) ||
    sessions.has(REPL_MAIN_THREAD_KEY) ||
    sessions.depth(REPL_MAIN_THREAD_KEY) > 0 ||
    sessions.outstanding(REPL_MAIN_THREAD_KEY) > 0
  if (!hasMainState) {
    codeModeAutoVerdictTracker.reset()
    return
  }

  const keptIds = sessions.evalIdsOf(REPL_MAIN_THREAD_KEY, keepToolUseIds)
  const keptPred =
    keptIds.size === 0 ? undefined : (id: number) => keptIds.has(id)
  sessions.clear([REPL_MAIN_THREAD_KEY], keptPred)
  sessions.release(REPL_MAIN_THREAD_KEY)
  persistentVmSessionsByKey.get(REPL_MAIN_THREAD_KEY)?.clearAllTimers()
  persistentVmSessionsByKey.delete(REPL_MAIN_THREAD_KEY)
  sessionUnsetVarsByKey.delete(REPL_MAIN_THREAD_KEY)

  const shouldRemove = (cmd: PollEventQueueCommandLike): boolean => {
    if (cmd.mode !== 'poll-event') return false
    const kind = cmd.pollEvent?.kind
    if (kind !== 'repl-eval' && kind !== 'repl-status') return false
    if (!isMainThreadPollCommand(cmd)) return false
    if (keptPred !== undefined) {
      const evalId = extractEvalIdFromPollEnvelope(cmd.pollEvent?.envelope)
      if (evalId !== undefined && keptPred(evalId)) return false
    }
    return true
  }

  try {
    if (queueOverride) {
      settleDroppedPollEvents(
        queueOverride.removeByFilter(shouldRemove),
        reason,
      )
    } else {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const mqm =
        require('../../utils/messageQueueManager.js') as typeof import('../../utils/messageQueueManager.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      const removed = mqm.removeByFilter(cmd =>
        shouldRemove(cmd as unknown as PollEventQueueCommandLike),
      )
      settleDroppedPollEvents(
        removed as unknown as PollEventQueueCommandLike[],
        reason,
      )
    }
  } catch {
    // Best-effort outside full message queue lifecycle
  }

  codeModeAutoVerdictTracker.reset()
}

/**
 * Official `endSubagentRepl` (`chunk@313694282.js @8551`):
 * Clears, releases, and forgets ONLY `agentId`'s Code Mode VM session and
 * `ReplSessions` entry, and drops that subagent's queued `poll-event` items
 * without disturbing the main thread or sibling subagents.
 */
export function endSubagentRepl(
  agentId: string,
  queueOverride?: {
    removeByFilter: (
      predicate: (cmd: PollEventQueueCommandLike) => boolean,
    ) => PollEventQueueCommandLike[]
  },
): void {
  const { persistentVmSessionsByKey, sessionUnsetVarsByKey } =
    getExecutorSessionState()
  const sessions = getReplSessions()
  const hasAgentState =
    isCodeModeAccepted() ||
    hasCodeModeBeenUsed() ||
    persistentVmSessionsByKey.has(agentId) ||
    sessions.has(agentId) ||
    sessions.depth(agentId) > 0 ||
    sessions.outstanding(agentId) > 0
  if (!hasAgentState) return

  sessions.clear([agentId])
  sessions.release(agentId)
  sessions.forget(agentId)
  persistentVmSessionsByKey.get(agentId)?.clearAllTimers()
  persistentVmSessionsByKey.delete(agentId)
  sessionUnsetVarsByKey.delete(agentId)

  const shouldRemove = (cmd: PollEventQueueCommandLike): boolean =>
    cmd.mode === 'poll-event' && cmd.agentId === agentId
  const reason = 'the subagent that ran the script ended its run'

  try {
    if (queueOverride) {
      settleDroppedPollEvents(
        queueOverride.removeByFilter(shouldRemove),
        reason,
      )
    } else {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const mqm =
        require('../../utils/messageQueueManager.js') as typeof import('../../utils/messageQueueManager.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      const removed = mqm.removeByFilter(cmd =>
        shouldRemove(cmd as unknown as PollEventQueueCommandLike),
      )
      settleDroppedPollEvents(
        removed as unknown as PollEventQueueCommandLike[],
        reason,
      )
    }
  } catch {
    // Best-effort outside full message queue lifecycle
  }
}

function skipWsAndComments(code: string, start: number): number {
  let i = start
  const len = code.length
  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      continue
    }
    break
  }
  return i
}

function scanStringLiteralEnd(code: string, start: number): number {
  const quote = code[start]!
  let i = start + 1
  const len = code.length
  while (i < len) {
    if (code[i] === '\\') {
      i += 2
      continue
    }
    if (code[i] === quote) return i + 1
    i++
  }
  return len
}

function scanRegexLiteralEnd(code: string, start: number): number {
  let i = start + 1
  const len = code.length
  let inCharClass = false
  while (i < len) {
    const rc = code[i]!
    if (rc === '\\') {
      i += 2
      continue
    }
    if (rc === '\n' || rc === '\r') return i
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
      return i
    }
    i++
  }
  return len
}

function findMatchingDelimiter(
  code: string,
  openIdx: number,
  openChar: '(' | '{' | '[',
  closeChar: ')' | '}' | ']',
): number {
  let depth = 0
  let i = openIdx
  const len = code.length
  let emitted = ''
  const templateBraceDepths: number[] = []
  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      emitted += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      emitted += ' '
      continue
    }
    if (ch === "'" || ch === '"') {
      i = scanStringLiteralEnd(code, i)
      emitted += '""'
      continue
    }
    if (ch === '`') {
      i++
      emitted += ' '
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          emitted += '('
          break
        }
        if (code[i] === '`') {
          i++
          emitted += '""'
          break
        }
        i++
      }
      continue
    }
    if (templateBraceDepths.length > 0) {
      if (ch === '{') {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
        emitted += ch
        i++
        continue
      }
      if (ch === '}') {
        const td = templateBraceDepths[templateBraceDepths.length - 1]!
        if (td === 0) {
          templateBraceDepths.pop()
          emitted += ')'
          i++
          while (i < len) {
            if (code[i] === '\\') {
              i += 2
              continue
            }
            if (code[i] === '$' && code[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              emitted += '('
              break
            }
            if (code[i] === '`') {
              i++
              emitted += '""'
              break
            }
            i++
          }
          continue
        }
        templateBraceDepths[templateBraceDepths.length - 1] = td - 1
        emitted += ch
        i++
        continue
      }
    }
    if (ch === '/' && canPrecedeRegexLiteral(emitted)) {
      i = scanRegexLiteralEnd(code, i)
      emitted += '""'
      continue
    }
    if (ch === openChar) depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0) return i
    }
    emitted += ch
    i++
  }
  return -1
}

function findTopLevelSemicolons(inner: string): number[] {
  const semis: number[] = []
  let depthParen = 0
  let depthBracket = 0
  let depthCurly = 0
  let i = 0
  const len = inner.length
  let emitted = ''
  const templateBraceDepths: number[] = []
  while (i < len) {
    const ch = inner[i]!
    const next = inner[i + 1]
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && inner[i] !== '\n') i++
      emitted += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(inner[i] === '*' && inner[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      emitted += ' '
      continue
    }
    if (ch === "'" || ch === '"') {
      i = scanStringLiteralEnd(inner, i)
      emitted += '""'
      continue
    }
    if (ch === '`') {
      i++
      while (i < len) {
        if (inner[i] === '\\') {
          i += 2
          continue
        }
        if (inner[i] === '$' && inner[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          break
        }
        if (inner[i] === '`') {
          i++
          break
        }
        i++
      }
      emitted += '""'
      continue
    }
    if (templateBraceDepths.length > 0) {
      if (ch === '{') {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
        i++
        continue
      }
      if (ch === '}') {
        const td = templateBraceDepths[templateBraceDepths.length - 1]!
        if (td === 0) {
          templateBraceDepths.pop()
          i++
          while (i < len) {
            if (inner[i] === '\\') {
              i += 2
              continue
            }
            if (inner[i] === '$' && inner[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              break
            }
            if (inner[i] === '`') {
              i++
              break
            }
            i++
          }
          continue
        }
        templateBraceDepths[templateBraceDepths.length - 1] = td - 1
        i++
        continue
      }
    }
    if (ch === '/' && canPrecedeRegexLiteral(emitted)) {
      i = scanRegexLiteralEnd(inner, i)
      emitted += '""'
      continue
    }
    if (ch === '(') depthParen++
    else if (ch === ')') depthParen--
    else if (ch === '[') depthBracket++
    else if (ch === ']') depthBracket--
    else if (ch === '{') depthCurly++
    else if (ch === '}') depthCurly--
    else if (
      ch === ';' &&
      depthParen === 0 &&
      depthBracket === 0 &&
      depthCurly === 0
    ) {
      semis.push(i)
    }
    emitted += ch
    i++
  }
  return semis
}

function findSingleStatementEnd(code: string, start: number): number {
  let depthParen = 0
  let depthBracket = 0
  let depthCurly = 0
  let i = start
  const len = code.length
  let emitted = ''
  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    if (ch === '/' && next === '/') {
      i += 2
      while (i < len && code[i] !== '\n') i++
      if (depthParen === 0 && depthBracket === 0 && depthCurly === 0) {
        return i
      }
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      continue
    }
    if (ch === "'" || ch === '"') {
      i = scanStringLiteralEnd(code, i)
      emitted += '""'
      continue
    }
    if (ch === '`') {
      i++
      let td = 0
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (td === 0 && code[i] === '$' && code[i + 1] === '{') {
          td = 1
          i += 2
          continue
        }
        if (td > 0) {
          if (code[i] === '{') td++
          else if (code[i] === '}') td--
          i++
          continue
        }
        if (code[i] === '`') {
          i++
          break
        }
        i++
      }
      emitted += '""'
      continue
    }
    if (ch === '/' && canPrecedeRegexLiteral(emitted)) {
      i = scanRegexLiteralEnd(code, i)
      emitted += '""'
      continue
    }
    if (ch === '(') depthParen++
    else if (ch === ')') depthParen--
    else if (ch === '[') depthBracket++
    else if (ch === ']') depthBracket--
    else if (ch === '{') depthCurly++
    else if (ch === '}') {
      if (depthCurly === 0) return i
      depthCurly--
    } else if (depthParen === 0 && depthBracket === 0 && depthCurly === 0) {
      if (ch === ';') return i + 1
      if (ch === '\n') return i
    }
    emitted += ch
    i++
  }
  return len
}

/**
 * Official 2.1.328 (`ua`): instrument `for`, `for await`, `while`, and `do`
 * loops with `__checkBudget()` so synchronous infinite loops AFTER an `await`
 * (when `vm.Script.runInContext({ timeout })` no longer applies) terminate
 * cleanly within the script's timeout budget instead of hanging the event loop.
 * Safely skips strings, template literal text, comments, and regex literals.
 */
export function instrumentCodeModeLoops(source: string): string {
  let out = ''
  let i = 0
  const len = source.length
  let braceDepth = 0
  const doBlockBraceDepths: number[] = []
  const doSingleStmtDepths: number[] = []
  let expectDoWhileTail = false
  const templateBraceDepths: number[] = []

  const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)

  while (i < len) {
    const ch = source[i]!
    const next = source[i + 1]

    // Line comment
    if (ch === '/' && next === '/') {
      const start = i
      i += 2
      while (i < len && source[i] !== '\n') i++
      out += source.slice(start, i)
      continue
    }
    // Block comment
    if (ch === '/' && next === '*') {
      const start = i
      i += 2
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      out += source.slice(start, i)
      continue
    }
    // Quoted string
    if (ch === "'" || ch === '"') {
      const end = scanStringLiteralEnd(source, i)
      out += source.slice(i, end)
      i = end
      expectDoWhileTail = false
      continue
    }
    // Template literal
    if (ch === '`') {
      const start = i
      i++
      while (i < len) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          break
        }
        if (source[i] === '`') {
          i++
          break
        }
        i++
      }
      out += source.slice(start, i)
      expectDoWhileTail = false
      continue
    }
    // Inside template `${...}` interpolation
    if (templateBraceDepths.length > 0) {
      if (ch === '{') {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
        out += ch
        i++
        continue
      }
      if (ch === '}') {
        const td = templateBraceDepths[templateBraceDepths.length - 1]!
        if (td === 0) {
          templateBraceDepths.pop()
          const resumeStart = i
          i++
          while (i < len) {
            if (source[i] === '\\') {
              i += 2
              continue
            }
            if (source[i] === '$' && source[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              break
            }
            if (source[i] === '`') {
              i++
              break
            }
            i++
          }
          out += source.slice(resumeStart, i)
          continue
        }
        templateBraceDepths[templateBraceDepths.length - 1] = td - 1
        out += ch
        i++
        continue
      }
    }
    // Regex literal
    if (ch === '/' && canPrecedeRegexLiteral(out)) {
      const end = scanRegexLiteralEnd(source, i)
      out += source.slice(i, end)
      i = end
      expectDoWhileTail = false
      continue
    }

    if (/\s/.test(ch)) {
      out += ch
      i++
      continue
    }

    if (ch === '{') {
      braceDepth++
      out += ch
      i++
      expectDoWhileTail = false
      continue
    }
    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
      out += ch
      i++
      if (
        doBlockBraceDepths.length > 0 &&
        doBlockBraceDepths[doBlockBraceDepths.length - 1] === braceDepth
      ) {
        doBlockBraceDepths.pop()
        expectDoWhileTail = true
      } else {
        expectDoWhileTail = false
      }
      continue
    }

    if (isIdentStart(ch)) {
      const idStart = i
      i++
      while (i < len && isIdentPart(source[i]!)) i++
      const word = source.slice(idStart, i)
      const precededByDot = isPrecededByMemberDot(out, out.length)
      const afterWs = skipWsAndComments(source, i)
      const isObjectKey = source[afterWs] === ':'

      if (!precededByDot && !isObjectKey && word === 'do') {
        expectDoWhileTail = false
        if (source[afterWs] === '{') {
          doBlockBraceDepths.push(braceDepth)
          braceDepth++
          out += `${word}${source.slice(i, afterWs)}{ __checkBudget(); `
          i = afterWs + 1
          continue
        }
        // Single-statement `do stmt; while (cond)` — guard on the matching `while`
        doSingleStmtDepths.push(braceDepth)
        out += word
        continue
      }

      if (!precededByDot && !isObjectKey && word === 'while') {
        const isDoBlockTail = expectDoWhileTail
        expectDoWhileTail = false
        const isDoSingleTail =
          !isDoBlockTail &&
          doSingleStmtDepths.length > 0 &&
          doSingleStmtDepths[doSingleStmtDepths.length - 1] === braceDepth

        if (source[afterWs] === '(') {
          const closeParen = findMatchingDelimiter(source, afterWs, '(', ')')
          if (closeParen !== -1) {
            const condInner = source.slice(afterWs + 1, closeParen)
            const instrCond = instrumentCodeModeLoops(condInner)
            if (isDoBlockTail) {
              out += `${word}${source.slice(i, afterWs)}(${instrCond})`
              i = closeParen + 1
              continue
            }
            if (isDoSingleTail) {
              doSingleStmtDepths.pop()
              out += `${word}${source.slice(i, afterWs)}((__checkBudget(), (${instrCond})))`
              i = closeParen + 1
              continue
            }
            const bodyIdx = skipWsAndComments(source, closeParen + 1)
            const between = source.slice(closeParen + 1, bodyIdx)
            if (source[bodyIdx] === '{') {
              braceDepth++
              out += `${word}${source.slice(i, afterWs)}(${instrCond})${between}{ __checkBudget(); `
              i = bodyIdx + 1
              continue
            }
            if (source[bodyIdx] === ';') {
              out += `${word}${source.slice(i, afterWs)}(${instrCond})${between}{ __checkBudget(); }`
              i = bodyIdx + 1
              continue
            }
            // Single-statement `while (cond) stmt`
            out += `${word}${source.slice(i, afterWs)}((__checkBudget(), (${instrCond})))`
            i = closeParen + 1
            continue
          }
        }
        out += word
        continue
      }

      if (!precededByDot && !isObjectKey && word === 'for') {
        expectDoWhileTail = false
        let headerStart = afterWs
        if (
          source.slice(headerStart, headerStart + 5) === 'await' &&
          !isIdentPart(source[headerStart + 5] ?? '')
        ) {
          headerStart = skipWsAndComments(source, headerStart + 5)
        }
        if (source[headerStart] === '(') {
          const closeParen = findMatchingDelimiter(
            source,
            headerStart,
            '(',
            ')',
          )
          if (closeParen !== -1) {
            const prefixBeforeParen = source.slice(i, headerStart)
            const headerInner = source.slice(headerStart + 1, closeParen)
            const bodyIdx = skipWsAndComments(source, closeParen + 1)
            const between = source.slice(closeParen + 1, bodyIdx)
            if (source[bodyIdx] === '{') {
              braceDepth++
              out += `${word}${prefixBeforeParen}(${instrumentCodeModeLoops(headerInner)})${between}{ __checkBudget(); `
              i = bodyIdx + 1
              continue
            }
            if (source[bodyIdx] === ';') {
              out += `${word}${prefixBeforeParen}(${instrumentCodeModeLoops(headerInner)})${between}{ __checkBudget(); }`
              i = bodyIdx + 1
              continue
            }
            const semis = findTopLevelSemicolons(headerInner)
            if (semis.length === 2) {
              const initPart = instrumentCodeModeLoops(
                headerInner.slice(0, semis[0]!),
              )
              const rawTest = headerInner.slice(semis[0]! + 1, semis[1]!).trim()
              const updatePart = instrumentCodeModeLoops(
                headerInner.slice(semis[1]! + 1),
              )
              const guardedTest =
                rawTest.length > 0
                  ? `(__checkBudget(), (${instrumentCodeModeLoops(rawTest)}))`
                  : '(__checkBudget(), true)'
              out += `${word}${prefixBeforeParen}(${initPart}; ${guardedTest}; ${updatePart})`
              i = closeParen + 1
              continue
            }
            // Single-statement `for (x of y) stmt` / `for (k in obj) stmt`
            const stmtEnd = findSingleStatementEnd(source, bodyIdx)
            const stmtText = source.slice(bodyIdx, stmtEnd)
            out += `${word}${prefixBeforeParen}(${instrumentCodeModeLoops(headerInner)})${between}{ __checkBudget(); ${instrumentCodeModeLoops(stmtText)} }`
            i = stmtEnd
            continue
          }
        }
        out += word
        continue
      }

      if (!precededByDot && !isObjectKey && word === 'function') {
        expectDoWhileTail = false
        let scan = afterWs
        if (source[scan] === '*') {
          scan = skipWsAndComments(source, scan + 1)
        }
        if (scan < len && isIdentStart(source[scan]!)) {
          scan++
          while (scan < len && isIdentPart(source[scan]!)) scan++
          scan = skipWsAndComments(source, scan)
        }
        if (source[scan] === '(') {
          const closeParen = findMatchingDelimiter(source, scan, '(', ')')
          if (closeParen !== -1) {
            const bodyIdx = skipWsAndComments(source, closeParen + 1)
            if (source[bodyIdx] === '{') {
              braceDepth++
              const paramInner = source.slice(scan + 1, closeParen)
              out += `${word}${source.slice(i, scan)}(${instrumentCodeModeLoops(paramInner)})${source.slice(closeParen + 1, bodyIdx)}{ __checkBudget(); `
              i = bodyIdx + 1
              continue
            }
          }
        }
        out += word
        continue
      }

      expectDoWhileTail = false
      out += word
      continue
    }

    // Arrow function block body: `=> {`
    if (ch === '=' && next === '>') {
      expectDoWhileTail = false
      const afterArrow = skipWsAndComments(source, i + 2)
      if (source[afterArrow] === '{') {
        braceDepth++
        out += `${source.slice(i, afterArrow)}{ __checkBudget(); `
        i = afterArrow + 1
        continue
      }
      out += '=>'
      i += 2
      continue
    }

    expectDoWhileTail = false
    out += ch
    i++
  }

  return out
}

/**
 * Official 2.1.328 (`zc`/`fr`): wrap single-key `{ raw: expr }` object literals
 * written directly in script source with `__markRawLiteral({ raw: expr })` so
 * `$` can distinguish script-authored `{ raw }` literals from external/parsed
 * objects or mutated literals.
 */
export function markCodeModeRawLiterals(
  source: string,
  markerName = '__markRawLiteral',
): string {
  let out = ''
  let i = 0
  const len = source.length
  const templateBraceDepths: number[] = []

  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)

  while (i < len) {
    const ch = source[i]!
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      const start = i
      i += 2
      while (i < len && source[i] !== '\n') i++
      out += source.slice(start, i)
      continue
    }
    if (ch === '/' && next === '*') {
      const start = i
      i += 2
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      out += source.slice(start, i)
      continue
    }
    if (ch === "'" || ch === '"') {
      const end = scanStringLiteralEnd(source, i)
      out += source.slice(i, end)
      i = end
      continue
    }
    if (ch === '`') {
      const start = i
      i++
      while (i < len) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          break
        }
        if (source[i] === '`') {
          i++
          break
        }
        i++
      }
      out += source.slice(start, i)
      continue
    }
    if (templateBraceDepths.length > 0 && ch === '}') {
      const td = templateBraceDepths[templateBraceDepths.length - 1]!
      if (td === 0) {
        templateBraceDepths.pop()
        const resumeStart = i
        i++
        while (i < len) {
          if (source[i] === '\\') {
            i += 2
            continue
          }
          if (source[i] === '$' && source[i + 1] === '{') {
            i += 2
            templateBraceDepths.push(0)
            break
          }
          if (source[i] === '`') {
            i++
            break
          }
          i++
        }
        out += source.slice(resumeStart, i)
        continue
      }
      templateBraceDepths[templateBraceDepths.length - 1] = td - 1
      out += ch
      i++
      continue
    }
    if (ch === '/' && canPrecedeRegexLiteral(out)) {
      const end = scanRegexLiteralEnd(source, i)
      out += source.slice(i, end)
      i = end
      continue
    }

    if (ch === '{') {
      const closeIdx = findMatchingDelimiter(source, i, '{', '}')
      if (closeIdx !== -1) {
        const inner = source.slice(i + 1, closeIdx)
        const keyStart = skipWsAndComments(inner, 0)
        // Check if object literal has a single `raw` key: `{ raw: expr }` (with optional trailing comma)
        if (
          inner.slice(keyStart, keyStart + 3) === 'raw' &&
          !isIdentPart(inner[keyStart + 3] ?? '')
        ) {
          const afterKey = skipWsAndComments(inner, keyStart + 3)
          if (inner[afterKey] === ':') {
            const parts = splitTopLevelCommas(inner).filter(
              p => p.trim().length > 0,
            )
            if (parts.length === 1) {
              // Ensure `{` is in an expression position (e.g. after `(`, `,`, `=`, `:`, `[`, `?`, `return`, `${`, etc.)
              let prevIdx = out.length - 1
              while (prevIdx >= 0 && /\s/.test(out[prevIdx]!)) prevIdx--
              const prevChar = prevIdx >= 0 ? out[prevIdx]! : ''
              const isExprPos =
                prevChar === '' ||
                '([,=?:!+-*/%&|^~{'.includes(prevChar) ||
                (prevChar === '>' && out[prevIdx - 1] === '=') ||
                /\b(?:return|yield|await|throw|of|in)$/.test(
                  out.slice(Math.max(0, prevIdx - 10), prevIdx + 1),
                )
              if (isExprPos) {
                const valueExpr = inner.slice(afterKey + 1)
                out += `${markerName}({ raw:${markCodeModeRawLiterals(valueExpr, markerName)}})`
                i = closeIdx + 1
                continue
              }
            }
          }
        }
      }
      if (templateBraceDepths.length > 0) {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
      }
      out += ch
      i++
      continue
    }

    out += ch
    i++
  }

  return out
}

const STATIC_IMPORT_RE =
  /(?:^|[;\n])\s*import\s+(?:[\s\S]*?\s+from\s+['"]|['"])/

function rejectStaticImports(code: string): void {
  const stripped = stripJsCommentsAndStrings(code)
  if (STATIC_IMPORT_RE.test(stripped)) {
    throw new SyntaxError(
      'Code Mode scripts cannot use `import` statements; use the provided global tools and helpers instead.',
    )
  }
}

/**
 * Fallback transform when a script combines top-level `return` with `await`
 * (which `Bun.Transpiler({ replMode: true })` rejects as ESM top-level return)
 * or when running under a non-Bun runtime. Hoists top-level declarations to
 * `var` outside `(async () => { ... })()` so bindings persist across turns.
 */
function transformWithTopLevelHoistAndAsyncIife(code: string): string {
  const hoisted = new Set<string>()
  const parts: string[] = []
  let i = 0
  const len = code.length
  let braceDepth = 0
  let parenDepth = 0
  let bracketDepth = 0
  let emitted = ''
  const templateBraceDepths: number[] = []
  const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
  const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)
  const isAtTopLevel = () =>
    braceDepth === 0 &&
    parenDepth === 0 &&
    bracketDepth === 0 &&
    templateBraceDepths.length === 0

  while (i < len) {
    const ch = code[i]!
    const next = code[i + 1]
    if (ch === '/' && next === '/') {
      const start = i
      i += 2
      while (i < len && code[i] !== '\n') i++
      parts.push(code.slice(start, i))
      emitted += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      const start = i
      i += 2
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(len, i + 2)
      parts.push(code.slice(start, i))
      emitted += ' '
      continue
    }
    if (ch === "'" || ch === '"') {
      const end = scanStringLiteralEnd(code, i)
      parts.push(code.slice(i, end))
      emitted += '""'
      i = end
      continue
    }
    if (ch === '`') {
      const start = i
      i++
      while (i < len) {
        if (code[i] === '\\') {
          i += 2
          continue
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          i += 2
          templateBraceDepths.push(0)
          break
        }
        if (code[i] === '`') {
          i++
          break
        }
        i++
      }
      parts.push(code.slice(start, i))
      emitted += ' '
      continue
    }
    if (templateBraceDepths.length > 0) {
      if (ch === '{') {
        templateBraceDepths[templateBraceDepths.length - 1]! += 1
        parts.push(ch)
        emitted += ch
        i++
        continue
      }
      if (ch === '}') {
        const td = templateBraceDepths[templateBraceDepths.length - 1]!
        if (td === 0) {
          templateBraceDepths.pop()
          const resumeStart = i
          i++
          while (i < len) {
            if (code[i] === '\\') {
              i += 2
              continue
            }
            if (code[i] === '$' && code[i + 1] === '{') {
              i += 2
              templateBraceDepths.push(0)
              break
            }
            if (code[i] === '`') {
              i++
              break
            }
            i++
          }
          parts.push(code.slice(resumeStart, i))
          emitted += ')'
          continue
        }
        templateBraceDepths[templateBraceDepths.length - 1] = td - 1
        parts.push(ch)
        emitted += ch
        i++
        continue
      }
    }
    if (ch === '/' && canPrecedeRegexLiteral(emitted)) {
      const end = scanRegexLiteralEnd(code, i)
      parts.push(code.slice(i, end))
      emitted += '""'
      i = end
      continue
    }

    if (isAtTopLevel() && isIdentStart(ch)) {
      const idStart = i
      i++
      while (i < len && isIdentPart(code[i]!)) i++
      const word = code.slice(idStart, i)
      const afterWs = skipWsAndComments(code, i)

      if (
        (word === 'const' || word === 'let' || word === 'var') &&
        !isPrecededByMemberDot(emitted, emitted.length)
      ) {
        const targetChar = code[afterWs]
        if (targetChar && isIdentStart(targetChar)) {
          let nameEnd = afterWs + 1
          while (nameEnd < len && isIdentPart(code[nameEnd]!)) nameEnd++
          const varName = code.slice(afterWs, nameEnd)
          const eqIdx = skipWsAndComments(code, nameEnd)
          if (code[eqIdx] === '=' && code[eqIdx + 1] !== '=') {
            hoisted.add(varName)
            parts.push(varName)
            emitted += varName
            i = nameEnd
            continue
          }
          if (code[eqIdx] === ';' || code[eqIdx] === '\n' || eqIdx >= len) {
            hoisted.add(varName)
            i = nameEnd
            continue
          }
        } else if (targetChar === '{' || targetChar === '[') {
          const closeChar = targetChar === '{' ? '}' : ']'
          const closeIdx = findMatchingDelimiter(
            code,
            afterWs,
            targetChar,
            closeChar,
          )
          if (closeIdx !== -1) {
            const pattern = code.slice(afterWs, closeIdx + 1)
            const eqIdx = skipWsAndComments(code, closeIdx + 1)
            if (code[eqIdx] === '=' && code[eqIdx + 1] !== '=') {
              collectDestructuringBindings(
                stripJsCommentsAndStrings(pattern),
                targetChar === '{',
                hoisted,
              )
              const stmtEnd = findSingleStatementEnd(code, eqIdx + 1)
              const rhs = code.slice(eqIdx + 1, stmtEnd).replace(/;\s*$/, '')
              const wrapped = `(${pattern} = ${rhs});`
              parts.push(wrapped)
              emitted += wrapped
              i = stmtEnd
              continue
            }
          }
        }
      } else if (
        word === 'function' &&
        !isPrecededByMemberDot(emitted, emitted.length)
      ) {
        let fnNameStart = afterWs
        if (code[fnNameStart] === '*') {
          fnNameStart = skipWsAndComments(code, fnNameStart + 1)
        }
        if (fnNameStart < len && isIdentStart(code[fnNameStart]!)) {
          let fnNameEnd = fnNameStart + 1
          while (fnNameEnd < len && isIdentPart(code[fnNameEnd]!)) fnNameEnd++
          const fnName = code.slice(fnNameStart, fnNameEnd)
          hoisted.add(fnName)
          parts.push(`globalThis.${fnName} = ${fnName}; ${word}`)
          emitted += word
          continue
        }
      } else if (
        word === 'async' &&
        !isPrecededByMemberDot(emitted, emitted.length) &&
        code.slice(afterWs, afterWs + 8) === 'function' &&
        !isIdentPart(code[afterWs + 8] ?? '')
      ) {
        let fnNameStart = skipWsAndComments(code, afterWs + 8)
        if (code[fnNameStart] === '*') {
          fnNameStart = skipWsAndComments(code, fnNameStart + 1)
        }
        if (fnNameStart < len && isIdentStart(code[fnNameStart]!)) {
          let fnNameEnd = fnNameStart + 1
          while (fnNameEnd < len && isIdentPart(code[fnNameEnd]!)) fnNameEnd++
          const fnName = code.slice(fnNameStart, fnNameEnd)
          hoisted.add(fnName)
          parts.push(`globalThis.${fnName} = ${fnName}; ${word}`)
          emitted += word
          continue
        }
      } else if (
        word === 'class' &&
        !isPrecededByMemberDot(emitted, emitted.length) &&
        afterWs < len &&
        isIdentStart(code[afterWs]!)
      ) {
        let clsEnd = afterWs + 1
        while (clsEnd < len && isIdentPart(code[clsEnd]!)) clsEnd++
        const clsName = code.slice(afterWs, clsEnd)
        hoisted.add(clsName)
        parts.push(`${clsName} = class`)
        emitted += 'class'
        continue
      }

      parts.push(word)
      emitted += word
      continue
    }

    if (ch === '{') braceDepth++
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (ch === '(') parenDepth++
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1)
    else if (ch === '[') bracketDepth++
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1)

    parts.push(ch)
    emitted += ch
    i++
  }

  const varDecls = [...hoisted].map(name => `var ${name};`).join('\n')
  const prefix = varDecls ? `${varDecls}\n` : ''
  return `${prefix}(async () => {\n${parts.join('')}\n})()`
}

/**
 * Official 2.1.328 (`jl`/`ep` + `ua`): transform a Code Mode script so
 * top-level `const`/`let`/`var`/`function`/`class` bindings persist onto the
 * VM context across turns and all loops call `__checkBudget()`.
 */
export function transformCodeModeScript(
  code: string,
  rawLiteralMarkerName = '__markRawLiteral',
): string {
  rejectStaticImports(code)
  const rawMarked = markCodeModeRawLiterals(code, rawLiteralMarkerName)
  const transpiler = getReplTranspiler()
  let transformed: string
  if (transpiler) {
    try {
      transformed = transpiler.transformSync(rawMarked)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/top-level return/i.test(msg)) {
        transformed = transformWithTopLevelHoistAndAsyncIife(rawMarked)
      } else if (rawMarked.trimStart().startsWith('{')) {
        try {
          transformed = transpiler.transformSync(`(${rawMarked}\n)`)
        } catch {
          try {
            transformed = transpiler.transformSync(`;${rawMarked}`)
          } catch {
            transformed = transformWithTopLevelHoistAndAsyncIife(rawMarked)
          }
        }
      } else {
        throw err
      }
    }
  } else {
    transformed = transformWithTopLevelHoistAndAsyncIife(rawMarked)
  }
  return instrumentCodeModeLoops(transformed)
}

function unwrapReplTransformValue(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === 'object' &&
    Object.getPrototypeOf(raw) === null &&
    Object.hasOwn(raw, 'value') &&
    Object.keys(raw).length === 1
  ) {
    return (raw as { value: unknown }).value
  }
  return raw
}

/**
 * Executes a JavaScript snippet inside a sandboxed VM context (reused per
 * `sessionKey` across turns so top-level bindings persist), exposing async
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
    sessionKey,
    allowedTools,
    unsetVars,
    onProgress,
    permissionMode,
    getCachedFileContent,
    availableToolNames,
    toolDescriptors,
    evalId,
    dosLimits,
  } = options

  noteReplContextCreated()

  const resolvedDosLimits = resolveReplDosLimits(dosLimits)
  const turnCallBudget = new ReplTurnCallBudget(resolvedDosLimits)
  const clampedTimeout = Math.max(100, Math.min(timeoutMs, REPL_MAX_TIMEOUT_MS))
  const logs: string[] = []
  let toolCalls = 0
  let nextCallSeq = 0
  // Official 2.1.328 (#653): track in-flight tool calls so failures report
  // which tool calls were still running when the script failed.
  const inFlightCalls = new Map<number, string>()
  const scriptReadCache = new Map<string, string>()

  // Execution-scoped stop/abort state so timeout or external abort immediately
  // stops in-flight waits, aborts inner tools, and refuses any subsequent
  // zombie tool calls from background continuations.
  const execAbortController = new AbortController()
  let stopped = false
  let stopMessage = ''
  let inFlightSnapshotAtStop: string[] | undefined
  let stopReject: ((err: Error) => void) | undefined
  const stopPromise = new Promise<never>((_resolve, reject) => {
    stopReject = reject
  })
  void stopPromise.catch(() => {})

  const triggerStop = (message: string) => {
    if (stopped) return
    stopped = true
    stopMessage = message
    inFlightSnapshotAtStop = [...inFlightCalls.values()]
    const err = new Error(message)
    if (!execAbortController.signal.aborted) {
      execAbortController.abort(err)
    }
    stopReject?.(err)
  }

  const isStopped = () =>
    stopped || signal?.aborted === true || execAbortController.signal.aborted

  const getStopMessage = () =>
    stopped ? stopMessage : 'Code Mode script aborted'

  const vmSession =
    sessionKey !== undefined
      ? getOrCreatePersistentVmSession(sessionKey)
      : createCodeModeVmSession()
  const { sandbox, context } = vmSession

  const callCodec = createReplCodec({
    mostItems: resolvedDosLimits.mostItems,
    mostDepth: resolvedDosLimits.mostDepth,
    mostDigits: resolvedDosLimits.mostDigits,
    mostChars: resolvedDosLimits.mostJsonChars,
    hides: value =>
      value === sandbox || value === globalThis || utilTypes.isProxy(value),
    extraObjectPrototypes: [vmSession.bridge.realmObjectPrototype],
    extraArrayPrototypes: [vmSession.bridge.realmArrayPrototype],
  })

  const evalTurnState = makeTurnState()

  let timerRef: PausableCodeModeTimer | undefined
  // Official `ft`/`startsNoMoreCalls`: after the script's deadline (or abort)
  // the realm must refuse to start NEW tool calls. Stored per-eval on `binding`
  // so concurrent detached evals never interfere with each other.
  const evalTimers = new Set<number>()

  const guardedCall = async (
    rawToolName: unknown,
    rawInput: unknown = {},
  ): Promise<unknown> => {
    // Official `ft` (`It.startsNoMoreCalls=!0`): once the turn deadline/abort
    // fires, zombie continuations cannot start new tool calls — they throw
    // the timeout message directly.
    if (binding.noMoreCalls) {
      throw new Error(getStopMessage())
    }
    if (isStopped()) {
      throw new Error(getStopMessage())
    }
    // Official 2.1.331 (`be.answer` / `MNt`): tool name must be a string within `mostTextChars`.
    if (
      typeof rawToolName !== 'string' ||
      rawToolName.length > resolvedDosLimits.mostTextChars
    ) {
      throw new ReplHostCallValidationError(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    }
    const toolName = rawToolName
    // Official 2.1.331 (`createCodec.encode(..., true)` + `ae` + `Ae.#E`):
    // validate nesting depth, BigInt digit count, per-call argument size, wire
    // length/depth, and per-turn call count / total data budget BEFORE invoking
    // the host tool.
    const encodedInput = callCodec.encode(rawInput, undefined, true)
    let decodedInput: unknown
    try {
      decodedInput = decodeReplWireValue(
        encodedInput,
        callCodec,
        resolvedDosLimits,
      )
    } catch {
      throw new ReplHostCallValidationError(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    }
    binding.turnCallBudget.chargeOrThrow([toolName, encodedInput], false)
    const input = (
      typeof decodedInput === 'object' && decodedInput !== null
        ? decodedInput
        : decodedInput === undefined
          ? {}
          : decodedInput
    ) as Record<string, unknown>
    const inputObj =
      typeof input === 'object' && input !== null ? input : undefined
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
    if (toolName === 'Edit' && inputObj && isNoOpCodeModeEdit(inputObj)) {
      return {
        filePath:
          typeof inputObj.file_path === 'string' ? inputObj.file_path : '',
        changed: false,
        noOp: true,
      }
    }
    const callId = ++nextCallSeq
    const callLabel =
      (toolName === 'Bash' || toolName === 'PowerShell') &&
      inputObj &&
      typeof inputObj.command === 'string'
        ? `${toolName}(${JSON.stringify(inputObj.command.slice(0, 60))})`
        : toolName
    inFlightCalls.set(callId, callLabel)
    // Official `Wl`/`Xo`/`Mr`: the step-budget turn only counts *script* code —
    // disarm it while inside a tool call. The elapsed deadline timer keeps
    // running so a tool that hangs still aborts the whole execution.
    const turn = binding.turnState
    const wasArmed = turn.bound !== 0
    turn.bound = 0
    const shouldPause = shouldPauseCodeModeTimerForTool(
      toolName,
      permissionMode,
    )
    if (shouldPause) timerRef?.pause()
    try {
      const toolPromise = Promise.resolve(
        invokeTool(toolName, input, execAbortController.signal),
      )
      void toolPromise.catch(() => {})
      const result = await Promise.race([toolPromise, stopPromise])
      // Official `wl`/`Mr` + `Ae.#k`: on resume, re-arm a fresh turn and reset
      // the per-turn call/data budget so awaiting lets subsequent turns proceed.
      if (!isStopped()) {
        binding.turnCallBudget.reset()
        if (wasArmed) {
          startCodeModeTurn(binding.turnState, clampedTimeout)
        }
      }
      if (isStopped()) {
        throw new Error(getStopMessage())
      }
      if (
        toolName === 'Read' &&
        inputObj &&
        typeof inputObj.file_path === 'string'
      ) {
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
          scriptReadCache.set(inputObj.file_path, readContent)
        }
      } else if (
        toolName === 'Write' &&
        inputObj &&
        typeof inputObj.file_path === 'string' &&
        typeof inputObj.content === 'string'
      ) {
        scriptReadCache.set(inputObj.file_path, inputObj.content)
      }
      return result
    } catch (err) {
      if (isStopped()) {
        throw new Error(getStopMessage())
      }
      // Official 2.1.328 (#652): on failed Edit, attach closest-match hint only
      // from already-cached readable content (never invoke Read, which could
      // bypass allowedTools or trigger a Read permission prompt).
      if (
        toolName === 'Edit' &&
        inputObj &&
        typeof inputObj.file_path === 'string' &&
        typeof inputObj.old_string === 'string' &&
        err instanceof Error &&
        /not found|multiple|match/i.test(err.message) &&
        (!allowedTools || allowedTools.has('Read'))
      ) {
        const content =
          scriptReadCache.get(inputObj.file_path) ??
          getCachedFileContent?.(inputObj.file_path)
        if (content !== undefined) {
          const hint = findClosestEditMatchHint(content, inputObj.old_string)
          if (hint) {
            throw new Error(`${err.message}\n${hint}`)
          }
        }
      }
      throw err
    } finally {
      if (shouldPause) timerRef?.resume()
      if (!isStopped()) {
        binding.turnCallBudget.reset()
        if (wasArmed) {
          startCodeModeTurn(binding.turnState, clampedTimeout)
        }
      }
      if (!stopped) {
        inFlightCalls.delete(callId)
      }
    }
  }

  // Official 2.1.326 #293 + 2.1.328 (`$c`/`zc`/`Fc`): `$` shell helper exposed
  // as a 100% realm-sealed callable with realm `$.escape` and realm Promise.
  const mayLeaveUnquoted = (v: object): boolean =>
    Object.keys(v).length === 1 &&
    Object.hasOwn(v, 'raw') &&
    vmSession.rawLiteralValues.get(v) === (v as { raw: unknown }).raw

  const createShellRunner = (
    command: string,
    initialTimeout?: number,
  ): CodeModeShellRunner => {
    return async (
      nothrow: boolean,
      msOverride: number | undefined,
      cwdVal: string | undefined,
      envVal: unknown,
    ): Promise<Record<string, unknown>> => {
      if (isStopped()) {
        throw new Error(getStopMessage())
      }
      const ms = msOverride ?? initialTimeout
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
      if (exitCode !== 0 && !nothrow) {
        const cutNotice = outputWasCut
          ? '\nNote: the command failed, and its output was too long to keep whole, so stdout has a "characters truncated" line where the middle was cut out.'
          : ''
        const err = new Error(
          `Command failed with exit code ${exitCode}${stderr ? `:\n${stderr}` : ''}${cutNotice}`,
        )
        err.name = 'ShellError'
        throw err
      }
      return {
        stdout,
        stderr,
        exitCode,
        ...(outputWasCut ? { truncated: true } : {}),
      }
    }
  }

  const dispatchDollar = (first: unknown, values: unknown[]) => {
    if (Array.isArray(first) && Object.hasOwn(first, 'raw')) {
      const rendered = renderCodeModeShellTemplate(
        first as readonly string[] & { raw?: readonly string[] },
        values,
        { shellKind, mayLeaveUnquoted },
      )
      return createShellRunner(rendered)
    }
    return createShellRunner(
      String(first),
      typeof values[0] === 'number' ? values[0] : undefined,
    )
  }

  // Official 2.1.328 (#581 & `Tl`/`Rl`): bind each allowed tool global AT MOST
  // ONCE onto `vmSession.sandbox`, dispatching to the active eval via
  // `AsyncLocalStorage` so concurrent/detached evals never overwrite or delete
  // each other's bindings.
  const exposedTools: string[] = []
  const exposedToolSet = new Set<string>()
  for (const [fnName, toolName] of PRIMITIVE_SHORTHAND_MAP) {
    if (allowedTools && !allowedTools.has(toolName)) {
      continue
    }
    exposedTools.push(toolName)
    exposedToolSet.add(toolName)
    ensureToolGlobalBound(vmSession, fnName, toolName)
    ensureToolGlobalBound(vmSession, toolName, toolName)
  }
  const extraToolNames = [
    ...(availableToolNames ?? []),
    ...(allowedTools ? [...allowedTools] : []),
  ]
  for (const toolName of extraToolNames) {
    if (
      exposedToolSet.has(toolName) ||
      !VALID_IDENTIFIER_RE.test(toolName) ||
      toolName === 'REPL' ||
      toolName === 'Eval'
    ) {
      continue
    }
    if (
      allowedTools &&
      !toolName.startsWith('mcp__') &&
      !allowedTools.has(toolName)
    ) {
      continue
    }
    exposedTools.push(toolName)
    exposedToolSet.add(toolName)
    ensureToolGlobalBound(vmSession, toolName, toolName)
  }

  const descriptorList =
    toolDescriptors ?? exposedTools.map(name => ({ name, description: name }))
  const evalsAccess = getReplSessions().access(
    sessionKey ?? REPL_MAIN_THREAD_KEY,
    () => evalId,
  )

  const binding: CodeModeEvalBinding = {
    outside: false,
    ended: false,
    noMoreCalls: false,
    shellKind,
    logs,
    turnState: evalTurnState,
    clampedTimeout,
    timers: evalTimers,
    allowedTools,
    exposedTools,
    toolDescriptors: descriptorList,
    evalsAccess,
    dosLimits: resolvedDosLimits,
    turnCallBudget,
    isStopped,
    getStopMessage,
    guardedCall,
    dispatchDollar,
  }

  let onAbort: (() => void) | undefined
  // Official `ft`: the pausable deadline timer aborts the whole execution once
  // real elapsed time exceeds the budget — covers tool calls that never return
  // and async hangs. `runInContext` has no `timeout` so a single long tool call
  // doesn't count as script time; the step budget handles sync spin.
  timerRef = createPausableCodeModeTimer(clampedTimeout, () => {
    binding.noMoreCalls = true
    triggerStop(`Code Mode script timed out after ${clampedTimeout}ms`)
  })
  const getAbortReasonMessage = (): string => {
    const reason = signal?.reason
    if (reason instanceof Error && reason.message.length > 0) {
      return reason.message
    }
    if (typeof reason === 'string' && reason.length > 0) {
      return reason
    }
    return 'Code Mode script aborted'
  }

  if (signal) {
    if (signal.aborted) {
      triggerStop(getAbortReasonMessage())
    } else {
      onAbort = () => triggerStop(getAbortReasonMessage())
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  try {
    if (isStopped()) {
      throw new Error(getStopMessage())
    }
    // Official 2.1.328 (#576): guard references to top-level variables declared
    // by an earlier failed script that were never set.
    const guardedCode = unsetVars ? injectUnsetVarGuards(code, unsetVars) : code
    const wrappedSource = transformCodeModeScript(
      guardedCode,
      vmSession.rawLiteralMarkerName,
    )
    const script = new vm.Script(wrappedSource, {
      filename: REPL_SCRIPT_FILENAME,
      importModuleDynamically: (() => {
        throw new Error('Dynamic import() is not allowed in Code Mode scripts')
      }) as never,
    })
    let rawRun: unknown
    try {
      // Official `Xo`/`El` + `currentCall.run(this.binding, ...)`: arm a fresh
      // per-eval turn and run inside `AsyncLocalStorage` so concurrent/detached
      // evals remain completely isolated.
      startCodeModeTurn(binding.turnState, clampedTimeout)
      binding.turnCallBudget.reset()
      rawRun = vmSession.currentCall.run(binding, () =>
        script.runInContext(context),
      )
    } catch (syncErr) {
      if (
        syncErr &&
        typeof syncErr === 'object' &&
        (syncErr as { code?: unknown }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
      ) {
        binding.noMoreCalls = true
        triggerStop(`Code Mode script timed out after ${clampedTimeout}ms`)
        throw new Error(getStopMessage())
      }
      throw syncErr
    }
    const runPromise = Promise.resolve(rawRun)
    // Suppress unhandledRejection if runPromise rejects after timeout/abort wins the race.
    void runPromise.catch(() => {})

    const raced = await Promise.race([runPromise, stopPromise])
    binding.noMoreCalls = true
    const unwrapped = unwrapReplTransformValue(raced)

    const outputParts: string[] = logs.map(l => elideReplOutputPart(l))
    if (unwrapped !== undefined) {
      outputParts.push(elideReplOutputPart(formatValueForOutput(unwrapped)))
    }
    return {
      result:
        elideReplOutputPart(outputParts.join('\n')) ||
        '(completed with no output)',
      tool_calls: toolCalls,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const formattedError = formatThrownErrorHeader(err)
    const plainErrorText = mapReplPlainErrorLine(err, formattedError)
    const prefix = logs.length > 0 ? `${logs.join('\n')}\n` : ''
    // Official 2.1.328 (#653): report which tool calls were still running when
    // the script failed.
    const stillRunning = inFlightSnapshotAtStop ?? [...inFlightCalls.values()]
    const runningSuffix =
      stillRunning.length > 0
        ? `\nStill running when script failed: ${stillRunning.join(', ')}`
        : ''
    // Official 2.1.328 (#576): record declared top-level variables that remained
    // unset so subsequent scripts don't silently read `undefined`.
    const unsetVariables = extractTopLevelDeclaredVars(code).filter(
      varName => sandbox[varName] === undefined,
    )
    return {
      result: `${prefix}Error: ${message}${runningSuffix}`,
      tool_calls: toolCalls,
      ...(stillRunning.length > 0 ? { inFlightAtFailure: stillRunning } : {}),
      ...(unsetVariables.length > 0 ? { unsetVariables } : {}),
      ...(plainErrorText !== undefined
        ? {
            plainErrorLine: {
              text: plainErrorText,
              replaces: summarizeReplErrorLine(formattedError),
            },
          }
        : {}),
    }
  } finally {
    binding.ended = true
    clearTimersForEvalBinding(vmSession, binding)
    timerRef?.clear()
    timerRef = undefined
    if (onAbort !== undefined) {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

const CODE_MODE_VISIBLE_TOOL_NAMES = new Set([
  'REPL',
  'Eval',
  'StructuredOutput',
])

export function getCodeModeAutoVerdictTracker(): CodeModeAutoVerdictTracker {
  return getExecutorSessionState().codeModeAutoVerdictTracker
}

export function resetCodeModeRuntimeStateForTests(): void {
  const state = getExecutorSessionState()
  for (const s of state.persistentVmSessionsByKey.values()) {
    s.clearAllTimers()
  }
  state.persistentVmSessionsByKey.clear()
  state.sessionUnsetVarsByKey.clear()
  state.codeModeAutoVerdictTracker.reset()
  state.codeModeScriptSeq = 0
}

/**
 * Official `cNn` (`chunk@294254613.js @1709417`): true when code contains a
 * `\\uXXXX` unicode escape that auto mode refuses to classify.
 */
export function hasUnicodeHexEscape(code: string): boolean {
  return /\\u[0-9a-fA-F]{4}/.test(code)
}

/**
 * Official `alo()` (`chunk@294254613.js @5858237`): refusal message when a hook
 * rewrote the REPL script or an earlier tool call in the same response under
 * auto mode.
 */
export const CODE_MODE_HOOK_REWRITE_REFUSAL =
  "This code was NOT run. In Code Mode, auto mode doesn't run code after a hook changed its call from what you wrote. This also applies when a hook changed an earlier tool call in the same response. This is not a judgment that the code is unsafe. If this response had other tool calls, you may send this code once more, in a response with no other tool calls. Otherwise, don't send it again. Go on with work that doesn't need it, and tell the user that a hook (a PreToolUse hook, or a mod's) changes your code. They can turn that hook off (or ask their administrator, if their organization set it), or leave auto mode with Shift+Tab (for example for Manual mode), where they are asked about each of the code's tool calls that needs approval."

export const CODE_MODE_HOOK_REWRITE_REASON =
  "Auto mode does not run code after a hook changed it, or changed an earlier tool call in the same response. Turn the hook off, or leave auto mode, where you are asked about each of the code's tool calls that needs approval."

/**
 * Official `ilo()` (`chunk@294254613.js @5857961`): refusal message when a REPL
 * script contains a `\\uXXXX` escape under auto mode.
 */
export const CODE_MODE_UNICODE_ESCAPE_REFUSAL =
  'This code was NOT run. Auto mode could not check it, because it contains a \\uXXXX escape. This is not a judgment that the code is unsafe. Write each such character another way, for example \\x1b or \\u{1b} in place of \\u001b, and send the code again.'

export const CODE_MODE_UNICODE_ESCAPE_REASON =
  'Auto mode cannot check code that contains a \\uXXXX escape'

function isWithheldOutsideCodeModeLaunchList(
  permissionContext: ToolPermissionContext,
  tool: { name: string; mcpInfo?: unknown; isMcp?: boolean },
): boolean {
  const kept = permissionContext.toolsKeptByLaunchList
  if (
    kept === undefined ||
    tool.name.startsWith('mcp__') ||
    tool.isMcp === true ||
    tool.mcpInfo !== undefined ||
    tool.name === SYNTHETIC_OUTPUT_TOOL_NAME ||
    kept.includes(tool.name)
  ) {
    return false
  }
  return true
}

function synthesizeCodeModeRestrictedDenyNames(
  tools: readonly { name: string; enablesCodeExecution?: boolean }[],
  permissionContext: ToolPermissionContext,
): Set<string> {
  if (
    !(
      permissionContext.restricted === true &&
      permissionContext.toolsKeptByLaunchList === undefined
    )
  ) {
    return new Set()
  }
  const codeRunning = new Set([
    ...tools.filter(t => t.enablesCodeExecution).map(t => t.name),
    ...restrictedAlwaysCodeRunningNames(),
  ])
  return new Set(restrictedDenyToolNames(codeRunning, new Set()))
}

function parseSubagentDisallowedTools(
  disallowedTools: readonly string[] | undefined,
): {
  bareDisallowed: Set<string>
  disallowedMcpServers: Set<string>
  disallowAllMcp: boolean
} {
  const bareDisallowed = new Set<string>()
  const disallowedMcpServers = new Set<string>()
  let disallowAllMcp = false
  for (const rawSpec of disallowedTools ?? []) {
    if (typeof rawSpec !== 'string') continue
    const spec = rawSpec.trim()
    if (!spec) continue
    // Official `Clt` (`chunk@303112704.js @179720`): scoped rules like
    // `"Bash(rm:*)"` carry ruleContent and are enforced at permission time —
    // they MUST NOT ban the entire `Bash` tool from the subagent's tool pool.
    if (spec.includes('(')) continue
    bareDisallowed.add(spec)
    if (spec === 'mcp__*' || spec === 'mcp__*__*') {
      disallowAllMcp = true
    } else if (spec.startsWith('mcp__')) {
      const rest = spec.slice(5)
      if (!rest.includes('__')) {
        disallowedMcpServers.add(rest)
      } else if (rest.endsWith('__*')) {
        disallowedMcpServers.add(rest.slice(0, -3))
      }
    }
  }
  return { bareDisallowed, disallowedMcpServers, disallowAllMcp }
}

function isToolDisallowedForSubagent(
  tool: Tool,
  parsed: ReturnType<typeof parseSubagentDisallowedTools>,
): boolean {
  if (parsed.bareDisallowed.has(tool.name)) return true
  const isMcp =
    tool.isMcp === true ||
    tool.mcpInfo !== undefined ||
    tool.name.startsWith('mcp__')
  if (!isMcp) return false
  if (parsed.disallowAllMcp) return true
  if (parsed.disallowedMcpServers.size > 0) {
    const serverName =
      tool.mcpInfo?.serverName ?? mcpInfoFromString(tool.name)?.serverName
    if (
      serverName !== undefined &&
      parsed.disallowedMcpServers.has(serverName)
    ) {
      return true
    }
  }
  return false
}

function matchesSubagentAllowList(
  tool: Tool,
  allowList: ReadonlySet<string>,
): boolean {
  if (allowList.has(tool.name)) return true
  for (const entry of allowList) {
    const trimmed = entry.trim()
    const baseName = trimmed.includes('(')
      ? trimmed.slice(0, trimmed.indexOf('(')).trim()
      : trimmed
    if (baseName === '*' || baseName === tool.name) return true
    if (
      baseName === 'mcp__*' &&
      (tool.isMcp === true || tool.name.startsWith('mcp__'))
    ) {
      return true
    }
    if (baseName.startsWith('mcp__')) {
      const prefix = baseName.endsWith('__*')
        ? baseName.slice(0, -1)
        : !baseName.slice(5).includes('__')
          ? `${baseName}__`
          : undefined
      if (prefix !== undefined && tool.name.startsWith(prefix)) return true
    }
  }
  return false
}

/**
 * Resolve the effective tool pool callable from a Code Mode script, honoring:
 * - explicit deny rules & MCP server-prefix deny rules (`getDenyRuleForTool`)
 * - `--tools` launch list (`toolsKeptByLaunchList`)
 * - `--restricted` mode (`synthesizeCodeModeRestrictedDenyNames`)
 * - plugin `tool.list` removals & deny rules
 * - org-blocked MCP tools (`effectiveMaxPermission === 'blocked'`)
 * - subagent `tools` allowlist + blanket `disallowedTools` (without banning
 *   whole tools on scoped rules like `"Bash(rm:*)"`) + live MCP tools.
 */
export function resolveCodeModeEffectiveTools(
  baseReplToolName: string,
  resolveAvailableTools: () => readonly Tool[],
  context: ToolUseContext,
): Tool[] {
  const appState = context.getAppState?.()
  const rawPermCtx = appState?.toolPermissionContext
  const effectivePermCtx = rawPermCtx
    ? applyPluginToolListDenyRules(rawPermCtx)
    : undefined
  const contextTools = context.options?.tools
  const liveMcpTools = appState?.mcp?.tools ?? []
  const hasExplicitPrimitiveTools =
    Array.isArray(contextTools) &&
    contextTools.some(
      t =>
        !CODE_MODE_VISIBLE_TOOL_NAMES.has(t.name) &&
        t.name !== baseReplToolName,
    )

  const enabledBaseTools = () =>
    resolveAvailableTools().filter(
      t => typeof t.isEnabled !== 'function' || t.isEnabled(),
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
        const parsedDisallowed = parseSubagentDisallowedTools(
          agentDef.disallowedTools,
        )
        const allowList =
          agentDef.tools &&
          !(agentDef.tools.length === 1 && agentDef.tools[0] === '*')
            ? new Set(agentDef.tools)
            : undefined
        const candidates = [...enabledBaseTools(), ...liveMcpTools]
        rawTools = candidates.filter(t => {
          if (isToolDisallowedForSubagent(t, parsedDisallowed)) return false
          if (allowList && !matchesSubagentAllowList(t, allowList)) return false
          return true
        })
      } else if (Array.isArray(contextTools)) {
        rawTools = [...contextTools, ...liveMcpTools]
      } else {
        rawTools = []
      }
    }
  } else if (hasExplicitPrimitiveTools) {
    // Explicit restricted tool list on main thread (e.g. `--tools Read,Grep`)
    rawTools = [...contextTools, ...liveMcpTools]
  } else {
    // Main thread with Code Mode hiding primitives from `context.options.tools`
    rawTools = [...enabledBaseTools(), ...(contextTools ?? []), ...liveMcpTools]
  }

  const pluginFiltered = applyPluginToolListFilter(rawTools)
  const restrictedDenySet = effectivePermCtx
    ? synthesizeCodeModeRestrictedDenyNames(pluginFiltered, effectivePermCtx)
    : new Set<string>()

  const seen = new Set<string>()
  const deduped: Tool[] = []
  for (const tool of pluginFiltered) {
    if (seen.has(tool.name)) continue
    if (tool.name !== SYNTHETIC_OUTPUT_TOOL_NAME) {
      if (tool.mcpInfo?.effectiveMaxPermission === 'blocked') continue
      if (restrictedDenySet.has(tool.name)) continue
      if (
        effectivePermCtx &&
        ((effectivePermCtx.alwaysDenyRules &&
          getDenyRuleForTool(effectivePermCtx, tool)) ||
          isWithheldOutsideCodeModeLaunchList(effectivePermCtx, tool))
      ) {
        continue
      }
    }
    seen.add(tool.name)
    deduped.push(tool)
  }
  return deduped
}

function extractMediaBlocksFromToolData(data: unknown): REPLMediaBlock[] {
  const blocks: REPLMediaBlock[] = []
  if (!data || typeof data !== 'object') return blocks
  const rec = data as Record<string, unknown>
  // FileReadTool image/pdf shape: { type: 'image'|'pdf', file: { base64, type } }
  if (
    (rec.type === 'image' || rec.type === 'pdf') &&
    rec.file &&
    typeof rec.file === 'object'
  ) {
    const f = rec.file as { base64?: unknown; type?: unknown }
    if (typeof f.base64 === 'string' && f.base64.length > 0) {
      blocks.push({
        type: rec.type === 'pdf' ? 'document' : 'image',
        source: {
          type: 'base64',
          media_type:
            typeof f.type === 'string'
              ? f.type
              : rec.type === 'pdf'
                ? 'application/pdf'
                : 'image/png',
          data: f.base64,
        },
      })
    }
  }
  return blocks
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

  const wrappedTool: Tool = {
    ...baseReplTool,
    aliases: ['Eval'],
    isEnabled() {
      return isCodeModeEnabled() || isReplModeEnabled()
    },
    userFacingName() {
      return isCodeModeEnabled() ? 'Code' : baseReplTool.name
    },
    toAutoClassifierInput(input: unknown) {
      return input &&
        typeof input === 'object' &&
        typeof (input as { code?: unknown }).code === 'string'
        ? (input as { code: string }).code
        : ''
    },
    suppressesAlwaysAllowRule() {
      return isCodeModeEnabled()
    },
    permissionNote(input: unknown, mode?: string) {
      if (!isCodeModeEnabled()) return undefined
      const desc =
        typeof input === 'object' &&
        input !== null &&
        'description' in input &&
        typeof (input as { description?: unknown }).description === 'string'
          ? (input as { description: string }).description.trim()
          : ''
      const baseNote =
        desc === ''
          ? "Yes runs Claude's code."
          : "Yes runs Claude's code. The line at the top is Claude's own summary of it, and nothing checks it against the code."
      return mode === undefined || mode === 'bypassPermissions'
        ? baseNote
        : `${baseNote} Each tool call that needs approval while this code runs is still checked on its own, by auto mode, by you or by a hook you've set up.`
    },
    async checkPermissions(input: unknown, context: ToolUseContext) {
      const mode = context.getAppState?.()?.toolPermissionContext?.mode
      if (mode === 'auto') {
        const hookRewriteCtx = context as {
          inputChangedByHook?: boolean
          serverClassifierInputRewritten?: boolean
        }
        if (
          isCodeModeEnabled() &&
          (hookRewriteCtx.inputChangedByHook === true ||
            hookRewriteCtx.serverClassifierInputRewritten === true)
        ) {
          return {
            behavior: 'deny' as const,
            message: CODE_MODE_HOOK_REWRITE_REFUSAL,
            decisionReason: {
              type: 'other' as const,
              reason: CODE_MODE_HOOK_REWRITE_REASON,
            },
          }
        }
        const code =
          input &&
          typeof input === 'object' &&
          typeof (input as { code?: unknown }).code === 'string'
            ? (input as { code: string }).code
            : undefined
        if (
          isCodeModeEnabled() &&
          code !== undefined &&
          hasUnicodeHexEscape(code)
        ) {
          return {
            behavior: 'deny' as const,
            message: CODE_MODE_UNICODE_ESCAPE_REFUSAL,
            decisionReason: {
              type: 'other' as const,
              reason: CODE_MODE_UNICODE_ESCAPE_REASON,
            },
          }
        }
        return {
          behavior: 'passthrough' as const,
          message: `${REPL_TOOL_NAME} script requires classifier review.`,
        }
      }
      return {
        behavior: 'allow' as const,
        updatedInput: input as Record<string, unknown>,
      }
    },
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
          ? `\n\nAvailable Code Mode tools (callable as async global functions, e.g. \`await Read({ file_path })\`, \`await Bash({ command })\`, or via \`callTool(name, input)\`):\n${conciseLines.join('\n')}`
          : ''
      const runtimeGuidance = [
        'VM Runtime Globals & Helpers:',
        '- Available tools are exposed as async global functions by name (PascalCase, e.g. `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `PowerShell`, `NotebookEdit`, `Agent`, and connected `mcp__*` tools) as well as lowercase shorthands.',
        '- `$` shell template helper: ``await $`git status` `` with safe quoting, `.nothrow()`, `.throws()`, `.quiet()`, `.timeout(ms)`, `.cwd(dir)`, `.env(obj)`, `.text()`, `.lines()`, `.json()`, `$.escape(s)`, and script-authored `{ raw: "..." }` literals.',
        '- Logging & inspection: `console.log`/`self.log`/`log`, `console.tail(n)`, `console.buffer()`, `console.dropped()`, `preview(value, maxChars)`, `searchTools(query, limit)`, `describeTool(name)`, `tools.list()`.',
        '- Top-level bindings (`const`/`let`/`var`/`function`/`class`) persist across calls in the same session.',
      ].join('\n')
      return `${basePrompt}\n\n${runtimeGuidance}${toolsBlock}\n\n${CODE_MODE_STATIC_MCP_GUIDANCE}`
    },
    async call(
      input: { code: string; description?: string; timeout?: number },
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
      let activeScriptContext: ToolUseContext = context
      const currentPermissionMode =
        context.getAppState?.()?.toolPermissionContext?.mode
      // Official `chunk@294254613.js @3674600-3675200`: defense-in-depth in
      // auto mode — refuse hook-rewritten scripts and `\\uXXXX` escapes.
      if (currentPermissionMode === 'auto') {
        const hookRewriteCtx = context as {
          inputChangedByHook?: boolean
          serverClassifierInputRewritten?: boolean
        }
        const inputChangedByHook =
          hookRewriteCtx.inputChangedByHook === true ||
          hookRewriteCtx.serverClassifierInputRewritten === true ||
          (parentMessage as { serverClassifierInputRewritten?: boolean })
            ?.serverClassifierInputRewritten === true
        if (inputChangedByHook) {
          return {
            data: {
              result: `Error: ${CODE_MODE_HOOK_REWRITE_REFUSAL}`,
              tool_calls: 0,
            },
          }
        }
        if (typeof input.code === 'string' && hasUnicodeHexEscape(input.code)) {
          return {
            data: {
              result: `Error: ${CODE_MODE_UNICODE_ESCAPE_REFUSAL}`,
              tool_calls: 0,
            },
          }
        }
      }
      const executorState = getExecutorSessionState()
      const { codeModeAutoVerdictTracker, sessionUnsetVarsByKey } =
        executorState
      const scriptId =
        context.toolUseId ?? `repl-${++executorState.codeModeScriptSeq}`
      const unsetKey = context.agentId ?? 'main'
      const priorUnsetVars = sessionUnsetVarsByKey.get(unsetKey)

      // Official 2.1.328: persist replMode=true for this session so resume
      // recovers Code Mode cleanly.
      try {
        saveReplMode(true)
      } catch {
        // Best-effort outside full session storage lifecycle (e.g. unit tests)
      }

      // Per-script abort controller wired to parent abort + auto-mode stop chain
      const scriptAbortController = new AbortController()
      const parentSignal = context.abortController.signal
      let onParentAbort: (() => void) | undefined
      if (parentSignal.aborted) {
        scriptAbortController.abort(parentSignal.reason)
      } else {
        onParentAbort = () => scriptAbortController.abort(parentSignal.reason)
        parentSignal.addEventListener('abort', onParentAbort, { once: true })
      }
      let scriptAutoBlockedReason: string | undefined

      // Official 2.1.327 (#386) & 2.1.328 (`J.scriptChecks`):
      // Do NOT unconditionally mark `auto` mode scripts allowed.
      // - `bypassPermissions` or already-classified `autoModeClassified` -> allowed
      // - `auto` with `autoModeScriptCheckDeferred` -> queued as `unchecked`
      //   with deferred classifier check & stop chain
      // - unclassified `auto` script -> mark unclassifiedCodeRan & drop unchecked
      const autoModeClassified =
        (context as { autoModeClassified?: boolean }).autoModeClassified ===
        true
      const autoModeScriptCheckDeferred =
        (context as { autoModeScriptCheckDeferred?: boolean })
          .autoModeScriptCheckDeferred === true

      codeModeAutoVerdictTracker.registerScript(scriptId)
      if (currentPermissionMode === 'bypassPermissions') {
        codeModeAutoVerdictTracker.markAllowed(scriptId)
      } else if (currentPermissionMode === 'auto') {
        if (autoModeClassified) {
          codeModeAutoVerdictTracker.markAllowed(scriptId)
        } else if (
          autoModeScriptCheckDeferred &&
          !codeModeAutoVerdictTracker.hasUnclassifiedCodeRan()
        ) {
          codeModeAutoVerdictTracker.addDeferredCheck({
            id: scriptId,
            code: input.code,
            toolUseId: scriptId,
            runCheck: async (combinedCode, checkCtx, checkCanUseTool) =>
              checkCanUseTool(
                wrappedTool,
                { ...input, code: combinedCode },
                {
                  ...checkCtx,
                  replScriptCheckNow: true,
                } as ToolUseContext,
                parentMessage,
                scriptId,
              ),
            stop: (reason, batchSize, cause) => {
              scriptAutoBlockedReason = formatAutoModeScriptBlockedMessage(
                reason,
                batchSize,
                cause,
              )
              if (!scriptAbortController.signal.aborted) {
                scriptAbortController.abort(new Error(scriptAutoBlockedReason))
              }
            },
          })
        } else {
          codeModeAutoVerdictTracker.markUnclassifiedCodeRan()
          codeModeAutoVerdictTracker.dropUnchecked()
        }
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
      const collectedToolNewMessages: NonNullable<
        ToolResult<unknown>['newMessages']
      > = []
      const seenToolNewMessageKeys = new Set<string>()
      const collectedContextModifiers: Array<
        NonNullable<ToolResult<unknown>['contextModifier']>
      > = []
      const collectedContextLayers: NonNullable<
        ToolResult<unknown>['contextLayers']
      > = []
      const collectedMedia: REPLMediaBlock[] = []

      const extractTextFromSkillMessages = (
        msgs: NonNullable<ToolResult<unknown>['newMessages']>,
      ): string => {
        const chunks: string[] = []
        for (const m of msgs) {
          if (m.type !== 'user' || !('message' in m) || !m.message) continue
          const content = m.message.content
          if (typeof content === 'string') {
            const trimmed = content.trim()
            if (trimmed.length > 0) chunks.push(trimmed)
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block &&
                typeof block === 'object' &&
                (block as { type?: unknown }).type === 'text' &&
                typeof (block as { text?: unknown }).text === 'string'
              ) {
                const trimmed = (block as { text: string }).text.trim()
                if (trimmed.length > 0) chunks.push(trimmed)
              }
            }
          }
        }
        return chunks.join('\n\n')
      }
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

      const runScript = (
        overrideSignal: AbortSignal,
        assignedEvalId?: number,
      ): Promise<CodeModeExecutionResult> =>
        executeCodeModeScript({
          code: input.code,
          timeoutMs: input.timeout,
          signal: overrideSignal,
          sessionKey: unsetKey,
          evalId: assignedEvalId,
          allowedTools: allowedToolNames,
          availableToolNames: initialTools.map(t => t.name),
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
                    activeScriptContext.readFileState?.get(resolvedPath) ??
                    activeScriptContext.readFileState?.get(filePath)
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
          invokeTool: async (toolName, rawInput, execSignal) => {
            if (scriptAutoBlockedReason !== undefined) {
              throw new Error(scriptAutoBlockedReason)
            }
            if (execSignal?.aborted || scriptAbortController.signal.aborted) {
              throw new Error(
                scriptAutoBlockedReason ?? 'Code Mode script aborted',
              )
            }
            if (scriptHookHalted) {
              throw new Error(CODE_MODE_HOOK_HALT_REFUSAL)
            }
            // Official 2.1.328 (#572 & #581): re-resolve live MCP tools on main
            // thread while continuing to enforce restricted/subagent tool pools.
            const allTools = resolveCodeModeEffectiveTools(
              baseReplTool.name,
              resolveAvailableTools,
              activeScriptContext,
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
            const parsed = safeParseWithCircularTransformGuard(
              target.inputSchema,
              normalizedInput,
            )
            if (!parsed.success) {
              throw new Error(
                `Invalid input for ${toolName}: ${parsed.error?.message ?? 'validation failed'}`,
              )
            }
            // Official 2.1.326 #232: run tool.validateInput before canUseTool,
            // check prefixed shell commands for dangerousRemoval circuit breakers,
            // and suspend sandbox auto-allow on inner Code Mode calls so more
            // sandboxed commands go through normal permission checks / ask / refuse.
            if (typeof target.validateInput === 'function') {
              const validation = await target.validateInput(
                parsed.data as never,
                activeScriptContext,
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
                activeScriptContext,
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
              typeof activeScriptContext.getAppState === 'function'
                ? () => {
                    const st = activeScriptContext.getAppState()
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

            // Wire per-call AbortController so script timeout / auto-mode stop
            // aborts in-flight inner tools immediately.
            const innerCallAbortController = new AbortController()
            let onExecAbort: (() => void) | undefined
            if (execSignal?.aborted || scriptAbortController.signal.aborted) {
              innerCallAbortController.abort(
                execSignal?.reason ?? scriptAbortController.signal.reason,
              )
            } else {
              onExecAbort = () =>
                innerCallAbortController.abort(
                  execSignal?.reason ?? scriptAbortController.signal.reason,
                )
              execSignal?.addEventListener('abort', onExecAbort, { once: true })
              scriptAbortController.signal.addEventListener(
                'abort',
                onExecAbort,
                { once: true },
              )
            }

            const innerHookContext: ToolUseContext = {
              ...activeScriptContext,
              abortController: innerCallAbortController,
              toolUseId: innerToolUseId,
              options:
                activeScriptContext.options ??
                ({} as ToolUseContext['options']),
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
                  const parsedUpdated = safeParseWithCircularTransformGuard(
                    target.inputSchema,
                    item.updatedInput,
                  )
                  const remainingIssues = parsedUpdated.success
                    ? []
                    : (parsedUpdated.error?.issues ?? []).filter(
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

            // Official 2.1.328 (`J.scriptChecks.awaitVerdict`): if this script
            // or any queued script in the batch has a deferred auto-mode check,
            // run it before executing the inner tool and fire the stop chain if blocked.
            const scriptRecord = codeModeAutoVerdictTracker.getRecord(scriptId)
            if (
              scriptRecord?.state === 'unchecked' ||
              codeModeAutoVerdictTracker.hasUnchecked()
            ) {
              const deferredVerdict =
                await codeModeAutoVerdictTracker.awaitVerdict(
                  scriptId,
                  innerHookContext,
                  canUseTool,
                )
              if (deferredVerdict.kind === 'blocked') {
                const blockedMsg =
                  scriptAutoBlockedReason ??
                  (deferredVerdict.decision.behavior === 'deny'
                    ? deferredVerdict.decision.message
                    : undefined) ??
                  `Permission denied for ${toolName}`
                throw new Error(blockedMsg)
              }
            }
            if (scriptAutoBlockedReason !== undefined) {
              throw new Error(scriptAutoBlockedReason)
            }

            const ridesAutoVerdict =
              codeModeAutoVerdictTracker.ridesNow(scriptId)
            const currentScriptState =
              codeModeAutoVerdictTracker.getRecord(scriptId)?.state
            const suspendLayer: HostPermissionLayer = {
              kind: 'sandbox_auto_allow_suspended',
              allowOnly: true,
            }
            const innerPermissionContext: ToolUseContext = {
              ...innerHookContext,
              ...(ridesAutoVerdict ? { replScriptInner: true } : {}),
              ...(currentScriptState === 'atLimit'
                ? { replScriptAtLimit: true }
                : {}),
              permissionLayers: [
                ...(activeScriptContext.permissionLayers ?? []),
                suspendLayer,
              ],
            }
            const innerRemoteRunnerAtStart = getRemoteNativeToolRunner(
              innerPermissionContext.session,
              target.name,
            )
            const innerRemotePermCheckedFor =
              getRemoteNativeToolCheck(
                innerPermissionContext.session,
                target.name,
              ) !== undefined
                ? innerRemoteRunnerAtStart
                : innerRemoteRunnerAtStart === undefined
                  ? null
                  : undefined
            const innerRemoteRunnerCheckedHere =
              innerRemotePermCheckedFor !== undefined &&
              innerRemotePermCheckedFor !== null
                ? undefined
                : innerRemoteRunnerAtStart
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
                  permission,
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
            const innerLocalCheckDeferred =
              consumeRemoteNativeToolLocallyChecked(
                innerHookContext.session,
                innerToolUseId,
              )
            let out: ToolResult<unknown>
            try {
              out = (await target.call(
                finalInput as never,
                innerHookContext,
                canUseTool,
                parentMessage,
                undefined,
                {
                  userModified: permission.userModified ?? false,
                  permissionCheckedFor: innerLocalCheckDeferred
                    ? undefined
                    : innerRemotePermCheckedFor,
                  runnerCheckedHere: innerLocalCheckDeferred
                    ? innerRemoteRunnerAtStart
                    : innerRemoteRunnerCheckedHere,
                },
              )) as ToolResult<unknown>
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
            } finally {
              if (onExecAbort !== undefined) {
                execSignal?.removeEventListener('abort', onExecAbort)
                scriptAbortController.signal.removeEventListener(
                  'abort',
                  onExecAbort,
                )
              }
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
            // Official 2.1.328 (@325563762): forward inner Skill (and any inner
            // tool's) `newMessages`, `contextModifier`, and `contextLayers` to
            // the outer REPLTool result and apply modifiers immediately for
            // subsequent calls within the same script.
            if (Array.isArray(out.newMessages) && out.newMessages.length > 0) {
              for (const m of out.newMessages) {
                let dedupeKey: string
                try {
                  dedupeKey = JSON.stringify(
                    (m.type === 'user' || m.type === 'assistant') &&
                      'message' in m
                      ? [m.type, m.message?.content]
                      : m,
                  )
                } catch {
                  dedupeKey = String(collectedToolNewMessages.length)
                }
                if (seenToolNewMessageKeys.has(dedupeKey)) continue
                seenToolNewMessageKeys.add(dedupeKey)
                collectedToolNewMessages.push(m)
              }
            }
            if (typeof out.contextModifier === 'function') {
              collectedContextModifiers.push(out.contextModifier)
              activeScriptContext = out.contextModifier(activeScriptContext)
            }
            if (
              Array.isArray(out.contextLayers) &&
              out.contextLayers.length > 0
            ) {
              collectedContextLayers.push(...out.contextLayers)
              activeScriptContext = {
                ...activeScriptContext,
                permissionLayers: [
                  ...(activeScriptContext.permissionLayers ?? []),
                  ...out.contextLayers,
                ],
              }
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
            if (
              toolName === 'Skill' &&
              Array.isArray(out.newMessages) &&
              out.newMessages.length > 0 &&
              out.data &&
              typeof out.data === 'object' &&
              !Array.isArray(out.data)
            ) {
              const rec = out.data as Record<string, unknown>
              if (
                rec.body === undefined &&
                rec.content === undefined &&
                rec.prompt === undefined
              ) {
                const body = extractTextFromSkillMessages(out.newMessages)
                if (body.length > 0) {
                  return { ...rec, body }
                }
              }
            }
            const mediaBlocks = extractMediaBlocksFromToolData(out.data)
            if (mediaBlocks.length > 0) {
              collectedMedia.push(...mediaBlocks)
            }
            return out.data
          },
        })

      const optInAsync = optInModule as {
        isAsyncReplEnabled?: () => boolean
        isAsyncLaneMode?: (mode?: string) => boolean
      }
      const isAsyncReplActive =
        optInAsync.isAsyncReplEnabled?.() === true &&
        optInAsync.isAsyncLaneMode?.(currentPermissionMode) === true

      let execution: CodeModeExecutionResult
      if (isAsyncReplActive) {
        const sessions = getReplSessions()
        if (sessions.depth(unsetKey) >= ASYNC_REPL_MAX_EVALS) {
          codeModeAutoVerdictTracker.endScript(scriptId)
          if (onParentAbort !== undefined) {
            parentSignal.removeEventListener('abort', onParentAbort)
          }
          return {
            data: {
              result: `Error: async REPL dispatch rejected: ${sessions.depth(unsetKey)} evals already waiting or running on this context — wait for their settles (Poll) before dispatching more`,
              tool_calls: 0,
              asyncDispatched: true,
            },
          }
        }

        const evalStartMs = Date.now()
        let returnedReceipt = false
        let settledExecution: CodeModeExecutionResult | undefined
        let resolveSettled: ((res: CodeModeExecutionResult) => void) | undefined
        const settledPromise = new Promise<CodeModeExecutionResult>(resolve => {
          resolveSettled = resolve
        })

        let dispatchedEvalId = 0
        const handle = sessions.dispatch(
          unsetKey,
          async controller => {
            try {
              const res = await runScript(controller.signal, dispatchedEvalId)
              settledExecution = res
              return res.result
            } finally {
              codeModeAutoVerdictTracker.endScript(scriptId)
              if (onParentAbort !== undefined) {
                parentSignal.removeEventListener('abort', onParentAbort)
              }
            }
          },
          {
            description: input.description,
            toolUseId: context.toolUseId,
            signal: scriptAbortController.signal,
            detachAfterMs: REPL_DETACH_AFTER_MS,
            deliver: async (evalId, output, isError, retired) => {
              const elapsedMs = Date.now() - evalStartMs
              const finalExec: CodeModeExecutionResult = settledExecution
                ? { ...settledExecution, evalId, ms: elapsedMs }
                : {
                    result: output,
                    tool_calls: 0,
                    evalId,
                    ms: elapsedMs,
                  }
              if (!returnedReceipt) {
                resolveSettled?.(finalExec)
                return
              }
              if (retired) return
              try {
                const mqm = (await import(
                  '../../utils/messageQueueManager.js'
                )) as {
                  enqueueReplEvalPollEvent?: (opts: {
                    evalId: number
                    content: string
                    isError?: boolean
                    ms?: number
                    agentId?: string
                    toolUseId?: string
                    startsTurn?: boolean
                    wake?: boolean
                    media?: unknown[]
                  }) => void
                }
                mqm.enqueueReplEvalPollEvent?.({
                  evalId,
                  content: output,
                  isError,
                  ms: elapsedMs,
                  agentId: context.agentId,
                  toolUseId: context.toolUseId,
                  startsTurn: true,
                  wake: true,
                  media:
                    collectedMedia.length > 0 ? [...collectedMedia] : undefined,
                })
              } catch {
                // Best-effort outside full message queue lifecycle.
              }
            },
          },
          input.code,
        )
        dispatchedEvalId = handle.evalId

        const rawSettleWindowMs = (
          input as unknown as { settleWindowMs?: unknown }
        ).settleWindowMs
        const settleWindowMs =
          typeof rawSettleWindowMs === 'number'
            ? Math.max(0, rawSettleWindowMs)
            : REPL_SETTLE_WINDOW_MS

        let windowTimer: ReturnType<typeof setTimeout> | undefined
        const raced = await Promise.race<
          | { kind: 'settled'; execution: CodeModeExecutionResult }
          | { kind: 'dispatched' }
        >([
          settledPromise.then(execRes => ({
            kind: 'settled' as const,
            execution: execRes,
          })),
          new Promise<{ kind: 'dispatched' }>(resolve => {
            windowTimer = setTimeout(
              () => resolve({ kind: 'dispatched' }),
              settleWindowMs,
            )
            windowTimer.unref?.()
          }),
        ])
        if (windowTimer !== undefined) clearTimeout(windowTimer)

        if (raced.kind === 'dispatched') {
          returnedReceipt = true
          sessions.callReturned(unsetKey, handle.evalId)
          return {
            data: {
              result: `(dispatched #${handle.evalId})`,
              tool_calls: 0,
              evalId: handle.evalId,
              asyncDispatched: true,
            },
          }
        }
        const settledResult = raced.execution
        const isSettledError = settledResult.result.startsWith('Error:')
        execution = {
          ...settledResult,
          result: formatReplOutputEnvelope({
            evalId: settledResult.evalId ?? handle.evalId,
            ms: settledResult.ms ?? Math.max(0, Date.now() - evalStartMs),
            result: isSettledError
              ? settledResult.result.replace(/^Error:\s*/, '')
              : settledResult.result,
            isError: isSettledError,
          }),
        }
      } else {
        try {
          execution = await runScript(scriptAbortController.signal)
        } finally {
          codeModeAutoVerdictTracker.endScript(scriptId)
          if (onParentAbort !== undefined) {
            parentSignal.removeEventListener('abort', onParentAbort)
          }
        }
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
        ...(collectedMedia.length > 0 ? { media: collectedMedia } : {}),
      }

      const allNewMessages = [
        ...collectedHookMessages,
        ...collectedToolNewMessages,
      ]
      const composedContextModifier =
        collectedContextModifiers.length > 0
          ? (ctx: ToolUseContext) =>
              collectedContextModifiers.reduce((acc, mod) => mod(acc), ctx)
          : undefined

      return {
        data: resultData,
        ...(allNewMessages.length > 0 ? { newMessages: allNewMessages } : {}),
        ...(composedContextModifier
          ? { contextModifier: composedContextModifier }
          : {}),
        ...(collectedContextLayers.length > 0
          ? { contextLayers: collectedContextLayers }
          : {}),
      }
    },
    create(deps) {
      return {
        call(args, callCtx) {
          const ctx = resolveToolUseContext(deps, callCtx)
          return wrappedTool.call(
            args,
            ctx,
            callCtx.canUseTool ?? createDefaultCanUseTool(),
            callCtx.parentMessage as Parameters<Tool['call']>[3],
            callCtx.onProgress,
          )
        },
        ...(wrappedTool.validateInput !== undefined
          ? {
              validateInput(input, callCtx) {
                return wrappedTool.validateInput!(
                  input,
                  resolveToolUseContext(deps, callCtx),
                )
              },
            }
          : {}),
        checkPermissions(input, callCtx) {
          return wrappedTool.checkPermissions(
            input,
            resolveToolUseContext(deps, callCtx),
          )
        },
      }
    },
  }
  return wrappedTool
}

export type CodeModeResumePlan = {
  pin?: boolean
  unpin?: boolean
  switched: boolean
  refused?: string
  refusedWhy?: string
  /** Official 2.1.328 (`C`): true when an sdkUrlWorker session is downgraded out of Code Mode. */
  declined?: boolean
  /** Official 2.1.328 (`C`/`M`): notice + reminder when taken out of Code Mode on sdkUrlWorker. */
  takenOut?: {
    notice: string
    reminder: string
  }
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

const NO_SUCH_TOOL_PREFIX = '<tool_use_error>Error: No such tool available: '
const REPL_UNAVAILABLE_PREFIX = 'Error: REPL tool is not available'
const REPL_TOOL_NAMES_FOR_INFERENCE = new Set(['REPL', 'Eval'])
const ORDINARY_PRIMITIVE_TOOLS_FOR_INFERENCE = new Set([
  'Bash',
  'PowerShell',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'NotebookEdit',
  'Agent',
  'WebFetch',
  'WebSearch',
])

function extractToolResultBlockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0]
    if (typeof first === 'string') return first
    if (
      first &&
      typeof first === 'object' &&
      (first as { type?: unknown }).type === 'text' &&
      typeof (first as { text?: unknown }).text === 'string'
    ) {
      return (first as { text: string }).text
    }
  }
  return ''
}

/**
 * Official 2.1.328 (`m` + `_` / `g` @328432100): infer whether a resumed
 * session was running in Code Mode (`replMode`) from historical tool calls in
 * its transcript when explicit `replMode` metadata is absent.
 *
 * Returns `true` when the last completed pool-identifying tool call was a
 * successful `REPL` / `Eval` call, `false` when it was an ordinary primitive
 * tool call that was in the active pool, or `undefined` when inconclusive.
 */
export function inferReplModeFromMessages(
  messages: readonly ResumedTranscriptMessageLike[] | undefined,
): boolean | undefined {
  if (!messages || messages.length === 0) return undefined
  try {
    const replResult = new Set<string>()
    const inPool = new Set<string>()
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object' || msg.type !== 'user') continue
      const content = msg.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (
          !block ||
          typeof block !== 'object' ||
          (block as { type?: unknown }).type !== 'tool_result'
        ) {
          continue
        }
        const rec = block as {
          tool_use_id?: unknown
          is_error?: unknown
          content?: unknown
        }
        if (typeof rec.tool_use_id !== 'string') continue
        const text = extractToolResultBlockText(rec.content)
        if (rec.is_error !== true) {
          if (
            !text.startsWith(NO_SUCH_TOOL_PREFIX) &&
            !text.startsWith(REPL_UNAVAILABLE_PREFIX)
          ) {
            replResult.add(rec.tool_use_id)
          }
          inPool.add(rec.tool_use_id)
          continue
        }
        if (
          !text.startsWith(NO_SUCH_TOOL_PREFIX) &&
          !text.startsWith(REPL_UNAVAILABLE_PREFIX)
        ) {
          inPool.add(rec.tool_use_id)
        }
      }
    }

    let inferred: boolean | undefined
    for (const msg of messages) {
      if (
        !msg ||
        typeof msg !== 'object' ||
        msg.type !== 'assistant' ||
        (msg as { isVirtual?: unknown }).isVirtual === true
      ) {
        continue
      }
      const content = msg.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (
          !block ||
          typeof block !== 'object' ||
          (block as { type?: unknown }).type !== 'tool_use'
        ) {
          continue
        }
        const rec = block as { name?: unknown; id?: unknown }
        if (typeof rec.name !== 'string' || typeof rec.id !== 'string') continue
        if (
          REPL_TOOL_NAMES_FOR_INFERENCE.has(rec.name) &&
          replResult.has(rec.id)
        ) {
          inferred = true
        } else if (
          ORDINARY_PRIMITIVE_TOOLS_FOR_INFERENCE.has(rec.name) &&
          inPool.has(rec.id)
        ) {
          inferred = false
        }
      }
    }
    return inferred
  } catch {
    return undefined
  }
}

function isSandboxHostListsBlockingCodeMode(): boolean {
  const maybeFn = (
    optInModule as { sandboxHostListsBlockCodeMode?: () => boolean }
  ).sandboxHostListsBlockCodeMode
  return typeof maybeFn === 'function' ? maybeFn() === true : false
}

function buildCodeModeTakenOutReminder(header: string): string {
  return [
    header,
    'Do not call REPL or Eval. They may still be in your tool list, but every call to them is refused. Disregard their descriptions, including the statement that you have no other tools.',
    'Use your other tools instead.',
    'The variables and functions that your earlier scripts defined are gone.',
    `If this conversation later continues in a session that gives you no tools other than REPL and Eval, ${CODE_MODE_NAME} is on there: disregard this reminder.`,
  ].join('\n- ')
}

/**
 * Official `planCodeModeFromSession` (`chunk@328409226`): determines how to
 * reconcile the current Code Mode opt-in state with a resumed session's
 * `replMode` flag (falling back to inferring `replMode` from historical
 * `REPL` tool calls when explicit metadata is absent), handles `sdkUrlWorker`
 * degradation, and whether to wait for the user's next prompt (#2316).
 */
export function planCodeModeFromSession(
  session: {
    replMode?: boolean
    sessionId?: string
    source?: string
    headless?: boolean
    withinSession?: boolean
    sdkUrlWorker?: boolean
    permissionMode?: string
    fromPicker?: boolean
    messages?: readonly ResumedTranscriptMessageLike[]
  },
  onNotice?: (message: string) => void,
): CodeModeResumePlan {
  const canRun = codeModeBeforePin() && !isSandboxHostListsBlockingCodeMode()
  const resolvedReplMode =
    session.replMode ?? inferReplModeFromMessages(session.messages) ?? false
  const isResumedCodeMode = resolvedReplMode === true
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

  if (!canRun && session.sdkUrlWorker !== true) {
    if (!isResumedCodeMode) {
      return { pin: undefined, switched: false }
    }
    const optIn = getCodeModeOptInState()
    const base = `This session was started in ${CODE_MODE_EXPERIMENTAL_NAME}`
    const resumeId =
      session.source === 'store' || session.source === undefined
        ? session.sessionId
        : undefined
    const resumeArg = resumeId ? `--resume ${resumeId}` : undefined
    const exitPrefix = session.withinSession === true ? 'exit and ' : ''
    const envName = CODE_MODE_ENV_VAR

    if (optIn.state === 'refused') {
      const reason = codeModeRefusalReasonText(optIn.why)
      const tail =
        resumeArg === undefined
          ? ''
          : optIn.why === 'declined'
            ? ` To resume it, ${exitPrefix}${formatCodeModeCommand(1, resumeArg, 'step')} and choose Yes.`
            : ''
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which ${reason}, so it can't be resumed.${tail}`,
        refusedWhy: `opt_in_refused_${optIn.why}`,
      }
    }
    if (optIn.state === 'on') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which can't be turned on again until you quit Claude Code, so it can't be resumed here. To resume it, quit and ${resumeArg === undefined ? `start Claude Code again with ${envName}=1 set` : formatCodeModeCommand(1, resumeArg, 'step')}.`,
        refusedWhy: 'opt_in_on_but_mode_unavailable',
      }
    }
    if (optIn.turnedOffIn === 'managed') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which your organization's settings don't allow, so it can't be resumed.`,
        refusedWhy: 'opt_in_off_managed',
      }
    }
    if (optIn.turnedOffIn === 'settings') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which ${envName} in your settings turns off, so it can't be resumed. To resume it, remove that value (from ~/.claude/settings.json, ~/.claude.json or the file given to --settings) and set the variable to 1 in your shell or in ~/.claude/settings.json.`,
        refusedWhy: 'opt_in_off_settings',
      }
    }
    const howToResume =
      resumeArg === undefined
        ? `To resume it, ${exitPrefix}start Claude Code with ${envName}=1 set.`
        : `To resume it, ${exitPrefix}${formatCodeModeCommand(1, resumeArg, 'step')}.`
    if (optIn.turnedOffIn === 'shell') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, but ${envName} in your shell turns ${CODE_MODE_NAME} off, so it can't be resumed.\n${howToResume}`,
        refusedWhy: 'opt_in_off_shell',
      }
    }
    if (session.headless === true) {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which ${codeModeRefusalReasonText('entrypoint')}, so it can't be resumed here.${resumeArg === undefined ? '' : ` Resume it in the terminal: ${formatCodeModeCommand(1, resumeArg)}`}`,
        refusedWhy: 'not_asked_headless',
      }
    }
    if (session.source !== undefined && session.source !== 'store') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which is off, so it can't be resumed.\n${howToResume}`,
        refusedWhy: 'not_from_store',
      }
    }
    return {
      pin: undefined,
      switched: false,
      refused: `${base}, which is off, so it can't be resumed.\n${howToResume}`,
      refusedWhy: 'not_asked',
    }
  }

  const currentlyOn = isCodeModeEnabled()
  if (!isResumedCodeMode) {
    if (!canRun) {
      return { pin: undefined, switched: false }
    }
    onNotice?.(
      `${CODE_MODE_NAME} is on, but this session isn't using it, so it continues with the ordinary tools. New sessions use ${CODE_MODE_NAME}.`,
    )
    return currentlyOn
      ? { pin: false, switched: true }
      : { pin: undefined, switched: false }
  }
  if (!canRun) {
    const notice = `This session was started in ${CODE_MODE_EXPERIMENTAL_NAME}, which isn't available where it runs now. It continues with the ordinary tools and stays out of ${CODE_MODE_NAME} from now on.`
    onNotice?.(notice)
    return {
      pin: undefined,
      switched: false,
      declined: true,
      takenOut: {
        notice,
        reminder: buildCodeModeTakenOutReminder(
          `${CODE_MODE_NAME} is off in this session.`,
        ),
      },
    }
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
 * Official `applyCodeModePlan`: pins or unpins Code Mode for a resumed session
 * and persists the resulting `replMode` state to session storage.
 */
export function applyCodeModePlan(plan: CodeModeResumePlan): void {
  if (plan.unpin) {
    unpinCodeMode()
  } else if (plan.pin !== undefined) {
    pinCodeMode(plan.pin)
  }
  try {
    saveReplMode(isCodeModeEnabled())
  } catch {
    // Best-effort outside full session storage lifecycle
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
