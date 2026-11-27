import {
  useInput,
  useOptionalKeybindingContext,
  type Key,
} from '@anthropic/ink'
import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  bindPluginFocusHost,
  dispatchPersonUiScroll,
  dispatchUiFocus,
  logUiScrollSettled,
  getPluginScrollSite,
  getRasterFrameVersion,
  subscribeRasterFrames,
} from '../../utils/plugins/functionHooksModules.js'
import {
  BAND_REQUEST_ID,
  type DrawingFocusable,
  type PluginBandKeysBag,
  type PluginBandResolve,
  type PluginSelectFocusable,
  type PluginSelectSeatState,
  type SelectOpen,
  firePress,
  firePressAnswer,
  floorOffset,
  focusableAt,
  pluginInputFieldKey,
  pluginInputIsNav,
  pluginInputIsTyped,
  pluginSelectTypeahead,
  pluginSelectTypeaheadNext,
  resetPluginSelectSeat,
  selectFocusableAt,
  selectSeatKeyOf,
} from './drawingHelpers.js'
import {
  deleteSeatKeys,
  usePluginFieldSeatMap,
  usePluginFieldValuePrune,
} from './sessionStores.js'

/**
 * densable `yEe` lite — offset / followEnd / scrollBy (in-flight queue) / place.
 * Ide HAVE: PluginAbovePromptSite syncs dims into `pluginSites` via
 * `registerPluginScrollSite` / `updatePluginScrollSite` (no minify Ide export).
 * Hde/`QLt` person-origin HAVE: `fireScroll`/`commit` void
 * `dispatchPersonUiScroll` → `runFunctionHookChain('ui.scroll')` when the
 * scroll site is registered (Pane or AbovePrompt). Keep sync drain;
 * await in background.
 */
