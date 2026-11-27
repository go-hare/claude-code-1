/**
 * Headless streaming command-queue draining, batch coalescing, rescue yield,
 * query ask() execution, and streaming output emission.
 */
import type {
  HeadlessStreamingContext,
  PromptSuggestionState,
  TurnRunDrainState,
} from './streamingTypes.js'
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import {
  peek,
  getCommandQueue,
  dequeue,
  consumeCancelPendingAcked,
  consumeCancelPending,
  countRemainingWakePollEventsAfter,
  enqueue,
  settleTaken,
} from 'src/utils/messageQueueManager.js'
import { logError } from 'src/utils/log.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  isPrintQueueableCommand,
  canBatchWith,
  mergeQueuedPromptCommands,
} from 'src/cli/printPromptBatch.js'
import { clearCommandScopedAllowRules } from 'src/utils/permissions/permissionSetup.js'
import {
  getMainThreadAgentId,
  getSessionId,
  getInitJsonSchema,
} from 'src/bootstrap/state.js'
import {
  type RescueYieldCommandHead,
  shouldRescueYieldToPersonPrompt,
  type RescueQueuedItemLike,
} from './startupAndAccount.js'
import { isPrintUserIntentCommand } from 'src/cli/printDrainGates.js'
import {
  shouldHoldQueryForTaskNotificationFollower,
  isPrintTaskNotificationCoalesceEnabled,
} from 'src/cli/printTaskNotificationCoalesce.js'
import {
  claimConsumableQueuedAutonomyCommands,
  finalizeAutonomyCommandsForTurn,
} from 'src/utils/autonomyQueueLifecycle.js'
import { getCwd } from 'src/utils/cwd.js'
import { notifyCommandLifecycle } from 'src/utils/commandLifecycle.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { reregisterChannelHandlerAfterReconnect } from 'src/cli/headless/HeadlessControlPlane.js'
import { emitTaskTerminatedSdk } from '../../utils/sdkEventQueue.js'
import { RemoteIO } from 'src/cli/remoteIO.js'
import { logEvent } from 'src/services/analytics/index.js'
import {
  logSuggestionOutcome,
  logSuggestionSuppressed,
  tryGenerateSuggestion,
} from 'src/services/PromptSuggestion/promptSuggestion.js'
import { createAbortController } from 'src/utils/abortController.js'
import { feature } from 'bun:bundle'
import { normalizeNameForMCP } from '../../services/mcp/normalization.js'
import { resolveMcpStartupPrewaitBudgetMs } from '../../services/mcp/mcpConnectTimeout.js'
import { sleep } from 'src/utils/sleep.js'
import {
  parseUserSpecifiedModel,
  getMainLoopModel,
} from 'src/utils/model/model.js'
import { resolveModelFacts } from 'src/utils/model/modelFacts.js'
import {
  headlessProfilerCheckpoint,
  logHeadlessProfilerTurn,
  headlessProfilerStartTurn,
} from 'src/utils/headlessProfiler.js'
import {
  startQueryProfile,
  logQueryProfileReport,
} from 'src/utils/queryProfiler.js'
import {
  setHookHeartbeatTurn,
  markHookHeartbeatTurnPastResult,
  stopAllHookHeartbeatsForSession,
} from '../../utils/hooks/hookHeartbeat.js'
import {
  runWithTurnAttribution,
  resolveCommandTurnAttributionKey,
} from 'src/utils/turnAttribution.js'
import { runWithWorkload } from 'src/utils/workloadContext.js'
import { ask } from 'src/QueryEngine.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { pollEventDeclaredFromCommands } from 'src/utils/processUserInput/artStamps.js'
import { mergeFileStateCaches } from 'src/utils/fileStateCache.js'
import {
  resolvePrintSystemPrompt,
  serializePrintWireMessage,
  hasAutoModeNoCheckDenial,
} from './outputFormatting.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { randomUUID } from 'crypto'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { getRunningTasks } from '../../utils/task/framework.js'
import { isBackgroundTask } from '../../tasks/types.js'
import { forwardParentToolUseSdkFrame } from 'src/bridge/subagentSdkFrames.js'
import { executeFilePersistence } from 'src/utils/filePersistence/filePersistence.js'
import { getLastCacheSafeParams } from 'src/utils/forkedAgent.js'
import { toError } from '../../utils/errors.js'

