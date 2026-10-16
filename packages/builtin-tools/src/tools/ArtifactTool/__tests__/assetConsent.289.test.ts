;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}

/**
 * densable 2.1.289 Artifact upload_asset / delete_asset consent
 * (Xqe reader, qIt writer, eH delete pin).
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'
import * as realGrowthbook from '../../../../../../src/services/analytics/growthbook.js'
import { getEmptyToolPermissionContext } from '../../../../../../src/Tool.js'

const growthbookSnap = snapshotModuleExports(realGrowthbook)

function growthbookMock() {
  return {
    ...growthbookSnap,
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE:
      growthbookSnap.checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  }
}
mock.module('src/services/analytics/growthbook.ts', growthbookMock)
mock.module('src/services/analytics/growthbook.js', growthbookMock)

const { resetArtifactAutoReactStoreForTests, un } = await import(
  '../../../../../../src/services/artifactAutoReact/index.js'
)
const { checkArtifactActionPermissions } = await import('../permissions.js')
const {
  beginArtifactConsentCheck,
  eH,
  gNe,
  qm,
  resetConsentStateForTests,
  Wu,
} = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/consent.js'
)
const { resetProvenanceStateForTests } = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/provenance.js'
)
const { recordArtifactAssetUploadGrant } = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/grants.js'
)

afterAll(() => {
  mock.module('src/services/analytics/growthbook.ts', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

afterEach(() => {
  resetProvenanceStateForTests()
  resetConsentStateForTests()
  resetArtifactAutoReactStoreForTests()
})

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const ASSET_ID = 'a'.repeat(32)
const FILE = '/tmp/asset.bin'

function seedProbe(toolUseId: string, extra?: Record<string, unknown>): void {
  un().shareStatus.bySlug.set(SLUG, {
    mode: 'owner',
    isSharedLive: false,
    role: 'owner',
    lastProbeToolUseId: toolUseId,
    lastProbeIssuedAt: Date.now(),
    ...extra,
  } as never)
}

function session(mode = 'default') {
  let appState: Record<string, unknown> = {
    toolPermissionContext: { ...getEmptyToolPermissionContext(), mode },
  }
  return {
    appState: () => appState,
    context(toolUseId: string) {
      return {
        toolUseId,
        abortController: new AbortController(),
        messages: [],
        getAppState: () => appState,
        setAppState: (f: (prev: Record<string, unknown>) => never) => {
          appState = f(appState)
        },
      } as never
    },
  }
}

describe('densable 2.1.289 upload_asset consent (Xqe / qIt)', () => {
  test('unparseable url denies', async () => {
    const s = session()
    const ctx = s.context('tu-bad')
    beginArtifactConsentCheck(ctx)
    const r = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: 'https://example.com/x', file_path: FILE },
      ctx,
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain('not an artifact url')
  })

  test('first upload asks with Wu; after qIt, second allows via Xqe', async () => {
    const s = session()
    seedProbe('tu-1')
    const first = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: URL, file_path: FILE },
      s.context('tu-1'),
    )) as {
      behavior: string
      updatedInput?: Record<string, unknown>
    }
    expect(first.behavior).toBe('ask')
    expect(first.updatedInput?.[Wu]).toBe(true)
    expect(first.updatedInput?.[qm]).toBe(false)
    expect(first.updatedInput?.[gNe]).toEqual({
      slug: SLUG,
      real: FILE,
      identity: null,
    })
    const ctx = s.context('tu-1')
    beginArtifactConsentCheck(ctx)
    recordArtifactAssetUploadGrant(first.updatedInput ?? {}, ctx, SLUG)
    expect(s.appState().artifactAssetUploadConsentSlugs).toEqual({
      [SLUG]: true,
    })
    seedProbe('tu-2')
    const second = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: URL, file_path: FILE },
      s.context('tu-2'),
    )) as {
      behavior: string
      updatedInput?: Record<string, unknown>
    }
    expect(second.behavior).toBe('allow')
    expect(second.updatedInput?.[Wu]).toBe(false)
  })

  test('plan ask stamps qm so qIt writes Human; Xqe then admits', async () => {
    const s = session('plan')
    seedProbe('tu-p1')
    const first = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: URL, file_path: FILE },
      s.context('tu-p1'),
    )) as {
      behavior: string
      updatedInput?: Record<string, unknown>
    }
    expect(first.behavior).toBe('ask')
    expect(first.updatedInput?.[qm]).toBe(true)
    expect(first.updatedInput?.[Wu]).toBe(true)
    const ctx = s.context('tu-p1')
    beginArtifactConsentCheck(ctx)
    recordArtifactAssetUploadGrant(first.updatedInput ?? {}, ctx, SLUG)
    expect(s.appState().artifactAssetUploadHumanConsentSlugs).toEqual({
      [SLUG]: true,
    })
    seedProbe('tu-p2')
    const second = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: URL, file_path: FILE },
      s.context('tu-p2'),
    )) as { behavior: string }
    expect(second.behavior).toBe('allow')
  })
})

describe('densable 2.1.289 delete_asset eH @211244084', () => {
  test('stamps eH {action, slug, assetId} and never remembers', async () => {
    const s = session()
    const ctx = s.context('tu-del')
    beginArtifactConsentCheck(ctx)
    const r = (await checkArtifactActionPermissions(
      { action: 'delete_asset', url: URL, asset_id: ASSET_ID },
      ctx,
    )) as {
      behavior: string
      updatedInput?: Record<string, unknown>
      localDisplayOnly?: boolean
    }
    expect(r.behavior).toBe('ask')
    expect(r.updatedInput?.[eH]).toEqual({
      action: 'delete_asset',
      slug: SLUG,
      assetId: ASSET_ID,
    })
    expect(r.updatedInput?.[Wu]).toBe(false)
    expect(r.updatedInput?.[qm]).toBe(false)
    expect(r.localDisplayOnly).toBe(true)
  })

  test('call delete_asset reads eH pin via Reflect.get, matching Tat/gNe', () => {
    const src = readFileSync(
      join(import.meta.dir, '../ArtifactTool.ts'),
      'utf8',
    )
    expect(src).toContain('async function callDeleteAsset')
    expect(src).toContain('Reflect.get(input, ARTIFACT_ASSET_TARGET_PIN)')
    expect(src).toContain("pin?.action !== 'delete_asset'")
    expect(src).toContain(
      'This asset delete was not confirmed by the user, so nothing was deleted',
    )
  })

  test('unparseable url or bad asset_id denies', async () => {
    const s = session()
    const badUrl = (await checkArtifactActionPermissions(
      {
        action: 'delete_asset',
        url: 'https://example.com/x',
        asset_id: ASSET_ID,
      },
      s.context('tu-d1'),
    )) as { behavior: string; message?: string }
    expect(badUrl.behavior).toBe('deny')
    expect(badUrl.message).toContain('not an artifact url')
    const badId = (await checkArtifactActionPermissions(
      { action: 'delete_asset', url: URL, asset_id: 'nope' },
      s.context('tu-d2'),
    )) as { behavior: string; message?: string }
    expect(badId.behavior).toBe('deny')
    expect(badId.message).toContain('32 hex characters')
  })
})
