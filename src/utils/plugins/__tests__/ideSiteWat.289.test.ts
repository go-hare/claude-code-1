import { afterEach, describe, expect, test } from 'bun:test'
import {
  EMPTY_PANES,
  commitPluginScrollSite,
  followPluginScrollSiteEnd,
  getPluginScrollSite,
  getRasterFrameVersion,
  handleHostOp,
  isToastHoldShown,
  registerPluginScrollSite,
  setLoadedFunctionHooksModules,
  setPanesState,
  unregisterPluginScrollSite,
  updatePluginScrollSite,
} from '../functionHooksModules.js'

afterEach(() => {
  setLoadedFunctionHooksModules([])
  unregisterPluginScrollSite('p', 'req')
})

describe('densable 2.1.289 Ide site followEnd + wat + toast hold', () => {
  test('followEnd latch pins offset on dim growth', () => {
    registerPluginScrollSite('p', 'req', 'Pane', {
      maxOffset: 5,
      offset: 5,
    })
    const before = getRasterFrameVersion()
    expect(followPluginScrollSiteEnd('p', 'req')).toBe(true)
    expect(getPluginScrollSite('p', 'req')?.followEnd).toBe(true)
    expect(getRasterFrameVersion()).toBeGreaterThan(before)
    updatePluginScrollSite('p', 'req', { maxOffset: 9 })
    expect(getPluginScrollSite('p', 'req')?.offset).toBe(9)
    expect(getPluginScrollSite('p', 'req')?.followEnd).toBe(true)
  })

  test('ui.scroll to end arms followEnd (wat)', async () => {
    registerPluginScrollSite('p', 'req', 'Pane', {
      maxOffset: 4,
      offset: 0,
    })
    const result = await handleHostOp(
      'ui.scroll',
      [{ to: 'end', in: 'req' }],
      'p',
    )
    expect(result).toEqual({})
    expect(getPluginScrollSite('p', 'req')?.offset).toBe(4)
    expect(getPluginScrollSite('p', 'req')?.followEnd).toBe(true)
  })

  test('bare commit to max clears followEnd (gold Ide Vt We(!1))', () => {
    registerPluginScrollSite('p', 'req', 'Pane', {
      maxOffset: 4,
      offset: 0,
    })
    expect(followPluginScrollSiteEnd('p', 'req')).toBe(true)
    expect(getPluginScrollSite('p', 'req')?.followEnd).toBe(true)
    // densable commit/vq never arms — only wat/followEnd() does.
    expect(commitPluginScrollSite('p', 'req', 4)).toEqual({})
    expect(getPluginScrollSite('p', 'req')?.offset).toBe(4)
    expect(getPluginScrollSite('p', 'req')?.followEnd).toBe(false)
  })

  test('isToastHoldShown needs placements + shown holdToasts', () => {
    expect(isToastHoldShown(EMPTY_PANES)).toBe(false)
    expect(
      isToastHoldShown({
        ...EMPTY_PANES,
        placements: 1,
        shownId: 'a',
        open: [
          {
            id: 'a',
            plugin: 'p',
            title: 'A',
            holdToasts: true,
          },
        ],
      }),
    ).toBe(true)
    setPanesState(EMPTY_PANES)
  })
})
