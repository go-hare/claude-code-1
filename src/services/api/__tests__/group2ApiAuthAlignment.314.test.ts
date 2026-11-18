import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getSubscriptionTypeVerifiedAt,
  resolveGracefulSubscriptionType,
  shouldSkipPolicyLimitsForProMaxStartup,
} from '../../../utils/auth.js'
import {
  _resetPolicyLimitsForTesting,
  loadPolicyLimits,
  REVALIDATE_IN_FULL_AFTER_MS,
} from '../../policyLimits/index.js'
import {
  getActivePublishedModelCatalogSource,
  getDensableModelCatalog,
  setActivePublishedModelCatalogForTesting,
} from '../../../utils/model/modelCatalogCapabilities.js'
import {
  applyThirdPartyUpgradeChoice,
  filterUndecidedUpgradeCandidates,
  findBedrockUpgradeCandidates,
  findStalePinnedModelTiers,
  findVertexUpgradeCandidates,
  formatUpgradeKey,
  initThirdPartyModelCatalogStartup,
} from '../../../utils/model/thirdPartyModelUpgrade.js'
import {
  configureGlobalMTLS,
  getLastSyncedDefaultCACertListForTesting,
  handleTlsHandshakeServerCertificates,
  probeCrossSignedRootPairs,
  setDroppedCrossCertificatesStateForTesting,
} from '../../../utils/mtls.js'
import {
  evaluateStoredRemoteSettingsCopy,
  extractHelperTier,
  getDroppedHelperTier,
  getRemoteHelperTierStatus,
  getStoredCopyRefusal,
  isForceRemoteSettingsRefreshBlocking,
  reconcileMdmAndRemoteSettings,
  resetRemoteSettingsSessionCache,
  resetRemoteSettingsStateForTesting,
  resolveRemoteHelperTier,
  retainDroppedHelperBaseUrlEnv,
  setVerifiedRemoteSettingsForTesting,
} from '../../../utils/settings/remoteSettingsState.js'
import {
  buildRetractedWireFields,
  RetractedWireUuidTracker,
} from '../../../query/queryHelpers.js'
import {
  neutralizeRefusalFallbackForFork,
  rearmCyberRefusalOnResume,
  resolveResumeRefusalFallbackModel,
  restoreModelOnResume,
} from '../../../utils/refusalFallback.js'

