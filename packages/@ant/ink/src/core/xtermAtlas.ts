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

const atlasKeys = new Set<number>()
let atlasKeysSaturated = false
let atlasTrackingEnabled = true
let atlasResetEnabled = true
let atlasResetSuppressed = false
let atlasResetThrottleBypassed = false
let atlasResetCount = 0
let atlasResetLastReason: 'none' | 'delta' | 'focus' | 'force' = 'none'
let atlasResetLastAt = 0

/** densable gfo */
export function isAtlasTrackingEnabled(): boolean {
  return atlasTrackingEnabled
}

/** densable RDt */
export function setAtlasTrackingEnabled(enabled: boolean): void {
  atlasTrackingEnabled = enabled
}

/** densable Por */
export function isAtlasResetEnabled(): boolean {
  return atlasResetEnabled
}

/** densable P2u */
export function setAtlasResetEnabled(enabled: boolean): void {
  atlasResetEnabled = enabled
}

/** densable Uds — suppress proactive resets (render-debug stress non-off). */
export function isAtlasResetSuppressed(): boolean {
  return atlasResetSuppressed
}

/** densable Bds */
export function setAtlasResetSuppressed(suppressed: boolean): void {
  atlasResetSuppressed = suppressed
}

/** densable R2u — when true, delta path skips cooldown. */
export function isAtlasResetThrottleBypassed(): boolean {
  return atlasResetThrottleBypassed
}

/** densable Fds */
export function setAtlasResetThrottleBypassed(bypassed: boolean): void {
  atlasResetThrottleBypassed = bypassed
}

/**
 * densable C2u — record a unique (charId, styleId) pair written to the screen.
 * charId < 2 is ignored (empty / space intern slots).
 */
export function trackAtlasKey(charId: number, styleId: number): void {
  if (charId < 2) return
  if (atlasKeys.size >= ATLAS_KEY_HARD_CAP) {
    atlasKeysSaturated = true
    return
  }
  atlasKeys.add(charId * ATLAS_KEY_PACK_STRIDE + styleId)
}

/** densable DDt */
export function getAtlasKeyStats(): { atlasKeys: number; saturated: boolean } {
  return { atlasKeys: atlasKeys.size, saturated: atlasKeysSaturated }
}

/** densable Lor */
export function clearAtlasKeys(): void {
  atlasKeys.clear()
  atlasKeysSaturated = false
}

/** densable Wds */
export function recordAtlasReset(reason: 'delta' | 'focus' | 'force'): void {
  atlasResetCount++
  atlasResetLastReason = reason
  atlasResetLastAt = performance.now()
}

export function getAtlasResetStats(): {
  count: number
  lastReason: typeof atlasResetLastReason
  lastResetAt: number
} {
  return {
    count: atlasResetCount,
    lastReason: atlasResetLastReason,
    lastResetAt: atlasResetLastAt,
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

/** Test-only reset of module state. */
export function _resetXtermAtlasForTesting(): void {
  atlasKeys.clear()
  atlasKeysSaturated = false
  atlasTrackingEnabled = true
  atlasResetEnabled = true
  atlasResetSuppressed = false
  atlasResetThrottleBypassed = false
  atlasResetCount = 0
  atlasResetLastReason = 'none'
  atlasResetLastAt = 0
}
