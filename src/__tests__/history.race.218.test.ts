/**
 * densable 2.1.218 #20 — prompt history race: snapshot-then-filter flush,
 * consecutive-dedupe, removeLast mid-flush.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setProjectRoot } from '../bootstrap/state.js'
import * as realEnvUtils from '../utils/envUtils.js'
import * as realResidualGates from '../utils/residualFinalEnvGates.js'
import { debugMock } from '../../tests/mocks/debug.js'
import { snapshotModuleExports } from '../../tests/mocks/settings.js'

let tmpHome: string

// Snapshot BEFORE mock.module — live namespace rebinds under Bun.
const envUtilsSnap = snapshotModuleExports(realEnvUtils)
const residualGatesSnap = snapshotModuleExports(realResidualGates)

// Preserve full residual gate surface — incomplete mocks pollute sibling files.
mock.module('src/utils/residualFinalEnvGates.js', () => ({
  ...residualGatesSnap,
  shouldSkipPromptHistory: () => false,
}))

mock.module('src/utils/cleanupRegistry.js', () => ({
  registerCleanup: () => {},
}))

// Complete debug surface — incomplete {logForDebugging} drops isDebugToStdErr
// and poisons /tui co-suites under process-global mock.module.
mock.module('src/utils/debug.js', debugMock)
mock.module('src/utils/debug.ts', debugMock)

// Preserve full envUtils surface — incomplete mocks pollute sibling files
// (isEnvTruthy etc.) under Bun process-global mock.module.
mock.module('src/utils/envUtils.js', () => ({
  ...envUtilsSnap,
  getClaudeConfigHomeDir: Object.assign(() => tmpHome, {
    cache: { clear: () => {}, get: () => undefined },
  }),
}))

mock.module('src/utils/pasteStore.js', () => ({
  hashPastedText: (s: string) => `h:${s.length}`,
  storePastedText: async () => {},
  retrievePastedText: async () => null,
}))

mock.module('src/utils/lockfile.js', () => ({
  lock: async () => async () => {},
}))

const {
  addToHistory,
  removeLastFromHistory,
  clearPendingHistoryEntries,
  getHistory,
} = await import('../history.js')

function historyPath(): string {
  return join(tmpHome, 'history.jsonl')
}

function readDiskLines(): string[] {
  try {
    const raw = readFileSync(historyPath(), 'utf8')
    return raw.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function drain(): Promise<void> {
  // densable cLd sleeps 500ms before re-flushing leftover pending after a
  // successful write — wait past that, then until line count is stable.
  await new Promise(r => setTimeout(r, 700))
  for (let i = 0; i < 40; i++) {
    const a = readDiskLines().length
    await new Promise(r => setTimeout(r, 50))
    const b = readDiskLines().length
    if (a === b) return
  }
}

describe('densable 2.1.218 #20 history race', () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'hist218-'))
    setProjectRoot('/proj-history-218')
    clearPendingHistoryEntries()
  })

  afterEach(() => {
    clearPendingHistoryEntries()
    try {
      rmSync(tmpHome, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  afterAll(() => {
    // Explicit restore with pre-mock snapshots — do NOT mock.restore() after
    // re-registering (restore can re-apply last factories that close over tmpHome).
    mock.module('src/utils/envUtils.js', () => ({ ...envUtilsSnap }))
    mock.module('src/utils/residualFinalEnvGates.js', () => ({
      ...residualGatesSnap,
    }))
  })

  test('flush keeps concurrent adds: two sequential adds both land once', async () => {
    addToHistory('first')
    addToHistory('second')
    await drain()
    const lines = readDiskLines()
    const displays = lines.map(l => JSON.parse(l).display as string)
    expect(displays).toContain('first')
    expect(displays).toContain('second')
    expect(displays.filter(d => d === 'first').length).toBe(1)
    expect(displays.filter(d => d === 'second').length).toBe(1)
  })

  test('_ty consecutive duplicate suppress does not double-write', async () => {
    addToHistory('same')
    addToHistory('same')
    await drain()
    const lines = readDiskLines()
    const same = lines.filter(l => JSON.parse(l).display === 'same')
    expect(same.length).toBe(1)
  })

  test('removeLastFromHistory pops pending before flush lands', async () => {
    addToHistory('undo-me')
    removeLastFromHistory()
    await drain()
    const lines = readDiskLines()
    const hit = lines.filter(l => JSON.parse(l).display === 'undo-me')
    if (hit.length > 0) {
      const entries: string[] = []
      for await (const e of getHistory()) {
        entries.push(e.display)
      }
      expect(entries).not.toContain('undo-me')
    } else {
      expect(hit.length).toBe(0)
    }
  })

  test('removeLast after consecutive-dedupe is no-op on prior entry', async () => {
    addToHistory('keep')
    await drain()
    addToHistory('keep') // deduped
    removeLastFromHistory() // clears VDo only
    await drain()
    const lines = readDiskLines()
    const keep = lines.filter(l => JSON.parse(l).display === 'keep')
    expect(keep.length).toBe(1)
  })
})
