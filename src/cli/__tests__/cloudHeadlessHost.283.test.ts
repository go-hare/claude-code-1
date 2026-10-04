/**
 * densable 2.1.283 headless SDK-host `In` / `EVo` / `vVo` source-lock.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `In` @202416789
 * - `EVo` create @202420586
 * - `vVo` attach @202432597
 * - TTY refuse Lo @202415169
 * - `headlessCloud` = m8r ∧ violin-wood (`os()`)
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resetSessionHostForTests } from '../../utils/sessionHost.js'
import {
  HEADLESS_CLOUD_STDIN_TTY_ERROR,
  headlessCloudFeatures,
  headlessCloudIgnoredHostOptions,
  headlessCloudServeOnlyFeatures,
  isHeadlessCloudSdkHost,
  notAppliedReport,
  parseCloudLaunch,
  registeredBuiltInToolNames,
} from '../cloudSession.js'

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

describe('cloudHeadlessHost 283 In/EVo/vVo source-lock', () => {
  test('cloudSession.ts lands gold In/EVo/vVo entry strings', () => {
    const body = src('../cloudSession.ts')
    expect(body).toContain('gold `In` @202416789')
    expect(body).toContain('gold `EVo` @202420586')
    expect(body).toContain('gold `vVo` @202432597')
    expect(body).toContain("entry: 'create'")
    expect(body).toContain("entry: 'attach'")
    expect(body).toContain("attachHonours: ['attachServeRequest']")
    expect(body).toContain('runHeadlessCloudCreate')
    expect(body).toContain('runHeadlessCloudAttach')
    expect(body).toContain('runHeadlessCloudHost')
    expect(body).toContain('teleportToRemote')
    expect(body).toContain('startHeadlessCloudSession')
    expect(body).toContain('gold `m_n` @202374511')
    expect(body).toContain('class HeadlessCloudSdkHost')
    expect(body).toContain('new HeadlessCloudSdkHost')
    expect(body).toContain('oauthBridgeInstalled')
    expect(body).toContain('bindPreflight')
    expect(body).toContain('cloudBindUnavailableError')
    expect(body).toContain('could not be bound to this machine')
    expect(body).toContain('account_mismatch')
    expect(body).toContain('CLAUDE_CODE_ACCOUNT_UUID')
    expect(body).toContain('agentRequests')
    expect(body).toContain('hostRequests')
    expect(body).toContain('no_device_proof')
    expect(body).toContain('trustedDeviceTokenForBind')
    expect(body).toContain('installOAuthBridge')
    expect(body).toContain('resolveBindAccount')
    expect(body).toContain("source: 'stored'")
    expect(body).toContain("source: 'env'")
    expect(body).toContain("uar.status === 'missing'")
    expect(body).toContain("uar.status === 'mismatch'")
    expect(body).toContain('d5oTrustedDeviceTokenForBind')
    expect(body).toContain('routeCloudHostedControlRequest')
    expect(body).toContain('classifyCloudInitializeOptions')
    expect(body).toContain('names a path on this machine')
    expect(body).toContain('is not available in a cloud-hosted session')
    expect(body).toContain('cloudInitializeSuccessEnvelope')
    expect(body).toContain('pid: process.pid')
    expect(body).toContain('tengu_remote_create_session')
    expect(body).toContain('tengu_remote_attach_session')
    expect(body).toContain('tengu_remote_headless_client_host_request')
    expect(body).toContain("initializePolicy: 'strict'")
    expect(body).toContain('openingInitializeHonours')
    expect(body).toContain('feature_name:')
    expect(body).toContain("'remote_headless_session'")
    expect(body).toContain('cloudBranchMode')
    expect(body).toContain("'on_branch'")
    expect(body).toContain('headlessCloudTeleportPayload')
    expect(body).toContain('branchFromHead')
    expect(body).toContain('allowBundle: true')
    expect(body).toContain('tengu_remote_create_session_success')
    expect(body).toContain('could not read where cloud session')
    expect(body).toContain('attach_stream_position')
    expect(body).toContain('setHasFormattedOutput(true)')
    expect(body).toContain('markRemote(true)')
    expect(body).toContain('initializeFieldFate')
    expect(body).toContain('overlayInitializeOnForwarded')
    expect(body).toContain('joinCloudSystemPrompt')
    expect(body).toContain('withHeadlessCloudAuth')
    expect(body).toContain('Unable to open the cloud session')
    expect(body).toContain('Failed to authenticate')
    expect(body).toContain('rejected_argv')
    expect(body).toContain('attachHeadlessFeatures')
    expect(body).toContain('createCloudHooksPack')
    expect(body).toContain('createCloudToolsPack')
    expect(body).toContain('createSettingsToCloudPack')
    expect(body).toContain('linkSessionDeviceWithRetry')
    expect(body).toContain('accountUuid => oZe(accountUuid)')
    expect(body).toContain('readiness_wait_ms: U')
    expect(body).toContain('peerFramesDroppedBeforeInitCount')
    expect(body).toContain('servedHostMaxAskMs')
    expect(body).toContain('createServedAskLimiter')
    expect(body).toContain('askLimiter = createServedAskLimiter()')
    expect(body).toContain('composeExtraReachForCloudHooks')
    expect(body).toContain('mergeReachEnv')
    expect(body).toContain('legacyConfigFileCache')
    expect(body).toContain(
      "const bound = opened.kind === 'opened' && opened.bound === true",
    )
    expect(body).toContain('servedTools: bound ? {} : undefined')
    expect(body).toContain("bound: resolved.status === 'bound'")
    expect(body).not.toContain('createCloudToolsPack()({ bound: false })')
    expect(body).toContain('HEADLESS_CLOUD_WATCHDOG_MS_ATTACHED')
    expect(body).toContain('headlessCloudModelGate')
    expect(body).toContain('promptDirSyncConsent')
    expect(body).toContain('promptUnattendedServingConsent')
    expect(body).toContain('tengu_dir_sync_mode_prompt_skipped')
    expect(body).toContain('tengu_served_unattended_consent')
    expect(body).toContain('settingsToCloudEnabled')
    expect(body).toContain("action: 'none'")
    expect(body).toContain('cloud_sync_consent')
    expect(body).toContain('unattended_serving_consent')
    expect(body).toContain('localServeLinkIdentity')
    expect(body).toContain('linkForServing')
    expect(body).toContain('createDeviceBindingBag')
    expect(body).toContain('class HeadlessCloudAgentRequests')
    expect(body).toContain('class HeadlessCloudHostRequests')
    expect(body).toContain('new HeadlessCloudAgentRequests()')
    expect(body).toContain('new HeadlessCloudHostRequests()')
    expect(body).toContain('tengu_attach_serve_link')
    expect(body).toContain("kind: 'local'")
    expect(body).toContain('isLocalServeLinkAllowed')
    expect(src('../serveIdentity.ts')).toContain("reason === 'no_device_proof'")
    expect(src('../serveIdentity.ts')).toContain(
      'Error: cannot serve cloud session ${sessionId} from this computer:',
    )
    expect(body).toContain('class HeadlessCloudFrames')
    expect(body).toContain('class HeadlessCloudLiveness')
    expect(body).toContain('class HeadlessCloudOutbound')
    expect(body).toContain('postsInFlight = new Set')
    expect(body).toContain('forwardsWaiting = new Map')
    expect(body).toContain('sendOutstanding = false')
    expect(body).toContain('abandonPostsInFlight')
    expect(body).toContain('this.queue.length + this.forwardsWaiting.size')
    expect(body).toContain('class HeadlessCloudFeatureHandles')
    expect(body).toContain('tengu_remote_headless_client_queue_overflow')
    expect(body).toContain('stripCloudSessionKey')
    expect(body).toContain('stripEdeDiagnosticErrors')
    expect(body).toContain('[ede_diagnostic]')
    expect(body).toContain('seedDirSync: true')
    expect(body).toContain('staysAttached: true')
    expect(body).toContain('hostedServeDialogsGateOn')
    expect(body).toContain(
      'attach preflight failed (continuing via the stream)',
    )
    expect(body).toContain('home_seed_started')
    expect(body).toContain('cloudSessionContextExtras')
    expect(body).not.toContain('tengu_violin_amati')
    expect(body).toContain('openingPermissionModeRequests')
    expect(body).toContain('replayCloudUserMessage')
    expect(body).toContain('isReplay: true')
    expect(body).toContain('serveOnlySeparateCopy')
    expect(body).toContain('separate_copy')
    expect(body).toContain('resolveAttachDeviceBinding')
    expect(body).toContain('tengu_device_bind_attach')
    expect(body).toContain('isLinkPreparationOverlapOn')
    expect(body).toContain('headlessCloudBareTeleportPayload')
    expect(body).toContain('staysAttached: false')
    expect(body).toContain('cloud_headless_bare')
    expect(body).toContain('a cloud session needs a prompt')
    expect(body).toContain('attach_wont_start')
    expect(body).toContain('attach_busy')
    expect(body).toContain('openHeadlessCloudBareCreate')
    expect(body).toContain('openHeadlessCloudBareAttach')
    expect(body).toContain('class HeadlessCloudSendLedger')
    expect(body).toContain('the device bridge did not start')
    expect(body).toContain('directory-sync lookup failed')
    expect(body).toContain('stream position unreadable, retrying once')
    expect(body).toContain('classifyCloudTurnEvents')
    expect(body).toContain('cloudTurnInFlight')
    expect(body).toContain('registerAttachDevice')
    expect(body).toContain('cloudSessionEnvelope')
    expect(body).toContain('client_version: 1')
    expect(body).toContain('startRepositoryTrustPoll')
    expect(body).toContain('mergeOpenedCloudSessionNotices')
    expect(body).toContain('Claude Code on ')
    expect(body).toContain('isRepositoryTrustPollEnabled')
    expect(body).toContain('isEventualHavenEnabledSync')
    expect(body).toContain('dirSyncConsentCopy')
    expect(body).toContain('deviceMcpConsentSnapshot')
    expect(body).toContain('askHostDeviceMcpConsent')
    expect(body).toContain('startAttachSync')
    expect(body).toContain('boundCreateSessionBody')
    expect(body).toContain('target_device_id')
    expect(body).toContain('bind_attestation')
    expect(body).toContain('postBoundCreateSession')
    expect(body).toContain('postSessionDeviceBind')
    expect(body).toContain('CLOUD_SYNC_CONSENT_RESULTS')
    expect(body).toContain('DEVICE_MCP_CONSENT_RESULTS')
    expect(body).toContain('parseRepositoryTrustToolError')
    expect(body).toContain('repositoryTrustFromSession')
    expect(body).toContain('firstPromptDeferred')
    expect(body).toContain(
      '[deviceBind] bound create leaves the first prompt out: this client sends it signed once the permission mode it pushes has been stored',
    )
    expect(body).toContain('[deviceBind] bound create dropped ${D.join(", ")}')
    expect(body).toContain(
      '[deviceBind] bound create goes without repositories_trusted',
    )
    expect(body).toContain(
      '[deviceBind] the create that asked for the elevated tier got',
    )
    expect(body).toContain('repositoryTrustFromTags')
    expect(body).toContain('coalescedSessionPoll')
    expect(body).toContain('startLaptopRegistration')
    expect(body).toContain('tengu_device_bridge_started')
    expect(body).toContain(
      '[deviceBridge] skipped: non-essential egress disabled, non-first-party provider, or remote sessions policy-denied',
    )
    expect(body).toContain(
      '[deviceBridge] skipped: the bridge cannot check a device proof and trusted devices are required or unknown',
    )
    expect(body).toContain('tengu_device_bridge_skipped')
    expect(body).toContain('missing_org')
    expect(body).toContain('missing_account')
    expect(body).toContain('account_source')
    expect(body).toContain('tengu_device_bridge_muted')
    expect(body).toContain('[deviceBridge] stopping: the gate turned off')
    expect(body).toContain('isTrustedDeviceActiveForOrg')
    expect(body).toContain('tengu_remote_headless_laptop_linked')
    expect(body).toContain('streamEcho')
    expect(body).toContain('giveUp')
    expect(body).toContain('waitDirSyncSeedAtExit')
    expect(body).toContain('directory-sync seed was still uploading after')
    expect(body).toContain('cut_at_exit')
    expect(body).toContain('directorySyncEnvelope')
    expect(body).toContain('file_mode_source')
    expect(body).toContain('attachLaptopDirSyncSession')
    expect(body).toContain('ccr_dir_sync_pull')
    expect(body).toContain('created_empty_unfilled')
    expect(body).toContain('engine_declined')
    expect(body).toContain('engine_unsupported')
    expect(body).toContain('attach_created_empty_unfilled')
    expect(body).toContain('attach_engine_declined')
    expect(body).toContain('attach_engine_unsupported')
    expect(body).toContain('attach_folder_record_unreadable')
    expect(body).toContain('isViolinWoodEnabledSync')
    expect(body).toContain('gold `es()` @180782505')
    expect(body).toContain('gold `Me` @196043887')
    expect(body).toContain('DIR_SYNC_ENGINE_DECLINED_LINE')
    expect(body).toContain('DIR_SYNC_CREATED_EMPTY_UNFILLED_LINE')
    expect(body).toContain('DIR_SYNC_ENGINE_UNSUPPORTED_LINE')
    expect(body).not.toContain('tengu_violin_amati')
    expect(body).toContain('fetchLatestCloudEvents')
    expect(body).toContain('createServingReadiness')
    expect(body).toContain('postCreateDropRepositoriesTrusted')
    expect(body).toContain('repeating it without the field')
    expect(body).toContain('HEADLESS_CLOUD_STALL_MS')
    expect(body).toContain('headlessCloudWatchdogMs')
    expect(body).toContain('Still waiting for the cloud session to start')
    expect(body).toContain('Cloud session may be unresponsive')
    expect(body).toContain('tengu_remote_headless_client_bootstrap_stalled')
    expect(body).toContain('tengu_remote_headless_client_watchdog_fired')
    expect(body).not.toContain('frames: unknown = null')
    expect(body).not.toContain('liveness: unknown = null')
  })

  test('st/ot frames+liveness: hold create until init; watchdog ms', async () => {
    const {
      HeadlessCloudFrames,
      HeadlessCloudLiveness,
      headlessCloudWatchdogMs,
      HEADLESS_CLOUD_STALL_MS,
    } = await import('../cloudSession.js')
    expect(HEADLESS_CLOUD_STALL_MS).toBe(60_000)
    expect(headlessCloudWatchdogMs(false)).toBe(60_000)
    expect(headlessCloudWatchdogMs(true)).toBe(180_000)
    const create = new HeadlessCloudFrames({
      entry: 'create',
      sessionId: 'cse_1',
    })
    expect(create.handle({ type: 'assistant' }, 'worker')).toBe('hold')
    expect(create.handle({ type: 'system', subtype: 'init' }, 'worker')).toBe(
      'init',
    )
    expect(create.releaseHeld()).toHaveLength(1)
    expect(create.handle({ type: 'assistant' }, 'worker')).toBe('emit')
    const attach = new HeadlessCloudFrames({
      entry: 'attach',
      sessionId: 'cse_1',
    })
    expect(attach.workerReady).toBe(true)
    expect(attach.handle({ type: 'assistant' }, 'worker')).toBe('emit')
    expect(
      create.sanitize({
        type: 'result',
        cloud_session: { id: 'x' },
        errors: ['[ede_diagnostic] n', 'keep'],
      }),
    ).toEqual({ type: 'result', errors: ['keep'] })
    const live = new HeadlessCloudLiveness(
      {
        controlOnly: false,
        queuedSendCount: () => 0,
        reconnect: () => {},
        line: () => {},
      },
      { titleFromFirstMessage: true },
    )
    live.noteDelivered('hello')
    expect(live.title).toBe('set')
    live.noteInbound({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
    })
    expect(live.compacting).toBe(true)
    live.noteInterrupt()
    await live.stop()
    expect(live.stopped).toBe(true)
  })

  test('We/Lt/Ke/at wrap: no_device_proof still serveOnly; at routes D()', async () => {
    const {
      linkForServing,
      HeadlessCloudAgentRequests,
      HeadlessCloudHostRequests,
      createDeviceBindingBag,
      cloudCreatedUnboundError,
    } = await import('../cloudSession.js')
    const bag = createDeviceBindingBag('acct')
    expect(bag.status()).toBe('unbound')
    bag.onBound('dev')
    expect(bag.status()).toBe('bound')
    const agent = new HeadlessCloudAgentRequests()
    expect(agent.pendingCount).toBe(0)
    expect(agent.askLimiter.inflight.size).toBe(0)
    agent.cancel('x')
    expect(agent.retiredIds.has('x')).toBe(true)
    const host = new HeadlessCloudHostRequests()
    expect(
      host.handleControlRequest({ subtype: 'initialize' }, { strict: true }),
    ).toBe('local')
    expect(
      host.handleControlRequest({ subtype: 'claim_session' }, { strict: true }),
    ).toBe('rejected')
    expect(cloudCreatedUnboundError('cse_1', 'egress', true)).toContain(
      'could not be bound to it: egress',
    )
    expect(cloudCreatedUnboundError('cse_1', 'egress', true)).toContain(
      'listed under Archived',
    )
    expect(bag.snapshot()).toEqual({ status: 'bound', deviceId: 'dev' })
    bag.onUnbound('egress')
    expect(bag.snapshot()).toEqual({ status: 'unbound', reason: 'egress' })
    const linked = await linkForServing({
      sessionId: 'not-a-session',
      serveOnly: false,
    })
    expect(linked.ok).toBe(true)
    const {
      classifyHeadlessCloudArgvPolicy,
      HEADLESS_CLOUD_ARGV_POLICY_CODES,
    } = await import('../cloudSession.js')
    expect(HEADLESS_CLOUD_ARGV_POLICY_CODES.bypass).toBe('rejected_argv')
    expect(classifyHeadlessCloudArgvPolicy()).toBeUndefined()
    expect(classifyHeadlessCloudArgvPolicy('sdk_mcp')?.code).toBe(
      'rejected_argv',
    )
  })

  test('ct/Ce/SXn/bXn wrap: queue cap, homeSeed, strip keys', async () => {
    const {
      HeadlessCloudOutbound,
      HeadlessCloudFeatureHandles,
      HEADLESS_CLOUD_QUEUE_CAP,
      stripCloudSessionKey,
      stripEdeDiagnosticErrors,
      cloudSessionContextExtras,
    } = await import('../cloudSession.js')
    expect(HEADLESS_CLOUD_QUEUE_CAP).toBe(100)
    const out = new HeadlessCloudOutbound(2)
    expect(out.submit({ kind: 'message', uuid: 'a' })).toBe('new')
    expect(out.submit({ kind: 'message', uuid: 'a' })).toBe('redelivered')
    expect(out.ledger.wasTaken('a')).toBe(true)
    expect(out.submit({ kind: 'control' })).toBe('new')
    expect(out.submit({ kind: 'message', uuid: 'b' })).toBe('refused')
    expect(out.queuedCount).toBe(2)
    expect(out.close('session_ended')).toBe(2)
    expect(out.queuedCount).toBe(0)
    const packs = new HeadlessCloudFeatureHandles()
    packs.adopt([{ feature: 'memory', homeSeed: { id: 'hs' } }])
    expect(packs.homeSeed()).toEqual({ id: 'hs' })
    expect(packs.handles()).toHaveLength(1)
    await packs.dispose()
    expect(packs.handles()).toHaveLength(0)
    expect(
      stripCloudSessionKey({ type: 'result', cloud_session: { id: 'x' } }),
    ).toEqual({ type: 'result' })
    expect(stripCloudSessionKey({ type: 'assistant' })).toEqual({
      type: 'assistant',
    })
    expect(
      stripEdeDiagnosticErrors({
        type: 'result',
        errors: ['[ede_diagnostic] n', 'real'],
      }),
    ).toEqual({ type: 'result', errors: ['real'] })
    expect(
      stripEdeDiagnosticErrors({ type: 'assistant', errors: ['x'] }),
    ).toEqual({ type: 'assistant', errors: ['x'] })
    expect(
      cloudSessionContextExtras({
        customSystemPrompt: 'sys',
        maxBudgetUsd: 2,
        allowedTools: ['Bash'],
        disallowedTools: [],
      }),
    ).toEqual({
      custom_system_prompt: 'sys',
      max_budget_usd: 2,
      allowed_tools: ['Bash'],
    })
  })

  test('ct postsInFlight add/abandon; queuedCount includes forwardsWaiting', async () => {
    const { HeadlessCloudOutbound } = await import('../cloudSession.js')
    const out = new HeadlessCloudOutbound(8)
    expect(out.submit({ kind: 'message', uuid: 'a', content: 'hi' })).toBe(
      'new',
    )
    const item = out.shift()
    expect(item?.uuid).toBe('a')
    expect(out.postsInFlight.size).toBe(1)
    expect(out.postsInFlight.has(item!)).toBe(true)
    expect(out.ledger.phaseOf('a')).toBe('posting')
    expect(out.abandonPostsInFlight('disconnected')).toBe(1)
    expect(out.postsInFlight.size).toBe(0)
    expect(out.renewalParked.size).toBe(0)
    expect(out.ledger.phaseOf('a')).toBe('failed')

    const ok = new HeadlessCloudOutbound(8)
    expect(ok.submit({ kind: 'message', uuid: 'ok' })).toBe('new')
    const sent = ok.shift()!
    expect(ok.confirmPosted(sent)).toBe(true)
    expect(ok.postsInFlight.size).toBe(0)
    expect(ok.ledger.phaseOf('ok')).toBe('delivered')
    expect(ok.confirmPosted(sent)).toBe(false)

    const waiting = new AbortController()
    out.forwardsWaiting.set(waiting, {
      kind: 'control',
      request: { subtype: 'initialize' },
    })
    expect(out.submit({ kind: 'message', uuid: 'b' })).toBe('new')
    expect(out.queue.length).toBe(1)
    expect(out.forwardsWaiting.size).toBe(1)
    expect(out.queuedCount).toBe(2)
  })

  test('$e / on / rn wrap existing hosts', async () => {
    const {
      headlessCloudModelGate,
      parseHeadlessCloudPermissionMode,
      decideHeadlessCloudPermissionMode,
      promptDirSyncConsent,
      promptUnattendedServingConsent,
      CLOUD_SYNC_CONSENT_KIND,
      UNATTENDED_SERVING_CONSENT_KIND,
    } = await import('../cloudSession.js')
    expect(
      parseHeadlessCloudPermissionMode('bypassPermissions'),
    ).toBeUndefined()
    expect(parseHeadlessCloudPermissionMode('plan')).toBe('plan')
    expect(parseHeadlessCloudPermissionMode(undefined)).toBeUndefined()
    expect(
      decideHeadlessCloudPermissionMode({
        explicitMode: 'plan',
        settingsModeForwardable: true,
        settingsMode: 'auto',
      }),
    ).toEqual({ permissionMode: 'plan', action: 'none' })
    const gated = headlessCloudModelGate(
      { permissionModeCli: 'plan', effectiveModel: 'opus' },
      {
        settingsToCloudEnabled: false,
        settings: {},
        hostFillsDefault: true,
      },
    )
    expect(gated.decision.action).toBe('none')
    expect(gated.explicitMode).toBe('plan')
    expect(gated.model).toBe('opus')
    expect(await promptDirSyncConsent({})).toEqual([])
    expect(
      await promptDirSyncConsent({
        dialogs: {
          kinds: new Set(),
          request: async () => ({ answer: 'sync', answered: true }),
        },
        seams: { flagOn: async () => true },
      }),
    ).toEqual([])
    expect(CLOUD_SYNC_CONSENT_KIND).toBe('cloud_sync_consent')
    expect(UNATTENDED_SERVING_CONSENT_KIND).toBe('unattended_serving_consent')
    await promptUnattendedServingConsent({ permissionMode: 'auto' })
  })

  test('xJ branch_mode / qt payload / $eo fate', async () => {
    const {
      cloudBranchMode,
      headlessCloudTeleportPayload,
      initializeFieldFate,
    } = await import('../cloudSession.js')
    expect(cloudBranchMode('main', undefined)).toBe('on_branch')
    expect(cloudBranchMode(undefined, 'abc')).toBe('ref')
    expect(cloudBranchMode(undefined, undefined)).toBe('default')
    const payload = headlessCloudTeleportPayload({})
    expect(payload.branchFromHead).toBe(true)
    expect(payload.allowBundle).toBe(true)
    expect(payload.staysAttached).toBe(true)
    expect(payload.seedDirSync).toBe(true)
    expect(payload.initialMessage).toBe(null)
    const pinned = headlessCloudTeleportPayload({ poolOnBranch: 'feat' })
    expect(pinned.branchFromHead).toBe(false)
    expect(pinned.explicitRef).toBe('feat')
    expect(initializeFieldFate('systemPrompt')).toBe('lost')
    expect(initializeFieldFate('title')).toBe('preference')
    expect(initializeFieldFate('excludeDynamicSections')).toBe('preference')
    expect(initializeFieldFate('unknownField')).toBe('lost')
  })

  test('Jqr overlay + Hl join + h_n open_threw', async () => {
    const {
      overlayInitializeOnForwarded,
      joinCloudSystemPrompt,
      withHeadlessCloudAuth,
    } = await import('../cloudSession.js')
    expect(joinCloudSystemPrompt(['a', '', '\n', 'b'])).toBe('a\n\nb')
    expect(joinCloudSystemPrompt(['', '\n'])).toBeUndefined()
    const over = overlayInitializeOnForwarded(
      { customSystemPrompt: 'old', appendSystemPrompt: 'ap' },
      { systemPrompt: ['new'], appendSystemPrompt: 'from-init' },
    )
    expect(over.customSystemPrompt).toBe('new')
    expect(over.appendSystemPrompt).toBe('from-init')
    const failed = await withHeadlessCloudAuth(async () => {
      throw new Error('')
    })
    expect(failed).toEqual({
      kind: 'failed',
      message: 'Error: Unable to open the cloud session',
    })
    const authFailed = await withHeadlessCloudAuth(async () => 'ok', {
      getCreds: async () => {
        throw new Error('')
      },
    })
    expect(authFailed).toEqual({
      kind: 'failed',
      message: 'Error: Failed to authenticate',
    })
  })

  test('Uar: stored-only / env-only / match resolve; missing / mismatch stop before K', async () => {
    const { resolveBindAccount } = await import('../cloudSession.js')
    expect(resolveBindAccount({ storedAccountUuid: 'aaa' })).toEqual({
      status: 'resolved',
      accountUuid: 'aaa',
      source: 'stored',
    })
    expect(resolveBindAccount({ hostAccountUuid: 'bbb' })).toEqual({
      status: 'resolved',
      accountUuid: 'bbb',
      source: 'env',
    })
    expect(
      resolveBindAccount({
        storedAccountUuid: 'AaA',
        hostAccountUuid: 'aaa',
      }),
    ).toEqual({
      status: 'resolved',
      accountUuid: 'AaA',
      source: 'env',
    })
    expect(resolveBindAccount({})).toEqual({ status: 'missing' })
    expect(
      resolveBindAccount({
        storedAccountUuid: 'aaa',
        hostAccountUuid: 'bbb',
      }),
    ).toEqual({ status: 'mismatch' })
  })

  test('D / Ikn: claim_session reject; hooks+strict reject; initialize local', async () => {
    const {
      routeCloudHostedControlRequest,
      classifyCloudInitializeOptions,
      CLOUD_HOSTED_LOCAL_PATH,
      CLOUD_HOSTED_LOST_OPTIONS,
    } = await import('../cloudSession.js')
    const claim = routeCloudHostedControlRequest(
      { subtype: 'claim_session' },
      { strict: true },
    )
    expect(claim).toEqual({
      kind: 'reject',
      error: `claim_session ${CLOUD_HOSTED_LOCAL_PATH}`,
    })
    const init = routeCloudHostedControlRequest(
      { subtype: 'initialize' },
      { strict: true },
    )
    expect(init).toEqual({ kind: 'local', handler: 'initialize' })
    const hooks = classifyCloudInitializeOptions(
      { hooks: { PreToolUse: [{}] } },
      'strict',
    )
    expect(hooks.outcome).toBe('reject')
    if (hooks.outcome === 'reject') {
      expect(hooks.error).toBe(CLOUD_HOSTED_LOST_OPTIONS(['hooks']))
    }
    const lenient = classifyCloudInitializeOptions(
      { hooks: { PreToolUse: [{}] } },
      'lenient',
    )
    expect(lenient.outcome).toBe('accept')
    if (lenient.outcome === 'accept') {
      expect(lenient.ignored).toContain('hooks')
    }
  })

  test('g_n / GQe / Mt / kXn / qt-bare wrap', async () => {
    const {
      openingPermissionModeRequests,
      HEADLESS_CLOUD_PERMISSION_MODE_CLI_DEFAULT,
      replayCloudUserMessage,
      serveOnlySeparateCopy,
      dirSyncNotArmedHere,
      separateCopyCutoffAllows,
      resolveAttachDeviceBinding,
      sessionBindingSnapshot,
      headlessCloudBareTeleportPayload,
      cloudBarePromptPresent,
      formatCloudSessionId,
      isCloudEgressAllowed,
    } = await import('../cloudSession.js')
    expect(HEADLESS_CLOUD_PERMISSION_MODE_CLI_DEFAULT).toBe('manual')
    expect(
      openingPermissionModeRequests(undefined, { serveOnly: false }),
    ).toEqual([])
    expect(openingPermissionModeRequests('plan', { serveOnly: true })).toEqual(
      [],
    )
    expect(
      openingPermissionModeRequests('default', { serveOnly: false }),
    ).toEqual([])
    expect(
      openingPermissionModeRequests('manual', { serveOnly: false }),
    ).toEqual([
      {
        request: { subtype: 'set_permission_mode', mode: 'default' },
        required: false,
        describe: '--permission-mode default',
      },
    ])
    const plan = openingPermissionModeRequests('plan', { serveOnly: false })
    expect(plan[0]?.required).toBe(true)
    const replay = replayCloudUserMessage('cse_1', 'u1', 'hi')
    expect(replay.isReplay).toBe(true)
    expect(replay.message).toEqual({ role: 'user', content: 'hi' })
    expect(dirSyncNotArmedHere({}).noRecordOnThisMachine).toBe(true)
    expect(dirSyncNotArmedHere({ ownRecord: true }).noRecordOnThisMachine).toBe(
      undefined,
    )
    expect(
      separateCopyCutoffAllows('2020-01-01T00:00:00.000Z', { kind: 'never' }),
    ).toBe(true)
    expect(
      separateCopyCutoffAllows('2020-01-01T00:00:00.000Z', { kind: 'unknown' }),
    ).toBe(false)
    expect(
      serveOnlySeparateCopy({
        serveOnly: true,
        lookup: dirSyncNotArmedHere({}),
        sessionBefore: { createdAt: '2020-01-01T00:00:00.000Z' },
        sweep: { kind: 'never' },
      }),
    ).toBe('separate_copy')
    expect(
      serveOnlySeparateCopy({
        serveOnly: false,
        lookup: dirSyncNotArmedHere({}),
        sessionBefore: { createdAt: '2020-01-01T00:00:00.000Z' },
        sweep: { kind: 'never' },
      }),
    ).toBeUndefined()
    expect(
      sessionBindingSnapshot({
        session_status: 'archived',
        bound_device_uuid: 'dev',
      }),
    ).toEqual({ archived: true, boundDeviceId: 'dev' })
    expect(
      await resolveAttachDeviceBinding({
        sessionId: 'cse_1',
        session: Promise.resolve({ archived: false }),
        isEnabled: async () => false,
      }),
    ).toEqual({ status: 'disabled' })
    expect(
      await resolveAttachDeviceBinding({
        sessionId: 'cse_1',
        session: Promise.resolve({ archived: false }),
        isEnabled: async () => true,
      }),
    ).toEqual({ status: 'not_applicable' })
    expect(
      await resolveAttachDeviceBinding({
        sessionId: 'cse_1',
        session: Promise.resolve({ archived: false, boundDeviceId: 'DEV' }),
        isEnabled: async () => true,
        isEgressAllowed: () => true,
        getAccount: async () => ({
          status: 'resolved',
          accountUuid: 'acct',
          source: 'stored',
        }),
        readLocalDeviceId: async () => 'dev',
      }),
    ).toEqual({ status: 'bound', deviceId: 'dev' })
    expect(
      await resolveAttachDeviceBinding({
        sessionId: 'cse_1',
        session: Promise.resolve({ archived: false, boundDeviceId: 'DEV' }),
        isEnabled: async () => true,
        isEgressAllowed: () => true,
        getAccount: async () => ({
          status: 'resolved',
          accountUuid: 'acct',
          source: 'stored',
        }),
        readLocalDeviceId: async () => 'other',
      }),
    ).toEqual({ status: 'unbound', reason: 'other_device' })
    const bare = headlessCloudBareTeleportPayload({
      prompt: 'hi',
      promptUuid: 'p1',
    })
    expect(bare.staysAttached).toBe(false)
    expect(bare.initialMessage).toBe('hi')
    expect(bare.branchFromHead).toBe(true)
    expect(cloudBarePromptPresent('  ')).toBe(false)
    expect(cloudBarePromptPresent('x')).toBe(true)
    expect(cloudBarePromptPresent([{ type: 'text', text: '  ' }])).toBe(false)
    expect(cloudBarePromptPresent([{ type: 'image' }])).toBe(true)
    expect(formatCloudSessionId('cse_abc')).toBe('session_abc')
    expect(typeof isCloudEgressAllowed()).toBe('boolean')
  })

  test('Vo/oi/Ko/vjt/rXe/dt wrap', async () => {
    const {
      cloudPlatformLabel,
      cloudDeviceDisplayName,
      startLaptopDeviceBridge,
      attachDirSyncLookup,
      classifyCloudTurnEvents,
      cloudSessionEnvelope,
      startRepositoryTrustPoll,
      mergeOpenedCloudSessionNotices,
      HEADLESS_CLOUD_STREAM_POSITION_RETRY_MS,
      registerAttachDevice,
    } = await import('../cloudSession.js')
    expect(cloudPlatformLabel('darwin')).toBe('macOS')
    expect(cloudPlatformLabel('win32')).toBe('Windows')
    expect(cloudDeviceDisplayName('box', 'darwin')).toBe(
      'Claude Code on box · macOS',
    )
    const bridge = await startLaptopDeviceBridge({ sessionId: 'cse_1' })
    expect(bridge.started).toBe(false)
    expect(bridge.fileMode).toBe('unspecified')
    expect(
      await attachDirSyncLookup({
        sessionId: 'cse_1',
        boundToThisMachine: false,
        woodOn: false,
      }),
    ).toEqual({ handle: undefined, why: 'not_looked' })
    expect(
      await attachDirSyncLookup({
        sessionId: 'cse_1',
        boundToThisMachine: false,
        sessionHost: {},
        woodOn: true,
      }),
    ).toEqual({ handle: undefined, why: 'lookup_failed' })
    expect(
      classifyCloudTurnEvents([
        { source: 'worker', payload: { type: 'assistant' } },
      ]),
    ).toBe('under_way')
    expect(
      classifyCloudTurnEvents([
        { source: 'worker', payload: { type: 'result' } },
      ]),
    ).toBe('over')
    expect(
      classifyCloudTurnEvents([
        {
          source: 'worker',
          payload: { type: 'assistant', parent_tool_use_id: 'x' },
        },
        { payload: { type: 'user' } },
      ]),
    ).toBe('under_way')
    expect(HEADLESS_CLOUD_STREAM_POSITION_RETRY_MS).toBe(500)
    const env = cloudSessionEnvelope({
      sessionId: 'cse_abc',
      viewUrl: 'https://x',
      device: { status: 'unbound' },
      directorySync: { state: 'off' },
    })
    expect(env).toEqual({
      id: 'session_abc',
      view_url: 'https://x',
      device: { status: 'unbound' },
      directory_sync: { state: 'off' },
      client_version: 1,
    })
    expect(
      startRepositoryTrustPoll({ sessionId: 'cse_1', enabled: false }),
    ).toBeUndefined()
    const merged = mergeOpenedCloudSessionNotices(
      { kind: 'opened', sessionId: 'cse_1', notices: [] },
      {
        notices: [{ level: 'notice', text: 'n' }],
        entries: [{ kind: 'preference', name: 'x' }],
      },
    )
    expect(merged.notices).toEqual([{ level: 'notice', text: 'n' }])
    const reg = registerAttachDevice({
      sessionId: 'cse_1',
      binding: Promise.resolve({ status: 'disabled' }),
    })
    await reg.stop()
  })

  test('mn/xgt/g7r/_jt/Mqr/Fnn/dt seed wrap', async () => {
    const {
      dirSyncConsentCopy,
      isDirSyncConsentFolder,
      deviceMcpConsentSnapshot,
      askHostDeviceMcpConsent,
      startAttachSync,
      boundCreateSessionBody,
      BOUND_CREATE_MAX_EVENTS,
      redactBindAttestation,
      postBoundCreateSession,
      repositoryTrustFromTags,
      coalescedSessionPoll,
      remoteFileMode,
      startLaptopRegistration,
      HeadlessCloudSendLedger,
    } = await import('../cloudSession.js')
    expect(isDirSyncConsentFolder('')).toBe(false)
    expect(isDirSyncConsentFolder('/tmp/proj')).toBe(true)
    expect(dirSyncConsentCopy({ folder: '' })).toBeNull()
    expect(dirSyncConsentCopy({ folder: '/tmp/proj' })?.title).toBe(
      'Sync this project directory to the cloud?',
    )
    expect(
      dirSyncConsentCopy({ folder: '/tmp/proj', copy: 'attach' })?.title,
    ).toBe('Keep this folder in sync with the cloud session?')
    expect(
      deviceMcpConsentSnapshot({
        machineName: 'box',
        offered: [['mcp', { scope: 'user', type: 'stdio' }]],
      }),
    ).toEqual({
      v: 1,
      machine_name: 'box',
      reconsent: false,
      servers: [
        {
          name: 'mcp',
          scope: 'user',
          transport: 'stdio',
          tool_count: 0,
          tool_names: [],
          tool_names_truncated: false,
        },
      ],
    })
    expect(
      deviceMcpConsentSnapshot({ machineName: 'box', offered: [] }),
    ).toBeNull()
    expect(await askHostDeviceMcpConsent({})).toBe('settled')
    expect(
      startAttachSync({
        sessionId: 'cse_1',
        boundToThisMachine: false,
        seams: { flagOn: () => false },
      }),
    ).toBeUndefined()
    expect(BOUND_CREATE_MAX_EVENTS).toBe(16)
    expect(
      boundCreateSessionBody({
        deviceBinding: {
          deviceUUID: 'd',
          kid: 'creg_d',
          signature: 'sig',
          issuedAt: 't',
        },
        events: [
          { data: { type: 'user' } },
          {
            data: {
              type: 'control_request',
              request: { subtype: 'initialize' },
            },
          },
        ],
        environmentVariables: { A: '1' },
      }),
    ).toEqual({
      events: [{ payload: { type: 'user' } }],
      target_device_id: 'd',
      bind_attestation: { kid: 'creg_d', signature: 'sig' },
      bind_attestation_issued_at: 't',
    })
    expect(
      redactBindAttestation({
        bind_attestation: { kid: 'k', signature: 'secret' },
      }),
    ).toEqual({ bind_attestation: { kid: 'k', signature: '<redacted>' } })
    const unsigned = await postBoundCreateSession({
      prepared: { ok: false },
      buildBody: a => ({ a }),
      post: async body => body,
    })
    expect(unsigned.attested).toBe(false)
    expect(unsigned.response).toEqual({ a: undefined })
    expect(repositoryTrustFromTags(['config:repo-trusted'])).toBe('trusted')
    expect(repositoryTrustFromTags(['config:no-git-repo'])).toBe(
      'no_repository',
    )
    expect(repositoryTrustFromTags(['config:repo-trust-declined'])).toBe(
      'declined',
    )
    expect(repositoryTrustFromTags([])).toBe('not_marked')
    let reads = 0
    const poll = coalescedSessionPoll({
      read: async () => {
        reads += 1
        return reads
      },
      now: () => 0,
    })
    expect(await poll.refresh()).toBe(1)
    expect(await poll.refresh()).toBe(1)
    expect(reads).toBe(1)
    expect(await remoteFileMode()).toBe('unspecified')
    const xgt = startLaptopRegistration({
      sessionId: 'cse_1',
      isEnabled: async () => false,
    })
    expect(await xgt.started).toBe(false)
    const ledger = new HeadlessCloudSendLedger(8, true)
    ledger.seed('u1', 'hello')
    expect(ledger.wasTaken('u1')).toBe(true)
    expect(ledger.phaseOf('u1')).toBe('seeded')
    expect(ledger.streamEcho('u1', 'hello').verdict).toBe('claim')
    ledger.seed('u3', 'hello', 'hello')
    expect(ledger.streamEcho('u3', 'hello').verdict).toBe('consume')
    ledger.accept('u2', 'message', 'x')
    ledger.postStart('u2')
    expect(ledger.postFail('u2').error).toBe(true)
    expect(ledger.giveUp('missing').echo).toBe(false)
  })

  test('_n/yn/He/JGt/hPe wrap', async () => {
    const {
      dirSyncState,
      directorySyncEnvelope,
      DIR_SYNC_NOT_SEEDED,
      waitDirSyncSeedAtExit,
      notePendingDirSyncSeed,
      takePendingDirSyncSeed,
      DIR_SYNC_CUT_SHORT,
      DIR_SYNC_CUT_BEFORE_ARMED,
      attachLaptopDirSyncSession,
      attachDirSyncLookup,
      DIR_SYNC_ENGINE_DECLINED_LINE,
      DIR_SYNC_CREATED_EMPTY_UNFILLED_LINE,
      DIR_SYNC_ENGINE_UNSUPPORTED_LINE,
      CCR_DIR_SYNC_PULL_ATTACH_ENGINE_DECLINED,
      fetchLatestCloudEvents,
      createServingReadiness,
      postCreateDropRepositoriesTrusted,
      LATEST_EVENTS_PAGE,
    } = await import('../cloudSession.js')
    expect(dirSyncState({ fileMode: 'unspecified' })).toEqual({
      state: 'off',
      reason: 'not_opted_in',
    })
    expect(dirSyncState({ fileMode: 'container_sync' })).toEqual({
      state: 'off',
      reason: 'not_seeded',
      message: DIR_SYNC_NOT_SEEDED,
    })
    expect(
      directorySyncEnvelope({ fileMode: 'unspecified' }).file_mode_source,
    ).toBe('stored')
    expect(
      directorySyncEnvelope({
        fileMode: 'unspecified',
        dirSync: {
          sync: { state: () => ({ state: 'armed', firstUpload: 'pending' }) },
          createFacts: { origin: 'upload' },
        },
      }),
    ).toMatchObject({
      state: 'armed',
      first_upload: 'pending',
      started_from_upload: true,
      file_mode_source: 'stored',
    })
    expect(await waitDirSyncSeedAtExit('none', new AbortController())).toBe(
      undefined,
    )
    notePendingDirSyncSeed('cse_cut', {
      state: () => 'cut',
      completion: Promise.resolve(),
    })
    expect(
      (await waitDirSyncSeedAtExit('cse_cut', new AbortController()))?.text,
    ).toBe(DIR_SYNC_CUT_SHORT)
    expect(takePendingDirSyncSeed('cse_cut')).toBeNull()
    notePendingDirSyncSeed('cse_arm', {
      state: () => 'arming',
      completion: Promise.resolve(),
    })
    expect(
      (await waitDirSyncSeedAtExit('cse_arm', new AbortController()))?.text,
    ).toBe(DIR_SYNC_CUT_BEFORE_ARMED)
    expect(
      await attachLaptopDirSyncSession({
        sessionId: 'cse_1',
        boundToThisMachine: false,
        woodOn: false,
      }),
    ).toBeUndefined()
    expect(
      await attachLaptopDirSyncSession({
        sessionId: 'cse_1',
        boundToThisMachine: false,
        woodOn: true,
        cwd: '/tmp/not-a-git-root-attach-dir-sync',
      }),
    ).toBeUndefined()
    expect(
      await attachLaptopDirSyncSession({
        sessionId: 'cse_1',
        boundToThisMachine: false,
        woodOn: true,
        cwd: process.cwd(),
        fileMode: 'unspecified',
      }),
    ).toBeUndefined()
    const declined = await attachLaptopDirSyncSession({
      sessionId: 'cse_1',
      boundToThisMachine: true,
      woodOn: true,
      cwd: process.cwd(),
      fileMode: 'container_sync',
    })
    expect(declined?.engine).toEqual({
      kind: 'stopped',
      reason: 'engine_declined',
      line: DIR_SYNC_ENGINE_DECLINED_LINE,
      level: 'info',
    })
    expect(declined?.createFacts).toBeUndefined()
    expect(await declined!.boundToThisMachine).toBe(false)
    expect(CCR_DIR_SYNC_PULL_ATTACH_ENGINE_DECLINED).toBe(
      'attach_engine_declined',
    )
    expect(DIR_SYNC_CREATED_EMPTY_UNFILLED_LINE).toContain(
      'created empty and never received',
    )
    expect(DIR_SYNC_ENGINE_UNSUPPORTED_LINE).toContain(
      'sync engine this version of Claude Code does not have',
    )
    expect(
      await attachDirSyncLookup({
        sessionId: 'cse_1',
        boundToThisMachine: false,
        sessionHost: {},
        woodOn: true,
      }),
    ).toEqual({ handle: undefined, why: 'lookup_failed' })
    expect(LATEST_EVENTS_PAGE).toBe(5)
    const ready = createServingReadiness()
    let opened = false
    const waiter = ready.whenReady().then(() => {
      opened = true
    })
    expect(opened).toBe(false)
    ready.ready()
    await waiter
    expect(opened).toBe(true)
    const posts: boolean[] = []
    const retried = await postCreateDropRepositoriesTrusted(
      async trusted => {
        posts.push(trusted)
        return {
          status: trusted ? 400 : 201,
          data: { error: { reason: 'invalid' } },
        }
      },
      undefined,
      { kind: 'send' },
      {},
    )
    expect(posts).toEqual([true, false])
    expect(retried.status).toBe(201)
    void fetchLatestCloudEvents
  })

  test('main.tsx print-mode gates EVo/vVo on cloudLaunch.headlessCloud', () => {
    const main = src('../../main.tsx')
    expect(main).toContain(
      'if (cloudLaunch.headlessCloud && process.stdin.isTTY)',
    )
    expect(main).toContain('HEADLESS_CLOUD_STDIN_TTY_ERROR')
    expect(main).toContain('if (cloudLaunch.headlessCloud)')
    expect(main).toContain('runHeadlessCloudCreate')
    expect(main).toContain('runHeadlessCloudAttach')
    expect(main).toContain('cloudLaunch.cloudAttachId === null')
    expect(main).toContain('serveOnly: cloudLaunch.serveOnly')
  })

  test('TTY refuse string is gold Lo', () => {
    expect(HEADLESS_CLOUD_STDIN_TTY_ERROR).toBe(
      'Error: headless --cloud reads the SDK host messages from stdin as stream-json; stdin is a terminal here.',
    )
  })

  test('Wo source-locks string inputPrompt → no_stream_input + Lo', () => {
    const body = src('../cloudSession.ts')
    expect(body).toContain("code: 'no_stream_input'")
    expect(body).toContain('message: HEADLESS_CLOUD_STDIN_TTY_ERROR')
    expect(body).toContain("typeof input === 'string'")
  })
})

describe('cloudHeadlessHost 283 headlessCloud gate', () => {
  const hostCtx = {
    hasSdkUrl: false,
    nonInteractive: true,
    hasConnect: false,
    hasSSH: false,
    inputFormat: 'stream-json' as const,
    outputFormat: 'stream-json' as const,
  }

  test('m8r is stream-json host without --print', () => {
    expect(
      isHeadlessCloudSdkHost({
        print: false,
        initOnly: false,
        nonInteractive: true,
        inputFormat: 'stream-json',
        outputFormat: 'stream-json',
        hasSdkUrl: false,
      }),
    ).toBe(true)
    expect(
      isHeadlessCloudSdkHost({
        print: true,
        initOnly: false,
        nonInteractive: true,
        inputFormat: 'stream-json',
        outputFormat: 'stream-json',
        hasSdkUrl: false,
      }),
    ).toBe(false)
  })

  test('os() headlessCloud is m8r ∧ violin-wood', async () => {
    const off = await parseCloudLaunch({ cloud: 'do the thing' }, hostCtx)
    expect(off.ok).toBe(false)

    const on = await parseCloudLaunch(
      { cloud: 'do the thing' },
      { ...hostCtx, isViolinWoodEnabled: async () => true },
    )
    expect(on.ok).toBe(true)
    if (!on.ok) return
    expect(on.value.headlessCloud).toBe(true)
    expect(on.value.cloudAttachId).toBeNull()
  })

  test('os() attach + violin-wood is headlessCloud attach', async () => {
    const r = await parseCloudLaunch(
      { cloud: 'session_abc' },
      { ...hostCtx, isViolinWoodEnabled: async () => true },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.headlessCloud).toBe(true)
    expect(r.value.cloudAttachId).toBe('session_abc')
  })
})

describe('cloudHeadlessHost 283 Dn / Qo / attachServeRequest', () => {
  afterEach(() => {
    resetSessionHostForTests()
  })

  test('Dn wires forwardHomeSettings/consent + tools + channel', () => {
    const host = {
      launchOptions: {
        mayForwardHomeSettings: () => true,
        homeSettingsHostConsent: () => null as 'forward' | null,
      },
      extensionsConfig: {
        allowedChannels: () => ['cli'],
      },
    }
    const features = headlessCloudFeatures(
      {
        inputPrompt: (async function* () {})(),
        tools: [{ name: 'Bash' }],
        forwardHomeSettings: true,
        homeSettingsConsent: 'forward',
      },
      host,
    )
    expect(features.map(f => f.kind)).toEqual([
      'forwardHomeSettings',
      'memory',
      'tools',
      'channel',
    ])
    expect(features[0]).toMatchObject({
      forwardHomeSettings: true,
      consentMode: 'forward',
    })
    expect(headlessCloudServeOnlyFeatures()).toEqual([
      { kind: 'channel', controlOnly: true },
    ])
  })

  test('Qo lists host options ignored on attach', () => {
    expect(
      headlessCloudIgnoredHostOptions(
        { appendSystemPrompt: 'x', allowedTools: ['Bash'] },
        { inputPrompt: '', sessionNameArg: 'n', effectiveModel: 'opus' },
        'opus',
      ),
    ).toEqual(['appendSystemPrompt', 'allowedTools', 'model', 'name'])
  })

  test('registeredBuiltInToolNames maps the launch pool', () => {
    expect(
      registeredBuiltInToolNames([{ name: 'Bash' }, { name: 'Read' }]),
    ).toEqual(['Bash', 'Read'])
  })

  test('notAppliedReport attach keeps create honours', () => {
    const r = notAppliedReport(
      [{ kind: 'preference', name: 'model' }],
      { systemPrompt: 'x', effort: 'high' },
      'attach',
      ['attachServeRequest'],
    )
    expect(r.notices.some(n => n.level === 'notice')).toBe(true)
    expect(
      r.entries.some(
        e => e.name === 'initialize.systemPrompt' && e.kind === 'kept',
      ),
    ).toBe(true)
  })

  test('vVo serve-only source-locks attachServeRequest honour', () => {
    const body = src('../cloudSession.ts')
    expect(body).toContain(
      "serveOnly && { attachHonours: ['attachServeRequest'] }",
    )
    expect(body).toContain('headlessCloudServeOnlyFeatures')
  })
})

describe('cloudHeadlessHost 283 Unn / d5o source-lock', () => {
  test('teleport env-select warns when default ccpool_ is missing from org list', () => {
    const teleport = src('../../utils/teleport.tsx')
    expect(teleport).toContain('fetchSelfHostedPools')
    expect(teleport).toContain(
      "is not in the org's environment list — sending it anyway; server validates at CreateSession",
    )
    expect(teleport).toContain('fetchSelfHostedPools rejected:')
    const env = src('../../utils/teleport/environments.ts')
    expect(env).toContain('/v1/code/runners/self-hosted/pools')
    expect(env).toContain('teleport_self_hosted_pool_list')
    expect(env).toContain("getAPIProvider() !== 'firstParty'")
  })

  test('d5o enrolls via trustedDeviceTokenForBind on existing host', () => {
    const td = src('../../bridge/trustedDevice.ts')
    expect(td).toContain('export async function trustedDeviceTokenForBind')
    expect(td).toContain("error: 'trusted_devices_off'")
    expect(td).toContain("error: 'enrollment_paused'")
    expect(td).toContain("error: 'not_given'")
    expect(td).toContain(
      'tengu_sessions_elevated_auth_disable_proactive_enrollment',
    )
    expect(td).toContain("trigger: 'device_bind'")
    expect(td).toContain('Not enrolled, enrolling for a device-bound session')
  })
})

describe('cloudHeadlessHost 283 Lt POST /device wrap', () => {
  test('without key: serveOnly wrap does not fake a signature POST', async () => {
    const { linkForServing } = await import('../cloudSession.js')
    let posted = 0
    await linkForServing({
      sessionId: 'cse_abc',
      serveOnly: true,
      post: async () => {
        posted += 1
        return { ok: true }
      },
    })
    expect(posted).toBe(0)
    expect(
      await linkForServing({ sessionId: 'cse_abc', serveOnly: false }),
    ).toEqual({ ok: true })
    const bad = await linkForServing({
      sessionId: 'not-a-session',
      serveOnly: true,
    })
    expect(bad.ok).toBe(false)
  })

  test('with key.sign: Far attestation then POST target_device_id + bind_attestation', async () => {
    const { linkForServing, postSessionDeviceBind } = await import(
      '../cloudSession.js'
    )
    const UUID = '11111111-1111-1111-1111-111111111111'
    const posts: Array<{
      sessionId: string
      attestation: {
        deviceUUID: string
        kid: string
        signature: string
        issuedAt: string
      }
    }> = []
    const linked = await linkForServing({
      sessionId: 'cse_abc',
      sessionUuid: UUID,
      serveOnly: true,
      orgUuid: UUID,
      accountUuid: UUID,
      deviceUUID: UUID,
      key: { sign: async payload => payload },
      post: async (sessionId, attestation) => {
        posts.push({ sessionId, attestation })
        expect(attestation.kid).toBe(`creg_${UUID}`)
        expect(attestation.deviceUUID).toBe(UUID)
        expect(attestation.signature.length).toBeGreaterThan(0)
        return { ok: true }
      },
    })
    expect(linked).toEqual({ ok: true, deviceId: UUID })
    expect(posts).toHaveLength(1)
    expect(posts[0]?.sessionId).toBe('cse_abc')
    expect(typeof postSessionDeviceBind).toBe('function')
  })
})
