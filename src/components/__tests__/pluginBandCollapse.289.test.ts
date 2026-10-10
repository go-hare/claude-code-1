import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  pluginInputFieldKey,
  bandKeysWithScroll,
  bandRingHandlers,
  bandWindow,
  focusableAt,
  focusablesOfDrawing,
  getSettledBudget,
  createPluginInputMap,
  nextBandFocus,
  overflowCueText,
  paneScrollHandlers,
  isOtherDrawer,
  teammateViewId,
  pluginBandKeys,
  selectHighlightHandlers,
  selectKeysIntercept,
  setSettledBudget,
  subscribeSettledBudget,
  pluginInputPressEvent,
  wrapPluginFocusActs,
  clickFocusByPress,
  extendPaneRingWithCloseMark,
  hotkeyMapOfDrawing,
  resolveHotkeyPresses,
  titleStripStart,
  titleTabColumns,
  paneTitleChromeRows,
  paneWheelScroll,
  pluginClientKeyFromInput,
  pluginClientPointerButton,
  openListRows,
  selectWindow,
  hotkeyDigitVisible,
  resetPluginSelectSeat,
} from '../PluginRasterPanes.js'
import { computeWheelStep, initWheelAccel } from '../ScrollKeybindingHandler.js'

const PANES = join(import.meta.dir, '../PluginRasterPanes.tsx')
const DEFAULTS = join(import.meta.dir, '../../keybindings/defaultBindings.ts')
const SCHEMA = join(import.meta.dir, '../../keybindings/schema.ts')

describe('densable 2.1.289 Mods band CollapseHandle slice', () => {
  test('exports gold band constants and CollapseHandle / CollapsedHint', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain('export const BAND_REQUEST_ID')
    expect(src).toContain('BAND_REQUEST_ID = ABOVE_PROMPT_REQUEST_ID')
    expect(src).toContain('export const MARK_EDGE_COLUMNS = 1')
    expect(src).toContain('export const COLLAPSE_HANDLE_COLUMNS = 5')
    expect(src).toContain('export const HEIGHT_SETTLE_MS = 150')
    expect(src).toContain('export function PluginBandCollapseHandle')
    expect(src).toContain('export function PluginBandCollapsedHint')
    expect(src).toContain('export function PluginDimButton')
    expect(src).toContain('label="[-]"')
    expect(src).toContain('plugin panel hidden')
    expect(src).toContain('setBandCollapsed')
    expect(src).toContain('getBandCollapsed')
  })

  test('PluginAbovePromptSite wires collapse handle and collapsed hint', () => {
    const src = readFileSync(PANES, 'utf8')
    const start = src.indexOf('export function PluginAbovePromptSite')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start)
    expect(body).toContain('useBandCollapsed')
    expect(body).toContain('<PluginBandCollapseHandle')
    expect(body).toContain('<PluginBandCollapsedHint')
    expect(body).toContain('abovePrompt:toggle')
    expect(body).toContain('requestId: BAND_REQUEST_ID')
    expect(body).toContain('bandWindow(')
    expect(body).toContain('<PluginBandOverflowCue')
    expect(src).toContain('): site failed:')
  })

  test('Chat default binding registers abovePrompt:toggle', () => {
    const defaults = readFileSync(DEFAULTS, 'utf8')
    const schema = readFileSync(SCHEMA, 'utf8')
    expect(defaults).toContain("'ctrl+x ctrl+a': 'abovePrompt:toggle'")
    expect(schema).toContain("'abovePrompt:toggle'")
  })

  test('tip-additive effortSlider aliases survive band land', () => {
    const defaults = readFileSync(DEFAULTS, 'utf8')
    const schema = readFileSync(SCHEMA, 'utf8')
    expect(schema).toContain("'effortSlider:decreaseEffort'")
    expect(schema).toContain("'effortSlider:increaseEffort'")
    expect(schema).toContain("'effortSlider:toggleUltracode'")
    expect(schema).toContain("'effortSlider:thisSessionOnly'")
    expect(defaults).toContain("tab: 'effortSlider:toggleUltracode'")
  })
})

describe('densable 2.1.289 Mods band OverflowCue / bandWindow / nextBandFocus', () => {
  test('bandWindow reserves one row for cue when tree exceeds budget', () => {
    expect(bandWindow({ budget: 10, settledBudget: 10, treeRows: 10 })).toEqual(
      {
        windowRows: 10,
        hasCue: false,
        maxOffset: 0,
        bodyRows: 9,
      },
    )
    expect(bandWindow({ budget: 10, settledBudget: 10, treeRows: 14 })).toEqual(
      {
        windowRows: 9,
        hasCue: true,
        maxOffset: 5,
        bodyRows: 9,
      },
    )
  })

  test('overflowCueText matches gold i$ arrows', () => {
    expect(overflowCueText(0, 0)).toBe('')
    expect(overflowCueText(2, 0)).toBe('↑ 2 more')
    expect(overflowCueText(0, 3)).toBe('↓ 3 more')
    expect(overflowCueText(2, 3)).toBe('↑ 2 more · ↓ 3 more')
  })

  test('nextBandFocus lands first focusable or stays on band', () => {
    expect(nextBandFocus({ focus: null, count: 3 })).toBe(0)
    expect(nextBandFocus({ focus: null, count: 0 })).toBe('band')
    expect(nextBandFocus({ focus: 0, count: 3 })).toBe(1)
    expect(nextBandFocus({ focus: 2, count: 3 })).toBe(null)
    expect(nextBandFocus({ focus: 'band', count: 2 })).toBe(0)
  })

  test('exports OverflowCue host and abovePrompt ring action names', () => {
    const src = readFileSync(PANES, 'utf8')
    const schema = readFileSync(SCHEMA, 'utf8')
    const defaults = readFileSync(DEFAULTS, 'utf8')
    expect(src).toContain('export function PluginBandOverflowCue')
    expect(src).toContain('export function bandWindow')
    expect(src).toContain('export function nextBandFocus')
    expect(src).toContain('export function overflowCueText')
    expect(schema).toContain("'abovePrompt:next'")
    expect(schema).toContain("'abovePrompt:previous'")
    expect(schema).toContain("'abovePrompt:press'")
    expect(schema).toContain("'abovePrompt:leave'")
    expect(defaults).toContain("tab: 'abovePrompt:next'")
    expect(defaults).toContain("'shift+tab': 'abovePrompt:previous'")
  })
})

describe('densable 2.1.289 AZ !hasCue remap', () => {
  test('!hasCue remaps pane:scrollUp/Down onto ring previous/next', () => {
    const ran: string[] = []
    const ring = {
      'abovePrompt:next': () => {
        ran.push('next')
      },
      'abovePrompt:previous': () => {
        ran.push('prev')
      },
      'abovePrompt:press': () => undefined,
      'abovePrompt:leave': () => undefined,
    }
    const scroll = paneScrollHandlers({
      bodyRows: 8,
      contentRows: 20,
      scrollBy: delta => {
        ran.push(`scroll:${delta}`)
      },
    })
    const idle = bandKeysWithScroll(ring, scroll, false)
    idle['pane:scrollUp']()
    idle['pane:scrollDown']()
    expect(ran).toEqual(['prev', 'next'])
    const overflow = bandKeysWithScroll(ring, scroll, true)
    overflow['pane:scrollUp']()
    overflow['pane:scrollDown']()
    overflow['pane:pageUp']()
    expect(ran).toEqual(['prev', 'next', 'scroll:-1', 'scroll:1', 'scroll:-8'])
  })

  test('AbovePrompt Zt binds AZ bag while held, not only hasCue', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain('export function bandKeysWithScroll')
    expect(src).toContain('export function paneScrollHandlers')
    expect(src).toContain('bandKeysWithScroll(ring, scrollHandlers, hasCue)')
    expect(src).toContain(
      'const abovePromptIsActive = ringActive && !inputFocused && !selectFocused',
    )
    expect(src).toContain(
      "useKeybinding('pane:scrollUp', abovePromptHandlers['pane:scrollUp']",
    )
    expect(src).not.toContain(
      'const scrollActive = hasPluginTree && !bandCollapsed && hasCue',
    )
  })
})

