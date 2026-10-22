import { createRequire } from 'node:module'
import { coerce, gte } from 'semver'
import type { Writable } from 'stream'
import {
  eraseViewportInPlace,
  getClearTerminalSequence,
} from './clearTerminal.js'
import type { Diff } from './frame.js'
import {
  cursorMove,
  cursorTo,
  DISABLE_KITTY_KEYBOARD,
  eraseLines,
} from './termio/csi.js'
import { BSU, ESU, HIDE_CURSOR, SHOW_CURSOR } from './termio/dec.js'
import { inkSession } from './instances.js'
import { isJediTermEnv } from './jediTermInput.js'
import { attacherCaps, link } from './termio/osc.js'
import { Jk, tD } from './terminalCapabilities.js'

function isEnvTruthyLike(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

/**
 * densable `sg()` — `r().isEnabled()`. Call-time require of the AX gate
 * (flag / CLAUDE_AX_SCREEN_READER / settings / GB). Standalone Ink tests
 * fall back to env.
 */
function isScreenReaderEnvEnabled(): boolean {
  try {
    const require = createRequire(import.meta.url)
    const { isScreenReaderModeEnabled } =
      require('../../../../../src/utils/screenReaderGate.ts') as typeof import('../../../../../src/utils/screenReaderGate.ts')
    return isScreenReaderModeEnabled()
  } catch {
    return (
      isEnvTruthyLike(process.env.CLAUDE_AX_SCREEN_READER) ||
      isEnvTruthyLike(process.env.INK_SCREEN_READER)
    )
  }
}

/** densable `k("tengu_native_cursor", !1)===!0`. */
function kNativeCursor(): boolean {
  try {
    const require = createRequire(import.meta.url)
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      require('../../../../../src/services/analytics/growthbook.ts') as typeof import('../../../../../src/services/analytics/growthbook.ts')
    return (
      getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
        'tengu_native_cursor',
        false,
      ) === true
    )
  } catch {
    return false
  }
}

/** densable `k("tengu_marlin_porch", !1)===!0`. */
function kMarlinPorch(): boolean {
  try {
    const require = createRequire(import.meta.url)
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      require('../../../../../src/services/analytics/growthbook.ts') as typeof import('../../../../../src/services/analytics/growthbook.ts')
    return (
      getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
        'tengu_marlin_porch',
        false,
      ) === true
    )
  } catch {
    return false
  }
}

/**
 * densable `CDn(r=o7())` — DECSTBM renderer allowlist.
 * `o7` is `g({beforeTheAnswer:false})`.
 */
function isDecstbmAllowlisted(sync: boolean): boolean {
  if (process.env.CLAUDE_BG_BACKEND === 'daemon') return false
  return (
    sync &&
    process.env.TMUX == null &&
    process.env.ZELLIJ == null &&
    !isJediTermEnv() &&
    !isXtermJs() &&
    process.env.WT_SESSION == null
  )
}

type SessionFeaturePins = {
  decstbmRendererEnabled: boolean | undefined
}

const sessionFeaturePins = new WeakMap<object, SessionFeaturePins>()

/**
 * densable `Oo()` — `r.of(U())`. Not `Jk()` (`h.of(U().host)`).
 */
function Oo(): SessionFeaturePins {
  const session = inkSession()
  const existing = sessionFeaturePins.get(session)
  if (existing) return existing
  const created: SessionFeaturePins = { decstbmRendererEnabled: undefined }
  sessionFeaturePins.set(session, created)
  return created
}

/**
 * densable `noe()` — `tmux -CC` control-mode probe (gold `chunk-bagyda0f`).
 */
function isTmuxControlModeGold(): boolean {
  try {
    const require = createRequire(import.meta.url)
    const { isTmuxControlMode } =
      require('../../../../../src/utils/fullscreen.ts') as typeof import('../../../../../src/utils/fullscreen.ts')
    return isTmuxControlMode()
  } catch {
    return false
  }
}

/**
 * densable `x6` — pin `Oo().decstbmRendererEnabled`.
 * Gold `vc()` is `YWe()?ge("policySettings")` — Team/Enterprise slot
 * `slotAdminOrParentComposed` is product-removed here, so `vc()` is always
 * null (do not invent a file-policy stand-in).
 */
