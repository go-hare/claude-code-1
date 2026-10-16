/**
 * densable 2.1.289 Artifact comments — gold Xo/gb (delegatedObservation)
 * on Fee notice ask and lTm/HEo census.
 *
 * Gold check @210871292: `h=r!==null&&Gf(r.slug)&&!Xo(s.agentContext)`
 * (no agentId). Gold census @210885112:
 * `s.agentId===void 0&&!Xo(s.agentContext)` then HEo.
 * Tip Xo is `isDelegatedObservation(getAgentContext())`.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'
import * as realGrowthbook from '../../../../../../src/services/analytics/growthbook.js'
import { getEmptyToolPermissionContext } from '../../../../../../src/Tool.js'
import {
  isDelegatedObservation,
  runWithAgentContext,
} from '../../../../../../src/utils/agentContext.js'

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

const { resetArtifactAutoReactStoreForTests } = await import(
  '../../../../../../src/services/artifactAutoReact/index.js'
)
const { zIe } = await import(
  '../../../../../../src/services/artifactAutoReact/ownership.js'
)
const { checkArtifactActionPermissions } = await import('../permissions.js')
const { resetConsentStateForTests } = await import(
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

afterEach(() => {
  delete process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS
  resetConsentStateForTests()
  resetArtifactAutoReactStoreForTests()
})

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const ASK =
  `Claude wants to read the comment threads on ${URL} — prompted by the ` +
  'new-comments notification; comment text is written by artifact viewers'

const delegated = {
  agentType: 'subagent' as const,
  agentId: 'obs-1',
  delegatedObservation: true,
}

function ctx(agentId?: string) {
  return {
    toolUseId: 'tu-comments-xo',
    abortController: new AbortController(),
    messages: [],
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
    ...(agentId !== undefined ? { agentId } : {}),
  } as never
}

async function checkComments(agentId?: string) {
  return (await checkArtifactActionPermissions(
    { action: 'comments', url: URL },
    ctx(agentId),
  )) as { behavior: string; message?: string }
}

describe('gold Xo comments @210871292 / @210885112', () => {
  test('source lock: Fee ask is !Xo, not agentId', () => {
    const perm = readFileSync(
      join(import.meta.dir, '../permissions.ts'),
      'utf8',
    )
    expect(perm).toContain('Fee(parsed.slug)')
    expect(perm).toContain('!isDelegatedObservation(getAgentContext())')
    expect(perm).not.toContain('local has no delegatedObservation')
    const comments = perm.slice(perm.indexOf("action === 'comments'"))
    const next = comments.indexOf("action === 'watch'")
    const block = next === -1 ? comments : comments.slice(0, next)
    expect(block).not.toContain('context.agentId')
  })

  test('source lock: lTm/HEo is unset agentId AND !Xo', () => {
    const src = readFileSync(
      join(import.meta.dir, '../ArtifactTool.ts'),
      'utf8',
    )
    expect(src).toContain('markCommentsReadForCensus')
    expect(src).toContain('context?.agentId === undefined &&')
    expect(src).toContain('!isDelegatedObservation(getAgentContext())')
    expect(src).toContain('scoped_dispatch: true')
    expect(src).not.toContain('Local has no delegatedObservation')
  })

  test('isDelegatedObservation matches gold Xo', () => {
    expect(isDelegatedObservation(undefined)).toBe(false)
    expect(
      isDelegatedObservation({ agentType: 'subagent', agentId: 'a' }),
    ).toBe(false)
    expect(isDelegatedObservation(delegated)).toBe(true)
  })

  test('Fee notice asks when not Xo — including a regular subagent', async () => {
    zIe(SLUG)
    const main = await checkComments()
    expect(main.behavior).toBe('ask')
    expect(main.message).toBe(ASK)

    const sub = await runWithAgentContext(
      { agentType: 'subagent', agentId: 'sub-1' },
      () => checkComments('sub-1'),
    )
    expect(sub.behavior).toBe('ask')
    expect(sub.message).toBe(ASK)
  })

  test('Fee notice allows under delegatedObservation even if agentId unset', async () => {
    zIe(SLUG)
    const r = await runWithAgentContext(delegated, () => checkComments())
    expect(r.behavior).toBe('allow')
  })

  test('no Fee notice allows without Xo', async () => {
    const r = await checkComments()
    expect(r.behavior).toBe('allow')
  })
})
