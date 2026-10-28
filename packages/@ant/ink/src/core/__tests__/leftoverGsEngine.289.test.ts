/**
 * densable 2.1.289 Gs Mv fC/hC, SC unpainted, lst cull.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendChildNode, createNode, setStyle } from '../dom.js'
import { hitTest } from '../hit-test.js'
import { nodeCache } from '../node-cache.js'
import Output from '../output.js'
import applyStyles from '../styles.js'
import { CharPool, createScreen, HyperlinkPool, StylePool } from '../screen.js'
import renderNodeToOutput, {
  createRenderFrameContext,
  leftoverGsAbsChildMoved,
  leftoverGsDropCachedLayout,
  leftoverGsEscapingDirtyPoisons,
  leftoverGsSkipBlitMiss,
  leftoverGsStampUnpainted,
  runWithRenderFrameContext,
} from '../render-node-to-output.js'

const render = readFileSync(
  join(import.meta.dir, '../render-node-to-output.ts'),
  'utf8',
)
const ink = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
const renderer = readFileSync(join(import.meta.dir, '../renderer.ts'), 'utf8')
const selection = readFileSync(join(import.meta.dir, '../selection.ts'), 'utf8')

describe('leftoverGs Mv fC/hC wire', () => {
  test('prevScreen kills F&&!ie, L.has, B&&escaping', () => {
    expect(render).toContain('leftoverGsF && !isAbsolute')
    expect(render).toContain('leftoverGsL?.has(childElem) === true')
    expect(render).toContain(
      'seenDirtyClipped && childElem.hasEscapingDescendant === true',
    )
  })

  test('fC: abs child yoga vs cache miss', () => {
    const parent = createNode('ink-box')
    const child = createNode('ink-box')
    applyStyles(parent.yogaNode!, { width: 20, height: 10 })
    applyStyles(child.yogaNode!, {
      position: 'absolute',
      width: 4,
      height: 2,
      top: 1,
      left: 1,
    })
    appendChildNode(parent, child)
    setStyle(child, { position: 'absolute', width: 4, height: 2 })
    parent.yogaNode!.calculateLayout(20)
    const yoga = child.yogaNode!
    child.cachedLayout = {
      x: yoga.getComputedLeft(),
      y: yoga.getComputedTop(),
      width: yoga.getComputedWidth(),
      height: yoga.getComputedHeight(),
    }
    expect(parent.hasAbsoluteDescendant).toBe(true)
    expect(leftoverGsAbsChildMoved(parent, 0, 0)).toBe(false)
    applyStyles(child.yogaNode!, {
      position: 'absolute',
      width: 4,
      height: 2,
      top: 1,
      left: 8,
    })
    parent.yogaNode!.calculateLayout(20)
    expect(leftoverGsAbsChildMoved(parent, 0, 0)).toBe(true)
  })

  test('hC: later escaping dirty descendant poisons earlier in-flow', () => {
    const parent = createNode('ink-box')
    const earlier = createNode('ink-box')
    const later = createNode('ink-box')
    const desc = createNode('ink-box')
    applyStyles(parent.yogaNode!, {
      flexDirection: 'column',
      width: 10,
      height: 8,
    })
    applyStyles(earlier.yogaNode!, { width: 10, height: 4 })
    applyStyles(later.yogaNode!, { width: 10, height: 4 })
    applyStyles(desc.yogaNode!, { width: 10, height: 4 })
    appendChildNode(parent, earlier)
    appendChildNode(parent, later)
    appendChildNode(later, desc)
    parent.yogaNode!.calculateLayout(10)
    earlier.cachedLayout = { x: 0, y: 0, width: 10, height: 4 }
    later.cachedLayout = { x: 0, y: 4, width: 10, height: 4 }
    desc.cachedLayout = { x: 0, y: 0, width: 10, height: 6 }
    later.hasEscapingDescendant = true
    later.dirty = true
    desc.dirty = true
    const poisoned = leftoverGsEscapingDirtyPoisons(parent, 0, 0)
    expect(poisoned?.has(earlier)).toBe(true)
    expect(poisoned?.has(later)).toBeFalsy()
  })
})

describe('leftoverGs SC unpainted / lst cull', () => {
  test('SC stamps unpainted so yC misses skip-blit', () => {
    const parent = createNode('ink-box')
    const child = createNode('ink-box')
    applyStyles(parent.yogaNode!, { width: 8, height: 4 })
    applyStyles(child.yogaNode!, { width: 8, height: 4 })
    appendChildNode(parent, child)
    parent.yogaNode!.calculateLayout(8)
    leftoverGsStampUnpainted(child, 0, 0)
    expect(child.cachedLayout?.unpainted).toBe(true)
    expect(leftoverGsSkipBlitMiss(child, child.cachedLayout!, undefined)).toBe(
      true,
    )
  })

  test('lst drops cachedLayout and WeakMap', () => {
    const node = createNode('ink-box')
    const rect = { x: 0, y: 0, width: 8, height: 4, unpainted: true }
    node.cachedLayout = rect
    nodeCache.set(node, rect)
    leftoverGsDropCachedLayout(node)
    expect(node.cachedLayout).toBeUndefined()
    expect(nodeCache.get(node)).toBeUndefined()
  })

  test('height===0 walks SC; cull walks lst', () => {
    expect(render).toContain(
      'leftoverGsStampUnpainted(child as DOMElement, x, y)',
    )
    expect(render).toContain(
      'if (!preserveCulledCache) leftoverGsDropCachedLayout(childElem)',
    )
    expect(render).not.toContain('function dropSubtreeCache')
    expect(render).not.toContain('blitEscapingAbsoluteDescendants')
  })

  test('Gs stamps ink-root cachedLayout so R6 hitTest can click/hover', () => {
    const root = createNode('ink-root')
    const box = createNode('ink-box')
    applyStyles(root.yogaNode!, { width: 20, height: 4 })
    applyStyles(box.yogaNode!, { width: 20, height: 4 })
    appendChildNode(root, box)
    root.yogaNode!.calculateLayout(20)
    const stylePool = new StylePool()
    const screen = createScreen(
      20,
      4,
      stylePool,
      new CharPool(),
      new HyperlinkPool(),
    )
    const output = new Output({ width: 20, height: 4, stylePool, screen })
    runWithRenderFrameContext(createRenderFrameContext(), () => {
      renderNodeToOutput(root, output, { prevScreen: undefined })
    })
    expect(root.cachedLayout).toEqual(
      expect.objectContaining({ x: 0, y: 0, width: 20, height: 4 }),
    )
    expect(hitTest(root, 1, 1)).toBe(box)
    expect(nodeCache.get(root)).toBe(root.cachedLayout)
  })

  test('stampLayout is gold one object; Gs skip-blit reads cachedLayout', () => {
    expect(render).toContain('node.cachedLayout = rect')
    expect(render).toContain('nodeCache.set(node, rect)')
    expect(render).toContain('const cached = node.cachedLayout')
    expect(render).toContain('const contentCached = content.cachedLayout')
    expect(render).toContain('const cached = childElem.cachedLayout')
    expect(render).not.toContain('node.cachedLayout ?? nodeCache.get(node)')
  })

  test('sf leftoverGsWidthUnchanged is gold _t; fast-path clips void 0', () => {
    expect(render).toContain('leftoverGsWidthUnchanged')
    expect(render).toContain(
      'contentCached.width === contentYoga.getComputedWidth()',
    )
    expect(render).toContain('leftoverGsWidthUnchanged &&')
    expect(render).toContain('depth + 2')
  })
})

describe('leftoverGs Kt overlayActive / Ze wire', () => {
  test('ink stamps prevOverlaySig and overlayActive before renderer', () => {
    expect(ink).toContain('leftoverGsOverlaySig')
    expect(ink).toContain('leftoverGsContaminated')
    expect(ink).toContain('leftoverGsOverlayActive')
    expect(ink).toContain('leftoverGsSelectionBothEndsOff')
    expect(ink).toContain('overlayActive: leftoverGsOverlay')
    expect(ink).toContain('prevFrameContaminated: leftoverGsContaminated')
    expect(renderer).toContain('leftoverGsSetOverlayActive')
    expect(renderer).toContain('options.overlayActive === true')
    expect(selection).toContain(
      'export function leftoverGsSelectionBothEndsOff',
    )
    expect(render).toContain('leftoverGsKt')
    expect(render).toContain('node,')
  })

  test('gold DualInk onRender: getter + R damage + write clears flag', () => {
    expect(ink).toContain('private get altScreenFullRepaint(): boolean')
    expect(ink).toContain(
      'return isEnvTruthyLike(process.env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT)',
    )
    expect(ink).not.toContain('this.altScreenFullRepaint = isEnvTruthyLike')
    expect(ink).toContain('leftoverGsContaminated ||')
    expect(ink).toContain('this.prevFrameContaminated = false')
    expect(ink).not.toContain(
      'this.prevFrameContaminated = selActive || hlActive',
    )
  })

  test('raw-ansi inherited bg walks leftoverGsRawAnsiWrite', () => {
    expect(render).toContain('leftoverGsRawAnsiWrite')
    expect(render).toContain('leftoverGsRewriteRawAnsiBg')
    expect(render).toContain("typeof text === 'string' && text")
    expect(render).toContain('inheritedBackgroundColor')
    expect(render).toContain('rawBgRewriteCache')
  })
})