export function useBandScrollPlace(input: {
  bodyRows: number
  contentRows: number
  maxOffset: number
  plugin?: string
  requestId?: string
  component?: 'Pane' | 'AbovePrompt'
}): {
  offset: number
  placed: number
  followEnd: boolean
  scrollBy: (delta: number, pointer?: { column: number; row: number }) => void
  place: (fn: (prev: number) => number) => void
  commit: (next: number) => void
  followEndOn: () => void
} {
  const [placed, setPlaced] = useState(0)
  const [followEnd, setFollowEnd] = useState(false)
  const dims = useRef({
    bodyRows: input.bodyRows,
    contentRows: input.contentRows,
    maxOffset: input.maxOffset,
  })
  const placedRef = useRef(placed)
  const followEndRef = useRef(followEnd)
  const inFlightRef = useRef(false)
  const queuedDeltaRef = useRef(0)
  const queuedPointerRef = useRef<{ column: number; row: number } | undefined>(
    undefined,
  )
  // densable yEe Kt — skip finally drain after unmount.
  const aliveRef = useRef(true)
  const personScrollRef = useRef({
    plugin: input.plugin ?? '',
    requestId: input.requestId ?? BAND_REQUEST_ID,
    component: input.component ?? 'AbovePrompt',
  })
  dims.current = {
    bodyRows: input.bodyRows,
    contentRows: input.contentRows,
    maxOffset: input.maxOffset,
  }
  placedRef.current = placed
  followEndRef.current = followEnd
  personScrollRef.current = {
    plugin: input.plugin ?? '',
    requestId: input.requestId ?? BAND_REQUEST_ID,
    component: input.component ?? 'AbovePrompt',
  }
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  const clamp = (n: number): number =>
    Math.max(0, Math.min(dims.current.maxOffset, floorOffset(n)))
  const liveOffset = (): number =>
    followEndRef.current
      ? dims.current.maxOffset
      : Math.min(placedRef.current, dims.current.maxOffset)
  const offset = followEnd
    ? dims.current.maxOffset
    : Math.min(placed, dims.current.maxOffset)
  useEffect(() => {
    if (followEnd && placed !== dims.current.maxOffset) {
      setPlaced(dims.current.maxOffset)
    }
  }, [followEnd, input.maxOffset, placed])
  // densable raster bump — ui.scroll / follow-end write the site, then
  // bumpRasterFrames. Paint reads React offset, so adopt the site here.
  const rasterFrame = useSyncExternalStore(
    subscribeRasterFrames,
    getRasterFrameVersion,
    getRasterFrameVersion,
  )
  useEffect(() => {
    const siteMeta = personScrollRef.current
    if (siteMeta.plugin === '' || siteMeta.requestId === '') return
    const site = getPluginScrollSite(
      siteMeta.plugin,
      siteMeta.requestId,
      siteMeta.component,
    )
    if (site === undefined) return
    // Person scroll still in flight: do not pull React back to a stale site.offset.
    if (inFlightRef.current) return
    if (site.followEnd) {
      const pinned = Math.max(0, dims.current.maxOffset)
      if (!followEndRef.current || placedRef.current !== pinned) {
        followEndRef.current = true
        placedRef.current = pinned
        setFollowEnd(true)
        setPlaced(pinned)
      }
      return
    }
    if (followEndRef.current || placedRef.current !== site.offset) {
      followEndRef.current = false
      placedRef.current = site.offset
      setFollowEnd(false)
      setPlaced(site.offset)
    }
  }, [rasterFrame])
  const dispatchPersonIfRegistered = (
    nextOffset: number,
    by: number,
    pointer?: { column: number; row: number },
  ): Promise<void> => {
    const siteMeta = personScrollRef.current
    // densable yEe commits for Pane + AbovePrompt once Ide site is registered.
    if (siteMeta.plugin === '' || siteMeta.requestId === '')
      return Promise.resolve()
    if (
      getPluginScrollSite(
        siteMeta.plugin,
        siteMeta.requestId,
        siteMeta.component,
      ) === undefined
    ) {
      return Promise.resolve()
    }
    // densable `Hde(\`ui.scroll …\`, QLt(...))` — await settles inFlight.
    return dispatchPersonUiScroll({
      component: siteMeta.component,
      requestId: siteMeta.requestId,
      offset: nextOffset,
      by,
      bodyRows: dims.current.bodyRows,
      contentRows: dims.current.contentRows,
      plugin: siteMeta.plugin,
      ...(pointer !== undefined && { pointer }),
    }).then(() => undefined)
  }
  const commit = useCallback((next: number): number => {
    const before = liveOffset()
    const clamped = clamp(next)
    followEndRef.current = false
    placedRef.current = clamped
    setFollowEnd(false)
    setPlaced(clamped)
    return clamped - before
  }, [])
  // Person path: the ui.scroll hook commits the site. React follows only if
  // that commit landed. An unregistered site still moves locally.
  const commitIfPersonAllowed = (
    target: number,
    by: number,
    pointer?: { column: number; row: number },
  ): Promise<void> => {
    const siteMeta = personScrollRef.current
    const registered =
      siteMeta.plugin !== '' &&
      siteMeta.requestId !== '' &&
      getPluginScrollSite(
        siteMeta.plugin,
        siteMeta.requestId,
        siteMeta.component,
      ) !== undefined
    if (!registered) {
      commit(target)
      return Promise.resolve()
    }
    return dispatchPersonIfRegistered(target, by, pointer).then(() => {
      const site = getPluginScrollSite(
        siteMeta.plugin,
        siteMeta.requestId,
        siteMeta.component,
      )
      if (site?.offset === target) commit(target)
    })
  }
  // densable yEe `io=ce((no)=>Vt(no(Ne())),[Vt,Ne])` — stable place identity.
  const place = useCallback(
    (fn: (prev: number) => number): void => {
      inFlightRef.current = true
      const target = clamp(fn(placedRef.current))
      const by = target - liveOffset()
      if (by === 0) {
        inFlightRef.current = false
        return
      }
      void commitIfPersonAllowed(target, by).finally(() => {
        inFlightRef.current = false
      })
    },
    [commit],
  )
  const fireScroll = (
    delta: number,
    pointer?: { column: number; row: number },
  ): void => {
    inFlightRef.current = true
    const target = clamp(liveOffset() + delta)
    const by = target - liveOffset()
    // densable QLt.finally — keep inFlight until person scroll settles, then drain.
    const after = (): void => {
      if (!aliveRef.current) {
        inFlightRef.current = false
        queuedDeltaRef.current = 0
        queuedPointerRef.current = undefined
        return
      }
      inFlightRef.current = false
      const queued = queuedDeltaRef.current
      const queuedPointer = queuedPointerRef.current
      queuedDeltaRef.current = 0
      queuedPointerRef.current = undefined
      if (queued !== 0) fireScroll(queued, queuedPointer)
    }
    if (by === 0) {
      after()
      return
    }
    void commitIfPersonAllowed(target, by, pointer).finally(after)
  }
  const scrollBy = (
    delta: number,
    pointer?: { column: number; row: number },
  ): void => {
    if (delta === 0) return
    if (inFlightRef.current) {
      queuedDeltaRef.current += delta
      queuedPointerRef.current = pointer
      return
    }
    fireScroll(delta, pointer)
  }
  const followEndOn = (): void => {
    followEndRef.current = true
    setFollowEnd(true)
  }
  return {
    offset,
    placed: followEnd ? dims.current.maxOffset : placed,
    followEnd,
    scrollBy,
    place,
    commit,
    followEndOn,
  }
}

