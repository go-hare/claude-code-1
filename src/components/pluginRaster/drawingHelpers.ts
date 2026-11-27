import {
  Box,
  Text,
  stringWidth,
  measureElement,
  type DOMElement,
  type Key,
  type MouseActionEvent,
  type WheelEvent,
} from '@anthropic/ink'
import type { ComponentProps, RefObject } from 'react'
import { getRenderVersion } from '../../utils/render/invalidateAllRenders.js'
import {
  ABOVE_PROMPT_REQUEST_ID,
  dispatchPersonUiScroll,
  getPluginDrawingTrees,
  getRasterFrameVersion,
  invokePress,
  heldPress,
  heldByKeyOf,
  normalizeModTextWrapAndMaxLines,
  recordPress,
} from '../../utils/plugins/functionHooksModules.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  getActiveSessionFromAls,
  runWithSession,
  type Session,
} from '../../utils/sessionRoot.js'
import { Jmn, L1t, tellerOf } from '../../utils/plugins/pluginDrawError.js'
import {
  computeWheelStep,
  initWheelAccel,
  isWheelScrollAccelerationEnabled,
  resolveWheelProfile,
  type WheelAccelState,
  type WheelProfile,
} from '../ScrollKeybindingHandler.js'

/** densable Select `at=8` — open list window (`FMn` / `s$`). */
const SELECT_WINDOW = 8

/**
 * densable `lEe` — AZERTY unshifted digit row → ASCII digit, for Wm.
 * Gold: `&→1 é→2 "→3 '→4 (→5 -→6 è→7 _→8 ç→9 à→0`.
 */
export const AZERTY_DIGIT: ReadonlyMap<string, string> = new Map([
  ['&', '1'],
  ['é', '2'],
  ['"', '3'],
  ["'", '4'],
  ['(', '5'],
  ['-', '6'],
  ['§', '6'],
  ['è', '7'],
  ['_', '8'],
  ['ç', '9'],
  ['à', '0'],
])

export const BAND_DIGIT_DEBOUNCE_MS = 400

export const BAND_DIGIT_MOUNT_DELAY_MS = 600

/** densable `yy.DOCK_GRIP_COLUMNS` / `XN`. */
export const DOCK_GRIP_COLUMNS = 1

/** densable `dL` — CloseMark inset from the pane edge. */
export const BORDER_MARK_INSET = 2

/** densable `VZ` — CloseMark reserved columns. */
export const CLOSE_MARK_COLUMNS = 2

/** densable `k$` — CloseMark glyph cells. */
export const CLOSE_MARK_CELLS = 1

/** densable `dee` — max title-tab columns (`UM`). */
export const TITLE_TAB_MAX_COLUMNS = 12

/**
 * densable `lL=(h,v)=>(h||!v?1:0)+(v?2:0)` where `h=open.length>1`, `v=!fill`.
 * Title/spacer 1: multi-open `_$` strip, or single-pane **dock** `height:1`.
 * Round-border +2: inline (`!fill`) top+bottom `borderStyle:"round"`.
 */
export function paneTitleChromeRows(multiOpen: boolean, fill: boolean): number {
  return (multiOpen || fill ? 1 : 0) + (fill ? 0 : 2)
}

/** densable `xZ=4` — inline round-border left+right (border+paddingX). */
export const INLINE_PANE_CHROME_COLUMNS = 4

/** densable `UM(title)` — min(stringWidth(title)+2, 12). */
export function titleTabColumns(title: string): number {
  return Math.min(stringWidth(title) + 2, TITLE_TAB_MAX_COLUMNS)
}

/**
 * densable `w$` — leftmost open-pane index that still fits `columns` ending at shownId.
 */
export function titleStripStart(input: {
  open: ReadonlyArray<{ id: string; title: string }>
  shownId: string
  columns: number
}): number {
  const at = input.open.findIndex(pane => pane.id === input.shownId)
  let start = Math.max(0, at)
  let used = -1
  for (let i = at; i >= 0; i--) {
    used += 1 + titleTabColumns(input.open[i]?.title ?? '')
    if (used > input.columns && i < at) break
    start = i
  }
  return start
}

type HotkeyPress = { plugin: string; handle: unknown }

/**
 * densable `r$` — walk drawing; Button with hotkey → Map<hotkey, press>.
 */
export function hotkeyMapOfDrawing(drawn: unknown): Map<string, HotkeyPress> {
  const map = new Map<string, HotkeyPress>()
  const walk = (node: unknown): void => {
    if (typeof node === 'string' || node === undefined || node === null) return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (!isRecord(node)) return
    if (node.type === 'Button') {
      const props = isRecord(node.props) ? node.props : node
      const hotkey = typeof props.hotkey === 'string' ? props.hotkey : undefined
      const press = pressOf(node)
      if (hotkey !== undefined && press !== undefined) map.set(hotkey, press)
      return
    }
    if (node.type !== 'engine') {
      const props = isRecord(node.props) ? node.props : undefined
      for (const child of childList(node, props ?? {})) walk(child)
    }
  }
  walk(drawn)
  return map
}

export type HotkeyYogaSeat = {
  hotkey: string
  top: number
  height: number
}

/**
 * densable `LZ` — cue off means every digit is visible. Cue on means every
 * yoga seat for that digit sits fully inside [offset, offset+windowRows].
 */
export function hotkeyDigitVisible(
  hasCue: boolean,
  digit: string,
  seats: readonly HotkeyYogaSeat[],
  offset: number,
  windowRows: number,
): boolean {
  if (!hasCue) return true
  const mine = seats.filter(seat => seat.hotkey === digit)
  if (mine.length === 0) return false
  const end = offset + windowRows
  return mine.every(seat => seat.top >= offset && seat.top + seat.height <= end)
}

export function hotkeySeatsIn(content: DOMElement | null): HotkeyYogaSeat[] {
  if (content === null) return []
  const seats: HotkeyYogaSeat[] = []
  const walk = (node: DOMElement): void => {
    const hotkey = node.attributes.hotkey
    const yoga = node.yogaNode
    if (typeof hotkey === 'string' && yoga) {
      seats.push({
        hotkey,
        top: yoga.getComputedTop(),
        height: yoga.getComputedHeight(),
      })
    }
    for (const child of node.childNodes) {
      if (child.nodeName === '#text') continue
      walk(child)
    }
  }
  walk(content)
  return seats
}

/**
 * densable `BZ(h,v,M)` — if press exists and `v()` (visible), `M()` then fire.
 */
