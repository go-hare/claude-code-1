/**
 * densable 2.1.239 ProposeGoalTool — extract 1:1 (ikw / vgi).
 *
 * Independent of GoalTool (get/update only). Always in the base pool;
 * isEnabled() gates via GB + session shape + modelProposedGoals.
 */

import { z } from 'zod/v4'
import {
  getIsNonInteractiveSession,
  getIsRemoteMode,
  getMainThreadAgentId,
} from 'src/bootstrap/state.js'
import { goalProposalSpec } from 'src/dialog/specs/jsuKinds.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { isGoalClearKeyword } from 'src/services/goal/clearKeywords.js'
import { getGoalRestoreGate } from 'src/services/goal/restoreGoalFromTranscript.js'
import { setQueuedGoalOrigin } from 'src/services/goal/queuedGoalOrigin.js'
import { buildTool, type ToolResultBlockParam } from 'src/Tool.js'
import { randomUUID } from 'src/utils/crypto.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/utils/errors.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logError } from 'src/utils/log.js'
import { enqueue } from 'src/utils/messageQueueManager.js'
import {
  canonicalizeGoalCondition,
  flattenNewlines,
  truncateGoalConditionForRender,
} from './canonicalize.js'
import {
  PROPOSE_GOAL_CONDITION_MAX_CHARS,
  PROPOSE_GOAL_TOOL_NAME,
} from './constants.js'
import {
  ASK_USER_SCHEMA_DESCRIPTION,
  CONDITION_SCHEMA_DESCRIPTION,
  DESCRIPTION,
  OUTPUT_ASK_USER_DESCRIPTION,
  OUTPUT_CONDITION_DESCRIPTION,
  PROMPT,
  SEARCH_HINT,
  TOOL_RESULT_ASK_USER,
  TOOL_RESULT_DIRECT,
} from './prompt.js'
import {
  getModelProposedGoalsSetting,
  getModelProposedGoalsSettingAsync,
  isBgSessionKind,
  isProposeGoalEnabled,
} from './proposeGoalGate.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    condition: z
      .string()
      .min(1)
      .max(PROPOSE_GOAL_CONDITION_MAX_CHARS)
      .describe(CONDITION_SCHEMA_DESCRIPTION),
    ask_user: z.boolean().optional().describe(ASK_USER_SCHEMA_DESCRIPTION),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type ProposeGoalInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    condition: z.string().describe(OUTPUT_CONDITION_DESCRIPTION),
    askUser: z.boolean().describe(OUTPUT_ASK_USER_DESCRIPTION),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ProposeGoalOutput = z.infer<OutputSchema>

