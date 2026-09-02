/**
 * densable jwe / Fee·jnt ownership / frame relay (2.1.239).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import {
  Fee,
  fetchArtifactAssetBytes,
  fetchViaArtifactFrameRelay,
  createCcrGatewayArtifactFrameRelayHost,
  getArtifactFrameRelayHost,
  installArtifactAutoReactProduct,
  ip,
  isArtifactFrameRelayOpen,
  isCobaltPlinthSorrelOpen,
  isSessionGatewayReady,
  jnt,
  probeArtifactOwnership,
  resetArtifactAutoReactProductForTests,
  resetArtifactAutoReactStoreForTests,
  resetArtifactFrameRelayHostForTests,
  resetInteractionSchemaGatesForTests,
  setArtifactFrameRelayHost,
  setFrameDlDepsForTests,
  Sqe,
  Tgr,
  un,
  zIe,
  artifactJweWriteBlock,
  artifactRelayServedPath,
  CGi,
  freezeReadPageDataSchemaNames,
  listEnabledInteractionSchemaNames,
  registerWorkshopDecisionsGate,
  VRm,
  DL,
  resolveFrameRelayFamily,
} from '../../services/artifactAutoReact/index.js'
import { checkArtifactActionPermissions } from '../../../packages/builtin-tools/src/tools/ArtifactTool/permissions.js'

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`

const authMock = {
  getClaudeAIOAuthTokens: mock(() => ({
    accessToken: 'test-oauth',
  })),
}
mock.module('../../utils/auth.js', () => authMock)
mock.module('src/utils/auth.js', () => authMock)

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  resetArtifactAutoReactProductForTests()
  resetArtifactFrameRelayHostForTests()
  resetInteractionSchemaGatesForTests()
  setFrameDlDepsForTests(null)
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_ARTIFACT_FRAME_RELAY
  delete process.env.CLAUDE_CODE_ARTIFACT_VERIFY
  delete process.env.CLAUDE_CODE_ARTIFACT_DELETE
  delete process.env.CLAUDE_CODE_SESSION_KIND
  delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
  delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
  delete process.env.SESSION_INGRESS_URL
})

function fakeContext(overrides?: { agentId?: string }) {
  return {
    abortController: new AbortController(),
    toolUseId: 'tu-own',
    getAppState: () => ({
      toolPermissionContext: { mode: 'default' },
    }),
    setAppState: () => {},
    ...overrides,
  } as never
}

describe('Fee / jnt ownership (239)', () => {
  test('Fee pending notice set/clear', () => {
    expect(Fee(SLUG)).toBe(false)
    zIe(SLUG)
    expect(Fee(SLUG)).toBe(true)
    Sqe(SLUG)
    expect(Fee(SLUG)).toBe(false)
  })

  test('comments asks when Fee notice is pending (gold Fee path)', async () => {
    zIe(SLUG)
    const ask = await checkArtifactActionPermissions(
      { action: 'comments', url: URL },
      fakeContext(),
    )
    expect(ask.behavior).toBe('ask')
    expect('message' in ask ? String(ask.message) : '').toContain(
      'new-comments notification',
    )
    Sqe(SLUG)
    const allow = await checkArtifactActionPermissions(
      { action: 'comments', url: URL },
      fakeContext(),
    )
    expect(allow.behavior).toBe('allow')
  })

  test('comments Fee ask is skipped for subagent agentId', async () => {
    zIe(SLUG)
    const r = await checkArtifactActionPermissions(
      { action: 'comments', url: URL },
      fakeContext({ agentId: 'agent-1' }),
    )
    expect(r.behavior).toBe('allow')
    Sqe(SLUG)
  })

  test('probe stores owner role via boot perm', async () => {
    const prev = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ver: 'v1',
          assetToken: 'atok',
          perm: { role: 'owner', mode: 'owner' },
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      const status = await probeArtifactOwnership(
        { slug: SLUG, env: 'prod' },
        { signal: new AbortController().signal, toolUseId: 't1' },
      )
      expect(jnt(status)).toBe(true)
      expect(ip(SLUG)?.role).toBe('owner')
      expect(Tgr(status)).toBe(false)
    } finally {
      globalThis.fetch = prev
    }
  })

  test('verify owner-only after probe', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_VERIFY = '1'
    const prev = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ver: 'v1',
          assetToken: 'atok',
          perm: { role: 'reader', mode: 'public' },
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      const r = await checkArtifactActionPermissions(
        { action: 'verify', url: URL },
        fakeContext(),
      )
      expect(r.behavior).toBe('deny')
      expect('message' in r ? String(r.message) : '').toContain('owner-only')
    } finally {
      globalThis.fetch = prev
    }
  })

  test('delete denies non-owner after probe', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_DELETE = '1'
    const prev = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ver: 'v1',
          assetToken: 'atok',
          perm: { role: 'writer', mode: 'users' },
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      const r = await checkArtifactActionPermissions(
        { action: 'delete', url: URL },
        fakeContext(),
      )
      expect(r.behavior).toBe('deny')
      expect('message' in r ? String(r.message) : '').toContain('someone else')
    } finally {
      globalThis.fetch = prev
    }
  })
})

describe('jwe write fence (239)', () => {
  test('interactive session: jwe null for cwd path', () => {
    const dir = join(process.cwd(), '.tmp-jwe-ok')
    mkdirSync(dir, { recursive: true })
    try {
      expect(artifactJweWriteBlock(join(dir, 'a.bin'))).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('frame relay (239)', () => {
  test('sEe closed without remote', () => {
    expect(isArtifactFrameRelayOpen()).toBe(false)
  })

  test('sEe closed when ENVIRONMENT_KIND set (not R$t)', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_ENVIRONMENT_KIND = 'bridge'
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'tok'
    process.env.SESSION_INGRESS_URL = 'https://ingress.test'
    expect(isArtifactFrameRelayOpen()).toBe(false)
  })

  test('sEe closed when cobalt sorrel forced off', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'tok'
    process.env.SESSION_INGRESS_URL = 'https://ingress.test'
    process.env.CLAUDE_CODE_ARTIFACT_FRAME_RELAY = '0'
    expect(isCobaltPlinthSorrelOpen()).toBe(false)
    expect(isArtifactFrameRelayOpen()).toBe(false)
  })

  test('remote without SDi → relay_unavailable on asset read', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    expect(isSessionGatewayReady()).toBe(false)
    expect(isArtifactFrameRelayOpen()).toBe(false)
    const r = await fetchArtifactAssetBytes({
      slug: SLUG,
      assetId: 'a'.repeat(32),
    })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.reason).toBe('relay_unavailable')
  })

  test('remote + SDi + host delivers via Fdw path', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'tok'
    process.env.SESSION_INGRESS_URL = 'https://ingress.test'
    process.env.CLAUDE_CODE_ARTIFACT_FRAME_RELAY = '1'
    setArtifactFrameRelayHost({
      fetchArtifactMount: async () => ({
        ok: true,
        status: 200,
        bytes: Buffer.from([9, 9]),
        contentType: 'image/png',
      }),
    })
    const prev = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ver: 'v1',
          assetToken: 'atok',
          perm: { role: 'owner' },
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      expect(isArtifactFrameRelayOpen()).toBe(true)
      const r = await fetchArtifactAssetBytes({
        slug: SLUG,
        assetId: 'b'.repeat(32),
      })
      expect(r.kind).toBe('ok')
      if (r.kind === 'ok') {
        expect(r.bytes.length).toBe(2)
        expect(r.relay).toBe(true)
      }
      // densable o$i marks Mlw family (boot); Fdw host marks artifact_mount
      const served = [...un().frameRelay.servedUntil.keys()]
      expect(served.length).toBeGreaterThanOrEqual(1)
      expect(served.includes('boot') || served.includes('artifact_mount')).toBe(
        true,
      )
    } finally {
      globalThis.fetch = prev
    }
  })

  test('production ccr-gateway JWT host hits NYr with Bearer + asset token', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'sess-jwt-test'
    process.env.SESSION_INGRESS_URL = 'https://ingress.test'
    process.env.CLAUDE_CODE_ARTIFACT_FRAME_RELAY = '1'
    const seen: { url?: string; headers?: Headers } = {}
    const host = createCcrGatewayArtifactFrameRelayHost({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.url = String(input)
        seen.headers = new Headers(init?.headers)
        return new Response(Buffer.from([1, 2, 3, 4]), {
          status: 200,
          headers: {
            'x-frame-asset-content-type': 'image/png',
          },
        })
      }) as unknown as typeof fetch,
    })
    setArtifactFrameRelayHost(host)
    const via = await fetchViaArtifactFrameRelay({
      slug: SLUG,
      servedPath: '/_f/v1/_blob/abcd',
      assetToken: 'atok',
      maxBytes: 1024,
    })
    expect(via.relayed).toBe(true)
    if (via.relayed && via.result.ok) {
      expect(via.result.bytes.equals(Buffer.from([1, 2, 3, 4]))).toBe(true)
      expect(via.result.contentType).toBe('image/png')
    }
    expect(seen.url).toBe(
      `https://ingress.test${artifactRelayServedPath(SLUG, '/_f/v1/_blob/abcd')}`,
    )
    expect(seen.headers?.get('authorization')).toBe('Bearer sess-jwt-test')
    expect(seen.headers?.get('x-frame-asset-token')).toBe('atok')
  })

  test('ccr-gateway host without session JWT → no_auth', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'present-for-sEe'
    process.env.SESSION_INGRESS_URL = 'https://ingress.test'
    process.env.CLAUDE_CODE_ARTIFACT_FRAME_RELAY = '1'
    setArtifactFrameRelayHost(
      createCcrGatewayArtifactFrameRelayHost({
        getAuthToken: () => null,
      }),
    )
    const via = await fetchViaArtifactFrameRelay({
      slug: SLUG,
      servedPath: '/_f/v1/index.html',
      assetToken: 'atok',
      maxBytes: 1024,
    })
    expect(via.relayed).toBe(false)
    if (!via.relayed) {
      expect(via.code).toBe('no_auth')
      expect(via.why).toContain('no gateway credential')
    }
  })

  test('product install binds default ccr-gateway host; inject overrides', () => {
    expect(getArtifactFrameRelayHost()).toBeNull()
    installArtifactAutoReactProduct()
    expect(getArtifactFrameRelayHost()).not.toBeNull()
    const custom = {
      fetchArtifactMount: async () =>
        ({
          ok: false,
          reason: 'custom',
        }) as const,
    }
    installArtifactAutoReactProduct({ frameRelayHost: custom })
    expect(getArtifactFrameRelayHost()).toBe(custom)
  })

  test('DL.getRelayOnly fails closed when sEe off', async () => {
    const r = await DL.getRelayOnly('/api/frame/x?via=model_read')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('relay-unavailable')
  })

  test('DL.getRelayOnly hits agent-proxy/frame when sEe open', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'tok'
    process.env.SESSION_INGRESS_URL = 'https://ingress.test'
    process.env.CLAUDE_CODE_ARTIFACT_FRAME_RELAY = '1'
    let hit = ''
    setFrameDlDepsForTests({
      fetch: (async (input: RequestInfo | URL) => {
        hit = String(input)
        return new Response(JSON.stringify({ ver: 'v1', assetToken: 'a' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-ccr-relay-upstream': '1',
          },
        })
      }) as unknown as typeof fetch,
    })
    const r = await DL.getRelayOnly(`/api/frame/${SLUG}?via=model_read`)
    expect(r.ok).toBe(true)
    expect(hit).toContain(`/v1/code/agent-proxy/frame/${SLUG}?via=model_read`)
  })

  test('o$i Mlw resolves boot/publish families', () => {
    expect(resolveFrameRelayFamily('GET', `/api/frame/${SLUG}`)).toBe('boot')
    expect(resolveFrameRelayFamily('POST', '/api/frame/deploy/direct')).toBe(
      'publish',
    )
    expect(resolveFrameRelayFamily('GET', '/api/frame/nope/extra')).toBeNull()
  })

  test('o$i soft-fail with x-ccr-relay-upstream keeps relay answer (bZf)', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'tok'
    process.env.SESSION_INGRESS_URL = 'https://ingress.test'
    process.env.CLAUDE_CODE_ARTIFACT_FRAME_RELAY = '1'
    let oauthHit = false
    setFrameDlDepsForTests({
      oauthBearer: async () => {
        oauthHit = true
        return 'oauth-tok'
      },
      fetch: (async () =>
        new Response(JSON.stringify({ err: 'missing' }), {
          status: 404,
          headers: {
            'content-type': 'application/json',
            'x-ccr-relay-upstream': '1',
          },
        })) as unknown as typeof fetch,
    })
    const r = await DL.get(`/api/frame/${SLUG}`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.status).toBe(404)
      expect(r.route).toBe('relay')
      expect(r.fromFrame).toBe(true)
    }
    expect(oauthHit).toBe(false)
    expect(un().frameRelay.declinedUntil.size).toBe(0)
  })

  test('o$i probe Ilw=65536 rejects oversized probe body', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'tok'
    process.env.SESSION_INGRESS_URL = 'https://ingress.test'
    process.env.CLAUDE_CODE_ARTIFACT_FRAME_RELAY = '1'
    setFrameDlDepsForTests({
      fetch: (async (input: RequestInfo | URL) => {
        const u = String(input)
        if (u.includes('contract/latest')) {
          const big = 'x'.repeat(70_000)
          return new Response(big, {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'content-length': String(big.length),
              'x-ccr-relay-upstream': '1',
            },
          })
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-ccr-relay-upstream': '1',
          },
        })
      }) as unknown as typeof fetch,
    })
    const r = await DL.post(
      '/api/frame/deploy/direct',
      { slug: SLUG, content: '<html></html>' },
      { relayProbe: '/api/frame/contract/latest' },
    )
    // oversized probe → fallBackDirect or fail; must not treat as served success silently
    expect(r.ok === false || r.route === 'direct').toBe(true)
  })

  test('CGi workshop-decisions registered; VRm empty until freeze+enabled', () => {
    expect(CGi('workshop-decisions').ok).toBe(true)
    expect(CGi('nope').ok).toBe(false)
    expect(listEnabledInteractionSchemaNames()).toEqual([])
    expect(VRm('workshop-decisions')).toBe(false)
    freezeReadPageDataSchemaNames(true, [])
    expect(VRm('workshop-decisions')).toBe(false)
    registerWorkshopDecisionsGate(() => true)
    freezeReadPageDataSchemaNames(true, listEnabledInteractionSchemaNames())
    expect(listEnabledInteractionSchemaNames()).toEqual(['workshop-decisions'])
    expect(VRm('workshop-decisions')).toBe(true)
  })
})
