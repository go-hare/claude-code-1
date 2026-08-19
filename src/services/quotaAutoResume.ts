/**
 * densable 2.1.234 quota auto-resume (`autoContinueAtUsageLimit`).
 *
 * SEA symbols: Wqn/BXa/Sxi (effective setting), M4f/L4f/O4f (arm),
 * Axi/IVr (cancel), qXa/B4f (tick/fire), zqn/vgt (GB gates),
 * DZi/lYm/cYm/pYm (wait copy), VXa (dialog arm), Gis (cancel+notice).
 *
 * Invent-ban: Desktop/cloud handoff product paths are cancel *reasons* only —
 * we do not invent Desktop/cloud clients. Local CLI paths are implemented.
 */

import { randomUUID } from 'crypto'
import {
  getMainThreadAgentId,
  getIsNonInteractiveSession,
  isMainThreadQueuedCommand,
} from '../bootstrap/state.js'
import { createSignal } from '../utils/signal.js'
import { logError } from '../utils/log.js'
import { isClaudeAISubscriber, getOauthAccountInfo } from '../utils/auth.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import type { SettingSource } from '../utils/settings/constants.js'
import { formatResetTime } from '../utils/format.js'
import { logEvent } from './analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from './analytics/metadata.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from './analytics/growthbook.js'
import {
  type ClaudeAILimits,
  currentLimits,
  statusListeners,
} from './claudeAiLimits.js'
import {
  enqueue,
  getCommandQueue,
  isQueuedCommandEditable,
} from '../utils/messageQueueManager.js'
import type { QueuedCommand } from '../types/textInputTypes.js'

/** densable k0S */
export const TENGU_MARBLE_HERON = 'tengu_marble_heron'
/** densable vgt */
export const TENGU_MAPLE_SUNDIAL = 'tengu_maple_sundial'

/** densable T4f — 24h horizon for auto-arm */
export const AUTO_CONTINUE_HORIZON_MS = 86_400_000
/** densable x0S / C0S jitter bounds (ms) */
const JITTER_MIN_MS = 30_000
const JITTER_MAX_MS = 90_000
/** densable T0S rearm cap */
const REARM_CAP = 2
/** densable iYm — tick while armed */
export const QUOTA_AUTO_RESUME_TICK_MS = 30_000

/** densable A4f */
export const CONTINUATION_PROMPT =
  'Your claude.ai usage limit has reset. Continue the task you were working on when the limit was reached; do not repeat work that is already complete.'

/** densable r4i */
export const AUTO_CONTINUE_CANCELLED_NOTICE =
  'Automatic continue cancelled · /rate-limit-options to re-arm'

/**
 * densable iOs for Kkr(autoContinueAtUsageLimit): policy → flag → user.
 * First defined value wins (high-priority managed sources first).
 */
const AUTO_CONTINUE_SETTING_SOURCES: SettingSource[] = [
  'policySettings',
  'flagSettings',
  'userSettings',
]

export type AutoContinueKeyPresence =
  | 'unscanned'
  | 'absent'
  | 'present'
  | 'unknowable'

export type QuotaAutoResumePhase = 'idle' | 'armed' | 'stale'

export type QuotaAutoResumeState =
  | { phase: 'idle' }
  | {
      phase: 'armed'
      resetsAtSeconds: number
      fireAtMs: number
      consecutiveRearms: number
    }
  | { phase: 'stale' }

export type EpisodeArmOrigin = 'dialog' | 'auto'

export type CancelReason =
  | 'escape'
  | 'ctrl_c'
  | 'kill_agents_chord'
  | 'dialog'
  | 'account_switch'
  | 'setting_off'
  | 'manual_submit'
  | 'conversation_reset'
  | 'killswitch'
  | 'rearm_cap'
  | 'horizon_exceeded'
  | 'continuation_dropped'
  | 'background_handoff'
  | 'relaunch'
  | 'desktop_handoff'
  | 'cloud_handoff'
  | 'process_exit'
  | 'fired'
  | 'stale'

