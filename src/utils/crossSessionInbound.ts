/**
 * densable 2.1.224 #5 — cross-session inbound peer message gate.
 *
 * SEA: TPr / lya / Bqp / jqp / PRn / vPr·zqp / Kei / xRn·dya / hold buffer
 * (hqb=100) / peer_inbound_gate / Wei (tengu_harbor_kite_mode_emit).
 *
 * Pure decision + hold buffer + mode-getter registry + release-on-change.
 * Wire UDS/bridge drain through gatePeerInboundMessage / gatePeerInboundQueuedCommand.
 */

import type { MessageOrigin } from '../types/message.js'
import type { PermissionMode } from '../types/permissions.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import {
  type CrossSessionInbound,
  resolveCrossSessionInbound,
} from './settings/settings.js'

export type PermissionModeClass = 'bypass' | 'prompting'

export type PeerInboundHoldCause =
  | 'explicit-setting'
  | 'bypass-default'
  | 'mode-mismatch'
  | 'mode-unknown'
  | 'no-mode-asserted'

export type PeerInboundPolicyDecision = {
  policy: CrossSessionInbound
  holdCause: PeerInboundHoldCause
}

export type PeerInboundGateResult = 'accept' | 'held' | 'refused'

export type PeerInboundReleaseReason =
  | 'mode-changed'
  | 'policy-accepts'
  | 'approved'

export type PeerModeSnapshot = {
  mode: PermissionMode
  /** densable: plan + isBypassPermissionsModeAvailable counts as bypass. */
  isBypassPermissionsModeAvailable?: boolean
}

export type PeerOriginMeta = {
  fromMode?: PermissionModeClass
  selfSent?: boolean
}

/** densable cya — is this session's permission mode class "bypass"? */
export function isBypassPermissionModeClass(
  snap: PeerModeSnapshot | null | undefined,
): boolean {
  if (!snap) return false
  return (
    snap.mode === 'bypassPermissions' ||
    (snap.mode === 'plan' && snap.isBypassPermissionsModeAvailable === true)
  )
}

/** densable uya — map session mode → class. */
export function permissionModeClassOf(
  snap: PeerModeSnapshot,
): PermissionModeClass {
  return isBypassPermissionModeClass(snap) ? 'bypass' : 'prompting'
}

const KNOWN_MODES = new Set<PermissionMode>([
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
  'bubble',
])

/**
 * densable Wei / tengu_harbor_kite_mode_emit — honor origin.fromMode when true.
 * Default false (fail closed on mode parity until the emit gate is on).
 */
export function shouldHonorPeerFromMode(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_harbor_kite_mode_emit',
    false as boolean,
  )
}

/**
 * densable Bqp(e) — decide accept/hold/refuse for one peer-origin message.
 *
 *   explicit crossSessionInbound → that policy
 *   selfSent → accept
 *   local mode unknown → hold (fail-closed)
 *   if sender asserted fromMode (feature-gated emit): class match → accept else hold
 *   else if local is bypass → hold (no-mode-asserted)
 *   else → accept
 */
export function decidePeerInboundPolicy(opts: {
  explicit?: CrossSessionInbound
  selfMode: PeerModeSnapshot | null
  origin?: PeerOriginMeta | null
  /** densable Wei / tengu_harbor_kite_mode_emit — honor origin.fromMode when true. */
  honorFromMode?: boolean
}): PeerInboundPolicyDecision {
  const explicit = opts.explicit
  if (explicit !== undefined) {
    return { policy: explicit, holdCause: 'explicit-setting' }
  }
  if (opts.origin?.selfSent) {
    return { policy: 'accept', holdCause: 'bypass-default' }
  }
  const self = opts.selfMode
  if (self === null || !KNOWN_MODES.has(self.mode)) {
    if (self !== null && self.mode !== undefined) {
      logForDebugging(
        `[cross-session-inbound] unrecognized permission mode '${String(self.mode)}' (fail-closed → hold)`,
      )
    }
    return { policy: 'hold', holdCause: 'mode-unknown' }
  }
  const selfClass = permissionModeClassOf(self)
  const honorFromMode = opts.honorFromMode === true
  const fromMode = honorFromMode ? opts.origin?.fromMode : undefined
  if (fromMode !== undefined) {
    if (fromMode === selfClass) {
      return { policy: 'accept', holdCause: 'bypass-default' }
    }
    return { policy: 'hold', holdCause: 'mode-mismatch' }
  }
  if (selfClass === 'bypass') {
    return { policy: 'hold', holdCause: 'no-mode-asserted' }
  }
  return { policy: 'accept', holdCause: 'bypass-default' }
}

