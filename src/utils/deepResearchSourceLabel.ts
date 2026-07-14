/**
 * Official 2.1.207 deep-research Fetch agent progress labels.
 *
 * Workflow sandbox has no URL global — host comes from a strict regex.
 * Labels must never forge a trusted hostname or smuggle terminal controls
 * (ANSI / bidi / quote lookalikes). Bare clean LDH hostnames render plain;
 * anything else is quoted+stripped; missing both host and title → "unknown".
 */

/** Captures (1) hostname (userinfo, www., port stripped) and (2) pathname. */
export const URL_HOST_PATTERN =
  /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#\\]*@)?(?:www\.)?([^/:?#@\\]+)(?::\d+)?([^?#]*)/i

export const LABEL_CAP = 40

/**
 * C0/C1, bidi/zero-width, and double-quote lookalikes — must never render.
 * Built via char codes so Biome does not flag control-char class ranges.
 */
function buildLabelStrip(): RegExp {
  const c0c1: string[] = []
  for (let i = 0; i <= 0x1f; i++) c0c1.push(String.fromCharCode(i))
  for (let i = 0x7f; i <= 0x9f; i++) c0c1.push(String.fromCharCode(i))
  const extras =
    '\u200b\u200c\u200d\u200e\u200f' +
    '\u202a\u202b\u202c\u202d\u202e' +
    '\u2066\u2067\u2068\u2069' +
    '\ufeff\u0022\u201c\u201d\u201e\u201f\u2033\u2036\u275d\u275e\u301d\u301e\uff02'
  const escaped = [...c0c1, ...extras]
    .map(ch => ch.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('')
  return new RegExp(`[${escaped}]`, 'g')
}

export const LABEL_STRIP = buildLabelStrip()

/** Strict registrable hostname charset (dot-separated LDH labels). */
export const STRICT_HOST =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

export function stripLabelChars(s: string): string {
  return String(s).replace(LABEL_STRIP, '')
}

/**
 * Render a web-controlled value as a clearly-untrusted quoted label.
 * Cap is in code points (Array.from) so surrogates never split; ellipsis
 * is inside the quotes when truncated.
 */
export function quotedLabel(s: string): string {
  const cps = Array.from(stripLabelChars(s))
  const body = cps.slice(0, LABEL_CAP).join('').trim()
  const ellipsis = cps.length > LABEL_CAP ? '…' : ''
  return `"${body}${ellipsis}"`
}

/** Dedup key: host + path (no trailing slash), lowercased. */
export function normURL(u: string): string {
  const m = String(u).match(URL_HOST_PATTERN)
  if (!m) return String(u).toLowerCase()
  const host = m[1] ?? ''
  const path = (m[2] ?? '').replace(/\/$/, '')
  return (host + path).toLowerCase()
}

/**
 * Progress label for a Fetch agent: bare host when clean, quoted otherwise,
 * title fallback, then "unknown" (official 2.1.207).
 */
export function deepResearchSourceLabel(source: {
  url: string
  title?: string
}): string {
  const capturedHost = String(source.url).match(URL_HOST_PATTERN)?.[1] ?? ''
  const host = capturedHost.toLowerCase()
  const cleanHost = stripLabelChars(host)
  const isCleanBareHost =
    cleanHost === host &&
    host !== '' &&
    Array.from(host).length <= LABEL_CAP &&
    STRICT_HOST.test(host)
  const hostLabel =
    cleanHost === '' ? '' : isCleanBareHost ? host : quotedLabel(host)
  if (hostLabel) return hostLabel
  const title = stripLabelChars(source.title ?? '').trim()
  if (title) return quotedLabel(source.title ?? '')
  return 'unknown'
}

/** Full agent label prefix used in the official workflow. */
export function deepResearchFetchAgentLabel(source: {
  url: string
  title?: string
}): string {
  return `fetch:${deepResearchSourceLabel(source)}`
}
