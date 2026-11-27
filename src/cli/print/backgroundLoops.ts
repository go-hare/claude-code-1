/**
 * Headless streaming background wake loops: UDS peer inbox admission/holding and Kairos cron scheduler.
 */
import type { HeadlessStreamingContext } from './streamingTypes.js'
import { feature } from 'bun:bundle'
import { logForDebugging } from 'src/utils/debug.js'
import { enqueue } from 'src/utils/messageQueueManager.js'
import { randomUUID } from 'crypto'
import {
  setPermissionModeChangedListener,
  notifyPermissionModeChanged,
} from 'src/utils/sessionState.js'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { getSessionId, getSessionCronTasks } from 'src/bootstrap/state.js'
import { settingsChangeDetector } from 'src/utils/settings/changeDetector.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  cronGate,
  cronSchedulerModule,
  cronJitterConfigModule,
} from './featureLoaders.js'
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import {
  createAutonomyQueuedPromptIfNoActiveSource,
  markAutonomyRunFailed,
} from 'src/utils/autonomyRuns.js'
import { getCwd } from 'src/utils/cwd.js'
import { WORKLOAD_CRON } from 'src/utils/workloadContext.js'
import { cancelQueuedAutonomyCommands } from 'src/utils/autonomyQueueLifecycle.js'
import { logError } from 'src/utils/log.js'
import { isHeadlessCronLoading } from './startupAndAccount.js'
import { hasPendingSessionWakeup } from '../printBgWait.js'

