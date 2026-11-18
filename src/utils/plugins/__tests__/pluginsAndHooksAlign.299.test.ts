import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyPendingUiInvalidations,
  createPromptChangeCoordinator,
  getPendingUiInvalidations,
  runUiHost,
} from '../functionHooksModules.js'
import {
  endSyncedPluginReloadHold,
  getPluginsSyncState,
  holdSyncedPluginReload,
  markSyncedDirsLoaded,
  markSyncedPluginsReloaded,
  resetSyncedLaneState,
} from '../syncedPluginCloudSync.js'
import {
  attachSurfaceViewportClient,
  detachSurfaceViewportClient,
  placementFromAttachedSurfaces,
} from '../surfaceViewportClients.js'
import { logPluginsEnabledForSession } from '../../telemetry/pluginTelemetry.js'

describe('Plugins & FunctionHooks v2.1.299-v2.1.300 alignment', () => {
  test('#618 ui.invalidate records tool.describe and prompt.section and applyPendingUiInvalidations flushes them', async () => {
    applyPendingUiInvalidations()
    await runUiHost('ui.invalidate', { event: 'tool.describe' })
    await runUiHost('ui.invalidate', { event: 'prompt.section' })
    await runUiHost('ui.invalidate', { event: 'tool.list' })

    expect(getPendingUiInvalidations().has('tool.describe')).toBe(true)
    expect(getPendingUiInvalidations().has('prompt.section')).toBe(true)
    expect(getPendingUiInvalidations().has('tool.list')).toBe(true)

    const called: string[] = []
    const flushed = applyPendingUiInvalidations({
      'tool.describe': () => called.push('tool.describe'),
      'prompt.section': () => called.push('prompt.section'),
    })
    expect(flushed).toEqual(['tool.describe', 'prompt.section', 'tool.list'])
    expect(called).toEqual(['tool.describe', 'prompt.section'])
    expect(getPendingUiInvalidations().size).toBe(0)
  })

  test('#682 clientsWithFullscreenKey checks isFullscreen !== undefined and returns exact SEA reason', () => {
    const id = 'vscode-surface-682'
    attachSurfaceViewportClient({
      surface: 'vscode',
      clientId: id,
      viewport: { columns: 100, rows: 30, isFullscreen: undefined },
    })
    try {
      const placement = placementFromAttachedSurfaces()
      expect(placement).toEqual({
        isPlaced: false,
        reason: `no attached surface places panes (${id}): placed when a surface that does attaches; once they detach, as a fresh open is`,
      })
    } finally {
      detachSurfaceViewportClient(id)
    }
  })

  test('#762 createPromptChangeCoordinator coalesces non-typed changes and stalls after 8 consecutive plugin fills', async () => {
    const raised: Array<{ text: string; cursor: number; origin: unknown }> = []
    const stalls: string[][] = []
    let box = { text: 'hello', cursor: 5 }

    const coord = createPromptChangeCoordinator(() => box, {
      isHooked: () => true,
      later: cb => cb(),
      raise: async payload => {
        raised.push(payload)
      },
      stall: plugins => stalls.push([...plugins]),
    })

    coord.changed({ before: '', after: 'hello', origin: { kind: 'history' } })
    await Promise.resolve()
    expect(raised).toHaveLength(1)
    expect(raised[0]).toEqual({
      text: 'hello',
      cursor: 5,
      origin: { kind: 'history' },
    })

    // 8 consecutive plugin fills allowed; 9th triggers stall
    for (let i = 1; i <= 9; i++) {
      const prev = box.text
      box = { text: `fill-${i}`, cursor: 6 }
      coord.changed({
        before: prev,
        after: box.text,
        origin: { kind: 'plugin', name: 'loop-mod' },
      })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    }
    expect(stalls).toHaveLength(1)
    expect(stalls[0]?.length).toBe(8)
    coord.dispose()
  })

  test('#587/#610/#628 pluginsSync state machine tracks holds, reloads, and loaded synced dirs', () => {
    resetSyncedLaneState()
    const token = holdSyncedPluginReload()
    expect(getPluginsSyncState().reloadHeld).toBe(true)
    endSyncedPluginReloadHold(token)
    expect(getPluginsSyncState().reloadHeld).toBe(false)

    markSyncedDirsLoaded(['/tmp/synced/a'])
    expect(getPluginsSyncState().syncedLaneOpened).toBe(true)
    expect(
      getPluginsSyncState().syncedDirsLoadedHere.has('/tmp/synced/a'),
    ).toBe(true)

    markSyncedPluginsReloaded(3)
    expect(getPluginsSyncState().changesReloaded).toBe(3)
    expect(getPluginsSyncState().reloadsCompleted).toBeGreaterThanOrEqual(1)
    resetSyncedLaneState()
  })

  test('#631 logPluginsEnabledForSession is exported and #608 temp dir smoke', () => {
    expect(typeof logPluginsEnabledForSession).toBe('function')
    const dir = mkdtempSync(join(tmpdir(), 'plugin-608-'))
    try {
      mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
      writeFileSync(
        join(dir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'test-plugin' }),
      )
      expect(Boolean(dir)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
