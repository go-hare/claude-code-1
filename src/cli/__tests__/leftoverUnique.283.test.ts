/**
 * densable 2.1.283 leftover unique source-lock.
 *
 * Gold SEA `/tmp/official-283/package/claude` — wrap twins only, no fleet engine.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('../../utils/debug.js', () => debugMock())
mock.module('../../utils/debug.ts', () => debugMock())
mock.module('src/utils/debug.js', () => debugMock())
mock.module('src/utils/debug.ts', () => debugMock())
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())
mock.module('src/services/analytics/index.js', () => analyticsMock())
mock.module('src/services/analytics/index.ts', () => analyticsMock())

const {
  applyInterruptCancelQueued,
  boundDeviceIdIfEgressAllowed,
  classifyCloudCreateApiError,
  classifyForwardedHookOutcome,
  classifyToolProgressStream,
  CLOUD_RESTRICTED_SESSION_ERROR,
  CLOUD_SYNC_OFFLINE_BODY,
  CLOUD_SYNC_OFFLINE_KIND,
  CLOUD_SYNC_OFFLINE_TITLE,
  cloudSyncOfflineCopy,
  createBoundCreatePack,
  createHeadlessHostDialogDispatcher,
  createLaunchFolderJudge,
  createMemorySender,
  definedEntryMap,
  envAccountUuidIfHostAuth,
  flattenCloudPromptText,
  HeadlessEmittedUuidSet,
  holdUntilPermissionModeSaved,
  isDigestOnlyHookInput,
  isHeadlessHostDialogKind,
  isHeadlessPartialFrame,
  isIsoTimestamp,
  launchedFromHomeRefuseExtra,
  isRetryablePermissionModePost,
  isToolUseBlock,
  PERMISSION_MODE_PUSH_GAVE_UP,
  PERMISSION_MODE_PUSH_GAVE_UP_IDLE,
  PERMISSION_MODE_PUSH_SESSION_INACTIVE,
  peerImageSource,
  pushCreatePermissionMode,
  noteCcrSessionLink,
  remoteToolsLog,
  repositoryTrustStateCopyKey,
  reshapeCloudSessionEnvelope,
  reshapePeerUserPrompt,
  resolveBindAccountFromHost,
  servedCanUseToolAsk,
  servedToolsAttachOptions,
  servedToolsOwner,
  skipDeviceBind,
  STOPPED_WHILE_RUNNING,
  WORKER_UP,
  stampOpenedCloudSessionNotApplied,
  stripUnsupportedPeerContent,
  truncateHeadlessError,
  UNSUPPORTED_PEER_CONTENT_OMITTED,
} = await import('../leftoverUnique.js')
import type { PermissionModePostResult } from '../leftoverUnique.js'

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

describe('leftover unique 283 source-lock', () => {
  test('leftoverUnique.ts lands gold leftover unique strings', () => {
    const body = src('../leftoverUnique.ts')
    expect(body).toContain('gold `Fi` @202283734')
    expect(body).toContain('gold `AWt` @202284437')
    expect(body).toContain('gold `kWt` @202284645')
    expect(body).toContain('gold `Eo` @202280662')
    expect(body).toContain('gold `RWt` @202285771')
    expect(body).toContain('leftover `RWt` @202285762 unique token')
    expect(body).toContain('stopped_while_running')
    expect(body).toContain('onWorkerUp:O("worker_up")')
    expect(body).toContain("export const WORKER_UP = 'worker_up'")
    expect(body).toContain('gold `xWt` @202287816')
    expect(body).toContain('gold `Zi` @202288489')
    expect(body).toContain('gold `PWt` @202288606')
    expect(body).toContain('gold `iKr` @202290825')
    expect(body).toContain('gold `IWt` @202291200')
    expect(body).toContain('gold `AVo` @202293959')
    expect(body).toContain('gold `kVo` @202294334')
    expect(body).toContain('gold `Xe` @202333532')
    expect(body).toContain('gold `jt` @202333608')
    expect(body).toContain('gold `Ze` @202334992')
    expect(body).toContain('gold `class tt` @202335088')
    expect(body).toContain('gold `Ts` @202344277')
    expect(body).toContain('gold `Hs` @202344734')
    expect(body).toContain('gold `Kt` @202345363')
    expect(body).toContain('gold `Ls` @202345448')
    expect(body).toContain('gold `xs` @202345676')
    expect(body).toContain('gold `Us` @202345967')
    expect(body).toContain('gold `Gt` @202346212')
    expect(body).toContain('gold `et` @202346304')
    expect(body).toContain('gold `Qs` @202358474')
    expect(body).toContain('gold `Js` @202373828')
    expect(body).toContain('gold `Nt` @202327058')
    expect(body).toContain('gold `__n` @202419110')
    expect(body).toContain('gold `Bar` @196066607')
    expect(body).toContain('gold `zbe` @196066774')
    expect(body).toContain('gold `ype` @196067729')
    expect(body).toContain('gold `jGt` @185893074')
    expect(body).toContain('gold `HGt` @185892587')
    expect(body).toContain('gold `x2o` @185902119')
    expect(body).toContain('gold `Dae` @185902771')
    expect(body).toContain('gold `eSn` @200263182')
    expect(body).toContain('gold `fVt` @200265467')
    expect(body).toContain('gold `p7r` @200266307')
    expect(body).toContain('gold `HWt` @202291265')
    expect(body).toContain('gold `Rt` @202303237')
    expect(body).toContain('gold `class st` @202335343')
    expect(body).toContain('leftoverHeadlessCopy')
    expect(body).toContain('leftoverHeadlessClient.ts')
    expect(body).toContain('leftoverTulip.ts')
    expect(body).toContain('leftoverHeadlessManager.ts')
    expect(body).toContain('leftover `_o` @202276282')
    expect(body).toContain(
      'leftover `PWt`/`TXn`/`v`/`Ke`/`st`/`dt`/`tn` unique logs',
    )
    expect(body).toContain('not_applied')
    expect(body).toContain('tengu_ccr_session_link')
    expect(body).toContain('tengu_device_bind_skipped')
    expect(body).toContain(
      'Cloud sessions cannot be created from a --restricted session',
    )
    expect(body).toContain('[remote-tools]')
    expect(body).toContain('suppress_always_allow_rule')
    expect(body).toContain('repository_trust.state.trusted')
    expect(body).toContain('event_mismatch')
    expect(body).toContain('content_digest')
    expect(body).toContain('[RemoteSessionManager] Cannot send: not connected')
    expect(body).toContain('tengu_remote_create_permission_mode_push')
    expect(body).toContain("couldn't be saved on the server first")
    expect(body).toContain(
      'Cloud session may be unresponsive. Attempting to reconnect',
    )
    expect(body).toContain('cloud_sync_offline')
    expect(body).toContain('File sync is offline for this session')
    expect(body).toContain('tengu_remote_headless_client_host_dialog')
    expect(body).toContain('[unsupported content from another client omitted]')
    expect(body).toContain('cancel_queued')
    expect(body).toContain('tengu_remote_headless_client_agent_request')
    expect(body).toContain('dropped a cloud_session key')
    expect(body).toContain(
      'Your message was not delivered to the cloud session',
    )
    expect(body).toContain('the cloud client is closing')
    expect(body).toContain('tengu_remote_headless_client_worker_initialize')
    expect(body).toContain('POLICY_INVALID_REASON')
    expect(body).toContain("kind === 'bash'")
    expect(body).toContain('staysAttached: true')
    expect(body).not.toContain('tengu_violin_amati')
    expect(body).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
  })

  test('Fi/AWt/kWt/Eo/RWt wrap', async () => {
    expect(classifyForwardedHookOutcome('answered')).toBe('ok')
    expect(classifyForwardedHookOutcome('event_mismatch')).toBe('ok')
    expect(classifyForwardedHookOutcome('not_mine')).toBe(null)
    expect(classifyForwardedHookOutcome('unknown_id')).toBe('sad')
    expect(classifyForwardedHookOutcome('staging_failed')).toBe('bad')
    expect(
      isDigestOnlyHookInput({
        description: 'hook',
        input: {
          content_digest:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      }),
    ).toBe(true)
    expect(
      isDigestOnlyHookInput({
        description: 'hook',
        input: { content_digest: 'nope', extra: 1 },
      }),
    ).toBe(false)
    expect(await createLaunchFolderJudge({ launchDir: '/tmp' }).judge()).toBe(
      'unknown',
    )
    const pack = createBoundCreatePack({ launchDir: '/tmp' })
    expect(pack.servingMuted).toBe(false)
    pack.sender.unregister()
    createMemorySender({ launchDir: '/tmp' }).servingMute(true)
  })

  test('xWt/Zi/PWt/iKr wrap', async () => {
    expect(CLOUD_SYNC_OFFLINE_KIND).toBe('cloud_sync_offline')
    expect(cloudSyncOfflineCopy({ folder: '/proj', attempts: 2 })).toEqual({
      folder: '/proj',
      title: CLOUD_SYNC_OFFLINE_TITLE,
      body: CLOUD_SYNC_OFFLINE_BODY,
      attempts: 2,
    })
    expect(
      isRetryablePermissionModePost({
        outcome: 'failed',
        cause: 'http',
        status: 429,
      }),
    ).toBe(true)
    expect(
      isRetryablePermissionModePost({
        outcome: 'failed',
        cause: 'http',
        status: 400,
      }),
    ).toBe(false)
    const posted: PermissionModePostResult[] = []
    const result = await pushCreatePermissionMode({
      manager: {
        postControlRequest: req => {
          posted.push({ outcome: 'accepted' })
          expect(req.subtype).toBe('set_permission_mode')
          return {
            posted: Promise.resolve({ outcome: 'accepted' }),
            response: Promise.resolve({}),
          }
        },
      },
      mode: 'acceptEdits',
      surface: 'sdk_host',
      sessionId: 'cse_1',
      superseded: () => false,
    })
    expect(result.outcome).toBe('accepted')
    expect(PERMISSION_MODE_PUSH_GAVE_UP_IDLE).toContain('idling')
    expect(PERMISSION_MODE_PUSH_GAVE_UP).toContain("couldn't be saved")
    expect(PERMISSION_MODE_PUSH_SESSION_INACTIVE).toContain("isn't active")
    expect(STOPPED_WHILE_RUNNING).toBe('stopped_while_running')
    expect(WORKER_UP).toBe('worker_up')
    const latch: { notTakenAtMs?: number } = {}
    const hold = holdUntilPermissionModeSaved({
      posted: Promise.resolve({ outcome: 'failed' }),
      mode: 'acceptEdits',
      latch,
      retire: () => {},
      now: () => 1000,
    })
    const blocked = await hold({ submittedAtMs: 1001 })
    expect(blocked?.go).toBe(false)
    expect(blocked?.reason).toContain("permission mode couldn't be saved")
  })

  test('AVo/kVo/Xe/jt/Ze/tt wrap', async () => {
    expect(
      await boundDeviceIdIfEgressAllowed(
        Promise.resolve({ archived: false, boundDeviceId: 'dev-1' }),
        { isEnabled: async () => true, isEgressAllowed: () => true },
      ),
    ).toBe('dev-1')
    expect(
      await boundDeviceIdIfEgressAllowed(
        Promise.resolve({ archived: true, boundDeviceId: 'dev-1' }),
        { isEnabled: async () => true, isEgressAllowed: () => true },
      ),
    ).toBeUndefined()
    expect(
      servedToolsOwner({
        viewerOnly: false,
        binding: { status: 'bound', deviceId: 'd' },
      }),
    ).toEqual({ owner: true, deviceId: 'd' })
    const served = await servedToolsAttachOptions({
      sessionId: 'cse_1',
      binding: Promise.resolve({ status: 'bound', deviceId: 'd' }),
    })
    expect(served.owner()).toEqual({ owner: true, deviceId: 'd' })
    expect(isHeadlessHostDialogKind('cloud_sync_consent')).toBe(true)
    expect(isHeadlessHostDialogKind('cloud_sync_offline')).toBe(true)
    expect(isHeadlessHostDialogKind('nope')).toBe(false)
    const ask = createHeadlessHostDialogDispatcher({
      io: {
        requestUserDialog: async () => ({
          behavior: 'answered',
          result: 'sync',
        }),
      },
      declaredKinds: new Set(['cloud_sync_consent']),
    })
    expect(
      await ask(
        { kind: 'cloud_sync_consent', default: 'not_now' },
        { folder: '/' },
      ),
    ).toEqual({ answer: 'sync', answered: true })
    expect(
      await ask({ kind: 'cloud_sync_offline', default: 'unanswered' }, {}),
    ).toEqual({ answer: 'unanswered', answered: false })
    expect(isHeadlessPartialFrame({ type: 'stream_event' })).toBe(true)
    expect(
      isHeadlessPartialFrame({ type: 'system', subtype: 'thinking_tokens' }),
    ).toBe(true)
    const uuids = new HeadlessEmittedUuidSet(2)
    uuids.add('a')
    uuids.add('b')
    uuids.add('c')
    expect(uuids.has('a')).toBe(false)
    expect(uuids.has('c')).toBe(true)
    expect(truncateHeadlessError('x'.repeat(80)).length).toBe(64)
  })

  test('Ts/Hs/Kt/Ls/xs/Us/Gt/et/Qs/Js wrap', () => {
    expect(isToolUseBlock({ type: 'tool_use' })).toBe(true)
    expect(
      stripUnsupportedPeerContent([{ type: 'text', text: 'hi' }]).content,
    ).toEqual([{ type: 'text', text: 'hi' }])
    expect(stripUnsupportedPeerContent({ nope: true }).content).toEqual([
      { type: 'text', text: UNSUPPORTED_PEER_CONTENT_OMITTED },
    ])
    expect(
      peerImageSource({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'abc',
        },
      }),
    ).toEqual({ type: 'base64', media_type: 'image/png', data: 'abc' })
    expect(isIsoTimestamp('2026-09-28T12:00:00Z')).toBe(true)
    expect(isIsoTimestamp('not-a-date')).toBe(false)
    const reshaped = reshapePeerUserPrompt(
      {
        uuid: 'u1',
        timestamp: '2026-09-28T12:00:00Z',
        message: { content: 'hello' },
      },
      { keepUuid: true, sessionId: 'session_1' },
    )
    expect(reshaped.prompt).toMatchObject({
      type: 'user',
      uuid: 'u1',
      session_id: 'session_1',
      message: { role: 'user', content: 'hello' },
    })
    expect(definedEntryMap({ a: 1, b: undefined }).has('b')).toBe(false)
    const envelope = reshapeCloudSessionEnvelope({
      id: 'cse_deadbeef',
      device: { status: 'unbound', reason: 'gone', message: 'x' },
      directory_sync: {
        state: 'off',
        file_mode: 'none',
        file_mode_source: 'stored',
      },
    })
    expect(String(envelope.id).startsWith('session_')).toBe(true)
    expect(
      applyInterruptCancelQueued(
        { cancel_queued: true },
        { subtype: 'interrupt' },
      ),
    ).toEqual({ subtype: 'interrupt', cancel_queued: true })
    expect(
      applyInterruptCancelQueued({ cancel_queued: true }, { subtype: 'other' }),
    ).toEqual({ subtype: 'other' })
    expect(classifyToolProgressStream({ kind: 'bash' })).toBe('streams')
    expect(
      classifyToolProgressStream({
        content: '<bash-stdout>hi',
      }),
    ).toBe('never')
  })

  test('__n/Bar/zbe/ype/jGt/HGt/x2o/Dae/eSn/fVt/p7r wrap', async () => {
    const stamped = stampOpenedCloudSessionNotApplied(
      {
        kind: 'opened' as const,
        session: {
          notices: [],
          cloudSession: () => ({ id: 'session_1' }),
        },
      },
      {
        notices: [{ level: 'notice', text: 'n' }],
        entries: [{ kind: 'preference', name: 'initialize.cwd' }],
      },
    )
    expect(stamped.session.cloudSession().not_applied).toEqual([
      { name: 'initialize.cwd', kind: 'preference' },
    ])
    expect(await envAccountUuidIfHostAuth(async () => 'stored')).toBeUndefined()
    const prev = process.env.CLAUDE_CODE_ACCOUNT_UUID
    process.env.CLAUDE_CODE_ACCOUNT_UUID = 'AAAA-BBBB'
    try {
      expect(await envAccountUuidIfHostAuth(async () => 'env')).toBe(
        'aaaa-bbbb',
      )
      const uar = await resolveBindAccountFromHost({
        storedAccountUuid: 'aaaa-bbbb',
        hostAuthSource: async () => 'env',
      })
      expect(uar.status).toBe('resolved')
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_ACCOUNT_UUID
      else process.env.CLAUDE_CODE_ACCOUNT_UUID = prev
    }
    expect(launchedFromHomeRefuseExtra('launched_from_home')).toEqual({})
    expect(launchedFromHomeRefuseExtra('egress')).toEqual({})
    expect(classifyCloudCreateApiError('rate_limit_error')).toBe(
      'rate_limit_error',
    )
    expect(classifyCloudCreateApiError('nope')).toBe('other')
    expect(CLOUD_RESTRICTED_SESSION_ERROR).toContain('--restricted')
    noteCcrSessionLink({
      sessionId: 'cse_1',
      source: 'cli',
      endpoint: 'v1alpha2',
    })
    expect(flattenCloudPromptText([{ type: 'text', text: 'hi' }])).toBe('hi')
    expect(flattenCloudPromptText(null)).toBe('')
    expect(skipDeviceBind('endpoint')).toEqual({
      skipped: true,
      reason: 'endpoint',
    })
    remoteToolsLog('bridge')('start', 'ok')
    expect(
      servedCanUseToolAsk({
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: {},
        tool_use_id: '1',
      }),
    ).toMatchObject({
      suppress_always_allow_rule: true,
      default_to_no: true,
      requires_user_interaction: true,
    })
    expect(repositoryTrustStateCopyKey('trusted')).toBe(
      'repository_trust.state.trusted',
    )
  })
})
