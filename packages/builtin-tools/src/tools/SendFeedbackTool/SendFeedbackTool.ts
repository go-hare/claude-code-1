import { z } from 'zod/v4'
import { getLastMainRequestId, getSessionId } from 'src/bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  FEEDBACK_FAILURE_MODES,
  FEEDBACK_TASK_CATEGORIES,
  FEEDBACK_TYPES,
  DETAILS_PREVIEW_CHARS,
  DETAILS_PREVIEW_LINES,
  MAX_KEPT_FEEDBACK_DRAFTS,
  MAX_TITLE_CHARS,
  TOOL_CALL_REQUEST_ID_WINDOW,
} from 'src/utils/feedbackDrafts/constants.js'
import {
  createFeedbackDraft,
  truncateGraphemes,
} from 'src/utils/feedbackDrafts/draft.js'
import { isSendFeedbackEnabled } from 'src/utils/feedbackDrafts/gates.js'
import {
  decrementSessionDraftCount,
  getJuniperRelayConfig,
  getMaxToolCallsPerSession,
  queueFeedbackDraftNotice,
  tryConsumeSendFeedbackCall,
} from 'src/utils/feedbackDrafts/notice.js'
import { writeFeedbackDraft } from 'src/utils/feedbackDrafts/writeDraft.js'
import { resolveAppliedEffort } from 'src/utils/effort.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getRuntimeMainLoopModel } from 'src/utils/model/model.js'
import { getTranscriptPathForSession } from 'src/utils/sessionPaths.js'
import { doesMostRecentAssistantMessageExceed200k } from 'src/utils/tokens.js'
import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
} from '../AgentTool/constants.js'
import {
  SEND_FEEDBACK_DESCRIPTION,
  SEND_FEEDBACK_PROMPT,
  SEND_FEEDBACK_SEARCH_HINT,
  SEND_FEEDBACK_TOOL_NAME,
} from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    type: z.enum(FEEDBACK_TYPES).describe('What kind of feedback this is.'),
    title: z
      .string()
      .min(1)
      .describe('Short, specific one-line summary of the issue.'),
    details: z
      .string()
      .min(1)
      .describe(
        `Labeled bullets, in order: **What happened:** (observed vs. expected, exact error text if short); **What the user said:** (quoted, or "User didn't comment; observed by the model."); **Repro:** (minimal steps); **Evidence:** (request IDs, timestamps, paths, versions; omit if none); optionally a final **Cause:** only if verified in-session. One to three lines per bullet. No narrative paragraphs, no speculation, no secrets.`,
      ),
    area: z
      .string()
      .optional()
      .describe(
        'Optional short tag naming the part of Claude Code this is about (e.g. "hooks config", "/help", "file editing"). Leave blank if unclear.',
      ),
    failure_mode: z
      .enum(FEEDBACK_FAILURE_MODES)
      .optional()
      .describe(
        'When the report is about MODEL BEHAVIOR (not a product bug), the closest failure mode, or `other` when it is a model-behavior issue that fits no listed value. Omit only when the report is a product/tool bug with no model-behavior component.',
      ),
    task_category: z
      .enum(FEEDBACK_TASK_CATEGORIES)
      .optional()
      .describe(
        'What kind of task the session was doing when the issue occurred, or `other` when it is a clear task that fits no listed value. Omit only if genuinely unclear.',
      ),
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function countSubagentSpawns(
  messages: Array<{
    type?: string
    message?: { content?: unknown }
  }>,
): number {
  let count = 0
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'tool_use' &&
        'name' in block &&
        (block.name === AGENT_TOOL_NAME ||
          block.name === LEGACY_AGENT_TOOL_NAME)
      ) {
        count++
      }
    }
  }
  return count
}

function effortToString(effort: unknown): string | undefined {
  if (effort === undefined) return
  return typeof effort === 'number' ? String(effort) : String(effort)
}

function detailsPreview(details: string): string {
  const lines = details.split('\n')
  const head = lines.slice(0, DETAILS_PREVIEW_LINES).join('\n')
  const clipped = truncateGraphemes(head, DETAILS_PREVIEW_CHARS)
  return clipped !== head ||
    lines.slice(DETAILS_PREVIEW_LINES).some(line => line.trim() !== '')
    ? `${clipped}\u2026`
    : clipped
}