export function pressShownDigit(
  press: HotkeyPress | undefined,
  visible: () => boolean,
  clear: () => void,
): void {
  if (press !== undefined && visible()) {
    clear()
    firePress(press.plugin, press.handle)
  }
}

/** densable `hL` — printable, no ctrl/meta/super/escape/tab/return. */
export function isHotkeyType(input: string, key: Key): boolean {
  return (
    !key.ctrl &&
    !key.meta &&
    !key.super &&
    !key.escape &&
    !key.tab &&
    !key.return &&
    /^[^\p{C}\p{Z}]+$/u.test(input)
  )
}

/**
 * densable `HZ` — NFKC-lowercase each typed char through the hotkey Map.
 * All chars must hit or the chord is dropped.
 */
export function resolveHotkeyPresses(
  input: string,
  key: Key,
  seats: Map<string, HotkeyPress>,
): HotkeyPress[] {
  if (!isHotkeyType(input, key)) return []
  const mapped = [...input.normalize('NFKC').toLowerCase()].map(ch =>
    seats.get(ch),
  )
  const hits = mapped.filter((row): row is HotkeyPress => row !== undefined)
  return hits.length === mapped.length ? hits : []
}

/**
 * densable band chrome (AbovePrompt) — SEA 2.1.289 `_Ee` / `EZ` / `n$` / `OM` /
 * `IZ` / `a$` / `gL` / `yEe`. Soft remainder `l$`/`xze`/`d$`/`m$` HAVE.
 * `m$` HAVE: `usePluginInputSeat` lifted as `_Ee`/`pee` `rr` into g$ `inputs`.
 *
 * `y$` HAVE: `usePluginSelectSeat` `{fields, handlers, intercept}` over kL(YFt)+Pc.
 * `g$` HAVE on PluginAbovePromptSite and pee (Pane bag + isAhead).
 * `$l` HAVE via `useYogaMeasure` (subscribeLayout).
 * Keep effortSlider:* untouched. DualInk `onPointer` HAVE (named then alias).
 *
 * densable Chat panes (`Si`/`JSn`/`EMPTY_PANES`) HAVE as semantic store in
 * `functionHooksModules` (`getPanesState`/`getPanesStore`/`setPanesState`/
 * `subscribePanes`, `focusPane`/`nextFocusedPaneId`/`offerPanePlacement`/
 * `settlePaneFocusRequest`, `placeWaitingPanes`/`placeWaitingPanesRemote`,
 * `paneOpenFloor`/`hasAskedPane`/`rememberAskedPane`/`forgetAskedPane`/
 * `seedAskedPanes`) — minify names stay in comments only (never export
 * `Si`/`panesStore`/`oNo`/`i4n`/`askedLatch`). `abovePrompt:focus`: pending
 * `focusedId` → `$Fr`/`focusPane` (incl. clear on last); else band step; else
 * `open[0]` via `$Fr`; else band from null. Never a4n(true) on the key —
 * pending `focusRequest` is only auto-settled by the a4n effect.
 * Columns settle calls `settlePanesTerminalColumns` → `placeWaitingPanes`.
 *
 * `pluginSites` = Ide HAVE via `registerPluginScrollSite` keyed
 * `component:requestId` (gold `Fj`). Hde/`QLt` person-origin `ui.scroll` HAVE via
 * `dispatchPersonUiScroll` → `runFunctionHookChain('ui.scroll')` + vq commit
 * (no minify Ide/Hde/QLt/iZ export). asked soft persist + ui.open→unplaced
 * column gate HAVE on panes store. Leave `dialogStore.open` alone. Keep
 * effortSlider:* untouched.
 */
/** densable `pL` — CollapseHandle inset from the right edge. */
export const MARK_EDGE_COLUMNS = 1

/** densable `DZ` — reserved columns for the collapse handle. */
export const COLLAPSE_HANDLE_COLUMNS = 5

/**
 * densable `h_e` lite for o$/SEe — identity id from a task.
 * Gold: local_agent → agentId; in_process_teammate → resumableAgentId ?? agentId.
 */
export function teammateViewId(task: {
  type?: string
  agentId?: string
  identity?: { agentId?: string; resumableAgentId?: string }
}): string | undefined {
  if (task.type === 'local_agent' && typeof task.agentId === 'string') {
    return task.agentId
  }
  if (task.type === 'in_process_teammate') {
    const resumable = task.identity?.resumableAgentId
    if (typeof resumable === 'string') return resumable
    if (typeof task.identity?.agentId === 'string') return task.identity.agentId
  }
  return undefined
}

/** densable SEe — viewingAgentTaskId → h_e(task)?.id. */
export function viewingAgentIdFromState(state: {
  viewingAgentTaskId?: string
  tasks: Record<
    string,
    {
      type?: string
      agentId?: string
      identity?: { agentId?: string; resumableAgentId?: string }
    }
  >
}): string | undefined {
  const taskId = state.viewingAgentTaskId
  if (taskId === undefined) return undefined
  const task = state.tasks[taskId]
  return task === undefined ? undefined : teammateViewId(task)
}

/**
 * densable `FZ` — both lists non-empty and no shared plugin (drawer identity flip).
 */
export function isOtherDrawer(
  previous: Array<{ plugin: string }>,
  next: Array<{ plugin: string }>,
): boolean {
  return (
    previous.length > 0 &&
    next.length > 0 &&
    !next.some(row => previous.some(was => was.plugin === row.plugin))
  )
}

export function runInCapturedSession(
  captured: Session | undefined,
  fn: () => void,
): void {
  if (captured !== undefined && getActiveSessionFromAls() !== captured) {
    runWithSession(captured, fn)
  } else {
    fn()
  }
}

export function notifySessionListeners(
  listeners: Map<() => void, Session | undefined>,
): void {
  for (const [listener, captured] of listeners) {
    runInCapturedSession(captured, listener)
  }
}

/** densable `NZ` — height settle debounce for band layout. */
export const HEIGHT_SETTLE_MS = 150

/** densable `vG` — same requestId as AbovePrompt site (`c9`). */
export const BAND_REQUEST_ID = ABOVE_PROMPT_REQUEST_ID

/**
 * densable `IZ` bandWindow — reserve one row for OverflowCue when the tree
 * exceeds the live budget; bodyRows uses the settled budget.
 */
export function bandWindow(input: {
  budget: number
  settledBudget: number
  treeRows: number
}): {
  windowRows: number
  hasCue: boolean
  maxOffset: number
  bodyRows: number
} {
  const budget = Math.max(0, input.budget)
  const hasCue = input.treeRows > budget
  const windowRows = hasCue ? Math.max(0, budget - 1) : budget
  return {
    windowRows,
    hasCue,
    maxOffset: Math.max(0, input.treeRows - windowRows),
    bodyRows: Math.max(0, input.settledBudget - 1),
  }
}