describe('densable 2.1.289 s$ / FMn / _Ee onWheel / Wm', () => {
  test('s$ openListRows is FMn.rows; closed Select is 0', () => {
    expect(openListRows(null, 20)).toBe(0)
    expect(selectWindow(20, 0)).toEqual({
      first: 0,
      size: 8,
      hidden: 12,
      rows: 9,
    })
    expect(openListRows({ highlight: 0 }, 20)).toBe(9)
    expect(selectWindow(3, 0).rows).toBe(3)
  })

  test('PluginAbovePromptSite outer Box onWheel when hasCue && !dialogOpen', () => {
    const src = readFileSync(PANES, 'utf8')
    const site = src.slice(src.indexOf('export function PluginAbovePromptSite'))
    expect(site).toContain(
      'onWheel={hasCue && !dialogOpen ? bandWheel : undefined}',
    )
    expect(site).toContain('maxHeight={rows + listRows}')
    expect(site).toContain('useBandDigitHotkey')
    expect(site).toContain('enterConfirms:!1')
  })

  test('Wm digit visibility: !hasCue always; cue requires a seat', () => {
    const seats = new Map([['1', { plugin: 'p', handle: 1 }]])
    expect(hotkeyDigitVisible(false, seats, '1')).toBe(true)
    expect(hotkeyDigitVisible(true, new Map(), '1')).toBe(false)
    expect(hotkeyDigitVisible(true, seats, '1')).toBe(true)
    expect(hotkeyDigitVisible(true, seats, '2')).toBe(false)
  })
})

