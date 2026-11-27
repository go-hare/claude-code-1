/**
 * Headless print output formatting, wire serialization, TTY sanitization, and notice writers.
 */
import {
  getRemoteSystemPromptGbFeatureKey,
  resolveSystemPromptWithRemoteGb,
} from 'src/utils/residualMoreEnvGates.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { normalizeInformationalContent } from 'src/QueryEngine.js'
import {
  RetractedWireUuidTracker,
  buildRetractedWireFields,
} from 'src/query/queryHelpers.js'
import chalk from 'chalk'
import { writeToStdout } from 'src/utils/process.js'
import { logError } from 'src/utils/log.js'
import { toError } from '../../utils/errors.js'
import { logEvent } from 'src/services/analytics/index.js'

/**
 * Official densable — when CLAUDE_CODE_REMOTE + SYSTEM_PROMPT_GB_FEATURE, prefer
 * the GrowthBook string override for the print/SDK system prompt.
 */
export function resolvePrintSystemPrompt(
  base: string | undefined,
): string | undefined {
  const key = getRemoteSystemPromptGbFeatureKey()
  if (!key) return base
  const gbValue = getFeatureValue_CACHED_MAY_BE_STALE(key, '')
  return resolveSystemPromptWithRemoteGb({ base, gbValue })
}

/** densable PD — system subtypes and message types that must not pin lastMessage. */
const HEADLESS_LAST_MESSAGE_SKIP_TYPES: ReadonlySet<string> = new Set([
  'control_response',
  'control_request',
  'control_cancel_request',
  'command_lifecycle',
  'conversation_reset',
  'active_goal',
  'autocompact_state',
  'stream_event',
  'keep_alive',
  'tool_progress',
  'transcript_mirror',
  'streamlined_text',
  'streamlined_tool_use_summary',
  'prompt_suggestion',
])

const HEADLESS_LAST_MESSAGE_SKIP_SYSTEM_SUBTYPES: ReadonlySet<string> = new Set(
  [
    'session_state_changed',
    'permission_denied',
    'task_notification',
    'task_started',
    'task_updated',
    'task_progress',
    'background_tasks_changed',
    'feedback_draft_queued',
    'control_request_progress',
    'notification',
    'post_turn_summary',
    'task_summary',
    'session_metadata',
    'hook_started',
    'hook_progress',
    'hook_response',
    'commands_changed',
    'elicitation_complete',
    'files_persisted',
    'mirror_error',
    'code_change_published',
    'tool_host_result',
    'peer_message_hold',
    'ui_invalidate',
    'ui_log',
    'ui_toast',
    'ui_status',
    'ui_panes',
    'ui_scroll',
    'ui_focus',
    'vcs_state_changed',
    'dev_intent',
    'session_title_changed',
    'turn_preempted',
    'per_turn_effort_changed',
    'instruction_size_warning',
    'api_retry',
    'file_attachments_missing',
  ],
)

/** densable `Y0 = _u = 5000` — delay before printing background wait notice */
export const PRINT_WAIT_NOTICE_DELAY_MS = 5000

/** densable `WP` — write wait notice on stderr when stderr is a TTY (unless json/stream-json also on TTY stdout) */
export function shouldWriteWaitNoticeOnStderr(opts: {
  outputFormat?: string
  stderrIsTerminal: boolean
  stdoutIsTerminal: boolean
}): boolean {
  return (
    opts.stderrIsTerminal &&
    !(
      (opts.outputFormat === 'json' || opts.outputFormat === 'stream-json') &&
      opts.stdoutIsTerminal
    )
  )
}

function truncateWaitDesc(desc: string | undefined, maxLen = 60): string {
  if (!desc) return ''
  return desc.length <= maxLen ? desc : `${desc.slice(0, maxLen - 1)}…`
}

function formatWaitTaskType(task: { type: string; kind?: string }): string {
  if (task.type === 'local_bash' && task.kind === 'monitor') return 'monitor'
  switch (task.type) {
    case 'local_bash':
      return 'bash'
    case 'local_agent':
      return 'agent'
    case 'remote_agent':
      return 'remote agent'
    case 'local_workflow':
      return 'workflow'
    case 'monitor_mcp':
    case 'monitor_ws':
      return 'monitor'
    default:
      return task.type
  }
}