/**
 * densable lya() — session-level default policy when no per-message origin
 * is available (used for buffer release / UI).
 */
export function decideSessionInboundPolicy(opts: {
  explicit?: CrossSessionInbound
  selfMode: PeerModeSnapshot | null
}): PeerInboundPolicyDecision {
  const explicit = opts.explicit
  if (explicit !== undefined) {
    return { policy: explicit, holdCause: 'explicit-setting' }
  }
  const self = opts.selfMode
  if (self === null || !KNOWN_MODES.has(self.mode)) {
    if (self !== null && self.mode !== undefined) {
      logForDebugging(
        `[cross-session-inbound] unrecognized permission mode '${String(self.mode)}' (fail-closed → hold)`,
      )
    }
    return { policy: 'hold', holdCause: 'mode-unknown' }
  }
  return {
    policy: isBypassPermissionModeClass(self) ? 'hold' : 'accept',
    holdCause: 'bypass-default',
  }
}

// ---------------------------------------------------------------------------
// Mode getter (densable oya / xRn / dya)
// ---------------------------------------------------------------------------

type PeerModeGetter = () => PeerModeSnapshot | null

let modeGetter: PeerModeGetter | null = null

/**
 * densable xRn — register session permission-mode getter.
 * When non-null, immediately attempts release of held messages (mode-changed).
 */
export function setPeerInboundModeGetter(getter: PeerModeGetter | null): void {
  modeGetter = getter
  if (getter !== null) {
    releaseHeldPeerInboundMessages('mode-changed')
  }
}

/** densable dya — read current self mode via getter (fail-closed → null). */
export function getPeerInboundSelfMode(): PeerModeSnapshot | null {
  if (modeGetter === null) {
    logForDebugging(
      '[cross-session-inbound] permission-mode getter not wired (fail-closed → hold)',
    )
    return null
  }
  try {
    return modeGetter()
  } catch (e) {
    logForDebugging(
      `[cross-session-inbound] mode getter threw (${errorMessage(e)}; fail-closed → hold)`,
    )
    return null
  }
}

/**
 * densable Uqp — extract PeerOriginMeta from a queued command / message origin.
 */
export function peerOriginMetaFromMessage(
  message: unknown,
): PeerOriginMeta | null {
  if (!message || typeof message !== 'object') return null
  const origin = (message as { origin?: MessageOrigin | null }).origin
  if (!origin || origin.kind !== 'peer') return null
  const raw = origin.fromMode
  const fromMode: PermissionModeClass | undefined =
    raw === 'bypass' || raw === 'prompting' ? raw : undefined
  return {
    ...(fromMode !== undefined ? { fromMode } : {}),
    ...(origin.selfSent === true ? { selfSent: true } : {}),
  }
}

// ---------------------------------------------------------------------------
// Hold buffer (densable q0e / hqb=100)
// ---------------------------------------------------------------------------

export const PEER_INBOUND_HOLD_BUFFER_MAX = 100

export type HeldPeerInboundMessage<T = unknown> = {
  message: T
  heldAt: number
  holdCause: PeerInboundHoldCause
}

type HoldListeners<T> = {
  onHeld?: (
    entry: HeldPeerInboundMessage<T>,
    size: number,
    cause: PeerInboundHoldCause,
  ) => void
  onState?: (
    entry: HeldPeerInboundMessage<T>,
    state: 'held' | 'delivered' | 'denied' | 'expired',
  ) => void
  onReleased?: (entries: HeldPeerInboundMessage<T>[], reason: string) => void
}

const holdBuffer: HeldPeerInboundMessage[] = []
let holdListeners: HoldListeners<unknown> = {}

export function setPeerInboundHoldListeners<T = unknown>(
  listeners: HoldListeners<T>,
): void {
  holdListeners = listeners as HoldListeners<unknown>
}

export function clearPeerInboundHoldBuffer(): void {
  holdBuffer.length = 0
}

/** Test / teardown helper — drop mode getter without release. */
export function clearPeerInboundModeGetter(): void {
  modeGetter = null
}

export function getHeldPeerInboundMessages<
  T = unknown,
>(): HeldPeerInboundMessage<T>[] {
  return [...holdBuffer] as HeldPeerInboundMessage<T>[]
}

function summarizeHeld(entry: HeldPeerInboundMessage): string {
  const m = entry.message as
    | {
        from?: string
        value?: string
        origin?: { from?: string }
      }
    | undefined
  const from =
    m && typeof m === 'object'
      ? typeof m.origin?.from === 'string'
        ? m.origin.from
        : typeof m.from === 'string'
          ? m.from
          : 'unknown'
      : 'unknown'
  const value =
    m && typeof m === 'object' && typeof m.value === 'string'
      ? m.value.slice(0, 60)
      : '[blocks]'
  return `from=${from} "${value}"`
}

