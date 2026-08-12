/**
 * densable #8: unarchiveCodeSession + rit env shape + post-adopt cron disown.
 * Uses shared debugMock to avoid incomplete mock.module pollution.
 */
import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../tests/mocks/debug.js'

beforeAll(() => {
  ;(globalThis as { MACRO?: { VERSION: string } }).MACRO = {
    VERSION: '2.6.33-test',
  }
})

const axiosPost = mock(
  async (
    _url: string,
    _body?: unknown,
    _cfg?: { validateStatus?: (s: number) => boolean },
  ) => ({ status: 200, data: {} }),
)

mock.module('axios', () => ({
  default: {
    post: axiosPost,
    isAxiosError: (e: unknown) =>
      Boolean(e && typeof e === 'object' && 'isAxiosError' in e),
  },
}))

mock.module('src/utils/debug.ts', debugMock)

describe('unarchiveCodeSession (densable Nls)', () => {
  afterEach(() => {
    axiosPost.mockClear()
  })

  test('POST /v1/sessions/{compat}/unarchive with oauth + org headers', async () => {
    axiosPost.mockImplementationOnce(async (url: string) => {
      expect(url).toContain('/v1/sessions/')
      expect(url.endsWith('/unarchive')).toBe(true)
      return { status: 200, data: {} }
    })
    const { unarchiveCodeSession } = await import('../codeSessionApi.js')
    const status = await unarchiveCodeSession(
      'cse_abc',
      'https://api.example',
      'tok',
      'org-1',
      1500,
    )
    expect(status).toBe(200)
    expect(axiosPost).toHaveBeenCalledTimes(1)
    const [, , cfg] = axiosPost.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ]
    expect(cfg.headers.Authorization).toBe('Bearer tok')
    expect(cfg.headers['x-organization-uuid']).toBe('org-1')
    expect(cfg.headers['anthropic-beta']).toBe('ccr-byoc-2025-07-29')
  })

  test('empty sessionId → invalid', async () => {
    const { unarchiveCodeSession } = await import('../codeSessionApi.js')
    const status = await unarchiveCodeSession(
      '',
      'https://api.example',
      'tok',
      'org-1',
      1500,
    )
    expect(status).toBe('invalid')
    expect(axiosPost).not.toHaveBeenCalled()
  })
})

describe('buildBridgeReattachEnv (densable rit/EAt)', () => {
  test('rit sets SESSION/SEQ/GROUPING/OUTBOUND_ONLY', async () => {
    const { buildBridgeReattachEnv } = await import(
      '../../cli/bg/leftArrowAgents.js'
    )
    const env = buildBridgeReattachEnv('cse_xyz', {
      seq: 42,
      grouping: 'grp-1',
      outboundOnly: true,
    })
    expect(env).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'cse_xyz',
      CLAUDE_BRIDGE_REATTACH_SEQ: '42',
      CLAUDE_BRIDGE_REATTACH_GROUPING: 'grp-1',
      CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY: '1',
    })
  })

  test('outboundOnly false omits OUTBOUND_ONLY', async () => {
    const { buildBridgeReattachEnv } = await import(
      '../../cli/bg/leftArrowAgents.js'
    )
    const env = buildBridgeReattachEnv('cse_xyz', {
      outboundOnly: false,
    })
    expect(env?.CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY).toBeUndefined()
  })

  test('EAt owner + NO_BACKFILL fields (2.1.228 #5)', async () => {
    const { buildBridgeReattachEnv } = await import(
      '../../cli/bg/leftArrowAgents.js'
    )
    const env = buildBridgeReattachEnv('cse_xyz', {
      seq: 1,
      outboundOnly: true,
      ownerAccountUuid: 'acct-1',
      ownerOrganizationUuid: 'org-1',
      noHistoryBackfill: true,
    })
    expect(env).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'cse_xyz',
      CLAUDE_BRIDGE_REATTACH_SEQ: '1',
      CLAUDE_BRIDGE_REATTACH_OWNER_ACCT: 'acct-1',
      CLAUDE_BRIDGE_REATTACH_OWNER_ORG: 'org-1',
      CLAUDE_BRIDGE_REATTACH_NO_BACKFILL: '1',
      CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY: '1',
    })
  })
})