/** densable `BP` + `announceLongWait` message builder */
export function formatPrintWaitNotice(
  tasks: ReadonlyArray<{ type: string; kind?: string; description?: string }>,
  hasScheduledWakeup: boolean,
): string {
  const taskSummary = tasks
    .map(t => {
      const label = formatWaitTaskType(t)
      const desc = truncateWaitDesc(t.description, 60)
      return desc ? `${label} "${desc}"` : label
    })
    .join(', ')
  const waitingFor = [taskSummary, hasScheduledWakeup ? 'scheduled wakeup' : '']
    .filter(Boolean)
    .join(', ')
  return `Waiting for background work to finish${waitingFor ? ` (${waitingFor})` : ''}. Press Ctrl+C to exit now.`
}

/** densable `XA` — clear queued_turn_count when worker is stopping */
export function finalizeHeldBackResultForShutdown<
  T extends { type?: string; queued_turn_count?: number },
>(result: T, stopping: boolean): T {
  if (
    !stopping ||
    result.type !== 'result' ||
    result.queued_turn_count === undefined ||
    result.queued_turn_count === 0
  ) {
    return result
  }
  return { ...result, queued_turn_count: 0 }
}

/** densable `RP` — flush held results on non-shutdown abort */
export function shouldFlushHeldBackResultOnAbort(opts: {
  aborted: boolean
  shuttingDown: boolean
  abortedForShutdown: boolean
  teardownRequested: boolean
  heldResultCount: number
}): boolean {
  return (
    opts.aborted &&
    !opts.shuttingDown &&
    !opts.abortedForShutdown &&
    !opts.teardownRequested &&
    opts.heldResultCount > 0
  )
}

export type PrintTextResultMessage = {
  type: 'result'
  subtype: string
  result?: unknown
  errors?: unknown[]
  terminal_reason?: unknown
}

function isBlankTextResult(
  msg: PrintTextResultMessage,
  extra?: string,
): boolean {
  return (
    msg.subtype === 'success' &&
    extra === undefined &&
    typeof msg.result === 'string' &&
    msg.result.trim() === ''
  )
}

// ---------------------------------------------------------------------------
// Wave 319-321 print/headless production helpers:
//   #1724 auto_mode no-check exit 1
//   #1734 informational SDK content normalization
//   #1735 & #1912 full-disk stderr warning + stream-json session_writes_lost
//   #1774 cloud session hidden command filter
//   #1918 sendsLeftToReRun subagent recovery tracker
//   #1927 CLAUDE_JOB_DIR/exit-detail on fatal startup exit
//   #1947 AskUserQuestion afkTimeoutMs host denial
//   #1959 set_cwd remote_origin rejection
// ---------------------------------------------------------------------------

/** #1724: Classifier refusal codes that must cause exitCode = 1 in text and JSON. */
export const AUTO_MODE_NO_CHECK_EXIT_CODES = new Set([
  'auto_mode_no_check_in_session',
  'auto_mode_stop_no_check_in_session',
  'auto_mode_stop_no_result_for_calls',
  'auto_mode_stop_no_verdict',
])

export function hasAutoModeNoCheckDenial(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false
  const m = message as {
    type?: unknown
    permission_denials?: unknown
    decision_reason_code?: unknown
  }
  if (
    typeof m.decision_reason_code === 'string' &&
    AUTO_MODE_NO_CHECK_EXIT_CODES.has(m.decision_reason_code)
  ) {
    return true
  }
  if (!Array.isArray(m.permission_denials)) return false
  for (const denial of m.permission_denials) {
    if (!denial || typeof denial !== 'object') continue
    const d = denial as {
      decision_reason_code?: unknown
      decisionReason?: { hostCode?: unknown; reason?: unknown }
      reason?: unknown
    }
    if (
      typeof d.decision_reason_code === 'string' &&
      (AUTO_MODE_NO_CHECK_EXIT_CODES.has(d.decision_reason_code) ||
        d.decision_reason_code.startsWith('auto_mode_stop_'))
    ) {
      return true
    }
    if (
      typeof d.decisionReason?.hostCode === 'string' &&
      (AUTO_MODE_NO_CHECK_EXIT_CODES.has(d.decisionReason.hostCode) ||
        d.decisionReason.hostCode.startsWith('auto_mode_stop_'))
    ) {
      return true
    }
    if (
      typeof d.reason === 'string' &&
      (AUTO_MODE_NO_CHECK_EXIT_CODES.has(d.reason) ||
        d.reason.startsWith('auto_mode_stop_'))
    ) {
      return true
    }
  }
  return false
}

/** #1734: Ensure SDK informational messages always preserve `content` text. */
export function normalizeInformationalSdkMessage<
  T extends Record<string, unknown>,
