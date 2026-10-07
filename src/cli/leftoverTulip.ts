/**
 * densable 2.1.283 leftover `_o` @202276282 BODY wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   leftover `jtr` @202143707 · leftover `s` @202143914
 *   leftover `TIe` @202144104 · leftover `RIe` @202144178
 *   leftover `$2e` @202144248 · leftover `nVt` @202144326
 *   leftover `_o` @202276282 next `function Hi(`
 *
 * Gold leftover `_o`:
 *   `function _o(e){let n=TIe(e);return n===void 0?void 0:{attestation:n,heldBack:RIe(n)}}`
 *
 * Wraps existing GrowthBook `getFeatureValue_CACHED_MAY_BE_STALE` (`x`) for
 * leftover `jtr` (`tengu_breezy_fairy` → `tengu_vast_tulip`) and leftover `Yle`
 * (`tengu_bridge_attestation_enforce` / elevated-auth / enforce_config).
 * leftover `s` CALLs leftover `aMr` + leftover `gzn` ladder. leftover `E()`
 * `fLt` wraps existing `isPolicyEnforced` / `isPolicyLimitsEligible`. leftover
 * `h()` @179070612 is a module cache (`hintedEnforcedKeys` / `sessionAttributed`);
 * leftover `hintFromRefusedBody` @179069478. leftover `VDr`/`ldt`/`qDr` catalog
 * wrap. leftover `Jt`/`pLt` catalog lookup wrap. leftover `oe`/`WDr`/`UX`
 * host-cache + leftover `je`/`T`/`L` disk stamp READ
 * (`policy-limits.json.stamp.json`). leftover `zle` sha256 of the principal
 * descriptor. leftover `nGo`/`YIo` AND leftover `hDo`/`_Do`
 * (`tengu_validated_clover` / `tengu_hashed_lark` servedTrue). leftover
 * `Mhe`/`_B` unix-socket placeholder skip. leftover `ODr`/`FGn`/`$Gn`/`GIo`
 * stamp WRITE. leftover `UX`/`jn`/`Ohe` OAuth/WIF/key principal. leftover
 * `KIo` UX()===null fail-open. NEVER `export function _o`. NEVER `export
 * function Jt`. NEVER `export function oe`. NEVER `export function zle`.
 * NEVER `export function je`. NEVER `export function ODr`. NEVER `export
 * function UX`. No Far store, no WS, no `CLAUDE_CODE_NO_DEVICE_PROOF`.
 */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { createHash } from 'crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readSync,
} from 'fs'
import { unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { errorMessage, isENOENT } from '../utils/errors.js'
import { safeParseJSON } from '../utils/json.js'
import { jsonStringify } from '../utils/slowOperations.js'

/** leftover `u` @180888421 next leftover `Yle` */
export const REQUIRE_TRUSTED_DEVICES = 'require_trusted_devices'

/**
 * Local stand-ins for deleted `services/policyLimits` product-cut stubs.
 * Org policy never enforces; eligibility stays false (fail-open).
 */
function isPolicyEnforced(_policy: string): boolean {
  return false
}

function isPolicyLimitsEligible(): boolean {
  return false
}

/** leftover `jtr` @202143707 — `x("tengu_breezy_fairy", false)` else tulip. */
const TENGU_BREEZY_FAIRY = 'tengu_breezy_fairy'
/** leftover `jtr` @202143707 */
const TENGU_VAST_TULIP = 'tengu_vast_tulip'
/** leftover `Yle` @180890124 */
const TENGU_BRIDGE_ATTESTATION_ENFORCE = 'tengu_bridge_attestation_enforce'
/** leftover `Yle` `f` @180888421 */
const TENGU_SESSIONS_ELEVATED_AUTH_ENFORCEMENT =
  'tengu_sessions_elevated_auth_enforcement'
/** leftover `Yle` @180890124 */
const TENGU_BRIDGE_ATTESTATION_ENFORCE_CONFIG =
  'tengu_bridge_attestation_enforce_config'
/** leftover `jtr` catch copy @202143707 */
export const TOOL_HOST_ATTESTATION_TULIP_THREW =
  'tool host attestation: reading tengu_vast_tulip threw; observing'

/** leftover `ge` next leftover `uFe` */
const DEVICE_ATTESTATION_STATUS_PREFIX = 'DEVICE_ATTESTATION_STATUS_'

/** leftover `je` next leftover `uFe` */
export const DEVICE_ATTESTATION_STATUSES = [
  'UNSPECIFIED',
  'ABSENT',
  'VERIFIED',
  'VERIFIED_BY_GATE',
  'INVALID',
  'UNCHECKED',
  'VERIFIED_KEYLESS_DEVICE',
  'SERVICE_VOUCHED',
  'SERVER_AUTHORED',
  'SERVER_REPLAYED',
  'TRANSITIVELY_VOUCHED',
] as const

/** leftover `He` next leftover `uFe` — numeric index table. */
const DEVICE_ATTESTATION_STATUS_BY_INDEX = [
  'UNSPECIFIED',
  'ABSENT',
  'VERIFIED',
  'VERIFIED_BY_GATE',
  'INVALID',
  'UNCHECKED',
] as const

/** leftover `z` next leftover `gzn` @180877408 */
const ATTESTATION_MEETS_LEVEL_LADDER = [
  'VERIFIED',
  'VERIFIED_KEYLESS_DEVICE',
  'VERIFIED_BY_GATE',
] as const

/** leftover `Qe` next leftover `t0o` @180877521 */
const ATTESTATION_ACCEPT_STATUSES = [
  'UNSPECIFIED',
  'ABSENT',
  'INVALID',
  'UNCHECKED',
] as const

export type DeviceAttestationStatus =
  (typeof DEVICE_ATTESTATION_STATUSES)[number]

export type ToolHostTulipMode = 'off' | 'enforce' | 'observe'

export type ToolHostAttestationVerdict =
  | 'not_policed'
  | 'pass'
  | 'config_exception'
  | 'below_floor'

export type ToolHostAttestation = {
  mode: Exclude<ToolHostTulipMode, 'off'>
  status: string
  verdict: ToolHostAttestationVerdict
}

/** leftover `hzn` @180877525 — default leftover `Yle` when enforce GB is off. */
export const DEFAULT_TOOL_HOST_ATTESTATION_POLICY = {
  enforce: false,
  acceptLevel: 'VERIFIED',
  acceptStatuses: new Set<string>(),
} as const

export type ToolHostAttestationPolicy = {
  enforce: boolean
  acceptLevel: string
  acceptStatuses: ReadonlySet<string>
}

/** leftover `lSt` @200266752 */
export const SERVED_CALLS_UNATTESTED_NOTICE_KEY = 'served-calls-unattested'

/** leftover `Di["repository_trust.served_calls.unattested"]` @181895223 */
export const SERVED_CALLS_UNATTESTED_COPY =
  "This computer refused a call from the cloud session: the service could not vouch for the call's sender under your organization's trusted-device policy."

export type ToolHostAttestationSeams = {
  tulipMode?: () => ToolHostTulipMode
  normalizeStatus?: (status: unknown) => DeviceAttestationStatus
  policy?: ToolHostAttestationPolicy
  isPolicyEnforcedOrHintedByRefusedCache?: () => boolean
  restrictions?: Record<string, { allowed?: boolean }> | null
  hintedEnforcedKeys?: readonly string[]
  sessionAttributed?: boolean
  eligible?: boolean
  meetsLevel?: (status: string, policy: ToolHostAttestationPolicy) => boolean
  configException?: (
    status: string,
    policy: ToolHostAttestationPolicy,
  ) => boolean
}

/** leftover `ze` @179068348 — hinted key cap. */
const POLICY_HINT_CAP = 256

export type PolicyLimitsOnCacheMiss = 'allow' | 'deny' | 'hold'

export type PolicyLimitsCatalogEntry = {
  deniedUnder: readonly string[]
  onCacheMiss: PolicyLimitsOnCacheMiss
  label: string
  verb: string
  requirementId: string
  serverPopulated?: true
  transcriptScan?: true
  hardBlockUnder?: readonly string[]
}

/**
 * leftover `VDr` @176860862 — leftover `ldt`/`qDr` catalog. Gold `...{}`
 * spreads are no-ops. Do not invent leftover `Jt`/`pLt` HIPAA fetch.
 */
export const POLICY_LIMITS_CATALOG: Record<string, PolicyLimitsCatalogEntry> = {
  allow_product_feedback: {
    deniedUnder: ['hipaa', 'zdr'],
    serverPopulated: true,
    onCacheMiss: 'deny',
    label: 'Feedback',
    verb: 'is',
    requirementId: 'HIPAA-R1',
  },
  allow_web_fetch: {
    deniedUnder: ['hipaa'],
    serverPopulated: true,
    onCacheMiss: 'allow',
    label: 'Web fetch',
    verb: 'is',
    requirementId: 'HIPAA-R3',
  },
  allow_memory_sync: {
    deniedUnder: ['hipaa', 'zdr'],
    onCacheMiss: 'allow',
    label: 'Memory sync',
    verb: 'is',
    requirementId: 'HIPAA-R5',
    hardBlockUnder: ['hipaa'],
  },
  allow_design_sync: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'allow',
    label: 'Design sync',
    verb: 'is',
    requirementId: 'HIPAA-R9',
  },
  allow_projects_tool: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'hold',
    label: 'Projects',
    verb: 'are',
    requirementId: 'HIPAA-R17',
    hardBlockUnder: ['hipaa'],
  },
  allow_claude_browser_extension: {
    deniedUnder: ['hipaa'],
    serverPopulated: true,
    onCacheMiss: 'allow',
    label: 'Claude in Chrome',
    verb: 'is',
    requirementId: 'HIPAA-R34',
  },
  allow_remote_sessions: {
    deniedUnder: ['hipaa'],
    serverPopulated: true,
    onCacheMiss: 'deny',
    label: 'Cloud sessions',
    verb: 'are',
    requirementId: 'HIPAA-R6',
  },
  allow_remote_control: {
    deniedUnder: ['hipaa'],
    serverPopulated: true,
    onCacheMiss: 'deny',
    label: 'Remote Control',
    verb: 'is',
    requirementId: 'HIPAA-R6',
  },
  allow_cobalt_plinth: {
    deniedUnder: ['hipaa', 'zdr'],
    serverPopulated: true,
    onCacheMiss: 'deny',
    label: 'Artifacts',
    verb: 'are',
    requirementId: 'HIPAA-R16',
  },
  allow_team_onboarding: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'hold',
    label: 'Team onboarding',
    verb: 'is',
    requirementId: 'HIPAA-R13',
    hardBlockUnder: ['hipaa'],
  },
  allow_error_reporting: {
    deniedUnder: ['hipaa', 'zdr'],
    onCacheMiss: 'deny',
    label: 'Error reporting',
    verb: 'is',
    requirementId: 'HIPAA-R19',
  },
  allow_auto_mode_sibling_docs: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'deny',
    label: 'Repository lookups',
    verb: 'are',
    requirementId: 'HIPAA-R36',
  },
  allow_send_file: {
    deniedUnder: ['hipaa', 'zdr'],
    onCacheMiss: 'deny',
    label: 'File upload',
    verb: 'is',
    requirementId: 'HIPAA-R37',
  },
  allow_heap_dump: {
    deniedUnder: ['hipaa', 'zdr'],
    onCacheMiss: 'deny',
    label: 'Heap dumps',
    verb: 'are',
    requirementId: 'HIPAA-R38',
  },
  allow_local_checkpoint_commit: {
    deniedUnder: ['hipaa', 'zdr'],
    onCacheMiss: 'deny',
    label: 'Usage-limit checkpoints',
    verb: 'are',
    requirementId: 'HIPAA-R39',
  },
  allow_plugin_skill_search: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'deny',
    label: 'Plugin and skill search',
    verb: 'is',
    requirementId: 'HIPAA-R26',
  },
  allow_plugin_directory_search: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'deny',
    label: 'The plugin directory',
    verb: 'is',
    requirementId: 'HIPAA-R35',
  },
  allow_connector_suggest: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'deny',
    label: 'Connector suggestions',
    verb: 'are',
    requirementId: 'HIPAA-R43',
  },
  allow_account_skills_sync: {
    deniedUnder: ['hipaa'],
    serverPopulated: true,
    onCacheMiss: 'deny',
    label: 'Account skills sync',
    verb: 'is',
    requirementId: 'HIPAA-R29',
  },
  allow_account_plugins_sync: {
    deniedUnder: ['hipaa'],
    serverPopulated: true,
    onCacheMiss: 'deny',
    label: 'Account plugins sync',
    verb: 'is',
    requirementId: 'HIPAA-R30',
  },
  allow_mycelium: {
    deniedUnder: ['hipaa', 'zdr'],
    onCacheMiss: 'deny',
    label: 'Peer messaging',
    verb: 'is',
    requirementId: 'HIPAA-R25',
    hardBlockUnder: ['hipaa'],
  },
  allow_usage_transcript_scan: {
    deniedUnder: ['hipaa'],
    transcriptScan: true,
    onCacheMiss: 'deny',
    label: 'Usage patterns',
    verb: 'are',
    requirementId: 'HIPAA-R31',
  },
  allow_skill_doctor_transcript_scan: {
    deniedUnder: ['hipaa'],
    transcriptScan: true,
    onCacheMiss: 'deny',
    label: 'Skill token counts',
    verb: 'are',
    requirementId: 'HIPAA-R32',
  },
  allow_insights: {
    deniedUnder: ['hipaa'],
    transcriptScan: true,
    onCacheMiss: 'deny',
    label: 'Insights',
    verb: 'are',
    requirementId: 'HIPAA-R40',
  },
  allow_stats_transcript_scan: {
    deniedUnder: ['hipaa'],
    transcriptScan: true,
    onCacheMiss: 'deny',
    label: 'Usage stats',
    verb: 'are',
    requirementId: 'HIPAA-R42',
  },
  allow_model_catalog: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'allow',
    label: 'The model catalog',
    verb: 'is',
    requirementId: 'HIPAA-R33',
  },
  allow_container_result_files: {
    deniedUnder: ['hipaa', 'zdr'],
    onCacheMiss: 'deny',
    label: 'Saving large tool results in the tool container',
    verb: 'is',
    requirementId: 'HIPAA-R53',
  },
  allow_promo_offers: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'deny',
    label: 'Promotional offers',
    verb: 'are',
    requirementId: 'HIPAA-R54',
  },
  allow_previous_conversation_pointer: {
    deniedUnder: ['hipaa'],
    onCacheMiss: 'deny',
    label: 'Linking a new conversation to the one it replaces',
    verb: 'is',
    requirementId: 'HIPAA-R58',
  },
}