/** densable `e$` — floor non-negative scroll offset (`floorOffset` alias). */
export function floorOffset(value: number): number {
  return Math.max(0, Math.floor(value))
}

/** @deprecated Prefer `floorOffset` — same densable `e$`. */
export const floorBandOffset = floorOffset

/** densable `dEe` — wheel pointer relative to the scroll clip box's cachedLayout. */
export function relativeWheelPointer(
  clipRef: RefObject<DOMElement | null>,
  event: WheelEvent,
): { column: number; row: number } | undefined {
  const layout = (
    clipRef.current as { cachedLayout?: { x: number; y: number } } | null
  )?.cachedLayout
  return event.col !== undefined &&
    event.row !== undefined &&
    layout !== undefined
    ? { column: event.col - layout.x, row: event.row - layout.y }
    : undefined
}

/**
 * densable `gL` nextBandFocus — first land / wrap / stay on `"band"`.
 * Full AbovePrompt focus ring still deferred; exported for gold-shaped hosts.
 */
export function nextBandFocus(input: {
  focus: number | 'band' | null
  count: number
}): number | 'band' | null {
  const hasFocusables = input.count > 0
  if (typeof input.focus === 'number') {
    return input.focus + 1 < input.count ? input.focus + 1 : null
  }
  if (hasFocusables) return 0
  return input.focus === null ? 'band' : null
}

/** densable `i$` overflowCueText — `↑ N more · ↓ M more`. */
export function overflowCueText(above: number, below: number): string {
  return [
    above > 0 ? `↑ ${above} more` : '',
    below > 0 ? `↓ ${below} more` : '',
  ]
    .filter(part => part !== '')
    .join(' · ')
}

/** densable `aL` — persist only a finite integer ≥ 1. */
export function paneRoomValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : null
}

/** densable `yy.DOCK_MIN_COLUMNS` / `P2`. */
const DOCK_MIN_COLUMNS = 24

/** Official 2.1.305 (#1059): `Zue` = 60, `Xue` = 0.45. */
const DOCK_TRANSCRIPT_MIN_COLUMNS = 60

const DOCK_MAX_SHARE = 0.45

/** densable `nq` — dock is 0 when transcript columns are below this. */
const DOCK_FLOOR_COLUMNS = 110

/**
 * Official 2.1.305 `VO` (#1059): default `pW`: min(floor(h*0.45), 90, h-70),
 * clamped to [DOCK_MIN_COLUMNS, min(floor(h*0.45), h-60)], 0 if h<110.
 */
export function pluginPaneDockColumns(
  columns: number,
  chosen?: number | null,
  requested?: number | null,
): number {
  if (columns < DOCK_FLOOR_COLUMNS) return 0
  const maxWidth = Math.min(
    Math.floor(columns * DOCK_MAX_SHARE),
    columns - DOCK_TRANSCRIPT_MIN_COLUMNS,
  )
  const clamp = (value: number) =>
    Math.min(maxWidth, Math.max(DOCK_MIN_COLUMNS, value))
  if (typeof chosen === 'number') return clamp(chosen)
  if (typeof requested === 'number') return clamp(requested)
  return Math.min(Math.floor(columns * DOCK_MAX_SHARE), 90, columns - 70)
}

/** densable `_7` / `R7` / `A7` / `I7` — inline pane rows (`oA` / `Q7`). */
/** densable `x7` — keyboard pane grow/shrink step. */
export const INLINE_KEY_ROWS = 1

/** densable `g7` — keyboard dock grow/shrink step. */
export const DOCK_KEY_COLUMNS = 4

const INLINE_MIN_ROWS = 5

const INLINE_PROMPT_FLOOR_ROWS = 8

const INLINE_TRANSCRIPT_PEEK_ROWS = 3

const INLINE_ROWS_SHARE = 3

/**
 * densable `oA`: floor(rows/3); fullscreen uses that; else max(share, rows-peek-floor).
 * Clamp to [min(5, cap), cap]. Chosen wins, then requested, else share.
 */
export function pluginPaneInlineRows(
  rows: number,
  layout: 'fullscreen' | 'inline' = 'inline',
  chosen?: number | null,
  requested?: number,
): number {
  const share = Math.floor(rows / INLINE_ROWS_SHARE)
  const cap =
    layout === 'fullscreen'
      ? share
      : Math.max(
          share,
          rows - INLINE_TRANSCRIPT_PEEK_ROWS - INLINE_PROMPT_FLOOR_ROWS,
        )
  const floor = Math.min(INLINE_MIN_ROWS, cap)
  const clamp = (value: number) => Math.min(cap, Math.max(floor, value))
  if (typeof chosen === 'number') return clamp(chosen)
  if (typeof requested === 'number') return clamp(requested)
  return share
}

export function snapshot(): number {
  return getRasterFrameVersion()
}

