/**
 * Official tae densable — should the fullscreen TUI upsell dialog show?
 *
 * Full dialog + /tui relaunch accept path remains denser; this is the pure gate.
 *
 * Official tae @202592078 (2.1.248; V1y lineage from 2.1.239):
 *   if (_t()) return false;                         // bg session
 *   if (On()) return false;                         // remote workspace
 *   if (hg()!==null) return false;                  // bg takeover
 *   if (FORCE_FULLSCREEN_UPSELL) return true;
 *   if (Lt()) return false;                         // already fullscreen env
 *   if (Om()) return false;                         // screen-reader
 *   if (qe().tui !== undefined) return false;
 *   if (GHe()==="fullscreen") return false;         // latched mode
 *   if (uft($T())) return false;                    // auto-off reasons
 *   if (gqn()) return false;                        // GB fallback — thin
 *   if (GC()) return false;                         // #w forkRestricted — NOT Yk/#l
 *   if ((seen ?? 0) >= VHe=3) return false;
 *   if (mwt()) return false;                        // sticky auto-disable VERSION
 *   return true;
 *
 * Leftover As() non-interactive stays ahead of the official arms (test/demo).
 * gqn: no leftover `gbGateSource==="fallback"` host — injectable, default false.
 */

import { getGlobalConfig } from './config.js'
import { isBgSession } from './concurrentSessions.js'
import { isEnvTruthy } from './envUtils.js'
import { getForkRestrictedLaunchConfig } from './forkReplayLaunchConfig.js'
import {
  fullscreenModeForGateReason,
  getFullscreenGateReason,
  isFullscreenEnvEnabled,
  isFullscreenStickyAutoDisabled,
  type FullscreenGateReason,
} from './fullscreen.js'
import { isForceFullscreenUpsellEnabled } from './residualUiEnvGates.js'
import { isScreenReaderModeEnabled } from './screenReaderGate.js'
import { getSettingsForSource } from './settings/settings.js'

/** Official M4r / VHe — max times the fullscreen upsell may be shown. */
export const FULLSCREEN_UPSELL_MAX_SEEN = 3

/** Official Mhp.upsellImpression — one increment per process. */
let upsellImpression: number | undefined

/**
 * Official uft($T()) — auto-off gate reasons that suppress the upsell.
 * Gold @180808173: env_off | sr_auto_off | tmux_cc_auto_off | win_ssh_auto_off.
 */
export function isFullscreenUpsellAutoOffReason(
  reason: FullscreenGateReason | string,
): boolean {
  return (
    reason === 'env_off' ||
    reason === 'sr_auto_off' ||
    reason === 'tmux_cc_auto_off' ||
    reason === 'win_ssh_auto_off'
  )
}

export type FullscreenUpsellGateInput = {
  env?: NodeJS.ProcessEnv
  /** Official As() — non-interactive / demo skip. Default: NODE_ENV=test or IS_DEMO. */
  isNonInteractiveOrDemo?: boolean
  /** Official _t() — bg session. Default: isBgSession(). */
  isBgSession?: boolean
  /** Official On() — surfaceCapabilities.workspace==="remote". Default: getIsRemoteMode(). */
  isRemoteWorkspace?: boolean
  /** Official hg()!==null — bg takeover. Default: getBgJobTakeover()!=null. */
  hasBgTakeover?: boolean
  /** Official Vs() / Lt() — already in fullscreen env. Default: isFullscreenEnvEnabled(). */
  isFullscreenAlready?: boolean
  /** Official CU() / Om() — hard-disable environments (e.g. screen-reader). Default false. */
  isHardDisabled?: boolean
  /** User already set settings.tui. Default: read userSettings.tui. */
  hasExplicitTuiSetting?: boolean
  /**
   * Official GHe()==="fullscreen" — latched renderer mode.
   * Default: fullscreenModeForGateReason(getFullscreenGateReason())==="fullscreen".
   */
  isLatchedFullscreen?: boolean
  /**
   * Official uft($T()) — auto-off reason. Default: isFullscreenUpsellAutoOffReason(getFullscreenGateReason()).
   */
  isAutoOffGateReason?: boolean
  /**
   * Official gqn() — JN() && gbGateSource==="fallback".
   * No leftover host for gbGateSource; default false (inject in tests).
   */
  isGrowthBookFallback?: boolean
  /**
   * Official GC() @178553257 — Ie.#w forkRestrictedLaunchConfig.
   * Default: getForkRestrictedLaunchConfig(). Not Yk / restrictedSession (#l).
   */
  isForkRestrictedLaunchConfig?: boolean
  /** Seen count from global config. Default: config.fullscreenUpsellSeenCount. */
  seenCount?: number
  /** Official mwt() — sticky auto-disable for current VERSION. Default: isFullscreenStickyAutoDisabled(). */
  isStickyAutoDisabled?: boolean
}

