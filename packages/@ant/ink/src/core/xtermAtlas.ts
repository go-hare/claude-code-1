/**
 * densable 2.1.217 xterm.js color-atlas tracking + proactive OSC 104 reset.
 *
 * densable names (approx):
 *   LWu  = ATLAS_RESET_OSC  "\x1b]104;255\x07"
 *   C2u  = trackAtlasKey(charId, styleId)
 *   gfo  = isAtlasTrackingEnabled  (A2u)
 *   RDt  = setAtlasTrackingEnabled
 *   Por  = isAtlasResetEnabled     (T2u)
 *   P2u  = setAtlasResetEnabled
 *   Uds  = isAtlasResetSuppressed  (D2u) — true while render-debug stress
 *   Bds  = setAtlasResetSuppressed
 *   R2u  = isAtlasResetThrottleBypassed (I2u) — debug path
 *   Fds  = setAtlasResetThrottleBypassed
 *   DDt  = getAtlasKeyStats
 *   Lor  = clearAtlasKeys
 *   Wds  = recordAtlasReset(reason)
 *   tiy  = ATLAS_KEY_THRESHOLD (2000)
 *   riy  = ATLAS_RESET_COOLDOWN_MS (2000)
 *   Nty  = ATLAS_KEY_PACK_STRIDE (32768)
 *   $ty  = ATLAS_KEY_HARD_CAP (131072)
 *
 * GrowthBook bootstrap (densable N1f):
 *   tengu_xterm_atlas_reset default true  → Por
 *   tengu_basalt_meadow default false
 *   if either → RDt(true)
 * Defaults match densable so ink works without GB wire-up.
 */

import { InkHostSlot } from './instances.js'

/** densable LWu — OSC 104;255 (reset color index 255 / atlas). BEL-terminated. */
export const ATLAS_RESET_OSC = '\x1b]104;255\x07'

/** densable tiy — proactive delta reset once unique (char,style) keys exceed this. */
export const ATLAS_KEY_THRESHOLD = 2000

/** densable riy — min ms between proactive delta resets (focus path ignores). */
export const ATLAS_RESET_COOLDOWN_MS = 2000

/** densable Nty — pack charId*Nty + styleId into one Set key. */
const ATLAS_KEY_PACK_STRIDE = 32768

/** densable $ty — hard cap; further keys mark saturated and stop tracking. */
const ATLAS_KEY_HARD_CAP = 131072

type AtlasResetReason = 'none' | 'delta' | 'focus' | 'force'

type XtermAtlasHostState = {
  atlasKeys: Set<number>
  atlasKeysSaturated: boolean
  atlasTrackingEnabled: boolean
  atlasResetEnabled: boolean
  atlasResetSuppressed: boolean
  atlasResetThrottleBypassed: boolean
  atlasResetCount: number
  atlasResetLastReason: AtlasResetReason
  atlasResetLastAt: number
}

const xtermAtlasHostSlot = new InkHostSlot<XtermAtlasHostState>(() => ({
  atlasKeys: new Set<number>(),
  atlasKeysSaturated: false,
  atlasTrackingEnabled: true,
  atlasResetEnabled: true,
  atlasResetSuppressed: false,
  atlasResetThrottleBypassed: false,
  atlasResetCount: 0,
  atlasResetLastReason: 'none',
  atlasResetLastAt: 0,
}))

/** densable gfo */
export function isAtlasTrackingEnabled(): boolean {
  return xtermAtlasHostSlot.peek()?.atlasTrackingEnabled ?? true
}

/** densable RDt */
export function setAtlasTrackingEnabled(enabled: boolean): void {
  xtermAtlasHostSlot.of().atlasTrackingEnabled = enabled
}

/** densable Por */
export function isAtlasResetEnabled(): boolean {
  return xtermAtlasHostSlot.peek()?.atlasResetEnabled ?? true
}