export function renderVersion(): number {
  return getRenderVersion('ui.render')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isEngineDrawing(value: unknown): boolean {
  return isRecord(value) && value.type === 'engine'
}

/** densable `L1t` debug + `Jmn` toast. Kind is gold `answer`. */
export function reportDrawWhileDrawn(
  component: string,
  names: readonly string[],
  error: Error,
  addNotification: (notification: {
    key: string
    text: string
    priority: 'immediate'
    kind: 'warning'
    color: 'error'
  }) => void,
): void {
  const teller = tellerOf(names)
  const debug = L1t(component, teller, 'answer')
  if (debug !== null) logForDebugging(debug)
  const toast = Jmn({ component, teller, error })
  if (toast === null) return
  addNotification({
    key: toast.key,
    text: toast.text,
    priority: 'immediate',
    kind: 'warning',
    color: 'error',
  })
}

export function stampedPlugin(
  node: Record<string, unknown>,
  fallback: string,
): string {
  if (typeof node.__plugin === 'string' && node.__plugin !== '')
    return node.__plugin
  if (typeof node.plugin === 'string' && node.plugin !== '') return node.plugin
  const raster = isRecord(node.raster) ? node.raster : undefined
  if (typeof raster?.plugin === 'string' && raster.plugin !== '')
    return raster.plugin
  const image = isRecord(node.image) ? node.image : undefined
  if (typeof image?.plugin === 'string' && image.plugin !== '')
    return image.plugin
  const client = isRecord(node.client) ? node.client : undefined
  if (typeof client?.plugin === 'string' && client.plugin !== '')
    return client.plugin
  return fallback
}

export function flattenDrawingChildren(
  raw: unknown,
  out: unknown[] = [],
): unknown[] {
  if (raw === undefined || raw === null || typeof raw === 'boolean') return out
  if (Array.isArray(raw)) {
    for (const item of raw) flattenDrawingChildren(item, out)
    return out
  }
  out.push(typeof raw === 'number' ? String(raw) : raw)
  return out
}

export function extractDrawnPlugin(
  node: unknown,
  component?: string,
  requestId?: string,
): string | undefined {
  const walk = (item: unknown): string | undefined => {
    if (Array.isArray(item)) {
      for (const child of item) {
        const hit = walk(child)
        if (hit !== undefined) return hit
      }
      return undefined
    }
    if (!isRecord(item)) return undefined
    const direct = stampedPlugin(item, '')
    if (direct !== '') return direct
    const press = isRecord(item.press) ? item.press : undefined
    if (typeof press?.plugin === 'string' && press.plugin !== '')
      return press.plugin
    const group = isRecord(item.group) ? item.group : undefined
    if (typeof group?.plugin === 'string' && group.plugin !== '')
      return group.plugin
    const props = isRecord(item.props) ? item.props : {}
    for (const child of childList(item, props)) {
      const hit = walk(child)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  const found = walk(node)
  if (found !== undefined) return found
  if (component !== undefined) {
    const stored = getPluginDrawingTrees().find(
      drawing =>
        drawing.component === component &&
        (requestId === undefined || drawing.requestId === requestId),
    )?.plugin
    if (typeof stored === 'string' && stored !== '') return stored
  }
  return undefined
}

export function pressOf(
  node: Record<string, unknown>,
  fallbackPlugin = '',
): { plugin: string; handle: unknown } | undefined {
  const press = isRecord(node.press) ? node.press : undefined
  if (press === undefined || typeof press.plugin !== 'string') return undefined
  const plugin =
    press.plugin !== '' ? press.plugin : stampedPlugin(node, fallbackPlugin)
  return { plugin, handle: press.handle }
}

/** densable `xze` focusable drawn node (Button / Input / Select). */
export type DrawingFocusable = {
  tag: 'Button' | 'Input' | 'Select'
  plugin: string
  handle: unknown
  element: unknown
  isAutoFocus: boolean
  value?: unknown
  options?: unknown
}

/**
 * densable `xze(e)` focusablesOfDrawing — walk drawing tree; Button/Input/Select
 * → `{tag, plugin, handle, element: props.key, isAutoFocus, value?, options?}`
 * via `e.press`; else flatMap children (including nested arrays).
 */
export function focusablesOfDrawing(drawn: unknown): DrawingFocusable[] {
  if (
    drawn === undefined ||
    drawn === null ||
    typeof drawn === 'string' ||
    typeof drawn === 'boolean'
  )
    return []
  if (Array.isArray(drawn))
    return flattenDrawingChildren(drawn).flatMap(focusablesOfDrawing)
  if (!isRecord(drawn)) return []
  if (drawn.type === 'engine') return []
  const type = drawn.type
  if (type === 'Button' || type === 'Input' || type === 'Select') {
    const press = pressOf(drawn)
    if (press === undefined) return []
    const props = isRecord(drawn.props) ? drawn.props : drawn
    const base: DrawingFocusable = {
      tag: type,
      plugin: press.plugin,
      handle: press.handle,
      element: props.key,
      isAutoFocus: props.autoFocus === true,
    }
    if (type !== 'Button') base.value = props.value
    if (type === 'Select') base.options = props.options
    return [base]
  }
  const props = isRecord(drawn.props) ? drawn.props : {}
  return childList(drawn, props).flatMap(focusablesOfDrawing)
}

function wheelProfileDrifted(
  prev: WheelProfile | null,
  next: WheelProfile,
): boolean {
  if (prev === null) return false
  return (
    prev.useDecayCurve !== next.useDecayCurve ||
    prev.wheelFlood !== next.wheelFlood ||
    prev.jediTerm !== next.jediTerm ||
    prev.wtSession !== next.wtSession ||
    prev.xtermJs !== next.xtermJs
  )
}

/**
 * densable `U4`/`uct` — lazy wheel-accel state, re-pin `base` every tick
 * (gold `h.current.base = P6().base`). Reset when J3 profile drifts
 * (same fields as ScrollKeybindingHandler.ensureWheelAccel).
 */
export function ensurePaneWheelAccel(
  held: { current: WheelAccelState | null },
  profileHeld: { current: WheelProfile | null },
): WheelAccelState {
  const profile = resolveWheelProfile()
  if (wheelProfileDrifted(profileHeld.current, profile)) held.current = null
  profileHeld.current = profile
  held.current ??= initWheelAccel(
    profile.useDecayCurve,
    profile.base,
    profile.wheelFlood,
    isWheelScrollAccelerationEnabled(),
  )
  held.current.base = profile.base
  return held.current
}

/**
 * densable `pEe`/`gEe` — WheelEvent → yEe person scrollBy.
 * `gEe` rows = `computeWheelStep` (`dct`/`FSp`); pointer is densable `dEe`
 * local col/row from the WheelEvent.
 */
export function paneWheelScroll(
  event: WheelEvent,
  input: {
    plugin: string
    requestId: string
    offset: number
    bodyRows: number
    contentRows: number
    maxOffset: number
    accel: WheelAccelState
    now?: number
  },
): void {
  const sign: 1 | -1 = event.deltaY < 0 ? -1 : 1
  // gold dct/FSp: bounce-defer returns 0 — do not lift to 1 row.
  const rows = computeWheelStep(
    input.accel,
    sign,
    input.now ?? performance.now(),
  )
  const by = sign * rows
  const next = Math.max(0, Math.min(input.maxOffset, input.offset + by))
  if (rows === 0 || next === input.offset) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  void dispatchPersonUiScroll({
    plugin: input.plugin,
    component: 'Pane',
    requestId: input.requestId,
    offset: next,
    by,
    bodyRows: input.bodyRows,
    contentRows: input.contentRows,
    pointer: { column: event.localCol, row: event.localRow },
  })
  event.preventDefault()
  event.stopPropagation()
}

/** densable y$ `bt` — Select at a ring index. */
export type PluginSelectFocusable = {
  plugin: string
  handle: unknown
  element: string
  options: Array<{ value: string; label?: string }>
  value?: string
}

/** densable y$ `Pc` / `Kt` — `{key,isOpen,highlight}`. */
export type PluginSelectSeatState = {
  key: string | null
  isOpen: boolean
  highlight: number
}

function selectOptionsOf(
  row: DrawingFocusable,
): Array<{ value: string; label?: string }> {
  const raw = row.options
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    if (!isRecord(item) || typeof item.value !== 'string') return []
    return [
      {
        value: item.value,
        ...(typeof item.label === 'string' && { label: item.label }),
      },
    ]
  })
}

export function selectFocusableAt(
  focusables: readonly DrawingFocusable[] | undefined,
  index: number | 'band' | null | undefined,
): PluginSelectFocusable | null {
  const row = focusableAt(
    focusables ?? [],
    typeof index === 'number' ? index : null,
  )
  if (
    row === null ||
    row.tag !== 'Select' ||
    typeof row.element !== 'string' ||
    row.element === ''
  ) {
    return null
  }
  return {
    plugin: row.plugin,
    handle: row.handle,
    element: row.element,
    options: selectOptionsOf(row),
    ...(typeof row.value === 'string' && { value: row.value }),
  }
}

export function selectSeatKeyOf(
  row: PluginSelectFocusable | null,
): string | null {
  return row === null ? null : pluginInputFieldKey(row.plugin, row.element)
}

/**
 * densable y$ `Kt(io)` — identity reset: Select → `{key, isOpen:true, highlight}`;
 * none → `{key:null, isOpen:false, highlight:0}`.
 */
export function resetPluginSelectSeat(
  row: PluginSelectFocusable | null,
  picked: Map<string, string>,
): PluginSelectSeatState {
  if (row === null) return { key: null, isOpen: false, highlight: 0 }
  const key = pluginInputFieldKey(row.plugin, row.element)
  const shown = picked.get(key) ?? row.value
  const at = row.options.findIndex(option => option.value === shown)
  return { key, isOpen: true, highlight: Math.max(0, at) }
}

/** densable `Ode(list, index)` — focusable at ring index. `'band'` is not a row. */
export function focusableAt(
  focusables: readonly DrawingFocusable[],
  index: number | 'band' | null | undefined,
): DrawingFocusable | null {
  if (typeof index !== 'number') return null
  return focusables[index] ?? null
}

export type PluginBandKeyContext =
  | 'AbovePrompt'
  | 'AbovePromptInput'
  | 'AbovePromptSelect'
  | 'Pane'

export type PluginBandKeysBag = {
  isAhead: () => boolean
  contextNow: () => PluginBandKeyContext | null
  focusedNow: () => DrawingFocusable | null
  contextRendered: () => PluginBandKeyContext | null
  focusedRendered: () => DrawingFocusable | null
  handlers: Partial<Record<PluginBandKeyContext, Record<string, () => void>>>
  /** densable `m$` inputs bag (textNow + fields.edit). */
  inputs?: {
    textNow: (focusable: {
      plugin: string
      element: string
      value?: string
    }) => string
    fields: {
      edit: (
        focusable: { plugin: string; handle: unknown; element: string },
        value: string,
      ) => void
    }
  }
  /** densable `y$.intercept` / selectKeysIntercept. */
  selectKeys: (input: string, key: Key) => boolean
}

export type PluginBandResolve = (
  input: string,
  key: Key,
  contexts: Array<PluginBandKeyContext | 'Global'>,
) => { type: string; action?: string }

/** densable `n_e` / `qm` → ui.press via T3.heldPress then invokePress. DualInk omits baseButton. */
export function firePress(
  plugin: string,
  handle: unknown,
  event?: unknown,
  element?: string,
): void {
  const clientHeld = typeof handle === 'number' && handle < 0
  if (!clientHeld && heldPress(plugin, handle, element) === undefined) {
    logForDebugging(
      `ui.press: no Button of ${plugin} is held under handle ${String(handle)}; nothing ran`,
    )
    return
  }
  recordPress(plugin, handle, event)
  void invokePress(plugin, handle, event)
}

export function firePressAnswer(
  plugin: string,
  handle: unknown,
  event: unknown,
  meta?: {
    tag: 'Input' | 'Select'
    eventName: 'ui.input' | 'ui.select'
    element?: string
    component?: string
    requestId?: string
    surface?: string
    admits?: (held: NonNullable<ReturnType<typeof heldPress>>) => boolean
  },
): Promise<unknown> {
  const tag = meta?.tag ?? 'Input'
  const eventName = meta?.eventName ?? 'ui.input'
  const surface = meta?.surface ?? 'terminal'
  const clientHeld = typeof handle === 'number' && handle < 0
  if (clientHeld) {
    recordPress(plugin, handle, event)
    return invokePress(plugin, handle, event)
  }
  const keyLookup =
    meta?.element !== undefined && meta?.component !== undefined
      ? {
          tag,
          plugin,
          element: meta.element,
          surface,
          component: meta.component,
          ...(meta.requestId !== undefined && { requestId: meta.requestId }),
        }
      : undefined
  const held =
    heldPress(plugin, handle, meta?.element) ??
    (keyLookup !== undefined ? heldByKeyOf(keyLookup) : undefined)
  if (held?.tag !== tag) {
    logForDebugging(
      `${eventName}: no ${tag} of ${plugin} is held under handle ${String(handle)}; nothing ran`,
    )
    return Promise.resolve(undefined)
  }
  if (meta?.admits !== undefined && !meta.admits(held)) {
    logForDebugging(
      `${eventName}: the ${tag} ${plugin}/${held.element} does not take that value; nothing ran`,
    )
    return Promise.resolve(undefined)
  }
  recordPress(plugin, held.handle, event)
  return invokePress(plugin, held.handle, event)
}

/** densable `BDe` — Input field Map key `plugin\0element`. */
export function pluginInputFieldKey(plugin: string, element: string): string {
  return `${plugin}\0${element}`
}

/**
 * densable `vhr` — `ui.input` change/submit. Local via firePressAnswer/invokePress
 * (no Hde invent). Gold also passes element/component; payload kind+value is load-bearing.
 */
export function pluginInputPressEvent(event: {
  plugin: string
  handle: unknown
  element?: string
  component?: string
  requestId?: string
  kind: string
  value: string
}): Promise<unknown> {
  return firePressAnswer(
    event.plugin,
    event.handle,
    {
      kind: event.kind,
      value: event.value,
    },
    {
      tag: 'Input',
      eventName: 'ui.input',
      element: event.element,
      component: event.component,
      requestId: event.requestId,
    },
  )
}

export type PluginInputFieldsSlice = {
  textOf: (plugin: string, element: string) => string | undefined
  edit: (
    ref: { plugin: string; handle: unknown; element: string },
    value: string,
  ) => void
}

/** densable `m$` return — `{fields, textNow, submit}`. */
export type PluginInputMapApi = {
  fields: PluginInputFieldsSlice
  textNow: (ref: { plugin: string; element: string; value?: string }) => string
  submit: (ref: {
    plugin: string
    handle: unknown
    element: string
    value?: string
  }) => void
}

/**
 * densable `m$(focusables, component, requestId)`.
 * Gold body: live Map + submitting Set + BDe + vhr change/submit + textOf/edit/textNow/submit.
 * `usePluginInputSeat` owns kL/yL; this is the map half.
 */
export function createPluginInputMap(
  _focusables: readonly DrawingFocusable[] | undefined,
  component: string,
  requestId: string,
  host: {
    texts: Map<string, string>
    setTexts: (
      updater: (current: Map<string, string>) => Map<string, string>,
    ) => void
    live: { current: Map<string, string> }
    submitting: { current: Set<string> }
  },
): PluginInputMapApi {
  const { texts, setTexts, live, submitting } = host
  const fields: PluginInputFieldsSlice = {
    textOf: (plugin, element) =>
      texts.get(pluginInputFieldKey(plugin, element)),
    edit({ plugin, handle, element }, value) {
      const key = pluginInputFieldKey(plugin, element)
      live.current.set(key, value)
      setTexts(current => new Map(current).set(key, value))
      void pluginInputPressEvent({
        plugin,
        handle,
        element,
        component,
        requestId,
        kind: 'change',
        value,
      })
    },
  }
  return {
    fields,
    textNow({ plugin, element, value }) {
      const key = pluginInputFieldKey(plugin, element)
      return live.current.get(key) ?? texts.get(key) ?? value ?? ''
    },
    submit({ plugin, handle, element, value }) {
      const key = pluginInputFieldKey(plugin, element)
      const sent = live.current.get(key) ?? texts.get(key) ?? value ?? ''
      if (submitting.current.has(key)) return
      submitting.current.add(key)
      void pluginInputPressEvent({
        plugin,
        handle,
        element,
        component,
        requestId,
        kind: 'submit',
        value: sent,
      }).then(
        reply => {
          submitting.current.delete(key)
          if (reply !== undefined && (live.current.get(key) ?? sent) === sent) {
            live.current.set(key, '')
            setTexts(current => new Map(current).set(key, ''))
          }
        },
        () => {
          submitting.current.delete(key)
        },
      )
    },
  }
}

export function stringProp(
  props: Record<string, unknown>,
  node: Record<string, unknown>,
  key: string,
): string | undefined {
  const fromProps = props[key]
  if (typeof fromProps === 'string') return fromProps
  const fromNode = node[key]
  return typeof fromNode === 'string' ? fromNode : undefined
}

export function numberProp(
  props: Record<string, unknown>,
  node: Record<string, unknown>,
  key: string,
): number | undefined {
  const fromProps = props[key]
  if (typeof fromProps === 'number') return fromProps
  const fromNode = node[key]
  return typeof fromNode === 'number' ? fromNode : undefined
}

export function boolProp(
  props: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = props[key]
  return typeof value === 'boolean' ? value : undefined
}

type BoxLayout = {
  -readonly [K in keyof Pick<
    ComponentProps<typeof Box>,
    | 'display'
    | 'position'
    | 'top'
    | 'left'
    | 'right'
    | 'bottom'
    | 'flexDirection'
    | 'flexGrow'
    | 'flexShrink'
    | 'flexWrap'
    | 'alignItems'
    | 'alignSelf'
    | 'justifyContent'
    | 'width'
    | 'height'
    | 'minWidth'
    | 'minHeight'
    | 'maxWidth'
    | 'maxHeight'
    | 'overflow'
    | 'overflowX'
    | 'gap'
    | 'columnGap'
    | 'rowGap'
    | 'padding'
    | 'paddingX'
    | 'paddingY'
    | 'paddingTop'
    | 'paddingBottom'
    | 'paddingLeft'
    | 'paddingRight'
    | 'margin'
    | 'marginX'
    | 'marginY'
    | 'marginTop'
    | 'marginBottom'
    | 'marginLeft'
    | 'marginRight'
    | 'borderStyle'
    | 'borderColor'
    | 'borderDimColor'
    | 'backgroundColor'
  >]: ComponentProps<typeof Box>[K]
}

/** densable `oqn` — standard named terminal colors mapped to hex (`rdn`/`He`). */
const NAMED_TO_HEX: Readonly<Record<string, string>> = {
  black: '#000000',
  red: '#e5484d',
  green: '#46a758',
  yellow: '#f5d90a',
  blue: '#3e63dd',
  magenta: '#d6409f',
  cyan: '#05a2c2',
  white: '#ffffff',
  gray: '#8b8d98',
  grey: '#8b8d98',
  blackBright: '#6e6e6e',
  redBright: '#ff6369',
  greenBright: '#5bd07f',
  yellowBright: '#ffe629',
  blueBright: '#5b8def',
  magentaBright: '#ee6ac2',
  cyanBright: '#3ec2e0',
  whiteBright: '#ffffff',
}

function resolvePluginColor(color: string): string {
  return Object.hasOwn(NAMED_TO_HEX, color) ? NAMED_TO_HEX[color]! : color
}

export function modTextMaxLinesFrom(
  props: Record<string, unknown> | undefined,
): number | undefined {
  if (props === undefined) return undefined
  const normalized = normalizeModTextWrapAndMaxLines(props)
  const maxLines = normalized.maxLines
  if (
    typeof maxLines !== 'number' ||
    !Number.isInteger(maxLines) ||
    maxLines < 1 ||
    maxLines > 10_000
  ) {
    return undefined
  }
  return maxLines
}

export function clampModTextLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  const kept = lines.slice(0, maxLines)
  const lastIdx = kept.length - 1
  kept[lastIdx] = `${kept[lastIdx] ?? ''}…`
  return kept.join('\n')
}

