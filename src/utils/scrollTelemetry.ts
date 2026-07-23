/**
 * Fullscreen scroll telemetry (official densable lPc / V5n / z5n / wLi / p2r /
 * ALi / cPc / uPc / DTo from 2.1.210).
 *
 * Session-scoped counters are flushed once at graceful shutdown as
 * `tengu_scroll_summary` when interactive and any counter is non-zero.
 *
 * Keep this module free of React / Ink so keybinding handlers and shutdown
 * can share the same process-global store without import cycles.
 */

import { getIsInteractive } from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'

export type ScrollTelemetry = {
  scrolls: number
  pageJumps: number
  jumpToBottomClicks: number
  reachedScrollbackCap: boolean
  scrolledUpMs: number
  unpinnedSince: number | null
}

export type ScrollTelemetrySummary = {
  scrolls: number
  scroll_up_seconds: number
  jump_to_bottom_clicks: number
  page_jumps: number
  reached_scrollback_cap: boolean
}

function createEmptyTelemetry(): ScrollTelemetry {
  return {
    scrolls: 0,
    pageJumps: 0,
    jumpToBottomClicks: 0,
    reachedScrollbackCap: false,
    scrolledUpMs: 0,
    unpinnedSince: null,
  }
}

/** Process-global store (official Vvt densable). */
const telemetry: ScrollTelemetry = createEmptyTelemetry()

/** @internal test helper — reset counters between tests. */
export function resetScrollTelemetryForTesting(
  store: ScrollTelemetry = telemetry,
): void {
  Object.assign(store, createEmptyTelemetry())
}

/** @internal test helper — inspect live counters. */
export function getScrollTelemetryForTesting(
  store: ScrollTelemetry = telemetry,
): ScrollTelemetry {
  return store
}

/** Official V5n — wheel / line scroll event. */
export function recordScroll(store: ScrollTelemetry = telemetry): void {
  store.scrolls++
}

/** Official z5n — page / half-page jump. */
export function recordPageJump(store: ScrollTelemetry = telemetry): void {
  store.pageJumps++
}

/** Official wLi — NewMessagesPill click (jump to bottom). */
export function recordJumpToBottomClick(
  store: ScrollTelemetry = telemetry,
): void {
  store.jumpToBottomClicks++
}

/** Official p2r — user hit the top of scrollback. */
export function recordReachedScrollbackCap(
  store: ScrollTelemetry = telemetry,
): void {
  store.reachedScrollbackCap = true
}

/**
 * Official ALi — track how long the user stays unpinned from sticky bottom.
 * sticky=true stops the clock (and accrues elapsed); sticky=false starts it.
 */
export function recordStickyState(
  sticky: boolean,
  now: number = Date.now(),
  store: ScrollTelemetry = telemetry,
): void {
  if (sticky) {
    if (store.unpinnedSince !== null) {
      store.scrolledUpMs += Math.max(0, now - store.unpinnedSince)
      store.unpinnedSince = null
    }
  } else if (store.unpinnedSince === null) {
    store.unpinnedSince = now
  }
}

/**
 * Official cPc — snapshot + reset. Call once at session end so the summary
 * is not double-emitted if shutdown retries.
 */
export function takeScrollTelemetrySummary(
  now: number = Date.now(),
  store: ScrollTelemetry = telemetry,
): ScrollTelemetrySummary {
  let scrolledUpMs = store.scrolledUpMs
  if (store.unpinnedSince !== null) {
    scrolledUpMs += Math.max(0, now - store.unpinnedSince)
  }
  const summary: ScrollTelemetrySummary = {
    scrolls: store.scrolls,
    scroll_up_seconds: Math.round(scrolledUpMs / 1000),
    jump_to_bottom_clicks: store.jumpToBottomClicks,
    page_jumps: store.pageJumps,
    reached_scrollback_cap: store.reachedScrollbackCap,
  }
  Object.assign(store, createEmptyTelemetry())
  return summary
}

/** Official uPc — any activity worth emitting? */
export function hasScrollTelemetry(
  store: ScrollTelemetry = telemetry,
): boolean {
  return (
    store.scrolls > 0 ||
    store.pageJumps > 0 ||
    store.jumpToBottomClicks > 0 ||
    store.reachedScrollbackCap ||
    store.scrolledUpMs > 0 ||
    store.unpinnedSince !== null
  )
}

/**
 * Official DTo — emit tengu_scroll_summary on interactive exit when anything
 * was recorded. Best-effort; never throws into the shutdown path.
 */
export function emitScrollTelemetrySummary(): void {
  try {
    if (!getIsInteractive() || !hasScrollTelemetry()) return
    logEvent('tengu_scroll_summary', {
      ...takeScrollTelemetrySummary(),
      fullscreen: isFullscreenEnvEnabled(),
    })
  } catch {
    // Ignore telemetry errors during shutdown.
  }
}
