import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import {
  getMainThreadAgentId,
  isReplBridgeActive,
} from 'src/bootstrap/state.js'
import { getReplBridgeHandle } from 'src/bridge/replBridgeHandle.js'
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
import { logForDebugging } from 'src/utils/debug.js'
import { readAgentMetadata } from 'src/utils/sessionStorage.js'
import { errorMessage } from 'src/utils/errors.js'
import { truncate } from 'src/utils/format.js'
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { enqueuePendingNotification } from 'src/utils/messageQueueManager.js'
import { parseAddress } from 'src/utils/peerAddress.js'
import { semanticBoolean } from 'src/utils/semanticBoolean.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
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
  writeToMailbox,
} from 'src/utils/teammateMailbox.js'
import { resumeAgentBackground } from '../AgentTool/resumeAgent.js'
import {
  SEND_MESSAGE_SUMMARY_MAX_CHARS,
  SEND_MESSAGE_TOOL_NAME,
} from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

/** densable D6 — reserved recipient routed to the main conversation queue. */
export const MAIN_RECIPIENT = MAIN_RECIPIENT_NAME

/**
 * densable `na` — character truncate with high-surrogate safety (not display width).
 * Used by SendMessage summary coerce: `na(t, Cpr-1)+"…"`.
 */
function truncateSummaryChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  let slice = text.slice(0, maxChars)
  const last = slice.charCodeAt(maxChars - 1)
  // Drop lone high surrogate so we never cut mid-pair.
  if (last >= 0xd800 && last <= 0xdbff) {
    slice = slice.slice(0, -1)
  }
  return slice
}

/**
 * densable OIp — coerceInput: when summary exceeds Cpr, soft-truncate + ellipsis
 * rather than rejecting schema max(Cpr).
 */
export function coerceSendMessageInput(
  raw: unknown,
): { input: Input; shapeClass: 'truncate_summary' } | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const summary = record.summary
  if (
    typeof summary !== 'string' ||
    summary.length <= SEND_MESSAGE_SUMMARY_MAX_CHARS
  ) {
    return null
  }
  return {
    input: {
      ...(record as Input),
      summary:
        truncateSummaryChars(summary, SEND_MESSAGE_SUMMARY_MAX_CHARS - 1) + '…',
    },
    shapeClass: 'truncate_summary',
  }
}

const StructuredMessage = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('shutdown_request'),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('shutdown_response'),
      request_id: z.string(),
      approve: semanticBoolean(),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('plan_approval_response'),
      request_id: z.string(),
      approve: semanticBoolean(),
      feedback: z.string().optional(),
    }),
  ]),
)

