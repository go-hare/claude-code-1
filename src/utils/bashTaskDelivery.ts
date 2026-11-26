/**
 * densable `KRr` — splice a bash-complete GetTask pair into the API message
 * list and record `Qn().bashTaskDeliveryOutcomes`.
 */
import { createHash, randomUUID, type UUID } from 'crypto'
import { z } from 'zod/v4'
import type { AssistantMessage, UserMessage } from '../types/message.js'
import {
  BashTaskDeliveryBag,
  bashTaskDeliveryBagOf,
  type BashTaskDeliveryOutcome,
  type BashTaskSnapshotEntry,
  GET_TASK_TOOL_NAME,
} from './bashTaskDeliveryOutcomes.js'
import { getBootstrapSessionHost } from './sessionHost.js'
import { NO_CONTENT_MESSAGE } from '../constants/messages.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { leftoverM, leftoverP, leftoverY } from './leftoverOt.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/constants.js'
import { jsonStringify } from './slowOperations.js'
import { getDefaultBashTimeoutMs, getMaxBashTimeoutMs } from './timeouts.js'
import { formatDuration } from './format.js'

export {
  BashTaskDeliveryBag,
  bashTaskDeliveryBagOf,
  type BashTaskDeliveryOutcome,
  type BashTaskSnapshotEntry,
  GET_TASK_TOOL_NAME,
}

/**
 * Official 2.1.331 @305046105 `yn()` — per-`SessionHost` `BashTaskDeliveryBag`
 * (`dx.of(N().host)`), delegating directly to `bashTaskDeliveryOutcomes.ts` so
 * both modules share the exact same bag per `SessionHost` regardless of active
 * ALS context.
 */
export function getBashTaskDeliveryBag(): BashTaskDeliveryBag {
  return bashTaskDeliveryBagOf(getBootstrapSessionHost())
}

export function bashTaskDeliveryOutcomes(): Map<
  string,
  BashTaskDeliveryOutcome
> {
  return getBashTaskDeliveryBag().bashTaskDeliveryOutcomes
}

export function reportedBashTaskDeliveries(): Set<string> {
  return getBashTaskDeliveryBag().reportedBashTaskDeliveries
}

export function setBashTaskDeliveryOutcome(
  messageId: string,
  outcome: BashTaskDeliveryOutcome,
): void {
  getBashTaskDeliveryBag().bashTaskDeliveryOutcomes.set(messageId, outcome)
}

export function isBashTaskDeliveryHosted(
  messageId: string | undefined,
): boolean {
  if (messageId === undefined) return true
  return (
    getBashTaskDeliveryBag().bashTaskDeliveryOutcomes.get(messageId) !==
    'no_host'
  )
}

export function rememberBashTaskSnapshot(
  taskId: string,
  snapshot: unknown,
  agentId?: string,
): void {
  getBashTaskDeliveryBag().rememberBashTaskSnapshot(taskId, snapshot, agentId)
}

export function lookupBashTaskSnapshot(
  taskId: string,
  agentId?: string,
): BashTaskSnapshotEntry | undefined {
  const entry = getBashTaskDeliveryBag().bashTaskSnapshots.get(taskId)
  if (!entry) return undefined
  let caller = agentId
  if (caller !== undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getMainThreadAgentId } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      if (caller === getMainThreadAgentId()) caller = undefined
    } catch {
      // ignore
    }
  }
  if (caller !== undefined && entry.agentId !== caller) {
    return undefined
  }
  return entry
}

export function resetBashTaskDeliveryForTests(): void {
  getBashTaskDeliveryBag().reset()
}

/** densable `gF` — GB `tengu_violin_rosin` && !qd() && !q4t() && !Or(). */
export function isBashTaskGetDeliveryEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    const gb =
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_violin_rosin', false) === true
    if (!gb) return false
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { areBackgroundTasksDisabled } =
      require('./sessionBackgroundGates.js') as typeof import('./sessionBackgroundGates.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getStrictToolResultPairing } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isBareMode } =
      require('./envUtils.js') as typeof import('./envUtils.js')
    return (
      !areBackgroundTasksDisabled() &&
      !getStrictToolResultPairing() &&
      !isBareMode()
    )
  } catch {
    return false
  }
}

/** densable `sX` / `cX` — killed snapshot copy by stopCause. */
export type BashTaskStopCause = 'memory_pressure' | 'deadline'