/** densable episode.events payloads used by oTl hook */
export type QuotaAutoResumeEvent =
  | 'armed'
  | 'auto-armed'
  | 'cancelled'
  | 'fired-now'
  | 'stale'
  | 'disabled'
  | 'horizon-exceeded'
  | 'continuation-dropped'
  | 'cap-exhausted'
  | 'taken-over'
  | 'rearmed'

/** densable W4f / G4f activeTurnClaim */
export type QuotaTurnClaim = {
  claimedAtMs: number
  kind: 'takeover' | 'continuation'
  queried: boolean
}

type Episode = {
  state: QuotaAutoResumeState
  consecutiveRearms: number
  armedAtMs: number
  lastArmedResetsAtSeconds: number
  lastObservedMs: number | null
  pendingContinuationUuid: string | null
  takeoverUuids: Set<string>
  dispatchingTakeoverUuids: Set<string>
  queuedBeforeArmUuids: Set<string>
  activeTurnClaim: QuotaTurnClaim | null
  episodeArmOrigin: EpisodeArmOrigin
  sleptThroughReset: boolean
  armedResetKeys: Set<number>
  autoArmDedupeResetKeys: Set<number>
  autoContinueKeyPresence: AutoContinueKeyPresence
  changed: ReturnType<typeof createSignal>
  events: SignalWithEvent
}

type SignalWithEvent = {
  subscribe: (listener: (event: QuotaAutoResumeEvent) => void) => () => void
  emit: (event: QuotaAutoResumeEvent) => void
  clear: () => void
}

function createEventSignal(): SignalWithEvent {
  const inner = createSignal<[QuotaAutoResumeEvent]>()
  return {
    subscribe: listener => inner.subscribe(listener),
    emit: event => inner.emit(event),
    clear: () => inner.clear(),
  }
}

function createEpisode(): Episode {
  // densable I0S
  return {
    state: { phase: 'idle' },
    consecutiveRearms: 0,
    armedAtMs: 0,
    lastArmedResetsAtSeconds: 0,
    lastObservedMs: null,
    pendingContinuationUuid: null,
    takeoverUuids: new Set(),
    dispatchingTakeoverUuids: new Set(),
    queuedBeforeArmUuids: new Set(),
    activeTurnClaim: null,
    episodeArmOrigin: 'dialog',
    sleptThroughReset: false,
    armedResetKeys: new Set(),
    autoArmDedupeResetKeys: new Set(),
    autoContinueKeyPresence: 'unscanned',
    changed: createSignal(),
    events: createEventSignal(),
  }
}

let episode: Episode = createEpisode()
let limitsHooked = false

/** densable wF / J3e */
export function getQuotaAutoResumeState(): QuotaAutoResumeState {
  return episode.state
}

export function subscribeQuotaAutoResumeChanged(
  listener: () => void,
): () => void {
  return episode.changed.subscribe(listener)
}

/** densable Kqn */
export function subscribeQuotaAutoResumeEvents(
  listener: (event: QuotaAutoResumeEvent) => void,
): () => void {
  return episode.events.subscribe(listener)
}

/** densable C4f */
function coerceGateTruthy(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase()
    return t !== '' && t !== 'false' && t !== '0'
  }
  return Boolean(value)
}

/** densable x4f / UXa — tengu_marble_heron payload */
function getMarbleHeronConfig(): Record<string, unknown> {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    TENGU_MARBLE_HERON,
    {},
  )
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

/** densable zqn — killswitch (default ON when unset) */
export function isQuotaAutoResumeKillswitchEnabled(): boolean {
  const cfg = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    TENGU_MARBLE_HERON,
    {},
  )
  if (cfg !== null && typeof cfg === 'object' && !Array.isArray(cfg)) {
    const obj = cfg as Record<string, unknown>
    if ('enabled' in obj) return coerceGateTruthy(obj.enabled)
  }
  return coerceGateTruthy(cfg)
}

/** densable vgt — Config toggle visibility */
export function isAutoContinueAtUsageLimitToggleable(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
    TENGU_MAPLE_SUNDIAL,
    false,
  )
}

/** densable O0S — autoArm from marble_heron (default true) */
function isAutoArmEnabled(): boolean {
  return coerceGateTruthy(getMarbleHeronConfig().autoArm)
}

/**
 * densable Kkr / T0e — densable iOs order (policy → flag → user).
 */