describe('resolveBridgeReattachOwnerMeta (densable q5o)', () => {
  test('owner match passes uuids and handle noHistoryBackfill', async () => {
    const { resolveBridgeReattachOwnerMeta } = await import(
      '../../cli/bg/leftArrowAgents.js'
    )
    expect(
      resolveBridgeReattachOwnerMeta(
        { bridgeSessionId: 'cse_a', noHistoryBackfill: true },
        {
          id: 'cse_a',
          ownerAccountUuid: 'acct',
          ownerOrganizationUuid: 'org',
          noHistoryBackfill: false,
        },
      ),
    ).toEqual({
      ownerAccountUuid: 'acct',
      ownerOrganizationUuid: 'org',
      noHistoryBackfill: true,
    })
  })

  test('owner mismatch forces noHistoryBackfill and drops owner uuids', async () => {
    const { resolveBridgeReattachOwnerMeta } = await import(
      '../../cli/bg/leftArrowAgents.js'
    )
    expect(
      resolveBridgeReattachOwnerMeta(
        { bridgeSessionId: 'cse_new' },
        {
          id: 'cse_old',
          ownerAccountUuid: 'acct',
          ownerOrganizationUuid: 'org',
        },
      ),
    ).toEqual({
      ownerAccountUuid: undefined,
      ownerOrganizationUuid: undefined,
      noHistoryBackfill: true,
    })
  })

  test('no owner pointer keeps handle flag only', async () => {
    const { resolveBridgeReattachOwnerMeta } = await import(
      '../../cli/bg/leftArrowAgents.js'
    )
    expect(
      resolveBridgeReattachOwnerMeta(
        { bridgeSessionId: 'cse_a', noHistoryBackfill: false },
        undefined,
      ),
    ).toEqual({
      ownerAccountUuid: undefined,
      ownerOrganizationUuid: undefined,
      noHistoryBackfill: false,
    })
  })
})

describe('resolveLeftArrowBridgeReattachCapture (unmount → openAgents)', () => {
  test('null handle + persisted id builds id/seq/grouping and owner match', async () => {
    const { resolveLeftArrowBridgeReattachCapture, buildBridgeReattachEnv } =
      await import('../../cli/bg/leftArrowAgents.js')
    const cap = resolveLeftArrowBridgeReattachCapture(null, {
      id: 'cse_persisted',
      seq: 12,
      groupingId: 'grp_p',
      ownerAccountUuid: 'acct-p',
      ownerOrganizationUuid: 'org-p',
      noHistoryBackfill: false,
    })
    expect(cap.bridgeSessionId).toBe('cse_persisted')
    expect(cap.seq).toBe(12)
    expect(cap.grouping).toBe('grp_p')
    expect(cap.outboundOnly).toBeUndefined()
    // Synthetic handleLike matches owner.id → OWNER_* pass, no forced NO_BACKFILL.
    expect(cap.ownerMeta).toEqual({
      ownerAccountUuid: 'acct-p',
      ownerOrganizationUuid: 'org-p',
      noHistoryBackfill: false,
    })
    expect(
      buildBridgeReattachEnv(cap.bridgeSessionId, {
        seq: cap.seq,
        grouping: cap.grouping,
        outboundOnly: cap.outboundOnly,
        ...cap.ownerMeta,
      }),
    ).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'cse_persisted',
      CLAUDE_BRIDGE_REATTACH_SEQ: '12',
      CLAUDE_BRIDGE_REATTACH_GROUPING: 'grp_p',
      CLAUDE_BRIDGE_REATTACH_OWNER_ACCT: 'acct-p',
      CLAUDE_BRIDGE_REATTACH_OWNER_ORG: 'org-p',
      CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY: '1',
    })
  })

  test('live handle preferred over persisted; seq from getLastSequenceNum', async () => {
    const { resolveLeftArrowBridgeReattachCapture } = await import(
      '../../cli/bg/leftArrowAgents.js'
    )
    const cap = resolveLeftArrowBridgeReattachCapture(
      {
        bridgeSessionId: 'cse_live',
        outboundOnly: false,
        sessionGroupingId: 'grp_live',
        getLastSequenceNum: () => 99,
        noHistoryBackfill: true,
      },
      {
        id: 'cse_old',
        seq: 1,
        groupingId: 'grp_old',
        ownerAccountUuid: 'acct',
        ownerOrganizationUuid: 'org',
      },
    )
    expect(cap.bridgeSessionId).toBe('cse_live')
    expect(cap.seq).toBe(99)
    expect(cap.grouping).toBe('grp_live')
    expect(cap.outboundOnly).toBe(false)
    // owner id ≠ live handle → force NO_BACKFILL, drop OWNER_*
    expect(cap.ownerMeta).toEqual({
      ownerAccountUuid: undefined,
      ownerOrganizationUuid: undefined,
      noHistoryBackfill: true,
    })
  })

  test('both absent → no invent bridge id', async () => {
    const { resolveLeftArrowBridgeReattachCapture, buildBridgeReattachEnv } =
      await import('../../cli/bg/leftArrowAgents.js')
    const cap = resolveLeftArrowBridgeReattachCapture(null, null)
    expect(cap.bridgeSessionId).toBeUndefined()
    expect(cap.seq).toBeUndefined()
    expect(cap.grouping).toBeUndefined()
    expect(buildBridgeReattachEnv(cap.bridgeSessionId)).toBeUndefined()
  })
})