/**
 * densable `l$(h)` ringHandlers — cycle focus index; press Button→WCe/press,
 * Input→submit; leave clears. Input submit uses PluginSiteFields `m$` via bridge.
 */
export function bandRingHandlers(input: {
  focusables: DrawingFocusable[]
  focusIndexNow: () => number | null
  focusByPerson: (index: number) => void
  leave: () => void
  submit?: (focusable: DrawingFocusable) => void
}): {
  'abovePrompt:next': () => void
  'abovePrompt:previous': () => void
  'abovePrompt:press': () => void
  'abovePrompt:leave': () => void
} {
  const count = input.focusables.length
  return {
    'abovePrompt:next': () => {
      if (count > 0)
        input.focusByPerson(((input.focusIndexNow() ?? -1) + 1) % count)
    },
    'abovePrompt:previous': () => {
      if (count > 0)
        input.focusByPerson(((input.focusIndexNow() ?? 0) - 1 + count) % count)
    },
    'abovePrompt:press': () => {
      const index = input.focusIndexNow()
      const focused = index === null ? null : (input.focusables[index] ?? null)
      if (focused?.tag === 'Button') {
        firePress(focused.plugin, focused.handle)
        return
      }
      if (focused?.tag === 'Input') {
        input.submit?.(focused)
      }
      // Select press owned by y$/qZ selectHighlightHandlers on AbovePromptSelect.
    },
    'abovePrompt:leave': input.leave,
  }
}

/**
 * densable `mEe` — pixel scroll bag. Page step is live `bodyRows` (gold `v` / `ro`).
 */
export function paneScrollHandlers(input: {
  bodyRows: number
  contentRows: number
  scrollBy: (delta: number) => void
}): {
  'pane:scrollUp': () => void
  'pane:scrollDown': () => void
  'pane:pageUp': () => void
  'pane:pageDown': () => void
  'pane:top': () => void
  'pane:bottom': () => void
} {
  const { bodyRows, contentRows, scrollBy } = input
  return {
    'pane:scrollUp': () => scrollBy(-1),
    'pane:scrollDown': () => scrollBy(1),
    'pane:pageUp': () => scrollBy(-bodyRows),
    'pane:pageDown': () => scrollBy(bodyRows),
    'pane:top': () => scrollBy(-contentRows),
    'pane:bottom': () => scrollBy(contentRows),
  }
}

/**
 * densable `AZ(h,v,M)` — ring + mEe(scroll); `!hasCue` remaps ↑↓ onto the ring.
 * Gold `Zt(Yi,{context:"AbovePrompt",isActive:is})` binds the whole bag.
 */
export function bandKeysWithScroll<H extends Record<string, () => void>>(
  ring: H,
  scroll: ReturnType<typeof paneScrollHandlers>,
  hasCue: boolean,
): H & ReturnType<typeof paneScrollHandlers> {
  return {
    ...ring,
    ...scroll,
    ...(!hasCue && {
      'pane:scrollUp': ring['abovePrompt:previous'] as () => void,
      'pane:scrollDown': ring['abovePrompt:next'] as () => void,
    }),
  }
}

/**
 * densable `c$` — findIndex plugin+handle, then focusByPerson.
 */
export function clickFocusByPress(
  focusables: DrawingFocusable[],
  focusByPerson: (index: number) => void,
): (press: { plugin: string; handle: unknown }) => void {
  return press => {
    const index = focusables.findIndex(
      row => row.plugin === press.plugin && row.handle === press.handle,
    )
    if (index >= 0) focusByPerson(index)
  }
}

type PaneCloseRing = ReturnType<typeof bandRingHandlers> & {
  'pane:scrollUp': () => void
  'pane:scrollDown': () => void
}

