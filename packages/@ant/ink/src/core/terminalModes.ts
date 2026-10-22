/**
 * densable `dqe` — DEC private-mode stack with suspend/resume.
 *
 * Gold `set`/`reset` return the on/off sequence (empty while `suspended`).
 * `suspend(kept)` turns everything off except `kept`; `resume` turns remaining
 * entries back on. `isHandedOff` ORs `modes.isSuspended`.
 */

import {
  CURSOR_HOME,
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
  ENABLE_KITTY_KEYBOARD,
  ENABLE_MODIFY_OTHER_KEYS,
  ERASE_SCREEN,
  RESET_SCROLL_REGION,
} from './termio/csi.js'
import {
  DBP,
  DFE,
  DISABLE_MOUSE_TRACKING,
  DTR,
  EBP,
  EFE,
  ENTER_ALT_SCREEN,
  ETR,
  EXIT_ALT_SCREEN,
  SHOW_CURSOR,
  decreset,
  decset,
  enableMouseTracking,
  type MouseTrackingMode,
  DEC,
} from './termio/dec.js'
import {
  isProgressReportingAvailable,
  kittyKeyboardPopSeq,
  supportsExtendedKeys,
} from './terminal.js'
import {
  CLEAR_ITERM2_PROGRESS,
  CLEAR_TAB_STATUS,
  OSC,
  osc,
  supportsTabStatus,
  wrapForMultiplexer,
} from './termio/osc.js'

export type TerminalModeName =
  | 'bracketedPaste'
  | 'themeReports'
  | 'extendedKeys'
  | 'altScreen'
  | 'altScreenKeys'
  | 'mouse'
  | 'mousePixels'
  | 'surface'
  | 'focusEvents'

type ModeEntry = {
  mode: TerminalModeName
  on: string
  off: string
}

/** densable `f` — sort key so set/reset emit in gold order. */
const MODE_ORDER: Record<TerminalModeName, number> = {
  bracketedPaste: 0,
  themeReports: 0,
  extendedKeys: 0,
  altScreen: 1,
  altScreenKeys: 2,
  mouse: 2,
  mousePixels: 2,
  surface: 3,
  focusEvents: 4,
}

function extendedKeysOn(): string {
  if (!supportsExtendedKeys()) return ''
  return (
    DISABLE_KITTY_KEYBOARD + ENABLE_KITTY_KEYBOARD + ENABLE_MODIFY_OTHER_KEYS
  )
}

function extendedKeysOff(): string {
  if (!supportsExtendedKeys()) return ''
  return DISABLE_MODIFY_OTHER_KEYS + DISABLE_KITTY_KEYBOARD
}

function kittyPop(): string {
  if (!supportsExtendedKeys()) return ''
  return DISABLE_KITTY_KEYBOARD
}

type SurfaceColors = {
  background?: string | number
  foreground?: string | number
}

/** densable `T` — OSC set bg+fg. Private; not a public API name. */
function T({ background: r, foreground: n }: SurfaceColors): string {
  return osc(OSC.SET_BG_COLOR, r ?? '') + osc(OSC.SET_FG_COLOR, n ?? '')
}

/** densable `x` — OSC reset bg+fg. Private; not a public API name. */
function x(): string {
  return osc(OSC.RESET_BG_COLOR) + osc(OSC.RESET_FG_COLOR)
}

function namedEntry(mode: TerminalModeName): ModeEntry {
  switch (mode) {
    case 'bracketedPaste':
      return { mode, on: EBP, off: DBP }
    case 'themeReports':
      return { mode, on: ETR, off: DTR }
    case 'focusEvents':
      return { mode, on: EFE, off: DFE }
    case 'mousePixels':
      return {
        mode,
        on: decset(DEC.MOUSE_PIXELS),
        off: decreset(DEC.MOUSE_PIXELS) + decset(DEC.MOUSE_SGR),
      }
    case 'extendedKeys':
      return { mode, on: extendedKeysOn(), off: extendedKeysOff() }
    case 'altScreen':
      return {
        mode,
        on: ENTER_ALT_SCREEN + ERASE_SCREEN + CURSOR_HOME,
        off: EXIT_ALT_SCREEN + DISABLE_MODIFY_OTHER_KEYS,
      }
    case 'altScreenKeys':
      return { mode, on: extendedKeysOn(), off: kittyPop() }
    default:
      return { mode, on: '', off: '' }
  }
}

export class TerminalModes {
  private entries: ModeEntry[] = []
  private suspended = false
  private kept: TerminalModeName | undefined

  get isSuspended(): boolean {
    return this.suspended
  }

  isSet(mode: TerminalModeName): boolean {
    return this.entries.some(entry => entry.mode === mode)
  }

  set(
    mode: TerminalModeName,
    arg?: MouseTrackingMode | Record<string, unknown>,
  ): string {
    if (this.isSet(mode)) return ''
    let seq = this.add(this.entry(mode, arg))
    if (mode === 'altScreen') {
      seq += this.add(namedEntry('altScreenKeys'))
    }
    return this.suspended ? '' : seq
  }

  reset(mode: TerminalModeName): string {
    if (!this.isSet(mode)) return ''
    const keysOff = mode === 'altScreen' ? this.remove('altScreenKeys') : ''
    const off = this.remove(mode)
    if (this.suspended && mode === this.kept) {
      this.kept = undefined
      return off
    }
    return this.suspended ? '' : keysOff + off
  }

