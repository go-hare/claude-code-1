/**
 * densable 2.1.283 leftover gold `Zgt` @202277137 wrap.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  LEGACY_CONFIG_RETRY_MS,
  createLegacyConfigLocator,
  legacyConfigFileCache,
  pinnedLegacyEnv,
  refreshLegacyConfigIfDue,
  type LegacyConfigBag,
} from '../legacyConfigFile.js'

const src = readFileSync(
  join(import.meta.dir, '../legacyConfigFile.ts'),
  'utf8',
)

describe('legacyConfigFile 283 leftover gold Zgt wrap', () => {
  test('source-locks gold Zgt/Ni/Mi; no minify public API', () => {
    expect(src).toContain('gold `Zgt` @202277137')
    expect(src).toContain('legacyConfigFile')
    expect(src).toContain('gold leftover unique `Ni` @202276699')
    expect(src).toContain('gold leftover unique `Mi` @202277060')
    expect(src).not.toMatch(/^export (async )?function Zgt\b/m)
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('new WebSocket')
  })

  test('ruo pin: undefined uses fallback; null omits', () => {
    expect(pinnedLegacyEnv({}, { A: '1' })).toEqual({ A: '1' })
    expect(pinnedLegacyEnv({ legacyEnvPin: null }, { A: '1' })).toBeUndefined()
    expect(pinnedLegacyEnv({ legacyEnvPin: { B: '2' } }, { A: '1' })).toEqual({
      B: '2',
    })
  })

  test('Zgt caches locator; alias retries 30000; ENOENT no retry', async () => {
    expect(LEGACY_CONFIG_RETRY_MS).toBe(30_000)
    const bag: LegacyConfigBag = {}
    let locates = 0
    const first = legacyConfigFileCache(bag, {
      path: '/tmp/legacy.json',
      env: { K: 'v' },
      locateReal: async () => {
        locates += 1
        return { real: '/real/legacy.json', aliased: false }
      },
    })
    expect(bag.legacyConfigFile).toBe(first)
    expect(first.path).toBe('/tmp/legacy.json')
    expect(first.env).toEqual({ K: 'v' })
    await Promise.resolve()
    expect(first.real).toBe('/real/legacy.json')
    expect(legacyConfigFileCache(bag, { path: '/other' })).toBe(first)
    expect(locates).toBe(1)

    const aliased = createLegacyConfigLocator(
      '/alias',
      undefined,
      async () => ({
        real: '/x',
        aliased: true,
      }),
    )
    await Promise.resolve()
    expect(aliased.real).toBe('unresolvable')
    expect(aliased.retryAt).toBeGreaterThan(Date.now())

    const missing = createLegacyConfigLocator(
      '/missing',
      undefined,
      async () => {
        const err = new Error('gone') as Error & { code: string }
        err.code = 'ENOENT'
        throw err
      },
    )
    await Promise.resolve()
    expect(missing.real).toBe('unresolvable')
    expect(missing.retryAt).toBeUndefined()

    let retried = 0
    const due = createLegacyConfigLocator('/due', undefined, async () => {
      retried += 1
      return { real: '/due-real', aliased: false }
    })
    await Promise.resolve()
    due.retryAt = Date.now() - 1
    refreshLegacyConfigIfDue(due)
    await Promise.resolve()
    expect(retried).toBe(2)
  })
})
