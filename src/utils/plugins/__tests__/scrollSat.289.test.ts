import { afterEach, describe, expect, test } from 'bun:test'
import {
  commitPluginScrollSite,
  dispatchPersonUiScroll,
  getPluginScrollSite,
  getRasterFrameVersion,
  isForeignPluginScrollOrigin,
  registerPluginScrollSite,
  setLoadedFunctionHooksModules,
  unregisterPluginScrollSite,
} from '../functionHooksModules.js'

afterEach(() => {
  setLoadedFunctionHooksModules([])
  unregisterPluginScrollSite('owner.p', 'req_1')
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
})