export const STOP_CAUSE_SHORT: Record<BashTaskStopCause, string> = {
  memory_pressure: 'stopped because the system is running low on memory',
  deadline: 'stopped after reaching its background time limit',
}

export const STOP_CAUSE_LONG: Record<BashTaskStopCause, string> = {
  memory_pressure:
    'This is not a failure of the command. Claude Code stopped it because the system was critically low on memory while the session was idle, which says nothing about the command or its own memory use, so there is nothing in it to debug. Do not start it again on your own, even if the work seems to need it: memory may still be short. Report what was stopped and why, and start it again only when asked. The user can turn this behavior off by starting Claude Code with CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1 in its environment; setting it from a shell command has no effect.',
  deadline:
    'If the work in progress still needs it, start it again with `run_in_background` and a longer `timeout`. If it already had the longest `timeout` allowed, do not restart it. Either way, report that it was stopped.',
}

/** densable `qZe` / `X6n` — snapshot tail. */
export const GETTASK_SNAPSHOT_TAIL_CHARS = 12_000
export const GETTASK_SNAPSHOT_READ_BYTES = 4 * GETTASK_SNAPSHOT_TAIL_CHARS

const AUTO_DELIVER =
  'between your tool calls if you are still working, or by starting a new turn if you have already replied'

const BG_DEADLINE_DEFAULT_MS = 1_800_000
const BG_DEADLINE_FLOOR_MS = 7_200_000

const DESKTOP_HOSTED_ENTRYPOINTS = new Set([
  'claude-desktop',
  'claude-desktop-3p',
  'local-agent',
])

/**
 * densable `e6(e=Ce())`. `Ce` is `!launchOptions.isInteractive()`
 * (`getIsNonInteractiveSession`). Then not (desktop/local-agent parent
 * without CLAUDECODE) and not (vscode parent without CLAUDECODE).
 */
function e6(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getIsNonInteractiveSession } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    if (!getIsNonInteractiveSession()) return false
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isChildSession } =
      require('./sessionRoleEnv.js') as typeof import('./sessionRoleEnv.js')
    const child = isChildSession()
    const claudecode = Boolean(process.env.CLAUDECODE)
    const entry = process.env.CLAUDE_CODE_ENTRYPOINT
    // densable `Ju`: desktop / local-agent && !childSession
    const ju =
      !child && entry !== undefined && DESKTOP_HOSTED_ENTRYPOINTS.has(entry)
    if (ju && !claudecode) return false
    // densable `_E`: vscode && !child && !claudecode
    if (entry === 'claude-vscode' && !child && !claudecode) return false
    return true
  } catch {
    return false
  }
}

/** densable `rmn` / `gUr`. */
function gUr(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSessionBackgroundGates } =
      require('./sessionBackgroundGates.js') as typeof import('./sessionBackgroundGates.js')
    if (getSessionBackgroundGates().backgroundDeadlineDisabled) {
      return false
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    if (
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_cosmic_shore', true) === false
    ) {
      return false
    }
    return e6()
  } catch {
    return false
  }
}

/** densable `L6o` / `boe` / `hUr`. */
function hUr(timeoutMs?: number): number {
  const L6o = Math.max(BG_DEADLINE_DEFAULT_MS, getDefaultBashTimeoutMs())
  const boe = Math.min(
    Math.max(BG_DEADLINE_FLOOR_MS, getMaxBashTimeoutMs()),
    2147483647,
  )
  return Math.min(timeoutMs ?? L6o, boe)
}

/**
 * densable `h9n(e)` — `gUr()?hUr(e):void 0`. Optional `e` is the command
 * timeout; omitted → `L6o()`.
 */
export function backgroundShellDeadlineMs(
  timeoutMs?: number,
): number | undefined {
  return gUr() ? hUr(timeoutMs) : undefined
}

/** densable `gUr` — Cvr re-checks the gate at fire time. */
export function isBackgroundShellDeadlineEnabled(): boolean {
  return gUr()
}

/** @internal densable `h9n` alias used by DVn. */
function h9n(timeoutMs?: number): number | undefined {
  return backgroundShellDeadlineMs(timeoutMs)
}