/** densable P2u */
export function setAtlasResetEnabled(enabled: boolean): void {
  xtermAtlasHostSlot.of().atlasResetEnabled = enabled
}

/** densable Uds — suppress proactive resets (render-debug stress non-off). */
export function isAtlasResetSuppressed(): boolean {
  return xtermAtlasHostSlot.peek()?.atlasResetSuppressed ?? false
}

/** densable Bds */
export function setAtlasResetSuppressed(suppressed: boolean): void {
  xtermAtlasHostSlot.of().atlasResetSuppressed = suppressed
}

/** densable R2u — when true, delta path skips cooldown. */
export function isAtlasResetThrottleBypassed(): boolean {
  return xtermAtlasHostSlot.peek()?.atlasResetThrottleBypassed ?? false
}

/** densable Fds */
export function setAtlasResetThrottleBypassed(bypassed: boolean): void {
  xtermAtlasHostSlot.of().atlasResetThrottleBypassed = bypassed
}

/**
 * densable C2u — record a unique (charId, styleId) pair written to the screen.
 * charId < 2 is ignored (empty / space intern slots).
 */
export function trackAtlasKey(charId: number, styleId: number): void {
  if (charId < 2) return
  const state = xtermAtlasHostSlot.of()
  if (state.atlasKeys.size >= ATLAS_KEY_HARD_CAP) {
    state.atlasKeysSaturated = true
    return
  }
  state.atlasKeys.add(charId * ATLAS_KEY_PACK_STRIDE + styleId)
}

/** densable DDt */
export function getAtlasKeyStats(): { atlasKeys: number; saturated: boolean } {
  const state = xtermAtlasHostSlot.peek()
  if (!state) return { atlasKeys: 0, saturated: false }
  return {
    atlasKeys: state.atlasKeys.size,
    saturated: state.atlasKeysSaturated,
  }
}

/** densable Lor */
export function clearAtlasKeys(): void {
  const state = xtermAtlasHostSlot.peek()
  if (!state) return
  state.atlasKeys.clear()
  state.atlasKeysSaturated = false
}

/** densable Wds */
export function recordAtlasReset(reason: 'delta' | 'focus' | 'force'): void {
  const state = xtermAtlasHostSlot.of()
  state.atlasResetCount++
  state.atlasResetLastReason = reason
  state.atlasResetLastAt = performance.now()
}

export function getAtlasResetStats(): {
  count: number
  lastReason: AtlasResetReason
  lastResetAt: number
} {
  const state = xtermAtlasHostSlot.peek()
  if (!state) {
    return { count: 0, lastReason: 'none', lastResetAt: 0 }
  }
  return {
    count: state.atlasResetCount,
    lastReason: state.atlasResetLastReason,
    lastResetAt: state.atlasResetLastAt,
  }
}

/**
 * densable N1f-shaped bootstrap.
 * Call from business layer with GrowthBook values when available.
 * Defaults: atlasReset=true, basaltMeadow=false → tracking on.
 */
export function bootstrapXtermAtlas(opts?: {
  xtermAtlasReset?: boolean
  basaltMeadow?: boolean
}): void {
  const atlasReset = opts?.xtermAtlasReset ?? true
  const basaltMeadow = opts?.basaltMeadow ?? false
  setAtlasResetEnabled(atlasReset)
  if (atlasReset || basaltMeadow) {
    setAtlasTrackingEnabled(true)
  }
}

/** Test-only reset of host state. */
export function _resetXtermAtlasForTesting(): void {
  const state = xtermAtlasHostSlot.peek()
  if (!state) return
  state.atlasKeys.clear()
  state.atlasKeysSaturated = false
  state.atlasTrackingEnabled = true
  state.atlasResetEnabled = true
  state.atlasResetSuppressed = false
  state.atlasResetThrottleBypassed = false
  state.atlasResetCount = 0
  state.atlasResetLastReason = 'none'
  state.atlasResetLastAt = 0
}
