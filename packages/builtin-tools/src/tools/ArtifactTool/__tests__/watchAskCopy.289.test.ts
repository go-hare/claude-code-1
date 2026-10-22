/**
 * densable 2.1.289 Artifact watch ask — JBn/YBn after em dash, sxr/XBn
 * decisionReason. Gold third deny: durable && JR() && declined && !standing_job.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'
import * as realGrowthbook from '../../../../../../src/services/analytics/growthbook.js'
import { getEmptyToolPermissionContext } from '../../../../../../src/Tool.js'

const growthbookSnap = snapshotModuleExports(realGrowthbook)
const flags: Record<string, unknown> = {}

function growthbookMock() {
  return {
    ...growthbookSnap,
    getFeatureValue_CACHED_MAY_BE_STALE: (name: string, fallback: unknown) =>
      name in flags ? flags[name] : fallback,
  }
}
mock.module('src/services/analytics/growthbook.ts', growthbookMock)
mock.module('src/services/analytics/growthbook.js', growthbookMock)

const { JBn, YBn, checkArtifactActionPermissions, sxr, XBn } = await import(
  '../permissions.js'
)
const { resetArtifactAutoReactStoreForTests, un } = await import(
  '../../../../../../src/services/artifactAutoReact/index.js'
)
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
  resetArtifactAutoReactStoreForTests()
  resetConsentStateForTests()
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_ARTIFACT_COMMENTS
  for (const key of Object.keys(flags)) delete flags[key]
})

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const HUMAN = [
  {
    type: 'user',
    origin: { kind: 'human' },
    message: { content: 'watch it' },
  },
]

function fakeContext(toolUseId = 'tu-watch') {
  return {
    toolUseId,
    abortController: new AbortController(),
    messages: HUMAN,
    options: { isNonInteractiveSession: false },
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode: 'default',
      },
    }),
    setAppState: () => {},
  } as never
}

describe('densable 2.1.289 Artifact watch JBn/YBn/sxr', () => {
  test('JBn live vs cloud after the em dash (not a viewer URL)', () => {
    expect(JBn(false, false, true)).toBe(
      'approving resumes keeping track of new versions of it published elsewhere for the rest of this session; a new version starts no turn and sends no notification',
    )
    expect(JBn(true, false, false)).toContain(
      'in a cloud session, the wake when a comment on it is sent to Claude',
    )
    expect(JBn(false, false, false)).toContain(
      'republish notifications carry no content',
    )
    expect(JBn(false, true, true)).toContain(
      'comments sent to Claude reach this session again',
    )
  })

  test('YBn first-watch copy names live vs cloud, not the artifact URL', () => {
    expect(YBn(false, false, true)).toContain(
      'over a live background connection',
    )
    expect(YBn(false, false, true)).not.toContain('https://')
    expect(YBn(true, false, false)).toContain(
      'also when a comment on any watched artifact is sent to Claude',
    )
  })

  test('sxr stopped decisionReason keeps classifier copy', () => {
    expect(
      sxr({
        live: true,
        replies: false,
        commentWake: false,
        coversSession: false,
      }),
    ).toBe(
      'Watching this artifact was stopped earlier this session. Claude will again keep track of new versions of it published elsewhere.',
    )
    expect(
      XBn({
        live: true,
        replies: false,
        commentWake: false,
        coversSession: false,
      }),
    ).toBe(
      'Claude will keep track of new versions of this artifact published elsewhere.',
    )
  })

  test('stopped watch ask uses JBn after the em dash', async () => {
    un().durable.stopLatches.confirmStop(SLUG)
    const r = (await checkArtifactActionPermissions(
      { action: 'watch', url: URL },
      fakeContext(),
    )) as {
      behavior: string
      message?: string
      decisionReason?: {
        type: string
        reason: string
        classifierApprovable?: boolean
      }
    }
    expect(r.behavior).toBe('ask')
    expect(r.message).toContain(
      'whose watch was deliberately stopped earlier this session — ',
    )
    expect(r.message).toContain(JBn(false, false, false))
    expect(r.message).not.toContain(URL)
    expect(r.decisionReason?.type).toBe('safetyCheck')
    expect(r.decisionReason?.reason).toBe(
      sxr({
        live: false,
        replies: false,
        commentWake: false,
        coversSession: true,
      }),
    )
    expect(r.decisionReason?.classifierApprovable).toBe(true)
  })

  test('first watch ask uses YBn after the em dash', async () => {
    const r = (await checkArtifactActionPermissions(
      { action: 'watch', url: URL },
      fakeContext(),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('ask')
    expect(r.message).toBe(
      `Claude wants to watch an artifact — ${YBn(false, false, false)}`,
    )
    expect(r.message).not.toContain(URL)
  })

  test('remote + replies declined does not deny without JR() commentsOn', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    un().live.repliesConsent.declined.set(SLUG, true)
    const r = (await checkArtifactActionPermissions(
      { action: 'watch', url: URL },
      fakeContext(),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('ask')
    expect(r.message).not.toContain("wasn't approved")
    expect(r.message).toContain(YBn(false, false, false))
  })

  test('durable + commentsOn + declined + no standing_job denies', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS = '1'
    un().live.repliesConsent.declined.set(SLUG, true)
    const r = (await checkArtifactActionPermissions(
      { action: 'watch', url: URL },
      fakeContext(),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain("wasn't approved")
  })

  test('live lantern first-watch uses YBn live copy', async () => {
    flags.tengu_slate_lantern = true
    const r = (await checkArtifactActionPermissions(
      { action: 'watch', url: URL },
      fakeContext(),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('ask')
    expect(r.message).toBe(
      `Claude wants to watch an artifact — ${YBn(false, false, true)}`,
    )
  })

  test('permissions source does not use viewer URL after the dash', () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(src).toContain('function JBn(')
    expect(src).toContain('function YBn(')
    expect(src).toContain('function sxr(')
    expect(src).toContain('durable && JR() && declined')
    expect(src).not.toContain(
      'whose watch was deliberately stopped earlier this session — ${label}',
    )
  })
})
