import supportsHyperlinksLib from 'supports-hyperlinks'
import { attacherCaps, printsUnknownSequences } from './termio/osc.js'

// Additional terminals that support OSC 8 hyperlinks but aren't detected by supports-hyperlinks.
// Checked against both TERM_PROGRAM and LC_TERMINAL (the latter is preserved inside tmux).
export const ADDITIONAL_HYPERLINK_TERMINALS = [
  'ghostty',
  'Hyper',
  'kitty',
  'alacritty',
  'iTerm.app',
  'iTerm2',
  'rex',
  'WarpTerminal',
]

type EnvLike = Record<string, string | undefined>

export type SupportsHyperlinksOptions = {
  env?: EnvLike
  stdoutSupported?: boolean
}

/**
 * densable Slt / WH FORCE_HYPERLINK gate (2.1.217 #15):
 *   if "FORCE_HYPERLINK" in env:
 *     library: parseInt===0 → false; else force true
 *     densable WH: when FORCE present, return supportsHyperlink(stdout)
 *       which itself treats non-zero FORCE as force-on.
 * Local: when FORCE_HYPERLINK is set, honor it over auto-detection —
 *   "0" / empty-after-parse-0 → false; any other value → true.
 */
function isEnvFalsy(value: string): boolean {
  const normalized = value.toLowerCase().trim()
  return (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off'
  )
}

function forceHyperlinkOverride(env: EnvLike): boolean | undefined {
  if (!('FORCE_HYPERLINK' in env)) return undefined
  const raw = env['FORCE_HYPERLINK']
  // densable supports-hyperlinks Mms / 2.1.314 UJe: !(ws(i) || parseInt(i,10)===0)
  // unset key handled above; present:
  if (raw === undefined) return true
  if (isEnvFalsy(raw) || (raw.length > 0 && Number.parseInt(raw, 10) === 0)) {
    return false
  }
  return true
}

/**
 * densable `tAe` @192908005 — explicit attacher or FORCE_HYPERLINK override,
 * or undefined when neither is set (allows Link `assumeSupport` to respect
 * `FORCE_HYPERLINK=0`).
 */
export function getForcedHyperlinkSupport(
  options?: SupportsHyperlinksOptions,
): boolean | undefined {
  const caps = (attacherCaps() as { hyperlinks?: boolean } | null)?.hyperlinks
  if (caps !== undefined) return caps
  const env = options?.env ?? process.env
  return forceHyperlinkOverride(env)
}

/**
 * Returns whether stdout supports OSC 8 hyperlinks.
 * Extends the supports-hyperlinks library with additional terminal detection.
 * densable 2.1.289 `G_` @192908005: WarpTerminal, JetBrains-JediTerm,
 * WT_SESSION outside tmux, tmux >= 3.4.
 * @param options Optional overrides for testing (env, stdoutSupported)
 */
export function supportsHyperlinks(
  options?: SupportsHyperlinksOptions,
): boolean {
  const forced = getForcedHyperlinkSupport(options)
  if (forced !== undefined) {
    return forced
  }

  const env = options?.env ?? process.env

  const stdoutSupported =
    options?.stdoutSupported ?? supportsHyperlinksLib.stdout
  if (stdoutSupported) {
    return true
  }

  // Check for additional terminals not detected by supports-hyperlinks
  const termProgram = env['TERM_PROGRAM']
  if (termProgram && ADDITIONAL_HYPERLINK_TERMINALS.includes(termProgram)) {
    return true
  }

  if (env['TERMINAL_EMULATOR'] === 'JetBrains-JediTerm') {
    return true
  }

  if (env['WT_SESSION'] && termProgram !== 'tmux' && !env['TMUX']) {
    return true
  }

  if (termProgram === 'tmux') {
    const [majorStr, minorStr] = (env['TERM_PROGRAM_VERSION'] ?? '').split('.')
    const major = Number.parseInt(majorStr ?? '', 10)
    const minor = Number.parseInt(minorStr ?? '', 10)
    if (major > 3 || (major === 3 && minor >= 4)) {
      return true
    }
  }

  // LC_TERMINAL is set by some terminals (e.g. iTerm2) and preserved inside tmux,
  // where TERM_PROGRAM is overwritten to 'tmux'.
  const lcTerminal = env['LC_TERMINAL']
  if (lcTerminal && ADDITIONAL_HYPERLINK_TERMINALS.includes(lcTerminal)) {
    return true
  }

  // Kitty sets TERM=xterm-kitty
  const term = env['TERM']
  if (term?.includes('kitty')) {
    return true
  }

  return false
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char guard for OSC 8 URLs
const OSC8_UNSAFE_URL_RE = /[\x00-\x1f\x7f-\x9f]/

function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !OSC8_UNSAFE_URL_RE.test(url)
}

function isBgOrAttachedSession(env: EnvLike): boolean {
  return attacherCaps() !== null || env['CLAUDE_CODE_SESSION_KIND'] === 'bg'
}

/**
 * Official 2.1.326 `Epn` (#213): whether stdout is a terminal capable of
 * ignoring or honoring OSC 8 hyperlinks safely on raw URLs (so URLs that wrap
 * across multiple lines remain clickable even in terminals Claude Code does
 * not explicitly recognize).
 */
export function mayWriteHyperlinksToStdout(
  options?: SupportsHyperlinksOptions & { isTTY?: boolean },
): boolean {
  const env = options?.env ?? process.env
  if (isBgOrAttachedSession(env)) {
    const caps = attacherCaps() as {
      mayWriteHyperlinks?: boolean
      hyperlinks?: boolean
    } | null
    return caps?.mayWriteHyperlinks ?? caps?.hyperlinks ?? false
  }
  const forced = getForcedHyperlinkSupport(options)
  if (forced !== undefined) return forced
  const term = env['TERM'] ?? ''
  const isDumb =
    term === 'dumb' || (term === '' && process.platform !== 'win32')
  const isGnuScreen =
    Boolean(env['STY']) || (term.startsWith('screen') && !env['TMUX'])
  const isTTY = options?.isTTY ?? process.stdout.isTTY === true
  return isTTY && !isDumb && !isGnuScreen && !printsUnknownSequences()
}

/**
 * Official 2.1.326 `Fra` (#213): whether a bare http(s) URL may be wrapped in
 * OSC 8 even when `supportsHyperlinks()` is false, so wrapped URLs stay
 * clickable in unrecognized OSC 8 terminals.
 */
export function mayWriteRawUrlHyperlink(
  url: string,
  options?: SupportsHyperlinksOptions & { isTTY?: boolean },
): boolean {
  const env = options?.env ?? process.env
  return (
    isSafeHttpUrl(url) &&
    !isBgOrAttachedSession(env) &&
    mayWriteHyperlinksToStdout(options)
  )
}