>(message: T): T {
  if (
    message.type === 'system' &&
    message.subtype === 'informational' &&
    typeof message.content !== 'string'
  ) {
    return {
      ...message,
      content: normalizeInformationalContent(message.content),
    }
  }
  return message
}

/**
 * Official 2.1.328 #1492 (`chunk@294254613.js @3717400`, `chunk@283886268.js @9666`):
 * When an emitted SDK `result` frame carries an auto-mode no-check/no-verdict
 * denial code (`auto_mode_stop_no_verdict`, `auto_mode_no_check_in_session`,
 * `auto_mode_stop_no_check_in_session`, `auto_mode_stop_no_result_for_calls`),
 * mark the result frame as failed (`is_error: true`, `subtype: 'error_during_execution'`)
 * so cloud/headless callers never treat an unchecked stop as a successful turn.
 */
export function enforceAutoModeNoCheckResultFailure<
  T extends Record<string, unknown>,
>(message: T): T {
  if (message.type !== 'result' || !hasAutoModeNoCheckDenial(message)) {
    return message
  }
  if (
    message.subtype === 'error_during_execution' &&
    message.is_error === true
  ) {
    return message
  }
  const existingErrors = Array.isArray(message.errors)
    ? message.errors
    : undefined
  return {
    ...message,
    subtype: 'error_during_execution',
    is_error: true,
    errors:
      existingErrors && existingErrors.length > 0
        ? existingErrors
        : [
            'Auto mode unavailable \u2014 stopped after repeated responses with no safety verdict',
          ],
  }
}

/**
 * Official 2.1.328 P1-#44 (`chunk@285257860.js @331561`, `chunk@303112704.js @51145`):
 * Wire-serialize outgoing print/SDK messages with normalized informational
 * content, `retracted_message_uuids` via `buildRetractedWireFields`, and
 * `supersedes` via `RetractedWireUuidTracker`.
 */
export function serializePrintWireMessage<T extends Record<string, unknown>>(
  message: T,
  retractedTracker?: RetractedWireUuidTracker,
): T {
  let out: Record<string, unknown> = normalizeInformationalSdkMessage(message)
  if (out.type === 'result') {
    out = enforceAutoModeNoCheckResultFailure(out)
  }
  const rawRetracted = Array.isArray(out.retractedWireUuids)
    ? (out.retractedWireUuids as readonly string[])
    : Array.isArray(out.retractedMessageUuids)
      ? (out.retractedMessageUuids as readonly string[])
      : undefined
  const retractedFields =
    out.retracted_message_uuids === undefined
      ? buildRetractedWireFields({ retractedWireUuids: rawRetracted })
      : {}
  const wireRetracted =
    (out.retracted_message_uuids as readonly string[] | undefined) ??
    retractedFields.retracted_message_uuids
  if (wireRetracted && wireRetracted.length > 0 && retractedTracker) {
    retractedTracker.add(wireRetracted.map(uuid => ({ uuid })))
  }
  if (retractedFields.retracted_message_uuids) {
    out = { ...out, ...retractedFields }
  }
  if (
    out.type === 'assistant' &&
    out.parent_tool_use_id === null &&
    out.supersedes === undefined &&
    retractedTracker
  ) {
    const supersedes = retractedTracker.consumeForSupersedes()
    if (supersedes && supersedes.length > 0) {
      out = { ...out, supersedes }
    }
  }
  return out as T
}

/**
 * Official 2.1.325 #2283 (`_0t` + `QJo`):
 * When `claude -p` writes text output to a TTY, strip terminal control
 * sequences other than SGR text styling (`\x1b[...m` with `[0-9;:]` params)
 * and C0/C1 control characters (keeping `\t` and `\n`, normalizing `\r\n?` to
 * `\n`). Pipes and files are unchanged.
 */
