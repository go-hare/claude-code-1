/**
 * Official ObserverReport tool (WId / Sbo) — observer → observed delivery.
 * Gate: CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS (+ pairing registry).
 */
import { z } from 'zod/v4'
import type { ToolResultBlockParam, ToolUseContext } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import {
  isLocalAgentTask,
  queuePendingMessage,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import {
  deliverObserverReport,
  getArmedObserverPairing,
  isObserverTaskId,
} from 'src/utils/observerAgents.js'
import { isExperimentalObserverAgentsEnabled as isObserverEnv } from 'src/utils/residualFinalEnvGates.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { enqueuePendingNotification } from 'src/utils/messageQueueManager.js'
import { OBSERVER_REPORT_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    report: z
      .string()
      .min(1)
      .describe(
        'The report to deliver to the observed agent. Be concise and specific.',
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

/**
 * Env / GB gate for registry inclusion. Tool.isEnabled has no agentId, so
 * call/checkPermissions + filterToolsForAgent(isObserverAgent) further
 * restrict prompt exposure to armed observer agents only.
 */
export function isObserverReportEnabled(
  env: NodeJS.ProcessEnv = process.env,
  gbValue?: boolean,
): boolean {
  return isObserverEnv({ env, gbValue })
}

/**
 * Official WId surface densable — true only for an armed observer task id
 * (pairing present). Main session and non-observer agents stay false so the
 * tool is not freely offered outside observer async agents.
 */
export function isObserverReportCallable(
  agentId: string | undefined | null,
): boolean {
  if (!agentId) return false
  if (getArmedObserverPairing(agentId)) return true
  // Still registered as observer task (e.g. mid-arm) — allow call path to
  // return the official not-armed message rather than tool-missing.
  return isObserverTaskId(agentId)
}

/**
 * Official prompt-surface densable — whether ObserverReport should be
 * considered actively armable for this agentId (armed pairing, not merely
 * registered). Used by tests / host diagnostics; call still accepts
 * isObserverTaskId for mid-arm error messages.
 */
export function isObserverReportArmed(
  agentId: string | undefined | null,
): boolean {
  if (!agentId) return false
  return getArmedObserverPairing(agentId) !== undefined
}

export const ObserverReportTool = buildTool({
  name: OBSERVER_REPORT_TOOL_NAME,
  searchHint: 'observer report deliver to observed agent',
  maxResultSizeChars: 1000,
  // Deferred for main pool; observers get it via ASYNC_AGENT_ALLOWED_TOOLS
  // + filterToolsForAgent(isObserverAgent=true).
  shouldDefer: true,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isEnabled() {
    // Env/GB gate at registry level (no agentId on Tool.isEnabled).
    // filterToolsForAgent strips from non-observer agent pools; call and
    // checkPermissions further require isObserverReportCallable(agentId).
    return isObserverReportEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false
  },

  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },

  userFacingName() {
    return 'Observer report'
  },

  toAutoClassifierInput(input: Input) {
    return `ObserverReport ${input.report?.slice(0, 80) ?? ''}`
  },

  renderToolUseMessage(input: Partial<Input>) {
    if (!input.report) return 'Observer report'
    const preview =
      input.report.length > 60 ? `${input.report.slice(0, 60)}…` : input.report
    return `report: ${preview}`
  },

  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.message,
      is_error: !content.success,
    }
  },

  async checkPermissions(input, context) {
    // Official: only observer agents may invoke; main session has no pairing.
    if (!isObserverReportCallable(context?.agentId)) {
      return {
        behavior: 'deny' as const,
        message:
          'ObserverReport is only available to an observer agent; the main session does not have an observed pairing.',
        decisionReason: {
          type: 'other' as const,
          reason: 'not_observer_agent',
        },
      }
    }
    return { behavior: 'allow' as const, updatedInput: input }
  },

  async call(input: Input, context: ToolUseContext) {
    if (!isObserverReportCallable(context.agentId)) {
      return {
        data: {
          success: false,
          message:
            'ObserverReport is only available to an observer agent; the main session does not have an observed pairing.',
        } satisfies Output,
      }
    }
    const result = deliverObserverReport({
      observerTaskId: context.agentId,
      report: input.report,
      isObservedRunning: observedTaskId => {
        try {
          const task = context.getAppState().tasks[observedTaskId]
          return isLocalAgentTask(task) && task.status === 'running'
        } catch {
          return false
        }
      },
      enqueueMain: (value, origin) => {
        // densable IT({mode:"prompt",...,origin:l,skipSlashCommands:!0,isMeta:!0})
        // origin kind is "observer" (not observer-activity) so Fws can frame.
        enqueuePendingNotification({
          mode: 'prompt',
          value,
          priority: 'next',
          isMeta: true,
          skipSlashCommands: true,
          origin: origin as never,
        })
      },
      enqueueAgent: (observedTaskId, value, origin) => {
        // Async observers get a no-op setAppState from forkedAgent
        // (shareSetAppState: !isAsync). Root task queue writes must use
        // setAppStateForTasks, same as query/autoDream/observer host.
        // densable sqe(…,{origin:l, isMeta:!0}) with kind:"observer".
        const setAppState = context.setAppStateForTasks ?? context.setAppState
        queuePendingMessage(observedTaskId, value, setAppState, {
          isMeta: true,
          origin: origin as never,
        })
      },
    })
    return {
      data: {
        success: result.success,
        message: result.message,
      } satisfies Output,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
