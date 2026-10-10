import { afterEach, describe, expect, test } from 'bun:test'
import {
  commitPluginScrollSite,
  dispatchPersonUiScroll,
  getPluginScrollSite,
  getRasterFrameVersion,
  isForeignPluginScrollOrigin,
  followPluginScrollSiteEnd,
  registerPluginScrollSite,
  setLoadedFunctionHooksModules,
  unregisterPluginScrollSite,
  updatePluginScrollSite,
} from '../functionHooksModules.js'

afterEach(() => {
  setLoadedFunctionHooksModules([])
  unregisterPluginScrollSite('owner.p', 'req_1')
  unregisterPluginScrollSite('owner.p', 'shared')
  unregisterPluginScrollSite('owner.p', 'shared', 'AbovePrompt')
})

describe('densable 2.1.289 Sat scroll site ownership', () => {
  test('isForeignPluginScrollOrigin matches gold Sat', () => {
    expect(
      isForeignPluginScrollOrigin('owner.a', {
        kind: 'plugin',
        name: 'owner.b',
      }),
    ).toBe(true)
    expect(
      isForeignPluginScrollOrigin('owner.a', {
        kind: 'plugin',
        name: 'owner.a',
      }),
    ).toBe(false)
    expect(isForeignPluginScrollOrigin('owner.a', { kind: 'person' })).toBe(
      false,
    )
    expect(
      isForeignPluginScrollOrigin(undefined, { kind: 'plugin', name: 'x' }),
    ).toBe(false)
  })

  test('commitPluginScrollSite denies foreign plugin origin', () => {
    registerPluginScrollSite('owner.p', 'req_1', 'Pane', {
      bodyRows: 10,
      contentRows: 20,
      maxOffset: 10,
      offset: 0,
    })
    expect(
      commitPluginScrollSite('owner.p', 'req_1', 5, {
        kind: 'plugin',
        name: 'other',
      }),
    ).toEqual({ deny: "not this plugin's site" })
    expect(
      commitPluginScrollSite('owner.p', 'req_1', 5, { kind: 'person' }),
    ).toEqual({})
    expect(
      commitPluginScrollSite('owner.p', 'req_1', 5, {
        kind: 'plugin',
        name: 'owner.p',
      }),
    ).toEqual({})
  })

  test('dispatchPersonUiScroll bumps raster after successful vq commit', async () => {
    registerPluginScrollSite('owner.p', 'req_1', 'Pane', {
      bodyRows: 4,
      contentRows: 12,
      maxOffset: 8,
      offset: 0,
    })
    const before = getRasterFrameVersion()
    await dispatchPersonUiScroll({
      plugin: 'owner.p',
      component: 'Pane',
      requestId: 'req_1',
      offset: 3,
      by: 3,
      bodyRows: 4,
      contentRows: 12,
    })
    expect(getPluginScrollSite('owner.p', 'req_1')?.offset).toBe(3)
    expect(getRasterFrameVersion()).toBeGreaterThan(before)
  })

  test('holdPluginSite keys component:requestId so Pane and AbovePrompt can share requestId', () => {
    registerPluginScrollSite('owner.p', 'shared', 'Pane', { bodyRows: 2 })
    registerPluginScrollSite('owner.p', 'shared', 'AbovePrompt', {
      bodyRows: 4,
    })
    expect(getPluginScrollSite('owner.p', 'shared', 'Pane')?.bodyRows).toBe(2)
    expect(
      getPluginScrollSite('owner.p', 'shared', 'AbovePrompt')?.bodyRows,
    ).toBe(4)
    unregisterPluginScrollSite('owner.p', 'shared', 'Pane')
    expect(
      getPluginScrollSite('owner.p', 'shared', 'AbovePrompt')?.bodyRows,
    ).toBe(4)
    unregisterPluginScrollSite('owner.p', 'shared', 'AbovePrompt')
  })

  test('followEnd and bind layout use Ide Fj not first-match', () => {
    registerPluginScrollSite('owner.p', 'shared', 'Pane', {
      maxOffset: 5,
      offset: 5,
    })
    registerPluginScrollSite('owner.p', 'shared', 'AbovePrompt', {
      maxOffset: 8,
      offset: 0,
    })
    expect(followPluginScrollSiteEnd('owner.p', 'shared', 'AbovePrompt')).toBe(
      true,
    )
    expect(getPluginScrollSite('owner.p', 'shared', 'Pane')?.followEnd).toBe(
      false,
    )
    expect(
      getPluginScrollSite('owner.p', 'shared', 'AbovePrompt')?.followEnd,
    ).toBe(true)
    expect(
      getPluginScrollSite('owner.p', 'shared', 'AbovePrompt')?.offset,
    ).toBe(8)
    unregisterPluginScrollSite('owner.p', 'shared', 'Pane')
    unregisterPluginScrollSite('owner.p', 'shared', 'AbovePrompt')
  })

  test('updatePluginScrollSite with component uses Ide Fj key not first-match', () => {
    registerPluginScrollSite('owner.p', 'shared', 'Pane', { bodyRows: 2 })
    registerPluginScrollSite('owner.p', 'shared', 'AbovePrompt', {
      bodyRows: 4,
    })
    updatePluginScrollSite('owner.p', 'shared', { bodyRows: 9 }, 'AbovePrompt')
    expect(getPluginScrollSite('owner.p', 'shared', 'Pane')?.bodyRows).toBe(2)
    expect(
      getPluginScrollSite('owner.p', 'shared', 'AbovePrompt')?.bodyRows,
    ).toBe(9)
    unregisterPluginScrollSite('owner.p', 'shared', 'Pane')
    unregisterPluginScrollSite('owner.p', 'shared', 'AbovePrompt')
  })
})
