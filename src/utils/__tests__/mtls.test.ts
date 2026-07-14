import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearMTLSCache,
  didMtlsCertCacheChange,
  getLoadedMtlsCertPaths,
  loadMtlsCertFileAsync,
  loadMtlsCertFileSync,
  reloadMtlsCertsFromEnvAsync,
  resetMtlsCachesForTests,
  resolveMTLSConfigFromEnv,
} from '../mtls.js'

afterEach(() => {
  resetMtlsCachesForTests()
})

describe('mTLS densables (zsl/Ksl/b4t)', () => {
  test('didMtlsCertCacheChange densable', () => {
    expect(
      didMtlsCertCacheChange({
        prevCert: null,
        prevKey: null,
        nextCert: null,
        nextKey: null,
      }),
    ).toBe(false)
    expect(
      didMtlsCertCacheChange({
        prevCert: { path: '/a', content: '1' },
        prevKey: null,
        nextCert: { path: '/a', content: '1' },
        nextKey: null,
      }),
    ).toBe(false)
    expect(
      didMtlsCertCacheChange({
        prevCert: { path: '/a', content: '1' },
        prevKey: null,
        nextCert: { path: '/a', content: '2' },
        nextKey: null,
      }),
    ).toBe(true)
    expect(
      didMtlsCertCacheChange({
        prevCert: null,
        prevKey: { path: '/k', content: '1' },
        nextCert: null,
        nextKey: { path: '/k2', content: '1' },
      }),
    ).toBe(true)
  })

  test('loadMtlsCertFileSync/Async densable', async () => {
    const files = new Map([['/c.pem', 'CERT']])
    const entry = loadMtlsCertFileSync(' /c.pem'.trim(), 'client certificate', {
      readFileSync: p => {
        const v = files.get(p)
        if (!v) throw new Error('missing')
        return v
      },
    })
    expect(entry).toEqual({ path: '/c.pem', content: 'CERT' })
    expect(
      loadMtlsCertFileSync('/missing', 'client certificate', {
        readFileSync: () => {
          throw new Error('enoent')
        },
      }),
    ).toBeNull()

    const asyncEntry = await loadMtlsCertFileAsync('/c.pem', 'client key', {
      readFile: async p => {
        const v = files.get(p)
        if (!v) throw new Error('missing')
        return v
      },
    })
    expect(asyncEntry).toEqual({ path: '/c.pem', content: 'CERT' })
  })

  test('reloadMtlsCertsFromEnvAsync b4t densable', async () => {
    const store = new Map([
      ['/cert.pem', 'CERT1'],
      ['/key.pem', 'KEY1'],
    ])
    const load = async (path: string) => {
      const content = store.get(path)
      if (!content) return null
      return { path, content }
    }

    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_CLIENT_CERT: '/cert.pem',
      CLAUDE_CODE_CLIENT_KEY: '/key.pem',
    }
    const changed1 = await reloadMtlsCertsFromEnvAsync({
      env,
      loadFile: load,
    })
    expect(changed1).toBe(true)
    expect(getLoadedMtlsCertPaths()).toEqual({
      certPath: '/cert.pem',
      keyPath: '/key.pem',
    })

    const changed2 = await reloadMtlsCertsFromEnvAsync({
      env,
      loadFile: load,
    })
    expect(changed2).toBe(false)

    store.set('/cert.pem', 'CERT2')
    let cleared = false
    const changed3 = await reloadMtlsCertsFromEnvAsync({
      env,
      loadFile: load,
      onChanged: () => {
        cleared = true
      },
    })
    expect(changed3).toBe(true)
    expect(cleared).toBe(true)

    // resolveMTLSConfigFromEnv uses file cache when path matches
    clearMTLSCache()
    const cfg = resolveMTLSConfigFromEnv(env)
    expect(cfg?.cert).toBe('CERT2')
    expect(cfg?.key).toBe('KEY1')
  })
})
