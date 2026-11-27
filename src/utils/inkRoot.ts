import type { ReactNode } from 'react'
import {
  createRoot as createInkRoot,
  registerInkHostAdapter,
  type RenderOptions,
  type Root,
} from '@anthropic/ink'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { wrapWithSessionServices } from '../context/sessionServices.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { isTmuxControlMode } from './fullscreen.js'
import { getPlatform, type Platform } from './platform.js'
import { isScreenReaderModeEnabled } from './screenReaderGate.js'
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  hasActiveSessionAls,
  runWithSession,
  type Session,
} from './sessionRoot.js'
import { getPinnedStorageV5 } from './storageV5/index.js'

export function registerDefaultInkHostAdapter(): void {
  registerInkHostAdapter({
    sessionRoot: {
      getBootstrapSession,
      hasActiveSessionAls,
      getActiveSessionFromAls,
      runWithSession: (session, fn) => runWithSession(session as Session, fn),
    },
    getFeatureFlag: getFeatureValue_CACHED_MAY_BE_STALE,
    isScreenReaderModeEnabled: () => isScreenReaderModeEnabled(),
    isTmuxControlMode,
  })
}

registerDefaultInkHostAdapter()

/**
 * Official 2.1.328 (`l1` @chunk@306863829.js): enables Ink's early-key
 * InputGate press timing in interactive sessions unless disabled by
 * `CLAUDE_CODE_DISABLE_EARLY_KEY_GUARD`, gated on `tengu_nifty_lemon`.
 */
export function isEarlyKeyGuardEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (getIsNonInteractiveSession()) return false
  const raw = env.CLAUDE_CODE_DISABLE_EARLY_KEY_GUARD
  if (raw !== undefined) {
    if (isEnvDefinedFalsy(raw)) return true
    return !isEnvTruthy(raw)
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_nifty_lemon', false)
}

/**
 * densable `h8` / `m8` / `H0`. Official:
 *   l = o?.storageV5 !== void 0 ? ce(o.storageV5) : void 0
 *   render(s) => ink.render(H0(s, l))
 *   H0(e,o) = o !== void 0 ? z({...o, children: inkTree}) : inkTree
 *
 * Ink itself stays storage-free. This is the Claude `_490.js` wrap.
 * Callers that omit `storageV5` leftover-wire the CLI pin (official Pe/h8
 * option), not a We() read.
 */
export type SessionRenderOptions = RenderOptions & {
  storageV5?: unknown
}

type TerminalProfile = {
  names: readonly string[]
  library?: string
  sampleCells: string
}

/** Official 2.1.328 `MA` terminal capability table (@chunk@306863829.js @365769). */
const TERMINAL_PROFILES: readonly TerminalProfile[] = [
  { names: ['apple_terminal'], sampleCells: '11122e2' },
  { names: ['vscode', 'codium'], library: 'xterm.js', sampleCells: '11112b2' },
  {
    names: ['cursor', 'windsurf', 'antigravity'],
    library: 'xterm.js',
    sampleCells: '11112b2',
  },
  { names: ['xterm.js'], sampleCells: '11112' },
  { names: ['tmux', 'tmux-256color'], sampleCells: '1122242' },
  { names: ['ghostty', 'xterm-ghostty'], sampleCells: '1122222' },
  {
    names: ['vte', 'vte-based', 'gnome-terminal', 'terminator', 'tilix'],
    sampleCells: '11112b2',
  },
  { names: ['kitty', 'xterm-kitty'], sampleCells: '11222?2' },
  { names: ['konsole'], sampleCells: '1122222' },
  { names: ['wezterm'], sampleCells: '1111222' },
  { names: ['alacritty'], sampleCells: '11112b2' },
  { names: ['xterm'], sampleCells: '?1112?2' },
  { names: ['foot', 'foot-extra'], sampleCells: '1122222' },
  { names: ['zellij'], sampleCells: '11112b2' },
  { names: ['screen'], sampleCells: '1' },
  { names: ['rxvt', 'rxvt-unicode-256color'], sampleCells: '11112b2' },
  { names: ['mlterm'], sampleCells: '11112e2' },
  { names: ['st-256color'], sampleCells: '11112b2' },
  { names: ['eterm-color'], sampleCells: '11112b2' },
]

type TestedTerminalRule = {
  TERM?: string
  macApp?: string
}

