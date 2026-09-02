/**
 * densable edge: Qem mint / Cji WS / watch_url MCP (2.1.239).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  createFrameLiveTransform,
  extractLabeledField,
  extractSubscriptionToken,
  FRAME_LIVE_PROTOCOL,
  FRAME_VER_RE,
  frameControlPlaneHeaders,
  frameLiveWsUrl,
  installDefaultArtifactLiveArmDeps,
  isValidWebhookFireUrl,
  mintSubscriptionToken,
  parseFrameLiveMessage,
  parseWatchUrlMint,
  releaseOrphanTriggers,
  resetArtifactAutoReactStoreForTests,
  resetArtifactLiveArmDepsForTests,
  resetWatchUrlDepsForTests,
  setWatchUrlDeps,
  TRIGGER_ID_RE,
  un,
  WATCH_URL_TOOL,
  WEBHOOK_FIRE_SUFFIX,
  WEBHOOK_TRIGGERS_PATH_PREFIX,
} from '../../services/artifactAutoReact/index.js'

const authMock = {
  getClaudeAIOAuthTokens: mock(() => ({
    accessToken: 'test-oauth',
  })),
}
mock.module('../../utils/auth.js', () => authMock)
mock.module('src/utils/auth.js', () => authMock)

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  resetArtifactLiveArmDepsForTests()
  resetWatchUrlDepsForTests()
  delete process.env.CLAUDE_CODE_ARTIFACT_SUBSCRIPTION_TOKEN
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ar =
    require('../../services/artifactAutoReact/bootstrap.js') as typeof import('../../services/artifactAutoReact/bootstrap.js')
  ar.resetArtifactAutoReactProductForTests()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const scan =
    require('../../services/artifactAutoReact/scan.js') as typeof import('../../services/artifactAutoReact/scan.js')
  scan.resetArtifactScanDepsForTests()
})

describe('mint Qem / Jem', () => {
  test('FRAME_VER_RE matches densable yJr', () => {
    expect(FRAME_VER_RE.test('abc_01')).toBe(true)
    expect(FRAME_VER_RE.test('bad ver')).toBe(false)
  })

  test('frameControlPlaneHeaders carry X-Frame-*', () => {
    const h = frameControlPlaneHeaders()
    expect(h['X-Frame-CP']).toBe('go')
    expect(h['X-Frame-Surface']).toBe('code')
    expect(h['X-Frame-Platform']).toBe('cli')
  })

  test('extractSubscriptionToken gated by env / GB', () => {
    process.env.CLAUDE_CODE_ARTIFACT_SUBSCRIPTION_TOKEN = '0'
    expect(
      extractSubscriptionToken({ subscriptionToken: 'tok' }),
    ).toBeUndefined()
    process.env.CLAUDE_CODE_ARTIFACT_SUBSCRIPTION_TOKEN = '1'
    expect(extractSubscriptionToken({ subscriptionToken: 'tok' })).toBe('tok')
  })

  test('mintSubscriptionToken maps boot JSON to token', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_SUBSCRIPTION_TOKEN = '1'
    const prevFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ver: 'v1',
          assetToken: 'asset',
          subscriptionToken: 'sub-tok',
          watchTokenRenewEnabled: true,
          subscriptionTokenExp: 99,
          perm: { role: 'writer' },
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      const out = await mintSubscriptionToken(
        'slug-x',
        new AbortController().signal,
      )
      expect(out).toEqual({
        err: null,
        token: 'sub-tok',
        ver: 'v1',
        editor: true,
        tokenExp: 99,
        renewable: true,
      })
    } finally {
      globalThis.fetch = prevFetch
    }
  })

  test('mintSubscriptionToken 404 → err status', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_SUBSCRIPTION_TOKEN = '1'
    const prevFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('nope', { status: 404 })) as unknown as typeof fetch
    try {
      const out = await mintSubscriptionToken(
        'missing',
        new AbortController().signal,
      )
      expect(out).toEqual({ err: true, status: 404 })
    } finally {
      globalThis.fetch = prevFetch
    }
  })
})

describe('cji frame-live', () => {
  test('frameLiveWsUrl uses edge-api + wss', () => {
    const u = frameLiveWsUrl('my-slug')
    expect(u).toContain('/edge-api/frame-live/my-slug/ws')
    expect(u.startsWith('wss://')).toBe(true)
  })

  test('FRAME_LIVE_PROTOCOL densable vDw', () => {
    expect(FRAME_LIVE_PROTOCOL).toBe('frame-live.v1')
  })

  test('parseFrameLiveMessage + transform stamps supervisor', () => {
    expect(parseFrameLiveMessage('not-json')).toBeNull()
    const msg = parseFrameLiveMessage('{"kind":"comment","id":"1"}')
    expect(msg?.kind).toBe('comment')
    un().live.supervisors.set('s1', {
      slug: 's1',
      abort: new AbortController(),
      stopped: false,
      lastActivityAt: 0,
      watchedSince: 0,
      consecutiveFailures: 0,
      explicit: false,
      armedVia: 'publish',
    })
    const xf = createFrameLiveTransform({ slug: 's1' })
    expect(xf('{"kind":"comment"}')).toBeNull()
    expect(un().live.supervisors.get('s1')!.lastActivityAt).toBeGreaterThan(0)
    expect(xf('{"kind":"x","ver":"v2"}')).toBeNull()
    expect(un().live.supervisors.get('s1')!.carriedVer).toBe('v2')
  })
})

describe('watch_url MCP helpers', () => {
  test('parseWatchUrlMint labeled fields', () => {
    const text = [
      'url: https://example.com/integrations/v1/code/webhook-triggers/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/fire',
      'trigger_id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'sealed_secret: sekkrit',
    ].join('\n')
    const m = parseWatchUrlMint(text)
    expect(m?.triggerId).toMatch(TRIGGER_ID_RE)
    expect(m?.sealedSecret).toBe('sekkrit')
    expect(extractLabeledField(text, 'url')).toContain(
      WEBHOOK_TRIGGERS_PATH_PREFIX,
    )
  })

  test('isValidWebhookFireUrl densable XMw', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const ok = `https://host.example${WEBHOOK_TRIGGERS_PATH_PREFIX}${id}${WEBHOOK_FIRE_SUFFIX}`
    expect(isValidWebhookFireUrl(ok, id)).toBe(true)
    expect(isValidWebhookFireUrl(ok + '?x=1', id)).toBe(false)
  })

  test('releaseOrphanTriggers via injected callTool', async () => {
    un().durable.orphanTriggers.add('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    const calls: string[] = []
    setWatchUrlDeps({
      callTool: async (name, args) => {
        calls.push(name)
        expect(args.trigger_id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
        return { isError: false, text: 'ok' }
      },
    })
    const failed = await releaseOrphanTriggers()
    expect(failed).toBe(0)
    expect(calls).toEqual(['unwatch_url'])
    expect(un().durable.orphanTriggers.size).toBe(0)
  })

  test('WATCH_URL_TOOL densable dxm', () => {
    expect(WATCH_URL_TOOL).toBe('watch_url')
  })
})

describe('yWt / coalesce wake', () => {
  test('yWt seed enqueues arm notice; schedule is wired', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    const { registerAutoReactAvailability, mI, yWt, flushAllCoalesceForTests } =
      await import('../../services/artifactAutoReact/index.js')
    registerAutoReactAvailability(() => true)
    mI()
    const { peek, dequeueAllMatching } = await import(
      '../../utils/messageQueueManager.js'
    )
    dequeueAllMatching(cmd => cmd.mode === 'task-notification')
    yWt({
      slug: 'wake1',
      url: 'https://claude.ai/artifacts/wake1',
      title: 'Wake',
      seed: true,
    })
    flushAllCoalesceForTests()
    const last = peek(cmd => cmd.mode === 'task-notification')
    expect(last?.mode).toBe('task-notification')
    expect(String(last?.value)).toContain('artifact-auto-react')
    expect((last?.origin as { source?: string } | undefined)?.source).toBe(
      'artifact-auto-react',
    )
    dequeueAllMatching(cmd => cmd.mode === 'task-notification')
  })

  test('coalesce fire uses latest lastWakeArgs (non-kick overwrite)', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    const { registerAutoReactAvailability, mI, scheduleCommentScan, un } =
      await import('../../services/artifactAutoReact/index.js')
    registerAutoReactAvailability(() => true)
    mI()
    un().autoReact.coalesceMsOverride = 20
    const seen: string[] = []
    const prevFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ threads: [] }), {
        status: 200,
      })) as unknown as typeof fetch
    try {
      scheduleCommentScan({
        slug: 'coal-1',
        url: 'https://claude.ai/code/artifact/coal-1',
        seed: true,
        getTitle: () => {
          seen.push('old')
          return 'old'
        },
      })
      scheduleCommentScan({
        slug: 'coal-1',
        url: 'https://claude.ai/code/artifact/coal-1',
        seed: true,
        getTitle: () => {
          seen.push('new')
          return 'new'
        },
      })
      await new Promise<void>(resolve => {
        setTimeout(resolve, 80)
      })
      expect(seen).toEqual(['new'])
    } finally {
      globalThis.fetch = prevFetch
    }
  })
})

describe('UPw / zPw comment scan', () => {
  test('parseFrameCommentsPayload + digest', async () => {
    const { parseFrameCommentsPayload, digestCommentThreads } = await import(
      '../../services/artifactAutoReact/index.js'
    )
    const parsed = parseFrameCommentsPayload({
      threads: [
        {
          id: 'th1',
          comments: [
            {
              id: 'c1',
              author: { account: 'alice', role: 'human' },
              text: 'hello',
              to_claude_at: '2026-01-01T00:00:00Z',
            },
          ],
        },
      ],
    })
    expect(parsed?.threads).toHaveLength(1)
    expect(parsed?.threads[0]?.comments[0]?.text).toBe('hello')
    const d = digestCommentThreads(parsed!.threads, new Map())
    expect(typeof d).toBe('string')
    expect(d!.length).toBe(64)
  })

  test('UPw seed baselines; second scan surfaces new human comment', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    process.env.CLAUDE_CODE_ARTIFACT_SUBSCRIPTION_TOKEN = '1'
    const {
      registerAutoReactAvailability,
      mI,
      runCommentScanNow,
      getArtifactScanState,
      flushAllCoalesceForTests,
      resetArtifactScanDepsForTests,
    } = await import('../../services/artifactAutoReact/index.js')
    registerAutoReactAvailability(() => true)
    mI()
    resetArtifactScanDepsForTests()
    const { peek, dequeueAllMatching } = await import(
      '../../utils/messageQueueManager.js'
    )
    dequeueAllMatching(cmd => cmd.mode === 'task-notification')

    let comments = [
      {
        id: 'c1',
        author: { account: 'alice', role: 'human' },
        text: 'first',
      },
    ]
    const prevFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ threads: [{ id: 'th1', comments }] }), {
        status: 200,
      })) as unknown as typeof fetch

    try {
      await runCommentScanNow({
        slug: 'scan1',
        url: 'https://claude.ai/artifacts/scan1',
        title: 'S',
        seed: true,
      })
      expect(getArtifactScanState('scan1').baselined).toBe(true)
      flushAllCoalesceForTests()
      dequeueAllMatching(cmd => cmd.mode === 'task-notification')

      comments = [
        ...comments,
        {
          id: 'c2',
          author: { account: 'bob', role: 'human' },
          text: 'second hello',
        },
      ]
      await runCommentScanNow({
        slug: 'scan1',
        url: 'https://claude.ai/artifacts/scan1',
        title: 'S',
      })
      flushAllCoalesceForTests()
      const last = peek(cmd => cmd.mode === 'task-notification')
      expect(String(last?.value)).toContain('second hello')
      expect(String(last?.value)).toContain('thread th1')
    } finally {
      globalThis.fetch = prevFetch
      dequeueAllMatching(cmd => cmd.mode === 'task-notification')
      delete process.env.CLAUDE_CODE_ARTIFACT_SUBSCRIPTION_TOKEN
    }
  })

  test('plan mode / hourly cap / notify_only / allow+compose post', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    const {
      registerAutoReactAvailability,
      mI,
      runAutoReplyPipeline,
      getArtifactScanState,
      setArtifactScanDeps,
      resetArtifactScanDepsForTests,
      flushAllCoalesceForTests,
      underHourlyAutoCap,
      HOURLY_AUTO_TURN_CAP,
      formatGateNotice,
      verdictFromPermissionMode,
    } = await import('../../services/artifactAutoReact/index.js')
    registerAutoReactAvailability(() => true)
    mI()
    resetArtifactScanDepsForTests()
    const { peek, dequeueAllMatching } = await import(
      '../../utils/messageQueueManager.js'
    )
    dequeueAllMatching(cmd => cmd.mode === 'task-notification')

    expect(verdictFromPermissionMode('default')).toBe('ask')
    expect(verdictFromPermissionMode('auto')).toBe('allow')
    expect(verdictFromPermissionMode('dontAsk')).toBe('deny')
    expect(formatGateNotice('comment', 'plan', 'u', 'N').detail).toContain(
      'plan mode',
    )
    expect(underHourlyAutoCap([], Date.now()).ok).toBe(true)
    expect(
      underHourlyAutoCap(
        Array.from({ length: HOURLY_AUTO_TURN_CAP }, () => Date.now()),
        Date.now(),
      ).ok,
    ).toBe(false)

    const state = getArtifactScanState('gate1')
    const threadState = {
      seen: new Set<string>(['c1']),
      ownReplyIds: new Set<string>(),
      sentToClaudeAt: new Map<string, string | null>(),
      lastAutoReplyAt: null as number | null,
      consecutiveAuto: 0,
      breakerOpen: false,
      consecutivePipelineDenials: 0,
      activatedAt: null as string | null,
      activatedAtObserved: true,
    }
    state.threads.set('th1', threadState)
    const thread = {
      id: 'th1',
      comments: [
        {
          id: 'c1',
          account: 'bob',
          role: 'human',
          text: 'hi',
        },
      ],
    }
    const humans = thread.comments

    // plan mode
    setArtifactScanDeps({ getPermissionMode: () => 'plan' })
    await runAutoReplyPipeline({
      slug: 'gate1',
      url: 'https://claude.ai/artifacts/gate1',
      artifactName: 'G',
      thread,
      newComments: humans,
      artifactState: state,
      threadState,
      abort: new AbortController(),
    })
    flushAllCoalesceForTests()
    expect(String(peek()?.value)).toContain('plan mode')
    dequeueAllMatching(cmd => cmd.mode === 'task-notification')
    expect(state.planModeNoticed).toBe(true)

    // notify_only (default ask)
    resetArtifactScanDepsForTests()
    setArtifactScanDeps({ getPermissionMode: () => 'default' })
    await runAutoReplyPipeline({
      slug: 'gate1',
      url: 'https://claude.ai/artifacts/gate1',
      artifactName: 'G',
      thread,
      newComments: humans,
      artifactState: state,
      threadState,
      abort: new AbortController(),
    })
    flushAllCoalesceForTests()
    expect(String(peek()?.value)).toContain('notify-only')
    dequeueAllMatching(cmd => cmd.mode === 'task-notification')

    // allow + compose + post
    const posts: string[] = []
    setArtifactScanDeps({
      getPermissionMode: () => 'auto',
      checkReplyPermission: async () => 'allow',
      composeAutoReply: async ({ phase }) =>
        phase === 'substantive' ? 'Substantive reply body' : null,
      postReply: async ({ text }) => {
        posts.push(text)
        return { kind: 'ok', commentId: 'posted-1' }
      },
    })
    await runAutoReplyPipeline({
      slug: 'gate1',
      url: 'https://claude.ai/artifacts/gate1',
      artifactName: 'G',
      thread,
      newComments: humans,
      artifactState: state,
      threadState,
      abort: new AbortController(),
    })
    expect(posts).toEqual(['Substantive reply body'])
    expect(threadState.ownReplyIds.has('posted-1')).toBe(true)
    resetArtifactScanDepsForTests()
    dequeueAllMatching(cmd => cmd.mode === 'task-notification')

    // composeAutoReply is the writer (product always installs it) — not a
    // permission probe. default mode stays notify-only (gold FPw).
    const leaked: string[] = []
    setArtifactScanDeps({
      getPermissionMode: () => 'default',
      composeAutoReply: async () => 'must not post in default',
      postReply: async ({ text }) => {
        leaked.push(text)
        return { kind: 'ok', commentId: 'leak' }
      },
    })
    await runAutoReplyPipeline({
      slug: 'gate1',
      url: 'https://claude.ai/artifacts/gate1',
      artifactName: 'G',
      thread,
      newComments: humans,
      artifactState: state,
      threadState,
      abort: new AbortController(),
    })
    expect(leaked).toEqual([])
    resetArtifactScanDepsForTests()
    dequeueAllMatching(cmd => cmd.mode === 'task-notification')
  })

  test('hourly cap stamps only after a successful post', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    const {
      registerAutoReactAvailability,
      mI,
      runAutoReplyPipeline,
      getArtifactScanState,
      setArtifactScanDeps,
      resetArtifactScanDepsForTests,
    } = await import('../../services/artifactAutoReact/index.js')
    registerAutoReactAvailability(() => true)
    mI()
    resetArtifactScanDepsForTests()

    const state = getArtifactScanState('cap-stamp')
    const threadState = {
      seen: new Set<string>(['c1']),
      ownReplyIds: new Set<string>(),
      sentToClaudeAt: new Map<string, string | null>(),
      lastAutoReplyAt: null as number | null,
      consecutiveAuto: 0,
      breakerOpen: false,
      consecutivePipelineDenials: 0,
      activatedAt: null as string | null,
      activatedAtObserved: true,
    }
    state.threads.set('th1', threadState)
    const thread = {
      id: 'th1',
      comments: [{ id: 'c1', account: 'bob', role: 'human', text: 'hi' }],
    }

    setArtifactScanDeps({
      getPermissionMode: () => 'auto',
      checkReplyPermission: async () => 'allow',
      composeAutoReply: async () => {
        throw new Error('compose failed')
      },
      postReply: async () => ({ kind: 'ok', commentId: 'should-not' }),
    })
    await runAutoReplyPipeline({
      slug: 'cap-stamp',
      url: 'https://claude.ai/code/artifact/cap-stamp',
      artifactName: 'C',
      thread,
      newComments: thread.comments,
      artifactState: state,
      threadState,
      abort: new AbortController(),
    })
    expect(state.turnTimestamps).toEqual([])

    setArtifactScanDeps({
      composeAutoReply: async ({ phase }) =>
        phase === 'substantive' ? 'body' : null,
      postReply: async () => ({ kind: 'error', message: 'post failed' }),
    })
    await runAutoReplyPipeline({
      slug: 'cap-stamp',
      url: 'https://claude.ai/code/artifact/cap-stamp',
      artifactName: 'C',
      thread,
      newComments: thread.comments,
      artifactState: state,
      threadState,
      abort: new AbortController(),
    })
    expect(state.turnTimestamps).toEqual([])

    setArtifactScanDeps({
      composeAutoReply: async ({ phase }) =>
        phase === 'substantive' ? 'body' : null,
      postReply: async () => ({ kind: 'ok', commentId: 'p1' }),
    })
    await runAutoReplyPipeline({
      slug: 'cap-stamp',
      url: 'https://claude.ai/code/artifact/cap-stamp',
      artifactName: 'C',
      thread,
      newComments: thread.comments,
      artifactState: state,
      threadState,
      abort: new AbortController(),
    })
    expect(state.turnTimestamps).toHaveLength(1)

    setArtifactScanDeps({
      fastAckEnabled: () => true,
      composeAutoReply: async ({ phase }) =>
        phase === 'fast_ack' ? 'ack' : 'full',
      postReply: async () => ({ kind: 'ok', commentId: 'p2' }),
    })
    await runAutoReplyPipeline({
      slug: 'cap-stamp',
      url: 'https://claude.ai/code/artifact/cap-stamp',
      artifactName: 'C',
      thread,
      newComments: thread.comments,
      artifactState: state,
      threadState,
      abort: new AbortController(),
    })
    expect(state.turnTimestamps).toHaveLength(2)
    resetArtifactScanDepsForTests()
  })
})

describe('installDefaultArtifactLiveArmDeps', () => {
  beforeEach(() => {
    resetArtifactLiveArmDepsForTests()
  })

  test('install + override localArm arms via Qem mint path', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_SUBSCRIPTION_TOKEN = '1'
    process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
    const prevFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ver: 'v9',
          assetToken: 'a',
          subscriptionToken: 'live-tok',
          perm: { role: 'owner' },
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      const { aGi, mI, registerAutoReactAvailability, Stn } = await import(
        '../../services/artifactAutoReact/index.js'
      )
      registerAutoReactAvailability(() => true)
      mI()
      installDefaultArtifactLiveArmDeps({
        withTransform: false,
        overrides: {
          openLiveSocket: undefined,
          localArmWithoutSocket: true,
        },
      })
      let tasks: Record<string, unknown> = {}
      const out = await aGi({
        slug: 'edge-slug',
        url: 'https://claude.ai/artifacts/edge-slug',
        publishContext: 'interactive',
        title: 'E',
        commentVerbsInSchema: true,
        tool: {},
        setAppState: updater => {
          const next = updater({ tasks } as never) as {
            tasks: Record<string, unknown>
          }
          tasks = next.tasks
        },
        context: { abortController: new AbortController() },
      })
      expect(out.outcome).toBe('armed')
      expect(Stn().has('edge-slug')).toBe(true)
    } finally {
      globalThis.fetch = prevFetch
      delete process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT
    }
  })
})
