import { afterEach, describe, expect, test } from 'bun:test'
import {
  applyGatewayFromEnvResult,
  buildRefreshedGatewayAuthSession,
  clearGatewayAuth,
  decodeJwtExpSeconds,
  ensureGatewayAuthApplied,
  formatGatewaySessionExpiredError,
  GATEWAY_IDP_REFRESH_SKEW_MS,
  getGatewayAuth,
  invalidateGatewaySecureStorageRestoreCache,
  isGatewayAuthExpired,
  isGatewayAuthPinned,
  maybeRefreshGatewayIdp,
  normalizeGatewayBaseUrl,
  parseGatewayIdpTokenResponse,
  persistEnterpriseGatewayCredential,
  persistGatewayTlsPin,
  planEnterpriseGatewayStorageMerge,
  planGatewayTlsProbe,
  planGatewayTrustStorageMerge,
  planRestoreGatewayAuth,
  parseEnterpriseGatewayCredential,
  matchesGatewayTlsPin,
  normalizeGatewayTlsFingerprint,
  createGatewayTlsPinCheckServerIdentity,
  createPinnedGatewayHttpsAgent,
  probeGatewayTlsFingerprint,
  readGatewayTlsPin,
  resolveGatewayFromEnv,
  resolveGatewayIdpTokenEndpoint,
  resolveGatewayTrustHostKey,
  resetGatewaySecureStorageRestoreCache_FOR_TESTS,
  restoreGatewayAuth,
  setGatewayAuth,
  setGatewaySecureStorageNowMs_FOR_TESTS,
  setTestGatewaySecureStorageRead_FOR_TESTS,
  shouldRefreshGatewayIdp,
  toEnterpriseGatewayCredential,
  tryRestoreGatewayAuthFromSecureStorage,
  GATEWAY_HTTP_LOOPBACK_FINGERPRINT,
  GATEWAY_SECURE_STORAGE_MISS_TTL_MS,
  GATEWAY_SECURE_STORAGE_READ_FAIL_BACKOFF_MS,
  GATEWAY_TLS_PIN_MISMATCH_MESSAGE,
} from '../gatewayEnv.js'

function makeJwt(expSeconds: number | undefined): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify(expSeconds === undefined ? {} : { exp: expSeconds }),
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

describe('resolveGatewayFromEnv', () => {
  test('disabled when env off', () => {
    expect(resolveGatewayFromEnv({})).toEqual({ status: 'disabled' })
  })
  test('missing base or token warns', () => {
    const r = resolveGatewayFromEnv({ CLAUDE_CODE_USE_GATEWAY: '1' })
    expect(r.status).toBe('missing')
    if (r.status === 'missing') {
      expect(r.message).toContain('ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN')
    }
  })
  test('invalid url', () => {
    const r = resolveGatewayFromEnv({
      CLAUDE_CODE_USE_GATEWAY: '1',
      ANTHROPIC_BASE_URL: 'not a url',
      ANTHROPIC_AUTH_TOKEN: 'tok',
    })
    expect(r.status).toBe('invalid_url')
  })
  test('ok session with jwt exp', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const jwt = makeJwt(exp)
    const r = resolveGatewayFromEnv({
      CLAUDE_CODE_USE_GATEWAY: '1',
      ANTHROPIC_BASE_URL: 'https://gw.example.com/',
      ANTHROPIC_AUTH_TOKEN: jwt,
    })
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.session.url).toBe('https://gw.example.com')
      expect(r.session.jwt).toBe(jwt)
      expect(r.session.expiresAtMs).toBe(exp * 1000)
      expect(r.session.unpinned).toBe(true)
    }
  })
  test('ok session without exp → MAX_SAFE_INTEGER', () => {
    const jwt = makeJwt(undefined)
    const r = resolveGatewayFromEnv({
      CLAUDE_CODE_USE_GATEWAY: '1',
      ANTHROPIC_BASE_URL: 'https://gw.example.com',
      ANTHROPIC_AUTH_TOKEN: jwt,
    })
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.session.expiresAtMs).toBe(Number.MAX_SAFE_INTEGER)
    }
  })
})