/**
 * densable `aee` — ring = focusables + other-pane tabs (`tabCount`) + close mark.
 * Engine hold: `0..tabCount-1` pick tab, `tabCount` close. `pane:scrollUp/Down`
 * cycle focusables only when Pe>0 (gold We); pixel scroll stays on
 * PluginPaneKeyResize when maxOffset>0.
 */
export function extendPaneRingWithCloseMark(input: {
  ring: ReturnType<typeof bandRingHandlers>
  focusablesCount: number
  focusIndexNow: () => number | null
  engineHeldNow: () => number | null
  holdEngine: (index: number | null) => void
  setIndex: (index: number | null) => void
  moveByPerson: (move: { index: number | null; apply: () => void }) => void
  leave: () => void
  close: () => void
  tabs?: ReadonlyArray<{ id: string }>
  pick?: (id: string) => void
}): PaneCloseRing {
  const count = input.focusablesCount
  const tabCount = input.tabs?.length ?? 0
  const combinedCount = count + tabCount + 1
  const combinedNow = (): number | null => {
    const engine = input.engineHeldNow()
    return engine === null ? input.focusIndexNow() : count + engine
  }
  const go = (combined: number): void => {
    const inFocusables = combined < count
    input.moveByPerson({
      index: inFocusables ? combined : null,
      apply: () => {
        input.holdEngine(inFocusables ? null : combined - count)
        input.setIndex(inFocusables ? combined : null)
      },
    })
  }
  const cycleFocusables = (delta: number): void => {
    if (count <= 0) return
    const fallback = delta === 1 ? -1 : count
    const from =
      input.engineHeldNow() === null
        ? (input.focusIndexNow() ?? fallback)
        : fallback
    go((from + delta + count) % count)
  }
  const pressEngine = (engine: number): void => {
    if (engine === tabCount) {
      input.close()
      return
    }
    const id = input.tabs?.[engine]?.id
    if (id !== undefined) input.pick?.(id)
  }
  return {
    ...input.ring,
    'abovePrompt:next': () => go(((combinedNow() ?? -1) + 1) % combinedCount),
    'abovePrompt:previous': () =>
      go(((combinedNow() ?? 0) - 1 + combinedCount) % combinedCount),
    'abovePrompt:press': () => {
      const engine = input.engineHeldNow()
      if (engine === null) {
        input.ring['abovePrompt:press']()
        return
      }
      pressEngine(engine)
    },
    'abovePrompt:leave': input.leave,
    'pane:scrollUp': () => cycleFocusables(-1),
    'pane:scrollDown': () => cycleFocusables(1),
  }
}

/**
 * densable `qZ` — AbovePromptSelect handlers over a Select move/press host
 * (PluginSiteFields SelectFields + PluginPressSelect / firePressAnswer).
 */
export function selectHighlightHandlers(input: {
  move: (delta: number) => void
  press: () => void
}): {
  'abovePrompt:highlightNext': () => void
  'abovePrompt:highlightPrevious': () => void
  'abovePrompt:press': () => void
} {
  return {
    'abovePrompt:highlightNext': () => input.move(1),
    'abovePrompt:highlightPrevious': () => input.move(-1),
    'abovePrompt:press': input.press,
  }
}

/**
 * densable `y$.intercept` — ctrl-c close/unfocus + typeahead. Gold feeds this
 * into `g$({selectKeys})` and `sb(intercept)` while Select is focused.
 * PluginAbovePromptSite `usePluginBandKeys` + PluginSiteFields useInput consume it.
 */
export function selectKeysIntercept(
  input: string,
  key: Key,
  select: {
    focusedSelect: {
      plugin: string
      handle: unknown
      element: string
      options: Array<{ value: string; label?: string }>
    } | null
    open: {
      plugin: string
      handle: unknown
      highlight: number
      element: string
      options: Array<{ value: string; label?: string }>
    } | null
    close: () => void
    unfocus: () => void
    typeahead: (letter: string) => void
  },
  opts?: { working?: boolean },
): boolean {
  const focused = select.focusedSelect
  const ctrlC = key.ctrl && input === 'c'
  const typed = pluginSelectTypeahead(input, key)
  if (focused === null || (ctrlC && opts?.working === true)) return false
  if (ctrlC && select.open !== null) {
    select.close()
    return true
  }
  if (ctrlC) {
    select.unfocus()
    return true
  }
  if (typed) {
    select.typeahead(input.toLowerCase())
    return true
  }
  return false
}

