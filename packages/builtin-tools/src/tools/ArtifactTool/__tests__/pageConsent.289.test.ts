/**
 * densable 2.1.289 Artifact page `action:"read"` consent (NCo / mKe page /
 * UI files_read dump).
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
const { artifactPageReadGrant } = await import('../readSaveHooks.js')
const { beginArtifactConsentCheck, resetConsentStateForTests } = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/consent.js'
)
const { GHt, resetProvenanceStateForTests } = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/provenance.js'
)
const { mayAdmitOutsideOrgArtifactRead, recordArtifactPageReadGrant } =
  await import(
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

function setRole(role: 'owner' | 'reader', toolUseId: string): void {
  const now = Date.now()
  un().shareStatus.bySlug.set(SLUG, {
    mode: 'org',
    isSharedLive: false,
    role,
    lastProbeToolUseId: toolUseId,
    lastProbeIssuedAt: now,
    // densable Tu skip: same toolUseId + lastCapsReadAt lands readBack.
    lastCapsReadAt: now,
    lastCapsReadToolUseId: toolUseId,
  } as never)
}

describe('densable 2.1.289 page read consent (NCo)', () => {
  function session(mode = 'default') {
    let appState: Record<string, unknown> = {
      toolPermissionContext: { ...getEmptyToolPermissionContext(), mode },
    }
    return {
      appState: () => appState,
      context(toolUseId: string, approvedBy?: string) {
        return {
          toolUseId,
          abortController: new AbortController(),
          messages: [],
          getAppState: () => appState,
          setAppState: (f: (prev: Record<string, unknown>) => never) => {
            appState = f(appState)
          },
          ...(approvedBy !== undefined && {
            toolDecisions: new Map([
              [
                toolUseId,
                { source: approvedBy, decision: 'accept', timestamp: 0 },
              ],
            ]),
          }),
        } as never
      },
    }
  }

  async function check(s: ReturnType<typeof session>, toolUseId: string) {
    setRole('reader', toolUseId)
    const ctx = s.context(toolUseId)
    beginArtifactConsentCheck(ctx)
    return (await checkArtifactActionPermissions(
      { action: 'read', url: URL },
      ctx,
    )) as {
      behavior: string
      updatedInput?: Record<string, unknown>
    }
  }

  async function approve(
    s: ReturnType<typeof session>,
    toolUseId: string,
    input: Record<string, unknown>,
  ) {
    const grant = await artifactPageReadGrant(
      input,
      s.context(toolUseId, 'user_temporary'),
    )
    grant?.()
  }

  test('first page read asks; after approve+record, second allows via artifactReadConsentSlugs', async () => {
    const s = session()
    const first = await check(s, 'tu-1')
    expect(first.behavior).toBe('ask')
    expect(first.updatedInput?.__artifactConsentAskCanReachUser).toBe(true)
    await approve(s, 'tu-1', first.updatedInput ?? {})
    expect(s.appState().artifactReadConsentSlugs).toEqual({ [SLUG]: true })
    expect(s.appState().artifactAssetReadHumanConsentSlugs).toBeUndefined()
    expect(s.appState().artifactConsentEpoch ?? 0).toBe(un().accountEpoch)
    const second = await check(s, 'tu-2')
    expect(second.behavior).toBe('allow')
    expect(second.updatedInput?.__artifactConsentAskCanReachUser).toBe(false)
  })

  test('mKe page uses artifactReadConsentSlugs not Human asset map', () => {
    const s = session()
    const ctx = s.context('tu-mke')
    beginArtifactConsentCheck(ctx)
    expect(mayAdmitOutsideOrgArtifactRead({}, ctx, SLUG, 'page')).toBe(false)
    // NCo requires Wu (V); without it the map stays empty.
    recordArtifactPageReadGrant({ url: URL }, ctx, SLUG)
    expect(s.appState().artifactReadConsentSlugs).toBeUndefined()
    recordArtifactPageReadGrant(
      { url: URL, __artifactConsentAskCanReachUser: true },
      ctx,
      SLUG,
    )
    expect(s.appState().artifactReadConsentSlugs).toEqual({ [SLUG]: true })
    expect(mayAdmitOutsideOrgArtifactRead({}, ctx, SLUG, 'page')).toBe(true)
    expect(mayAdmitOutsideOrgArtifactRead({}, ctx, SLUG, 'files')).toBe(false)
    // densable assets kind shares the human asset map with files.
    expect(mayAdmitOutsideOrgArtifactRead({}, ctx, SLUG, 'assets')).toBe(false)
  })

  test('UI source lock includes files_read in the JSON dump branch', () => {
    const ui = readFileSync(join(import.meta.dir, '../UI.tsx'), 'utf8')
    expect(ui).toContain('content.files_read')
    expect(ui).toContain('content.file_read')
  })

  test('gold page read has no modeAllowsQuietRead shortcut', () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(src).not.toContain('modeAllowsQuietRead')
    expect(src).not.toContain('allows artifact')
    expect(src).toContain(
      'Read of this shared artifact already approved this conversation',
    )
    expect(src).toContain("Reading the user's own artifact")
    expect(src).toContain('needs no approval')
    expect(src).toContain('Aat(context, parsed, input.url, readOpts)')
    expect(src).toContain('Ltn')
    const rules = readFileSync(
      join(
        import.meta.dir,
        '../../../../../../src/services/artifactAutoReact/readPerm/rules.ts',
      ),
      'utf8',
    )
    expect(rules).toContain('export function Aat')
    expect(rules).toContain('jjt(artifactRegistriesFromContext(context)')
    expect(rules).toContain('Otn(context, parsed, url, read)')
    expect(rules).toContain('export function C(')
    const consent = readFileSync(
      join(
        import.meta.dir,
        '../../../../../../src/services/artifactAutoReact/readPerm/consent.ts',
      ),
      'utf8',
    )
    expect(consent).toContain("export const Ltn = '__artifactReadTargetPin'")
    expect(consent).toContain(
      'approving covers re-reads of this artifact for the rest of the conversation',
    )
  })

  test('auto mode without consent still asks (gold, not quiet shortcut)', async () => {
    const s = session('auto')
    const first = await check(s, 'tu-auto')
    expect(first.behavior).toBe('ask')
  })

  test('unparseable url denies with gold unique English', async () => {
    const s = session()
    const ctx = s.context('tu-bad')
    beginArtifactConsentCheck(ctx)
    const result = (await checkArtifactActionPermissions(
      { action: 'read', url: 'https://example.com/not-an-artifact' },
      ctx,
    )) as { behavior: string; message?: string }
    expect(result.behavior).toBe('deny')
    expect(result.message).toContain(
      'This is not an artifact url Claude can read',
    )
  })

  test('fq attested someone-else: needs no approval unique English', async () => {
    const s = session()
    GHt(SLUG, 'first_party_type', Date.now())
    const first = await check(s, 'tu-fq')
    expect(first.behavior).toBe('allow')
    expect(first.updatedInput?.__artifactReadTargetPin).toEqual({
      action: 'read',
      slug: SLUG,
    })
    expect(
      (first as { decisionReason?: { reason?: string } }).decisionReason
        ?.reason,
    ).toBe('Reading a published first-party Artifact type needs no approval')
  })

  test('plan+no surface+attested: gold skips Sh (fq false in plan) and denies', async () => {
    const s = session('plan')
    s.appState().toolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      mode: 'plan',
      shouldAvoidPermissionPrompts: true,
    }
    GHt(SLUG, 'first_party_type', Date.now())
    const first = await check(s, 'tu-plan-attested')
    expect(first.behavior).toBe('deny')
    expect(String((first as { message?: string }).message)).toContain(
      "Reading someone else's artifact from plan mode needs a consent surface",
    )
  })
})
