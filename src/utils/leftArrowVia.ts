/**
 * densable 2.1.239 dtn / CRw / kRw / BWi / xRw — left-arrow via resolver.
 *
 * SEA offsets: kRw@313615922 CRw@313616009 BWi@313616411 dtn@313618865
 */
import { getIsRemoteMode } from '../bootstrap/state.js'
import { isAgentViewDisabled } from './residualUiEnvGates.js'
import { getInitialSettings } from './settings/settings.js'
import { isPersistenceSuppressed } from './sessionPersistenceStatus.js'
import type { LeftArrowInFlight } from './leftArrowConfirm.js'

export type LeftArrowVia =
  | 'idle-fork'
  | 'abort-then-fork'
  | 'defer-then-fork'
  | 'detach'

export type LeftArrowViaBlockReason =
  | 'fleet-disabled'
  | 'remote'
  | 'persistence'
  | 'loading'

export type LeftArrowViaResult =
  | { ok: true; via: LeftArrowVia; inFlight: LeftArrowInFlight }
  | {
      ok: false
      reason: LeftArrowViaBlockReason
      inFlight: LeftArrowInFlight
    }

export type LeftArrowViaInput = {
  isBg: boolean
  isLoading: boolean
  isExternalLoading: boolean
  betweenCalls: boolean
  inFlight: LeftArrowInFlight
  /** Injected by dtn; callers of CRw may override for tests. */
  fleetEnabled?: boolean
  isRemote?: boolean
  persistenceDisabled?: boolean
}

/** densable kRw — via when gates pass. */
export function pickLeftArrowVia(
  isLoading: boolean,
  betweenCalls: boolean,
): Exclude<LeftArrowVia, 'detach'> {
  if (!isLoading) return 'idle-fork'
  return betweenCalls ? 'defer-then-fork' : 'abort-then-fork'
}

/**
 * densable xRw — trailing open assistant (stop_reason === null).
 */
export function hasOpenAssistantWithoutStop(
  messages: ReadonlyArray<{
    type: string
    message?: { stop_reason?: string | null }
  }>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.type === 'assistant') return m.message?.stop_reason === null
    if (m.type === 'user') return false
  }
  return false
}

/**
 * densable `Er.stream.peekStreamingText() !== null`.
 * Empty string is in-stream (thinking / first-token window) — not between-calls.
 */
export function isLeftArrowStreamOpen(raw: string | null | undefined): boolean {
  return raw !== null && raw !== undefined
}

/**
 * densable BWi(msgs, hasStreamText) — between API calls (no live stream +
 * no open assistant). hasStreamText is gold `peek !== null`.
 */
export function isLeftArrowBetweenCalls(
  messages: ReadonlyArray<{
    type: string
    message?: { stop_reason?: string | null }
  }>,
  hasStreamText: boolean,
): boolean {
  return !hasStreamText && !hasOpenAssistantWithoutStop(messages)
}

/** densable z4 — agent/fleet view enabled. */
export function isLeftArrowFleetEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const settingsDisable = getInitialSettings()?.disableAgentView === true
  return !isAgentViewDisabled(env, settingsDisable)
}

/**
 * densable CRw — eligibility + via (does not inject process gates).
 */
export function resolveLeftArrowViaCRw(
  e: LeftArrowViaInput,
): LeftArrowViaResult {
  const inFlight = e.inFlight
  if (e.isBg) return { ok: true, via: 'detach', inFlight }
  if (e.fleetEnabled === false) {
    return { ok: false, reason: 'fleet-disabled', inFlight }
  }
  if (e.isRemote === true) {
    return { ok: false, reason: 'remote', inFlight }
  }
  if (e.persistenceDisabled === true) {
    return { ok: false, reason: 'persistence', inFlight }
  }
  if (e.isExternalLoading) {
    return { ok: false, reason: 'loading', inFlight }
  }
  return {
    ok: true,
    via: pickLeftArrowVia(e.isLoading, e.betweenCalls),
    inFlight,
  }
}

/**
 * densable dtn — CRw with fleet/remote/persistence from process state.
 */
export function resolveLeftArrowVia(
  e: Omit<
    LeftArrowViaInput,
    'fleetEnabled' | 'isRemote' | 'persistenceDisabled'
  > &
    Partial<
      Pick<
        LeftArrowViaInput,
        'fleetEnabled' | 'isRemote' | 'persistenceDisabled'
      >
    >,
): LeftArrowViaResult {
  return resolveLeftArrowViaCRw({
    ...e,
    fleetEnabled: e.fleetEnabled ?? isLeftArrowFleetEnabled(),
    isRemote: e.isRemote ?? getIsRemoteMode(),
    persistenceDisabled: e.persistenceDisabled ?? isPersistenceSuppressed(),
  })
}

/**
 * densable YA rewrite after dtn (SEA @ 326511109):
 * FE.via==="abort-then-fork" && !Ig → "defer-then-fork"
 * Ig = Er.abortController reference — strict nullish, NOT .signal.aborted.
 * Aborted-but-retained AC is still truthy → stays abort-then-fork.
 */
export function rewriteLeftArrowViaForAbortController(
  via: LeftArrowVia,
  abortController: AbortController | null | undefined,
): LeftArrowVia {
  if (via === 'abort-then-fork' && !abortController) return 'defer-then-fork'
  return via
}

/** densable Mu !FE.ok toast (always this copy regardless of reason). */
export const LEFT_ARROW_VIA_BLOCKED_TOAST =
  'Cannot open agents — a foregrounded task is running.'
