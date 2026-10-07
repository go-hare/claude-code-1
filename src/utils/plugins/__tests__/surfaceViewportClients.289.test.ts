import { afterEach, describe, expect, test } from 'bun:test'
import {
  attachSurfaceViewportClient,
  clientsWithFullscreenKey,
  clientsWithViewport,
  placementFromAttachedSurfaces,
  resetSurfaceViewportClientsForTests,
} from '../surfaceViewportClients.js'

afterEach(() => {
  resetSurfaceViewportClientsForTests()
})

describe('densable 2.1.289 empty Epn / surfaceViewportClients', () => {
  test('empty registry → placementFromAttachedSurfaces undefined', () => {
    expect(placementFromAttachedSurfaces()).toBeUndefined()
    expect(clientsWithViewport()).toEqual([])
    expect(clientsWithFullscreenKey()).toEqual([])
  })

  test('viewport without isFullscreen key → deny', () => {
    attachSurfaceViewportClient({
      clientId: 'c1',
      surface: 'desktop',
      viewport: { columns: 120, rows: 40 },
    })
    const got = placementFromAttachedSurfaces()
    expect(got?.isPlaced).toBe(false)
    expect(got && 'reason' in got ? got.reason : '').toContain(
      'no attached surface places panes (c1)',
    )
  })

  test('isFullscreen key present (even false) → place', () => {
    attachSurfaceViewportClient({
      clientId: 'c2',
      surface: 'vscode',
      viewport: { columns: 80, rows: 24, isFullscreen: false },
    })
    expect(placementFromAttachedSurfaces()).toEqual({ isPlaced: true })
  })
})
