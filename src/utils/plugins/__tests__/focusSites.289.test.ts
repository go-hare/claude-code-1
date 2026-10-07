import { afterEach, describe, expect, test } from 'bun:test'
import {
  bindPluginFocusHost,
  dispatchUiFocus,
  getPluginFocusSite,
  handleHostOp,
  noteDrawnElement,
  offerPlacement,
  registerPluginScrollSite,
  setLoadedFunctionHooksModules,
  unregisterPluginScrollSite,
} from '../functionHooksModules.js'

afterEach(() => {
  setLoadedFunctionHooksModules([])
  unregisterPluginScrollSite('plug', 'pane-1')
  unregisterPluginScrollSite('other', 'pane-1')
  unregisterPluginScrollSite('plug', 'pane-2')
})

async function focus(
  args: Record<string, unknown>,
  plugin = 'plug',
): Promise<{ deny?: string } | undefined> {
  return (await handleHostOp('ui.focus', [args], plugin)) as
    | { deny?: string }
    | undefined
}

async function tq(input: {
  component: 'Pane' | 'AbovePrompt'
  requestId: string
  plugin?: string
  element?: string
  origin: { kind: string; name?: string }
}): Promise<{ deny?: string }> {
  return await Promise.resolve(dispatchUiFocus(input))
}

describe('densable 2.1.289 focusSites Map (g9e/Tq/lSo)', () => {
  test("lSo missing identity → not this plugin's site", async () => {
    expect(await focus({ requestId: 'pane-1', key: 'k' })).toEqual({
      deny: "not this plugin's site",
    })
  })

  test('drawn key commits after ui.open; snapshot on separate Map', async () => {
    expect(await handleHostOp('ui.open', [{ id: 'pane-1' }], 'plug')).toEqual({
      isPlaced: true,
    })
    noteDrawnElement('plug', 'pane-1', 'k')
    expect(getPluginFocusSite('plug', 'pane-1')?.keyCount).toBe(1)
    expect(await focus({ requestId: 'pane-1', key: 'k' })).toEqual({})
    expect(getPluginFocusSite('plug', 'pane-1')?.holder).toBe('plug')
  })

  test('lSo missing drawn key → no element of its own is drawn under that key', async () => {
    expect(await handleHostOp('ui.open', [{ id: 'pane-1' }], 'plug')).toEqual({
      isPlaced: true,
    })
    expect(await focus({ requestId: 'pane-1', key: 'missing' })).toEqual({
      deny: 'no element of its own is drawn under that key',
    })
  })

  test("Tq foreign origin vs owner → not this plugin's site", async () => {
    expect(await handleHostOp('ui.open', [{ id: 'pane-1' }], 'plug')).toEqual({
      isPlaced: true,
    })
    noteDrawnElement('plug', 'pane-1', 'k')
    expect(
      await tq({
        component: 'Pane',
        requestId: 'pane-1',
        plugin: 'plug',
        element: 'k',
        origin: { kind: 'plugin', name: 'other' },
      }),
    ).toEqual({ deny: "not this plugin's site" })
  })

  test('Tq unshown pane does not hold the keyboard', async () => {
    expect(await handleHostOp('ui.open', [{ id: 'pane-1' }], 'plug')).toEqual({
      isPlaced: true,
    })
    noteDrawnElement('plug', 'pane-1', 'k')
    expect(await focus({ requestId: 'pane-1', key: 'k' })).toEqual({})
    registerPluginScrollSite('plug', 'pane-2', 'Pane')
    noteDrawnElement('plug', 'pane-2', 'k2')
    expect(
      await tq({
        component: 'Pane',
        requestId: 'pane-2',
        plugin: 'plug',
        element: 'k2',
        origin: { kind: 'plugin', name: 'plug' },
      }),
    ).toEqual({ deny: 'that site does not hold the keyboard' })
  })

  test('setLoadedFunctionHooksModules clears focusSites', async () => {
    registerPluginScrollSite('plug', 'pane-1', 'Pane')
    noteDrawnElement('plug', 'pane-1', 'k')
    expect(getPluginFocusSite('plug', 'pane-1')?.keyCount).toBe(1)
    setLoadedFunctionHooksModules([])
    expect(getPluginFocusSite('plug', 'pane-1')).toBeUndefined()
  })

  test('lSo wait: bind after focus starts then commits', async () => {
    const release = offerPlacement()
    expect(await handleHostOp('ui.open', [{ id: 'pane-1' }], 'plug')).toEqual({
      isPlaced: true,
    })
    const pending = focus({ requestId: 'pane-1', key: 'k' })
    await Promise.resolve()
    const unbind = bindPluginFocusHost({
      component: 'Pane',
      requestId: 'pane-1',
      owner: 'plug',
      isHeldNow: () => true,
      holderNow: () => 'plug',
      hasElement: (_plugin, element) => element === 'k',
      commit: () => undefined,
    })
    expect(await pending).toEqual({})
    unbind()
    release()
  })

  test('XHo bind commit: person race → the focus moved meanwhile', async () => {
    const unbind = bindPluginFocusHost({
      component: 'Pane',
      requestId: 'pane-1',
      owner: 'plug',
      isHeldNow: () => true,
      holderNow: () => 'plug',
      hasElement: () => true,
      commit: input =>
        input.origin.kind === 'person'
          ? 'the focus moved meanwhile'
          : undefined,
    })
    expect(
      await tq({
        component: 'Pane',
        requestId: 'pane-1',
        plugin: 'plug',
        element: 'k',
        origin: { kind: 'person' },
      }),
    ).toEqual({ deny: 'the focus moved meanwhile' })
    unbind()
  })

  test('XHo bind isHeldNow false → that site does not hold the keyboard', async () => {
    const unbind = bindPluginFocusHost({
      component: 'Pane',
      requestId: 'pane-1',
      owner: 'plug',
      isHeldNow: () => false,
      holderNow: () => undefined,
      hasElement: () => true,
      commit: () => undefined,
    })
    expect(
      await tq({
        component: 'Pane',
        requestId: 'pane-1',
        plugin: 'plug',
        element: 'k',
        origin: { kind: 'plugin', name: 'plug' },
      }),
    ).toEqual({
      deny: 'that site does not hold the keyboard',
    })
    unbind()
  })

  test('Tq missing site → no such site', async () => {
    expect(
      await tq({
        component: 'Pane',
        requestId: 'ghost',
        plugin: 'plug',
        element: 'k',
        origin: { kind: 'plugin', name: 'plug' },
      }),
    ).toEqual({ deny: 'no such site' })
  })
})
