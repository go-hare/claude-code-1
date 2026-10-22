/**
 * Official o1r / qDi / hkc densables — screen-reader DOM text extraction.
 * Used by Ink.onRenderScreenReader to materialize fullText + cursor node offsets.
 *
 * densable 2.1.218 `xYr` / `preserveRanges` / `aria-preserve-whitespace`:
 * nodes with `accessibility.preserveWhitespace` keep trailing spaces so VoiceOver
 * does not announce "new line" for trailing whitespace on the input line.
 */

import stripAnsi from 'strip-ansi'
import type { DOMElement, DOMNode, TextNode } from './dom.js'
import { LayoutDisplay } from './layout/node.js'
import { MAX_TREE_DEPTH, warnTreeDepthExceeded } from './maxTreeDepth.js'

export type ScreenReaderAccessibility = {
  hidden?: boolean
  label?: string
  role?: string
  state?: Record<string, boolean | undefined>
  /** densable: keep trailing spaces in SR line materialize (#13) */
  preserveWhitespace?: boolean
}

/** DOM node that may carry official accessibility props. */
export type ScreenReaderDOMNode = DOMNode & {
  accessibility?: ScreenReaderAccessibility
}

/** densable preserveRanges: [start, end) char offsets in fullText. */
export type PreserveRange = readonly [number, number]
/** densable `rowPrefixRanges`: [start, end, prefix] — blockquote `"> "`. */
export type RowPrefixRange = readonly [number, number, string]

const BLOCKQUOTE_PREFIX = '> '
const EMPTY_PRESERVE: PreserveRange[] = []
const EMPTY_ROW_PREFIX: RowPrefixRange[] = []
const EMPTY_EXTRACT: ScreenReaderExtract = {
  text: '',
  preserveRanges: EMPTY_PRESERVE,
  rowPrefixRanges: EMPTY_ROW_PREFIX,
}

export type ScreenReaderExtract = {
  text: string
  preserveRanges: PreserveRange[]
  rowPrefixRanges: RowPrefixRange[]
}

/** Official CHh control/bidi strip set used by hkc (RegExp string avoids control-char literal lint). */
// biome-ignore lint/complexity/useRegexLiterals: control ranges as string avoid noControlCharactersInRegex
const CONTROL_OR_BIDI_RE = new RegExp(
  '[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u061c\\u202a-\\u202e\\u2066-\\u2069]',
)

/**
 * Official hkc densable — strip ANSI + drop C0/C1 controls (keep tab/newline)
 * + replace bidi isolates with U+FFFD.
 */
export function sanitizeScreenReaderText(text: string): string {
  if (!CONTROL_OR_BIDI_RE.test(text) && text.indexOf('\x1b') === -1) {
    return text
  }
  const stripped = stripAnsi(text)
  let out = ''
  for (let i = 0; i < stripped.length; i++) {
    const code = stripped.charCodeAt(i)
    if (code < 32) {
      if (code === 9 || code === 10) out += stripped[i]
    } else if (code === 127 || (code >= 128 && code <= 159)) {
      // drop
    } else if (
      code === 0x061c ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      out += '\uFFFD'
    } else {
      out += stripped[i]
    }
  }
  return out
}

function isDisplayNone(node: DOMElement): boolean {
  if (node.isHidden) return true
  if (node.style.display === LayoutDisplay.None) return true
  // Yoga numeric Display.None === 1 in official; our adapter may expose getDisplay.
  const yoga = node.yogaNode as { getDisplay?: () => unknown } | undefined
  const d = yoga?.getDisplay?.()
  return d === 1 || d === LayoutDisplay.None || d === 'none'
}

function isTextish(nodeName: string): boolean {
  return (
    nodeName === 'ink-text' ||
    nodeName === 'ink-virtual-text' ||
    nodeName === 'ink-link'
  )
}

function isBoxish(nodeName: string): boolean {
  return nodeName === 'ink-box' || nodeName === 'ink-root'
}

/** densable `hfo` — offset child preserve ranges into parent. */
function shiftPreserveRanges(
  base: PreserveRange[],
  child: PreserveRange[],
  offset: number,
): PreserveRange[] {
  if (child.length === 0) return base
  const out = base === EMPTY_PRESERVE ? [] : [...base]
  for (const [s, e] of child) {
    out.push([s + offset, e + offset])
  }
  return out
}