  reassert(mode: TerminalModeName): string {
    if (this.suspended) return ''
    return this.entries.find(entry => entry.mode === mode)?.on ?? ''
  }

  reassertKeys(): string {
    if (this.suspended) return ''
    const name: TerminalModeName = this.isSet('altScreen')
      ? 'altScreenKeys'
      : 'extendedKeys'
    return this.entries.find(entry => entry.mode === name)?.on ?? ''
  }

  reassertFrom(mode: TerminalModeName): string {
    if (this.suspended || !this.isSet(mode)) return ''
    const floor = MODE_ORDER[mode]
    return this.entries
      .filter(entry => MODE_ORDER[entry.mode] >= floor)
      .reduce((acc, entry) => acc + entry.on, '')
  }

  suspend(kept?: TerminalModeName): string {
    if (this.suspended) return ''
    this.suspended = true
    this.kept = kept
    return this.entries.reduceRight(
      (acc, entry) => (entry.mode === kept ? acc : acc + entry.off),
      '',
    )
  }

  resume(opts: { clearKeys?: boolean } = {}): string {
    if (!this.suspended) return ''
    this.suspended = false
    this.kept = undefined
    const inAlt = this.isSet('altScreen')
    const clearKeys = opts.clearKeys === true
    const prefix = clearKeys
      ? extendedKeysOff() + (inAlt ? '' : kittyPop())
      : ''
    return this.entries.reduce(
      (acc, entry) =>
        acc +
        entry.on +
        (clearKeys && entry.mode === 'altScreen' ? kittyPop() : ''),
      prefix,
    )
  }

  resetAll(): string {
    const list = this.suspended
      ? this.entries.filter(entry => entry.mode === this.kept)
      : this.entries
    this.entries = []
    this.kept = undefined
    return list.reduceRight((acc, entry) => acc + entry.off, '')
  }

  private entry(
    mode: TerminalModeName,
    arg?: MouseTrackingMode | Record<string, unknown>,
  ): ModeEntry {
    if (mode === 'mouse') {
      const tracking: MouseTrackingMode = typeof arg === 'string' ? arg : 'off'
      return {
        mode,
        on: enableMouseTracking(tracking),
        off: tracking === 'off' ? '' : DISABLE_MOUSE_TRACKING,
      }
    }
    if (mode === 'surface') {
      return {
        mode,
        on: typeof arg === 'object' ? T(arg as SurfaceColors) : '',
        off: x(),
      }
    }
    return namedEntry(mode)
  }

  private add(entry: ModeEntry): string {
    const idx = this.entries.findIndex(
      existing => MODE_ORDER[existing.mode] > MODE_ORDER[entry.mode],
    )
    if (idx === -1) this.entries.push(entry)
    else this.entries.splice(idx, 0, entry)
    return entry.on
  }

  private remove(mode: TerminalModeName): string {
    const idx = this.entries.findIndex(entry => entry.mode === mode)
    if (idx === -1) return ''
    return this.entries.splice(idx, 1)[0]!.off
  }
}

/** densable `tlr` — G0 USASCII + SI. */
const G0_USASCII = '\x1b(B\x0f'
/** densable `sle` — mouse off without 1016 (pixels is a separate TC entry). */
const MOUSE_OFF =
  decreset(DEC.MOUSE_SGR) +
  decreset(DEC.MOUSE_ANY) +
  decreset(DEC.MOUSE_BUTTON) +
  decreset(DEC.MOUSE_NORMAL)
/**
 * densable `TC` — restore extras after resetAll, skip any already in `m`.
 */
const RESTORE_EXTRAS = [
  decreset(DEC.MOUSE_PIXELS),
  MOUSE_OFF,
  DISABLE_MODIFY_OTHER_KEYS,
  DFE,
  DTR,
  DBP,
]

function isErrnoException(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
  )
}

/**
 * densable `wDn(n,u)` — unmount restore:
 * `m=n.resetAll()`, then
 * `m+tlr+TC.filter(g=>!m.includes(g)).join("")+(f?"":eAe())+e0+"\x1B7"+CSI r+"\x1B8"+(cqe()?fgn:"")+(Z1t()?Sx(mgn):"")`.
 */
export function restoreTerminalModes(
  modes: TerminalModes,
  write: (seq: string) => void,
): void {
  const hadExtendedKeys = modes.isSet('extendedKeys') && !modes.isSuspended
  const reset = modes.resetAll()
  const seq =
    reset +
    G0_USASCII +
    RESTORE_EXTRAS.filter(extra => !reset.includes(extra)).join('') +
    (hadExtendedKeys ? '' : kittyKeyboardPopSeq()) +
    SHOW_CURSOR +
    '\x1b7' +
    RESET_SCROLL_REGION +
    '\x1b8' +
    (isProgressReportingAvailable() ? CLEAR_ITERM2_PROGRESS : '') +
    (supportsTabStatus() ? wrapForMultiplexer(CLEAR_TAB_STATUS) : '')
  try {
    write(seq)
  } catch (err) {
    if (isErrnoException(err)) return
    throw err
  }
}