/**
 * leftover `VDr.deniedUnder` — leftover `KDr` pairs `[taint, policy]`.
 */
export const POLICY_DENIED_UNDER: Record<string, readonly string[]> =
  Object.fromEntries(
    Object.entries(POLICY_LIMITS_CATALOG).map(([policy, row]) => [
      policy,
      row.deniedUnder,
    ]),
  )

/** leftover `qDr` @176865010 — `Object.hasOwn(VDr,e)`. NEVER `export function qDr`. */
export function isKnownPolicyLimitsKey(e: string): boolean {
  return Object.hasOwn(POLICY_LIMITS_CATALOG, e)
}

/** leftover `ldt` @176865054 — `qDr(e)?VDr[e]:void 0`. NEVER `export function ldt`. */
export function lookupPolicyLimitsEntry(
  e: string,
): PolicyLimitsCatalogEntry | undefined {
  return isKnownPolicyLimitsKey(e) ? POLICY_LIMITS_CATALOG[e] : undefined
}

/**
 * leftover `PK` @176865140
 * `{featureLabel:n?.label??e,verb:n?.verb??"is"}`
 */
export function policyLimitsFeatureCopy(e: string): {
  featureLabel: string
  verb: string
} {
  const n = lookupPolicyLimitsEntry(e)
  return { featureLabel: n?.label ?? e, verb: n?.verb ?? 'is' }
}

/**
 * leftover `KDr` @179086848
 * `W().flatMap((e)=>(ldt(e)?.deniedUnder??[]).map((n)=>[n,e]))`
 */
export function policyDeniedUnderPairs(): Array<[string, string]> {
  return Object.entries(POLICY_LIMITS_CATALOG).flatMap(([policy, row]) =>
    row.deniedUnder.map((taint): [string, string] => [taint, policy]),
  )
}

