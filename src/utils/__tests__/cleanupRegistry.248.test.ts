/**
 * Official `fe` / `W` / `Et` / `mEe` / `DYe` / `Vk` / `svt` / `tde` @178613195.
 * Leftover: host-owned cleanup + preExitFlush bags via WeakOwnerCache.
 *
 * Task suites stub registerCleanup via process-global mock.module — reclaim
 * the real snap (tests/mocks/taskSurface) before each assertion via require().
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { restoreCleanupRegistryModule } from '../../../tests/mocks/taskSurface.js'
import { resetSessionHostForTests } from '../sessionRoot.js'

function reclaimCleanupRegistry(): typeof import('../cleanupRegistry.js') {
  mock.module('src/utils/cleanupRegistry.js', restoreCleanupRegistryModule)
  mock.module('src/utils/cleanupRegistry.ts', restoreCleanupRegistryModule)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../cleanupRegistry.js') as typeof import('../cleanupRegistry.js')
}

describe('cleanupRegistry fe bags', () => {
  beforeEach(() => {
    reclaimCleanupRegistry()
    resetSessionHostForTests()
  })

  afterEach(() => {
    resetSessionHostForTests()
  })

  test('official tde is 2000', () => {
    const { CLEANUP_DRAIN_TIMEOUT_MS } = reclaimCleanupRegistry()
    expect(CLEANUP_DRAIN_TIMEOUT_MS).toBe(2000)
  })

  test('official DYe alias isCleanupDrainStarted', () => {
    const { isCleanupDrainStarted, cleanupDrainStarted } =
      reclaimCleanupRegistry()
    expect(isCleanupDrainStarted).toBe(cleanupDrainStarted)
  })

  test('registerCleanup + runCleanupFunctions drains once', async () => {
    const { registerCleanup, runCleanupFunctions, cleanupDrainStarted } =
      reclaimCleanupRegistry()
    let n = 0
    registerCleanup(async () => {
      n++
    })
    expect(cleanupDrainStarted()).toBe(false)
    await runCleanupFunctions()
    expect(n).toBe(1)
    expect(cleanupDrainStarted()).toBe(true)
    await runCleanupFunctions()
    expect(n).toBe(1)
    expect(cleanupDrainStarted()).toBe(true)
  })

  test('Et unregister + Symbol.dispose remove before drain', async () => {
    const { registerCleanup, runCleanupFunctions } = reclaimCleanupRegistry()
    let n = 0
    const unreg = registerCleanup(() => {
      n++
    })
    expect(typeof unreg[Symbol.dispose]).toBe('function')
    unreg()
    await runCleanupFunctions()
    expect(n).toBe(0)

    const unreg2 = registerCleanup(() => {
      n++
    })
    unreg2[Symbol.dispose]()
    await runCleanupFunctions()
    expect(n).toBe(0)
  })

  test('W drain allSettled throws first rejection', async () => {
    const { registerCleanup, runCleanupFunctions, cleanupDrainStarted } =
      reclaimCleanupRegistry()
    registerCleanup(async () => {
      throw new Error('cleanup-boom')
    })
    registerCleanup(async () => {})
    await expect(runCleanupFunctions()).rejects.toThrow('cleanup-boom')
    expect(cleanupDrainStarted()).toBe(true)
  })

  test('Et accepts Disposable / AsyncDisposable', async () => {
    const { registerCleanup, runCleanupFunctions } = reclaimCleanupRegistry()
    let disposed = 0
    let asyncDisposed = 0
    registerCleanup({
      [Symbol.dispose]() {
        disposed++
      },
    })
    registerCleanup({
      [Symbol.asyncDispose]() {
        asyncDisposed++
        return Promise.resolve()
      },
    })
    await runCleanupFunctions()
    expect(disposed).toBe(1)
    expect(asyncDisposed).toBe(1)
  })

  test('registerPreExitFlush + runPreExitFlush is leftover svt', async () => {
    const { registerPreExitFlush, runPreExitFlush } = reclaimCleanupRegistry()
    let n = 0
    registerPreExitFlush(async () => {
      n++
    })
    await runPreExitFlush()
    expect(n).toBe(1)
    await runPreExitFlush()
    expect(n).toBe(1)
  })
})

describe('diagLogs Qbt', () => {
  test('Qbt flushDiagLogs is c().flush() over CLAUDE_CODE_DIAGNOSTICS_FILE', () => {
    // Runtime write is polluted by bridge envReroute.243 mock.module(diagLogs);
    // assert the leftover Qbt wiring in source instead.
    const src = readFileSync(join(import.meta.dir, '../diagLogs.ts'), 'utf8')
    expect(src).toContain('export function flushDiagLogs')
    expect(src).toContain('return diagLogWriter().flush()')
    expect(src).toContain('CLAUDE_CODE_DIAGNOSTICS_FILE')
    expect(src).toContain('registerCleanup(() => this.flush())')
    expect(src).toContain('pendingWrite')
  })
})