/** Official 2.1.328 `NS` tested terminal allowlist (@chunk@306863829.js @368081). */
const TESTED_TERMINALS: Record<string, TestedTerminalRule> = {
  apple_terminal: { TERM: 'xterm-256color', macApp: 'com.apple.Terminal' },
  vscode: {},
  tmux: {},
  ghostty: {},
  vte: {},
  kitty: {},
  konsole: {},
  wezterm: {},
  alacritty: { TERM: 'alacritty' },
  xterm: {},
  foot: {},
  zellij: {},
  screen: { TERM: 'screen' },
  rxvt: { TERM: 'rxvt' },
}

function findTerminalProfile(
  name: string | null | undefined,
): TerminalProfile | undefined {
  const lower = name?.toLowerCase() ?? ''
  return TERMINAL_PROFILES.find(profile => profile.names.includes(lower))
}

function detectTerminalNameFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  if (env.CURSOR_TRACE_ID) return 'cursor'
  const askpass = env.VSCODE_GIT_ASKPASS_MAIN?.toLowerCase() ?? ''
  if (askpass.includes('cursor')) return 'cursor'
  if (
    askpass.includes('windsurf') ||
    askpass.includes('devin.app') ||
    askpass.includes('devin desktop') ||
    askpass.includes('devin-desktop')
  ) {
    return 'windsurf'
  }
  if (askpass.includes('antigravity')) return 'antigravity'
  const bundleId = env.__CFBundleIdentifier?.toLowerCase()
  if (bundleId?.includes('vscodium')) return 'codium'
  if (bundleId?.includes('windsurf') || bundleId?.includes('devin')) {
    return 'windsurf'
  }
  if (env.TERM === 'xterm-ghostty') return 'ghostty'
  if (env.TERM?.includes('kitty')) return 'kitty'
  if (env.TERM_PROGRAM) {
    if (/^devin([ -]desktop)?$/i.test(env.TERM_PROGRAM)) return 'windsurf'
    return env.TERM_PROGRAM
  }
  if (env.TMUX) return 'tmux'
  if (env.STY) return 'screen'
  if (env.KONSOLE_VERSION) return 'konsole'
  if (env.GNOME_TERMINAL_SERVICE) return 'gnome-terminal'
  if (env.XTERM_VERSION) return 'xterm'
  if (env.VTE_VERSION) return 'vte-based'
  if (env.TERMINATOR_UUID) return 'terminator'
  if (env.KITTY_WINDOW_ID) return 'kitty'
  if (env.ALACRITTY_LOG) return 'alacritty'
  if (env.TILIX_ID) return 'tilix'
  return env.TERM || undefined
}

function detectMultiplexerFromEnv(env: NodeJS.ProcessEnv): string | null {
  if (env.TMUX) return 'tmux'
  if (env.STY) return 'screen'
  if (env.ZELLIJ) return 'zellij'
  return null
}

function isTmuxControlModeForEnv(env: NodeJS.ProcessEnv): boolean {
  if (env === process.env) return isTmuxControlMode()
  if (!env.TMUX) return false
  if (env.TERM_PROGRAM !== 'iTerm.app') return false
  const term = env.TERM ?? ''
  return !term.startsWith('screen') && !term.startsWith('tmux')
}

export type NewRendererTerminalCaps = {
  name: string
  isTested: boolean
}

export type ResolveTerminalCapsOptions = {
  terminalName?: string
  platform?: Platform
  versionWasAsked?: boolean
  versionReply?: string
  measuredSampleCells?: string
}

/**
 * Official 2.1.328 `Xl()` / `_A()` / `Ql()` / `AS()` (@chunk@306863829.js
 * @365769..370800): resolves canonical terminal name and whether it is in the
 * tested allowlist (`NS`) for the new byte renderer.
 */