/**
 * leftover `rGo` @176865214
 * `W().flatMap((e)=>(ldt(e)?.hardBlockUnder??[]).map((n)=>[n,e]))`
 */
export function policyHardBlockUnderPairs(): Array<[string, string]> {
  return Object.entries(POLICY_LIMITS_CATALOG).flatMap(([policy, row]) =>
    (row.hardBlockUnder ?? []).map((taint): [string, string] => [
      taint,
      policy,
    ]),
  )
}

/** leftover `$e` @176865094 */
const HIPAA_TAINT = new Set(['hipaa'])

/**
 * leftover `Ap.servedTrue` @178209276 — `reader(e,false)===true`, missing
 * reader / throw → false. Host is GB cached getter.
 */
function leftoverServedTrue(flag: string): boolean {
  try {
    return getFeatureValue_CACHED_MAY_BE_STALE(flag, false) === true
  } catch {
    return false
  }
}

/** leftover `hDo` @178209601 — `On.servedTrue("tengu_validated_clover")`. */
function leftoverValidatedClover(): boolean {
  return leftoverServedTrue('tengu_validated_clover')
}

/** leftover `yDo` @178209663 — `On.servedTrue("tengu_tranquil_crescent")`. */
function leftoverTranquilCrescent(): boolean {
  return leftoverServedTrue('tengu_tranquil_crescent')
}

/** leftover `_Do` @178209726 — `On.servedTrue("tengu_hashed_lark")`. */
function leftoverHashedLark(): boolean {
  return leftoverServedTrue('tengu_hashed_lark')
}

/**
 * leftover `nGo` @179086600
 * `ldt(e)?.serverPopulated===!0&&!hDo()`.
 */
export function isServerPopulatedPolicyKey(e: string): boolean {
  return (
    lookupPolicyLimitsEntry(e)?.serverPopulated === true &&
    !leftoverValidatedClover()
  )
}

/**
 * leftover `YIo` @179086660
 * `ldt(e)?.transcriptScan===!0&&!_Do()`.
 */
export function isTranscriptScanPolicyKey(e: string): boolean {
  return (
    lookupPolicyLimitsEntry(e)?.transcriptScan === true && !leftoverHashedLark()
  )
}

/**
 * leftover `z` @176867888
 * `for(let[i,r] of KDr) if(r===e&&n.includes(i)) return !0`
 */
export function policyDeniedByTaints(
  policy: string,
  taints: readonly string[],
): boolean {
  if (taints.length === 0) return false
  for (const [taint, key] of policyDeniedUnderPairs()) {
    if (key === policy && taints.includes(taint)) return true
  }
  return false
}

/**
 * leftover `pLt` @176866957. Catalog lookup against restrictions + taints.
 * NEVER invent gold `oe`/`WDr`/`UX` HIPAA evidence fetch.
 */
export function evaluatePolicyLimitsAgainst(
  e: {
    restrictions?: Record<string, { allowed?: boolean } | undefined>
    compliance_taints?: string[]
  },
  n: string,
  i: readonly string[] = [],
): boolean {
  const r = e.compliance_taints ?? []
  if (
    policyHardBlockUnderPairs().some(
      ([d, p]) => p === n && (r.includes(d) || i.includes(d)),
    )
  ) {
    return false
  }
  const s = e.restrictions?.[n]
  if (s) return s.allowed === true
  if (isTranscriptScanPolicyKey(n)) return true
  const c = isServerPopulatedPolicyKey(n)
    ? [
        ...i.filter(d => !(HIPAA_TAINT.has(d) && r.includes(d))),
        ...r.filter(d => !HIPAA_TAINT.has(d)),
      ]
    : [...i, ...r]
  return !policyDeniedByTaints(n, c)
}

export type HipaaEvidence = {
  seen: string[]
  incomplete: boolean
  ruledOut: string[]
}

export type PolicyLimitsPrincipal = {
  kind?: 'org' | 'key' | 'wif' | 'token'
  descriptor: string
  unclassified?: boolean
  storedLoginOrgless?: boolean
  bearerDigest?: string
} | null

export type PolicyLimitsAllowedSeams = {
  eligible?: boolean
  restrictions?: Record<string, { allowed?: boolean }> | null
  latchedTaints?: readonly string[]
  tranquilCrescent?: boolean
  hashedLark?: boolean
  attributedBearerDigest?: string | null
  principal?: PolicyLimitsPrincipal
  hipaaEvidence?: HipaaEvidence
  skipDiskStamp?: boolean
}

/** leftover `Xn` @176865640 */
const HIPAA_EVIDENCE_POLICY_KEYS = new Set([
  'allow_web_fetch',
  'allow_design_sync',
])

/** leftover `UGn` @179067826 */
const POLICY_LIMITS_CACHE_FILENAME = 'policy-limits.json'
/** leftover `an` @179051287 */
const HIPAA_STAMP_SUFFIX = '.stamp.json'
/** leftover `ge` @179051247 — stamp file size cap. */
const HIPAA_STAMP_MAX_BYTES = 4096
/** leftover `P` @179051247 — stamp seen / ruledOut cap. */
const HIPAA_STAMP_SEEN_CAP = 8
/** leftover `lRe` @177805089 — unix-socket placeholder. */
const UNIX_SOCKET_AUTH_PLACEHOLDER = 'ssh-placeholder'
/** leftover `BGn` @179067866 — oauth principal memo TTL. */
const OAUTH_PRINCIPAL_MEMO_TTL_MS = 30_000
/** leftover `FGn` mode 384. */
const HIPAA_STAMP_FILE_MODE = 0o600
/** leftover `We` @179067866 */
const HIPAA_STAMP_ABSENT = { kind: 'absent' } as const
/** leftover `ln` @179052200 */
const HIPAA_STAMP_IO_CODES = new Set([
  'EMFILE',
  'ENFILE',
  'EAGAIN',
  'EBUSY',
  'EINTR',
])

type HipaaStampRead =
  | { kind: 'ok'; stamp: HipaaEvidence }
  | { kind: 'absent' }
  | { kind: 'unusable'; cause: 'io' | 'content' }

/**
 * leftover `zle` @179051657
 * `he("sha256").update(e.descriptor).digest("hex")`.
 * NEVER `export function zle`.
 */
export function leftoverHashPrincipalDescriptor(descriptor: string): string {
  return createHash('sha256').update(descriptor).digest('hex')
}

/**
 * leftover `Ohe` @179051728
 * `he("sha256").update(e).digest("hex").slice(0,32)`.
 * NEVER `export function Ohe`.
 */
function leftoverHashPrincipalShort(e: string): string {
  return createHash('sha256').update(e).digest('hex').slice(0, 32)
}

/** leftover `Pw` @179072372 — `Wn(be(), UGn)`. */
function leftoverPolicyLimitsCachePath(): string {
  return join(getClaudeConfigHomeDir(), POLICY_LIMITS_CACHE_FILENAME)
}

/** leftover `iFe` @179051623 — `${e}${an}`. */
function leftoverHipaaStampPath(cachePath: string): string {
  return `${cachePath}${HIPAA_STAMP_SUFFIX}`
}

/**
 * leftover `_B` @179072406 then leftover `Mhe` @179071835.
 * Unix-socket + placeholder oauth/api-key. No diskless `jo()` invent.
 */
function leftoverUnixSocketTunnel(): string | undefined {
  const e = leftoverPolicyLimitsHost()
  if (e.tunnelSocket === undefined) {
    const n = process.env.ANTHROPIC_UNIX_SOCKET
    const i = process.env.CLAUDE_CODE_OAUTH_TOKEN
    const r = process.env.ANTHROPIC_API_KEY
    const s =
      !process.env.ANTHROPIC_AUTH_TOKEN &&
      ((i === UNIX_SOCKET_AUTH_PLACEHOLDER && !r) ||
        (r === UNIX_SOCKET_AUTH_PLACEHOLDER && !i))
    e.tunnelSocket = n && s ? n : null
  }
  return e.tunnelSocket ?? undefined
}

function leftoverHipaaStampSkipped(): boolean {
  return leftoverUnixSocketTunnel() !== undefined
}

function leftoverErrnoCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return
  const code = (e as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** leftover `Kcn` @179052200 — `unusable && cause==="io"`. */
function leftoverHipaaStampIoUnusable(e: HipaaStampRead): boolean {
  return e.kind === 'unusable' && e.cause === 'io'
}

/** leftover `aLt` @179051843. */
function leftoverHipaaEvidenceFromStamp(raw: {
  hipaa_seen?: unknown
  hipaa_seen_incomplete?: unknown
  hipaa_ruled_out?: unknown
}): HipaaEvidence {
  const seen = Array.isArray(raw.hipaa_seen)
    ? raw.hipaa_seen.filter((row): row is string => typeof row === 'string')
    : []
  const ruledOut = Array.isArray(raw.hipaa_ruled_out)
    ? raw.hipaa_ruled_out.filter(
        (row): row is string => typeof row === 'string',
      )
    : []
  return {
    seen,
    incomplete: raw.hipaa_seen_incomplete === true,
    ruledOut,
  }
}

/**
 * leftover `L` @179052200 — sync stamp READ. No stamp WRITE.
 * NEVER `export function L`. NEVER `export function je`.
 */
function leftoverReadHipaaStampFile(cachePath: string): HipaaStampRead {
  const path = leftoverHipaaStampPath(cachePath)
  let fd: number | undefined
  try {
    fd = openSync(
      path,
      fsConstants.O_RDONLY |
        ('O_NOFOLLOW' in fsConstants ? fsConstants.O_NOFOLLOW : 0),
    )
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > HIPAA_STAMP_MAX_BYTES) {
      return { kind: 'unusable', cause: 'content' }
    }
    const buf = Buffer.alloc(stat.size)
    const n = readSync(fd, buf, 0, stat.size, 0)
    const parsed = safeParseJSON(buf.toString('utf8', 0, n), false)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return { kind: 'unusable', cause: 'content' }
    }
    return {
      kind: 'ok',
      stamp: leftoverHipaaEvidenceFromStamp(
        parsed as {
          hipaa_seen?: unknown
          hipaa_seen_incomplete?: unknown
          hipaa_ruled_out?: unknown
        },
      ),
    }
  } catch (err) {
    const code = leftoverErrnoCode(err)
    if (code === 'ENOENT' || code === 'ENOTDIR') return HIPAA_STAMP_ABSENT
    logForDebugging(
      `Policy limits: stamp unreadable (${errorMessage(err)}); cache reads as unvouched`,
    )
    return {
      kind: 'unusable',
      cause: code && HIPAA_STAMP_IO_CODES.has(code) ? 'io' : 'content',
    }
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // leftover L finally swallows close
      }
    }
  }
}

/**
 * leftover `je` @179080371
 * `Mhe()?We:L(Pw())`.
 */
function leftoverReadHipaaStamp(): HipaaStampRead {
  if (leftoverHipaaStampSkipped()) return HIPAA_STAMP_ABSENT
  return leftoverReadHipaaStampFile(leftoverPolicyLimitsCachePath())
}

/**
 * leftover `T` @179080209
 * `hipaaEvidenceLoaded=!Kcn(e)`; ok → aLt; unusable&&!Kcn → hipaaSeenUnreadable.
 */
function leftoverApplyHipaaStamp(e: HipaaStampRead): void {
  const n = leftoverPolicyLimitsHost()
  n.hipaaEvidenceLoaded = !leftoverHipaaStampIoUnusable(e)
  if (e.kind === 'ok') n.hipaaEvidence = e.stamp
  else if (e.kind === 'unusable' && !leftoverHipaaStampIoUnusable(e)) {
    n.hipaaSeenUnreadable = true
  }
}

/**
 * leftover `WDr` @176858651 / leftover `WDr` @179080127
 * `if(!e.hipaaEvidenceLoaded)T(je());return e.hipaaEvidence`.
 * Disk stamp READ via leftover `L`. NEVER `export function WDr`.
 */
export function leftoverHipaaEvidence(
  seams?: Pick<PolicyLimitsAllowedSeams, 'hipaaEvidence' | 'skipDiskStamp'>,
): HipaaEvidence {
  if (seams?.hipaaEvidence) return seams.hipaaEvidence
  const host = leftoverPolicyLimitsHost()
  if (!host.hipaaEvidenceLoaded) {
    if (seams?.skipDiskStamp === true) host.hipaaEvidenceLoaded = true
    else leftoverApplyHipaaStamp(leftoverReadHipaaStamp())
  }
  return host.hipaaEvidence
}

/**
 * leftover `te` @179078543 — `{kind:"org",descriptor:"org:"+lower}`.
 */
function leftoverOrgPrincipal(e: string): PolicyLimitsPrincipal {
  return { kind: 'org', descriptor: `org:${e.toLowerCase()}` }
}

function leftoverOAuthTokenSource(): 'store' | 'env' | 'fd' | 'none' {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return 'env'
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getOAuthTokenFromFileDescriptor } =
    require('../utils/authFileDescriptor.js') as typeof import('../utils/authFileDescriptor.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  if (getOAuthTokenFromFileDescriptor()) return 'fd'
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getClaudeAIOAuthTokens } =
    require('../utils/auth.js') as typeof import('../utils/auth.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return getClaudeAIOAuthTokens()?.accessToken ? 'store' : 'none'
}

/**
 * leftover `jn` @179078543 — OAuth bearer principal + memo.
 * NEVER `export function jn`.
 */
function leftoverOauthBearerPrincipal(e: string): PolicyLimitsPrincipal {
  const n = leftoverPolicyLimitsHost()
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getOauthAccountInfo } =
    require('../utils/auth.js') as typeof import('../utils/auth.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const i = getOauthAccountInfo()
  const r = process.env.CLAUDE_CODE_ORGANIZATION_UUID?.trim()
  const s = leftoverHashPrincipalShort(e)
  const p = [
    s,
    r ?? '',
    i?.organizationUuid ?? '',
    '',
    process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'env' : '',
  ].join('|')
  const m = n.oauthPrincipalMemo
  if (m?.key === p && (m.expiresAtMs === null || Date.now() < m.expiresAtMs)) {
    return m.principal
  }
  let g: PolicyLimitsPrincipal = { kind: 'token', descriptor: `token:${s}` }
  const source = leftoverOAuthTokenSource()
  switch (source) {
    case 'store': {
      const b = i?.organizationUuid?.trim() ?? null
      if (b) g = leftoverOrgPrincipal(b)
      else
        g = {
          kind: 'token',
          descriptor: `token:${s}`,
          storedLoginOrgless: true,
        }
      break
    }
    case 'env':
    case 'fd':
      if (r) g = { ...leftoverOrgPrincipal(r), bearerDigest: s }
      break
    case 'none':
      g = { kind: 'token', descriptor: `token:${s}`, unclassified: true }
      break
  }
  n.oauthPrincipalMemo = {
    key: p,
    principal: g,
    daemonSnapshotWorker: false,
    expiresAtMs:
      source === 'none' || g === null
        ? Date.now() + OAUTH_PRINCIPAL_MEMO_TTL_MS
        : null,
  }
  return g
}

/**
 * leftover `UX` @176853519 / leftover `UX` @179074995. Seams override. Unix-socket `_B` → null.
 * API key `fS`, WIF `ed`/`KS`, OAuth `pt`/`jn`. NEVER `export function UX`.
 */
