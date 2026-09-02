import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { getMainThreadAgentId } from 'src/bootstrap/state.js'
import {
  formatRemoteControlSendBlock,
  getRemoteControlSendBlockReason,
} from 'src/bridge/remoteControlSendGate.js'
import {
  formatUnreachableElevatedRefusal,
  isRemoteControlPeerUnreachableFromHere,
} from 'src/bridge/trustedDevice.js'
import type { Tool, ToolUseContext } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { findTeammateTaskByAgentId } from 'src/tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import {
  isLocalAgentTask,
  isObserverAgentTask,
  queuePendingMessage,
  type LocalAgentTaskState,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { sanitizeInheritedPermissionMode } from 'src/utils/permissions/permissionSetup.js'
import { isAutoModeActive } from 'src/utils/permissions/autoModeState.js'
import type { PermissionMode } from 'src/types/permissions.js'
import { isInProcessTeammateTask } from 'src/tasks/InProcessTeammateTask/types.js'
import { isMainSessionTask } from 'src/tasks/LocalMainSessionTask.js'
import { asAgentId, toAgentId } from 'src/types/ids.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import { generateRequestId } from 'src/utils/agentId.js'
import { isAgentSwarmsEnabled } from 'src/utils/agentSwarmsEnabled.js'
import { isObserverTaskId } from 'src/utils/observerAgents.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { logForDebugging } from 'src/utils/debug.js'
import { readAgentMetadata } from 'src/utils/sessionStorage.js'
import { errorMessage } from 'src/utils/errors.js'
import {
  isDefinitelyOwnMessagingSocket,
  isOwnMessagingSocketTarget,
  isUdsMessageTooLargeError,
} from 'src/utils/udsMessaging.js'
import { truncate } from 'src/utils/format.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { enqueuePendingNotification } from 'src/utils/messageQueueManager.js'
import { parseAddress } from 'src/utils/peerAddress.js'
import { semanticBoolean } from 'src/utils/semanticBoolean.js'
import { jsonParse, jsonStringify } from 'src/utils/slowOperations.js'
import type { BackendType } from 'src/utils/swarm/backends/types.js'
import {
  MAIN_RECIPIENT_NAME,
  TEAM_LEAD_NAME,
} from 'src/utils/swarm/constants.js'
import { readTeamFileAsync } from 'src/utils/swarm/teamHelpers.js'
import {
  getAgentId,
  getAgentName,
  getTeammateColor,
  getTeamName,
  isTeamLead,
  isTeammate,
} from 'src/utils/teammate.js'
import {
  createShutdownApprovedMessage,
  createShutdownRejectedMessage,
  createShutdownRequestMessage,
  isStructuredProtocolMessage,
  writeToMailbox,
} from 'src/utils/teammateMailbox.js'
import {
  formatResumedAgentMessage,
  resumeAgentBackground,
} from '../AgentTool/resumeAgent.js'
import { LIST_AGENTS_TOOL_NAME } from '../ListPeersTool/constants.js'
import {
  CROSS_MACHINE_MESSAGING_UNAVAILABLE,
  isCrossMachineMessagingAvailable,
} from './cloudHop.js'
import { validateSendMessageTo } from './validateTo.js'
import {
  SEND_MESSAGE_PARAM_SET,
  SEND_MESSAGE_SUMMARY_MAX_CHARS,
  SEND_MESSAGE_TO_MAX_CHARS,
  SEND_MESSAGE_TO_MAX_RE,
  SEND_MESSAGE_TO_SINGLE_LINE_RE,
  SEND_MESSAGE_TOOL_NAME,
} from './constants.js'
import {
  buildPeerCandidates,
  formatAmbiguousMessage,
  leftoverClosestPeers,
  listingRefMatchesCandidate,
  localClaimedRemoteBodies,
  parseNameRef,
  resolvePeerByName,
  setSendMessagePinOnAppState,
  type PeerCandidate,
} from './nameResolve.js'
import {
  callerIsSubagentFromContext,
  classifyOwnNameTarget,
  describeOwnSession,
  formatImpersonationDisplay,
  formatImpersonationMessage,
  formatOwnNameAlsoNote,
  formatOwnNameNotSentDisplay,
  formatSelfSendMessage,
  isImpersonatingOwnSession,
  isOwnNameSearchComplete,
  leftoverAmbiguousIsSelfSend,
  leftoverNotFoundIsSelfSend,
  SELF_SEND_ERROR_CLASS,
} from './ownSession.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

/** densable D6 — reserved recipient routed to the main conversation queue. */
export const MAIN_RECIPIENT = MAIN_RECIPIENT_NAME

/** densable g5 leftover — ALS + optional agentId, not ToolUseContext fields. */
function callerIsSubagentForSend(context?: { agentId?: string }): boolean {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getTeammateContext } =
    require('src/utils/teammateContext.js') as typeof import('src/utils/teammateContext.js')
  const { getAgentContext } =
    require('src/utils/agentContext.js') as typeof import('src/utils/agentContext.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return callerIsSubagentFromContext({
    teammateContext: getTeammateContext(),
    agentContext:
      getAgentContext() ??
      (context?.agentId ? { agentType: 'subagent' } : undefined),
  })
}

/** densable DEe(to, g5(t)) — name from QV via DHm. */
function formatDeeMessage(to: string, context?: { agentId?: string }): string {
  const callerIsSubagent = callerIsSubagentForSend(context)
  const self = describeOwnSession(callerIsSubagent)
  return formatSelfSendMessage(to, self?.name ?? null, callerIsSubagent)
}

/** leftover Qen/Zen/Jen on not-found. Local: no mailbox fake-send. */
function leftoverOwnNameMiss(
  to: string,
  message: unknown,
  opts: {
    closest: PeerCandidate[]
    searchTruncated?: boolean
    pinnedIdentityClaimedLocally?: string
  },
  context?: { agentId?: string },
):
  | {
      kind: 'dee'
      data: {
        success: false
        message: string
        display: string
        errorClass: typeof SELF_SEND_ERROR_CLASS
      }
    }
  | {
      kind: 'not-found'
      data: {
        success: false
        message: string
        display: string
        errorClass: 'not_reachable'
      }
    } {
  const qen = typeof message === 'string' ? classifyOwnNameTarget(to) : 'no'
  const zen = isOwnNameSearchComplete({
    searchTruncated: opts.searchTruncated,
    pinnedIdentityClaimedLocally: opts.pinnedIdentityClaimedLocally,
  })
  if (leftoverNotFoundIsSelfSend(qen, to, opts.closest, zen)) {
    return {
      kind: 'dee',
      data: {
        success: false,
        message: formatDeeMessage(to, context),
        display: formatOwnNameNotSentDisplay(to),
        errorClass: SELF_SEND_ERROR_CLASS,
      },
    }
  }
  const didYouMean =
    opts.closest.length > 0
      ? ` Did you mean: ${opts.closest.map(c => c.name).join(', ')}?`
      : ''
  const jen =
    qen !== 'no'
      ? formatOwnNameAlsoNote(to, callerIsSubagentForSend(context))
      : ''
  let body = `No agent named '${to}' is reachable.${didYouMean}${jen}\nUse ListAgents to discover targets (name [ref]).`
  let display = `Not sent — no agent named '${to}' is reachable.${didYouMean}`
  if (opts.searchTruncated) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { appendSearchTruncatedBody, searchTruncatedDisplayNote } =
      require('src/utils/sessionListIncompleteCopy.js') as typeof import('src/utils/sessionListIncompleteCopy.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    body = appendSearchTruncatedBody(body, true)
    display += searchTruncatedDisplayNote(true)
  }
  return {
    kind: 'not-found',
    data: {
      success: false,
      message: body,
      display,
      errorClass: 'not_reachable',
    },
  }
}

/** leftover Qen/Zen on yRw prefix-ambiguous. Official DEe only when matchedBy prefix. */
function leftoverOwnNameAmbiguous(
  to: string,
  message: unknown,
  opts: {
    matchedBy: 'exact' | 'prefix'
    searchTruncated?: boolean
    pinnedIdentityClaimedLocally?: string
  },
  context?: { agentId?: string },
):
  | {
      kind: 'dee'
      data: {
        success: false
        message: string
        display: string
        errorClass: typeof SELF_SEND_ERROR_CLASS
      }
    }
  | { kind: 'ambiguous' } {
  const qen = typeof message === 'string' ? classifyOwnNameTarget(to) : 'no'
  const zen = isOwnNameSearchComplete({
    searchTruncated: opts.searchTruncated,
    pinnedIdentityClaimedLocally: opts.pinnedIdentityClaimedLocally,
  })
  if (leftoverAmbiguousIsSelfSend(qen, opts.matchedBy, zen)) {
    return {
      kind: 'dee',
      data: {
        success: false,
        message: formatDeeMessage(to, context),
        display: formatOwnNameNotSentDisplay(to),
        errorClass: SELF_SEND_ERROR_CLASS,
      },
    }
  }
  return { kind: 'ambiguous' }
}

/** densable Xen → Jio → VEt. */
function refuseOwnOrImpersonatedSocket(
  to: string,
  sock: string,
  context?: { agentId?: string },
):
  | { kind: 'self'; message: string; display: string }
  | {
      kind: 'impersonation'
      message: string
      display: string
      degradedClass: 'claimed_locally'
    }
  | undefined {
  if (isDefinitelyOwnMessagingSocket(sock)) {
    return {
      kind: 'self',
      message: formatDeeMessage(to, context),
      display: formatOwnNameNotSentDisplay(to),
    }
  }
  if (isImpersonatingOwnSession(to, sock)) {
    return {
      kind: 'impersonation',
      message: formatImpersonationMessage(to),
      display: formatImpersonationDisplay(to),
      degradedClass: 'claimed_locally',
    }
  }
  if (isOwnMessagingSocketTarget(sock)) {
    return {
      kind: 'self',
      message: formatDeeMessage(to, context),
      display: formatOwnNameNotSentDisplay(to),
    }
  }
  return undefined
}

/**
 * densable `na` / `So` — character truncate with high-surrogate safety (not display width).
 * Used by SendMessage summary coerce: `So(n, VGr-1)+"…"`.
 */
function truncateSummaryChars(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (text.length <= maxChars) return text
  let slice = text.slice(0, maxChars)
  const last = slice.charCodeAt(maxChars - 1)
  // Drop lone high surrogate so we never cut mid-pair.
  if (last >= 0xd800 && last <= 0xdbff) {
    slice = slice.slice(0, -1)
  }
  return slice
}

const SLIPPED_SUMMARY_CLOSE = '</summary>'
const SLIPPED_MESSAGE_OPENER_BARE = '<parameter name="message">'
const SLIPPED_MESSAGE_OPENER_NS = '<antml:parameter name="message">'
const SLIPPED_UNREPAIRED_MARKUP_RE =
  /<(?:antml:)?parameter\b|<\/(?:antml:)?(?:parameter|invoke|function_calls|message)>/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** densable `fp`/`Cs` — first line, or the whole string if no `\n`. */
