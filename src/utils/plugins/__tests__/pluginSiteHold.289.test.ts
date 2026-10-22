/**
 * densable 2.1.289 `pr` / `nr` / `sr` / `d8n` / `RZ`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  G2E_COMPONENTS,
  Qe,
  RZ,
  d8n,
  isEngineFallback,
  isG2eComponent,
  jo,
  nextHeldSiteRows,
  nr,
  siteIsOff,
  sr,
  type HeldSiteRows,
  type ScreenSiteNode,
} from '../pluginSiteHold.js'

const SRC = readFileSync(join(import.meta.dir, '../pluginSiteHold.ts'), 'utf8')
const PANES = readFileSync(
  join(import.meta.dir, '../../../components/PluginRasterPanes.tsx'),
  'utf8',
)

const empty: HeldSiteRows = {
  rows: undefined,
  wasOff: false,
  input: 'a',
  drawn: { type: 'Box' },
}

describe('densable 2.1.289 pr / nr / sr', () => {
  test('RZ engine sentinel and g2e card list', () => {
    expect(RZ).toEqual({ type: 'engine', ref: 0 })
    expect(isEngineFallback(RZ)).toBe(true)
    expect(G2E_COMPONENTS).toContain('UserMessage')
    expect(G2E_COMPONENTS).not.toContain('AbovePrompt')
    expect(SRC).not.toContain('step aside')
  })

  test('d8n: missing / object / explicit null', () => {
    expect(d8n({ props: {} })).toBeUndefined()
    expect(d8n({ props: { onScreen: { first: 0, last: 2, of: 10 } } })).toEqual(
      {
        first: 0,
        last: 2,
        of: 10,
      },
    )
    expect(d8n({ props: { onScreen: null } })).toBeNull()
  })

  test('sr first-off holds lastRows; nr fallback releases so cards take the space', () => {
    const held = sr(empty, {
      input: 'a',
      drawn: RZ,
      lastRows: 6,
      contentRows: 0,
    })
    expect(held).toEqual({
      rows: 6,
      wasOff: true,
      input: 'a',
      drawn: RZ,
    })
    const released = nr(
      { rows: 6, wasOff: true, input: 'a', drawn: { type: 'Box' } },
      {
        input: 'a',
        drawn: RZ,
        isFallback: true,
        contentRows: 0,
      },
    )
    expect(released.rows).toBeUndefined()
    expect(released.wasOff).toBe(false)
  })

  test('nextHeldSiteRows: off holds, on+fallback releases', () => {
    const off = nextHeldSiteRows(empty, {
      isOff: true,
      input: 'band',
      drawn: RZ,
      lastRows: 4,
      contentRows: 0,
    })
    expect(off.rows).toBe(4)
    const on = nextHeldSiteRows(off, {
      isOff: false,
      input: 'band',
      drawn: RZ,
      isFallback: true,
      contentRows: 0,
    })
    expect(on.rows).toBeUndefined()
  })

  test('t7t hosts wire minHeight; UserMessage ar/g2e injects onScreen', () => {
    expect(PANES).toContain('useHeldSiteRows')
    expect(PANES).toContain('useSiteMeasure')
    expect(PANES).toContain('isG2eComponent')
    expect(PANES).toContain('isFullscreenEnvEnabled')
    expect(PANES).toContain('siteIsOff')
    expect(PANES).toContain('aboveHeldRows')
    expect(PANES).toContain('userHeldRows')
    expect(PANES).toContain('paneHeldRows')
    expect(PANES).toContain('minHeight: aboveHeldRows')
    expect(PANES).toContain('minHeight: userHeldRows')
    expect(PANES).toContain('setDrawn(RZ)')
    expect(PANES).toContain('onScreen !== undefined && { onScreen }')
    expect(PANES).toContain('subscribeFrames')
    expect(SRC).toContain('subscribeFrames')
    const user = PANES.slice(
      PANES.indexOf('export function PluginUserMessageSite'),
    )
    expect(user).not.toContain('subscribeRasterFrames')
    expect(isG2eComponent('UserMessage')).toBe(true)
    expect(isG2eComponent('AbovePrompt')).toBe(false)
    expect(siteIsOff(true, { props: {} })).toBe(false)
    expect(siteIsOff(true, { props: { onScreen: null } })).toBe(true)
    expect(siteIsOff(false, { props: { onScreen: null } })).toBe(false)
  })

  test('Qe / jo: display none and off-screen clip are null', () => {
    const hidden: ScreenSiteNode = {
      yogaNode: {
        getDisplay: () => 'none',
        getComputedTop: () => 0,
        getComputedHeight: () => 4,
        getComputedBorder: () => 0,
        getComputedPadding: () => 0,
      },
    }
    expect(Qe(hidden)).toBeNull()
    const clip: ScreenSiteNode = {
      scrollTop: 20,
      yogaNode: {
        getDisplay: () => 'flex',
        getComputedTop: () => 0,
        getComputedHeight: () => 10,
        getComputedBorder: () => 0,
        getComputedPadding: () => 0,
      },
    }
    const item: ScreenSiteNode = {
      yogaNode: {
        getDisplay: () => 'flex',
        getComputedTop: () => 0,
        getComputedHeight: () => 4,
        getComputedBorder: () => 0,
        getComputedPadding: () => 0,
      },
    }
    expect(jo(item, clip, { top: 0, itemTop: 0, itemHeight: 4 })).toBeNull()
    expect(jo(item, clip, { top: 20, itemTop: 20, itemHeight: 4 })).toEqual({
      first: 0,
      last: 3,
      of: 4,
    })
  })

  test('UserMessage BO wraps only the plugin tree', () => {
    const start = PANES.indexOf('export function PluginUserMessageSite')
    const body = PANES.slice(start, start + 3500)
    expect(body).toContain('hasPluginDrawing')
    expect(body).toContain('fallback={engine}')
    expect(body).toContain('component="UserMessage"')
    expect(body).not.toContain("rebuild(drawn, '', requestId, children)")
    expect(body).not.toContain(
      "rebuild(drawn, '', requestId, undefined, 'Pane'",
    )
  })
})
