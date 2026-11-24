/**
 * Pure-TypeScript 1:1 port of official Claude Code 2.1.328's pure-JS Yoga
 * flexbox layout engine (`chunk@306863829.js`: `class au`, `Fb`, `aC`, `uC`,
 * `cC`, `Ib`, `dC`, `fC`, `rs`, `hC`, `Nf`, `mC`, `yC`, `bC`, `gC`, `xC`,
 * `vC`, `SC`, `EC`, `wC`, `CC`/`RC`/`TC`, `MC`, `DC`).
 *
 * Key properties matching official 2.1.328:
 *   - Integer-exact terminal layout (`Int32Array` backing buffers & rounding)
 *   - Per-config counters (`generation`, `nodesVisited`, `measureCalls`,
 *     `measureCacheHits`, `cacheHits`, `liveNodes`) + `onDamage` / `checksNumbers`
 *   - Structural integrity validation `isYogaNodeIntact(node)` (`aC`)
 *   - Multi-entry layout measure cache (`_c`, 8×10 ints) & measureFunc cache
 *     (`_mfC`, 4×6 ints) with `getOfferedWidth` & `markDirty` invalidation
 */

import {
  Align,
  BoxSizing,
  Dimension,
  Direction,
  Display,
  Edge,
  Errata,
  ExperimentalFeature,
  FlexDirection,
  Gutter,
  Justify,
  MeasureMode,
  Overflow,
  PositionType,
  Unit,
  Wrap,
} from './enums.js'

export {
  Align,
  BoxSizing,
  Dimension,
  Direction,
  Display,
  Edge,
  Errata,
  ExperimentalFeature,
  FlexDirection,
  Gutter,
  Justify,
  MeasureMode,
  Overflow,
  PositionType,
  Unit,
  Wrap,
}

// --
// Value types & int32 helpers (`cn`, `ni`, `Pr`, `cu`, `rr`, `wt`, `pt`, `ol`, `or`, `kt`, `Cf`)

export type Value = {
  unit: Unit
  value: number
}

const UNDEFINED_VALUE: Value = { unit: Unit.Undefined, value: NaN }
const AUTO_VALUE: Value = { unit: Unit.Auto, value: NaN }

const NAN_SENTINEL = -2147483648 // `ol` (INT32_MIN sentinel for NaN in Int32Array caches)
const SZ_FLEX_BASIS = 0 // `fo`
const SZ_MAIN_SIZE = 1 // `co`
const SZ_CROSS_SIZE = 2 // `al`

const CACHE_SLOTS = 8 // `uu`
const MEASURE_CACHE_SLOTS = 4 // `sl`

const FB_BASIS = 0 // `Eb`
const FB_OWNER_W = 1 // `wb`
const FB_OWNER_H = 2 // `Cb`
const FB_AVAIL_MAIN = 3 // `Rb`
const FB_AVAIL_CROSS = 4 // `Tb`

function isInt32Range(v: number): boolean {
  return Number.isFinite(v) && Math.abs(v) <= 2147483647
}

function roundInt(v: number): number {
  return v >= 0 ? (v + 0.5) | 0 : (v - 0.5) | 0
}

function packInt(v: number): number {
  return Number.isNaN(v) ? NAN_SENTINEL : v
}

function pointValue(v: number): Value {
  return isInt32Range(v)
    ? { unit: Unit.Point, value: roundInt(v) }
    : UNDEFINED_VALUE
}

function percentValue(v: number): Value {
  return isInt32Range(v) ? { unit: Unit.Percent, value: v } : UNDEFINED_VALUE
}

function resolveValue(v: Value, ownerSize: number): number {
  switch (v.unit) {
    case Unit.Point:
      return v.value
    case Unit.Percent: {
      const r = (v.value * ownerSize) / 100
      return isInt32Range(r) ? roundInt(r) : NaN
    }
    default:
      return NaN
  }
}

function isDefined(v: number): boolean {
  return !Number.isNaN(v)
}

function allocIntCache(length: number): Int32Array {
  return new Int32Array(length).fill(NAN_SENTINEL)
}

function isInt32ArrayOfLength(length: number, val: unknown): val is Int32Array {
  return val instanceof Int32Array && val.length === length
}

// --
// Layout result (computed integer values backed by Int32Array edge buffers)

type Layout = {
  left: number
  top: number
  width: number
  height: number
  border: Int32Array // length 4: left, top, right, bottom
  padding: Int32Array // length 4
  margin: Int32Array // length 4
}

// --
// Style (input values)

type Style = {
  direction: Direction
  flexDirection: FlexDirection
  justifyContent: Justify
  alignItems: Align
  alignSelf: Align
  alignContent: Align
  flexWrap: Wrap
  overflow: Overflow
  display: Display
  positionType: PositionType

  flexGrow: number
  flexShrink: number
  flexBasis: Value

  // 9-edge arrays indexed by Edge enum
  margin: Value[]
  padding: Value[]
  border: Value[]
  position: Value[]

  // 3-gutter array indexed by Gutter enum
  gap: Value[]

  width: Value
  height: Value
  minWidth: Value
  minHeight: Value
  maxWidth: Value
  maxHeight: Value
}

function defaultStyle(): Style {
  return {
    direction: Direction.Inherit,
    flexDirection: FlexDirection.Column,
    justifyContent: Justify.FlexStart,
    alignItems: Align.Stretch,
    alignSelf: Align.Auto,
    alignContent: Align.FlexStart,
    flexWrap: Wrap.NoWrap,
    overflow: Overflow.Visible,
    display: Display.Flex,
    positionType: PositionType.Relative,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: AUTO_VALUE,
    margin: new Array<Value>(9).fill(UNDEFINED_VALUE),
    padding: new Array<Value>(9).fill(UNDEFINED_VALUE),
    border: new Array<Value>(9).fill(UNDEFINED_VALUE),
    position: new Array<Value>(9).fill(UNDEFINED_VALUE),
    gap: new Array<Value>(3).fill(UNDEFINED_VALUE),
    width: AUTO_VALUE,
    height: AUTO_VALUE,
    minWidth: UNDEFINED_VALUE,
    minHeight: UNDEFINED_VALUE,
    maxWidth: UNDEFINED_VALUE,
    maxHeight: UNDEFINED_VALUE,
  }
}

// --
// Edge & axis helpers (`Ri`, `ir`, `kr`, `du`, `iu`, `nr`, `ao`, `Rf`, `su`, `ul`, `Bb`, `sC`, `fu`, `kf`)

const EDGE_LEFT = 0 // `Mn`
const EDGE_TOP = 1 // `sr`
const EDGE_RIGHT = 2 // `vr`
const EDGE_BOTTOM = 3 // `Lr`

function resolveEdge(
  edges: Value[],
  physicalEdgeIdx: number,
  ownerSize: number,
): number {
  const v = resolveEdgeRaw(edges, physicalEdgeIdx)
  if (v.unit === Unit.Undefined || v.unit === Unit.Auto) return 0
  return resolveValue(v, ownerSize)
}

function resolveEdgeRaw(edges: Value[], physicalEdgeIdx: number): Value {
  // Official 2.1.328 `ir`: Start/End > Left/Right > Horizontal/Vertical > All
  let v =
    physicalEdgeIdx === EDGE_LEFT
      ? edges[Edge.Start]!
      : physicalEdgeIdx === EDGE_RIGHT
        ? edges[Edge.End]!
        : UNDEFINED_VALUE
  if (v.unit === Unit.Undefined) v = edges[physicalEdgeIdx]!
  if (v.unit === Unit.Undefined) {
    v =
      physicalEdgeIdx === EDGE_LEFT || physicalEdgeIdx === EDGE_RIGHT
        ? edges[Edge.Horizontal]!
        : edges[Edge.Vertical]!
  }
  if (v.unit === Unit.Undefined) v = edges[Edge.All]!
  return v
}

function isMarginAuto(edges: Value[], physicalEdgeIdx: number): boolean {
  return resolveEdgeRaw(edges, physicalEdgeIdx).unit === Unit.Auto
}

function hasEdgeUnit(edges: Value[], unit: Unit): boolean {
  for (let i = 0; i < 9; i++) if (edges[i]!.unit === unit) return true
  return false
}

function hasAnyDefinedEdge(edges: Value[]): boolean {
  for (let i = 0; i < 9; i++) if (edges[i]!.unit !== Unit.Undefined) return true
  return false
}

function styleReadsOwnerWidth(style: Style): boolean {
  return (
    style.width.unit === Unit.Percent ||
    style.minWidth.unit === Unit.Percent ||
    style.maxWidth.unit === Unit.Percent ||
    hasEdgeUnit(style.margin, Unit.Percent) ||
    hasEdgeUnit(style.padding, Unit.Percent)
  )
}

function styleReadsOwnerHeight(style: Style): boolean {
  return (
    style.height.unit === Unit.Percent ||
    style.minHeight.unit === Unit.Percent ||
    style.maxHeight.unit === Unit.Percent
  )
}

function resolveEdgeValue(v: Value, ownerSize: number): number {
  const u = v.unit
  if (u === Unit.Point) return v.value
  if (u === Unit.Percent) {
    const r = (v.value * ownerSize) / 100
    return isInt32Range(r) ? roundInt(r) : 0
  }
  return 0
}

function resolveEdges4Into(
  edges: Value[],
  ownerSize: number,
  out: Int32Array,
): void {
  const eH = edges[Edge.Horizontal]!
  const eV = edges[Edge.Vertical]!
  const eA = edges[Edge.All]!
  const eS = edges[Edge.Start]!
  const eE = edges[Edge.End]!

  let v = eS
  if (v.unit === Unit.Undefined) v = edges[Edge.Left]!
  if (v.unit === Unit.Undefined) v = eH
  if (v.unit === Unit.Undefined) v = eA
  out[0] = resolveEdgeValue(v, ownerSize)

  v = edges[Edge.Top]!
  if (v.unit === Unit.Undefined) v = eV
  if (v.unit === Unit.Undefined) v = eA
  out[1] = resolveEdgeValue(v, ownerSize)

  v = eE
  if (v.unit === Unit.Undefined) v = edges[Edge.Right]!
  if (v.unit === Unit.Undefined) v = eH
  if (v.unit === Unit.Undefined) v = eA
  out[2] = resolveEdgeValue(v, ownerSize)

  v = edges[Edge.Bottom]!
  if (v.unit === Unit.Undefined) v = eV
  if (v.unit === Unit.Undefined) v = eA
  out[3] = resolveEdgeValue(v, ownerSize)
}

function isRow(dir: FlexDirection): boolean {
  return dir === FlexDirection.Row || dir === FlexDirection.RowReverse
}

function isReverse(dir: FlexDirection): boolean {
  return dir === FlexDirection.RowReverse || dir === FlexDirection.ColumnReverse
}

function crossAxis(dir: FlexDirection): FlexDirection {
  return isRow(dir) ? FlexDirection.Column : FlexDirection.Row
}

function leadingEdge(dir: FlexDirection): number {
  switch (dir) {
    case FlexDirection.Row:
      return EDGE_LEFT
    case FlexDirection.RowReverse:
      return EDGE_RIGHT
    case FlexDirection.Column:
      return EDGE_TOP
    case FlexDirection.ColumnReverse:
      return EDGE_BOTTOM
  }
}