describe('decodeJwtExpSeconds', () => {
  test('reads exp', () => {
    expect(decodeJwtExpSeconds(makeJwt(12345))).toBe(12345)
  })
  test('null when missing', () => {
    expect(decodeJwtExpSeconds(makeJwt(undefined))).toBeNull()
    expect(decodeJwtExpSeconds('not-a-jwt')).toBeNull()
  })
})

describe('normalizeGatewayBaseUrl', () => {
  test('strips trailing slash', () => {
    expect(normalizeGatewayBaseUrl('https://x.example/')).toBe(
      'https://x.example',
    )
  })
})

describe('gatewayAuth store o_/XFe/eGo/Sht densable', () => {
  afterEach(() => {
    clearGatewayAuth()
  })

  test('set/get/clear', () => {
    expect(getGatewayAuth()).toBeNull()
    setGatewayAuth({
      url: 'https://gw.example',
      jwt: 't',
      expiresAtMs: Date.now() + 60_000,
      unpinned: true,
    })
    expect(getGatewayAuth()?.url).toBe('https://gw.example')
    clearGatewayAuth()
    expect(getGatewayAuth()).toBeNull()
  })

  test('isGatewayAuthExpired eGo', () => {
    const sess = {
      url: 'https://gw.example',
      jwt: 't',
      expiresAtMs: 1000,
      unpinned: true as const,
    }
    expect(isGatewayAuthExpired(sess, 999)).toBe(false)
    expect(isGatewayAuthExpired(sess, 1000)).toBe(true)
    expect(isGatewayAuthExpired(null)).toBe(false)
  })

  test('isGatewayAuthPinned Sht', () => {
    expect(
      isGatewayAuthPinned({
        url: 'https://gw.example',
        jwt: 't',
        expiresAtMs: 1,
        unpinned: true,
      }),
    ).toBe(false)
    expect(
      isGatewayAuthPinned({
        url: 'https://gw.example',
        jwt: 't',
        expiresAtMs: 1,
      }),
    ).toBe(true)
  })

  test('applyGatewayFromEnvResult pins on ok', () => {
    const r = resolveGatewayFromEnv({
      CLAUDE_CODE_USE_GATEWAY: '1',
      ANTHROPIC_BASE_URL: 'https://gw.example.com',
      ANTHROPIC_AUTH_TOKEN: 'tok',
    })
    applyGatewayFromEnvResult(r)
    expect(getGatewayAuth()?.jwt).toBe('tok')
  })

  test('formatGatewaySessionExpiredError', () => {
    expect(
      formatGatewaySessionExpiredError({ CLAUDE_CODE_USE_GATEWAY: '1' }),
    ).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(formatGatewaySessionExpiredError({})).toContain('/login')
  })

  test('SJe idp refresh densables', async () => {
    expect(GATEWAY_IDP_REFRESH_SKEW_MS).toBe(300_000)
    expect(
      parseGatewayIdpTokenResponse({
        access_token: 'a',
        expires_in: 60,
        refresh_token: 'r2',
      }),
    ).toEqual({
      access_token: 'a',
      expires_in: 60,
      refresh_token: 'r2',
    })
    expect(parseGatewayIdpTokenResponse({ access_token: 'a' })).toBeNull()

    const base = {
      url: 'https://gw.example',
      jwt: 'old',
      expiresAtMs: Date.now() + 60_000,
      idpRefreshToken: 'r1',
    }
    expect(shouldRefreshGatewayIdp(base, Date.now(), 300_000)).toBe(true)
    expect(
      shouldRefreshGatewayIdp(
        { ...base, expiresAtMs: Date.now() + 600_000 },
        Date.now(),
        300_000,
      ),
    ).toBe(false)
    expect(
      shouldRefreshGatewayIdp({ ...base, idpRefreshToken: undefined }),
    ).toBe(false)
    expect(resolveGatewayIdpTokenEndpoint(base)).toBe(
      'https://gw.example/oauth/token',
    )
    expect(
      resolveGatewayIdpTokenEndpoint({
        ...base,
        tokenEndpoint: 'https://idp.example/token',
      }),
    ).toBe('https://idp.example/token')

    const next = buildRefreshedGatewayAuthSession(
      base,
      { access_token: 'new', expires_in: 120, refresh_token: 'r2' },
      1_000_000,
    )
    expect(next.jwt).toBe('new')
    expect(next.expiresAtMs).toBe(1_000_000 + 120_000)
    expect(next.idpRefreshToken).toBe('r2')

    setGatewayAuth(base)
    const skipped = await maybeRefreshGatewayIdp({
      nowMs: Date.now(),
      skewMs: 0,
    })
    expect(skipped.status).toBe('skipped')

    const noTransport = await maybeRefreshGatewayIdp({
      session: base,
      nowMs: Date.now(),
    })
    expect(noTransport.status).toBe('error')

    const refreshed = await maybeRefreshGatewayIdp({
      session: base,
      nowMs: Date.now(),
      postToken: async () => ({
        data: {
          access_token: 'fresh',
          expires_in: 300,
          refresh_token: 'r3',
        },
      }),
    })
    expect(refreshed.status).toBe('refreshed')
    if (refreshed.status === 'refreshed') {
      expect(refreshed.session.jwt).toBe('fresh')
      expect(getGatewayAuth()?.jwt).toBe('fresh')
    }

    const invalid = await maybeRefreshGatewayIdp({
      session: {
        ...base,
        expiresAtMs: Date.now() + 1,
        idpRefreshToken: 'bad',
      },
      nowMs: Date.now(),
      postToken: async () => {
        throw {
          isAxiosError: true,
          response: { data: { error: 'invalid_grant' } },
        }
      },
      isInvalidGrant: () => true,
    })
    expect(invalid).toEqual({
      status: 'invalid_grant',
      clearedRefresh: true,
    })
    expect(getGatewayAuth()?.idpRefreshToken).toBeUndefined()
  })

  test('enterpriseGateway secureStorage persist densable (JYl/XYl)', async () => {
    const session = {
      url: 'https://gw.example',
      jwt: 'tok',
      expiresAtMs: Date.now() + 60_000,
      idpRefreshToken: 'r1',
      unpinned: false as const,
    }
    expect(toEnterpriseGatewayCredential(session)).toEqual({
      url: 'https://gw.example',
      jwt: 'tok',
      expiresAtMs: session.expiresAtMs,
      idpRefreshToken: 'r1',
      unpinned: false,
    })

    const planned = planEnterpriseGatewayStorageMerge({
      existing: { oauthAccount: { id: 'x' } },
      next: session,
      expectedIdpRefreshToken: 'r1',
    })
    expect(planned.discarded).toBe(false)
    expect(planned.data.enterpriseGateway).toMatchObject({
      jwt: 'tok',
      idpRefreshToken: 'r1',
    })
    expect(planned.data.oauthAccount).toEqual({ id: 'x' })

    const raced = planEnterpriseGatewayStorageMerge({
      existing: {
        enterpriseGateway: {
          url: 'https://gw.example',
          jwt: 'other',
          expiresAtMs: 1,
          idpRefreshToken: 'r-other',
        },
      },
      next: session,
      expectedIdpRefreshToken: 'r1',
    })
    expect(raced.discarded).toBe(true)
    expect(raced.applied.idpRefreshToken).toBe('r-other')

    const writes: unknown[] = []
    const ok = await persistEnterpriseGatewayCredential({
      session,
      expectedIdpRefreshToken: 'r1',
      storage: {
        read: () => ({ oauthAccount: { id: 'x' } }),
        update: data => {
          writes.push(data)
          return { success: true }
        },
      },
    })
    expect(ok).toEqual({ success: true, discarded: false })
    expect(writes).toHaveLength(1)

    setGatewayAuth(session)
    const persisted: Array<{ jwt: string }> = []
    const refreshed = await maybeRefreshGatewayIdp({
      session,
      nowMs: Date.now(),
      autoPersist: false,
      postToken: async () => ({
        data: {
          access_token: 'fresh2',
          expires_in: 300,
          refresh_token: 'r4',
        },
      }),
      persist: s => {
        persisted.push(s)
      },
    })
    expect(refreshed.status).toBe('refreshed')
    expect(persisted[0]?.jwt).toBe('fresh2')
  })

  test('gatewayTrust TLS pin densables (U_c / zPr / uRi restore)', async () => {
    expect(normalizeGatewayTlsFingerprint('AB:CD:EF')).toBe('abcdef')
    expect(resolveGatewayTrustHostKey('https://gw.example:8443/v1')).toBe(
      'gw.example',
    )
    expect(matchesGatewayTlsPin('ab:cd', 'ABCD')).toBe(true)
    expect(matchesGatewayTlsPin('ab', 'cd')).toBe(false)
    expect(GATEWAY_TLS_PIN_MISMATCH_MESSAGE).toContain('pinned fingerprint')

    const merged = planGatewayTrustStorageMerge({
      existing: { oauthAccount: { id: 'x' } },
      host: 'gw.example',
      fingerprint: 'AA:BB',
    })
    expect(merged.gatewayTrust).toEqual({ 'gw.example': 'aabb' })
    expect(merged.oauthAccount).toEqual({ id: 'x' })

    const writes: unknown[] = []
    const pinOk = await persistGatewayTlsPin({
      host: 'gw.example',
      fingerprint: '11:22',
      storage: {
        read: () => ({}),
        update: data => {
          writes.push(data)
          return { success: true }
        },
      },
    })
    expect(pinOk).toEqual({ success: true })
    expect(writes[0]).toMatchObject({
      gatewayTrust: { 'gw.example': '1122' },
    })

    expect(
      readGatewayTlsPin({
        host: 'gw.example',
        storageData: { gatewayTrust: { 'gw.example': 'aabb' } },
      }),
    ).toBe('aabb')

    const cred = parseEnterpriseGatewayCredential({
      url: 'https://gw.example',
      jwt: 'j',
      expiresAt: Date.now() + 60_000,
      idpRefreshToken: 'r',
    })
    expect(cred?.jwt).toBe('j')
    expect(cred?.unpinned).toBe(false)

    const untrusted = planRestoreGatewayAuth({
      storageData: {
        enterpriseGateway: {
          url: 'https://gw.example',
          jwt: 'j',
          expiresAtMs: Date.now() + 60_000,
        },
      },
    })
    expect(untrusted.status).toBe('untrusted')

    const mismatch = planRestoreGatewayAuth({
      storageData: {
        enterpriseGateway: {
          url: 'https://gw.example',
          jwt: 'j',
          expiresAtMs: Date.now() + 60_000,
        },
        gatewayTrust: { 'gw.example': 'pinpin' },
      },
      liveFingerprint: 'deadbeef',
    })
    expect(mismatch.status).toBe('tls_mismatch')

    const restore = planRestoreGatewayAuth({
      storageData: {
        enterpriseGateway: {
          url: 'https://gw.example',
          jwt: 'restored-jwt',
          expiresAtMs: Date.now() + 60_000,
        },
        gatewayTrust: { 'gw.example': 'pinpin' },
      },
      liveFingerprint: 'pinpin',
    })
    expect(restore.status).toBe('restore')
    if (restore.status === 'restore') {
      expect(restore.session.jwt).toBe('restored-jwt')
    }

    clearGatewayAuth()
    const applied = await restoreGatewayAuth({
      env: {},
      quiet: true,
      readStorage: () => ({
        enterpriseGateway: {
          url: 'https://gw.example',
          jwt: 'from-storage',
          expiresAtMs: Date.now() + 60_000,
        },
        gatewayTrust: { 'gw.example': 'aa' },
      }),
      probeFingerprint: async () => ({ fingerprint: 'aa' }),
    })
    expect(applied.status).toBe('restored')
    expect(getGatewayAuth()?.jwt).toBe('from-storage')

    clearGatewayAuth()
    const sync = tryRestoreGatewayAuthFromSecureStorage({
      quiet: true,
      storage: {
        read: () => ({
          enterpriseGateway: {
            url: 'https://gw.example',
            jwt: 'sync-jwt',
            expiresAtMs: Date.now() + 60_000,
          },
          gatewayTrust: { 'gw.example': 'bb' },
        }),
      },
    })
    expect(sync.status).toBe('restored')
    expect(getGatewayAuth()?.jwt).toBe('sync-jwt')
  })

  test('injectable secure-storage host is not negative-cached', () => {
    clearGatewayAuth()
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    let reads = 0
    const injectable = {
      read: () => {
        reads++
        return null
      },
    }
    const a = tryRestoreGatewayAuthFromSecureStorage({
      quiet: true,
      storage: injectable,
    })
    const b = tryRestoreGatewayAuthFromSecureStorage({
      quiet: true,
      storage: injectable,
    })
    expect(a.status).toBe('skipped')
    expect(b.status).toBe('skipped')
    expect(reads).toBe(2)
  })

  test('ensureGatewayAuthApplied TTL-skips empty secure storage reads', () => {
    clearGatewayAuth()
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    let now = 2_000_000
    setGatewaySecureStorageNowMs_FOR_TESTS(() => now)

    let reads = 0
    setTestGatewaySecureStorageRead_FOR_TESTS(() => {
      reads++
      return null
    })

    ensureGatewayAuthApplied()
    ensureGatewayAuthApplied()
    expect(reads).toBe(1)

    // Within miss TTL: no re-read.
    const second = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(second).toEqual({ status: 'skipped', reason: 'miss_ttl' })
    expect(reads).toBe(1)

    // clearGatewayAuth invalidates so a later cold path re-reads.
    clearGatewayAuth()
    ensureGatewayAuthApplied()
    expect(reads).toBe(2)

    // Credential-write invalidation also allows a re-read.
    invalidateGatewaySecureStorageRestoreCache()
    ensureGatewayAuthApplied()
    expect(reads).toBe(3)

    // force: true bypasses TTL for this call and re-applies miss TTL.
    invalidateGatewaySecureStorageRestoreCache()
    const forced = tryRestoreGatewayAuthFromSecureStorage({
      quiet: true,
      force: true,
    })
    expect(forced.status).toBe('skipped')
    expect(reads).toBe(4)
    const cached = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(cached).toEqual({
      status: 'skipped',
      reason: 'miss_ttl',
    })
    expect(reads).toBe(4)

    resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    clearGatewayAuth()
  })

  test('empty miss TTL allows restore after external credential write', () => {
    clearGatewayAuth()
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    let now = 3_000_000
    setGatewaySecureStorageNowMs_FOR_TESTS(() => now)

    let reads = 0
    let storageData: Record<string, unknown> | null = null
    setTestGatewaySecureStorageRead_FOR_TESTS(() => {
      reads++
      return storageData
    })

    const empty = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(empty).toEqual({ status: 'skipped', reason: 'no_credential' })
    expect(getGatewayAuth()).toBeNull()
    expect(reads).toBe(1)

    // External process writes credentials while we still hold miss TTL.
    storageData = {
      enterpriseGateway: {
        url: 'https://gw.example',
        jwt: 'external-login-jwt',
        expiresAtMs: Date.now() + 60_000,
      },
      gatewayTrust: { 'gw.example': 'pin' },
    }
    expect(tryRestoreGatewayAuthFromSecureStorage({ quiet: true })).toEqual({
      status: 'skipped',
      reason: 'miss_ttl',
    })
    expect(reads).toBe(1)
    expect(getGatewayAuth()).toBeNull()

    // After TTL, re-read and restore.
    now += GATEWAY_SECURE_STORAGE_MISS_TTL_MS
    const restored = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(restored.status).toBe('restored')
    expect(getGatewayAuth()?.jwt).toBe('external-login-jwt')
    expect(reads).toBe(2)

    // Successful restore is permanent until clear (no further reads).
    expect(tryRestoreGatewayAuthFromSecureStorage({ quiet: true })).toEqual({
      status: 'skipped',
      reason: 'already_attempted',
    })
    expect(reads).toBe(2)

    resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    clearGatewayAuth()
  })

  test('expired restored session re-reads and picks up external re-login', () => {
    clearGatewayAuth()
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    // planRestore uses real Date.now for credential expiry; fake clock only for
    // isGatewayAuthExpired / ensure short-circuit paths when we inject it later.
    let reads = 0
    let storageData: Record<string, unknown> = {
      enterpriseGateway: {
        url: 'https://gw.example',
        jwt: 'old-jwt',
        expiresAtMs: Date.now() + 60_000,
      },
      gatewayTrust: { 'gw.example': 'pin' },
    }
    setTestGatewaySecureStorageRead_FOR_TESTS(() => {
      reads++
      return storageData
    })

    const initial = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(initial.status).toBe('restored')
    expect(getGatewayAuth()?.jwt).toBe('old-jwt')
    expect(reads).toBe(1)

    // Still valid → permanent skip.
    expect(ensureGatewayAuthApplied()?.jwt).toBe('old-jwt')
    expect(tryRestoreGatewayAuthFromSecureStorage({ quiet: true })).toEqual({
      status: 'skipped',
      reason: 'already_attempted',
    })
    expect(reads).toBe(1)

    // Expire in-memory session without clearGatewayAuth (keeps restoreSucceeded
    // until expiry check clears it). External process writes refreshed JWT.
    setGatewayAuth({
      url: 'https://gw.example',
      jwt: 'old-jwt',
      expiresAtMs: Date.now() - 1,
    })
    storageData = {
      enterpriseGateway: {
        url: 'https://gw.example',
        jwt: 'new-jwt',
        expiresAtMs: Date.now() + 60_000,
      },
      gatewayTrust: { 'gw.example': 'pin' },
    }

    // ensure keeps identity until a fresh valid credential is restored.
    expect(ensureGatewayAuthApplied()?.jwt).toBe('new-jwt')
    expect(reads).toBe(2)
    expect(getGatewayAuth()?.jwt).toBe('new-jwt')

    // Valid again → permanent skip.
    expect(tryRestoreGatewayAuthFromSecureStorage({ quiet: true })).toEqual({
      status: 'skipped',
      reason: 'already_attempted',
    })
    expect(reads).toBe(2)

    resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    clearGatewayAuth()
  })

  test('expired session + expired disk keeps gateway identity over Bedrock env', async () => {
    clearGatewayAuth()
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    const savedBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    try {
      setGatewayAuth({
        url: 'https://gw.example',
        jwt: 'stale-gateway-jwt',
        expiresAtMs: Date.now() - 1,
      })
      setTestGatewaySecureStorageRead_FOR_TESTS(() => ({
        enterpriseGateway: {
          url: 'https://gw.example',
          jwt: 'also-stale-jwt',
          expiresAtMs: Date.now() - 1,
        },
        gatewayTrust: { 'gw.example': 'pin' },
      }))

      // Must not clear expired identity when disk cannot supply a fresh session.
      const applied = ensureGatewayAuthApplied()
      expect(applied?.jwt).toBe('stale-gateway-jwt')
      expect(getGatewayAuth()?.jwt).toBe('stale-gateway-jwt')
      expect(isGatewayAuthExpired(getGatewayAuth())).toBe(true)

      // Disk miss is TTL-blocked expired, not a clear.
      expect(tryRestoreGatewayAuthFromSecureStorage({ quiet: true })).toEqual({
        status: 'skipped',
        reason: 'miss_ttl',
      })

      // Provider ranking: any gatewayAuth (including expired) beats Bedrock.
      const { getAPIProvider } = await import('../model/providers.js')
      expect(getAPIProvider({})).toBe('gateway')
    } finally {
      if (savedBedrock === undefined) {
        delete process.env.CLAUDE_CODE_USE_BEDROCK
      } else {
        process.env.CLAUDE_CODE_USE_BEDROCK = savedBedrock
      }
      resetGatewaySecureStorageRestoreCache_FOR_TESTS()
      clearGatewayAuth()
    }
  })

  test('expired explicit env session is not overwritten by secure-storage', () => {
    clearGatewayAuth()
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    const saved = {
      USE_GATEWAY: process.env.CLAUDE_CODE_USE_GATEWAY,
      BASE_URL: process.env.ANTHROPIC_BASE_URL,
      AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
    }
    // JWT already expired — env still explicitly pins this gateway identity.
    const expiredJwt = makeJwt(Math.floor(Date.now() / 1000) - 60)
    process.env.CLAUDE_CODE_USE_GATEWAY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://env-gw.example'
    process.env.ANTHROPIC_AUTH_TOKEN = expiredJwt

    let reads = 0
    setTestGatewaySecureStorageRead_FOR_TESTS(() => {
      reads++
      return {
        enterpriseGateway: {
          url: 'https://stored-gw.example',
          jwt: 'storage-jwt',
          expiresAtMs: Date.now() + 60_000,
        },
        gatewayTrust: { 'stored-gw.example': 'pin' },
      }
    })

    try {
      const applied = ensureGatewayAuthApplied()
      expect(applied?.url).toBe('https://env-gw.example')
      expect(applied?.jwt).toBe(expiredJwt)
      expect(applied?.unpinned).toBe(true)
      expect(isGatewayAuthExpired(applied)).toBe(true)
      // Must not fall through to disk and swap identity.
      expect(reads).toBe(0)
      expect(getGatewayAuth()?.jwt).toBe(expiredJwt)
      expect(getGatewayAuth()?.url).toBe('https://env-gw.example')
    } finally {
      if (saved.USE_GATEWAY === undefined) {
        delete process.env.CLAUDE_CODE_USE_GATEWAY
      } else {
        process.env.CLAUDE_CODE_USE_GATEWAY = saved.USE_GATEWAY
      }
      if (saved.BASE_URL === undefined) {
        delete process.env.ANTHROPIC_BASE_URL
      } else {
        process.env.ANTHROPIC_BASE_URL = saved.BASE_URL
      }
      if (saved.AUTH_TOKEN === undefined) {
        delete process.env.ANTHROPIC_AUTH_TOKEN
      } else {
        process.env.ANTHROPIC_AUTH_TOKEN = saved.AUTH_TOKEN
      }
      resetGatewaySecureStorageRestoreCache_FOR_TESTS()
      clearGatewayAuth()
    }
  })

  test('expired disk session with idpRefreshToken is restored for IdP refresh', async () => {
    clearGatewayAuth()
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    const savedBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    try {
      setTestGatewaySecureStorageRead_FOR_TESTS(() => ({
        enterpriseGateway: {
          url: 'https://gw.example',
          jwt: 'expired-but-refreshable',
          expiresAtMs: Date.now() - 1,
          idpRefreshToken: 'refresh-token',
          tokenEndpoint: 'https://idp.example/token',
        },
        gatewayTrust: { 'gw.example': 'pin' },
      }))

      // planRestore allows expired+refresh; tryRestore must not re-reject.
      const restored = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
      expect(restored.status).toBe('restored')
      if (restored.status === 'restored') {
        expect(restored.session.jwt).toBe('expired-but-refreshable')
        expect(restored.session.idpRefreshToken).toBe('refresh-token')
      }
      expect(getGatewayAuth()?.idpRefreshToken).toBe('refresh-token')
      expect(isGatewayAuthExpired(getGatewayAuth())).toBe(true)

      // Cold ensure path also restores refreshable identity (no env).
      clearGatewayAuth()
      resetGatewaySecureStorageRestoreCache_FOR_TESTS()
      setTestGatewaySecureStorageRead_FOR_TESTS(() => ({
        enterpriseGateway: {
          url: 'https://gw.example',
          jwt: 'expired-but-refreshable',
          expiresAtMs: Date.now() - 1,
          idpRefreshToken: 'refresh-token',
          tokenEndpoint: 'https://idp.example/token',
        },
        gatewayTrust: { 'gw.example': 'pin' },
      }))
      expect(ensureGatewayAuthApplied()?.idpRefreshToken).toBe('refresh-token')

      // Provider stays gateway so IdP refresh can run, not silent Bedrock.
      const { getAPIProvider } = await import('../model/providers.js')
      expect(getAPIProvider({})).toBe('gateway')
    } finally {
      if (savedBedrock === undefined) {
        delete process.env.CLAUDE_CODE_USE_BEDROCK
      } else {
        process.env.CLAUDE_CODE_USE_BEDROCK = savedBedrock
      }
      resetGatewaySecureStorageRestoreCache_FOR_TESTS()
      clearGatewayAuth()
    }
  })

  test('storage_read_failed uses short backoff instead of permanent cache', () => {
    clearGatewayAuth()
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    let now = 1_000_000
    setGatewaySecureStorageNowMs_FOR_TESTS(() => now)

    let reads = 0
    setTestGatewaySecureStorageRead_FOR_TESTS(() => {
      reads++
      throw new Error('io fail')
    })

    const first = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(first).toEqual({
      status: 'skipped',
      reason: 'storage_read_failed',
    })
    expect(reads).toBe(1)

    // Within backoff: no re-read.
    now += 100
    const second = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(second).toEqual({
      status: 'skipped',
      reason: 'storage_read_backoff',
    })
    expect(reads).toBe(1)

    // After backoff expires, retry read and restore when storage recovers.
    now += GATEWAY_SECURE_STORAGE_READ_FAIL_BACKOFF_MS
    setTestGatewaySecureStorageRead_FOR_TESTS(() => {
      reads++
      return {
        enterpriseGateway: {
          url: 'https://gw.example',
          jwt: 'recovered-jwt',
          expiresAtMs: Date.now() + 60_000,
        },
        gatewayTrust: { 'gw.example': 'pin' },
      }
    })
    const third = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(third.status).toBe('restored')
    expect(getGatewayAuth()?.jwt).toBe('recovered-jwt')
    expect(reads).toBe(2)

    resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    clearGatewayAuth()
  })

  test('persistGatewayTlsPin invalidates restore cache so gateway can re-restore', async () => {
    clearGatewayAuth()
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    let reads = 0
    let storageData: Record<string, unknown> = {
      enterpriseGateway: {
        url: 'https://gw.example',
        jwt: 'post-pin-jwt',
        expiresAtMs: Date.now() + 60_000,
      },
    }
    setTestGatewaySecureStorageRead_FOR_TESTS(() => {
      reads++
      return storageData
    })

    // First cold restore: credential present but host not trusted → blocked.
    const before = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(before.status).toBe('blocked')
    expect(getGatewayAuth()).toBeNull()
    expect(reads).toBe(1)

    // Miss TTL would otherwise freeze this miss until expiry.
    expect(tryRestoreGatewayAuthFromSecureStorage({ quiet: true })).toEqual({
      status: 'skipped',
      reason: 'miss_ttl',
    })
    expect(reads).toBe(1)

    const pin = await persistGatewayTlsPin({
      host: 'gw.example',
      fingerprint: 'aabbcc',
      storage: {
        read: () => storageData,
        update: data => {
          storageData = data
          return { success: true }
        },
      },
    })
    expect(pin).toEqual({ success: true })

    // After pin write, default-host restore re-reads and applies session.
    const after = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
    expect(after.status).toBe('restored')
    expect(getGatewayAuth()?.jwt).toBe('post-pin-jwt')
    expect(reads).toBe(2)

    resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    clearGatewayAuth()
  })

  test('VPr / B_c TLS probe densables', async () => {
    expect(planGatewayTlsProbe('http://gw.example')).toEqual({
      status: 'http_loopback',
      hostname: 'gw.example',
      fingerprint: GATEWAY_HTTP_LOOPBACK_FINGERPRINT,
    })
    expect(planGatewayTlsProbe('https://gw.example:8443/v1')).toEqual({
      status: 'probe',
      hostname: 'gw.example',
      host: 'gw.example',
      port: 8443,
    })
    expect(
      (await probeGatewayTlsFingerprint('http://localhost')).fingerprint,
    ).toBe(GATEWAY_HTTP_LOOPBACK_FINGERPRINT)

    const probed = await probeGatewayTlsFingerprint('https://gw.example', {
      connect: async () => ({ fingerprint256: 'AB:CD:EF' }),
    })
    expect(probed).toEqual({ hostname: 'gw.example', fingerprint: 'abcdef' })

    await expect(
      probeGatewayTlsFingerprint('https://gw.example', {
        connect: async () => ({ fingerprint256: '' }),
      }),
    ).rejects.toThrow(/could not read TLS certificate fingerprint/)

    const check = createGatewayTlsPinCheckServerIdentity(
      'aabb',
      () => undefined,
    )
    expect(check('gw.example', { fingerprint256: 'AA:BB' })).toBeUndefined()
    expect(check('gw.example', { fingerprint256: 'ccdd' })?.message).toContain(
      'pinned fingerprint',
    )

    class FakeAgent {
      opts: Record<string, unknown>
      constructor(opts: Record<string, unknown>) {
        this.opts = opts
      }
    }
    const agent = createPinnedGatewayHttpsAgent('deadbeef', {
      Agent: FakeAgent as unknown as new (
        options?: Record<string, unknown>,
      ) => unknown,
      checkServerIdentity: () => undefined,
      ca: 'ca',
    }) as FakeAgent
    expect(typeof agent.opts.checkServerIdentity).toBe('function')
    const pinCheck = agent.opts.checkServerIdentity as (
      h: string,
      c: { fingerprint256?: string },
    ) => Error | undefined
    expect(pinCheck('h', { fingerprint256: 'DEADBEEF' })).toBeUndefined()
    expect(pinCheck('h', { fingerprint256: '00' })?.message).toBe(
      GATEWAY_TLS_PIN_MISMATCH_MESSAGE,
    )
  })
})
