/**
 * Official o1r / qDi / hkc densables — screen-reader DOM text extraction.
 * Used by Ink.onRenderScreenReader to materialize fullText + cursor node offsets.
 */

import stripAnsi from 'strip-ansi'
import type { DOMElement, DOMNode, TextNode } from './dom.js'
import { LayoutDisplay } from './layout/node.js'

export type ScreenReaderAccessibility = {
  hidden?: boolean
  label?: string
  role?: string
  state?: Record<string, boolean | undefined>
}

/** DOM node that may carry official accessibility props. */
export type ScreenReaderDOMNode = DOMNode & {
  accessibility?: ScreenReaderAccessibility
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

/**
 * Official o1r densable — flatten DOM tree into screen-reader plain text.
 * @param parentRole role inherited from parent (official `t` arg)
 */
export function extractScreenReaderText(
  node: ScreenReaderDOMNode,
  parentRole?: string,
): string {
  if (node.nodeName === '#text') {
    return sanitizeScreenReaderText((node as TextNode).nodeValue)
  }
  const el = node as DOMElement & { accessibility?: ScreenReaderAccessibility }
  const a11y = el.accessibility
  if (a11y?.hidden) return ''
  if (isDisplayNone(el)) return ''

  let out = ''
  if (a11y?.label !== undefined) {
    out = sanitizeScreenReaderText(a11y.label)
  } else if (isTextish(el.nodeName)) {
    for (const child of el.childNodes) {
      out += extractScreenReaderText(
        child as ScreenReaderDOMNode,
        a11y?.role ?? parentRole,
      )
    }
  } else if (isBoxish(el.nodeName)) {
    out = extractScreenReaderBoxText(el, a11y?.role ?? parentRole)
  }

  if (a11y?.state) {
    const active = Object.keys(a11y.state).filter(k => a11y.state?.[k])
    if (active.length > 0) {
      out = `(${active.join(', ')}) ${out}`
    }
  }
  if (a11y?.role && a11y.role !== parentRole) {
    out = `${a11y.role}: ${out}`
  }
  return out
}

/** Official wHh densable — box/root join by flex direction. */
function extractScreenReaderBoxText(
  el: DOMElement & { accessibility?: ScreenReaderAccessibility },
  parentRole?: string,
): string {
  const dir = el.style.flexDirection ?? 'row'
  const vertical = dir === 'column' || dir === 'column-reverse'
  const reverse = dir === 'row-reverse' || dir === 'column-reverse'
  const sep = vertical ? '\n' : ' '
  const parts: string[] = []
  for (const child of el.childNodes) {
    const t = extractScreenReaderText(child as ScreenReaderDOMNode, parentRole)
    if (t !== '') parts.push(t)
  }
  if (reverse) parts.reverse()
  return parts.join(sep)
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
): number | null {
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
    const found = findScreenReaderNodeStartIndex(item.node, target, role)
    if (found !== null) return prefix + offset + found
    offset += item.out.length + sepLen
  }
  return null
}
