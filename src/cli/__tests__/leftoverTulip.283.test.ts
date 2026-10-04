/**
 * densable 2.1.283 leftover `_o` / TIe / RIe / $2e / nVt wrap.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  analyticsMock,
  pushAnalyticsLogEvent,
} from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

const debugLogs: Array<{ msg: string; level?: string }> = []
const events: Array<{ name: string; props: Record<string, unknown> }> = []

mock.module('../../utils/debug.js', () => ({
  ...debugMock(),
  logForDebugging: (msg: string, opts?: { level?: string }) => {
    debugLogs.push({ msg, level: opts?.level })
  },
}))
mock.module('../../utils/debug.ts', () => ({
  ...debugMock(),
  logForDebugging: (msg: string, opts?: { level?: string }) => {
    debugLogs.push({ msg, level: opts?.level })
  },
}))
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())

const {
  BRIDGE_ATTESTATION_MALFORMED_CONFIG_PREFIX,
  DEFAULT_TOOL_HOST_ATTESTATION_POLICY,
  DEVICE_ATTESTATION_STATUSES,
  SERVED_CALLS_UNATTESTED_COPY,
  SERVED_CALLS_UNATTESTED_NOTICE_KEY,
  TOOL_HOST_ATTESTATION_TULIP_THREW,
  assessToolHostAttestation,
  attestToolHostStatus,
  gradeToolHostAttestation,
  isToolHostAttestationHeldBack,
  leftoverHookAttestationBag,
  leftoverPolicyLimitsHost,
  dropLeftoverPolicyHints,
  hintFromRefusedPolicyBody,
  isEnforceOrRequirePolicyKey,
  isKnownPolicyLimitsKey,
  isPolicyLimitsAllowed,
  leftoverAnonymousHipaaStampBody,
  leftoverBuildHipaaStamp,
  leftoverHashPrincipalDescriptor,
  leftoverHipaaEvidence,
  leftoverHipaaEvidenceBlocks,
  leftoverPersistHipaaStamp,
  leftoverPolicyLimitsPrincipal,
  leftoverRemoveHipaaStamp,
  isServerPopulatedPolicyKey,
  isTranscriptScanPolicyKey,
  lookupPolicyLimitsEntry,
  POLICY_LIMITS_CATALOG,
  policyDeniedByTaints,
  policyDeniedUnderPairs,
  policyHardBlockUnderPairs,
  policyLimitsFeatureCopy,
  evaluatePolicyLimitsAgainst,
  isPolicyEnforcedOrHintedByRefusedCache,
  REQUIRE_TRUSTED_DEVICES,
  meetsAttestationLevel,
  normalizeDeviceAttestationStatus,
  notifyServedCallsUnattested,
  parseBridgeAttestationEnforceConfig,
  readToolHostAttestationPolicy,
  unspecifiedToolHostAttestationBag,
} = await import('../leftoverTulip.js')

const src = readFileSync(join(import.meta.dir, '../leftoverTulip.ts'), 'utf8')

let restoreAnalytics: (() => void) | undefined
beforeEach(() => {
  restoreAnalytics = pushAnalyticsLogEvent((name, props) => {
    events.push({ name, props: props ?? {} })
  })
})
afterEach(() => {
  restoreAnalytics?.()
  restoreAnalytics = undefined
  debugLogs.length = 0
  events.length = 0
  leftoverPolicyLimitsHost().hipaaEvidence = {
    seen: [],
    incomplete: false,
    ruledOut: [],
  }
  leftoverPolicyLimitsHost().hipaaEvidenceLoaded = false
  leftoverPolicyLimitsHost().hipaaSeenUnreadable = false
  leftoverPolicyLimitsHost().tunnelSocket = undefined
  leftoverPolicyLimitsHost().oauthPrincipalMemo = null
  leftoverPolicyLimitsHost().wifAccountDiverged = false
  leftoverPolicyLimitsHost().principalFromOAuthBearer = false
})

describe('leftoverTulip 283 leftover _o BODY', () => {
  test('source-locks leftover _o / TIe / RIe / $2e / nVt; no minify public API', () => {
    expect(src).toContain('leftover `_o` @202276282')
    expect(src).toContain('leftover `TIe` @202144104')
    expect(src).toContain('leftover `RIe` @202144178')
    expect(src).toContain('leftover `$2e` @202144248')
    expect(src).toContain('leftover `nVt` @202144326')
    expect(src).toContain('leftover `jtr` @202143707')
    expect(src).toContain('leftover `s` @202143914')
    expect(src).toContain('leftover `fLt` @179091527')
    expect(src).toContain('leftover `h()` @179070612')
    expect(src).toContain('leftover `hintFromRefusedBody` @179069478')
    expect(src).toContain('leftover `se` @179089013')
    expect(src).toContain('leftover `KDr` @179086848')
    expect(src).toContain('leftover `VDr` @176860862')
    expect(src).toContain('leftover `qDr` @176865010')
    expect(src).toContain('leftover `ldt` @176865054')
    expect(src).toContain('POLICY_LIMITS_CATALOG')
    expect(src).toContain('isKnownPolicyLimitsKey')
    expect(src).toContain('lookupPolicyLimitsEntry')
    expect(src).not.toMatch(/^export function ldt\b/m)
    expect(src).not.toMatch(/^export function qDr\b/m)
    expect(src).toContain('leftover `Jt` @176866119')
    expect(src).toContain('leftover `pLt` @176866957')
    expect(src).toContain('isPolicyLimitsAllowed')
    expect(src).toContain('evaluatePolicyLimitsAgainst')
    expect(src).not.toMatch(/^export function Jt\b/m)
    expect(src).not.toMatch(/^export function pLt\b/m)
    expect(src).toContain('leftover `oe` @176865717')
    expect(src).toContain('leftover `Ye` @176859571')
    expect(src).toContain('leftover `Zn` @176866051')
    expect(src).toContain('leftover `KIo` @176858800')
    expect(src).toContain('token:unreadable')
    expect(src).toContain('unclassified: true')
    expect(src).toContain('leftover `WDr` @176858651')
    expect(src).toContain('leftover `UX` @176853519')
    expect(src).toContain('leftover `UX` @179074995')
    expect(src).toContain('leftoverHipaaEvidenceBlocks')
    expect(src).toContain('leftover `zle` @179051657')
    expect(src).toContain('leftoverHashPrincipalDescriptor')
    expect(src).toContain('policy-limits.json.stamp.json')
    expect(src).toContain('leftover `L` @179052200')
    expect(src).toContain('leftover `je` @179080371')
    expect(src).toContain('leftover `T` @179080209')
    expect(src).toContain('tengu_hashed_lark')
    expect(src).toContain('tengu_validated_clover')
    expect(src).toContain('tengu_tranquil_crescent')
    expect(src).toContain('ANTHROPIC_UNIX_SOCKET')
    expect(src).not.toMatch(/^export function oe\b/m)
    expect(src).not.toMatch(/^export function WDr\b/m)
    expect(src).not.toMatch(/^export function UX\b/m)
    expect(src).not.toMatch(/^export function zle\b/m)
    expect(src).not.toMatch(/^export function je\b/m)
    expect(src).not.toMatch(/^export function L\b/m)
    expect(src).toContain('leftover `ODr` @179053488')
    expect(src).toContain('leftover `FGn` @179054102')
    expect(src).toContain('leftover `$Gn` @179054143')
    expect(src).toContain('leftover `GIo` @179054278')
    expect(src).toContain('leftover `jn` @179078543')
    expect(src).toContain('leftover `Ohe` @179051728')
    expect(src).toContain('leftover `UX` @179074995')
    expect(src).toContain('ssh-placeholder')
    expect(src).toContain('leftoverBuildHipaaStamp')
    expect(src).toContain('leftoverPersistHipaaStamp')
    expect(src).not.toMatch(/^export function ODr\b/m)
    expect(src).not.toMatch(/^export function FGn\b/m)
    expect(src).not.toMatch(/^export function jn\b/m)
    expect(src).not.toMatch(/^export function Ohe\b/m)
    expect(src).toContain('isEnforceOrRequirePolicyKey')
    expect(src).toContain('require_trusted_devices')
    expect(src).toContain('isPolicyEnforcedOrHintedByRefusedCache')
    expect(src).toContain('leftover `Yle` @180890124')
    expect(src).toContain('leftover `aMr` @180883700')
    expect(src).toContain('leftover `gzn` @180877408')
    expect(src).toContain('leftover `t0o` @180877728')
    expect(src).toContain('tengu_bridge_attestation_enforce')
    expect(src).toContain('tengu_sessions_elevated_auth_enforcement')
    expect(src).toContain('tengu_vast_tulip')
    expect(src).toContain('tengu_breezy_fairy')
    expect(src).not.toMatch(/^export function Yle\b/m)
    expect(src).not.toMatch(/^export function aMr\b/m)
    expect(src).not.toMatch(/^export function gzn\b/m)
    expect(src).toContain(TOOL_HOST_ATTESTATION_TULIP_THREW)
    expect(src).toContain('getFeatureValue_CACHED_MAY_BE_STALE')
    expect(src).toContain('served-calls-unattested')
    expect(src).toContain('repository_trust.served_calls.unattested')
    expect(src).toContain('leftoverHookAttestationBag')
    expect(src).toContain('attestToolHostStatus')
    expect(src).toContain('isToolHostAttestationHeldBack')
    expect(src).toContain('unspecifiedToolHostAttestationBag')
    expect(src).toContain('notifyServedCallsUnattested')
    expect(src).not.toMatch(/^export function _o\b/m)
    expect(src).not.toMatch(/^export function TIe\b/m)
    expect(src).not.toMatch(/^export function RIe\b/m)
    expect(src).not.toMatch(/^export function \$2e\b/m)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(code).not.toContain('tengu_violin_amati')
    expect(code).not.toContain('new WebSocket')
    expect(code).not.toContain('Far(')
    expect(code).not.toContain('settings.set')
  })

  test('uFe normalize + leftover s not_policed on default hzn', () => {
    expect(DEVICE_ATTESTATION_STATUSES).toHaveLength(11)
    expect(normalizeDeviceAttestationStatus(undefined)).toBe('UNSPECIFIED')
    expect(normalizeDeviceAttestationStatus(2)).toBe('VERIFIED')
    expect(normalizeDeviceAttestationStatus('server_authored')).toBe(
      'SERVER_AUTHORED',
    )
    expect(
      normalizeDeviceAttestationStatus('DEVICE_ATTESTATION_STATUS_VERIFIED'),
    ).toBe('VERIFIED')
    expect(normalizeDeviceAttestationStatus('nope')).toBe('UNSPECIFIED')
    expect(gradeToolHostAttestation('VERIFIED').verdict).toBe('not_policed')
    expect(DEFAULT_TOOL_HOST_ATTESTATION_POLICY.enforce).toBe(false)
  })

  test('leftover TIe/RIe/_o/$2e 1:1 with tulipMode seam', () => {
    const off = leftoverHookAttestationBag('VERIFIED', {
      tulipMode: () => 'off',
    })
    expect(off).toBeUndefined()
    expect(
      attestToolHostStatus('VERIFIED', { tulipMode: () => 'off' }),
    ).toBeUndefined()

    const observe = leftoverHookAttestationBag('VERIFIED', {
      tulipMode: () => 'observe',
    })
    expect(observe).toEqual({
      attestation: {
        mode: 'observe',
        status: 'VERIFIED',
        verdict: 'not_policed',
      },
      heldBack: false,
    })
    expect(isToolHostAttestationHeldBack(observe?.attestation)).toBe(false)

    const held = leftoverHookAttestationBag('ABSENT', {
      tulipMode: () => 'enforce',
      policy: {
        enforce: true,
        acceptLevel: 'VERIFIED',
        acceptStatuses: new Set(),
      },
    })
    expect(held?.attestation.verdict).toBe('below_floor')
    expect(held?.heldBack).toBe(true)
    expect(isToolHostAttestationHeldBack(held?.attestation)).toBe(true)

    const unspecified = unspecifiedToolHostAttestationBag({
      tulipMode: () => 'observe',
    })
    expect(unspecified.attestation?.status).toBe('UNSPECIFIED')
    expect(unspecified.heldBack).toBe(false)
  })

  test('leftover nVt sink + throw copy 1:1', () => {
    const seen: Array<[string, string]> = []
    notifyServedCallsUnattested((key, text) => {
      seen.push([key, text])
    })
    expect(seen).toEqual([
      [SERVED_CALLS_UNATTESTED_NOTICE_KEY, SERVED_CALLS_UNATTESTED_COPY],
    ])
    notifyServedCallsUnattested(() => {
      throw new Error('boom')
    })
    expect(
      debugLogs.some(
        row =>
          row.level === 'error' &&
          row.msg.includes(
            '[remote-tools] the notice sink threw on served-calls-unattested: boom',
          ),
      ),
    ).toBe(true)
  })

  test('leftover gzn/aMr/s/t0o/Yle 1:1', () => {
    expect(meetsAttestationLevel('SERVICE_VOUCHED', 'VERIFIED')).toBe(true)
    expect(meetsAttestationLevel('VERIFIED', 'VERIFIED')).toBe(true)
    expect(meetsAttestationLevel('VERIFIED_BY_GATE', 'VERIFIED')).toBe(false)
    expect(meetsAttestationLevel('ABSENT', 'VERIFIED')).toBe(false)

    const pass = assessToolHostAttestation('VERIFIED', {
      enforce: true,
      acceptLevel: 'VERIFIED',
      acceptStatuses: new Set(),
    })
    expect(pass).toEqual({
      status: 'VERIFIED',
      meetsLevel: true,
      configException: false,
    })
    expect(
      gradeToolHostAttestation('VERIFIED', {
        enforce: true,
        acceptLevel: 'VERIFIED',
        acceptStatuses: new Set(),
      }).verdict,
    ).toBe('pass')
    expect(
      leftoverHookAttestationBag('VERIFIED', {
        tulipMode: () => 'enforce',
        policy: {
          enforce: true,
          acceptLevel: 'VERIFIED',
          acceptStatuses: new Set(),
        },
      })?.heldBack,
    ).toBe(false)

    const authored = assessToolHostAttestation('SERVER_AUTHORED', {
      enforce: true,
      acceptLevel: 'VERIFIED',
      acceptStatuses: new Set(),
    })
    expect(authored.status).toBe('UNSPECIFIED')
    expect(authored.meetsLevel).toBe(false)

    const exception = gradeToolHostAttestation('ABSENT', {
      enforce: true,
      acceptLevel: 'VERIFIED',
      acceptStatuses: new Set(['ABSENT']),
    })
    expect(exception.verdict).toBe('config_exception')

    const parsed = parseBridgeAttestationEnforceConfig({
      accept_level: 'VERIFIED_KEYLESS_DEVICE',
      accept_statuses: ['UNSPECIFIED'],
    })
    expect(parsed).toEqual({
      enforce: true,
      acceptLevel: 'VERIFIED_KEYLESS_DEVICE',
      acceptStatuses: new Set(['UNSPECIFIED']),
    })
    const malformed = parseBridgeAttestationEnforceConfig({
      accept_level: 'nope',
    })
    expect(malformed).toEqual({
      enforce: true,
      acceptLevel: 'VERIFIED',
      acceptStatuses: new Set(),
    })
    expect(
      debugLogs.some(row =>
        row.msg.startsWith(BRIDGE_ATTESTATION_MALFORMED_CONFIG_PREFIX),
      ),
    ).toBe(true)
    expect(
      events.some(
        e =>
          e.name === 'bridge_event_attestation' &&
          e.props.reason === 'malformed_config',
      ),
    ).toBe(true)

    expect(
      readToolHostAttestationPolicy({
        isPolicyEnforcedOrHintedByRefusedCache: () => false,
      }),
    ).toEqual(DEFAULT_TOOL_HOST_ATTESTATION_POLICY)

    expect(REQUIRE_TRUSTED_DEVICES).toBe('require_trusted_devices')
    expect(
      isPolicyEnforcedOrHintedByRefusedCache(REQUIRE_TRUSTED_DEVICES, {
        restrictions: { require_trusted_devices: { allowed: true } },
      }),
    ).toBe(true)
    expect(
      isPolicyEnforcedOrHintedByRefusedCache(REQUIRE_TRUSTED_DEVICES, {
        restrictions: null,
        hintedEnforcedKeys: [REQUIRE_TRUSTED_DEVICES],
        sessionAttributed: false,
        eligible: true,
      }),
    ).toBe(true)
    expect(
      isPolicyEnforcedOrHintedByRefusedCache(REQUIRE_TRUSTED_DEVICES, {
        restrictions: {},
        hintedEnforcedKeys: [REQUIRE_TRUSTED_DEVICES],
        sessionAttributed: true,
        eligible: true,
      }),
    ).toBe(false)

    dropLeftoverPolicyHints()
    leftoverPolicyLimitsHost().sessionCache = null
    leftoverPolicyLimitsHost().sessionAttributed = false
    hintFromRefusedPolicyBody({
      restrictions: { require_trusted_devices: { allowed: true } },
    })
    expect(leftoverPolicyLimitsHost().hintedEnforcedKeys).toContain(
      REQUIRE_TRUSTED_DEVICES,
    )
    expect(
      isPolicyEnforcedOrHintedByRefusedCache(REQUIRE_TRUSTED_DEVICES, {
        restrictions: null,
        eligible: true,
      }),
    ).toBe(true)
    leftoverPolicyLimitsHost().sessionCache = { x: { allowed: true } }
    leftoverPolicyLimitsHost().sessionAttributed = true
    hintFromRefusedPolicyBody({
      restrictions: { extra: { allowed: true } },
    })
    expect(leftoverPolicyLimitsHost().hintedEnforcedKeys).not.toContain('extra')
    dropLeftoverPolicyHints()
    leftoverPolicyLimitsHost().sessionCache = null
    leftoverPolicyLimitsHost().sessionAttributed = false

    expect(isEnforceOrRequirePolicyKey('require_trusted_devices')).toBe(true)
    expect(isEnforceOrRequirePolicyKey('enforce_foo')).toBe(true)
    expect(isEnforceOrRequirePolicyKey('allow_web_fetch')).toBe(false)
    expect(
      policyDeniedUnderPairs().some(
        ([taint, policy]) => taint === 'hipaa' && policy === 'allow_web_fetch',
      ),
    ).toBe(true)
    hintFromRefusedPolicyBody({
      restrictions: {
        allow_web_fetch: { allowed: true },
        require_trusted_devices: { allowed: true },
        allow_memory_sync: { allowed: false },
      },
      compliance_taints: ['hipaa', 'not-a-taint'],
    })
    expect(leftoverPolicyLimitsHost().hintedEnforcedKeys).toContain(
      REQUIRE_TRUSTED_DEVICES,
    )
    expect(leftoverPolicyLimitsHost().hintedEnforcedKeys).not.toContain(
      'allow_web_fetch',
    )
    expect(leftoverPolicyLimitsHost().hintedDeniedKeys).toContain(
      'allow_memory_sync',
    )
    expect(leftoverPolicyLimitsHost().hintedTaints).toEqual(['hipaa'])
    dropLeftoverPolicyHints()

    expect(isKnownPolicyLimitsKey('allow_web_fetch')).toBe(true)
    expect(isKnownPolicyLimitsKey('not_a_policy')).toBe(false)
    expect(lookupPolicyLimitsEntry('allow_projects_tool')).toEqual({
      deniedUnder: ['hipaa'],
      onCacheMiss: 'hold',
      label: 'Projects',
      verb: 'are',
      requirementId: 'HIPAA-R17',
      hardBlockUnder: ['hipaa'],
    })
    expect(
      lookupPolicyLimitsEntry('allow_usage_transcript_scan')?.transcriptScan,
    ).toBe(true)
    expect(lookupPolicyLimitsEntry('allow_web_fetch')?.serverPopulated).toBe(
      true,
    )
    expect(lookupPolicyLimitsEntry('allow_web_fetch')?.onCacheMiss).toBe(
      'allow',
    )
    expect(policyLimitsFeatureCopy('allow_web_fetch')).toEqual({
      featureLabel: 'Web fetch',
      verb: 'is',
    })
    expect(policyLimitsFeatureCopy('unknown_key')).toEqual({
      featureLabel: 'unknown_key',
      verb: 'is',
    })
    expect(
      policyHardBlockUnderPairs().some(
        ([taint, policy]) =>
          taint === 'hipaa' && policy === 'allow_memory_sync',
      ),
    ).toBe(true)
    expect(Object.keys(POLICY_LIMITS_CATALOG)).toHaveLength(29)

    expect(isServerPopulatedPolicyKey('allow_web_fetch')).toBe(true)
    expect(isTranscriptScanPolicyKey('allow_usage_transcript_scan')).toBe(true)
    expect(policyDeniedByTaints('allow_web_fetch', ['hipaa'])).toBe(true)
    expect(policyDeniedByTaints('allow_web_fetch', [])).toBe(false)
    expect(
      evaluatePolicyLimitsAgainst(
        { restrictions: { allow_web_fetch: { allowed: true } } },
        'allow_web_fetch',
      ),
    ).toBe(true)
    expect(
      evaluatePolicyLimitsAgainst(
        { restrictions: {}, compliance_taints: ['hipaa'] },
        'allow_memory_sync',
      ),
    ).toBe(false)
    expect(
      isPolicyLimitsAllowed('allow_web_fetch', {
        eligible: false,
        restrictions: null,
      }),
    ).toBe(true)
    leftoverPolicyLimitsHost().hintedDeniedKeys = ['allow_web_fetch']
    expect(
      isPolicyLimitsAllowed('allow_web_fetch', {
        eligible: true,
        restrictions: null,
        skipDiskStamp: true,
      }),
    ).toBe(false)
    dropLeftoverPolicyHints()

    expect(
      leftoverHipaaEvidenceBlocks('allow_memory_sync', { eligible: true }),
    ).toBe(false)
    expect(
      leftoverHipaaEvidenceBlocks('allow_web_fetch', { eligible: false }),
    ).toBe(false)
    expect(
      leftoverHipaaEvidenceBlocks('allow_web_fetch', {
        eligible: true,
        tranquilCrescent: true,
      }),
    ).toBe(false)
    leftoverPolicyLimitsHost().sessionCache = { x: { allowed: true } }
    leftoverPolicyLimitsHost().sessionAttributed = true
    leftoverPolicyLimitsHost().attributedBearerDigest = 'same'
    expect(
      leftoverHipaaEvidenceBlocks('allow_web_fetch', {
        eligible: true,
        attributedBearerDigest: 'same',
      }),
    ).toBe(false)
    leftoverPolicyLimitsHost().sessionCache = null
    leftoverPolicyLimitsHost().sessionAttributed = false
    leftoverPolicyLimitsHost().attributedBearerDigest = null
    const alice = leftoverHashPrincipalDescriptor('token:alice')
    leftoverPolicyLimitsHost().hipaaEvidence = {
      seen: [alice],
      incomplete: false,
      ruledOut: [],
    }
    leftoverPolicyLimitsHost().hipaaEvidenceLoaded = true
    expect(
      leftoverHipaaEvidenceBlocks('allow_web_fetch', {
        eligible: true,
        principal: { descriptor: 'token:alice' },
        skipDiskStamp: true,
      }),
    ).toBe(true)
    expect(
      leftoverHipaaEvidence({
        hipaaEvidence: { seen: ['x'], incomplete: true, ruledOut: [] },
      }).incomplete,
    ).toBe(true)
    expect(leftoverPolicyLimitsPrincipal({ principal: null })).toBeNull()
    leftoverPolicyLimitsHost().sessionCache = { x: { allowed: true } }
    leftoverPolicyLimitsHost().sessionAttributed = true
    leftoverPolicyLimitsHost().attributedBearerDigest = 'host'
    leftoverPolicyLimitsHost().hipaaEvidence = {
      seen: [alice],
      incomplete: false,
      ruledOut: [],
    }
    leftoverPolicyLimitsHost().hipaaEvidenceLoaded = true
    expect(
      leftoverHipaaEvidenceBlocks('allow_web_fetch', {
        eligible: true,
        attributedBearerDigest: 'other',
        principal: { descriptor: 'token:alice' },
        skipDiskStamp: true,
      }),
    ).toBe(false)
    expect(
      leftoverHipaaEvidenceBlocks('allow_web_fetch', {
        eligible: true,
        attributedBearerDigest: 'other',
        principal: { descriptor: 'token:alice', unclassified: true },
        skipDiskStamp: true,
      }),
    ).toBe(true)
    expect(
      leftoverHipaaEvidenceBlocks('allow_web_fetch', {
        eligible: true,
        attributedBearerDigest: 'other',
        principal: {
          descriptor: 'token:bob',
          storedLoginOrgless: true,
        },
        skipDiskStamp: true,
      }),
    ).toBe(true)
    expect(leftoverHashPrincipalDescriptor('token:alice')).toHaveLength(64)
    leftoverPolicyLimitsHost().sessionCache = null
    leftoverPolicyLimitsHost().sessionAttributed = false
    leftoverPolicyLimitsHost().attributedBearerDigest = null
    leftoverPolicyLimitsHost().hipaaEvidence = {
      seen: [],
      incomplete: false,
      ruledOut: [],
    }
    leftoverPolicyLimitsHost().hipaaEvidenceLoaded = false
  })

  test('leftover L reads policy-limits.json.stamp.json into WDr', async () => {
    const dir = join(import.meta.dir, 'tmp-leftover-hipaa-stamp')
    mkdirSync(dir, { recursive: true })
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      const alice = leftoverHashPrincipalDescriptor('token:alice')
      writeFileSync(
        join(dir, 'policy-limits.json.stamp.json'),
        JSON.stringify({
          v: 1,
          identity: alice,
          kind: 'token',
          sha: 'x',
          confirmed_at: 1,
          hipaa_seen: [alice],
          hipaa_seen_incomplete: false,
        }),
      )
      leftoverPolicyLimitsHost().hipaaEvidenceLoaded = false
      leftoverPolicyLimitsHost().oauthPrincipalMemo = null
      expect(leftoverHipaaEvidence().seen).toEqual([alice])
      expect(
        leftoverHipaaEvidenceBlocks('allow_web_fetch', {
          eligible: true,
          principal: null,
        }),
      ).toBe(false)
      expect(
        leftoverHipaaEvidenceBlocks('allow_web_fetch', {
          eligible: true,
          principal: { descriptor: 'token:alice' },
        }),
      ).toBe(true)
      const stamp = leftoverBuildHipaaStamp({
        principal: { kind: 'token', descriptor: 'token:alice' },
        bodySha: 'sha',
        confirmedAt: 2,
        bodyTaints: ['hipaa'],
        previous: { seen: [], incomplete: false, ruledOut: [] },
      })
      expect(stamp.identity).toBe(alice)
      expect(stamp.hipaa_seen).toEqual([alice])
      expect(stamp.kind).toBe('token')
      expect(
        leftoverAnonymousHipaaStampBody({
          seen: [alice],
          incomplete: true,
          ruledOut: ['x'],
        }).identity,
      ).toBe('0'.repeat(64))
      expect(await leftoverPersistHipaaStamp(stamp)).toBe(true)
      leftoverPolicyLimitsHost().hipaaEvidenceLoaded = false
      leftoverPolicyLimitsHost().hipaaEvidence = {
        seen: [],
        incomplete: false,
        ruledOut: [],
      }
      expect(leftoverHipaaEvidence().seen).toEqual([alice])
      await leftoverRemoveHipaaStamp()
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
