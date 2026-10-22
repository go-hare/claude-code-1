/**
 * densable 2.1.289 `pr` / `nr` / `sr` / `d8n` / `RZ` / `g2e` / `Qe` / `jo` /
 * `ar` askedOnScreen. t7t wraps a site drawing in a Box whose minHeight is
 * the held row count so an off-screen g2e card keeps lastRows, then nr
 * releases on fallback.
 */

import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'

/** densable `RZ`. */
export const RZ = Object.freeze({ type: 'engine', ref: 0 })

/** densable `g2e` — transcript cards whose t7t measures lastRows. */
export const G2E_COMPONENTS = Object.freeze([
  'UserMessage',
  'AssistantMessage',
  'ToolUse',
  'ToolResult',
  'ToolGroup',
  'CommandOutput',
  'TurnDuration',
  'InfoNotice',
])

export type OnScreenRows = { first: number; last: number; of: number }

export type HeldSiteRows = {
  rows: number | undefined
  wasOff: boolean
  input: unknown
  drawn: unknown
}

export type HeldSiteInput = {
  input: unknown
  drawn: unknown
  lastRows?: number
  contentRows?: number
  isFallback?: boolean
}

/** Structural yoga/DOM subset for `Qe` / `jo`. */
export type ScreenSiteNode = {
  parentNode?: ScreenSiteNode
  yogaNode?: {
    getDisplay(): string | number
    getComputedTop(): number
    getComputedHeight(): number
    getComputedBorder(edge: 'top' | 'bottom'): number
    getComputedPadding(edge: 'top' | 'bottom'): number
  }
  style?: { overflow?: string; overflowY?: string }
  scrollTop?: number
  childNodes?: readonly { yogaNode?: { getComputedHeight(): number } }[]
}

const askedBySite = new Map<string, OnScreenRows | null>()
const heldBySite = new Map<string, number>()

export function isG2eComponent(component: string): boolean {
  return (G2E_COMPONENTS as readonly string[]).includes(component)
}

/** densable `d8n`. */
export function d8n(input: {
  props?: Record<string, unknown>
}): OnScreenRows | null | undefined {
  const props = input.props
  if (props === undefined || !Object.hasOwn(props, 'onScreen')) {
    return undefined
  }
  const n = props.onScreen
  const r =
    typeof n === 'object' && n !== null
      ? (n as Record<string, unknown>)
      : undefined
  const s = r && 'first' in r ? r.first : null
  const h = r && 'last' in r ? r.last : null
  const g = r && 'of' in r ? r.of : null
  if (typeof s === 'number' && typeof h === 'number' && typeof g === 'number') {
    return { first: s, last: h, of: g }
  }
  return n === null ? null : undefined
}

export function isEngineFallback(drawn: unknown): boolean {
  return (
    typeof drawn === 'object' &&
    drawn !== null &&
    (drawn as { type?: unknown }).type === 'engine'
  )
}

export function hasPluginDrawing(drawn: unknown): boolean {
  if (drawn === undefined || drawn === null) return false
  if (isEngineFallback(drawn)) return false
  return typeof drawn === 'string' || typeof drawn === 'object'
}

/** densable `isOff: h && d8n(f)===null`. */
export function siteIsOff(
  hasHook: boolean,
  input: { props?: Record<string, unknown> },
): boolean {
  return hasHook && d8n(input) === null
}

/** densable `jo`. */
export function jo(
  node: ScreenSiteNode,
  clip: ScreenSiteNode,
  loc: { top: number; itemTop: number; itemHeight: number },
): OnScreenRows | null | undefined {
  const u = clip.scrollTop
  const c = clip.yogaNode
  const m = node.yogaNode?.getComputedHeight()
  if (u === undefined || !c || !m) return undefined
  const f = c.getComputedBorder('top')
  const C = c.getComputedHeight() - c.getComputedBorder('bottom')
  const v = f + c.getComputedPadding('top')
  const h = C - c.getComputedPadding('bottom')
  const S = loc.top - u
  const R = loc.itemTop - u
  const E = R + loc.itemHeight <= v || R >= h
  const P = Math.max(S, f)
  const T = Math.min(S + m, C)
  return E || P >= T ? null : { first: P - S, last: T - S - 1, of: m }
}

/** densable `Qe` — walk to overflow:scroll ancestor, then jo. */
export function Qe(
  node: ScreenSiteNode | null | undefined,
): OnScreenRows | null | undefined {
  if (!node?.yogaNode) return undefined
  const display = node.yogaNode.getDisplay()
  if (display === 'none' || display === 1) return null
  let r = 0
  let l: ScreenSiteNode = node
  for (;;) {
    const u = l.parentNode
    if (!u?.yogaNode || !l.yogaNode) return undefined
    r += l.yogaNode.getComputedTop()
    const c = u.parentNode
    const overflow = c?.style?.overflowY ?? c?.style?.overflow
    if (c?.yogaNode !== undefined && overflow === 'scroll') {
      return jo(node, c, {
        top: u.yogaNode.getComputedTop() + r,
        itemTop: u.yogaNode.getComputedTop() + l.yogaNode.getComputedTop(),
        itemHeight: l.yogaNode.getComputedHeight(),
      })
    }
    l = u
  }
}