export function getAutoContinueAtUsageLimitSettingEntries(): Array<{
  source: SettingSource
  value: boolean
}> {
  const out: Array<{ source: SettingSource; value: boolean }> = []
  for (const source of AUTO_CONTINUE_SETTING_SOURCES) {
    const v = getSettingsForSource(source)?.autoContinueAtUsageLimit
    if (typeof v === 'boolean') out.push({ source, value: v })
  }
  return out
}

/** densable Sxi */
export function getAutoContinueAtUsageLimitFromSettings(): boolean | undefined {
  return getAutoContinueAtUsageLimitSettingEntries()[0]?.value
}

/** densable _xi lite — disk key presence (no remote storageV5 invent) */
export function refreshAutoContinueKeyPresence(): AutoContinueKeyPresence {
  const entries = getAutoContinueAtUsageLimitSettingEntries()
  episode.autoContinueKeyPresence = entries.length === 0 ? 'absent' : 'present'
  return episode.autoContinueKeyPresence
}

/**
 * densable BXa / Wqn — settings value wins; else absent key ⇒ true.
 */
export function isAutoContinueAtUsageLimitEffective(
  presence: AutoContinueKeyPresence = episode.autoContinueKeyPresence,
): boolean {
  const fromSettings = getAutoContinueAtUsageLimitFromSettings()
  if (fromSettings !== undefined) return fromSettings
  if (presence === 'unscanned') {
    return refreshAutoContinueKeyPresence() === 'absent'
  }
  return presence === 'absent'
}

/** densable R4f ≈ subscriber && interactive */
function isQuotaAutoResumeSurfaceEligible(): boolean {
  return isClaudeAISubscriber() && !getIsNonInteractiveSession()
}

/** densable Vqn */
export function isQuotaRejectedForAutoContinue(
  limits: ClaudeAILimits,
): boolean {
  return (
    limits.status === 'rejected' &&
    limits.resetsAt !== undefined &&
    Number.isFinite(limits.resetsAt) &&
    limits.isUsingOverage !== true
  )
}

/** densable Ac()?.billingType !== "usage_based" */
function isNotUsageBasedBilling(): boolean {
  const billing = getOauthAccountInfo()?.billingType
  return billing !== 'usage_based'
}

/** densable M0S / d$t prechecks (without limits) */
export function canOfferQuotaAutoResume(limits: ClaudeAILimits): boolean {
  return (
    isQuotaAutoResumeSurfaceEligible() &&
    isNotUsageBasedBilling() &&
    isQuotaRejectedForAutoContinue(limits) &&
    isQuotaAutoResumeKillswitchEnabled()
  )
}

/** densable WXa — pending continuation still in queue */
export function hasPendingQuotaContinuationInQueue(): boolean {
  const uuid = episode.pendingContinuationUuid
  if (uuid === null) return false
  return getCommandQueue().some(cmd => cmd.uuid === uuid)
}

/**
 * densable bxi — cmd is this episode's continuation or a Yqn takeover uuid.
 */
function isQuotaEpisodeOwnedCommand(cmd: QueuedCommand): boolean {
  return (
    cmd.uuid !== undefined &&
    (cmd.uuid === episode.pendingContinuationUuid ||
      episode.takeoverUuids.has(cmd.uuid))
  )
}

/**
 * densable Exi / p$t — episode still owns the wait (armed/stale or pending fire).
 */
export function isQuotaAutoResumeEpisodeActive(
  state: QuotaAutoResumeState = episode.state,
): boolean {
  return (
    state.phase === 'armed' ||
    state.phase === 'stale' ||
    hasPendingQuotaContinuationInQueue()
  )
}

/**
 * densable qlr — episode is live for O4f / Yqn / Axi.
 * Gold: armed || stale || activeTurnClaim || dispatchingTakeover ||
 * RU().some(bxi) || sxa(bxi). Local has no in-flight drain tracker (sxa);
 * WXa covers the queued continuation; takeoverUuids covers Yqn-owned humans.
 */
export function isQuotaAutoResumeLive(): boolean {
  if (
    episode.state.phase === 'armed' ||
    episode.state.phase === 'stale' ||
    episode.activeTurnClaim !== null ||
    episode.dispatchingTakeoverUuids.size > 0
  ) {
    return true
  }
  return getCommandQueue().some(isQuotaEpisodeOwnedCommand)
}