describe('densable 2.1.289 yEe scroll place + AbovePrompt* contexts', () => {
  test('useBandScrollPlace wires offset/marginTop (no deferred offset=0 stub)', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain('export function useBandScrollPlace')
    // densable `e$` — primary export is floorOffset; floorBandOffset is alias.
    expect(src).toContain('export function floorOffset')
    expect(src).toContain('export const floorBandOffset = floorOffset')
    expect(src).toContain('useBandScrollPlace({')
    expect(src).toContain('marginTop={-offset}')
    expect(src).toContain('paneScrollHandlers({')
    expect(src).toContain('contentRows: treeRows')
    expect(src).not.toContain(
      'densable scroll place (`yEe`) deferred — offset stays 0',
    )
    const site = src.slice(src.indexOf('export function PluginAbovePromptSite'))
    expect(site).not.toMatch(/const offset = 0/)
    expect(site).toContain("context: 'AbovePrompt'")
    // Ide HAVE — register/update/unregister ABOVE_PROMPT site (no Ide/Hde minify).
    expect(src).toContain('registerPluginScrollSite')
    expect(src).toContain('updatePluginScrollSite')
    expect(src).toContain('unregisterPluginScrollSite')
    expect(site).toContain(
      "registerPluginScrollSite(scrollOwner, BAND_REQUEST_ID, 'AbovePrompt'",
    )
    expect(site).toContain('updatePluginScrollSite(')
    expect(site).toContain('scrollOwner,')
    expect(site).toContain('BAND_REQUEST_ID')
    expect(site).toContain("'AbovePrompt'")
    // Hde/`QLt` person-origin HAVE — dispatchPersonUiScroll → ui.scroll chain.
    expect(src).toContain('dispatchPersonUiScroll')
    expect(src).toContain('getPluginScrollSite')
    expect(src).toContain('void dispatchPersonUiScroll')
    expect(site).toContain('requestId: BAND_REQUEST_ID')
    expect(site).toContain("component: 'AbovePrompt'")
    // person gate open for any registered site (Pane + AbovePrompt).
    expect(src).toContain("siteMeta.plugin === '' || siteMeta.requestId === ''")
    expect(src).not.toContain(
      "siteMeta.component !== 'AbovePrompt' || siteMeta.requestId !== BAND_REQUEST_ID",
    )
    // densable `_Ee` To>So + OMr place mirrored on AbovePrompt.
    expect(site).toContain('placed > maxOffset')
    expect(site).toContain('nearestScrollOffset')
    expect(site).toContain('HeldFocusRefContext.Provider')
    // densable IZ split: yEe/OMr/Ide bodyRows=windowRows (ro); props.scroll=Ao.
    expect(site).toContain('bodyRows: windowRows')
    expect(site).toContain('useBandScrollPlace({\n    bodyRows: windowRows')
    expect(site).toContain(
      'nearestScrollOffset({\n        offset: prev,\n        bodyRows: windowRows',
    )
    expect(site).toContain('bodyRows: windowRows')
    expect(site).toContain('contentRows: treeRows')
    expect(site).toContain('bandKeysWithScroll(ring, scrollHandlers, hasCue)')
    expect(site).toContain('scroll: { offset, bodyRows }')
    expect(site).toContain('maxHeight={windowRows}')
    // densable fEe keptColumns=DZ + XXt body columns + o$ view.
    expect(site).toContain('marginRight={COLLAPSE_HANDLE_COLUMNS}')
    expect(site).toContain('PaneBodyColumnsContext.Provider')
    expect(site).toContain('view: viewingAgentView')
    // densable o$: primitive SEe via useAppState, object via useMemo — never
    // return {} from the selector (Object.is loop → RootREPLBoundary #185).
    expect(src).toContain('function useViewingAgentView')
    expect(src).toContain('useAppState(s => viewingAgentIdFromState(s))')
    expect(src).not.toContain('useAppState(s =>\n    viewingAgentViewProps')
    expect(src).toContain('agentId === undefined ? {} : { agentId }')
    expect(src).toContain('export function teammateViewId')
    expect(src).toContain('resumableAgentId')
    expect(src).toContain('export function isOtherDrawer')
    expect(site).toContain('const clearFocusIndex')
    expect(site).toContain('if (!bandLiveGate) clearFocusIndex(null)')
    expect(site).toContain('if (panesFocusedId !== null) clearFocusIndex(null)')
    expect(site).toContain("clearFocusIndex('band')")
    expect(site).toContain(
      'isOtherDrawer(prevFocusablesRef.current, focusables)',
    )
    expect(site).toContain('usePaneClickAway(bandClickAway)')
    expect(site).toContain('clearFocusIndex(null);')
    expect(site).toContain(
      'useDraftHeldAway(focusIndex ?? panesFocusedId, bandAway)',
    )
    expect(src).toContain('retainFinePointer()')
    expect(src).toContain('event?.shift')
    expect(src).toContain('bandCollapsed')
    expect(src).toContain('bandAwayRef.current = node')
    expect(site).not.toMatch(/landFocusIndex\(null\)/)
    // densable jZ + NLe/DQt mutex
    expect(src).toContain('export function useDraftHeldAway')
    expect(src).toContain('export function setPluginClientFocusedId')
    expect(src).toContain('export function clearPluginClientFocusedId')
    expect(site).toContain(
      'useDraftHeldAway(focusIndex ?? panesFocusedId, bandAway)',
    )
    expect(src).toContain('if (held === null) return')
    expect(src).toContain('getPromptInputStoreValue() !== origin')
    expect(site).toContain('getPluginClientFocusedId')
    expect(site).toContain(
      'if (clientFocusedId !== null) clearFocusIndex(null)',
    )
    expect(site).toContain(
      'if (focusIndex !== null) setPluginClientFocusedId(null)',
    )
    // densable QT BO wraps pee
    const qt = src.slice(
      src.indexOf('export function PluginPaneSite'),
      src.indexOf('function PluginPaneSiteBody'),
    )
    expect(qt).toContain('<PaneErrorBoundary')
    const pee = src.slice(
      src.indexOf('function PluginPaneSiteBody'),
      src.indexOf('export function PluginAbovePromptSite'),
    )
    expect(pee).not.toContain('<PaneErrorBoundary')
    const replInline = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(replInline).toContain('{panesDocked ? null : (')
    expect(replInline).not.toContain(
      '{panesDocked ? null : shownPluginPane !== undefined ? (',
    )
    // densable yEe Kt/QLt.finally lives in useBandScrollPlace (shared).
    expect(src).toContain('aliveRef')
    expect(src).toContain('.finally(after)')
    // densable a4n mount/clear + auto-settle (Un/h/Wr/Me/placements gates).
    expect(site).toContain('settlePaneFocusRequest(false)')
    expect(site).toContain('promptEmpty &&')
    expect(site).toContain('!hasSurvey')
    expect(site).toContain('!dialogOpen')
    expect(site).toContain('focusIndex === null')
    expect(site).toContain('panes.focusedId === null')
    expect(site).toContain('panes.placements > 0')
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    expect(repl).toContain("promptEmpty={inputValue === ''}")
    expect(src).toContain("runFunctionHookChain('ui.scroll')")
    expect(src).not.toMatch(/\bexport (?:const|function|class|let|var) Ide\b/)
    expect(src).not.toMatch(/\bexport (?:const|function|class|let|var) Hde\b/)
    expect(src).not.toMatch(/\bexport (?:const|function|class|let|var) QLt\b/)
    expect(src).not.toMatch(/\bexport\s+(?:const|function|let)\s+a4n\b/)
  })

  test('AbovePrompt / Input / Select contexts + gold bindings land', () => {
    const schema = readFileSync(SCHEMA, 'utf8')
    const defaults = readFileSync(DEFAULTS, 'utf8')
    expect(schema).toContain("'AbovePrompt'")
    expect(schema).toContain("'AbovePromptInput'")
    expect(schema).toContain("'AbovePromptSelect'")
    expect(schema).toContain("'abovePrompt:highlightNext'")
    expect(schema).toContain("'abovePrompt:highlightPrevious'")
    expect(schema).toContain("'abovePrompt:focus'")
    expect(schema).toContain("'pane:scrollUp'")
    expect(schema).toContain("'pane:next'")
    expect(schema).toContain("'pane:previous'")
    expect(defaults).toContain("context: 'AbovePrompt'")
    expect(defaults).toContain("context: 'AbovePromptInput'")
    expect(defaults).toContain("context: 'AbovePromptSelect'")
    expect(defaults).toContain("space: 'abovePrompt:press'")
    expect(defaults).toContain("down: 'abovePrompt:highlightNext'")
    expect(defaults).toContain("up: 'abovePrompt:highlightPrevious'")
    expect(defaults).toContain("'ctrl+x tab': 'abovePrompt:focus'")
    // tip-additive effortSlider must survive
    expect(schema).toContain("'effortSlider:toggleUltracode'")
    expect(defaults).toContain("tab: 'effortSlider:toggleUltracode'")
  })

  test('PluginSiteFields hosts m$/y$/g$; Chat abovePrompt:focus lands ring', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain('function PluginSiteFields')
    expect(src).toContain('InputFieldsContext')
    expect(src).toContain('SelectFieldsContext')
    expect(src).toContain('function landBandInputFocus')
    expect(src).not.toContain('registerBandFieldBridge')
    expect(src).not.toContain('bandFieldBridge')
    expect(src).toContain("if (site !== 'AbovePrompt') return")
    expect(src).toContain("'abovePrompt:focus'")
    expect(src).toContain(
      'nextBandFocus({ focus: focusIndex, count: focusables.length })',
    )
    // Si dock HAVE: settle preferred, then focusedId cycle, then band ring
    expect(src).toContain('settlePaneFocusRequest')
    expect(src).toContain('nextFocusedPaneId')
    expect(src).toContain('getPanesState')
  })

  test('PluginPaneSite XHo: live focusedId isHeldNow + act/moveByPerson ring', () => {
    const src = readFileSync(PANES, 'utf8')
    const start = src.indexOf('export function PluginPaneSite')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(
      start,
      src.indexOf('export function PluginAbovePromptSite'),
    )
    expect(body).toContain('usePluginFocusHost')
    expect(body).toContain('getPanesState().focusedId === id')
    expect(body).toContain('wrapPluginFocusActs')
    expect(body).toContain('paneHost.moveByPerson')
    expect(body).toContain('paneHost.forget()')
    expect(body).toContain('registerPluginScrollSite')
    expect(body).toContain('extendPaneRingWithCloseMark')
    expect(body).toContain('clickFocusByPress')
    expect(body).toContain('ClickedPressContext.Provider')
    expect(body).toContain('paneFocusIndex >= paneFocusables.length')
    expect(body).toContain("'pane:next'")
    expect(body).toContain("'pane:previous'")
    expect(body).toContain('cycleShownPaneId')
    expect(body).toContain("'chat:cancel'")
    expect(body).toContain('closeOnEscape')
    expect(body).toContain('PluginPaneTitleStrip')
    expect(body).toContain('hotkeyMapOfDrawing')
    expect(body).toContain('resolveHotkeyPresses')
    expect(body).toContain('useHasOpenDialogs')
    expect(body).toContain('useIsOverlayActive')
    expect(body).toContain("s.viewSelectionMode === 'viewing-agent'")
    expect(body).toContain('s.footerSelection !== null')
    expect(body).toContain('height={1}')
    expect(body).toContain('paneTitleChromeRows')
    expect(body).toContain('usePaneClickAway')
    expect(body).toContain('promptOwnsEscape')
    expect(body).toContain("borderStyle: 'round'")
    // densable pee unfocus/prune: ht(null) only — never Un/Vt (#185 boot).
    expect(body).toContain('clearPaneFocusLocal')
    expect(body).toMatch(
      /if \(!paneHeld\) \{\s*setPaneFocusIndex\(null\);\s*setEngineHeld\(null\);/,
    )
    expect(body).not.toMatch(/if \(!paneHeld\) \{\s*landPaneFocusIndex\(null\)/)
    expect(body).not.toMatch(
      /paneFocusIndex >= paneFocusables\.length\) \{\s*landPaneFocusIndex\(null\)/,
    )
    // densable QT gate: empty host must not mount pee body hooks.
    expect(body).toContain('function PluginPaneSiteBody')
    expect(body).toContain('if (pane === undefined) return null')
    expect(body).toContain(
      'if (!((rows ?? 0) > 0 && (columns ?? 0) > 0)) return null',
    )
    expect(body).toContain('tabs: otherTabs')
    expect(body).toContain('pick: showPane')
    expect(body).toContain('heldTabId')
    expect(body).toContain('selectionScope')
    // densable pee yEe — Pane host owns scrollBy; paneWheelScroll helper stays exported.
    expect(body).toContain("component: 'Pane'")
    expect(body).toContain('useBandScrollPlace({')
    expect(body).toContain('marginTop={-paneScrollOffset}')
    // densable pee: clip uses Ao (paneAllocated); yEe bodyRows uses ao (paneViewport).
    expect(body).toContain('const paneAllocated =')
    expect(body).toContain('Math.min(paneAllocated, paneTreeRows)')
    expect(body).toContain('maxHeight={paneAllocated}')
    expect(body).toContain('overflowY="hidden"')
    expect(body).toContain('height: paneAllocated')
    expect(body).toContain('paneScrollBy(sign * rows)')
    expect(body).toContain('computeWheelStep')
    expect(body).toContain('ensurePaneWheelAccel')
    expect(body).not.toContain('paneWheelScroll(event')
    expect(body).toContain('panePlaced > paneMaxOffset')
    expect(body).toContain('nearestScrollOffset')
    expect(body).toContain('heldFocusEdge')
    expect(body).toContain('HeldFocusRefContext.Provider')
    expect(body).toContain('FocusedPressContext.Provider')
    expect(body).toContain('borderTopColor: lit')
    // densable QT: dialog/unmount clear via u3(null) on the light gate.
    expect(body).toContain('if (dialogOpen) focusPane(null)')
    expect(body).toContain(
      'prev !== null && shownId !== null && prev !== shownId',
    )
    expect(body).toContain('dockHostRef')
    expect(body).not.toContain('void paneHost')
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    // densable Mee: PluginPaneDockHost measures yoga then QT rows=hostRows.
    expect(src).toContain('export function PluginPaneDockHost')
    expect(src).toContain('rows={hostRows}')
    expect(src).not.toContain('rows={transcriptRows}')
    expect(repl).toContain('<PluginPaneDockHost')
    expect(repl).toContain('promptOwnsEscape={promptOwnsEscape}')
    expect(repl).toContain('pixelScroll={false}')
    // densable Ree/Mee offerPlacement from REPL hosts (not PluginPaneSite).
    expect(repl).toContain('offerPlacement')
    expect(repl).toContain('inlineHostOffered')
    expect(repl).toContain('dockHostOffered')
    expect(repl).toContain('inlineHostOffered ? offerPlacement()')
    expect(repl).toContain('dockHostOffered ? offerPlacement()')
    expect(repl).toContain('const dockHostOffered = pluginDockOffered > 0')
    expect(repl).not.toContain('const dockHostOffered = pluginDockWidth > 0')
    // densable Uh.usePaneToastHold() (FEe) next to dock/offer wiring.
    expect(src).toContain('export function usePaneToastHold')
    expect(src).toContain('paneHoldsToasts: true')
    expect(repl).toContain('usePaneToastHold()')
    // densable 2.1.289 gold `$.ui.toast: shown as` CLI host (non-stacksToasts).
    expect(repl).toContain('$.ui.toast: shown as')
    expect(repl).toContain('plugin-toast-${randomUUID()}')
    expect(repl).toContain('timeoutMs: toast.timeoutMs ?? 4000')
    expect(repl).toContain('${toast.plugin}: ${toast.text}')
    expect(repl).toContain("kind: 'event'")
    expect(src).toContain('nothing was drawn')
    expect(src).toContain(
      "ui.render (AbovePrompt): a plugin's tree threw while drawn",
    )
    const prompt = readFileSync(
      join(import.meta.dir, '../PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(prompt).toContain(
      'prompt.edit: hooked; the composer relays its edits to the chain',
    )
    expect(prompt).toContain(
      'prompt.edit: unhooked; the composer relays nothing',
    )
    const toasts = readFileSync(
      join(import.meta.dir, '../PromptInput/Notifications.tsx'),
      'utf8',
    )
    expect(toasts).toContain('ui.toast: the toast stack threw while drawn')
    expect(toasts).toContain('no toast is drawn until the stack changes')
    expect(body).not.toContain('isHeldNow: () => paneHeld')
    expect(body).not.toContain('local Ink has no subscribeClicks bus')
    // densable pee g$ isAhead: bn()!==N || Ln()!==eo || dn()!==hn
    expect(body).toContain('paneIsHeldNow() !== paneHeld')
    expect(body).toContain(
      'paneFocusIndexRef.current !== paneRenderedFocusIndex.current',
    )
    expect(body).toContain(
      'engineHeldRef.current !== paneRenderedEngineHeld.current',
    )
    expect(prompt).toContain('createPromptEditComposer')
    expect(prompt).toContain('setHooked(promptEditHooked)')
    expect(prompt).toContain('promptEditComposerRef.current?.record')
    const modules = readFileSync(
      join(import.meta.dir, '../../utils/plugins/functionHooksModules.ts'),
      'utf8',
    )
    expect(modules).toContain('export function createPromptEditComposer')
    expect(modules).toContain("the editor's edit stands")
    expect(modules).toContain(
      'a rewrite no longer fits the draft (it moved meanwhile)',
    )
    expect(body).not.toMatch(
      /\bexport\s+(?:const|function|let)\s+(?:lL|mee|ITt|zCe|u7t|yEe|pee|gEe|OMr|Jq|QFt|FEe|FFr|Pte)\b/,
    )
  })

  test('paneTitleChromeRows lL: title/spacer + inline round-border +2', () => {
    expect(paneTitleChromeRows(false, true)).toBe(1)
    expect(paneTitleChromeRows(true, true)).toBe(1)
    expect(paneTitleChromeRows(true, false)).toBe(3)
    expect(paneTitleChromeRows(false, false)).toBe(2)
  })

  test('paneWheelScroll pEe: preventDefault+stopPropagation, skip no-op', () => {
    const calls: Array<{ type: string }> = []
    const event = {
      deltaY: 1,
      localCol: 2,
      localRow: 3,
      preventDefault: () => calls.push({ type: 'prevent' }),
      stopPropagation: () => calls.push({ type: 'stop' }),
    }
    paneWheelScroll(event as never, {
      plugin: 'p',
      requestId: 'id',
      offset: 0,
      bodyRows: 4,
      contentRows: 4,
      maxOffset: 0,
      accel: initWheelAccel(false, 1, false, true),
    })
    expect(calls.map(c => c.type)).toEqual(['prevent', 'stop'])
    calls.length = 0
    paneWheelScroll({ ...event, deltaY: -1 } as never, {
      plugin: 'p',
      requestId: 'id',
      offset: 0,
      bodyRows: 4,
      contentRows: 10,
      maxOffset: 6,
      accel: initWheelAccel(false, 1, false, true),
    })
    expect(calls.map(c => c.type)).toEqual(['prevent', 'stop'])
  })

  test('paneWheelScroll FSp bounce-defer 0 does not lift to 1 row', () => {
    const accel = initWheelAccel(false, 1, false, true)
    const now = 1_000
    expect(computeWheelStep(accel, 1, now)).toBeGreaterThan(0)
    const bounce = initWheelAccel(false, 1, false, true)
    computeWheelStep(bounce, 1, now)
    expect(computeWheelStep(bounce, -1, now + 1)).toBe(0)
    const bounce2 = initWheelAccel(false, 1, false, true)
    computeWheelStep(bounce2, 1, now)
    const calls: Array<{ type: string }> = []
    paneWheelScroll(
      {
        deltaY: -1,
        localCol: 0,
        localRow: 0,
        preventDefault: () => calls.push({ type: 'prevent' }),
        stopPropagation: () => calls.push({ type: 'stop' }),
      } as never,
      {
        plugin: 'p',
        requestId: 'id',
        offset: 3,
        bodyRows: 4,
        contentRows: 10,
        maxOffset: 6,
        accel: bounce2,
        now: now + 1,
      },
    )
    expect(calls.map(c => c.type)).toEqual(['prevent', 'stop'])
  })
})

describe('densable 2.1.289 soft remainder xze / l$ / d$ / m$', () => {
  test('focusablesOfDrawing walks Button/Input/Select via press', () => {
    const tree = {
      type: 'Box',
      children: [
        {
          type: 'Button',
          press: { plugin: 'p', handle: 1 },
          props: { key: 'b1', autoFocus: true, label: 'Go' },
        },
        {
          type: 'Input',
          press: { plugin: 'p', handle: 2 },
          props: { key: 'i1', value: 'hi' },
        },
        {
          type: 'Select',
          press: { plugin: 'p', handle: 3 },
          props: {
            key: 's1',
            value: 'a',
            options: [{ value: 'a', label: 'A' }],
          },
        },
        { type: 'engine' },
        'text',
      ],
    }
    expect(focusablesOfDrawing(tree)).toEqual([
      {
        tag: 'Button',
        plugin: 'p',
        handle: 1,
        element: 'b1',
        isAutoFocus: true,
      },
      {
        tag: 'Input',
        plugin: 'p',
        handle: 2,
        element: 'i1',
        isAutoFocus: false,
        value: 'hi',
      },
      {
        tag: 'Select',
        plugin: 'p',
        handle: 3,
        element: 's1',
        isAutoFocus: false,
        value: 'a',
        options: [{ value: 'a', label: 'A' }],
      },
    ])
    expect(focusablesOfDrawing(undefined)).toEqual([])
    expect(focusablesOfDrawing({ type: 'engine' })).toEqual([])
  })

  test('bandRingHandlers cycles focus; Input press no-ops without submit; wires fields.submit', () => {
    const focusables = [
      ...focusablesOfDrawing({
        type: 'Button',
        press: { plugin: 'p', handle: 'h' },
        props: { key: 'b' },
      }),
      ...focusablesOfDrawing({
        type: 'Input',
        press: { plugin: 'p', handle: 'i' },
        props: { key: 'in', value: 'x' },
      }),
    ]
    let index: number | null = null
    const left: string[] = []
    const submitted: string[] = []
    const ringNoSubmit = bandRingHandlers({
      focusables,
      focusIndexNow: () => index,
      focusByPerson: next => {
        index = next
      },
      leave: () => {
        index = null
        left.push('leave')
      },
      // omit submit → Input press no-ops (does not invent a buffer)
    })
    ringNoSubmit['abovePrompt:next']()
    expect(index).toBe(0)
    ringNoSubmit['abovePrompt:next']()
    expect(index).toBe(1)
    ringNoSubmit['abovePrompt:previous']()
    expect(index).toBe(0)
    index = 1
    ringNoSubmit['abovePrompt:press']()
    expect(submitted).toEqual([])
    ringNoSubmit['abovePrompt:leave']()
    expect(index).toBe(null)
    expect(left).toEqual(['leave'])

    // densable: pass fields.submit into bandRingHandlers so AbovePrompt Input press lands.
    index = 1
    const ring = bandRingHandlers({
      focusables,
      focusIndexNow: () => index,
      focusByPerson: next => {
        index = next
      },
      leave: () => {
        index = null
      },
      submit: focusable => {
        submitted.push(
          `${focusable.plugin}:${String(focusable.element)}:${String(focusable.value ?? '')}`,
        )
      },
    })
    ring['abovePrompt:press']()
    expect(submitted).toEqual(['p:in:x'])
    expect(typeof ring['abovePrompt:press']).toBe('function')
  })

  test('wrapPluginFocusActs queues all but skip list (YHo)', () => {
    const acted: string[] = []
    const host = {
      act: (fn: () => void) => {
        acted.push('act')
        fn()
      },
    }
    const wrapped = wrapPluginFocusActs(
      host,
      {
        'abovePrompt:next': () => acted.push('next'),
        'abovePrompt:leave': () => acted.push('leave'),
      },
      ['abovePrompt:leave'],
    )
    wrapped['abovePrompt:next']()
    wrapped['abovePrompt:leave']()
    expect(acted).toEqual(['act', 'next', 'leave'])
  })

  test('clickFocusByPress maps plugin+handle onto ring index (c$)', () => {
    const focusables = focusablesOfDrawing({
      type: 'Button',
      press: { plugin: 'p', handle: 'h2' },
      props: { key: 'b' },
    })
    const hits: number[] = []
    const click = clickFocusByPress(focusables, index => hits.push(index))
    click({ plugin: 'p', handle: 'h2' })
    click({ plugin: 'ghost', handle: 'h2' })
    expect(hits).toEqual([0])
  })

  test('extendPaneRingWithCloseMark tabCount=0 last slot is close (aee)', () => {
    const focusables = focusablesOfDrawing({
      type: 'Button',
      press: { plugin: 'p', handle: 'h' },
      props: { key: 'b' },
    })
    let index: number | null = 0
    let engine: number | null = null
    const closed: string[] = []
    const ring = bandRingHandlers({
      focusables,
      focusIndexNow: () => index,
      focusByPerson: next => {
        index = next
      },
      leave: () => {
        index = null
      },
    })
    const extended = extendPaneRingWithCloseMark({
      ring,
      focusablesCount: 1,
      focusIndexNow: () => index,
      engineHeldNow: () => engine,
      holdEngine: next => {
        engine = next
      },
      setIndex: next => {
        index = next
      },
      moveByPerson: move => move.apply(),
      leave: () => {
        index = null
        engine = null
      },
      close: () => closed.push('close'),
    })
    extended['abovePrompt:next']()
    expect(index).toBeNull()
    expect(engine).toBe(0)
    extended['abovePrompt:press']()
    expect(closed).toEqual(['close'])
    extended['abovePrompt:next']()
    expect(index).toBe(0)
    expect(engine).toBeNull()
  })

  test('extendPaneRingWithCloseMark tabCount>0 press picks other pane (aee ze)', () => {
    const focusables = focusablesOfDrawing({
      type: 'Button',
      press: { plugin: 'p', handle: 'h' },
      props: { key: 'b' },
    })
    let index: number | null = 0
    let engine: number | null = null
    const picked: string[] = []
    const closed: string[] = []
    const ring = bandRingHandlers({
      focusables,
      focusIndexNow: () => index,
      focusByPerson: next => {
        index = next
      },
      leave: () => {
        index = null
      },
    })
    const extended = extendPaneRingWithCloseMark({
      ring,
      focusablesCount: 1,
      focusIndexNow: () => index,
      engineHeldNow: () => engine,
      holdEngine: next => {
        engine = next
      },
      setIndex: next => {
        index = next
      },
      moveByPerson: move => move.apply(),
      leave: () => {
        index = null
        engine = null
      },
      close: () => closed.push('close'),
      tabs: [{ id: 'other' }],
      pick: id => picked.push(id),
    })
    extended['abovePrompt:next']()
    expect(index).toBeNull()
    expect(engine).toBe(0)
    extended['abovePrompt:press']()
    expect(picked).toEqual(['other'])
    expect(closed).toEqual([])
    extended['abovePrompt:next']()
    expect(engine).toBe(1)
    extended['abovePrompt:press']()
    expect(closed).toEqual(['close'])
  })

  test('titleTabColumns UM + titleStripStart w$', () => {
    expect(titleTabColumns('A')).toBe(3)
    expect(titleTabColumns('abcdefghijklmnop')).toBe(12)
    const open = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ]
    expect(titleStripStart({ open, shownId: 'a', columns: 80 })).toBe(0)
    expect(titleStripStart({ open, shownId: 'c', columns: 80 })).toBe(0)
    expect(titleStripStart({ open, shownId: 'c', columns: 4 })).toBe(2)
  })

  test('hotkeyMapOfDrawing r$ + resolveHotkeyPresses HZ', () => {
    const tree = {
      type: 'Box',
      children: [
        {
          type: 'Button',
          press: { plugin: 'p', handle: 'h' },
          props: { key: 'b', hotkey: 'g', label: 'Go' },
        },
        { type: 'engine' },
      ],
    }
    const seats = hotkeyMapOfDrawing(tree)
    expect(seats.get('g')).toEqual({ plugin: 'p', handle: 'h' })
    const key = {
      ctrl: false,
      meta: false,
      super: false,
      escape: false,
      tab: false,
      return: false,
    } as never
    expect(resolveHotkeyPresses('g', key, seats)).toEqual([
      { plugin: 'p', handle: 'h' },
    ])
    expect(resolveHotkeyPresses('G', key, seats)).toEqual([
      { plugin: 'p', handle: 'h' },
    ])
    expect(resolveHotkeyPresses('x', key, seats)).toEqual([])
    expect(
      resolveHotkeyPresses('g', { ...key, ctrl: true } as never, seats),
    ).toEqual([])
  })

  test('m$/BDe/pluginInputPressEvent densable Input field Map API', () => {
    expect(pluginInputFieldKey('plug', 'el')).toBe('plug\0el')
    expect(typeof pluginInputPressEvent).toBe('function')
    const texts = new Map<string, string>()
    const live = { current: new Map<string, string>() }
    const submitting = { current: new Set<string>() }
    const api = createPluginInputMap(undefined, 'AbovePrompt', 'band', {
      texts,
      setTexts: updater => {
        const next = updater(texts)
        texts.clear()
        for (const [k, v] of next) texts.set(k, v)
      },
      live,
      submitting,
    })
    expect(api.fields.textOf('p', 'e')).toBeUndefined()
    // Seed host Map directly — edit/submit call pluginInputPressEvent→invokePress (needs held handler).
    const key = pluginInputFieldKey('p', 'e')
    live.current.set(key, 'hi')
    texts.set(key, 'hi')
    expect(api.textNow({ plugin: 'p', element: 'e' })).toBe('hi')
    expect(api.fields.textOf('p', 'e')).toBe('hi')
    expect(typeof api.fields.edit).toBe('function')
    expect(typeof api.submit).toBe('function')
  })

  test('settledBudget store get/set/subscribe mirrors bandCollapsed', () => {
    setSettledBudget(undefined)
    expect(getSettledBudget()).toBeUndefined()
    let ticks = 0
    const unsub = subscribeSettledBudget(() => {
      ticks += 1
    })
    setSettledBudget(12)
    expect(getSettledBudget()).toBe(12)
    setSettledBudget(12)
    setSettledBudget(20)
    expect(getSettledBudget()).toBe(20)
    expect(ticks).toBe(2)
    unsub()
    setSettledBudget(undefined)
  })

  test('PluginAbovePromptSite wires xze/l$/d$/m$ and Chat abovePrompt:focus', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain('export function focusablesOfDrawing')
    expect(src).toContain('export function bandRingHandlers')
    expect(src).toContain('export function getSettledBudget')
    expect(src).toContain('export function setSettledBudget')
    expect(src).toContain('export function subscribeSettledBudget')
    expect(src).toContain('export function createPluginInputMap')
    expect(src).toContain('export function pluginInputFieldKey')
    expect(src).toContain('export function pluginInputPressEvent')
    expect(src).toContain('Soft remainder `l$`/`xze`/`d$`/`m$` HAVE')
    expect(src).toContain('focusablesOfDrawing(drawn)')
    expect(src).toContain('bandRingHandlers({')
    expect(src).toContain('bandInputRef.current?.submit')
    expect(src).toContain("useRegisterKeybindingContext('AbovePromptInput'")
    expect(src).toContain("useRegisterKeybindingContext('AbovePromptSelect'")
    expect(src).toContain('abovePrompt:next')
    expect(src).toContain('abovePrompt:previous')
    expect(src).toContain('abovePrompt:press')
    expect(src).toContain('abovePrompt:leave')
    expect(src).toContain('bandInputFocusHost')
    expect(src).toContain("'abovePrompt:focus'")
    expect(src).toContain('settlePaneFocusRequest')
    // densable u$ on AbovePrompt — Button hotkeys while ring (not Input/Select).
    const above = src.slice(
      src.indexOf('export function PluginAbovePromptSite'),
    )
    expect(above).toContain('hotkeyMapOfDrawing(drawn)')
    expect(above).toContain('resolveHotkeyPresses(input, key, bandHotkeys)')
    expect(above).toContain(
      'ringActive && !inputFocused && !selectFocused && bandHotkeys.size > 0',
    )
    // semantic panes helpers; m$ exported densable-shaped
    expect(src).toContain('getPanesState')
    expect(src).toContain('export function createPluginInputMap')
    // tip-additive effortSlider must survive soft remainder
    const schema = readFileSync(SCHEMA, 'utf8')
    const defaults = readFileSync(DEFAULTS, 'utf8')
    expect(schema).toContain("'effortSlider:toggleUltracode'")
    expect(defaults).toContain("tab: 'effortSlider:toggleUltracode'")
  })
})

