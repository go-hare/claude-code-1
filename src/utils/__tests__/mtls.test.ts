import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearMTLSCache,
  didMtlsCertCacheChange,
  getLoadedMtlsCertPaths,
  isCompletePemMaterial,
  isMtlsCertKeyMismatched,
  isValidMtlsCertFileStat,
  loadMtlsCertFileAsync,
  loadMtlsCertFileSync,
  reloadMtlsCertsFromEnvAsync,
  reloadMtlsClientMaterialFromEnvAsync,
  resetMtlsCachesForTests,
  resolveMTLSConfigFromEnv,
  tryReloadMtlsOnStaleTlsConnection,
} from '../mtls.js'

afterEach(() => {
  resetMtlsCachesForTests()
})

const PEM_CERT = `-----BEGIN CERTIFICATE-----
MIIB
-----END CERTIFICATE-----
`
const PEM_KEY = `-----BEGIN PRIVATE KEY-----
MIIB
-----END PRIVATE KEY-----
`

const fileStat = (size = 64) => ({
  isFile: () => true,
  size,
})

describe('mTLS densables (zsl/Ksl/b4t/XEt/y3b)', () => {
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

  test('isCompletePemMaterial densable neu', () => {
    expect(isCompletePemMaterial(PEM_CERT)).toBe(true)
    expect(isCompletePemMaterial(PEM_KEY)).toBe(true)
    expect(isCompletePemMaterial('CERT')).toBe(false)
    expect(isCompletePemMaterial('-----BEGIN CERTIFICATE-----\nabc')).toBe(
      false,
    )
  })

  test('isValidMtlsCertFileStat densable oeu', () => {
    expect(isValidMtlsCertFileStat(fileStat(100), 'cert')).toBe(true)
    expect(
      isValidMtlsCertFileStat(
        { isFile: () => false, size: 10 },
        'cert',
        1_048_576,
        () => {},
      ),
    ).toBe(false)
    expect(
      isValidMtlsCertFileStat(fileStat(2_000_000), 'cert', 1_048_576, () => {}),
    ).toBe(false)
  })

  test('isMtlsCertKeyMismatched returns false on unparseable key (DDy)', () => {
    // Invalid key material → createPrivateKey throws → densable false
    expect(isMtlsCertKeyMismatched(PEM_CERT, 'not-a-key')).toBe(false)
  })

  test('loadMtlsCertFileSync/Async densable eeu/teu', async () => {
    const files = new Map([['/c.pem', PEM_CERT]])
    const entry = loadMtlsCertFileSync('/c.pem', 'client certificate', {
      readFileSync: p => {
        const v = files.get(p)
        if (!v) throw new Error('missing')
        return v
      },
      statSync: () => fileStat(PEM_CERT.length),
    })
    expect(entry).toEqual({ path: '/c.pem', content: PEM_CERT })
    expect(
      loadMtlsCertFileSync('/missing', 'client certificate', {
        readFileSync: () => {
          throw new Error('enoent')
        },
        statSync: () => {
          throw new Error('enoent')
        },
      }),
    ).toBeNull()
    expect(
      loadMtlsCertFileSync('/c.pem', 'client certificate', {
        readFileSync: () => 'CERT',
        statSync: () => fileStat(4),
        log: () => {},
      }),
    ).toBeNull()

    const asyncEntry = await loadMtlsCertFileAsync('/c.pem', 'client key', {
      readFile: async p => {
        const v = files.get(p)
        if (!v) throw new Error('missing')
        return v
      },
      stat: async () => fileStat(PEM_CERT.length),
    })
    expect(asyncEntry).toEqual({ path: '/c.pem', content: PEM_CERT })
  })

  test('reloadMtlsCertsFromEnvAsync b4t densable', async () => {
    const store = new Map([
      ['/cert.pem', PEM_CERT + '1'],
      ['/key.pem', PEM_KEY + '1'],
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

    store.set('/cert.pem', PEM_CERT + '2')
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
    expect(cfg?.cert).toBe(PEM_CERT + '2')
    expect(cfg?.key).toBe(PEM_KEY + '1')
  })

  test('reloadMtlsClientMaterialFromEnvAsync keeps prior on load fail (XEt)', async () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_CLIENT_CERT: '/cert.pem',
      CLAUDE_CODE_CLIENT_KEY: '/key.pem',
    }
    // seed
    await reloadMtlsClientMaterialFromEnvAsync({
      env,
      loadFile: async path =>
        path.endsWith('cert.pem')
          ? { path, content: PEM_CERT + 'A' }
          : { path, content: PEM_KEY + 'A' },
    })
    expect(getLoadedMtlsCertPaths().certPath).toBe('/cert.pem')

    // cert load fails → keep prior
    const result = await reloadMtlsClientMaterialFromEnvAsync({
      env,
      loadFile: async path =>
        path.endsWith('cert.pem') ? null : { path, content: PEM_KEY + 'B' },
    })
    expect(result.readFailed).toBe(true)
    expect(result.changed).toBe(false)
    // still previous content via resolve
    clearMTLSCache()
    const cfg = resolveMTLSConfigFromEnv(env)
    expect(cfg?.cert).toBe(PEM_CERT + 'A')
  })

  test('tryReloadMtlsOnStaleTlsConnection densable y3b gates', async () => {
    // no cert env → not attempted
    const none = await tryReloadMtlsOnStaleTlsConnection({
      env: {},
    })
    expect(none).toEqual({ reportedFailure: false, attempted: false })

    // disable flag
    const disabled = await tryReloadMtlsOnStaleTlsConnection({
      env: {
        CLAUDE_CODE_CLIENT_CERT: '/c.pem',
        CLAUDE_CODE_DISABLE_MTLS_RELOAD_ON_STALE_CONNECTION: '1',
      },
    })
    expect(disabled.attempted).toBe(false)

    let okEvents = 0
    let badCodes: string[] = []
    let materialChanged = 0
    const ok = await tryReloadMtlsOnStaleTlsConnection({
      env: { CLAUDE_CODE_CLIENT_CERT: '/c.pem' },
      reportFailure: true,
      reload: async () => ({
        changed: true,
        readFailed: false,
        mismatched: false,
      }),
      onMaterialChanged: () => {
        materialChanged++
      },
      logEventOk: () => {
        okEvents++
      },
      logEventBad: code => {
        badCodes.push(code)
      },
    })
    expect(ok).toEqual({ reportedFailure: false, attempted: true })
    expect(okEvents).toBe(1)
    expect(materialChanged).toBe(1)

    const fail = await tryReloadMtlsOnStaleTlsConnection({
      env: { CLAUDE_CODE_CLIENT_CERT: '/c.pem' },
      reportFailure: true,
      reload: async () => ({
        changed: false,
        readFailed: true,
        mismatched: true,
      }),
      logEventBad: code => {
        badCodes.push(code)
      },
    })
    expect(fail.reportedFailure).toBe(true)
    expect(fail.attempted).toBe(true)
    expect(badCodes).toContain('material_mismatched')
  })
})