/** densable Klr */
export function isQuotaAutoResumeArmedOrPending(): boolean {
  return hasPendingQuotaContinuationInQueue()
}

/** densable P4f / waiting UI — armed/stale phase (for Esc cancel) */
export function isQuotaAutoResumeWaiting(
  state: QuotaAutoResumeState = episode.state,
): boolean {
  return state.phase === 'armed' || state.phase === 'stale'
}

/**
 * densable N0S — main-thread prompt that is also Uft-editable.
 * Gold: YM(e)&&e.mode==="prompt" then N0S = OUr && Uft.
 */
function isMainThreadEditablePrompt(cmd: QueuedCommand): boolean {
  return (
    isMainThreadQueuedCommand(cmd) &&
    cmd.mode === 'prompt' &&
    isQueuedCommandEditable(cmd)
  )
}

function setState(next: QuotaAutoResumeState): void {
  episode.state = next
  episode.changed.emit()
}

function computeFireAtMs(resetsAtSeconds: number): number {
  // densable F0S with null rearm → resets*1000 + jitter
  const jitter = Math.round(
    JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS),
  )
  return resetsAtSeconds * 1000 + jitter
}

/** densable L4f */
export function armQuotaAutoResume(
  resetsAtSeconds: number,
  nowMs: number = Date.now(),
  origin: EpisodeArmOrigin = 'dialog',
  rearm: number | null = null,
): void {
  episode.episodeArmOrigin = origin
  episode.lastArmedResetsAtSeconds = resetsAtSeconds
  episode.autoArmDedupeResetKeys.add(resetsAtSeconds)
  episode.armedResetKeys.add(resetsAtSeconds)
  episode.lastObservedMs = nowMs
  episode.sleptThroughReset = false
  const fireAtMs = computeFireAtMs(resetsAtSeconds)
  logEvent('tengu_quota_auto_resume_armed', {
    resets_in_sec: Math.max(0, Math.round(resetsAtSeconds - nowMs / 1000)),
    rearm: rearm === null ? 0 : rearm + 1,
  })
  setState({
    phase: 'armed',
    resetsAtSeconds,
    fireAtMs,
    consecutiveRearms: episode.consecutiveRearms,
  })
}

