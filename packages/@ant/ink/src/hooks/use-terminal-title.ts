import { useContext, useEffect } from 'react'
import stripAnsi from 'strip-ansi'
import { CLEAR_TERMINAL_TITLE, OSC, osc } from '../core/termio/osc.js'
import { TerminalWriteContext } from './useTerminalNotification.js'

type WriteRaw = ((data: string) => void) | null

/** densable 228 #16: static ✳ + busy ◐/◑ title prefixes. */
const TITLE_PREFIX = /^([✳◐◑])\s+/u

/** Delay so WT can observe the plain SetConsoleTitle before the prefixed one. */
const WIN32_TITLE_UNSTICK_MS = 40

type TitleIconFamily = 'idle' | 'busy' | 'none'

function splitTitlePrefix(clean: string): {
  prefix: string | null
  plain: string
} {
  const m = TITLE_PREFIX.exec(clean)
  if (!m) return { prefix: null, plain: clean }
  return { prefix: m[1] ?? null, plain: clean.slice(m[0].length) }
}

function titleIconFamily(prefix: string | null): TitleIconFamily {
  if (prefix === '✳') return 'idle'
  if (prefix === '◐' || prefix === '◑') return 'busy'
  return 'none'
}

/** Last densable icon family written on win32 — avoid plain-poke on ◐↔◑ ticks. */
let lastWin32IconFamily: TitleIconFamily | null = null

/** Bumps to cancel an in-flight delayed unstick write. */
let win32TitleEpoch = 0

/**
 * Apply a cleaned title to the host terminal.
 *
 * densable Ink hook:
 * - win32: `process.title` only (classic conhost / SetConsoleTitle).
 * - elsewhere: OSC 0 (title+icon) via Ink's stdout.
 *
 * No win32 OSC invent (official SEA has none). Windows Terminal can keep a
 * sticky tab glyph across densable idle↔busy prefix flips (✳ ↔ ◐/◑). Same-
 * tick plain+full SetConsoleTitle is coalesced by WT, so unstick writes the
 * plain title then applies the prefixed title after a short delay. Same-
 * family ◐↔◑ ticks skip the poke.
 */
export function applyTerminalTitle(clean: string, writeRaw: WriteRaw): void {
  if (process.platform === 'win32') {
    const { prefix, plain } = splitTitlePrefix(clean)
    const family = titleIconFamily(prefix)
    const needsUnstick =
      family !== 'none' &&
      lastWin32IconFamily !== null &&
      family !== lastWin32IconFamily &&
      plain !== clean

    lastWin32IconFamily = family
    const epoch = ++win32TitleEpoch

    if (needsUnstick) {
      process.title = plain
      setTimeout(() => {
        if (epoch !== win32TitleEpoch) return
        process.title = clean
      }, WIN32_TITLE_UNSTICK_MS)
      return
    }
    process.title = clean
    return
  }
  if (writeRaw) {
    writeRaw(osc(OSC.SET_TITLE_AND_ICON, clean))
  }
}

/**
 * Clear tab/window title. Mirrors densable apply channels.
 */
export function clearTerminalTitle(writeRaw: WriteRaw): void {
  if (process.platform === 'win32') {
    win32TitleEpoch++
    process.title = ''
    lastWin32IconFamily = null
    return
  }
  if (writeRaw) {
    // Always BEL terminator (CLEAR_TERMINAL_TITLE) — safer than osc() on kitty ST.
    writeRaw(CLEAR_TERMINAL_TITLE)
  }
}

/** @internal test helper — reset win32 icon-family latch between cases. */
export function resetWin32TitleIconFamilyForTests(): void {
  win32TitleEpoch++
  lastWin32IconFamily = null
}

/**
 * Declaratively set the terminal tab/window title.
 *
 * Pass a string to set the title. ANSI escape sequences are stripped
 * automatically so callers don't need to know about terminal encoding.
 * Pass `null` to opt out — the hook becomes a no-op and leaves the
 * terminal title untouched.
 */
export function useTerminalTitle(title: string | null): void {
  const writeRaw = useContext(TerminalWriteContext)

  useEffect(() => {
    if (title === null) return
    applyTerminalTitle(stripAnsi(title), writeRaw)
  }, [title, writeRaw])
}