export function askedOnScreenOf(id: string): OnScreenRows | null | undefined {
  return askedBySite.get(id)
}

export function rememberAskedOnScreen(
  id: string,
  screen: OnScreenRows | null,
): void {
  askedBySite.set(id, screen)
}

/** densable `noteHeldRows` — only when onScreen is explicitly null. */
export function noteHeldRows(
  id: string,
  onScreen: OnScreenRows | null | undefined,
  rows: number,
): void {
  if (onScreen === null) heldBySite.set(id, rows)
}

export function heldRowsOf(id: string): number | undefined {
  return heldBySite.get(id)
}

export function resetSiteHoldNotes(): void {
  askedBySite.clear()
  heldBySite.clear()
}

/** densable `nr` — site is on; release held rows on fallback / new draw. */
export function nr(state: HeldSiteRows, input: HeldSiteInput): HeldSiteRows {
  const { input: p, drawn: a, contentRows: m, isFallback: f } = input
  return state.rows !== undefined &&
    (f || state.drawn !== a || (m !== undefined && m >= state.rows))
    ? { rows: undefined, wasOff: false, input: p, drawn: a }
    : state.wasOff
      ? { ...state, wasOff: false }
      : state
}

/** densable `sr` — site is off; hold lastRows so cards stay put. */
export function sr(state: HeldSiteRows, input: HeldSiteInput): HeldSiteRows {
  const { input: p, drawn: a, lastRows: m, contentRows: f } = input
  const empty = f === 0
  const firstOff = !state.wasOff
  const inputChanged = state.input !== p
  const holdMissing = empty && state.rows === undefined
  return firstOff
    ? { rows: m, wasOff: true, input: p, drawn: a }
    : inputChanged
      ? { rows: empty ? m : undefined, wasOff: true, input: p, drawn: a }
      : holdMissing
        ? { ...state, rows: m, drawn: a }
        : { ...state, drawn: a }
}

export function nextHeldSiteRows(
  state: HeldSiteRows,
  input: HeldSiteInput & { isOff: boolean },
): HeldSiteRows {
  return input.isOff ? sr(state, input) : nr(state, input)
}

/** densable `pr`. */
export function useHeldSiteRows(
  input: HeldSiteInput & { isOff: boolean },
): number | undefined {
  const [state, setState] = useState<HeldSiteRows>(() => ({
    rows: input.isOff ? input.lastRows : undefined,
    wasOff: input.isOff,
    input: input.input,
    drawn: input.drawn,
  }))
  const next = nextHeldSiteRows(state, input)
  if (
    next.rows !== state.rows ||
    next.wasOff !== state.wasOff ||
    next.input !== state.input ||
    next.drawn !== state.drawn
  ) {
    setState(next)
  }
  return next.rows
}

export type SiteMeasureSnapshot = {
  rows: OnScreenRows | null | undefined
  lastRows: number | undefined
  contentRows: number | undefined
}

function sameOnScreen(
  a: OnScreenRows | null | undefined,
  b: OnScreenRows | null | undefined,
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.first === b.first && a.last === b.last && a.of === b.of
}

/**
 * densable `mDn` — `useSyncExternalStore(subscribeFrames, read yoga+Qe)`.
 * `subscribeFrames` is Ink's paint bus (`ib.subscribeFrames`), not raster blit.
 */
export function useSiteMeasure(
  enabled: boolean,
  siteId: string,
  subscribeFrames?: (listener: () => void) => () => void,
): {
  ref: RefObject<ScreenSiteNode | null>
  lastRows: number | undefined
  contentRows: number | undefined
  onScreen: OnScreenRows | null | undefined
} {
  const ref = useRef<ScreenSiteNode | null>(null)
  const snap = useRef<SiteMeasureSnapshot>({
    rows: askedOnScreenOf(siteId),
    lastRows: heldRowsOf(siteId),
    contentRows: undefined,
  })
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!enabled || subscribeFrames === undefined) return () => {}
      return subscribeFrames(onStoreChange)
    },
    [enabled, subscribeFrames],
  )
  const getSnapshot = (): SiteMeasureSnapshot => {
    if (!enabled) return snap.current
    const node = ref.current
    const height = node?.yogaNode?.getComputedHeight()
    const kids = node?.childNodes?.reduce(
      (sum, child) => sum + (child.yogaNode?.getComputedHeight() ?? 0),
      0,
    )
    const screen = Qe(node)
    const prev = snap.current
    const sameRows = screen === undefined || sameOnScreen(screen, prev.rows)
    const content = height === undefined ? undefined : kids
    if (!(sameRows && content === prev.contentRows)) {
      const next: SiteMeasureSnapshot = {
        rows: sameRows ? prev.rows : screen,
        lastRows: height || prev.lastRows,
        contentRows: content,
      }
      snap.current = next
      if (next.rows !== undefined) {
        rememberAskedOnScreen(siteId, next.rows)
        noteHeldRows(siteId, next.rows, height ?? 0)
      }
      return next
    }
    if (height) prev.lastRows = height
    return prev
  }
  const seen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    ref,
    lastRows: seen.lastRows,
    contentRows: seen.contentRows,
    onScreen: seen.rows,
  }
}
