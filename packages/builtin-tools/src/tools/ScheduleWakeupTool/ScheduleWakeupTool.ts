/**
 * densable `otp` / ScheduleWakeup (SEA 2.1.221) — 1:1 product tool.
 *
 * Always registered in the base tools pool (no isEnabled). Call-time gate is
 * densable `jKe` (tengu_kairos_loop_dynamic); TX never-defers when jKe is on.
 * Runtime: QKu / JKu / $$t via src/utils/loopDynamic.ts.
 */

import { z } from 'zod/v4'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  isKairosLoopDynamicEnabled,
  isLoopNoopFoldEnabled,
  markLoopEnded,
  scheduleModelWakeup,
  stopDynamicLoop,
} from 'src/utils/loopDynamic.js'
import { semanticNumber } from 'src/utils/semanticNumber.js'
import { CRON_DELETE_TOOL_NAME } from '../ScheduleCronTool/prompt.js'
import { TASK_STOP_TOOL_NAME } from '../TaskStopTool/prompt.js'
import {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  AUTONOMOUS_LOOP_SENTINEL,
  SCHEDULE_WAKEUP_DESCRIPTION,
  SCHEDULE_WAKEUP_TOOL_NAME,
  buildScheduleWakeupPrompt,
  buildScheduleWakeupSearchHint,
  resolveScheduleWakeupCacheGuidance,
} from './prompt.js'

/** densable `Tw` — Monitor tool wire name (no shared constant export). */
const MONITOR_TOOL_NAME = 'Monitor'

/** densable `H3o` */
export class ScheduleWakeupInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleWakeupInputError'
  }
}