export type PluginSelectSeatRing = {
  focusIndex: number | 'band' | null
  focusIndexNow: () => number | 'band' | null
  setFocusIndex: (next: number | 'band' | null) => void
  working?: boolean
}

/**
 * densable `y$(h)` — `{fields, handlers, intercept}` over kL(YFt)+Pc.
 * Identity `qe.key!==Rt(Me)` resets during render (gold `We(Kt(Me))`).
 */
export function usePluginSelectSeat(
  focusables: readonly DrawingFocusable[] | undefined,
  component: string,
  requestId: string,
  ring?: PluginSelectSeatRing,
): {
  fields: {
    pickedOf: (plugin: string, element: string) => string | undefined
    open: SelectOpen | null
  }
  handlers: ReturnType<typeof selectHighlightHandlers>
  intercept: (input: string, key: Key) => boolean
  focusedSelect: PluginSelectFocusable | null
  move: (delta: number) => void
  press: () => void
  typeahead: (letter: string) => void
  close: () => void
  toggle: (ref: {
    plugin: string
    handle: unknown
    element: string
    options: Array<{ value: string; label?: string }>
    value?: string
  }) => void
  focus: (ref: PluginSelectFocusable) => void
  unfocus: () => void
} {
  const [picked, setPicked] = usePluginFieldSeatMap(
    'select',
    component,
    requestId,
  )
  usePluginFieldValuePrune(focusables, 'Select', keys => {
    setPicked(current => deleteSeatKeys(current, keys))
  })
  const me = selectFocusableAt(focusables, ring?.focusIndex)
  const meKey = selectSeatKeyOf(me)
  const [seat, setSeat] = useState<PluginSelectSeatState>(() =>
    resetPluginSelectSeat(null, picked),
  )
  const seatNow = seat.key !== meKey ? resetPluginSelectSeat(me, picked) : seat
  useLayoutEffect(() => {
    if (seat.key === meKey) return
    setSeat(resetPluginSelectSeat(me, picked))
  }, [me, meKey, picked, seat.key])
  const optionCount = me?.options.length ?? 0
  const isOpen = me !== null && seatNow.isOpen
  const highlight = Math.min(seatNow.highlight, Math.max(0, optionCount - 1))
  const open: SelectOpen | null =
    isOpen && me !== null
      ? {
          plugin: me.plugin,
          handle: me.handle,
          highlight,
          element: me.element,
          options: me.options,
        }
      : null

  const rowNow = (): PluginSelectFocusable | null =>
    selectFocusableAt(focusables, ring?.focusIndexNow() ?? ring?.focusIndex)

  const ensureSeat = (row: PluginSelectFocusable): PluginSelectSeatState => {
    const key = pluginInputFieldKey(row.plugin, row.element)
    if (seatNow.key === key) return seatNow
    const next = resetPluginSelectSeat(row, picked)
    setSeat(next)
    return next
  }

  const move = (delta: number): void => {
    // densable y$ Vt — closed Select opens on move; open cycles highlight.
    const row = rowNow()
    if (row === null) return
    const now = ensureSeat(row)
    const count = Math.max(1, row.options.length)
    const at = Math.min(now.highlight, Math.max(0, row.options.length - 1))
    setSeat(
      now.isOpen
        ? { ...now, highlight: (at + delta + count) % count }
        : { ...now, isOpen: true },
    )
  }

  const press = (): void => {
    const row = rowNow()
    if (row === null) return
    const now = ensureSeat(row)
    const key = pluginInputFieldKey(row.plugin, row.element)
    const choice =
      row.options[Math.min(now.highlight, Math.max(0, row.options.length - 1))]
    if (!now.isOpen || choice === undefined) {
      setSeat({ ...now, isOpen: true })
      return
    }
    setPicked(current => new Map(current).set(key, choice.value))
    setSeat({ ...now, isOpen: false })
    void firePressAnswer(
      row.plugin,
      row.handle,
      { value: choice.value },
      {
        tag: 'Select',
        eventName: 'ui.select',
        element: row.element,
        component,
        requestId,
        admits: held =>
          held.options === undefined || held.options.includes(choice.value),
      },
    ).then(reply => {
      if (
        reply !== undefined &&
        typeof reply === 'object' &&
        reply !== null &&
        'value' in reply
      ) {
        const next = (reply as { value: unknown }).value
        if (typeof next === 'string') {
          setPicked(current =>
            current.get(key) === choice.value
              ? new Map(current).set(key, next)
              : current,
          )
        }
      }
    })
  }

  const typeahead = (letter: string): void => {
    const row = rowNow()
    if (row === null) return
    const now = ensureSeat(row)
    const next = pluginSelectTypeaheadNext(
      now.isOpen
        ? {
            plugin: row.plugin,
            handle: row.handle,
            element: row.element,
            options: row.options,
            highlight: now.highlight,
          }
        : null,
      row,
      letter,
    )
    if (next === null) return
    setSeat({ ...now, highlight: next.highlight, isOpen: true })
  }

  const close = (): void => {
    setSeat(current => ({ ...current, isOpen: false }))
  }

  const unfocus = (): void => {
    close()
    ring?.setFocusIndex(null)
  }

  const intercept = (input: string, key: Key): boolean =>
    selectKeysIntercept(
      input,
      key,
      {
        focusedSelect: rowNow(),
        open,
        close,
        unfocus,
        typeahead,
      },
      { working: ring?.working === true },
    )

  return {
    fields: {
      pickedOf: (plugin, element) =>
        picked.get(pluginInputFieldKey(plugin, element)),
      open,
    },
    handlers: selectHighlightHandlers({ move, press }),
    intercept,
    focusedSelect: me,
    move,
    press,
    typeahead,
    close,
    toggle(ref) {
      const key = pluginInputFieldKey(ref.plugin, ref.element)
      const same =
        open !== null &&
        open.plugin === ref.plugin &&
        open.handle === ref.handle
      if (!same) {
        const shown = picked.get(key) ?? ref.value
        const at = ref.options.findIndex(option => option.value === shown)
        setSeat({ key, isOpen: true, highlight: at < 0 ? 0 : at })
        return
      }
      press()
    },
    focus() {
      /* densable Me is the ring index; mouse lands via clickedPress. */
    },
    unfocus,
  }
}

