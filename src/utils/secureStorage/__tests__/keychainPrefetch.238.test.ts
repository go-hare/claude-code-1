/**
 * densable 2.1.238 #31 — joa / Akd / LDn / F8o / mkd / Uoa.
 * Injects spawn via `_setKeychainPrefetchExecFileForTesting` (do not
 * mock.module `child_process` — process-global last-write-wins).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  KEYCHAIN_PREFETCH_FASTPATH_BUDGET_MS,
  _resetKeychainPrefetchForTesting,
  _setKeychainPrefetchExecFileForTesting,
  clearLegacyApiKeyPrefetch,
  ensureKeychainPrefetchCompleted,
  getLegacyApiKeyPrefetchResult,
  startKeychainPrefetch,
} from '../keychainPrefetch.js'
import {
  CREDENTIALS_SERVICE_SUFFIX,
  clearKeychainCache,
  getMacOsKeychainStorageServiceName,
  keychainCacheState,
} from '../macOsKeychainHelpers.js'

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void

type SpawnCall = {
  file: string
  args: readonly string[]
  options: { encoding: string; timeout: number; windowsHide: boolean }
  callback: ExecFileCallback
}

function serviceOf(call: SpawnCall): string {
  const i = call.args.indexOf('-s')
  return i >= 0 ? String(call.args[i + 1]) : ''
}

function killedError(): Error & { killed: boolean } {
  return Object.assign(new Error('timed out'), { killed: true })
}

describe('densable 2.1.238 keychain prefetch (joa/LDn/Uoa)', () => {
  const prevSimple = process.env.CLAUDE_CODE_SIMPLE
  let calls: SpawnCall[]

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_SIMPLE
    _resetKeychainPrefetchForTesting()
    clearKeychainCache()
    keychainCacheState.cache = { data: null, cachedAt: 0 }
    calls = []
    _setKeychainPrefetchExecFileForTesting((file, args, options, callback) => {
      calls.push({ file, args, options, callback })
    })
  })

  afterEach(() => {
    _resetKeychainPrefetchForTesting()
    if (prevSimple === undefined) delete process.env.CLAUDE_CODE_SIMPLE
    else process.env.CLAUDE_CODE_SIMPLE = prevSimple
  })

  test('Uoa budget is 250ms', () => {
    expect(KEYCHAIN_PREFETCH_FASTPATH_BUDGET_MS).toBe(250)
  })

  test('isBareMode no-op — no spawn', () => {
    process.env.CLAUDE_CODE_SIMPLE = '1'
    startKeychainPrefetch()
    expect(calls).toHaveLength(0)
    expect(getLegacyApiKeyPrefetchResult()).toBeNull()
  })

  test('FHr pending until spawn result — F8o null in-flight', () => {
    startKeychainPrefetch()
    expect(calls).toHaveLength(2)
    expect(getLegacyApiKeyPrefetchResult()).toBeNull()
    expect(calls[0]?.file).toBe('security')
    expect(calls[0]?.options.windowsHide).toBe(true)
    expect(calls[0]?.options.timeout).toBe(10_000)
    expect(calls[0]?.options.encoding).toBe('utf-8')
  })

  test('legacy spawn completes independently of oauth', async () => {
    startKeychainPrefetch()
    const oauthName = getMacOsKeychainStorageServiceName(
      CREDENTIALS_SERVICE_SUFFIX,
    )
    const legacyName = getMacOsKeychainStorageServiceName()
    const oauth = calls.find(c => serviceOf(c) === oauthName)
    const legacy = calls.find(c => serviceOf(c) === legacyName)
    expect(oauth).toBeDefined()
    expect(legacy).toBeDefined()

    legacy!.callback(null, 'sk-legacy\n', '')
    await Promise.resolve()
    expect(getLegacyApiKeyPrefetchResult()).toEqual({ stdout: 'sk-legacy' })

    oauth!.callback(null, '{"accessToken":"tok"}', '')
    await ensureKeychainPrefetchCompleted()
    expect(keychainCacheState.cache.data).toEqual({ accessToken: 'tok' })
    expect(keychainCacheState.cache.cachedAt).toBeGreaterThan(0)
  })

  test('timeout (killed) → null spawn, FHr stays pending, no prime', async () => {
    startKeychainPrefetch()
    for (const c of calls) c.callback(killedError(), '', '')
    await ensureKeychainPrefetchCompleted()
    expect(getLegacyApiKeyPrefetchResult()).toBeNull()
    expect(keychainCacheState.cache.cachedAt).toBe(0)
  })

  test('Akd catch → null (execFile throws)', async () => {
    _setKeychainPrefetchExecFileForTesting(() => {
      throw new Error('spawn ENOENT')
    })
    startKeychainPrefetch()
    await ensureKeychainPrefetchCompleted()
    expect(getLegacyApiKeyPrefetchResult()).toBeNull()
    expect(keychainCacheState.cache.cachedAt).toBe(0)
  })

  test('mkd skips when generation drifted', async () => {
    const generationAtStart = keychainCacheState.generation
    startKeychainPrefetch()
    keychainCacheState.generation = generationAtStart + 1
    for (const c of calls) {
      c.callback(null, '{"accessToken":"stale"}', '')
    }
    await ensureKeychainPrefetchCompleted()
    expect(keychainCacheState.cache.cachedAt).toBe(0)
    expect(keychainCacheState.cache.data).toBeNull()
  })

  test('mkd skips when cachedAt already set', async () => {
    keychainCacheState.cache = {
      data: { accessToken: 'authoritative' },
      cachedAt: Date.now(),
    }
    startKeychainPrefetch()
    for (const c of calls) {
      c.callback(null, '{"accessToken":"prefetch"}', '')
    }
    await ensureKeychainPrefetchCompleted()
    expect(keychainCacheState.cache.data).toEqual({
      accessToken: 'authoritative',
    })
  })

  test('LDn(Uoa) returns before hung spawn; unbounded LDn waits', async () => {
    startKeychainPrefetch()
    const t0 = Date.now()
    await ensureKeychainPrefetchCompleted(KEYCHAIN_PREFETCH_FASTPATH_BUDGET_MS)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(getLegacyApiKeyPrefetchResult()).toBeNull()

    const done = ensureKeychainPrefetchCompleted()
    for (const c of calls) c.callback(null, '', '')
    await done
    expect(getLegacyApiKeyPrefetchResult()).toEqual({ stdout: null })
  })

  test('$8o clears completed prefetch', async () => {
    startKeychainPrefetch()
    for (const c of calls) c.callback(null, 'sk-x', '')
    await ensureKeychainPrefetchCompleted()
    expect(getLegacyApiKeyPrefetchResult()).toEqual({ stdout: 'sk-x' })
    clearLegacyApiKeyPrefetch()
    expect(getLegacyApiKeyPrefetchResult()).toBeNull()
  })

  test('second startKeychainPrefetch is a no-op', () => {
    startKeychainPrefetch()
    expect(calls).toHaveLength(2)
    startKeychainPrefetch()
    expect(calls).toHaveLength(2)
  })

  test('exit-not-killed still yields {stdout:null} (entry missing)', async () => {
    startKeychainPrefetch()
    const err = Object.assign(new Error('not found'), { killed: false })
    for (const c of calls) c.callback(err, '', '')
    await ensureKeychainPrefetchCompleted()
    expect(getLegacyApiKeyPrefetchResult()).toEqual({ stdout: null })
  })
})
