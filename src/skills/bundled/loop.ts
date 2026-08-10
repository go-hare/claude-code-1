/**
 * densable `/loop` skill (SEA 2.1.221 `vjT` / `TjT` / `bjT` / `aqm`).
 *
 * Modes:
 *   - Fixed interval → CronCreate (bjT)
 *   - jKe + no interval → ScheduleWakeup dynamic self-pace (TjT)
 *   - qAs + empty/interval-only → autonomous / loop.md default (aqm)
 */
import {
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  DEFAULT_MAX_AGE_DAYS,
  isKairosCronEnabled,
} from '@claude-code/builtin-tools/tools/ScheduleCronTool/prompt.js'
import { SCHEDULE_WAKEUP_TOOL_NAME } from '@claude-code/builtin-tools/tools/ScheduleWakeupTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskListTool/constants.js'
import { TASK_STOP_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskStopTool/prompt.js'
import { logEvent } from 'src/services/analytics/index.js'
import {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  AUTONOMOUS_LOOP_SENTINEL,
  clearLoopEndedOnLoopStart,
  isKairosLoopDynamicEnabled,
} from 'src/utils/loopDynamic.js'
import {
  getAutonomousLoopPreamble,
  isLoopDefaultPromptEnabled,
  isLoopPushNotifGuidanceEnabled,
  logAutonomousLoopActivation,
  LOOP_FILE_DYNAMIC_SENTINEL,
  LOOP_FILE_SENTINEL,
  readLoopFile,
  type LoopFile,
} from 'src/utils/loopFire.js'
import { registerBundledSkill } from '../bundledSkills.js'

const DEFAULT_INTERVAL = '10m'
/** densable Monitor wire name (Tw). */
const MONITOR_TOOL_NAME = 'Monitor'

const LEADING_INTERVAL = /^\d+[smhd]$/
const EVERY_INTERVAL_ONLY =
  /^every\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s*$/i

const INTERVAL_CRON_TABLE = `| Interval pattern      | Cron expression     | Notes                                    |
|-----------------------|---------------------|------------------------------------------|
| \`Nm\` where N ≤ 59   | \`*/N * * * *\`     | every N minutes                          |
| \`Nm\` where N ≥ 60   | \`0 */H * * *\`     | round to hours (H = N/60, must divide 24)|
| \`Nh\` where N ≤ 23   | \`0 */N * * *\`     | every N hours                            |
| \`Nd\`                | \`0 0 */N * *\`     | every N days at midnight local           |
| \`Ns\`                | treat as \`ceil(N/60)m\` | cron minimum granularity is 1 minute  |

**If the interval doesn't cleanly divide its unit** (e.g. \`7m\` → \`*/7 * * * *\` gives uneven gaps at :56→:00; \`90m\` → 1.5h which cron can't express), pick the nearest clean interval and tell the user what you rounded to before scheduling.`

/** densable `lqm` — push-notif stop guidance when agent push is on. */
function stopPushNotifGuidance(): string {
  if (!isLoopPushNotifGuidanceEnabled()) return ''
  return ` Before you stop, send a one-line outcome via PushNotification — the user may be away and waiting to hear it's done. Skip this if you're stopping because the user just told you to; they're already here.`
}

/** densable `gjT` — normalize "every N unit" match to Ns/Nm/Nh/Nd. */
function everyMatchToInterval(match: RegExpMatchArray): string {
  const n = match[1]!
  const unit = match[2]!.toLowerCase()
  if (unit.startsWith('s')) return `${n}s`
  if (unit.startsWith('h')) return `${n}h`
  if (unit.startsWith('d')) return `${n}d`
  return `${n}m`
}

function fixedIntervalUsage(): string {
  return `Usage: /loop [interval] <prompt>

Run a prompt or slash command on a recurring interval.

Intervals: Ns, Nm, Nh, Nd (e.g. 5m, 30m, 2h, 1d). Minimum granularity is 1 minute.
If no interval is specified, defaults to ${DEFAULT_INTERVAL}.

Examples:
  /loop 5m /babysit-prs
  /loop 30m check the deploy
  /loop 1h /standup 1
  /loop check the deploy          (defaults to ${DEFAULT_INTERVAL})
  /loop check the deploy every 20m`
}

/** densable `SjT` */
function dynamicUsage(): string {
  return `Usage: /loop [interval] <prompt>

Run a prompt or slash command on a recurring interval — or with no interval, let the model self-pace based on the task.

Intervals: Ns, Nm, Nh, Nd (e.g. 5m, 30m, 2h, 1d). Minimum granularity is 1 minute.
If no interval is specified, the model picks a delay between iterations based on what it's doing.

Examples:
  /loop 5m /babysit-prs
  /loop 30m check the deploy
  /loop 1h /standup 1
  /loop check the deploy          (dynamic — model picks delays)
  /loop check the deploy every 20m`
}

/** densable `bjT` — fixed CronCreate path (jKe off or interval present). */
function buildFixedIntervalPrompt(args: string): string {
  return `# /loop — schedule a recurring prompt

Parse the input below into \`[interval] <prompt…>\` and schedule it with ${CRON_CREATE_TOOL_NAME}.

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches \`^\\d+[smhd]$\` (e.g. \`5m\`, \`2h\`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with \`every <N><unit>\` or \`every <N> <unit-word>\` (e.g. \`every 20m\`, \`every 5 minutes\`, \`every 2 hours\`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — \`check every PR\` has no interval.
3. **Default**: otherwise, interval is \`${DEFAULT_INTERVAL}\` and the entire input is the prompt.

If the resulting prompt is empty, show usage \`/loop [interval] <prompt>\` and stop — do not call ${CRON_CREATE_TOOL_NAME}.

Examples:
- \`5m /babysit-prs\` → interval \`5m\`, prompt \`/babysit-prs\` (rule 1)
- \`check the deploy every 20m\` → interval \`20m\`, prompt \`check the deploy\` (rule 2)
- \`run tests every 5 minutes\` → interval \`5m\`, prompt \`run tests\` (rule 2)
- \`check the deploy\` → interval \`${DEFAULT_INTERVAL}\`, prompt \`check the deploy\` (rule 3)
- \`check every PR\` → interval \`${DEFAULT_INTERVAL}\`, prompt \`check every PR\` (rule 3 — "every" not followed by time)
- \`5m\` → empty prompt → show usage

## Interval → cron

Supported suffixes: \`s\` (seconds, rounded up to nearest minute, min 1), \`m\` (minutes), \`h\` (hours), \`d\` (days). Convert:

${INTERVAL_CRON_TABLE}

## Action

1. Call ${CRON_CREATE_TOOL_NAME} with:
   - \`cron\`: the expression from the table above
   - \`prompt\`: the parsed prompt from above, verbatim (slash commands are passed through unchanged)
   - \`recurring\`: \`true\`
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that they can cancel sooner with ${CRON_DELETE_TOOL_NAME} (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.

## Input

${args}`
}

/** densable `TjT` — jKe dynamic self-pace when no interval. */
function buildDynamicPrompt(args: string): string {
  const dynamicBody = `The user wants you to self-pace. Decide what makes the next iteration worth running — a passage of time, or an observable event.

1. **Run the parsed prompt now.** If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.
2. **If the next run is gated on an event** (CI finishing, a log line matching, a file changing, a PR comment) and no ${MONITOR_TOOL_NAME} is already running for it: arm one now with \`persistent: true\`. Its events arrive as \`<task-notification>\` messages and wake this loop immediately — you do not wait for the ${SCHEDULE_WAKEUP_TOOL_NAME} deadline. Arm once; on later iterations call ${TASK_LIST_TOOL_NAME} first and skip this step if a monitor is already running.
3. **Briefly confirm**: that you're self-pacing, whether a ${MONITOR_TOOL_NAME} is the primary wake signal, that you ran the task now, and what fallback delay you're about to pick. Write this as text *before* calling ${SCHEDULE_WAKEUP_TOOL_NAME} — the turn ends as soon as that tool returns.
4. **Then, as the last action of this turn, decide whether the loop continues.** If the task needs another iteration, call ${SCHEDULE_WAKEUP_TOOL_NAME} with:
   - \`delaySeconds\`: with a ${MONITOR_TOOL_NAME} armed this is the **fallback heartbeat** — how long to wait if no event fires (lean 1200–1800s; idle ticks more frequent than the task needs are pure overhead). Without a ${MONITOR_TOOL_NAME} this is the cadence — pick based on what you observed. Read the tool's own description for cache-aware delay guidance.
   - \`reason\`: one short sentence on why you picked that delay.
   - \`prompt\`: the full original /loop input verbatim, prefixed with \`/loop \` so the next firing re-enters this skill and continues the loop. For example, if the user typed \`/loop check the deploy\`, pass \`/loop check the deploy\` as the prompt.
   If it doesn't need another iteration, stop instead (step 6) — re-arming is a per-turn choice, not a default.
5. **If you were woken by a \`<task-notification>\`** rather than this prompt: handle the event in the context of the loop task, then make the same decision. If the loop should continue, call ${SCHEDULE_WAKEUP_TOOL_NAME} again with the same \`prompt\` and the same 1200–1800s \`delaySeconds\` from step 4 (the ${MONITOR_TOOL_NAME} remains the wake signal; the new wakeup is only the fallback heartbeat). If the event means the work is finished, stop (step 6).
6. **To stop the loop** — the task is complete, further iterations can't make progress, or the user asked you to stop — call ${SCHEDULE_WAKEUP_TOOL_NAME} with \`stop: true\` (no other fields) and ${TASK_STOP_TOOL_NAME} any ${MONITOR_TOOL_NAME} you armed (use ${TASK_LIST_TOOL_NAME} to find the task ID if it is no longer in context). Stopping is the loop's normal ending — the user can restart it anytime with /loop.${stopPushNotifGuidance()}`

  return `# /loop — schedule a recurring or self-paced prompt

Parse the input below into \`[interval] <prompt…>\` and schedule it.

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches \`^\\d+[smhd]$\` (e.g. \`5m\`, \`2h\`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with \`every <N><unit>\` or \`every <N> <unit-word>\` (e.g. \`every 20m\`, \`every 5 minutes\`, \`every 2 hours\`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — \`check every PR\` has no interval.
3. **No interval**: otherwise, the entire input is the prompt and you'll self-pace dynamically (see "Dynamic mode" below).

If the resulting prompt is empty, show usage \`/loop [interval] <prompt>\` and stop.

Examples:
- \`5m /babysit-prs\` → interval \`5m\`, prompt \`/babysit-prs\` (rule 1)
- \`check the deploy every 20m\` → interval \`20m\`, prompt \`check the deploy\` (rule 2)
- \`run tests every 5 minutes\` → interval \`5m\`, prompt \`run tests\` (rule 2)
- \`check the deploy\` → no interval → dynamic mode, prompt \`check the deploy\` (rule 3)
- \`check every PR\` → no interval → dynamic mode, prompt \`check every PR\` (rule 3 — "every" not followed by time)
- \`5m\` → empty prompt → show usage

## Fixed-interval mode (rules 1 and 2)

Convert the interval to a cron expression:

${INTERVAL_CRON_TABLE}

Then:
1. Call ${CRON_CREATE_TOOL_NAME} with: \`cron\` (the expression above), \`prompt\` (the parsed prompt verbatim), \`recurring: true\`.
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that the user can cancel sooner with ${CRON_DELETE_TOOL_NAME} (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.

## Dynamic mode (rule 3 — no interval)

${dynamicBody}

## Input

${args}`
}

/**
 * densable `aqm` — empty / interval-only + qAs → autonomous or loop.md default.
 */
function buildAutonomousDefaultPrompt(
  loopFile: LoopFile | null,
  dynamic: boolean,
  intervalToken: string,
): string {
  const sectionTitle = loopFile
    ? `## Loop tasks (from ${loopFile.path})`
    : '## Autonomous-loop instructions (for the immediate execution and every fire)'
  let body: string
  if (loopFile) {
    body = loopFile.content
  } else {
    logAutonomousLoopActivation()
    body = getAutonomousLoopPreamble()
  }
  const workLabel = loopFile ? 'the loop.md tasks' : 'the autonomous check'

  if (dynamic) {
    const sentinel = loopFile
      ? LOOP_FILE_DYNAMIC_SENTINEL
      : AUTONOMOUS_LOOP_DYNAMIC_SENTINEL
    const header = loopFile
      ? `# /loop — loop.md tasks with dynamic pacing

The user invoked \`/loop\` with no prompt and no interval and has a loop-tasks file at \`${loopFile.path}\`. Run those tasks now, then self-pace the next iteration via ${SCHEDULE_WAKEUP_TOOL_NAME} — no cron.`
      : `# /loop — autonomous default with dynamic pacing

The user invoked \`/loop\` with no prompt and no interval. Run the autonomous check now, then self-pace the next iteration via ${SCHEDULE_WAKEUP_TOOL_NAME} — no cron.`
    const confirm = loopFile
      ? `that you're running tasks from \`${loopFile.path}\` in dynamic-pacing mode, that you ran the first tick now`
      : 'that this is the autonomous default in dynamic-pacing mode, that you ran the check now'
    const actions = `1. **Run ${workLabel} now**, following the instructions inlined below.
2. **If the next tick is gated on an event** (CI finishing, a PR comment, a log line) and no ${MONITOR_TOOL_NAME} is already running for it: arm one now with \`persistent: true\`. Its events wake this loop immediately — you do not wait for the ${SCHEDULE_WAKEUP_TOOL_NAME} deadline. Arm once; on later ticks call ${TASK_LIST_TOOL_NAME} first and skip if a monitor is already running.
3. **Briefly confirm**: ${confirm}, whether a ${MONITOR_TOOL_NAME} is the primary wake signal, and what fallback delay you're about to pick. Write this as text *before* calling ${SCHEDULE_WAKEUP_TOOL_NAME} — the turn ends as soon as that tool returns.
4. **Then, as the last action of this turn, decide whether the loop continues.** If the next check is worth running, call ${SCHEDULE_WAKEUP_TOOL_NAME} with:
   - \`delaySeconds\`: with a ${MONITOR_TOOL_NAME} armed this is the fallback heartbeat (lean 1200–1800s). Without one, pick based on what you observed this turn — quiet branch? wait longer. Lots in flight? wait shorter. Read the tool's own description for cache-aware delay guidance.
   - \`reason\`: one short sentence on why you picked that delay.
   - \`prompt\`: the literal string \`${sentinel}\` — the dynamic-mode sentinel expands at fire time to the full instructions (first fire / first fire post-compact / loop.md edited) or a dynamic-pacing-specific short reminder (subsequent fires). Do not pass the full instructions; that is handled automatically.
   If it isn't, stop instead (step 6) — re-arming is a per-turn choice, not a default.
5. **If woken by a \`<task-notification>\`** rather than this prompt: handle the event, then make the same decision. If the loop should continue, call ${SCHEDULE_WAKEUP_TOOL_NAME} again with \`${sentinel}\` and the same 1200–1800s \`delaySeconds\` (the ${MONITOR_TOOL_NAME} remains the wake signal; the new wakeup is only the fallback heartbeat). If the event means the work is finished, stop (step 6).
6. **To stop the loop** — the task is complete, further iterations can't make progress, or the user asked you to stop — call ${SCHEDULE_WAKEUP_TOOL_NAME} with \`stop: true\` (no other fields) and ${TASK_STOP_TOOL_NAME} any ${MONITOR_TOOL_NAME} you armed (use ${TASK_LIST_TOOL_NAME} to find the task ID if it is no longer in context). Stopping is the loop's normal ending — the user can restart it anytime with /loop.${stopPushNotifGuidance()}`
    return `${header}

## Action

${actions}

${sectionTitle}

${body}`
  }

  const sentinel = loopFile ? LOOP_FILE_SENTINEL : AUTONOMOUS_LOOP_SENTINEL
  const header = loopFile
    ? `# /loop — schedule loop.md tasks

The user invoked \`/loop\` with no prompt (input was empty or just the interval \`${intervalToken}\`) and has a loop-tasks file at \`${loopFile.path}\`. Schedule a recurring cron that runs those tasks each tick, then run the first tick immediately.`
    : `# /loop — schedule the autonomous default

The user invoked \`/loop\` with no prompt (input was empty or just the interval \`${intervalToken}\`). Schedule the autonomous-loop default and then run the first autonomous check immediately.`
  const expandNote = loopFile
    ? 'it expands at fire time to the full loop.md contents on first delivery (and whenever loop.md has been edited since last fire), and to a short reminder on subsequent unchanged fires. The long instructions stay in the cached message-prefix.'
    : 'it expands at fire time to the full autonomous-loop instructions on first delivery, and to a short reminder on subsequent fires (the long instructions stay in the cached message-prefix).'
  const confirm = loopFile
    ? `what's scheduled, the cron expression, the human-readable cadence, that it's running tasks from \`${loopFile.path}\`, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that the user can cancel sooner with ${CRON_DELETE_TOOL_NAME} (include the job ID).`
    : `what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that they can cancel sooner with ${CRON_DELETE_TOOL_NAME} (include the job ID). Mention this is the autonomous default and that the autonomous-loop instructions are baked in.`
  return `${header}

## Action

1. Convert \`${intervalToken}\` to a 5-field cron expression. Supported suffixes: \`s\` → ceil to nearest minute, \`m\` (minutes), \`h\` (hours), \`d\` (days). Examples: \`5m\` → \`*/5 * * * *\`, \`1h\` → \`0 * * * *\`, \`1d\` → \`0 0 * * *\`. If the interval doesn't cleanly divide its unit, round to the nearest clean interval and tell the user what you rounded to.
2. Call ${CRON_CREATE_TOOL_NAME} with:
   - \`cron\`: the expression from step 1
   - \`prompt\`: the literal string \`${sentinel}\` — ${expandNote}
   - \`recurring\`: \`true\`
3. Briefly confirm: ${confirm}
4. **Then immediately run ${workLabel} now**, following the instructions inlined below. Don't wait for the first cron fire.

${sectionTitle}

${body}`
}

export function registerLoopSkill(): void {
  registerBundledSkill({
    name: 'loop',
    // densable menuDescription
    description: isKairosLoopDynamicEnabled()
      ? 'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo). Omit the interval to let the model self-pace.'
      : 'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo, defaults to 10m)',
    whenToUse:
      'When the user wants to set up a recurring task, poll for status, or run something repeatedly on an interval (e.g. "check the deploy every 5 minutes", "keep running /babysit-prs"). Do NOT invoke for one-off tasks.',
    argumentHint: isLoopDefaultPromptEnabled()
      ? '[interval] [prompt]'
      : '[interval] <prompt>',
    userInvocable: true,
    isEnabled: isKairosCronEnabled,
    async getPromptForCommand(args, context) {
      const trimmed = args.trim()
      // densable: skip tengu_loop_command when skill preload / model-scheduled
      const opts = (
        context as {
          options?: { isSkillPreload?: boolean; modelScheduledOrigin?: boolean }
        }
      ).options
      const isSystem =
        opts?.isSkillPreload === true || opts?.modelScheduledOrigin === true
      if (!isSystem) {
        logEvent(
          'tengu_loop_command' as never,
          {
            has_args: trimmed.length > 0,
            is_interval_only:
              LEADING_INTERVAL.test(trimmed) ||
              EVERY_INTERVAL_ONLY.test(trimmed),
          } as never,
        )
      }

      // densable qAs path: empty or interval-only → autonomous / loop.md
      const everyOnly = trimmed.match(EVERY_INTERVAL_ONLY)
      const empty = !trimmed
      const intervalOnly = LEADING_INTERVAL.test(trimmed) || everyOnly !== null
      if ((empty || intervalOnly) && isLoopDefaultPromptEnabled()) {
        const intervalToken = everyOnly
          ? everyMatchToInterval(everyOnly)
          : trimmed || DEFAULT_INTERVAL
        const loopFile = readLoopFile()
        if (empty && isKairosLoopDynamicEnabled()) {
          if (!isSystem) clearLoopEndedOnLoopStart()
          return [
            {
              type: 'text',
              text: buildAutonomousDefaultPrompt(loopFile, true, intervalToken),
            },
          ]
        }
        return [
          {
            type: 'text',
            text: buildAutonomousDefaultPrompt(loopFile, false, intervalToken),
          },
        ]
      }

      if (isKairosLoopDynamicEnabled()) {
        if (!trimmed) {
          return [{ type: 'text', text: dynamicUsage() }]
        }
        if (!isSystem) clearLoopEndedOnLoopStart()
        return [{ type: 'text', text: buildDynamicPrompt(trimmed) }]
      }

      if (!trimmed) {
        return [{ type: 'text', text: fixedIntervalUsage() }]
      }
      return [{ type: 'text', text: buildFixedIntervalPrompt(trimmed) }]
    },
  })
}
