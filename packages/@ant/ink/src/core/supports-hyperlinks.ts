import supportsHyperlinksLib from 'supports-hyperlinks'

// Additional terminals that support OSC 8 hyperlinks but aren't detected by supports-hyperlinks.
// Checked against both TERM_PROGRAM and LC_TERMINAL (the latter is preserved inside tmux).
export const ADDITIONAL_HYPERLINK_TERMINALS = [
  'ghostty',
  'Hyper',
  'kitty',
  'alacritty',
  'iTerm.app',
  'iTerm2',
]

type EnvLike = Record<string, string | undefined>

type SupportsHyperlinksOptions = {
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
function forceHyperlinkOverride(env: EnvLike): boolean | undefined {
  if (!('FORCE_HYPERLINK' in env)) return undefined
  const raw = env['FORCE_HYPERLINK']
  // densable supports-hyperlinks Mms: if(r) return !(r.length>0 && parseInt(r,10)===0)
  // unset key handled above; present:
  if (raw === undefined) return true
  if (raw.length > 0 && Number.parseInt(raw, 10) === 0) return false
  return true
}

/**
 * Returns whether stdout supports OSC 8 hyperlinks.
 * Extends the supports-hyperlinks library with additional terminal detection.
 * densable 2.1.217: FORCE_HYPERLINK=0 exits hyperlink mode; set forces on.
 * @param options Optional overrides for testing (env, stdoutSupported)
 */
export function supportsHyperlinks(
  options?: SupportsHyperlinksOptions,
): boolean {
  const env = options?.env ?? process.env

  const forced = forceHyperlinkOverride(env)
  if (forced !== undefined) {
    return forced
  }

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
