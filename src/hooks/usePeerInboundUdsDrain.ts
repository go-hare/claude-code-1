/**
 * densable 2.1.224 #5 — interactive REPL peer UDS drain + PRn gate + rSh hold UI.
 *
 * SEA rSh(e,t,r,n):
 *   sya → warning toast on hold
 *   n(gGn, …, {signal, queueBehind:!0}) for mode-mismatch | no-mode-asserted
 *   IRn → release toast (qqp delivers inside Kei/zqp; we deliver in onReleased)
 *   xRn mode getter; vPr policy/mode
 *
 * Dialog host: createPeerInboundApprovalQueue (densable Oy/Ns queueBehind).
 * Renders via returned ReactNode into REPL FullscreenLayout `modal` slot —
 * NOT promptOverlay (Provider is inside FullscreenLayout; PromptInput writes null).
 *
 * selfSent: densable UTf/zTf — kernel peer ancestry only. Never wire meta.selfSent
 * and never forgeable message.from === own socket path.
 */
import { feature } from 'bun:bundle'
import { randomUUID } from 'crypto'
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { PeerInboundApprovalDialog } from '../components/PeerInboundApprovalDialog.js'
import { useNotifications } from '../context/notifications.js'
import { useAppStateStore } from '../state/AppState.js'
import { enqueue } from '../utils/messageQueueManager.js'
import { createPeerInboundApprovalQueue } from '../utils/peerInboundApprovalQueue.js'
import {
  buildHeldPeerMessageToast,
  buildPeerInboundHoldPreview,
  buildReleasedPeerMessagesToast,
  resolvePeerInboundDialogTimeoutMs,
  shouldPromptPeerInboundApproval,
  UNIDENTIFIED_PEER_SESSION,
} from '../utils/peerInboundHoldUi.js'
import { jsonStringify } from '../utils/slowOperations.js'

export type UsePeerInboundUdsDrainOptions = {
  /**
   * densable: dialog host waits behind other top-level dialogs (queueBehind).
   * When false, peer approval stays queued until the slot is free.
   */
  isDialogSlotFree?: () => boolean
}

/**
 * Wire UDS peer inbound drain + densable rSh hold surface.
 * Returns the active approval dialog node (or null) for REPL modal slot.
 */
