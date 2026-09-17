/**
 * densable 2.1.246 AF — restore /pause-memory from worker internal.
 *
 * Official AF: if(e?.internal?.memory_toggled_off!==!0)return;
 *   Yv(!0), K("tengu_memory_toggle_restored",{}), k("[print.ts] restored …")
 * Yv = by = sessionFlags.replaceMemoryToggledOff; #s default false.
 * /pause-memory command isEnabled:()=>!1 — do not invent the slash.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  memoryToggledOff,
  replaceMemoryToggledOff,
  resetStateForTests,
} from '../../bootstrap/state.js'
import { restoreMemoryToggleFromWorkerState } from '../restoreMemoryToggle.js'

afterEach(() => {
  resetStateForTests()
})

describe('densable 2.1.246 AF memory toggle restore', () => {
  test('Yv/by: default false; replaceMemoryToggledOff writes #s', () => {
    expect(memoryToggledOff()).toBe(false)
    replaceMemoryToggledOff(true)
    expect(memoryToggledOff()).toBe(true)
    replaceMemoryToggledOff(false)
    expect(memoryToggledOff()).toBe(false)
  })

  test('AF: memory_toggled_off===true latches Yv(true)', () => {
    restoreMemoryToggleFromWorkerState({
      internal: { memory_toggled_off: true },
    })
    expect(memoryToggledOff()).toBe(true)
  })

  test('AF: missing / false / null are no-ops', () => {
    restoreMemoryToggleFromWorkerState(null)
    restoreMemoryToggleFromWorkerState({ internal: null })
    restoreMemoryToggleFromWorkerState({ internal: {} })
    restoreMemoryToggleFromWorkerState({
      internal: { memory_toggled_off: false },
    })
    restoreMemoryToggleFromWorkerState({
      internal: { memory_toggled_off: 1 },
    })
    expect(memoryToggledOff()).toBe(false)
  })

  test('print calls AF after restoredWorkerState; no empty iX', () => {
    const print = readFileSync(
      join(import.meta.dir, '../../cli/print.ts'),
      'utf8',
    )
    expect(print).toContain('restoreMemoryToggleFromWorkerState')
    expect(print).toContain('await structuredIO.restoredWorkerState')
    expect(print).not.toContain('function iX(')
    expect(print).not.toContain('planModeRestoredAtBoot')
    const af = readFileSync(
      join(import.meta.dir, '../restoreMemoryToggle.ts'),
      'utf8',
    )
    expect(af).toContain('memory_toggled_off !== true')
    expect(af).toContain('replaceMemoryToggledOff(true)')
    expect(af).toContain('tengu_memory_toggle_restored')
    expect(af).toContain(
      '[print.ts] restored /pause-memory toggle from prior worker epoch',
    )
  })
})