function firstLineOf(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

/** densable `fqS` — extracted message looks like a JSON object/array. */
function isSlippedJsonPayload(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

type SlippedOpenerForm = 'bare' | 'namespaced'
type SlippedUnrepaired = 'markup' | 'json'

type SlippedSummaryDetection = {
  split: { summary: string; message: string; openerForm: SlippedOpenerForm }
  unrepaired: SlippedUnrepaired | undefined
}

/**
 * densable U4f — detect a message that slipped past a `</summary>` closer
 * into the summary field (`message` absent/null; keys ⊆ dqS).
 */
function detectSlippedSummary(
  raw: unknown,
): SlippedSummaryDetection | undefined {
  if (!isPlainObject(raw)) return
  const { message, summary } = raw
  if (
    typeof raw.to !== 'string' ||
    (message !== undefined && message !== null) ||
    typeof summary !== 'string' ||
    !Object.keys(raw).every(key => SEND_MESSAGE_PARAM_SET.has(key))
  ) {
    return
  }
  let closer = summary.indexOf(SLIPPED_SUMMARY_CLOSE)
  while (closer !== -1) {
    let cursor = closer + SLIPPED_SUMMARY_CLOSE.length
    while (cursor < summary.length && /\s/.test(summary.charAt(cursor))) {
      cursor++
    }
    const openerForm: SlippedOpenerForm | undefined = summary.startsWith(
      SLIPPED_MESSAGE_OPENER_NS,
      cursor,
    )
      ? 'namespaced'
      : summary.startsWith(SLIPPED_MESSAGE_OPENER_BARE, cursor)
        ? 'bare'
        : undefined
    if (openerForm !== undefined) {
      const opener =
        openerForm === 'namespaced'
          ? SLIPPED_MESSAGE_OPENER_NS
          : SLIPPED_MESSAGE_OPENER_BARE
      const slipped = summary.slice(cursor + opener.length).trimEnd()
      if (slipped.trim().length === 0) return
      return {
        split: {
          summary: summary.slice(0, closer).trim(),
          message: slipped,
          openerForm,
        },
        unrepaired: SLIPPED_UNREPAIRED_MARKUP_RE.test(slipped)
          ? 'markup'
          : isSlippedJsonPayload(slipped)
            ? 'json'
            : undefined,
      }
    }
    closer = summary.indexOf(
      SLIPPED_SUMMARY_CLOSE,
      closer + SLIPPED_SUMMARY_CLOSE.length,
    )
  }
  return
}

/**
 * densable bMi — repaired slipped split only (`unrepaired === undefined`).
 * backfillObservableInput returns early when this is defined.
 */
export function getRepairedSlippedSummarySplit(
  raw: unknown,
):
  | { summary: string; message: string; openerForm: SlippedOpenerForm }
  | undefined {
  const detected = detectSlippedSummary(raw)
  return detected !== undefined && detected.unrepaired === undefined
    ? detected.split
    : undefined
}

/** densable QTl — `isSlippedSummarySplitEnabled` / `tengu_deep_feather` default true. */
export function isSlippedSummarySplitEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_deep_feather', true)
}

/**
 * densable vMi (236: yEi) — coerceInput.
 * applySplit default true (official `t=!0`); tool wires `QTl()`.
 */
export function coerceSendMessageInput(
  raw: unknown,
  { applySplit = true }: { applySplit?: boolean } = {},
): { input: Input; shapeClass: string } | null {
  if (!isPlainObject(raw)) return null
  let message = raw.message
  let summary = raw.summary
  const ops: string[] = []
  const detected = detectSlippedSummary(raw)
  const split = detected?.unrepaired === undefined ? detected?.split : undefined
  if (split !== undefined && applySplit) {
    message = split.message
    summary = split.summary
    ops.push(`split_slipped_summary_${split.openerForm}`)
  }
  if (
    typeof message === 'string' &&
    (typeof summary !== 'string' || summary.trim().length === 0)
  ) {
    const derived = firstLineOf(message.trim()).trim()
    if (derived.length > 0) {
      summary = derived
      ops.push('derive_summary')
    }
  }
  if (
    typeof summary === 'string' &&
    summary.length > SEND_MESSAGE_SUMMARY_MAX_CHARS
  ) {
    summary =
      truncateSummaryChars(summary, SEND_MESSAGE_SUMMARY_MAX_CHARS - 1) + '…'
    ops.push('truncate_summary')
  }
  const firstOp = ops[0]
  const shapeClass =
    detected?.unrepaired !== undefined
      ? `split_slipped_summary_${detected.split.openerForm}_unrepaired_${detected.unrepaired}`
      : split !== undefined && !applySplit
        ? `split_slipped_summary_${split.openerForm}_detect_only`
        : firstOp
  if (shapeClass === undefined) return null
  return {
    input: {
      ...(raw as Input),
      ...(message !== undefined && { message: message as Input['message'] }),
      summary: summary as Input['summary'],
    },
    shapeClass,
  }
}

/** densable jTl = fle+GRw (GRw=100); fle=200 → 300, same numeric cap as Agf. */
const SEND_MESSAGE_REQUEST_ID = z
  .string()
  .min(1, 'must be the request id being responded to')
  .regex(SEND_MESSAGE_TO_SINGLE_LINE_RE, 'must be a single-line request id')
  .regex(
    SEND_MESSAGE_TO_MAX_RE,
    `request id longer than any real one (max ${SEND_MESSAGE_TO_MAX_CHARS} characters)`,
  )

/** densable KRw */
const StructuredMessage = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('shutdown_request'),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('shutdown_response'),
      request_id: SEND_MESSAGE_REQUEST_ID,
      approve: semanticBoolean(),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('plan_approval_response'),
      request_id: SEND_MESSAGE_REQUEST_ID,
      approve: semanticBoolean(),
      feedback: z.string().optional(),
    }),
  ]),
)

const PLAIN_TEXT_MESSAGE = z.string().describe('Plain text message content')

/** densable idle_notification / teammate_terminated / task_* / shutdown_rejected */
const TEAMMATE_LIFECYCLE_FRAME_TYPES = new Set([
  'idle_notification',
  'teammate_terminated',
  'task_assignment',
  'task_completed',
  'shutdown_rejected',
])

function isTeammateLifecycleFrame(message: string): boolean {
  try {
    const parsed = jsonParse(message)
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      'type' in parsed &&
      typeof parsed.type === 'string' &&
      TEAMMATE_LIFECYCLE_FRAME_TYPES.has(parsed.type)
    )
  } catch {
    return false
  }
}

/**
 * densable E0m(uds) + FTl:
 *   T0m = E0m(true)  UDS + teams (union + default "")
 *   A0m = E0m(false) teams, no UDS (union)
 *   XRw = T0m.extend({message: string.default("")})  UDS, no teams
 *   YRw = A0m.extend({message: string})              no UDS, no teams
 * Do not call feature() in here — Bun forbids it inside lazySchema arrows.
 */
function sendMessageObjectSchema(uds: boolean, teams: boolean) {
  const toDesc = uds
    ? `Recipient: a name from ${LIST_AGENTS_TOOL_NAME} (append its " [ref]" only when a listing or an error shows one), a teammate name, "main", or a background agent's agentId`
    : 'Recipient: teammate name'
  const unionMessage = z.union([PLAIN_TEXT_MESSAGE, StructuredMessage()])
  const message = teams
    ? uds
      ? unionMessage.optional().default('')
      : unionMessage
    : uds
      ? PLAIN_TEXT_MESSAGE.default('')
      : PLAIN_TEXT_MESSAGE
  return z.object({
    // densable 2.1.234 #11 / SEA kgf: b4a single-line + bVv unicode max Agf=300
    to: z
      .string()
      .regex(
        SEND_MESSAGE_TO_SINGLE_LINE_RE,
        'must be a single-line recipient name or address',
      )
      .regex(
        SEND_MESSAGE_TO_MAX_RE,
        `recipient longer than any listed name or address (max ${SEND_MESSAGE_TO_MAX_CHARS} characters)`,
      )
      .describe(toDesc),
    // densable 2.1.239 E0m summary describe — no longer "required when message is a string"
    summary: z
      .string()
      .max(SEND_MESSAGE_SUMMARY_MAX_CHARS)
      .optional()
      .describe(
        `A 5-10 word summary shown as a one-line preview in the UI. Defaults to the first line of a plain-text message; longer summaries are truncated to ${SEND_MESSAGE_SUMMARY_MAX_CHARS} characters rather than rejected.`,
      ),
    message,
    ...(uds
      ? {
          notify_when_idle: semanticBoolean(z.boolean().optional()).describe(
            'Ask a session ON THIS MACHINE to send you ONE notice when it next goes idle (finishes its turn with nothing queued) or exits — opt-in, one-shot, no polling. With a message: deliver it now AND subscribe. Without a message (omit it): a pure subscription that costs the other session nothing.',
          ),
        }
      : {}),
  })
}

const sendMessageInputSchemaUdsTeams = lazySchema(() =>
  sendMessageObjectSchema(true, true),
)
const sendMessageInputSchemaUdsPlain = lazySchema(() =>
  sendMessageObjectSchema(true, false),
)
const sendMessageInputSchemaTeams = lazySchema(() =>
  sendMessageObjectSchema(false, true),
)
const sendMessageInputSchemaPlain = lazySchema(() =>
  sendMessageObjectSchema(false, false),
)

type InputSchema = ReturnType<typeof sendMessageInputSchemaUdsTeams>

export type Input = z.infer<InputSchema>

export type MessageRouting = {
  sender: string
  senderColor?: string
  target: string
  targetColor?: string
  summary?: string
  content?: string
}

export type MessageOutput = {
  success: boolean
  message: string
  routing?: MessageRouting
  /** densable aqy — present only when mailbox write succeeded. */
  msg_id?: string
  /** densable errorClass — e.g. mailbox_write_failed / not_reachable. */
  errorClass?: string
  /**
   * densable agent-stopped resume: when the lifecycle was not awaited to a
   * finalText (async bg resume), expose the agent id for follow-up if the
   * task is unowned / owned by main.
   */
  resumedAgentId?: string
}

export type BroadcastOutput = {
  success: boolean
  message: string
  recipients: string[]
  routing?: MessageRouting
  errorClass?: string
}

export type RequestOutput = {
  success: boolean
  message: string
  request_id: string
  target: string
  errorClass?: string
}

export type ResponseOutput = {
  success: boolean
  message: string
  request_id?: string
  /** densable: shutdown-approval continues exit even if mailbox write failed. */
  degradedClass?: string
  errorClass?: string
}

export type SendMessageToolOutput =
  | MessageOutput
  | BroadcastOutput
  | RequestOutput
  | ResponseOutput

const UDS_INLINE_TOKEN_MARKER = '#token='

function stripInlineUdsToken(target: string): string {
  const markerIndex = target.indexOf(UDS_INLINE_TOKEN_MARKER)
  return markerIndex === -1 ? target : target.slice(0, markerIndex)
}

function hasInlineUdsToken(to: string): boolean {
  const addr = parseAddress(to)
  // Empty-token markers are still inline-token attempts. Observable input
  // redaction preserves "#token=" so cloned inputs remain rejected.
  return addr.scheme === 'uds' && addr.target.includes(UDS_INLINE_TOKEN_MARKER)
}

/** densable LPi — `"true"`/`"false"` literals, otherwise the value as-is. */
function lpi(value: unknown): unknown {
  return value === 'true' ? true : value === 'false' ? false : value
}

/** densable fWt / S$t — notify_when_idle present and LPi-true. */
function wantsNotifyWhenIdle(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false
  if (!('notify_when_idle' in input)) return false
  return (
    lpi((input as { notify_when_idle?: unknown }).notify_when_idle) === true
  )
}

export type OriginalSendMessageToolUseFields = {
  message: unknown
  notify_when_idle: unknown
}

/**
 * Official x0m / i$f — raw tool_use fields after vMi
 * (`o=vMi(n,{applySplit:QTl()}); i=o!==null&&jo(o.input)?o.input:n`).
 */
export function readOriginalSendMessageToolUse(
  assistantMessage: { message?: { content?: unknown } } | undefined,
  toolUseId: string | undefined,
): OriginalSendMessageToolUseFields | undefined {
  if (toolUseId === undefined) return
  const content = assistantMessage?.message?.content
  if (!Array.isArray(content)) return
  const block = content.find(
    (item): item is { type: string; id: string; input?: unknown } =>
      typeof item === 'object' &&
      item !== null &&
      (item as { type?: unknown }).type === 'tool_use' &&
      (item as { id?: unknown }).id === toolUseId,
  )
  if (block === undefined || block.type !== 'tool_use') return
  const raw = block.input
  if (typeof raw !== 'object' || raw === null) return
  const coerced = coerceSendMessageInput(raw, {
    applySplit: isSlippedSummarySplitEnabled(),
  })
  const source =
    coerced !== null && isPlainObject(coerced.input) ? coerced.input : raw
  if (!isPlainObject(source)) return
  return {
    message: 'message' in source ? source.message : undefined,
    notify_when_idle:
      'notify_when_idle' in source ? source.notify_when_idle : undefined,
  }
}

/** Official c3i / GRi. */
export function isNotifyWhenIdleStrippedByHandler(
  input: unknown,
  assistantMessage: { message?: { content?: unknown } } | undefined,
  toolUseId: string | undefined,
): boolean {
  return (
    !wantsNotifyWhenIdle(input) &&
    lpi(
      readOriginalSendMessageToolUse(assistantMessage, toolUseId)
        ?.notify_when_idle,
    ) === true
  )
}

