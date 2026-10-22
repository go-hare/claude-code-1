/**
 * densable `jd` — imperative DOM tree used instead of React `render()`.
 * Gold `tree()`: `ownTree ??= new jd(this.rootNode)`. Mutations walk to the
 * mount and call `scheduleRenderFrom` (`oy`).
 */

import {
  appendChildNode,
  createNode,
  createTextNode,
  type DOMElement,
  type DOMNode,
  type TextNode,
  insertBeforeNode,
  removeChildNode,
  scheduleRenderFrom,
  setStyle,
  setTextNodeValue,
  setTextStyles,
  type ElementNames,
} from './dom.js'
import applyStyles, { type Styles, type TextStyles } from './styles.js'

/** densable `Jg` */
const BOX_DEFAULTS: Styles = {
  flexWrap: 'nowrap',
  flexDirection: 'row',
  flexGrow: 0,
  flexShrink: 1,
  overflowX: 'visible',
  overflowY: 'visible',
}

/** densable `Zn` */
function textWrapStyle(textWrap: NonNullable<Styles['textWrap']>): Styles {
  return {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    textWrap,
  }
}

/** densable `Dr` — `cE` then `ty` when yoga exists. */
function applyTreeStyle(node: DOMElement, style: Styles): void {
  setStyle(node, style)
  if (node.yogaNode) applyStyles(node.yogaNode, style, style)
}

export class InkTree {
  private readonly mount: DOMElement
  private readonly own = new WeakSet<DOMNode>()

  constructor(mount: DOMElement) {
    this.mount = mount
  }

  box(style: Styles = {}): DOMElement {
    return this.create('ink-box', { ...BOX_DEFAULTS, ...style })
  }

  text(value: string, textStyles: TextStyles = {}): DOMElement {
    const node = this.create('ink-text', textWrapStyle('wrap'))
    setTextStyles(node, textStyles)
    appendChildNode(node, createTextNode(value) as unknown as DOMElement)
    return node
  }

  span(value: string, textStyles: TextStyles = {}): DOMElement {
    const node = this.create('ink-virtual-text', {})
    setTextStyles(node, textStyles)
    appendChildNode(node, createTextNode(value) as unknown as DOMElement)
    return node
  }

  append(parent: DOMElement, child: DOMNode): void {
    this.mustHold(parent, child)
    appendChildNode(parent, child as DOMElement)
    this.changed(parent)
  }

  insertBefore(parent: DOMElement, child: DOMNode, before: DOMNode): void {
    this.mustHold(parent, child)
    this.mustBeOwn(before)
    insertBeforeNode(parent, child, before)
    this.changed(parent)
  }

  remove(node: DOMNode): void {
    this.mustBeOwn(node)
    this.forget(node)
    const parent = node.parentNode
    if (!parent) return
    removeChildNode(parent, node)
    this.changed(parent)
  }

  empty(): void {
    for (const child of this.mount.childNodes.slice()) {
      if (child.nodeName !== '#text' && this.own.has(child)) {
        this.remove(child)
      }
    }
  }

  setStyle(node: DOMElement, style: Styles): void {
    this.mustBeOwn(node)
    applyTreeStyle(node, { ...BOX_DEFAULTS, ...style })
    this.changed(node)
  }

  setTextStyles(node: DOMElement, textStyles: TextStyles): void {
    this.mustBeOwn(node)
    setTextStyles(node, textStyles)
    this.changed(node)
  }

  setText(node: DOMElement, value: string): void {
    setTextNodeValue(this.textOf(node), value)
    this.changed(node)
  }

  appendText(node: DOMElement, value: string): void {
    const text = this.textOf(node)
    setTextNodeValue(text, text.nodeValue + value)
    this.changed(node)
  }

  rect(
    node: DOMElement,
  ): { x: number; y: number; width: number; height: number } | undefined {
    this.mustBeOwn(node)
    const cached = node.cachedLayout
    if (!cached) return
    return {
      x: cached.x,
      y: cached.y,
      width: cached.width,
      height: cached.height,
    }
  }

  /** densable `create` — `_r(n, this.mount.yogaNode?.config)` then `Dr`. */
  private create(name: ElementNames, style: Styles): DOMElement {
    const node = createNode(name, this.mount.yogaNode?.config)
    applyTreeStyle(node, style)
    this.own.add(node)
    return node
  }

  private changed(node: DOMNode): void {
    let cur: DOMNode | undefined = node
    while (cur && cur !== this.mount) cur = cur.parentNode
    if (cur) scheduleRenderFrom(this.mount)
  }

  private textOf(node: DOMElement): TextNode {
    this.mustBeOwn(node)
    const child = node.childNodes[0]
    if (child?.nodeName !== '#text') {
      throw new Error('Tree: only a text or a span has text')
    }
    return child
  }

  private mustBeOwn(node: DOMNode): void {
    if (!this.own.has(node)) {
      throw new Error('Tree: that node is not this tree’s')
    }
  }

  private mustHold(parent: DOMElement, child: DOMNode): void {
    if (parent !== this.mount) this.mustBeOwn(parent)
    this.mustBeOwn(child)
    const insideText =
      parent.nodeName === 'ink-text' ||
      parent.nodeName === 'ink-virtual-text' ||
      parent.nodeName === 'ink-link'
    if (insideText && child.nodeName !== 'ink-virtual-text') {
      throw new Error('Tree: a box or a text can’t go inside text, only a span')
    }
    if (!insideText && child.nodeName === 'ink-virtual-text') {
      throw new Error('Tree: a span only goes inside text')
    }
  }

  private forget(node: DOMNode): void {
    this.own.delete(node)
    if (node.nodeName === '#text') return
    for (const child of (node as DOMElement).childNodes) {
      this.forget(child)
    }
  }
}
