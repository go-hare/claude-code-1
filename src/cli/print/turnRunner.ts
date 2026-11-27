/**
 * Headless streaming turn runner lifecycle: MCP/plugin startup joins, command drain loop,
 * background agent wait ceiling/wind-down, held-back result flush, and team teardown.
 */
import type {
  HeadlessStreamingContext,
  TurnRunDrainState,
} from './streamingTypes.js'
import { runDrainCommandQueue } from './turnDrain.js'
import { notifySessionStateChanged } from 'src/utils/sessionState.js'
import { headlessProfilerCheckpoint } from 'src/utils/headlessProfiler.js'
import { getHooksConfigFromSnapshot } from '../../utils/hooks/hooksConfigSnapshot.js'
import {
  collectRequiredMcpPrewaitServers,
  resolveMcpStartupPrewaitBudgetMs,
} from '../../services/mcp/mcpConnectTimeout.js'
import { normalizeNameForMCP } from '../../services/mcp/normalization.js'
import { createAbortController } from 'src/utils/abortController.js'
import {
  raceWithTimeoutMs,
  resolveSyncPluginsInstallTimeoutMs,
  formatSyncPluginInstallTimeoutLog,
} from 'src/utils/residualFinalEnvGates.js'
import { logError, getInMemoryErrors } from 'src/utils/log.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import { createPrintTaskNotificationCoalesceState } from 'src/cli/printTaskNotificationCoalesce.js'
import {
  createPrintStartGate,
  createPrintPrewaitLatch,
  isPrintUserIntentCommand,
} from 'src/cli/printDrainGates.js'
import {
  shouldHaltBackgroundAgentsForBudget,
  formatPrintBudgetHaltDebug,
  formatPrintBudgetHaltStderr,
  haltBackgroundAgentsForBudget,
} from '../../utils/budgetHalt.js'
import { getRunningTasks } from '../../utils/task/framework.js'
import { isBackgroundTask } from '../../tasks/types.js'
import { peek, enqueue } from 'src/utils/messageQueueManager.js'
import { isPrintQueueableCommand } from 'src/cli/printPromptBatch.js'
import { detachedToolCallsOweResult } from 'src/utils/detachedToolCallStore.js'
import {
  hasPendingSessionWakeup,
  getPrintBgWaitCeilingMs,
  advanceSharedPrintBgWaitFirstIdle,
  formatPrintBgWaitCeilingMessage,
  nextPrintBgWaitGate,
  shouldStopAgentsOnPrintBgCeiling,
  formatPrintWindDownMessage,
  PRINT_BG_WAIT_GRACE_MS,
  canReportSessionIdleWithBgActivity,
} from '../printBgWait.js'
import { getSessionCronTasks, getSessionId } from 'src/bootstrap/state.js'
import {
  PRINT_WAIT_NOTICE_DELAY_MS,
  formatPrintWaitNotice,
  shouldWriteWaitNoticeOnStderr,
  shouldFlushHeldBackResultOnAbort,
  finalizeHeldBackResultForShutdown,
} from './outputFormatting.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  hasActiveInProcessTeammates,
  isTeamLead,
  hasWorkingInProcessTeammates,
  waitForTeammatesToBecomeIdle,
} from '../../utils/teammate.js'
import { stopTask } from '../../tasks/stopTask.js'
import { sleep } from 'src/utils/sleep.js'
import {
  isShuttingDown,
  gracefulShutdownSync,
} from 'src/utils/gracefulShutdown.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { EMPTY_USAGE } from '@ant/model-provider'
import { randomUUID } from 'crypto'
import { errorMessage } from '../../utils/errors.js'
import { feature } from 'bun:bundle'
import { proactiveModule, SHUTDOWN_TEAM_PROMPT } from './featureLoaders.js'
import { resolveTeamTeardownParkTimeoutMsOrDefault } from 'src/utils/residualMsEnvGates.js'
import {
  readUnreadMessages,
  markMessagesAsRead,
  isShutdownApproved,
  consumePendingShutdownRequest,
} from '../../utils/teammateMailbox.js'
import {
  isShutdownFrameStale,
  removeTeammateFromTeamFile,
} from '../../utils/swarm/teamHelpers.js'
import { unassignTeammateTasks } from '../../utils/tasks.js'
import { TEAMMATE_MESSAGE_TAG } from 'src/constants/xml.js'
import { finalizePendingAsyncHooks } from 'src/utils/hooks/AsyncHookRegistry.js'
import { statusListeners } from 'src/services/claudeAiLimits.js'
import { stopAllHookHeartbeatsForSession } from '../../utils/hooks/hookHeartbeat.js'