/** densable y$ return — `{fields, handlers, intercept}` plus SiteFields hosts. */
export type PluginSelectSeat = ReturnType<typeof usePluginSelectSeat>

/** densable `Z$t` — queued person focus acts while a move is in flight. */
const FOCUS_HOST_QUEUE_MAX = 64

export type PluginFocusHostApi = {
  act: (fn: () => void) => void
  moveByPerson: (move: { index: number | null; apply: () => void }) => void
  forget: () => void
}

/**
 * densable `YHo(host, handlers, skip)` — wrap each handler in `host.act`
 * except keys in `skip` (gold Pane: `["abovePrompt:leave"]`).
 */
export function wrapPluginFocusActs<H extends Record<string, () => void>>(
  host: { act: (fn: () => void) => void },
  handlers: H,
  skip: readonly string[] = [],
): H {
  const next = { ...handlers }
  for (const key of Object.keys(handlers) as Array<keyof H & string>) {
    if (skip.includes(key)) continue
    const fn = handlers[key]
    next[key] = (() => {
      host.act(fn)
    }) as H[typeof key]
  }
  return next
}

/**
 * densable `XHo` — bind live keyboard host onto g9e focusSites.
 * commit: person `move.apply` / auto race `"the focus moved meanwhile"` / land(index).
 */