function leftoverDerivePolicyLimitsPrincipal(): PolicyLimitsPrincipal {
  const e = leftoverPolicyLimitsHost()
  e.principalFromOAuthBearer = false
  if (leftoverUnixSocketTunnel() !== undefined) return null
  let n: string | null = null
  let i = 'none'
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getAnthropicApiKeyWithSource } =
      require('../utils/auth.js') as typeof import('../utils/auth.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    const got = getAnthropicApiKeyWithSource()
    n = got.key
    i = got.source
  } catch {
    // leftover UX catch around fS
  }
  if (!n) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const {
      getAnthropicProfileAccountInfo,
      getAnthropicProfileSource,
      hasAnthropicProfileAuth,
    } =
      require('../utils/anthropicProfile.js') as typeof import('../utils/anthropicProfile.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (hasAnthropicProfileAuth()) {
      if (e.wifAccountDiverged) return null
      try {
        const source = getAnthropicProfileSource()
        const profile = process.env.ANTHROPIC_PROFILE
        const orgRaw = getAnthropicProfileAccountInfo()?.organizationUuid
        const org = typeof orgRaw === 'string' ? orgRaw.trim() : ''
        const c =
          (source === 'env-quad'
            ? process.env.ANTHROPIC_ORGANIZATION_ID?.trim()
            : org) || ''
        if (c && e.wifSourceLocation === undefined) {
          e.wifRecordProfile =
            source === 'profile-explicit' ? profile : undefined
          e.wifSourceLocation = source ?? undefined
        }
        if (e.wifRecordedOrg === undefined) {
          e.wifRecordedOrg = c.toLowerCase() || null
        } else if (e.wifRecordedOrg !== (c.toLowerCase() || null)) {
          logForDebugging(
            'Policy limits: the WIF source now records a different organization than the one this process derived its principal from; its policy verdicts are session-only until restart',
          )
          e.wifAccountDiverged = true
          return null
        }
        if (!c) return null
        return leftoverOrgPrincipal(c)
      } catch (g) {
        logForDebugging(
          `Policy limits: WIF profile unreadable (${errorMessage(g)}); its policy verdicts are session-only until restart`,
        )
        e.wifAccountDiverged = true
        return null
      }
    }
  }
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getClaudeAIOAuthTokens, isClaudeAISubscriber } =
    require('../utils/auth.js') as typeof import('../utils/auth.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  if (isClaudeAISubscriber()) {
    const r = getClaudeAIOAuthTokens()?.accessToken
    if (!r) return null
    e.principalFromOAuthBearer = true
    return leftoverOauthBearerPrincipal(r)
  }
  if (i === 'apiKeyHelper') return null
  if (n)
    return { kind: 'key', descriptor: `key:${leftoverHashPrincipalShort(n)}` }
  return null
}

export function leftoverPolicyLimitsPrincipal(
  seams?: Pick<PolicyLimitsAllowedSeams, 'principal'>,
): PolicyLimitsPrincipal {
  if (seams && 'principal' in seams) return seams.principal ?? null
  return leftoverDerivePolicyLimitsPrincipal()
}

/**
 * leftover `Ce` @179051880 — incomplete stamp fields.
 */
function leftoverHipaaStampIncompleteFields(e: HipaaEvidence): {
  hipaa_seen_incomplete?: true
  hipaa_ruled_out?: string[]
} {
  return e.incomplete
    ? {
        hipaa_seen_incomplete: true,
        hipaa_ruled_out: e.ruledOut.slice(-HIPAA_STAMP_SEEN_CAP),
      }
    : {}
}

/**
 * leftover `ODr` @179053488. Builds the on-disk stamp object. NEVER
 * `export function ODr`.
 */
export function leftoverBuildHipaaStamp(opts: {
  principal: NonNullable<PolicyLimitsPrincipal>
  bodySha: string
  confirmedAt: number
  bodyTaints: readonly string[]
  previous: HipaaEvidence
  authority?: string
}): {
  v: 1
  identity: string
  kind: string
  sha: string
  confirmed_at: number
  hipaa_seen: string[]
  hipaa_seen_incomplete?: true
  hipaa_ruled_out?: string[]
} {
  const d = leftoverHashPrincipalDescriptor(opts.principal.descriptor)
  const p = opts.bodyTaints.includes('hipaa')
  let m: string[]
  let g: string[]
  if (opts.authority === 'prior_evidence' && !p) {
    m = opts.previous.seen.slice()
    g = opts.previous.ruledOut.slice()
  } else {
    m = opts.previous.seen.filter(_ => _ !== d)
    g = opts.previous.ruledOut.filter(_ => _ !== d)
    if (p) m.push(d)
    else if (opts.previous.incomplete) g.push(d)
  }
  const y = m.length > HIPAA_STAMP_SEEN_CAP
  return {
    v: 1,
    identity: d,
    kind: opts.principal.kind ?? 'token',
    sha: opts.bodySha,
    confirmed_at: opts.confirmedAt,
    hipaa_seen: m.slice(-HIPAA_STAMP_SEEN_CAP),
    ...leftoverHipaaStampIncompleteFields({
      ...opts.previous,
      incomplete: opts.previous.incomplete || y,
      ruledOut: g,
    }),
  }
}

/** leftover `WIo` @179053962. NEVER `export function WIo`. */
function leftoverAnonymousHipaaStamp(e: HipaaEvidence): {
  v: 1
  identity: string
  kind: string
  sha: string
  confirmed_at: number
  hipaa_seen: string[]
  hipaa_seen_incomplete?: true
  hipaa_ruled_out?: string[]
} {
  return {
    v: 1,
    identity: '0'.repeat(64),
    kind: 'token',
    sha: 'none',
    confirmed_at: 0,
    hipaa_seen: e.seen.slice(-HIPAA_STAMP_SEEN_CAP),
    ...leftoverHipaaStampIncompleteFields(e),
  }
}

/**
 * leftover `FGn` @179054102 — `kn(iFe(e), S(n), 384)`.
 * NEVER `export function FGn`.
 */
async function leftoverWriteHipaaStampFile(
  cachePath: string,
  stamp: unknown,
): Promise<void> {
  await writeFile(leftoverHipaaStampPath(cachePath), jsonStringify(stamp), {
    mode: HIPAA_STAMP_FILE_MODE,
  })
}

/**
 * leftover `$Gn` @179054143. NEVER `export function $Gn`.
 */
export async function leftoverPersistHipaaStamp(
  stamp: unknown,
): Promise<boolean> {
  if (leftoverHipaaStampSkipped()) return false
  try {
    await leftoverWriteHipaaStampFile(leftoverPolicyLimitsCachePath(), stamp)
    return true
  } catch (i) {
    logForDebugging(
      `Policy limits: failed to write the cache stamp - ${errorMessage(i)}`,
    )
    return false
  }
}

/**
 * leftover `GIo` @179054278. NEVER `export function GIo`.
 */
export async function leftoverRemoveHipaaStamp(): Promise<void> {
  if (leftoverHipaaStampSkipped()) return
  try {
    await unlink(leftoverHipaaStampPath(leftoverPolicyLimitsCachePath()))
  } catch (n) {
    if (!isENOENT(n)) {
      logForDebugging(
        `Policy limits: failed to remove the cache stamp - ${errorMessage(n)}`,
      )
    }
  }
}

export function leftoverAnonymousHipaaStampBody(
  e: HipaaEvidence,
): ReturnType<typeof leftoverAnonymousHipaaStamp> {
  return leftoverAnonymousHipaaStamp(e)
}

/**
 * leftover `Ye` @176859571
 * `e.unclassified===!0||e.storedLoginOrgless===!0`
 * leftover `Zn` @176866051
 * `try{let e=UX();return e!==null&&Ye(e)}catch{return!0}`
 */
function leftoverPrincipalUnclassifiedOrOrgless(
  seams?: Pick<PolicyLimitsAllowedSeams, 'principal'>,
): boolean {
  try {
    const e = leftoverPolicyLimitsPrincipal(seams)
    return (
      e !== null && (e.unclassified === true || e.storedLoginOrgless === true)
    )
  } catch {
    return true
  }
}

/**
 * leftover `KIo` @176858800 subset — evidence seen / incomplete vs principal.
 * Gold: `if(e===null){let r=h().oauthPrincipalMemo;if(!r?.daemonSnapshotWorker||r.principal!==null)return!1;return s.seen.length>0||s.incomplete}`.
 * Default UX()===null fail-opens (does not treat disk seen as a hit).
 * Ye-path: `n.seen.length>0||n.incomplete&&!r` where
 * `r=storedLoginOrgless&&!unclassified&&ruledOut.includes(zle(e))`.
 * Else `n.seen.includes(zle(e))||n.incomplete&&!n.ruledOut.includes(zle(e))`.
 */
function leftoverHipaaEvidenceHitsPrincipal(
  seams?: Pick<
    PolicyLimitsAllowedSeams,
    'principal' | 'hipaaEvidence' | 'skipDiskStamp'
  >,
): boolean {
  const evidence = leftoverHipaaEvidence(seams)
  let principal: PolicyLimitsPrincipal
  try {
    principal = leftoverPolicyLimitsPrincipal(seams)
  } catch {
    principal = {
      kind: 'token',
      descriptor: 'token:unreadable',
      unclassified: true,
    }
  }
  if (principal === null) {
    const r = leftoverPolicyLimitsHost().oauthPrincipalMemo
    if (!r?.daemonSnapshotWorker || r.principal !== null) return false
    return evidence.seen.length > 0 || evidence.incomplete
  }
  const i = leftoverHashPrincipalDescriptor(principal.descriptor)
  if (leftoverPrincipalUnclassifiedOrOrgless(seams)) {
    const r =
      principal.storedLoginOrgless === true &&
      principal.unclassified !== true &&
      evidence.ruledOut.includes(i)
    return evidence.seen.length > 0 || (evidence.incomplete && !r)
  }
  return (
    evidence.seen.includes(i) ||
    (evidence.incomplete && !evidence.ruledOut.includes(i))
  )
}