/** Official C0m / blankCallCausedByHandler. */
export function blankCallCausedByHandler(
  input: unknown,
  assistantMessage: { message?: { content?: unknown } } | undefined,
  toolUseId: string | undefined,
): boolean {
  if (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as { message?: unknown }).message === 'string' &&
    (input as { message: string }).message.trim().length > 0
  ) {
    return false
  }
  const original = readOriginalSendMessageToolUse(assistantMessage, toolUseId)
  return (
    (typeof original?.message === 'string' &&
      original.message.trim().length > 0) ||
    isNotifyWhenIdleStrippedByHandler(input, assistantMessage, toolUseId)
  )
}

/** Official QRw */
export const HANDLER_EMPTIED_MESSAGE_NO_REINTERPRET =
  'A permission handler emptied this message; nothing was sent, and no idle subscription was made (a blanked delivery is never reinterpreted as a pure subscription — send notify_when_idle without a message if that is what you want).'

/** Official eIw */
export const HANDLER_EMPTIED_MESSAGE =
  'A permission handler emptied this message; nothing was sent, and no idle subscription was made.'

/** Official R0m */
export const HANDLER_REWROTE_NOTHING_LEFT =
  'A permission handler rewrote this call so that nothing was left to send or subscribe; nothing was sent.'

const MESSAGE_MUST_NOT_BE_EMPTY = 'message must not be empty'

type UdsBlankGateResult = { data: { success: false; message: string } }

/**
 * Official GTl / udsBlankMessageGate.
 * `notify` is UTl.notify (wanted and not principal-refused).
 */
export function udsBlankMessageGate(args: {
  input: unknown
  plainMessage: string
  notify: boolean
  refusedForPrincipal: boolean
  assistantMessage: { message?: { content?: unknown } } | undefined
  toolUseId: string | undefined
  emit: (route: 'uds', errorClass: string) => void
}): UdsBlankGateResult | undefined {
  if (args.plainMessage.trim().length > 0) return
  if (
    blankCallCausedByHandler(args.input, args.assistantMessage, args.toolUseId)
  ) {
    args.emit('uds', 'handler_rewrite')
    if (wantsNotifyWhenIdle(args.input)) {
      return {
        data: {
          success: false,
          message: args.refusedForPrincipal
            ? HANDLER_EMPTIED_MESSAGE
            : HANDLER_EMPTIED_MESSAGE_NO_REINTERPRET,
        },
      }
    }
    return { data: { success: false, message: HANDLER_REWROTE_NOTHING_LEFT } }
  }
  if (!args.notify) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const idle =
      require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (args.refusedForPrincipal) {
      idle.noteSubscribeRefusedPrincipal()
    }
    args.emit(
      'uds',
      args.refusedForPrincipal ? 'permission_denied' : 'empty_message',
    )
    return {
      data: {
        success: false,
        message: args.refusedForPrincipal
          ? idle.NOTIFY_WHEN_IDLE_MAIN_ONLY
          : MESSAGE_MUST_NOT_BE_EMPTY,
      },
    }
  }
  return
}

function emitUdsBlankGate(route: 'uds', errorClass: string): void {
  logForDebugging(`[send_message_delivery] ${route} ${errorClass}`)
}

function classifyUdsIdleFlags(
  input: unknown,
  context: ToolUseContext,
): { notify: boolean; refusedForPrincipal: boolean } {
  const wanted = wantsNotifyWhenIdle(input)
  const refusedForPrincipal =
    wanted && isNotifyWhenIdlePrincipalRefused(context)
  return { notify: wanted && !refusedForPrincipal, refusedForPrincipal }
}

function applyUdsBlankMessageGate(
  input: unknown,
  plainMessage: string,
  context: ToolUseContext,
  assistantMessage: { message?: { content?: unknown } } | undefined,
): UdsBlankGateResult | undefined {
  const flags = classifyUdsIdleFlags(input, context)
  return udsBlankMessageGate({
    input,
    plainMessage,
    notify: flags.notify,
    refusedForPrincipal: flags.refusedForPrincipal,
    assistantMessage,
    toolUseId: context.toolUseId,
    emit: emitUdsBlankGate,
  })
}

function appendHandlerStrippedIdleNote(message: string): string {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const idle =
    require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  idle.noteSubscribeStrippedByHandler()
  return `${message}\n${idle.NO_IDLE_SUB_HANDLER_STRIPPED_EITHER}`
}

/** densable VRi — main conversation only (not subagent / teammate). */
function isNotifyWhenIdlePrincipalRefused(context: ToolUseContext): boolean {
  if (context.agentId !== undefined) return true
  if (getAgentContext()?.agentType === 'teammate') return true
  if (isTeammate()) return true
  return false
}

function plainMessageText(message: Input['message']): string {
  return typeof message === 'string' ? message : ''
}

/**
 * densable subscribe after optional UDS text delivery.
 * Restricts to on-this-machine UDS targets (U2f).
 */
async function maybeSubscribePeerIdle(opts: {
  to: string
  socketPath: string
  displayLabel?: string
  fromMode?: 'bypass' | 'prompting'
  context: ToolUseContext
}): Promise<{
  ok: boolean
  modelLine: string
  displayLine: string
  errorClass?: string
  degradedClass?: string
}> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const idle =
    require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
  /* eslint-enable @typescript-eslint/no-require-imports */

  if (isNotifyWhenIdlePrincipalRefused(opts.context)) {
    return {
      ok: false,
      modelLine: idle.NOTIFY_WHEN_IDLE_MAIN_ONLY,
      displayLine: idle.NO_IDLE_SUB_MAIN_ONLY,
      errorClass: 'permission_denied',
    }
  }

  let peerRecord: { pid?: number; features?: string[] } | null = null
  try {
    const { listLiveSessionRecords } =
      require('src/utils/concurrentSessions.js') as typeof import('src/utils/concurrentSessions.js')
    const live = await listLiveSessionRecords()
    const hit = live.find(r => r.messagingSocketPath === opts.socketPath)
    if (hit) {
      peerRecord = {
        pid: hit.pid,
        ...(hit.features !== undefined ? { features: hit.features } : {}),
      }
    }
  } catch {
    peerRecord = null
  }

  const result = await idle.subscribeToPeerIdle(opts.socketPath, {
    fromMode: opts.fromMode,
    label: opts.displayLabel ?? opts.to,
    peerRecord,
    peerRegistryReadable: peerRecord != null,
  })
  const modelLine = result.ok
    ? idle.idleSubscribedLine(
        opts.displayLabel ?? opts.to,
        result.peerKnownCapable,
      )
    : idle.idleSubscribeFailedLine(result)
  const displayLine = idle.idleSubscribeDisplayLine(
    opts.displayLabel ?? opts.to,
    result,
  )
  if (result.ok) {
    return { ok: true, modelLine, displayLine }
  }
  const cls = idle.idleSubscribeErrorClass(result.reason)
  const degraded =
    result.reason === 'send-uncertain' ||
    result.reason === 'requester-refuses-inbound' ||
    result.reason === 'cap'
  return {
    ok: false,
    modelLine,
    displayLine,
    ...(degraded ? { degradedClass: cls } : { errorClass: cls }),
  }
}

/** Peer body envelope tag. */
const AGENT_MESSAGE_TAG = 'agent-message'

/**
 * Refuse delivery when recipient is a background observer (or its observer
 * status cannot be verified from sidecar).
 */
const OBSERVER_RECIPIENT_REFUSE = {
  data: {
    success: false as const,
    message:
      'That agent cannot receive messages (it is a background observer, or its status could not be verified).',
  },
}

/**
 * agent-live|stopped|evicted gate: refuse observer recipients (task id,
 * live task, or sidecar metadata). Unreadable metadata also refuses.
 */
async function refuseIfObserverRecipient(
  agentId: string,
  task: unknown,
): Promise<typeof OBSERVER_RECIPIENT_REFUSE | null> {
  if (isObserverTaskId(agentId) || isObserverAgentTask(task)) {
    return OBSERVER_RECIPIENT_REFUSE
  }
  try {
    const meta = await readAgentMetadata(asAgentId(agentId))
    if (meta?.isObserver === true) {
      return OBSERVER_RECIPIENT_REFUSE
    }
  } catch {
    // meta unreadable → refuse (cannot verify non-observer)
    return OBSERVER_RECIPIENT_REFUSE
  }
  return null
}

/**
 * Escape raw `<agent-message` openers inside body so nested envelopes
 * cannot break the outer tag.
 */
function escapeAgentMessageBody(text: string): string {
  return text.replace(
    new RegExp(`<(?=/?${AGENT_MESSAGE_TAG}(?:[>\\s/]|$))`, 'gi'),
    '<\\',
  )
}

/**
 * Sanitize display name for origin.name (max 64 graphemes).
 */
