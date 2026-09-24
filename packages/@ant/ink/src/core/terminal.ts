import { coerce, gte } from 'semver'
import type { Writable } from 'stream'
import {
  eraseViewportInPlace,
  getClearTerminalSequence,
} from './clearTerminal.js'
import type { Diff } from './frame.js'
import { isJediTermEnv } from './jediTermInput.js'
import { cursorMove, cursorTo, eraseLines } from './termio/csi.js'
import { BSU, ESU, HIDE_CURSOR, SHOW_CURSOR } from './termio/dec.js'
import { attacherCaps, link } from './termio/osc.js'

export type Progress = {
  state: 'running' | 'completed' | 'error' | 'indeterminate'
  percentage?: number
}

/**
 * Checks if the terminal supports OSC 9;4 progress reporting.
 * Supported terminals:
 * - ConEmu (Windows) - all versions
 * - Ghostty 1.2.0+
 * - iTerm2 3.6.6+
 *
 * Note: Windows Terminal interprets OSC 9;4 as notifications, not progress.
 */
export function isProgressReportingAvailable(): boolean {
  // Only available if we have a TTY (not piped)
  if (!process.stdout.isTTY) {
    return false
  }

  // Explicitly exclude Windows Terminal, which interprets OSC 9;4 as
  // notifications rather than progress indicators
  if (process.env.WT_SESSION) {
    return false
  }

  // ConEmu supports OSC 9;4 for progress (all versions)
  if (
    process.env.ConEmuANSI ||
    process.env.ConEmuPID ||
    process.env.ConEmuTask
  ) {
    return true
  }

  const version = coerce(process.env.TERM_PROGRAM_VERSION)
  if (!version) {
    return false
  }

  // Ghostty 1.2.0+ supports OSC 9;4 for progress
  // https://ghostty.org/docs/install/release-notes/1-2-0
  if (process.env.TERM_PROGRAM === 'ghostty') {
    return gte(version.version, '1.2.0')
  }

  // iTerm2 3.6.6+ supports OSC 9;4 for progress
  // https://iterm2.com/downloads.html
  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    return gte(version.version, '3.6.6')
  }

  return false
}

/**
 * densable DI — DEC 2026 support.
 *
 * Gold 251: daemon → Al()?.syncOutput!==!1; TMUX → probed ===!0;
 * FORCE → true; known TERM_PROGRAM / kitty / foot / WT / VTE / Konsole;
 * then dT().synchronizedOutputSupported.
 */
function heuristicSynchronizedOutputSupported(): boolean {
  const force = process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT
  if (force === '1' || force === 'true' || force === 'yes' || force === 'on') {
    return true
  }

  const termProgram = process.env.TERM_PROGRAM
  const term = process.env.TERM

  if (
    termProgram === 'iTerm.app' ||
    termProgram === 'WezTerm' ||
    termProgram === 'WarpTerminal' ||
    termProgram === 'ghostty' ||
    termProgram === 'contour' ||
    termProgram === 'vscode' ||
    termProgram === 'alacritty' ||
    termProgram === 'mintty' ||
    termProgram === 'rio' ||
    termProgram === 'Tabby'
  ) {
    return true
  }

  if (isJediTermEnv()) return true

  const konsoleVersion = process.env.KONSOLE_VERSION
  if (konsoleVersion) {
    const version = parseInt(konsoleVersion, 10)
    if (!Number.isNaN(version) && version >= 211200) return true
  }

  if (term?.includes('kitty') || process.env.KITTY_WINDOW_ID) return true
  if (term === 'xterm-ghostty') return true
  if (term?.startsWith('foot')) return true
  if (term?.includes('alacritty')) return true
  if (process.env.ZED_TERM) return true
  if (process.env.WT_SESSION) return true

  const vteVersion = process.env.VTE_VERSION
  if (vteVersion) {
    const version = parseInt(vteVersion, 10)
    if (version >= 6800) return true
  }

  if (probedSynchronizedOutputSupported) return true
  return false
}

/**
 * densable lWn / DI.
 * tmux: wait for DECRQM probe (undefined → skip / false).
 * daemon: attacher caps.syncOutput !== false.
 */
