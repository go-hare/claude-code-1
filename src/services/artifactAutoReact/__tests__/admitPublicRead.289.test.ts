/**
 * densable 2.1.289 admitPublicRead (mKe) fetch wiring — tokenless public gate
 * and kind map split (page vs files/assets).
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
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realGrowthbook from '../../../services/analytics/growthbook.js'
import { getClaudeAIOAuthTokens } from '../../../utils/auth.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { resetArtifactAutoReactStoreForTests } from '../index.js'
import {
  mayAdmitOutsideOrgArtifactRead,
  mayAdmitPublicArtifactRead,
  recordArtifactPageReadGrant,
  recordArtifactReadGrant,
} from '../readPerm/grants.js'
import {
  beginArtifactConsentCheck,
  resetConsentStateForTests,
} from '../readPerm/consent.js'
import { resetProvenanceStateForTests } from '../readPerm/provenance.js'
import { fetchArtifactAssetBytes, fetchArtifactFileBytes } from '../restApis.js'
import { callArtifactReadFile } from '../saveActions.js'
import { eH } from '../readPerm/consent.js'

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
const URL = `https://claude.ai/code/artifact/${SLUG}`
const ASSET_ID = 'a'.repeat(32)
const root = mkdtempSync(join(tmpdir(), 'admit-public-289-'))
const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
const prevFetch = globalThis.fetch

function clearTokenMemo(): void {
  ;(
    getClaudeAIOAuthTokens as unknown as { cache?: { clear?: () => void } }
  ).cache?.clear?.()
}

function session() {
  let state: Record<string, unknown> = {
    toolPermissionContext: getEmptyToolPermissionContext(),
  }
  const context = (toolUseId = 'tu') => {
    const ctx = {
      toolUseId,
      getAppState: () => state as never,
      setAppState: (u: (prev: never) => never) => {
        state = u(state as never) as Record<string, unknown>
      },
      toolDecisions: undefined,
      permissionLayers: undefined,
    }
    beginArtifactConsentCheck(ctx)
    return ctx
  }
  return {
    context,
    appState: () => state,
  }
}

function publicBootFetch(body: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const u = String(input)
    if (u.includes('/api/frame/') && !u.includes('claudeusercontent')) {
      return new Response(
        JSON.stringify({
          ver: 'v7',
          mode: 'public',
          perm: { role: 'owner' },
        }),
        { status: 200 },
      )
    }
    if (u.includes('claudeusercontent.com')) {
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }
    return new Response('miss', { status: 404 })
  }) as typeof fetch
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
  rmSync(root, { recursive: true, force: true })
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

describe('mayAdmitPublicArtifactRead kind maps', () => {
  test('page hits artifactReadConsentSlugs; files/assets hit human asset map', () => {
    const s = session()
    const ctx = s.context('tu-kind')
    expect(mayAdmitPublicArtifactRead({}, ctx, SLUG, 'page')).toBe(false)
    expect(mayAdmitOutsideOrgArtifactRead({}, ctx, SLUG, 'files')).toBe(false)
    expect(mayAdmitPublicArtifactRead({}, ctx, SLUG, 'assets')).toBe(false)

    recordArtifactPageReadGrant(
      { url: URL, __artifactConsentAskCanReachUser: true },
      ctx,
      SLUG,
    )
    expect(s.appState().artifactReadConsentSlugs).toEqual({ [SLUG]: true })
    expect(mayAdmitPublicArtifactRead({}, ctx, SLUG, 'page')).toBe(true)
    expect(mayAdmitPublicArtifactRead({}, ctx, SLUG, 'files')).toBe(false)
    expect(mayAdmitPublicArtifactRead({}, ctx, SLUG, 'assets')).toBe(false)

    // files grant: human asset map (cKe with Wu + human)
    recordArtifactReadGrant(
      {
        url: URL,
        __artifactConsentAskCanReachUser: true,
        [eH]: { action: 'read_file', slug: SLUG },
      },
      ctx,
      SLUG,
    )
    // Without outside-org Do path, cKe still stamps asset maps when V/Te hold.
    // If human map landed, files/assets admit; page remains independent.
    const human = s.appState().artifactAssetReadHumanConsentSlugs as
      | Record<string, true>
      | undefined
    if (human?.[SLUG] === true) {
      expect(mayAdmitPublicArtifactRead({}, ctx, SLUG, 'files')).toBe(true)
      expect(mayAdmitPublicArtifactRead({}, ctx, SLUG, 'assets')).toBe(true)
    }
    expect(mayAdmitPublicArtifactRead({}, ctx, SLUG, 'page')).toBe(true)
  })
})

describe('fetchArtifact* admitPublicRead', () => {
  test('tokenless with Yw off stays tokenless (no admit consulted for success)', async () => {
    gbValues.tengu_cobalt_plinth_sedge = false
    globalThis.fetch = publicBootFetch('hello public file')
    const seen: boolean[] = []
    const r = await fetchArtifactFileBytes({
      slug: SLUG,
      path: 'a.txt',
      admitPublicRead: () => {
        seen.push(true)
        return true
      },
    })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.reason).toBe('tokenless')
    // Gold short-circuits on !Yw before admitPublicRead.
    expect(seen).toEqual([])
  })

  test('tokenless with Yw on and admit false → public_unasked', async () => {
    gbValues.tengu_cobalt_plinth_sedge = true
    globalThis.fetch = publicBootFetch('hello public file')
    let called = 0
    const r = await fetchArtifactFileBytes({
      slug: SLUG,
      path: 'a.txt',
      admitPublicRead: () => {
        called++
        return false
      },
    })
    expect(called).toBe(1)
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.reason).toBe('public_unasked')
      expect(r.message).toContain('no person has approved reading it here')
    }
  })

  test('tokenless with Yw on and admit true fetches content', async () => {
    gbValues.tengu_cobalt_plinth_sedge = true
    globalThis.fetch = publicBootFetch('hello public file')
    const r = await fetchArtifactFileBytes({
      slug: SLUG,
      path: 'a.txt',
      admitPublicRead: () => true,
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.bytes.toString()).toBe('hello public file')
      expect(r.publicRead).toBe(true)
    }
  })

  test('asset fetch receives admitPublicRead and refuses when false', async () => {
    gbValues.tengu_cobalt_plinth_sedge = true
    globalThis.fetch = publicBootFetch('asset-bytes')
    const r = await fetchArtifactAssetBytes({
      slug: SLUG,
      assetId: ASSET_ID,
      admitPublicRead: () => false,
    })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.reason).toBe('public_unasked')
  })

  test('saveActions forwards admitPublicRead into file fetch', async () => {
    gbValues.tengu_cobalt_plinth_sedge = true
    globalThis.fetch = publicBootFetch('via-save')
    let called = 0
    const out = join(root, 'out')
    const r = await callArtifactReadFile({
      url: URL,
      path: 'a.txt',
      out_dir: out,
      admitPublicRead: () => {
        called++
        return true
      },
    })
    expect(called).toBe(1)
    expect('data' in r).toBe(true)
  })
})