describe('densable 2.1.289 y$ select highlight / selectKeys', () => {
  test('exports qZ selectHighlightHandlers and y$.intercept selectKeysIntercept', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain('export function selectHighlightHandlers')
    expect(src).toContain('export function selectKeysIntercept')
    expect(src).toContain('export function usePluginSelectSeat')
    expect(src).toContain('export function resetPluginSelectSeat')
    expect(src).toContain('`y$` HAVE')
    expect(src).toContain('`g$` HAVE')
    expect(src).toContain('DualInk `onPointer` HAVE')
    expect(src).toContain('press: () => void')
    expect(src).toContain('function landBandInputFocus')
    expect(src).toContain('closed Select opens on move')
    expect(src).toContain('onPointer={event => {')
    expect(src).toContain(
      'onPointer: (event: MouseActionEvent) => firePointer(pluginClientPointerKind(event.type), event)',
    )
  })

  test('selectHighlightHandlers mirrors gold qZ move/press shape', () => {
    const moves: number[] = []
    let presses = 0
    const handlers = selectHighlightHandlers({
      move: delta => {
        moves.push(delta)
      },
      press: () => {
        presses += 1
      },
    })
    handlers['abovePrompt:highlightNext']()
    handlers['abovePrompt:highlightPrevious']()
    handlers['abovePrompt:press']()
    expect(moves).toEqual([1, -1])
    expect(presses).toBe(1)
  })

  test('selectKeysIntercept handles typeahead and ctrl-c close/unfocus', () => {
    const baseKey = {
      ctrl: false,
      meta: false,
      super: false,
      escape: false,
      tab: false,
      return: false,
      leftArrow: false,
      rightArrow: false,
      upArrow: false,
      downArrow: false,
      home: false,
      end: false,
      delete: false,
      pageUp: false,
      pageDown: false,
      backspace: false,
      wheelUp: false,
      wheelDown: false,
    }
    const closed: string[] = []
    const unfocused: string[] = []
    const typed: string[] = []
    const select = {
      focusedSelect: {
        plugin: 'p',
        handle: 1,
        element: 's1',
        options: [{ value: 'alpha', label: 'Alpha' }],
      },
      open: null as null | {
        plugin: string
        handle: unknown
        highlight: number
        element: string
        options: Array<{ value: string; label?: string }>
      },
      close: () => {
        closed.push('close')
      },
      unfocus: () => {
        unfocused.push('unfocus')
      },
      typeahead: (letter: string) => {
        typed.push(letter)
      },
    }
    expect(selectKeysIntercept('a', baseKey as never, select)).toBe(true)
    expect(typed).toEqual(['a'])
    expect(
      selectKeysIntercept('c', { ...baseKey, ctrl: true } as never, select),
    ).toBe(true)
    expect(unfocused).toEqual(['unfocus'])
    select.open = {
      plugin: 'p',
      handle: 1,
      highlight: 0,
      element: 's1',
      options: [{ value: 'alpha', label: 'Alpha' }],
    }
    expect(
      selectKeysIntercept('c', { ...baseKey, ctrl: true } as never, select),
    ).toBe(true)
    expect(closed).toEqual(['close'])
    expect(
      selectKeysIntercept('c', { ...baseKey, ctrl: true } as never, select, {
        working: true,
      }),
    ).toBe(false)
  })

  test('AbovePromptSelect registers highlight* + press via selectHighlightHandlers', () => {
    const src = readFileSync(PANES, 'utf8')
    const defaults = readFileSync(DEFAULTS, 'utf8')
    const schema = readFileSync(SCHEMA, 'utf8')
    expect(src).toContain("bandSelect.handlers['abovePrompt:highlightNext']")
    expect(src).toContain(
      "bandSelect.handlers['abovePrompt:highlightPrevious']",
    )
    expect(src).toContain("bandSelect.handlers['abovePrompt:press']")
    expect(src).toContain("context: 'AbovePromptSelect'")
    expect(src).toContain('bandSelect.intercept(input, key')
    expect(src).toContain('export function selectKeysIntercept')
    expect(defaults).toContain("down: 'abovePrompt:highlightNext'")
    expect(defaults).toContain("up: 'abovePrompt:highlightPrevious'")
    expect(schema).toContain("'abovePrompt:highlightNext'")
    expect(schema).toContain("'abovePrompt:highlightPrevious'")
    // tip-additive effortSlider must survive y$ land
    expect(schema).toContain("'effortSlider:toggleUltracode'")
    expect(defaults).toContain("tab: 'effortSlider:toggleUltracode'")
  })

  test('resetPluginSelectSeat is gold Kt identity: Select opens, none closes', () => {
    const picked = new Map([[pluginInputFieldKey('p', 's1'), 'b']])
    expect(resetPluginSelectSeat(null, picked)).toEqual({
      key: null,
      isOpen: false,
      highlight: 0,
    })
    expect(
      resetPluginSelectSeat(
        {
          plugin: 'p',
          handle: 1,
          element: 's1',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
        picked,
      ),
    ).toEqual({
      key: pluginInputFieldKey('p', 's1'),
      isOpen: true,
      highlight: 1,
    })
  })
})