export function isSynchronizedOutputSupported(): boolean {
  if (process.env.CLAUDE_BG_BACKEND === 'daemon') {
    return attacherCaps()?.syncOutput !== false
  }
  if (process.env.TMUX) {
    if (probedSynchronizedOutputSupported === undefined) return false
    return probedSynchronizedOutputSupported === true
  }
  return heuristicSynchronizedOutputSupported()
}

// -- XTVERSION-detected terminal name (populated async at startup) --
//
// TERM_PROGRAM is not forwarded over SSH by default, so env-based detection
// fails when claude runs remotely inside a VS Code integrated terminal.
// XTVERSION (CSI > 0 q → DCS > | name ST) goes through the pty — the query
// reaches the *client* terminal and the reply comes back through stdin.
// App.tsx fires the query when raw mode enables; setXtversionName() is called
// from the response handler. Readers should treat undefined as "not yet known"
// and fall back to env-var detection.

let xtversionName: string | undefined
/** densable dT().synchronizedOutputSupported — DECRQM(2026) probe result. */
let probedSynchronizedOutputSupported: boolean | undefined

/** densable nWn — overwrite XTVERSION name (daemon re-probe after attach). */
export function setXtversionName(name: string): void {
  xtversionName = name
}

/** densable aWn — record DECRQM(2026) status. */
export function setSynchronizedOutputSupported(supported: boolean): void {
  probedSynchronizedOutputSupported = supported
}

export function resetTerminalProbeForTests(): void {
  xtversionName = undefined
  probedSynchronizedOutputSupported = undefined
}

/** Official c4r densable — raw XTVERSION name, or undefined if not yet known. */
export function getXtversionName(): string | undefined {
  return xtversionName
}

/** True if running in an xterm.js-based terminal (VS Code, Cursor, Windsurf
 *  integrated terminals). Combines TERM_PROGRAM env check (fast, sync, but
 *  not forwarded over SSH) with the XTVERSION probe result (async, survives
 *  SSH — query/reply goes through the pty). Early calls may miss the probe
 *  reply — call lazily (e.g. in an event handler) if SSH detection matters. */
export function isXtermJs(): boolean {
  if (process.env.TERM_PROGRAM === 'vscode') return true
  return xtversionName?.startsWith('xterm.js') ?? false
}

/** densable `ME` / `Ln` — XTVERSION ghostty (SSH-safe; not TERM_PROGRAM). */
export function isGhosttyXtversion(): boolean {
  return xtversionName?.toLowerCase().startsWith('ghostty') ?? false
}

// Terminals known to correctly implement the Kitty keyboard protocol
// (CSI >1u) and/or xterm modifyOtherKeys (CSI >4;2m) for ctrl+shift+<letter>
// disambiguation. We previously enabled unconditionally (#23350), assuming
// terminals silently ignore unknown CSI — but some terminals honor the enable
// and emit codepoints our input parser doesn't handle (notably over SSH and
// in xterm.js-based terminals like VS Code). tmux is allowlisted because it
// accepts modifyOtherKeys and doesn't forward the kitty sequence to the outer
// terminal.
const EXTENDED_KEYS_TERMINALS = [
  'iTerm.app',
  'kitty',
  'WezTerm',
  'ghostty',
  'tmux',
  'windows-terminal',
  'WarpTerminal',
]

/** True if this terminal correctly handles extended key reporting
 *  (Kitty keyboard protocol + xterm modifyOtherKeys). */
export function supportsExtendedKeys(): boolean {
  const terminal =
    process.env.TERM_PROGRAM ||
    (process.env.WT_SESSION ? 'windows-terminal' : '')
  return EXTENDED_KEYS_TERMINALS.includes(terminal)
}

/** True if the terminal scrolls the viewport when it receives cursor-up
 *  sequences that reach above the visible area. On Windows, conhost's
 *  SetConsoleCursorPosition follows the cursor into scrollback
 *  (microsoft/terminal#14774), yanking users to the top of their buffer
 *  mid-stream. WT_SESSION catches WSL-in-Windows-Terminal where platform
 *  is linux but output still routes through conhost. */
