/**
 * densable 2.1.289 list_files O7 thickness — single_page / public_refused.
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
import { listArtifactFiles } from '../restApis.js'

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFrameFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): string[] {
  const calls: string[] = []
  setFrameDlDepsForTests({
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return handler(url, init)
    }) as typeof globalThis.fetch,
    oauthBearer: () => 'test-oauth',
    claudeAiOrigin: () => 'https://claude.ai',
    isRelayOpen: () => false,
  })
  // Content-host HEAD for densable te() uses global fetch, not FrameDl deps.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return handler(url, init)
  }) as typeof fetch
  return calls
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
})

afterEach(() => {
  setFrameDlDepsForTests(null)
  globalThis.fetch = prevFetch
})

describe('listArtifactFiles O7 @195904654', () => {
  test('HTTP 404 with !filesCounted → single_page', async () => {
    installFrameFetch(url => {
      if (url.includes(`/api/frame/${SLUG}?`)) {
        return jsonResponse(200, {
          ver: 'v7',
          assetToken: 'atok',
          perm: { role: 'owner' },
        })
      }
      if (url.includes(`/api/frame/files/${SLUG}`)) {
        return jsonResponse(404, { error: 'not_found' })
      }
      return new Response('miss', { status: 404 })
    })
    const r = await listArtifactFiles({ slug: SLUG })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.reason).toBe('single_page')
      expect(r.message).toBe(
        'this artifact is a single page with no separately published files, so there is no file list; read the page itself',
      )
      expect(r.ver).toBe('v7')
    }
  })

  test('HTTP 404 with filesCounted stays http_404 (not single_page)', async () => {
    installFrameFetch(url => {
      if (url.includes(`/api/frame/${SLUG}?`)) {
        return jsonResponse(200, {
          ver: 'v7',
          assetToken: 'atok',
          fileCount: 2,
          perm: { role: 'owner' },
        })
      }
      if (url.includes(`/api/frame/files/${SLUG}`)) {
        return jsonResponse(404, { error: 'not_found' })
      }
      return new Response('miss', { status: 404 })
    })
    const r = await listArtifactFiles({ slug: SLUG })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.reason).toBe('http_404')
      expect(r.message).toContain('does not offer their list yet')
    }
  })

  test('publicRead + 403 + te HEAD miss → public_refused', async () => {
    gbValues.tengu_cobalt_plinth_sedge = true
    installFrameFetch((url, init) => {
      if (url.includes(`/api/frame/${SLUG}?`)) {
        return jsonResponse(200, {
          ver: 'v7',
          mode: 'public',
          perm: { role: 'reader' },
        })
      }
      if (url.includes(`/api/frame/files/${SLUG}`)) {
        return jsonResponse(403, { error: 'forbidden' })
      }
      if (
        (init?.method === 'HEAD' || url.includes('/_f/v7/')) &&
        url.includes('claudeusercontent.com')
      ) {
        return new Response(null, { status: 404 })
      }
      return new Response('miss', { status: 404 })
    })
    const r = await listArtifactFiles({
      slug: SLUG,
      admitPublicRead: () => true,
    })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.reason).toBe('public_refused')
      expect(r.message).toBe(
        "this public artifact's files are not available to readers outside its organization right now — it may no longer be public, or it was taken down",
      )
    }
  })

  test('ok bag carries writerClass/orgRelation/title from member boot', async () => {
    installFrameFetch(url => {
      if (url.includes('/api/frame/files/')) {
        return jsonResponse(200, {
          ver: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          files: [
            {
              path: 'a.txt',
              content_type: 'text/plain',
              size_bytes: 1,
              sha256: 'b'.repeat(64),
            },
          ],
        })
      }
      if (url.includes('/api/frame/')) {
        return jsonResponse(200, {
          ver: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          assetToken: 'member-token',
          mode: 'org',
          perm: { role: 'owner' },
          title: 'Bag List',
          fileCount: 1,
        })
      }
      return jsonResponse(404, {})
    })
    const r = await listArtifactFiles({
      slug: SLUG,
      admitPublicRead: () => true,
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.writerClass).toBe(true)
      // densable aIr: mode defined → unproven (before owner role check).
      expect(r.orgRelation).toBe('unproven')
      expect(r.title).toBe('Bag List')
      // foreign only stamped when true (omit on false).
      expect(r.foreign).toBeUndefined()
      expect(r.publicRead).toBeUndefined()
    }
  })

  test('REMOTE without frame relay → relay_unavailable', async () => {
    const prev = process.env.CLAUDE_CODE_REMOTE
    process.env.CLAUDE_CODE_REMOTE = '1'
    try {
      const r = await listArtifactFiles({ slug: SLUG })
      expect(r.kind).toBe('error')
      if (r.kind === 'error') {
        expect(r.reason).toBe('relay_unavailable')
        expect(r.message).toContain('Anthropic-hosted cloud session')
      }
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_REMOTE
      else process.env.CLAUDE_CODE_REMOTE = prev
    }
  })

  test('publicRead + 403 + te HEAD 200 → public single_page', async () => {
    gbValues.tengu_cobalt_plinth_sedge = true
    installFrameFetch((url, init) => {
      if (url.includes(`/api/frame/${SLUG}?`)) {
        return jsonResponse(200, {
          ver: 'v7',
          mode: 'public',
          perm: { role: 'reader' },
        })
      }
      if (url.includes(`/api/frame/files/${SLUG}`)) {
        return jsonResponse(403, { error: 'forbidden' })
      }
      if (
        init?.method === 'HEAD' &&
        url.includes('claudeusercontent.com') &&
        url.includes('/_f/v7/')
      ) {
        return new Response(null, { status: 200 })
      }
      return new Response('miss', { status: 404 })
    })
    const r = await listArtifactFiles({
      slug: SLUG,
      admitPublicRead: () => true,
    })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.reason).toBe('single_page')
      expect(r.message).toBe(
        'this public artifact is a single page with no separately published files, so there is no file list; read the page itself',
      )
    }
  })

  test('ok path marks live files from boot livePaths and sets publicRead', async () => {
    gbValues.tengu_cobalt_plinth_sedge = true
    installFrameFetch(url => {
      if (url.includes(`/api/frame/${SLUG}?`)) {
        return jsonResponse(200, {
          ver: 'v9',
          mode: 'public',
          livePaths: [{ path: 'live.md' }, { path: 'other.md' }],
          perm: { role: 'reader' },
        })
      }
      if (url.includes(`/api/frame/files/${SLUG}`)) {
        return jsonResponse(200, {
          ver: 'v9',
          files: [
            {
              path: 'live.md',
              content_type: 'text/markdown',
              size_bytes: 3,
              sha256: 'a'.repeat(64),
            },
            {
              path: 'static.txt',
              content_type: 'text/plain',
              size_bytes: 1,
              sha256: 'b'.repeat(64),
            },
          ],
        })
      }
      return new Response('miss', { status: 404 })
    })
    const r = await listArtifactFiles({
      slug: SLUG,
      admitPublicRead: () => true,
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.publicRead).toBe(true)
      expect(r.files).toEqual([
        {
          path: 'live.md',
          contentType: 'text/markdown',
          sizeBytes: 3,
          sha256: 'a'.repeat(64),
          live: true,
        },
        {
          path: 'static.txt',
          contentType: 'text/plain',
          sizeBytes: 1,
          sha256: 'b'.repeat(64),
        },
      ])
    }
  })
})