const NON_SGR_TTY_CONTROL_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional terminal escape/control sequence filtering
  /(?!\x1b\[[0-9;:]*m)[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

export function sanitizePrintTextForTty(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(NON_SGR_TTY_CONTROL_RE, '')
}

/**
 * Official 2.1.326 #149 (`qWn`) — human-readable label for API retry status.
 */
export function formatApiRetryStatusLabel(status: number | undefined): string {
  switch (status) {
    case 429:
      return 'Rate limited'
    case 529:
      return 'API overloaded'
    case 401:
    case 403:
      return 'Authentication failed'
    default:
      return 'API error'
  }
}

function formatRetrySeconds(ms: number): string {
  const secs = Math.max(1, Math.ceil(ms / 1000))
  return `${secs}s`
}

/**
 * Official 2.1.326 #149 (`class uv`) — writes API retry progress lines to
 * stderr in `claude -p` when retrying an overloaded or failing request on a
 * terminal (after `PRINT_WAIT_NOTICE_DELAY_MS`, non-stream-json only).
 */
export class PrintRetryNoticeWriter {
  private readonly isShown: boolean
  private waitingSince: number
  private lastShownAttempt: number | undefined

  constructor(
    outputFormat?: string,
    private readonly deps: {
      writeStderr?: (text: string) => void
      now?: () => number
      stderrIsTerminal?: boolean
      stdoutIsTerminal?: boolean
      delayMs?: number
    } = {},
  ) {
    this.waitingSince = (deps.now ?? Date.now)()
    this.isShown =
      outputFormat !== 'stream-json' &&
      shouldWriteWaitNoticeOnStderr({
        outputFormat,
        stderrIsTerminal:
          deps.stderrIsTerminal ?? process.stderr.isTTY === true,
        stdoutIsTerminal:
          deps.stdoutIsTerminal ?? process.stdout.isTTY === true,
      })
  }

  observe(msg: {
    type?: string
    subtype?: string
    attempt?: number
    max_retries?: number
    retry_delay_ms?: number
    error_status?: number | null
    error?: string
    no_response?: { waited_ms: number; retry_wait_ms: number }
  }): void {
    const now = (this.deps.now ?? Date.now)()
    if (msg.type !== 'system' || msg.subtype !== 'api_retry') {
      this.waitingSince = now
      this.lastShownAttempt = undefined
      return
    }
    const retryDelayMs = msg.retry_delay_ms ?? 0
    const elapsedPlusDelay = now - this.waitingSince + retryDelayMs
    const threshold = this.deps.delayMs ?? PRINT_WAIT_NOTICE_DELAY_MS
    if (
      !this.isShown ||
      elapsedPlusDelay < threshold ||
      msg.attempt === undefined ||
      msg.attempt === this.lastShownAttempt
    ) {
      return
    }
    this.lastShownAttempt = msg.attempt
    const statusCode =
      msg.error === 'overloaded' ? 529 : (msg.error_status ?? undefined)
    const label = formatApiRetryStatusLabel(statusCode)
    const body = msg.no_response
      ? `No response from the API after ${formatRetrySeconds(msg.no_response.waited_ms)} \u00b7 retrying, waiting up to ${formatRetrySeconds(msg.no_response.retry_wait_ms)}`
      : `${label} \u00b7 retrying in ${formatRetrySeconds(retryDelayMs)}`
    const ofMax =
      msg.max_retries !== undefined && msg.attempt <= msg.max_retries
        ? ` of ${msg.max_retries}`
        : ''
    const write =
      this.deps.writeStderr ?? ((text: string) => process.stderr.write(text))
    write(`${chalk.dim(`${body} \u00b7 attempt ${msg.attempt}${ofMax}`)}\n`)
  }
}

/**
 * Official 2.1.328 (#659) `tengu_dreamy_reef` (default `true`):
 * In `claude -p` text output mode (neither `json` nor `stream-json`), write a
 * concise notice on stderr when a cross-session peer message is held or
 * dropped, explaining how to allow inbound peer messages.
 */
export class PrintPeerHoldNoticeWriter {
  constructor(
    private readonly outputFormat: string | undefined,
    private readonly deps: {
      writeStderr?: (text: string) => void
      isEnabled?: () => boolean
      settingsHint?: string
    } = {},
  ) {}

  observe(msg: {
    type?: string
    subtype?: string
    from?: string
    state?: string
    outcome?: string
    reason?: string
    cause?: string
  }): string | undefined {
    if (
      this.outputFormat === 'json' ||
      this.outputFormat === 'stream-json' ||
      msg.type !== 'system' ||
      msg.subtype !== 'peer_message_hold'
    ) {
      return undefined
    }
    const enabled =
      this.deps.isEnabled?.() ??
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_dreamy_reef', true)
    if (!enabled) return undefined

    const sender = msg.from ? ` from "${msg.from}"` : ''
    const state = msg.state ?? msg.outcome ?? 'held'
    const actionVerb =
      state === 'dropped' ||
      state === 'expired' ||
      state === 'denied' ||
      state === 'refused'
        ? `dropped (${state})`
        : 'held for approval'
    const allowHint =
      this.deps.settingsHint ??
      'run with --settings and a file that sets "crossSessionInbound" to "accept"'
    const text = `Cross-session message${sender} was ${actionVerb}. To allow incoming cross-session messages here, ${allowHint}.`
    const write =
      this.deps.writeStderr ?? ((s: string) => process.stderr.write(s))
    write(`${text}\n`)
    return text
  }
}

/**
 * densable `Sk` / Official 2.1.326 `class cv` — prints each turn's text result
 * immediately when the turn ends, and mirrors error results to stderr when
 * stdout is redirected/captured while stderr is a terminal (#149).
 */
export class PrintTextResults {
  private lastPrinted: PrintTextResultMessage | undefined
  private printedCount = 0
  private endsWithNewline = true

  constructor(
    private readonly limits: {
      maxTurns?: number
      maxBudgetUsd?: number
    },
    private readonly write: (text: string) => void = writeToStdout,
    private readonly isStdoutTty: () => boolean = () =>
      process.stdout.isTTY === true,
    private readonly writeStderr: (text: string) => void = text => {
      process.stderr.write(text)
    },
    private readonly isStderrTty: () => boolean = () =>
      process.stderr.isTTY === true,
  ) {}

  printAtTurnEnd(msg: PrintTextResultMessage, extra?: string): void {
    try {
      if (
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_jazzy_puddle', true) &&
        !isBlankTextResult(msg, extra) &&
        msg.terminal_reason !== 'tool_deferred_unavailable'
      ) {
        this.print(msg, extra)
      }
    } catch (err) {
      logError(toError(err))
    }
  }

  printAtExit(msg: PrintTextResultMessage, extra?: string): void {
    if (
      msg !== this.lastPrinted &&
      (this.printedCount === 0 || !isBlankTextResult(msg, extra))
    ) {
      this.print(msg, extra)
    }
    if (this.printedCount > 1) {
      logEvent('tengu_print_text_results', {
        results_printed: this.printedCount,
      })
    }
  }

  private print(msg: PrintTextResultMessage, extra?: string): void {
    let text = ''
    switch (msg.subtype) {
      case 'success': {
        const raw = String(msg.result ?? '')
        const combined = extra === undefined ? raw : `${extra}\n${raw}`
        text = combined.endsWith('\n') ? combined : combined + '\n'
        break
      }
      case 'error_during_execution':
        text = 'Execution error'
        break
      case 'error_max_turns':
        text = `Error: Reached max turns (${this.limits.maxTurns})`
        break
      case 'error_max_budget_usd':
        text = `Error: Exceeded USD budget (${this.limits.maxBudgetUsd})`
        break
      case 'error_max_structured_output_retries': {
        const errors = msg.errors as string[] | undefined
        text = `Error: ${errors?.[0] ?? 'Failed to provide valid structured output after maximum retries'}`
        break
      }
    }
    const stdoutTty = this.isStdoutTty()
    const output = stdoutTty ? sanitizePrintTextForTty(text) : text
    const prefix =
      this.printedCount === 0 ? '' : this.endsWithNewline ? '\n' : '\n\n'
    // Official 2.1.326 #149: when stdout is redirected/captured and stderr is
    // a terminal, mirror error results to stderr so failures are never silent.
    const isErrorResult =
      (msg as { is_error?: boolean }).is_error === true ||
      msg.subtype !== 'success'
    if (isErrorResult && this.isStderrTty() && !stdoutTty) {
      const errBody =
        msg.subtype === 'success' ? String(msg.result ?? '') : text
      this.writeStderr(`${sanitizePrintTextForTty(errBody).trimEnd()}\n`)
    }
    this.write(prefix + output)
    this.lastPrinted = msg
    this.printedCount++
    this.endsWithNewline = output.endsWith('\n')
  }
}

export function countsAsHeadlessLastMessage(message: {
  type: string
  subtype?: unknown
}): boolean {
  if (HEADLESS_LAST_MESSAGE_SKIP_TYPES.has(message.type)) return false
  return !(
    message.type === 'system' &&
    typeof message.subtype === 'string' &&
    HEADLESS_LAST_MESSAGE_SKIP_SYSTEM_SUBTYPES.has(message.subtype)
  )
}

/**
 * Official 2.1.323 #2008: warning printed by `claude -p` when a claude.ai
 * login ended and Claude Code fell back to `ant auth login`, explicitly noting
 * that `claude auth logout` also removes saved MCP server logins and plugin
 * secrets.
 */
export function formatPrintEndedClaudeAiLoginWarning(
  organization: string,
): string {
  return `Your claude.ai login ended; continuing on the sign-in from ant auth login instead, and its usage is billed to ${organization}. Run claude auth login to sign in again. To keep using the sign-in from ant auth login without this warning, run claude auth logout. That removes the ended login and the other credentials Claude Code has saved, such as MCP server logins and plugin secrets.`
}