describe('densable 2.1.289 g$ key intercept on PluginAbovePromptSite', () => {
  test('exports pluginBandKeys / usePluginBandKeys / focusableAt and wires site bag', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain('export function pluginBandKeys')
    expect(src).toContain('export function usePluginBandKeys')
    expect(src).toContain('export function focusableAt')
    expect(src).toContain('`g$` HAVE')
    expect(src).toContain(
      'isAhead: () => focusIndexRef.current !== renderedFocusIndex.current',
    )
    expect(src).toContain('handlers: {')
    expect(src).toContain('AbovePrompt:')
    expect(src).toContain('AbovePromptInput:')
    expect(src).toContain('AbovePromptSelect:')
    expect(src).toContain(
      'selectKeys: (input, key) => bandSelect.intercept(input, key)',
    )
    expect(src).toContain('textNow: bandInput.textNow')
    expect(src).toContain('fields: bandInput.fields')
    expect(src).toContain('usePluginBandKeys(bandKeysBag')
    expect(src).toContain('sb(fr.intercept,{isActive:Os})')
    expect(src).toContain('settlePaneFocusRequest')
    // tip-additive effortSlider must survive g$ land
    const schema = readFileSync(SCHEMA, 'utf8')
    const defaults = readFileSync(DEFAULTS, 'utf8')
    expect(schema).toContain("'effortSlider:toggleUltracode'")
    expect(defaults).toContain("tab: 'effortSlider:toggleUltracode'")
  })

  test('focusableAt mirrors densable Ode', () => {
    const list = focusablesOfDrawing({
      type: 'Button',
      press: { plugin: 'p', handle: 1 },
      props: { key: 'b1' },
    })
    expect(focusableAt(list, 0)?.element).toBe('b1')
    expect(focusableAt(list, null)).toBe(null)
    expect(focusableAt(list, 3)).toBe(null)
  })

  test('pluginBandKeys runs handler bag when ahead and resolve matches', () => {
    const ran: string[] = []
    const key = {
      ctrl: false,
      meta: false,
      super: false,
      escape: false,
      tab: false,
      return: false,
      leftArrow: false,
      rightArrow: false,
      upArrow: false,
      downArrow: false,
      home: false,
      end: false,
      delete: false,
      pageUp: false,
      pageDown: false,
      backspace: false,
      wheelUp: false,
      wheelDown: false,
    }
    const consume = pluginBandKeys(
      {
        isAhead: () => true,
        contextNow: () => 'AbovePrompt',
        focusedNow: () => null,
        contextRendered: () => 'AbovePrompt',
        focusedRendered: () => null,
        handlers: {
          AbovePrompt: {
            'abovePrompt:next': () => {
              ran.push('next')
            },
          },
        },
        selectKeys: () => false,
      },
      (_input, _key, contexts) =>
        contexts[0] === 'AbovePrompt'
          ? { type: 'match', action: 'abovePrompt:next' }
          : { type: 'none' },
    )
    expect(consume('', key as never, '')).toBe(true)
    expect(ran).toEqual(['next'])
  })

  test('pluginBandKeys does not steal when !isAhead', () => {
    const consume = pluginBandKeys(
      {
        isAhead: () => false,
        contextNow: () => 'AbovePrompt',
        focusedNow: () => null,
        contextRendered: () => 'AbovePrompt',
        focusedRendered: () => null,
        handlers: {
          AbovePrompt: {
            'abovePrompt:next': () => undefined,
          },
        },
        selectKeys: () => false,
      },
      () => ({ type: 'match', action: 'abovePrompt:next' }),
    )
    expect(
      consume(
        '',
        {
          ctrl: false,
          meta: false,
          super: false,
          escape: false,
          tab: false,
          return: false,
          leftArrow: false,
          rightArrow: false,
          upArrow: false,
          downArrow: false,
          home: false,
          end: false,
          delete: false,
          pageUp: false,
          pageDown: false,
          backspace: false,
          wheelUp: false,
          wheelDown: false,
        } as never,
        '',
      ),
    ).toBe(false)
  })
})

