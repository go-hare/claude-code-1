/**
 * densable 2.1.289 probeBoots / probeToolUseId / gatePublicRead reuse.
 */
import '../index.js'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realGrowthbook from '../../../services/analytics/growthbook.js'
import { getClaudeAIOAuthTokens } from '../../../utils/auth.js'
import { resetArtifactAutoReactStoreForTests, un } from '../index.js'
import { fetchFrameBoot, PROBE_BOOT_TTL_MS } from '../mint.js'
import {
  rememberProbeBoot,
  clearProbeBoot,
  Kgl,
  probeArtifactOwnership,
} from '../ownership.js'
import { resetConsentStateForTests } from '../readPerm/consent.js'
import { resetProvenanceStateForTests } from '../readPerm/provenance.js'
import { fetchArtifactAssetBytes, fetchArtifactFileBytes } from '../restApis.js'

const growthbookSnap = snapshotModuleExports(realGrowthbook)
const gbValues: Record<string, boolean> = {}

function growthbookMock() {
  return {
    ...growthbookSnap,
    getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) =>
      key in gbValues ? gbValues[key] : fallback,
  }
}
mock.module('src/services/analytics/growthbook.ts', growthbookMock)
mock.module('src/services/analytics/growthbook.js', growthbookMock)

const SLUG = '11111111-1111-1111-1111-111111111111'
const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
const prevFetch = globalThis.fetch

function clearTokenMemo(): void {
  ;(
    getClaudeAIOAuthTokens as unknown as { cache?: { clear?: () => void } }
  ).cache?.clear?.()
}

function bootBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ver: 'v7',
    mode: 'public',
    perm: { role: 'owner' },
    typeInstance: false,
    ...extra,
  })
}

function countingFetch(body: string): {
  fetch: typeof fetch
  frameGets: () => number
} {
  let frameGets = 0
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const u = String(input)
    if (u.includes('/api/frame/') && !u.includes('claudeusercontent')) {
      frameGets++
      return new Response(body, { status: 200 })
    }
    if (u.includes('claudeusercontent.com')) {
      return new Response('file-bytes', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }
    return new Response('miss', { status: 404 })
  }) as typeof fetch
  return { fetch: fetchImpl, frameGets: () => frameGets }
}

beforeAll(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth'
  clearTokenMemo()
})

