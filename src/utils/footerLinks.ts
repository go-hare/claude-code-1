/**
 * densable footerLinks (BDs / UDs / FAo / VKy / B4d core).
 *
 * Settings-driven regex badges that match turn output and pin clickable
 * footer links (max 5). Keyed entries (e.g. PR badge) survive /clear;
 * regex-derived entries do not.
 */
import { stripAnsi } from './ansi.js'
import { logForDebugging } from './debug.js'
import { logEvent } from '../services/analytics/index.js'
import { getSettingsForSource } from './settings/settings.js'
import { truncateToWidth } from './truncate.js'
import type { Message } from '../types/message.js'
import { isCompactSummary } from './messages.js'
import { findTurnStartIndex } from './residualFinalEnvGates.js'

/** densable $en — max footer badges shown / retained. */
export const FOOTER_LINKS_MAX = 5

/** densable BKy — max label display width. */
const MAX_LABEL_WIDTH = 28

/** densable D4d — max URL length after template fill. */
const MAX_URL_LENGTH = 2048

/** densable M4d — per-message text slice for scan. */
const PER_MESSAGE_TEXT_CAP = 8192

/** densable qDs — total scan corpus cap. */
const SCAN_CORPUS_CAP = 65_536

/** densable QKy — max messages considered for scan corpus. */
const SCAN_MESSAGE_CAP = 256

/** densable H4d — max matches considered per pattern before stop. */
const MATCH_CEILING = FOOTER_LINKS_MAX * 4 * 10

/** densable P4d — sliding window of newest matches kept per pattern. */
const MATCH_WINDOW = FOOTER_LINKS_MAX * 4

/** densable LOi — allowlisted URL schemes for templates. */
const ALLOWED_SCHEMES = new Set([
  'https:',
  'http:',
  'vscode:',
  'vscode-insiders:',
  'cursor:',
  'windsurf:',
  'zed:',
  'jetbrains:',
  'idea:',
  'slack:',
  'linear:',
  'notion:',
  'figma:',
])

