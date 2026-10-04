/**
 * densable 2.1.283 `Wd` / `es` @180782505 — `tengu_violin_wood` GB gate.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   async function Wd(){try{return await Bu("tengu_violin_wood")&&(!n()||await i())}catch{return!1}}
 *   function es(){try{return x("tengu_violin_wood",!1)&&(!n()||l())}catch{return!1}}
 *   n() = CLAUDE_CODE_ENTRYPOINT==="remote_desktop"
 *   i()/l() = Bu/x("tengu_violin_pegbox")
 *
 * `x(flag, false)` twin: getFeatureValue_CACHED_MAY_BE_STALE.
 * `Bu(flag)` twin: checkGate_CACHED_OR_BLOCKING.
 * `SB` @180782560 = `Wd()&&u()` — `u` is `tengu_violin_strad`.
 * `f_n` @202311992 = `Wd()&&Bu("tengu_violin_chinrest")`.
 * `_kr` @181393695 = `x("tengu_violin_bassbar", true) !== false`.
 * `ykr` @181393596 = `x("tengu_eventual_haven", true) !== false`.
 * `S9` @200268182 = `es()&&x("tengu_violin_bridgepin", false)` — rXe repository-trust poll.
 * Do not land amati (iGo/bzn).
 */

import {
  checkGate_CACHED_OR_BLOCKING,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../services/analytics/growthbook.js'

const VIOLIN_WOOD = 'tengu_violin_wood'
const VIOLIN_PEGBOX = 'tengu_violin_pegbox'
const VIOLIN_STRAD = 'tengu_violin_strad'
const VIOLIN_CHINREST = 'tengu_violin_chinrest'
const VIOLIN_BASSBAR = 'tengu_violin_bassbar'
const VIOLIN_HAVEN = 'tengu_eventual_haven'
const VIOLIN_BRIDGEPIN = 'tengu_violin_bridgepin'

function isRemoteDesktopEntrypoint(): boolean {
  return process.env.CLAUDE_CODE_ENTRYPOINT === 'remote_desktop'
}

/** gold `es` @180782505 — sync `x("tengu_violin_wood", false)`. */
export function isViolinWoodEnabledSync(): boolean {
  try {
    return (
      getFeatureValue_CACHED_MAY_BE_STALE(VIOLIN_WOOD, false) &&
      (!isRemoteDesktopEntrypoint() ||
        getFeatureValue_CACHED_MAY_BE_STALE(VIOLIN_PEGBOX, false))
    )
  } catch {
    return false
  }
}

/** gold `Wd` @180782399 — async `Bu("tengu_violin_wood")`. */
export async function isViolinWoodEnabled(): Promise<boolean> {
  try {
    return (
      (await checkGate_CACHED_OR_BLOCKING(VIOLIN_WOOD)) &&
      (!isRemoteDesktopEntrypoint() ||
        (await checkGate_CACHED_OR_BLOCKING(VIOLIN_PEGBOX)))
    )
  } catch {
    return false
  }
}

/** gold `u` @180782279 — `Bu("tengu_violin_strad")`. */
export async function isViolinStradEnabled(): Promise<boolean> {
  try {
    return await checkGate_CACHED_OR_BLOCKING(VIOLIN_STRAD)
  } catch {
    return false
  }
}

/** gold `s` @180782320 — sync strad. */
export function isViolinStradEnabledSync(): boolean {
  try {
    return getFeatureValue_CACHED_MAY_BE_STALE(VIOLIN_STRAD, false)
  } catch {
    return false
  }
}

/** gold `SB` @180782560 — `Wd()&&u()`. */
export async function isSettingsToCloudEnabled(): Promise<boolean> {
  return (await isViolinWoodEnabled()) && (await isViolinStradEnabled())
}

/** gold `Bu("tengu_violin_chinrest")`. */
export async function isViolinChinrestEnabled(): Promise<boolean> {
  try {
    return await checkGate_CACHED_OR_BLOCKING(VIOLIN_CHINREST)
  } catch {
    return false
  }
}

/** gold `f_n` @202311992 — `Wd()&&Bu("tengu_violin_chinrest")`. */
export async function isHostedServeDialogsEnabled(): Promise<boolean> {
  try {
    return (await isViolinWoodEnabled()) && (await isViolinChinrestEnabled())
  } catch {
    return false
  }
}

/** gold `_kr` @181393695 — `x("tengu_violin_bassbar", true) !== false`. */
export function isViolinBassbarEnabledSync(): boolean {
  try {
    return (
      getFeatureValue_CACHED_MAY_BE_STALE(VIOLIN_BASSBAR, true as boolean) !==
      false
    )
  } catch {
    return false
  }
}

/** gold `ykr` @181393596 — `x("tengu_eventual_haven", true) !== false`. */
export function isEventualHavenEnabledSync(): boolean {
  try {
    return (
      getFeatureValue_CACHED_MAY_BE_STALE(VIOLIN_HAVEN, true as boolean) !==
      false
    )
  } catch {
    return false
  }
}

/** gold `o` @200268150 — `x("tengu_violin_bridgepin", false)`. */
export function isViolinBridgepinEnabledSync(): boolean {
  try {
    return getFeatureValue_CACHED_MAY_BE_STALE(VIOLIN_BRIDGEPIN, false)
  } catch {
    return false
  }
}

/** gold `S9` @200268182 — `es()&&o()` for rXe. */
export function isRepositoryTrustPollEnabled(): boolean {
  return isViolinWoodEnabledSync() && isViolinBridgepinEnabledSync()
}