describe('left-arrow bridge handle stash (pre-unmount)', () => {
  afterEach(async () => {
    const { setReplBridgeHandle, resetLeftArrowBridgeHandleForTests } =
      await import('../replBridgeHandle.js')
    setReplBridgeHandle(null)
    resetLeftArrowBridgeHandleForTests()
  })

  test('take after stash returns handle once; second take is null', async () => {
    const {
      stashLeftArrowBridgeHandle,
      takeLeftArrowBridgeHandle,
      getReplBridgeHandle,
      setReplBridgeHandle,
    } = await import('../replBridgeHandle.js')
    const fake = {
      bridgeSessionId: 'cse_stash',
      teardown: async () => {},
    } as unknown as import('../replBridge.js').ReplBridgeHandle
    setReplBridgeHandle(fake)
    expect(getReplBridgeHandle()).toBe(fake)
    stashLeftArrowBridgeHandle(getReplBridgeHandle())
    // Simulate unmount cleanup nulling the global.
    setReplBridgeHandle(null)
    expect(getReplBridgeHandle()).toBeNull()
    expect(takeLeftArrowBridgeHandle()?.bridgeSessionId).toBe('cse_stash')
    expect(takeLeftArrowBridgeHandle()).toBeNull()
  })
})

describe('runLeftArrowPostAdoptCheckpoint disowns cron by default', () => {
  afterEach(async () => {
    const { resetLeftArrowCheckpointLive } = await import(
      '../../utils/bgCheckpoint.js'
    )
    resetLeftArrowCheckpointLive()
  })

  test('disown uses injected removeCronIds after adopt', async () => {
    const removeCronIdsCalls: string[][] = []
    const { stashLeftArrowCheckpointLive, runLeftArrowPostAdoptCheckpoint } =
      await import('../../utils/bgCheckpoint.js')

    stashLeftArrowCheckpointLive({
      payload: {
        writtenAtMs: Date.now(),
        shells: [],
        cron: [
          {
            id: 'cron-1',
            cron: '* * * * *',
            prompt: 'hi',
          },
        ],
      },
      shellTaskIds: [],
      agentIds: [],
      workflowTaskIds: [],
      cronIds: ['cron-1'],
      detachedPids: [],
      handoffTaskIds: [],
      disown(removers: { removeCronIds?: (ids: readonly string[]) => void }) {
        removers.removeCronIds?.(['cron-1'])
      },
      async checkpointAgents() {
        return { abortedWorkflowIds: [], abortedAgentIds: [] }
      },
      abandon() {},
    } as never)

    await runLeftArrowPostAdoptCheckpoint({
      removeCronIds: ids => {
        removeCronIdsCalls.push([...ids])
      },
      flushAgentTranscripts: async () => {},
    })
    expect(removeCronIdsCalls).toEqual([['cron-1']])
  })
})

describe('classic replBridge grouping pass-through (densable Qt)', () => {
  test('initBridgeCore params + handle expose outboundOnly/sessionGroupingId', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const core = readFileSync(join(import.meta.dir, '../replBridge.ts'), 'utf8')
    const init = readFileSync(
      join(import.meta.dir, '../initReplBridge.ts'),
      'utf8',
    )
    // BridgeCoreParams densable B / He
    expect(core).toContain('outboundOnly?: boolean')
    expect(core).toContain('sessionGroupingId?: string')
    // handle pass-through (not hardcoded false/undefined)
    expect(core).toContain('outboundOnly,')
    expect(core).toContain('sessionGroupingId,')
    expect(core).not.toContain(
      'outboundOnly: false,\n    sessionGroupingId: undefined',
    )
    // v1 path passes through from initReplBridge
    expect(init).toMatch(/outboundOnly,\s*\n\s*sessionGroupingId,/)
  })
})

