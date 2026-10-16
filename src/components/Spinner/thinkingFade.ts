import { STALL_AFTER_MS, STALL_FADE_MS } from './useStalledAnimation.js'

/** densable no — Yn/Jn/Qn/Zn. */
export const THINKING_STILL_MS = 10_000
export const THINKING_MORE_MS = 20_000
export const THINKING_SOME_MORE_MS = 30_000
export const THINKING_DEEP_MS = 45_000

/** densable no(l) — progressive thinking verb after burst wall-clock. */
export function progressiveThinkingLabel(thinkingMs: number): string {
  if (thinkingMs >= THINKING_DEEP_MS) return 'deep in thought'
  if (thinkingMs >= THINKING_SOME_MORE_MS) return 'thinking some more'
  if (thinkingMs >= THINKING_MORE_MS) return 'thinking more'
  if (thinkingMs >= THINKING_STILL_MS) return 'still thinking'
  return 'thinking'
}

/**
 * densable ze — after 10s of a thinking burst, fade 10s toward theme warning.
 * Wall-clock vs thinkingBurstStart (Date.now), not the animation tick.
 */
export function thinkingFadeIntensity(
  now: number,
  thinkingBurstStart: number | null,
  isThinking: boolean,
  hasActiveTools: boolean,
): number {
  if (hasActiveTools) return 0
  if (!isThinking || thinkingBurstStart === null) return 0
  const elapsed = now - thinkingBurstStart
  return Math.min(Math.max((elapsed - STALL_AFTER_MS) / STALL_FADE_MS, 0), 1)
}