export function hasCursorUpViewportYankBug(): boolean {
  return process.platform === 'win32' || !!process.env.WT_SESSION
}

/**
 * densable QQ / lWn live read — DECRQM(2026) can flip this after attach.
 * Keep the name for skipSyncMarkers / LogUpdate callers.
 */
export function SYNC_OUTPUT_SUPPORTED(): boolean {
  return isSynchronizedOutputSupported()
}

export type SlowestWrite = {
  startedMs: number
  endedMs: number
  bytes: number
}

export type Terminal = {
  stdout: Writable
  stderr: Writable
  /** densable `Nki` bag — longest stdout write this session. */
  slowestWrite?: SlowestWrite
  /** densable `g7a` — once set, further writes are dropped. */
  stdoutDead?: boolean
  tolerateDeadStdout?: boolean
}

/**
 * densable `Nki(e,t,r)` — keep the slowest write on `terminal`.
 * `startedMs` is the time just before the write; duration is now - startedMs.
 */
export function recordSlowestWrite(
  terminal: Terminal,
  startedMs: number,
  bytes: number,
): void {
  const endedMs = performance.now()
  const prev = terminal.slowestWrite
  if (
    prev === undefined ||
    endedMs - startedMs >= prev.endedMs - prev.startedMs
  ) {
    terminal.slowestWrite = { startedMs, endedMs, bytes }
  }
}

function stdoutErrno(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/**
 * densable `g7a(e,t)` / Ink `writeContent` — write then `Nki`.
 * Dead-stdout swallow is opt-in (`tolerateDeadStdout`) and only for EIO/EPIPE.
 */
export function writeContentToTerminal(
  terminal: Terminal,
  content: string,
): void {
  if (terminal.stdoutDead) return
  const startedMs = performance.now()
  const bytes = Buffer.byteLength(content)
  try {
    terminal.stdout.write(content)
  } catch (err) {
    if (
      terminal.tolerateDeadStdout &&
      (stdoutErrno(err) === 'EIO' || stdoutErrno(err) === 'EPIPE')
    ) {
      terminal.stdoutDead = true
      recordSlowestWrite(terminal, startedMs, bytes)
      return
    }
    throw err
  }
  recordSlowestWrite(terminal, startedMs, bytes)
}

export function writeDiffToTerminal(
  terminal: Terminal,
  diff: Diff,
  skipSyncMarkers = false,
): void {
  // No output if there are no patches
  if (diff.length === 0) {
    return
  }

  // BSU/ESU wrapping is opt-out to keep main-screen behavior unchanged.
  // Callers pass skipSyncMarkers=true when the terminal doesn't support
  // DEC 2026 (e.g. tmux) AND the cost matters (high-frequency alt-screen).
  const useSync = !skipSyncMarkers

  // Buffer all writes into a single string to avoid multiple write calls
  let buffer = useSync ? BSU : ''

  for (const patch of diff) {
    switch (patch.type) {
      case 'stdout':
        buffer += patch.content
        break
      case 'clear':
        if (patch.count > 0) {
          buffer += eraseLines(patch.count)
        }
        break
      case 'clearTerminal':
        // densable writeDiff: O+=T.altScreen?pj8():Bj8(T.viewportRows)
        // alt → 2J+3J+H; main → erase-in-place (preserve scrollback)
        buffer += patch.altScreen
          ? getClearTerminalSequence()
          : eraseViewportInPlace(patch.viewportRows ?? 0)
        break
      case 'cursorHide':
        buffer += HIDE_CURSOR
        break
      case 'cursorShow':
        buffer += SHOW_CURSOR
        break
      case 'cursorMove':
        buffer += cursorMove(patch.x, patch.y)
        break
      case 'cursorTo':
        buffer += cursorTo(patch.col)
        break
      case 'carriageReturn':
        buffer += '\r'
        break
      case 'hyperlink':
        buffer += link(patch.uri)
        break
      case 'styleStr':
        buffer += patch.str
        break
    }
  }

  // Add synchronized update end and flush buffer
  if (useSync) buffer += ESU
  // densable y7a flush → g7a (write + Nki)
  writeContentToTerminal(terminal, buffer)
}
