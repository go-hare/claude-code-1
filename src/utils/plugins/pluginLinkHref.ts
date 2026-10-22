/**
 * densable 2.1.289 `OBr` / `Vmn` / `i8n` / `HYe` / `PYe` / `zmn` / `r8n`.
 * A plugin pane Link whose href is not a string, or (off terminal) fails
 * OBr, is rewritten to Text so the pane does not throw while drawing.
 */

/** densable `OYe`. */
export const MAX_LINK_HREF_CHARS = 2048
/** densable `M1t`. */
const MAX_REASON_CHARS = 200

/** densable `Lz` + `tL` LINE_SCRUB. */
const CHARACTER_CLASSES = {
  escape: String.raw`\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f`,
  placeholder: String.raw`\u{10eeee}`,
  loneSurrogate: String.raw`\ud800-\udfff`,
}
const LINE_SCRUB = new RegExp(
  `[${String.raw`\t\n\r`}${CHARACTER_CLASSES.escape}${CHARACTER_CLASSES.loneSurrogate}${CHARACTER_CLASSES.placeholder}]`,
  'gu',
)

/** densable `$u` — lone surrogate to FFFD before encodeURIComponent. */
function replaceLoneSurrogate(ch: string): string {
  return /[\uD800-\uDFFF]/u.test(ch) ? '\uFFFD' : ch
}

/** densable `Sxe`. */
function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function typeLabel(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/** densable `HYe` — OSC 8 href. */
export function encodePluginLinkHref(href: string): string {
  return href.replace(/[^ -~]/gu, ch =>
    encodeURIComponent(replaceLoneSurrogate(ch)),
  )
}

/** densable `Pft` / `L8e` — bidi marks PYe encodes after tL. */
const BIDI_MARKS = /[\u{061c}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu

/** densable `PYe` — drawn URL text. */
export function encodePluginLinkLabel(href: string): string {
  return href
    .replace(LINE_SCRUB, ch => encodeURIComponent(replaceLoneSurrogate(ch)))
    .replace(BIDI_MARKS, encodeURIComponent)
}

/** densable `OBr`. */
export function pluginLinkHrefProblem(href: string): string | undefined {
  if (/[^!-~]/.test(href)) return 'holds a character outside printable ASCII'
  if (!URL.canParse(href)) return 'is not a URL'
  const {
    protocol,
    hostname,
    username,
    password,
    href: canonical,
  } = new URL(href)
  if (
    !(
      protocol === 'https:' ||
      (protocol === 'http:' && hostname === 'localhost')
    )
  ) {
    return 'is not https: (or http://localhost)'
  }
  if (username !== '' || password !== '')
    return 'carries credentials (user@host)'
  if (href.includes('@')) return 'holds a raw @'
  const withSlash = href.replace(/^(https?:\/\/[^/?#]+)(?=[?#]|$)/, '$1/')
  return canonical === href || canonical === withSlash
    ? undefined
    : `is not in canonical form (${canonical})`
}

/** densable `Vmn`. */
export function pluginLinkSurfaceProblem(
  href: unknown,
  surface: string,
): string | undefined {
  if (!isNonBlankString(href)) {
    return `is ${typeof href === 'string' ? 'blank' : href === undefined ? 'absent' : typeLabel(href)}, not a string that names where it goes`
  }
  const problem =
    surface !== 'terminal' ? pluginLinkHrefProblem(href) : undefined
  return problem === undefined
    ? undefined
    : `${problem}, and the ${surface} surface is sent no other link`
}

type LinkNode = {
  type: string
  props?: { href?: unknown; label?: unknown }
  children?: unknown[]
}

/** densable `zmn`. */
function linkPlainLabel(node: LinkNode): string {
  const props = isRecord(node.props) ? node.props : {}
  const children = node.children
  const hasKids = Array.isArray(children) && children.length > 0
  const label = props.label
  const href = props.href
  if (hasKids) return ''
  if (typeof label === 'string') return label
  return isNonBlankString(href) ? encodePluginLinkLabel(href) : ''
}

export type DrawnPlainLink = { ordinal: number; problem: string }

/** densable `r8n`. */
export function formatDrawnPlainLinks(
  component: string,
  problems: DrawnPlainLink[],
): string {
  const [first, ...rest] = problems
  if (first === undefined) return `ui.render (${component}):`
  const clipped =
    first.problem.length > MAX_REASON_CHARS
      ? `${first.problem.slice(0, MAX_REASON_CHARS)}...`
      : first.problem
  const more =
    rest.length > 0 ? `; ${rest.length} more of its tree as well` : ''
  const body =
    `Link ${first.ordinal} is drawn as plain text, no link made of it: its href ${clipped}${more}`.replace(
      LINE_SCRUB,
      '?',
    )
  return `ui.render (${component}): ${body}`
}

/** densable `i8n`. */
export function rewriteDrawnLinksToPlainText(
  tree: unknown,
  surface: string,
  onPlain?: (problems: DrawnPlainLink[]) => void,
): unknown {
  if (!isRecord(tree) || typeof tree.type !== 'string') return tree
  const problems: DrawnPlainLink[] = []
  let ordinal = 0
  const walk = (node: unknown): unknown => {
    if (!isRecord(node) || typeof node.type !== 'string') return node
    if (node.type !== 'Box' && node.type !== 'Text' && node.type !== 'Link') {
      return node
    }
    if (node.type === 'Link') ordinal += 1
    const n = ordinal
    const kids = Array.isArray(node.children) ? node.children : undefined
    const mapped = kids?.map(child =>
      typeof child === 'string' ? child : walk(child),
    )
    const next: Record<string, unknown> =
      mapped !== undefined && mapped.some((child, i) => child !== kids?.[i])
        ? { ...node, children: mapped }
        : node
    if (next.type !== 'Link') return next
    const props = isRecord(next.props) ? next.props : {}
    const problem = pluginLinkSurfaceProblem(props.href, surface)
    if (problem === undefined) return next
    problems.push({ ordinal: n, problem })
    const label = linkPlainLabel(next as LinkNode)
    const inner =
      mapped !== undefined && mapped.length > 0
        ? mapped
        : label === ''
          ? []
          : [label]
    return { type: 'Text', children: inner }
  }
  const rewritten = walk(tree)
  const [first, ...rest] = problems
  if (first !== undefined) onPlain?.([first, ...rest])
  return rewritten
}