function sanitizePeerOriginName(name: string): string {
  const cleaned = name.replace(/[\p{Cf}\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/gu, '').trim()
  const chars = [...cleaned]
  return chars.length > 64 ? `${chars.slice(0, 64).join('')}…` : cleaned
}

/**
 * Resolve human-readable sender label for peer origin.
 *
 * Order:
 *   1. ALS agentContext teammate + agentName (teammates under runWithAgentContext)
 *   2. agentNameRegistry reverse lookup
 *   3. local_agent task.agentType
 *   4. in-process teammate task.identity.agentName
 *   5. raw agent id
 *
 * Exported for unit tests.
 */
export function resolveSenderDisplayName(
  context: ToolUseContext,
  senderAgentId: string,
): string {
  // Prefer ALS when the running agent is a teammate (SendMessage from
  // in-process/tmux teammate loop). Live identity even when registry/task lag.
  const agentCtx = getAgentContext()
  if (
    agentCtx?.agentType === 'teammate' &&
    typeof agentCtx.agentName === 'string' &&
    agentCtx.agentName.length > 0
  ) {
    return agentCtx.agentName
  }

  const appState = context.getAppState()
  for (const [name, id] of appState.agentNameRegistry) {
    if (id === senderAgentId) return name
  }
  const task = appState.tasks[senderAgentId]
  if (isLocalAgentTask(task) && typeof task.agentType === 'string') {
    return task.agentType
  }
  if (
    isInProcessTeammateTask(task) &&
    typeof task.identity?.agentName === 'string'
  ) {
    return task.identity.agentName
  }
  return senderAgentId
}

/**
 * Wrap plain text in <agent-message from="…"> when peer-sent.
 */
function wrapAgentMessageEnvelope(from: string, message: string): string {
  const safeFrom = from.replace(/"/g, '')
  return `<${AGENT_MESSAGE_TAG} from="${safeFrom}">\n${escapeAgentMessageBody(message)}\n</${AGENT_MESSAGE_TAG}>`
}

/**
 * Peer when context.agentId (sender task) is set; else coordinator.
 * Main-thread SendMessage has no agentId → coordinator.
 */
function resolveSendMessageOriginAndBody(
  context: ToolUseContext,
  message: string,
): {
  origin:
    | { kind: 'coordinator' }
    | {
        kind: 'peer'
        from: string
        senderTaskId: string
        name?: string
        body: string
      }
  body: string
} {
  const senderTaskId = context.agentId
  if (!senderTaskId) {
    return { origin: { kind: 'coordinator' }, body: message }
  }
  const from = resolveSenderDisplayName(context, senderTaskId)
  const name = sanitizePeerOriginName(from)
  const bodyEscaped = escapeAgentMessageBody(message)
  return {
    origin: {
      kind: 'peer',
      from,
      senderTaskId,
      ...(name ? { name } : {}),
      body: bodyEscaped,
    },
    body: wrapAgentMessageEnvelope(from, message),
  }
}

function recipientForDisplay(to: string): string {
  const addr = parseAddress(to)
  if (addr.scheme !== 'uds') return to
  return `uds:${stripInlineUdsToken(addr.target)}`
}

function redactInlineUdsTokenForRejection(to: string): string {
  const addr = parseAddress(to)
  if (addr.scheme !== 'uds') return to
  const markerIndex = addr.target.indexOf(UDS_INLINE_TOKEN_MARKER)
  if (markerIndex === -1) return to
  return `uds:${addr.target.slice(0, markerIndex)}${UDS_INLINE_TOKEN_MARKER}`
}

function redactObservableInlineUdsToken(input: { to: string }): void {
  if (!hasInlineUdsToken(input.to)) return
  input.to = redactInlineUdsTokenForRejection(input.to)
}

function findTeammateColor(
  appState: {
    teamContext?: { teammates: { [id: string]: { color?: string } } }
  },
  name: string,
): string | undefined {
  const teammates = appState.teamContext?.teammates
  if (!teammates) return undefined
  for (const teammate of Object.values(teammates)) {
    if ('name' in teammate && (teammate as { name: string }).name === name) {
      return teammate.color
    }
  }
  return undefined
}

async function handleMessage(
  recipientName: string,
  content: string,
  summary: string | undefined,
  context: ToolUseContext,
): Promise<{ data: MessageOutput }> {
  const appState = context.getAppState()
  const teamName = getTeamName(appState.teamContext)
  const senderName =
    getAgentName() || (isTeammate() ? 'teammate' : TEAM_LEAD_NAME)
  const senderColor = getTeammateColor()

  // densable dO → msg_id | undefined; only success when write lands.
  const msgId = await writeToMailbox(
    recipientName,
    {
      from: senderName,
      text: content,
      summary,
      timestamp: new Date().toISOString(),
      color: senderColor,
    },
    teamName,
  )

  if (msgId === undefined) {
    return {
      data: {
        success: false,
        message: `Failed to write to ${recipientName}'s inbox — nothing was sent. Try again, or message the lead.`,
        errorClass: 'mailbox_write_failed',
      },
    }
  }

  const recipientColor = findTeammateColor(appState, recipientName)

  // densable vKg: routing.content = Bs(t, 50) — full body lives only in the
  // mailbox write above; tool_result / replay must not re-embed the whole message.
  return {
    data: {
      success: true,
      message: `Message sent to ${recipientName}'s inbox`,
      msg_id: msgId,
      routing: {
        sender: senderName,
        senderColor,
        target: `@${recipientName}`,
        targetColor: recipientColor,
        summary,
        content: truncate(content, 50),
      },
    },
  }
}

async function handleBroadcast(
  content: string,
  summary: string | undefined,
  context: ToolUseContext,
): Promise<{ data: BroadcastOutput }> {
  const appState = context.getAppState()
  const teamName = getTeamName(appState.teamContext)

  if (!teamName) {
    throw new Error(
      'Not in a team context. Create a team with Teammate spawnTeam first, or set CLAUDE_CODE_TEAM_NAME.',
    )
  }

  const teamFile = await readTeamFileAsync(teamName)
  if (!teamFile) {
    throw new Error(`Team "${teamName}" does not exist`)
  }

  const senderName =
    getAgentName() || (isTeammate() ? 'teammate' : TEAM_LEAD_NAME)
  if (!senderName) {
    throw new Error(
      'Cannot broadcast: sender name is required. Set CLAUDE_CODE_AGENT_NAME.',
    )
  }

  const senderColor = getTeammateColor()

  const recipients: string[] = []
  for (const member of teamFile.members) {
    if (member.name.toLowerCase() === senderName.toLowerCase()) {
      continue
    }
    recipients.push(member.name)
  }

  if (recipients.length === 0) {
    return {
      data: {
        success: true,
        message: 'No teammates to broadcast to (you are the only team member)',
        recipients: [],
      },
    }
  }

  const delivered: string[] = []
  const failed: string[] = []
  for (const recipientName of recipients) {
    const msgId = await writeToMailbox(
      recipientName,
      {
        from: senderName,
        text: content,
        summary,
        timestamp: new Date().toISOString(),
        color: senderColor,
      },
      teamName,
    )
    if (msgId === undefined) {
      failed.push(recipientName)
    } else {
      delivered.push(recipientName)
    }
  }

  if (delivered.length === 0) {
    return {
      data: {
        success: false,
        message: `Failed to write broadcast to any teammate inbox — nothing was sent. Try again.`,
        recipients: [],
        errorClass: 'mailbox_write_failed',
      },
    }
  }

  // densable: same Bs(…, 50) preview on routing as unicast (token savings in
  // tool_result / replayed history). Partial deliver still reports who got it.
  const partialNote =
    failed.length > 0 ? ` (${failed.length} failed: ${failed.join(', ')})` : ''
  return {
    data: {
      success: true,
      message: `Message broadcast to ${delivered.length} teammate(s): ${delivered.join(', ')}${partialNote}`,
      recipients: delivered,
      routing: {
        sender: senderName,
        senderColor,
        target: '@team',
        summary,
        content: truncate(content, 50),
      },
      ...(failed.length > 0 ? { errorClass: 'mailbox_write_failed' } : {}),
    },
  }
}

async function handleShutdownRequest(
  targetName: string,
  reason: string | undefined,
  context: ToolUseContext,
): Promise<{ data: RequestOutput }> {
  const appState = context.getAppState()
  const teamName = getTeamName(appState.teamContext)
  const senderName = getAgentName() || TEAM_LEAD_NAME
  const requestId = generateRequestId('shutdown', targetName)

  const shutdownMessage = createShutdownRequestMessage({
    requestId,
    from: senderName,
    reason,
  })

  const msgId = await writeToMailbox(
    targetName,
    {
      from: senderName,
      text: jsonStringify(shutdownMessage),
      timestamp: new Date().toISOString(),
      color: getTeammateColor(),
    },
    teamName,
  )

  if (msgId === undefined) {
    return {
      data: {
        success: false,
        message: `Failed to write the shutdown request to ${targetName}'s inbox — nothing was sent.`,
        request_id: requestId,
        target: targetName,
        errorClass: 'mailbox_write_failed',
      },
    }
  }

  return {
    data: {
      success: true,
      message: `Shutdown request sent to ${targetName}. Request ID: ${requestId}`,
      request_id: requestId,
      target: targetName,
    },
  }
}

async function handleShutdownApproval(
  requestId: string,
  context: ToolUseContext,
): Promise<{ data: ResponseOutput }> {
  const teamName = getTeamName()
  const agentId = getAgentId()
  const agentName = getAgentName() || 'teammate'

  logForDebugging(
    `[SendMessageTool] handleShutdownApproval: teamName=${teamName}, agentId=${agentId}, agentName=${agentName}`,
  )

  let ownPaneId: string | undefined
  let ownBackendType: BackendType | undefined
  if (teamName) {
    const teamFile = await readTeamFileAsync(teamName)
    if (teamFile && agentId) {
      const selfMember = teamFile.members.find(m => m.agentId === agentId)
      if (selfMember) {
        ownPaneId = selfMember.tmuxPaneId
        ownBackendType = selfMember.backendType
      }
    }
  }

  const approvedMessage = createShutdownApprovedMessage({
    requestId,
    from: agentName,
    paneId: ownPaneId,
    backendType: ownBackendType,
  })

  // densable Pqb: still exit on approval; degrade message if mailbox write fails.
  const confirmMsgId = await writeToMailbox(
    TEAM_LEAD_NAME,
    {
      from: agentName,
      text: jsonStringify(approvedMessage),
      timestamp: new Date().toISOString(),
      color: getTeammateColor(),
    },
    teamName,
  )
  const confirmationNote =
    confirmMsgId === undefined
      ? "The confirmation could not be written to team-lead's inbox."
      : 'Sent confirmation to team-lead.'
  const degraded =
    confirmMsgId === undefined
      ? ({ degradedClass: 'mailbox_write_failed' } as const)
      : undefined

  if (ownBackendType === 'in-process') {
    logForDebugging(
      `[SendMessageTool] In-process teammate ${agentName} approving shutdown - signaling abort`,
    )

    if (agentId) {
      const appState = context.getAppState()
      const task = findTeammateTaskByAgentId(agentId, appState.tasks)
      if (task?.abortController) {
        task.abortController.abort()
        logForDebugging(
          `[SendMessageTool] Aborted controller for in-process teammate ${agentName}`,
        )
      } else {
        logForDebugging(
          `[SendMessageTool] Warning: Could not find task/abortController for ${agentName}`,
        )
      }
    }
  } else {
    if (agentId) {
      const appState = context.getAppState()
      const task = findTeammateTaskByAgentId(agentId, appState.tasks)
      if (task?.abortController) {
        logForDebugging(
          `[SendMessageTool] Fallback: Found in-process task for ${agentName} via AppState, aborting`,
        )
        task.abortController.abort()

        return {
          data: {
            success: true,
            message: `Shutdown approved (fallback path). Agent ${agentName} is now exiting.`,
            request_id: requestId,
            ...degraded,
          },
        }
      }
    }

    setImmediate(async () => {
      await gracefulShutdown(0, 'other')
    })
  }

  return {
    data: {
      success: true,
      message: `Shutdown approved. ${confirmationNote} Agent ${agentName} is now exiting.`,
      request_id: requestId,
      ...degraded,
    },
  }
}

async function handleShutdownRejection(
  requestId: string,
  reason: string,
): Promise<{ data: ResponseOutput }> {
  const teamName = getTeamName()
  const agentName = getAgentName() || 'teammate'

  const rejectedMessage = createShutdownRejectedMessage({
    requestId,
    from: agentName,
    reason,
  })

  const msgId = await writeToMailbox(
    TEAM_LEAD_NAME,
    {
      from: agentName,
      text: jsonStringify(rejectedMessage),
      timestamp: new Date().toISOString(),
      color: getTeammateColor(),
    },
    teamName,
  )

  if (msgId === undefined) {
    return {
      data: {
        success: false,
        message:
          "Failed to write the shutdown rejection to team-lead's inbox — nothing was sent. Try again.",
        request_id: requestId,
        errorClass: 'mailbox_write_failed',
      },
    }
  }

  return {
    data: {
      success: true,
      message: `Shutdown rejected. Reason: "${truncate(reason, 50)}". Continuing to work.`,
      request_id: requestId,
    },
  }
}

/**
 * Format a plan_approval_response for local_agent queue/resume delivery.
 * Mirrors densable Ejr wording so the subagent can proceed or revise.
 */
function formatPlanApprovalForLocalAgent(
  approved: boolean,
  requestId: string,
  feedback?: string,
): string {
  if (approved) {
    const base = feedback
      ? `[Plan Approved] ${feedback}`
      : '[Plan Approved] You can now proceed with implementation'
    return `${base} (request_id=${requestId})`
  }
  return `[Plan Rejected] ${feedback || 'Please revise your plan'} (request_id=${requestId})`
}

/**
 * Local fortify over densable (no local_agent mFu): when plan is approved for a
 * local_agent task, stamp selectedAgent.permissionMode so runAgent's live
 * agentGetAppState exits plan tool-set. Reject only queues Ejr text.
 * Teammate path still uses mailbox + mFu/inProcessRunner.
 */
function applyPlanApprovalModeToLocalAgent(
  agentId: string,
  approved: boolean,
  permissionMode: string | undefined,
  setAppState: ToolUseContext['setAppState'],
): void {
  if (!approved) return
  const mode = sanitizeInheritedPermissionMode(permissionMode) as PermissionMode
  setAppState(prev => {
    const t = prev.tasks[agentId]
    if (!isLocalAgentTask(t) || isMainSessionTask(t)) return prev
    const nextSelected = t.selectedAgent
      ? { ...t.selectedAgent, permissionMode: mode }
      : ({ permissionMode: mode } as LocalAgentTaskState['selectedAgent'])
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [agentId]: {
          ...t,
          selectedAgent: nextSelected,
        },
      },
    }
  })
}

/**
 * densable Hco local_agent path: name registry or raw createAgentId →
 * queue when running, resume when stopped/evicted. Returns null when `to`
 * is not a local subagent address (teammate names fall through to mailbox).
 */