export function createTurnRunner(
  streamCtx: HeadlessStreamingContext,
): () => Promise<void> {
  const run = async () => {
    if (streamCtx.running) {
      return
    }

    let resolveActiveRun!: () => void
    const currentRunPromise = new Promise<void>(resolve => {
      resolveActiveRun = resolve
    })
    streamCtx.activeRunPromise = currentRunPromise
    streamCtx.running = true
    streamCtx.runPhase = undefined
    notifySessionStateChanged('running')
    streamCtx.idleTimeout.stop()

    headlessProfilerCheckpoint('run_entry')
    // TODO(custom-tool-refactor): Should move to the init message, like browser

    // Official 2.1.323 #2054: collect MCP servers required by `--allowedTools`,
    // permission allow rules, or `mcp_tool` hooks so first-turn prewait keeps
    // at least the 2000ms floor even when CLAUDE_CODE_MCP_STARTUP_WAIT_MS is lower.
    const collectRequiredMcpServers = (): Set<string> => {
      const mcpToolHookServers: string[] = []
      try {
        const hooksCfg = getHooksConfigFromSnapshot()
        if (hooksCfg) {
          for (const matchers of Object.values(hooksCfg)) {
            if (!Array.isArray(matchers)) continue
            for (const matcher of matchers) {
              if (!matcher || !Array.isArray(matcher.hooks)) continue
              for (const hook of matcher.hooks) {
                if (
                  hook &&
                  typeof hook === 'object' &&
                  'type' in hook &&
                  hook.type === 'mcp_tool' &&
                  'server' in hook &&
                  typeof hook.server === 'string'
                ) {
                  mcpToolHookServers.push(hook.server)
                }
              }
            }
          }
        }
      } catch {
        // hooks snapshot optional
      }
      const allowRules = Object.values(
        streamCtx.getAppState().toolPermissionContext.alwaysAllowRules ?? {},
      )
        .flat()
        .filter((r): r is string => typeof r === 'string')
      return collectRequiredMcpPrewaitServers({
        allowedToolRules: [
          ...(streamCtx.options.allowedTools ?? []),
          ...allowRules,
        ],
        mcpToolHookServers,
      })
    }
    const configuredMcpStartupWaitMs = (() => {
      const raw = process.env.CLAUDE_CODE_MCP_STARTUP_WAIT_MS
      if (raw === undefined || raw.trim() === '') return undefined
      const parsed = Number(raw)
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
    })()

    if (streamCtx.options.sdkUrl) {
      const { getMcpConnectTimeoutMs } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/mcp/mcpConnectTimeout.js') as typeof import('../../services/mcp/mcpConnectTimeout.js')
      const requiredServers = collectRequiredMcpServers()
      const hasPendingRequiredSdk = streamCtx.sdkClients.some(
        c =>
          c.type === 'pending' &&
          (requiredServers.has(c.name) ||
            requiredServers.has(normalizeNameForMCP(c.name))),
      )
      const budgetMs =
        configuredMcpStartupWaitMs !== undefined
          ? resolveMcpStartupPrewaitBudgetMs({
              configuredWaitMs: configuredMcpStartupWaitMs,
              hasPendingRequiredServers: hasPendingRequiredSdk,
              pendingClients: streamCtx.sdkClients,
              requiredServerNames: requiredServers,
            })
          : getMcpConnectTimeoutMs()
      const sdkMcpUpdatePromise = streamCtx.updateSdkMcp('skip')
      streamCtx.mcpStartupAbortRef.current = createAbortController()
      const mcpAbortSignal = streamCtx.mcpStartupAbortRef.current.signal
      const mcpAbortPromise = new Promise<'aborted'>(resolve => {
        if (mcpAbortSignal.aborted) {
          resolve('aborted')
          return
        }
        mcpAbortSignal.addEventListener('abort', () => resolve('aborted'), {
          once: true,
        })
      })
      const raced = await Promise.race([
        raceWithTimeoutMs(sdkMcpUpdatePromise, budgetMs),
        mcpAbortPromise.then(() => ({ status: 'aborted' as const })),
      ])
      streamCtx.mcpStartupAbortRef.current = null
      if (raced.status === 'aborted') {
        sdkMcpUpdatePromise.catch(logError)
        logForDebugging(
          '[print.ts] sdk_mcp_update_wait aborted by stop/interrupt',
          { level: 'info' },
        )
        streamCtx.running = false
        if (streamCtx.activeRunPromise === currentRunPromise) {
          streamCtx.activeRunPromise = undefined
        }
        resolveActiveRun()
        notifySessionStateChanged('idle')
        return
      }
      if (raced.status === 'timeout') {
        sdkMcpUpdatePromise.catch(logError)
        logEvent('tengu_sdk_mcp_update_wait_timeout', {
          budget_ms: budgetMs,
        })
        logForDebugging(
          `[print.ts] sdk_mcp_update_wait_timeout after ${budgetMs}ms`,
          { level: 'warn' },
        )
      }
      if (
        !streamCtx.sdkMcpBackgroundRetry &&
        streamCtx.sdkClients.some(c => c.type === 'failed')
      ) {
        logForDebugging('[print.ts] sdk_mcp_retry_not_awaited', {
          level: 'info',
        })
        streamCtx.sdkMcpBackgroundRetry = streamCtx
          .updateSdkMcp('retry')
          .catch(logError)
          .finally(() => {
            streamCtx.sdkMcpBackgroundRetry = undefined
          })
      }
    } else {
      await streamCtx.updateSdkMcp()
    }
    headlessProfilerCheckpoint('after_updateSdkMcp')

    function sdkToolRelistJoin(joinOpts: {
      shouldQuery?: boolean
    }): Promise<void> | null {
      if (
        joinOpts.shouldQuery === false ||
        streamCtx.sdkMcpBackgroundRetry ||
        !streamCtx.sdkClients.some(c => c.type === 'pending')
      ) {
        return null
      }
      const { getMcpConnectTimeoutMs } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../services/mcp/mcpConnectTimeout.js') as typeof import('../../services/mcp/mcpConnectTimeout.js')
      const budgetMs = getMcpConnectTimeoutMs()
      const started = performance.now()
      const updatePromise = streamCtx.updateSdkMcp('skip')
      return raceWithTimeoutMs(updatePromise, budgetMs)
        .then(raced => {
          const timedOut = raced.status === 'timeout'
          if (timedOut) {
            updatePromise.catch(logError)
          }
          logForDebugging(
            `[print.ts] sdk_mcp_relist_wait budget_ms=${budgetMs} waited_ms=${Math.round(performance.now() - started)} timed_out=${timedOut}`,
            { level: timedOut ? 'warn' : 'info' },
          )
        })
        .catch(logError)
    }
    void sdkToolRelistJoin

    // Resolve deferred plugin installation (CLAUDE_CODE_SYNC_PLUGIN_INSTALL).
    // The promise was started eagerly so installation overlaps with other init.
    // Awaiting here guarantees plugins are available before the first ask().
    // If CLAUDE_CODE_SYNC_PLUGIN(S)_INSTALL_TIMEOUT_MS is set, races against that
    // deadline and proceeds without plugins on timeout (logging an error).
    if (streamCtx.pluginInstallPromise) {
      // Official Lmn: default 30s; env SYNC_PLUGIN(S)_INSTALL_TIMEOUT_MS override.
      const timeoutMs = resolveSyncPluginsInstallTimeoutMs()
      const raced = await raceWithTimeoutMs(
        streamCtx.pluginInstallPromise,
        timeoutMs,
      )
      if (raced.status === 'timeout') {
        logError(new Error(formatSyncPluginInstallTimeoutLog(timeoutMs)))
        logEvent('tengu_sync_plugin_install_timeout', {
          timeout_ms: timeoutMs,
        })
      }
      streamCtx.pluginInstallPromise = null

      // Refresh commands, agents, and hooks now that plugins are installed
      await streamCtx.refreshPluginState()

      // Set up hot-reload for plugin hooks now that the initial install is done.
      // In sync-install mode, setup.ts skips this to avoid racing with the install.
      const { setupPluginHookHotReload } = await import(
        '../../utils/plugins/loadPluginHooks.js'
      )
      setupPluginHookHotReload()
    }

    // densable AL: main-thread commands (agentId===mi()) — subagent
    // notifications are drained by the subagent's mid-turn gate in query.ts.
    // Defined outside the try block so it's accessible in the post-finally
    // queue re-checks at the bottom of run().
    const { isMainThreadQueuedCommand } = await import(
      '../../bootstrap/state.js'
    )
    const isMainThread = (cmd: QueuedCommand) => isMainThreadQueuedCommand(cmd)

    try {
      let command: QueuedCommand | undefined
      let waitingForAgents = false
      // Official print bg wait ceiling (dEf/pEf): track elapsed wait + wind-down.
      let printBgWaitStartedAt: number | null = null
      let printBgWaitFirstIdleAt: number | null = null
      let printBgWaitDeadline: number | null = null
      let printBgWaitSwept = false
      let printBgWaitCeilingWarned = false
      const announcedWaitWork = new Set<string>()
      let waitNoticeBroken = false
      // densable firstCommandMountJoin — one-shot await of hearth/grants
      // startup before the first ask(). takeFirstTurnJoins nulls its slots.
      let firstTurnJoinsPending = true
      // densable `Rl.pollEmptyDispatchStalled` analog — no class.
      let pollEmptyDispatchStalled = false
      let pollDispatchTarget: QueuedCommand | undefined
      let lastDispatchAborted = false
      // densable 2.1.289 Kc — print task-notification coalesce hold/owed state.
      const taskNotificationCoalesce =
        createPrintTaskNotificationCoalesceState()
      // densable 2.1.289 admits/doom — install live gates (armed by interrupt
      // subscribe + parkBatch/markAhead below; invent-ban Rl|Tl|Dm classes).
      streamCtx.printStartGate = createPrintStartGate()
      streamCtx.printPrewait = createPrintPrewaitLatch({
        isUserIntent: cmd => isPrintUserIntentCommand(cmd, isMainThread),
      })
      const startGate = streamCtx.printStartGate
      const prewait = streamCtx.printPrewait
      const drainState: TurnRunDrainState = {
        isMainThread,
        collectRequiredMcpServers,
        configuredMcpStartupWaitMs,
        command,
        firstTurnJoinsPending,
        pollEmptyDispatchStalled,
        pollDispatchTarget,
        lastDispatchAborted,
        taskNotificationCoalesce,
        startGate,
        prewait,
      }

      // Use a do-while loop to drain commands and then wait for any
      // background agents that are still running. When agents complete,
      // their notifications are enqueued and the loop re-drains.
      do {
        // Drain SDK events (task_started, task_progress) before command queue
        // so progress events precede task_notification on the stream.
        streamCtx.drainPrintSdkEvents()

        streamCtx.runPhase = 'draining_commands'
        await runDrainCommandQueue(streamCtx, drainState)

        // Check for running background tasks before exiting.
        // Exclude in_process_teammate — teammates are long-lived by design
        // (status: 'running' for their whole lifetime, cleaned up by the
        // shutdown protocol, not by transitioning to 'completed'). Waiting
        // on them here loops forever (gh-30008). Same exclusion already
        // exists at useBackgroundTaskNavigation.ts:55 for the same reason;
        // L1839 above is already narrower (type === 'local_agent') so it
        // doesn't hit this.
        waitingForAgents = false
        {
          const state = streamCtx.getAppState()
          // densable 2.1.217 #20 — $am + tcr: once --max-budget-usd reached,
          // halt running background agents (deny new spawns is in AgentTool L()).
          if (
            shouldHaltBackgroundAgentsForBudget(
              streamCtx.options.maxBudgetUsd,
              Object.values(state.tasks ?? {}),
            )
          ) {
            logForDebugging(
              formatPrintBudgetHaltDebug(
                streamCtx.options.maxBudgetUsd as number,
              ),
            )
            process.stderr.write(
              formatPrintBudgetHaltStderr(
                streamCtx.options.maxBudgetUsd as number,
              ),
            )
            await haltBackgroundAgentsForBudget(state.tasks ?? {}, {
              getAppState: streamCtx.getAppState,
              setAppState: streamCtx.setAppState,
            })
          }

          const runningBg = getRunningTasks(state).filter(
            t => isBackgroundTask(t) && t.type !== 'in_process_teammate',
          )
          const hasRunningBg = runningBg.length > 0
          const hasMainThreadQueued =
            peek(isPrintQueueableCommand) !== undefined
          const maxBudgetHalted = shouldHaltBackgroundAgentsForBudget(
            streamCtx.options.maxBudgetUsd,
            Object.values(state.tasks ?? {}),
          )
          const detachedOwes =
            detachedToolCallsOweResult(Date.now()) && !maxBudgetHalted
          const pendingWakeup = hasPendingSessionWakeup(getSessionCronTasks(), {
            now: Date.now(),
            parkedSince: printBgWaitStartedAt,
          })
          if (
            (hasRunningBg ||
              hasMainThreadQueued ||
              detachedOwes ||
              pendingWakeup) &&
            !streamCtx.shuttingDownForPrint &&
            !streamCtx.turnAbortedForShutdown
          ) {
            waitingForAgents = true
            if (!hasMainThreadQueued) {
              streamCtx.runPhase = 'waiting_for_agents'
              if (printBgWaitStartedAt === null) {
                printBgWaitStartedAt = Date.now()
              }
              const now = Date.now()
              if (
                !waitNoticeBroken &&
                now - printBgWaitStartedAt >= PRINT_WAIT_NOTICE_DELAY_MS
              ) {
                const waitIds = runningBg
                  .map(t => t.id)
                  .concat(pendingWakeup ? ['wakeup'] : [])
                if (!waitIds.every(id => announcedWaitWork.has(id))) {
                  for (const id of waitIds) announcedWaitWork.add(id)
                  const notice = formatPrintWaitNotice(
                    runningBg.map(t => {
                      const rec = t as {
                        type: string
                        kind?: string
                        description?: string
                      }
                      return {
                        type: rec.type,
                        kind: rec.kind,
                        description: rec.description,
                      }
                    }),
                    pendingWakeup,
                  )
                  const onStderr = shouldWriteWaitNoticeOnStderr({
                    outputFormat: streamCtx.options.outputFormat,
                    stderrIsTerminal: Boolean(process.stderr.isTTY),
                    stdoutIsTerminal: Boolean(process.stdout.isTTY),
                  })
                  if (onStderr) {
                    process.stderr.write(`\n${notice}\n`)
                  } else {
                    logForDebugging(notice)
                  }
                  logEvent('print_wait_notice', { on_stderr: onStderr })
                }
              }
              const ceiling = getPrintBgWaitCeilingMs()
              // Official 2.1.328 (#670): count a background subagent and any
              // subagents it waits for against ONE shared 10-minute wait budget
              // (`printBgWaitFirstIdleAt`), never resetting per intermediate turn.
              printBgWaitFirstIdleAt = advanceSharedPrintBgWaitFirstIdle({
                firstIdleAt: printBgWaitFirstIdleAt,
                hasRunningBgTasks: runningBg.length > 0,
                now,
              })
              const waitOriginAt =
                printBgWaitFirstIdleAt ?? printBgWaitStartedAt
              const ceilingExceeded =
                ceiling !== null && now - waitOriginAt >= ceiling

              // Official: stderr once when ceiling exceeded.
              if (
                ceilingExceeded &&
                !printBgWaitCeilingWarned &&
                ceiling !== null
              ) {
                printBgWaitCeilingWarned = true
                const bgSummary = runningBg
                  .slice(0, 3)
                  .map(t => t.description || t.id)
                  .join(', ')
                process.stderr.write(
                  formatPrintBgWaitCeilingMessage(ceiling, bgSummary),
                )
              }

              const holdForBackgroundShells =
                streamCtx.inputClosed &&
                !maxBudgetHalted &&
                getFeatureValue_CACHED_MAY_BE_STALE('tengu_tidy_sloth', true)
              const holdForArmedMonitors =
                streamCtx.inputClosed &&
                !maxBudgetHalted &&
                getFeatureValue_CACHED_MAY_BE_STALE(
                  'tengu_giggly_dragonfly',
                  true,
                )

              // Official pEf wind-down gate (input closed + grace / ceiling).
              const gate = nextPrintBgWaitGate({
                runningBackgroundTasks: runningBg.map(t => {
                  const rec = t as {
                    id: string
                    type: string
                    isBackgrounded?: boolean
                    kind?: string
                    agentId?: string
                    ambient?: boolean
                  }
                  return {
                    id: rec.id,
                    type: rec.type,
                    isBackgrounded: rec.isBackgrounded,
                    kind: rec.kind,
                    agentId: rec.agentId,
                    ambient: rec.ambient,
                  }
                }),
                inputClosed: streamCtx.inputClosed,
                hasMainThreadQueued: false,
                hasActiveTeammates: hasActiveInProcessTeammates(state),
                hasPendingNotification: detachedOwes,
                holdForBackgroundShells,
                holdForArmedMonitors,
                ceilingExceeded,
                deadline: printBgWaitDeadline,
                swept: printBgWaitSwept,
                now,
              })
              printBgWaitDeadline = gate.deadline
              printBgWaitSwept = gate.swept

              if (
                gate.shouldSweep ||
                (ceilingExceeded &&
                  (streamCtx.inputClosed || shouldStopAgentsOnPrintBgCeiling()))
              ) {
                // Official fEf — typed wind-down messages + print_wind_down telemetry
                for (const t of runningBg) {
                  try {
                    logForDebugging(
                      formatPrintWindDownMessage(
                        {
                          id: t.id,
                          type: t.type,
                          description: t.description,
                        },
                        PRINT_BG_WAIT_GRACE_MS,
                      ),
                    )
                    // densable sYr wind-down: jCe for non-observer + kill "system"
                    await stopTask(t.id, {
                      getAppState: streamCtx.getAppState,
                      setAppState: streamCtx.setAppState,
                      source: 'user',
                      killedBy: 'system',
                    })
                  } catch {
                    // best-effort print wind-down
                  }
                }
                if (runningBg.length > 0) {
                  logEvent('print_wind_down', {})
                }
                waitingForAgents = false
                printBgWaitStartedAt = null
                printBgWaitFirstIdleAt = null
                printBgWaitDeadline = null
                printBgWaitSwept = false
              } else if (ceilingExceeded) {
                // Ceiling hit while input still open: stop blocking exit.
                waitingForAgents = false
                printBgWaitStartedAt = null
                printBgWaitFirstIdleAt = null
              } else {
                await sleep(100)
              }
            }
            // Loop back to drain any newly queued commands
          } else {
            printBgWaitStartedAt = null
            // Official 2.1.328 (#670): only clear shared first-idle timer once
            // no background tasks remain running in the chain.
            if (getRunningTasks(streamCtx.getAppState()).length === 0) {
              printBgWaitFirstIdleAt = null
            }
            printBgWaitDeadline = null
            printBgWaitSwept = false
            printBgWaitCeilingWarned = false
          }
        }
      } while (waitingForAgents)

      if (streamCtx.heldBackResult) {
        // Official 2.1.328 `RP` / `WKi` (`chunk@323105654.js @313173`):
        // on a non-shutdown abort with a held-back result, stop lingering
        // background tasks before flushing the held result.
        if (
          shouldFlushHeldBackResultOnAbort({
            aborted: streamCtx.abortController?.signal.aborted === true,
            shuttingDown: streamCtx.shuttingDownForPrint || isShuttingDown(),
            abortedForShutdown: streamCtx.turnAbortedForShutdown,
            teardownRequested: streamCtx.inputClosed,
            heldResultCount: 1,
          })
        ) {
          for (const t of getRunningTasks(streamCtx.getAppState()).filter(
            task => isBackgroundTask(task),
          )) {
            try {
              await stopTask(t.id, {
                getAppState: streamCtx.getAppState,
                setAppState: streamCtx.setAppState,
                source: 'user',
                killedBy: 'system',
              })
            } catch {
              // best-effort background task stop on non-shutdown abort
            }
          }
        }
        streamCtx.output.enqueue(
          finalizeHeldBackResultForShutdown(
            streamCtx.heldBackResult as StdoutMessage & {
              queued_turn_count?: number
            },
            streamCtx.inputClosed ||
              streamCtx.shuttingDownForPrint ||
              streamCtx.turnAbortedForShutdown,
          ),
        )
        streamCtx.heldBackResult = null
        if (streamCtx.suggestionState.pendingSuggestion) {
          streamCtx.output.enqueue(streamCtx.suggestionState.pendingSuggestion)
          // Now that the suggestion is actually delivered, record it for acceptance tracking
          if (streamCtx.suggestionState.pendingLastEmittedEntry) {
            streamCtx.suggestionState.lastEmitted = {
              ...streamCtx.suggestionState.pendingLastEmittedEntry,
              emittedAt: Date.now(),
            }
            streamCtx.suggestionState.pendingLastEmittedEntry = null
          }
          streamCtx.suggestionState.pendingSuggestion = null
        }
      }
    } catch (error) {
      // Emit error result message before shutting down
      // Write directly to structuredIO to ensure immediate delivery
      try {
        await streamCtx.structuredIO.write({
          type: 'result',
          subtype: 'error_during_execution',
          duration_ms: 0,
          duration_api_ms: 0,
          is_error: true,
          num_turns: 0,
          stop_reason: null,
          session_id: getSessionId(),
          total_cost_usd: 0,
          usage: EMPTY_USAGE,
          modelUsage: {},
          permission_denials: [],
          uuid: randomUUID(),
          errors: [
            errorMessage(error),
            ...getInMemoryErrors().map(_ => _.error),
          ],
        })
      } catch {
        // If we can't emit the error result, continue with shutdown anyway
      }
      streamCtx.suggestionState.abortController?.abort()
      gracefulShutdownSync(1)
      return
    } finally {
      streamCtx.runPhase = 'finally_flush'
      // Flush pending internal events before going idle
      await streamCtx.structuredIO.flushInternalEvents()
      streamCtx.runPhase = 'finally_post_flush'
      if (!isShuttingDown()) {
        // Official cEf / CLAUDE_CODE_BG_TASKS_REPORT_RUNNING: keep session
        // non-idle while bg tasks or in-process teammates are still active.
        const finallyState = streamCtx.getAppState()
        const hasRunningBgTasks = getRunningTasks(finallyState).some(
          t => isBackgroundTask(t) && t.type !== 'in_process_teammate',
        )
        const hasActiveTeammates = hasActiveInProcessTeammates(finallyState)
        if (
          canReportSessionIdleWithBgActivity({
            hasActiveTeammates,
            hasRunningBgTasks,
            hasPendingNotification: false,
          })
        ) {
          notifySessionStateChanged('idle')
        }
        // Drain so the idle session_state_changed SDK event (plus any
        // terminal task_notification bookends emitted during bg-agent
        // teardown) reach the output stream before we block on the next
        // command. The do-while drain above only runs while
        // waitingForAgents; once we're here the next drain would be the
        // top of the next run(), which won't come if input is idle.
        streamCtx.drainPrintSdkEvents()
      }
      streamCtx.running = false
      if (streamCtx.activeRunPromise === currentRunPromise) {
        streamCtx.activeRunPromise = undefined
      }
      resolveActiveRun()
      // densable post-tick (REPL isLoading→false): clear aPt; YKu && !rmt() → XKu.
      // Headless previously stamped aPt on kind:loop fire but never settled —
      // model-forgot-ScheduleWakeup left the dynamic loop dead in long -p/SDK sessions.
      // When input is closed or process is shutting down, only clear aPt —
      // arming keepalive would never fire (isLoading stays true / process exits).
      try {
        const { settleLoopTickAfterIdle } =
          require('../../utils/loopDynamic.js') as typeof import('../../utils/loopDynamic.js')
        const mayArmKeepalive = !streamCtx.inputClosed && !isShuttingDown()
        settleLoopTickAfterIdle({ armKeepalive: mayArmKeepalive })
        if (mayArmKeepalive) {
          streamCtx.cronScheduler?.checkNow()
        }
      } catch {
        // loopDynamic may be unavailable in partial test mocks
      }
      // Start idle timer when we finish processing and are waiting for input
      streamCtx.idleTimeout.start()
    }

    // Proactive tick: if proactive is active and queue is empty, inject a tick
    if (
      (feature('PROACTIVE') || feature('KAIROS')) &&
      proactiveModule?.isProactiveActive() &&
      !proactiveModule.isProactivePaused()
    ) {
      if (
        peek(isPrintQueueableCommand) === undefined &&
        !streamCtx.inputClosed
      ) {
        streamCtx.scheduleProactiveTick!()
        return
      }
    }

    // Re-check the queue after releasing the mutex. A message may have
    // arrived (and called run()) between the last dequeue() returning
    // undefined and `running = false` above. In that case the caller
    // saw `running === true` and returned immediately, leaving the
    // message stranded in the queue with no one to process it.
    if (peek(isPrintQueueableCommand) !== undefined) {
      void run()
      return
    }

    // Check for unread teammate messages and process them
    // This mirrors what useInboxPoller does in interactive REPL mode
    // Poll until no more messages (teammates may still be working)
    {
      const currentAppState = streamCtx.getAppState()
      const teamContext = currentAppState.teamContext

      if (teamContext && isTeamLead(teamContext)) {
        const agentName = 'team-lead'

        // Poll for messages while teammates are active
        // This is needed because teammates may send messages while we're waiting
        // Keep polling until the team is shut down
        const POLL_INTERVAL_MS = 500
        // Official ZEf densable — park deadline before forced teardown
        const parkTimeoutMs = resolveTeamTeardownParkTimeoutMsOrDefault()
        const parkDeadline = Date.now() + parkTimeoutMs

        while (true) {
          // Check if teammates are still active
          const refreshedState = streamCtx.getAppState()
          const hasActiveTeammates =
            hasActiveInProcessTeammates(refreshedState) ||
            (refreshedState.teamContext &&
              Object.keys(refreshedState.teamContext.teammates).length > 0)

          if (!hasActiveTeammates) {
            logForDebugging(
              '[print.ts] No more active teammates, stopping poll',
            )
            break
          }

          // Official: give up after TEAM_TEARDOWN_PARK_TIMEOUT_MS
          if (Date.now() >= parkDeadline) {
            const rosterCount = Object.keys(
              refreshedState.teamContext?.teammates ?? {},
            ).length
            const runningInProcess = Object.values(
              refreshedState.tasks ?? {},
            ).filter(
              t => t.type === 'in_process_teammate' && t.status === 'running',
            ).length
            logForDebugging(
              `[print.ts] Team teardown park gave up after ${parkTimeoutMs}ms (shutdown prompt injected: ${streamCtx.shutdownPromptInjected}) with ${rosterCount} roster teammate(s) and ${runningInProcess} in-process teammate task(s) still active; tearing down anyway`,
            )
            logEvent('tengu_headless_team_teardown_park_timeout', {})
            break
          }

          const unread = await readUnreadMessages(
            agentName,
            refreshedState.teamContext?.teamName,
          )

          if (unread.length > 0) {
            logForDebugging(
              `[print.ts] Team-lead found ${unread.length} unread messages`,
            )

            // Mark as read immediately to avoid duplicate processing
            await markMessagesAsRead(
              agentName,
              refreshedState.teamContext?.teamName,
            )

            // Process shutdown_approved messages - remove teammates from team file
            // This mirrors what useInboxPoller does in interactive mode (lines 546-606)
            const teamName = refreshedState.teamContext?.teamName
            for (const m of unread) {
              const shutdownApproval = isShutdownApproved(m.text)
              if (
                shutdownApproval &&
                shutdownApproval.from === m.from &&
                teamName
              ) {
                const teammateToRemove = shutdownApproval.from
                // Find the teammate ID by name
                const teammateId = refreshedState.teamContext?.teammates
                  ? Object.entries(refreshedState.teamContext.teammates).find(
                      ([, t]) => t.name === teammateToRemove,
                    )?.[0]
                  : undefined

                if (teammateId) {
                  // Official 2.1.331 `M2t`: ignore stale shutdown_approved from before respawn
                  if (
                    await isShutdownFrameStale(
                      teamName,
                      teammateId,
                      m.timestamp,
                    )
                  ) {
                    continue
                  }
                  if (
                    !consumePendingShutdownRequest(
                      shutdownApproval.requestId,
                      shutdownApproval.from,
                    )
                  ) {
                    continue
                  }
                  logForDebugging(
                    `[print.ts] Processing shutdown_approved from ${teammateToRemove}`,
                  )

                  // Remove from team file
                  removeTeammateFromTeamFile(teamName, {
                    agentId: teammateId,
                    name: teammateToRemove,
                  })
                  logForDebugging(
                    `[print.ts] Removed ${teammateToRemove} from team file`,
                  )

                  // Unassign tasks owned by this teammate
                  await unassignTeammateTasks(
                    teamName,
                    teammateId,
                    teammateToRemove,
                    'shutdown',
                  )

                  // Remove from teamContext in AppState
                  streamCtx.setAppState(prev => {
                    if (!prev.teamContext?.teammates) return prev
                    if (!(teammateId in prev.teamContext.teammates)) return prev
                    const { [teammateId]: _, ...remainingTeammates } =
                      prev.teamContext.teammates
                    return {
                      ...prev,
                      teamContext: {
                        ...prev.teamContext,
                        teammates: remainingTeammates,
                      },
                    }
                  })
                }
              }
            }

            // Format messages same as useInboxPoller
            const formatted = unread
              .map(
                (m: { from: string; text: string; color?: string }) =>
                  `<${TEAMMATE_MESSAGE_TAG} teammate_id="${m.from}"${m.color ? ` color="${m.color}"` : ''}>\n${m.text}\n</${TEAMMATE_MESSAGE_TAG}>`,
              )
              .join('\n\n')

            // Enqueue and process
            enqueue({
              mode: 'prompt',
              value: formatted,
              uuid: randomUUID(),
            })
            void run()
            return // run() will come back here after processing
          }

          // No messages - check if we need to prompt for shutdown
          // If input is closed and teammates are active, inject shutdown prompt once
          if (streamCtx.inputClosed && !streamCtx.shutdownPromptInjected) {
            streamCtx.shutdownPromptInjected = true
            logForDebugging(
              '[print.ts] Input closed with active teammates, injecting shutdown prompt',
            )
            enqueue({
              mode: 'prompt',
              value: SHUTDOWN_TEAM_PROMPT,
              uuid: randomUUID(),
            })
            void run()
            return // run() will come back here after processing
          }

          // Wait and check again
          await sleep(POLL_INTERVAL_MS)
        }
      }
    }

    if (streamCtx.inputClosed) {
      // Check for active swarm that needs shutdown
      const hasActiveSwarm = await (async () => {
        // Wait for any working in-process team members to finish
        const currentAppState = streamCtx.getAppState()
        if (hasWorkingInProcessTeammates(currentAppState)) {
          await waitForTeammatesToBecomeIdle(
            streamCtx.setAppState,
            currentAppState,
          )
        }

        // Re-fetch state after potential wait
        const refreshedAppState = streamCtx.getAppState()
        const refreshedTeamContext = refreshedAppState.teamContext
        const hasTeamMembersNotCleanedUp =
          refreshedTeamContext &&
          Object.keys(refreshedTeamContext.teammates).length > 0

        return (
          hasTeamMembersNotCleanedUp ||
          hasActiveInProcessTeammates(refreshedAppState)
        )
      })()

      if (hasActiveSwarm) {
        // Team members are idle or pane-based - inject prompt to shut down team
        enqueue({
          mode: 'prompt',
          value: SHUTDOWN_TEAM_PROMPT,
          uuid: randomUUID(),
        })
        void run()
      } else {
        // Wait for any in-flight push suggestion before closing the output stream.
        if (streamCtx.suggestionState.inflightPromise) {
          await Promise.race([
            streamCtx.suggestionState.inflightPromise,
            sleep(5000),
          ])
        }
        streamCtx.suggestionState.abortController?.abort()
        streamCtx.suggestionState.abortController = null
        await finalizePendingAsyncHooks()
        streamCtx.unsubscribeSkillChanges()
        streamCtx.unsubscribeAuthStatus?.()
        statusListeners.delete(streamCtx.rateLimitListener)
        streamCtx.controlPlane.dispose()
        stopAllHookHeartbeatsForSession()
        streamCtx.unregisterHookHeartbeatSink?.()
        streamCtx.drainPrintSdkEvents()
        streamCtx.output.done()
      }
    }
  }
  return run
}
