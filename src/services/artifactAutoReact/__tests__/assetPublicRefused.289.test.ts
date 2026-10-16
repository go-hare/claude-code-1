/**
 * densable 2.1.289 wko asset Ibe → public_refused (tokenless 403 + plain forbidden).
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
import { setFrameDlDepsForTests } from '../frameDl.js'
import { fetchArtifactAssetBytes } from '../restApis.js'

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
const ASSET_ID = 'a'.repeat(32)
const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
const prevFetch = globalThis.fetch

function clearTokenMemo(): void {
  ;(
    getClaudeAIOAuthTokens as unknown as { cache?: { clear?: () => void } }
  ).cache?.clear?.()
}

function installFetches(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): void {
  setFrameDlDepsForTests({
    fetch: (async (input: string | URL | Request, init?: RequestInit) =>
      handler(String(input), init)) as typeof globalThis.fetch,
    oauthBearer: () => 'test-oauth',
    claudeAiOrigin: () => 'https://claude.ai',
    isRelayOpen: () => false,
  })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch
}

beforeAll(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth'
  clearTokenMemo()
})

afterAll(() => {
  globalThis.fetch = prevFetch
  setFrameDlDepsForTests(null)
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
  gbValues.tengu_cobalt_plinth_sedge = true
})

afterEach(() => {
  setFrameDlDepsForTests(null)
  globalThis.fetch = prevFetch
})

describe('fetchArtifactAssetBytes Ibe public_refused', () => {
  test('tokenless 403 + text/plain forbidden → public_refused', async () => {
    installFetches(url => {
      if (url.includes('/api/frame/') && !url.includes('/files/')) {
        return new Response(
          JSON.stringify({
            ver: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            mode: 'public',
            kind: 'public',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('forbidden', {
        status: 403,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    })
    const r = await fetchArtifactAssetBytes({
      slug: SLUG,
      assetId: ASSET_ID,
      admitPublicRead: () => true,
    })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.reason).toBe('public_refused')
      expect(r.message).toContain(
        'serves no asset with that id to readers outside its organization',
      )
    }
  })

  test('tokenless 403 + x-deny-reason stays http_403 (not Ibe)', async () => {
    installFetches(url => {
      if (url.includes('/api/frame/') && !url.includes('/files/')) {
        return new Response(
          JSON.stringify({
            ver: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            mode: 'public',
            kind: 'public',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('forbidden', {
        status: 403,
        headers: {
          'content-type': 'text/plain',
          'x-deny-reason': 'host_not_allowed',
        },
      })
    })
    const r = await fetchArtifactAssetBytes({
      slug: SLUG,
      assetId: ASSET_ID,
      admitPublicRead: () => true,
    })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.reason).toBe('http_403')
  })

  test('member-token 403 stays http_403 (Ibe only on tokenless)', async () => {
    installFetches(url => {
      if (url.includes('/api/frame/') && !url.includes('/files/')) {
        return new Response(
          JSON.stringify({
            ver: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            assetToken: 'member-token',
            mode: 'org',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('forbidden', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      })
    })
    const r = await fetchArtifactAssetBytes({
      slug: SLUG,
      assetId: ASSET_ID,
    })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.reason).toBe('http_403')
  })
})
