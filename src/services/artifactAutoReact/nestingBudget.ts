/**
 * densable nestingBudgetExceeded / scanNestingCounters (r$i / uhl / uZf / Iwt).
 * Gold: `.tmp-gold-nesting-mod.txt` / `.tmp-gold-uZf.js` — parse5 Tokenizer as Iwt.
 *
 * Caps: MAX_ESTIMATED_NESTING=4096, MAX_TOTAL_OPEN_TAGS=200000,
 * MAX_SCAN_WORK=50e6, MAX_TOTAL_TAG_TOKENS=200000, llw=1024.
 * Exceeded → cQf returns null → uto treats as ambiguous.
 */
import { Tokenizer, TokenizerMode } from 'parse5'

export const MAX_ESTIMATED_NESTING = 4096
export const MAX_TOTAL_OPEN_TAGS = 200_000
export const MAX_SCAN_WORK = 50_000_000
export const MAX_TOTAL_TAG_TOKENS = 200_000
/** densable llw — max same-tag nesting pressure (fmt estimate). */
export const MAX_SAME_TAG_PRESSURE = 1024
/** densable rlw — end-tag stack scan window. */
export const END_TAG_SCAN_WINDOW = 64

export type NestingScanCounters = {
  exceeded: boolean
  maxDepth: number
  totalOpens: number
  tagTokens: number
  scanWork: number
  maxFmtEstimate: number
  formSplices: number
  failClosed: boolean
}

type NestingCap = { depth: number; totalOpens: number }

