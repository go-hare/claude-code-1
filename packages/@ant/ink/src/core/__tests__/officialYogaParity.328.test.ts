import { describe, expect, test } from 'bun:test'
import * as dom from '../dom.js'
import { LayoutController } from '../layout-controller.js'
import type { YogaLayoutNode } from '../layout/yoga.js'
import Yoga, {
  Align,
  clearLayoutCacheRecursive,
  Display,
  Edge,
  FlexDirection,
  Gutter,
  getYogaCounters,
  isYogaNodeIntact,
  Justify,
  MeasureMode,
  Overflow,
  PositionType,
  Wrap,
} from '../yoga-layout/index.js'

describe('Official 2.1.328 pure-JS Yoga engine parity', () => {
  test('row/column/reverse directions and justifyContent/alignItems/alignSelf', () => {
    const cfg = Yoga.Config.create()
    const root = Yoga.Node.create(cfg)
    root.setWidth(20)
    root.setHeight(10)
    root.setFlexDirection(FlexDirection.RowReverse)
    root.setJustifyContent(Justify.SpaceBetween)
    root.setAlignItems(Align.Center)

    const a = Yoga.Node.create(cfg)
    a.setWidth(4)
    a.setHeight(2)
    const b = Yoga.Node.create(cfg)
    b.setWidth(6)
    b.setHeight(4)
    b.setAlignSelf(Align.FlexEnd)

    root.insertChild(a, 0)
    root.insertChild(b, 1)
    root.calculateLayout(20, 10)

    // RowReverse + SpaceBetween: a at right edge (20 - 4 = 16), b at left edge (0)
    expect(a.getComputedLeft()).toBe(16)
    expect(a.getComputedTop()).toBe(4) // centered in height 10: (10 - 2)/2 = 4
    expect(b.getComputedLeft()).toBe(0)
    expect(b.getComputedTop()).toBe(6) // flex-end: 10 - 4 = 6

    // ColumnReverse
    root.setFlexDirection(FlexDirection.ColumnReverse)
    root.setJustifyContent(Justify.FlexStart)
    root.setAlignItems(Align.FlexStart)
    b.setAlignSelf(Align.Auto)
    root.calculateLayout(20, 10)

    expect(a.getComputedTop()).toBe(8) // 10 - 2
    expect(b.getComputedTop()).toBe(4) // 10 - 2 - 4
  })

  test('flexWrap, wrapReverse, and alignContent line distribution', () => {
    const cfg = Yoga.Config.create()
    const root = Yoga.Node.create(cfg)
    root.setWidth(10)
    root.setHeight(10)
    root.setFlexDirection(FlexDirection.Row)
    root.setFlexWrap(Wrap.Wrap)
    root.setAlignContent(Align.SpaceBetween)
    root.setGap(Gutter.Column, 2)

    const c1 = Yoga.Node.create(cfg)
    c1.setWidth(5)
    c1.setHeight(2)
    const c2 = Yoga.Node.create(cfg)
    c2.setWidth(5)
    c2.setHeight(2)
    const c3 = Yoga.Node.create(cfg)
    c3.setWidth(4)
    c3.setHeight(3)

    root.insertChild(c1, 0)
    root.insertChild(c2, 1)
    root.insertChild(c3, 2)
    root.calculateLayout(10, 10)

    // c1 (5) + gap (2) + c2 (5) = 12 > 10 -> wraps into 3 items across 2 lines: [c1], [c2, c3]
    expect(c1.getComputedLeft()).toBe(0)
    expect(c1.getComputedTop()).toBe(0)
    // Line 2 has c2 (5) + gap (2) + c3 (4) = 11 > 10 -> wraps again into 3 lines: [c1], [c2], [c3]
    // SpaceBetween across height 10 with heights 2,2,3 (total 7, free 3 -> gap 1.5):
    // line 0 top=0, line 1 top=round(3.5)=4, line 2 top=round(7)=7
    expect(c2.getComputedTop()).toBe(4)
    expect(c3.getComputedTop()).toBe(7)

    // WrapReverse reverses cross-axis stacking
    root.setFlexWrap(Wrap.WrapReverse)
    root.setAlignContent(Align.FlexStart)
    root.calculateLayout(10, 10)
    expect(c1.getComputedTop()).toBe(8) // 10 - 0 - 2
    expect(c2.getComputedTop()).toBe(6) // 10 - 2 - 2
    expect(c3.getComputedTop()).toBe(3) // 10 - 4 - 3
  })

  test('flexGrow, flexShrink, flexBasis, min/max clamping, and cumulative rounding', () => {
    const cfg = Yoga.Config.create()
    const root = Yoga.Node.create(cfg)
    root.setWidth(10)
    root.setFlexDirection(FlexDirection.Row)

    // Three equal flexGrow:1 children in width 10 -> cumulative rounding 3 + 4 + 3 = 10
    const kids = [0, 1, 2].map(() => {
      const n = Yoga.Node.create(cfg)
      n.setFlexGrow(1)
      n.setFlexBasis(0)
      n.setHeight(1)
      return n
    })
    kids.forEach((k, i) => root.insertChild(k, i))
    root.calculateLayout(10, undefined)

    const widths = kids.map(k => k.getComputedWidth())
    expect(widths.reduce((a, b) => a + b, 0)).toBe(10)
    expect(widths).toEqual([3, 4, 3])
    expect(kids[2]!.getComputedLeft() + kids[2]!.getComputedWidth()).toBe(10)

    // Multi-pass clamping with maxWidth: first child capped at 2, remaining 8 split 4 + 4
    kids[0]!.setMaxWidth(2)
    root.calculateLayout(10, undefined)
    expect(kids.map(k => k.getComputedWidth())).toEqual([2, 4, 4])

    // FlexShrink with minWidth clamp
    const shrinkRoot = Yoga.Node.create(cfg)
    shrinkRoot.setWidth(10)
    shrinkRoot.setFlexDirection(FlexDirection.Row)
    const s1 = Yoga.Node.create(cfg)
    s1.setWidth(10)
    s1.setMinWidth(7)
    s1.setFlexShrink(1)
    s1.setHeight(1)
    const s2 = Yoga.Node.create(cfg)
    s2.setWidth(10)
    s2.setFlexShrink(1)
    s2.setHeight(1)
    shrinkRoot.insertChild(s1, 0)
    shrinkRoot.insertChild(s2, 1)
    shrinkRoot.calculateLayout(10, undefined)
    expect(s1.getComputedWidth()).toBe(7)
    expect(s2.getComputedWidth()).toBe(3)
  })

  test('percent dimensions, padding, border, margin, auto margin, gap, and edge precedence', () => {
    const cfg = Yoga.Config.create()
    const root = Yoga.Node.create(cfg)
    root.setWidth(40)
    root.setHeight(20)
    root.setFlexDirection(FlexDirection.Row)
    // Edge precedence: Start > Left > Horizontal > All
    root.setPadding(Edge.All, 1)
    root.setPadding(Edge.Horizontal, 2)
    root.setPadding(Edge.Left, 3)
    root.setPadding(Edge.Start, 4)
    root.setBorder(Edge.All, 1)
    root.setGap(Gutter.All, 2)

    const c1 = Yoga.Node.create(cfg)
    c1.setWidthPercent(50) // 50% of inner width (40 - (4+2) - (1+1) = 32) = 16
    c1.setHeightPercent(50) // 50% of inner height (20 - (1+1) - (1+1) = 16) = 8

    const c2 = Yoga.Node.create(cfg)
    c2.setWidth(6)
    c2.setHeight(4)
    c2.setMarginAuto(Edge.Left) // pushes c2 to right edge
    c2.setMarginAuto(Edge.Top)
    c2.setMarginAuto(Edge.Bottom) // centers c2 vertically

    root.insertChild(c1, 0)
    root.insertChild(c2, 1)
    root.calculateLayout(40, 20)

    expect(root.getComputedPadding(Edge.Left)).toBe(4)
    expect(root.getComputedPadding(Edge.Right)).toBe(2)
    expect(root.getComputedPadding(Edge.Top)).toBe(1)
    expect(root.getComputedBorder(Edge.Left)).toBe(1)

    expect(c1.getComputedWidth()).toBe(16)
    expect(c1.getComputedHeight()).toBe(8)
    expect(c1.getComputedLeft()).toBe(5) // border(1) + paddingStart(4)
    expect(c1.getComputedTop()).toBe(2) // border(1) + paddingTop(1)

    // c2 pushed to right inner edge: 40 - borderRight(1) - paddingRight(2) - width(6) = 31
    expect(c2.getComputedLeft()).toBe(31)
    // c2 centered vertically in inner height 16: border(1)+pad(1) + (16 - 4)/2 = 8
    expect(c2.getComputedTop()).toBe(8)
  })

  test('absolute positioning (insets, opposite inset stretch, fallback alignment) and display: none', () => {
    const cfg = Yoga.Config.create()
    const root = Yoga.Node.create(cfg)
    root.setWidth(30)
    root.setHeight(12)
    root.setBorder(Edge.All, 1)

    // Opposite insets stretch width & height inside border box (28x10)
    const stretched = Yoga.Node.create(cfg)
    stretched.setPositionType(PositionType.Absolute)
    stretched.setPosition(Edge.Left, 2)
    stretched.setPosition(Edge.Right, 4)
    stretched.setPosition(Edge.Top, 1)
    stretched.setPosition(Edge.Bottom, 3)

    // Bottom-right anchored
    const corner = Yoga.Node.create(cfg)
    corner.setPositionType(PositionType.Absolute)
    corner.setWidth(5)
    corner.setHeight(2)
    corner.setPosition(Edge.Right, 1)
    corner.setPosition(Edge.Bottom, 1)

    // Hidden subtree with grandchild
    const hidden = Yoga.Node.create(cfg)
    hidden.setDisplay(Display.None)
    hidden.setWidth(10)
    hidden.setHeight(5)
    const grand = Yoga.Node.create(cfg)
    grand.setWidth(8)
    grand.setHeight(3)
    hidden.insertChild(grand, 0)

    root.insertChild(stretched, 0)
    root.insertChild(corner, 1)
    root.insertChild(hidden, 2)
    root.calculateLayout(30, 12)

    expect(stretched.getComputedLeft()).toBe(3) // border(1) + left(2)
    expect(stretched.getComputedTop()).toBe(2) // border(1) + top(1)
    expect(stretched.getComputedWidth()).toBe(22) // 28 - 2 - 4
    expect(stretched.getComputedHeight()).toBe(6) // 10 - 1 - 3

    expect(corner.getComputedLeft()).toBe(23) // 30 - border(1) - right(1) - width(5)
    expect(corner.getComputedTop()).toBe(8) // 12 - border(1) - bottom(1) - height(2)

    expect(hidden.getComputedWidth()).toBe(0)
    expect(grand.getComputedWidth()).toBe(0)

    // Unhide restores grandchild layout cleanly (cache invalidated on hide)
    hidden.setDisplay(Display.Flex)
    root.calculateLayout(30, 12)
    expect(hidden.getComputedWidth()).toBe(10)
    expect(grand.getComputedWidth()).toBe(8)
    expect(grand.getComputedHeight()).toBe(3)
  })

  test('measureFunc caching (_mfC), getOfferedWidth, markDirty invalidation, and Ib(root) counters', () => {
    const cfg = Yoga.Config.create()
    const root = Yoga.Node.create(cfg)
    root.setFlexDirection(FlexDirection.Column)
    root.setAlignItems(Align.FlexStart)
    root.setOverflow(Overflow.Visible)

    let text = 'hello world'
    let rawMeasureCalls = 0
    const leaf = Yoga.Node.create(cfg)
    leaf.setMeasureFunc((w, mode) => {
      rawMeasureCalls++
      const avail =
        mode === MeasureMode.Undefined || Number.isNaN(w)
          ? Number.POSITIVE_INFINITY
          : Math.max(1, w)
      // Simulate word-wrap: when constrained to 7 cols, 'hello' (5) + 'world' (5) -> width 5, height 2
      if (text === 'hello world' && avail >= 5 && avail < 11) {
        return { width: 5, height: 2 }
      }
      return {
        width: Math.min(text.length, avail),
        height: Math.ceil(text.length / avail),
      }
    })
    root.insertChild(leaf, 0)

    expect(cfg.generation).toBe(0)
    root.calculateLayout(40, undefined)
    expect(cfg.generation).toBe(1)
    expect(leaf.getComputedWidth()).toBe(11)
    expect(leaf.getComputedHeight()).toBe(1)
    expect(rawMeasureCalls).toBe(1)

    const c1 = getYogaCounters(root)
    expect(c1.live).toBe(2)
    expect(c1.visited).toBeGreaterThan(0)
    expect(c1.measured).toBeGreaterThan(0)
    // 0-arg getYogaCounters() matches last calculated config
    expect(getYogaCounters()).toEqual(c1)

    // Re-layout at same width hits layout cache — zero raw measureFunc calls!
    const callsBefore = rawMeasureCalls
    root.calculateLayout(40, undefined)
    expect(cfg.generation).toBe(2)
    expect(rawMeasureCalls).toBe(callsBefore)
    const c2 = getYogaCounters(root)
    expect(c2.cacheHits).toBeGreaterThan(0)

    // Narrowing AtMost 40 -> AtMost 20 (still >= cached width 11) reuses _mfC!
    root.calculateLayout(20, undefined)
    expect(cfg.generation).toBe(3)
    expect(rawMeasureCalls).toBe(callsBefore)
    expect(getYogaCounters(root).measureCacheHits).toBeGreaterThan(0)

    // Wrap case: AtMost 7 produces width 5, height 2 -> getOfferedWidth(5, 2) recovers 7!
    root.calculateLayout(7, undefined)
    expect(leaf.getComputedWidth()).toBe(5)
    expect(leaf.getComputedHeight()).toBe(2)
    expect(leaf.getOfferedWidth(5, 2)).toBe(7)

    // markDirty invalidates _mfC and forces re-measure
    text = 'hi'
    leaf.markDirty()
    const beforeDirty = rawMeasureCalls
    root.calculateLayout(7, undefined)
    expect(rawMeasureCalls).toBeGreaterThan(beforeDirty)
    expect(leaf.getComputedWidth()).toBe(2)
    expect(leaf.getComputedHeight()).toBe(1)

    // clearLayoutCacheRecursive invalidates subtree caches
    clearLayoutCacheRecursive(root)
    expect(root.isDirty()).toBe(true)
    expect(leaf.isDirty()).toBe(true)

    // Cross-config insertChild throws official error
    const otherCfg = Yoga.Config.create()
    const foreign = Yoga.Node.create(otherCfg)
    expect(() => root.insertChild(foreign, 1)).toThrow(
      'insertChild: child was created with a different Config',
    )

    // freeRecursive decrements liveNodes accurately
    foreign.free()
    expect(getYogaCounters(foreign).live).toBe(0)
    root.freeRecursive()
    expect(getYogaCounters(root).live).toBe(0)
  })

  test('isYogaNodeIntact (aC) validates every Int32Array backing buffer', () => {
    const cfg = Yoga.Config.create()
    const node = Yoga.Node.create(cfg)
    expect(isYogaNodeIntact(node)).toBe(true)
    expect(node.layout.border).toBeInstanceOf(Int32Array)
    expect(node.layout.border.length).toBe(4)
    expect(node.layout.padding).toBeInstanceOf(Int32Array)
    expect(node.layout.padding.length).toBe(4)
    expect(node.layout.margin).toBeInstanceOf(Int32Array)
    expect(node.layout.margin.length).toBe(4)
    expect(node._lc).toBeInstanceOf(Int32Array)
    expect(node._lc.length).toBe(6)
    expect(node._mc).toBeInstanceOf(Int32Array)
    expect(node._mc.length).toBe(6)
    expect(node._fb).toBeInstanceOf(Int32Array)
    expect(node._fb.length).toBe(5)

    // Corrupting any backing buffer fails aC(node)
    const savedLc = node._lc
    node._lc = new Int32Array(2)
    expect(isYogaNodeIntact(node)).toBe(false)
    node._lc = savedLc
    expect(isYogaNodeIntact(node)).toBe(true)

    const savedBorder = node.layout.border
    node.layout.border = new Int32Array(2)
    expect(isYogaNodeIntact(node)).toBe(false)
    node.layout.border = savedBorder

    node._c = new Int32Array(12) // expected 80
    expect(isYogaNodeIntact(node)).toBe(false)
    node._c = new Int32Array(80)
    expect(isYogaNodeIntact(node)).toBe(true)

    node._mfC = new Int32Array(10) // expected 24
    expect(isYogaNodeIntact(node)).toBe(false)
    node._mfC = null
    expect(isYogaNodeIntact(node)).toBe(true)

    node.children = null as unknown as typeof node.children
    expect(isYogaNodeIntact(node)).toBe(false)
  })

  test('LayoutController wires onDamage, detects damaged buffers/numbers, and recovers via replaceLayoutNodes()', () => {
    const cfg = Yoga.Config.create()
    const root = dom.createNode('ink-root', cfg)
    const box = dom.createNode('ink-box', cfg)
    dom.setStyle(box, { width: 12, height: 3 })
    box.yogaNode!.setWidth(12)
    box.yogaNode!.setHeight(3)
    dom.appendChildNode(root, box)

    let prevFrameInvalidations = 0
    let damagedTelemetryCount = 0
    const faultErrors: Error[] = []

    const controller = new LayoutController(root, cfg, {
      width: () => 40,
      onFailed: () => {},
      invalidatePrevFrame: () => {
        prevFrameInvalidations++
      },
      onDamagedLayout: () => {
        damagedTelemetryCount++
      },
      onFaultError: err => {
        faultErrors.push(err)
      },
    })

    // Initial clean layout pass populates Ib(root) counters
    controller.runLayoutPass()
    expect(controller.layoutDamaged).toBe(false)
    expect(box.yogaNode!.getComputedWidth()).toBe(12)
    expect(box.yogaNode!.getComputedHeight()).toBe(3)
    const counters = controller.takeYogaCounters()
    expect(counters.visited).toBeGreaterThanOrEqual(2)
    expect(counters.live).toBe(2)

    // 1. Corrupt Int32Array backing buffer -> runLayoutPass throws in fC (aC check) & auto-recovers
    const oldRootYoga = root.yogaNode
    const oldBoxYoga = box.yogaNode
    ;(root.yogaNode as YogaLayoutNode).yoga._lc = new Int32Array(1)
    expect(root.yogaNode!.isIntact?.()).toBe(false)

    controller.runLayoutPass()
    expect(controller.layoutDamaged).toBe(false)
    expect(controller.failedLayouts).toBe(0)
    expect(root.yogaNode).not.toBe(oldRootYoga)
    expect(box.yogaNode).not.toBe(oldBoxYoga)
    expect(root.yogaNode!.isIntact?.()).toBe(true)
    expect(box.yogaNode!.getComputedWidth()).toBe(12)
    expect(box.yogaNode!.getComputedHeight()).toBe(3)
    expect(prevFrameInvalidations).toBe(1)
    // liveNodes stays balanced (2) after replaceLayoutNodes()!
    expect(controller.takeYogaCounters().live).toBe(2)

    // 2. Non-int32 computed value during paint(false, ...) triggers onDamage -> throws & paint returns undefined
    ;(box.yogaNode as YogaLayoutNode).yoga.layout.width = Number.NaN
    const paintResult = controller.paint(false, () => {
      return box.yogaNode!.getComputedWidth()
    })
    expect(paintResult).toBeUndefined()
    expect(controller.layoutDamaged).toBe(true)

    // Subsequent runLayoutPass sees layoutDamaged, calls countDamagedLayout, and replaces nodes
    const beforeDamageReplace = box.yogaNode
    controller.runLayoutPass()
    expect(controller.layoutDamaged).toBe(false)
    expect(controller.damagedLayouts).toBe(1)
    expect(damagedTelemetryCount).toBe(1)
    expect(box.yogaNode).not.toBe(beforeDamageReplace)
    expect(box.yogaNode!.getComputedWidth()).toBe(12)
    expect(prevFrameInvalidations).toBe(2)

    // 3. Repeated damage up to hA = 8 disables cfg.checksNumbers and reports error
    for (let i = 2; i <= 8; i++) {
      ;(box.yogaNode as YogaLayoutNode).yoga.layout.width = 1.5
      // Trigger onDamage outside paint() -> sets layoutDamaged without throwing
      expect(box.yogaNode!.getComputedWidth()).toBe(0)
      expect(controller.layoutDamaged).toBe(true)
      controller.runLayoutPass()
      expect(controller.damagedLayouts).toBe(i)
    }
    expect(cfg.checksNumbers).toBe(false)
    expect(
      faultErrors.some(e =>
        e.message.includes(
          'ink layout records keep being damaged; odd numbers no longer checked',
        ),
      ),
    ).toBe(true)

    // With checksNumbers=false, non-integer numbers pass through without triggering damage
    ;(box.yogaNode as YogaLayoutNode).yoga.layout.width = 1.5
    expect(box.yogaNode!.getComputedWidth()).toBe(1.5)
    expect(controller.layoutDamaged).toBe(false)
  })
})
