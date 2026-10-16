/**
 * densable 2.1.289 Artifact comments checkPermissions — hosted subset.
 * Gold @210871235: a_/qR deny, Fee AE/Ow, md+Tu+dD, K_/k7/T7/Xle/zen. jAr KEEP.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'
import * as realGrowthbook from '../../../../../../src/services/analytics/growthbook.js'
import { getEmptyToolPermissionContext } from '../../../../../../src/Tool.js'
import type { ToolPermissionRulesBySource } from '../../../../../../src/types/permissions.js'

const growthbookSnap = snapshotModuleExports(realGrowthbook)
const flags: Record<string, unknown> = {}

function growthbookMock() {
  return {
    ...growthbookSnap,
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE:
      growthbookSnap.checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
    getFeatureValue_CACHED_MAY_BE_STALE: (name: string, fallback: unknown) =>
      name in flags ? flags[name] : fallback,
  }
}
mock.module('src/services/analytics/growthbook.ts', growthbookMock)
mock.module('src/services/analytics/growthbook.js', growthbookMock)

const { resetArtifactAutoReactStoreForTests, un } = await import(
  '../../../../../../src/services/artifactAutoReact/index.js'
)
const { Sqe, zIe } = await import(
  '../../../../../../src/services/artifactAutoReact/ownership.js'
)
const { checkArtifactActionPermissions } = await import('../permissions.js')
const { $tn, resetConsentStateForTests, v, Wu } = await import(
  '../../../../../../src/services/artifactAutoReact/readPerm/consent.js'
)

afterAll(() => {
  mock.module('src/services/analytics/growthbook.ts', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

function clearCoworkEnv(): void {
  delete process.env.CLAUDE_CODE_ENTRYPOINT
  delete process.env.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS
  delete process.env.CLAUDE_CODE_CHILD_SESSION
  delete process.env.CLAUDECODE
}

afterEach(() => {
  delete process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS
  clearCoworkEnv()
  for (const key of Object.keys(flags)) delete flags[key]
  resetConsentStateForTests()
  resetArtifactAutoReactStoreForTests()
})

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const FEE_ASK =
  `Claude wants to read the comment threads on ${URL} — prompted by the ` +
  'new-comments notification; comment text is written by artifact viewers'

function seedStatus(toolUseId: string, extra?: Record<string, unknown>): void {
  un().shareStatus.bySlug.set(SLUG, {
    mode: 'org',
    isSharedLive: false,
    lastProbeToolUseId: toolUseId,
    lastProbeIssuedAt: Date.now(),
    ...extra,
  } as never)
}

function ctx(
  toolUseId: string,
  rules?: {
    deny?: ToolPermissionRulesBySource
    ask?: ToolPermissionRulesBySource
    allow?: ToolPermissionRulesBySource
    mode?: string
    avoidPrompts?: boolean
  },
) {
  const empty = getEmptyToolPermissionContext()
  return {
    toolUseId,
    abortController: new AbortController(),
    messages: [],
    getAppState: () => ({
      toolPermissionContext: {
        ...empty,
        mode: rules?.mode ?? empty.mode,
        alwaysDenyRules: rules?.deny ?? empty.alwaysDenyRules,
        alwaysAskRules: rules?.ask ?? empty.alwaysAskRules,
        alwaysAllowRules: rules?.allow ?? empty.alwaysAllowRules,
        ...(rules?.avoidPrompts === true
          ? { shouldAvoidPermissionPrompts: true }
          : {}),
      },
    }),
  } as never
}

async function checkComments(
  toolUseId: string,
  rules?: Parameters<typeof ctx>[1],
) {
  return (await checkArtifactActionPermissions(
    { action: 'comments', url: URL },
    ctx(toolUseId, rules),
  )) as {
    behavior: string
    message?: string
    updatedInput?: Record<string, unknown>
    decisionReason?: { type?: string }
  }
}

describe('densable 2.1.289 comments checkPermissions hosted @210871235', () => {
  test('a_ url deny returns qR before Fee ask', async () => {
    zIe(SLUG)
    seedStatus('tu-deny')
    const r = await checkComments('tu-deny', {
      deny: { userSettings: [`Artifact(url:${URL})`] },
    })
    expect(r.behavior).toBe('deny')
    expect(r.message).toBe(
      `Reading this artifact is blocked by the Artifact(url:${URL}) deny rule from user settings.`,
    )
    expect(r.decisionReason?.type).toBe('rule')
  })

  test('Fee notice + other-org AE denies', async () => {
    zIe(SLUG)
    seedStatus('tu-ae', {
      probeFailed: true,
      probeErrorCode: 'boot_org_mismatch',
      role: undefined,
    })
    const r = await checkComments('tu-ae')
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain("another of the user's organizations")
    expect(r.message).toContain('Nothing was read')
  })

  test('Fee notice + Ow whole-tool deny returns qR', async () => {
    zIe(SLUG)
    seedStatus('tu-ow')
    const r = await checkComments('tu-ow', {
      deny: { userSettings: ['Artifact'] },
    })
    expect(r.behavior).toBe('deny')
    expect(r.message).toBe(
      'Reading this artifact is blocked by the Artifact deny rule from user settings.',
    )
    expect(r.decisionReason?.type).toBe('rule')
  })

  test('non-Fee a_ ask uses Bte suffix', async () => {
    seedStatus('tu-ask')
    const r = await checkComments('tu-ask', {
      ask: { userSettings: [`Artifact(url:${URL})`] },
    })
    expect(r.behavior).toBe('ask')
    expect(r.message).toBe(
      `Claude wants to read the comment threads on ${URL} (your Artifact ask rule covers this url); comment text is written by artifact viewers`,
    )
    expect(r.message).not.toBe(FEE_ASK)
    expect(r.decisionReason?.type).toBe('rule')
  })

  test('md+dD allows an owned artifact without a Fee notice', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS = '1'
    seedStatus('tu-md-own', { role: 'owner' })
    const r = await checkComments('tu-md-own')
    expect(r.behavior).toBe('allow')
    expect(r.updatedInput?.[Wu]).toBe(false)
    expect(r.updatedInput?.[$tn]).toBeUndefined()
  })

  test('md+dD asks when ownership is unknown', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS = '1'
    seedStatus('tu-md-ask')
    const r = await checkComments('tu-md-ask')
    expect(r.behavior).toBe('ask')
    expect(r.message).toContain("couldn't check who made")
    expect(r.updatedInput?.[$tn]).toMatchObject({
      class: 'foreign_read',
      remember: 'this_call',
      slug: SLUG,
    })
  })

  test('md+dD other-org AE denies without a Fee notice', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS = '1'
    seedStatus('tu-md-ae', {
      probeFailed: true,
      probeErrorCode: 'boot_org_mismatch',
      role: undefined,
    })
    const r = await checkComments('tu-md-ae')
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain('Nothing was read')
  })

  test('K_ stamps comments pin on allow and Fee ask', async () => {
    const allow = await checkComments('tu-pin-allow')
    expect(allow.behavior).toBe('allow')
    expect(allow.updatedInput?.[v]).toEqual({
      action: 'comments',
      slug: SLUG,
    })
    zIe(SLUG)
    seedStatus('tu-pin-ask')
    const ask = await checkComments('tu-pin-ask')
    expect(ask.behavior).toBe('ask')
    expect(ask.updatedInput?.[v]).toEqual({
      action: 'comments',
      slug: SLUG,
    })
  })

  test('k7 notes Fee sighting; take consumes it', async () => {
    zIe(SLUG)
    seedStatus('tu-k7')
    await checkComments('tu-k7')
    expect(un().shareStatus.noticeReadSights.comments.take('tu-k7', SLUG)).toBe(
      true,
    )
    expect(
      un().shareStatus.noticeReadSights.comments.take('tu-k7', SLUG),
    ).toBeUndefined()
    Sqe(SLUG)
    const quiet = await checkComments('tu-k7-quiet')
    expect(quiet.behavior).toBe('allow')
    expect(
      un().shareStatus.noticeReadSights.comments.take('tu-k7-quiet', SLUG),
    ).toBe(false)
  })

  test('T7 denies Fee notice in plan with no consent surface', async () => {
    zIe(SLUG)
    seedStatus('tu-t7')
    const r = await checkComments('tu-t7', {
      mode: 'plan',
      avoidPrompts: true,
    })
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain('Nothing was read')
    expect(r.message).toContain('plan mode')
  })

  test('Xle denies Fee+five-class foreign read when no one can answer', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS = '1'
    clearCoworkEnv()
    process.env.CLAUDE_CODE_ENTRYPOINT = 'local_agent'
    process.env.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS = '1'
    zIe(SLUG)
    seedStatus('tu-xle')
    const r = await checkComments('tu-xle', { mode: 'bypassPermissions' })
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain('Nothing was read')
    expect(r.message).toContain('user does not own')
  })

  test('zen allows Fee notice via action:reply when ochre_plover is on', async () => {
    flags.tengu_ochre_plover = true
    zIe(SLUG)
    seedStatus('tu-zen')
    const r = await checkComments('tu-zen', {
      allow: { userSettings: ['Artifact(action:reply)'] },
    })
    expect(r.behavior).toBe('allow')
    expect(r.updatedInput?.[v]).toEqual({
      action: 'comments',
      slug: SLUG,
    })
  })
})