/**
 * leftover `oe` @176865717
 * `if(!Xn.has(e)||!C_()||yDo())return!1` then host-cache evidence reread.
 * NEVER invent disk stamp / Far. NEVER `export function oe`.
 */
export function leftoverHipaaEvidenceBlocks(
  e: string,
  seams?: PolicyLimitsAllowedSeams,
): boolean {
  if (!HIPAA_EVIDENCE_POLICY_KEYS.has(e)) return false
  const eligible = seams?.eligible ?? isPolicyLimitsEligible()
  if (!eligible) return false
  if ((seams?.tranquilCrescent ?? leftoverTranquilCrescent()) === true) {
    return false
  }
  const host = leftoverPolicyLimitsHost()
  if (host.sessionCache !== null && host.sessionAttributed) {
    const i =
      seams?.attributedBearerDigest !== undefined
        ? seams.attributedBearerDigest
        : host.attributedBearerDigest
    if (i !== null && i === host.attributedBearerDigest) return false
    if (host.evidenceRereadForBearer !== i) {
      host.evidenceRereadForBearer = i
      host.hipaaEvidenceLoaded = false
    }
    const r = leftoverHipaaEvidence(seams)
    if (
      (r.seen.length === 0 && !r.incomplete) ||
      !leftoverPrincipalUnclassifiedOrOrgless(seams)
    ) {
      return false
    }
  }
  return leftoverHipaaEvidenceHitsPrincipal(seams)
}

/**
 * leftover `SV` @176868050 — fail-open when no session cache.
 */
function leftoverFailOpenWithoutCache(
  seams?: PolicyLimitsAllowedSeams,
): boolean {
  const eligible = seams?.eligible ?? isPolicyLimitsEligible()
  if (!eligible) return false
  const host = leftoverPolicyLimitsHost()
  const n =
    seams?.restrictions !== undefined ? seams.restrictions : host.sessionCache
  return n === null || host.failOpenVerdict
}

/**
 * leftover `Dke` @176868116 — settledWithoutVerdictFor matches current principal.
 */
function leftoverSettledWithoutVerdict(
  seams?: PolicyLimitsAllowedSeams,
): boolean {
  if (!leftoverFailOpenWithoutCache(seams)) return false
  const host = leftoverPolicyLimitsHost()
  if (host.settledWithoutVerdictFor === null) return false
  const principal = leftoverPolicyLimitsPrincipal(seams)
  return host.settledWithoutVerdictFor === (principal?.descriptor ?? '')
}

/**
 * leftover `Mke` @176868282 — principal unreadable / evidence incomplete.
 */
function leftoverHipaaEvidenceUnreadable(
  seams?: PolicyLimitsAllowedSeams,
): boolean {
  let e: PolicyLimitsPrincipal
  try {
    e = leftoverPolicyLimitsPrincipal(seams)
  } catch {
    return true
  }
  if (e === null || e.unclassified) return true
  const host = leftoverPolicyLimitsHost()
  return (
    host.hipaaSeenUnreadable ||
    !host.hipaaEvidenceLoaded ||
    leftoverHipaaEvidenceHitsPrincipal(seams)
  )
}

/**
 * leftover `Jt` @176866119. Catalog + leftover `h()` hinted keys + leftover
 * `oe`/`WDr`/`UX` host-cache. No disk stamp fetch / Far. NEVER `export function Jt`.
 */
export function isPolicyLimitsAllowed(
  e: string,
  seams?: PolicyLimitsAllowedSeams,
): boolean {
  const host = leftoverPolicyLimitsHost()
  const eligible = seams?.eligible ?? isPolicyLimitsEligible()
  const n =
    seams?.restrictions !== undefined ? seams.restrictions : host.sessionCache
  const latched = seams?.latchedTaints ?? []
  if (isTranscriptScanPolicyKey(e)) {
    const s = n?.[e]
    if (s) return s.allowed === true
    return !(eligible && host.hintedDeniedKeys.includes(e))
  }
  if (!n) {
    const onCacheMiss = lookupPolicyLimitsEntry(e)?.onCacheMiss
    if (onCacheMiss !== undefined && onCacheMiss !== 'allow') {
      const holdOpen =
        onCacheMiss === 'hold' &&
        leftoverSettledWithoutVerdict(seams) &&
        !leftoverHipaaEvidenceUnreadable(seams)
      if (eligible && !holdOpen) return false
    }
    if (policyDeniedByTaints(e, latched)) return false
    if (leftoverHipaaEvidenceBlocks(e, seams)) return false
    if (host.hintedDeniedKeys.length === 0 && host.hintedTaints.length === 0) {
      return true
    }
    if (!eligible) return true
    if (host.hintedDeniedKeys.includes(e)) return false
    return evaluatePolicyLimitsAgainst(
      { restrictions: {}, compliance_taints: [] },
      e,
      host.hintedTaints,
    )
  }
  if (n[e] === undefined && host.hintedDeniedKeys.includes(e)) return false
  if (
    lookupPolicyLimitsEntry(e)?.onCacheMiss === 'hold' &&
    leftoverFailOpenWithoutCache(seams) &&
    !(
      leftoverSettledWithoutVerdict(seams) &&
      !leftoverHipaaEvidenceUnreadable(seams)
    )
  ) {
    return false
  }
  if (leftoverHipaaEvidenceBlocks(e, seams)) return false
  const r = host.sessionFromServerFetch
  return evaluatePolicyLimitsAgainst(
    {
      restrictions: n,
      compliance_taints: r ? host.complianceTaints : [],
    },
    e,
    [...latched, ...host.hintedTaints, ...(r ? [] : host.complianceTaints)],
  )
}

/**
 * leftover `se` @179089013
 * `function se(e){return e.startsWith("enforce_")||e.startsWith("require_")}`
 */
export function isEnforceOrRequirePolicyKey(e: string): boolean {
  return e.startsWith('enforce_') || e.startsWith('require_')
}

/**
 * leftover `VIo` / leftover `h()` @179070612
 * `function h(){return tGo.of(j().host)}`
 */
export type PolicyLimitsHostCache = {
  hintedEnforcedKeys: string[]
  hintedDeniedKeys: string[]
  hintedTaints: string[]
  sessionAttributed: boolean
  sessionCache: Record<string, { allowed?: boolean }> | null
  complianceTaints: string[]
  sessionFromServerFetch: boolean
  hipaaEvidenceLoaded: boolean
  hipaaEvidence: HipaaEvidence
  hipaaSeenUnreadable: boolean
  attributedBearerDigest: string | null
  evidenceRereadForBearer: string | null
  failOpenVerdict: boolean
  settledWithoutVerdictFor: string | null
  principalFromOAuthBearer: boolean
  tunnelSocket: string | null | undefined
  wifAccountDiverged: boolean
  wifSourceLocation: string | undefined
  wifRecordProfile: string | undefined
  wifRecordedOrg: string | null | undefined
  oauthPrincipalMemo: {
    key: string
    principal: PolicyLimitsPrincipal
    daemonSnapshotWorker: boolean
    expiresAtMs: number | null
  } | null
}

const EMPTY_HIPAA_EVIDENCE: HipaaEvidence = {
  seen: [],
  incomplete: false,
  ruledOut: [],
}

const policyLimitsHost: PolicyLimitsHostCache = {
  hintedEnforcedKeys: [],
  hintedDeniedKeys: [],
  hintedTaints: [],
  sessionAttributed: false,
  sessionCache: null,
  complianceTaints: [],
  sessionFromServerFetch: false,
  hipaaEvidenceLoaded: false,
  hipaaEvidence: EMPTY_HIPAA_EVIDENCE,
  hipaaSeenUnreadable: false,
  attributedBearerDigest: null,
  evidenceRereadForBearer: null,
  failOpenVerdict: false,
  settledWithoutVerdictFor: null,
  principalFromOAuthBearer: false,
  tunnelSocket: undefined,
  wifAccountDiverged: false,
  wifSourceLocation: undefined,
  wifRecordProfile: undefined,
  wifRecordedOrg: undefined,
  oauthPrincipalMemo: null,
}

