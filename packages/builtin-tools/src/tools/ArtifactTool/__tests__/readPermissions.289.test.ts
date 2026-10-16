/**
 * densable 2.1.289 ArtifactTool checkPermissions — read_file / read_asset /
 * list_files / list_assets consent branch.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'
import * as realGrowthbook from '../../../../../../src/services/analytics/growthbook.js'
import { getEmptyToolPermissionContext } from '../../../../../../src/Tool.js'

const growthbookSnap = snapshotModuleExports(realGrowthbook)
let scratchGate = true

function growthbookMock() {
  return {
    ...growthbookSnap,
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE: (gate: string) =>
      gate === 'tengu_scratch'
        ? scratchGate
        : growthbookSnap.checkStatsigFeatureGate_CACHED_MAY_BE_STALE(gate),
  }
}
mock.module('src/services/analytics/growthbook.ts', growthbookMock)
mock.module('src/services/analytics/growthbook.js', growthbookMock)

const { resetArtifactAutoReactStoreForTests, un } = await import(
  '../../../../../../src/services/artifactAutoReact/index.js'
)
const { checkArtifactReadPermissions } = await import('../readPermissions.js')
const { artifactReadGrant } = await import('../readSaveHooks.js')
const { beginArtifactConsentCheck } = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/consent.js'
)
const { resetProvenanceStateForTests } = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/provenance.js'
)
const { resetConsentStateForTests } = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/consent.js'
)
const { takeStashedWritePermission } = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/savePaths.js'
)
const { getScratchpadDir } = await import(
  '../../../../../../src/utils/permissions/filesystem.js'
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
  scratchGate = true
  resetProvenanceStateForTests()
  resetConsentStateForTests()
  resetArtifactAutoReactStoreForTests()
})

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const TOOL_USE_ID = 'tu-read-perm'

function setRole(role: 'owner' | 'reader', toolUseId = TOOL_USE_ID): void {
  un().shareStatus.bySlug.set(SLUG, {
    mode: 'org',
    isSharedLive: false,
    role,
    lastProbeToolUseId: toolUseId,
    lastProbeIssuedAt: Date.now(),
  } as never)
}

function fakeContext(opts?: { avoidPrompts?: boolean }) {
  return {
    toolUseId: TOOL_USE_ID,
    abortController: new AbortController(),
    messages: [],
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        ...(opts?.avoidPrompts ? { shouldAvoidPermissionPrompts: true } : {}),
      },
    }),
    setAppState: () => {},
  } as never
}

type Pinned = {
  behavior: string
  message?: string
  updatedInput?: Record<string, unknown>
  suppressAlwaysAllowRule?: boolean
  localDisplayOnly?: boolean
}

function defaultBase(): string {
  return join(getScratchpadDir(), 'artifact-files', SLUG)
}

describe('densable 2.1.289 read checkPermissions', () => {
  test('unparseable url denies before any probe', async () => {
    const r = (await checkArtifactReadPermissions(
      { action: 'read_file', url: 'https://example.com/x', path: 'a.txt' },
      fakeContext(),
    )) as Pinned
    expect(r.behavior).toBe('deny')
    expect(r.message).toBe(
      'This is not an artifact url Claude can read files from. Use the artifact url from the list or publish result.',
    )
  })

  test('read_asset with a malformed asset_id denies', async () => {
    const r = (await checkArtifactReadPermissions(
      { action: 'read_asset', url: URL, asset_id: 'nope' },
      fakeContext(),
    )) as Pinned
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain('32 hex characters')
  })

  test('own artifact into the scratchpad default dir allows with a pin and stash', async () => {
    setRole('owner')
    const r = (await checkArtifactReadPermissions(
      { action: 'read_file', url: URL, path: 'a.txt' },
      fakeContext(),
    )) as Pinned
    expect(r.behavior).toBe('allow')
    const stem = join(defaultBase(), 'a.txt')
    expect(r.updatedInput?.__artifactAssetTargetPin).toEqual({
      action: 'read_file',
      slug: SLUG,
      path: 'a.txt',
      stem,
      defaultDir: true,
    })
    expect(r.updatedInput?.out_dir).toBe(defaultBase())
    expect(Array.isArray(takeStashedWritePermission(TOOL_USE_ID, stem))).toBe(
      true,
    )
  })

  test('own artifact with out_dir outside the scratchpad asks', async () => {
    setRole('owner')
    const outDir = join(process.cwd(), '.tmp-read-perm-out')
    const r = (await checkArtifactReadPermissions(
      { action: 'read_file', url: URL, path: 'a.txt', out_dir: outDir },
      fakeContext(),
    )) as Pinned
    expect(r.behavior).toBe('ask')
    expect(r.message).toStartWith(
      `Let Claude save "a.txt" from this artifact to "`,
    )
    expect(r.message).toContain(
      "That folder is outside this session's scratchpad.",
    )
    expect(r.suppressAlwaysAllowRule).toBe(true)
    expect(r.localDisplayOnly).toBe(true)
    expect(r.updatedInput?.__artifactAssetTargetPin).toMatchObject({
      action: 'read_file',
      slug: SLUG,
      stem: join(outDir, 'a.txt'),
    })
    expect(r.updatedInput?.__artifactConsentAskCanReachUser).toBe(false)
  })

  test('no consent surface denies a save outside the scratchpad', async () => {
    setRole('owner')
    const r = (await checkArtifactReadPermissions(
      {
        action: 'read_file',
        url: URL,
        path: 'a.txt',
        out_dir: join(process.cwd(), '.tmp-read-perm-out'),
      },
      fakeContext({ avoidPrompts: true }),
    )) as Pinned
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain('no one can answer the prompt in this session')
  })

  test("someone else's artifact asks with the covers-the-conversation suffix", async () => {
    setRole('reader')
    const r = (await checkArtifactReadPermissions(
      { action: 'read_file', url: URL, path: 'a.txt' },
      fakeContext(),
    )) as Pinned
    expect(r.behavior).toBe('ask')
    expect(r.message).toBe(
      'This artifact was made by someone else. Let Claude read it? Approving covers its files for the rest of the conversation.',
    )
    expect(r.updatedInput?.__artifactConsentAskCanReachUser).toBe(true)
  })

  test('a protected path in a batch is set aside and reported as skipped', async () => {
    setRole('owner')
    const r = (await checkArtifactReadPermissions(
      { action: 'read_file', url: URL, paths: ['a.txt', '.git/config'] },
      fakeContext(),
    )) as Pinned
    expect(r.behavior).toBe('allow')
    expect(r.updatedInput?.__artifactAssetTargetPin).toMatchObject({
      action: 'read_file',
      slug: SLUG,
      paths: ['a.txt'],
      stems: [join(defaultBase(), 'a.txt')],
      skipped: ['.git/config'],
    })
  })
})

describe('densable 2.1.289 cKe read grant', () => {
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
    return (await checkArtifactReadPermissions(
      { action: 'read_file', url: URL, path: 'a.txt' },
      ctx,
    )) as Pinned
  }

  async function approve(
    s: ReturnType<typeof session>,
    toolUseId: string,
    input: Record<string, unknown>,
    approvedBy = 'user_temporary',
  ) {
    const grant = await artifactReadGrant(
      input,
      s.context(toolUseId, approvedBy),
    )
    grant?.()
  }

  test("an approved read of someone else's artifact stops the next one asking", async () => {
    const s = session()
    const first = await check(s, 'tu-1')
    expect(first.behavior).toBe('ask')
    await approve(s, 'tu-1', first.updatedInput ?? {})
    expect(s.appState().artifactAssetReadConsentSlugs).toEqual({ [SLUG]: true })
    expect(s.appState().artifactAssetReadHumanConsentSlugs).toBeUndefined()
    expect(s.appState().artifactConsentEpoch ?? 0).toBe(un().accountEpoch)
    expect((await check(s, 'tu-2')).behavior).toBe('allow')
  })

  test('a call without the approval pin records nothing', async () => {
    const s = session()
    await approve(s, 'tu-1', { action: 'read_file', url: URL, path: 'a.txt' })
    expect(s.appState().artifactAssetReadConsentSlugs).toBeUndefined()
  })

  test('a classifier-pinned or once approval records nothing', async () => {
    const s = session()
    const first = await check(s, 'tu-1')
    const input = first.updatedInput ?? {}
    const pin = input.__artifactAssetTargetPin as Record<string, unknown>
    await approve(s, 'tu-1', {
      ...input,
      __artifactAssetTargetPin: { ...pin, classifier: true },
    })
    await approve(s, 'tu-1', {
      ...input,
      __artifactAssetTargetPin: { ...pin, once: true },
    })
    expect(s.appState().artifactAssetReadConsentSlugs).toBeUndefined()
  })

  test('an account switch after the check voids the grant', async () => {
    const s = session()
    const first = await check(s, 'tu-1')
    un().accountEpoch += 1
    try {
      await approve(s, 'tu-1', first.updatedInput ?? {})
      expect(s.appState().artifactAssetReadConsentSlugs).toBeUndefined()
    } finally {
      un().accountEpoch -= 1
    }
  })

  test("the user's own plain artifact never needs a grant", async () => {
    const s = session()
    const input = {
      action: 'read_file',
      url: URL,
      path: 'a.txt',
      __artifactConsentAskCanReachUser: true,
      __artifactAssetTargetPin: { action: 'read_file', slug: SLUG },
    }
    setRole('owner', 'tu-1')
    beginArtifactConsentCheck(s.context('tu-1'))
    await approve(s, 'tu-1', input)
    expect(s.appState().artifactAssetReadConsentSlugs).toBeUndefined()
  })
})