function shiftRowPrefixRanges(
  base: RowPrefixRange[],
  child: RowPrefixRange[],
  offset: number,
): RowPrefixRange[] {
  if (child.length === 0) return base
  const out = base === EMPTY_ROW_PREFIX ? [] : [...base]
  for (const [s, e, prefix] of child) {
    out.push([s + offset, e + offset, prefix])
  }
  return out
}

/**
 * densable `xYr` — extract text + preserveRanges from a DOM node.
 */
export function extractScreenReaderOutput(
  node: ScreenReaderDOMNode,
  parentRole?: string,
  depth = 0,
): ScreenReaderExtract {
  // densable xYr: if (r>=Zlt) return yir("renderNodeToScreenReaderOutput", …), empty
  if (depth >= MAX_TREE_DEPTH) {
    warnTreeDepthExceeded('renderNodeToScreenReaderOutput', node.nodeName)
    return EMPTY_EXTRACT
  }
  if (node.nodeName === '#text') {
    return {
      text: sanitizeScreenReaderText((node as TextNode).nodeValue),
      preserveRanges: EMPTY_PRESERVE,
      rowPrefixRanges: EMPTY_ROW_PREFIX,
    }
  }
  const el = node as DOMElement & { accessibility?: ScreenReaderAccessibility }
  const a11y = el.accessibility
  if (a11y?.hidden) return EMPTY_EXTRACT
  if (isDisplayNone(el)) return EMPTY_EXTRACT

  let out = ''
  let ranges: PreserveRange[] = EMPTY_PRESERVE
  let rowPrefixes: RowPrefixRange[] = EMPTY_ROW_PREFIX

  if (a11y?.label !== undefined) {
    out = sanitizeScreenReaderText(a11y.label)
  } else if (isTextish(el.nodeName)) {
    for (const child of el.childNodes) {
      const childOut = extractScreenReaderOutput(
        child as ScreenReaderDOMNode,
        a11y?.role ?? parentRole,
        depth + 1,
      )
      if (childOut.preserveRanges.length > 0) {
        ranges = shiftPreserveRanges(
          ranges,
          childOut.preserveRanges,
          out.length,
        )
      }
      if (childOut.rowPrefixRanges.length > 0) {
        rowPrefixes = shiftRowPrefixRanges(
          rowPrefixes,
          childOut.rowPrefixRanges,
          out.length,
        )
      }
      out += childOut.text
    }
  } else if (isBoxish(el.nodeName)) {
    const box = extractScreenReaderBoxOutput(
      el,
      a11y?.role ?? parentRole,
      depth,
    )
    out = box.text
    ranges = box.preserveRanges
    rowPrefixes = box.rowPrefixRanges
  }

  if (a11y?.state) {
    const active = Object.keys(a11y.state).filter(k => a11y.state?.[k])
    if (active.length > 0) {
      const prefix = `(${active.join(', ')}) `
      out = prefix + out
      ranges = shiftPreserveRanges(EMPTY_PRESERVE, ranges, prefix.length)
      rowPrefixes = shiftRowPrefixRanges(
        EMPTY_ROW_PREFIX,
        rowPrefixes,
        prefix.length,
      )
    }
  }
  // densable: skip role prefix when inherited or blockquote (blockquote uses rowPrefix).
  if (a11y?.role && a11y.role !== parentRole && a11y.role !== 'blockquote') {
    const prefix = `${a11y.role}: `
    out = prefix + out
    ranges = shiftPreserveRanges(EMPTY_PRESERVE, ranges, prefix.length)
    rowPrefixes = shiftRowPrefixRanges(
      EMPTY_ROW_PREFIX,
      rowPrefixes,
      prefix.length,
    )
  }
  if (a11y?.preserveWhitespace && out !== '') {
    ranges = [[0, out.length]]
  }
  if (a11y?.role === 'blockquote' && out !== '') {
    rowPrefixes = [[0, out.length, BLOCKQUOTE_PREFIX]]
  }
  return { text: out, preserveRanges: ranges, rowPrefixRanges: rowPrefixes }
}

/**
 * Official o1r densable — flatten DOM tree into screen-reader plain text.
 * @param parentRole role inherited from parent (official `t` arg)
 */
export function extractScreenReaderText(
  node: ScreenReaderDOMNode,
  parentRole?: string,
): string {
  return extractScreenReaderOutput(node, parentRole).text
}

