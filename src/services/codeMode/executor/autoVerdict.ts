/**
 * Auto-mode per-script verdict tracking, deferred script classification,
 * pausable script timers, and Code Mode script policy/refusal helpers.
 */
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../../Tool.js'
import type { PermissionResult } from '../../../utils/permissions/PermissionResult.js'
import { REPL_POST_SCRIPT_PAUSE_AUTO_MS } from '../constants.js'
import { isCodeModeEnabled } from '../optIn.js'
import type {
  AutoScriptAwaitVerdictResult,
  AutoScriptRecord,
  AutoScriptVerdictState,
  CodeModeScriptSideEffects,
  DeferredAutoScriptCheckEntry,
  PausableCodeModeTimer,
} from './types.js'

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