const TRUNCATE_ROWS_WRAPS = new Set(['end', 'truncate', 'truncate-end', 'clip'])

export function textStyleFrom(
  props: Record<string, unknown> | undefined,
): Partial<ComponentProps<typeof Text>> {
  if (props === undefined) return {}
  const wrap = props.wrap
  return {
    ...(boolProp(props, 'bold') !== undefined && {
      bold: boolProp(props, 'bold'),
    }),
    ...(boolProp(props, 'dimColor') !== undefined && {
      dimColor: boolProp(props, 'dimColor'),
    }),
    ...(boolProp(props, 'italic') !== undefined && {
      italic: boolProp(props, 'italic'),
    }),
    ...(boolProp(props, 'underline') !== undefined && {
      underline: boolProp(props, 'underline'),
    }),
    ...(boolProp(props, 'strikethrough') !== undefined && {
      strikethrough: boolProp(props, 'strikethrough'),
    }),
    ...(boolProp(props, 'inverse') !== undefined && {
      inverse: boolProp(props, 'inverse'),
    }),
    ...(typeof props.color === 'string' && {
      color: resolvePluginColor(props.color) as ComponentProps<
        typeof Text
      >['color'],
    }),
    ...(typeof props.backgroundColor === 'string' && {
      backgroundColor: resolvePluginColor(
        props.backgroundColor,
      ) as ComponentProps<typeof Text>['backgroundColor'],
    }),
    // Official 2.1.328 (`bi`): map end/truncate/truncate-end/clip → truncate-rows.
    ...(typeof wrap === 'string' && TRUNCATE_ROWS_WRAPS.has(wrap)
      ? { wrap: 'truncate-rows' as ComponentProps<typeof Text>['wrap'] }
      : (wrap === 'wrap' ||
          wrap === 'middle' ||
          wrap === 'truncate-start' ||
          wrap === 'truncate-middle' ||
          wrap === 'truncate-rows') && { wrap }),
  }
}