describe('densable 2.1.289 Si panes semantic store (EMPTY_PANES-shaped)', () => {
  const FH = join(
    import.meta.dir,
    '../../utils/plugins/functionHooksModules.ts',
  )

  test('abovePrompt:focus gold order: $Fr cycle → band step → open[0]; never a4n(true); keeps effortSlider', () => {
    const src = readFileSync(PANES, 'utf8')
    const defaults = readFileSync(DEFAULTS, 'utf8')
    const schema = readFileSync(SCHEMA, 'utf8')
    // a4n mount/auto-settle still present; key must not invent settle-first.
    expect(src).toContain('settlePaneFocusRequest')
    expect(src).not.toMatch(
      /focusRequest !== null\) \{\s*settlePaneFocusRequest\(true\)/,
    )
    expect(src).toContain('getPanesState')
    expect(src).toContain('focusPane(nextFocusedPaneId(panes))')
    expect(src).toContain('panes.focusedId !== null')
    expect(src).toContain('panes.open.length > 0')
    expect(src).toContain(
      'nextBandFocus({ focus: focusIndex, count: focusables.length })',
    )
    expect(src).toContain(
      'nextBandFocus({ focus: null, count: focusables.length })',
    )
    expect(src).toContain("'abovePrompt:focus'")
    expect(src).toContain('EMPTY_PANES')
    expect(src).toContain('placeWaitingPanesRemote')
    expect(src).toContain('settlePanesTerminalColumns')
    expect(src).not.toMatch(/\bexport\s+(?:const|function|let)\s+Si\b/)
    expect(src).not.toMatch(/\bexport\s+(?:const|function|let)\s+panesStore\b/)
    expect(defaults).toContain("'ctrl+x tab': 'abovePrompt:focus'")
    expect(schema).toContain("'abovePrompt:focus'")
    // tip-additive effortSlider must survive Si store land
    expect(schema).toContain("'effortSlider:toggleUltracode'")
    expect(defaults).toContain("tab: 'effortSlider:toggleUltracode'")
  })

  test('functionHooksModules exports EMPTY_PANES-shaped store + helpers (no Si/panesStore minify)', () => {
    const fh = readFileSync(FH, 'utf8')
    expect(fh).toContain('export const EMPTY_PANES')
    expect(fh).toContain('export function getPanesState')
    expect(fh).toContain('export function getPanesStore')
    expect(fh).toContain('export function setPanesState')
    expect(fh).toContain('export function subscribePanes')
    expect(fh).toContain('export function focusPane')
    expect(fh).toContain('export function nextFocusedPaneId')
    expect(fh).toContain('export function offerPlacement')
    expect(fh).toContain('export const offerPanePlacement')
    expect(fh).toContain('export function settleFocusRequest')
    expect(fh).toContain('export const settlePaneFocusRequest')
    expect(fh).toContain('export function showPane')
    expect(fh).toContain('export const PANE_OPEN_FLOOR_ASKED')
    expect(fh).toContain('export const PANE_OPEN_FLOOR_DEFAULT')
    expect(fh).toContain('export function paneOpenFloor')
    expect(fh).toContain('export function hasAskedPane')
    expect(fh).toContain('export function placeWaitingPanes')
    expect(fh).toContain('export function placeWaitingPanesRemote')
    expect(fh).toContain('export function rememberAskedPane')
    expect(fh).toContain('export function forgetAskedPane')
    expect(fh).toContain('export function seedAskedPanes')
    expect(fh).toContain('export function settlePanesTerminalColumns')
    expect(fh).toContain('shownId: null')
    expect(fh).toContain('focusedId: null')
    expect(fh).toContain('focusRequest: null')
    expect(fh).toContain('placements: 0')
    expect(fh).toContain('const paneOpenIds = new Set<string>()')
    expect(fh).toContain('let shownPaneId: string | null = null')
    expect(fh).toContain('let focusedPaneId: string | null = null')
    expect(fh).toContain('const paneClosing = new Set<string>()')
    expect(fh).toContain('input.focus === true')
    expect(fh).not.toMatch(/\bexport\s+(?:const|function|let)\s+Si\b/)
    expect(fh).not.toMatch(/\bexport\s+(?:const|function|let)\s+panesStore\b/)
    expect(fh).not.toMatch(
      /\bexport\s+(?:const|function|let|class)\s+askedLatch\b/,
    )
    expect(fh).not.toMatch(/\bexport\s+function\s+placeWaitingRemote\b/)
    expect(fh).not.toMatch(/\bexport\s+function\s+oNo\b/)
    expect(fh).not.toMatch(/\bexport\s+function\s+i4n\b/)
    expect(fh).not.toMatch(/\bnew\s+WeakSet\b/)
    // leave dialogStore.open alone — no minify Ide/Hde/QLt person-registry export
    expect(fh).not.toContain('dialogStore.open')
    expect(fh).not.toMatch(/\bexport\s+(?:const|function|let|class)\s+Ide\b/)
    expect(fh).not.toMatch(/\bexport\s+(?:const|function|let|class)\s+Hde\b/)
    expect(fh).not.toMatch(/\bexport\s+(?:const|function|let|class)\s+QLt\b/)
    // Hde/`QLt` HAVE as semantic helpers; iZ via runFunctionHookChain('ui.scroll').
    expect(fh).toContain('export function logUiScrollSettled')
    expect(fh).toContain('export function commitPluginScrollSite')
    expect(fh).toContain('export function dispatchPersonUiScroll')
    expect(fh).toContain("runFunctionHookChain('ui.scroll'")
    expect(fh).toContain('isForeignPluginScrollOrigin')
    // person/plugin vq success bumps raster so Pane marginTop={-offset} re-renders
    // (gold yEe local Me; local scrollPluginPane already bumped).
    expect(fh).toContain('bumpRasterFrames()')
    const personVq = fh.slice(
      fh.indexOf('export function dispatchPersonUiScroll'),
      fh.indexOf('export function dispatchPersonUiScroll') + 1800,
    )
    expect(personVq).toContain('bumpRasterFrames()')
  })
})