type TagTok = {
  tagName: string
  selfClosing?: boolean
  attrs?: ReadonlyArray<{ name: string; value: string }>
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

const RAWTEXT_MODES = new Map<string, number>([
  ['script', TokenizerMode.SCRIPT_DATA],
  ['style', TokenizerMode.RAWTEXT],
  ['xmp', TokenizerMode.RAWTEXT],
  ['iframe', TokenizerMode.RAWTEXT],
  ['noembed', TokenizerMode.RAWTEXT],
  ['noframes', TokenizerMode.RAWTEXT],
  ['noscript', TokenizerMode.RAWTEXT],
  ['title', TokenizerMode.RCDATA],
  ['textarea', TokenizerMode.RCDATA],
  ['plaintext', TokenizerMode.PLAINTEXT],
])

const SVG_HTML_INTEGRATION = new Set(['foreignobject', 'desc', 'title'])
const MATH_HTML_INTEGRATION = new Set(['mi', 'mo', 'mn', 'ms', 'mtext'])

const SCOPE_MARKERS = new Set([
  'applet',
  'caption',
  'html',
  'table',
  'td',
  'th',
  'marquee',
  'object',
  'template',
  'svg',
  'math',
  'foreignobject',
  'desc',
  'title',
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'annotation-xml',
])

const SPECIAL_TAGS = new Set([
  'address',
  'applet',
  'area',
  'article',
  'aside',
  'base',
  'basefont',
  'bgsound',
  'blockquote',
  'body',
  'br',
  'button',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dir',
  'div',
  'dl',
  'dt',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'iframe',
  'img',
  'input',
  'keygen',
  'li',
  'link',
  'listing',
  'main',
  'marquee',
  'menu',
  'meta',
  'nav',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'ol',
  'p',
  'param',
  'plaintext',
  'pre',
  'script',
  'search',
  'section',
  'select',
  'source',
  'style',
  'summary',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
  'wbr',
  'xmp',
  'foreignobject',
  'desc',
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'annotation-xml',
])

/** densable alw — HTML elements that close foreign content. */
const HTML_CLOSES_FOREIGN = new Set([
  'b',
  'big',
  'blockquote',
  'body',
  'br',
  'center',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'hr',
  'i',
  'img',
  'li',
  'listing',
  'menu',
  'meta',
  'nobr',
  'ol',
  'p',
  'pre',
  'ruby',
  's',
  'small',
  'span',
  'strong',
  'strike',
  'sub',
  'sup',
  'table',
  'tt',
  'u',
  'ul',
  'var',
])

/** densable aZf — formatting tags tracked for llw pressure. */
const FORMATTING_TAGS = new Set([
  'a',
  'b',
  'big',
  'code',
  'em',
  'font',
  'i',
  'nobr',
  's',
  'small',
  'strike',
  'strong',
  'tt',
  'u',
])

const END_TAG_IMPLICIT_CLOSE = new Map<string, Set<string>>([
  ['li', new Set(['ul', 'ol'])],
  ['p', new Set(['button'])],
])

const IGNORE_END_TAGS = new Set(['body', 'html'])
const TABLE_SECTION_END = new Set([
  'caption',
  'col',
  'colgroup',
  'frame',
  'frameset',
  'head',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'title',
])

function fontHasPresentationalAttrs(
  attrs: TagTok['attrs'] | undefined,
): boolean {
  if (attrs === undefined) return false
  return attrs.some(a => {
    const name = a?.name
    if (typeof name !== 'string') return false
    const m = name.toLowerCase()
    return m === 'color' || m === 'face' || m === 'size'
  })
}

/**
 * densable uZf — Iwt (parse5 Tokenizer) walk with HTML5 nesting accounting.
 * `cap === null` → densable plw (no depth/opens/scan early-exit except failClosed).
 */
export function scanNestingWithIwt(
  html: string,
  cap: NestingCap | null,
): NestingScanCounters {
  const openStack: string[] = []
  const integrationFlags: boolean[] = []
  const foreignStack: string[] = []
  /** densable i — mode stack: "f" foreign, "i" html-integration. */
  const modeStack: string[] = []
  let selectDepth = 0
  let framesetDepth = 0
  let foreignDepth = 0
  let integrationDepth = 0
  let totalOpens = 0
  let scanWork = 0
  let tagTokens = 0
  let fmtPressure = 0
  let maxFmtEstimate = 0
  let maxDepth = 0
  let formSplices = 0
  let exceeded = false
  let failClosed = false
  const fmtCounts = new Map<string, number>()

  const noop = (): void => {}

  function popForeignUntilHtml(): void {
    while (openStack.length > 0 && modeStack.at(-1) === 'f') {
      const x = openStack.pop()
      if (integrationFlags.pop() === true && integrationDepth > 0) {
        integrationDepth--
        if (modeStack.at(-1) === 'i') modeStack.pop()
      }
      if (x === 'svg' || x === 'math') {
        foreignDepth--
        foreignStack.pop()
        if (modeStack.at(-1) === 'f') modeStack.pop()
      } else if (x === 'select' && selectDepth > 0) selectDepth--
      else if (x === 'frameset' && framesetDepth > 0) framesetDepth--
    }
  }

  // Tokenizer self-reference for RAWTEXT mode switches (densable C.state).
  let tok: Tokenizer | null = null

  tok = new Tokenizer(
    {},
    {
      onStartTag(x: TagTok) {
        if (exceeded) return
        scanWork += openStack.length + 1 + fmtPressure
        tagTokens++
        if (
          cap !== null &&
          (scanWork > MAX_SCAN_WORK || tagTokens > MAX_TOTAL_TAG_TOKENS)
        ) {
          exceeded = true
          return
        }
        let R = x.tagName
        if (
          modeStack.at(-1) === 'f' &&
          HTML_CLOSES_FOREIGN.has(R) &&
          (R !== 'font' || fontHasPresentationalAttrs(x.attrs))
        ) {
          popForeignUntilHtml()
        }
        const inHtml = modeStack.length === 0 || modeStack.at(-1) === 'i'
        const rawMode = inHtml ? RAWTEXT_MODES.get(R) : undefined
        if (
          rawMode !== undefined &&
          (framesetDepth > 0 || (selectDepth > 0 && R !== 'script'))
        ) {
          failClosed = true
          exceeded = true
          return
        }
        if (rawMode !== undefined && tok) {
          tok.state = rawMode
          tok.lastStartTagName = R
        }
        if (VOID_TAGS.has(R) && inHtml) return
        totalOpens++
        if (R === 'svg' || R === 'math') {
          if (x.selfClosing) return
        }
        if (!(x.selfClosing && !inHtml)) {
          if (FORMATTING_TAGS.has(R)) {
            fmtCounts.set(R, (fmtCounts.get(R) ?? 0) + 1)
            fmtPressure++
            if (fmtPressure > maxFmtEstimate) maxFmtEstimate = fmtPressure
            if (cap !== null && fmtPressure > MAX_SAME_TAG_PRESSURE) {
              exceeded = true
              return
            }
          }
          openStack.push(R)
          if (openStack.length > maxDepth) maxDepth = openStack.length
          let enteredIntegration = false
          if (R === 'svg' || R === 'math') {
            foreignDepth++
            foreignStack.push(R)
            modeStack.push('f')
          } else if (R === 'select') selectDepth++
          else if (R === 'frameset') framesetDepth++
          else if (modeStack.at(-1) === 'f') {
            const F = foreignStack.at(-1)
            if (F === 'svg') enteredIntegration = SVG_HTML_INTEGRATION.has(R)
            else if (F === 'math') {
              enteredIntegration =
                MATH_HTML_INTEGRATION.has(R) ||
                (R === 'annotation-xml' &&
                  x.attrs?.some(
                    B =>
                      B.name.toLowerCase() === 'encoding' &&
                      ['text/html', 'application/xhtml+xml'].includes(
                        B.value.toLowerCase(),
                      ),
                  ) === true)
            }
            if (enteredIntegration) {
              integrationDepth++
              modeStack.push('i')
            }
          }
          integrationFlags.push(enteredIntegration)
        }
        if (
          cap !== null &&
          (openStack.length > cap.depth || totalOpens > cap.totalOpens)
        ) {
          exceeded = true
        }
      },
      onEndTag(x: TagTok) {
        if (exceeded) return
        scanWork += openStack.length + 1 + fmtPressure
        tagTokens++
        if (
          cap !== null &&
          (scanWork > MAX_SCAN_WORK || tagTokens > MAX_TOTAL_TAG_TOKENS)
        ) {
          exceeded = true
          return
        }
        const R = x.tagName
        if (IGNORE_END_TAGS.has(R)) return
        if (
          selectDepth > 0 &&
          R !== 'select' &&
          R !== 'option' &&
          R !== 'optgroup' &&
          R !== 'template' &&
          R !== 'script'
        ) {
          return
        }
        if (modeStack.at(-1) === 'f' && (R === 'p' || R === 'br')) {
          popForeignUntilHtml()
        }
        const isSpecial = SPECIAL_TAGS.has(R)
        const closeSet = END_TAG_IMPLICIT_CLOSE.get(R)
        const scanFloor = TABLE_SECTION_END.has(R)
          ? Math.max(0, openStack.length - 1)
          : Math.max(0, openStack.length - END_TAG_SCAN_WINDOW)
        for (let D = openStack.length - 1; D >= scanFloor; D--) {
          const F = openStack[D]!
          if (F === R) {
            if (FORMATTING_TAGS.has(R)) {
              const B = fmtCounts.get(R) ?? 0
              if (B > 0) {
                fmtCounts.set(R, B - 1)
                if (fmtPressure > 0) fmtPressure--
              }
            }
            if (R === 'form') {
              openStack.splice(D, 1)
              integrationFlags.splice(D, 1)
              formSplices++
              return
            }
            for (let B = openStack.length - 1; B >= D; B--) {
              const W = openStack[B]!
              if (integrationFlags[B] === true && integrationDepth > 0) {
                integrationDepth--
                if (modeStack.at(-1) === 'i') modeStack.pop()
              }
              if (W === 'svg' || W === 'math') {
                if (foreignDepth > 0) foreignDepth--
                foreignStack.pop()
                if (modeStack.at(-1) === 'f') modeStack.pop()
              } else if (W === 'select' && selectDepth > 0) selectDepth--
              else if (W === 'frameset' && framesetDepth > 0) framesetDepth--
            }
            openStack.length = D
            integrationFlags.length = D
            return
          }
          if (SCOPE_MARKERS.has(F) || closeSet?.has(F) === true) return
          if (!isSpecial && SPECIAL_TAGS.has(F)) return
        }
      },
      onComment: noop,
      onDoctype: noop,
      onCharacter: noop,
      onNullCharacter: noop,
      onWhitespaceCharacter: noop,
      onEof: noop,
      onParseError: noop,
    },
  )

  tok.write(html, true)
  return {
    exceeded,
    maxDepth,
    totalOpens,
    tagTokens,
    scanWork,
    maxFmtEstimate,
    formSplices,
    failClosed,
  }
}

/** densable plw / scanNestingCounters — no depth/opens cap early-exit. */
export function scanNestingCounters(html: string): NestingScanCounters {
  return scanNestingWithIwt(html, null)
}

/** densable uhl / nestingBudgetExceeded */
export function nestingBudgetExceeded(html: string): boolean {
  return scanNestingWithIwt(html, {
    depth: MAX_ESTIMATED_NESTING,
    totalOpens: MAX_TOTAL_OPEN_TAGS,
  }).exceeded
}