/** densable `aCn` */
export function getTaskOutputWrittenCopy(outputFile: string): string {
  return `Output is being written to ${outputFile}; use ${FILE_READ_TOOL_NAME} on that path for interim output.`
}

/** densable `DVn` — model-facing background shell copy. */
export function formatBackgroundShellCopy(opts: {
  backgroundTaskId: string
  outputPath: string
  backgroundedByUser?: boolean
  backgroundedToDeliverMessage?: boolean
  backgroundedByTurnAbort?: boolean
  timedOutAfterMs?: number
  reapedAtFinalResponse?: boolean
  readToolName?: string
}): string {
  const {
    backgroundTaskId: e,
    outputPath: n,
    backgroundedByUser: r,
    backgroundedToDeliverMessage: s,
    backgroundedByTurnAbort: g,
    timedOutAfterMs: h,
    reapedAtFinalResponse: b,
    readToolName: w = FILE_READ_TOOL_NAME,
  } = opts
  const M = r
    ? `Command was manually backgrounded by user with ID: ${e}. Output is being written to: ${n}.`
    : s
      ? `Command was moved to the background (ID: ${e}) so that a message that arrived while it was running can reach you; it was not interrupted. Output is being written to: ${n}.`
      : h !== undefined
        ? `Command did not complete within its ${Math.max(1, Math.round(h / 1000))}s timeout and was moved to the background (ID: ${e}). Output is being written to: ${n}.`
        : `Command running in background with ID: ${e}. Output is being written to: ${n}.`
  const B = b
    ? 'If it exits while you are still working you will be notified, but it is terminated when you give your final response and no notification can follow that — so do not end your turn to wait for it; if you need its result, wait for it before giving your final response.'
    : r
      ? undefined
      : 'You will be notified when it completes.'
  const capMs = (h !== undefined || r || s || g) && !b ? h9n() : undefined
  const he =
    capMs !== undefined
      ? `If it is still running after ${formatDuration(capMs, { hideTrailingZeros: true })} in the background, it will be stopped and you will be notified.`
      : undefined
  const ye = r
    ? undefined
    : `To check interim output, use ${w} on that file path.`
  return [M, B, he, ye].filter(Boolean).join(' ')
}

/** densable `mdt` — reaped → final_response, print session → session. */
export function backgroundTaskEnding(
  reapedAtFinalResponse?: boolean,
): 'final_response' | 'session' | undefined {
  if (reapedAtFinalResponse === true) return 'final_response'
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isSingleShotPrintSession } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    if (isSingleShotPrintSession()) return 'session'
  } catch {
    // optional
  }
}

const OTHER_AGENT_COPY =
  'Its result is delivered to the agent that started it, not to you.'

function keepWorkingCopy(): string {
  const mins = Math.floor(getMaxBashTimeoutMs() / 60_000)
  return `If you still need its result and have other work, keep working — it reaches you between your tool calls if it exits in time; if waiting for it is all that is left, wait with one foreground shell command that blocks until the output file shows what you need, rather than checking on it repeatedly. Next time, run a command you must wait on in the foreground (with a timeout of up to ${mins} minutes) and keep the background for work you can start and forget.`
}

function namedEndingCopy(ending: 'final_response' | 'session'): string {
  const when =
    ending === 'final_response'
      ? 'when you give your final response'
      : 'when your turn ends, since this session takes no further input'
  return `Its result reaches you only if it finishes while you are still working: it is terminated ${when}, and nothing can follow that. ${keepWorkingCopy()}`
}

const SELF_WORKING_COPY = `Do not call ${GET_TASK_TOOL_NAME} again for this task: when the command finishes, its result is delivered to you automatically — ${AUTO_DELIVER} (usually as a ${GET_TASK_TOOL_NAME} result, otherwise as a task notification). If that result is all you are waiting for, end your turn; otherwise continue with other work.`

export type GetTaskWorkingEnding = 'other_agent' | 'final_response' | 'session'

/** densable `TPo` working `statusMessage`. */
export function formatWorkingGetTaskStatusMessage(
  outputFile: string,
  ending?: GetTaskWorkingEnding,
): string {
  const extra =
    ending === 'other_agent'
      ? OTHER_AGENT_COPY
      : ending === 'final_response' || ending === 'session'
        ? namedEndingCopy(ending)
        : SELF_WORKING_COPY
  return `Still running. ${getTaskOutputWrittenCopy(outputFile)} ${extra}`
}