/** densable `QYs` — shape rebuilds when first resolved; Cfr gates `noop`. */
const inputSchema = lazySchema(() =>
  z.strictObject({
    delaySeconds: semanticNumber(z.number().optional()).describe(
      'Seconds from now to wake up. Clamped to [60, 3600] by the runtime. Required unless `stop` is true.',
    ),
    reason: z
      .string()
      .optional()
      .describe(
        'One short sentence explaining the chosen delay. Goes to telemetry and is shown to the user. Be specific. Required unless `stop` is true.',
      ),
    prompt: z
      .string()
      .optional()
      .describe(
        `The /loop input to fire on wake-up. Pass the same /loop input verbatim each turn so the next firing re-enters the skill and continues the loop. For autonomous /loop (no user prompt), pass the literal sentinel \`${AUTONOMOUS_LOOP_DYNAMIC_SENTINEL}\` instead (the dynamic-pacing variant, not the CronCreate-mode \`${AUTONOMOUS_LOOP_SENTINEL}\`). Required unless \`stop\` is true.`,
      ),
    stop: z
      .boolean()
      .optional()
      .describe(
        'Set to true to end the dynamic loop immediately instead of scheduling another wakeup. When true, all other fields are ignored and no further wakeups fire.',
      ),
    ...(isLoopNoopFoldEnabled()
      ? {
          noop: z
            .boolean()
            .optional()
            .describe(
              "true = nothing changed (you checked and there is nothing to report). false = something happened worth keeping (edited a file, posted a message, advanced state, surfaced a finding). Consecutive noop:true ticks are collapsed in the user's terminal view and tracked as a streak. Required unless `stop` is true.",
            ),
        }
      : {}),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type ScheduleWakeupInput = z.infer<InputSchema>

/** densable `Q9y` */
const outputSchema = lazySchema(() =>
  z.object({
    scheduledFor: z
      .number()
      .describe('Epoch ms timestamp when the next wakeup will fire'),
    clampedDelaySeconds: z
      .number()
      .describe('Actual delay used after clamping to runtime bounds'),
    wasClamped: z
      .boolean()
      .describe('True if the requested delaySeconds was outside [60, 3600]'),
    stopped: z
      .boolean()
      .optional()
      .describe('True when the model ended the loop via `stop: true`'),
    cancelledWakeups: z
      .number()
      .optional()
      .describe(
        'How many pending dynamic-loop wakeups stop:true cancelled. 0 means nothing was pending — a recurring /loop cron is not cancelled by stop:true.',
      ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ScheduleWakeupOutput = z.infer<OutputSchema>

export const ScheduleWakeupTool = buildTool({
  name: SCHEDULE_WAKEUP_TOOL_NAME,
  // densable searchHint via EU / CronDelete
  searchHint: buildScheduleWakeupSearchHint(),
  // densable maxResultSizeChars:1000
  maxResultSizeChars: 1000,
  // densable shouldDefer:!0
  shouldDefer: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  async description() {
    return SCHEDULE_WAKEUP_DESCRIPTION
  },

  async prompt() {
    // densable: FKu("noop"in QYs().shape, e===t?e:void 0)
    return buildScheduleWakeupPrompt(
      'noop' in inputSchema().shape,
      resolveScheduleWakeupCacheGuidance(),
    )
  },

  // densable userFacingName:()=>""
  userFacingName() {
    return ''
  },

  toAutoClassifierInput(input: ScheduleWakeupInput) {
    if (input.stop === true) {
      return 'stop the /loop — cancel pending wakeups, schedule nothing'
    }
    if (input.delaySeconds == null || input.prompt == null) {
      return `malformed ${SCHEDULE_WAKEUP_TOOL_NAME} call missing delaySeconds/prompt — the tool will reject it`
    }
    return `wake in ${input.delaySeconds}s: ${input.prompt}`
  },

  async checkPermissions(input, context) {
    // densable: if(bn(t).mode==="auto") return passthrough
    if (context.getAppState().toolPermissionContext.mode === 'auto') {
      return {
        behavior: 'passthrough' as const,
        message: 'Scheduling a /loop wakeup requires classifier review.',
      }
    }
    return { behavior: 'allow' as const, updatedInput: input }
  },

  // densable renderToolUseMessage(){return null}
  renderToolUseMessage() {
    return null
  },

  async call(input: ScheduleWakeupInput) {
    const { delaySeconds, reason, prompt, stop } = input
    // densable stop path → QKu
    if (stop === true) {
      return {
        data: {
          scheduledFor: 0,
          clampedDelaySeconds: 0,
          wasClamped: false,
          stopped: true,
          cancelledWakeups: stopDynamicLoop(),
        },
      }
    }
    if (delaySeconds === undefined || reason === undefined) {
      throw new ScheduleWakeupInputError(
        '`delaySeconds` and `reason` are required when `stop` is not true.',
      )
    }
    if (prompt === undefined) {
      throw new ScheduleWakeupInputError(
        '`prompt` is required when `stop` is not true.',
      )
    }
    // densable: "noop"in QYs().shape && e.noop===void 0
    if (
      'noop' in inputSchema().shape &&
      (input as { noop?: boolean }).noop === undefined
    ) {
      throw new ScheduleWakeupInputError(
        '`noop` is required when `stop` is not true.',
      )
    }
    // densable !jKe → $$t("gate_off") + zeros
    if (!isKairosLoopDynamicEnabled()) {
      markLoopEnded('gate_off')
      return {
        data: {
          scheduledFor: 0,
          clampedDelaySeconds: 0,
          wasClamped: false,
        },
      }
    }
    // densable JKu(t,n,r)
    const scheduled = scheduleModelWakeup(delaySeconds, prompt, reason)
    if (scheduled === null) {
      return {
        data: {
          scheduledFor: 0,
          clampedDelaySeconds: 0,
          wasClamped: false,
        },
      }
    }
    return {
      data: {
        scheduledFor: scheduled.scheduledFor,
        clampedDelaySeconds: scheduled.clampedDelaySeconds,
        wasClamped: scheduled.wasClamped,
      },
    }
  },

  mapToolResultToToolResultBlockParam(
    content: ScheduleWakeupOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    const {
      scheduledFor,
      clampedDelaySeconds,
      wasClamped,
      stopped,
      cancelledWakeups,
    } = content
    if (stopped === true) {
      const monitorHint = `If you armed a ${MONITOR_TOOL_NAME} for this loop, ${TASK_STOP_TOOL_NAME} it now; otherwise nothing more to do this turn.`
      if (cancelledWakeups === 0) {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `Loop stopped — any dynamic loop in this session is ended; there was no pending wakeup to cancel. If you are running a fixed-interval /loop (a recurring cron), it is NOT stopped by this call — cancel it with ${CRON_DELETE_TOOL_NAME}. ${monitorHint}`,
        }
      }
      const cancelled =
        cancelledWakeups === undefined
          ? 'no further wakeups scheduled'
          : `cancelled ${cancelledWakeups} pending wakeup(s); no further dynamic-loop wakeups scheduled`
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `Loop stopped — ${cancelled}. ${monitorHint}`,
      }
    }
    if (scheduledFor === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content:
          'Wakeup not scheduled. Either the /loop dynamic runtime gate is off or the loop reached its maximum duration — the loop has ended; do not re-issue.',
      }
    }
    const time = new Date(scheduledFor).toTimeString().slice(0, 8)
    const inSeconds = Math.max(
      0,
      Math.round((scheduledFor - Date.now()) / 1000),
    )
    const clampNote = wasClamped
      ? ` (clamped to ${clampedDelaySeconds}s from your requested value)`
      : ''
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Next wakeup scheduled for ${time} (in ${inSeconds}s)${clampNote}. Nothing more to do this turn — the harness re-invokes you when the wakeup fires or a task-notification arrives.`,
    }
  },
} satisfies ToolDef<InputSchema, ScheduleWakeupOutput>)