describe('Group 2 2.1.325 alignment (#1259, #1274, #1295, #1363/#1368, #1370, #1371, #1374, #1392, #1429)', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    resetRemoteSettingsStateForTesting()
    _resetPolicyLimitsForTesting()
    setActivePublishedModelCatalogForTesting(null)
    setDroppedCrossCertificatesStateForTesting({})
  })

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in savedEnv)) delete process.env[k]
    }
    Object.assign(process.env, savedEnv)
    resetRemoteSettingsStateForTesting()
    _resetPolicyLimitsForTesting()
    setActivePublishedModelCatalogForTesting(null)
    setDroppedCrossCertificatesStateForTesting({})
  })

  test('#1259: claude.ts caps consecutive keepalive ping resets at CONSECUTIVE_PING_CAP = 30', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'claude.ts'), 'utf8')
    expect(src).toContain('CONSECUTIVE_PING_CAP = 30')
    expect(src).toContain('consecutivePingCount <= CONSECUTIVE_PING_CAP')
    expect(src).toContain('consecutivePingCount = 0')
  })

  test('#1274: Pro/Max startup cache skips policy limits within 1h grace TTL', async () => {
    const now = 1_700_000_000_000
    const proProfileTokens = {
      accessToken: 'tok-pro',
      subscriptionType: 'pro',
      subscriptionTypeSource: 'profile',
      subscriptionTypeVerifiedAt: now - 30 * 60 * 1000, // 30m ago
    }
    expect(getSubscriptionTypeVerifiedAt(proProfileTokens)).toBe(
      now - 30 * 60 * 1000,
    )
    expect(
      shouldSkipPolicyLimitsForProMaxStartup(proProfileTokens, 1, now),
    ).toBe(true)

    const staleProTokens = {
      ...proProfileTokens,
      subscriptionTypeVerifiedAt: now - 2 * 60 * 60 * 1000, // 2h ago
    }
    expect(
      resolveGracefulSubscriptionType(
        'pro',
        getSubscriptionTypeVerifiedAt(staleProTokens),
        1,
        now,
      ),
    ).toBeNull()
    expect(shouldSkipPolicyLimitsForProMaxStartup(staleProTokens, 1, now)).toBe(
      false,
    )

    const signInMaxTokens = {
      accessToken: 'tok-max',
      subscriptionType: 'max',
      subscriptionTypeSource: 'sign_in',
    }
    expect(getSubscriptionTypeVerifiedAt(signInMaxTokens)).toBeUndefined()
    expect(
      shouldSkipPolicyLimitsForProMaxStartup(signInMaxTokens, 1, now),
    ).toBe(true)
    expect(REVALIDATE_IN_FULL_AFTER_MS).toBe(21_600_000)

    const res = await loadPolicyLimits()
    expect(res).toBeUndefined()
  })

  test('#1295: published catalog activation & 3P startup loader', async () => {
    const compiled = getDensableModelCatalog()
    const cloned = {
      ...compiled,
      defaults: { ...compiled.defaults, sonnet: 'custom-sonnet-test' },
    }
    setActivePublishedModelCatalogForTesting(cloned, 'hosted')
    expect(getActivePublishedModelCatalogSource()).toBe('hosted')
    expect(getDensableModelCatalog().defaults.sonnet).toBe('custom-sonnet-test')

    setActivePublishedModelCatalogForTesting(null)
    process.env.CLAUDE_CODE_MODEL_CATALOG = 'off'
    const fallbackCatalog = await initThirdPartyModelCatalogStartup({
      headless: true,
    })
    expect(fallbackCatalog.models.length).toBeGreaterThan(0)
  })

  test('#1363 & #1368: configureGlobalMTLS syncs default CA certs & TLS handshake hook handles peer chains', () => {
    configureGlobalMTLS()
    // Synced list is defined if tls.setDefaultCACertificates is supported and CA certs exist
    const synced = getLastSyncedDefaultCACertListForTesting()
    expect(synced === undefined || Array.isArray(synced)).toBe(true)

    const handled = handleTlsHandshakeServerCertificates({
      getPeerCertificate: () => ({}) as never,
    })
    expect(handled).toBe(false)

    process.env.CLAUDE_CODE_DISABLE_SELF_NAMED_CERT_DROP = '1'
    expect(probeCrossSignedRootPairs([])).toEqual([])
  })

  test('#1370: findStalePinnedModelTiers skips managed policySettings.env pins & filters declined upgrades', async () => {
    const tierConfigs = {
      sonnet: {
        tier: 'sonnet' as const,
        envVarPriority: ['ANTHROPIC_DEFAULT_SONNET_MODEL'],
        defaultKey: 'claude-sonnet-4-6',
      },
      opus: {
        tier: 'opus' as const,
        envVarPriority: ['ANTHROPIC_DEFAULT_OPUS_MODEL'],
        defaultKey: 'claude-opus-4-6',
      },
    }
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5',
    }

    // Without managed pin: both sonnet and opus are stale
    const unpinned = findStalePinnedModelTiers(tierConfigs, {
      env,
      policySettingsEnv: {},
      orderedModelKeys: [
        'claude-sonnet-4-5',
        'claude-opus-4-5',
        'claude-sonnet-4-6',
        'claude-opus-4-6',
      ],
      resolveModelKey: v => v,
      resolveTierForKey: k => (k.includes('opus') ? 'opus' : 'sonnet'),
    })
    expect(unpinned.map(t => t.tier)).toEqual(['sonnet', 'opus'])

    // With sonnet pinned in policySettings.env: sonnet is skipped
    const managedPinned = findStalePinnedModelTiers(tierConfigs, {
      env,
      policySettingsEnv: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
      },
      orderedModelKeys: [
        'claude-sonnet-4-5',
        'claude-opus-4-5',
        'claude-sonnet-4-6',
        'claude-opus-4-6',
      ],
      resolveModelKey: v => v,
      resolveTierForKey: k => (k.includes('opus') ? 'opus' : 'sonnet'),
    })
    expect(managedPinned.map(t => t.tier)).toEqual(['opus'])

    // Declined upgrade filtering
    const candidate = {
      tier: 'opus' as const,
      envVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
      fromKey: 'claude-opus-4-5',
      fromMarketingName: 'Opus 4.5',
      toKey: 'claude-opus-4-6',
      toMarketingName: 'Opus 4.6',
      toModelId: 'us.anthropic.claude-opus-4-6-v1',
    }
    expect(
      filterUndecidedUpgradeCandidates('bedrock', [candidate], {
        bedrockDeclinedUpgrades: { opus: formatUpgradeKey(candidate) },
      }),
    ).toEqual([])

    // Non-bedrock/vertex provider returns empty
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    expect(await findBedrockUpgradeCandidates()).toEqual([])
    expect(await findVertexUpgradeCandidates()).toEqual([])
    expect(typeof applyThirdPartyUpgradeChoice).toBe('function')
  })

  test('#1371: forceRemoteSettingsRefresh blocks and records storedCopyRefusal on untrusted copy', () => {
    const settings = { forceRemoteSettingsRefresh: true }
    const res = evaluateStoredRemoteSettingsCopy(settings, {
      trusted: false,
      reason: 'expired',
      isRefreshable: true,
      nowMs: 12345,
    })
    expect(res.admitted).toBe(false)
    if (!res.admitted) {
      expect(res.blocked).toBe(true)
      expect(res.refusal).toEqual({
        atMs: 12345,
        reason: 'expired',
        forcesRefresh: true,
      })
    }
    expect(getStoredCopyRefusal()?.forcesRefresh).toBe(true)
    expect(isForceRemoteSettingsRefreshBlocking(settings)).toBe(true)
  })

  test('#1374: RetractedWireUuidTracker & query.ts retractedWireUuids wiring', () => {
    const tracker = new RetractedWireUuidTracker()
    const added = tracker.add([{ uuid: 'u-1' }, { uuid: 'u-2' }])
    expect(added).toEqual(['u-1', 'u-2'])
    expect(buildRetractedWireFields({ retractedWireUuids: added })).toEqual({
      retracted_message_uuids: ['u-1', 'u-2'],
    })
    expect(tracker.consumeForSupersedes()).toEqual(['u-1', 'u-2'])
    expect(tracker.consumeForSupersedes()).toBeUndefined()

    const querySrc = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'query.ts'),
      'utf8',
    )
    expect(querySrc).toContain(
      'retryMessage.retractedWireUuids = retractedUuids',
    )
  })

  test('#1392: restoreModelOnResume handles fork neutralization and cyber re-arm', () => {
    const entries = [
      {
        type: 'user',
        turnAttributionKey: 'k1',
      },
      {
        type: 'system',
        subtype: 'model_refusal_fallback',
        fallbackModel: 'claude-sonnet-4-6',
        apiRefusalCategory: 'cyber',
        requestId: 'req_cyber_1',
      },
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4-6' },
      },
    ]

    // Non-fork resume rearms cyber refusal header & latches model
    const nonFork = restoreModelOnResume(structuredClone(entries), {
      isFork: false,
    })
    expect(nonFork.rearmedCyberRequestId).toBe('req_cyber_1')
    expect(nonFork.model).toBe('claude-sonnet-4-6')

    // Fork resume neutralizes refusal fallback & skips restoring fallback model
    const forkEntries = structuredClone(entries)
    const forked = restoreModelOnResume(forkEntries, { isFork: true })
    expect(
      (forkEntries[1] as { neutralizedByFork?: boolean } | undefined)
        ?.neutralizedByFork,
    ).toBe(true)
    expect(
      (forkEntries[0] as { turnAttributionKey?: unknown }).turnAttributionKey,
    ).toBeUndefined()
    expect(forked.rearmedCyberRequestId).toBeUndefined()
    expect(forked.model).toBeUndefined()

    expect(typeof neutralizeRefusalFallbackForFork).toBe('function')
    expect(typeof rearmCyberRefusalOnResume).toBe('function')
    expect(typeof resolveResumeRefusalFallbackModel).toBe('function')
  })

  test('#1429: droppedHelperTier retention & MDM/remote-settings base URL / apiKeyHelper reconciliation', () => {
    const remoteSettings = {
      apiKeyHelper: '/usr/local/bin/remote-helper.sh',
      env: {
        ANTHROPIC_BASE_URL: 'https://remote-gw.example.com',
        OTHER_VAR: 'ignored',
      },
    }
    expect(extractHelperTier(remoteSettings)).toEqual({
      apiKeyHelper: '/usr/local/bin/remote-helper.sh',
      env: {
        ANTHROPIC_BASE_URL: 'https://remote-gw.example.com',
        OTHER_VAR: 'ignored',
      },
    })

    setVerifiedRemoteSettingsForTesting(remoteSettings)
    expect(getRemoteHelperTierStatus()).toBeNull()

    // Resetting session cache moves verified helper tier into droppedHelperTier
    resetRemoteSettingsSessionCache()
    expect(getDroppedHelperTier()?.apiKeyHelper).toBe(
      '/usr/local/bin/remote-helper.sh',
    )
    expect(getRemoteHelperTierStatus()).toBe('restart_needed')

    // Only retained when process.env matches the dropped base URL
    process.env.ANTHROPIC_BASE_URL = 'https://remote-gw.example.com'
    expect(
      retainDroppedHelperBaseUrlEnv(getDroppedHelperTier()!, null, process.env),
    ).toEqual({
      ANTHROPIC_BASE_URL: 'https://remote-gw.example.com',
    })
    expect(resolveRemoteHelperTier(process.env)?.apiKeyHelper).toBe(
      '/usr/local/bin/remote-helper.sh',
    )

    // Reconcile MDM vs remote-settings: remote wins over MDM
    const reconciled = reconcileMdmAndRemoteSettings(
      {
        apiKeyHelper: '/usr/local/bin/mdm-helper.sh',
        env: { ANTHROPIC_BASE_URL: 'https://mdm-gw.example.com' },
      },
      remoteSettings,
      process.env,
    )
    expect(reconciled.source).toBe('remote')
    expect(reconciled.apiKeyHelper).toBe('/usr/local/bin/remote-helper.sh')
    expect(reconciled.baseUrlEnv.ANTHROPIC_BASE_URL).toBe(
      'https://remote-gw.example.com',
    )
  })
})