/** densable `bCn`. */
export function formatSnapshotOutputTail(
  output:
    | {
        content: string
        omittedBytes: number
      }
    | undefined,
  outputFile: string,
): string {
  if (!output) return ''
  const clipped =
    output.content.length > GETTASK_SNAPSHOT_TAIL_CHARS
      ? output.content.slice(-GETTASK_SNAPSHOT_TAIL_CHARS)
      : output.content
  const omitted =
    output.omittedBytes > 0 || clipped.length < output.content.length
  const body = clipped.replace(/^\n+/, '').trimEnd()
  return omitted
    ? `[… earlier output omitted; full output: ${outputFile}]\n${body}`
    : body
}

export async function readBashTaskSnapshotOutput(
  taskId: string,
): Promise<{ content: string; omittedBytes: number } | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readTaskOutputTail } =
      require('./task/diskOutput.js') as typeof import('./task/diskOutput.js')
    const tail = await readTaskOutputTail(taskId, GETTASK_SNAPSHOT_READ_BYTES)
    if (tail.content.length === 0 && tail.omittedBytes === 0) return undefined
    return tail
  } catch {
    return undefined
  }
}

/** densable `J6n` — background bash tool_result when gF. */
export function formatBackgroundTaskResult(
  taskId: string,
  prefix: string,
  opts?: {
    backgroundedByUser?: boolean
    ending?: 'final_response' | 'session'
  },
): string {
  const ending = opts?.ending
  const g =
    ending === 'final_response'
      ? keepWorkingCopy()
      : ending === 'session'
        ? `This session takes no further input, though: the command is stopped when your turn ends, so its result reaches you only while you are still working. ${keepWorkingCopy()}`
        : opts?.backgroundedByUser === true
          ? 'Its result is delivered to you automatically when it finishes; carry on without waiting for it.'
          : `When it finishes, its result is delivered to you automatically — ${AUTO_DELIVER} — so there is no need to check whether it is done or to sleep; if that result is all you are waiting for, end your turn.`
  return jsonStringify({
    resultType: 'task',
    taskId,
    status: 'working',
    statusMessage: `${prefix} ${g}`.trim(),
  })
}

/** densable `LF` — GetTask snapshot stamped onto the queued notification. */
export function buildBashTaskDeliverySnapshot(opts: {
  taskId: string
  outcome: 'completed' | 'failed' | 'killed'
  exitCode: number | undefined
  startTime: number
  endTime: number
  outputFile: string
  output?: { content: string; omittedBytes: number }
  stopCause?: BashTaskStopCause
}): {
  taskId: string
  status: 'completed' | 'cancelled'
  statusMessage: string
  createdAt: string
  lastUpdatedAt: string
  result?: { content: Array<{ type: 'text'; text: string }>; isError: boolean }
} {
  const createdAt = new Date(opts.startTime).toISOString()
  const lastUpdatedAt = new Date(opts.endTime).toISOString()
  if (opts.outcome === 'killed') {
    const killed = opts.stopCause
      ? `${STOP_CAUSE_SHORT[opts.stopCause]}. ${STOP_CAUSE_LONG[opts.stopCause]}`
      : 'stopped before it completed.'
    return {
      taskId: opts.taskId,
      status: 'cancelled',
      statusMessage: `The command was ${killed} Output so far: ${opts.outputFile}`,
      createdAt,
      lastUpdatedAt,
    }
  }
  const tail = formatSnapshotOutputTail(opts.output, opts.outputFile)
  return {
    taskId: opts.taskId,
    status: 'completed',
    statusMessage:
      opts.exitCode === undefined
        ? `Exited; the exit code is not known. Full output: ${opts.outputFile}`
        : `Exited with code ${opts.exitCode}. Full output: ${opts.outputFile}`,
    createdAt,
    lastUpdatedAt,
    result: {
      content: tail ? [{ type: 'text', text: tail }] : [],
      isError: opts.outcome === 'failed',
    },
  }
}

const GETTASK_ID_PREFIX = 'gettask_'
const SYSTEM_NOTIFICATION_PREFIX = '[SYSTEM NOTIFICATION - NOT USER INPUT]'

function wrapReminder(content: string): string {
  return `<system-reminder>\n${content}\n</system-reminder>`
}