export function usePluginFocusHost(input: {
  component: 'Pane' | 'AbovePrompt'
  requestId: string
  owner?: string
  focusables: DrawingFocusable[]
  isHeld: boolean
  isHeldNow: () => boolean
  indexNow: () => number | null
  isEmptyNow: () => boolean
  land: (index: number) => void
}): PluginFocusHostApi {
  const pendingRef = useRef<
    | {
        abort: AbortController
        expected: number | null
        move?: { index: number | null; apply: () => void }
        auto?: DrawingFocusable
      }
    | undefined
  >(undefined)
  const queueRef = useRef<Array<() => void>>([])
  const startedRef = useRef(false)
  const liveRef = useRef(true)
  const focusablesRef = useRef(input.focusables)
  focusablesRef.current = input.focusables
  const indexNowRef = useRef(input.indexNow)
  indexNowRef.current = input.indexNow
  const landRef = useRef(input.land)
  landRef.current = input.land
  const isHeldNowRef = useRef(input.isHeldNow)
  isHeldNowRef.current = input.isHeldNow
  const holderNowRef = useRef(() => {
    const idx = indexNowRef.current()
    return focusableAt(focusablesRef.current, idx)?.plugin
  })

  const drain = useCallback(() => {
    while (pendingRef.current === undefined && queueRef.current.length > 0) {
      const next = queueRef.current.shift()
      next?.()
    }
  }, [])

  const forget = useCallback(() => {
    pendingRef.current?.abort.abort()
    pendingRef.current = undefined
    queueRef.current = []
  }, [])

  const actFocus = useCallback(
    (
      payload: {
        component: 'Pane' | 'AbovePrompt'
        requestId: string
        plugin?: string
        element?: unknown
        origin: { kind: string; name?: string }
      },
      meta: {
        expected: number | null
        move?: { index: number | null; apply: () => void }
        auto?: DrawingFocusable
      },
    ) => {
      const ticket = { ...meta, abort: new AbortController() }
      pendingRef.current = ticket
      const finish = () => {
        const same = pendingRef.current === ticket
        if (same) pendingRef.current = undefined
        if (same && liveRef.current) drain()
      }
      // densable ve → idn({input, signal}) → Tq. Person lands in commit.apply.
      const key =
        typeof payload.element === 'string' && payload.element !== ''
          ? payload.element
          : undefined
      const result = dispatchUiFocus(
        {
          component: payload.component,
          requestId: payload.requestId,
          ...(payload.plugin !== undefined && { plugin: payload.plugin }),
          ...(key !== undefined && { element: key }),
          origin: payload.origin,
        },
        { signal: ticket.abort.signal },
      )
      // densable: Promise → Hde.finally(Qe); else Qe() same tick.
      if (result instanceof Promise) {
        void logUiScrollSettled(
          `ui.focus ${payload.requestId}`,
          result,
        ).finally(finish)
        return
      }
      finish()
    },
    [drain],
  )

  const moveByPerson = useCallback(
    (move: { index: number | null; apply: () => void }) => {
      const hit = focusableAt(focusablesRef.current, move.index)
      if (move.index !== null && hit === null) return
      startedRef.current = true
      actFocus(
        {
          component: input.component,
          requestId: input.requestId,
          ...(hit && {
            plugin: hit.plugin,
            element: hit.element,
          }),
          origin: { kind: 'person' },
        },
        { expected: indexNowRef.current(), move },
      )
    },
    [actFocus, input.component, input.requestId],
  )

  const act = useCallback((fn: () => void) => {
    if (pendingRef.current === undefined && queueRef.current.length === 0) {
      fn()
      return
    }
    if (queueRef.current.length < FOCUS_HOST_QUEUE_MAX) {
      queueRef.current = [...queueRef.current, fn]
    }
  }, [])

  const hasElement = useCallback((plugin: string, element: string) => {
    return (
      focusablesRef.current.findIndex(
        row => row.plugin === plugin && row.element === element,
      ) >= 0
    )
  }, [])

  const commit = useCallback(
    (payload: {
      plugin: string
      element?: string
      origin: { kind: string; name?: string }
    }) => {
      const pending = pendingRef.current
      const omitted = payload.element === undefined
      if (payload.origin.kind === 'person') {
        const move = pending?.move
        if (
          pending === undefined ||
          move === undefined ||
          indexNowRef.current() !== pending.expected
        ) {
          return 'the focus moved meanwhile'
        }
        const at = focusableAt(focusablesRef.current, move.index)
        if (
          omitted ||
          (at !== null &&
            at.plugin === payload.plugin &&
            at.element === payload.element)
        ) {
          move.apply()
          return
        }
      }
      const auto = pending?.auto
      if (
        auto !== undefined &&
        payload.plugin === auto.plugin &&
        payload.element === auto.element &&
        indexNowRef.current() !== pending?.expected
      ) {
        return 'the focus moved meanwhile'
      }
      const at = focusablesRef.current.findIndex(
        row => row.plugin === payload.plugin && row.element === payload.element,
      )
      if (at < 0) {
        return omitted
          ? 'no element named'
          : `no element of ${payload.plugin} is drawn under that key`
      }
      startedRef.current = true
      landRef.current(at)
      return
    },
    [],
  )

  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
      forget()
    }
  }, [forget])

  useEffect(() => {
    if (input.requestId === '') return
    return bindPluginFocusHost({
      component: input.component,
      requestId: input.requestId,
      owner: input.owner,
      isHeldNow: () => isHeldNowRef.current(),
      holderNow: () => holderNowRef.current(),
      hasElement,
      commit,
    })
  }, [input.component, input.requestId, input.owner, hasElement, commit])

  const autoFocusable = useMemo(
    () => input.focusables.find(row => row.isAutoFocus),
    [input.focusables],
  )

  useEffect(() => {
    if (!input.isHeld) {
      startedRef.current = false
      forget()
      return
    }
    if (
      startedRef.current ||
      pendingRef.current !== undefined ||
      autoFocusable === undefined ||
      input.isEmptyNow()
    ) {
      return
    }
    startedRef.current = true
    actFocus(
      {
        component: input.component,
        requestId: input.requestId,
        plugin: autoFocusable.plugin,
        element: autoFocusable.element,
        origin: { kind: 'plugin', name: autoFocusable.plugin },
      },
      { expected: indexNowRef.current(), auto: autoFocusable },
    )
  }, [input.isHeld, autoFocusable, input, actFocus, forget])

  return { act, moveByPerson, forget }
}