export async function runDrainCommandQueue(
  streamCtx: HeadlessStreamingContext,
  drainState: TurnRunDrainState,
): Promise<void> {
  await streamCtx.pendingSetModelPromise
  while (true) {
    // densable `odo`/`dequeueOrphansFirst`: continues===true && !holdsBack,
    // then orphans without handedOffTurn, then any !holdsBack orphan —
    // peek BEFORE dequeue so a prompt head is not spliced out.
    const {
      deferredToolUsePendingFromMessages,
      holdsBackHandoff,
      isWakePollEventHead,
      isReservedPollEventKind,
      POLL_EVENT_RESERVED_KIND_REFUSED,
      POLL_EVENT_DISCARDED_UNDELIVERED,
      pollEventDiscardedUndelivered,
      POLL_EMPTY_DISPATCH_STALLED,
      orphanedPermissionPrioritizeLog,
      settlePollEventsDiscardedUndelivered,
    } = await import('src/cli/printControlExtras.js')
    const pending = deferredToolUsePendingFromMessages(
      streamCtx.mutableMessages,
    )
    const isOrphan = (cmd: QueuedCommand): boolean =>
      drainState.isMainThread(cmd) && cmd.mode === 'orphaned-permission'
    const isLegalMode = (mode: QueuedCommand['mode']): boolean =>
      mode === 'prompt' ||
      mode === 'orphaned-permission' ||
      mode === 'task-notification' ||
      mode === 'poll-event'
    // densable `Rl.takeHead` 1:1: stall log, then YOo empty prompt
    // BEFORE odo. Synthetic is {value:[],mode:prompt,isMeta,pollEmptyDispatch,
    // skipSubmissionHooks} — do not dequeue the wake poll.
    if (
      drainState.pollDispatchTarget !== undefined &&
      peek(cmd => cmd === drainState.pollDispatchTarget) ===
        drainState.pollDispatchTarget &&
      !drainState.lastDispatchAborted
    ) {
      drainState.pollEmptyDispatchStalled = true
      logError(new Error(POLL_EMPTY_DISPATCH_STALLED))
    }
    drainState.pollDispatchTarget = undefined
    // densable Kc.take owed_call checks drain.abortController.signal.aborted
    // BEFORE synthesizing an empty prompt. Do not clear lastDispatchAborted
    // until after owed is decided — the previous ask() controller is still
    // this abortController and may already be aborted.
    // densable `Rl.takeHead` `if(this.holdsEvalSettles())return`
    // after stall clear. Print inject is gold `s??(()=>!1)` — never
    // bind `waitingForAgents` (do-while latch). True → no dequeue
    // (gold takeHead undefined); outer `while (waitingForAgents)`
    // may loop. Do not invent `export class Rl`.
    const holdsEvalSettles = (): boolean => false
    if (holdsEvalSettles()) {
      drainState.command = undefined
      break
    }
    const prioritizeOrphan = (): void => {
      const handedOffOrphan =
        peek(
          cmd =>
            isOrphan(cmd) &&
            cmd.handedOffTurn?.continues === true &&
            !holdsBackHandoff(cmd, pending),
        ) ??
        peek(cmd => isOrphan(cmd) && cmd.handedOffTurn === undefined) ??
        peek(cmd => isOrphan(cmd) && !holdsBackHandoff(cmd, pending))
      if (
        handedOffOrphan?.handedOffTurn !== undefined &&
        handedOffOrphan.handedOffTurn.continues !== true
      ) {
        const queued = getCommandQueue()
        const before = queued.slice(0, queued.indexOf(handedOffOrphan))
        const noQuery = before.find(
          cmd =>
            drainState.isMainThread(cmd) &&
            cmd.mode === 'prompt' &&
            cmd.shouldQuery === false,
        )
        if (noQuery) {
          drainState.command = dequeue(cmd => cmd === noQuery)
          return
        }
      }
      if (handedOffOrphan) {
        drainState.command = dequeue(cmd => cmd === handedOffOrphan)
        logForDebugging(
          orphanedPermissionPrioritizeLog(
            (() => {
              const result =
                handedOffOrphan.orphanedPermission?.permissionResult
              const fromPermission =
                result &&
                'toolUseID' in result &&
                typeof result.toolUseID === 'string'
                  ? result.toolUseID
                  : undefined
              return (
                fromPermission ??
                handedOffOrphan.handedOffTurn?.toolUseIDs.join(',') ??
                undefined
              )
            })(),
          ),
        )
      } else {
        drainState.command = dequeue(isPrintQueueableCommand)
      }
    }
    const head = peek(isPrintQueueableCommand)
    const deferredHuman = peek(
      cmd =>
        drainState.isMainThread(cmd) &&
        cmd.verifiedSlackHumanTurn === true &&
        cmd.priority !== 'now',
    )
    if (
      isWakePollEventHead(head, drainState.pollEmptyDispatchStalled) &&
      peek(isOrphan) === undefined &&
      deferredHuman === undefined
    ) {
      const other = peek(
        cmd =>
          drainState.isMainThread(cmd) &&
          cmd.mode !== 'poll-event' &&
          isLegalMode(cmd.mode),
      )
      if (other) {
        // densable Tl ahead-of-start steal — markAhead + snapshot queue.
        drainState.startGate.markAhead()
        drainState.startGate.captureFollowersFrom(getCommandQueue())
        drainState.command = dequeue(cmd => cmd === other)
      } else {
        drainState.pollDispatchTarget = head
        drainState.command = {
          value: [],
          mode: 'prompt',
          isMeta: true,
          pollEmptyDispatch: true,
          skipSubmissionHooks: true,
          agentId: head?.agentId,
        }
        // densable `m6r`/`O6o` — pollEmptyDispatch stamps delivery guard.
        streamCtx.setAppState(prev => ({
          ...prev,
          toolPermissionContext: {
            ...clearCommandScopedAllowRules(prev.toolPermissionContext),
            pollEventDeliveryGuard: true,
          } as typeof prev.toolPermissionContext,
        }))
      }
    } else {
      // Normal take — densable Tl.isHeadAhead false.
      drainState.startGate.clearAhead()
      prioritizeOrphan()
    }
    if (!drainState.command) {
      // densable Kc.take owed_call — held notifications with empty main
      // queue synthesize a meta empty prompt so the model still runs.
      const owed = drainState.taskNotificationCoalesce.maybeOwedPrompt({
        endSessionRequested: streamCtx.inputClosed,
        aborted:
          drainState.lastDispatchAborted ||
          streamCtx.abortController?.signal.aborted === true,
        peekMainDefined: peek(isPrintQueueableCommand) !== undefined,
        mainAgentId: getMainThreadAgentId(),
      })
      if (owed) {
        drainState.command = owed
      } else {
        drainState.prewait.dropParkedBatch()
        drainState.startGate.clearAhead()
        break
      }
    }
    drainState.lastDispatchAborted = false

    // Official 2.1.328 #1645/#1646 (`chunk@323105654.js @91050, @129655`):
    // if this dequeued command is an API-errored rescue re-run and a newer
    // person prompt is already waiting in the queue, yield to the person
    // prompt instead of re-sending the errored message ahead of it.
    const rescueHead = drainState.command as QueuedCommand &
      RescueYieldCommandHead
    if (
      rescueHead.yieldsToPersonPrompt !== undefined &&
      shouldRescueYieldToPersonPrompt({
        head: rescueHead,
        queued: getCommandQueue() as readonly RescueQueuedItemLike[],
        promptHeld: false,
        stopLatched:
          streamCtx.turnAbortedForShutdown || streamCtx.shuttingDownForPrint,
        decidedAt: 'before_start',
      })
    ) {
      if (drainState.command.uuid) {
        streamCtx.cutOffReRunStopTracker.markStarted(drainState.command.uuid)
        streamCtx.pendingReRunSends.clearAfterReRunEnded(
          drainState.command.uuid,
        )
      }
      continue
    }

    // densable Tl/Dm arming for this head (Kc.take):
    // - steal path already markAhead; normal path clearAhead above
    // - snapshot remaining queue for admits membership
    // parkBatch waits until take-cancel leaves a nonempty batch
    drainState.startGate.captureFollowersFrom(getCommandQueue())
    const intentHead = isPrintUserIntentCommand(
      drainState.command,
      drainState.isMainThread,
    )

    // densable Kc hold stamp — if a coalescable follower is waiting,
    // force shouldQuery:false + queryHeldForNextTurn on this head.
    // densable 2.1.289 admits/doom
    {
      const nextMain = peek(isPrintQueueableCommand)
      const holdsFollower = shouldHoldQueryForTaskNotificationFollower(
        drainState.command,
        nextMain,
        {
          deferredHuman: deferredHuman !== undefined,
          admits: next => drainState.startGate.admits(next),
          isDoomBoundary: (h, n) => drainState.prewait.isDoomBoundary(h, n),
        },
      )
      drainState.command = drainState.taskNotificationCoalesce.maybeStampHold(
        drainState.command,
        {
          endSessionRequested: streamCtx.inputClosed,
          coalesceEnabled: isPrintTaskNotificationCoalesceEnabled(),
          holdsFollower,
        },
      )
    }

    if (drainState.command.mode === 'poll-event') {
      if (isReservedPollEventKind(drainState.command.pollEvent?.kind)) {
        const reason = pollEventDiscardedUndelivered(
          POLL_EVENT_RESERVED_KIND_REFUSED,
        )
        logForDebugging(reason)
        const dropped = new Error(reason)
        dropped.name = POLL_EVENT_DISCARDED_UNDELIVERED
        drainState.command.pollEvent?.settleDropped?.(dropped)
        continue
      }
      if (drainState.pollEmptyDispatchStalled) {
        drainState.pollEmptyDispatchStalled = false
      }
    }

    // densable `aVn`: prompt | orphaned-permission | task-notification | poll-event
    if (
      drainState.command.mode !== 'prompt' &&
      drainState.command.mode !== 'orphaned-permission' &&
      drainState.command.mode !== 'task-notification' &&
      drainState.command.mode !== 'poll-event'
    ) {
      throw new Error('only prompt commands are supported in streaming mode')
    }

    // Non-prompt commands (task-notification, orphaned-permission, poll-event)
    // carry side effects or envelope state, so they process singly.
    // Prompt commands greedily collect followers with matching workload.
    let batch: QueuedCommand[] = [drainState.command]
    if (drainState.command.mode === 'prompt') {
      while (canBatchWith(drainState.command, peek(isPrintQueueableCommand))) {
        batch.push(dequeue(isPrintQueueableCommand)!)
      }
    }
    const queuedAutonomyClaim =
      await claimConsumableQueuedAutonomyCommands(batch)
    if (queuedAutonomyClaim.staleCommands.length > 0) {
      await finalizeAutonomyCommandsForTurn({
        commands: queuedAutonomyClaim.staleCommands,
        outcome: { type: 'cancelled' },
        currentDir: getCwd(),
        priority: 'later',
        workload: drainState.command.workload ?? streamCtx.options.workload,
      })
      for (const stale of queuedAutonomyClaim.staleCommands) {
        if (stale.uuid && !consumeCancelPendingAcked(stale.uuid)) {
          notifyCommandLifecycle(stale.uuid, 'cancelled')
        }
      }
    }
    batch = queuedAutonomyClaim.attachmentCommands
    if (batch.length === 0) {
      drainState.prewait.dropParkedBatch()
      drainState.startGate.clearAhead()
      continue
    }
    // densable Kc.take consumeCancelPending before $c merge.
    {
      const cancelled = batch.filter(
        member =>
          member.uuid !== undefined && consumeCancelPending(member.uuid),
      )
      if (cancelled.length > 0) {
        logForDebugging('cancelled by the host')
        for (const member of cancelled) {
          if (member.uuid) {
            notifyCommandLifecycle(member.uuid, 'cancelled')
          }
        }
        batch = batch.filter(member => !cancelled.includes(member))
        if (batch.length === 0) {
          // densable Kc.take empty cancel: prewaitLatch.reset(); continue.
          // No Acked (commit still Acked). No clearAhead.
          drainState.prewait.reset()
          continue
        }
      }
    }
    drainState.command = batch[0]!
    drainState.prewait.parkBatch(
      intentHead ||
        isPrintUserIntentCommand(drainState.command, drainState.isMainThread),
    )
    streamCtx.drainingHandoff = drainState.command.handedOffTurn
      ? drainState.command
      : undefined
    // densable recovery set analog: unanswered last-assistant tool_use
    // ids are the unrun calls a restarted worker would set aside.
    {
      const answered = new Set<string>()
      let lastAssistantUses: string[] = []
      for (const message of streamCtx.mutableMessages) {
        if (message.type === 'user') {
          const content = message.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block !== null &&
                typeof block === 'object' &&
                (block as { type?: unknown }).type === 'tool_result' &&
                typeof (block as { tool_use_id?: unknown }).tool_use_id ===
                  'string'
              ) {
                answered.add((block as { tool_use_id: string }).tool_use_id)
              }
            }
          }
        }
        if (message.type === 'assistant') {
          const content = message.message?.content
          lastAssistantUses = []
          if (Array.isArray(content)) {
            for (const block of content) {
              if (
                block !== null &&
                typeof block === 'object' &&
                (block as { type?: unknown }).type === 'tool_use' &&
                typeof (block as { id?: unknown }).id === 'string'
              ) {
                lastAssistantUses.push((block as { id: string }).id)
              }
            }
          }
        }
      }
      for (const id of lastAssistantUses) {
        if (!answered.has(id)) {
          streamCtx.recoveredToolUseIds.add(id)
        }
      }
    }
    if (drainState.command.mode === 'prompt' && batch.length > 1) {
      drainState.command = mergeQueuedPromptCommands(batch)
    }
    let batchUuids = batch.map(c => c.uuid).filter(u => u !== undefined)

    // QueryEngine will emit a replay for command.uuid (the last uuid in
    // the batch) via its messagesToAck path. Emit replays here for the
    // rest so consumers that track per-uuid delivery (clank's
    // asyncMessages footer, CCR) see an ack for every message they sent,
    // not just the one that survived the merge.
    if (streamCtx.options.replayUserMessages && batch.length > 1) {
      for (const c of batch) {
        if (c.uuid && c.uuid !== drainState.command.uuid) {
          streamCtx.output.enqueue({
            type: 'user',
            content: c.value,
            message: { role: 'user', content: c.value } as unknown,
            session_id: getSessionId(),
            parent_tool_use_id: null,
            uuid: c.uuid as string,
            isReplay: true,
          } as unknown as StdoutMessage)
        }
      }
    }

    // Combine all MCP clients. appState.mcp is populated incrementally
    // per-server by main.tsx (mirrors useManageMCPConnections). Reading
    // fresh per-command means late-connecting servers are visible on the
    // next turn. registerElicitationHandlers is idempotent (tracking set).
    const appState = streamCtx.getAppState()
    const allMcpClients = [
      ...appState.mcp.clients,
      ...streamCtx.sdkClients,
      ...streamCtx.dynamicMcpState.clients,
    ]
    streamCtx.seedHeadlessMcpIdentity()
    streamCtx.attachHeadlessRemoteReconnect(allMcpClients)
    streamCtx.registerElicitationHandlers(allMcpClients)
    // Channel handlers for servers allowlisted via --channels at
    // construction time (or enableChannel() mid-session). Runs every
    // turn like registerElicitationHandlers — idempotent per-client
    // (setNotificationHandler replaces, not stacks) and no-ops for
    // non-allowlisted servers (one feature-flag check).
    for (const client of allMcpClients) {
      reregisterChannelHandlerAfterReconnect(client)
    }

    const allTools = streamCtx.buildAllTools(appState)

    for (const uuid of batchUuids) {
      notifyCommandLifecycle(uuid, 'started')
    }

    // Task notifications arrive when background agents complete.
    // Emit an SDK system event for SDK consumers, then fall through
    // to ask() so the model sees the agent result and can act on it.
    // This matches TUI behavior where useQueueProcessor always feeds
    // notifications to the model regardless of coordinator mode.
    if (drainState.command.mode === 'task-notification') {
      const notificationText =
        typeof drainState.command.value === 'string'
          ? drainState.command.value
          : ''
      // Parse the XML-formatted notification
      const taskIdMatch = notificationText.match(/<task-id>([^<]+)<\/task-id>/)
      const toolUseIdMatch = notificationText.match(
        /<tool-use-id>([^<]+)<\/tool-use-id>/,
      )
      const outputFileMatch = notificationText.match(
        /<output-file>([^<]+)<\/output-file>/,
      )
      const statusMatch = notificationText.match(/<status>([^<]+)<\/status>/)
      const summaryMatch = notificationText.match(/<summary>([^<]+)<\/summary>/)

      const isValidStatus = (
        s: string | undefined,
      ): s is 'completed' | 'failed' | 'stopped' | 'killed' =>
        s === 'completed' || s === 'failed' || s === 'stopped' || s === 'killed'
      const rawStatus = statusMatch?.[1]
      const status = isValidStatus(rawStatus)
        ? rawStatus === 'killed'
          ? 'stopped'
          : rawStatus
        : 'completed'

      const usageMatch = notificationText.match(/<usage>([\s\S]*?)<\/usage>/)
      const usageContent = usageMatch?.[1] ?? ''
      const totalTokensMatch = usageContent.match(
        /<(?:subagent_tokens|total_tokens)>(\d+)<\/(?:subagent_tokens|total_tokens)>/,
      )
      const toolUsesMatch = usageContent.match(/<tool_uses>(\d+)<\/tool_uses>/)
      const durationMsMatch = usageContent.match(
        /<duration_ms>(\d+)<\/duration_ms>/,
      )

      // Only emit a task_notification SDK event when a <status> tag is
      // present — that means this is a terminal notification (completed/
      // failed/stopped). Stream events from enqueueStreamEvent carry no
      // <status> (they're progress pings); emitting them here would
      // default to 'completed' and falsely close the task for SDK
      // consumers.
      // densable lf + c7c: BRt/Ovu may already have bookended; once-gate
      // skips duplicate. Flush drain so Host sees the event on this tick
      // even when BRt dual-emitted earlier but drain had not run yet.
      if (statusMatch) {
        const taskId = taskIdMatch?.[1] ?? ''
        if (taskId) {
          emitTaskTerminatedSdk(taskId, status, {
            toolUseId: toolUseIdMatch?.[1],
            outputFile: outputFileMatch?.[1] ?? '',
            summary: summaryMatch?.[1] ?? '',
            usage:
              totalTokensMatch && toolUsesMatch
                ? {
                    total_tokens: parseInt(totalTokensMatch[1]!, 10),
                    tool_uses: parseInt(toolUsesMatch[1]!, 10),
                    duration_ms: durationMsMatch
                      ? parseInt(durationMsMatch[1]!, 10)
                      : 0,
                  }
                : undefined,
          })
        }
        streamCtx.drainPrintSdkEvents()
      }
      // No continue -- fall through to ask() so the model processes the result
    }

    // densable Kc.commit — second consumeCancelPending after take, before ask.
    {
      const cancelled = batch.filter(
        member =>
          member.uuid !== undefined && consumeCancelPending(member.uuid),
      )
      if (cancelled.length > 0) {
        logForDebugging('cancelled by the host')
        settlePollEventsDiscardedUndelivered(cancelled, 'cancelled by the host')
        for (const member of cancelled) {
          if (member.uuid && !consumeCancelPendingAcked(member.uuid)) {
            notifyCommandLifecycle(member.uuid, 'cancelled')
          }
        }
        batch = batch.filter(member => !cancelled.includes(member))
        if (batch.length === 0) {
          drainState.prewait.dropParkedBatch()
          continue
        }
        drainState.command =
          drainState.command.mode === 'prompt'
            ? mergeQueuedPromptCommands(batch)
            : batch[0]!
        batchUuids = batch.map(c => c.uuid).filter(u => u !== undefined)
      }
    }

    // densable `zXe` + `lXn` + `z3`: poll-event prompt is reminted envelopes
    let input: QueuedCommand['value']
    if (drainState.command.mode === 'poll-event') {
      const envelope = drainState.command.pollEvent?.envelope
      if (envelope === undefined) {
        const { POLL_EVENT_MISSING_PAYLOAD } = await import(
          'src/cli/printControlExtras.js'
        )
        logForDebugging(POLL_EVENT_MISSING_PAYLOAD)
        input = drainState.command.value
      } else {
        const { formatPollEventsPrompt, remintPollEventEnvelope } =
          await import('src/cli/printControlExtras.js')
        input = formatPollEventsPrompt(
          [remintPollEventEnvelope(envelope).envelope],
          countRemainingWakePollEventsAfter([drainState.command]),
          drainState.command.pollEvent?.kind !== undefined
            ? [drainState.command.pollEvent.kind]
            : undefined,
        )
      }
    } else {
      input = drainState.command.value
    }
    const claimedAutonomyCommands = queuedAutonomyClaim.claimedCommands

    if (
      streamCtx.structuredIO instanceof RemoteIO &&
      drainState.command.mode === 'prompt'
    ) {
      logEvent('tengu_bridge_message_received', {
        is_repl: false,
      })
    }

    // Abort any in-flight suggestion generation and track acceptance
    streamCtx.suggestionState.abortController?.abort()
    streamCtx.suggestionState.abortController = null
    streamCtx.suggestionState.pendingSuggestion = null
    streamCtx.suggestionState.pendingLastEmittedEntry = null
    if (streamCtx.suggestionState.lastEmitted) {
      if (drainState.command.mode === 'prompt') {
        // SDK user messages enqueue ContentBlockParam[], not a plain string
        const inputText =
          typeof input === 'string'
            ? input
            : (
                input.find(b => b.type === 'text') as
                  | { type: 'text'; text: string }
                  | undefined
              )?.text
        if (typeof inputText === 'string') {
          logSuggestionOutcome(
            streamCtx.suggestionState.lastEmitted.text,
            inputText,
            streamCtx.suggestionState.lastEmitted.emittedAt,
            streamCtx.suggestionState.lastEmitted.promptId,
            streamCtx.suggestionState.lastEmitted.generationRequestId,
          )
        }
        streamCtx.suggestionState.lastEmitted = null
      }
    }

    streamCtx.abortController = createAbortController()
    const turnStartTime = feature('FILE_PERSISTENCE') ? Date.now() : undefined

    // densable firstCommandMountJoin — await held hearth/grants once
    // before the first ask(); subsequent turns no-op (slots nulled).
    if (drainState.firstTurnJoinsPending) {
      drainState.firstTurnJoinsPending = false
      const joins = streamCtx.workSecretSession?.takeFirstTurnJoins()
      const heldHearth = streamCtx.hearthMountStartup
      streamCtx.hearthMountStartup = null
      // Official 2.1.323 #2054: wait for pending required MCP servers up
      // to resolveMcpStartupPrewaitBudgetMs (enforces 2000ms floor).
      const requiredServers = drainState.collectRequiredMcpServers()
      const hasPendingRequiredMcp = () =>
        requiredServers.size > 0 &&
        [...streamCtx.getAppState().mcp.clients, ...streamCtx.sdkClients].some(
          c =>
            c.type === 'pending' &&
            (requiredServers.has(c.name) ||
              requiredServers.has(normalizeNameForMCP(c.name))),
        )
      const waitForRequiredMcp = async () => {
        if (!hasPendingRequiredMcp()) return
        const waitStarted = Date.now()
        while (
          hasPendingRequiredMcp() &&
          !streamCtx.abortController?.signal.aborted
        ) {
          const remainingMs = resolveMcpStartupPrewaitBudgetMs({
            configuredWaitMs: drainState.configuredMcpStartupWaitMs,
            hasPendingRequiredServers: true,
            elapsedMs: Date.now() - waitStarted,
          })
          if (remainingMs <= 0) break
          await sleep(Math.min(25, remainingMs))
        }
      }
      // Official 2.1.327 #402: wait for model settings bootstrap before
      // the first request (defaults to 10s in non-interactive mode).
      const firstTurnModel = streamCtx.activeUserSpecifiedModel
        ? parseUserSpecifiedModel(streamCtx.activeUserSpecifiedModel)
        : getMainLoopModel()
      await Promise.all([
        heldHearth ?? Promise.resolve(),
        joins?.replyMount ?? Promise.resolve(),
        joins?.grants ?? Promise.resolve(),
        waitForRequiredMcp(),
        resolveModelFacts(firstTurnModel, {
          abortController: streamCtx.abortController,
        }),
      ])
    }

    headlessProfilerCheckpoint('before_ask')
    startQueryProfile()
    // Per-iteration ALS context so bg agents spawned inside ask()
    // inherit workload across their detached awaits. In-process cron
    // stamps cmd.workload; the SDK --workload flag is options.workload.
    // const-capture: TS loses `while ((command = dequeue()))` narrowing
    // inside the closure.
    const cmd = drainState.command
    // Official 2.1.323 #1970: advance hook heartbeat turn ID on turn start.
    const currentHeartbeatTurn = ++streamCtx.hookHeartbeatTurnId
    setHookHeartbeatTurn(currentHeartbeatTurn)
    let lastResultIsError = false
    let lastResultNumTurns = 0
    let lastResultBody = ''
    streamCtx.rapidFollowupPreempt.noteTurnStart({
      command: cmd,
      members: batch,
    })
    try {
      await runWithTurnAttribution(
        resolveCommandTurnAttributionKey(cmd),
        () =>
          runWithWorkload(
            cmd.workload ?? streamCtx.options.workload,
            async () => {
              for await (const message of ask({
                commands: uniqBy(
                  [...streamCtx.currentCommands, ...appState.mcp.commands],
                  'name',
                ),
                prompt: input,
                promptUuid: cmd.uuid,
                isMeta: cmd.isMeta,
                // densable 2.1.221: cron fire stamps (skipSlash + modelScheduled + wakeup)
                skipSlashCommands: cmd.skipSlashCommands,
                skipAttachments:
                  cmd.skipAttachments === true ||
                  cmd.mode === 'poll-event' ||
                  cmd.mode === 'task-notification' ||
                  undefined,
                pollEventDelivery: cmd.mode === 'poll-event' || undefined,
                pollEventProvenance:
                  cmd.mode === 'poll-event'
                    ? [cmd.pollEvent?.provenance ?? null]
                    : undefined,
                pollEventDeclared: pollEventDeclaredFromCommands([cmd]),
                skipSkillPermissionReset:
                  cmd.mode === 'poll-event' ||
                  cmd.pollEmptyDispatch === true ||
                  undefined,
                pollEmptyDispatch: cmd.pollEmptyDispatch === true || undefined,
                stopHookActive: cmd.stopHookActive,
                skipSubmissionHooks:
                  cmd.skipSubmissionHooks === true || cmd.mode === 'poll-event',
                fileAttachments: cmd.fileAttachments,
                inlinedImagePaths: cmd.inlinedImagePaths,
                stampThreadState: cmd.stampThreadState,
                frameTiming: cmd.frameTiming,
                bridgeOrigin: cmd.bridgeOrigin,
                localStdinOrigin: cmd.localStdinOrigin,
                sessionChannelPersonTyped: cmd.sessionChannelPersonTyped,
                hostInitiator: cmd.hostInitiator,
                modelScheduledOrigin: cmd.modelScheduledOrigin,
                wakeupSource: cmd.wakeupSource,
                artifactCommentTurn: cmd.artifactCommentTurn,
                origin: cmd.origin,
                isHumanTypedPrompt: (cmd as { isHumanTypedPrompt?: boolean })
                  .isHumanTypedPrompt,
                suppressWorkflowKeyword: cmd.suppressWorkflowKeyword,
                clientPlatform: cmd.clientPlatform,
                verifiedSlackHumanTurn: cmd.verifiedSlackHumanTurn,
                projectsUserTurn: cmd.projectsUserTurn,
                hearthRelayRows: cmd.hearthRelayRows,
                hearthRelayThreadTs: cmd.hearthRelayThreadTs,
                hearthRelayMessageIds: cmd.hearthRelayMessageIds,
                taskDelivery: cmd.taskDelivery,
                shouldQuery: cmd.shouldQuery,
                queryHeldForNextTurn: cmd.queryHeldForNextTurn,
                cwd: getCwd(),
                tools: allTools,
                verbose: streamCtx.options.verbose,
                mcpClients: allMcpClients,
                thinkingConfig: streamCtx.options.thinkingConfig,
                maxTurns: streamCtx.options.maxTurns,
                maxBudgetUsd: streamCtx.options.maxBudgetUsd,
                taskBudget: streamCtx.options.taskBudget,
                canUseTool: streamCtx.canUseTool,
                userSpecifiedModel: streamCtx.activeUserSpecifiedModel,
                fallbackModel: streamCtx.options.fallbackModel,
                jsonSchema: getInitJsonSchema() ?? streamCtx.options.jsonSchema,
                mutableMessages: streamCtx.mutableMessages,
                getReadFileCache: () =>
                  streamCtx.pendingSeeds.size === 0
                    ? streamCtx.readFileState
                    : mergeFileStateCaches(
                        streamCtx.readFileState,
                        streamCtx.pendingSeeds,
                      ),
                toolState: streamCtx.sessionToolState,
                taskRegistry: streamCtx.sessionTaskRegistry,
                setReadFileCache: cache => {
                  streamCtx.readFileState = cache
                  for (const [path, seed] of streamCtx.pendingSeeds.entries()) {
                    const existing = streamCtx.readFileState.get(path)
                    if (!existing || seed.timestamp > existing.timestamp) {
                      streamCtx.readFileState.set(path, seed)
                    }
                  }
                  streamCtx.pendingSeeds.clear()
                },
                customSystemPrompt: resolvePrintSystemPrompt(
                  streamCtx.options.systemPrompt,
                ),
                appendSystemPrompt: streamCtx.options.appendSystemPrompt,
                appendSubagentSystemPrompt:
                  streamCtx.options.appendSubagentSystemPrompt,
                getAppState: streamCtx.getAppState,
                setAppState: streamCtx.setAppState,
                abortController: streamCtx.abortController,
                replayUserMessages: streamCtx.options.replayUserMessages,
                includePartialMessages:
                  streamCtx.options.includePartialMessages,
                replayAcksAtRequestDispatch:
                  streamCtx.structuredIO instanceof RemoteIO
                    ? () =>
                        getFeatureValue_CACHED_MAY_BE_STALE(
                          'tengu_ccr_replay_acks_at_request_dispatch',
                          false,
                        )
                    : undefined,
                refreshTools: () =>
                  streamCtx.buildAllTools(streamCtx.getAppState()),
                refreshMcpClients: () => [
                  ...streamCtx.getAppState().mcp.clients,
                  ...streamCtx.sdkClients,
                  ...streamCtx.dynamicMcpState.clients,
                ],
                forwardSubagentText: streamCtx.options.forwardSubagentText,
                handleElicitation: (serverName, params, elicitSignal) =>
                  streamCtx.structuredIO.handleElicitation(
                    serverName,
                    params.message,
                    undefined,
                    elicitSignal,
                    params.mode,
                    params.url,
                    'elicitationId' in params
                      ? params.elicitationId
                      : undefined,
                  ),
                // Official requestDialog:OSr()?cvf(e) — arm when print host built.
                requestDialog: streamCtx.printRequestDialog,
                agents: streamCtx.currentAgents,
                orphanedPermission: cmd.orphanedPermission,
                deferredToolUse: streamCtx.takePendingDeferredToolUse(),
                keptDeferredToolNotice:
                  'A deferred tool call could not run because its MCP server is unavailable; the call was kept in the conversation.',
                dropsUnavailableDeferredTool: false,
                isPersistedTransport: Boolean(streamCtx.options.sdkUrl),
                setSDKStatus: status => {
                  streamCtx.output.enqueue({
                    type: 'system',
                    subtype: 'status',
                    status: status as 'compacting' | null,
                    session_id: getSessionId(),
                    uuid: randomUUID(),
                  })
                },
              })) {
                // Forward messages to bridge incrementally (mid-turn) so
                // claude.ai sees progress and the connection stays alive
                // while blocked on permission requests.
                streamCtx.forwardMessagesToBridge()
                streamCtx.rapidFollowupPreempt.noteFrame(
                  message as unknown as Record<string, unknown>,
                )
                // Official 2.1.326 #239: stream partial text/thinking deltas
                // to Remote Control viewers as they are written.
                if (
                  streamCtx.bridgeHandle &&
                  message.type === 'stream_event' &&
                  (message as { parent_tool_use_id?: string | null })
                    .parent_tool_use_id === null
                ) {
                  const ev = (message as { event?: { type?: string } }).event
                  if (ev?.type !== 'ping') {
                    streamCtx.bridgeHandle.writeSdkMessages?.([
                      message as unknown as SDKMessage,
                    ])
                  }
                }

                if (message.type === 'result') {
                  // Official 2.1.323 #1970: suppress hook heartbeats past result.
                  markHookHeartbeatTurnPastResult(currentHeartbeatTurn)
                  const wireResult = serializePrintWireMessage(
                    message as unknown as Record<string, unknown>,
                    streamCtx.wireRetractedTracker,
                  )
                  const resultMsg = wireResult
                  if (
                    resultMsg.stop_reason === 'tool_deferred_unavailable' ||
                    resultMsg.terminal_reason === 'tool_deferred_unavailable'
                  ) {
                    streamCtx.deferredCallRefusesTurns = true
                  }
                  if (cmd.uuid) {
                    streamCtx.cutOffReRunStopTracker.markStarted(cmd.uuid)
                    streamCtx.pendingReRunSends.clearAfterReRunEnded(cmd.uuid)
                  }
                  lastResultIsError =
                    !!resultMsg.is_error || hasAutoModeNoCheckDenial(resultMsg)
                  lastResultNumTurns =
                    typeof resultMsg.num_turns === 'number'
                      ? resultMsg.num_turns
                      : 0
                  lastResultBody =
                    typeof resultMsg.result === 'string' ? resultMsg.result : ''
                  // Flush pending SDK events so they appear before result on the stream.
                  streamCtx.drainPrintSdkEvents(true)

                  // Hold-back: don't emit result while background agents are running
                  const currentState = streamCtx.getAppState()
                  if (
                    getRunningTasks(currentState).some(
                      t =>
                        (t.type === 'local_agent' ||
                          t.type === 'local_workflow') &&
                        isBackgroundTask(t),
                    )
                  ) {
                    streamCtx.heldBackResult =
                      wireResult as unknown as StdoutMessage
                  } else {
                    streamCtx.heldBackResult = null
                    streamCtx.output.enqueue(
                      wireResult as unknown as StdoutMessage,
                    )
                  }
                } else {
                  // Flush SDK events (task_started, task_progress) so background
                  // agent progress is streamed in real-time, not batched until result.
                  // task_progress stays a status payload. Tool frames with
                  // parent_tool_use_id are additionally written to Remote
                  // Control (densable Ce / idt).
                  streamCtx.drainPrintSdkEvents(true)
                  forwardParentToolUseSdkFrame(
                    streamCtx.bridgeHandle,
                    message as {
                      type?: string
                      parent_tool_use_id?: string | null
                      message?: { content?: unknown }
                    },
                  )
                  streamCtx.output.enqueue(
                    serializePrintWireMessage(
                      message as unknown as Record<string, unknown>,
                      streamCtx.wireRetractedTracker,
                    ) as unknown as StdoutMessage,
                  )
                }
              }
            },
          ), // end runWithWorkload
      ) // end runWithTurnAttribution
      if (lastResultIsError) {
        await finalizeAutonomyCommandsForTurn({
          commands: claimedAutonomyCommands,
          outcome: {
            type: 'failed',
            message: 'ask() returned an error result',
          },
          currentDir: getCwd(),
          priority: 'later',
          workload: cmd.workload ?? streamCtx.options.workload,
        })
      } else {
        const nextCommands = await finalizeAutonomyCommandsForTurn({
          commands: claimedAutonomyCommands,
          outcome: { type: 'completed' },
          currentDir: getCwd(),
          priority: 'later',
          workload: cmd.workload ?? streamCtx.options.workload,
        })
        for (const nextCommand of nextCommands) {
          enqueue({
            ...nextCommand,
            uuid: randomUUID(),
          })
        }
      }
      // densable Kc.noteTurnEnded — A=drain.abortController.signal.aborted
      // at the result frame (not lastDispatchAborted, which is still
      // false after a cooperative aborted_tools return).
      const abortedAtResult =
        drainState.lastDispatchAborted ||
        streamCtx.abortController?.signal.aborted === true
      drainState.taskNotificationCoalesce.noteTurnEnded({
        aborted: abortedAtResult,
        command: cmd,
        numTurns: lastResultNumTurns,
        result: lastResultBody,
      })
      drainState.lastDispatchAborted = abortedAtResult
      // densable Dm.dropParkedBatch + Tl.clearAhead after turn settles.
      stopAllHookHeartbeatsForSession()
      streamCtx.rapidFollowupPreempt.noteTurnEnd()
      settleTaken({ turnEnded: true })
      drainState.prewait.dropParkedBatch()
      drainState.startGate.clearAhead()
    } catch (error) {
      stopAllHookHeartbeatsForSession()
      streamCtx.rapidFollowupPreempt.noteTurnEnd()
      settleTaken({ turnEnded: true })
      await finalizeAutonomyCommandsForTurn({
        commands: claimedAutonomyCommands,
        outcome: { type: 'failed', error },
        currentDir: getCwd(),
        priority: 'later',
        workload: cmd.workload ?? streamCtx.options.workload,
      })
      drainState.lastDispatchAborted = true
      streamCtx.drainingHandoff = undefined
      drainState.taskNotificationCoalesce.noteTurnEnded({
        aborted: true,
        command: cmd,
        numTurns: 0,
        result: '',
      })
      drainState.prewait.dropParkedBatch()
      drainState.startGate.clearAhead()
      throw error
    }

    for (const uuid of batchUuids) {
      notifyCommandLifecycle(uuid, 'completed')
    }

    // Forward messages to bridge after each turn
    streamCtx.forwardMessagesToBridge()
    streamCtx.costMetadataPusher.pushIfChanged()
    streamCtx.pluginCeilingTurns += lastResultNumTurns
    streamCtx.bridgeHandle?.sendResult()

    if (feature('FILE_PERSISTENCE') && turnStartTime !== undefined) {
      void executeFilePersistence(
        {
          turnStartTime,
        } as import('src/utils/filePersistence/types.js').TurnStartTime,
        streamCtx.abortController.signal,
        result => {
          const filesResult = result as unknown as {
            persistedFiles: { filename: string; file_id: string }[]
            failedFiles: { filename: string; error: string }[]
          }
          streamCtx.output.enqueue({
            type: 'system' as const,
            subtype: 'files_persisted' as const,
            files: filesResult.persistedFiles,
            failed: filesResult.failedFiles,
            processed_at: new Date().toISOString(),
            uuid: randomUUID(),
            session_id: getSessionId(),
          })
        },
      )
    }

    // Generate and emit prompt suggestion for SDK consumers.
    // #175 SEA `AMt` (@298675596): honor CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
    // and cloud/setting gates.
    const { shouldAllowPromptSuggestionInSdk } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../services/PromptSuggestion/promptSuggestion.js') as typeof import('../../services/PromptSuggestion/promptSuggestion.js')
    if (
      streamCtx.options.promptSuggestions &&
      shouldAllowPromptSuggestionInSdk()
    ) {
      // TS narrows suggestionState to never in the while loop body;
      // cast via unknown to reset narrowing.
      const state =
        streamCtx.suggestionState as unknown as PromptSuggestionState
      state.abortController?.abort()
      const localAbort = new AbortController()
      streamCtx.suggestionState.abortController = localAbort

      const cacheSafeParams = getLastCacheSafeParams()
      if (!cacheSafeParams) {
        logSuggestionSuppressed('sdk_no_params', undefined, undefined, 'sdk')
      } else {
        // Use a ref object so the IIFE's finally can compare against its own
        // promise without a self-reference (which upsets TypeScript's flow analysis).
        const ref: { promise: Promise<void> | null } = { promise: null }
        ref.promise = (async () => {
          try {
            const result = await tryGenerateSuggestion(
              localAbort,
              streamCtx.mutableMessages,
              streamCtx.getAppState,
              cacheSafeParams,
              'sdk',
            )
            if (!result || localAbort.signal.aborted) return
            const suggestionMsg = {
              type: 'prompt_suggestion' as const,
              suggestion: result.suggestion,
              uuid: randomUUID(),
              session_id: getSessionId(),
            }
            const lastEmittedEntry = {
              text: result.suggestion,
              emittedAt: Date.now(),
              promptId: result.promptId,
              generationRequestId: result.generationRequestId,
            }
            // Defer emission if the result is being held for background agents,
            // so that prompt_suggestion always arrives after result.
            // Only set lastEmitted when the suggestion is actually delivered
            // to the consumer; deferred suggestions may be discarded before
            // delivery if a new command arrives first.
            if (streamCtx.heldBackResult) {
              streamCtx.suggestionState.pendingSuggestion = suggestionMsg
              streamCtx.suggestionState.pendingLastEmittedEntry = {
                text: lastEmittedEntry.text,
                promptId: lastEmittedEntry.promptId,
                generationRequestId: lastEmittedEntry.generationRequestId,
              }
            } else {
              streamCtx.suggestionState.lastEmitted = lastEmittedEntry
              streamCtx.output.enqueue(suggestionMsg)
            }
          } catch (error) {
            if (
              error instanceof Error &&
              (error.name === 'AbortError' ||
                error.name === 'APIUserAbortError')
            ) {
              logSuggestionSuppressed('aborted', undefined, undefined, 'sdk')
              return
            }
            logError(toError(error))
          } finally {
            if (streamCtx.suggestionState.inflightPromise === ref.promise) {
              streamCtx.suggestionState.inflightPromise = null
            }
          }
        })()
        streamCtx.suggestionState.inflightPromise = ref.promise
      }
    }

    // Log headless profiler metrics for this turn and start next turn
    logHeadlessProfilerTurn()
    logQueryProfileReport()
    headlessProfilerStartTurn()
    streamCtx.drainingHandoff = undefined
  }
}
