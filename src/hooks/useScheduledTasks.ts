import { useEffect, useRef } from 'react'
import { useAppStateStore, useSetAppState } from '../state/AppState.js'
import { isTerminalTaskStatus } from '../Task.js'
import {
  findTeammateTaskByAgentId,
  injectUserMessageToTeammate,
} from '../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import { isKairosCronEnabled } from '@claude-code/builtin-tools/tools/ScheduleCronTool/prompt.js'
import type { Message } from '../types/message.js'
import { getCwd } from '../utils/cwd.js'
import { getCronJitterConfig } from '../utils/cronJitterConfig.js'
import { createCronScheduler } from '../utils/cronScheduler.js'
import { removeCronTasks, type CronTask } from '../utils/cronTasks.js'
import {
  createAutonomyQueuedPrompt,
  createAutonomyQueuedPromptIfNoActiveSource,
  markAutonomyRunCancelled,
  markAutonomyRunFailed,
} from '../utils/autonomyRuns.js'
import { logForDebugging } from '../utils/debug.js'
import {
  isLoopNoopFoldEnabled,
  settleLoopTickAfterIdle,
} from '../utils/loopDynamic.js'
import {
  resolveLoopDefaultFire,
  wakeupSourceForCronTask,
} from '../utils/loopFire.js'
import {
  appendLoopWakeupMessages,
  createLoopScheduledTaskFireMessage,
} from '../utils/loopNoopFold.js'
import { enqueuePendingNotification } from '../utils/messageQueueManager.js'
import { createScheduledTaskFireMessage } from '../utils/messages.js'
import { setLoopTickInFlightPrompt } from '../bootstrap/state.js'
import { WORKLOAD_CRON } from '../utils/workloadContext.js'
import type { QueuedCommand } from '../types/textInputTypes.js'

type Props = {
  isLoading: boolean
  /**
   * When true, bypasses the isLoading gate so tasks can enqueue while a
   * query is streaming rather than deferring to the next 1s check tick
   * after the turn ends. Assistant mode no longer forces --proactive
   * (#20425) so isLoading drops between turns like a normal REPL — this
   * bypass is now a latency nicety, not a starvation fix. The prompt is
   * enqueued at 'later' priority either way and drains between turns.
   */
  assistantMode?: boolean
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
}

export async function createScheduledTaskQueuedCommand(
  task: Pick<CronTask, 'id' | 'prompt'>,
  options?: {
    rootDir?: string
    currentDir?: string
    shouldCreate?: () => boolean
    /** densable L$t — expand autonomous/loop.md sentinels at fire time. */
    basePrompt?: string
  },
): Promise<QueuedCommand | null> {
  const command = await createAutonomyQueuedPromptIfNoActiveSource({
    basePrompt: options?.basePrompt ?? task.prompt,
    trigger: 'scheduled-task',
    rootDir: options?.rootDir,
    currentDir: options?.currentDir ?? getCwd(),
    sourceId: task.id,
    sourceLabel: task.prompt,
    workload: WORKLOAD_CRON,
    shouldCreate: options?.shouldCreate,
  })
  if (!command) {
    logForDebugging(
      `[ScheduledTasks] skipping ${task.id}: previous run still queued or running`,
    )
  }
  return command
}

/**
 * REPL wrapper for the cron scheduler. Mounts the scheduler once and tears
 * it down on unmount. Fired prompts go into the command queue as 'later'
 * priority, which the REPL drains via useCommandQueue between turns.
 *
 * densable `_QT` extras:
 *   - resolveLoopDefaultFire on fire (PU_)
 *   - kind==="loop" → setLoopTickInFlightPrompt (aPt) + loop wakeup message
 *   - after isLoading false: keepalive XKu if YKu && !rmt()
 *
 * Scheduler core (timer, file watcher, fire logic) lives in cronScheduler.ts
 * so SDK/-p mode can share it — see print.ts for the headless wiring.
 */