const inputSchema = lazySchema(() =>
  z.object({
    to: z
      .string()
      .describe(
        feature('UDS_INBOX')
          ? `Recipient: teammate name, "*" for broadcast, "uds:<socket-path>" for a local peer, "bridge:<session-id>" for a Remote Control peer${feature('LAN_PIPES') ? ', or "tcp:<host>:<port>" for a LAN peer' : ''} (use ListAgents to discover)`
          : 'Recipient: teammate name, or "*" for broadcast to all teammates',
      ),
    // densable SRp: summary.max(Cpr) + soft-truncate describe (Cpr=200).
    summary: z
      .string()
      .max(SEND_MESSAGE_SUMMARY_MAX_CHARS)
      .optional()
      .describe(
        `A 5-10 word summary shown as a one-line preview in the UI (required when message is a string). Longer summaries are truncated to ${SEND_MESSAGE_SUMMARY_MAX_CHARS} characters rather than rejected, and only the first line is shown.`,
      ),
    message: z.union([
      z.string().describe('Plain text message content'),
      StructuredMessage(),
    ]),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

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
  const registered = appState.agentNameRegistry.get(to)
  const agentId = registered ?? toAgentId(to)
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
      const result = await resumeAgentBackground({
        agentId,
        prompt: sendBody,
        toolUseContext: context,
        canUseTool,
        invokingRequestId: assistantMessage?.requestId as string | undefined,
        promptOrigin: sendOrigin,
        promptIsMeta: true,
      })
      return {
        data: {
          success: true,
          message: `Agent "${to}" was stopped (${task.status}); resumed it in the background with your message. You'll be notified when it finishes. Output: ${result.outputFile}`,
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
      const result = await resumeAgentBackground({
        agentId,
        prompt: sendBody,
        toolUseContext: context,
        canUseTool,
        invokingRequestId: assistantMessage?.requestId as string | undefined,
        promptOrigin: sendOrigin,
        promptIsMeta: true,
      })
      return {
        data: {
          success: true,
          message: `Agent "${to}" had no active task; resumed from transcript in the background with your message. You'll be notified when it finishes. Output: ${result.outputFile}`,
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
      return inputSchema()
    },
    shouldDefer: true,
    alwaysLoad: isAgentSwarmsEnabled(),

    isEnabled() {
      return true
    },

    isReadOnly(input) {
      return typeof input.message === 'string'
    },

    // densable OIp — soft-truncate summary > Cpr before schema max(Cpr) rejects.
    coerceInput: coerceSendMessageInput,

    // densable xKg.backfillObservableInput: content/reason/feedback via Bs(…, 50)
    // so telemetry / observable clones never carry the full message body.
    backfillObservableInput(input) {
      if (typeof input.to !== 'string') return

      redactObservableInlineUdsToken(input as { to: string })
      if ('type' in input) return

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

    async validateInput(input, _context) {
      if (input.to.trim().length === 0) {
        return {
          result: false,
          message: 'to must not be empty',
          errorCode: 9,
        }
      }
      const addr = parseAddress(input.to)
      if (
        (addr.scheme === 'bridge' ||
          addr.scheme === 'uds' ||
          addr.scheme === 'tcp') &&
        addr.target.trim().length === 0
      ) {
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
            'to must be a bare teammate name or "*" — there is only one team per session',
          errorCode: 9,
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
        // postInterClaudeMessage derives from= via getReplBridgeHandle() —
        // check handle directly for the init-timing window. Also check
        // isReplBridgeActive() to reject outbound-only (CCR mirror) mode
        // where the bridge is write-only and peer messaging is unsupported.
        if (!getReplBridgeHandle() || !isReplBridgeActive()) {
          return {
            result: false,
            message:
              'Remote Control is not connected — cannot send to a bridge: target. Reconnect with /remote-control first.',
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
        if (!input.summary || input.summary.trim().length === 0) {
          return {
            result: false,
            message: 'summary is required when message is a string',
            errorCode: 9,
          }
        }
        return { result: true }
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
      return getPrompt()
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

      if (typeof input.message === 'string') {
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

      if (feature('UDS_INBOX') && typeof input.message === 'string') {
        const addr = parseAddress(input.to)
        if (addr.scheme === 'bridge') {
          // Re-check handle — checkPermissions blocks on user approval (can be
          // minutes). validateInput's check is stale if the bridge dropped
          // during the prompt wait; without this, from="unknown" ships.
          // Also re-check isReplBridgeActive for outbound-only mode.
          if (!getReplBridgeHandle() || !isReplBridgeActive()) {
            return {
              data: {
                success: false,
                message: `Remote Control disconnected before send — cannot deliver to ${input.to}`,
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
          return {
            data: {
              success: result.ok,
              message: result.ok
                ? `”${preview}” → ${input.to}`
                : `Failed to send to ${input.to}: ${result.error ?? 'unknown'}`,
            },
          }
        }
        if (addr.scheme === 'uds') {
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
            return {
              data: {
                success: true,
                message: `”${preview}” → ${recipient}`,
              },
            }
          } catch (e) {
            return {
              data: {
                success: false,
                message: `Failed to send to ${recipient}: ${errorMessage(e)}`,
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
          try {
            const client = new PipeClient(input.to, `send-${process.pid}`, ep)
            await client.connect(5000)
            client.send({ type: 'chat', data: input.message })
            client.disconnect()
            const preview = input.summary || truncate(input.message, 50)
            return {
              data: {
                success: true,
                message: `”${preview}” → ${input.to} (TCP ${ep.host}:${ep.port})`,
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