async function tryDeliverToLocalAgent(
  to: string,
  message: string,
  context: ToolUseContext,
  canUseTool: Parameters<NonNullable<Tool['call']>>[2],
  assistantMessage: Parameters<NonNullable<Tool['call']>>[3],
  planApproval?: {
    approved: boolean
    permissionMode?: string
  },
): Promise<{ data: MessageOutput } | null> {
  if (to === '*' || to === MAIN_RECIPIENT) {
    return null
  }
  const appState = context.getAppState()
  const parsedTo = parseNameRef(to)
  const registeredExact = appState.agentNameRegistry.get(to)
  const registeredBare = parsedTo
    ? appState.agentNameRegistry.get(parsedTo.name)
    : undefined
  // `Name [ref]` only stays local when the ref matches this subagent.
  // Otherwise fall through so a UDS/bridge peer with that listing ref wins.
  if (
    parsedTo &&
    registeredBare &&
    !registeredExact &&
    !listingRefMatchesCandidate(
      { kind: 'subagent', id: registeredBare },
      parsedTo.ref,
    )
  ) {
    return null
  }
  const registered = registeredExact ?? registeredBare
  const agentId = registered ?? toAgentId(parsedTo?.name ?? to)
  if (!agentId) {
    return null
  }
  const task = appState.tasks[agentId]
  if (isLocalAgentTask(task) && !isMainSessionTask(task)) {
    const observerRefuse = await refuseIfObserverRecipient(agentId, task)
    if (observerRefuse) return observerRefuse
    if (task.stoppedByUser) {
      return {
        data: {
          success: false,
          message: `Agent "${to}" was stopped by the user and was not resumed. Treat its work as cancelled; only start a new agent for it if the user explicitly asks.`,
        },
      }
    }
    const setAppState = context.setAppStateForTasks ?? context.setAppState
    // Local fortify: apply mode before queue so next tool round sees new mode.
    if (planApproval) {
      applyPlanApprovalModeToLocalAgent(
        agentId,
        planApproval.approved,
        planApproval.permissionMode,
        setAppState,
      )
    }
    const { origin: sendOrigin, body: sendBody } =
      resolveSendMessageOriginAndBody(context, message)
    if (task.status === 'running') {
      queuePendingMessage(agentId, sendBody, setAppState, {
        isMeta: true,
        origin: sendOrigin,
      })
      return {
        data: {
          success: true,
          message: `Message queued for delivery to ${to} at its next tool round.`,
        },
      }
    }
    try {
      // densable agent-stopped → Y8a = X8a(..., "reply"): awaitCompletion + D5f.
      // No continueInterruptedTurn — always append the SendMessage body and re-run.
      const result = await resumeAgentBackground({
        agentId,
        prompt: sendBody,
        toolUseContext: context,
        canUseTool,
        invokingRequestId: assistantMessage?.requestId as string | undefined,
        promptOrigin: sendOrigin,
        promptIsMeta: true,
        // densable X8a(K="reply") awaits lifecycle → finalText for D5f
        awaitCompletion: true,
      })
      const blockedWait = result.finalText !== undefined
      const after = context.getAppState().tasks[agentId]
      const exposeResumedId =
        !blockedWait &&
        (!isLocalAgentTask(after) ||
          !after.ownerAgentId ||
          after.ownerAgentId === getMainThreadAgentId())
      return {
        data: {
          success: true,
          message: formatResumedAgentMessage(to, result.finalText),
          ...(exposeResumedId ? { resumedAgentId: agentId } : {}),
        },
      }
    } catch (e) {
      return {
        data: {
          success: false,
          message: `Agent "${to}" is stopped (${task.status}) and could not be resumed: ${errorMessage(e)}`,
        },
      }
    }
  }
  if (!task || !isLocalAgentTask(task)) {
    const observerRefuse = await refuseIfObserverRecipient(agentId, task)
    if (observerRefuse) return observerRefuse
    const { origin: sendOrigin, body: sendBody } =
      resolveSendMessageOriginAndBody(context, message)
    try {
      // densable agent-evicted cold path — same Y8a reply await + D5f surface
      const result = await resumeAgentBackground({
        agentId,
        prompt: sendBody,
        toolUseContext: context,
        canUseTool,
        invokingRequestId: assistantMessage?.requestId as string | undefined,
        promptOrigin: sendOrigin,
        promptIsMeta: true,
        awaitCompletion: true,
      })
      const blockedWait = result.finalText !== undefined
      return {
        data: {
          success: true,
          message: formatResumedAgentMessage(to, result.finalText),
          // densable: ...I?{}:{resumedAgentId:S} when no finalText
          ...(!blockedWait ? { resumedAgentId: agentId } : {}),
        },
      }
    } catch (e) {
      return {
        data: {
          success: false,
          message: `Agent "${to}" is registered but has no transcript to resume. It may have been cleaned up. (${errorMessage(e)})`,
        },
      }
    }
  }
  return null
}

async function handlePlanApproval(
  recipientName: string,
  requestId: string,
  context: ToolUseContext,
  feedback?: string,
): Promise<{ data: ResponseOutput }> {
  const appState = context.getAppState()
  const teamName = appState.teamContext?.teamName

  if (!isTeamLead(appState.teamContext)) {
    throw new Error(
      'Only the team lead can approve plans. Teammates cannot approve their own or other plans.',
    )
  }

  const leaderMode = appState.toolPermissionContext.mode
  const modeToInherit = leaderMode === 'plan' ? 'default' : leaderMode

  // densable tQg: include feedback when present
  const approvalResponse = {
    type: 'plan_approval_response',
    requestId,
    approved: true,
    ...(feedback !== undefined ? { feedback } : {}),
    timestamp: new Date().toISOString(),
    permissionMode: modeToInherit,
  }

  const msgId = await writeToMailbox(
    recipientName,
    {
      from: TEAM_LEAD_NAME,
      text: jsonStringify(approvalResponse),
      timestamp: new Date().toISOString(),
    },
    teamName,
  )

  if (msgId === undefined) {
    return {
      data: {
        success: false,
        message: `Failed to write the plan approval to ${recipientName}'s inbox — nothing was sent. Try again.`,
        request_id: requestId,
        errorClass: 'mailbox_write_failed',
      },
    }
  }

  return {
    data: {
      success: true,
      message: `Plan approved for ${recipientName}. They will receive the approval and can proceed with implementation.`,
      request_id: requestId,
    },
  }
}

async function handlePlanRejection(
  recipientName: string,
  requestId: string,
  feedback: string,
  context: ToolUseContext,
): Promise<{ data: ResponseOutput }> {
  const appState = context.getAppState()
  const teamName = appState.teamContext?.teamName

  if (!isTeamLead(appState.teamContext)) {
    throw new Error(
      'Only the team lead can reject plans. Teammates cannot reject their own or other plans.',
    )
  }

  const rejectionResponse = {
    type: 'plan_approval_response',
    requestId,
    approved: false,
    feedback,
    timestamp: new Date().toISOString(),
  }

  const msgId = await writeToMailbox(
    recipientName,
    {
      from: TEAM_LEAD_NAME,
      text: jsonStringify(rejectionResponse),
      timestamp: new Date().toISOString(),
    },
    teamName,
  )

  if (msgId === undefined) {
    return {
      data: {
        success: false,
        message: `Failed to write the plan rejection to ${recipientName}'s inbox — nothing was sent. Try again.`,
        request_id: requestId,
        errorClass: 'mailbox_write_failed',
      },
    }
  }

  return {
    data: {
      success: true,
      message: `Plan rejected for ${recipientName} with feedback: "${feedback}"`,
      request_id: requestId,
    },
  }
}

