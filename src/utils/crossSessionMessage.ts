/**
 * densable 2.1.228 #13 — cross-session-message envelope (I6y / fbr / Tte / lhm).
 *
 * Gold:
 * - I6y builds attrs: from / from-session / hop-chain / from-name / from-mode
 * - fbr wraps body as <cross-session-message …>\nbody\n</…>
 * - Tte: strip Cf/Cc/Cs/Zl/Zp, trim, ellipsize >64 codepoints
 * - UI sender label: from-name || pretty(from) || "peer"
 * - RC bridge send uses selfTitle (Soa) as from-name so other machines show
 *   the Remote Control session name as sender
 */

import { CROSS_SESSION_MESSAGE_TAG } from '../constants/xml.js'

/** densable Tte — display-safe truncation (64 codepoints + …). */
export function sanitizeCrossSessionDisplayName(raw: string): string {
  const stripped = raw.replace(/[\p{Cf}\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/gu, '').trim()
  const chars = [...stripped]
  if (chars.length > 64) {
    return `${chars.slice(0, 64).join('')}…`
  }
  return stripped
}

/**
 * densable lhm — pretty-print address for UI when from-name is absent.
 * uds:/path/foo.sock → foo; bridge:… → "(untitled)"; bare path → basename.
 */
export function prettyCrossSessionFromAddress(from: string): string {
  if (from.startsWith('uds:')) {
    const t = from.slice(4)
    return t.slice(t.lastIndexOf('/') + 1).replace(/\.sock$/, '')
  }
  if (from.startsWith('bridge:')) return '(untitled)'
  if (from.startsWith('/')) {
    return from.slice(from.lastIndexOf('/') + 1).replace(/\.sock$/, '')
  }
  return from
}

/**
 * densable UI: LIT&&Tte(LIT)||MIT&&Tte(lhm(MIT))||"peer"
 */
export function resolveCrossSessionSenderLabel(input: {
  from?: string | null
  fromName?: string | null
}): string {
  const named =
    input.fromName !== undefined &&
    input.fromName !== null &&
    input.fromName !== ''
      ? sanitizeCrossSessionDisplayName(input.fromName)
      : ''
  if (named) return named
  if (input.from) {
    const pretty = sanitizeCrossSessionDisplayName(
      prettyCrossSessionFromAddress(input.from),
    )
    if (pretty) return pretty
  }
  return 'peer'
}

export type CrossSessionMessageAttrs = {
  from?: string
  fromName?: string
  fromSession?: string
  hopChain?: readonly string[]
  fromMode?: string
}

/**
 * densable I6y — attribute string (leading space when non-empty).
 */
export function buildCrossSessionMessageAttrs(
  attrs: CrossSessionMessageAttrs,
): string {
  const parts: string[] = []
  if (attrs.from) parts.push(`from="${attrs.from}"`)
  if (attrs.fromSession) {
    parts.push(`from-session="${attrs.fromSession}"`)
  }
  if (attrs.hopChain !== undefined && attrs.hopChain.length > 0) {
    parts.push(`hop-chain="${attrs.hopChain.join(',')}"`)
  }
  const fromName =
    attrs.fromName === undefined
      ? undefined
      : sanitizeCrossSessionDisplayName(attrs.fromName.replace(/["<>]/g, ''))
  if (fromName) parts.push(`from-name="${fromName}"`)
  if (attrs.fromMode) parts.push(`from-mode="${attrs.fromMode}"`)
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

/**
 * densable fbr — wrap body in cross-session-message envelope.
 * If body is already a full envelope, return as-is (idempotent for re-sends).
 */
export function wrapCrossSessionMessage(
  body: string,
  attrs: CrossSessionMessageAttrs,
): string {
  const open = `<${CROSS_SESSION_MESSAGE_TAG}`
  if (
    body.startsWith(open) ||
    body.includes(`\n${open}`) ||
    /^[\s\S]*?<cross-session-message\b/.test(body.slice(0, 200))
  ) {
    // densable DLu re-canonicalizes; for send path skip double-wrap when already tagged
    if (
      /^<cross-session-message\b[^>]*>\n[\s\S]*\n<\/cross-session-message>$/.test(
        body.trim(),
      )
    ) {
      return body
    }
  }
  const attrStr = buildCrossSessionMessageAttrs(attrs)
  return `<${CROSS_SESSION_MESSAGE_TAG}${attrStr}>\n${body}\n</${CROSS_SESSION_MESSAGE_TAG}>`
}

/** Parse open-tag attrs for UI (from / from-name). */
export function parseCrossSessionOpenAttrs(text: string): {
  from?: string
  fromName?: string
} {
  const open =
    text.match(/^[\s\S]*?<cross-session-message\b([^>]*)>/)?.[1] ?? ''
  const from = open.match(/\bfrom="([^"]+)"/)?.[1]
  const fromName = open.match(/\bfrom-name="([^"]+)"/)?.[1]
  return {
    ...(from !== undefined ? { from } : {}),
    ...(fromName !== undefined ? { fromName } : {}),
  }
}