export function useScheduledTasks({
  isLoading,
  assistantMode = false,
  setMessages,
}: Props): void {
  // Latest-value ref so the scheduler's isLoading() getter doesn't capture
  // a stale closure. The effect mounts once; isLoading changes every turn.
  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading

  // densable o.current — scheduler handle for checkNow after keepalive arm.
  const schedulerRef = useRef<ReturnType<typeof createCronScheduler> | null>(
    null,
  )

  const store = useAppStateStore()
  const setAppState = useSetAppState()

  useEffect(() => {
    // Runtime gate checked here (not at the hook call site) so the hook
    // stays unconditionally mounted — rules-of-hooks forbid wrapping the
    // call in a dynamic condition. getFeatureValue_CACHED_WITH_REFRESH
    // reads from disk; the 5-min TTL fires a background refetch but the
    // effect won't re-run on value flip (assistantMode is the only dep),
    // so this guard alone is launch-grain. The mid-session killswitch is
    // the isKilled option below — check() polls it every tick.
    if (!isKairosCronEnabled()) return

    // System-generated — hidden from queue preview and transcript UI.
    // In brief mode, executeForkedSlashCommand runs as a background
    // subagent and returns no visible messages. In normal mode,
    // isMeta is only propagated for plain-text prompts (via
    // processTextPrompt); slash commands like /context:fork do not
    // forward isMeta, so their messages remain visible in the
    // transcript. This is acceptable since normal mode is not the
    // primary use case for scheduled tasks.
    let disposed = false
    /**
     * densable 2.1.221 fire stamp (SEA `yd` / `Pv`):
     *   value: resolveLoopDefaultFire(d), mode:"prompt", priority:"later",
     *   isMeta:!0, skipSlashCommands:!0, modelScheduledOrigin:!0,
     *   wakeupSource, workload
     * skipSlash + modelScheduledOrigin together: processUserInput re-opens
     * slash for model-invocable commands (`/loop` re-entry) while still
     * blocking exit-word / accidental slash on plain scheduled text.
     */
    const enqueueForLead = async (
      prompt: string,
      wakeupSource: 'loop_wakeup' | 'schedule_wakeup',
    ) => {
      const expanded = resolveLoopDefaultFire(prompt)
      const command = await createAutonomyQueuedPrompt({
        basePrompt: expanded,
        trigger: 'scheduled-task',
        currentDir: getCwd(),
        workload: WORKLOAD_CRON,
        shouldCreate: () => !disposed,
      })
      if (!command) {
        return
      }
      if (disposed) {
        await markAutonomyRunCancelled(
          command.autonomy!.runId,
          command.autonomy!.rootDir,
        )
        return
      }
      // Keep prepared command.value (RZn + optional AGENTS/HEARTBEAT authority).
      // densable stamps flags only — do NOT overwrite value with bare expanded
      // (that strips #20 RZn and local autonomy_authority; slash re-open reads
      // the body via extractModelScheduledSlashInput).
      enqueuePendingNotification({
        ...command,
        isMeta: true,
        priority: 'later',
        skipSlashCommands: true,
        modelScheduledOrigin: true,
        wakeupSource,
      })
    }

    const scheduler = createCronScheduler({
      // Missed-task surfacing (onFire fallback). Teammate crons are always
      // session-only (durable:false) so they never appear in the missed list,
      // which is populated from disk at scheduler startup — this path only
      // handles team-lead durable crons.
      onFire: prompt => {
        // densable: onFire → schedule_wakeup (legacy/missed list has no kind)
        void enqueueForLead(prompt, 'schedule_wakeup').catch(error =>
          logForDebugging(
            `[ScheduledTasks] failed to enqueue missed task prompt: ${error}`,
            { level: 'error' },
          ),
        )
      },
      // Normal fires receive the full CronTask so we can route by agentId.
      onFireTask: task => {
        void (async () => {
          if (task.agentId) {
            const teammate = findTeammateTaskByAgentId(
              task.agentId,
              store.getState().tasks,
            )
            if (teammate && !isTerminalTaskStatus(teammate.status)) {
              // densable dyn(p.id, d.prompt, …): inject RAW prompt — no
              // resolveLoopDefaultFire (lead path only expands sentinels).
              const command = await createScheduledTaskQueuedCommand(task, {
                shouldCreate: () => !disposed,
              })
              if (!command) {
                return
              }
              if (disposed) {
                await markAutonomyRunCancelled(
                  command.autonomy!.runId,
                  command.autonomy!.rootDir,
                )
                return
              }
              const injected = injectUserMessageToTeammate(
                teammate.id,
                // densable dyn(p.id, d.prompt): always raw task.prompt — never
                // resolveLoopDefaultFire / autonomy-prepared value.
                task.prompt,
                {
                  autonomyRunId: command.autonomy?.runId,
                  autonomyRootDir: command.autonomy?.rootDir,
                  origin: command.origin,
                },
                setAppState,
              )
              if (!injected && command.autonomy?.runId) {
                await markAutonomyRunFailed(
                  command.autonomy.runId,
                  `Teammate ${task.agentId} exited before the scheduled message could be delivered.`,
                  command.autonomy.rootDir,
                )
              }
              return
            }
            // Teammate is gone — clean up the orphaned cron so it doesn't keep
            // firing into nowhere every tick. One-shots would auto-delete on
            // fire anyway, but recurring crons would loop until auto-expiry.
            logForDebugging(
              `[ScheduledTasks] teammate ${task.agentId} gone, removing orphaned cron ${task.id}`,
            )
            void removeCronTasks([task.id])
            return
          }

          // Resolve once — autonomous preamble is sticky (Ain/wfr).
          const expanded = resolveLoopDefaultFire(task.prompt)
          const command = await createScheduledTaskQueuedCommand(task, {
            shouldCreate: () => !disposed,
            basePrompt: expanded,
          })
          if (!command) {
            // Do not aPt / keepalive on storm-deduped or disposed skips.
            return
          }
          if (disposed) {
            await markAutonomyRunCancelled(
              command.autonomy!.runId,
              command.autonomy!.rootDir,
            )
            return
          }

          // densable: kind==="loop" → aPt only after a real enqueue claim.
          if (task.kind === 'loop') {
            setLoopTickInFlightPrompt(task.prompt)
          }

          // densable UXm / Cfr: kind:loop + noop-fold → fold prior noop span when idle.
          // Always stamp cronKind:'loop' so later Cfr sessions keep fold anchors.
          if (task.kind === 'loop') {
            if (isLoopNoopFoldEnabled()) {
              setMessages(prev =>
                appendLoopWakeupMessages(prev, !isLoadingRef.current),
              )
            } else {
              setMessages(prev => [
                ...prev,
                createLoopScheduledTaskFireMessage(
                  `Claude resuming /loop wakeup (${formatCronFireTime(new Date())})`,
                  { cronKind: 'loop' },
                ),
              ])
            }
          } else {
            const msg = createScheduledTaskFireMessage(
              `Running scheduled task (${formatCronFireTime(new Date())})`,
            )
            setMessages(prev => [...prev, msg])
          }
          // densable 2.1.221 fire stamp 1:1 — flags only; keep prepared value
          // (basePrompt already expanded via resolveLoopDefaultFire above).
          enqueuePendingNotification({
            ...command,
            isMeta: true,
            priority: 'later',
            skipSlashCommands: true,
            modelScheduledOrigin: true,
            wakeupSource: wakeupSourceForCronTask(task.kind),
          })
        })().catch(error =>
          logForDebugging(
            `[ScheduledTasks] failed to enqueue task ${task.id}: ${error}`,
            { level: 'error' },
          ),
        )
      },
      isLoading: () => isLoadingRef.current,
      assistantMode,
      getJitterConfig: getCronJitterConfig,
      isKilled: () => !isKairosCronEnabled(),
    })
    scheduler.start()
    schedulerRef.current = scheduler
    return () => {
      disposed = true
      schedulerRef.current = null
      scheduler.stop()
    }
    // assistantMode is stable for the session lifetime; store/setAppState are
    // stable refs from useSyncExternalStore; setMessages is a stable useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantMode])

  // densable: after isLoading false → clear aPt; if YKu && !rmt() → XKu; checkNow
  useEffect(() => {
    if (isLoading) return
    settleLoopTickAfterIdle()
    schedulerRef.current?.checkNow()
  }, [isLoading])
}

function formatCronFireTime(d: Date): string {
  return d
    .toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    .replace(/,? at |, /, ' ')
    .replace(/ ([AP]M)/, (_, ampm) => ampm.toLowerCase())
}
