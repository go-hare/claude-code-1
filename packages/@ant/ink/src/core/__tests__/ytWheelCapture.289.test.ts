/**
 * densable 2.1.289 Yt `eo` / lag wheel.
 * Gold: ancestor-only VC; eo AND R6. No column-x dive.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DOMElement } from '../dom.js'
import { hitTest, wheelCaptureOwnedByDescendant } from '../hit-test.js'
import { nodeCache } from '../node-cache.js'

function makeBox(
  rect: { x: number; y: number; width: number; height: number },
  parent?: DOMElement,
): DOMElement {
  const node = {
    nodeName: 'ink-box' as const,
    attributes: {},
    childNodes: [] as DOMElement[],
    style: {},
    dirty: false,
    parentNode: parent,
  } as DOMElement
  if (parent) parent.childNodes.push(node)
  nodeCache.set(node, rect)
  return node
}

describe('densable 2.1.289 Yt eo wheel capture', () => {
  test('descendant onWheel inside hit rect owns capture (skip synthesize)', () => {
    const root = makeBox({ x: 0, y: 0, width: 100, height: 40 })
    const left = makeBox({ x: 0, y: 0, width: 60, height: 40 }, root)
    const right = makeBox({ x: 60, y: 0, width: 40, height: 40 }, root)
    right._eventHandlers = { onWheel: () => {} }
    expect(wheelCaptureOwnedByDescendant(right, root, 70, 10)).toBe(true)
    expect(wheelCaptureOwnedByDescendant(left, root, 10, 10)).toBe(false)
  })

  test('gold R6: uncached child is skipped (no grandchild search)', () => {
    const root = makeBox({ x: 0, y: 0, width: 100, height: 40 })
    const sidebar = makeBox({ x: 60, y: 0, width: 40, height: 40 }, root)
    const pane = makeBox({ x: 60, y: 0, width: 40, height: 40 }, sidebar)
    pane._eventHandlers = { onWheel: () => {} }
    nodeCache.delete(sidebar)
    expect(hitTest(root, 70, 10)).toBe(root)
    expect(hitTest(sidebar, 70, 10)).toBeNull()
  })

  test('gold eo: onWheel AND R6 — uncached node does not own', () => {
    const root = makeBox({ x: 0, y: 0, width: 100, height: 40 })
    const right = makeBox({ x: 60, y: 0, width: 40, height: 8 }, root)
    right._eventHandlers = { onWheel: () => {} }
    expect(wheelCaptureOwnedByDescendant(right, root, 70, 20)).toBe(false)
    nodeCache.delete(right)
    expect(wheelCaptureOwnedByDescendant(right, root, 70, 10)).toBe(false)
  })

  test('gold VC is ancestor-only: stretched sidebar shell does not dive to Obe', () => {
    const root = makeBox({ x: 0, y: 0, width: 100, height: 40 })
    const sidebar = makeBox({ x: 60, y: 0, width: 40, height: 40 }, root)
    const pane = makeBox({ x: 60, y: 0, width: 40, height: 8 }, sidebar)
    pane._eventHandlers = { onWheel: () => {} }
    expect(hitTest(root, 70, 20)).toBe(sidebar)
    const hit = readFileSync(join(import.meta.dir, '../hit-test.ts'), 'utf8')
    expect(hit).not.toContain('export function findWheelEventTarget')
    const ink = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
    expect(ink).not.toContain('findWheelEventTarget')
    expect(ink).toContain('(hit && nodeHasWheelHandler(hit) ? hit : null)')
  })

  test('missing col/row still owns when onWheel is on the walk', () => {
    const root = makeBox({ x: 0, y: 0, width: 10, height: 10 })
    const pane = makeBox({ x: 0, y: 0, width: 10, height: 10 }, root)
    pane._eventHandlers = { onWheel: () => {} }
    expect(
      wheelCaptureOwnedByDescendant(pane, root, undefined, undefined),
    ).toBe(true)
  })

  test('App lag never emits InputEvent for wheelup/wheeldown', () => {
    const app = readFileSync(
      join(import.meta.dir, '../../components/App.tsx'),
      'utf8',
    )
    const setup = readFileSync(
      join(import.meta.dir, '../../keybindings/KeybindingSetup.tsx'),
      'utf8',
    )
    const ink = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
    expect(app).toContain(
      'app.props.dispatchWheelEvent?.(convertWheelIfPixels(app, item));',
    )
    const nonMouse = app.slice(
      app.indexOf("if (item.name !== 'mouse')"),
      app.indexOf(
        'const event = new InputEvent(item);',
        app.indexOf("if (item.name !== 'mouse')"),
      ),
    )
    expect(nonMouse).toContain('continue;')
    expect(nonMouse).not.toContain("internal_eventEmitter.emit('input'")
    expect(setup).toContain('onWheelCapture={handleWheelCapture}')
    expect(setup).toContain('wheelCaptureOwnedByDescendant')
    expect(setup).toContain('onKeyDownCapture={handleKeyDownCapture}')
    expect(setup).toContain('function kmo(')
    expect(setup).toContain('reclaimIfNullOrAncestor')
    expect(setup).not.toContain('useFocusReclaim(keybindingRootRef')
    expect(setup).not.toContain('onKeyDownCapture={() => {}}')
    expect(setup).not.toContain('onKeyDownCapture={() => {')
    expect(app).not.toContain(
      "app.internal_eventEmitter.emit('input', event);\n    }",
    )
    expect(ink).toContain('if (this.pointerCapture) return;')
    expect(ink).not.toContain('findWheelEventTarget')
    expect(ink).not.toContain('return event.defaultPrevented;')
  })
})
