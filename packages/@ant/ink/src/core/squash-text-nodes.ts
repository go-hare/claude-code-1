import type { DOMElement } from './dom.js'
import type { TextStyles } from './styles.js'

/**
 * A segment of text with its associated styles.
 * Used for structured rendering without ANSI string transforms.
 */
export type StyledSegment = {
  text: string
  styles: TextStyles
  hyperlink?: string
}

/**
 * Squash text nodes into styled segments, propagating styles down through the tree.
 * This allows structured styling without relying on ANSI string transforms.
 */
export function squashTextNodesToSegments(
  node: DOMElement,
  inheritedStyles: TextStyles = {},
  inheritedHyperlink?: string,
  out: StyledSegment[] = [],
): StyledSegment[] {
  const mergedStyles = node.textStyles
    ? { ...inheritedStyles, ...node.textStyles }
    : inheritedStyles

  for (const childNode of node.childNodes) {
    if (childNode === undefined) {
      continue
    }

    if (childNode.nodeName === '#text') {
      // Official 2.1.302 (#915): if the previous segment ended with a high
      // surrogate (0xD800-0xDBFF) and this text node starts with a low
      // surrogate (0xDC00-0xDFFF), merge the low surrogate onto the previous
      // segment so an emoji split by an <ink-link> boundary isn't measured
      // or wrapped one column too wide.
      const prev = out.at(-1)
      const splitSurrogate =
        prev !== undefined &&
        (childNode.nodeValue.charCodeAt(0) & 0xfc00) === 0xdc00 &&
        (prev.text.charCodeAt(prev.text.length - 1) & 0xfc00) === 0xd800
      if (splitSurrogate) {
        prev.text += childNode.nodeValue.charAt(0)
      }
      const rest = splitSurrogate
        ? childNode.nodeValue.substring(1)
        : childNode.nodeValue
      if (rest.length > 0) {
        out.push({
          text: rest,
          styles: mergedStyles,
          hyperlink: inheritedHyperlink,
        })
      }
    } else if (
      childNode.nodeName === 'ink-text' ||
      childNode.nodeName === 'ink-virtual-text'
    ) {
      squashTextNodesToSegments(
        childNode,
        mergedStyles,
        inheritedHyperlink,
        out,
      )
    } else if (childNode.nodeName === 'ink-link') {
      const href = childNode.attributes['href'] as string | undefined
      squashTextNodesToSegments(
        childNode,
        mergedStyles,
        href || inheritedHyperlink,
        out,
      )
    }
  }

  return out
}

/**
 * Squash text nodes into a plain string (without styles).
 * Used for text measurement in layout calculations.
 */
function squashTextNodes(node: DOMElement): string {
  let text = ''

  for (const childNode of node.childNodes) {
    if (childNode === undefined) {
      continue
    }

    if (childNode.nodeName === '#text') {
      text += childNode.nodeValue
    } else if (
      childNode.nodeName === 'ink-text' ||
      childNode.nodeName === 'ink-virtual-text'
    ) {
      text += squashTextNodes(childNode)
    } else if (childNode.nodeName === 'ink-link') {
      text += squashTextNodes(childNode)
    }
  }

  return text
}

export default squashTextNodes