/** densable M4f / VXa — dialog/manual arm entry */
export function offerArmQuotaAutoResume(
  limits: ClaudeAILimits,
  nowMs: number = Date.now(),
  origin: EpisodeArmOrigin = 'dialog',
): boolean {
  if (!canOfferQuotaAutoResume(limits)) return false
  episode.consecutiveRearms = 0
  episode.takeoverUuids.clear()
  episode.dispatchingTakeoverUuids.clear()
  episode.queuedBeforeArmUuids.clear()
  // densable M4f: snapshot N0S (main-thread editable prompt) + bash Uft
  // uuids already in the queue so W4f can skip pre-arm humans as takeover.
  for (const cmd of getCommandQueue()) {
    if (
      isMainThreadEditablePrompt(cmd) ||
      (cmd.mode === 'bash' && isQueuedCommandEditable(cmd))
    ) {
      const uuid = cmd.uuid ?? randomUUID()
      cmd.uuid = uuid
      episode.queuedBeforeArmUuids.add(uuid)
    }
  }
  episode.armedAtMs = nowMs
  logEvent('tengu_quota_auto_resume_offer_armed', {
    origin:
      origin as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  armQuotaAutoResume(limits.resetsAt ?? 0, nowMs, origin, null)
  episode.events.emit(origin === 'auto' ? 'auto-armed' : 'armed')
  return true
}

/** densable O4f — auto-arm when setting effective */
export function tryAutoArmQuotaAutoResume(
  limits: ClaudeAILimits,
  nowMs: number = Date.now(),
): boolean {
  if (!canOfferQuotaAutoResume(limits)) return false
  if (!isAutoContinueAtUsageLimitEffective()) return false
  if (!isAutoArmEnabled()) return false
  const resetsAt = limits.resetsAt ?? 0
  if (resetsAt * 1000 - nowMs > AUTO_CONTINUE_HORIZON_MS) return false
  // densable O4f: if(qlr(r)||autoArmDedupe.has(n)) return !1
  if (isQuotaAutoResumeLive() || episode.autoArmDedupeResetKeys.has(resetsAt)) {
    return false
  }
  return offerArmQuotaAutoResume(limits, nowMs, 'auto')
}

function shouldLogCancel(reason: CancelReason): boolean {
  // densable W0S — fired/stale do not log cancelled
  return reason !== 'fired' && reason !== 'stale'
}

function shouldEmitCancelledEvent(reason: CancelReason): boolean {
  // densable j0S — user-gesture cancels emit "cancelled"
  return (
    reason === 'escape' || reason === 'ctrl_c' || reason === 'kill_agents_chord'
  )
}

function shouldClearAutoArmDedupe(reason: CancelReason): boolean {
  // densable z0S
  switch (reason) {
    case 'account_switch':
    case 'conversation_reset':
    case 'background_handoff':
    case 'relaunch':
    case 'desktop_handoff':
    case 'cloud_handoff':
    case 'process_exit':
      return true
    default:
      return false
  }
}

/**
 * densable Xqn — drop ownership of the pending continuation uuid.
 * keepIfDrained: if the continuation already left the queue, keep the uuid
 * (WXa/takeover still need it); if it is still queued, null it.
 * Does not dequeue (gold Xqn only drops the pointer).
 */
function dropPendingQuotaContinuationOwnership(keepIfDrained = false): boolean {
  const uuid = episode.pendingContinuationUuid
  if (uuid === null) return false
  const inQueue = getCommandQueue().some(cmd => cmd.uuid === uuid)
  if (inQueue || !keepIfDrained) {
    episode.pendingContinuationUuid = null
    episode.changed.emit()
  }
  return inQueue
}

/**
 * densable IVr / Axi / bgt.
 *
 * Gold IVr only Ylr(idle) — it never nulls pendingContinuationUuid.
 * Axi/E4f/PVr callers still drop the uuid; `fired`/`stale`/`manual_submit`
 * keep it so WXa can still see the continuation after qXa fire / Yqn Xqn.
 */
export function cancelQuotaAutoResume(reason: CancelReason): void {
  if (episode.state.phase === 'idle' && !hasPendingQuotaContinuationInQueue()) {
    return
  }
  const wasActive = isQuotaAutoResumeEpisodeActive()
  if (shouldClearAutoArmDedupe(reason)) {
    episode.autoArmDedupeResetKeys.clear()
  }
  if (shouldLogCancel(reason)) {
    logEvent('tengu_quota_auto_resume_cancelled', {
      reason:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  // densable IVr does not clear uuid on fired/stale/manual_submit.
  if (reason !== 'fired' && reason !== 'stale' && reason !== 'manual_submit') {
    episode.pendingContinuationUuid = null
  }
  setState({ phase: 'idle' })
  if (wasActive && shouldEmitCancelledEvent(reason)) {
    episode.events.emit('cancelled')
  }
}

/**
 * densable Yqn — human prompt submit while the episode is live.
 * Cancels armed wait (manual_submit) / stale resume; Xqn keepIfDrained
 * drops uuid ownership if the continuation is still queued.
 * Gold: takeoverUuids.add(e); if dispatching, dispatchingTakeoverUuids.add(e).
 */
export function onQuotaAutoResumeHumanSubmit(
  uuid?: string,
  opts: { dispatching?: boolean } = {},
): void {
  if (!isQuotaAutoResumeLive()) return
  dropPendingQuotaContinuationOwnership(true)
  if (episode.state.phase === 'stale') {
    logEvent('tengu_quota_auto_resume_stale_resumed', {})
    episode.lastObservedMs = null
    cancelQuotaAutoResume('stale')
  } else if (episode.state.phase === 'armed') {
    episode.lastObservedMs = null
    cancelQuotaAutoResume('manual_submit')
  }
  if (uuid !== undefined) {
    episode.takeoverUuids.add(uuid)
    if (opts.dispatching) episode.dispatchingTakeoverUuids.add(uuid)
  }
  episode.changed.emit()
}

/**
 * densable Jqn — killswitch off / auto-origin setting_off revoke the episode.
 * G0S unknowable-rescan is not ported (no storageV5). Dialog origin never
 * setting_off via G0S.
 */
function isQuotaContinuationRevoked(): boolean {
  if (!isQuotaAutoResumeKillswitchEnabled()) {
    cancelQuotaAutoResume('killswitch')
    episode.events.emit('disabled')
    return true
  }
  if (
    episode.episodeArmOrigin === 'auto' &&
    !isAutoContinueAtUsageLimitEffective()
  ) {
    cancelQuotaAutoResume('setting_off')
    episode.events.emit('disabled')
    return true
  }
  return false
}

/**
 * densable z4f — strip pending continuation from a drain batch only when Jqn.
 * Does not dequeue on Yqn/human submit.
 */
export function filterPendingQuotaContinuationIfRevoked(
  commands: QueuedCommand[],
): QueuedCommand[] {
  const uuid = episode.pendingContinuationUuid
  if (uuid === null || !commands.some(cmd => cmd.uuid === uuid)) {
    return commands
  }
  if (!isQuotaContinuationRevoked()) return commands
  return commands.filter(cmd => cmd.uuid !== uuid)
}

/** densable PVr — reset takeover/claim/origin bookkeeping; Xqn the pointer. */
function resetQuotaEpisodeOwnership(): boolean {
  episode.consecutiveRearms = 0
  episode.lastArmedResetsAtSeconds = 0
  episode.episodeArmOrigin = 'dialog'
  episode.takeoverUuids.clear()
  episode.dispatchingTakeoverUuids.clear()
  episode.queuedBeforeArmUuids.clear()
  episode.lastObservedMs = null
  episode.activeTurnClaim = null
  const dropped = dropPendingQuotaContinuationOwnership()
  episode.changed.emit()
  return dropped
}

/** densable w4f */
function emitQuotaContinuationDropped(): void {
  logEvent('tengu_quota_auto_resume_cancelled', {
    reason:
      'continuation_dropped' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  episode.events.emit('continuation-dropped')
}

export type QuotaTurnClaimInput = {
  turnUuids: string[]
  isHumanTakeover: boolean
  humanCommandUuids: Array<string | undefined>
  willQuery: boolean
}

/**
 * densable W4f — claim this drain as takeover vs continuation.
 * Does not dequeue the continuation (gold leaves it in J unless z4f/Jqn).
 */
export function claimQuotaAutoResumeTurn(
  input: QuotaTurnClaimInput,
): QuotaTurnClaim | null {
  for (const uuid of input.turnUuids) {
    episode.dispatchingTakeoverUuids.delete(uuid)
  }
  const continuationInTurn =
    episode.pendingContinuationUuid !== null &&
    input.turnUuids.includes(episode.pendingContinuationUuid)
  const takeoverInTurn = input.turnUuids.some(uuid =>
    episode.takeoverUuids.has(uuid),
  )
  const episodeActive = isQuotaAutoResumeEpisodeActive() || continuationInTurn
  const preArmHumanOnly =
    input.isHumanTakeover &&
    !takeoverInTurn &&
    input.humanCommandUuids.length > 0 &&
    input.humanCommandUuids.every(
      uuid => uuid !== undefined && episode.queuedBeforeArmUuids.has(uuid),
    )
  let kind: QuotaTurnClaim['kind'] | null = null
  if (preArmHumanOnly && !continuationInTurn) return null
  if (preArmHumanOnly) {
    kind = 'continuation'
  } else if (input.isHumanTakeover && (takeoverInTurn || episodeActive)) {
    kind = 'takeover'
    dropPendingQuotaContinuationOwnership(true)
    if (episode.state.phase === 'stale') {
      logEvent('tengu_quota_auto_resume_stale_resumed', {})
      episode.lastObservedMs = null
      cancelQuotaAutoResume('stale')
    } else if (episode.state.phase === 'armed') {
      episode.lastObservedMs = null
      cancelQuotaAutoResume('manual_submit')
    }
  } else if (continuationInTurn) {
    kind = 'continuation'
  }
  if (kind === null) return null
  if (episode.activeTurnClaim !== null) {
    logError(
      new Error(
        'quota auto-resume: a turn claimed the episode while another claim was outstanding',
      ),
    )
  }
  const claim: QuotaTurnClaim = {
    claimedAtMs: Date.now(),
    kind,
    queried: input.willQuery,
  }
  episode.activeTurnClaim = claim
  episode.changed.emit()
  return claim
}

/**
 * densable G4f — release the W4f claim after the turn; PVr + maybe w4f.
 */
export function releaseQuotaAutoResumeTurnClaim(
  claim: QuotaTurnClaim | null,
  turnUuids: string[],
): void {
  for (const uuid of turnUuids) {
    episode.dispatchingTakeoverUuids.delete(uuid)
  }
  const queueHasOwned = () => getCommandQueue().some(isQuotaEpisodeOwnedCommand)
  if (claim !== null) {
    if (claim !== episode.activeTurnClaim) return
    episode.activeTurnClaim = null
    episode.changed.emit()
    if (episode.state.phase !== 'idle') return
    if (queueHasOwned()) return
    resetQuotaEpisodeOwnership()
    if (claim.kind === 'continuation' && !claim.queried) {
      emitQuotaContinuationDropped()
    }
    return
  }
  const continuationInTurn =
    episode.pendingContinuationUuid !== null &&
    turnUuids.includes(episode.pendingContinuationUuid)
  if (
    (continuationInTurn ||
      turnUuids.some(uuid => episode.takeoverUuids.has(uuid))) &&
    episode.state.phase === 'idle' &&
    episode.activeTurnClaim === null &&
    !queueHasOwned()
  ) {
    resetQuotaEpisodeOwnership()
    if (continuationInTurn) emitQuotaContinuationDropped()
  }
}

/**
 * densable Gis — cancel + immediate feedback notification text.
 * Caller shows notification; we return the densable r4i copy.
 */
export function cancelQuotaAutoResumeWithNotice(
  reason: CancelReason,
): string | null {
  if (!isQuotaAutoResumeWaiting() && !hasPendingQuotaContinuationInQueue()) {
    return null
  }
  cancelQuotaAutoResume(reason)
  return AUTO_CONTINUE_CANCELLED_NOTICE
}

/** densable B4f — enqueue meta continuation */
export function fireQuotaAutoResumeContinuation(
  prompt: string = CONTINUATION_PROMPT,
): string {
  dropPendingQuotaContinuationOwnership()
  const uuid = randomUUID()
  episode.pendingContinuationUuid = uuid
  episode.activeTurnClaim = null
  episode.changed.emit()
  enqueue({
    value: prompt,
    mode: 'prompt',
    priority: 'later',
    uuid,
    origin: { kind: 'auto-continuation' },
    isMeta: true,
    skipSlashCommands: true,
    agentId: getMainThreadAgentId(),
  })
  return uuid
}

/**
 * densable qXa — clock tick while armed.
 * Returns pending | fired | stale | idle.
 */
export function tickQuotaAutoResume(
  nowMs: number = Date.now(),
  stillRejected = false,
): 'pending' | 'fired' | 'stale' | 'idle' {
  if (episode.state.phase !== 'armed') return 'idle'
  if (!isQuotaAutoResumeKillswitchEnabled()) {
    cancelQuotaAutoResume('killswitch')
    episode.events.emit('disabled')
    return 'idle'
  }
  if (!isAutoContinueAtUsageLimitEffective()) {
    cancelQuotaAutoResume('setting_off')
    episode.events.emit('disabled')
    return 'idle'
  }
  const armed = episode.state
  const last = episode.lastObservedMs ?? armed.fireAtMs
  const gap = nowMs - last
  episode.lastObservedMs = nowMs
  // densable: large clock gap past fireAt ⇒ slept through → stale
  if (gap > 30 * 60 * 1000 && nowMs >= armed.fireAtMs) {
    episode.sleptThroughReset = true
  }
  if (stillRejected || nowMs < armed.fireAtMs) return 'pending'
  if (episode.sleptThroughReset) {
    episode.sleptThroughReset = false
    logEvent('tengu_quota_auto_resume_stale', {
      late_by_ms: Math.round(nowMs - armed.fireAtMs),
    })
    setState({ phase: 'stale' })
    episode.events.emit('stale')
    return 'stale'
  }
  fireQuotaAutoResumeContinuation()
  logEvent('tengu_quota_auto_resume_fired', {
    rearm: armed.consecutiveRearms,
    waited_ms: Math.max(0, Math.round(nowMs - episode.armedAtMs)),
  })
  cancelQuotaAutoResume('fired')
  return 'fired'
}

/** densable pYm */
export function formatAutoContinueAtLabel(
  state: QuotaAutoResumeState,
  nowMs: number = Date.now(),
): string {
  if (state.phase !== 'armed') return 'shortly'
  const resetsAt = state.resetsAtSeconds
  if (resetsAt * 1000 > nowMs) {
    const formatted = formatResetTime(resetsAt, false)
    if (formatted) return `at ${formatted}`
  }
  return 'shortly'
}

/** densable lYm */
export function formatAutoContinueWaitNotice(
  state: QuotaAutoResumeState,
  nowMs: number = Date.now(),
): string {
  if (state.phase !== 'armed') return ''
  const when = formatAutoContinueAtLabel(state, nowMs)
  return `Usage limit reached · continuing automatically ${when} · esc or type to cancel`
}

/** densable _eo — sticky footer / pinned notice while waiting */
export function formatAutoContinuePinnedStatus(
  state: QuotaAutoResumeState,
  nowMs: number = Date.now(),
): string {
  if (state.phase === 'stale') {
    return 'Your usage limit has reset · press enter to continue'
  }
  if (state.phase !== 'armed') return ''
  const formatted = formatResetTime(state.resetsAtSeconds, false)
  if (formatted && state.resetsAtSeconds * 1000 > nowMs) {
    return `Usage limit reached · continuing automatically at ${formatted} · esc to cancel`
  }
  return 'Usage limit reached · continuing automatically when it resets · esc to cancel'
}

/** densable DZi — /rate-limit-options auto-resume label */
export function getWaitThenContinueOption(
  resetsAtSeconds: number | undefined,
  resetAlreadyPassed: boolean,
): { label: string; confirmationPhrase: string } {
  if (resetAlreadyPassed) {
    return {
      label: 'Wait here, then continue automatically shortly',
      confirmationPhrase: 'shortly',
    }
  }
  const formatted =
    resetsAtSeconds !== undefined
      ? formatResetTime(resetsAtSeconds, false)
      : undefined
  if (formatted) {
    return {
      label: `Wait here, then continue automatically at ${formatted}`,
      confirmationPhrase: `at ${formatted}`,
    }
  }
  return {
    label: 'Wait here, then continue automatically when the limit resets',
    confirmationPhrase: 'when your usage limit resets',
  }
}

/** Persist setting (densable Config onChange → userSettings) */
export function setAutoContinueAtUsageLimitSetting(enabled: boolean): {
  error: Error | null
} {
  const result = updateSettingsForSource('userSettings', {
    autoContinueAtUsageLimit: enabled,
  })
  refreshAutoContinueKeyPresence()
  if (!enabled && episode.state.phase === 'armed') {
    cancelQuotaAutoResume('setting_off')
    episode.events.emit('disabled')
  }
  logEvent('tengu_quota_auto_resume_setting_changed', { enabled })
  return result
}

/** Hook limits → try auto-arm (idempotent) */
export function ensureQuotaAutoResumeLimitsSubscription(): void {
  if (limitsHooked) return
  limitsHooked = true
  refreshAutoContinueKeyPresence()
  statusListeners.add((limits: ClaudeAILimits) => {
    if (limits.status === 'rejected') {
      tryAutoArmQuotaAutoResume(limits)
    }
  })
  // Opportunistic arm on existing rejected state
  if (currentLimits.status === 'rejected') {
    tryAutoArmQuotaAutoResume(currentLimits)
  }
}

/** Test helper — reset module episode */
export function resetQuotaAutoResumeForTests(): void {
  episode = createEpisode()
  limitsHooked = false
}

/** Expose rearm cap for tests / future rearm path */
export function getQuotaAutoResumeRearmCap(): number {
  return REARM_CAP
}