describe('bridgeSessionMeta densable CXr/wXr/kEo', () => {
  test('save → get → clear round-trip when session matches', async () => {
    const { getSessionId } = await import('../../bootstrap/state.js')
    const {
      saveBridgeSessionMeta,
      getPersistedBridgeSession,
      clearBridgeSessionMeta,
      resetBridgeSessionMetaForTests,
    } = await import('../bridgeSessionMeta.js')

    resetBridgeSessionMetaForTests()
    expect(getPersistedBridgeSession()).toBeUndefined()

    const sessionId = getSessionId()
    expect(sessionId).toBeTruthy()

    saveBridgeSessionMeta('cse_meta_1', 17, {
      sessionId,
      groupingId: 'grp-meta',
      ownerAccountUuid: 'acct-meta',
      ownerOrganizationUuid: 'org-meta',
      noHistoryBackfill: true,
    })
    expect(getPersistedBridgeSession()).toEqual({
      id: 'cse_meta_1',
      seq: 17,
      groupingId: 'grp-meta',
      declaredDialogKinds: undefined,
      noHistoryBackfill: true,
      ownerAccountUuid: 'acct-meta',
      ownerOrganizationUuid: 'org-meta',
    })

    // densable kEo
    clearBridgeSessionMeta()
    expect(getPersistedBridgeSession()).toBeUndefined()
  })

  test('save for foreign sessionId does not mutate live meta', async () => {
    const {
      saveBridgeSessionMeta,
      getPersistedBridgeSession,
      resetBridgeSessionMetaForTests,
    } = await import('../bridgeSessionMeta.js')
    resetBridgeSessionMetaForTests()
    saveBridgeSessionMeta('cse_foreign', 1, {
      sessionId: 'session-not-live',
      groupingId: 'x',
    })
    expect(getPersistedBridgeSession()).toBeUndefined()
  })

  /**
   * densable 2.1.228 #5 / C1 Critical:
   * skipArchive CXr only passes groupingId (+seq). Full-replace would wipe
   * noHistoryBackfill / owner* and break same-process wXr reattach after
   * left-arrow / disable→enable. Merge must retain suppress/owner flags.
   */
  test('skipArchive-style partial CXr retains noHistoryBackfill and owner', async () => {
    const { getSessionId } = await import('../../bootstrap/state.js')
    const {
      saveBridgeSessionMeta,
      getPersistedBridgeSession,
      resetBridgeSessionMetaForTests,
    } = await import('../bridgeSessionMeta.js')

    resetBridgeSessionMetaForTests()
    const sessionId = getSessionId()
    saveBridgeSessionMeta('cse_skip_c1', 10, {
      sessionId,
      groupingId: 'grp-seed',
      ownerAccountUuid: 'acct-c1',
      ownerOrganizationUuid: 'org-c1',
      noHistoryBackfill: true,
      declaredDialogKinds: ['user', 'assistant'],
    })

    // densable Kr skipArchive shape — only groupingId (seq advances)
    saveBridgeSessionMeta('cse_skip_c1', 99, {
      sessionId,
      groupingId: 'grp-seed',
    })

    expect(getPersistedBridgeSession()).toEqual({
      id: 'cse_skip_c1',
      seq: 99,
      groupingId: 'grp-seed',
      declaredDialogKinds: ['user', 'assistant'],
      noHistoryBackfill: true,
      ownerAccountUuid: 'acct-c1',
      ownerOrganizationUuid: 'org-c1',
    })
  })

  test('CXr for a different bridge id does not inherit prior suppress flags', async () => {
    const { getSessionId } = await import('../../bootstrap/state.js')
    const {
      saveBridgeSessionMeta,
      getPersistedBridgeSession,
      resetBridgeSessionMetaForTests,
    } = await import('../bridgeSessionMeta.js')

    resetBridgeSessionMetaForTests()
    const sessionId = getSessionId()
    saveBridgeSessionMeta('cse_old', 1, {
      sessionId,
      noHistoryBackfill: true,
      ownerAccountUuid: 'acct-old',
    })
    // Fresh mint for a new remote session — must not carry suppress/owner
    saveBridgeSessionMeta('cse_new', 0, {
      sessionId,
      groupingId: 'grp-new',
    })
    expect(getPersistedBridgeSession()).toEqual({
      id: 'cse_new',
      seq: 0,
      groupingId: 'grp-new',
      declaredDialogKinds: undefined,
      noHistoryBackfill: undefined,
      ownerAccountUuid: undefined,
      ownerOrganizationUuid: undefined,
    })
  })

  test('explicit noHistoryBackfill:false clears suppress on same bridge', async () => {
    const { getSessionId } = await import('../../bootstrap/state.js')
    const {
      saveBridgeSessionMeta,
      getPersistedBridgeSession,
      resetBridgeSessionMetaForTests,
    } = await import('../bridgeSessionMeta.js')

    resetBridgeSessionMetaForTests()
    const sessionId = getSessionId()
    saveBridgeSessionMeta('cse_clear', 1, {
      sessionId,
      noHistoryBackfill: true,
      ownerAccountUuid: 'acct',
    })
    saveBridgeSessionMeta('cse_clear', 2, {
      sessionId,
      noHistoryBackfill: false,
    })
    const meta = getPersistedBridgeSession()
    expect(meta?.noHistoryBackfill).toBeUndefined()
    // owner still merges when omitted
    expect(meta?.ownerAccountUuid).toBe('acct')
    expect(meta?.seq).toBe(2)
  })
})