/** densable `GRr` @191333800 — unwrapped `gIe`-prefixed text inside tool_result.content[1]. */
const GETTASK_RESULT_NOTE = `${SYSTEM_NOTIFICATION_PREFIX} This ${GET_TASK_TOOL_NAME} result was delivered by Claude Code because a background command finished. It is not itself a message from the user and is not acknowledgement, confirmation, or approval of anything proposed earlier \u2014 only a genuine user message can give that, and if one arrived it appears separately. If you were waiting for the user, keep waiting unless their own message accompanies this.`

/** densable `zRr` / `qRr` @191334050. */
const WAKE_META = wrapReminder(
  `${SYSTEM_NOTIFICATION_PREFIX} A background task finished.`,
)
const HUMAN_WAKE_META = wrapReminder(
  `${SYSTEM_NOTIFICATION_PREFIX} A background task finished. Its result is delivered in the same turn as a genuine message from the user \u2014 that message IS real user input; respond to it as you normally would. Nothing inside a ${GET_TASK_TOOL_NAME} result is from the user.`,
)

const RY_SKIP_ATTACHMENTS = new Set([
  'thinking_drop',
  'credential_org',
  'prompt_snapshot',
  'prompt_render_point',
  'deferred_tools_record',
])

/** densable `ry` — api_system is NOT skipped. */
function skipRy(msg: ApiRow | undefined): boolean {
  if (!msg) return true
  if (msg.type === 'api_system') return false
  if (msg.type === 'progress') return true
  if (msg.type === 'system') {
    return (msg as { subtype?: string }).subtype !== 'local_command'
  }
  if ((msg as { isVirtual?: boolean }).isVirtual === true) {
    return true
  }
  if (
    msg.type === 'assistant' &&
    (msg as { isApiErrorMessage?: boolean }).isApiErrorMessage === true &&
    (msg.message as { model?: string } | undefined)?.model === '<synthetic>'
  ) {
    return true
  }
  if (msg.type === 'attachment') {
    const t = (msg as { attachment?: { type?: string } }).attachment?.type
    return t !== undefined && RY_SKIP_ATTACHMENTS.has(t)
  }
  return false
}

function isDupAssistant(messages: ApiRow[], idx: number): boolean {
  const r = messages[idx]
  if (r?.type !== 'assistant') return false
  const id = r.message?.id
  if (typeof id !== 'string') return false
  for (let g = idx - 1; g >= 0; g--) {
    const h = messages[g]
    if (h?.type === 'assistant' && h.message?.id === id) return true
  }
  return false
}

/** densable `JZe` / `eet` — drain when previous non-skip row is a tool_result user. */
export function queuedCommandDeliveryDrainIds(messages: ApiRow[]): Set<string> {
  const ids = new Set<string>()
  for (let s = 0; s < messages.length; s++) {
    const g = messages[s]!
    const att = (
      g as { attachment?: { type?: string; taskDelivery?: unknown } }
    ).attachment
    if (
      g.type !== 'attachment' ||
      att?.type !== 'queued_command' ||
      att.taskDelivery === undefined
    ) {
      continue
    }
    let h = s - 1
    while (
      h >= 0 &&
      (messages[h]!.type === 'attachment' ||
        skipRy(messages[h]) ||
        isDupAssistant(messages, h))
    ) {
      h--
    }
    const b = messages[h]
    const content = b?.message?.content
    if (
      b?.type === 'user' &&
      Array.isArray(content) &&
      (content[0] as { type?: string } | undefined)?.type === 'tool_result' &&
      typeof g.uuid === 'string'
    ) {
      ids.add(g.uuid)
    }
  }
  return ids
}

/**
 * densable `KRn` — walk back from `end` for a real human user (not
 * tool_result / compact / meta except image-metadata).
 */
function hasHumanUserBefore(messages: ApiRow[], end: number): boolean {
  for (let r = Math.min(end, messages.length) - 1; r >= 0; r--) {
    const s = messages[r]
    if (s === undefined) continue
    if (s.type === 'assistant') return false
    if (s.type !== 'user') continue
    if (s.toolUseResult !== undefined || s.isCompactSummary === true) {
      return false
    }
    if (s.isVisibleInTranscriptOnly === true) continue
    if (s.isMeta === true) {
      if (s.turnCompanion === true) continue
      return false
    }
    const origin = s.origin as { kind?: string } | undefined
    const human =
      origin === undefined ||
      origin.kind === 'human' ||
      origin.kind === 'auto-continuation'
    return human && s.verifiedSlackHumanTurn !== true
  }
  return false
}