afterAll(() => {
  globalThis.fetch = prevFetch
  if (prevToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevToken
  clearTokenMemo()
  mock.module('src/services/analytics/growthbook.ts', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

beforeEach(() => {
  for (const k of Object.keys(gbValues)) delete gbValues[k]
  resetProvenanceStateForTests()
  resetConsentStateForTests()
  resetArtifactAutoReactStoreForTests()
  globalThis.fetch = prevFetch
})

afterEach(() => {
  globalThis.fetch = prevFetch
})

describe('probeBoots reuse (densable aT)', () => {
  test('probeArtifactOwnership remembers boot; same id reuses via Jgl', async () => {
    const counted = countingFetch(bootBody({ assetToken: 'tok' }))
    globalThis.fetch = counted.fetch
    const signal = new AbortController().signal
    const parsed = { slug: SLUG, env: 'prod' as const }
    await probeArtifactOwnership(parsed, {
      signal,
      toolUseId: 'tu-own',
    })
    expect(un().shareStatus.probeBoots.get(SLUG)?.toolUseId).toBe('tu-own')
    // Bypass lastProbeToolUseId short-circuit so the second call hits Jgl.
    const row = un().shareStatus.bySlug.get(SLUG)
    expect(row).toBeDefined()
    if (row === undefined) return
    const { lastProbeToolUseId: _drop, ...rest } = row
    un().shareStatus.bySlug.set(SLUG, rest)
    const before = counted.frameGets()
    await probeArtifactOwnership(parsed, {
      signal,
      toolUseId: 'tu-own',
    })
    expect(counted.frameGets()).toBe(before)
    const content = await fetchFrameBoot(SLUG, signal, {
      kind: 'read',
      gatePublicRead: false,
      probeToolUseId: 'tu-own',
    })
    expect(content.err).toBeNull()
    if (content.err !== null) return
    expect(content.reused).toBe(true)
    expect(counted.frameGets()).toBe(before)
  })

  test('same probeToolUseId reuses cached non-lean boot', async () => {
    const counted = countingFetch(bootBody({ assetToken: 'tok' }))
    globalThis.fetch = counted.fetch
    const signal = new AbortController().signal
    const first = await fetchFrameBoot(SLUG, signal, {
      kind: 'probe',
      probe: true,
      gatePublicRead: false,
      probeToolUseId: 'tu-1',
    })
    expect(first.err).toBeNull()
    if (first.err !== null) return
    rememberProbeBoot(SLUG, first, {
      toolUseId: 'tu-1',
      issuedAt: Date.now(),
    })
    expect(un().shareStatus.probeBoots.get(SLUG)?.toolUseId).toBe('tu-1')
    const before = counted.frameGets()
    const second = await fetchFrameBoot(SLUG, signal, {
      kind: 'read',
      gatePublicRead: false,
      probeToolUseId: 'tu-1',
    })
    expect(second.err).toBeNull()
    if (second.err !== null) return
    expect(second.reused).toBe(true)
    expect(second.ver).toBe(first.ver)
    expect(counted.frameGets()).toBe(before)
  })

  test('expired TTL misses reuse and hits network again', async () => {
    const counted = countingFetch(bootBody({ assetToken: 'tok' }))
    globalThis.fetch = counted.fetch
    const signal = new AbortController().signal
    const first = await fetchFrameBoot(SLUG, signal, {
      kind: 'probe',
      probe: true,
      gatePublicRead: false,
      probeToolUseId: 'tu-ttl',
    })
    expect(first.err).toBeNull()
    if (first.err !== null) return
    rememberProbeBoot(SLUG, first, {
      toolUseId: 'tu-ttl',
      issuedAt: Date.now() - PROBE_BOOT_TTL_MS - 1,
    })
    const before = counted.frameGets()
    const second = await fetchFrameBoot(SLUG, signal, {
      kind: 'read',
      gatePublicRead: false,
      probeToolUseId: 'tu-ttl',
    })
    expect(second.err).toBeNull()
    if (second.err !== null) return
    expect(second.reused).not.toBe(true)
    expect(counted.frameGets()).toBe(before + 1)
  })

  test('default gatePublicRead + tokenless + !Yw → public_read_disabled', async () => {
    gbValues.tengu_cobalt_plinth_sedge = false
    globalThis.fetch = countingFetch(bootBody()).fetch
    const r = await fetchFrameBoot(SLUG, new AbortController().signal, {
      kind: 'probe',
      probe: true,
      // gatePublicRead defaults true
    })
    expect(r.err).not.toBeNull()
    if (r.err === null) return
    expect(r.errorCode).toBe('public_read_disabled')
    expect(r.err).toContain('reading public artifacts that way is not enabled')
  })

  test('content fetch gatePublicRead:false does not return public_read_disabled', async () => {
    gbValues.tengu_cobalt_plinth_sedge = true
    globalThis.fetch = countingFetch(bootBody()).fetch
    const r = await fetchArtifactFileBytes({
      slug: SLUG,
      path: 'a.txt',
      admitPublicRead: () => true,
      probeToolUseId: 'tu-content',
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.bytes.toString()).toBe('file-bytes')
      expect(r.publicRead).toBe(true)
    }
  })

  test('content path Yw off returns tokenless not public_read_disabled', async () => {
    /// densable: aT({gatePublicRead:!1}) then caller does tokenless&&!Yw → tokenless.
    // Default gate would have ended at mint public_read_disabled instead.
    gbValues.tengu_cobalt_plinth_sedge = false
    globalThis.fetch = countingFetch(bootBody()).fetch
    const file = await fetchArtifactFileBytes({
      slug: SLUG,
      path: 'a.txt',
      admitPublicRead: () => true,
      probeToolUseId: 'tu-yw-off',
    })
    expect(file.kind).toBe('error')
    if (file.kind === 'error') {
      expect(file.reason).toBe('tokenless')
      expect(file.reason).not.toBe('public_read_disabled')
      expect(file.message).not.toContain(
        'reading public artifacts that way is not enabled',
      )
    }
    const asset = await fetchArtifactAssetBytes({
      slug: SLUG,
      assetId: 'a'.repeat(32),
      admitPublicRead: () => true,
      probeToolUseId: 'tu-yw-off-asset',
    })
    expect(asset.kind).toBe('error')
    if (asset.kind === 'error') {
      expect(asset.reason).toBe('tokenless')
      expect(asset.reason).not.toBe('public_read_disabled')
    }
  })

  test('content fetch forwards probeToolUseId into fetchFrameBoot', async () => {
    const counted = countingFetch(bootBody({ assetToken: 'tok' }))
    globalThis.fetch = counted.fetch
    const signal = new AbortController().signal
    const first = await fetchFrameBoot(SLUG, signal, {
      kind: 'probe',
      probe: true,
      gatePublicRead: false,
      probeToolUseId: 'tu-forward',
    })
    expect(first.err).toBeNull()
    if (first.err !== null) return
    rememberProbeBoot(SLUG, first, {
      toolUseId: 'tu-forward',
      issuedAt: Date.now(),
    })
    const before = counted.frameGets()
    // Forwarded probeToolUseId must hit tryReuseProbeBoot (no second frame GET).
    const r = await fetchArtifactFileBytes({
      slug: SLUG,
      path: 'a.txt',
      signal,
      probeToolUseId: 'tu-forward',
    })
    expect(r.kind).toBe('ok')
    expect(counted.frameGets()).toBe(before)
  })

  test('clearProbeBoot drops reuse', async () => {
    const counted = countingFetch(bootBody({ assetToken: 'tok' }))
    globalThis.fetch = counted.fetch
    const signal = new AbortController().signal
    const first = await fetchFrameBoot(SLUG, signal, {
      kind: 'probe',
      probe: true,
      gatePublicRead: false,
      probeToolUseId: 'tu-clear',
    })
    expect(first.err).toBeNull()
    if (first.err !== null) return
    rememberProbeBoot(SLUG, first, {
      toolUseId: 'tu-clear',
      issuedAt: Date.now(),
    })
    clearProbeBoot(SLUG)
    const before = counted.frameGets()
    const second = await fetchFrameBoot(SLUG, signal, {
      kind: 'read',
      gatePublicRead: false,
      probeToolUseId: 'tu-clear',
    })
    expect(second.err).toBeNull()
    if (second.err !== null) return
    expect(second.reused).not.toBe(true)
    expect(counted.frameGets()).toBe(before + 1)
  })

  test('failed Kgl/Uht clears probeBoots (densable Q_n on err)', () => {
    rememberProbeBoot(
      SLUG,
      {
        err: null,
        data: { typeInstance: false },
        ver: 'v1',
        assetToken: 'tok',
      },
      { toolUseId: 'tu-fail', issuedAt: Date.now() },
    )
    expect(un().shareStatus.probeBoots.has(SLUG)).toBe(true)
    Kgl(
      SLUG,
      { err: 'probe failed', errorCode: 'boot_failed' },
      { issuedAt: Date.now(), consumedByCheck: true, toolUseId: 'tu-fail' },
    )
    expect(un().shareStatus.probeBoots.has(SLUG)).toBe(false)
  })

  test('fresh boot with mismatched ver drops probeBoots (densable kin)', async () => {
    rememberProbeBoot(
      SLUG,
      {
        err: null,
        data: { typeInstance: false },
        ver: 'old-ver',
        assetToken: 'tok',
      },
      { toolUseId: 'tu-ver', issuedAt: Date.now() },
    )
    expect(un().shareStatus.probeBoots.get(SLUG)?.boot.ver).toBe('old-ver')
    globalThis.fetch = countingFetch(
      bootBody({ assetToken: 'tok', ver: 'new-ver-aaaaaaaaaaaaaaaa' }),
    ).fetch
    const r = await fetchFrameBoot(SLUG, new AbortController().signal, {
      kind: 'read',
      gatePublicRead: false,
    })
    expect(r.err).toBeNull()
    if (r.err !== null) return
    expect(r.ver).toBe('new-ver-aaaaaaaaaaaaaaaa')
    expect(un().shareStatus.probeBoots.has(SLUG)).toBe(false)
  })
})