/** leftover `h()` @179070612 */
export function leftoverPolicyLimitsHost(): PolicyLimitsHostCache {
  return policyLimitsHost
}

/** leftover `dropHintedTaints` @179069387 */
export function dropLeftoverPolicyHints(): void {
  policyLimitsHost.hintedEnforcedKeys = []
  policyLimitsHost.hintedDeniedKeys = []
  policyLimitsHost.hintedTaints = []
}

function uniqueCap(values: string[], cap: number): string[] {
  return [...new Set(values)].slice(0, cap)
}

/**
 * leftover `hintFromRefusedBody` @179069478
 * Skip when sessionCache && sessionAttributed.
 * `compliance_taints` filtered by leftover `KDr` taint names.
 * denied = allowed===false && !se(key); enforced = allowed===true && se(key).
 */
export function hintFromRefusedPolicyBody(e: {
  restrictions?: Record<string, { allowed?: boolean } | undefined>
  compliance_taints?: string[]
}): void {
  const host = leftoverPolicyLimitsHost()
  if (host.sessionCache !== null && host.sessionAttributed) return
  const kdr = policyDeniedUnderPairs()
  const taints = (e.compliance_taints ?? []).filter(p =>
    kdr.some(([m]) => m === p),
  )
  const restrictions = e.restrictions ?? {}
  const denied = Object.entries(restrictions)
    .filter(
      ([key, row]) =>
        row?.allowed === false && !isEnforceOrRequirePolicyKey(key),
    )
    .map(([key]) => key)
  const enforced = Object.entries(restrictions)
    .filter(
      ([key, row]) => row?.allowed === true && isEnforceOrRequirePolicyKey(key),
    )
    .map(([key]) => key)
  const nextTaints = uniqueCap(
    [...host.hintedTaints, ...taints],
    POLICY_HINT_CAP,
  )
  const nextDenied = uniqueCap(
    [...host.hintedDeniedKeys, ...denied],
    POLICY_HINT_CAP,
  )
  const nextEnforced = uniqueCap(
    [...host.hintedEnforcedKeys, ...enforced],
    POLICY_HINT_CAP,
  )
  if (
    nextTaints.length === host.hintedTaints.length &&
    nextDenied.length === host.hintedDeniedKeys.length &&
    nextEnforced.length === host.hintedEnforcedKeys.length
  ) {
    return
  }
  host.hintedTaints = nextTaints
  host.hintedDeniedKeys = nextDenied
  host.hintedEnforcedKeys = nextEnforced
}

/**
 * leftover `fLt` @179091527 / leftover `E().isPolicyEnforcedOrHintedByRefusedCache(u)`
 * `if(n?.[e]?.allowed===!0)return!0;
 *  return i.hintedEnforcedKeys.includes(e)&&n?.[e]===void 0&&(n===null||!i.sessionAttributed)&&C_()`
 * First clause wraps existing `isPolicyEnforced`. leftover `h()` supplies
 * hintedEnforcedKeys / sessionAttributed when seams omit them. `C_()` wraps
 * `isPolicyLimitsEligible`.
 */
export function isPolicyEnforcedOrHintedByRefusedCache(
  policy: string = REQUIRE_TRUSTED_DEVICES,
  seams?: Pick<
    ToolHostAttestationSeams,
    'restrictions' | 'hintedEnforcedKeys' | 'sessionAttributed' | 'eligible'
  >,
): boolean {
  const host = leftoverPolicyLimitsHost()
  const n =
    seams && 'restrictions' in seams
      ? (seams.restrictions ?? null)
      : isPolicyEnforced(policy)
        ? { [policy]: { allowed: true } }
        : null
  if (n?.[policy]?.allowed === true) return true
  const hinted = seams?.hintedEnforcedKeys ?? host.hintedEnforcedKeys
  const sessionAttributed = seams?.sessionAttributed ?? host.sessionAttributed
  const eligible = seams?.eligible ?? isPolicyLimitsEligible()
  return (
    hinted.includes(policy) &&
    n?.[policy] === undefined &&
    (n === null || !sessionAttributed) &&
    eligible
  )
}

/** leftover `Yr().attestation.malformedConfigReported` — module flag only. */
let malformedEnforceConfigReported = false

/** leftover `t0o` malformed copy @180877728 */
export const BRIDGE_ATTESTATION_MALFORMED_CONFIG_PREFIX =
  '[bridge:attestation] malformed enforce config — failing closed to accept_level=VERIFIED with no accept_statuses: '

/**
 * leftover `jtr` @202143707
 * `if(!fRr())return"off";try{return x("tengu_vast_tulip",!1)===!0?"enforce":"observe"}catch{…;"observe"}`
 * leftover `fRr` is `x("tengu_breezy_fairy", false)` — wrap GB, do not invent fRr.
 */
export function readToolHostTulipMode(): ToolHostTulipMode {
  try {
    if (!getFeatureValue_CACHED_MAY_BE_STALE(TENGU_BREEZY_FAIRY, false)) {
      return 'off'
    }
  } catch {
    return 'off'
  }
  try {
    return getFeatureValue_CACHED_MAY_BE_STALE(TENGU_VAST_TULIP, false) === true
      ? 'enforce'
      : 'observe'
  } catch {
    logForDebugging(TOOL_HOST_ATTESTATION_TULIP_THREW, { level: 'warn' })
    return 'observe'
  }
}

/**
 * leftover `uFe` @180876947 — device_attestation_status normalize.
 */
export function normalizeDeviceAttestationStatus(
  e: unknown,
): DeviceAttestationStatus {
  if (e === undefined || e === null) return 'UNSPECIFIED'
  if (typeof e === 'number') {
    return DEVICE_ATTESTATION_STATUS_BY_INDEX[e] ?? 'UNSPECIFIED'
  }
  if (typeof e !== 'string') return 'UNSPECIFIED'
  if (e === 'server_authored') return 'SERVER_AUTHORED'
  if (e === 'server_replayed') return 'SERVER_REPLAYED'
  if (e === 'transitively_vouched') return 'TRANSITIVELY_VOUCHED'
  const r = e.startsWith(DEVICE_ATTESTATION_STATUS_PREFIX)
    ? e.slice(DEVICE_ATTESTATION_STATUS_PREFIX.length)
    : e
  return (
    DEVICE_ATTESTATION_STATUSES.find(status => status === r) ?? 'UNSPECIFIED'
  )
}

/**
 * leftover `gzn` @180877408
 * `if(e==="SERVICE_VOUCHED")return!0;let s=z.findIndex((n)=>n===e);return s!==-1&&s<=z.indexOf(r)`
 */
export function meetsAttestationLevel(
  status: string,
  acceptLevel: string,
): boolean {
  if (status === 'SERVICE_VOUCHED') return true
  const s = (ATTESTATION_MEETS_LEVEL_LADDER as readonly string[]).indexOf(
    status,
  )
  const r = (ATTESTATION_MEETS_LEVEL_LADDER as readonly string[]).indexOf(
    acceptLevel,
  )
  return s !== -1 && s <= r
}

/**
 * leftover `t0o` @180877728 — enforce:true; malformed → VERIFIED + empty statuses.
 */
