import { afterEach, describe, expect, test } from 'bun:test'
import {
  EMPTY_PANES,
  focusPane,
  forgetAskedPane,
  getPanesState,
  getPanesStore,
  handleHostOp,
  hasAskedPane,
  nextFocusedPaneId,
  cycleShownPaneId,
  offerPanePlacement,
  offerPlacement,
  PANE_OPEN_FLOOR_ASKED,
  PANE_OPEN_FLOOR_DEFAULT,
  paneOpenFloor,
  placeWaitingPanes,
  placeWaitingPanesRemote,
  rememberAskedPane,
  seedAskedPanes,
  setLoadedFunctionHooksModules,
  setPanesState,
  settleFocusRequest,
  settlePaneFocusRequest,
  settlePanesTerminalColumns,
  showPane,
  subscribePanes,
} from '../functionHooksModules.js'

afterEach(() => {
  setLoadedFunctionHooksModules([])
})

describe('densable 2.1.289 EMPTY_PANES-shaped semantic panes store', () => {
  test('EMPTY_PANES mirrors gold JSn fields', () => {
    expect(EMPTY_PANES).toEqual({
      open: [],
      unplaced: [],
      asked: [],
      shownId: null,
      focusedId: null,
      focusRequest: null,
      placements: 0,
      closing: [],
    })
    expect(getPanesState()).toEqual(EMPTY_PANES)
    expect(getPanesStore().getState()).toEqual(EMPTY_PANES)
  })

  test('setPanesState / subscribePanes round-trip open + focusRequest', () => {
    let ticks = 0
    const stop = subscribePanes(() => {
      ticks += 1
    })
    setPanesState({
      open: [
        { id: 'a', plugin: 'p', title: 'A' },
        { id: 'b', plugin: 'p', title: 'B' },
      ],
      unplaced: [{ id: 'c', plugin: 'p', title: 'C' }],
      asked: [{ plugin: 'p', id: 'a' }],
      shownId: 'a',
      focusedId: 'a',
      focusRequest: 'b',
      placements: 0,
      closing: [],
    })
    expect(ticks).toBeGreaterThan(0)
    const state = getPanesState()
    expect(state.open.map(pane => pane.id)).toEqual(['a', 'b'])
    expect(state.unplaced.map(pane => pane.id)).toEqual(['c'])
    expect(state.asked).toEqual([{ plugin: 'p', id: 'a' }])
    expect(state.shownId).toBe('a')
    expect(state.focusedId).toBe('a')
    expect(state.focusRequest).toBe('b')
    stop()
  })

  test('focusPane (u3) sets focused/shown and clears focusRequest', () => {
    setPanesState({
      ...EMPTY_PANES,
      open: [
        { id: 'a', plugin: 'p', title: 'A' },
        { id: 'b', plugin: 'p', title: 'B' },
      ],
      shownId: 'a',
      focusedId: 'a',
      focusRequest: 'b',
    })
    focusPane('b')
    expect(getPanesState().focusedId).toBe('b')
    expect(getPanesState().shownId).toBe('b')
    expect(getPanesState().focusRequest).toBeNull()
  })

  test('showPane (l4n) updates shownId and focusedId when already focused', () => {
    setPanesState({
      ...EMPTY_PANES,
      open: [
        { id: 'a', plugin: 'p', title: 'A' },
        { id: 'b', plugin: 'p', title: 'B' },
      ],
      shownId: 'a',
      focusedId: 'a',
    })
    showPane('b')
    expect(getPanesState().shownId).toBe('b')
    expect(getPanesState().focusedId).toBe('b')
  })

  test('cycleShownPaneId (ZLo) wraps shownId when open.length>1', () => {
    const state = {
      ...EMPTY_PANES,
      open: [
        { id: 'a', plugin: 'p', title: 'A' },
        { id: 'b', plugin: 'p', title: 'B' },
        { id: 'c', plugin: 'p', title: 'C' },
      ],
      shownId: 'a',
    }
    expect(cycleShownPaneId(1, state)).toBe('b')
    expect(cycleShownPaneId(-1, state)).toBe('c')
    expect(cycleShownPaneId(1, { ...state, shownId: 'c' })).toBe('a')
    expect(
      cycleShownPaneId(1, {
        ...EMPTY_PANES,
        open: [{ id: 'a', plugin: 'p', title: 'A' }],
        shownId: 'a',
      }),
    ).toBeNull()
    expect(cycleShownPaneId(1, { ...state, shownId: null })).toBeNull()
  })

  test('nextFocusedPaneId ($Fr) walks open after focusedId', () => {
    const state = {
      ...EMPTY_PANES,
      open: [
        { id: 'a', plugin: 'p', title: 'A' },
        { id: 'b', plugin: 'p', title: 'B' },
        { id: 'c', plugin: 'p', title: 'C' },
      ],
      focusedId: 'a',
    }
    expect(nextFocusedPaneId(state)).toBe('b')
    expect(nextFocusedPaneId({ ...state, focusedId: 'c' })).toBeNull()
  })

  test('offerPlacement / offerPanePlacement (QFt) refcounts placements with disposer', () => {
    expect(getPanesState().placements).toBe(0)
    const dispose = offerPanePlacement()
    expect(getPanesState().placements).toBe(1)
    const dispose2 = offerPlacement()
    expect(getPanesState().placements).toBe(2)
    dispose()
    expect(getPanesState().placements).toBe(1)
    dispose()
    expect(getPanesState().placements).toBe(1)
    dispose2()
    expect(getPanesState().placements).toBe(0)
  })

  test('settleFocusRequest / settlePaneFocusRequest (a4n) focuses or clears pending request', () => {
    setPanesState({
      ...EMPTY_PANES,
      open: [
        { id: 'a', plugin: 'p', title: 'A' },
        { id: 'b', plugin: 'p', title: 'B' },
      ],
      shownId: 'a',
      focusedId: 'a',
      focusRequest: 'b',
    })
    settlePaneFocusRequest(false)
    expect(getPanesState().focusRequest).toBeNull()
    expect(getPanesState().focusedId).toBe('a')

    setPanesState(prev => ({ ...prev, focusRequest: 'b' }))
    settleFocusRequest(true)
    expect(getPanesState().focusedId).toBe('b')
    expect(getPanesState().shownId).toBe('b')
    expect(getPanesState().focusRequest).toBeNull()
  })

  test('ui.open focus:true queues focusRequest without writing focusedId (gold b)', async () => {
    const result = await handleHostOp(
      'ui.open',
      [{ id: 'pane_1', title: 'One', focus: true }],
      'plugin.p',
    )
    expect(result).toEqual({ isPlaced: true })
    const state = getPanesState()
    expect(state.open.map(pane => pane.id)).toEqual(['pane_1'])
    // densable b: shownId = focusedId ?? id; focusedId unchanged (null).
    expect(state.shownId).toBe('pane_1')
    expect(state.focusedId).toBeNull()
    expect(state.focusRequest).toBe('pane_1')
  })

  test('ui.open focus:true keeps prior focusedId/shownId; only queues focusRequest', async () => {
    await handleHostOp('ui.open', [{ id: 'pane_a', title: 'A' }], 'plugin.p')
    // Simulate person already holding keyboard on A.
    setPanesState(prev => ({
      ...prev,
      shownId: 'pane_a',
      focusedId: 'pane_a',
      focusRequest: null,
    }))
    const result = await handleHostOp(
      'ui.open',
      [{ id: 'pane_b', title: 'B', focus: true }],
      'plugin.p',
    )
    expect(result).toEqual({ isPlaced: true })
    const state = getPanesState()
    expect(state.open.map(pane => pane.id).sort()).toEqual(['pane_a', 'pane_b'])
    // densable b: shownId = focusedId ?? id → stays A; focusedId unchanged.
    expect(state.shownId).toBe('pane_a')
    expect(state.focusedId).toBe('pane_a')
    expect(state.focusRequest).toBe('pane_b')
  })

  test('ui.open below openFloor parks unplaced; force places + rememberAsked', async () => {
    settlePanesTerminalColumns(100)
    const wait = await handleHostOp(
      'ui.open',
      [{ id: 'narrow_1', title: 'Narrow' }],
      'plugin.p',
    )
    expect(wait).toMatchObject({ isPlaced: false })
    expect(getPanesState().unplaced.map(p => p.id)).toEqual(['narrow_1'])
    expect(getPanesState().open.map(p => p.id)).toEqual([])
    // densable rNo/fue — waiters appear with isPlaced:false.
    expect(await handleHostOp('ui.panes', [{}], 'plugin.p')).toEqual([
      {
        id: 'narrow_1',
        title: 'Narrow',
        isShown: false,
        isFocused: false,
        isPlaced: false,
      },
    ])

    const forced = await handleHostOp(
      'ui.open',
      [{ id: 'narrow_1', title: 'Narrow', force: true, focus: true }],
      'plugin.p',
    )
    expect(forced).toEqual({ isPlaced: true })
    expect(getPanesState().open.map(p => p.id)).toEqual(['narrow_1'])
    expect(getPanesState().unplaced).toEqual([])
    expect(
      hasAskedPane(getPanesState(), { plugin: 'plugin.p', id: 'narrow_1' }),
    ).toBe(true)
    expect(await handleHostOp('ui.panes', [{}], 'plugin.p')).toEqual([
      {
        id: 'narrow_1',
        title: 'Narrow',
        isShown: true,
        isFocused: false,
        isPlaced: true,
      },
    ])
  })

  test('ui.open at/above floor places without force', async () => {
    settlePanesTerminalColumns(144)
    const result = await handleHostOp(
      'ui.open',
      [{ id: 'wide_1', title: 'Wide' }],
      'plugin.q',
    )
    expect(result).toEqual({ isPlaced: true })
    expect(getPanesState().open.map(p => p.id)).toEqual(['wide_1'])
  })

  test('paneOpenFloor / hasAskedPane use gold D9=110 and C8e=144', () => {
    expect(PANE_OPEN_FLOOR_ASKED).toBe(110)
    expect(PANE_OPEN_FLOOR_DEFAULT).toBe(144)
    const asked = {
      ...EMPTY_PANES,
      asked: [{ plugin: 'p', id: 'a' }],
    }
    expect(hasAskedPane(asked, { plugin: 'p', id: 'a' })).toBe(true)
    expect(hasAskedPane(asked, { plugin: 'p', id: 'b' })).toBe(false)
    expect(paneOpenFloor(asked, { plugin: 'p', id: 'a' })).toBe(110)
    expect(paneOpenFloor(asked, { plugin: 'p', id: 'b' })).toBe(144)
  })

  test('placeWaitingPanes places only waiters at/above openFloor', () => {
    setPanesState({
      ...EMPTY_PANES,
      unplaced: [
        { id: 'asked_pane', plugin: 'p', title: 'Asked' },
        { id: 'fresh_pane', plugin: 'p', title: 'Fresh' },
      ],
      asked: [{ plugin: 'p', id: 'asked_pane' }],
      focusRequest: 'keep',
    })
    placeWaitingPanes(120)
    let state = getPanesState()
    expect(state.open.map(pane => pane.id)).toEqual(['asked_pane'])
    expect(state.unplaced.map(pane => pane.id)).toEqual(['fresh_pane'])
    expect(state.shownId).toBe('asked_pane')
    expect(state.focusRequest).toBe('keep')

    placeWaitingPanes(144)
    state = getPanesState()
    expect(state.open.map(pane => pane.id)).toEqual([
      'asked_pane',
      'fresh_pane',
    ])
    expect(state.unplaced).toEqual([])
  })

  test('placeWaitingPanesRemote places all unplaced regardless of floor', () => {
    setPanesState({
      ...EMPTY_PANES,
      unplaced: [
        { id: 'a', plugin: 'p', title: 'A' },
        { id: 'b', plugin: 'q', title: 'B' },
      ],
      focusedId: null,
      focusRequest: 'pending',
    })
    placeWaitingPanesRemote('surface-attach')
    const state = getPanesState()
    expect(state.open.map(pane => pane.id)).toEqual(['a', 'b'])
    expect(state.unplaced).toEqual([])
    // gold `b`: when focusedId is null, each new place sets shownId to that pane —
    // last waiter wins.
    expect(state.shownId).toBe('b')
    expect(state.focusRequest).toBe('pending')
  })

  test('rememberAskedPane / forgetAskedPane / seedAskedPanes latch in-memory asked', () => {
    seedAskedPanes([{ plugin: 'p', id: 'seeded' }])
    expect(getPanesState().asked).toEqual([{ plugin: 'p', id: 'seeded' }])
    // one-shot latch — second seed is a no-op
    seedAskedPanes([{ plugin: 'p', id: 'ignored' }])
    expect(getPanesState().asked).toEqual([{ plugin: 'p', id: 'seeded' }])

    rememberAskedPane({ plugin: 'p', id: 'fresh' })
    rememberAskedPane({ plugin: 'p', id: 'fresh' })
    expect(getPanesState().asked).toEqual([
      { plugin: 'p', id: 'seeded' },
      { plugin: 'p', id: 'fresh' },
    ])

    forgetAskedPane({ plugin: 'p', id: 'seeded' })
    expect(getPanesState().asked).toEqual([{ plugin: 'p', id: 'fresh' }])
  })

  test('settlePanesTerminalColumns / offerPlacement place waiters when width known', () => {
    setPanesState({
      ...EMPTY_PANES,
      unplaced: [{ id: 'wide', plugin: 'p', title: 'Wide' }],
    })
    settlePanesTerminalColumns(100)
    expect(getPanesState().unplaced.map(pane => pane.id)).toEqual(['wide'])
    expect(getPanesState().open).toEqual([])

    settlePanesTerminalColumns(144)
    expect(getPanesState().open.map(pane => pane.id)).toEqual(['wide'])
    expect(getPanesState().unplaced).toEqual([])

    setPanesState({
      ...EMPTY_PANES,
      unplaced: [{ id: 'later', plugin: 'p', title: 'Later' }],
    })
    const dispose = offerPlacement()
    expect(getPanesState().open.map(pane => pane.id)).toEqual(['later'])
    expect(getPanesState().placements).toBe(1)
    dispose()
  })

  test('ui.open already-open skips ee under floor (gold eNo short-circuit)', async () => {
    settlePanesTerminalColumns(200)
    expect(
      await handleHostOp(
        'ui.open',
        [{ id: 'keep_1', title: 'Keep' }],
        'plugin.p',
      ),
    ).toEqual({ isPlaced: true })
    expect(getPanesState().open.map(p => p.id)).toEqual(['keep_1'])
    expect(getPanesState().unplaced).toEqual([])

    // Shrink below floor; reopen same id must stay placed (not dual-park).
    settlePanesTerminalColumns(100)
    expect(
      await handleHostOp(
        'ui.open',
        [{ id: 'keep_1', title: 'Keep Renamed' }],
        'plugin.p',
      ),
    ).toEqual({ isPlaced: true })
    expect(getPanesState().open.map(p => p.id)).toEqual(['keep_1'])
    expect(getPanesState().unplaced).toEqual([])
    expect(await handleHostOp('ui.panes', [{}], 'plugin.p')).toEqual([
      {
        id: 'keep_1',
        title: 'Keep Renamed',
        isShown: true,
        isFocused: false,
        isPlaced: true,
      },
    ])
  })

  test('ui.close / drop clears focusedId (gold JFt/V membership)', async () => {
    settlePanesTerminalColumns(200)
    await handleHostOp('ui.open', [{ id: 'a', title: 'A' }], 'plugin.p')
    await handleHostOp('ui.open', [{ id: 'b', title: 'B' }], 'plugin.p')
    focusPane('a')
    expect(getPanesState().focusedId).toBe('a')
    expect(getPanesState().shownId).toBe('a')

    await handleHostOp(
      'ui.close',
      [{ id: 'a', origin: { kind: 'plugin' } }],
      'plugin.p',
    )
    // densable V: shownId → remaining last; focusedId → null (not promoted).
    expect(getPanesState().open.map(p => p.id)).toEqual(['b'])
    expect(getPanesState().shownId).toBe('b')
    expect(getPanesState().focusedId).toBeNull()
    expect(getPanesState().focusRequest).toBeNull()
  })

  test('drop bumps Pane remount generation (gold JFt→NFr/ift)', async () => {
    settlePanesTerminalColumns(200)
    await handleHostOp('ui.open', [{ id: 'r1', title: 'R' }], 'plugin.p')
    const { getPaneRemountGeneration } = await import(
      '../functionHooksModules.js'
    )
    const before = getPaneRemountGeneration('r1')
    await handleHostOp(
      'ui.close',
      [{ id: 'r1', origin: { kind: 'plugin' } }],
      'plugin.p',
    )
    expect(getPaneRemountGeneration('r1')).toBe(before + 1)
  })
})