function trailingEdge(dir: FlexDirection): number {
  switch (dir) {
    case FlexDirection.Row:
      return EDGE_RIGHT
    case FlexDirection.RowReverse:
      return EDGE_LEFT
    case FlexDirection.Column:
      return EDGE_BOTTOM
    case FlexDirection.ColumnReverse:
      return EDGE_TOP
  }
}

// --
// Public types

export type MeasureFunction = (
  width: number,
  widthMode: MeasureMode,
  height: number,
  heightMode: MeasureMode,
) => { width: number; height: number }

export type Size = { width: number; height: number }

export type YogaCounters = {
  visited: number
  measured: number
  measureCacheHits: number
  cacheHits: number
  live: number
}

// --
// Config (`Fb()`)

export type Config = {
  pointScaleFactor: number
  errata: Errata
  useWebDefaults: boolean
  generation: number
  nodesVisited: number
  measureCalls: number
  measureCacheHits: number
  cacheHits: number
  liveNodes: number
  onDamage: (() => void) | undefined
  checksNumbers: boolean
  free(): void
  isExperimentalFeatureEnabled(_: ExperimentalFeature): boolean
  setExperimentalFeatureEnabled(_: ExperimentalFeature, __: boolean): void
  setPointScaleFactor(factor: number): void
  getErrata(): Errata
  setErrata(errata: Errata): void
  setUseWebDefaults(v: boolean): void
}

function createConfig(): Config {
  const config: Config = {
    pointScaleFactor: 1,
    errata: Errata.None,
    useWebDefaults: false,
    generation: 0,
    nodesVisited: 0,
    measureCalls: 0,
    measureCacheHits: 0,
    cacheHits: 0,
    liveNodes: 0,
    onDamage: undefined,
    checksNumbers: true,
    free() {},
    isExperimentalFeatureEnabled() {
      return false
    },
    setExperimentalFeatureEnabled() {},
    setPointScaleFactor(f: number) {
      config.pointScaleFactor = f
    },
    getErrata() {
      return config.errata
    },
    setErrata(e: Errata) {
      config.errata = e
    },
    setUseWebDefaults(v: boolean) {
      config.useWebDefaults = v
    },
  }
  return config
}

// --
// Node implementation (`class au`)

export class Node {
  style: Style
  layout: Layout
  parent: Node | null
  children: Node[]
  measureFunc: MeasureFunction | null
  config: Config
  isDirty_: boolean
  isReferenceBaseline_: boolean

  // Per-layout scratch & fast-path flags
  _sz: Int32Array = new Int32Array(3)
  _lineIndex = 0
  _hasAutoMargin = false
  _hasPosition = false
  _hasPadding = false
  _hasBorder = false
  _hasMargin = false
  _readsOwnerWidth = false
  _readsOwnerHeight = false

  // Single-slot layout cache (`_lc`: [aW, aH, oW, oH, outW, outH])
  _lc: Int32Array = allocIntCache(6)
  _lWM: MeasureMode = 0
  _lHM: MeasureMode = 0
  _lFW = false
  _lFH = false
  _hasL = false

  // Single-slot measure cache (`_mc`: [aW, aH, oW, oH, outW, outH])
  _mc: Int32Array = allocIntCache(6)
  _mWM: MeasureMode = 0
  _mHM: MeasureMode = 0
  _hasM = false

  // Flex-basis cache (`_fb`: [basis, oW, oH, availMain, availCross])
  _fb: Int32Array = allocIntCache(5)
  _fbCrossMode: MeasureMode | -1 = -1
  _fbIsRow = false
  _fbGen = -1

  // Multi-entry measure cache (`_c`: 8 slots × 10 ints)
  _c: Int32Array | null = null
  _cGen = -1
  _cN = 0
  _cWr = 0

  // Per-node measureFunc result cache (`_mfC`: 4 slots × 6 ints)
  _mfC: Int32Array | null = null
  _mfN = 0
  _mfWr = 0

  // Generation of last measure-pass compute
  _mGen = -1

  constructor(config?: Config) {
    this.style = defaultStyle()
    this.layout = {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      border: new Int32Array(4),
      padding: new Int32Array(4),
      margin: new Int32Array(4),
    }
    this.parent = null
    this.children = []
    this.measureFunc = null
    this.config = config ?? DEFAULT_CONFIG
    this.isDirty_ = true
    this.isReferenceBaseline_ = false
    this.config.liveNodes++
  }

  // -- Tree

  insertChild(child: Node, index: number): void {
    if (child.config !== this.config) {
      throw new Error('insertChild: child was created with a different Config')
    }
    child.parent = this
    this.children.splice(index, 0, child)
    this.markDirty()
  }

  removeChild(child: Node): void {
    const idx = this.children.indexOf(child)
    if (idx >= 0) {
      this.children.splice(idx, 1)
      child.parent = null
      this.markDirty()
    }
  }

  getChild(index: number): Node {
    return this.children[index]!
  }

  getChildCount(): number {
    return this.children.length
  }

  getParent(): Node | null {
    return this.parent
  }

  // -- Lifecycle

  free(): void {
    this.parent = null
    this.children = []
    this.measureFunc = null
    this.config.liveNodes--
  }

  freeRecursive(): void {
    const kids = this.children
    for (let i = 0, len = kids.length; i < len; i++) {
      kids[i]!.freeRecursive()
    }
    this.free()
  }

  reset(): void {
    this.style = defaultStyle()
    this.layout.left = 0
    this.layout.top = 0
    this.layout.width = 0
    this.layout.height = 0
    this.layout.border.fill(0)
    this.layout.padding.fill(0)
    this.layout.margin.fill(0)
    this.children = []
    this.parent = null
    this.measureFunc = null
    this.isDirty_ = true
    this.isReferenceBaseline_ = false
    this._sz.fill(0)
    this._lineIndex = 0
    this._hasAutoMargin = false
    this._hasPosition = false
    this._hasPadding = false
    this._hasBorder = false
    this._hasMargin = false
    this._readsOwnerWidth = false
    this._readsOwnerHeight = false
    this._lc.fill(NAN_SENTINEL)
    this._lWM = 0
    this._lHM = 0
    this._lFW = false
    this._lFH = false
    this._hasL = false
    this._mc.fill(NAN_SENTINEL)
    this._mWM = 0
    this._mHM = 0
    this._hasM = false
    this._fb.fill(NAN_SENTINEL)
    this._fbCrossMode = -1
    this._fbIsRow = false
    this._fbGen = -1
    this._c = null
    this._cGen = -1
    this._cN = 0
    this._cWr = 0
    this._mfC = null
    this._mfN = 0
    this._mfWr = 0
    this._mGen = -1
  }

  // -- Dirty tracking

  clearLayoutCacheRecursive(): void {
    const visited = new Set<Node>()
    const stack: Node[] = [this]
    let remaining = Math.max(0, this.config.liveNodes | 0) * 4 + 1024
    while (stack.length > 0 && --remaining >= 0) {
      const n = stack.pop()!
      if (!(n instanceof Node) || visited.has(n)) continue
      visited.add(n)
      n.isDirty_ = true
      n._hasL = false
      n._hasM = false
      n._cN = 0
      n._cWr = 0
      n._cGen = -1
      n._mfN = 0
      n._mfWr = 0
      n._fbCrossMode = -1
      n._fbGen = -1
      n._mGen = -1
      const kids = n.children
      if (Array.isArray(kids)) {
        for (let i = 0, len = kids.length; i < len && i < remaining; i++) {
          stack.push(kids[i]!)
        }
      }
    }
    try {
      this.markDirty()
    } catch {
      // ignore
    }
  }

  markDirty(): void {
    this.isDirty_ = true
    this._mfN = 0
    this._mfWr = 0
    const p = this.parent
    if (p && !p.isDirty_) p.markDirty()
  }

  isDirty(): boolean {
    return this.isDirty_
  }

  hasNewLayout(): boolean {
    return true
  }

  markLayoutSeen(): void {}

  // -- Measure function

  setMeasureFunc(fn: MeasureFunction | null): void {
    this.measureFunc = fn
    this.markDirty()
  }

  unsetMeasureFunc(): void {
    this.measureFunc = null
    this.markDirty()
  }

  // -- Damage-checked computed layout getters

  checked(value: number | undefined, fallback: number): number {
    if (
      typeof value === 'number' &&
      ((value | 0) === value || !this.config.checksNumbers)
    ) {
      return value
    }
    this.config.onDamage?.()
    return fallback
  }

  getComputedLeft(): number {
    return this.checked(this.layout?.left, NaN)
  }

  getComputedTop(): number {
    return this.checked(this.layout?.top, NaN)
  }

  getComputedWidth(): number {
    return this.checked(this.layout?.width, 0)
  }

  getComputedHeight(): number {
    return this.checked(this.layout?.height, 0)
  }

  getComputedRight(): number {
    const p = this.parent
    if (!p) return 0
    const l = this.layout
    return p.layout.width - l.left - l.width
  }

  getComputedBottom(): number {
    const p = this.parent
    if (!p) return 0
    const l = this.layout
    return p.layout.height - l.top - l.height
  }

  getComputedLayout(): {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  } {
    return {
      left: this.layout.left,
      top: this.layout.top,
      right: this.getComputedRight(),
      bottom: this.getComputedBottom(),
      width: this.layout.width,
      height: this.layout.height,
    }
  }

  getComputedBorder(edge: Edge): number {
    return this.checked(this.layout?.border?.[physicalEdge(edge)], 0)
  }

  getComputedPadding(edge: Edge): number {
    return this.checked(this.layout?.padding?.[physicalEdge(edge)], 0)
  }

  getComputedMargin(edge: Edge): number {
    return this.checked(this.layout?.margin?.[physicalEdge(edge)], 0)
  }

  getOfferedWidth(width: number, height: number): number {
    const cache = this._mfC
    if (
      this._mfN > 0 &&
      !isInt32ArrayOfLength(MEASURE_CACHE_SLOTS * 6, cache)
    ) {
      this.config.onDamage?.()
      return width
    }
    if (this._mfN <= 0 || !cache) return width
    let offered = width
    for (let i = this._mfN * 6 - 6; i >= 0; i -= 6) {
      if (
        !canReuseMeasureResult(
          MeasureMode.Exactly,
          width,
          cache[i + 1]! as MeasureMode,
          cache[i]!,
          cache[i + 4]!,
        )
      ) {
        continue
      }
      if (cache[i + 5] !== height) return width
      offered = cache[i + 1] === MeasureMode.AtMost ? cache[i]! : width
    }
    return offered
  }

  // -- Style setters: dimensions

