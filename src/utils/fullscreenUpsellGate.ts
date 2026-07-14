/**
 * Official Npf densable — should the fullscreen TUI upsell dialog show?
 *
 * Full dialog + /tui relaunch accept path remains denser; this is the pure gate.
 *
 * Official logic:
 *   if (bs()) return false;                         // non-interactive / demo-like
 *   if (FORCE_FULLSCREEN_UPSELL) return true;
 *   if (zi()) return false;                         // already fullscreen env
 *   if (uU()) return false;                         // tmux -CC etc. (caller injects)
 *   if (settings.tui !== undefined) return false;   // user already chose a renderer
 *   if (!tengu_ochre_hollow GB) return false;
 *   if (fullscreenUpsellSeenCount >= 3) return false;
 *   return true;
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'
import { isForceFullscreenUpsellEnabled } from './residualUiEnvGates.js'
import { isScreenReaderModeEnabled } from './screenReaderGate.js'
import { getSettingsForSource } from './settings/settings.js'

/** Official Ufn — max times the fullscreen upsell may be shown. */
export const FULLSCREEN_UPSELL_MAX_SEEN = 3

export type FullscreenUpsellGateInput = {
  env?: NodeJS.ProcessEnv
  /** Official bs() — non-interactive / demo skip. Default: NODE_ENV=test or IS_DEMO. */
  isNonInteractiveOrDemo?: boolean
  /** Official zi() — already in fullscreen env. Default: isFullscreenEnvEnabled(). */
  isFullscreenAlready?: boolean
  /** Official uU() — hard-disable environments (e.g. tmux -CC). Default false. */
  isHardDisabled?: boolean
  /** User already set settings.tui. Default: read userSettings.tui. */
  hasExplicitTuiSetting?: boolean
  /** GB tengu_ochre_hollow. When unset, reads cached GB (default false). */
  gbOchreHollow?: boolean
  /** Seen count from global config. Default: config.fullscreenUpsellSeenCount. */
  seenCount?: number
}

/**
 * Official Npf — densable pure gate for fullscreen upsell eligibility.
 */
export function shouldShowFullscreenUpsell(
  input?: FullscreenUpsellGateInput,
): boolean {
  const env = input?.env ?? process.env
  const nonInteractive =
    input?.isNonInteractiveOrDemo ??
    (process.env.NODE_ENV === 'test' || isEnvTruthy(env.IS_DEMO))
  if (nonInteractive) return false

  if (isForceFullscreenUpsellEnabled(env)) return true

  const alreadyFs = input?.isFullscreenAlready ?? isFullscreenEnvEnabled()
  if (alreadyFs) return false

  // Official uU() hard-disable includes screen-reader mode.
  const hardDisabled =
    input?.isHardDisabled ?? isScreenReaderModeEnabled({ env })
  if (hardDisabled) return false

  let hasTui = input?.hasExplicitTuiSetting
  if (hasTui === undefined) {
    try {
      // Official settings.tui ("default"|"fullscreen"); may be absent in this fork.
      const settings = getSettingsForSource('userSettings') as
        | { tui?: string }
        | undefined
      hasTui = settings?.tui !== undefined
    } catch {
      hasTui = false
    }
  }
  if (hasTui) return false

  const gb =
    input?.gbOchreHollow ??
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_ochre_hollow', false)
  if (!gb) return false

  const seen =
    input?.seenCount ?? getGlobalConfig().fullscreenUpsellSeenCount ?? 0
  if (seen >= FULLSCREEN_UPSELL_MAX_SEEN) return false

  return true
}

/**
 * Official ckb — mark upsell as fully seen (cap at max) so it won't reappear.
 */
export function markFullscreenUpsellFullySeen(prev: {
  fullscreenUpsellSeenCount?: number
}): { fullscreenUpsellSeenCount: number } {
  const cur = prev.fullscreenUpsellSeenCount ?? 0
  if (cur >= FULLSCREEN_UPSELL_MAX_SEEN) {
    return { fullscreenUpsellSeenCount: cur }
  }
  return { fullscreenUpsellSeenCount: FULLSCREEN_UPSELL_MAX_SEEN }
}

/**
 * Official densable — increment seen count by 1 (capped at max).
 * Soft decline / dismiss without permanent disable may use this.
 */
export function incrementFullscreenUpsellSeen(prev: {
  fullscreenUpsellSeenCount?: number
}): { fullscreenUpsellSeenCount: number } {
  const cur = prev.fullscreenUpsellSeenCount ?? 0
  if (cur >= FULLSCREEN_UPSELL_MAX_SEEN) {
    return { fullscreenUpsellSeenCount: cur }
  }
  return { fullscreenUpsellSeenCount: cur + 1 }
}
