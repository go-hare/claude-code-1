/**
 * densable 2.1.234 quota auto-resume (`autoContinueAtUsageLimit`).
 *
 * SEA symbols: Wqn/BXa/Sxi (effective setting), M4f/L4f/O4f (arm),
 * Axi/IVr (cancel), qXa/B4f (tick/fire), zqn/vgt (GB gates),
 * DZi/lYm/cYm/pYm (wait copy), VXa (dialog arm), Gis (cancel+notice).
 *
 * Invent-ban: Desktop/cloud handoff product paths are cancel *reasons* only —
 * we do not invent Desktop/cloud clients. Local CLI paths are implemented.
 * Print/SDK has no wait loop — gold `$Fm` requires interactive, `kDl` is
 * REPL-hook-only. Do not invent a `-p` wait UI.
 */

import { randomUUID } from 'crypto'
import {
  getMainThreadAgentId,
  getIsNonInteractiveSession,
  isMainThreadQueuedCommand,
  getMainLoopModelOverride,
  getInitialMainLoopModel,
  isReplBridgeActive,
  onSessionSwitch,
  type SessionSwitchReason,
} from '../bootstrap/state.js'
import { getAgentId } from '../utils/teammate.js'
import { createSignal } from '../utils/signal.js'
import { logError } from '../utils/log.js'
import { isClaudeAISubscriber, getOauthAccountInfo } from '../utils/auth.js'
import {
  getSettingsForSource,
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import type { SettingSource } from '../utils/settings/constants.js'
import { formatResetTime } from '../utils/format.js'
import { logEvent } from './analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from './analytics/metadata.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from './analytics/growthbook.js'
import {
  type ClaudeAILimits,
  type RateLimitType,
  currentLimits,
  quotaRejectedListeners,
  statusListeners,
} from './claudeAiLimits.js'
import { getMainLoopModel } from '../utils/model/model.js'
import { isModelAllowed } from '../utils/model/modelAllowlist.js'
import { stepFamilyAliasToAllowed } from '../utils/model/printSetModel.js'
import {
  enqueue,
  getCommandQueue,
  isQueuedCommandEditable,
  someInFlightDrainCommand,
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
/** densable T0S / HEv rearm cap */
const REARM_CAP = 2
/**
 * densable p4f — min delay after *now* when rearm !== null (JEv).
 * Index by previous consecutiveRearms value passed into $Za/A4f.
 */
const REARM_MIN_DELAY_MS = [60_000, 300_000] as const
/** densable iYm — tick while armed */
export const QUOTA_AUTO_RESUME_TICK_MS = 30_000
/** densable R5w — default sleep-through grace */
export const MARBLE_HERON_GRACE_DEFAULT_MS = 1_800_000
/** densable D5w — min grace */
export const MARBLE_HERON_GRACE_MIN_MS = 60_000
/** densable I5w — max clamp for marble_heron ms values */
export const MARBLE_HERON_MS_MAX = 21_600_000

/** densable hAm bucket for s0v — only main_thread continues the rearm path */
export type QuotaRejectQuerySourceBucket = 'main_thread' | 'other'

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
  /** densable O4f / kxi / xfe — block auto-arm for the handoff window */
  handoffInProgress: boolean
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
    handoffInProgress: false,
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

/**
 * densable yDl(e, t, r=0) — coerce marble_heron ms, clamp to [r, I5w].
 * Non-number/string or non-finite/<0 → fallback t.
 */
export function clampMarbleHeronMs(
  value: unknown,
  fallback: number,
  min = 0,
): number {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(Math.max(Math.round(n), min), MARBLE_HERON_MS_MAX)
}

/** densable kDl grace: yDl(bDl().graceMs, R5w, D5w) */
export function getMarbleHeronGraceMs(): number {
  return clampMarbleHeronMs(
    getMarbleHeronConfig().graceMs,
    MARBLE_HERON_GRACE_DEFAULT_MS,
    MARBLE_HERON_GRACE_MIN_MS,
  )
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

/** densable As / KWe — CLAUDE_CODE_SESSION_KIND === "bg" */
function isQuotaAutoResumeBgSession(): boolean {
  return process.env.CLAUDE_CODE_SESSION_KIND === 'bg'
}

/**
 * densable $Fm / 234 R4f — interactive && not bg.
 * Gold 239: `fD()&&!As()` where fD = launchOptions.isInteractive.
 * Print/SDK (`claude -p`) is non-interactive → cannot offer or arm.
 */
function isQuotaAutoResumeSurfaceEligible(): boolean {
  return !getIsNonInteractiveSession() && !isQuotaAutoResumeBgSession()
}

/**
 * densable 239 QOt — extra auto-arm veto.
 * Gold: `Cx()||As()||Kxn()!==void 0`
 * (replBridgeActive || bg || teammateAgentId).
 * Kxn analog: getAgentId() — same as fableConsent vIt (ALS then
 * dynamicTeamContext). Does not read CLAUDE_CODE_AGENT_ID.
 */
export function isQuotaAutoArmVetoed(): boolean {
  return (
    isReplBridgeActive() ||
    isQuotaAutoResumeBgSession() ||
    getAgentId() !== undefined
  )
}

/** densable Vqn / hvr */
export function isQuotaRejectedForAutoContinue(
  limits: ClaudeAILimits,
): boolean {
  return (
    limits.status === 'rejected' &&
    limits.resetsAt !== undefined &&
    Number.isFinite(limits.resetsAt) &&
    limits.isUsingOverage !== true &&
    limits.overageInUse !== true
  )
}

/** densable Ac()?.billingType !== "usage_based" */
function isNotUsageBasedBilling(): boolean {
  const billing = getOauthAccountInfo()?.billingType
  return billing !== 'usage_based'
}

/** densable r3t / d$t — ls + billing + Vqn + $Fm + Xlo */
export function canOfferQuotaAutoResume(limits: ClaudeAILimits): boolean {
  return (
    isClaudeAISubscriber() &&
    isNotUsageBasedBilling() &&
    isQuotaRejectedForAutoContinue(limits) &&
    isQuotaAutoResumeSurfaceEligible() &&
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
 * RU().some(bxi) || sxa(bxi). sxa = someInFlightDrainCommand.
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
  if (getCommandQueue().some(isQuotaEpisodeOwnedCommand)) return true
  return someInFlightDrainCommand(isQuotaEpisodeOwnedCommand)
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

function computeJitterMs(): number {
  // densable YEv — marble_heron can override; local keeps fixed bounds
  return Math.round(
    JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS),
  )
}

/**
 * densable JEv / F0S.
 * rearm === null → resetsAt*1000 + jitter.
 * rearm !== null → max(that, now + p4f[rearm] ?? last).
 */
function computeFireAtMs(
  resetsAtSeconds: number,
  rearm: number | null,
  nowMs: number,
): number {
  const base = resetsAtSeconds * 1000 + computeJitterMs()
  if (rearm === null) return base
  const minDelay =
    REARM_MIN_DELAY_MS[rearm] ??
    REARM_MIN_DELAY_MS[REARM_MIN_DELAY_MS.length - 1] ??
    0
  return Math.max(base, nowMs + minDelay)
}

/**
 * densable xxi — whether this rate-limit window should participate in rearm /
 * autoArmDedupe bookkeeping for the current main-loop model.
 */
export function isQuotaRearmEligibleRateLimit(
  rateLimitType: RateLimitType | undefined,
  model?: string,
): boolean {
  switch (rateLimitType) {
    case 'five_hour':
    case 'seven_day':
    case 'overage':
      return true
    case 'seven_day_opus': {
      // densable yDe($o(model)) / Wjo(entry, "opus") — eligible when model family is opus
      const m = (model ?? getMainLoopModel()).toLowerCase()
      return m.includes('opus')
    }
    case 'seven_day_sonnet': {
      // densable ZWs($o(model)) / Wjo(entry, "sonnet") — eligible when model family is sonnet
      const m = (model ?? getMainLoopModel()).toLowerCase()
      return m.includes('sonnet')
    }
    case undefined:
      return false
    default:
      // densable also has seven_day_overage_included — local type omits it; fail closed
      return false
  }
}

/** densable L4f / A4f */
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
  episode.activeTurnClaim = null
  episode.sleptThroughReset = false
  episode.lastObservedMs = nowMs
  const fireAtMs = computeFireAtMs(resetsAtSeconds, rearm, nowMs)
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

/**
 * densable $Za — re-arm after a quota reject while the episode still owns a
 * continuation/takeover claim. Emits `rearmed` (and `taken-over` when auto
 * origin flips to dialog).
 */
function rearmQuotaAutoResume(
  resetsAtSeconds: number,
  rearm: number | null,
  origin: EpisodeArmOrigin,
): void {
  if (isQuotaContinuationRevoked()) return
  if (
    episode.episodeArmOrigin === 'auto' &&
    resetsAtSeconds * 1000 - Date.now() > AUTO_CONTINUE_HORIZON_MS
  ) {
    cancelQuotaAutoResume('horizon_exceeded')
    episode.events.emit('horizon-exceeded')
    return
  }
  const flippedAutoToDialog =
    episode.episodeArmOrigin === 'auto' && origin === 'dialog'
  armQuotaAutoResume(resetsAtSeconds, Date.now(), origin, rearm)
  episode.events.emit('rearmed')
  if (flippedAutoToDialog) {
    episode.events.emit('taken-over')
  }
}

/**
 * densable s0v — quotaRejected listener.
 * Rearm only after a main_thread reject while a turn claim is outstanding
 * (continuation path increments consecutiveRearms; takeover resets to 0).
 */
export function onQuotaRejectedForAutoResume(
  limits: ClaudeAILimits,
  querySourceBucket: QuotaRejectQuerySourceBucket,
): void {
  if (!isQuotaRejectedForAutoContinue(limits)) return
  if (!isQuotaAutoResumeSurfaceEligible()) return
  const resetsAt = limits.resetsAt ?? 0
  // Lazy model resolve only for opus/sonnet windows (avoids auth in tests for five_hour)
  const eligible = isQuotaRearmEligibleRateLimit(limits.rateLimitType)

  if (isQuotaAutoResumeLive() && eligible) {
    episode.autoArmDedupeResetKeys.add(resetsAt)
  }

  if (episode.state.phase === 'armed') {
    // Still waiting: if a *later* resetsAt arrives and window is eligible, rearm
    // with null (does not consume consecutiveRearms — densable $Za(..., null, …)).
    if (resetsAt * 1000 > episode.state.fireAtMs && eligible) {
      rearmQuotaAutoResume(resetsAt, null, episode.episodeArmOrigin)
    }
    return
  }

  if (hasPendingQuotaContinuationInQueue()) return
  if (episode.state.phase === 'stale') return

  const claim = episode.activeTurnClaim
  if (claim === null) return
  if (querySourceBucket !== 'main_thread') return

  if (claim.kind === 'takeover') {
    episode.consecutiveRearms = 0
    rearmQuotaAutoResume(
      eligible ? resetsAt : episode.lastArmedResetsAtSeconds,
      null,
      'dialog',
    )
    return
  }

  // continuation claim — densable T0S / HEv cap
  if (episode.consecutiveRearms >= REARM_CAP) {
    logEvent('tengu_quota_auto_resume_cancelled', {
      reason:
        'rearm_cap' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    episode.autoArmDedupeResetKeys.add(resetsAt)
    // densable l8r — drop ownership bookkeeping then idle + cap-exhausted
    resetQuotaEpisodeOwnership()
    setState({ phase: 'idle' })
    episode.events.emit('cap-exhausted')
    return
  }

  const prior = episode.consecutiveRearms
  episode.consecutiveRearms++
  rearmQuotaAutoResume(resetsAt, prior, episode.episodeArmOrigin)
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

/**
 * densable n2r — alias family for X5w escape (not full model id family).
 * opusplan|opusplan[1m] → opus; haiku → sonnet; else null.
 */
export function resolveQuotaAutoArmAliasFamily(
  alias: string | null | undefined,
): 'opus' | 'sonnet' | null {
  if (alias === 'opusplan' || alias === 'opusplan[1m]') return 'opus'
  if (alias === 'haiku') return 'sonnet'
  return null
}

/**
 * densable bZo — allowlist remap after SU alias resolve.
 * Gold: if (e && !Gu(e)) return L4(e) ?? void 0; return e
 * Tip: Gu ≈ isModelAllowed; L4 ≈ stepFamilyAliasToAllowed (family aliases only).
 * Non-family values (opusplan/haiku/full ids) that fail Gu → undefined (L4 null).
 */
export function applyQuotaAutoArmAliasAllowlist(
  alias: string | null | undefined,
): string | null | undefined {
  if (!alias) return alias
  if (isModelAllowed(alias)) return alias
  return stepFamilyAliasToAllowed(alias) ?? undefined
}

/**
 * densable SU — alias setting for n2r (X5w escape only).
 * Order: JA (mainLoopModelOverride) → mae (initialMainLoopModel) →
 * ANTHROPIC_MODEL || settings.model → bZo.
 *
 * Gold body (SEA @ 303273396) uses `!== void 0` for JA/mae. Tip ModelSetting
 * uses null for Default — keep ?? so null falls through (tip hardening).
 */
export function getQuotaAutoArmAliasSetting(): string | null | undefined {
  const raw =
    getMainLoopModelOverride() ??
    getInitialMainLoopModel() ??
    (process.env.ANTHROPIC_MODEL ||
      getSettings_DEPRECATED()?.model ||
      undefined)
  return applyQuotaAutoArmAliasAllowlist(raw)
}

/**
 * densable X0S / X5w — block auto-arm on cross-family week limits.
 * Returns true ⇒ O4f must refuse.
 *
 * Gold: seven_day_opus|sonnet; if yxi(model) → don't block; if n2r(SU())
 * matches window family → don't block; else block.
 */
export function blocksQuotaAutoArmForFamilyWindow(
  rateLimitType: ClaudeAILimits['rateLimitType'],
  model?: string,
): boolean {
  if (
    rateLimitType !== 'seven_day_opus' &&
    rateLimitType !== 'seven_day_sonnet'
  ) {
    return false
  }
  if (isQuotaRearmEligibleRateLimit(rateLimitType, model)) return false
  const aliasFamily = resolveQuotaAutoArmAliasFamily(
    getQuotaAutoArmAliasSetting(),
  )
  if (rateLimitType === 'seven_day_opus' && aliasFamily === 'opus') return false
  if (rateLimitType === 'seven_day_sonnet' && aliasFamily === 'sonnet') {
    return false
  }
  return true
}

/** densable O4f — auto-arm when setting effective */
export function tryAutoArmQuotaAutoResume(
  limits: ClaudeAILimits,
  nowMs: number = Date.now(),
): boolean {
  if (!canOfferQuotaAutoResume(limits)) return false
  // densable O4f/zFm: if(r.handoffInProgress) return !1
  if (episode.handoffInProgress) return false
  // densable zFm: if(QOt()) return !1
  if (isQuotaAutoArmVetoed()) return false
  if (!isAutoContinueAtUsageLimitEffective()) return false
  if (!isAutoArmEnabled()) return false
  const resetsAt = limits.resetsAt ?? 0
  if (resetsAt * 1000 - nowMs > AUTO_CONTINUE_HORIZON_MS) return false
  // densable O4f: if(X0S(e.rateLimitType,Ni())) return !1
  if (
    blocksQuotaAutoArmForFamilyWindow(limits.rateLimitType, getMainLoopModel())
  ) {
    return false
  }
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
  // densable V4f: conversation_reset also drops the kxi latch (even if idle)
  if (reason === 'conversation_reset') {
    episode.handoffInProgress = false
  }
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
 * densable kxi — set handoffInProgress then Axi. Flag stays up until xfe.
 * Returns whether the episode was active (Exi) before cancel.
 */
export function beginQuotaAutoResumeHandoff(reason: CancelReason): boolean {
  episode.handoffInProgress = true
  if (!isQuotaAutoResumeLive()) return false
  const wasActive = isQuotaAutoResumeEpisodeActive()
  cancelQuotaAutoResume(reason)
  return wasActive
}

/** densable xfe — clear the O4f handoff latch */
export function endQuotaAutoResumeHandoff(): void {
  episode.handoffInProgress = false
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
 * densable hSl / KXa — stale wait that is not Jqn-revoked.
 * `_ro` side-effects cancel when killswitch/auto-setting is off.
 */
export function isQuotaWaitStale(): boolean {
  return episode.state.phase === 'stale' && !isQuotaContinuationRevoked()
}

/** densable qvm / j4f — empty-Enter substitute text, or null. */
export function getStaleQuotaWaitPrompt(): string | null {
  return isQuotaWaitStale() ? CONTINUATION_PROMPT : null
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
  // densable qXa: phase!==armed || Jqn — dialog-armed wait survives setting_off
  if (isQuotaContinuationRevoked()) return 'idle'
  const armed = episode.state
  const last = episode.lastObservedMs ?? armed.fireAtMs
  const gap = nowMs - last
  episode.lastObservedMs = nowMs
  // densable kDl: yDl(bDl().graceMs, R5w, D5w); gap > grace && now >= fireAt
  if (gap > getMarbleHeronGraceMs() && nowMs >= armed.fireAtMs) {
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

/** leftover 239 RDl — clear/resume/remote_attach drop the kxi latch. */
export function isQuotaAutoResumeSessionReset(
  reason: SessionSwitchReason | undefined,
): boolean {
  switch (reason) {
    case 'clear':
    case 'resume':
    case 'remote_attach':
      return true
    case 'fork':
    case 'cd':
    case 'spare_claim':
    case 'hydrate':
    case 'startup_custom_id':
      return false
    default:
      return false
  }
}

/** Hook limits → try auto-arm + densable s0v rearm (idempotent) */
export function ensureQuotaAutoResumeLimitsSubscription(): void {
  if (limitsHooked) return
  limitsHooked = true
  refreshAutoContinueKeyPresence()
  statusListeners.add((limits: ClaudeAILimits) => {
    if (limits.status === 'rejected') {
      tryAutoArmQuotaAutoResume(limits)
    }
  })
  // densable yYp → s0v (429 error path only; headers do not emit quotaRejected)
  quotaRejectedListeners.add(onQuotaRejectedForAutoResume)
  // leftover 239 eUm/oU: RDl → g6i('conversation_reset') + kHe
  onSessionSwitch((_id, reason) => {
    if (isQuotaAutoResumeSessionReset(reason)) {
      cancelQuotaAutoResume('conversation_reset')
      episode.handoffInProgress = false
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
