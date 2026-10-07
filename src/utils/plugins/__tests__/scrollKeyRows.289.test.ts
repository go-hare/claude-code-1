import { afterEach, describe, expect, test } from 'bun:test'
import {
  alignScrollToKeyRows,
  bindPluginScrollSiteLayout,
  getPluginScrollSite,
  handleHostOp,
  heldFocusEdge,
  layoutKeyRows,
  layoutOffsetTop,
  nearestScrollOffset,
  noteDrawnElement,
  registerPluginScrollSite,
  scrollSiteKeyRows,
  setLoadedFunctionHooksModules,
  unregisterPluginScrollSite,
  type ScrollSiteLayoutNode,
} from '../functionHooksModules.js'

afterEach(() => {
  setLoadedFunctionHooksModules([])
  unregisterPluginScrollSite('plug', 'pane-1')
})

function yoga(top: number, height: number) {
  return {
    getComputedTop: () => top,
    getComputedHeight: () => height,
  }
}

describe('densable 2.1.289 Ide keyRows / kat / cEe', () => {
  test('OMr nearest: already in view stays; above jumps to top; below clamps', () => {
    expect(
      nearestScrollOffset({ offset: 5, bodyRows: 10, top: 6, bottom: 9 }),
    ).toBe(5)
    expect(
      nearestScrollOffset({ offset: 10, bodyRows: 10, top: 2, bottom: 4 }),
    ).toBe(2)
    expect(
      nearestScrollOffset({ offset: 0, bodyRows: 10, top: 20, bottom: 24 }),
    ).toBe(14)
  })

  test('Jq heldFocusEdge: stale/missing → -1; top/bottom from yoga', () => {
    const child: ScrollSiteLayoutNode = {
      nodeName: 'ink-box',
      childNodes: [],
      yogaNode: yoga(4, 3),
    }
    const root: ScrollSiteLayoutNode = {
      nodeName: 'ink-box',
      childNodes: [child],
      yogaNode: yoga(0, 20),
    }
    child.parentNode = root
    expect(heldFocusEdge({ held: null, index: 0, content: root }, 'top')).toBe(
      -1,
    )
    expect(
      heldFocusEdge(
        { held: { node: child, index: 1 }, index: 0, content: root },
        'top',
      ),
    ).toBe(-1)
    expect(
      heldFocusEdge(
        { held: { node: child, index: 0 }, index: 0, content: null },
        'top',
      ),
    ).toBe(-1)
    expect(
      heldFocusEdge(
        { held: { node: child, index: 0 }, index: 0, content: root },
        'top',
      ),
    ).toBe(4)
    expect(
      heldFocusEdge(
        { held: { node: child, index: 0 }, index: 0, content: root },
        'bottom',
      ),
    ).toBe(7)
  })

  test('kat start/end/center/nearest + taller-than-viewport starts at top', () => {
    const rows = { offset: 0, bodyRows: 10, top: 20, bottom: 24 }
    expect(alignScrollToKeyRows(rows, 'start')).toBe(20)
    expect(alignScrollToKeyRows(rows, 'end')).toBe(14)
    expect(alignScrollToKeyRows(rows, 'center')).toBe(17)
    expect(alignScrollToKeyRows({ ...rows, offset: 0 }, 'nearest')).toBe(14)
    expect(
      alignScrollToKeyRows(
        { offset: 0, bodyRows: 4, top: 10, bottom: 20 },
        'center',
      ),
    ).toBe(10)
  })

  test('cEe DFS finds descendant elementKey; skips root; plugin optional', () => {
    const child: ScrollSiteLayoutNode = {
      nodeName: 'ink-box',
      attributes: { elementKey: 'k', elementPlugin: 'plug' },
      childNodes: [],
      yogaNode: yoga(3, 2),
    }
    const root: ScrollSiteLayoutNode = {
      nodeName: 'ink-box',
      attributes: { elementKey: 'k', elementPlugin: 'other' },
      childNodes: [child],
      yogaNode: yoga(0, 10),
    }
    child.parentNode = root
    expect(layoutKeyRows(root, 'k', 'plug')).toEqual({ top: 3, bottom: 5 })
    expect(layoutKeyRows(root, 'k', 'other')).toBeUndefined()
    expect(layoutOffsetTop(child, root)).toBe(3)
  })

  test('ui.scroll {to:{key}} commits kat offset when layout bound', async () => {
    registerPluginScrollSite('plug', 'pane-1', 'Pane', {
      offset: 0,
      maxOffset: 40,
      bodyRows: 10,
      contentRows: 50,
    })
    noteDrawnElement('plug', 'pane-1', 'k')
    const child: ScrollSiteLayoutNode = {
      nodeName: 'ink-box',
      attributes: { elementKey: 'k', elementPlugin: 'plug' },
      childNodes: [],
      yogaNode: yoga(20, 4),
    }
    const root: ScrollSiteLayoutNode = {
      nodeName: 'ink-box',
      childNodes: [child],
      yogaNode: yoga(0, 50),
    }
    child.parentNode = root
    bindPluginScrollSiteLayout('plug', 'pane-1', root)
    expect(
      scrollSiteKeyRows(getPluginScrollSite('plug', 'pane-1')!, 'plug', 'k'),
    ).toEqual({
      top: 20,
      bottom: 24,
    })
    expect(
      await handleHostOp(
        'ui.scroll',
        [{ to: { key: 'k' }, in: 'pane-1', block: 'start' }],
        'plug',
      ),
    ).toEqual({})
    expect(getPluginScrollSite('plug', 'pane-1')?.offset).toBe(20)
  })

  test('ui.scroll missing key → no element of its own is drawn under that key', async () => {
    registerPluginScrollSite('plug', 'pane-1', 'Pane', {
      offset: 0,
      maxOffset: 4,
      bodyRows: 10,
    })
    expect(
      await handleHostOp('ui.scroll', [{ to: { key: 'missing' } }], 'plug'),
    ).toEqual({ deny: 'no element of its own is drawn under that key' })
  })

  test('contentRoot yoga hit without noteDrawnElement', async () => {
    registerPluginScrollSite('plug', 'pane-1', 'Pane', {
      offset: 0,
      maxOffset: 40,
      bodyRows: 10,
      contentRows: 50,
    })
    const child: ScrollSiteLayoutNode = {
      nodeName: 'ink-box',
      attributes: { elementKey: 'img', elementPlugin: 'plug' },
      childNodes: [],
      yogaNode: yoga(12, 3),
    }
    const root: ScrollSiteLayoutNode = {
      nodeName: 'ink-box',
      childNodes: [child],
      yogaNode: yoga(0, 50),
    }
    child.parentNode = root
    bindPluginScrollSiteLayout('plug', 'pane-1', root)
    expect(
      scrollSiteKeyRows(getPluginScrollSite('plug', 'pane-1')!, 'plug', 'img'),
    ).toEqual({ top: 12, bottom: 15 })
    expect(
      await handleHostOp(
        'ui.scroll',
        [{ to: { key: 'img' }, in: 'pane-1', block: 'start' }],
        'plug',
      ),
    ).toEqual({})
    expect(getPluginScrollSite('plug', 'pane-1')?.offset).toBe(12)
  })

  test('ui.scroll to start/end goes through QLt commit', async () => {
    registerPluginScrollSite('plug', 'pane-1', 'Pane', {
      offset: 3,
      maxOffset: 8,
      bodyRows: 10,
    })
    expect(
      await handleHostOp('ui.scroll', [{ to: 'start', in: 'pane-1' }], 'plug'),
    ).toEqual({})
    expect(getPluginScrollSite('plug', 'pane-1')?.offset).toBe(0)
    expect(getPluginScrollSite('plug', 'pane-1')?.followEnd).toBe(false)
    expect(
      await handleHostOp('ui.scroll', [{ to: 'end', in: 'pane-1' }], 'plug'),
    ).toEqual({})
    expect(getPluginScrollSite('plug', 'pane-1')?.offset).toBe(8)
    expect(getPluginScrollSite('plug', 'pane-1')?.followEnd).toBe(true)
  })
})
