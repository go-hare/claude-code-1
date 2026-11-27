/**
 * Function hooks submodule: panes
 * Extracted from src/utils/plugins/functionHooksModules.ts.
 */
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../../services/analytics/metadata.js'
import { setClientTerminalSize } from '../functionHooksClient.js'
import { placementFromAttachedSurfaces } from '../surfaceViewportClients.js'
import {
  PANE_ASKED_MAX,
  PANE_OPEN_FLOOR_ASKED,
  PANE_OPEN_FLOOR_DEFAULT,
  functionHookPatternMatches,
} from './constants.js'
import { clientFaultSiteKey, releaseClientFaultMount } from './faultRender.js'
import { runFunctionHookChain } from './hookChain.js'
import {
  bumpRasterFrames,
  fhState,
  ideGet,
  ideSiteKey,
  unmountRequest,
  type SessionFunctionHooksModulesState,
} from './state.js'
import type {
  AskedPaneRef,
  PanesListener,
  PanesState,
  PanesTerminalSize,
  PluginPaneEntry,
} from './types.js'

export function getPanesTerminalSize(): PanesTerminalSize | undefined {
  return fhState().panesTerminalSize
}

export function notifyPanesListeners(): void {
  for (const listener of fhState().panesListeners) listener()
}

function clonePaneEntry(pane: PluginPaneEntry): PluginPaneEntry {
  return {
    id: pane.id,
    plugin: pane.plugin,
    title: pane.title,
    ...(pane.closeOnEscape === true && { closeOnEscape: true }),
    ...(pane.holdToasts === true && { holdToasts: true }),
    ...(pane.rows !== undefined && { rows: pane.rows }),
    ...(pane.columns !== undefined && { columns: pane.columns }),
  }
}

/** Snapshot of densable `JSn`-shaped panes state. */
export function getPanesState(): PanesState {
  return {
    open: fhState()
      .pluginPanes.filter(pane => fhState().paneOpenIds.has(pane.id))
      .map(clonePaneEntry),
    unplaced: fhState().unplacedPanes.map(clonePaneEntry),
    asked: fhState().askedPanes.map(row => ({
      plugin: row.plugin,
      id: row.id,
    })),
    shownId: fhState().shownPaneId,
    focusedId: fhState().focusedPaneId,
    focusRequest: fhState().paneFocusRequest,
    placements: fhState().panePlacements,
    closing: [...fhState().paneClosing],
  }
}