export function layoutFrom(
  props: Record<string, unknown> | undefined,
): BoxLayout {
  if (props === undefined) return {}
  const out: BoxLayout = {}
  if (props.display === 'flex' || props.display === 'none') {
    out.display = props.display
  }
  if (props.position === 'absolute' || props.position === 'relative') {
    out.position = props.position
  }
  if (typeof props.top === 'number') out.top = props.top
  if (typeof props.left === 'number') out.left = props.left
  if (typeof props.right === 'number') out.right = props.right
  if (typeof props.bottom === 'number') out.bottom = props.bottom
  const flexDirection = props.flexDirection
  if (
    flexDirection === 'row' ||
    flexDirection === 'column' ||
    flexDirection === 'row-reverse' ||
    flexDirection === 'column-reverse'
  ) {
    out.flexDirection = flexDirection
  }
  if (typeof props.flexGrow === 'number') out.flexGrow = props.flexGrow
  if (typeof props.flexShrink === 'number') out.flexShrink = props.flexShrink
  if (
    props.flexWrap === 'nowrap' ||
    props.flexWrap === 'wrap' ||
    props.flexWrap === 'wrap-reverse'
  ) {
    out.flexWrap = props.flexWrap
  }
  if (
    props.alignItems === 'flex-start' ||
    props.alignItems === 'center' ||
    props.alignItems === 'flex-end' ||
    props.alignItems === 'stretch'
  ) {
    out.alignItems = props.alignItems
  }
  if (
    props.alignSelf === 'flex-start' ||
    props.alignSelf === 'center' ||
    props.alignSelf === 'flex-end' ||
    props.alignSelf === 'auto'
  ) {
    out.alignSelf = props.alignSelf
  }
  if (
    props.justifyContent === 'flex-start' ||
    props.justifyContent === 'center' ||
    props.justifyContent === 'flex-end' ||
    props.justifyContent === 'space-between' ||
    props.justifyContent === 'space-around'
  ) {
    out.justifyContent = props.justifyContent
  }
  if (typeof props.width === 'number') out.width = props.width
  else if (typeof props.width === 'string' && props.width.endsWith('%')) {
    out.width = props.width as `${number}%`
  }
  if (typeof props.height === 'number') out.height = props.height
  else if (typeof props.height === 'string' && props.height.endsWith('%')) {
    out.height = props.height as `${number}%`
  }
  if (typeof props.minWidth === 'number') out.minWidth = props.minWidth
  if (typeof props.minHeight === 'number') out.minHeight = props.minHeight
  if (typeof props.maxWidth === 'number') out.maxWidth = props.maxWidth
  if (typeof props.maxHeight === 'number') out.maxHeight = props.maxHeight
  if (props.overflow === 'visible' || props.overflow === 'hidden')
    out.overflow = props.overflow
  if (
    props.overflowX === 'visible' ||
    props.overflowX === 'hidden' ||
    props.overflowX === 'scroll'
  ) {
    out.overflowX = props.overflowX
    if (props.overflowX === 'scroll') {
      out.flexWrap ??= 'nowrap'
      out.minWidth ??= 0
    }
  }
  if (typeof props.gap === 'number') out.gap = props.gap
  if (typeof props.columnGap === 'number') out.columnGap = props.columnGap
  if (typeof props.rowGap === 'number') out.rowGap = props.rowGap
  if (typeof props.padding === 'number') out.padding = props.padding
  if (typeof props.paddingX === 'number') out.paddingX = props.paddingX
  if (typeof props.paddingY === 'number') out.paddingY = props.paddingY
  if (typeof props.paddingTop === 'number') out.paddingTop = props.paddingTop
  if (typeof props.paddingBottom === 'number')
    out.paddingBottom = props.paddingBottom
  if (typeof props.paddingLeft === 'number') out.paddingLeft = props.paddingLeft
  if (typeof props.paddingRight === 'number')
    out.paddingRight = props.paddingRight
  if (typeof props.margin === 'number') out.margin = props.margin
  if (typeof props.marginX === 'number') out.marginX = props.marginX
  if (typeof props.marginY === 'number') out.marginY = props.marginY
  if (typeof props.marginTop === 'number') out.marginTop = props.marginTop
  if (typeof props.marginBottom === 'number')
    out.marginBottom = props.marginBottom
  if (typeof props.marginLeft === 'number') out.marginLeft = props.marginLeft
  if (typeof props.marginRight === 'number') out.marginRight = props.marginRight
  if (typeof props.borderStyle === 'string') {
    out.borderStyle = props.borderStyle as BoxLayout['borderStyle']
  }
  if (typeof props.borderColor === 'string') {
    out.borderColor = resolvePluginColor(
      props.borderColor,
    ) as BoxLayout['borderColor']
  }
  if (typeof props.borderDimColor === 'boolean') {
    out.borderDimColor = props.borderDimColor
  }
  if (typeof props.backgroundColor === 'string') {
    out.backgroundColor = resolvePluginColor(
      props.backgroundColor,
    ) as BoxLayout['backgroundColor']
  }
  return out
}

