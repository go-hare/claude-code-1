/**
 * densable remaining edges: Z_r content-host, Ttn/nzt, X_r summon, visible_handoff, ykl storageV5.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  claimLedgerOwnership,
  claimSummonSeed,
  contentHostCommentsUrl,
  flushLedgerNow,
  outstandingSummons,
  parseFrameCommentsPayload,
  readArtifactComments,
  resetArtifactAutoReactStoreForTests,
  resetNztRunnerForTests,
  runAutoReplyPipeline,
  seedPendingLedgerForTests,
  setArtifactScanDeps,
  resetArtifactScanDepsForTests,
  setNztRunner,
  Ttn,
  un,
  type ArtifactThread,
} from '../../services/artifactAutoReact/index.js'
import { getSessionId } from '../../bootstrap/state.js'

const authMock = {
  getClaudeAIOAuthTokens: mock(() => ({
    accessToken: 'test-oauth',
  })),
}
mock.module('../../utils/auth.js', () => authMock)
mock.module('src/utils/auth.js', () => authMock)

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  resetArtifactScanDepsForTests()
  resetNztRunnerForTests()
  delete process.env.CLAUDE_CODE_ENTRYPOINT
  delete process.env.CLAUDE_CODE_ARTIFACT_AUTOREACT_AUTOREPLY
})

describe('Z_r content-host URL', () => {
  test('contentHostCommentsUrl matches densable host shape', () => {
    expect(contentHostCommentsUrl('abc', 'ver1', 'tok')).toBe(
      'https://abc.frame.claudeusercontent.com/_f/ver1/index.html.json?__frame_t=tok',
    )
    expect(contentHostCommentsUrl('abc', 'ver1', 'tok', 'staging')).toBe(
      'https://abc.frame.staging.claudeusercontent.com/_f/ver1/index.html.json?__frame_t=tok',
    )
  })

  test('readArtifactComments prefers content-host then falls back on egress deny', async () => {
    const prevFetch = globalThis.fetch
    let hits: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input)
      hits.push(u)
      if (u.includes('/api/frame/') && !u.includes('/comments/')) {
        return new Response(
          JSON.stringify({
            ver: 'v1',
            assetToken: 'atok',
            perm: { role: 'owner' },
          }),
          { status: 200 },
        )
      }
      if (u.includes('claudeusercontent.com')) {
        return new Response('blocked', { status: 403 })
      }
      if (u.includes('/api/frame/comments/')) {
        return new Response(
          JSON.stringify({
            threads: [
              {
                id: 'th1',
                comments: [
                  {
                    id: 'c1',
                    text: 'hi',
                    author: { account: 'u', role: 'human' },
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response('miss', { status: 404 })
    }) as typeof fetch
    try {
      const r = await readArtifactComments(
        'slug1',
        new AbortController().signal,
      )
      expect(r.err).toBeNull()
      if (r.err === null) expect(r.threads[0]?.id).toBe('th1')
      expect(hits.some(h => h.includes('claudeusercontent.com'))).toBe(true)
      expect(hits.some(h => h.includes('/api/frame/comments/'))).toBe(true)
      expect(un().contentHostEgressDenied.has('prod')).toBe(true)
    } finally {
      globalThis.fetch = prevFetch
    }
  })
})

describe('X_r summon', () => {
  test('outstandingSummons picks human toClaudeAt after last agent', () => {
    const thread: ArtifactThread = {
      id: 't1',
      claudeActivated: true,
      comments: [
        {
          id: 'a1',
          account: 'claude',
          role: 'assistant',
          text: 'prev',
          createdAt: '2026-01-01T00:00:00Z',
          postedByArtifact: true,
        },
        {
          id: 'h1',
          account: 'bob',
          role: 'human',
          text: 'please',
          createdAt: '2026-01-01T00:01:00Z',
          toClaudeAt: '2026-01-01T00:01:00Z',
        },
      ],
    }
    const s = outstandingSummons(thread)
    expect(s.map(c => c.id)).toEqual(['h1'])
  })
})

describe('Ttn / nzt reply turn', () => {
  test('Ttn drains nzt tool_result replied:true', async () => {
    setNztRunner(async function* (toolUse) {
      yield {
        message: {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: 'ok',
              },
            ],
          },
          toolUseResult: { replied: true, comment_id: 'cid-9' },
        },
      }
    })
    const r = await Ttn({
      url: 'https://claude.ai/artifacts/slug1',
      slug: 'slug1',
      threadId: 'th',
      text: 'ack',
      signal: new AbortController().signal,
    })
    expect(r.kind).toBe('posted')
    if (r.kind === 'posted') expect(r.commentId).toBe('cid-9')
  })

  test('runAutoReplyPipeline posts via Ttn when compose returns text', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_AUTOREACT_AUTOREPLY = '1'
    setArtifactScanDeps({
      getPermissionMode: () => 'bypassPermissions',
      composeAutoReply: async () => 'composed reply',
    })
    setNztRunner(async function* (toolUse) {
      yield {
        message: {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: 'ok',
              },
            ],
          },
          toolUseResult: { replied: true, comment_id: 'auto-1' },
        },
      }
    })
    const artifactState = {
      scanning: false,
      baselined: true,
      everBaselined: true,
      everHadThreads: true,
      lastReadDigest: null,
      stampHighWater: null,
      lastScanAt: null,
      threads: new Map(),
      turnTimestamps: [] as number[],
    }
    const threadState = {
      seen: new Set<string>(),
      ownReplyIds: new Set<string>(),
      sentToClaudeAt: new Map<string, string | null>(),
      lastAutoReplyAt: null,
      consecutiveAuto: 0,
      breakerOpen: false,
      consecutivePipelineDenials: 0,
      activatedAt: null,
      activatedAtObserved: true,
    }
    await runAutoReplyPipeline({
      slug: 's',
      url: 'https://claude.ai/artifacts/s',
      artifactName: 's',
      thread: {
        id: 'th',
        comments: [],
        claudeActivated: true,
      },
      newComments: [
        {
          id: 'c',
          account: 'u',
          role: 'human',
          text: 'hi',
        },
      ],
      artifactState,
      threadState,
      abort: new AbortController(),
    })
    expect(threadState.ownReplyIds.has('auto-1')).toBe(true)
  })
})

describe('visible_handoff claim key', () => {
  test('claimSummonSeed plants desktop claim', () => {
    claimSummonSeed('slug', 'th', '2026-01-01T00:00:00Z')
    expect(un().summonSeeds.claims.size).toBe(1)
  })
})

describe('ykl storageV5 append', () => {
  test('flush uses ledgerStorageV5.appendEntry when claimed', async () => {
    const appended: unknown[] = []
    claimLedgerOwnership({
      appendEntry: async (entry: unknown) => {
        appended.push(entry)
      },
    })
    const sid = getSessionId()
    seedPendingLedgerForTests({
      sid,
      accountUuid: null,
      slugs: new Map([
        [
          'art-a',
          {
            savedAt: Date.now(),
            stampHighWater: null,
            everBaselined: false,
            everHadThreads: false,
            turnTimestamps: [],
            interrupted: true,
          },
        ],
      ]),
    })
    flushLedgerNow({ force: true, urgent: true })
    await un().autoReact.ledgerLastAppend
    expect(appended.length).toBe(1)
    expect((appended[0] as { type: string }).type).toBe(
      'artifact-autoreact-ledger',
    )
  })
})

describe('JIw parse editCapable', () => {
  test('parseFrameCommentsPayload keeps edit_capable', () => {
    const p = parseFrameCommentsPayload({
      threads: [
        {
          id: 't',
          edit_capable: true,
          claude_activated_at: '2026-01-01T00:00:00Z',
          comments: [],
        },
      ],
    })
    expect(p?.threads[0]?.editCapable).toBe(true)
  })
})