export function subscribePanes(listener: PanesListener): () => void {
  const listeners = fhState().panesListeners
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Replace panes state (gold `Si().setState`). Open entries sync into
 * `pluginPanes` / `paneOpenIds` so ui.open/close/panes stay coherent.
 */
export function setPanesState(
  next: PanesState | ((prev: PanesState) => PanesState),
): void {
  const state = typeof next === 'function' ? next(getPanesState()) : next
  fhState().pluginPanes.length = 0
  fhState().paneOpenIds.clear()
  for (const pane of state.open) {
    const entry = clonePaneEntry(pane)
    fhState().pluginPanes.push(entry)
    fhState().paneOpenIds.add(entry.id)
  }
  fhState().unplacedPanes.length = 0
  for (const pane of state.unplaced)
    fhState().unplacedPanes.push(clonePaneEntry(pane))
  fhState().askedPanes.length = 0
  for (const row of state.asked) {
    fhState().askedPanes.push({ plugin: row.plugin, id: row.id })
  }
  fhState().shownPaneId = state.shownId
  fhState().focusedPaneId = state.focusedId
  fhState().paneFocusRequest = state.focusRequest
  fhState().panePlacements = state.placements
  fhState().paneClosing.clear()
  for (const id of state.closing) fhState().paneClosing.add(id)
  notifyPanesListeners()
  bumpRasterFrames()
}

/** densable `u3` focusPane — set focusedId/shownId, clear focusRequest. */
export function focusPane(id: string | null): void {
  const openHas =
    id === null || fhState().pluginPanes.some(pane => pane.id === id)
  const nextFocused = openHas ? id : fhState().focusedPaneId
  const nextShown = openHas && id !== null ? id : fhState().shownPaneId
  if (
    fhState().focusedPaneId === nextFocused &&
    fhState().shownPaneId === nextShown &&
    fhState().paneFocusRequest === null
  ) {
    return
  }
  fhState().focusedPaneId = nextFocused
  fhState().shownPaneId = nextShown
  fhState().paneFocusRequest = null
  notifyPanesListeners()
  bumpRasterFrames()
}

/** densable `$Fr` nextPaneId — next open id after focusedId. */
export function nextFocusedPaneId(
  state: PanesState = getPanesState(),
): string | null {
  const at = state.open.findIndex(pane => pane.id === state.focusedId)
  return state.open[at + 1]?.id ?? null
}

/**
 * densable `ZLo(state, delta)` — wrap shownId among open when open.length>1.
 */
export function cycleShownPaneId(
  delta: number,
  state: PanesState = getPanesState(),
): string | null {
  const count = state.open.length
  const at = state.open.findIndex(pane => pane.id === state.shownId)
  return count > 1 && at >= 0
    ? (state.open[(at + delta + count) % count]?.id ?? null)
    : null
}

/** densable `h` hasAsked — asked.some(plugin+id). */
export function hasAskedPane(
  state: PanesState,
  paneRef: AskedPaneRef | Pick<PluginPaneEntry, 'plugin' | 'id'>,
): boolean {
  return state.asked.some(
    row => row.id === paneRef.id && row.plugin === paneRef.plugin,
  )
}

/** densable `I` openFloor — asked → D9(110), else C8e(144). */
export function paneOpenFloor(
  state: PanesState,
  paneRef: AskedPaneRef | Pick<PluginPaneEntry, 'plugin' | 'id'>,
): number {
  return hasAskedPane(state, paneRef)
    ? PANE_OPEN_FLOOR_ASKED
    : PANE_OPEN_FLOOR_DEFAULT
}

/**
 * densable `b` placedPanes — move/update pane into open, drop from unplaced.
 * Keeps plugin ownership when replacing an already-open id.
 */
function placedPanes(
  state: PanesState,
  pane: PluginPaneEntry,
  focusRequest: string | null | undefined,
): PanesState {
  const already = state.open.some(row => row.id === pane.id)
  const open = already
    ? state.open.map(row =>
        row.id === pane.id ? { ...pane, plugin: row.plugin } : row,
      )
    : [...state.open, pane]
  return {
    open,
    unplaced: state.unplaced.filter(row => row.id !== pane.id),
    asked: state.asked,
    shownId: already ? state.shownId : (state.focusedId ?? pane.id),
    focusedId: state.focusedId,
    focusRequest: focusRequest ?? null,
    placements: state.placements,
    closing: state.closing,
  }
}

/**
 * densable `FFr` / `isToastHoldShown` — placements>0 && shown pane holdToasts.
 */
export function isToastHoldShown(state: PanesState = getPanesState()): boolean {
  if (state.placements <= 0) return false
  const shown = state.open.find(pane => pane.id === state.shownId)
  return shown?.holdToasts === true
}

/**
 * densable `Q` / `withKeptAsked` — pure GlobalConfig-shaped patch helper.
 */
export function withKeptAsked(
  config: {
    pluginPanes?: { asked?: AskedPaneRef[] } & Record<string, unknown>
  },
  asked: AskedPaneRef[],
): { pluginPanes: { asked: AskedPaneRef[] } & Record<string, unknown> } {
  return {
    ...config,
    pluginPanes: {
      ...config.pluginPanes,
      asked,
    },
  }
}

/**
 * densable `R` / `keptAsked` — read `pluginPanes.asked` from GlobalConfig.
 */
export function keptAskedPanesFromConfig(): AskedPaneRef[] {
  try {
    // Lazy require avoids cycles with config → plugins.
    const { getGlobalConfig } =
      require('../../config.js') as typeof import('../../config.js')
    const raw = getGlobalConfig().pluginPanes?.asked
    if (!Array.isArray(raw)) return []
    return raw.flatMap(row => {
      if (
        row === null ||
        typeof row !== 'object' ||
        typeof (row as { plugin?: unknown }).plugin !== 'string' ||
        typeof (row as { id?: unknown }).id !== 'string'
      ) {
        return []
      }
      return [
        {
          plugin: (row as { plugin: string }).plugin,
          id: (row as { id: string }).id,
        },
      ]
    })
  } catch {
    return []
  }
}

/**
 * densable `M` seedAsked — one-shot load of persisted asked into state.asked.
 * Default source: `keptAskedPanesFromConfig()` (`mL` disk).
 */
export function seedAskedPanes(persisted?: readonly AskedPaneRef[]): void {
  if (fhState().askedPanesSeeded) return
  fhState().askedPanesSeeded = true
  const rows = persisted ?? keptAskedPanesFromConfig()
  if (rows.length === 0) return
  setPanesState(state => ({
    ...state,
    asked: [...rows.filter(row => !hasAskedPane(state, row)), ...state.asked],
  }))
}

/**
 * densable `A`/`keepAsked` — write `pluginPanes.asked` via saveGlobalConfig (`mL`).
 * Cap at PANE_ASKED_MAX. Fire-and-forget; same-ref early exit.
 * Gold: on change → `y("plugin_function_hooks_pane_ask")` or
 * `p("plugin_function_hooks_pane_ask","not_persisted")`.
 */
function keepAskedPaneSoftPersist(
  pane: AskedPaneRef,
  mode: 'asked' | 'dismissed',
): void {
  const wantAsked = mode === 'asked'
  void import('../../config.js')
    .then(({ saveGlobalConfig }) => {
      let changed = false
      saveGlobalConfig(current => {
        const held = current.pluginPanes
        const prev = Array.isArray(held?.asked) ? held.asked : []
        const filtered = prev.filter(
          row =>
            !(
              typeof row === 'object' &&
              row !== null &&
              (row as { plugin?: string }).plugin === pane.plugin &&
              (row as { id?: string }).id === pane.id
            ),
        )
        const nextAsked = wantAsked
          ? [...filtered, { plugin: pane.plugin, id: pane.id }].slice(
              -PANE_ASKED_MAX,
            )
          : filtered
        const same =
          prev.length === nextAsked.length &&
          prev.every((row, i) => {
            const n = nextAsked[i]
            return (
              typeof row === 'object' &&
              row !== null &&
              n !== undefined &&
              (row as { plugin?: string }).plugin === n.plugin &&
              (row as { id?: string }).id === n.id
            )
          })
        if (same) return current
        changed = true
        return {
          ...current,
          pluginPanes: {
            ...held,
            asked: nextAsked,
          },
        }
      })
      if (!changed) return
      void import('../../../services/analytics/index.js')
        .then(({ logEvent }) => {
          logEvent(
            'plugin_function_hooks_pane_ask' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            {
              plugin:
                pane.plugin as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            },
          )
        })
        .catch(() => {
          /* hollow analytics optional */
        })
    })
    .catch(() => {
      void import('../../../services/analytics/index.js')
        .then(({ logEvent }) => {
          logEvent(
            'plugin_function_hooks_pane_ask' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            {
              status:
                'not_persisted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              plugin:
                pane.plugin as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            },
          )
        })
        .catch(() => {
          /* hollow analytics optional */
        })
    })
}

/**
 * densable `sNo` rememberAsked — seed + append asked if new + soft persist.
 */
export function rememberAskedPane(pane: AskedPaneRef): void {
  seedAskedPanes()
  let added = false
  setPanesState(state => {
    added = !hasAskedPane(state, pane)
    return added ? { ...state, asked: [...state.asked, { ...pane }] } : state
  })
  if (added) keepAskedPaneSoftPersist(pane, 'asked')
}

/**
 * densable `Y` forgetAsked — remove from asked + soft persist dismissed.
 */
export function forgetAskedPane(pane: AskedPaneRef): void {
  setPanesState(state =>
    hasAskedPane(state, pane)
      ? {
          ...state,
          asked: state.asked.filter(
            row => row.plugin !== pane.plugin || row.id !== pane.id,
          ),
        }
      : state,
  )
  keepAskedPaneSoftPersist(pane, 'dismissed')
}

/**
 * densable `ee` placementAtOpen — decide place vs unplaced from columns + floor.
 * `force` (person-origin) always places. Unknown columns → densable `Epn` via
 * `placementFromAttachedSurfaces()` (empty tip registry → undefined → place).
 * Desktop ui_attach/Fco still invent-ban.
 * focusSites HAVE as `pluginFocusSites` (g9e/Tq); XHo HAVE via bindPluginFocusHost.
 * vat/transcript.reveal for ui.scroll `{to:{requestId}}` is HAVE.
 */
export function placementAtOpen(
  state: PanesState,
  pane: AskedPaneRef,
  force = false,
): { isPlaced: true } | { isPlaced: false; reason: string } {
  const columns = fhState().panesTerminalSize?.columns
  const floor = paneOpenFloor(state, pane)
  if (columns === undefined) {
    // densable: Epn() ?? { isPlaced: true }
    return placementFromAttachedSurfaces() ?? { isPlaced: true }
  }
  if (force || columns >= floor) return { isPlaced: true }
  return {
    isPlaced: false,
    reason: `unasked below ${floor} columns (${columns} now${
      floor === PANE_OPEN_FLOOR_ASKED ? ', an id the person opened before' : ''
    }): placed when the person opens it, or when the terminal is widened to ${floor} columns`,
  }
}

/**
 * densable `oNo` placeWaiting — filter unplaced where columns >= openFloor,
 * place into open via reduce `b()`, log placed.
 */
export function placeWaitingPanes(columns: number): void {
  // densable oNo — place waiters only. d3 is sst's write; bootstrap L() if unset.
  if (fhState().panesTerminalSize === undefined) {
    const rows = process.stdout.rows ?? 0
    fhState().panesTerminalSize = {
      columns,
      rows,
      conversationColumns: Math.max(1, columns),
    }
    setClientTerminalSize(fhState().panesTerminalSize)
  }
  // gold logs each placed waiter via `t(\`ui.open … (waiting, ${columns} columns): placed\`)`
  setPanesState(state =>
    state.unplaced
      .filter(pane => columns >= paneOpenFloor(state, pane))
      .reduce(
        (next, pane) => placedPanes(next, pane, next.focusRequest),
        state,
      ),
  )
}

/**
 * densable `i4n` placeWaitingRemote — place ALL unplaced into open.
 */
export function placeWaitingPanesRemote(_reason?: string): void {
  if (getPanesState().unplaced.length === 0) return
  // gold logs each placed waiter via `t(\`ui.open … (waiting, ${reason}): placed\`)`
  setPanesState(state =>
    state.unplaced.reduce(
      (next, pane) => placedPanes(next, pane, next.focusRequest),
      state,
    ),
  )
}

/**
 * densable `sst(h,v,M)` — write d3 `{columns, rows, conversationColumns}` then oNo.
 * `conversationColumns = max(1, columns - chrome)`. Gold chrome is band collapse
 * columns; DualInk host passes 0 when unknown.
 */
export function settlePanesTerminalColumns(
  columns: number,
  rows?: number,
  chromeColumns = 0,
): void {
  if (!Number.isFinite(columns) || !Number.isInteger(columns) || columns <= 0) {
    return
  }
  const terminalRows =
    rows !== undefined && Number.isFinite(rows) && rows > 0
      ? Math.floor(rows)
      : (process.stdout.rows ?? 0)
  const conversationColumns = Math.max(1, columns - Math.max(0, chromeColumns))
  fhState().panesTerminalSize = {
    columns,
    rows: terminalRows,
    conversationColumns,
  }
  setClientTerminalSize(fhState().panesTerminalSize)
  placeWaitingPanes(columns)
}

/** densable `QFt` offerPlacement — placements++ with disposer placements--. */
export function offerPlacement(): () => void {
  fhState().panePlacements += 1
  notifyPanesListeners()
  const termSize = fhState().panesTerminalSize
  if (termSize !== undefined) {
    placeWaitingPanes(termSize.columns)
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    fhState().panePlacements -= 1
    notifyPanesListeners()
  }
}

/** densable `a4n` settleFocusRequest — ok? focusPane(req) : clear. */
export function settleFocusRequest(ok: boolean): void {
  const request = fhState().paneFocusRequest
  if (request === null) return
  if (ok) focusPane(request)
  else {
    fhState().paneFocusRequest = null
    notifyPanesListeners()
  }
}

/** Semantic alias for `offerPlacement` (`QFt`). */
export const offerPanePlacement = offerPlacement

/** Semantic alias for `settleFocusRequest` (`a4n`). */
export const settlePaneFocusRequest = settleFocusRequest

/**
 * densable `Si` panesStore shape (semantic) — get/set/subscribe over JSn fields.
 * Never export minify `Si` / `panesStore`.
 */
export function getPanesStore(): {
  getState: typeof getPanesState
  setState: typeof setPanesState
  subscribe: typeof subscribePanes
} {
  return {
    getState: getPanesState,
    setState: setPanesState,
    subscribe: subscribePanes,
  }
}

/** densable `l4n` showPane — set shownId; keep/move focusedId when already set. */
export function showPane(id: string): void {
  if (
    fhState().shownPaneId === id ||
    !fhState().pluginPanes.some(pane => pane.id === id)
  )
    return
  fhState().shownPaneId = id
  if (fhState().focusedPaneId !== null) fhState().focusedPaneId = id
  notifyPanesListeners()
  bumpRasterFrames()
}

/**
 * densable `ck(wd(Si().getState()))` — wire roster for CLI `ui_panes`.
 */
export function wirePanesState(state: PanesState = getPanesState()): {
  panes: Array<{
    id: string
    title: string
    plugin: string
    close_on_escape?: boolean
    hold_toasts?: boolean
    rows?: number
    columns?: number
  }>
  shown_id: string | null
  focused_id: string | null
  focus_requested_id: string | null
} {
  return {
    panes: state.open.map(pane => ({
      id: pane.id,
      title: pane.title,
      plugin: pane.plugin,
      ...(pane.closeOnEscape && { close_on_escape: pane.closeOnEscape }),
      ...(pane.holdToasts && { hold_toasts: pane.holdToasts }),
      ...(pane.rows !== undefined && { rows: pane.rows }),
      ...(pane.columns !== undefined && { columns: pane.columns }),
    })),
    shown_id: state.shownId,
    focused_id: state.focusedId,
    focus_requested_id: state.focusRequest,
  }
}

/**
 * densable `fue` — open + unplaced ids (ui_close membership).
 */
export function panesIncludingUnplaced(
  state: PanesState = getPanesState(),
): PluginPaneEntry[] {
  return [...state.open, ...state.unplaced]
}

/**
 * densable `XS` — remote client keyboard stamp after pane show/focus.
 * CLI has no Gt remote window map; still a call-site so print matches gold.
 */
export function syncRemotePaneKeyboard(_clientId: string): void {
  void _clientId
}

export function getPluginPanes(): Array<{
  id: string
  plugin: string
  title: string
  rows?: number
  columns?: number
}> {
  return fhState().pluginPanes.map(pane => ({
    id: pane.id,
    plugin: pane.plugin,
    title: pane.title,
    ...(pane.rows !== undefined && { rows: pane.rows }),
    ...(pane.columns !== undefined && { columns: pane.columns }),
  }))
}

/** densable `VS.shownPane` — the pane `cv`/`Zq` hosts with `nWt(xI("Pane"))`. */
export function getShownPluginPane():
  | {
      id: string
      plugin: string
      title: string
      isFocused: boolean
      rows?: number
      columns?: number
      offset: number
      bodyRows: number
      closeOnEscape?: boolean
    }
  | undefined {
  if (fhState().shownPaneId === null) return undefined
  const pane = fhState().pluginPanes.find(
    item => item.id === fhState().shownPaneId,
  )
  if (pane === undefined) return undefined
  const site = ideGet('Pane', pane.id)
  return {
    id: pane.id,
    plugin: pane.plugin,
    title: pane.title,
    isFocused: fhState().focusedPaneId === pane.id,
    ...(pane.rows !== undefined && { rows: pane.rows }),
    ...(pane.columns !== undefined && { columns: pane.columns }),
    offset: site?.offset ?? 0,
    bodyRows: pane.rows ?? site?.bodyRows ?? 0,
    ...(pane.closeOnEscape === true && { closeOnEscape: true }),
  }
}

/** densable `sft(component, requestId)` — Input/Select + remount seat key. */
export function pluginFieldSeatKey(
  component: string,
  requestId: string,
): string {
  return `${component}\0${requestId}`
}

export function pluginFieldSeatGeneration(
  component: string,
  requestId: string,
): number {
  return (
    fhState()
      .pluginFieldSeatGenerationStore.getState()
      .get(pluginFieldSeatKey(component, requestId)) ?? 0
  )
}

/**
 * densable `NFr` — bump generation and drop Input/Select seats for that site.
 */
export function bumpPluginFieldSeatGeneration(
  component: string,
  requestId: string,
): void {
  const key = pluginFieldSeatKey(component, requestId)
  const nextGen = pluginFieldSeatGeneration(component, requestId) + 1
  fhState().pluginInputSeatStore.setState(prev => {
    if (!prev.has(key)) return prev
    const next = new Map(prev)
    next.delete(key)
    return next
  })
  fhState().pluginSelectSeatStore.setState(prev => {
    if (!prev.has(key)) return prev
    const next = new Map(prev)
    next.delete(key)
    return next
  })
  fhState().pluginFieldSeatGenerationStore.setState(prev =>
    new Map(prev).set(key, nextGen),
  )
}

export function getPluginInputSeatStore(): SessionFunctionHooksModulesState['pluginInputSeatStore'] {
  return fhState().pluginInputSeatStore
}

export function getPluginSelectSeatStore(): SessionFunctionHooksModulesState['pluginSelectSeatStore'] {
  return fhState().pluginSelectSeatStore
}

export function getPluginFieldSeatGenerationStore(): SessionFunctionHooksModulesState['pluginFieldSeatGenerationStore'] {
  return fhState().pluginFieldSeatGenerationStore
}

/** densable `ift`/`NFr` — Pane remount generation for QT/BO resetKey. */

/** densable `ift("Pane", id)` — host key / ErrorBoundary resetKey. */
export function getPaneRemountGeneration(id: string): number {
  return fhState().paneRemountGeneration.get(id) ?? 0
}

function bumpPaneRemountGeneration(id: string): void {
  fhState().paneRemountGeneration.set(
    id,
    (fhState().paneRemountGeneration.get(id) ?? 0) + 1,
  )
}

export function dropPluginPane(id: string): void {
  const at = fhState().pluginPanes.findIndex(pane => pane.id === id)
  if (at >= 0) fhState().pluginPanes.splice(at, 1)
  fhState().paneOpenIds.delete(id)
  // densable V/JFt: shownId falls back to open.at(-1); focusedId/focusRequest
  // are membership-only → null when the closed id was focused/pending.
  if (fhState().shownPaneId === id) {
    fhState().shownPaneId = fhState().paneOpenIds.size
      ? [...fhState().paneOpenIds].at(-1)!
      : null
  }
  if (fhState().focusedPaneId === id) fhState().focusedPaneId = null
  if (fhState().paneFocusRequest === id) fhState().paneFocusRequest = null
  for (let i = fhState().unplacedPanes.length - 1; i >= 0; i--) {
    if (fhState().unplacedPanes[i]?.id === id)
      fhState().unplacedPanes.splice(i, 1)
  }
  // densable JFt — Ide/Fj + g9e keyed Pane:id only; shared requestId
  // AbovePrompt sites stay (gold Fj(component, requestId)).
  for (let i = fhState().pluginSites.length - 1; i >= 0; i--) {
    const site = fhState().pluginSites[i]
    if (site?.requestId === id && site.component === 'Pane') {
      releaseClientFaultMount(
        clientFaultSiteKey({
          surface: 'terminal',
          component: 'Pane',
          requestId: id,
        }),
      )
      fhState().pluginSites.splice(i, 1)
    }
  }
  for (const [mapKey, site] of fhState().pluginFocusSites) {
    if (site.requestId === id && site.component === 'Pane') {
      fhState().pluginFocusSites.delete(mapKey)
    }
  }
  // densable JFt → NFr("Pane", id) — bump remount gen so BO resets.
  bumpPaneRemountGeneration(id)
  bumpPluginFieldSeatGeneration('Pane', id)
  fhState().ideSites.delete(ideSiteKey('Pane', id))
  unmountRequest(id)
  notifyPanesListeners()
  bumpRasterFrames()
}

/**
 * densable `aTt` — `ui.close` chain then drop. A hook that never calls
 * `next` keeps the pane open. `kind:"unload"` drops first then still runs
 * the chain (gold `iTt` then `r1("ui.close")`).
 */
export async function closePluginPane(
  id?: string,
  origin: { kind: string } = { kind: 'person' },
): Promise<void> {
  const target = id ?? fhState().shownPaneId
  if (target === null || target === undefined) return
  const already = fhState().paneClosing.has(target)
  const pane = fhState().pluginPanes.find(item => item.id === target)
  const unload = origin.kind === 'unload'
  if (unload) dropPluginPane(target)
  if (already) return
  const owner = pane?.plugin
  const hasCloseHook = fhState().loadedModules.some(
    mod =>
      !(unload && owner !== undefined && mod.name === owner) &&
      (mod.hooks ?? []).some(hook =>
        functionHookPatternMatches(hook.pattern, 'ui.close'),
      ),
  )
  if (!hasCloseHook) {
    if (!unload) dropPluginPane(target)
    // densable `j` forgetDismissed — person close forgets asked latch.
    if (origin.kind === 'person' && owner !== undefined) {
      forgetAskedPane({ plugin: owner, id: target })
    }
    return
  }
  fhState().paneClosing.add(target)
  notifyPanesListeners()
  try {
    let closedId: string | undefined
    await runFunctionHookChain('ui.close', { id: target, origin }, event => {
      const nextId = typeof event.id === 'string' ? event.id : target
      dropPluginPane(nextId)
      closedId = nextId
      return Promise.resolve({ value: undefined })
    })
    if (
      fhState().paneClosing.has(target) &&
      fhState().pluginPanes.some(item => item.id === target)
    ) {
      /* gold: kept open by a hook that never called next */
    } else if (
      origin.kind === 'person' &&
      owner !== undefined &&
      closedId !== undefined
    ) {
      forgetAskedPane({ plugin: owner, id: closedId })
    }
  } finally {
    fhState().paneClosing.delete(target)
    notifyPanesListeners()
  }
}

/** densable Pane `up`/`down`/`pageup`/`pagedown`/`home`/`end` → site offset. */
export function scrollPluginPane(
  to: 'up' | 'down' | 'pageUp' | 'pageDown' | 'top' | 'bottom',
): void {
  const shown = fhState().shownPaneId
  if (shown === null) return
  const site = ideGet('Pane', shown)
  if (site === undefined) return
  const max = Math.max(0, site.contentRows - site.bodyRows, site.maxOffset)
  const page = Math.max(1, site.bodyRows)
  let next = site.offset
  if (to === 'up') next -= 1
  else if (to === 'down') next += 1
  else if (to === 'pageUp') next -= page
  else if (to === 'pageDown') next += page
  else if (to === 'top') next = 0
  else next = max
  site.offset = Math.max(0, Math.min(max, next))
  if (site.offset > site.maxOffset) site.maxOffset = site.offset
  bumpRasterFrames()
}