/**
 * densable `tX` — queued_command task-notification (not scheduled-trigger)
 * that sits after a human user (`KRn`).
 */
export function queuedCommandDeliveryHumanTurnIds(
  messages: ApiRow[],
): Set<string> {
  const ids = new Set<string>()
  for (let r = 0; r < messages.length; r++) {
    const s = messages[r]!
    const att = (
      s as {
        attachment?: {
          type?: string
          origin?: { kind?: string; subkind?: string }
          commandMode?: string
        }
      }
    ).attachment
    if (s.type !== 'attachment' || att?.type !== 'queued_command') continue
    const g = att.origin
    const isNotify =
      g != null
        ? g.kind === 'task-notification' &&
          g.subkind !== 'scheduled-trigger' &&
          g.subkind !== 'projects-relay'
        : att.commandMode === 'task-notification'
    if (
      isNotify &&
      hasHumanUserBefore(messages, r) &&
      typeof s.uuid === 'string'
    ) {
      ids.add(s.uuid)
    }
  }
  return ids
}

/** densable `tet` — `behindEarlierMessages` (Xe), not inHumanTurn. */
export function queuedCommandDeliveryBehindEarlierIds(
  messages: ApiRow[],
): Set<string> {
  const seen = new Set<string>()
  const ids = new Set<string>()
  for (let s = 0; s < messages.length; s++) {
    const g = messages[s]!
    const att = (
      g as { attachment?: { type?: string; taskDelivery?: unknown } }
    ).attachment
    const isAtt =
      g.type === 'attachment' &&
      att?.type === 'queued_command' &&
      att.taskDelivery !== undefined
    const isUser = g.type === 'user' && g.taskDelivery !== undefined
    if ((!isAtt && !isUser) || typeof g.uuid !== 'string' || seen.has(g.uuid)) {
      continue
    }
    seen.add(g.uuid)
    let skipUserOnce = isAtt
    let inHuman = false
    for (let B = s - 1; B >= 0; B--) {
      const K = messages[B]!
      if (skipRy(K) || (isAtt && K.type === 'attachment')) continue
      if (K.type === 'assistant') break
      if (skipUserOnce && K.type === 'user') {
        skipUserOnce = false
        continue
      }
      inHuman = true
      break
    }
    if (inHuman) ids.add(g.uuid)
  }
  return ids
}

const snapshotBaseFields = {
  taskId: z.string().min(1),
  statusMessage: z.string(),
  createdAt: z.string(),
  lastUpdatedAt: z.string(),
}

/** densable `V0r` / `qce` @187360793 — strict discriminated snapshot schema. */
const deliverySnapshotSchema = z.discriminatedUnion('status', [
  z.object({
    ...snapshotBaseFields,
    status: z.literal('working'),
  }),
  z.object({
    ...snapshotBaseFields,
    status: z.literal('completed'),
    result: z.object({
      content: z.array(
        z.object({
          type: z.literal('text'),
          text: z.string(),
        }),
      ),
      isError: z.boolean(),
    }),
  }),
  z.object({
    ...snapshotBaseFields,
    status: z.literal('failed'),
    error: z.object({
      code: z.number(),
      message: z.string(),
    }),
  }),
  z.object({
    ...snapshotBaseFields,
    status: z.literal('cancelled'),
  }),
])

type ParsedDeliverySnapshot = z.infer<typeof deliverySnapshotSchema>