/**
 * densable `g$(h)` body — Yl resolve + handler bag + selectKeys + optional m$ edit.
 * Returns whether the prepend `sb` listener should consume the event.
 */
export function pluginBandKeys(
  bag: PluginBandKeysBag,
  resolve: PluginBandResolve | null | undefined,
): (input: string, key: Key, eventInput: string) => boolean {
  return (input, key, eventInput) => {
    const contextNow = bag.contextNow()
    if (resolve == null || contextNow == null) return false
    if (key.wheelUp || key.wheelDown) return false
    if (!bag.isAhead()) return false
    const nowHit = resolve(input, key, [contextNow])
    if (nowHit.type === 'match' && typeof nowHit.action === 'string') {
      const run = bag.handlers[contextNow]?.[nowHit.action]
      if (run !== undefined) {
        run()
        return true
      }
    }
    const focusedNow = bag.focusedNow()
    if (focusedNow?.tag === 'Select' && bag.selectKeys(input, key)) return true
    if (resolve(input, key, ['Global']).type === 'match') return false
    const typed = input === '' ? eventInput : input
    if (focusedNow?.tag === 'Input' && bag.inputs !== undefined) {
      if (typeof focusedNow.element !== 'string' || focusedNow.element === '')
        return false
      const ref = {
        plugin: focusedNow.plugin,
        handle: focusedNow.handle,
        element: focusedNow.element,
        ...(typeof focusedNow.value === 'string' && {
          value: focusedNow.value,
        }),
      }
      const shown = bag.inputs.textNow(ref)
      if (key.backspace) {
        bag.inputs.fields.edit(ref, [...shown].slice(0, -1).join(''))
        return true
      }
      if (pluginInputIsTyped(typed, key)) {
        bag.inputs.fields.edit(ref, shown + typed)
        return true
      }
      if (pluginInputIsNav(input, key)) return true
    }
    const contextRendered = bag.contextRendered()
    if (contextRendered == null) return false
    const renderedHit = resolve(input, key, [contextRendered])
    const stealsHandler =
      renderedHit.type === 'match' &&
      typeof renderedHit.action === 'string' &&
      bag.handlers[contextRendered]?.[renderedHit.action] !== undefined
    const stealsInput =
      key.backspace ||
      pluginInputIsTyped(typed, key) ||
      pluginInputIsNav(input, key)
    return (
      stealsHandler || (bag.focusedRendered()?.tag === 'Input' && stealsInput)
    )
  }
}

/**
 * densable `g$` hook — `Yl()` resolve + `sb(..., {prepend:true})`.
 * Caller supplies bag from local ring/bridge (Si panes store already HAVE).
 */
export function usePluginBandKeys(
  bag: PluginBandKeysBag,
  options: { isActive: boolean },
): void {
  const keys = useOptionalKeybindingContext()
  const bagRef = useRef(bag)
  bagRef.current = bag
  const resolve = keys?.resolve as PluginBandResolve | undefined
  useInput(
    (input, key, event) => {
      const consume = pluginBandKeys(bagRef.current, resolve)
      if (consume(input, key, event.input)) event.stopImmediatePropagation()
    },
    { isActive: options.isActive, prepend: true },
  )
}