/**
 * densable `FMn(o,i)` — open Select window of `at=8`.
 * `rows = size + (hidden>0 ? 1 : 0)` for the overflow cue line.
 */
export function selectWindow(
  count: number,
  highlight: number,
): { first: number; size: number; hidden: number; rows: number } {
  const first = Math.max(0, highlight - SELECT_WINDOW + 1)
  const size = Math.max(0, Math.min(SELECT_WINDOW, count - first))
  const hidden = count - first - size
  return { first, size, hidden, rows: size + (hidden > 0 ? 1 : 0) }
}

/**
 * densable `s$=(h,v)=>h===null?0:FMn(v,h.highlight).rows`.
 * Open Select extra rows into band maxHeight (`nr=s$(ts,Gn)`).
 */
export function openListRows(
  open: { highlight: number } | null,
  optionCount: number,
): number {
  return open === null ? 0 : selectWindow(optionCount, open.highlight).rows
}

export type SelectOpen = {
  plugin: string
  handle: unknown
  highlight: number
  element: string
  options: Array<{ value: string; label?: string }>
}

/**
 * densable `mR`/`pyr` for `$q`/`Wq`: `ez.escape` + lone surrogate + U+10EEEE.
 * Not tab/LF/CR (`a4` has those; `pyr` does not). Char-code loop for biome.
 */