export function isDecstbmRendererEnabled(): boolean {
  const pins = Oo()
  if (pins.decstbmRendererEnabled !== undefined) {
    return pins.decstbmRendererEnabled
  }
  if (!process.stdout.isTTY) {
    pins.decstbmRendererEnabled = false
    return false
  }
  if (isTmuxControlModeGold()) {
    pins.decstbmRendererEnabled = false
    return false
  }
  if (!isDecstbmAllowlisted(isSynchronizedOutputSupported(true))) {
    pins.decstbmRendererEnabled = false
    return false
  }
  if (isScreenReaderEnvEnabled()) {
    pins.decstbmRendererEnabled = false
    return false
  }
  if (isEnvTruthyLike(process.env.CLAUDE_CODE_DECSTBM)) {
    pins.decstbmRendererEnabled = true
    return true
  }
  pins.decstbmRendererEnabled = kMarlinPorch()
  return pins.decstbmRendererEnabled
}

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
 * densable `g({beforeTheAnswer})` / `hhe` / `Dmo`.
 * daemon → attacher syncOutput !== false; FORCE only when not tmux;
 * settled `tD()` value, else pending likely when beforeTheAnswer.
 */
export function isSynchronizedOutputSupported(beforeTheAnswer = true): boolean {
  if (process.env.CLAUDE_BG_BACKEND === 'daemon') {
    return attacherCaps()?.syncOutput !== false
  }
  if (!process.env.TMUX && process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT) {
    return true
  }
  const reading = tD().get('synchronizedOutput')
  if (reading.state === 'settled') return reading.value
  return beforeTheAnswer && reading.likely
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

export { Jk, tD } from './terminalCapabilities.js'

/** densable nWn / `dgo` — overwrite XTVERSION name (daemon re-probe after attach). */
export function setXtversionName(name: string): void {
  Jk().xtversionName = name
}

/** densable aWn — `tD().answer("synchronizedOutput")`. */
export function setSynchronizedOutputSupported(supported: boolean): void {
  tD().answer(
    'synchronizedOutput',
    supported,
    `probe: DECRPM 2026 status=${supported ? 1 : 4}`,
  )
}

export function resetTerminalProbeForTests(): void {
  const host = Jk()
  host.xtversionName = undefined
  host.resetCapabilities()
  host.cellPixels = undefined
  host.osc11Responsive = undefined
  host.probeEventLogged = false
  host.nativeCursorEnabled = undefined
  Oo().decstbmRendererEnabled = undefined
}

/** densable `Jk().osc11Responsive`. */
export function getOsc11Responsive(): boolean | undefined {
  return Jk().osc11Responsive
}

export function setOsc11Responsive(responsive: boolean): void {
  Jk().osc11Responsive = responsive
}

/** densable `qg` / `Jk().cellPixels` setter. No graphics probe here. */
export function setCellPixels(
  size: { width: number; height: number } | undefined,
): void {
  if (size && size.width > 0 && size.height > 0) {
    Jk().cellPixels = { width: size.width, height: size.height }
  }
}

/** densable `Jk().cellPixels`. */
export function getCellPixels(): { width: number; height: number } | undefined {
  return Jk().cellPixels
}

/** densable mousePixels capability from DECRPM 1016. */
export function setMousePixelsSupported(supported: boolean): void {
  tD().answer('mousePixels', supported, 'probe: DECRPM 1016')
}

export function getMousePixelsSupported(): boolean {
  return tD().now('mousePixels')
}

/** densable `tD().onSettle("mousePixels")` — probe store, not GrowthBook. */
export function subscribeMousePixelsSupported(
  listener: () => void,
): () => void {
  return tD().onSettle('mousePixels', () => {
    listener()
  })
}

/** densable `lgo` — XTVERSION allows kitty graphics (kitty ≥0.28 / ghostty). */
export function xtversionAllowsKittyGraphics(
  name: string | undefined,
): boolean {
  if (name === undefined || name === '') return false
  if (name.startsWith('kitty(')) {
    const parsed = coerce(name.slice(6))
    return parsed !== null && gte(parsed.version, '0.28.0')
  }
  return (
    name === 'kitty' ||
    name === 'ghostty' ||
    name.startsWith('kitty ') ||
    name.startsWith('ghostty ')
  )
}

export function setKittyGraphicsSupported(supported: boolean): void {
  tD().answer('kittyGraphics', supported, 'probe: kitty graphics')
}

export function getKittyGraphicsSupported(): boolean {
  return tD().now('kittyGraphics')
}

/** densable `cgo` — probe store settle, not GrowthBook. */
export function subscribeKittyGraphicsSupported(
  listener: () => void,
): () => void {
  return tD().onSettle('kittyGraphics', () => {
    listener()
  })
}

/** Official c4r densable — raw XTVERSION name, or undefined if not yet known. */
export function getXtversionName(): string | undefined {
  return Jk().xtversionName
}

/** True if running in an xterm.js-based terminal (VS Code, Cursor, Windsurf
 *  integrated terminals). Combines TERM_PROGRAM env check (fast, sync, but
 *  not forwarded over SSH) with the XTVERSION probe result (async, survives
 *  SSH — query/reply goes through the pty). Early calls may miss the probe
 *  reply — call lazily (e.g. in an event handler) if SSH detection matters. */
export function isXtermJs(): boolean {
  if (attacherCaps()?.isVscodeTerm) return true
  if (process.env.TERM_PROGRAM === 'vscode') return true
  return Jk().xtversionName?.startsWith('xterm.js') ?? false
}

/**
 * densable `syr`.
 */
function nativeCursorSyr(): boolean {
  if (isEnvTruthyLike(process.env.CLAUDE_CODE_ACCESSIBILITY)) return true
  if (isScreenReaderEnvEnabled()) return true
  if (isEnvTruthyLike(process.env.CLAUDE_CODE_NATIVE_CURSOR)) return true
  return kNativeCursor()
}

/**
 * densable `eD` — pin `Jk().nativeCursorEnabled` once.
 * Gold: accessibility / sg() → true; else `!x6() && syr()`.
 */
export function isNativeCursorEnabled(): boolean {
  const host = Jk()
  if (host.nativeCursorEnabled !== undefined) return host.nativeCursorEnabled
  if (isEnvTruthyLike(process.env.CLAUDE_CODE_ACCESSIBILITY)) {
    host.nativeCursorEnabled = true
    return true
  }
  if (isScreenReaderEnvEnabled()) {
    host.nativeCursorEnabled = true
    return true
  }
  host.nativeCursorEnabled = !isDecstbmRendererEnabled() && nativeCursorSyr()
  return host.nativeCursorEnabled
}

/** densable `ME` / `Ln` — XTVERSION ghostty (SSH-safe; not TERM_PROGRAM). */
export function isGhosttyXtversion(): boolean {
  return Jk().xtversionName?.toLowerCase().startsWith('ghostty') ?? false
}

/**
 * densable `y(r)` — named terminal is yyr allowlist; else `tD().now("extendedKeys")`.
 */
export function supportsExtendedKeys(terminal?: string | null): boolean {
  if (terminal != null) {
    return [
      'iTerm.app',
      'kitty',
      'WezTerm',
      'ghostty',
      'tmux',
      'windows-terminal',
      'WarpTerminal',
    ].includes(terminal)
  }
  return tD().now('extendedKeys')
}

/**
 * densable `sRt` — kitty stack push is unsafe inside tmux/screen, or when
 * extendedKeys is off, or WT without a confirmed CSI ? u reply.
 */
export function shouldPushKittyKeyboard(
  terminal: string | null = process.env.TERM_PROGRAM ??
    (process.env.WT_SESSION ? 'windows-terminal' : null),
  capabilities = tD(),
): boolean {
  if (
    process.env.TMUX ||
    process.env.STY ||
    !capabilities.now('extendedKeys')
  ) {
    return false
  }
  return (
    terminal === null ||
    terminal !== 'windows-terminal' ||
    capabilities.confirmed('kittyKeyboard')
  )
}

/**
 * densable `eAe` — kitty pop on restore when extendedKeys or kittyKeyboard
 * is live (`y()||tD().now("kittyKeyboard")?Uto:""`).
 */
export function kittyKeyboardPopSeq(): string {
  return supportsExtendedKeys() || tD().now('kittyKeyboard')
    ? DISABLE_KITTY_KEYBOARD
    : ''
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
  viewportRows?: number,
  keptPrefix = '',
): void {
  // densable dyr(r,n,o=!1,u,i=""): empty n still writes i (kept 1049h).
  if (diff.length === 0) {
    if (keptPrefix !== '') writeContentToTerminal(terminal, keptPrefix)
    return
  }

  // BSU/ESU wrapping is opt-out to keep main-screen behavior unchanged.
  // Callers pass skipSyncMarkers=true when the terminal doesn't support
  // DEC 2026 (e.g. tmux) AND the cost matters (high-frequency alt-screen).
  const useSync = !skipSyncMarkers
  const clampY =
    viewportRows !== undefined && viewportRows > 1
      ? viewportRows - 1
      : undefined

  // densable: d=i+(s?lRt:"")
  let buffer = keptPrefix + (useSync ? BSU : '')

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
        buffer += cursorMove(
          patch.x,
          clampY !== undefined
            ? Math.max(-clampY, Math.min(clampY, patch.y))
            : patch.y,
        )
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
