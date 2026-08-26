/**
 * Official V1y densable — should the fullscreen TUI upsell dialog show?
 *
 * Full dialog + /tui relaunch accept path remains denser; this is the pure gate.
 *
 * Official V1y (2.1.239):
 *   if (As()) return false;                         // non-interactive / demo-like
 *   if (FORCE_FULLSCREEN_UPSELL) return true;
 *   if (Vs()) return false;                         // already fullscreen env
 *   if (CU()) return false;                         // screen-reader
 *   if (settings.tui !== undefined) return false;
 *   if ((seen ?? 0) >= M4r=3) return false;
 *   return true;
 *
 * Official V1y has NO tengu_ochre_hollow — that GB excluded Bedrock/Vertex/Foundry.
 * Unidentified official extras not invented: Jl / aj / D4r trial / jli(OQ) /
 * Nhp GB-fallback / Jpe / Vfs sticky-off.
 */

import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'
import { isForceFullscreenUpsellEnabled } from './residualUiEnvGates.js'
import { isScreenReaderModeEnabled } from './screenReaderGate.js'
import { getSettingsForSource } from './settings/settings.js'

/** Official M4r — max times the fullscreen upsell may be shown. */
export const FULLSCREEN_UPSELL_MAX_SEEN = 3

/** Official Mhp.upsellImpression — one increment per process. */
let upsellImpression: number | undefined

export type FullscreenUpsellGateInput = {
  env?: NodeJS.ProcessEnv
  /** Official As() — non-interactive / demo skip. Default: NODE_ENV=test or IS_DEMO. */
  isNonInteractiveOrDemo?: boolean
  /** Official Vs() — already in fullscreen env. Default: isFullscreenEnvEnabled(). */
  isFullscreenAlready?: boolean
  /** Official CU() — hard-disable environments (e.g. screen-reader). Default false. */
  isHardDisabled?: boolean
  /** User already set settings.tui. Default: read userSettings.tui. */
  hasExplicitTuiSetting?: boolean
  /** Seen count from global config. Default: config.fullscreenUpsellSeenCount. */
  seenCount?: number
}

/**
 * Official V1y — densable pure gate for fullscreen upsell eligibility.
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