export function pluginInputHoldsControl(input: string): boolean {
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp <= 0x08) return true
    if (cp === 0x0b || cp === 0x0c) return true
    if (cp >= 0x0e && cp <= 0x1f) return true
    if (cp >= 0x7f && cp <= 0x9f) return true
    if (cp >= 0xd800 && cp <= 0xdfff) return true
    if (cp === 0x10eeee) return true
  }
  return false
}

/** densable `qN` — Select typeahead: one non-C/Z grapheme, no ctrl/meta/super/esc/tab/return. */
export function pluginSelectTypeahead(input: string, key: Key): boolean {
  return (
    !key.ctrl &&
    !key.meta &&
    !key.super &&
    !key.escape &&
    !key.tab &&
    !key.return &&
    [...input].length === 1 &&
    /^[^\p{C}\p{Z}]+$/u.test(input)
  )
}

/**
 * densable `ro` — typeahead only opens (`isOpen:!0`) on a hit. A miss is a no-op
 * (closed stays closed; open highlight is unchanged).
 */
export function pluginSelectTypeaheadNext(
  current: SelectOpen | null,
  focused: {
    plugin: string
    handle: unknown
    element: string
    options: Array<{ value: string; label?: string }>
  } | null,
  letter: string,
): SelectOpen | null {
  const base =
    current ??
    (focused === null
      ? null
      : {
          plugin: focused.plugin,
          handle: focused.handle,
          element: focused.element,
          options: focused.options,
          highlight: 0,
        })
  if (base === null) return current
  const needle = letter.toLowerCase()
  const from = current === null ? -1 : base.highlight
  const count = base.options.length
  const hit = base.options
    .map((_, i) => (from + 1 + i) % Math.max(1, count))
    .find(i => {
      const option = base.options[i]
      return (
        option !== undefined &&
        (option.label ?? option.value).toLowerCase().startsWith(needle)
      )
    })
  if (hit === undefined) return current
  return { ...base, highlight: hit }
}

/** densable `Wq` — printable insert for focused plugin Input. */
export function pluginInputIsTyped(input: string, key: Key): boolean {
  return (
    input !== '' &&
    !key.ctrl &&
    !key.meta &&
    !key.super &&
    !key.tab &&
    !key.return &&
    !key.escape &&
    !pluginInputHoldsControl(input)
  )
}

/** densable `jq` — nav keys the host swallows on a focused Input. */
export function pluginInputIsNav(input: string, key: Key): boolean {
  return (
    key.leftArrow ||
    key.rightArrow ||
    key.home ||
    key.end ||
    key.delete ||
    key.pageUp ||
    key.pageDown ||
    (input.length === 1 && key.ctrl && 'abdefhknpuwy'.includes(input)) ||
    (input.length === 1 && key.meta && 'bdfy'.includes(input))
  )
}

/** densable `to` — Ink Key flags → surface key names. */
const PLUGIN_CLIENT_KEY_NAMES: Array<[keyof Key, string]> = [
  ['upArrow', 'up'],
  ['downArrow', 'down'],
  ['leftArrow', 'left'],
  ['rightArrow', 'right'],
  ['pageUp', 'pageup'],
  ['pageDown', 'pagedown'],
  ['home', 'home'],
  ['end', 'end'],
  ['return', 'return'],
  ['tab', 'tab'],
  ['backspace', 'backspace'],
  ['delete', 'delete'],
]

/**
 * densable `ro` — skip wheel; named key or space; empty input drops.
 */
export function pluginClientKeyFromInput(
  input: string,
  key: Key,
): { key: string; ctrl?: true; shift?: true; meta?: true } | undefined {
  if (key.wheelUp || key.wheelDown) return undefined
  const named =
    PLUGIN_CLIENT_KEY_NAMES.find(([flag]) => key[flag])?.[1] ??
    (input === ' ' ? 'space' : input)
  if (named === '') return undefined
  return {
    key: named,
    ...(key.ctrl ? { ctrl: true as const } : {}),
    ...(key.shift ? { shift: true as const } : {}),
    ...(key.meta ? { meta: true as const } : {}),
  }
}

export function pluginClientPointerKind(
  type: MouseActionEvent['type'],
): 'down' | 'up' | 'move' {
  if (type === 'mousedown') return 'down'
  if (type === 'mouseup') return 'up'
  return 'move'
}

/**
 * densable `eo` — isolate pointer button names. DualInk packs SGR mods in
 * high bits; mask 0x03 so 0/1/2 still map left/middle/right.
 */
export function pluginClientPointerButton(
  button: number | undefined,
): 'left' | 'middle' | 'right' | undefined {
  if (button === undefined) return undefined
  switch (button & 0x03) {
    case 0:
      return 'left'
    case 1:
      return 'middle'
    case 2:
      return 'right'
    default:
      return undefined
  }
}

export function measurePluginClientBox(node: DOMElement | null): {
  width: number
  height: number
} {
  if (node === null) return { width: 0, height: 0 }
  return measureElement(node)
}

export function childList(
  node: Record<string, unknown>,
  props: Record<string, unknown>,
): unknown[] {
  const raw = props.children ?? node.children
  return flattenDrawingChildren(raw)
}