describe('densable 2.1.289 o$ SEe / FZ / _Ee Ie(null) polarity', () => {
  test('teammateViewId matches gold h_e id (local_agent vs resumable teammate)', () => {
    expect(teammateViewId({ type: 'local_agent', agentId: 'local-1' })).toBe(
      'local-1',
    )
    expect(
      teammateViewId({
        type: 'in_process_teammate',
        identity: { agentId: 'live', resumableAgentId: 'resume' },
      }),
    ).toBe('resume')
    expect(
      teammateViewId({
        type: 'in_process_teammate',
        identity: { agentId: 'live' },
      }),
    ).toBe('live')
    expect(teammateViewId({ type: 'other' })).toBeUndefined()
  })

  test('isOtherDrawer is gold FZ (both nonempty, no shared plugin)', () => {
    expect(isOtherDrawer([], [{ plugin: 'a' }])).toBe(false)
    expect(isOtherDrawer([{ plugin: 'a' }], [{ plugin: 'a' }])).toBe(false)
    expect(isOtherDrawer([{ plugin: 'a' }], [{ plugin: 'b' }])).toBe(true)
  })
})

describe('densable 2.1.289 PluginClient oo / ro', () => {
  test('pluginClientKeyFromInput mirrors gold ro', () => {
    const base = {
      ctrl: false,
      meta: false,
      super: false,
      escape: false,
      tab: false,
      return: false,
      leftArrow: false,
      rightArrow: false,
      upArrow: false,
      downArrow: false,
      home: false,
      end: false,
      delete: false,
      pageUp: false,
      pageDown: false,
      backspace: false,
      wheelUp: false,
      wheelDown: false,
      shift: false,
      fn: false,
    }
    expect(pluginClientKeyFromInput('g', base as never)).toEqual({ key: 'g' })
    expect(pluginClientKeyFromInput(' ', base as never)).toEqual({
      key: 'space',
    })
    expect(pluginClientKeyFromInput('', base as never)).toBeUndefined()
    expect(
      pluginClientKeyFromInput('x', { ...base, upArrow: true } as never),
    ).toEqual({ key: 'up' })
    expect(
      pluginClientKeyFromInput('c', { ...base, ctrl: true } as never),
    ).toEqual({ key: 'c', ctrl: true })
    expect(
      pluginClientKeyFromInput('x', { ...base, wheelUp: true } as never),
    ).toBeUndefined()
  })

  test('PluginClient wires gold oo pointer-down DQt and sb keys', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain("kind === 'down' && live.acceptsKeys()")
    expect(src).toContain('live.key(mapped)')
    expect(src).toContain('live.pointer({')
    expect(src).toContain('onPointer:')
    expect(src).toContain('export function PluginPaneDockHost')
    expect(src).toContain('instanceRef.current.laidOut()')
    expect(src).toContain('instanceRef.current.drawnAgain()')
    expect(src).toContain('instanceRef.current.threw(error)')
    expect(src).toContain('drawn={props}')
    expect(src).toContain('}, [drawn])')
    expect(src).toContain('height: rows')
    expect(src).toContain('retainFinePointer()')
    expect(src).toContain('usePaneClickAway(bandClickAway)')
    expect(src).toContain('measureElement(node)')
    expect(src).toContain(
      'instanceRef.current.resize(measuredWidth, measuredHeight)',
    )
    expect(src).toContain('pluginClientPointerButton(event?.button)')
    expect(src).not.toContain('box?.width')
    expect(src).not.toContain('[width, height, snapshot]')
  })

  test('pluginClientPointerButton is gold eo 0/1/2 plus SGR mask', () => {
    expect(pluginClientPointerButton(undefined)).toBeUndefined()
    expect(pluginClientPointerButton(0)).toBe('left')
    expect(pluginClientPointerButton(1)).toBe('middle')
    expect(pluginClientPointerButton(2)).toBe('right')
    expect(pluginClientPointerButton(3)).toBeUndefined()
    expect(pluginClientPointerButton(0x04)).toBe('left')
    expect(pluginClientPointerButton(0x05)).toBe('middle')
  })
})