export function parseBridgeAttestationEnforceConfig(
  e: unknown,
): ToolHostAttestationPolicy {
  const parsed = parseEnforceConfigObject(e)
  if (!parsed.ok && !malformedEnforceConfigReported) {
    malformedEnforceConfigReported = true
    try {
      logForDebugging(
        `${BRIDGE_ATTESTATION_MALFORMED_CONFIG_PREFIX}${parsed.message}`,
        { level: 'error' },
      )
      logEvent('bridge_event_attestation', {
        reason:
          'malformed_config' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } catch (err) {
      logForDebugging(
        `[bridge:attestation] malformed-config report threw: ${errorMessage(err)}`,
        { level: 'error' },
      )
    }
  }
  return {
    enforce: true,
    acceptLevel: parsed.ok ? parsed.acceptLevel : 'VERIFIED',
    acceptStatuses: new Set(parsed.ok ? parsed.acceptStatuses : []),
  }
}

function parseEnforceConfigObject(
  e: unknown,
):
  | { ok: true; acceptLevel: string; acceptStatuses: string[] }
  | { ok: false; message: string } {
  if (typeof e !== 'object' || e === null) {
    return { ok: false, message: 'expected object' }
  }
  const row = e as { accept_level?: unknown; accept_statuses?: unknown }
  let acceptLevel = 'VERIFIED'
  if (row.accept_level !== undefined) {
    if (
      typeof row.accept_level !== 'string' ||
      !(ATTESTATION_MEETS_LEVEL_LADDER as readonly string[]).includes(
        row.accept_level,
      )
    ) {
      return { ok: false, message: 'accept_level' }
    }
    acceptLevel = row.accept_level
  }
  let acceptStatuses: string[] = []
  if (row.accept_statuses !== undefined) {
    if (!Array.isArray(row.accept_statuses)) {
      return { ok: false, message: 'accept_statuses' }
    }
    for (const status of row.accept_statuses) {
      if (
        typeof status !== 'string' ||
        !(ATTESTATION_ACCEPT_STATUSES as readonly string[]).includes(status)
      ) {
        return { ok: false, message: 'accept_statuses' }
      }
    }
    acceptStatuses = row.accept_statuses as string[]
  }
  return { ok: true, acceptLevel, acceptStatuses }
}

/**
 * leftover `Yle` @180890124
 * `if(!x("tengu_bridge_attestation_enforce",!1))return hzn;
 *  if(!x(f,!1)||!E().isPolicyEnforcedOrHintedByRefusedCache(u))return hzn;
 *  return t0o(x("tengu_bridge_attestation_enforce_config",{}))`
 * leftover `E()` CALL `isPolicyEnforcedOrHintedByRefusedCache(require_trusted_devices)`.
 */
export function readToolHostAttestationPolicy(
  seams?: ToolHostAttestationSeams,
): ToolHostAttestationPolicy {
  if (seams?.policy !== undefined) return seams.policy
  try {
    if (
      !getFeatureValue_CACHED_MAY_BE_STALE(
        TENGU_BRIDGE_ATTESTATION_ENFORCE,
        false,
      )
    ) {
      return DEFAULT_TOOL_HOST_ATTESTATION_POLICY
    }
    if (
      !getFeatureValue_CACHED_MAY_BE_STALE(
        TENGU_SESSIONS_ELEVATED_AUTH_ENFORCEMENT,
        false,
      ) ||
      !(
        seams?.isPolicyEnforcedOrHintedByRefusedCache?.() ??
        isPolicyEnforcedOrHintedByRefusedCache(REQUIRE_TRUSTED_DEVICES, seams)
      )
    ) {
      return DEFAULT_TOOL_HOST_ATTESTATION_POLICY
    }
    return parseBridgeAttestationEnforceConfig(
      getFeatureValue_CACHED_MAY_BE_STALE(
        TENGU_BRIDGE_ATTESTATION_ENFORCE_CONFIG,
        {},
      ),
    )
  } catch {
    return DEFAULT_TOOL_HOST_ATTESTATION_POLICY
  }
}

/**
 * leftover `aMr` @180883700 — leftover `s` always `{isCloudWorker:!1}`.
 */
export function assessToolHostAttestation(
  status: string,
  policy: ToolHostAttestationPolicy,
  opts?: { isCloudWorker?: boolean; vouchWithheld?: boolean },
): { status: string; meetsLevel: boolean; configException: boolean } {
  const isCloudWorker = opts?.isCloudWorker ?? false
  const vouchWithheld = opts?.vouchWithheld ?? false
  const remapped =
    !isCloudWorker &&
    (status === 'SERVER_AUTHORED' || status === 'SERVER_REPLAYED')
      ? 'UNSPECIFIED'
      : status
  const transitivelyMeets =
    !isCloudWorker &&
    remapped === 'TRANSITIVELY_VOUCHED' &&
    meetsAttestationLevel('VERIFIED_KEYLESS_DEVICE', policy.acceptLevel) &&
    !vouchWithheld
  return {
    status: remapped,
    meetsLevel:
      transitivelyMeets || meetsAttestationLevel(remapped, policy.acceptLevel),
    configException:
      policy.acceptStatuses.has(remapped) ||
      (remapped === 'TRANSITIVELY_VOUCHED' &&
        policy.acceptStatuses.has('UNSPECIFIED')),
  }
}

/**
 * leftover `s` @202143914
 * `function s(e){let o=Yle(),{status:r,meetsLevel:n,configException:i}=aMr(e,o,{isCloudWorker:!1});return{status:r,verdict:!o.enforce?"not_policed":n?"pass":i?"config_exception":"below_floor"}}`
 */
export function gradeToolHostAttestation(
  status: string,
  policy: ToolHostAttestationPolicy = DEFAULT_TOOL_HOST_ATTESTATION_POLICY,
  seams?: Pick<ToolHostAttestationSeams, 'meetsLevel' | 'configException'>,
): { status: string; verdict: ToolHostAttestationVerdict } {
  const assessed = assessToolHostAttestation(status, policy)
  const meets =
    seams?.meetsLevel?.(assessed.status, policy) ?? assessed.meetsLevel
  const configException =
    seams?.configException?.(assessed.status, policy) ??
    assessed.configException
  return {
    status: assessed.status,
    verdict: !policy.enforce
      ? 'not_policed'
      : meets
        ? 'pass'
        : configException
          ? 'config_exception'
          : 'below_floor',
  }
}

/**
 * leftover `TIe` @202144104
 * `function TIe(e){let o=jtr();return o==="off"?void 0:{mode:o,...s(uFe(e))}}`
 */
export function attestToolHostStatus(
  e: unknown,
  seams?: ToolHostAttestationSeams,
): ToolHostAttestation | undefined {
  const mode = (seams?.tulipMode ?? readToolHostTulipMode)()
  if (mode === 'off') return
  const status = (seams?.normalizeStatus ?? normalizeDeviceAttestationStatus)(e)
  const policy = seams?.policy ?? readToolHostAttestationPolicy(seams)
  return { mode, ...gradeToolHostAttestation(status, policy, seams) }
}

/**
 * leftover `RIe` @202144178
 * `function RIe(e){return e?.mode==="enforce"&&e.verdict==="below_floor"}`
 */
export function isToolHostAttestationHeldBack(
  e: ToolHostAttestation | undefined,
): boolean {
  return e?.mode === 'enforce' && e.verdict === 'below_floor'
}

/**
 * leftover `_o` @202276282 BODY.
 * Semantic export; NEVER `export function _o`.
 */
export function leftoverHookAttestationBag(
  e: unknown,
  seams?: ToolHostAttestationSeams,
): { attestation: ToolHostAttestation; heldBack: boolean } | undefined {
  const n = attestToolHostStatus(e, seams)
  if (n === undefined) return
  return { attestation: n, heldBack: isToolHostAttestationHeldBack(n) }
}

/**
 * leftover `$2e` @202144248
 * `function $2e(){let e=TIe("UNSPECIFIED");return{attestation:e,heldBack:RIe(e)}}`
 */
export function unspecifiedToolHostAttestationBag(
  seams?: ToolHostAttestationSeams,
): {
  attestation: ToolHostAttestation | undefined
  heldBack: boolean
} {
  const e = attestToolHostStatus('UNSPECIFIED', seams)
  return { attestation: e, heldBack: isToolHostAttestationHeldBack(e) }
}

/**
 * leftover `nVt` @202144326
 * `function nVt(e){try{e?.(lSt,Di["repository_trust.served_calls.unattested"])}catch(o){t(\`[remote-tools] the notice sink threw on ${lSt}: ${l(o)}\`,{level:"error"})}}`
 */
export function notifyServedCallsUnattested(
  sink?: (key: string, text: string) => void,
): void {
  try {
    sink?.(SERVED_CALLS_UNATTESTED_NOTICE_KEY, SERVED_CALLS_UNATTESTED_COPY)
  } catch (err) {
    logForDebugging(
      `[remote-tools] the notice sink threw on ${SERVED_CALLS_UNATTESTED_NOTICE_KEY}: ${errorMessage(err)}`,
      { level: 'error' },
    )
  }
}
