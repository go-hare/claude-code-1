/**
 * Official 2.1.210 JediTerm densables (RJc, Tog/CJc/xJc/X9n/kJc).
 * Gold `M1` / `eag` arrow-burst lives on App (`trackAppArrowBurst`), not here.
 * Ported constants: Hog=75, Cog=250, j3i=200.
 */
import type { ParsedInput, ParsedKey } from './parse-keypress.js'

/** Official Hog — bare up/down within this of last wheel is treated as flood. */
export const JEDI_ARROW_FLOOD_GAP_MS = 75
/** Official Cog — wheelup rewritten to wheeldown if last wheeldown within this. */
export const JEDI_WHEEL_FLIP_GAP_MS = 250
/** Official j3i — idle gap that clears lastWheelDownTime / jb flood. */
export const JEDI_WHEEL_IDLE_MS = 200

export type JediTermInputState = {
  lastWheelTime: number
  lastWheelDownTime: number
  /** densable Hmo `r.notified` — emit jediterm-scroll-bug once per state. */
  notified: boolean
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

export function createJediTermInputState(): JediTermInputState {
  return { lastWheelTime: 0, lastWheelDownTime: 0, notified: false }
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
      now - state.lastWheelTime < JEDI_ARROW_FLOOD_GAP_MS
    ) {
      if (!state.notified) {
        state.notified = true
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

/** Test-only reset. */
export function _resetJediTermInputForTesting(): void {
  jediBugConfirmed = false
  jediArrowFloodActive = false
  jediArrowBurstPending = 0
}