export function resolveNewRendererTerminalCaps(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveTerminalCapsOptions = {},
): NewRendererTerminalCaps {
  const platform = options.platform ?? getPlatform()
  const isDaemon = env.CLAUDE_BG_BACKEND === 'daemon'
  const isWindowsTerminal = Boolean(env.WT_SESSION)
  const isJetBrains = env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  const isUnsupportedHost = isDaemon || isWindowsTerminal || isJetBrains

  const terminal =
    options.terminalName !== undefined
      ? options.terminalName || undefined
      : detectTerminalNameFromEnv(env)
  const multiplexer = detectMultiplexerFromEnv(env)
  const term = env.TERM
  const versionToken = options.versionReply?.split(/[ (]/)[0]

  let profile: TerminalProfile | undefined
  if (!isUnsupportedHost) {
    const candidates =
      versionToken !== undefined
        ? [
            findTerminalProfile(terminal)?.library === versionToken
              ? terminal
              : versionToken,
          ]
        : term === 'xterm'
          ? [multiplexer]
          : term === 'screen'
            ? [multiplexer, terminal]
            : [term, multiplexer, terminal]
    profile = candidates.map(findTerminalProfile).find(p => p !== undefined)
  }

  let name: string
  if (isDaemon) {
    name = 'background'
  } else if (isWindowsTerminal || platform === 'wsl') {
    name = 'windows'
  } else if (isJetBrains) {
    name = 'jetbrains'
  } else {
    name = (
      profile?.names[0] ??
      versionToken ??
      terminal ??
      'unknown'
    ).toLowerCase()
  }

  const rule = profile ? TESTED_TERMINALS[name] : undefined
  const samplePattern = profile
    ? new RegExp(`^.${profile.sampleCells.slice(1).replaceAll('?', '.')}`)
    : undefined
  const isTested =
    Boolean(rule) &&
    (rule?.macApp === undefined ||
      (platform === 'macos' && env.__CFBundleIdentifier === rule.macApp)) &&
    (rule?.TERM === undefined
      ? !options.versionWasAsked || options.versionReply !== undefined
      : Boolean(term?.startsWith(rule.TERM)) &&
        (!options.measuredSampleCells ||
          Boolean(samplePattern?.test(options.measuredSampleCells))))

  return { name, isTested }
}

/**
 * Official 2.1.328 (`c1` / `cp` @chunk@306863829.js @449180): enables Ink's new
 * covering/inline/fullscreen byte renderer + IncrementalPainter when
 * `CLAUDE_CODE_NEW_RENDERER` is set, or when GrowthBook `tengu_functional_pebble`
 * parses as `{ add?: string[], remove?: string[] }` and allows the terminal
 * via explicit `add` or `(!isTmuxCc && caps.isTested)`.
 */
export function isNewRendererEnabled(
  env: NodeJS.ProcessEnv = process.env,
  terminalName?: string,
  options?: Omit<ResolveTerminalCapsOptions, 'terminalName'> & {
    flagValue?: unknown
  },
): boolean {
  const raw = env.CLAUDE_CODE_NEW_RENDERER
  if (raw !== undefined) {
    if (isEnvDefinedFalsy(raw)) return false
    return isEnvTruthy(raw)
  }
  const flag =
    options !== undefined && 'flagValue' in options
      ? options.flagValue
      : getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
          'tengu_functional_pebble',
          false,
        )
  if (typeof flag !== 'object' || flag === null || Array.isArray(flag)) {
    return false
  }
  const record = flag as { add?: unknown; remove?: unknown }
  if (
    record.add !== undefined &&
    (!Array.isArray(record.add) ||
      !record.add.every(v => typeof v === 'string'))
  ) {
    return false
  }
  if (
    record.remove !== undefined &&
    (!Array.isArray(record.remove) ||
      !record.remove.every(v => typeof v === 'string'))
  ) {
    return false
  }
  const add: string[] = record.add ?? []
  const remove: string[] = record.remove ?? []
  const caps = resolveNewRendererTerminalCaps(env, {
    ...options,
    terminalName,
  })
  const isTmuxCc = isTmuxControlModeForEnv(env)
  const effectiveName = isTmuxCc ? 'tmux-cc' : caps.name
  return (
    !remove.includes(effectiveName) &&
    (add.includes(effectiveName) || (!isTmuxCc && caps.isTested))
  )
}

export async function createRoot(
  options: SessionRenderOptions = {},
): Promise<Root> {
  const { storageV5: optionStorageV5, ...inkOptions } = options
  const storageV5 =
    'storageV5' in options ? optionStorageV5 : getPinnedStorageV5()
  const root = await createInkRoot({
    ...inkOptions,
    timesPresses: inkOptions.timesPresses ?? isEarlyKeyGuardEnabled,
    newRenderer: inkOptions.newRenderer ?? isNewRendererEnabled(),
  })
  return {
    render(node: ReactNode) {
      root.render(wrapWithSessionServices(node, storageV5))
    },
    unmount: () => root.unmount(),
    waitUntilExit: () => root.waitUntilExit(),
    handoffRawMode: () => root.handoffRawMode(),
    handoffAltScreen: () => root.handoffAltScreen(),
  }
}