/**
 * densable jqp — apply policy: accept | refuse | hold (buffer, cap 100).
 * accept also flushes held messages that now pass (zqp "policy-accepts").
 */
export function applyPeerInboundPolicy<T>(
  message: T,
  decision: PeerInboundPolicyDecision,
): PeerInboundGateResult {
  switch (decision.policy) {
    case 'accept':
      // densable jqp accept → zqp("policy-accepts") then accept the new message
      releaseHeldPeerInboundMessages('policy-accepts')
      return 'accept'
    case 'refuse':
      logForDebugging(
        `[cross-session-inbound] refused inbound peer message (crossSessionInbound=refuse: ${summarizeHeld({ message, heldAt: Date.now(), holdCause: decision.holdCause })})`,
      )
      return 'refused'
    case 'hold': {
      if (holdBuffer.length >= PEER_INBOUND_HOLD_BUFFER_MAX) {
        const evicted = holdBuffer.shift()
        if (evicted) {
          logForDebugging(
            `[cross-session-inbound] hold buffer full — evicted oldest as expired: ${summarizeHeld(evicted)}`,
          )
          holdListeners.onState?.(evicted, 'expired')
        }
      }
      const entry: HeldPeerInboundMessage<T> = {
        message,
        heldAt: Date.now(),
        holdCause: decision.holdCause,
      }
      holdBuffer.push(entry as HeldPeerInboundMessage)
      logForDebugging(
        `[cross-session-inbound] held inbound peer message (${holdBuffer.length} held, cause=${decision.holdCause}): ${summarizeHeld(entry as HeldPeerInboundMessage)}`,
      )
      holdListeners.onHeld?.(
        entry as HeldPeerInboundMessage,
        holdBuffer.length,
        decision.holdCause,
      )
      holdListeners.onState?.(entry as HeldPeerInboundMessage, 'held')
      return 'held'
    }
  }
}

/**
 * densable PRn / decide+apply with current settings + self mode.
 * selfMode defaults to mode getter (dya); origin defaults to Uqp(message).
 */
export function gatePeerInboundMessage<T>(
  message: T,
  opts: {
    selfMode?: PeerModeSnapshot | null
    origin?: PeerOriginMeta | null
    honorFromMode?: boolean
    /**
     * When the key is present (including `undefined`), use it as TPr result.
     * When omitted, call resolveCrossSessionInbound(). Tests pass
     * `explicit: undefined` to force the densable "unset" path.
     */
    explicit?: CrossSessionInbound
  } = {},
): PeerInboundGateResult {
  const explicit = Object.hasOwn(opts, 'explicit')
    ? opts.explicit
    : resolveCrossSessionInbound()
  const selfMode =
    opts.selfMode !== undefined ? opts.selfMode : getPeerInboundSelfMode()
  const origin =
    opts.origin !== undefined ? opts.origin : peerOriginMetaFromMessage(message)
  const honorFromMode =
    opts.honorFromMode !== undefined
      ? opts.honorFromMode
      : shouldHonorPeerFromMode()
  const decision = decidePeerInboundPolicy({
    explicit,
    selfMode,
    origin,
    honorFromMode,
  })
  return applyPeerInboundPolicy(message, decision)
}

/**
 * densable PRn convenience for queued commands with origin.kind === 'peer'.
 */
export function gatePeerInboundQueuedCommand<
  T extends { origin?: MessageOrigin | null },
>(
  command: T,
  opts: {
    selfMode?: PeerModeSnapshot | null
    honorFromMode?: boolean
    explicit?: CrossSessionInbound
  } = {},
): PeerInboundGateResult {
  return gatePeerInboundMessage(command, {
    ...opts,
    origin: peerOriginMetaFromMessage(command),
  })
}

/**
 * densable vPr / zqp — re-evaluate held buffer; deliver accept, drop refuse, keep hold.
 * Returns count of messages released for delivery (via onReleased).
 *
 * opts.explicit / opts.selfMode / opts.honorFromMode: when the key is present,
 * use that value instead of live TPr/dya/Wei (tests + deterministic re-eval).
 */