/** densable `Ee("goal_propose")`. */
function ok(): void {
  logEvent('tengu_feature_ok', {
    feature_name:
      'goal_propose' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** densable `be("goal_propose", code)`. */
function sad(errorCode: string): void {
  logEvent('tengu_feature_sad', {
    feature_name:
      'goal_propose' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

function meta(
  value: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export const ProposeGoalTool = buildTool({
  name: PROPOSE_GOAL_TOOL_NAME,
  shouldDefer: true,
  searchHint: SEARCH_HINT,
  maxResultSizeChars: 1000,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },

  isEnabled() {
    return isProposeGoalEnabled()
  },

  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return false
  },

  toAutoClassifierInput(input: ProposeGoalInput) {
    return `ask_user=${input.ask_user !== false}: ${input.condition ?? ''}`
  },

  renderToolUseMessage(input: ProposeGoalInput) {
    if (!input.condition) return ''
    return `Propose goal: ${truncateGoalConditionForRender(flattenNewlines(input.condition), 200)}`
  },

  mapToolResultToToolResultBlockParam(
    content: ProposeGoalOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content:
        content.askUser === false ? TOOL_RESULT_DIRECT : TOOL_RESULT_ASK_USER,
    }
  },

  async call({ condition, ask_user }: ProposeGoalInput, context) {
    if (context.agentId) {
      throw Error('ProposeGoal cannot be used in agent contexts')
    }
    if (
      getIsNonInteractiveSession() ||
      getIsRemoteMode() ||
      isBgSessionKind()
    ) {
      sad('session_shape')
      throw Error(
        'Goal proposals are only available in interactive local sessions.',
      )
    }
    const n = canonicalizeGoalCondition(flattenNewlines(condition)).trim()
    if (n === '') {
      throw Error(
        'The goal condition is empty once whitespace and invisible characters are removed. Provide a visible condition.',
      )
    }
    if (n.length > PROPOSE_GOAL_CONDITION_MAX_CHARS) {
      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        `The goal condition exceeds ${PROPOSE_GOAL_CONDITION_MAX_CHARS} characters once canonicalized for display (tabs expand to spaces). Shorten the condition — the user must be able to read all of it in the approval dialog.`,
        'goal condition exceeds the canonicalized-length cap',
      )
    }
    if (isGoalClearKeyword(n)) {
      throw Error(
        'ProposeGoal only proposes a new goal; it cannot clear one. The user can clear an active goal with /goal clear.',
      )
    }
    const gate = getGoalRestoreGate()
    if (gate !== null) {
      sad(gate.code)
      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        gate.message,
        'goal evaluator blocked',
      )
    }
    if (context.getAppState().toolPermissionContext.mode === 'plan') {
      sad('plan_mode')
      throw Error(
        'Plan mode is active, so a goal cannot be proposed yet. Keep planning; propose the goal after the plan is approved.',
      )
    }
    const setting = await getModelProposedGoalsSettingAsync()
    if (setting === 'disabled') {
      sad('setting_disabled')
      throw Error(
        'The user has disabled model-proposed goals in their settings. Do not propose goals; the user can set one themselves with /goal.',
      )
    }
    const askUser = setting === 'alwaysAsk' || ask_user !== false
    const requestDialog = context.requestDialog
    if (requestDialog === undefined) {
      throw Error(
        'Goal proposals need an interactive session to render the approval prompt; none is available here.',
      )
    }
    if (context.getAppState().pendingGoalProposal) {
      throw Error(
        "A goal proposal is already awaiting the user's decision. Keep working; if it is approved you will receive a kickoff message.",
      )
    }
    logEvent('tengu_goal_proposed', {
      promptLength: n.length,
      askUser,
      forcedAsk: askUser && ask_user === false,
    })
    ok()
    if (!askUser) {
      setQueuedGoalOrigin(context.setAppState, n, 'proposal_direct')
      enqueue({
        agentId: getMainThreadAgentId(),
        mode: 'prompt',
        value: `/goal ${n}`,
        origin: { kind: 'task-notification' },
      })
      return { data: { condition: n, askUser: false } }
    }
    const { setAppState } = context
    const latch = randomUUID()
    setAppState(prev => ({ ...prev, pendingGoalProposal: latch }))
    void requestDialog(
      goalProposalSpec,
      { condition: n },
      { queueBehind: true },
    )
      .then((raw: unknown) => {
        const parsed = goalProposalSpec.result().safeParse(raw)
        const d = parsed.success ? parsed.data : goalProposalSpec.default
        const stale = context.getAppState().pendingGoalProposal !== latch
        const disabled = getModelProposedGoalsSetting() === 'disabled'
        const plan = context.getAppState().toolPermissionContext.mode === 'plan'
        logEvent('tengu_goal_proposal_decided', {
          decision: d.approved
            ? stale
              ? meta('approved_stale')
              : disabled
                ? meta('approved_disabled')
                : plan
                  ? meta('approved_plan_mode')
                  : meta('approved')
            : d.explicit === true
              ? meta('declined')
              : meta('unanswered'),
        })
        if (!d.approved || stale || disabled || plan) {
          if (d.approved && !stale) {
            if (disabled) sad('approved_dropped_disabled')
            else if (plan) sad('approved_dropped_plan_mode')
          }
          return
        }
        setQueuedGoalOrigin(setAppState, n, 'proposal_approved')
        enqueue({
          agentId: getMainThreadAgentId(),
          mode: 'prompt',
          value: `/goal ${n}`,
          origin: { kind: 'auto-continuation' },
        })
      })
      .catch((err: unknown) => {
        logError(err)
      })
      .finally(() => {
        setAppState(prev =>
          prev.pendingGoalProposal === latch
            ? { ...prev, pendingGoalProposal: undefined }
            : prev,
        )
      })
    return { data: { condition: n, askUser: true } }
  },
})
