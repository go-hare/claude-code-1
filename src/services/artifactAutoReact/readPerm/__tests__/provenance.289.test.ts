/**
 * densable 2.1.289 yt / zl / v1 / xN / aKe / G0 / Sh / xct / fq / ine / Tu /
 * hat / AE — Artifact read-permission provenance lookups.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../../tests/mocks/settings.js'
import * as realGrowthbook from '../../../analytics/growthbook.js'

const growthbookSnap = snapshotModuleExports(realGrowthbook)
const gbValues: Record<string, unknown> = {}

function growthbookMock() {
  return {
    ...growthbookSnap,
    getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) =>
      key in gbValues ? gbValues[key] : fallback,
  }
}
mock.module('src/services/analytics/growthbook.ts', growthbookMock)
mock.module('src/services/analytics/growthbook.js', growthbookMock)

const {
  AE,
  aKe,
  B5,
  bWn,
  fq,
  G0,
  GHt,
  Gtn,
  hat,
  ine,
  jD,
  Kjt,
  LPe,
  md,
  Pbe,
  provenanceState,
  qjt,
  resetProvenanceStateForTests,
  setProvenanceDepsForTests,
  Sh,
  Tu,
  Ue,
  v1,
  xct,
  xN,
  yt,
  zl,
} = await import('../provenance.js')
const { resetArtifactAutoReactStoreForTests, un } = await import(
  '../../store.js'
)
const { setFrameDlDepsForTests } = await import('../../frameDl.js')
const { Ozr, resetConsentStateForTests } = await import('../consent.js')

afterAll(() => {
  mock.module('src/services/analytics/growthbook.ts', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

const ENV_KEYS = [
  'CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_ENVIRONMENT_KIND',
] as const

afterEach(() => {
  resetProvenanceStateForTests()
  resetConsentStateForTests()
  resetArtifactAutoReactStoreForTests()
  setFrameDlDepsForTests(null)
  for (const key of Object.keys(gbValues)) delete gbValues[key]
  for (const key of ENV_KEYS) delete process.env[key]
})

const SLUG = '11111111-1111-1111-1111-111111111111'
const TYPE_SLUG = '22222222-2222-2222-2222-222222222222'
const PARSED = { slug: SLUG, env: 'prod' as const }

type Row = NonNullable<ReturnType<typeof yt>>

function setStatus(patch: Partial<Row>): void {
  const row: Row = { mode: 'owner', isSharedLive: false, ...patch }
  un().shareStatus.bySlug.set(SLUG, row)
}

function fakeContext(opts?: {
  mode?: string
  appState?: Record<string, unknown>
  toolUseId?: string
}) {
  return {
    toolUseId: opts?.toolUseId ?? 'tu-1',
    abortController: new AbortController(),
    permissionLayers: undefined,
    getAppState: () => ({
      toolPermissionContext: {
        mode: opts?.mode ?? 'default',
        isBypassPermissionsModeAvailable: false,
      },
      ...opts?.appState,
    }),
  } as never
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFrameFetch(handler: (url: string) => Response): string[] {
  const calls: string[] = []
  setFrameDlDepsForTests({
    fetch: (async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      return handler(url)
    }) as typeof globalThis.fetch,
    oauthBearer: () => 'test-oauth',
    claudeAiOrigin: () => 'https://claude.ai',
    isRelayOpen: () => false,
  })
  return calls
}

describe('densable 2.1.289 ownership predicates', () => {
  test('zl / jD / v1 / B5 / xN', () => {
    setStatus({ role: 'owner' })
    expect(zl(yt(SLUG))).toBe(true)
    expect(jD(yt(SLUG))).toBe(false)
    setStatus({ role: 'writer' })
    expect(jD(yt(SLUG))).toBe(true)
    setStatus({ role: 'owner', probeFailed: true })
    expect(zl(yt(SLUG))).toBe(false)

    expect(v1({ mode: 'owner', isSharedLive: false, cowritten: true })).toBe(
      true,
    )
    expect(
      v1({ mode: 'owner', isSharedLive: false, artifactKind: 'live-doc' }),
    ).toBe(true)
    expect(B5({ mode: 'owner', isSharedLive: false, typeLock: null })).toBe(
      false,
    )
    expect(
      B5({ mode: 'owner', isSharedLive: false, typeLock: { slug: 'x' } }),
    ).toBe(true)

    const own = {
      mode: 'owner',
      isSharedLive: false,
      role: 'owner' as const,
      typeLocked: true,
    }
    expect(xN(own)).toBe(true)
    expect(xN({ ...own, artifactKind: 'live-doc' })).toBe(false)
    expect(xN(own, false)).toBe(false)
  })

  test('co-written D = zl && v1 && !xN', () => {
    setStatus({ role: 'owner', cowritten: true })
    const s = yt(SLUG)
    expect(zl(s) && v1(s) && !xN(s)).toBe(true)
    setStatus({ role: 'owner', cowritten: true, typeLocked: true })
    const t = yt(SLUG)
    expect(zl(t) && v1(t) && !xN(t)).toBe(false)
  })

  test('aKe needs a first_party_type attestation on the source type', () => {
    setStatus({ role: 'owner', typeLock: { slug: TYPE_SLUG } })
    expect(aKe(yt(SLUG))).toBe(false)
    GHt(TYPE_SLUG, 'first_party_type', Date.now())
    expect(aKe(yt(SLUG))).toBe(true)
    expect(aKe(yt(SLUG), false)).toBe(false)
  })

  test('G0 needs outsideOrgReader and tengu_cobalt_plinth_sedge', () => {
    setStatus({ role: 'reader', outsideOrgReader: true })
    expect(G0(yt(SLUG))).toBe(false)
    gbValues.tengu_cobalt_plinth_sedge = true
    expect(G0(yt(SLUG))).toBe(true)
    expect(Gtn).toBe('This artifact was created outside your organization.')
  })

  test('xct tier labels', () => {
    expect(xct('first_party_type')).toBe(
      'a published first-party Artifact type',
    )
    expect(xct('pipeline_instance')).toBe(
      "a template the organization's publishing pipeline owns",
    )
  })
})

describe('densable 2.1.289 Sh attestation marks (GHt / bWn)', () => {
  test('newer mark wins; same instant prefers the lower rank', () => {
    GHt(SLUG, 'template_instance', 10)
    GHt(SLUG, 'first_party_type', 10)
    expect(Sh(SLUG)).toBe('first_party_type')
    GHt(SLUG, 'pipeline_instance', 9)
    expect(Sh(SLUG)).toBe('first_party_type')
    GHt(SLUG, 'pipeline_instance', 11)
    expect(Sh(SLUG)).toBe('pipeline_instance')
  })

  test('revocation blocks older re-marks; account boundary blocks all', () => {
    GHt(SLUG, 'first_party_type', 10)
    bWn(SLUG, ['first_party_type'], 20)
    expect(Sh(SLUG)).toBeUndefined()
    GHt(SLUG, 'first_party_type', 15)
    expect(Sh(SLUG)).toBeUndefined()
    GHt(SLUG, 'first_party_type', 25)
    expect(Sh(SLUG)).toBe('first_party_type')
    provenanceState().accountBoundaryAt = 100
    GHt(TYPE_SLUG, 'first_party_type', 50)
    expect(Sh(TYPE_SLUG)).toBeUndefined()
  })
})

describe('densable 2.1.289 fq / ine', () => {
  test('fq: attested someone-else artifact with a fresh probe, not in plan', () => {
    setStatus({ role: 'writer', lastProbeIssuedAt: 5 })
    expect(fq(fakeContext(), SLUG)).toBe(false)
    GHt(SLUG, 'org_pinned_instance', 5)
    expect(fq(fakeContext(), SLUG)).toBe(true)
    expect(fq(fakeContext({ mode: 'plan' }), SLUG)).toBe(false)
    provenanceState().accountBoundaryAt = 5
    expect(fq(fakeContext(), SLUG)).toBe(false)
  })

  test('ine without five-class asks reads epoch-guarded AppState consent', () => {
    setStatus({ role: 'writer' })
    const consent = { artifactAssetReadConsentSlugs: { [SLUG]: true } }
    expect(ine(fakeContext(), PARSED, false)).toBe(false)
    expect(ine(fakeContext({ appState: consent }), PARSED, false)).toBe(true)
    un().accountEpoch = 1
    expect(ine(fakeContext({ appState: consent }), PARSED, false)).toBe(false)
    expect(
      ine(
        fakeContext({ appState: { ...consent, artifactConsentEpoch: 1 } }),
        PARSED,
        false,
      ),
    ).toBe(true)
    expect(
      ine(
        fakeContext({
          mode: 'plan',
          appState: { ...consent, artifactConsentEpoch: 1 },
        }),
        PARSED,
        false,
      ),
    ).toBe(false)
  })

  test('ine with five-class asks: own, network-on foreign, ask-class consent', () => {
    process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS = '1'
    expect(md()).toBe(true)
    setStatus({ role: 'owner' })
    expect(ine(fakeContext(), PARSED, true)).toBe(true)

    setStatus({ role: 'writer' })
    expect(ine(fakeContext(), PARSED, false)).toBe(true)

    process.env.CLAUDE_CODE_REMOTE = '1'
    Ue('prod', 'disabled')
    expect(ine(fakeContext(), PARSED, false)).toBe(false)
    Ozr('foreign_read', SLUG)
    expect(ine(fakeContext(), PARSED, false)).toBe(true)
  })

  test('ine with five-class asks: outside-org needs a person', () => {
    process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS = '1'
    gbValues.tengu_cobalt_plinth_sedge = true
    setStatus({ role: 'reader', outsideOrgReader: true })
    expect(Pbe(false, PARSED)).toBe(true)
    Ozr('foreign_read', SLUG)
    expect(ine(fakeContext(), PARSED, false)).toBe(false)
    Ozr('foreign_read', SLUG, true)
    expect(ine(fakeContext(), PARSED, false)).toBe(true)
  })
})

describe('densable 2.1.289 AE', () => {
  test('boot_org_mismatch denies with the other-organization copy', () => {
    expect(AE(PARSED, 'Nothing was read or changed')).toBeNull()
    setStatus({ probeFailed: true, probeErrorCode: 'boot_org_mismatch' })
    expect(AE(PARSED, 'Nothing was read or changed')).toEqual({
      behavior: 'deny',
      message: `https://claude.ai/code/artifact/${SLUG}: this Artifact is in another of the user's organizations, not the one this session is signed in to — nothing in this session can reach it until the user runs /login and signs in to that organization. Nothing was read or changed; tell the user.`,
      decisionReason: {
        type: 'other',
        reason: "Artifact is in another of the user's organizations",
      },
    })
  })
})

describe('densable 2.1.289 Tu', () => {
  test('probes once per toolUseId and keeps provenance fields', async () => {
    setStatus({ role: 'owner', typeLocked: true, typeSlug: TYPE_SLUG })
    const calls = installFrameFetch(() =>
      jsonResponse(200, {
        ver: 'v1',
        assetToken: 'tok',
        perm: { role: 'owner', mode: 'owner' },
        title: 'Deck',
      }),
    )
    const ctx = fakeContext({ toolUseId: 'tu-probe' })
    await Tu(PARSED, ctx, 'read_file', { readBack: false })
    const row = yt(SLUG)
    expect(row).toMatchObject({
      role: 'owner',
      title: 'Deck',
      typeLocked: true,
      typeSlug: TYPE_SLUG,
      outsideOrgReader: false,
      lastProbeToolUseId: 'tu-probe',
    })
    await Tu(PARSED, ctx, 'read_file')
    expect(calls.length).toBe(1)
  })

  test('tokenless public boot with Yw off → public_read_disabled (SEA aT default)', async () => {
    // densable share-probe omits gatePublicRead → aT default true.
    gbValues.tengu_cobalt_plinth_sedge = false
    installFrameFetch(() =>
      jsonResponse(200, { ver: 'v1', mode: 'public', perm: { role: 'owner' } }),
    )
    await Tu(PARSED, fakeContext(), 'list_files')
    expect(yt(SLUG)).toMatchObject({
      probeFailed: true,
      probeErrorCode: 'public_read_disabled',
    })
  })

  test('member assetToken probe still lands with Yw off', async () => {
    gbValues.tengu_cobalt_plinth_sedge = false
    installFrameFetch(() =>
      jsonResponse(200, {
        ver: 'v1',
        assetToken: 'tok',
        perm: { role: 'owner', mode: 'owner' },
        title: 'Owned',
      }),
    )
    await Tu(PARSED, fakeContext({ toolUseId: 'tu-member' }), 'read_file')
    expect(yt(SLUG)).toMatchObject({
      role: 'owner',
      title: 'Owned',
      outsideOrgReader: false,
      lastProbeToolUseId: 'tu-member',
      probeFailed: false,
    })
  })

  test('tokenless boot with Yw on lands as an outside-org reader', async () => {
    gbValues.tengu_cobalt_plinth_sedge = true
    installFrameFetch(() =>
      jsonResponse(200, { ver: 'v1', mode: 'public', perm: { role: 'owner' } }),
    )
    await Tu(PARSED, fakeContext(), 'list_files')
    expect(yt(SLUG)).toMatchObject({ mode: 'public', outsideOrgReader: true })
  })

  test('env mismatch fails the probe without a request', async () => {
    const calls = installFrameFetch(() => jsonResponse(500, {}))
    await Tu({ slug: SLUG, env: 'staging' }, fakeContext(), 'read_asset')
    expect(calls.length).toBe(0)
    expect(yt(SLUG)).toMatchObject({
      probeFailed: true,
      probeErrorCode: 'env_mismatch',
    })
  })

  test('remote Cowork: an allowlist-denied egress probe marks the env', async () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_cowork'
    installFrameFetch(() =>
      jsonResponse(200, {
        ver: 'v1',
        assetToken: 'tok',
        perm: { role: 'writer', mode: 'org' },
      }),
    )
    const egressCalls: string[] = []
    setProvenanceDepsForTests({
      fetch: (async (input: string | URL | Request) => {
        egressCalls.push(String(input))
        return new Response('blocked', {
          status: 403,
          headers: { 'x-proxy-error': 'blocked-by-allowlist' },
        })
      }) as typeof globalThis.fetch,
    })
    await Tu(PARSED, fakeContext(), 'read_file')
    expect(egressCalls).toEqual([
      `https://${SLUG}.frame.claudeusercontent.com/_warmup`,
    ])
    expect(un().contentHostEgressDenied.has('prod')).toBe(true)
    expect(Pbe(false, PARSED)).toBe(true)
    expect(Pbe(true, PARSED)).toBe(false)
  })
})

describe('densable 2.1.289 kin boot provenance', () => {
  test('a 403 org_mismatch boot lands boot_org_mismatch so AE denies', async () => {
    const calls = installFrameFetch(() =>
      jsonResponse(403, {
        error: 'forbidden',
        reason: 'org_mismatch',
        owner_org: '33333333-3333-3333-3333-333333333333',
      }),
    )
    await Tu(PARSED, fakeContext(), 'read_file', { readBack: true })
    expect(calls[0]).toContain('?via=model_read&bk=probe&readback=1')
    expect(yt(SLUG)).toMatchObject({
      probeFailed: true,
      probeErrorCode: 'boot_org_mismatch',
    })
    expect(AE(PARSED, 'Nothing was read or changed')?.behavior).toBe('deny')
  })

  test('readBack body lands lastCapsReadAt so Ijn can pass', async () => {
    installFrameFetch(() =>
      jsonResponse(200, {
        ver: 'v1',
        assetToken: 'tok',
        perm: { role: 'owner', mode: 'org' },
        typeInstance: false,
        readback: { capabilities: [], contract: {} },
      }),
    )
    await Tu(PARSED, fakeContext(), 'reply', { readBack: true })
    expect(yt(SLUG)?.lastCapsReadAt).toEqual(expect.any(Number))
    expect(yt(SLUG)?.capabilitiesUnknown).toBeUndefined()
  })

  test('boot type + typeFacts record the type lock and first-party attestation', async () => {
    installFrameFetch(() =>
      jsonResponse(200, {
        ver: 'v1',
        assetToken: 'tok',
        perm: { role: 'owner', mode: 'org' },
        type: { slug: TYPE_SLUG },
        typeFacts: { typeFirstParty: true, template: true },
        authoredByOthers: true,
        outsideWriter: false,
      }),
    )
    await Tu(PARSED, fakeContext(), 'read_file')
    const row = yt(SLUG)
    expect(row).toMatchObject({
      role: 'owner',
      typeLocked: true,
      typeSlug: TYPE_SLUG,
      authoredByOthers: true,
      outsideWriter: false,
    })
    expect(row?.external).toBeUndefined()
    expect(B5(row)).toBe(true)
    expect(xN(row)).toBe(true)
    expect(Sh(TYPE_SLUG)).toBe('first_party_type')
    expect(Sh(SLUG)).toBe('template_instance')
    expect(aKe(row)).toBe(true)
  })

  test('an external boot skips the instance attestation', async () => {
    installFrameFetch(() =>
      jsonResponse(200, {
        ver: 'v1',
        assetToken: 'tok',
        mode: 'external',
        perm: { role: 'reader', mode: 'external' },
        typeFacts: { firstPartyType: true },
      }),
    )
    await Tu(PARSED, fakeContext(), 'read_file')
    expect(yt(SLUG)?.external).toBe(true)
    expect(Sh(SLUG)).toBeUndefined()
  })

  test('commenter and viewer roles count as someone else’s artifact', async () => {
    for (const role of ['commenter', 'viewer'] as const) {
      resetArtifactAutoReactStoreForTests()
      installFrameFetch(() =>
        jsonResponse(200, { ver: 'v1', assetToken: 'tok', perm: { role } }),
      )
      await Tu(PARSED, fakeContext({ toolUseId: `tu-${role}` }), 'read_file')
      expect(yt(SLUG)?.role).toBe(role)
      expect(jD(yt(SLUG))).toBe(true)
    }
  })
})

describe('densable 2.1.289 hat', () => {
  test('prefetches the source type and attests a first-party listing', async () => {
    setStatus({ role: 'owner', typeLocked: true, typeSlug: TYPE_SLUG })
    const calls = installFrameFetch(url => {
      expect(url).toBe(`https://claude.ai/api/frame/types/${TYPE_SLUG}`)
      return jsonResponse(200, {
        slug: TYPE_SLUG,
        title: 'Slides',
        listings: [{ scope: 'anthropic', tier: 'core' }],
      })
    })
    const signal = new AbortController().signal
    await hat(PARSED, { signal })
    expect(Sh(TYPE_SLUG)).toBe('first_party_type')
    expect(aKe(yt(SLUG))).toBe(true)
    await hat(PARSED, { signal })
    expect(calls.length).toBe(1)
  })

  test('skips when the artifact is not the user’s own type instance', async () => {
    setStatus({ role: 'writer', typeLocked: true, typeSlug: TYPE_SLUG })
    const calls = installFrameFetch(() => jsonResponse(200, {}))
    await hat(PARSED, { signal: new AbortController().signal })
    expect(calls.length).toBe(0)
  })
})

describe('densable 2.1.289 qjt / Bht / LPe / Kjt', () => {
  test('qjt persists cowritten true and ignores other values', () => {
    qjt(SLUG, true)
    expect(yt(SLUG)?.cowritten).toBe(true)
    expect(yt(SLUG)?.mode).toBe('owner')
    qjt(SLUG, false)
    expect(yt(SLUG)?.cowritten).toBe(true)
  })

  test('LPe is response true, stored true, or owned with the field omitted', () => {
    expect(LPe(true, undefined, false)).toBe(true)
    expect(LPe(true, false, false)).toBe(false)
    expect(LPe(false, undefined, undefined)).toBe(false)
    expect(LPe(false, true, false)).toBe(true)
    expect(LPe(false, false, true)).toBe(true)
  })

  test('Kjt stamps outside_writer for an owned artifact when the reply omits it', () => {
    setStatus({ role: 'owner' })
    expect(Kjt(SLUG, undefined)).toBe(true)
    expect(yt(SLUG)?.outsideWriter).toBeUndefined()
  })

  test('Kjt persists a false reply and does not downgrade a stored true', () => {
    setStatus({ role: 'owner' })
    expect(Kjt(SLUG, false)).toBe(false)
    expect(yt(SLUG)?.outsideWriter).toBe(false)
    expect(Kjt(SLUG, true)).toBe(true)
    expect(yt(SLUG)?.outsideWriter).toBe(true)
    expect(Kjt(SLUG, false)).toBe(true)
    expect(yt(SLUG)?.outsideWriter).toBe(true)
  })
})
