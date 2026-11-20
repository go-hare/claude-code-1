import { attacherCaps, printsUnknownSequences } from './termio/osc.js'

const CI_HYPERLINK_ENV_KEYS = [
  'APPVEYOR',
  'BUILDKITE',
  'CIRCLECI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'TRAVIS',
] as const

function collectColorAndHyperlinkFlags(argv: readonly string[]): string {
  let out = ''
  for (const arg of argv) {
    if (arg === '--') break
    if (/^--(?:no-)?(?:color|hyperlink).*$/.test(arg)) {
      out += `${arg}\n`
    }
  }
  return out
}

function parseVersionPair(raw = ''): [number, number] {
  if (/^\d{3,4}$/.test(raw)) {
    return [0, Math.floor(Number(raw) / 100)]
  }
  return [
    Number.parseInt(raw, 10),
    Number.parseInt(raw.split('.', 2)[1] ?? '', 10),
  ]
}

function supportsColorForHyperlinks(
  env: EnvLike,
  forceColor: string | undefined,
  flags: string,
): boolean {
  let forced = false
  if (forceColor === undefined) {
    if (/^--(?:no-colors?|color=(?:false|never))$/m.test(flags)) return false
    forced = /^--color(?:s|=true|=always)?$/m.test(flags)
  } else {
    const parsed = Number.parseInt(forceColor, 10)
    if (parsed === 0 || forceColor === 'false') return false
    forced = !Number.isNaN(parsed) || forceColor === '' || forceColor === 'true'
  }
  if (/^--color=(?:256|16m|full|truecolor)$/m.test(flags)) return true
  const { TERM = '', TERM_PROGRAM, TEAMCITY_VERSION } = env
  if (TERM === 'dumb') return forced
  if (env.CI !== undefined) {
    return (
      forced ||
      env.CI_NAME === 'codeship' ||
      CI_HYPERLINK_ENV_KEYS.some(key => key in env)
    )
  }
  if (TEAMCITY_VERSION !== undefined) {
    const parts = TEAMCITY_VERSION.split('.', 3)
    const [major = '', minor = ''] = parts
    return major === '9'
      ? parts.length === 3 && /^\d+$/.test(minor) && Number(minor) > 0
      : parts.length > 1 && /^\d\d+$/.test(major)
  }
  return (
    forced ||
    env.COLORTERM !== undefined ||
    TERM_PROGRAM === 'iTerm.app' ||
    TERM_PROGRAM === 'Apple_Terminal' ||
    /^(?:rxvt|screen|vt(?:100|220)|xterm)/i.test(TERM) ||
    /ansi|color|cygwin|linux|-256$/i.test(TERM)
  )
}

/**
 * Official 2.1.327 (#451) inlined `supportsHyperlink(stream, env, forceColor)`:
 * - Gates `WT_SESSION` with `!env.TMUX && env.TERM_PROGRAM !== 'tmux'` so
 *   Windows Terminal inside old tmux (< 3.4) does not falsely claim OSC 8.
 * - Excludes VTE 0.50.0 (`'0.50.0'` / `'5000'`), which did not support OSC 8.
 */
export function supportsHyperlinkStream(
  stream: { isTTY?: boolean } | undefined,
  env: EnvLike = process.env,
  forceColor: string | undefined = env.FORCE_COLOR,
  argv: readonly string[] = process.argv,
): boolean {
  const { FORCE_HYPERLINK } = env
  if (FORCE_HYPERLINK) {
    return Number.parseInt(FORCE_HYPERLINK, 10) !== 0
  }
  const flags = collectColorAndHyperlinkFlags(argv)
  if (flags) {
    if (/^--(?:no-hyperlinks?|hyperlink=(?:false|never))$/m.test(flags)) {
      return false
    }
    if (/^--hyperlink=(?:true|always)$/m.test(flags)) {
      return true
    }
  }
  if (env.NETLIFY) return true
  if (
    (stream && !stream.isTTY) ||
    !supportsColorForHyperlinks(env, forceColor, flags)
  ) {
    return false
  }
  if ('WT_SESSION' in env && !env.TMUX && env.TERM_PROGRAM !== 'tmux') {
    return true
  }
  if (env.CI || env.TEAMCITY_VERSION) return false
  const [major, minor] = parseVersionPair(env.TERM_PROGRAM_VERSION)
  switch (env.TERM_PROGRAM ?? '') {
    case 'iTerm.app':
      return major > 3 || (major === 3 && minor >= 1)
    case 'WezTerm':
      return major >= 20200620
    case 'vscode':
      return major > 1 || (major === 1 && minor >= 72)
    case 'ghostty':
      return true
  }
  const { VTE_VERSION } = env
  if (VTE_VERSION) {
    const [vteMajor, vteMinor] = parseVersionPair(VTE_VERSION)
    return (
      VTE_VERSION !== '0.50.0' &&
      VTE_VERSION !== '5000' &&
      (vteMajor > 0 || vteMinor >= 50)
    )
  }
  return env.TERM === 'alacritty'
}

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
    options?.stdoutSupported ??
    supportsHyperlinkStream(process.stdout, env, env.FORCE_COLOR)
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