function parseSnapshot(raw: unknown): ParsedDeliverySnapshot | null {
  const parsed = deliverySnapshotSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** densable `iCn` / `ZMt` — canonical serialized snapshot payload. */
function formatParsedSnapshot(snap: ParsedDeliverySnapshot): string {
  const { taskId, statusMessage, createdAt, lastUpdatedAt } = snap
  switch (snap.status) {
    case 'working':
      return jsonStringify({
        taskId,
        status: 'working',
        statusMessage,
        createdAt,
        lastUpdatedAt,
      })
    case 'completed':
      return jsonStringify({
        taskId,
        status: 'completed',
        statusMessage,
        createdAt,
        lastUpdatedAt,
        result: {
          content: snap.result.content.map(({ type, text }) => ({
            type,
            text,
          })),
          isError: snap.result.isError,
        },
      })
    case 'failed':
      return jsonStringify({
        taskId,
        status: 'failed',
        statusMessage,
        createdAt,
        lastUpdatedAt,
        error: {
          code: snap.error.code,
          message: snap.error.message,
        },
      })
    case 'cancelled':
      return jsonStringify({
        taskId,
        status: 'cancelled',
        statusMessage,
        createdAt,
        lastUpdatedAt,
      })
  }
}

/** densable `HB(name, namespaceUuid)` — deterministic UUIDv5 for wake/call rows. */
export function deterministicDeliveryUuid(
  name: string,
  namespaceUuid: string,
): UUID {
  const hexNs = namespaceUuid.replaceAll('-', '')
  const nsBytes = /^[0-9a-f]{32}$/i.test(hexNs)
    ? Buffer.from(hexNs, 'hex')
    : createHash('sha1').update(namespaceUuid, 'utf8').digest().subarray(0, 16)
  const digest = createHash('sha1')
    .update(nsBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest()
  digest[6] = (digest[6]! & 0x0f) | 0x50
  digest[8] = (digest[8]! & 0x3f) | 0x80
  const hex = digest.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` as UUID
}

function gettaskToolUseId(messageId: string): string {
  return `${GETTASK_ID_PREFIX}${messageId.replaceAll('-', '')}`
}

export type ApiRow = {
  type: string
  uuid?: string
  message?: {
    content?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

function isHostAssistant(msg: ApiRow | undefined): msg is ApiRow & {
  type: 'assistant'
  message: { content: unknown[] }
} {
  if (msg?.type !== 'assistant') return false
  const content = msg.message?.content
  if (!Array.isArray(content)) return false
  return content.some(block => {
    const b = block as { type?: string; text?: string }
    if (b.type === 'tool_use') return true
    if (
      b.type === 'text' &&
      typeof b.text === 'string' &&
      b.text.trim() !== '' &&
      b.text.trim() !== NO_CONTENT_MESSAGE
    ) {
      return true
    }
    return false
  })
}

/** densable `s4e` @191334700 — `createAssistantMessage` + `HB("call", messageId)`. */
function makeAssistantGetTask(
  toolUseId: string,
  taskId: string,
  messageId: string,
): AssistantMessage {
  const toolUseBlock = {
    type: 'tool_use' as const,
    id: toolUseId,
    name: GET_TASK_TOOL_NAME,
    input: { taskId },
  }
  const { createAssistantMessage } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./messages.js') as typeof import('./messages.js')
  const base = createAssistantMessage({
    content: [toolUseBlock as never],
  })
  return {
    ...base,
    uuid: deterministicDeliveryUuid('call', messageId),
    message: {
      ...base.message,
      id: randomUUID(),
    },
  }
}

export function spliceBashTaskDelivery(
  apiMessages: ApiRow[],
  snapshot: unknown,
  messageId: string,
  opts: {
    report: boolean
    startsTurn?: boolean
    inDrainPosition?: boolean
    inHumanTurn?: boolean
    behindEarlierMessages?: boolean
    flushTail?: () => void
  },
): false | 'append' | 'new_turn' {
  const parsed = parseSnapshot(snapshot)
  if (!parsed) {
    if (opts.report) {
      const bag = getBashTaskDeliveryBag()
      bag.bashTaskDeliveryOutcomes.set(messageId, 'no_host')
      const reported = bag.reportedBashTaskDeliveries
      if (!reported.has(messageId)) {
        reported.add(messageId)
        logEvent('tengu_bash_task_delivered', {
          outcome:
            'unparseable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        leftoverM('task_local_shell_delivery', 'unparseable_snapshot')
      }
    }
    return false
  }

  let hostIdx = -1
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const m = apiMessages[i]!
    if (m.type === 'assistant') {
      hostIdx = i
      break
    }
    if (m.type !== 'user' && m.type !== 'api_system') break
    // gold walks past user + api_system only
  }

  const host = apiMessages[hostIdx]
  const hosted = isHostAssistant(host)
  const hostHasToolUse =
    hosted &&
    host.message.content.some(b => (b as { type?: string }).type === 'tool_use')
  let userAfterHost = false
  for (let i = hostIdx + 1; i < apiMessages.length && !userAfterHost; i++) {
    userAfterHost = apiMessages[i]!.type === 'user'
  }
  const inDrain = opts.inDrainPosition === true
  const afterTurn =
    hosted &&
    !inDrain &&
    userAfterHost &&
    (hostHasToolUse || opts.behindEarlierMessages === true)
  const append = hostHasToolUse && inDrain

  const structure = afterTurn ? 'after_turn' : append ? 'append' : 'new_turn'
  if (opts.report) {
    const outcome = hosted ? 'spliced' : 'no_host'
    const bag = getBashTaskDeliveryBag()
    bag.bashTaskDeliveryOutcomes.set(messageId, outcome)
    const reported = bag.reportedBashTaskDeliveries
    if (!reported.has(messageId)) {
      reported.add(messageId)
      logEvent('tengu_bash_task_delivered', {
        outcome:
          outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        status:
          parsed.status as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(hosted
          ? {
              structure:
                structure as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
      })
      if (hosted) {
        leftoverY('task_local_shell_delivery', { status: parsed.status })
      } else {
        leftoverP('task_local_shell_delivery', 'no_host')
      }
    }
  }
  if (!hosted || host?.type !== 'assistant') return false

  const toolUseId = gettaskToolUseId(messageId)
  const hostContent = Array.isArray(host.message.content)
    ? host.message.content
    : []
  if (
    hostContent.some(
      b =>
        (b as { type?: string; id?: string }).type === 'tool_use' &&
        (b as { id?: string }).id === toolUseId,
    )
  ) {
    return 'append'
  }

  const toolUse = {
    type: 'tool_use' as const,
    id: toolUseId,
    name: GET_TASK_TOOL_NAME,
    input: { taskId: parsed.taskId },
  }
  let assistantIdx = hostIdx
  if (afterTurn) {
    opts.flushTail?.()
    apiMessages.push(makeAssistantGetTask(toolUseId, parsed.taskId, messageId))
    assistantIdx = apiMessages.length - 1
  } else if (append) {
    const {
      apiBlockIndex: _apiBlockIndex,
      apiBlockIndices: _apiBlockIndices,
      ...hostRest
    } = host as ApiRow & {
      apiBlockIndex?: unknown
      apiBlockIndices?: unknown
    }
    apiMessages[hostIdx] = {
      ...hostRest,
      message: {
        ...host.message,
        content: [...hostContent, toolUse],
      },
    }
  } else {
    const wake: UserMessage = {
      type: 'user',
      uuid: deterministicDeliveryUuid('wake', messageId),
      timestamp: new Date().toISOString(),
      isMeta: true,
      message: {
        role: 'user',
        content: opts.inHumanTurn === true ? HUMAN_WAKE_META : WAKE_META,
      },
    }
    apiMessages.splice(
      hostIdx + 1,
      0,
      wake,
      makeAssistantGetTask(toolUseId, parsed.taskId, messageId),
    )
    assistantIdx = hostIdx + 2
  }

  const startsTurn = opts.startsTurn === true
  const formattedBody = formatParsedSnapshot(parsed)
  // Gold Ge is a tool_result block; put it as the user message content.
  const toolResultBlock = {
    type: 'tool_result' as const,
    tool_use_id: toolUseId,
    content: startsTurn
      ? [
          { type: 'text' as const, text: formattedBody },
          { type: 'text' as const, text: GETTASK_RESULT_NOTE },
        ]
      : formattedBody,
  }
  const after = apiMessages[assistantIdx + 1]
  if (after?.type === 'user') {
    const existing = after.message?.content
    const existingBlocks =
      typeof existing === 'string'
        ? [{ type: 'text' as const, text: existing }]
        : Array.isArray(existing)
          ? existing
          : []
    const blocks = [toolResultBlock, ...existingBlocks]
    apiMessages[assistantIdx + 1] = {
      ...after,
      message: { ...(after.message ?? {}), content: blocks },
    }
  } else {
    apiMessages.splice(assistantIdx + 1, 0, {
      type: 'user',
      uuid: messageId as UserMessage['uuid'],
      timestamp: new Date().toISOString(),
      isMeta: true,
      message: { role: 'user', content: [toolResultBlock] },
    })
  }
  return append ? 'append' : 'new_turn'
}