export function releaseHeldPeerInboundMessages(
  reason: PeerInboundReleaseReason,
  opts: {
    explicit?: CrossSessionInbound
    selfMode?: PeerModeSnapshot | null
    honorFromMode?: boolean
  } = {},
): number {
  if (holdBuffer.length === 0) return 0

  const explicit = Object.hasOwn(opts, 'explicit')
    ? opts.explicit
    : resolveCrossSessionInbound()
  const selfMode = Object.hasOwn(opts, 'selfMode')
    ? (opts.selfMode ?? null)
    : getPeerInboundSelfMode()
  const honorFromMode = Object.hasOwn(opts, 'honorFromMode')
    ? opts.honorFromMode === true
    : shouldHonorPeerFromMode()
  // densable gqb() === "refuse" → drop all held
  const sessionPolicy = decideSessionInboundPolicy({ explicit, selfMode })
  const dropAll = sessionPolicy.policy === 'refuse'

  const kept: HeldPeerInboundMessage[] = []
  const released: HeldPeerInboundMessage[] = []
  let dropped = 0

  for (const entry of holdBuffer) {
    if (dropAll) {
      dropped += 1
      holdListeners.onState?.(entry, 'denied')
      continue
    }
    const decision = decidePeerInboundPolicy({
      explicit,
      selfMode,
      origin: peerOriginMetaFromMessage(entry.message),
      honorFromMode,
    })
    if (decision.policy === 'accept') {
      released.push(entry)
    } else if (decision.policy === 'refuse') {
      dropped += 1
      holdListeners.onState?.(entry, 'denied')
    } else {
      kept.push(entry)
    }
  }

  holdBuffer.length = 0
  holdBuffer.push(...kept)

  if (dropped > 0) {
    logForDebugging(
      `[cross-session-inbound] dropped ${dropped} held peer message(s) — policy is now refuse`,
    )
  }
  if (released.length === 0) return 0

  // densable: qqp each, then aya(n, reason), then rwt delivered
  holdListeners.onReleased?.(released, reason)
  for (const entry of released) {
    holdListeners.onState?.(entry, 'delivered')
  }
  logForDebugging(
    `[cross-session-inbound] released ${released.length} held peer message(s) (${reason}); ${holdBuffer.length} still held`,
  )
  return released.length
}

/**
 * densable Kei — user approves/denies one held message.
 */
export function resolveHeldPeerInboundMessage(
  entry: HeldPeerInboundMessage,
  action: 'approve' | 'deny' | 'expire',
): 'delivered' | 'dropped' | 'gone' {
  const idx = holdBuffer.indexOf(entry)
  if (idx === -1) return 'gone'
  const [removed] = holdBuffer.splice(idx, 1)
  if (!removed) return 'gone'
  if (action === 'approve') {
    holdListeners.onReleased?.([removed], 'approved')
    holdListeners.onState?.(removed, 'delivered')
    logForDebugging(
      '[cross-session-inbound] held peer message APPROVED — released to queue',
    )
    return 'delivered'
  }
  logForDebugging(
    `[cross-session-inbound] held peer message ${action === 'deny' ? 'DENIED' : 'EXPIRED/CANCELLED'} — dropped with denial receipt`,
  )
  holdListeners.onState?.(removed, action === 'deny' ? 'denied' : 'expired')
  return 'dropped'
}

// ---------------------------------------------------------------------------
// densable hold-cause / release-reason copy (cxv / lxv) — for UI / warnings
// ---------------------------------------------------------------------------

/** densable cxv — short hold-cause explanation. */
export function peerInboundHoldCauseMessage(
  cause: PeerInboundHoldCause,
): string {
  switch (cause) {
    case 'bypass-default':
      return 'It is being reviewed before delivery.'
    case 'explicit-setting':
      return 'Your "crossSessionInbound" setting is "hold"; set it to "accept" to deliver held messages.'
    case 'mode-unknown':
      return 'It will be delivered once the session finishes starting up.'
    case 'mode-mismatch':
      return `The sending session's permission mode class doesn't match this session's. Review it below, or set "crossSessionInbound" to "accept".`
    case 'no-mode-asserted':
      return 'The sender did not attest its permission mode and this session bypasses prompts. Review it below, or set "crossSessionInbound" to "accept".'
  }
}

/** densable lxv — reason string when held messages auto-release. */
export function peerInboundReleaseReasonMessage(
  reason: PeerInboundReleaseReason | string,
): string {
  switch (reason) {
    case 'mode-changed':
      return 'permissions are prompting again'
    case 'policy-accepts':
      return 'crossSessionInbound now accepts'
    case 'approved':
      return 'you approved it'
    default:
      return String(reason)
  }
}

/**
 * densable pya — true when unset policy + local bypass class (UI may warn).
 */
export function isPeerInboundBypassDefaultHold(): boolean {
  if (resolveCrossSessionInbound() !== undefined) return false
  const self = getPeerInboundSelfMode()
  if (self === null || !KNOWN_MODES.has(self.mode)) return false
  return isBypassPermissionModeClass(self)
}
