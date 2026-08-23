/**
 * densable 2.1.238 `MYg` renderLabel — width-gated
 * "Yes, and don't ask again for ${tool} commands in ${cwd}" label.
 *
 * SEA: max(24, maxLabelWidth) + Bun.stringWidth; Ih(cwd) first — if it
 * fits, return even if rewritten; if rewritten and doesn't fit -> null;
 * else FL(original cwd); FJe(tilde path) grapheme prefix+..., still over -> null.
 */
import { homedir } from 'os'
import { sep } from 'path'
import { stringWidth } from '@anthropic/ink'
import { getGraphemeSegmenter } from '../../utils/intl.js'

/** densable `xMi` — tool name display width ceiling before DAA is withheld. */
export const DONT_ASK_TOOL_NAME_MAX_WIDTH = 48

/** densable `FL` — collapse `$HOME` prefix to `~`. */
export function toTildePath(cwd: string): string {
  const home = homedir()
  if (cwd === home) return '~'
  if (cwd.startsWith(home + sep)) return '~' + cwd.slice(home.length)
  return cwd
}

/** densable `FJe` — grapheme segments for prefix truncation. */
function graphemeSegments(text: string): string[] {
  if (!text) return []
  return Array.from(getGraphemeSegmenter().segment(text), s => s.segment)
}

/**
 * densable `Ih` stand-in: strip ANSI; if rewritten append U+FFFD; replace
 * C0/C1/bidi controls with U+FFFD. Full `LP` Unicode-security pass is not
 * ported (KCt-lite).
 */
export function sanitizeDontAskCwd(cwd: string): string {
  let stripped = cwd
  try {
    stripped = Bun.stripANSI(cwd)
  } catch {
    stripped = cwd
  }
  const marked = stripped === cwd ? stripped : `${stripped}\uFFFD`
  // U+2028/U+2029 are JS line terminators — must be unicode escapes, not literals.
  const IH_CONTROLS =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: densable Ih C0/C1 + bidi
    /[\x00-\x1f\x7f-\x9f\u061C\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu
  return marked.replace(IH_CONTROLS, '\uFFFD')
}

export type DontAskAgainLabelArgs = {
  toolName: string
  cwd: string
  maxLabelWidth: number
}

/**
 * densable `MYg` renderLabel body (string form).
 * Returns null when the label cannot fit — caller must omit the DAA option.
 */
export function renderDontAskAgainLabel({
  toolName,
  cwd,
  maxLabelWidth,
}: DontAskAgainLabelArgs): string | null {
  const name = String(toolName)
  if (stringWidth(name) >= DONT_ASK_TOOL_NAME_MAX_WIDTH || name.includes('…')) {
    return null
  }
  if (cwd.includes('…')) return null

  const budget = Math.max(24, maxLabelWidth)
  const build = (d: string): string =>
    `Yes, and don't ask again for ${name} commands in ${d}`

  const sanitized = sanitizeDontAskCwd(cwd)
  if (stringWidth(build(sanitized)) <= budget) return build(sanitized)
  if (sanitized !== cwd) return null

  const tilde = toTildePath(cwd)
  if (stringWidth(build(tilde)) <= budget) return build(tilde)

  const segments = graphemeSegments(tilde)
  let prefix = ''
  for (let i = 0; i < segments.length; i++) {
    const next = prefix + segments[i]!
    if (stringWidth(build(`${next}…`)) > budget) break
    prefix = next
  }
  if (prefix.length > 0) return build(`${prefix}…`)
  return null
}

/**
 * densable `sVc` `Aa0` — initial tracked Select width before `measureElement`.
 * First-frame cap is 40 so DAA is withheld until layout measures the real Select.
 */
export function initialDontAskAgainSelectWidth(columns: number): number {
  return Math.max(20, Math.min(40, columns - 6))
}

/**
 * densable `sVc` `Ilt-8`: `Ilt = min(tracked, max(20, columns-6))`.
 * `tracked` is either Aa0 (first frame) or `max(20, measuredWidth-2)`.
 */
export function dontAskAgainMaxLabelWidthFromTracked(
  trackedWidth: number,
  columns: number,
): number {
  const ilt = Math.min(trackedWidth, Math.max(20, columns - 6))
  return ilt - 8
}

/**
 * First-frame MYg budget only (Aa0 then -8). After layout, callers must pass
 * the measured Select width through `dontAskAgainMaxLabelWidthFromTracked`.
 */
export function dontAskAgainMaxLabelWidth(columns: number): number {
  return dontAskAgainMaxLabelWidthFromTracked(
    initialDontAskAgainSelectWidth(columns),
    columns,
  )
}