function defaultHasBgTakeover(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBgJobTakeover } =
      require('./sessionNameJobSidecar.js') as typeof import('./sessionNameJobSidecar.js')
    return getBgJobTakeover() !== null
  } catch {
    return false
  }
}

function defaultIsRemoteWorkspace(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getIsRemoteMode } =
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    return getIsRemoteMode()
  } catch {
    return false
  }
}

/**
 * Official tae — densable pure gate for fullscreen upsell eligibility.
 */
export function shouldShowFullscreenUpsell(
  input?: FullscreenUpsellGateInput,
): boolean {
  const env = input?.env ?? process.env
  // Leftover As() — ahead of official arms (test / demo).
  const nonInteractive =
    input?.isNonInteractiveOrDemo ??
    (process.env.NODE_ENV === 'test' || isEnvTruthy(env.IS_DEMO))
  if (nonInteractive) return false

  // official: if(_t())return!1
  const bg = input?.isBgSession ?? isBgSession()
  if (bg) return false

  // official: if(On())return!1
  const remote = input?.isRemoteWorkspace ?? defaultIsRemoteWorkspace()
  if (remote) return false

  // official: if(hg()!==null)return!1
  const takeover = input?.hasBgTakeover ?? defaultHasBgTakeover()
  if (takeover) return false

  // official: FORCE → true (after bg/remote/takeover; before Lt)
  if (isForceFullscreenUpsellEnabled(env)) return true

  const alreadyFs = input?.isFullscreenAlready ?? isFullscreenEnvEnabled()
  if (alreadyFs) return false

  // Official Om() hard-disable includes screen-reader mode.
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

  // official: if(GHe()==="fullscreen")return!1
  let latchedFs = input?.isLatchedFullscreen
  if (latchedFs === undefined) {
    try {
      latchedFs =
        fullscreenModeForGateReason(getFullscreenGateReason()) === 'fullscreen'
    } catch {
      latchedFs = false
    }
  }
  if (latchedFs) return false

  // official: if(uft($T()))return!1
  let autoOff = input?.isAutoOffGateReason
  if (autoOff === undefined) {
    try {
      autoOff = isFullscreenUpsellAutoOffReason(getFullscreenGateReason())
    } catch {
      autoOff = false
    }
  }
  if (autoOff) return false

  // official: if(gqn())return!1 — thin (no leftover gbGateSource host)
  if (input?.isGrowthBookFallback === true) return false

  // official tae: if(GC())return!1 — #w only; do not gate on Yk/#l
  const forkRestricted =
    input?.isForkRestrictedLaunchConfig ?? getForkRestrictedLaunchConfig()
  if (forkRestricted) return false

  const seen =
    input?.seenCount ?? getGlobalConfig().fullscreenUpsellSeenCount ?? 0
  if (seen >= FULLSCREEN_UPSELL_MAX_SEEN) return false

  // official: if(mwt())return!1
  const sticky = input?.isStickyAutoDisabled ?? isFullscreenStickyAutoDisabled()
  if (sticky) return false

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

/**
 * Official udc / Zng — count a dialog impression once per process.
 * Unanswered prompts still increment so the offer stops after M4r=3 launches.
 */
export function recordFullscreenUpsellImpression(prev: {
  fullscreenUpsellSeenCount?: number
}): { fullscreenUpsellSeenCount: number } {
  if (upsellImpression !== undefined) {
    return {
      fullscreenUpsellSeenCount:
        prev.fullscreenUpsellSeenCount ?? upsellImpression,
    }
  }
  const cur = prev.fullscreenUpsellSeenCount ?? 0
  const next = Math.min(cur + 1, FULLSCREEN_UPSELL_MAX_SEEN)
  upsellImpression = next
  if (cur >= next) {
    return { fullscreenUpsellSeenCount: cur }
  }
  return { fullscreenUpsellSeenCount: next }
}

/** Test-only: clear official Mhp.upsellImpression latch. */
export function _resetFullscreenUpsellImpressionForTesting(): void {
  upsellImpression = undefined
}