describe('makeWorkerShuttingDownMessage densable mzu', () => {
  test('system subtype worker_shutting_down carries reason', async () => {
    const { makeWorkerShuttingDownMessage } = await import(
      '../bridgeMessaging.js'
    )
    const msg = makeWorkerShuttingDownMessage('cse_1', 'host_exit')
    expect(msg).toMatchObject({
      type: 'system',
      subtype: 'worker_shutting_down',
      reason: 'host_exit',
      session_id: 'cse_1',
    })
    expect(typeof msg.uuid).toBe('string')
  })
})

describe('initReplBridge densable wXr + force env-less reattach', () => {
  test('source: wXr fallback + forceEnvLessReattach when reattach set', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const init = readFileSync(
      join(import.meta.dir, '../initReplBridge.ts'),
      'utf8',
    )
    expect(init).toContain('getPersistedBridgeSession')
    expect(init).toContain('Reattaching to persisted bridge session')
    expect(init).toContain('forceEnvLessReattach')
    expect(init).toContain(
      '(isEnvLessBridgeEnabled() || forceEnvLessReattach) && !perpetual',
    )
    // densable Q grouping: env GROUPING vs wXr groupingId vs option k
    expect(init).toContain('envReattachGrouping')
    expect(init).toContain('groupingId')
  })
})

describe('teardown To latch + mzu reason (source densable)', () => {
  test('remoteBridgeCore: To latches skipArchive/reason; Ks mzu + skip flush only with reason', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const core = readFileSync(
      join(import.meta.dir, '../remoteBridgeCore.ts'),
      'utf8',
    )
    expect(core).toContain('skipArchiveLatch')
    expect(core).toContain('teardownReason')
    expect(core).toContain('if (opts?.skipArchive) skipArchiveLatch = true')
    expect(core).toContain('if (opts?.reason) teardownReason = opts.reason')
    expect(core).toContain('if (teardownPromise) return teardownPromise')
    expect(core).toContain('makeWorkerShuttingDownMessage')
    // densable: flush on skip only when reason set
    expect(core).toMatch(
      /if \(skipArchiveLatch\)[\s\S]*?if \(teardownReason !== undefined\)[\s\S]*?flush/,
    )
    // kEo only on full teardown
    expect(core).toContain('clearBridgeSessionMeta()')
    expect(core).toContain('saveBridgeSessionMeta')
  })

  test('replBridge: To join + mzu + CXr on skip / kEo on full', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const core = readFileSync(join(import.meta.dir, '../replBridge.ts'), 'utf8')
    expect(core).toContain('skipArchiveLatch')
    expect(core).toContain('teardownPromise')
    expect(core).toContain('makeWorkerShuttingDownMessage')
    expect(core).toContain('saveBridgeSessionMeta(currentSessionId')
    expect(core).toContain('clearBridgeSessionMeta()')
  })

  test('useReplBridge cleanup writes reason + CXr/kEo', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const hook = readFileSync(
      join(import.meta.dir, '../../hooks/useReplBridge.tsx'),
      'utf8',
    )
    expect(hook).toContain('remote_control_disabled')
    expect(hook).toContain('host_exit')
    expect(hook).toContain('clearBridgeSessionMeta')
    expect(hook).toContain('saveBridgeSessionMeta')
    expect(hook).toContain('handle.teardown(')
  })
})