export function usePeerInboundUdsDrain(
  options?: UsePeerInboundUdsDrainOptions,
): ReactNode {
  const store = useAppStateStore()
  const { addNotification } = useNotifications()
  const isDialogSlotFreeRef = useRef(options?.isDialogSlotFree)
  isDialogSlotFreeRef.current = options?.isDialogSlotFree

  const queue = useMemo(
    () =>
      createPeerInboundApprovalQueue({
        isSlotFree: () => isDialogSlotFreeRef.current?.() ?? true,
      }),
    [],
  )

  const activePayload = useSyncExternalStore(
    queue.subscribe,
    queue.getActivePayload,
    () => null,
  )

  // densable host advances queueBehind when the modal slot frees.
  const slotFree = options?.isDialogSlotFree?.() ?? true
  useEffect(() => {
    if (slotFree) queue.tryPump()
  }, [slotFree, queue])

  useEffect(() => {
    if (!feature('UDS_INBOX')) return

    /* eslint-disable @typescript-eslint/no-require-imports */
    const { drainInbox, setOnEnqueue } =
      require('../utils/udsMessaging.js') as typeof import('../utils/udsMessaging.js')
    const {
      gatePeerInboundQueuedCommand,
      setPeerInboundModeGetter,
      setPeerInboundHoldListeners,
      releaseHeldPeerInboundMessages,
      resolveHeldPeerInboundMessage,
      shouldHonorPeerFromMode,
      clearPeerInboundModeGetter,
      clearPeerInboundHoldBuffer,
    } =
      require('../utils/crossSessionInbound.js') as typeof import('../utils/crossSessionInbound.js')
    type PermissionModeClass =
      import('../utils/crossSessionInbound.js').PermissionModeClass
    type HeldPeerInboundMessage =
      import('../utils/crossSessionInbound.js').HeldPeerInboundMessage
    type PeerInboundHoldCause =
      import('../utils/crossSessionInbound.js').PeerInboundHoldCause
    /* eslint-enable @typescript-eslint/no-require-imports */

    const deliverReleased = (entries: HeldPeerInboundMessage[]): void => {
      for (const entry of entries) {
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
              typeof cmd.uuid === 'string' ? (cmd.uuid as never) : randomUUID(),
            origin: (cmd.origin as never) ?? { kind: 'peer' },
            skipSlashCommands: true,
            isMeta: true,
          })
        }
      }
    }

    setPeerInboundHoldListeners({
      onHeld: (entry, size, cause: PeerInboundHoldCause) => {
        // densable sya → warning toast
        addNotification({
          key: `peer-inbound-held-${entry.heldAt}-${size}`,
          text: buildHeldPeerMessageToast(entry, size, cause),
          color: 'warning',
          priority: 'high',
        })

        // densable: dialog only when n is wired and cause is mode-mismatch | no-mode-asserted
        if (!shouldPromptPeerInboundApproval(cause)) return

        const d = buildPeerInboundHoldPreview(entry.message)
        const timeoutMs = resolvePeerInboundDialogTimeoutMs()
        const ac = new AbortController()
        let expired = false
        const timer =
          timeoutMs > 0
            ? setTimeout(() => {
                expired = true
                ac.abort('expired')
              }, timeoutMs)
            : null

        const payload = {
          fromAddress:
            d.address === UNIDENTIFIED_PEER_SESSION ? undefined : d.address,
          claimedName: d.claimedName || undefined,
          verifiedPeerPid: d.verifiedPeerPid,
          holdCause: cause,
          preview: d.dialogBody,
        }

        // densable n(gGn, …, {signal, queueBehind:!0}).then → Kei
        void queue
          .open(payload, { signal: ac.signal, key: entry as object })
          .then(behavior => {
            if (timer) clearTimeout(timer)
            // densable: cancelled + expired → Kei cancelled (expire);
            // cancelled without expire → deny
            if (behavior === 'cancelled') {
              resolveHeldPeerInboundMessage(
                entry as HeldPeerInboundMessage,
                expired ? 'expire' : 'deny',
              )
              return
            }
            resolveHeldPeerInboundMessage(
              entry as HeldPeerInboundMessage,
              behavior,
            )
          })
          .catch(() => {
            if (timer) clearTimeout(timer)
            resolveHeldPeerInboundMessage(
              entry as HeldPeerInboundMessage,
              expired ? 'expire' : 'deny',
            )
          })
      },
      onReleased: (entries, reason) => {
        // densable IRn: toast only (qqp already ran in zqp/Kei).
        // Local: deliver here; cancel only dialogs for released keys so a
        // concurrent hold's gGn is not clobbered.
        queue.cancelKeys(entries as object[])
        deliverReleased(entries as HeldPeerInboundMessage[])
        if (entries.length > 0) {
          addNotification({
            key: `peer-inbound-released-${Date.now()}`,
            text: buildReleasedPeerMessagesToast(entries.length, reason),
            color: 'warning',
            priority: 'high',
          })
        }
      },
    })

    setPeerInboundModeGetter(() => {
      const ctx = store.getState().toolPermissionContext
      return {
        mode: ctx.mode,
        isBypassPermissionsModeAvailable: ctx.isBypassPermissionsModeAvailable,
      }
    })

    // densable rSh: useEffect vPr("mode-changed") on [e,t] mode args
    let lastMode = store.getState().toolPermissionContext.mode
    let lastBypass =
      store.getState().toolPermissionContext.isBypassPermissionsModeAvailable
    const unsubMode = store.subscribe(() => {
      const ctx = store.getState().toolPermissionContext
      if (
        ctx.mode === lastMode &&
        ctx.isBypassPermissionsModeAvailable === lastBypass
      ) {
        return
      }
      lastMode = ctx.mode
      lastBypass = ctx.isBypassPermissionsModeAvailable
      releaseHeldPeerInboundMessages('mode-changed')
    })

    // densable: a=Ng().crossSessionInbound; useEffect vPr("policy-accepts")
    // Ng() = AppState.settings (applySettingsChange keeps it in sync).
    let lastPolicy = store.getState().settings?.crossSessionInbound
    const unsubPolicy = store.subscribe(() => {
      const next = store.getState().settings?.crossSessionInbound
      if (next === lastPolicy) return
      lastPolicy = next
      releaseHeldPeerInboundMessages('policy-accepts')
    })

    const enqueueUdsInboxMessages = (): void => {
      const entries = drainInbox()
      for (const entry of entries) {
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
        const from =
          typeof entry.message.from === 'string'
            ? entry.message.from
            : 'unknown'
        // densable UTf + zTf/jTf: selfSent only when kernel peer pid's ancestors
        // include process.pid (SO_PEERCRED / LOCAL_PEERPID via Bun.ant.getPeerPid).
        // Never trust wire meta.selfSent; never key on forgeable message.from
        // (densable: from is sender-authored, reply routing only). Without peer-cred
        // (no Bun.ant here / Windows / unverifiable) leave selfSent unset — fail-closed.

        const command = {
          mode: 'prompt' as const,
          value,
          uuid: randomUUID(),
          origin: {
            kind: 'peer' as const,
            from,
            ...(fromMode !== undefined ? { fromMode } : {}),
            ...(typeof meta?.msg_id === 'string'
              ? { msg_id: meta.msg_id }
              : {}),
          },
          skipSlashCommands: true,
          isMeta: true,
        }

        if (
          gatePeerInboundQueuedCommand(command, {
            honorFromMode: shouldHonorPeerFromMode(),
          }) !== 'accept'
        ) {
          continue
        }
        enqueue(command)
      }
    }

    setOnEnqueue(() => {
      enqueueUdsInboxMessages()
    })
    enqueueUdsInboxMessages()

    // densable 2.1.236 — deliver correlated [Cross-session idle notice] prompts.
    try {
      const { setIdleNoticeHandler, idleNoticeModelText } =
        require('../utils/udsIdleNotify.js') as typeof import('../utils/udsIdleNotify.js')
      setIdleNoticeHandler(notice => {
        const text = idleNoticeModelText(notice)
        if (!notice.modelVisible) {
          // densable hold: shown to user / logged, not delivered to the model.
          return
        }
        enqueue({
          mode: 'prompt',
          value: text,
          uuid: randomUUID(),
          origin: { kind: 'peer', from: 'peer_idle_notice' },
          skipSlashCommands: true,
          isMeta: true,
        })
      })
    } catch {
      // optional when UDS idle notify module unavailable
    }

    return () => {
      setOnEnqueue(null)
      try {
        const { setIdleNoticeHandler } =
          require('../utils/udsIdleNotify.js') as typeof import('../utils/udsIdleNotify.js')
        setIdleNoticeHandler(null)
      } catch {
        // ignore
      }
      unsubMode()
      unsubPolicy()
      clearPeerInboundModeGetter()
      clearPeerInboundHoldBuffer()
      setPeerInboundHoldListeners({})
      queue.dispose()
    }
  }, [store, addNotification, queue])

  const onAnswer = useCallback(
    (result: 'approve' | 'deny' | 'cancelled') => {
      queue.answer(result)
    },
    [queue],
  )

  if (!activePayload) return null
  return createElement(PeerInboundApprovalDialog, {
    payload: activePayload,
    onAnswer,
  })
}