export const SendFeedbackTool = buildTool({
  name: SEND_FEEDBACK_TOOL_NAME,
  maxResultSizeChars: 1000,
  searchHint: SEND_FEEDBACK_SEARCH_HINT,
  async description() {
    const { description } = getJuniperRelayConfig()
    return typeof description === 'string' && description !== ''
      ? description
      : SEND_FEEDBACK_DESCRIPTION
  },
  async prompt() {
    const { prompt } = getJuniperRelayConfig()
    return typeof prompt === 'string' && prompt !== ''
      ? prompt
      : SEND_FEEDBACK_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isReadOnly(_input: Input) {
    return false
  },
  isConcurrencySafe() {
    return true
  },
  isEnabled() {
    return isSendFeedbackEnabled()
  },
  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(
    output: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output.message,
      is_error: !output.success,
    }
  },
  renderToolUseMessage(input) {
    return typeof input.title === 'string'
      ? truncateGraphemes(input.title, MAX_TITLE_CHARS)
      : ''
  },
  async call(input, context) {
    if (!isSendFeedbackEnabled()) {
      return {
        data: {
          success: false,
          message: 'SendFeedback is not enabled in this session.',
        },
      }
    }
    if (!tryConsumeSendFeedbackCall()) {
      const cap = getMaxToolCallsPerSession()
      logEvent('tengu_feedback_draft_call_capped', {
        cap: cap as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {
        data: {
          success: false,
          message: `SendFeedback has reached its limit of ${cap} calls per session. Do not call it again this session; drafts already queued are unaffected and the user can review them with /feedback.`,
        },
      }
    }

    const sessionId = getSessionId()
    const lastRequestId = getLastMainRequestId()
    const messages = context.messages ?? []
    const requestIds: string[] = []
    for (const message of messages) {
      if (
        message.type === 'assistant' &&
        typeof message.requestId === 'string'
      ) {
        requestIds.push(message.requestId)
      }
    }
    const withCurrent = lastRequestId
      ? [...requestIds, lastRequestId]
      : requestIds
    const unique = uniqueStrings(withCurrent)
    const keptRequestIds = unique.slice(-TOOL_CALL_REQUEST_ID_WINDOW)
    const fallbackTurns =
      requestIds.length === 0
        ? new Set(
            messages.flatMap(message => {
              if (message.type !== 'assistant' || message.isVirtual) return []
              const payload = message.message
              if (!payload || payload.model === undefined) return []
              return typeof payload.id === 'string' ? [payload.id] : []
            }),
          ).size
        : 0
    const assistantTurnCount = Math.max(
      unique.length,
      fallbackTurns + (lastRequestId ? 1 : 0),
    )
    const permissionMode = context.getAppState().toolPermissionContext.mode
    const model = getRuntimeMainLoopModel({
      permissionMode,
      mainLoopModel: context.options.mainLoopModel,
      exceeds200kTokens:
        permissionMode === 'plan' &&
        doesMostRecentAssistantMessageExceed200k(messages),
    })
    const effort = resolveAppliedEffort(
      model,
      context.getAppState().effortValue,
    )
    const thinking = context.options.thinkingConfig
    const draft = createFeedbackDraft({
      type: input.type,
      title: input.title,
      details: input.details,
      area: input.area,
      failureMode: input.failure_mode,
      taskCategory: input.task_category,
      trigger: 'model_judgment',
      requestIds: keptRequestIds,
      sessionId,
      cwd: getCwd(),
      model,
      cliVersion: MACRO.VERSION,
      os: `${process.platform} x64`,
      effort: effortToString(effort),
      thinkingType: thinking.type,
      thinkingBudget:
        thinking.type === 'enabled' ? thinking.budgetTokens : undefined,
      messageCount: messages.length,
      assistantTurnCount,
      subagentCount: countSubagentSpawns(messages),
      transcriptFile: getTranscriptPathForSession(sessionId),
    })
    const written = await writeFeedbackDraft(
      draft,
      new Date(),
      context.storageV5,
    )
    if (!written.success) {
      logForDebugging(`feedback_drafts ${written.reason}`)
      return {
        data: {
          success: false,
          message:
            written.reason === 'too_large'
              ? 'Draft too large. Shorten the details and try once more.'
              : 'Could not write the feedback draft to disk.',
        },
      }
    }
    const evictedHere = written.evicted.filter(
      item => item.source_session_id === sessionId,
    ).length
    if (evictedHere > 0) decrementSessionDraftCount(evictedHere)
    const presentation = queueFeedbackDraftNotice({
      draftId: draft.draft_id,
      title: draft.title,
      type: draft.type,
      detailsPreview: detailsPreview(draft.details),
    })
    logEvent('tengu_feedback_draft_created', {
      type: draft.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger:
        draft.trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      presentation:
        presentation as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      request_id_count: draft.request_ids
        .length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      evicted_count: written.evicted
        .length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      failure_mode:
        draft.failure_mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      task_category:
        draft.task_category as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      effort: (typeof effort === 'number'
        ? effort
        : effort) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      thinking_type:
        draft.thinking_type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      thinking_budget:
        draft.thinking_budget as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      message_count:
        draft.message_count as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      assistant_turn_count:
        draft.assistant_turn_count as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      subagent_count:
        draft.subagent_count as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logForDebugging('feedback_drafts')
    context.appendSystemMessage?.({
      type: 'system',
      subtype: 'feedback_draft_queued',
      draft_id: draft.draft_id,
      draft_type: draft.type,
      title: draft.title,
      details_preview: truncateGraphemes(draft.details, 200),
    } as never)
    return {
      data: {
        success: true,
        message: `Feedback draft queued locally (max ${MAX_KEPT_FEEDBACK_DRAFTS} kept). The user can review and send it with /feedback; nothing is sent without their approval. Do not announce this or ask the user about it.`,
      },
    }
  },
})
