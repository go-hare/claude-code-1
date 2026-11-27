import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import {
  getAllowedChannels,
  getIsNonInteractiveSession,
  hasExitedPlanModeInSession,
  setHasExitedPlanMode,
  setNeedsAutoModeExitAttachment,
  setNeedsPlanModeExitAttachment,
} from 'src/bootstrap/state.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { logEvent } from 'src/services/analytics/index.js'
import {
  EXIT_PLAN_MODE_TRIGGER,
  logPermissionModeChanged,
} from 'src/utils/permissions/permissionSetup.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/metadata.js'
import {
  buildTool,
  type ToolDef,
  type ToolDeps,
  toolMatchesName,
  type ToolPermissionContext,
} from 'src/Tool.js'
import { formatAgentId, generateRequestId } from 'src/utils/agentId.js'
import { isAgentSwarmsEnabled } from 'src/utils/agentSwarmsEnabled.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  findInProcessTeammateTaskId,
  setAwaitingPlanApproval,
} from 'src/utils/inProcessTeammateHelpers.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logError } from 'src/utils/log.js'
import {
  getPlan,
  getPlanFilePath,
  persistApprovedPlanEdit,
  persistFileSnapshotIfRemote,
} from 'src/utils/plans.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import {
  getAgentName,
  getTeamName,
  isPlanModeRequired,
  isTeammate,
} from 'src/utils/teammate.js'
import { writeToMailbox } from 'src/utils/teammateMailbox.js'
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from './constants.js'
import { EXIT_PLAN_MODE_V2_TOOL_PROMPT } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('src/utils/permissions/autoModeState.js') as typeof import('src/utils/permissions/autoModeState.js'))
  : null
const permissionSetupModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('src/utils/permissions/permissionSetup.js') as typeof import('src/utils/permissions/permissionSetup.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Schema for prompt-based permission requests.
 * Used by Claude to request semantic permissions when exiting plan mode.
 */
const allowedPromptSchema = lazySchema(() =>
  z.object({
    tool: z.enum(['Bash']).describe('The tool this prompt applies to'),
    prompt: z
      .string()
      .describe(
        'Semantic description of the action, e.g. "run tests", "install dependencies"',
      ),
  }),
)

export type AllowedPrompt = z.infer<ReturnType<typeof allowedPromptSchema>>

const inputSchema = lazySchema(() =>
  z
    .strictObject({
      // Prompt-based permissions requested by the plan
      allowedPrompts: z
        .array(allowedPromptSchema())
        .optional()
        .describe(
          'Prompt-based permissions needed to implement the plan. These describe categories of actions rather than specific commands.',
        ),
    })
    .passthrough(),
)
type InputSchema = ReturnType<typeof inputSchema>

/**
 * SDK-facing input schema - includes fields injected by normalizeToolInput.
 * The internal inputSchema doesn't have these fields because plan is read from disk,
 * but the SDK/hooks see the normalized version with plan and file path included.
 */
export const _sdkInputSchema = lazySchema(() =>
  inputSchema().extend({
    plan: z
      .string()
      .optional()
      .describe('The plan content (injected by normalizeToolInput from disk)'),
    planFilePath: z
      .string()
      .optional()
      .describe('The plan file path (injected by normalizeToolInput)'),
  }),
)

export const outputSchema = lazySchema(() =>
  z.object({
    plan: z
      .string()
      .nullable()
      .describe('The plan that was presented to the user'),
    isAgent: z.boolean(),
    filePath: z
      .string()
      .optional()
      .describe('The file path where the plan was saved'),
    hasTaskTool: z
      .boolean()
      .optional()
      .describe('Whether the Agent tool is available in the current context'),
    planWasEdited: z
      .boolean()
      .optional()
      .describe(
        'True when the user edited the plan (CCR web UI or Ctrl+G); determines whether the plan is echoed back in tool_result',
      ),
    awaitingLeaderApproval: z
      .boolean()
      .optional()
      .describe(
        'When true, the teammate has sent a plan approval request to the team leader',
      ),
    requestId: z
      .string()
      .optional()
      .describe('Unique identifier for the plan approval request'),
    /** densable dO soft-fail: mailbox write did not land */
    mailboxWriteFailed: z
      .boolean()
      .optional()
      .describe(
        'When true, the plan approval request could not be written to the team-lead mailbox',
      ),
    /** 2.1.325 #2268: warning notice when plansDirectory could not accept the approved edit */
    planSaveNotice: z
      .string()
      .optional()
      .describe(
        'Warning notice emitted when the approved plan edit fell back to the default plans folder or could not be saved',
      ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

/**
 * 2.1.323 #2140: Detects whether a cloud, self-hosted runner, or SDK session
 * restarted while a plan was awaiting approval (so its in-memory mode reset
 * from 'plan' to 'default' even though an unapproved plan is still open).
 */
export function isRestartedPlanApprovalContext(
  context: {
    agentId?: string
    messages?: ReadonlyArray<{
      type?: string
      message?: { content?: unknown }
    }>
  },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const isRestartableHost =
    getIsNonInteractiveSession() ||
    isEnvTruthy(env.CLAUDE_CODE_REMOTE) ||
    env.CLAUDE_CODE_ENTRYPOINT === 'sdk-ts' ||
    env.CLAUDE_CODE_ENTRYPOINT === 'sdk-py' ||
    env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli' ||
    env.CLAUDE_CODE_ENTRYPOINT === 'self-hosted-runner'
  if (!isRestartableHost || hasExitedPlanModeInSession()) {
    return false
  }
  if (Array.isArray(context.messages) && context.messages.length > 0) {
    let openPlan = false
    for (const msg of context.messages) {
      if (msg?.type !== 'assistant') continue
      const content = msg.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'tool_use'
        ) {
          const name = (block as { name?: string }).name
          if (name === 'EnterPlanMode') openPlan = true
          else if (name === 'ExitPlanMode') openPlan = false
        }
      }
    }
    if (openPlan) return true
  }
  return getPlan(context.agentId as Parameters<typeof getPlan>[0]) !== null
}

function restorePlanModePermissionContext(
  prevContext: ToolPermissionContext,
): ToolPermissionContext {
  if (prevContext.mode !== 'plan') return prevContext
  setHasExitedPlanMode(true)
  setNeedsPlanModeExitAttachment(true)
  let restoreMode = prevContext.prePlanMode ?? 'default'
  if (
    restoreMode === 'bypassPermissions' &&
    !prevContext.isBypassPermissionsModeAvailable
  ) {
    restoreMode = 'default'
  }
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (
      restoreMode === 'auto' &&
      !(permissionSetupModule?.isAutoModeGateEnabled() ?? false)
    ) {
      restoreMode = 'default'
    }
    const finalRestoringAuto = restoreMode === 'auto'
    // Capture pre-restore state — isAutoModeActive() is the authoritative
    // signal (prePlanMode/strippedDangerousRules are stale after
    // transitionPlanAutoMode deactivates mid-plan).
    const autoWasUsedDuringPlan =
      autoModeStateModule?.isAutoModeActive() ?? false
    autoModeStateModule?.setAutoModeActive(finalRestoringAuto)
    if (autoWasUsedDuringPlan && !finalRestoringAuto) {
      setNeedsAutoModeExitAttachment(true)
    }
  }
  // If restoring to a non-auto mode and permissions were stripped (either
  // from entering plan from auto, or from shouldPlanUseAutoMode),
  // restore them. If restoring to auto, keep them stripped.
  const restoringToAuto = restoreMode === 'auto'
  let baseContext = prevContext
  if (restoringToAuto) {
    baseContext =
      permissionSetupModule?.stripDangerousPermissionsForAutoMode(
        baseContext,
      ) ?? baseContext
  } else if (prevContext.strippedDangerousRules) {
    baseContext =
      permissionSetupModule?.restoreDangerousPermissions(baseContext) ??
      baseContext
  }
  // densable qLe({from:"plan",to:m,trigger:"exit_plan_mode"}) before set
  logPermissionModeChanged('plan', restoreMode, EXIT_PLAN_MODE_TRIGGER)
  return {
    ...baseContext,
    mode: restoreMode,
    prePlanMode: undefined,
  }
}

export const ExitPlanModeV2Tool = buildTool({
  name: EXIT_PLAN_MODE_V2_TOOL_NAME,
  searchHint: 'present plan for approval and start coding (plan mode only)',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Prompts the user to exit plan mode and start coding'
  },
  async prompt() {
    return EXIT_PLAN_MODE_V2_TOOL_PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return ''
  },
  shouldDefer: true,
  isEnabled() {
    // When --channels is active the user is likely on Telegram/Discord, not
    // watching the TUI. The plan-approval dialog would hang. Paired with the
    // same gate on EnterPlanMode so plan mode isn't a trap.
    if (
      (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
      getAllowedChannels().length > 0
    ) {
      return false
    }
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false // Now writes to disk
  },
  requiresUserInteraction() {
    // For ALL teammates, no local user interaction needed:
    // - If isPlanModeRequired(): team lead approves via mailbox
    // - Otherwise: exits locally without approval (voluntary plan mode)
    if (isTeammate()) {
      return false
    }
    // For non-teammates, require user confirmation to exit plan mode
    return true
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
  create(deps: ToolDeps) {
    return {
      async validateInput() {
        // Teammate AppState may show leader's mode (runAgent.ts skips override in
        // acceptEdits/bypassPermissions/auto); isPlanModeRequired() is the real source
        if (isTeammate()) {
          return { result: true }
        }
        // The deferred-tool list announces this tool regardless of mode, so the
        // model can call it after plan approval (fresh delta on compact/clear).
        // Reject before checkPermissions to avoid showing the approval dialog.
        const mode = deps.permissions().mode
        if (mode !== 'plan') {
          // 2.1.323 #2140: in cloud, self-hosted runner, and SDK sessions, if the
          // session process restarted before plan approval arrived, restore plan
          // mode context instead of rejecting with "You are not in plan mode".
          if (
            isRestartedPlanApprovalContext({
              agentId: deps.agentId,
              messages: deps.messages(),
            })
          ) {
            logForDebugging(
              `[ExitPlanMode] Restoring plan mode after process restart (was ${mode})`,
            )
            return { result: true }
          }
          logEvent('tengu_exit_plan_mode_called_outside_plan', {
            model:
              deps.loopModel() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            hasExitedPlanModeInSession: hasExitedPlanModeInSession(),
          })
          return {
            result: false,
            message:
              'You are not in plan mode. This tool is only for exiting plan mode after writing a plan. If your plan was already approved, continue with implementation.',
            errorCode: 1,
          }
        }
        return { result: true }
      },
      async checkPermissions(input) {
        // For ALL teammates, bypass the permission UI to avoid sending permission_request
        // The call() method handles the appropriate behavior:
        // - If isPlanModeRequired(): sends plan_approval_request to leader
        // - Otherwise: exits plan mode locally (voluntary plan mode)
        if (isTeammate()) {
          return {
            behavior: 'allow' as const,
            updatedInput: input,
          }
        }

        // For non-teammates, require user confirmation to exit plan mode
        return {
          behavior: 'ask' as const,
          message: 'Exit plan mode?',
          updatedInput: input,
        }
      },
      async call(input) {
        const isAgent = !!deps.agentId

        let filePath = getPlanFilePath(deps.agentId)
        // CCR web UI may send an edited plan via permissionResult.updatedInput.
        // queryHelpers.ts full-replaces finalInput, so when CCR sends {} (no edit)
        // input.plan is undefined -> disk fallback. The internal inputSchema omits
        // `plan` (normally injected by normalizeToolInput), hence the narrowing.
        const inputPlan =
          'plan' in input && typeof input.plan === 'string'
            ? input.plan
            : undefined
        const plan = inputPlan ?? getPlan(deps.agentId)

        // Sync disk so subsequent Read calls see the approved plan edit. Re-snapshot
        // after: the only other persistFileSnapshotIfRemote call (api.ts) runs
        // in normalizeToolInput, pre-permission — it captured the old plan.
        // 2.1.325 #2268 (SEA `N6s` @284740124): if `plansDirectory` cannot accept
        // the approved edit, fall back to the default plans folder and warn where
        // and why.
        let planSaveNotice: string | undefined
        if (inputPlan !== undefined && filePath) {
          const saveOutcome = await persistApprovedPlanEdit(filePath, inputPlan)
          if (saveOutcome !== undefined) {
            planSaveNotice = saveOutcome.notice
            if (saveOutcome.savedTo !== undefined) {
              filePath = saveOutcome.savedTo
            }
            deps.addNotification?.({
              key: 'plan-edit-save-fallback',
              text: saveOutcome.notice,
              priority: 'immediate',
              color: 'warning',
              timeoutMs: 10000,
            })
          }
          void persistFileSnapshotIfRemote()
        }

        // Check if this is a teammate that requires leader approval
        if (isTeammate() && isPlanModeRequired()) {
          // Plan is required for plan_mode_required teammates
          if (!plan) {
            throw new Error(
              `No plan file found at ${filePath}. Please write your plan to this file before calling ExitPlanMode.`,
            )
          }
          const agentName = getAgentName() || 'unknown'
          const teamName = getTeamName()
          const requestId = generateRequestId(
            'plan_approval',
            formatAgentId(agentName, teamName || 'default'),
          )

          const approvalRequest = {
            type: 'plan_approval_request',
            from: agentName,
            timestamp: new Date().toISOString(),
            planFilePath: filePath,
            planContent: plan,
            requestId,
          }

          // densable dO: only report awaiting approval when mailbox write lands.
          const planMsgId = await writeToMailbox(
            'team-lead',
            {
              from: agentName,
              text: jsonStringify(approvalRequest),
              timestamp: new Date().toISOString(),
            },
            teamName,
          )

          if (planMsgId === undefined) {
            return {
              data: {
                plan,
                isAgent: true,
                filePath,
                awaitingLeaderApproval: false,
                requestId,
                mailboxWriteFailed: true,
              },
            }
          }

          // Update task state to show awaiting approval (for in-process teammates)
          const appState = deps.getAppState()
          const agentTaskId = findInProcessTeammateTaskId(agentName, appState)
          if (agentTaskId) {
            setAwaitingPlanApproval(
              agentTaskId,
              deps.setAppStateForTasks ?? deps.setAppState,
              true,
            )
          }

          return {
            data: {
              plan,
              isAgent: true,
              filePath,
              awaitingLeaderApproval: true,
              requestId,
            },
          }
        }

        // Note: Background verification hook is registered in REPL.tsx AFTER context clear
        // via registerPlanVerificationHook(). Registering here would be cleared during context clear.

        // Ensure mode is changed when exiting plan mode.
        // This handles cases where permission flow didn't set the mode
        // (e.g., when PermissionRequest hook auto-approves without providing updatedPermissions).
        // Compute gate-off fallback before setAppState so we can notify the user.
        // Circuit breaker defense: if prePlanMode was an auto-like mode but the
        // gate is now off (circuit breaker or settings disable), restore to
        // 'default' instead. Without this, ExitPlanMode would bypass the circuit
        // breaker by calling setAutoModeActive(true) directly.
        let gateFallbackNotification: string | null = null
        if (feature('TRANSCRIPT_CLASSIFIER')) {
          const prePlanRaw = deps.permissions().prePlanMode ?? 'default'
          if (
            prePlanRaw === 'auto' &&
            !(permissionSetupModule?.isAutoModeGateEnabled() ?? false)
          ) {
            const reason =
              permissionSetupModule?.getAutoModeUnavailableReason() ??
              'circuit-breaker'
            gateFallbackNotification =
              permissionSetupModule?.getAutoModeUnavailableNotification(
                reason,
              ) ?? 'auto mode unavailable'
            logForDebugging(
              `[auto-mode gate @ ExitPlanModeV2Tool] prePlanMode=${prePlanRaw} ` +
                `but gate is off (reason=${reason}) — falling back to default on plan exit`,
              { level: 'warn' },
            )
          }
        }
        if (gateFallbackNotification) {
          deps.addNotification?.({
            key: 'auto-mode-gate-plan-exit-fallback',
            text: `plan exit → default · ${gateFallbackNotification}`,
            priority: 'immediate',
            color: 'warning',
            timeoutMs: 10000,
          })
        }

        // 2.1.325 #2295: Approving a subagent's plan must NOT mutate the main
        // session's shared permission mode or consume/revert its `prePlanMode`.
        if (!isAgent) {
          if (deps.setToolPermissionContext) {
            deps.setToolPermissionContext(restorePlanModePermissionContext)
          } else {
            deps.setAppState(prev => {
              const nextContext = restorePlanModePermissionContext(
                prev.toolPermissionContext,
              )
              if (nextContext === prev.toolPermissionContext) return prev
              return {
                ...prev,
                toolPermissionContext: nextContext,
              }
            })
          }
        }

        const hasTaskTool =
          isAgentSwarmsEnabled() &&
          deps.tools.some(t => toolMatchesName(t, AGENT_TOOL_NAME))

        return {
          data: {
            plan,
            isAgent,
            filePath,
            hasTaskTool: hasTaskTool || undefined,
            planWasEdited: inputPlan !== undefined || undefined,
            ...(planSaveNotice !== undefined && { planSaveNotice }),
          },
        }
      },
    }
  },
  mapToolResultToToolResultBlockParam(
    {
      isAgent,
      plan,
      filePath,
      hasTaskTool,
      planWasEdited,
      awaitingLeaderApproval,
      requestId,
      mailboxWriteFailed,
      planSaveNotice,
    },
    toolUseID,
  ) {
    // densable dO soft-fail — do not claim submission when mailbox write failed
    if (mailboxWriteFailed) {
      return {
        type: 'tool_result',
        content: `Failed to write the plan approval request to the team-lead mailbox (mailbox_write_failed). Nothing was sent.

Plan file: ${filePath}

Retry ExitPlanMode, or message the team lead directly. Request ID (not delivered): ${requestId}`,
        tool_use_id: toolUseID,
        is_error: true,
      }
    }

    // Handle teammate awaiting leader approval
    if (awaitingLeaderApproval) {
      return {
        type: 'tool_result',
        content: `Your plan has been submitted to the team lead for approval.

Plan file: ${filePath}

**What happens next:**
1. Wait for the team lead to review your plan
2. You will receive a message in your inbox with approval/rejection
3. If approved, you can proceed with implementation
4. If rejected, refine your plan based on the feedback

**Important:** Do NOT proceed until you receive approval. Check your inbox for response.

Request ID: ${requestId}`,
        tool_use_id: toolUseID,
      }
    }

    if (isAgent) {
      return {
        type: 'tool_result',
        content:
          'User has approved the plan. There is nothing else needed from you now. Please respond with "ok"',
        tool_use_id: toolUseID,
      }
    }

    // Handle empty plan
    if (!plan || plan.trim() === '') {
      return {
        type: 'tool_result',
        content: 'User has approved exiting plan mode. You can now proceed.',
        tool_use_id: toolUseID,
      }
    }

    const teamHint = hasTaskTool
      ? `\n\nIf this plan can be broken down into multiple independent tasks, consider spawning named teammates with the ${AGENT_TOOL_NAME} tool (pass a \`name\`) to parallelize the work.`
      : ''

    // Always include the plan so hosts can retrieve the approved text from
    // the tool_result. Label edited plans so the model knows the user
    // changed something.
    const planLabel = planWasEdited
      ? 'Approved Plan (edited by user)'
      : 'Approved Plan'

    const noticeSuffix = planSaveNotice ? `\n\nWarning: ${planSaveNotice}` : ''

    return {
      type: 'tool_result',
      content: `User has approved your plan. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: ${filePath}
You can refer back to it if needed during implementation.${noticeSuffix}${teamHint}

## ${planLabel}:
${plan}`,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
