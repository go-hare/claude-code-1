/**
 * Official 2.1.210 JediTerm / arrow-burst densables (RJc, Tog/CJc/xJc/X9n/kJc,
 * eag arrow-burst window). Ported from native-binary constants:
 *   Hog=75, Cog=250, j3i=200, Qsg=100, Zsg=8
 */
import type { ParsedInput, ParsedKey } from './parse-keypress.js'

/** Official Hog — bare up/down within this of last wheel is treated as flood. */
export const JEDI_ARROW_FLOOD_GAP_MS = 75
/** Official Cog — wheelup rewritten to wheeldown if last wheeldown within this. */
export const JEDI_WHEEL_FLIP_GAP_MS = 250
/** Official j3i — idle gap that clears lastWheelDownTime / jb flood. */
export const JEDI_WHEEL_IDLE_MS = 200
/** Official Qsg — arrow-burst sliding window ms. */
export const ARROW_BURST_WINDOW_MS = 100
/** Official Zsg — arrow count in window that fires arrow-burst. */
export const ARROW_BURST_THRESHOLD = 8

export type JediTermInputState = {
  lastWheelTime: number
  lastWheelDownTime: number
}

export type ArrowBurstWindow = {
  dir: string | null
  entries: Array<{ t: number; n: number }>
}

/** Official TERMINAL_EMULATOR === JetBrains-JediTerm. */
export function isJediTermEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
}

/**
 * Official X9n densable — JetBrains terminal command-blocks env, or sticky
 * after first detection during arrow-flood rewrite.
 */
let jediBugConfirmed = false
/** Official B3i / kJc — arrow-flood active (wheel-as-arrows in progress). */
let jediArrowFloodActive = false
/** Official Y9n — pending burst count consumed by FSp jb path. */
let jediArrowBurstPending = 0
/** Official HJc — emit jediterm-scroll-bug once. */
let jediScrollBugEmitted = false

export function createJediTermInputState(): JediTermInputState {
  return { lastWheelTime: 0, lastWheelDownTime: 0 }
}

export function createArrowBurstWindow(): ArrowBurstWindow {
  return { dir: null, entries: [] }
}

/** Official Tog densable. */
export function noteJediTermArrowFlood(): void {
  jediBugConfirmed = true
  jediArrowFloodActive = true
  jediArrowBurstPending++
}

/** Official CJc densable. */
export function clearJediTermArrowFlood(): void {
  jediArrowFloodActive = false
  jediArrowBurstPending = 0
}

/** Official xJc densable — drain and zero pending burst count. */
export function consumeJediTermArrowBurstCount(): number {
  const n = jediArrowBurstPending
  jediArrowBurstPending = 0
  return n
}

/** Official X9n densable. */
export function isJediTermBugConfirmed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (jediBugConfirmed) return true
  if (
    env.INTELLIJ_TERMINAL_COMMAND_BLOCKS_REWORKED !== undefined ||
    env.INTELLIJ_TERMINAL_COMMAND_BLOCKS !== undefined
  ) {
    jediBugConfirmed = true
    return true
  }
  return false
}

/** Official kJc densable. */
export function isJediTermArrowFloodActive(): boolean {
  return jediArrowFloodActive
}

/**
 * Official RJc densable — rewrite JediTerm wheel/arrow floods.
 * @param onScrollBug first time bare arrows are dropped near a wheel event.
 */
export function rewriteJediTermInput(
  state: JediTermInputState,
  items: ParsedInput[],
  now: number,
  onScrollBug?: () => void,
  env: NodeJS.ProcessEnv = process.env,
): ParsedInput[] {
  if (!isJediTermEnv(env)) {
    clearJediTermArrowFlood()
    return items
  }

  let out: ParsedInput[] | null = null
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.kind !== 'key') {
      out?.push(item)
      continue
    }
    const key = item as ParsedKey
    if (key.name === 'wheelup' || key.name === 'wheeldown') {
      if (now - state.lastWheelTime > JEDI_WHEEL_IDLE_MS) {
        state.lastWheelDownTime = 0
        clearJediTermArrowFlood()
      }
      state.lastWheelTime = now
      if (key.name === 'wheeldown') state.lastWheelDownTime = now
      // Official: wheelup shortly after wheeldown while bug confirmed → flip to wheeldown
      if (
        key.name === 'wheelup' &&
        now - state.lastWheelDownTime < JEDI_WHEEL_FLIP_GAP_MS &&
        isJediTermBugConfirmed(env)
      ) {
        out ??= items.slice(0, i)
        out.push({ ...key, name: 'wheeldown' })
        continue
      }
      out?.push(item)
      continue
    }
    // Bare up/down within Hog of last wheel → drop + flood note
    if (
      (key.name === 'up' || key.name === 'down') &&
      !key.ctrl &&
      !key.meta &&
      !key.shift &&
      !key.isPasted &&
      now - state.lastWheelTime < JEDI_ARROW_FLOOD_GAP_MS
    ) {
      if (!jediScrollBugEmitted) {
        jediScrollBugEmitted = true
        onScrollBug?.()
      }
      noteJediTermArrowFlood()
      out ??= items.slice(0, i)
      continue
    }
    out?.push(item)
  }
  return out ?? items
}

/**
 * Official eag densable — sliding window of bare same-dir arrows; when
 * count ≥ 8 within 100ms emit arrow-burst payload.
 * Returns payload to emit, or null.
 */
export function trackArrowBurst(
  window: ArrowBurstWindow,
  items: ParsedInput[],
  now: number = performance.now(),
): { direction: string; count: number } | null {
  const first = items[0]
  if (
    !first ||
    first.kind !== 'key' ||
    (first.name !== 'up' && first.name !== 'down') ||
    first.ctrl ||
    first.meta ||
    first.shift ||
    first.isPasted ||
    !items.every(
      s =>
        s.kind === 'key' &&
        s.name === first.name &&
        !s.ctrl &&
        !s.meta &&
        !s.shift,
    )
  ) {
    window.entries.length = 0
    return null
  }
  if (window.dir !== first.name) {
    window.entries.length = 0
    window.dir = first.name
  }
  window.entries.push({ t: now, n: items.length })
  while (
    window.entries.length > 0 &&
    now - window.entries[0]!.t > ARROW_BURST_WINDOW_MS
  ) {
    window.entries.shift()
  }
  let count = 0
  for (const e of window.entries) count += e.n
  if (count >= ARROW_BURST_THRESHOLD) {
    window.entries.length = 0
    return { direction: first.name!, count }
  }
  return null
}

/** Test-only reset. */
export function _resetJediTermInputForTesting(): void {
  jediBugConfirmed = false
  jediArrowFloodActive = false
  jediArrowBurstPending = 0
  jediScrollBugEmitted = false
}