/** Official wHh densable — box/root join by flex direction (+ preserve ranges). */
function extractScreenReaderBoxOutput(
  el: DOMElement & { accessibility?: ScreenReaderAccessibility },
  parentRole?: string,
  depth = 0,
): ScreenReaderExtract {
  const dir = el.style.flexDirection ?? 'row'
  const vertical = dir === 'column' || dir === 'column-reverse'
  const reverse = dir === 'row-reverse' || dir === 'column-reverse'
  const sep = vertical ? '\n' : ' '
  const parts: ScreenReaderExtract[] = []
  for (const child of el.childNodes) {
    const t = extractScreenReaderOutput(
      child as ScreenReaderDOMNode,
      parentRole,
      depth + 1,
    )
    if (t.text !== '') parts.push(t)
  }
  if (reverse) parts.reverse()
  let text = ''
  let ranges: PreserveRange[] = EMPTY_PRESERVE
  let rowPrefixes: RowPrefixRange[] = EMPTY_ROW_PREFIX
  for (const part of parts) {
    if (text !== '') text += sep
    if (part.preserveRanges.length > 0) {
      ranges = shiftPreserveRanges(ranges, part.preserveRanges, text.length)
    }
    if (part.rowPrefixRanges.length > 0) {
      rowPrefixes = shiftRowPrefixRanges(
        rowPrefixes,
        part.rowPrefixRanges,
        text.length,
      )
    }
    text += part.text
  }
  return { text, preserveRanges: ranges, rowPrefixRanges: rowPrefixes }
}

/** densable wHh text-only path still used by findScreenReaderNodeStartIndex. */
function extractScreenReaderBoxText(
  el: DOMElement & { accessibility?: ScreenReaderAccessibility },
  parentRole?: string,
): string {
  return extractScreenReaderBoxOutput(el, parentRole).text
}

/**
 * Official qDi densable — absolute character offset of `target` in the
 * screen-reader text of `root`. Returns null when target is not found or is
 * a non-box leaf (text/link) that cannot host a declared cursor.
 */
export function findScreenReaderNodeStartIndex(
  root: ScreenReaderDOMNode,
  target: ScreenReaderDOMNode,
  parentRole?: string,
  depth = 0,
): number | null {
  // densable Pps: if (n>=Zlt) return null
  if (depth >= MAX_TREE_DEPTH) {
    warnTreeDepthExceeded('findScreenReaderNodeStartIndex', root.nodeName)
    return null
  }
  if (root === target) return 0
  if (root.nodeName === '#text') return null

  const el = root as DOMElement & { accessibility?: ScreenReaderAccessibility }
  const a11y = el.accessibility
  if (a11y?.hidden) return null
  if (isDisplayNone(el)) return null
  // Official: labeled nodes are atomic (no descent); textish leaves can't host.
  if (a11y?.label !== undefined) return null
  if (isTextish(el.nodeName)) return null
  if (!isBoxish(el.nodeName)) return null

  const role = a11y?.role ?? parentRole
  let prefix = 0
  if (a11y?.state) {
    const active = Object.keys(a11y.state).filter(k => a11y.state?.[k])
    if (active.length > 0) {
      prefix += `(${active.join(', ')}) `.length
    }
  }
  // densable Ws: `y.role!==f` — includes blockquote (text itself skips the role: prefix).
  if (a11y?.role && a11y.role !== parentRole) {
    prefix += `${a11y.role}: `.length
  }

  const dir = el.style.flexDirection ?? 'row'
  const vertical = dir === 'column' || dir === 'column-reverse'
  const reverse = dir === 'row-reverse' || dir === 'column-reverse'
  // Official c is always 1 (space or newline both length 1).
  const sepLen = 1
  void vertical

  const items: Array<{ node: ScreenReaderDOMNode; out: string }> = []
  for (const child of el.childNodes) {
    const out = extractScreenReaderText(child as ScreenReaderDOMNode, role)
    if (out !== '') {
      items.push({ node: child as ScreenReaderDOMNode, out })
    }
  }
  if (reverse) items.reverse()

  let offset = 0
  for (const item of items) {
    const found = findScreenReaderNodeStartIndex(
      item.node,
      target,
      role,
      depth + 1,
    )
    if (found !== null) return prefix + offset + found
    offset += item.out.length + sepLen
  }
  return null
}

// keep extractScreenReaderBoxText referenced for parity with older imports
void extractScreenReaderBoxText