  setWidth(v: number | 'auto' | string | undefined): void {
    this.style.width = parseDimension(v)
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setWidthPercent(v: number): void {
    this.style.width = percentValue(v)
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setWidthAuto(): void {
    this.style.width = AUTO_VALUE
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setHeight(v: number | 'auto' | string | undefined): void {
    this.style.height = parseDimension(v)
    this._readsOwnerHeight = styleReadsOwnerHeight(this.style)
    this.markDirty()
  }

  setHeightPercent(v: number): void {
    this.style.height = percentValue(v)
    this._readsOwnerHeight = styleReadsOwnerHeight(this.style)
    this.markDirty()
  }

  setHeightAuto(): void {
    this.style.height = AUTO_VALUE
    this._readsOwnerHeight = styleReadsOwnerHeight(this.style)
    this.markDirty()
  }

  setMinWidth(v: number | string | undefined): void {
    this.style.minWidth = parseDimension(v)
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setMinWidthPercent(v: number): void {
    this.style.minWidth = percentValue(v)
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setMinHeight(v: number | string | undefined): void {
    this.style.minHeight = parseDimension(v)
    this._readsOwnerHeight = styleReadsOwnerHeight(this.style)
    this.markDirty()
  }

  setMinHeightPercent(v: number): void {
    this.style.minHeight = percentValue(v)
    this._readsOwnerHeight = styleReadsOwnerHeight(this.style)
    this.markDirty()
  }

  setMaxWidth(v: number | string | undefined): void {
    this.style.maxWidth = parseDimension(v)
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setMaxWidthPercent(v: number): void {
    this.style.maxWidth = percentValue(v)
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setMaxHeight(v: number | string | undefined): void {
    this.style.maxHeight = parseDimension(v)
    this._readsOwnerHeight = styleReadsOwnerHeight(this.style)
    this.markDirty()
  }

  setMaxHeightPercent(v: number): void {
    this.style.maxHeight = percentValue(v)
    this._readsOwnerHeight = styleReadsOwnerHeight(this.style)
    this.markDirty()
  }

  // -- Style setters: flex

  setFlexDirection(dir: FlexDirection): void {
    this.style.flexDirection = dir
    this.markDirty()
  }

  setFlexGrow(v: number | undefined): void {
    this.style.flexGrow = v ?? 0
    this.markDirty()
  }

  setFlexShrink(v: number | undefined): void {
    this.style.flexShrink = v ?? 0
    this.markDirty()
  }

  setFlex(v: number | undefined): void {
    if (v === undefined || Number.isNaN(v)) {
      this.style.flexGrow = 0
      this.style.flexShrink = 0
    } else if (v > 0) {
      this.style.flexGrow = v
      this.style.flexShrink = 1
      this.style.flexBasis = pointValue(0)
    } else if (v < 0) {
      this.style.flexGrow = 0
      this.style.flexShrink = -v
    } else {
      this.style.flexGrow = 0
      this.style.flexShrink = 0
    }
    this.markDirty()
  }

  setFlexBasis(v: number | 'auto' | string | undefined): void {
    this.style.flexBasis = parseDimension(v)
    this.markDirty()
  }

  setFlexBasisPercent(v: number): void {
    this.style.flexBasis = percentValue(v)
    this.markDirty()
  }

  setFlexBasisAuto(): void {
    this.style.flexBasis = AUTO_VALUE
    this.markDirty()
  }

  setFlexWrap(wrap: Wrap): void {
    this.style.flexWrap = wrap
    this.markDirty()
  }

  // -- Style setters: alignment

  setAlignItems(a: Align): void {
    this.style.alignItems = a
    this.markDirty()
  }

  setAlignSelf(a: Align): void {
    this.style.alignSelf = a
    this.markDirty()
  }

  setAlignContent(a: Align): void {
    this.style.alignContent = a
    this.markDirty()
  }

  setJustifyContent(j: Justify): void {
    this.style.justifyContent = j
    this.markDirty()
  }

  // -- Style setters: display / position / overflow

  setDisplay(d: Display): void {
    this.style.display = d
    this.markDirty()
  }

  getDisplay(): Display {
    return this.checked(this.style?.display, Display.Flex) as Display
  }

  setPositionType(t: PositionType): void {
    this.style.positionType = t
    this.markDirty()
  }

  setPosition(edge: Edge, v: number | string | undefined): void {
    this.style.position[edge] = parseDimension(v)
    this._hasPosition = hasAnyDefinedEdge(this.style.position)
    this.markDirty()
  }

  setPositionPercent(edge: Edge, v: number): void {
    this.style.position[edge] = percentValue(v)
    this._hasPosition = true
    this.markDirty()
  }

  setPositionAuto(edge: Edge): void {
    this.style.position[edge] = AUTO_VALUE
    this._hasPosition = true
    this.markDirty()
  }

  setOverflow(o: Overflow): void {
    this.style.overflow = o
    this.markDirty()
  }

  setDirection(d: Direction): void {
    this.style.direction = d
    this.markDirty()
  }

  setBoxSizing(_: BoxSizing): void {}

  // -- Style setters: spacing

  setMargin(edge: Edge, v: number | 'auto' | string | undefined): void {
    const val = parseDimension(v)
    this.style.margin[edge] = val
    if (val.unit === Unit.Auto) this._hasAutoMargin = true
    else this._hasAutoMargin = hasEdgeUnit(this.style.margin, Unit.Auto)
    this._hasMargin =
      this._hasAutoMargin || hasAnyDefinedEdge(this.style.margin)
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setMarginPercent(edge: Edge, v: number): void {
    this.style.margin[edge] = percentValue(v)
    this._hasAutoMargin = hasEdgeUnit(this.style.margin, Unit.Auto)
    this._hasMargin = true
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setMarginAuto(edge: Edge): void {
    this.style.margin[edge] = AUTO_VALUE
    this._hasAutoMargin = true
    this._hasMargin = true
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setPadding(edge: Edge, v: number | string | undefined): void {
    this.style.padding[edge] = parseDimension(v)
    this._hasPadding = hasAnyDefinedEdge(this.style.padding)
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setPaddingPercent(edge: Edge, v: number): void {
    this.style.padding[edge] = percentValue(v)
    this._hasPadding = true
    this._readsOwnerWidth = styleReadsOwnerWidth(this.style)
    this.markDirty()
  }

  setBorder(edge: Edge, v: number | undefined): void {
    this.style.border[edge] = v === undefined ? UNDEFINED_VALUE : pointValue(v)
    this._hasBorder = hasAnyDefinedEdge(this.style.border)
    this.markDirty()
  }

  setGap(gutter: Gutter, v: number | string | undefined): void {
    this.style.gap[gutter] = parseDimension(v)
    this.markDirty()
  }

  setGapPercent(gutter: Gutter, v: number): void {
    this.style.gap[gutter] = percentValue(v)
    this.markDirty()
  }

  // -- Style getters

  getFlexDirection(): FlexDirection {
    return this.style.flexDirection
  }
  getJustifyContent(): Justify {
    return this.style.justifyContent
  }
  getAlignItems(): Align {
    return this.style.alignItems
  }
  getAlignSelf(): Align {
    return this.style.alignSelf
  }
  getAlignContent(): Align {
    return this.style.alignContent
  }
  getFlexGrow(): number {
    return this.style.flexGrow
  }
  getFlexShrink(): number {
    return this.style.flexShrink
  }
  getFlexBasis(): Value {
    return this.style.flexBasis
  }
  getFlexWrap(): Wrap {
    return this.style.flexWrap
  }
  getWidth(): Value {
    return this.style.width
  }
  getHeight(): Value {
    return this.style.height
  }
  getOverflow(): Overflow {
    return this.style.overflow
  }
  getPositionType(): PositionType {
    return this.style.positionType
  }
  getDirection(): Direction {
    return this.style.direction
  }

  // -- Unused API stubs (present for API parity)

  copyStyle(_: Node): void {}
  setDirtiedFunc(_: unknown): void {}
  unsetDirtiedFunc(): void {}
  setIsReferenceBaseline(v: boolean): void {
    this.isReferenceBaseline_ = v
    this.markDirty()
  }
  isReferenceBaseline(): boolean {
    return this.isReferenceBaseline_
  }
  setAspectRatio(_: number | undefined): void {}
  getAspectRatio(): number {
    return NaN
  }
  setAlwaysFormsContainingBlock(_: boolean): void {}

  // -- Layout entry point

  calculateLayout(
    ownerWidth?: number,
    ownerHeight?: number,
    _direction?: Direction,
  ): void {
    const cfg = this.config
    cfg.nodesVisited = 0
    cfg.measureCalls = 0
    cfg.measureCacheHits = 0
    cfg.cacheHits = 0
    cfg.generation++
    _lastCalculatedConfig = cfg

    const w =
      ownerWidth !== undefined && isInt32Range(ownerWidth)
        ? roundInt(ownerWidth)
        : NaN
    const h =
      ownerHeight !== undefined && isInt32Range(ownerHeight)
        ? roundInt(ownerHeight)
        : NaN

    layoutNode(
      this,
      w,
      h,
      isDefined(w) ? MeasureMode.Exactly : MeasureMode.Undefined,
      isDefined(h) ? MeasureMode.Exactly : MeasureMode.Undefined,
      w,
      h,
      true,
      false,
      false,
    )

    const mar = this.layout.margin
    const posL = resolveValue(
      resolveEdgeRaw(this.style.position, EDGE_LEFT),
      isDefined(w) ? w : 0,
    )
    const posT = resolveValue(
      resolveEdgeRaw(this.style.position, EDGE_TOP),
      isDefined(h) ? h : 0,
    )
    this.layout.left = (mar[EDGE_LEFT]! + (isDefined(posL) ? posL : 0)) | 0
    this.layout.top = (mar[EDGE_TOP]! + (isDefined(posT) ? posT : 0)) | 0
  }
}

const DEFAULT_CONFIG = createConfig() // `lC`
let _lastCalculatedConfig: Config = DEFAULT_CONFIG

// --
// Structural integrity validation (`aC`), cache helpers (`uC`, `cC`, `dC`, `fC`), counters (`Ib`)

/**
 * Official 2.1.328 `aC(node)` — validates that a Yoga node's `children` array
 * and all `Int32Array` backing buffers are structurally intact.
 */
export function isYogaNodeIntact(node: Node): boolean {
  if (!node || !node.layout) return false
  const { border, padding, margin } = node.layout
  return (
    Array.isArray(node.children) &&
    isInt32ArrayOfLength(4, border) &&
    isInt32ArrayOfLength(4, padding) &&
    isInt32ArrayOfLength(4, margin) &&
    isInt32ArrayOfLength(3, node._sz) &&
    isInt32ArrayOfLength(6, node._lc) &&
    isInt32ArrayOfLength(6, node._mc) &&
    isInt32ArrayOfLength(5, node._fb) &&
    (node._c === null || isInt32ArrayOfLength(CACHE_SLOTS * 10, node._c)) &&
    (node._mfC === null ||
      isInt32ArrayOfLength(MEASURE_CACHE_SLOTS * 6, node._mfC))
  )
}

/**
 * Official 2.1.328 `Ib(rootNode)` — reads profiling & liveness counters from
 * the given node's `Config` (or the last calculated `Config` when called with
 * no arguments for backward compatibility).
 */
export function getYogaCounters(
  rootNode?: Node | { config?: Config } | { yoga: Node },
): YogaCounters {
  let cfg: Config | undefined
  if (rootNode) {
    if ('yoga' in rootNode && rootNode.yoga) {
      cfg = rootNode.yoga.config
    } else if ('config' in rootNode && rootNode.config) {
      cfg = rootNode.config
    }
  }
  const c = cfg ?? _lastCalculatedConfig
  return {
    visited: c.nodesVisited,
    measured: c.measureCalls,
    measureCacheHits: c.measureCacheHits,
    cacheHits: c.cacheHits,
    live: c.liveNodes,
  }
}

export function clearLayoutCacheRecursive(node: Node): void {
  node.clearLayoutCacheRecursive()
}

function cacheWrite(
  node: Node,
  aW: number,
  aH: number,
  wM: MeasureMode,
  hM: MeasureMode,
  oW: number,
  oH: number,
  fW: boolean,
  fH: boolean,
  performLayout: boolean,
  wasDirty: boolean,
): void {
  const gen = node.config.generation
  if (wasDirty && node._cGen !== gen) {
    node._cN = 0
    node._cWr = 0
  }
  if (performLayout) return
  const buf = (node._c ??= new Int32Array(CACHE_SLOTS * 10))
  const slot = node._cWr++ % CACHE_SLOTS
  if (node._cN < CACHE_SLOTS) node._cN = node._cWr
  const o = slot * 10
  buf[o] = packInt(aW)
  buf[o + 1] = packInt(aH)
  buf[o + 2] = wM
  buf[o + 3] = hM
  buf[o + 4] = packInt(oW)
  buf[o + 5] = packInt(oH)
  buf[o + 6] = fW ? 1 : 0
  buf[o + 7] = fH ? 1 : 0
  const l = node.layout
  buf[o + 8] = l.width
  buf[o + 9] = l.height
  node._cGen = gen
}

function commitCacheOutputs(node: Node, performLayout: boolean): void {
  const l = node.layout
  const w = (l.width |= 0)
  const h = (l.height |= 0)
  if (performLayout) {
    node._lc[4] = w
    node._lc[5] = h
  } else {
    node._mc[4] = w
    node._mc[5] = h
  }
}

function tryLayoutCacheHit(
  node: Node,
  layout: Layout,
  aW: number,
  aH: number,
  wM: MeasureMode,
  hM: MeasureMode,
  oW: number,
  oH: number,
  performLayout: boolean,
  fW: boolean,
  fH: boolean,
): boolean {
  const cfg = node.config
  const gen = cfg.generation
  const sameGen = node._cGen === gen && !performLayout
  const measuredThisGen = performLayout && node._mGen === gen
  const dirty = node.isDirty_
  if ((dirty && !sameGen) || measuredThisGen) return false

  const pW = packInt(aW)
  const pH = packInt(aH)
  const pOW = packInt(oW)
  const pOH = packInt(oH)

  if (
    !dirty &&
    node._hasL &&
    node._lWM === wM &&
    node._lHM === hM &&
    node._lFW === fW &&
    node._lFH === fH &&
    node._lc[0] === pW &&
    node._lc[1] === pH &&
    node._lc[2] === pOW &&
    node._lc[3] === pOH
  ) {
    cfg.cacheHits++
    layout.width = node._lc[4]!
    layout.height = node._lc[5]!
    return true
  }

  const count = node._cN
  if (count > 0 && !performLayout && (sameGen || !dirty)) {
    const buf = node._c
    if (!isInt32ArrayOfLength(CACHE_SLOTS * 10, buf)) {
      throw new TypeError('a layout node is damaged')
    }
    const fWInt = fW ? 1 : 0
    const fHInt = fH ? 1 : 0
    for (let i = 0; i < count; i++) {
      const o = i * 10
      if (
        buf[o + 2] === wM &&
        buf[o + 3] === hM &&
        buf[o + 6] === fWInt &&
        buf[o + 7] === fHInt &&
        buf[o] === pW &&
        buf[o + 1] === pH &&
        buf[o + 4] === pOW &&
        buf[o + 5] === pOH
      ) {
        layout.width = buf[o + 8]!
        layout.height = buf[o + 9]!
        cfg.cacheHits++
        return true
      }
    }
  }

  if (
    !dirty &&
    !performLayout &&
    node._hasM &&
    node._mWM === wM &&
    node._mHM === hM &&
    node._mc[0] === pW &&
    node._mc[1] === pH &&
    node._mc[2] === pOW &&
    node._mc[3] === pOH
  ) {
    layout.width = node._mc[4]!
    layout.height = node._mc[5]!
    cfg.cacheHits++
    return true
  }

  return false
}

function commitCacheInputs(
  node: Node,
  aW: number,
  aH: number,
  wM: MeasureMode,
  hM: MeasureMode,
  oW: number,
  oH: number,
  performLayout: boolean,
  fW: boolean,
  fH: boolean,
): boolean {
  if (!isYogaNodeIntact(node)) {
    throw new TypeError('a layout node is damaged')
  }
  const wasDirty = node.isDirty_
  if (performLayout) {
    node._lc[0] = packInt(aW)
    node._lc[1] = packInt(aH)
    node._lWM = wM
    node._lHM = hM
    node._lc[2] = packInt(oW)
    node._lc[3] = packInt(oH)
    node._lFW = fW
    node._lFH = fH
    node._hasL = true
    node.isDirty_ = false
    if (wasDirty) node._hasM = false
  } else {
    node._mc[0] = packInt(aW)
    node._mc[1] = packInt(aH)
    node._mWM = wM
    node._mHM = hM
    node._mc[2] = packInt(oW)
    node._mc[3] = packInt(oH)
    node._hasM = true
    node._mGen = node.config.generation
    if (wasDirty) node._hasL = false
  }
  return wasDirty
}

// --
// Core flexbox algorithm (`rs`, `hC`, `Nf`, `mC`, `yC`, `bC`, `gC`, `xC`, `vC`, `SC`, `EC`, `wC`)

function layoutNode(
  node: Node,
  availableWidth: number,
  availableHeight: number,
  widthMode: MeasureMode,
  heightMode: MeasureMode,
  ownerWidth: number,
  ownerHeight: number,
  performLayout: boolean,
  forceWidth: boolean,
  forceHeight: boolean,
): void {
  node.config.nodesVisited++
  const { style, layout } = node
  const cacheOwnerW = node._readsOwnerWidth ? ownerWidth : NaN
  const cacheOwnerH = node._readsOwnerHeight ? ownerHeight : NaN

  if (
    tryLayoutCacheHit(
      node,
      layout,
      availableWidth,
      availableHeight,
      widthMode,
      heightMode,
      cacheOwnerW,
      cacheOwnerH,
      performLayout,
      forceWidth,
      forceHeight,
    )
  ) {
    return
  }

  const wasDirty = commitCacheInputs(
    node,
    availableWidth,
    availableHeight,
    widthMode,
    heightMode,
    cacheOwnerW,
    cacheOwnerH,
    performLayout,
    forceWidth,
    forceHeight,
  )

  const { padding, border, margin } = layout
  if (node._hasPadding) resolveEdges4Into(style.padding, ownerWidth, padding)
  else padding[0] = padding[1] = padding[2] = padding[3] = 0
  if (node._hasBorder) resolveEdges4Into(style.border, ownerWidth, border)
  else border[0] = border[1] = border[2] = border[3] = 0
  if (node._hasMargin) resolveEdges4Into(style.margin, ownerWidth, margin)
  else margin[0] = margin[1] = margin[2] = margin[3] = 0

  const padBorderW = padding[0]! + padding[2]! + border[0]! + border[2]!
  const padBorderH = padding[1]! + padding[3]! + border[1]! + border[3]!

  const styleW = forceWidth ? NaN : resolveValue(style.width, ownerWidth)
  const styleH = forceHeight ? NaN : resolveValue(style.height, ownerHeight)

  let targetW = availableWidth
  let targetH = availableHeight
  let wMode = widthMode
  let hMode = heightMode

  if (isDefined(styleW)) {
    targetW = styleW
    wMode = MeasureMode.Exactly
  }
  if (isDefined(styleH)) {
    targetH = styleH
    hMode = MeasureMode.Exactly
  }

  targetW = boundAxis(style, true, targetW, ownerWidth, ownerHeight)
  targetH = boundAxis(style, false, targetH, ownerWidth, ownerHeight)

  if (node.children.length === 0) {
    if (node.measureFunc) {
      layoutLeafWithMeasure(
        node,
        style,
        layout,
        targetW,
        targetH,
        wMode,
        hMode,
        padBorderW,
        padBorderH,
        ownerWidth,
        ownerHeight,
      )
    } else {
      layout.width =
        wMode === MeasureMode.Exactly
          ? targetW
          : boundAxis(style, true, padBorderW, ownerWidth, ownerHeight)
      layout.height =
        hMode === MeasureMode.Exactly
          ? targetH
          : boundAxis(style, false, padBorderH, ownerWidth, ownerHeight)
    }
  } else {
    layoutFlexContainer(
      node,
      style,
      layout,
      targetW,
      targetH,
      wMode,
      hMode,
      padBorderW,
      padBorderH,
      ownerWidth,
      ownerHeight,
      performLayout,
    )
  }

  commitCacheOutputs(node, performLayout)
  cacheWrite(
    node,
    availableWidth,
    availableHeight,
    widthMode,
    heightMode,
    cacheOwnerW,
    cacheOwnerH,
    forceWidth,
    forceHeight,
    performLayout,
    wasDirty,
  )
}

function layoutLeafWithMeasure(
  node: Node,
  style: Style,
  layout: Layout,
  targetW: number,
  targetH: number,
  wMode: MeasureMode,
  hMode: MeasureMode,
  padBorderW: number,
  padBorderH: number,
  ownerW: number,
  ownerH: number,
): void {
  if (wMode === MeasureMode.Exactly && hMode === MeasureMode.Exactly) {
    layout.width = targetW
    layout.height = targetH
    return
  }

  const rawW =
    wMode === MeasureMode.Undefined ? NaN : Math.max(0, targetW - padBorderW)
  const availW = rawW >= 1 ? rawW | 0 : rawW
  const rawH =
    hMode === MeasureMode.Undefined ? NaN : Math.max(0, targetH - padBorderH)
  const availH = rawH >= 1 ? rawH | 0 : rawH

  const cfg = node.config
  cfg.measureCalls++

  const packedW = packInt(availW)
  const packedH = packInt(availH)
  let mfCache = node._mfC

  if (node._mfN > 0) {
    if (!mfCache) throw new TypeError('a layout node is damaged')
    for (let i = 0; i < node._mfN; i++) {
      const o = i * 6
      const cachedOutW = mfCache[o + 4]!
      const cachedOutH = mfCache[o + 5]!
      if (
        canReuseMeasureResult(
          wMode,
          packedW,
          mfCache[o + 1]! as MeasureMode,
          mfCache[o]!,
          cachedOutW,
        ) &&
        canReuseMeasureResult(
          hMode,
          packedH,
          mfCache[o + 3]! as MeasureMode,
          mfCache[o + 2]!,
          cachedOutH,
        )
      ) {
        cfg.measureCacheHits++
        layout.width =
          wMode === MeasureMode.Exactly
            ? targetW
            : boundAxis(style, true, cachedOutW + padBorderW, ownerW, ownerH)
        layout.height =
          hMode === MeasureMode.Exactly
            ? targetH
            : boundAxis(style, false, cachedOutH + padBorderH, ownerW, ownerH)
        return
      }
    }
  }

  const measured = node.measureFunc!(availW, wMode, availH, hMode)
  if (!mfCache) {
    mfCache = node._mfC = new Int32Array(MEASURE_CACHE_SLOTS * 6)
  }
  const slot = node._mfWr++ % MEASURE_CACHE_SLOTS
  if (node._mfN < MEASURE_CACHE_SLOTS) node._mfN++
  const o = slot * 6
  mfCache[o] = packedW
  mfCache[o + 1] = wMode
  mfCache[o + 2] = packedH
  mfCache[o + 3] = hMode
  const outW = isInt32Range(measured.width) ? Math.ceil(measured.width) : 0
  const outH = isInt32Range(measured.height) ? Math.ceil(measured.height) : 0
  mfCache[o + 4] = outW
  mfCache[o + 5] = outH

  layout.width =
    wMode === MeasureMode.Exactly
      ? targetW
      : boundAxis(style, true, outW + padBorderW, ownerW, ownerH)
  layout.height =
    hMode === MeasureMode.Exactly
      ? targetH
      : boundAxis(style, false, outH + padBorderH, ownerW, ownerH)
}

function canReuseMeasureResult(
  reqMode: MeasureMode,
  reqVal: number,
  cachedMode: MeasureMode,
  cachedVal: number,
  cachedOut: number,
): boolean {
  if (cachedMode === reqMode && cachedVal === reqVal) return true
  if (cachedMode === MeasureMode.Exactly) return false
  if (reqMode === MeasureMode.Exactly) {
    return (
      reqVal === cachedOut &&
      (cachedMode === MeasureMode.Undefined || cachedOut <= cachedVal)
    )
  }
  return (
    reqMode === MeasureMode.AtMost &&
    cachedOut <= reqVal &&
    (cachedMode === MeasureMode.Undefined || cachedVal > reqVal)
  )
}

const EMPTY_INT32 = new Int32Array(0) // `pC`
let _alignCrossOffset = 0 // `ns`
let _alignLineGapAdd = 0 // `uo`
let _lastLineMain = 0 // `Of`
let _lastLineCross = 0 // `Df`

function layoutFlexContainer(
  node: Node,
  style: Style,
  layout: Layout,
  targetW: number,
  targetH: number,
  wMode: MeasureMode,
  hMode: MeasureMode,
  padBorderW: number,
  padBorderH: number,
  ownerW: number,
  ownerH: number,
  performLayout: boolean,
): void {
  const { padding, border } = layout
  const mainDir = style.flexDirection
  const crossDir = crossAxis(mainDir)
  const isMainRow = isRow(mainDir)

  const availMain = isMainRow ? targetW : targetH
  const availCross = isMainRow ? targetH : targetW
  const mainMode = isMainRow ? wMode : hMode
  const crossMode = isMainRow ? hMode : wMode
  const mainPadBorder = isMainRow ? padBorderW : padBorderH
  const crossPadBorder = isMainRow ? padBorderH : padBorderW

  const innerAvailMain = isDefined(availMain)
    ? Math.max(0, availMain - mainPadBorder)
    : NaN
  const innerAvailCross = isDefined(availCross)
    ? Math.max(0, availCross - crossPadBorder)
    : NaN

  const mainGap = resolveGap(
    style,
    isMainRow ? Gutter.Column : Gutter.Row,
    innerAvailMain,
  )

  const flowChildren: Node[] = []
  const absChildren: Node[] = []
  collectLayoutChildren(node, flowChildren, absChildren)

  const childOwnerW = isMainRow ? innerAvailMain : innerAvailCross
  const childOwnerH = isMainRow ? innerAvailCross : innerAvailMain
  const isWrap = style.flexWrap !== Wrap.NoWrap
  const crossGap = resolveGap(
    style,
    isMainRow ? Gutter.Row : Gutter.Column,
    innerAvailCross,
  )

  const flowCount = flowChildren.length
  for (let i = 0; i < flowCount; i++) {
    const child = flowChildren[i]!
    if (!isInt32ArrayOfLength(3, child._sz)) {
      throw new TypeError('a layout node is damaged')
    }
    child._sz[SZ_FLEX_BASIS] = computeFlexBasis(
      child,
      mainDir,
      innerAvailMain,
      innerAvailCross,
      crossMode,
      childOwnerW,
      childOwnerH,
    )
  }

  let lines: Node[][]
  if (!isWrap || !isDefined(innerAvailMain) || flowCount === 0) {
    for (let i = 0; i < flowCount; i++) flowChildren[i]!._lineIndex = 0
    lines = [flowChildren]
  } else {
    lines = splitFlexLines(
      flowChildren,
      innerAvailMain,
      isMainRow,
      mainDir,
      childOwnerW,
      childOwnerH,
      mainGap,
    )
  }

  const numLines = lines.length
  const hasBaseline = isBaselineLayout(node, flowChildren)
  const lineMainSizes = new Int32Array(numLines)
  const lineCrossSizes = new Int32Array(numLines)
  const lineMaxAscents = hasBaseline ? new Int32Array(numLines) : EMPTY_INT32
  const ownerMain = isMainRow ? ownerW : ownerH

  let maxLineMain = 0
  let totalLineCross = 0
  for (let i = 0; i < numLines; i++) {
    const line = lines[i]!
    layoutFlexLine(
      line,
      style,
      mainDir,
      crossDir,
      isMainRow,
      innerAvailMain,
      innerAvailCross,
      crossMode,
      mainGap,
      childOwnerW,
      childOwnerH,
      ownerMain,
      mainPadBorder,
      isWrap,
      performLayout,
    )
    let lineCross = _lastLineCross
    if (hasBaseline) {
      lineCross = computeLineBaselineCross(
        node,
        line,
        childOwnerW,
        lineMaxAscents,
        i,
        lineCross,
      )
    }
    const lineMain = _lastLineMain
    lineMainSizes[i] = lineMain
    lineCrossSizes[i] = lineCross
    maxLineMain = Math.max(maxLineMain, lineMain)
    totalLineCross += lineCross
  }

  const totalCrossGap = numLines > 1 ? crossGap * (numLines - 1) : 0
  totalLineCross += totalCrossGap

  const isScroll = style.overflow === Overflow.Scroll
  const contentMain = maxLineMain + mainPadBorder
  const resolvedMain =
    mainMode === MeasureMode.Exactly
      ? availMain
      : mainMode === MeasureMode.AtMost && isScroll
        ? Math.max(Math.min(availMain, contentMain), mainPadBorder)
        : isWrap && numLines > 1 && mainMode === MeasureMode.AtMost
          ? availMain
          : contentMain

  const contentCross = totalLineCross + crossPadBorder
  const resolvedCross =
    crossMode === MeasureMode.Exactly
      ? availCross
      : crossMode === MeasureMode.AtMost && isScroll
        ? Math.max(Math.min(availCross, contentCross), crossPadBorder)
        : contentCross

  const finalW = boundAxis(
    style,
    true,
    isMainRow ? resolvedMain : resolvedCross,
    ownerW,
    ownerH,
  )
  const finalH = boundAxis(
    style,
    false,
    isMainRow ? resolvedCross : resolvedMain,
    ownerW,
    ownerH,
  )

  layout.width = finalW
  layout.height = finalH
  if (!performLayout) return

  const innerMain = (isMainRow ? finalW : finalH) - mainPadBorder
  const innerCross = (isMainRow ? finalH : finalW) - crossPadBorder
  const mainLead = leadingEdge(mainDir)
  const crossLead = isMainRow ? EDGE_TOP : EDGE_LEFT
  const crossTrail = isMainRow ? EDGE_BOTTOM : EDGE_RIGHT
  const mainReverse = isReverse(mainDir)
  const outerMain = isMainRow ? finalW : finalH

  let crossPosStart = padding[crossLead]! + border[crossLead]!
  let lineGap = crossGap
  const freeCross = innerCross - totalLineCross

  if (numLines === 1 && !isWrap && !hasBaseline) {
    lineCrossSizes[0] = innerCross
  } else {
    distributeAlignContent(
      style.alignContent,
      freeCross,
      numLines,
      lineCrossSizes,
    )
    crossPosStart += _alignCrossOffset
    lineGap += _alignLineGapAdd
  }

  const wrapReverse = style.flexWrap === Wrap.WrapReverse
  const outerCross = isMainRow ? finalH : finalW
  const needsStretchRelayout = isWrap || crossMode !== MeasureMode.Exactly
  const mainStart = padding[mainLead]! + border[mainLead]!
  const containerAlignItems = style.alignItems

  let crossCursor = crossPosStart
  for (let i = 0; i < numLines; i++) {
    const line = lines[i]!
    const lineCross = lineCrossSizes[i]!
    if (needsStretchRelayout) {
      stretchLineChildren(
        line,
        containerAlignItems,
        isMainRow,
        crossDir,
        crossLead,
        crossTrail,
        lineCross,
        childOwnerW,
        childOwnerH,
        performLayout,
      )
    }
    positionFlexLine(
      line,
      style,
      mainDir,
      isMainRow,
      lineCross,
      wrapReverse ? outerCross - crossCursor - lineCross : crossCursor,
      lineMainSizes[i]!,
      innerMain,
      mainStart,
      outerMain,
      mainGap,
      childOwnerW,
      childOwnerH,
      mainReverse,
      wrapReverse,
      hasBaseline,
      hasBaseline ? lineMaxAscents[i]! : 0,
    )
    crossCursor += lineCross + lineGap
  }

  for (let i = 0, len = absChildren.length; i < len; i++) {
    layoutAbsoluteChild(node, absChildren[i]!, finalW, finalH, padding, border)
  }
}

function layoutFlexLine(
  line: Node[],
  parentStyle: Style,
  mainDir: FlexDirection,
  crossDir: FlexDirection,
  isMainRow: boolean,
  innerAvailMain: number,
  innerAvailCross: number,
  crossMode: MeasureMode,
  mainGap: number,
  childOwnerW: number,
  childOwnerH: number,
  ownerMain: number,
  mainPadBorder: number,
  isWrap: boolean,
  performLayout: boolean,
): void {
  const n = line.length
  const containerAlignItems = parentStyle.alignItems
  const totalGap = n > 1 ? mainGap * (n - 1) : 0
  let sumBasis = totalGap
  for (let i = 0; i < n; i++) {
    const c = line[i]!
    sumBasis +=
      c._sz[SZ_FLEX_BASIS]! + childMarginForAxis(c, mainDir, childOwnerW)
  }

  let flexTargetMain = innerAvailMain
  if (Number.isNaN(flexTargetMain)) {
    const minMain = resolveValue(
      isMainRow ? parentStyle.minWidth : parentStyle.minHeight,
      ownerMain,
    )
    const maxMain = resolveValue(
      isMainRow ? parentStyle.maxWidth : parentStyle.maxHeight,
      ownerMain,
    )
    if (!Number.isNaN(maxMain) && sumBasis > maxMain - mainPadBorder) {
      flexTargetMain = Math.max(0, maxMain - mainPadBorder)
    } else if (!Number.isNaN(minMain) && sumBasis < minMain - mainPadBorder) {
      flexTargetMain = Math.max(0, minMain - mainPadBorder)
    }
  }

  resolveFlexibleLengths(
    line,
    flexTargetMain,
    sumBasis,
    isMainRow,
    childOwnerW,
    childOwnerH,
  )

  if (!performLayout && crossMode === MeasureMode.Exactly) {
    for (let i = 0; i < n; i++) {
      const sz = line[i]!._sz
      sumBasis += sz[SZ_MAIN_SIZE]! - sz[SZ_FLEX_BASIS]!
    }
    _lastLineMain = sumBasis
    _lastLineCross = 0
    return
  }

  const crossLead = isMainRow ? EDGE_TOP : EDGE_LEFT
  const crossTrail = isMainRow ? EDGE_BOTTOM : EDGE_RIGHT
  const hasAvailCross = !Number.isNaN(innerAvailCross)
  let maxCross = 0

  for (let i = 0; i < n; i++) {
    const c = line[i]!
    const cs = c.style
    const align =
      cs.alignSelf === Align.Auto ? containerAlignItems : cs.alignSelf
    const crossMargin = childMarginForAxis(c, crossDir, childOwnerW)

    let childCrossAvail = NaN
    let childCrossMode: MeasureMode = MeasureMode.Undefined
    const explicitCross = resolveValue(
      isMainRow ? cs.height : cs.width,
      isMainRow ? childOwnerH : childOwnerW,
    )
    let hasCrossAutoMargin = false
    if (c._hasAutoMargin) {
      const m = cs.margin
      hasCrossAutoMargin =
        isMarginAuto(m, crossLead) || isMarginAuto(m, crossTrail)
    }

    if (!Number.isNaN(explicitCross)) {
      childCrossAvail = explicitCross
      childCrossMode = MeasureMode.Exactly
    } else if (
      align === Align.Stretch &&
      !hasCrossAutoMargin &&
      !isWrap &&
      hasAvailCross &&
      crossMode === MeasureMode.Exactly
    ) {
      childCrossAvail = Math.max(0, innerAvailCross - crossMargin)
      childCrossMode = MeasureMode.Exactly
    } else if (!isWrap && hasAvailCross) {
      childCrossAvail = Math.max(0, innerAvailCross - crossMargin)
      childCrossMode = MeasureMode.AtMost
    }

    const childW = isMainRow ? c._sz[SZ_MAIN_SIZE]! : childCrossAvail
    const childH = isMainRow ? childCrossAvail : c._sz[SZ_MAIN_SIZE]!
    layoutNode(
      c,
      childW,
      childH,
      isMainRow ? MeasureMode.Exactly : childCrossMode,
      isMainRow ? childCrossMode : MeasureMode.Exactly,
      childOwnerW,
      childOwnerH,
      performLayout,
      isMainRow,
      !isMainRow,
    )
    const cl = c.layout
    c._sz[SZ_CROSS_SIZE] = isMainRow ? cl.height : cl.width
    maxCross = Math.max(maxCross, c._sz[SZ_CROSS_SIZE]! + crossMargin)
  }

  const mainLead = leadingEdge(mainDir)
  const mainTrail = trailingEdge(mainDir)
  let totalMain = totalGap
  for (let i = 0; i < n; i++) {
    const c = line[i]!
    const m = c.layout.margin
    totalMain += c._sz[SZ_MAIN_SIZE]! + m[mainLead]! + m[mainTrail]!
  }
  if (Number.isNaN(totalMain) && n > 0 && line[0]!.config.checksNumbers) {
    line[0]!.config.onDamage?.()
  }
  _lastLineMain = totalMain
  _lastLineCross = maxCross
}

function positionFlexLine(
  line: Node[],
  parentStyle: Style,
  mainDir: FlexDirection,
  isMainRow: boolean,
  lineCross: number,
  lineCrossPos: number,
  lineMainSize: number,
  innerMain: number,
  mainStart: number,
  outerMain: number,
  mainGap: number,
  childOwnerW: number,
  childOwnerH: number,
  mainReverse: boolean,
  wrapReverse: boolean,
  hasBaseline: boolean,
  maxAscent: number,
): void {
  const n = line.length
  const containerAlignItems = parentStyle.alignItems
  const mainLead = leadingEdge(mainDir)
  const mainTrail = trailingEdge(mainDir)
  const crossLead = isMainRow ? EDGE_TOP : EDGE_LEFT
  const crossTrail = isMainRow ? EDGE_BOTTOM : EDGE_RIGHT

  let startPos = mainStart
  let gap = mainGap
  let autoMarginCount = 0
  for (let i = 0; i < n; i++) {
    const c = line[i]!
    if (!c._hasAutoMargin) continue
    const m = c.style.margin
    if (isMarginAuto(m, mainLead)) autoMarginCount++
    if (isMarginAuto(m, mainTrail)) autoMarginCount++
  }

  const freeMain = innerMain - lineMainSize
  const posFreeMain = Math.max(0, freeMain)
  const autoMarginShare =
    autoMarginCount > 0 && posFreeMain > 0 ? posFreeMain / autoMarginCount : 0

  if (autoMarginCount === 0) {
    switch (parentStyle.justifyContent) {
      case Justify.FlexStart:
        break
      case Justify.Center:
        startPos += freeMain / 2
        break
      case Justify.FlexEnd:
        startPos += freeMain
        break
      case Justify.SpaceBetween:
        if (n > 1) gap += posFreeMain / (n - 1)
        break
      case Justify.SpaceAround:
        if (n > 0) {
          gap += posFreeMain / n
          startPos += posFreeMain / n / 2
        }
        break
      case Justify.SpaceEvenly:
        if (n > 0) {
          gap += posFreeMain / (n + 1)
          startPos += posFreeMain / (n + 1)
        }
        break
    }
  }

  let cursor = startPos
  for (let i = 0; i < n; i++) {
    const c = line[i]!
    const { style: cs, layout: cl } = c
    const childMain = c._sz[SZ_MAIN_SIZE]!
    const mStyle = cs.margin
    const mLayout = cl.margin

    let autoMainLead = false
    let autoMainTrail = false
    let autoCrossLead = false
    let autoCrossTrail = false
    let leadM: number
    let trailM: number
    let cLeadM: number
    let cTrailM: number

    if (c._hasAutoMargin) {
      autoMainLead = isMarginAuto(mStyle, mainLead)
      autoMainTrail = isMarginAuto(mStyle, mainTrail)
      autoCrossLead = isMarginAuto(mStyle, crossLead)
      autoCrossTrail = isMarginAuto(mStyle, crossTrail)
      leadM = autoMainLead ? autoMarginShare : mLayout[mainLead]!
      trailM = autoMainTrail ? autoMarginShare : mLayout[mainTrail]!
      cLeadM = autoCrossLead ? 0 : mLayout[crossLead]!
      cTrailM = autoCrossTrail ? 0 : mLayout[crossTrail]!
    } else {
      leadM = mLayout[mainLead]!
      trailM = mLayout[mainTrail]!
      cLeadM = mLayout[crossLead]!
      cTrailM = mLayout[crossTrail]!
    }

    const mainPos = mainReverse
      ? outerMain - (cursor + leadM) - childMain
      : cursor + leadM
    const align =
      cs.alignSelf === Align.Auto ? containerAlignItems : cs.alignSelf
    let crossPos = lineCrossPos + cLeadM
    const freeCross = lineCross - c._sz[SZ_CROSS_SIZE]! - cLeadM - cTrailM

    if (autoCrossLead && autoCrossTrail) {
      crossPos += Math.max(0, freeCross) / 2
    } else if (autoCrossLead) {
      crossPos += Math.max(0, freeCross)
    } else if (autoCrossTrail) {
      // stays at leading edge
    } else {
      switch (align) {
        case Align.FlexStart:
        case Align.Stretch:
          if (wrapReverse) crossPos += freeCross
          break
        case Align.Center:
          crossPos += freeCross / 2
          break
        case Align.FlexEnd:
          if (!wrapReverse) crossPos += freeCross
          break
        case Align.Baseline:
          if (hasBaseline)
            crossPos = lineCrossPos + maxAscent - calculateBaseline(c)
          break
        default:
          break
      }
    }

    const isText = c.measureFunc !== null
    const rawLeft = isMainRow ? mainPos : crossPos
    const rawTop = isMainRow ? crossPos : mainPos
    const left = isText ? Math.floor(rawLeft) | 0 : roundInt(rawLeft)
    const top = isText ? Math.floor(rawTop) | 0 : roundInt(rawTop)

    if (c._hasPosition) {
      applyRelativePosition(c, childOwnerW, childOwnerH, cl, left, top)
    } else {
      cl.left = left
      cl.top = top
    }

    cursor += childMain + leadM + trailM + gap
  }
}

function splitFlexLines(
  flowChildren: Node[],
  innerAvailMain: number,
  isMainRow: boolean,
  mainDir: FlexDirection,
  childOwnerW: number,
  childOwnerH: number,
  mainGap: number,
): Node[][] {
  const lines: Node[][] = []
  const n = flowChildren.length
  let lineStart = 0
  let lineUsed = 0

  for (let i = 0; i < n; i++) {
    const c = flowChildren[i]!
    const clampedBasis = boundAxis(
      c.style,
      isMainRow,
      c._sz[SZ_FLEX_BASIS]!,
      childOwnerW,
      childOwnerH,
    )
    const itemOuter =
      Math.max(0, clampedBasis) + childMarginForAxis(c, mainDir, childOwnerW)
    const gapBefore = i > lineStart ? mainGap : 0
    if (i > lineStart && lineUsed + gapBefore + itemOuter > innerAvailMain) {
      lines.push(flowChildren.slice(lineStart, i))
      lineStart = i
      lineUsed = itemOuter
    } else {
      lineUsed += gapBefore + itemOuter
    }
    c._lineIndex = lines.length
  }

  lines.push(flowChildren.slice(lineStart))
  return lines
}

function computeLineBaselineCross(
  parent: Node,
  line: Node[],
  childOwnerW: number,
  lineMaxAscents: Int32Array,
  lineIdx: number,
  currentCross: number,
): number {
  let maxAscent = 0
  let maxDescent = 0
  for (let i = 0, len = line.length; i < len; i++) {
    const c = line[i]!
    if (resolveChildAlign(parent, c) !== Align.Baseline) continue
    const m = c.style.margin
    const mTop = resolveEdge(m, EDGE_TOP, childOwnerW)
    const mBot = resolveEdge(m, EDGE_BOTTOM, childOwnerW)
    const ascent = calculateBaseline(c) + mTop
    const descent = c.layout.height + mTop + mBot - ascent
    if (ascent > maxAscent) maxAscent = ascent
    if (descent > maxDescent) maxDescent = descent
  }
  lineMaxAscents[lineIdx] = maxAscent
  const baselineCross = maxAscent + maxDescent
  return baselineCross > currentCross ? baselineCross : currentCross
}

function distributeAlignContent(
  alignContent: Align,
  freeCross: number,
  numLines: number,
  lineCrossSizes: Int32Array,
): void {
  const posFree = Math.max(0, freeCross)
  _alignCrossOffset = 0
  _alignLineGapAdd = 0

  switch (alignContent) {
    case Align.FlexStart:
      break
    case Align.Center:
      _alignCrossOffset = freeCross / 2
      break
    case Align.FlexEnd:
      _alignCrossOffset = freeCross
      break
    case Align.Stretch:
      if (numLines > 0 && posFree > 0) {
        let acc = 0
        let prev = 0
        for (let i = 0; i < numLines; i++) {
          acc += posFree / numLines
          const cur = roundInt(acc)
          lineCrossSizes[i] = lineCrossSizes[i]! + (cur - prev)
          prev = cur
        }
      }
      break
    case Align.SpaceBetween:
      if (numLines > 1) _alignLineGapAdd = posFree / (numLines - 1)
      break
    case Align.SpaceAround:
      if (numLines > 0) {
        _alignLineGapAdd = posFree / numLines
        _alignCrossOffset = _alignLineGapAdd / 2
      }
      break
    case Align.SpaceEvenly:
      if (numLines > 0) {
        _alignLineGapAdd = posFree / (numLines + 1)
        _alignCrossOffset = _alignLineGapAdd
      }
      break
    default:
      break
  }
}

function stretchLineChildren(
  line: Node[],
  containerAlignItems: Align,
  isMainRow: boolean,
  crossDir: FlexDirection,
  crossLead: number,
  crossTrail: number,
  lineCross: number,
  childOwnerW: number,
  childOwnerH: number,
  performLayout: boolean,
): void {
  for (let i = 0, len = line.length; i < len; i++) {
    const c = line[i]!
    const cs = c.style
    const align =
      cs.alignSelf === Align.Auto ? containerAlignItems : cs.alignSelf
    if (align !== Align.Stretch) continue
    if (
      isDefined(
        resolveValue(
          isMainRow ? cs.height : cs.width,
          isMainRow ? childOwnerH : childOwnerW,
        ),
      )
    ) {
      continue
    }
    if (c._hasAutoMargin) {
      const m = cs.margin
      if (isMarginAuto(m, crossLead) || isMarginAuto(m, crossTrail)) continue
    }
    const crossMargin = childMarginForAxis(c, crossDir, childOwnerW)
    const targetCross = Math.max(0, lineCross - crossMargin)
    if (c._sz[SZ_CROSS_SIZE] !== targetCross) {
      const childMain = c._sz[SZ_MAIN_SIZE]!
      layoutNode(
        c,
        isMainRow ? childMain : targetCross,
        isMainRow ? targetCross : childMain,
        MeasureMode.Exactly,
        MeasureMode.Exactly,
        childOwnerW,
        childOwnerH,
        performLayout,
        isMainRow,
        !isMainRow,
      )
      c._sz[SZ_CROSS_SIZE] = targetCross
    }
  }
}

function applyRelativePosition(
  node: Node,
  ownerW: number,
  ownerH: number,
  layout: Layout,
  baseLeft: number,
  baseTop: number,
): void {
  const pos = node.style.position
  const posL = resolveValue(resolveEdgeRaw(pos, EDGE_LEFT), ownerW)
  const posR = resolveValue(resolveEdgeRaw(pos, EDGE_RIGHT), ownerW)
  const posT = resolveValue(resolveEdgeRaw(pos, EDGE_TOP), ownerH)
  const posB = resolveValue(resolveEdgeRaw(pos, EDGE_BOTTOM), ownerH)
  const dx = isDefined(posL) ? posL : isDefined(posR) ? -posR : 0
  const dy = isDefined(posT) ? posT : isDefined(posB) ? -posB : 0
  layout.left = (baseLeft + dx) | 0
  layout.top = (baseTop + dy) | 0
}

function layoutAbsoluteChild(
  parent: Node,
  child: Node,
  parentW: number,
  parentH: number,
  parentPad: Int32Array,
  parentBorder: Int32Array,
): void {
  const cs = child.style
  const posL = resolveValue(resolveEdgeRaw(cs.position, EDGE_LEFT), parentW)
  const posR = resolveValue(resolveEdgeRaw(cs.position, EDGE_RIGHT), parentW)
  const posT = resolveValue(resolveEdgeRaw(cs.position, EDGE_TOP), parentH)
  const posB = resolveValue(resolveEdgeRaw(cs.position, EDGE_BOTTOM), parentH)

  const innerW = parentW - parentBorder[0]! - parentBorder[2]!
  const innerH = parentH - parentBorder[1]! - parentBorder[3]!

  let childW = resolveValue(cs.width, innerW)
  let childH = resolveValue(cs.height, innerH)

  if (!isDefined(childW) && isDefined(posL) && isDefined(posR)) {
    childW = innerW - posL - posR
  }
  if (!isDefined(childH) && isDefined(posT) && isDefined(posB)) {
    childH = innerH - posT - posB
  }

  layoutNode(
    child,
    childW,
    childH,
    isDefined(childW) ? MeasureMode.Exactly : MeasureMode.Undefined,
    isDefined(childH) ? MeasureMode.Exactly : MeasureMode.Undefined,
    innerW,
    innerH,
    true,
    false,
    false,
  )

  const mL = resolveEdge(cs.margin, EDGE_LEFT, parentW)
  const mT = resolveEdge(cs.margin, EDGE_TOP, parentW)
  const mR = resolveEdge(cs.margin, EDGE_RIGHT, parentW)
  const mB = resolveEdge(cs.margin, EDGE_BOTTOM, parentW)

  const ps = parent.style
  const mainDir = ps.flexDirection
  const mainRev = isReverse(mainDir)
  const mainIsRow = isRow(mainDir)
  const wrapRev = ps.flexWrap === Wrap.WrapReverse
  const justify = ps.justifyContent
  const align = cs.alignSelf === Align.Auto ? ps.alignItems : cs.alignSelf

  const cl = child.layout
  const { width: w, height: h } = cl

  let left: number
  if (isDefined(posL)) {
    left = parentBorder[0]! + posL + mL
  } else if (isDefined(posR)) {
    left = parentW - parentBorder[2]! - posR - w - mR
  } else if (mainIsRow) {
    const start = parentPad[0]! + parentBorder[0]!
    const end = parentW - parentPad[2]! - parentBorder[2]!
    left = mainRev ? end - w - mR : alignAbsMain(justify, start, end, w) + mL
  } else {
    left =
      alignAbsCross(
        align,
        parentPad[0]! + parentBorder[0]!,
        parentW - parentPad[2]! - parentBorder[2]!,
        w,
        wrapRev,
      ) + mL
  }

  let top: number
  if (isDefined(posT)) {
    top = parentBorder[1]! + posT + mT
  } else if (isDefined(posB)) {
    top = parentH - parentBorder[3]! - posB - h - mB
  } else if (mainIsRow) {
    top =
      alignAbsCross(
        align,
        parentPad[1]! + parentBorder[1]!,
        parentH - parentPad[3]! - parentBorder[3]!,
        h,
        wrapRev,
      ) + mT
  } else {
    const start = parentPad[1]! + parentBorder[1]!
    const end = parentH - parentPad[3]! - parentBorder[3]!
    top = mainRev ? end - h - mB : alignAbsMain(justify, start, end, h) + mT
  }

  const isText = child.measureFunc !== null
  cl.left = isText ? Math.floor(left) | 0 : roundInt(left)
  cl.top = isText ? Math.floor(top) | 0 : roundInt(top)
}

function alignAbsMain(
  justify: Justify,
  start: number,
  end: number,
  size: number,
): number {
  switch (justify) {
    case Justify.Center:
      return start + (end - start - size) / 2
    case Justify.FlexEnd:
      return end - size
    default:
      return start
  }
}

function alignAbsCross(
  align: Align,
  start: number,
  end: number,
  size: number,
  wrapReverse: boolean,
): number {
  switch (align) {
    case Align.Center:
      return start + (end - start - size) / 2
    case Align.FlexEnd:
      return wrapReverse ? start : end - size
    default:
      return wrapReverse ? end - size : start
  }
}

// --
// Flex basis (`CC`, `RC`, `TC`, `zb`)

function computeFlexBasis(
  child: Node,
  mainDir: FlexDirection,
  innerAvailMain: number,
  innerAvailCross: number,
  crossMode: MeasureMode,
  childOwnerW: number,
  childOwnerH: number,
): number {
  const fb = child._fb
  const gen = child.config.generation
  const pOW = child._readsOwnerWidth ? packInt(childOwnerW) : NAN_SENTINEL
  const pOH = child._readsOwnerHeight ? packInt(childOwnerH) : NAN_SENTINEL
  const isMainRow = isRow(mainDir)
  const pAvailMain =
    isMainRow || child.style.flexBasis.unit === Unit.Percent
      ? packInt(innerAvailMain)
      : NAN_SENTINEL
  const pAvailCross = packInt(innerAvailCross)

  if (
    (child._fbGen === gen || !child.isDirty_) &&
    child._fbCrossMode === crossMode &&
    child._fbIsRow === isMainRow &&
    fb[FB_OWNER_W] === pOW &&
    fb[FB_OWNER_H] === pOH &&
    fb[FB_AVAIL_MAIN] === pAvailMain &&
    fb[FB_AVAIL_CROSS] === pAvailCross
  ) {
    return fb[FB_BASIS]!
  }

  const basis = isMainRow
    ? computeFlexBasisRow(
        child,
        innerAvailMain,
        innerAvailCross,
        crossMode,
        childOwnerW,
        childOwnerH,
      )
    : computeFlexBasisColumn(
        child,
        innerAvailMain,
        innerAvailCross,
        crossMode,
        childOwnerW,
        childOwnerH,
      )

  fb[FB_BASIS] = basis
  fb[FB_OWNER_W] = pOW
  fb[FB_OWNER_H] = pOH
  fb[FB_AVAIL_MAIN] = pAvailMain
  fb[FB_AVAIL_CROSS] = pAvailCross
  child._fbCrossMode = crossMode
  child._fbIsRow = isMainRow
  child._fbGen = gen
  return basis
}

function computeFlexBasisRow(
  child: Node,
  innerAvailMain: number,
  innerAvailCross: number,
  crossMode: MeasureMode,
  childOwnerW: number,
  childOwnerH: number,
): number {
  const cs = child.style
  const fbVal = resolveValue(cs.flexBasis, innerAvailMain)
  if (!Number.isNaN(fbVal)) return fbVal > 0 ? fbVal : 0

  const styleW = resolveValue(cs.width, childOwnerW)
  if (!Number.isNaN(styleW)) return styleW > 0 ? styleW : 0

  let crossAvail = resolveValue(cs.height, childOwnerH)
  let cMode: MeasureMode
  if (!Number.isNaN(crossAvail)) {
    cMode = MeasureMode.Exactly
  } else if (!Number.isNaN(innerAvailCross)) {
    crossAvail =
      innerAvailCross -
      childMarginForAxis(child, FlexDirection.Column, childOwnerW)
    cMode =
      crossMode === MeasureMode.Exactly && isStretchAlign(child)
        ? MeasureMode.Exactly
        : MeasureMode.AtMost
  } else {
    cMode = MeasureMode.Undefined
  }

  let mainAvail = NaN
  let mMode: MeasureMode = MeasureMode.Undefined
  if (!Number.isNaN(innerAvailMain) && hasMeasureDescendant(child)) {
    mainAvail =
      innerAvailMain - childMarginForAxis(child, FlexDirection.Row, childOwnerW)
    mMode = MeasureMode.AtMost
  }

  layoutNode(
    child,
    mainAvail,
    crossAvail,
    mMode,
    cMode,
    childOwnerW,
    childOwnerH,
    false,
    false,
    false,
  )
  return child.layout.width
}

function computeFlexBasisColumn(
  child: Node,
  innerAvailMain: number,
  innerAvailCross: number,
  crossMode: MeasureMode,
  childOwnerW: number,
  childOwnerH: number,
): number {
  const cs = child.style
  const fbVal = resolveValue(cs.flexBasis, innerAvailMain)
  if (!Number.isNaN(fbVal)) return fbVal > 0 ? fbVal : 0

  const styleH = resolveValue(cs.height, childOwnerH)
  if (!Number.isNaN(styleH)) return styleH > 0 ? styleH : 0

  let crossAvail = resolveValue(cs.width, childOwnerW)
  let cMode: MeasureMode
  if (!Number.isNaN(crossAvail)) {
    cMode = MeasureMode.Exactly
  } else if (!Number.isNaN(innerAvailCross)) {
    crossAvail =
      innerAvailCross -
      childMarginForAxis(child, FlexDirection.Row, childOwnerW)
    cMode =
      crossMode === MeasureMode.Exactly && isStretchAlign(child)
        ? MeasureMode.Exactly
        : MeasureMode.AtMost
  } else {
    cMode = MeasureMode.Undefined
  }

  layoutNode(
    child,
    crossAvail,
    NaN,
    cMode,
    MeasureMode.Undefined,
    childOwnerW,
    childOwnerH,
    false,
    false,
    false,
  )
  return child.layout.height
}

function hasMeasureDescendant(node: Node): boolean {
  if (node.measureFunc) return true
  const kids = node.children
  for (let i = 0, len = kids.length; i < len; i++) {
    if (hasMeasureDescendant(kids[i]!)) return true
  }
  return false
}

// --
// Flexible length resolution (`MC`, `ll`, `Tf`, `Mf`, `lu`, `Mb`)

let _frozenBits = new Int32Array(8)
let _unclampedScratch = new Float64Array(64)
let _clampedScratch = new Float64Array(64)

function isFrozen(idx: number): number {
  return _frozenBits[idx >>> 5]! & (1 << idx)
}

function markFrozen(idx: number): void {
  _frozenBits[idx >>> 5] = _frozenBits[idx >>> 5]! | (1 << idx)
}

function resolveFlexibleLengths(
  children: Node[],
  availMain: number,
  sumBasis: number,
  isMainRow: boolean,
  ownerW: number,
  ownerH: number,
): void {
  const n = children.length
  const words = (n + 31) >>> 5
  if (words > _frozenBits.length) _frozenBits = new Int32Array(words * 2)
  if (n > _unclampedScratch.length) _unclampedScratch = new Float64Array(n * 2)
  if (n > _clampedScratch.length) _clampedScratch = new Float64Array(n * 2)

  const unclamped = _unclampedScratch
  const clamped = _clampedScratch
  _frozenBits.fill(0, 0, words)

  const initialFree = isDefined(availMain) ? availMain - sumBasis : 0

  for (let i = 0; i < n; i++) {
    const c = children[i]!
    const cs = c.style
    const basis = c._sz[SZ_FLEX_BASIS]!
    const bounded = boundAxis(cs, isMainRow, basis, ownerW, ownerH)
    if (
      !isDefined(availMain) ||
      (initialFree >= 0 ? cs.flexGrow === 0 : cs.flexShrink === 0)
    ) {
      clamped[i] = Math.max(0, bounded)
      markFrozen(i)
    } else {
      clamped[i] = basis
    }
  }

  for (let pass = 0; pass <= n; pass++) {
    let frozenDelta = 0
    let totalGrow = 0
    let totalShrinkScaled = 0
    let unfrozenCount = 0

    for (let i = 0; i < n; i++) {
      const c = children[i]!
      const basis = c._sz[SZ_FLEX_BASIS]!
      if (isFrozen(i)) {
        frozenDelta += clamped[i]! - basis
      } else {
        const cs = c.style
        totalGrow += cs.flexGrow
        totalShrinkScaled += cs.flexShrink * basis
        unfrozenCount++
      }
    }

    if (unfrozenCount === 0) break

    let remaining = initialFree - frozenDelta
    if (remaining > 0 && totalGrow > 0 && totalGrow < 1) {
      const scaled = initialFree * totalGrow
      if (scaled < remaining) remaining = scaled
    } else if (remaining < 0 && totalShrinkScaled > 0) {
      let totalShrink = 0
      for (let i = 0; i < n; i++) {
        if (!isFrozen(i)) totalShrink += children[i]!.style.flexShrink
      }
      if (totalShrink < 1) {
        const scaled = initialFree * totalShrink
        if (scaled > remaining) remaining = scaled
      }
    }

    let totalViolation = 0
    for (let i = 0; i < n; i++) {
      if (isFrozen(i)) continue
      const c = children[i]!
      const cs = c.style
      const basis = c._sz[SZ_FLEX_BASIS]!
      let target = basis
      if (remaining > 0 && totalGrow > 0) {
        target += (remaining * cs.flexGrow) / totalGrow
      } else if (remaining < 0 && totalShrinkScaled > 0) {
        target += (remaining * (cs.flexShrink * basis)) / totalShrinkScaled
      }
      unclamped[i] = target
      const next = Math.max(0, boundAxis(cs, isMainRow, target, ownerW, ownerH))
      clamped[i] = next
      totalViolation += next - target
    }

    if (totalViolation === 0) break

    let anyFrozen = false
    for (let i = 0; i < n; i++) {
      if (isFrozen(i)) continue
      const v = clamped[i]! - unclamped[i]!
      if ((totalViolation > 0 && v > 0) || (totalViolation < 0 && v < 0)) {
        markFrozen(i)
        anyFrozen = true
      }
    }
    if (!anyFrozen) break
  }

  let acc = 0
  let prev = 0
  for (let i = 0; i < n; i++) {
    acc += clamped[i]!
    const cur = (acc + 0.5) | 0
    children[i]!._sz[SZ_MAIN_SIZE] = cur - prev
    prev = cur
  }
}

// --
// Alignment, baseline, margin, gap, min/max, child collection (`Ub`, `Wb`, `Pf`, `AC`, `ho`, `Ab`, `Wn`, `NC`, `_f`, `OC`, `jb`, `Gb`)

function isStretchAlign(child: Node): boolean {
  const p = child.parent
  if (!p) return false
  const self = child.style.alignSelf
  return (self === Align.Auto ? p.style.alignItems : self) === Align.Stretch
}

function resolveChildAlign(parent: Node, child: Node): Align {
  const self = child.style.alignSelf
  return self === Align.Auto ? parent.style.alignItems : self
}

function calculateBaseline(node: Node): number {
  const kids = node.children
  const n = kids.length
  let baselineIdx = -1
  for (let i = 0; i < n; i++) {
    const c = kids[i]!
    if (c._lineIndex > 0) break
    const cs = c.style
    if (cs.positionType === PositionType.Absolute) continue
    if (cs.display === Display.None) continue
    if (
      resolveChildAlign(node, c) === Align.Baseline ||
      c.isReferenceBaseline_
    ) {
      baselineIdx = i
      break
    }
    if (baselineIdx === -1) baselineIdx = i
  }
  if (baselineIdx === -1) return node.layout.height
  const target = kids[baselineIdx]!
  return calculateBaseline(target) + target.layout.top
}

function isBaselineLayout(node: Node, flowChildren: Node[]): boolean {
  const s = node.style
  if (!isRow(s.flexDirection)) return false
  if (s.alignItems === Align.Baseline) return true
  for (let i = 0, len = flowChildren.length; i < len; i++) {
    if (flowChildren[i]!.style.alignSelf === Align.Baseline) return true
  }
  return false
}

function childMarginForAxis(
  child: Node,
  axis: FlexDirection,
  ownerWidth: number,
): number {
  if (!child._hasMargin) return 0
  const m = child.style.margin
  return (
    resolveEdge(m, leadingEdge(axis), ownerWidth) +
    resolveEdge(m, trailingEdge(axis), ownerWidth)
  )
}

function resolveGap(style: Style, gutter: Gutter, ownerSize: number): number {
  let v = style.gap[gutter]!
  if (v.unit === Unit.Undefined) v = style.gap[Gutter.All]!
  const r = resolveValue(v, ownerSize)
  return isDefined(r) ? Math.max(0, r) : 0
}

function boundAxis(
  style: Style,
  isWidth: boolean,
  value: number,
  ownerW: number,
  ownerH: number,
): number {
  const minV = isWidth ? style.minWidth : style.minHeight
  const maxV = isWidth ? style.maxWidth : style.maxHeight
  const minU = minV.unit
  const maxU = maxV.unit
  if (minU === Unit.Undefined && maxU === Unit.Undefined) return value
  const minVal = minU === Unit.Point || minU === Unit.Percent ? minV.value : 0
  const maxVal = maxU === Unit.Point || maxU === Unit.Percent ? maxV.value : 0
  return clampValue(
    value,
    minU,
    maxU,
    minVal,
    maxVal,
    isWidth ? ownerW : ownerH,
  )
}

function clampValue(
  value: number,
  minUnit: Unit,
  maxUnit: Unit,
  minVal: number,
  maxVal: number,
  ownerSize: number,
): number {
  let v = value
  if (maxUnit === Unit.Point) {
    if (v > maxVal) v = maxVal
  } else if (maxUnit === Unit.Percent) {
    const m = (maxVal * ownerSize) / 100
    if (isInt32Range(m) && v > m) v = roundInt(m)
  }
  if (minUnit === Unit.Point) {
    if (v < minVal) v = minVal
  } else if (minUnit === Unit.Percent) {
    const m = (minVal * ownerSize) / 100
    if (isInt32Range(m) && v < m) v = roundInt(m)
  }
  return v
}

function zeroLayoutBox(layout: Layout): void {
  layout.left = 0
  layout.top = 0
  layout.width = 0
  layout.height = 0
}

function invalidateHiddenNode(node: Node): void {
  zeroLayoutBox(node.layout)
  node.isDirty_ = true
  node._hasL = false
  node._hasM = false
}

function zeroLayoutRecursive(node: Node): void {
  const kids = node.children
  for (let i = 0, len = kids.length; i < len; i++) {
    const c = kids[i]!
    invalidateHiddenNode(c)
    zeroLayoutRecursive(c)
  }
}

function collectLayoutChildren(node: Node, flow: Node[], abs: Node[]): void {
  const kids = node.children
  for (let i = 0, len = kids.length; i < len; i++) {
    const c = kids[i]!
    const cs = c.style
    const disp = cs.display
    if (disp === Display.None) {
      zeroLayoutBox(c.layout)
      zeroLayoutRecursive(c)
    } else if (disp === Display.Contents) {
      zeroLayoutBox(c.layout)
      collectLayoutChildren(c, flow, abs)
    } else if (cs.positionType === PositionType.Absolute) {
      abs.push(c)
    } else {
      flow.push(c)
    }
  }
}

// --
// Parsing & edge mapping (`gr`, `Af`)

function parseDimension(v: number | string | undefined): Value {
  if (v === undefined) return UNDEFINED_VALUE
  if (v === 'auto') return AUTO_VALUE
  if (typeof v === 'number') {
    return Number.isFinite(v) ? pointValue(v) : UNDEFINED_VALUE
  }
  if (typeof v === 'string' && v.endsWith('%')) {
    const pct = parseFloat(v)
    return Number.isFinite(pct) ? percentValue(pct) : UNDEFINED_VALUE
  }
  const n = parseFloat(v)
  return Number.isFinite(n) ? pointValue(n) : UNDEFINED_VALUE
}

function physicalEdge(edge: Edge): number {
  switch (edge) {
    case Edge.Left:
    case Edge.Start:
      return EDGE_LEFT
    case Edge.Top:
      return EDGE_TOP
    case Edge.Right:
    case Edge.End:
      return EDGE_RIGHT
    case Edge.Bottom:
      return EDGE_BOTTOM
    default:
      return EDGE_LEFT
  }
}

// --
// Module API matching official `DC` + `yoga-layout/load`

export type Yoga = {
  Config: {
    create(): Config
    destroy(config: Config): void
  }
  Node: {
    create(config?: Config): Node
    createDefault(): Node
    createWithConfig(config: Config): Node
    destroy(node: Node): void
  }
}

const YOGA_INSTANCE: Yoga = {
  Config: {
    create: createConfig,
    destroy() {},
  },
  Node: {
    create: (config?: Config) => new Node(config),
    createDefault: () => new Node(),
    createWithConfig: (config: Config) => new Node(config),
    destroy() {},
  },
}

export function loadYoga(): Promise<Yoga> {
  return Promise.resolve(YOGA_INSTANCE)
}

export default YOGA_INSTANCE
