/**
 * densable 2.1.247 n0c / k + plugin print wrappers.
 *
 * Official `_749.js` `n0c` (sha a65a793c9dbd22f2) is unique vs 246 `uYc`/`h`.
 * Wrappers `re`/`Io`/`At`/`se`/`Ve`/`Wr`/`Vr`/`Be`/`Rt`/`Ot`/`U` are
 * 247===246; CLI/UI print paths call them on marketplace-supplied text.
 * Do not use for plugin.json name schema (that stays NAME_CONTROL_OR_BIDI_RE).
 */
import stripAnsi from 'strip-ansi'

export type EscapeSafeTextOptions = {
  keepNewlines?: boolean
  keepEmojiJoiners?: boolean
}

/**
 * densable n0c `s`. Uses the npm package, not `Bun.stripANSI`: these wrappers
 * run on every plugin/marketplace print path and `dist/cli.js` must also run
 * under Node, where the `Bun` global is absent.
 */
function s(e: string): string {
  return stripAnsi(e)
}

// densable F0c regexes used by n0c / k (not the sibling path/URL sanitizers)
const f = '\\p{Default_Ignorable_Code_Point}\\u2800'
const a = '\\u200D\\uFE0E\\uFE0F'
const u = `\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Cn}\\u2028\\u2029${f}`
const _ = new RegExp(`[${u}]+`, 'gu')
const N = new RegExp(`(?:(?![${a}])[${u}])+`, 'gu')
const O = new RegExp(`(?:(?![${a}\\n])[${u}])+`, 'gu')
const S = new RegExp(`(?<!\\S)[${a}]+`, 'gu')
const d = /\p{Cs}/gu

/**
 * densable 2.1.247 `n0c` / `k`:
 * `function k(e,n,r){let t=r?.keepNewlines===!0||r?.keepEmojiJoiners===!0,i=s(e.replace(d,"\\u200B")).replace(r?.keepNewlines?O:t?N:_,n);return t?i.replace(S,""):i}`
 */
export function sanitizeInvisibleText(
  e: string,
  n: string,
  r?: EscapeSafeTextOptions,
): string {
  const t = r?.keepNewlines === true || r?.keepEmojiJoiners === true
  const i = s(e.replace(d, '\u200B')).replace(
    r?.keepNewlines ? O : t ? N : _,
    n,
  )
  return t ? i.replace(S, '') : i
}

/** densable `re` — CLI `ke` / UI `he` / `oKc` */
export function re(e: string): string {
  return sanitizeInvisibleText(e, ' ', { keepEmojiJoiners: true })
}

/** densable `Io` — CLI `D` / UI `zt` / `pKc` */
export function Io(e: string): string {
  return sanitizeInvisibleText(e, ' ', { keepNewlines: true })
}

/** densable `At` */
export function At(e: string): string {
  return sanitizeInvisibleText(e, '', { keepEmojiJoiners: true })
}

/** densable `se` */
export function se(
  e: string | undefined,
  t: (value: string) => string = re,
): string | undefined {
  if (e === undefined) return
  const n = t(e)
  return n.trim() === '' ? undefined : n
}

/** densable `Ve` */
export function Ve(e: string | undefined): string | undefined {
  if (e === undefined) return
  const t = sanitizeInvisibleText(e, '')
  try {
    const { protocol: n } = new URL(t)
    return n === 'https:' || n === 'http:' ? t : undefined
  } catch {
    return
  }
}

export type EscapeSafeManifestFields = {
  displayName?: string
  version?: string
  description?: string
  author?: {
    name: string
    email?: string
    url?: string
  }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
}

/** densable `Wr` / `sKc` / UI `ah` */
export function Wr<T extends EscapeSafeManifestFields>(e: T): T {
  return {
    ...e,
    displayName: se(e.displayName),
    version: se(e.version),
    description: se(e.description, Io),
    author:
      e.author === undefined
        ? undefined
        : {
            ...e.author,
            name: re(e.author.name),
            email: se(e.author.email),
            url: Ve(e.author.url),
          },
    homepage: Ve(e.homepage),
    repository: Ve(e.repository),
    license: se(e.license),
    keywords: e.keywords?.map(re),
  }
}

/** densable `Rt` */
export function Rt(e: string): string {
  return At(e)
}

/** densable `Be` / `wKc` */
export function Be(e: unknown): string | undefined {
  if (typeof e !== 'string') return
  return e.trim() ? e : undefined
}

/** densable `Ot` */
export function Ot(
  e: object,
): e is { manifest: object; name?: string; source?: string } {
  return (
    'manifest' in e &&
    typeof (e as { manifest: unknown }).manifest === 'object' &&
    (e as { manifest: unknown }).manifest !== null
  )
}

export const UNPRINTABLE_PLUGIN_NAME = '(unprintable plugin name)'

/** densable `Vr` / `vKc` — CLI `_n` / UI `He` */
export function Vr(e: {
  name: string
  source?: unknown
  displayName?: unknown
  manifest?: object | null
}): string {
  const t = Ot(e)
    ? (e.manifest as { displayName?: unknown }).displayName
    : e.displayName
  return (
    Be(typeof t === 'string' ? re(t).trim() : t) ??
    Be(Rt(e.name)) ??
    Be(Rt((Ot(e) ? e.source : '') as string)) ??
    UNPRINTABLE_PLUGIN_NAME
  )
}

/** densable CLI `U` — `e.map(ke).join('\\n')` */
export function formatPluginCliLines(e: string[]): string {
  return e.map(re).join('\n')
}