export const SendMessageTool: Tool<InputSchema, SendMessageToolOutput> =
  buildTool({
    name: SEND_MESSAGE_TOOL_NAME,
    searchHint:
      'send message to teammate agent, broadcast, inter-agent communication, swarm messaging, agent coordination',
    maxResultSizeChars: 100_000,

    userFacingName() {
      return 'SendMessage'
    },

    get inputSchema(): InputSchema {
      // densable FTl: rg()=UDS_INBOX, xd()=isAgentSwarmsEnabled
      if (feature('UDS_INBOX')) {
        return (
          isAgentSwarmsEnabled()
            ? sendMessageInputSchemaUdsTeams()
            : sendMessageInputSchemaUdsPlain()
        ) as InputSchema
      }
      return (
        isAgentSwarmsEnabled()
          ? sendMessageInputSchemaTeams()
          : sendMessageInputSchemaPlain()
      ) as InputSchema
    },
    shouldDefer: true,
    alwaysLoad: isAgentSwarmsEnabled(),

    isEnabled() {
      return true
    },

    isReadOnly(input) {
      return typeof input.message === 'string'
    },

    // densable vMi — coerceInput:(e)=>vMi(e,{applySplit:QTl()})
    coerceInput: input =>
      coerceSendMessageInput(input, {
        applySplit: isSlippedSummarySplitEnabled(),
      }),

    // densable xKg.backfillObservableInput: content/reason/feedback via Bs(…, 50)
    // so telemetry / observable clones never carry the full message body.
    backfillObservableInput(input) {
      if (typeof input.to !== 'string') return

      redactObservableInlineUdsToken(input as { to: string })
      if ('type' in input) return
      // densable bMi: skip observable backfill on a repaired slipped summary
      // (message still empty; type=message would preview the unsplit blob).
      if (getRepairedSlippedSummarySplit(input) !== undefined) return

      if (input.to === '*') {
        input.type = 'broadcast'
        if (typeof input.message === 'string') {
          input.content = truncate(input.message, 50)
        }
      } else if (typeof input.message === 'string') {
        input.type = 'message'
        input.recipient = recipientForDisplay(input.to)
        input.content = truncate(input.message, 50)
      } else if (typeof input.message === 'object' && input.message !== null) {
        const msg = input.message as {
          type?: string
          request_id?: string
          approve?: boolean
          reason?: string
          feedback?: string
        }
        input.type = msg.type
        input.recipient = recipientForDisplay(input.to)
        if (msg.request_id !== undefined) input.request_id = msg.request_id
        if (msg.approve !== undefined) input.approve = msg.approve
        const content = msg.reason ?? msg.feedback
        if (content !== undefined) input.content = truncate(content, 50)
      }
    },

    toAutoClassifierInput(input) {
      const recipient = recipientForDisplay(input.to)
      if (typeof input.message === 'string') {
        return `to ${recipient}: ${input.message}`
      }
      switch (input.message.type) {
        case 'shutdown_request':
          return `shutdown_request to ${recipient}`
        case 'shutdown_response':
          return `shutdown_response ${input.message.approve ? 'approve' : 'reject'} ${input.message.request_id}`
        case 'plan_approval_response':
          return `plan_approval ${input.message.approve ? 'approve' : 'reject'} to ${recipient}`
      }
    },

    async checkPermissions(input, context) {
      // Local safety (feature-gated OFF by default): bridge/LAN still ask.
      // densable SEA core for SendMessage is only Pjs passthrough — no bridge/LAN.
      if (feature('UDS_INBOX') && parseAddress(input.to).scheme === 'bridge') {
        // densable: via==="remote-control" && H9b() → deny P9b (cloud → elevated RC).
        if (isRemoteControlPeerUnreachableFromHere()) {
          return {
            behavior: 'deny' as const,
            message: formatUnreachableElevatedRefusal(input.to),
            decisionReason: {
              type: 'other',
              reason:
                'target is an elevated-security session unreachable from a cloud session',
            },
          }
        }
        return {
          behavior: 'ask' as const,
          message: `Send a message to Remote Control session ${input.to}? It arrives as a user prompt on the receiving Claude (possibly another machine) via Anthropic's servers.`,
          decisionReason: {
            type: 'safetyCheck',
            reason:
              'Cross-machine bridge message requires explicit user consent',
            classifierApprovable: false,
          },
        }
      }
      if (feature('LAN_PIPES') && parseAddress(input.to).scheme === 'tcp') {
        return {
          behavior: 'ask' as const,
          message: `Send a message to LAN peer ${input.to}? This connects directly over TCP to a machine on your local network.`,
          decisionReason: {
            type: 'safetyCheck',
            reason: 'Cross-machine LAN message requires explicit user consent',
            classifierApprovable: false,
          },
        }
      }
      // densable Pjs(mode): auto || (plan && isAutoModeActive) → classifier passthrough
      const mode = context.getAppState().toolPermissionContext.mode
      if (mode === 'auto' || (mode === 'plan' && isAutoModeActive())) {
        return {
          behavior: 'passthrough' as const,
          message: 'Message to another agent requires classifier review.',
        }
      }
      return { behavior: 'allow' as const, updatedInput: input }
    },

    async validateInput(input, context) {
      // densable Qei(e.to, e_) — empty to / empty bridge|uds target / ELe.
      const qei = validateSendMessageTo(input.to, LIST_AGENTS_TOOL_NAME)
      if (qei !== undefined) {
        return {
          result: false,
          message: qei,
          errorCode: 9,
        }
      }
      const addr = parseAddress(input.to)
      // densable Xen → Jio → VEt on explicit uds targets.
      if (addr.scheme === 'uds') {
        const ownOrFake = refuseOwnOrImpersonatedSocket(
          input.to,
          addr.target,
          context,
        )
        if (ownOrFake) {
          return {
            result: false,
            message: ownOrFake.message,
            errorCode: 9,
          }
        }
      }
      // local tcp: empty-target (official xD has did: not tcp:)
      if (addr.scheme === 'tcp' && addr.target.trim().length === 0) {
        return {
          result: false,
          message: 'address target must not be empty',
          errorCode: 9,
        }
      }
      if (addr.scheme === 'uds' && hasInlineUdsToken(input.to)) {
        return {
          result: false,
          message:
            'uds addresses must not include inline auth tokens; use the ListAgents address',
          errorCode: 9,
        }
      }
      if (input.to.includes('@')) {
        return {
          result: false,
          message:
            'to must be a bare teammate name — there is only one team per session',
          errorCode: 9,
        }
      }

      // densable 2.1.239 k0m: empty string fails before uds/bridge early-return
      // (unless notify_when_idle).
      if (
        typeof input.message === 'string' &&
        input.message.trim().length === 0 &&
        !wantsNotifyWhenIdle(input)
      ) {
        return {
          result: false,
          message: 'message must not be empty',
          errorCode: 9,
        }
      }

      // densable: pure notify_when_idle subscribe may omit message (default "").
      // bridge/tcp hard-refuse only for pure notify; message+notify may deliver
      // text and refuse subscribe later (mailbox/uds shape).
      if (feature('UDS_INBOX') && wantsNotifyWhenIdle(input)) {
        const plain = plainMessageText(input.message)
        const pureNotify = plain.trim().length === 0
        if (pureNotify && (addr.scheme === 'bridge' || addr.scheme === 'tcp')) {
          return {
            result: false,
            message:
              'notify_when_idle is only supported for Claude sessions on this machine in this release (not teammates, subagents, Remote Control or cloud sessions).',
            errorCode: 9,
          }
        }
        if (pureNotify) {
          // Pure subscribe — summary not required.
          return { result: true }
        }
        if (typeof input.message !== 'string') {
          return {
            result: false,
            message:
              'structured messages cannot be sent with notify_when_idle — only plain text (or omit message)',
            errorCode: 9,
          }
        }
      }

      if (feature('UDS_INBOX') && parseAddress(input.to).scheme === 'bridge') {
        // Structured-message rejection first — it's the permanent constraint.
        // Showing "not connected" first would make the user reconnect only to
        // hit this error on retry.
        if (typeof input.message !== 'string') {
          return {
            result: false,
            message:
              'structured messages cannot be sent cross-session — only plain text',
            errorCode: 9,
          }
        }
        // densable 2.1.238 #27 Aom — live handle OR CLAUDE_CODE_REMOTE with
        // a reply address is OK; only local non-RC without live handle is
        // rc-disconnected. Do not invent Desktop handoff.
        const rcBlock = getRemoteControlSendBlockReason()
        if (rcBlock) {
          const reason = formatRemoteControlSendBlock(rcBlock)
          return {
            result: false,
            message:
              rcBlock === 'rc-disconnected'
                ? `${reason} — cannot send to a bridge: target. Reconnect with /remote-control first.`
                : `${reason} — cannot send to a bridge: target.`,
            errorCode: 9,
          }
        }
        return { result: true }
      }
      if (
        feature('UDS_INBOX') &&
        parseAddress(input.to).scheme === 'uds' &&
        typeof input.message === 'string'
      ) {
        return { result: true }
      }
      if (
        feature('LAN_PIPES') &&
        parseAddress(input.to).scheme === 'tcp' &&
        typeof input.message === 'string'
      ) {
        return { result: true }
      }
      if (typeof input.message === 'string') {
        // densable Kwe — protocol frames as text (uds/bridge already returned)
        if (isStructuredProtocolMessage(input.message)) {
          return {
            result: false,
            message:
              'message text must not be a teammate protocol frame (permission/mode/plan/shutdown JSON) — to respond to a plan or shutdown request, use the structured object form ({"message": {"type": ...}}); otherwise send plain text',
            errorCode: 9,
          }
        }
        if (isTeammateLifecycleFrame(input.message)) {
          return {
            result: false,
            message:
              'message text must not be a teammate lifecycle/task frame (idle/terminated/task/shutdown JSON) — send plain text instead',
            errorCode: 9,
          }
        }
        return { result: true }
      }

      if (!isAgentSwarmsEnabled()) {
        return {
          result: false,
          message:
            'Structured team-protocol messages are only available with agent teams enabled.',
          errorCode: 9,
        }
      }

      if (input.to === '*') {
        return {
          result: false,
          message: 'structured messages cannot be broadcast (to: "*")',
          errorCode: 9,
        }
      }
      if (feature('UDS_INBOX') && parseAddress(input.to).scheme !== 'other') {
        return {
          result: false,
          message:
            'structured messages cannot be sent cross-session — only plain text',
          errorCode: 9,
        }
      }

      if (
        input.message.type === 'shutdown_response' &&
        input.to !== TEAM_LEAD_NAME
      ) {
        return {
          result: false,
          message: `shutdown_response must be sent to "${TEAM_LEAD_NAME}"`,
          errorCode: 9,
        }
      }

      if (
        input.message.type === 'shutdown_response' &&
        input.message.approve &&
        input.message.reason !== undefined
      ) {
        return {
          result: false,
          message:
            'reason is only delivered on rejections (approve: false) — approvals are sent as a silent confirmation with no reason text; omit reason or reject instead',
          errorCode: 9,
        }
      }

      if (
        input.message.type === 'shutdown_response' &&
        !input.message.approve &&
        (!input.message.reason || input.message.reason.trim().length === 0)
      ) {
        return {
          result: false,
          message: 'reason is required when rejecting a shutdown request',
          errorCode: 9,
        }
      }

      return { result: true }
    },

    async description() {
      return DESCRIPTION
    },

    async prompt() {
      return getPrompt(isAgentSwarmsEnabled())
    },

    mapToolResultToToolResultBlockParam(data, toolUseID) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: [
          {
            type: 'text' as const,
            text: jsonStringify(data),
          },
        ],
      }
    },

    async call(input, context, canUseTool, assistantMessage) {
      // Call entry: refuse when sender is an observer task.
      // Covers all routes (UDS/bridge/TCP/mailbox/broadcast/local_agent).
      if (context.agentId && isObserverTaskId(context.agentId)) {
        return {
          data: {
            success: false,
            message:
              'Observers report via ObserverReport, not SendMessage. SendMessage is not available from an observer.',
          },
        }
      }

      let notifyIdle = false
      if (feature('UDS_INBOX')) {
        notifyIdle = wantsNotifyWhenIdle(input)
      }
      const plainText = typeof input.message === 'string' ? input.message : null
      const pureIdleSubscribe =
        notifyIdle && (plainText === null || plainText.trim().length === 0)

      if (typeof input.message === 'string' || pureIdleSubscribe) {
        const addr = parseAddress(input.to)
        if (addr.scheme === 'uds' && hasInlineUdsToken(input.to)) {
          return {
            data: {
              success: false,
              message:
                'uds addresses must not include inline auth tokens; use the ListAgents address',
            },
          }
        }
      }

      // densable U2f / VRi — notify_when_idle gates before other delivery.
      if (notifyIdle) {
        const addr = parseAddress(input.to)
        // Pure notify on bridge/tcp: hard refuse (no subscribe invent).
        // Message+notify: fall through so text can deliver; append refuse note.
        if (
          pureIdleSubscribe &&
          (addr.scheme === 'bridge' || addr.scheme === 'tcp')
        ) {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const idle =
            require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
          /* eslint-enable @typescript-eslint/no-require-imports */
          return {
            data: {
              success: false,
              message: idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY,
              errorClass: 'not_reachable',
            },
          }
        }
        if (
          isNotifyWhenIdlePrincipalRefused(context) &&
          pureIdleSubscribe &&
          addr.scheme !== 'uds'
        ) {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const idle =
            require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
          /* eslint-enable @typescript-eslint/no-require-imports */
          return {
            data: {
              success: false,
              message: idle.NOTIFY_WHEN_IDLE_MAIN_ONLY,
              errorClass: 'permission_denied',
            },
          }
        }
        // Pure subscribe on explicit uds: — GTl first (QRw/eIw/R0m vs genuine subscribe).
        if (pureIdleSubscribe && addr.scheme === 'uds') {
          const gated = applyUdsBlankMessageGate(
            input,
            typeof input.message === 'string' ? input.message : '',
            context,
            assistantMessage,
          )
          if (gated !== undefined) return gated
          const sub = await maybeSubscribePeerIdle({
            to: input.to,
            socketPath: addr.target,
            displayLabel: recipientForDisplay(input.to),
            context,
          })
          return {
            data: {
              success: sub.ok,
              message: sub.modelLine,
              ...(sub.errorClass ? { errorClass: sub.errorClass } : {}),
              ...(sub.degradedClass
                ? { degradedClass: sub.degradedClass }
                : {}),
            },
          }
        }
        // C1 — bare-name pure notify: resolve+subscribe only (no empty send).
        if (
          pureIdleSubscribe &&
          addr.scheme === 'other' &&
          input.to !== '*' &&
          input.to !== MAIN_RECIPIENT
        ) {
          /* eslint-disable @typescript-eslint/no-require-imports */
          const udsClient =
            require('src/utils/udsClient.js') as typeof import('src/utils/udsClient.js')
          const bridgePeers =
            require('src/bridge/peerSessions.js') as typeof import('src/bridge/peerSessions.js')
          const idle =
            require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
          /* eslint-enable @typescript-eslint/no-require-imports */
          const [udsPeers, bridgeList, allLive] = await Promise.all([
            udsClient.listPeers(),
            bridgePeers.listBridgePeers(),
            udsClient.listAllLiveSessions(),
          ])
          const candidates = buildPeerCandidates({
            udsPeers,
            bridgePeers: bridgeList,
          })
          const pins = context.getAppState().sendMessagePins ?? {}
          const resolved = resolvePeerByName({
            to: input.to,
            pins,
            candidates,
            localClaimed: localClaimedRemoteBodies(allLive),
          })
          if (resolved.kind === 'refused') {
            return { data: { success: false, message: resolved.message } }
          }
          if (resolved.kind === 'ambiguous') {
            const prefixDee = leftoverOwnNameAmbiguous(
              input.to,
              input.message,
              {
                matchedBy: resolved.matchedBy,
                pinnedIdentityClaimedLocally:
                  resolved.pinnedIdentityClaimedLocally,
              },
              context,
            )
            if (prefixDee.kind === 'dee') {
              return { data: prefixDee.data }
            }
            const qen =
              typeof input.message === 'string'
                ? classifyOwnNameTarget(input.to)
                : 'no'
            let message = formatAmbiguousMessage(
              input.to,
              resolved.candidates,
              {
                pinnedIdentityClaimedLocally:
                  resolved.pinnedIdentityClaimedLocally,
              },
            )
            if (qen !== 'no') {
              message += formatOwnNameAlsoNote(
                input.to,
                callerIsSubagentForSend(context),
              )
            }
            return {
              data: {
                success: false,
                message,
              },
            }
          }
          if (resolved.kind === 'ok') {
            const cand = resolved.candidate
            if (cand.kind === 'bridge-session') {
              return {
                data: {
                  success: false,
                  message: idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY,
                  errorClass: 'not_reachable',
                },
              }
            }
            const gated = applyUdsBlankMessageGate(
              input,
              typeof input.message === 'string' ? input.message : '',
              context,
              assistantMessage,
            )
            if (gated !== undefined) return gated
            const sub = await maybeSubscribePeerIdle({
              to: cand.name,
              socketPath: cand.id,
              displayLabel: cand.name,
              context,
            })
            return {
              data: {
                success: sub.ok,
                message: sub.modelLine,
                ...(sub.errorClass ? { errorClass: sub.errorClass } : {}),
                ...(sub.degradedClass
                  ? { degradedClass: sub.degradedClass }
                  : {}),
              },
            }
          }
          if (resolved.kind === 'not-found') {
            const miss = leftoverOwnNameMiss(
              input.to,
              input.message,
              {
                closest: leftoverClosestPeers(input.to, candidates),
                searchTruncated: resolved.searchTruncated,
              },
              context,
            )
            if (miss.kind === 'dee') {
              return { data: miss.data }
            }
          }
          return {
            data: {
              success: false,
              message: idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY,
              errorClass: 'not_reachable',
            },
          }
        }
      }

      if (
        feature('UDS_INBOX') &&
        typeof input.message === 'string' &&
        input.message.trim().length > 0
      ) {
        const addr = parseAddress(input.to)
        // Explicit uds:/bridge:/tcp: schemes only here.
        // densable gIn bare-name / name [ref] peer resolve runs AFTER local_agent.
        if (addr.scheme === 'bridge') {
          // densable H9b/P9b — cloud session cannot reach elevated RC.
          if (isRemoteControlPeerUnreachableFromHere()) {
            return {
              data: {
                success: false,
                message: formatUnreachableElevatedRefusal(input.to),
              },
            }
          }
          // densable g0m — before posting through Anthropic servers.
          if (!isCrossMachineMessagingAvailable()) {
            return {
              data: {
                success: false,
                message: CROSS_MACHINE_MESSAGING_UNAVAILABLE,
              },
            }
          }
          // densable 2.1.238 #27 — re-check Aom after permission wait.
          const rcBlock = getRemoteControlSendBlockReason()
          if (rcBlock) {
            return {
              data: {
                success: false,
                message:
                  rcBlock === 'rc-disconnected'
                    ? `Remote Control disconnected before send — cannot deliver to ${input.to}`
                    : `${formatRemoteControlSendBlock(rcBlock)} — cannot deliver to ${input.to}`,
              },
            }
          }
          /* eslint-disable @typescript-eslint/no-require-imports */
          const { postInterClaudeMessage } =
            require('src/bridge/peerSessions.js') as typeof import('src/bridge/peerSessions.js')
          /* eslint-enable @typescript-eslint/no-require-imports */
          const result = (await postInterClaudeMessage(
            addr.target,
            input.message,
          )) as { ok: boolean; error?: string }
          const preview = input.summary || truncate(input.message, 50)
          // densable NKp only fires on bare-name / name [ref] resolve success
          // (displayName). Explicit bridge:/uds: scheme paths do NOT pin —
          // address-string keys would pollute sendMessagePins and never match
          // ListAgents names (SEA: only two NKp call sites, both p.displayName).
          if (!result.ok) {
            return {
              data: {
                success: false,
                message: `Failed to send to ${input.to}: ${result.error ?? 'unknown'}`,
              },
            }
          }
          let message = `”${preview}” → ${input.to}`
          // I7 — message+notify on bridge: deliver text, refuse subscribe.
          if (notifyIdle) {
            /* eslint-disable @typescript-eslint/no-require-imports */
            const idle =
              require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
            /* eslint-enable @typescript-eslint/no-require-imports */
            message = `${message}\nNothing was subscribed either: ${idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY}`
          }
          return {
            data: {
              success: true,
              message,
            },
          }
        }
        if (addr.scheme === 'uds') {
          if (typeof input.message === 'string') {
            const gated = applyUdsBlankMessageGate(
              input,
              input.message,
              context,
              assistantMessage,
            )
            if (gated !== undefined) return gated
          }
          const ownOrFake = refuseOwnOrImpersonatedSocket(
            input.to,
            addr.target,
            context,
          )
          if (ownOrFake) {
            return {
              data: {
                success: false,
                message: ownOrFake.message,
                display: ownOrFake.display,
                ...(ownOrFake.kind === 'impersonation'
                  ? { degradedClass: ownOrFake.degradedClass }
                  : {}),
              },
            }
          }
          const recipient = recipientForDisplay(input.to)
          /* eslint-disable @typescript-eslint/no-require-imports */
          const { sendToUdsSocket } =
            require('src/utils/udsClient.js') as typeof import('src/utils/udsClient.js')
          const { permissionModeClassOf, shouldHonorPeerFromMode } =
            require('src/utils/crossSessionInbound.js') as typeof import('src/utils/crossSessionInbound.js')
          /* eslint-enable @typescript-eslint/no-require-imports */
          try {
            // densable Wei: stamp fromMode only when harbor_kite_mode_emit is on.
            const perm = context.getAppState().toolPermissionContext
            const fromMode = shouldHonorPeerFromMode()
              ? permissionModeClassOf({
                  mode: perm.mode,
                  isBypassPermissionsModeAvailable:
                    perm.isBypassPermissionsModeAvailable,
                })
              : undefined
            await sendToUdsSocket(addr.target, input.message, {
              ...(fromMode !== undefined ? { fromMode } : {}),
            })
            const preview = input.summary || truncate(input.message, 50)
            // densable: no NKp on explicit uds: scheme (see bridge branch above).
            // Idle subscribe only after message delivery succeeds.
            if (notifyIdle) {
              if (isNotifyWhenIdlePrincipalRefused(context)) {
                /* eslint-disable @typescript-eslint/no-require-imports */
                const idle =
                  require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
                /* eslint-enable @typescript-eslint/no-require-imports */
                return {
                  data: {
                    success: true,
                    message: `”${preview}” → ${recipient}\nNothing was subscribed either: ${idle.NOTIFY_WHEN_IDLE_MAIN_ONLY}`,
                  },
                }
              }
              const sub = await maybeSubscribePeerIdle({
                to: input.to,
                socketPath: addr.target,
                displayLabel: recipient,
                fromMode,
                context,
              })
              return {
                data: {
                  success: true,
                  message: `”${preview}” → ${recipient}\n${sub.modelLine}`,
                  ...(sub.errorClass ? { errorClass: sub.errorClass } : {}),
                  ...(sub.degradedClass
                    ? { degradedClass: sub.degradedClass }
                    : {}),
                },
              }
            }
            let delivered = `”${preview}” → ${recipient}`
            if (
              isNotifyWhenIdleStrippedByHandler(
                input,
                assistantMessage,
                context.toolUseId,
              )
            ) {
              delivered = appendHandlerStrippedIdleNote(delivered)
            }
            return {
              data: {
                success: true,
                message: delivered,
              },
            }
          } catch (e) {
            // densable yZt → too_large / message_too_large (tFd text already in message)
            /* eslint-disable @typescript-eslint/no-require-imports */
            const idle =
              require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
            /* eslint-enable @typescript-eslint/no-require-imports */
            return {
              data: {
                success: false,
                message: `Failed to send to ${recipient}: ${errorMessage(e)}${
                  notifyIdle
                    ? `\nNothing was subscribed either (when a message rides along, the idle subscription is only made after that message is delivered).${idle.NOTIFY_WHEN_IDLE_NOT_DELIVERED_RETRY}`
                    : ''
                }`,
                ...(isUdsMessageTooLargeError(e)
                  ? { errorClass: 'message_too_large' }
                  : {}),
              },
            }
          }
        }
        if (addr.scheme === 'tcp' && feature('LAN_PIPES')) {
          const { parseTcpTarget } =
            require('src/utils/peerAddress.js') as typeof import('src/utils/peerAddress.js')
          const { PipeClient } =
            require('src/utils/pipeTransport.js') as typeof import('src/utils/pipeTransport.js')
          const ep = parseTcpTarget(addr.target)
          if (!ep) {
            return {
              data: {
                success: false,
                message: `Invalid TCP target format: ${addr.target}. Expected host:port`,
              },
            }
          }
          // LAN TCP requires shared-secret handshake (pipeTransport auth).
          // Resolve token from LanBeacon via normalizeLanHost + pipeName when
          // known — same discovery surface as /attach / usePipeIpc. Do not
          // invent ad-hoc tcp:host:port#token syntax (not densable gold).
          // Threat model: token is also on the UDP beacon (plaintext); see
          // docs/features/pipes-and-lan.md — trusted LAN only.
          let authToken: string | undefined
          try {
            const { getLanBeacon, resolveLanPeerAuthToken } =
              require('src/utils/lanBeacon.js') as typeof import('src/utils/lanBeacon.js')
            const beacon = getLanBeacon()
            if (beacon) {
              authToken = resolveLanPeerAuthToken(beacon.getPeers().values(), {
                host: ep.host,
                port: ep.port,
              })
            }
          } catch {
            // beacon optional at tool-load; resolve fails closed below
          }
          if (!authToken) {
            return {
              data: {
                success: false,
                message: `Cannot send via TCP to ${ep.host}:${ep.port}: no LAN peer advertised an auth token for this endpoint (discover via /pipes or wait for beacon, then /attach). Host is matched case-insensitively with localhost↔127.0.0.1; hostname field also accepted.`,
              },
            }
          }
          try {
            const client = new PipeClient(
              input.to,
              `send-${process.pid}`,
              ep,
              authToken,
            )
            await client.connect(5000)
            client.send({ type: 'chat', data: input.message })
            client.disconnect()
            const preview = input.summary || truncate(input.message, 50)
            let message = `”${preview}” → ${input.to} (TCP ${ep.host}:${ep.port})`
            // I7 — message+notify on tcp: deliver text, refuse subscribe.
            if (notifyIdle) {
              /* eslint-disable @typescript-eslint/no-require-imports */
              const idle =
                require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
              /* eslint-enable @typescript-eslint/no-require-imports */
              message = `${message}\nNothing was subscribed either: ${idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY}`
            }
            return {
              data: {
                success: true,
                message,
              },
            }
          } catch (e) {
            return {
              data: {
                success: false,
                message: `Failed to send via TCP to ${input.to}: ${errorMessage(e)}`,
              },
            }
          }
        }
      }

      // densable Hco: e===D6 → kind:"main" before agentNameRegistry / mailbox.
      // Subagent → main: IT({mode:"prompt", agentId:mi(), origin:peer, …}).
      // Main → main: refuse (you already are the main conversation).
      if (typeof input.message === 'string' && input.to === MAIN_RECIPIENT) {
        if (!context.agentId) {
          return {
            data: {
              success: false,
              message: `You are the main conversation — "${MAIN_RECIPIENT}" addresses you. Send to a named agent instead.`,
            },
          }
        }
        const { origin: sendOrigin, body: sendBody } =
          resolveSendMessageOriginAndBody(context, input.message)
        enqueuePendingNotification({
          mode: 'prompt',
          value: sendBody,
          priority: 'next',
          isMeta: true,
          skipSlashCommands: true,
          origin: sendOrigin as never,
          agentId: getMainThreadAgentId(),
        })
        return {
          data: {
            success: true,
            message: "Message queued for the main conversation's next turn.",
          },
        }
      }

      // Route to in-process subagent by name or raw agentId before falling
      // through to ambient-team resolution. Stopped agents are auto-resumed.
      // Also covers plan_approval_response when the model targets a local
      // subagent id (createAgentId) — must not hit team-lead mailbox gate.
      // (Observer sender gate is at call() entry — covers UDS/mailbox/etc.)
      if (input.to !== '*') {
        let localText: string | null = null
        let planApproval:
          | { approved: boolean; permissionMode?: string }
          | undefined
        if (typeof input.message === 'string') {
          localText = input.message
        } else if (input.message.type === 'plan_approval_response') {
          const approved = Boolean(input.message.approve)
          localText = formatPlanApprovalForLocalAgent(
            approved,
            input.message.request_id,
            input.message.feedback,
          )
          // Leader mode inherit (same as mailbox tQg): plan → default.
          const leaderMode = context.getAppState().toolPermissionContext.mode
          const modeToInherit = leaderMode === 'plan' ? 'default' : leaderMode
          planApproval = {
            approved,
            permissionMode: approved ? modeToInherit : undefined,
          }
        }
        if (localText !== null) {
          const local = await tryDeliverToLocalAgent(
            input.to,
            localText,
            context,
            canUseTool,
            assistantMessage,
            planApproval,
          )
          if (local) return local
        }
      }

      // densable 2.1.225 gIn/rKp + 2.1.234 #34 searchTruncated —
      // after in-process agents, resolve bare name / name [ref] against local
      // UDS + RC peers (incl. account bridge walk) with pin guard.
      // densable 2.1.236 C1: require non-empty text (pure idle handled earlier).
      if (
        feature('UDS_INBOX') &&
        typeof input.message === 'string' &&
        input.message.trim().length > 0 &&
        input.to !== '*' &&
        input.to !== MAIN_RECIPIENT &&
        parseAddress(input.to).scheme === 'other'
      ) {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const udsClient =
          require('src/utils/udsClient.js') as typeof import('src/utils/udsClient.js')
        const bridgePeers =
          require('src/bridge/peerSessions.js') as typeof import('src/bridge/peerSessions.js')
        const cloudPeers =
          require('src/utils/teleport/cloudPeerSessions.js') as typeof import('src/utils/teleport/cloudPeerSessions.js')
        const {
          appendSearchTruncatedSuccessSuffix,
          appendSearchTruncatedBody,
          searchTruncatedDisplayNote,
        } =
          require('src/utils/sessionListIncompleteCopy.js') as typeof import('src/utils/sessionListIncompleteCopy.js')
        /* eslint-enable @typescript-eslint/no-require-imports */
        const accountStatus = { failed: false, truncated: false }
        const [udsPeers, bridgeList, accountBridge, cloudList, allLive] =
          await Promise.all([
            udsClient.listPeers(),
            bridgePeers.listBridgePeers(),
            bridgePeers.listBridgePeerSessions(accountStatus),
            cloudPeers.listCloudPeerSessions(),
            udsClient.listAllLiveSessions(),
          ])
        // densable Mhf / g(): searchTruncated = cloud.truncated || bridge.truncated
        const searchTruncated =
          cloudList.truncated === true || accountStatus.truncated === true
        const appStateNow = context.getAppState()
        const listingUniqueness: Array<{ kind: string; id: string }> = []
        for (const [id] of Object.entries(
          appStateNow.teamContext?.teammates ?? {},
        )) {
          listingUniqueness.push({ kind: 'teammate', id })
        }
        for (const [name, id] of appStateNow.agentNameRegistry) {
          if (name) listingUniqueness.push({ kind: 'subagent', id })
        }
        for (const row of cloudList.sessions) {
          listingUniqueness.push({ kind: 'cloud-session', id: row.id })
        }
        const candidates = buildPeerCandidates({
          udsPeers,
          bridgePeers: bridgeList,
          accountBridgePeers: accountBridge,
          listingUniqueness,
        })
        const pins = context.getAppState().sendMessagePins ?? {}
        const resolved = resolvePeerByName({
          to: input.to,
          pins,
          candidates,
          localClaimed: localClaimedRemoteBodies(allLive),
          searchTruncated,
        })
        if (resolved.kind === 'refused') {
          return { data: { success: false, message: resolved.message } }
        }
        if (resolved.kind === 'ambiguous') {
          const prefixDee = leftoverOwnNameAmbiguous(
            input.to,
            input.message,
            {
              matchedBy: resolved.matchedBy,
              searchTruncated: resolved.searchTruncated,
              pinnedIdentityClaimedLocally:
                resolved.pinnedIdentityClaimedLocally,
            },
            context,
          )
          if (prefixDee.kind === 'dee') {
            return { data: prefixDee.data }
          }
          const qen =
            typeof input.message === 'string'
              ? classifyOwnNameTarget(input.to)
              : 'no'
          let message = formatAmbiguousMessage(input.to, resolved.candidates, {
            pinnedIdentityClaimedLocally: resolved.pinnedIdentityClaimedLocally,
            searchTruncated: resolved.searchTruncated,
          })
          if (qen !== 'no') {
            message += formatOwnNameAlsoNote(
              input.to,
              callerIsSubagentForSend(context),
            )
          }
          return {
            data: {
              success: false,
              message,
            },
          }
        }
        if (resolved.kind === 'ok') {
          const cand = resolved.candidate
          const preview = input.summary || truncate(input.message, 50)
          if (cand.kind === 'bridge-session') {
            // densable H9b/P9b — via remote-control from a cloud session.
            if (isRemoteControlPeerUnreachableFromHere()) {
              return {
                data: {
                  success: false,
                  message: formatUnreachableElevatedRefusal(cand.name),
                },
              }
            }
            // densable g0m — official also gates resolved cloud-session here.
            if (!isCrossMachineMessagingAvailable()) {
              return {
                data: {
                  success: false,
                  message: CROSS_MACHINE_MESSAGING_UNAVAILABLE,
                },
              }
            }
            const rcBlock = getRemoteControlSendBlockReason()
            if (rcBlock) {
              return {
                data: {
                  success: false,
                  message:
                    rcBlock === 'rc-disconnected'
                      ? `Remote Control disconnected before send — cannot deliver to ${cand.name}`
                      : `${formatRemoteControlSendBlock(rcBlock)} — cannot deliver to ${cand.name}`,
                },
              }
            }
            const result = (await bridgePeers.postInterClaudeMessage(
              cand.id,
              input.message,
            )) as { ok: boolean; error?: string }
            if (!result.ok) {
              return {
                data: {
                  success: false,
                  message: `Failed to send to ${cand.name}: ${result.error ?? 'unknown'}`,
                },
              }
            }
            setSendMessagePinOnAppState(
              context.setAppState as unknown as Parameters<
                typeof setSendMessagePinOnAppState
              >[0],
              cand.name,
              { kind: 'bridge-session', id: cand.id },
            )
            const siblingNote =
              resolved.sameNamedSiblings && resolved.sameNamedSiblings > 0
                ? `\nNote: ${resolved.sameNamedSiblings} other agent${resolved.sameNamedSiblings === 1 ? ' is' : 's are'} also named '${cand.name}'. This went to the one this conversation confirmed; to switch, re-send with that agent's 'name [ref]' (ListAgents lists them).`
                : ''
            let message = appendSearchTruncatedSuccessSuffix(
              `“${preview}” → ${cand.name} (a Claude session on another machine, over Remote Control)${siblingNote}`,
              resolved.searchTruncated,
            )
            // I7 — bare→bridge message+notify: deliver, refuse subscribe.
            if (notifyIdle) {
              /* eslint-disable @typescript-eslint/no-require-imports */
              const idle =
                require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
              /* eslint-enable @typescript-eslint/no-require-imports */
              message = `${message}\nNothing was subscribed either: ${idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY}`
            }
            return {
              data: {
                success: true,
                message,
              },
            }
          }
          const { permissionModeClassOf, shouldHonorPeerFromMode } =
            require('src/utils/crossSessionInbound.js') as typeof import('src/utils/crossSessionInbound.js')
          // densable Xen → Jio → VEt on resolved local-session.
          const ownOrFake = refuseOwnOrImpersonatedSocket(
            input.to,
            cand.id,
            context,
          )
          if (ownOrFake) {
            return {
              data: {
                success: false,
                message: ownOrFake.message,
                display: ownOrFake.display,
                ...(ownOrFake.kind === 'impersonation'
                  ? { degradedClass: ownOrFake.degradedClass }
                  : {}),
              },
            }
          }
          if (typeof input.message === 'string') {
            const gated = applyUdsBlankMessageGate(
              input,
              input.message,
              context,
              assistantMessage,
            )
            if (gated !== undefined) return gated
          }
          try {
            const perm = context.getAppState().toolPermissionContext
            const fromMode = shouldHonorPeerFromMode()
              ? permissionModeClassOf({
                  mode: perm.mode,
                  isBypassPermissionsModeAvailable:
                    perm.isBypassPermissionsModeAvailable,
                })
              : undefined
            await udsClient.sendToUdsSocket(cand.id, input.message, {
              ...(fromMode !== undefined ? { fromMode } : {}),
            })
            setSendMessagePinOnAppState(
              context.setAppState as unknown as Parameters<
                typeof setSendMessagePinOnAppState
              >[0],
              cand.name,
              { kind: 'session', id: cand.id },
            )
            const siblingNote =
              resolved.sameNamedSiblings && resolved.sameNamedSiblings > 0
                ? `\nNote: ${resolved.sameNamedSiblings} other live session${resolved.sameNamedSiblings === 1 ? ' is' : 's are'} also named '${cand.name}'. This went to the one this conversation confirmed; to switch, re-send with that session's 'name [ref]' (ListAgents lists them).`
                : ''
            const message = appendSearchTruncatedSuccessSuffix(
              `“${preview}” → ${cand.name} (another Claude session on this machine)${siblingNote}`,
              resolved.searchTruncated,
            )
            if (notifyIdle) {
              if (isNotifyWhenIdlePrincipalRefused(context)) {
                /* eslint-disable @typescript-eslint/no-require-imports */
                const idle =
                  require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
                /* eslint-enable @typescript-eslint/no-require-imports */
                return {
                  data: {
                    success: true,
                    message: `${message}\nNothing was subscribed either: ${idle.NOTIFY_WHEN_IDLE_MAIN_ONLY}`,
                  },
                }
              }
              const sub = await maybeSubscribePeerIdle({
                to: cand.name,
                socketPath: cand.id,
                displayLabel: cand.name,
                fromMode,
                context,
              })
              return {
                data: {
                  success: true,
                  message: `${message}\n${sub.modelLine}`,
                  ...(sub.errorClass ? { errorClass: sub.errorClass } : {}),
                  ...(sub.degradedClass
                    ? { degradedClass: sub.degradedClass }
                    : {}),
                },
              }
            }
            let delivered = message
            if (
              isNotifyWhenIdleStrippedByHandler(
                input,
                assistantMessage,
                context.toolUseId,
              )
            ) {
              delivered = appendHandlerStrippedIdleNote(delivered)
            }
            return {
              data: {
                success: true,
                message: delivered,
              },
            }
          } catch (e) {
            // densable yZt → too_large / message_too_large (tFd text already in message)
            return {
              data: {
                success: false,
                message: `Failed to send to ${cand.name}: ${errorMessage(e)}`,
                ...(isUdsMessageTooLargeError(e)
                  ? { errorClass: 'message_too_large' }
                  : {}),
              },
            }
          }
        }
        if (resolved.kind === 'not-found') {
          const miss = leftoverOwnNameMiss(
            input.to,
            input.message,
            {
              closest: leftoverClosestPeers(input.to, candidates),
              searchTruncated,
              pinnedIdentityClaimedLocally: undefined,
            },
            context,
          )
          return { data: miss.data }
        }
      }

      // densable U2f — notify_when_idle never rides teammate mailbox / broadcast.
      if (notifyIdle) {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const idle =
          require('src/utils/udsIdleNotify.js') as typeof import('src/utils/udsIdleNotify.js')
        /* eslint-enable @typescript-eslint/no-require-imports */
        if (pureIdleSubscribe) {
          return {
            data: {
              success: false,
              message: idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY,
              errorClass: 'not_reachable',
            },
          }
        }
        // Message+notify to a non-UDS target: deliver message via mailbox below,
        // but refuse the idle subscription with an explicit note.
        if (typeof input.message === 'string') {
          if (input.to === '*') {
            const delivered = await handleBroadcast(
              input.message,
              input.summary,
              context,
            )
            const base =
              typeof delivered.data.message === 'string'
                ? delivered.data.message
                : 'Broadcast sent.'
            return {
              data: {
                ...delivered.data,
                message: `${base}\nNothing was subscribed either: ${idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY}`,
              },
            }
          }
          const delivered = await handleMessage(
            input.to,
            input.message,
            input.summary,
            context,
          )
          const base =
            typeof delivered.data.message === 'string'
              ? delivered.data.message
              : `Message sent to ${input.to}.`
          return {
            data: {
              ...delivered.data,
              message: `${base}\nNothing was subscribed either: ${idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY}`,
            },
          }
        }
        return {
          data: {
            success: false,
            message: idle.NOTIFY_WHEN_IDLE_THIS_MACHINE_ONLY,
            errorClass: 'not_reachable',
          },
        }
      }

      if (typeof input.message === 'string') {
        if (input.to === '*') {
          return handleBroadcast(input.message, input.summary, context)
        }
        return handleMessage(input.to, input.message, input.summary, context)
      }

      if (input.to === '*') {
        throw new Error('structured messages cannot be broadcast')
      }

      switch (input.message.type) {
        case 'shutdown_request':
          return handleShutdownRequest(input.to, input.message.reason, context)
        case 'shutdown_response':
          if (input.message.approve) {
            return handleShutdownApproval(input.message.request_id, context)
          }
          return handleShutdownRejection(
            input.message.request_id,
            input.message.reason!,
          )
        case 'plan_approval_response':
          if (input.message.approve) {
            return handlePlanApproval(
              input.to,
              input.message.request_id,
              context,
              input.message.feedback,
            )
          }
          return handlePlanRejection(
            input.to,
            input.message.request_id,
            input.message.feedback ?? 'Plan needs revision',
            context,
          )
      }
    },

    renderToolUseMessage,
    renderToolResultMessage,
  } satisfies ToolDef<InputSchema, SendMessageToolOutput>)