export function setupUdsInboxLoop(streamCtx: HeadlessStreamingContext): void {
  // Set up UDS inbox callback so the query loop is kicked off
  // when a message arrives via the UDS socket in headless mode.
  // densable 2.1.224 #5: peer origin + PRn gate (Bqp/jqp) before hb().
  if (feature('UDS_INBOX')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { drainInbox, setOnEnqueue } =
      require('../../utils/udsMessaging.js') as typeof import('../../utils/udsMessaging.js')
    const {
      gatePeerInboundQueuedCommand,
      setPeerInboundModeGetter,
      setPeerInboundHoldListeners,
      releaseHeldPeerInboundMessages,
      shouldHonorPeerFromMode,
      resolveHeldPeerInboundMessage,
    } =
      require('../../utils/crossSessionInbound.js') as typeof import('../../utils/crossSessionInbound.js')
    type PermissionModeClass =
      import('../../utils/crossSessionInbound.js').PermissionModeClass
    type PeerInboundHoldCause =
      import('../../utils/crossSessionInbound.js').PeerInboundHoldCause
    const { resolvePeerInboundDialogTimeoutMs } =
      require('../../utils/peerInboundHoldUi.js') as typeof import('../../utils/peerInboundHoldUi.js')
    /* eslint-enable @typescript-eslint/no-require-imports */

    // densable aya / qqp — released held messages re-enter the prompt queue.
    // Register listeners BEFORE xRn so a mode-changed release can deliver.
    // densable 2.1.225 headless: onHeld dialogExpiry expire + onState hold-receipt.
    const headlessHoldTimers = new Map<object, ReturnType<typeof setTimeout>>()
    const clearHeadlessHoldTimer = (entry: object): void => {
      const t = headlessHoldTimers.get(entry)
      if (t !== undefined) {
        clearTimeout(t)
        headlessHoldTimers.delete(entry)
      }
    }
    setPeerInboundHoldListeners({
      onHeld: (entry, _size, cause: PeerInboundHoldCause) => {
        // densable bIn: only mode-mismatch / no-mode-asserted get dialogExpiry expire.
        if (cause !== 'mode-mismatch' && cause !== 'no-mode-asserted') return
        const ms = resolvePeerInboundDialogTimeoutMs()
        if (ms <= 0) return
        clearHeadlessHoldTimer(entry)
        const timer = setTimeout(() => {
          headlessHoldTimers.delete(entry)
          if (resolveHeldPeerInboundMessage(entry, 'expire') === 'dropped') {
            logForDebugging(
              '[cross-session-inbound] headless: held peer message expired (no approval surface) — dropped with an expired receipt',
            )
          }
        }, ms)
        timer.unref?.()
        headlessHoldTimers.set(entry, timer)
      },
      onState: (entry, status) => {
        if (
          status === 'delivered' ||
          status === 'denied' ||
          status === 'expired'
        ) {
          clearHeadlessHoldTimer(entry)
        }
        const cmd = entry.message as
          | { origin?: { from?: string }; from?: string }
          | undefined
        const from =
          (typeof cmd?.origin?.from === 'string' && cmd.origin.from) ||
          (typeof cmd?.from === 'string' && cmd.from) ||
          '(unknown)'
        logForDebugging(
          `[headless] cross-session hold-receipt: status=${status} from=${from}`,
        )
      },
      onReleased: entries => {
        for (const entry of entries) {
          clearHeadlessHoldTimer(entry)
          const cmd = entry.message as {
            mode?: 'prompt'
            value?: string | unknown
            uuid?: string
            origin?: unknown
          }
          if (
            cmd &&
            typeof cmd === 'object' &&
            typeof cmd.value === 'string' &&
            cmd.mode === 'prompt'
          ) {
            enqueue({
              mode: 'prompt',
              value: cmd.value,
              uuid:
                typeof cmd.uuid === 'string'
                  ? (cmd.uuid as never)
                  : randomUUID(),
              origin: (cmd.origin as never) ?? { kind: 'peer' },
              skipSlashCommands: true,
              isMeta: true,
            })
          }
        }
        if (entries.length > 0 && !streamCtx.inputClosed) {
          void streamCtx.run()
        }
      },
    })

    // densable xRn / dya — permission-mode getter for Bqp fail-closed path.
    setPeerInboundModeGetter(() => {
      const ctx = streamCtx.getAppState().toolPermissionContext
      return {
        mode: ctx.mode,
        isBypassPermissionsModeAvailable: ctx.isBypassPermissionsModeAvailable,
      }
    })

    // densable vPr("mode-changed") — replace the earlier status-only listener so
    // mode flips both emit SDK status and release held peer messages (zqp).
    setPermissionModeChangedListener(newMode => {
      if (
        newMode === 'default' ||
        newMode === 'acceptEdits' ||
        newMode === 'bypassPermissions' ||
        newMode === 'plan' ||
        newMode === (feature('TRANSCRIPT_CLASSIFIER') && 'auto') ||
        newMode === 'dontAsk'
      ) {
        streamCtx.output.enqueue({
          type: 'system',
          subtype: 'status',
          status: null,
          permissionMode: newMode as PermissionMode,
          uuid: randomUUID(),
          session_id: getSessionId(),
        })
      }
      if (
        releaseHeldPeerInboundMessages('mode-changed') > 0 &&
        !streamCtx.inputClosed
      ) {
        void streamCtx.run()
      }
    })

    // densable rSh: useEffect vPr("policy-accepts") on Ng().crossSessionInbound.
    // Headless has no React tree — re-evaluate hold buffer when settings change
    // (settingsChangeDetector already applies AppState via the earlier subscriber).
    let lastCrossSessionInbound =
      streamCtx.getAppState().settings?.crossSessionInbound
    settingsChangeDetector.subscribe(() => {
      const next = streamCtx.getAppState().settings?.crossSessionInbound
      if (next === lastCrossSessionInbound) return
      lastCrossSessionInbound = next
      if (
        releaseHeldPeerInboundMessages('policy-accepts') > 0 &&
        !streamCtx.inputClosed
      ) {
        void streamCtx.run()
      }
    })

    const enqueueUdsInboxMessages = (): boolean => {
      const entries = drainInbox()
      let accepted = 0
      for (const entry of entries) {
        // Only text/user-like payloads become prompts; skip control frames.
        if (
          entry.message.type !== 'text' &&
          entry.message.type !== 'notification'
        ) {
          continue
        }
        const value =
          typeof entry.message.data === 'string'
            ? entry.message.data
            : entry.message.data !== undefined
              ? jsonStringify(entry.message.data)
              : ''
        if (!value) continue

        const meta = entry.message.meta
        const rawFromMode = meta?.fromMode
        const fromMode: PermissionModeClass | undefined =
          rawFromMode === 'bypass' || rawFromMode === 'prompting'
            ? rawFromMode
            : undefined
        // densable UTf + zTf/jTf: selfSent only from kernel peer ancestry
        // (SO_PEERCRED / LOCAL_PEERPID). Never trust wire meta.selfSent; never
        // key on forgeable message.from (reply routing only). Without peer-cred
        // (Bun.ant.getPeerPid not available here) leave selfSent unset — fail-closed.
        const from =
          typeof entry.message.from === 'string'
            ? entry.message.from
            : 'unknown'
        const verifiedPeerPid =
          typeof entry.peerPid === 'number' && entry.peerPid > 0
            ? entry.peerPid
            : undefined
        // densable dOe — hop-chain from the envelope onto origin for yr/K2r.
        let hopChain: string[] | undefined
        try {
          const { parseCrossSessionHopChain } =
            require('../../utils/crossSessionMessage.js') as typeof import('../../utils/crossSessionMessage.js')
          hopChain = parseCrossSessionHopChain(value)
        } catch {
          hopChain = undefined
        }

        const command = {
          mode: 'prompt' as const,
          value,
          uuid: randomUUID(),
          origin: {
            kind: 'peer' as const,
            from,
            ...(fromMode !== undefined ? { fromMode } : {}),
            ...(verifiedPeerPid !== undefined ? { verifiedPeerPid } : {}),
            ...(hopChain !== undefined ? { hopChain } : {}),
            ...(typeof meta?.msg_id === 'string'
              ? { msg_id: meta.msg_id }
              : typeof entry.message.msg_id === 'string'
                ? { msg_id: entry.message.msg_id }
                : {}),
          },
          skipSlashCommands: true,
          skipAttachments: true,
          isMeta: true,
        }

        // densable PRn(c) — only hb when accept
        if (
          gatePeerInboundQueuedCommand(command, {
            honorFromMode: shouldHonorPeerFromMode(),
          }) !== 'accept'
        ) {
          continue
        }
        enqueue(command)
        accepted += 1
      }
      return accepted > 0
    }

    setOnEnqueue(() => {
      if (!streamCtx.inputClosed) {
        if (enqueueUdsInboxMessages()) {
          void streamCtx.run()
        }
      }
    })

    // densable 2.1.236 — deliver correlated [Cross-session idle notice] prompts.
    try {
      const { setIdleNoticeHandler, idleNoticeModelText } =
        require('../../utils/udsIdleNotify.js') as typeof import('../../utils/udsIdleNotify.js')
      setIdleNoticeHandler(notice => {
        const text = idleNoticeModelText(notice)
        if (!notice.modelVisible) {
          // densable hold (sdk-cli/headless): only logged, not delivered to model.
          logForDebugging(
            `[Cross-session idle notice] held — only logged, not delivered to model: ${text}`,
          )
          return
        }
        enqueue({
          mode: 'prompt',
          value: text,
          uuid: randomUUID(),
          priority: 'later',
          origin: { kind: 'peer', from: 'peer_idle_notice' },
          skipSlashCommands: true,
          skipAttachments: true,
          isMeta: true,
        })
        if (!streamCtx.inputClosed) void streamCtx.run()
      })
    } catch {
      // optional
    }

    if (enqueueUdsInboxMessages()) {
      void streamCtx.run()
    }
  }
}

