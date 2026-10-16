/**
 * densable 2.1.289 Artifact grants — Xo early return on cKe/NCo/qIt,
 * Xqe upload reader, qIt upload writer.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { snapshotModuleExports } from '../../../../../tests/mocks/settings.js'
import * as realGrowthbook from '../../../../services/analytics/growthbook.js'
import { getEmptyToolPermissionContext } from '../../../../Tool.js'
import {
  isDelegatedObservation,
  runWithAgentContext,
} from '../../../../utils/agentContext.js'

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

const { resetArtifactAutoReactStoreForTests } = await import('../../index.js')
const { beginArtifactConsentCheck, OP, qm, resetConsentStateForTests, Wu } =
  await import('../consent.js')
const { resetProvenanceStateForTests } = await import('../provenance.js')
const {
  hasArtifactAssetUploadConsent,
  recordArtifactAssetUploadGrant,
  recordArtifactPageReadGrant,
  recordArtifactReadGrant,
} = await import('../grants.js')
const { eH } = await import('../consent.js')

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

function session(mode = 'default') {
  let appState: Record<string, unknown> = {
    toolPermissionContext: { ...getEmptyToolPermissionContext(), mode },
  }
  return {
    appState: () => appState,
    context(toolUseId: string) {
      return {
        toolUseId,
        getAppState: () => appState,
        setAppState: (f: (prev: Record<string, unknown>) => never) => {
          appState = f(appState)
        },
      } as never
    },
  }
}

const delegated = {
  agentType: 'subagent' as const,
  agentId: 'obs-1',
  delegatedObservation: true,
}

describe('gold Xo @182147842', () => {
  test('isDelegatedObservation matches gold Xo', () => {
    expect(isDelegatedObservation(undefined)).toBe(false)
    expect(
      isDelegatedObservation({ agentType: 'subagent', agentId: 'a' }),
    ).toBe(false)
    expect(
      isDelegatedObservation({
        agentType: 'subagent',
        agentId: 'a',
        delegatedObservation: false,
      }),
    ).toBe(false)
    expect(
      isDelegatedObservation({
        agentType: 'subagent',
        agentId: 'a',
        delegatedObservation: true,
      }),
    ).toBe(true)
    expect(
      isDelegatedObservation({
        agentType: 'teammate',
        agentId: 't',
        agentName: 't',
        teamName: 'team',
        planModeRequired: false,
        parentSessionId: 'p',
        isTeamLead: false,
        delegatedObservation: true,
      } as never),
    ).toBe(false)
  })

  test('cKe / NCo / qIt skip remember under delegatedObservation', () => {
    const s = session()
    const ctx = s.context('tu-xo')
    beginArtifactConsentCheck(ctx)
    const wu = { [Wu]: true, url: URL }
    runWithAgentContext(delegated, () => {
      recordArtifactReadGrant(
        { ...wu, [eH]: { action: 'read_file', slug: SLUG } },
        ctx,
        SLUG,
      )
      recordArtifactPageReadGrant(wu, ctx, SLUG)
      recordArtifactAssetUploadGrant(wu, ctx, SLUG)
    })
    expect(s.appState().artifactAssetReadConsentSlugs).toBeUndefined()
    expect(s.appState().artifactReadConsentSlugs).toBeUndefined()
    expect(s.appState().artifactAssetUploadConsentSlugs).toBeUndefined()
  })

  test('AgentTool spawn inherits Xo(parent) as gold tn', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../../../packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('isDelegatedObservation(getAgentContext())')
    expect(src).toContain('delegatedObservation: true')
  })
})

describe('gold qIt @199722114 / Xqe @210614011', () => {
  test('qIt writes ConsentSlugs when Wu and not auto; Xqe then admits', () => {
    const s = session()
    const ctx = s.context('tu-up')
    beginArtifactConsentCheck(ctx)
    expect(hasArtifactAssetUploadConsent(ctx, SLUG)).toBe(false)
    recordArtifactAssetUploadGrant({ [Wu]: true }, ctx, SLUG)
    expect(s.appState().artifactAssetUploadConsentSlugs).toEqual({
      [SLUG]: true,
    })
    expect(s.appState().artifactAssetUploadHumanConsentSlugs).toBeUndefined()
    expect(hasArtifactAssetUploadConsent(ctx, SLUG)).toBe(true)
  })

  test('qIt writes Human map when iKe; plan Xqe reads Human only', () => {
    const s = session('plan')
    const ctx = s.context('tu-plan')
    beginArtifactConsentCheck(ctx)
    recordArtifactAssetUploadGrant({ [Wu]: true, [qm]: true }, ctx, SLUG)
    expect(s.appState().artifactAssetUploadConsentSlugs).toEqual({
      [SLUG]: true,
    })
    expect(s.appState().artifactAssetUploadHumanConsentSlugs).toEqual({
      [SLUG]: true,
    })
    expect(hasArtifactAssetUploadConsent(ctx, SLUG)).toBe(true)

    const def = session()
    const defCtx = def.context('tu-def')
    beginArtifactConsentCheck(defCtx)
    recordArtifactAssetUploadGrant({ [Wu]: true }, defCtx, SLUG)
    def.appState().toolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      mode: 'plan',
    }
    expect(hasArtifactAssetUploadConsent(defCtx, SLUG)).toBe(false)
  })

  test('qIt + Xqe no-op in auto', () => {
    const s = session('auto')
    const ctx = s.context('tu-auto')
    beginArtifactConsentCheck(ctx)
    recordArtifactAssetUploadGrant({ [Wu]: true, [OP]: true }, ctx, SLUG)
    expect(s.appState().artifactAssetUploadConsentSlugs).toBeUndefined()
    expect(hasArtifactAssetUploadConsent(ctx, SLUG)).toBe(false)
  })
})