const TEMPLATE_PLACEHOLDER = /\{([^{}]+)\}/g
const NAMED_GROUP = /\(\?<([^>=!][^>]*)>/g
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g

export type FooterLinkRegexConfig = {
  type: 'regex'
  pattern: string
  url: string
  label?: string
}

export type FooterLink = {
  url: string
  label: string
  /** densable dedupUrl — alternate URL used for FAo equality. */
  dedupUrl?: string
  prefix?: string
  /** densable keyed sticky entries (e.g. PR). Regex matches have no key. */
  key?: string
  color?: string
}

export type FooterLinkMatch = {
  url: string
  label: string
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function urlOrigin(u: URL): string {
  return u.origin !== 'null' ? u.origin : `${u.protocol}//${u.host}`
}

/** densable JKy — template must have literal allowlisted origin. */
export function templateOrigin(urlTemplate: string): string | null {
  const u = safeUrl(urlTemplate.replace(TEMPLATE_PLACEHOLDER, 'x'))
  if (!u || !ALLOWED_SCHEMES.has(u.protocol)) return null
  return urlOrigin(u)
}

/** densable YKy — fill label placeholders without URL-encoding. */
export function fillTemplate(
  template: string,
  groups: Record<string, string | undefined>,
): string {
  return template.replace(TEMPLATE_PLACEHOLDER, (_m, name: string) =>
    Object.hasOwn(groups, name) ? (groups[name] ?? '') : '',
  )
}

/**
 * densable VKy — fill URL placeholders with encodeURIComponent; reject
 * path segments that are `.` / `..` (or percent-encoded).
 */
export function fillUrlTemplate(
  template: string,
  groups: Record<string, string | undefined>,
): string | null {
  const filled = template.replace(TEMPLATE_PLACEHOLDER, (_m, name: string) =>
    encodeURIComponent(
      Object.hasOwn(groups, name) ? (groups[name] ?? '') : '',
    ),
  )
  const q = filled.search(/[?#]/)
  const pathPart = q === -1 ? filled : filled.slice(0, q)
  if (pathPart.split(/[/\\]/).some(seg => DOT_SEGMENT.test(seg))) {
    return null
  }
  return filled
}

/** densable FAo — URL / dedupUrl equality. */
export function footerLinksEqual(a: FooterLink, b: FooterLink): boolean {
  return (
    a.url === b.url ||
    a.url === b.dedupUrl ||
    a.dedupUrl === b.url ||
    (a.dedupUrl !== undefined && a.dedupUrl === b.dedupUrl)
  )
}

/**
 * densable UDs — merge new regex matches into existing footerLinks.
 * Keyed entries first; then newest regex matches; cap at FOOTER_LINKS_MAX.
 */
export function mergeFooterLinks(
  existing: FooterLink[],
  incoming: FooterLinkMatch[],
): FooterLink[] {
  if (incoming.length === 0) return existing
  const keyed = existing.filter(l => l.key !== undefined)
  const unkeyed = existing.filter(l => l.key === undefined)
  const fresh: FooterLink[] = []
  for (const m of incoming) {
    const asLink: FooterLink = { url: m.url, label: m.label }
    if (
      fresh.some(l => footerLinksEqual(l, asLink)) ||
      keyed.some(l => footerLinksEqual(l, asLink))
    ) {
      continue
    }
    fresh.push(asLink)
  }
  if (fresh.length === 0) return existing
  const remainingUnkeyed = unkeyed.filter(
    l => !fresh.some(n => footerLinksEqual(l, n)),
  )
  const next = [
    ...keyed,
    ...[...fresh, ...remainingUnkeyed].slice(0, FOOTER_LINKS_MAX),
  ]
  if (
    next.length === existing.length &&
    next.every((a, i) => {
      const b = existing[i]
      return (
        a === b ||
        (b !== undefined &&
          a.url === b.url &&
          a.dedupUrl === b.dedupUrl &&
          a.label === b.label &&
          a.prefix === b.prefix &&
          a.key === b.key &&
          a.color === b.color)
      )
    })
  ) {
    return existing
  }
  return next
}

/**
 * densable $Ds — upsert/remove a keyed footer link (PR badge etc.).
 */
export function setKeyedFooterLink(
  links: FooterLink[],
  key: string,
  entry: Omit<FooterLink, 'key'> | null,
): FooterLink[] {
  if (entry === null) {
    return links.some(l => l.key === key)
      ? links.filter(l => l.key !== key)
      : links
  }
  const existing = links.find(l => l.key === key)
  if (
    existing &&
    existing.url === entry.url &&
    existing.dedupUrl === entry.dedupUrl &&
    existing.label === entry.label &&
    existing.prefix === entry.prefix &&
    existing.color === entry.color
  ) {
    return links
  }
  return [
    { ...entry, key },
    ...links.filter(
      l => l.key !== key && (l.key !== undefined || !footerLinksEqual(l, entry)),
    ),
  ]
}

/** densable F4d — user/flag/policy only (not project/local). */
export function getFooterLinksRegexConfigs(): FooterLinkRegexConfig[] | undefined {
  const out: FooterLinkRegexConfig[] = []
  for (const source of ['policySettings', 'flagSettings', 'userSettings'] as const) {
    const raw = getSettingsForSource(source)?.footerLinksRegexes
    if (!Array.isArray(raw)) continue
    for (const entry of raw) {
      if (
        entry &&
        typeof entry === 'object' &&
        (entry as { type?: string }).type === 'regex' &&
        typeof (entry as { pattern?: string }).pattern === 'string' &&
        typeof (entry as { url?: string }).url === 'string'
      ) {
        out.push(entry as FooterLinkRegexConfig)
      }
    }
  }
  return out.length > 0 ? out : undefined
}

/** densable BDs — scan text with regex configs → matches in document order. */
export function scanFooterLinksFromText(
  configs: readonly FooterLinkRegexConfig[] | undefined,
  text: string,
): FooterLinkMatch[] {
  if (!configs || configs.length === 0 || !text) return []
  const results: { index: number; match: FooterLinkMatch }[] = []

  for (const cfg of configs) {
    if (cfg.type !== 'regex') continue
    const { pattern, url, label } = cfg
    if (
      typeof pattern !== 'string' ||
      typeof url !== 'string' ||
      (label !== undefined && typeof label !== 'string')
    ) {
      continue
    }
    let re: RegExp
    try {
      re = new RegExp(pattern, 'g')
    } catch {
      logForDebugging(`[footerLinks] invalid pattern ${pattern}`)
      continue
    }
    const origin = templateOrigin(url)
    if (origin === null) {
      logForDebugging(
        `[footerLinks] url template "${url}" must have a literal allowlisted origin`,
      )
      continue
    }

    let count = 0
    const window: RegExpExecArray[] = []
    try {
      for (const m of text.matchAll(re)) {
        if (++count > MATCH_CEILING) {
          logForDebugging(
            `[footerLinks] pattern ${pattern} exceeded match ceiling`,
          )
          break
        }
        window.push(m as RegExpExecArray)
        if (window.length > MATCH_WINDOW) window.shift()
      }
      for (const m of window) {
        const groups = (m.groups ?? {}) as Record<string, string | undefined>
        const filledUrl = fillUrlTemplate(url, groups)
        if (filledUrl !== null && filledUrl.length > MAX_URL_LENGTH) continue
        const parsed = filledUrl === null ? null : safeUrl(filledUrl)
        if (filledUrl === null || !parsed || urlOrigin(parsed) !== origin) {
          continue
        }
        const rawLabel = stripAnsi(
          (label ? fillTemplate(label, groups) : m[0] ?? '').replace(
            CONTROL_CHARS,
            '',
          ),
        ).trim()
        const badgeLabel = truncateToWidth(rawLabel, MAX_LABEL_WIDTH)
        if (badgeLabel === '') continue
        results.push({
          index: m.index ?? 0,
          match: { url: filledUrl, label: badgeLabel },
        })
      }
    } catch (err) {
      logForDebugging(
        `[footerLinks] regex exec failed for ${pattern}: ${String(err)}`,
      )
    }
  }

  return results
    .sort((a, b) => a.index - b.index)
    .map(r => r.match)
}

function capText(s: string): string {
  return s.length > PER_MESSAGE_TEXT_CAP ? s.slice(-PER_MESSAGE_TEXT_CAP) : s
}

function messageScanText(msg: Message): string {
  if (msg.type === 'assistant') {
    if (!Array.isArray(msg.message.content)) return ''
    const first = msg.message.content[0]
    return first?.type === 'text' ? capText(first.text) : ''
  }
  if (msg.type === 'user') {
    if (msg.isMeta || !Array.isArray(msg.message.content)) return ''
    const first = msg.message.content[0]
    if (!first || first.type !== 'tool_result') return ''
    if (typeof first.content === 'string') return capText(first.content)
    if (Array.isArray(first.content)) {
      const parts = first.content
        .filter(
          (b): b is { type: 'text'; text: string } =>
            !!b && typeof b === 'object' && (b as { type?: string }).type === 'text',
        )
        .map(b => b.text)
      return capText(parts.join('\n'))
    }
  }
  return ''
}

function isScannableMessage(msg: Message): boolean {
  if (msg.type === 'assistant') {
    return (
      Array.isArray(msg.message.content) &&
      msg.message.content.some(b => b.type === 'text')
    )
  }
  if (msg.type === 'user') {
    if (msg.isMeta || !Array.isArray(msg.message.content)) return false
    return msg.message.content.some(b => {
      if (b.type !== 'tool_result') return false
      if (typeof b.content === 'string') return true
      return (
        Array.isArray(b.content) &&
        b.content.some(
          c => c && typeof c === 'object' && (c as { type?: string }).type === 'text',
        )
      )
    })
  }
  return false
}

/**
 * densable U4d + tYy — build scan corpus from messages after last real user
 * turn (assistant text + tool_result text only).
 */
export function buildFooterLinksScanCorpus(
  messages: readonly Message[],
): string {
  // densable tYy uses last real user; findTurnStartIndex is AJu-equivalent.
  const turnStart = findTurnStartIndex(messages as Message[])
  const slice = messages.slice(turnStart)
  let corpus = ''
  let count = 0
  for (let i = slice.length - 1; i >= 0 && corpus.length < SCAN_CORPUS_CAP && count < SCAN_MESSAGE_CAP; i--) {
    const msg = slice[i]!
    if (!isScannableMessage(msg)) continue
    // Skip compact summaries if present as user/assistant hybrid
    if (
      msg.type === 'user' &&
      (isCompactSummary(msg) ||
        (msg as { toolUseResult?: unknown }).toolUseResult !== undefined)
    ) {
      continue
    }
    count++
    const text = messageScanText(msg)
    if (!text) continue
    corpus = corpus ? `${text}\n${corpus}` : text
  }
  return corpus.length > SCAN_CORPUS_CAP
    ? corpus.slice(-SCAN_CORPUS_CAP)
    : corpus
}

/**
 * densable B4d — scan messages and merge into footerLinks. Returns same array
 * reference when unchanged.
 */
export function scanAndMergeFooterLinks(
  messages: readonly Message[],
  existing: FooterLink[],
  configs: readonly FooterLinkRegexConfig[] | undefined = getFooterLinksRegexConfigs(),
): FooterLink[] {
  if (!configs || configs.length === 0) return existing
  try {
    const corpus = buildFooterLinksScanCorpus(messages)
    // densable: BDs then reverse so newest matches win merge order
    const matches = scanFooterLinksFromText(configs, corpus).reverse()
    if (matches.length === 0) return existing
    logEvent('repl_footer_links', {})
    return mergeFooterLinks(existing, matches)
  } catch (err) {
    logForDebugging(`[footerLinks] scan failed: ${String(err)}`)
    return existing
  }
}

/** densable $4d residual: on /clear keep only keyed footer links. */
export function footerLinksAfterClear(links: FooterLink[]): FooterLink[] {
  return links.filter(l => l.key !== undefined)
}

/** densable DHa — visible list, optionally excluding keyed, capped. */
export function visibleFooterLinks(
  links: FooterLink[],
  opts?: { excludeKeyed?: boolean },
): FooterLink[] {
  const filtered = opts?.excludeKeyed
    ? links.filter(l => l.key === undefined)
    : links
  return filtered.length <= FOOTER_LINKS_MAX
    ? filtered
    : filtered.slice(0, FOOTER_LINKS_MAX)
}