export function setupKairosCronLoop(streamCtx: HeadlessStreamingContext): void {
  // Official $qy: after onPermissionModeChanged is wired, emit the
  // post-y_u mode when resume restored or declined plan.
  if (
    streamCtx.options.planModeOnResume === 'restored' ||
    streamCtx.options.planModeOnResume === 'declined'
  ) {
    notifyPermissionModeChanged(
      streamCtx.getAppState().toolPermissionContext.mode,
    )
  }

  // Cron scheduler: runs scheduled_tasks.json tasks in SDK/-p mode.
  // Mirrors REPL's useScheduledTasks hook. Fired prompts enqueue + kick
  // off run() directly — unlike REPL, there's no queue subscriber here
  // that drains on enqueue while idle. The run() mutex makes this safe
  // during an active turn: the call no-ops and the post-run recheck at
  // the end of run() picks up the queued command.
  // (cronScheduler binding declared near `running` so run() finally can see it.)
  if (cronGate.isKairosCronEnabled()) {
    // Shared dedup-claim → input-close-recheck → onSuccess pipeline for the
    // three cron entry points (legacy onFire, onFireTask agent, onFireTask
    // non-agent). Centralizing the cancel-on-late-shutdown contract here keeps
    // the three branches from drifting on what happens between claim and
    // dispatch. onSuccess receives the claimed QueuedCommand and decides
    // whether to enqueue it (normal path) or mark the run failed (agent path).
    const dispatchHeadlessCronCommand = (params: {
      basePrompt: string
      sourceId: string
      sourceLabel: string
      logSuffix: string
      onSuccess: (command: QueuedCommand) => void | Promise<void>
      /** densable kind:"loop" — stamp in-flight for keepalive after turn. */
      isLoop?: boolean
      /** densable wakeupSource: loop_wakeup | schedule_wakeup */
      wakeupSource?: 'loop_wakeup' | 'schedule_wakeup'
    }): void => {
      if (streamCtx.inputClosed) return
      void (async () => {
        // densable Xav.resolveLoopDefaultFire(Cn)
        const { resolveLoopDefaultFire } =
          require('../../utils/loopFire.js') as typeof import('../../utils/loopFire.js')
        const expanded = resolveLoopDefaultFire(params.basePrompt)
        const command = await createAutonomyQueuedPromptIfNoActiveSource({
          basePrompt: expanded,
          trigger: 'scheduled-task',
          currentDir: getCwd(),
          sourceId: params.sourceId,
          sourceLabel: params.sourceLabel,
          workload: WORKLOAD_CRON,
          shouldCreate: () => !streamCtx.inputClosed,
        })
        // densable aPt only after a real enqueue claim — skip storm-dedup / closed.
        if (!command) return
        if (streamCtx.inputClosed) {
          await cancelQueuedAutonomyCommands({ commands: [command] })
          return
        }
        if (params.isLoop) {
          const { setLoopTickInFlightPrompt } =
            require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')
          setLoopTickInFlightPrompt(params.basePrompt)
        }
        // densable 2.1.221 fire stamp 1:1:
        // skipSlashCommands:!0, modelScheduledOrigin:!0, wakeupSource
        // Keep prepared command.value (RZn + optional autonomy_authority).
        // basePrompt was already resolveLoopDefaultFire'd above — do not
        // overwrite value with bare expanded (strips #20 RZn on headless).
        await params.onSuccess({
          ...command,
          isMeta: true,
          priority: 'later',
          skipSlashCommands: true,
          modelScheduledOrigin: true,
          wakeupSource: params.wakeupSource ?? 'schedule_wakeup',
        })
      })().catch(error => {
        logError(error)
        logForDebugging(
          `[ScheduledTasks] failed to enqueue headless task${params.logSuffix}: ${error}`,
          { level: 'error' },
        )
      })
    }

    const enqueueAndRun = (command: QueuedCommand): void => {
      enqueue({
        ...command,
        uuid: randomUUID(),
      })
      void streamCtx.run()
    }

    streamCtx.cronScheduler = cronSchedulerModule.createCronScheduler({
      onFire: prompt => {
        // Legacy KAIROS-style entries: the prompt text is what uniquely
        // identifies the cron entry, so it doubles as both source id and
        // source label for dedup. densable: onFire → schedule_wakeup.
        dispatchHeadlessCronCommand({
          basePrompt: prompt,
          sourceId: prompt,
          sourceLabel: prompt,
          logSuffix: '',
          wakeupSource: 'schedule_wakeup',
          onSuccess: enqueueAndRun,
        })
      },
      onFireTask: task => {
        const { wakeupSourceForCronTask } =
          require('../../utils/loopFire.js') as typeof import('../../utils/loopFire.js')
        const wakeupSource = wakeupSourceForCronTask(task.kind)
        if (task.agentId) {
          dispatchHeadlessCronCommand({
            basePrompt: task.prompt,
            sourceId: task.id,
            sourceLabel: task.prompt,
            logSuffix: ` ${task.id}`,
            wakeupSource,
            onSuccess: async command => {
              await markAutonomyRunFailed(
                command.autonomy!.runId,
                `No teammate runtime available for scheduled task owner ${task.agentId} in headless mode.`,
                command.autonomy!.rootDir,
              )
            },
          })
          return
        }
        dispatchHeadlessCronCommand({
          basePrompt: task.prompt,
          sourceId: task.id,
          sourceLabel: task.prompt,
          logSuffix: ` ${task.id}`,
          isLoop: task.kind === 'loop',
          wakeupSource,
          onSuccess: enqueueAndRun,
        })
      },
      isLoading: () =>
        isHeadlessCronLoading({
          running: streamCtx.running,
          runPhase: streamCtx.runPhase,
          inputClosed: streamCtx.inputClosed,
          hasPendingWakeup: hasPendingSessionWakeup(getSessionCronTasks(), {
            now: Date.now(),
            parkedSince: null,
          }),
        }),
      getJitterConfig: cronJitterConfigModule?.getCronJitterConfig,
      isKilled: () => !cronGate?.isKairosCronEnabled(),
    })
    streamCtx.cronScheduler.start()
  }
}
