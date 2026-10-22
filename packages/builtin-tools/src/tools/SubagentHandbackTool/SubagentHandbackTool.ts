/**
 * densable 2.1.289 `cen` / `qw` SubagentHandback.
 * One-shot report from a spawned subagent to its caller (Image 34 Wr).
 */
import { z } from 'zod/v4'
import { getMainThreadAgentId } from 'src/bootstrap/state.js'
import type { ToolResultBlockParam, ToolUseContext } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import {
  isLocalAgentTask,
  queuePendingMessage,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { enqueueReportingAdmission } from 'src/utils/messageQueueManager.js'
import {
  escapeAgentMessageBody,
  frameHandbackReport,
  indentHandbackReport,
  sanitizeCrossSessionDisplayName,
  wrapAgentMessageEnvelope,
} from 'src/utils/crossSessionMessage.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import {
  formatHandbackClassifierNote,
  shouldFlagHandbackFromClassifierResult,
  takeHandbackClassifierResult,
} from 'src/utils/handbackClassifierResult.js'
import { sanitizeHarnessText } from 'src/utils/harnessTextSanitize.js'
import { updateTaskState } from 'src/utils/task/framework.js'
import {
  flagHandbackSession,
  getHandbackDelivery,
  getHandbackSessionContract,
  isHandbackEndsTurnEnabled,
  isHandbackInboxAlive,
  isHandbackInboxReadable,
  recordHandbackDelivery,
} from 'src/utils/subagentHandback.js'
import { SUBAGENT_HANDBACK_TOOL_NAME } from './constants.js'
import { CLASSIFIER_PREFIX, DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    message: z.string().describe('Your full report for your caller'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function resolveHandbackFrom(
  context: ToolUseContext,
  senderTaskId: string,
): { from: string; displayName: string } {
  const als = getAgentContext()
  if (als?.agentType === 'subagent' && als.subagentName) {
    const name = sanitizeCrossSessionDisplayName(als.subagentName)
    if (name) return { from: name, displayName: name }
  }
  if (als?.agentType === 'teammate' && als.agentName) {
    const name = sanitizeCrossSessionDisplayName(als.agentName)
    if (name) return { from: name, displayName: name }
  }
  try {
    const task = context.getAppState().tasks[senderTaskId]
    if (isLocalAgentTask(task) && task.agentType) {
      const name = sanitizeCrossSessionDisplayName(task.agentType)
      if (name) return { from: name, displayName: name }
    }
  } catch {
    // task registry optional in tests
  }
  return { from: senderTaskId, displayName: senderTaskId }
}

export const SubagentHandbackTool = buildTool({
  name: SUBAGENT_HANDBACK_TOOL_NAME,
  searchHint: 'deliver your final report to the agent that spawned you',
  maxResultSizeChars: 100_000,
  alwaysLoad: true,
  // densable cen: backgrounding:"never"
  backgrounding: 'never',

  userFacingName() {
    return SUBAGENT_HANDBACK_TOOL_NAME
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isEnabled() {
    return true
  },
  isReadOnly() {
    return false
  },

  // densable cen: classifierOnly(){return{onBlock:"flag"}}
  classifierOnly() {
    return { onBlock: 'flag' as const }
  },

  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },

  toAutoClassifierInput(input: Input) {
    return `${CLASSIFIER_PREFIX}: ${input.message}`
  },

  renderToolUseMessage() {
    return null
  },

  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [{ type: 'text', text: content.message }],
      is_error: !content.success,
    }
  },

  async validateInput(input) {
    if (input.message.trim().length === 0) {
      return {
        result: false,
        message: 'message must not be empty',
        errorCode: 9,
      }
    }
    return { result: true }
  },

  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },

  async call(input: Input, context: ToolUseContext) {
    const als = getAgentContext()
    const senderTaskId =
      context.agentId ??
      (als?.agentType === 'subagent' || als?.agentType === 'teammate'
        ? als.agentId
        : undefined)
    // densable: i=EOo(toolUseId); g=i&&i.kind!=="unavailable"; g&&agentId → pGo early.
    const i = takeHandbackClassifierResult(context.toolUseId)
    const g = shouldFlagHandbackFromClassifierResult(i)
    if (g && senderTaskId !== undefined) {
      flagHandbackSession(senderTaskId)
    }
    const task = senderTaskId
      ? (() => {
          try {
            return context.getAppState().tasks[senderTaskId]
          } catch {
            return undefined
          }
        })()
      : undefined
    const contract =
      isLocalAgentTask(task) && task.handbackContract === true
        ? { recipient: task.handbackRecipient }
        : undefined
    if (!senderTaskId || contract?.recipient === undefined) {
      return {
        data: {
          success: false,
          message: `Nothing was sent: ${SUBAGENT_HANDBACK_TOOL_NAME} is not active for this agent. Write your report as plain text instead.`,
        } satisfies Output,
      }
    }
    const recipient = contract.recipient
    const alreadyDelivered =
      getHandbackDelivery(senderTaskId, recipient) !== undefined
    if (alreadyDelivered) {
      return {
        data: {
          success: false,
          message: `Nothing was sent: your report was already delivered (${SUBAGENT_HANDBACK_TOOL_NAME} delivers one report). Use SendMessage for anything further, then stop.`,
        } satisfies Output,
      }
    }

    const { from, displayName } = resolveHandbackFrom(context, senderTaskId)
    // densable C_n join: h=y7n(body); d=D(i); b=d===void 0?h:`${bht(d)}\n${h}`
    // (flagged → D undefined / no note; unavailable still notes, g false).
    const framedReport = frameHandbackReport(input.message)
    const note = i ? formatHandbackClassifierNote(i) : undefined
    const bodyText =
      note === undefined
        ? framedReport
        : `${indentHandbackReport(note)}\n${framedReport}`
    const envelope = wrapAgentMessageEnvelope(from, bodyText)
    const flagged =
      g || getHandbackSessionContract(senderTaskId)?.flagged === true
    // densable T: peer origin has no lineage field. Framing still treats
    // senderTaskId as the descendant lane.
    const origin = {
      kind: 'peer' as const,
      from,
      senderTaskId,
      ...(displayName ? { name: displayName } : {}),
      body: escapeAgentMessageBody(bodyText),
      handback: true as const,
      ...(flagged ? { flagged: true as const } : {}),
    }
    const mainId = getMainThreadAgentId()
    const getTask = (id: string) => {
      try {
        return context.getAppState().tasks[id]
      } catch {
        return undefined
      }
    }
    const sender = isLocalAgentTask(task) ? task : undefined
    // densable: backgrounded && !Xcn(recipient) → Ve() main
    const deliverTo =
      sender?.isBackgrounded === true &&
      !isHandbackInboxReadable(recipient, getTask, mainId)
        ? mainId
        : recipient
    const setAppState = context.setAppStateForTasks ?? context.setAppState
    // densable: c !== contract recipient → stamp handbackRecipient before
    // the second v_n(r, c) check.
    if (deliverTo !== recipient) {
      try {
        updateTaskState(senderTaskId, setAppState, t => {
          if (!isLocalAgentTask(t)) return t
          return { ...t, handbackRecipient: deliverTo }
        })
      } catch {
        // tests may omit setAppState
      }
    }
    if (getHandbackDelivery(senderTaskId, deliverTo) !== undefined) {
      return {
        data: {
          success: false,
          message: `Nothing was sent: your report was already delivered (${SUBAGENT_HANDBACK_TOOL_NAME} delivers one report). Use SendMessage for anything further, then stop.`,
        } satisfies Output,
      }
    }
    if (deliverTo === mainId) {
      // densable: enqueueReportingAdmission; refuse when main does not admit.
      if (
        !enqueueReportingAdmission({
          mode: 'prompt',
          value: envelope,
          priority: 'next',
          isMeta: true,
          skipSlashCommands: true,
          skipAttachments: true,
          origin: origin as never,
          agentId: mainId,
        }).admitted
      ) {
        return {
          data: {
            success: false,
            message:
              'Nothing was sent: the main conversation did not accept the message.',
          } satisfies Output,
        }
      }
    } else {
      const target = getTask(deliverTo)
      if (
        !isHandbackInboxAlive(isLocalAgentTask(target) ? target : undefined)
      ) {
        return {
          data: {
            success: false,
            message:
              'Nothing was sent: the agent that spawned you is no longer running.',
          } satisfies Output,
        }
      }
      const setAppState = context.setAppStateForTasks ?? context.setAppState
      queuePendingMessage(deliverTo, envelope, setAppState, {
        isMeta: true,
        origin: origin as never,
      })
    }

    // densable v_n keys the one-report lock on the *contract* recipient,
    // not the bg-retarget deliverTo (main). Retargeting delivery to main
    // must not let a second call miss the lock. (Main admit path may also
    // stamp via enqueueReportingAdmission with agentId=main — overwrite here.)
    recordHandbackDelivery(senderTaskId, recipient, { flagged })
    try {
      // densable handbackReport.text = tet(Ax(message, {prependMarker:false}).sanitized)
      // — raw sanitized message, NOT the framed C_n envelope body.
      // warning = tet(d) when classifier note is defined (no Ax on warning).
      updateTaskState(senderTaskId, setAppState, t => {
        if (!isLocalAgentTask(t)) return t
        return {
          ...t,
          handbackReport: {
            text: escapeAgentMessageBody(
              sanitizeHarnessText(input.message, { prependMarker: false })
                .sanitized,
            ),
            ...(note !== undefined
              ? { warning: escapeAgentMessageBody(note) }
              : {}),
          },
        }
      })
    } catch {
      // tests may omit setAppState
    }

    return {
      data: {
        success: true,
        message: 'Report delivered to your caller.',
      } satisfies Output,
      ...(isHandbackEndsTurnEnabled() ? { endsTurn: true } : {}),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