describe('densable 2.1.289 kL/yL/$l/g$ wrap', () => {
  test('PluginRasterPanes wires kL seats, yL prune, $l subscribeLayout, pee g$', () => {
    const src = readFileSync(PANES, 'utf8')
    expect(src).toContain(
      'export { pluginFieldSeatKey, pluginFieldSeatGeneration, bumpPluginFieldSeatGeneration }',
    )
    expect(src).toContain('export function usePluginFieldSeatMap')
    expect(src).toContain('export function usePluginFieldValuePrune')
    expect(src).toContain('export function useYogaMeasure')
    expect(src).toContain('export function usePluginInputSeat')
    expect(src).toContain("usePluginFieldSeatMap('input'")
    expect(src).toContain("usePluginFieldSeatMap('select'")
    expect(src).toContain("usePluginFieldValuePrune(focusables, 'Input'")
    expect(src).toContain("usePluginFieldValuePrune(focusables, 'Select'")
    expect(src).toContain('const { subscribeLayout } = useApp()')
    expect(src).toContain('useSyncExternalStore(subscribeLayout, read, read)')
    expect(src).toContain('if (!Object.is(read(), snapshot)) bump()')
    expect(src).toContain(
      'useYogaMeasure(() => measurePluginClientBox(boxRef.current).width)',
    )
    expect(src).toContain(
      'useYogaMeasure(() => measurePluginClientBox(hostRef.current).height)',
    )
    expect(src).toContain(
      'usePluginBandKeys(paneKeysBag, { isActive: paneHeld })',
    )
    expect(src).toContain('paneSelect')
    expect(src).toContain('...paneSelect.handlers')
    expect(src).toContain('paneSelect.intercept(input, key)')
    expect(src).toContain('textNow: paneInput.textNow')
    expect(src).toContain('fields: paneInput.fields')
    expect(src).toContain('working: isWorking')
    expect(src).not.toContain('export function KFt')
    expect(src).not.toContain('export function YFt')
    expect(src).not.toContain('export function $l')
  })

  test('pluginFieldSeatKey is gold sft component NUL requestId', async () => {
    const {
      pluginFieldSeatKey,
      bumpPluginFieldSeatGeneration,
      pluginFieldSeatGeneration,
    } = await import('../PluginRasterPanes.js')
    expect(pluginFieldSeatKey('AbovePrompt', 'above-prompt')).toBe(
      'AbovePrompt\0above-prompt',
    )
    const before = pluginFieldSeatGeneration('Pane', 'p1')
    bumpPluginFieldSeatGeneration('Pane', 'p1')
    expect(pluginFieldSeatGeneration('Pane', 'p1')).toBe(before + 1)
  })
})

describe('densable 2.1.289 NLe/DQt client mutex store', () => {
  test('DQt sets and hSo clears only the current id', async () => {
    const {
      getPluginClientFocusedId,
      setPluginClientFocusedId,
      clearPluginClientFocusedId,
    } = await import('../PluginRasterPanes.js')
    setPluginClientFocusedId(null)
    setPluginClientFocusedId('a')
    expect(getPluginClientFocusedId()).toBe('a')
    clearPluginClientFocusedId('b')
    expect(getPluginClientFocusedId()).toBe('a')
    clearPluginClientFocusedId('a')
    expect(getPluginClientFocusedId()).toBe(null)
  })
})
