/**
 * densable yt / zl / jD / v1 / B5 / xN / aKe / G0 / Gtn / Sh / xct / fq / ine /
 * Tu / hat / AE / Pbe / md — Artifact ownership & provenance lookups for the
 * read_file / read_asset / list_files / list_assets permission branch (2.1.289).
 * Gold chunks: nykhqmnf (yt zl jD qH Yjt md R7e _U iz KBe Uht A), aw8dyr84
 * (v1 B5 xN aKe Gtn Oat B1n), fmsfw5my (G0 Pbe _b Hoe HPe ZGo GBe), 1djxnjdt
 * (Sh vRo xct GHt bWn CRo Ue P4e xFe PFe), xwgfbhhb (ine fq g f), gh922bea (Tu),
 * veeqfwp6 (hat btn), 3qe768sr (j7 Oe), fvtx9p4b (AE).
 */
import { getOauthConfig } from '../../../constants/oauth.js'
import type { ToolUseContext } from '../../../Tool.js'
import type { PermissionDenyDecision } from '../../../types/permissions.js'
import type { ParsedArtifactUrl } from '../../../utils/artifactUrl.js'
import { logForDebugging } from '../../../utils/debug.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { DL } from '../frameDl.js'
import { fetchFrameBoot, frameControlPlaneHeaders } from '../mint.js'
import {
  clearAllProbeBoots,
  ip,
  jnt,
  Kgl,
  rememberProbeBoot,
  type OwnershipProbeResult,
  Tgr,
} from '../ownership.js'
import {
  type ArtifactAutoReactStore,
  type ArtifactShareStatus,
  un,
} from '../store.js'
import { _U, G0, Gtn, md, R7e, Yw } from './consent.js'

export { G0, Gtn, md }

export type ArtifactTypeLock = { slug?: string; [key: string]: unknown }

/** densable shareStatus.bySlug row — provenance fields gold `A()` carries. */
export type ArtifactProvenanceStatus = ArtifactShareStatus & {
  outsideOrgReader?: boolean
  external?: boolean
  typeLocked?: boolean
  typeSlug?: string
  typeLock?: ArtifactTypeLock | null
  probeGone?: boolean
  authoredByOthers?: boolean
  outsideWriter?: boolean
}

export type AttestedTypeKind =
  | 'first_party_type'
  | 'org_pinned_instance'
  | 'pipeline_instance'
  | 'template_instance'

type AttestedTypeEntry = {
  mark?: { kind: AttestedTypeKind; issuedAt: number }
  revokedAt?: Partial<Record<AttestedTypeKind, number>>
}

export type ArtifactTypeDetail = {
  slug: string
  title?: string
  firstParty: boolean
}

type TypeDescribeResult =
  | { err: null; detail: ArtifactTypeDetail }
  | { err: string; reason: string }

type TypeDescription = {
  askedAt: number
  until: number
  answer: Promise<ArtifactTypeDetail | undefined>
}

type ProvenanceState = {
  /** densable shareStatus.accountBoundaryAt */
  accountBoundaryAt: number | undefined
  attestedTypeArtifacts: Map<string, AttestedTypeEntry>
  typeDescriptions: Map<string, TypeDescription>
  contentHostEgressProbed: Map<string, number>
  contentHostEgressUnanswered: Set<string>
  contentHostEgressInFlight: Map<string, Promise<void>>
  sandboxEgress: Map<string, { setting: string; at: number }>
}

const stateByStore = new WeakMap<ArtifactAutoReactStore, ProvenanceState>()

/** densable X() provenance subset — lives and dies with the un() store. */
export function provenanceState(): ProvenanceState {
  const store = un()
  let st = stateByStore.get(store)
  if (st === undefined) {
    st = {
      accountBoundaryAt: undefined,
      attestedTypeArtifacts: new Map(),
      typeDescriptions: new Map(),
      contentHostEgressProbed: new Map(),
      contentHostEgressUnanswered: new Set(),
      contentHostEgressInFlight: new Map(),
      sandboxEgress: new Map(),
    }
    stateByStore.set(store, st)
  }
  return st
}

type ProvenanceDeps = { fetch?: typeof globalThis.fetch }

let depsOverride: ProvenanceDeps | null = null

export function setProvenanceDepsForTests(deps: ProvenanceDeps | null): void {
  depsOverride = deps
}

export function resetProvenanceStateForTests(): void {
  stateByStore.delete(un())
  depsOverride = null
}

/**
 * densable account-boundary wipe subset — stamp accountBoundaryAt and clear
 * shareStatus.probeBoots (gold also clears richer share fields tip may not hold).
 */
export function noteShareAccountBoundary(at: number = Date.now()): void {
  provenanceState().accountBoundaryAt = at
  clearAllProbeBoots()
}

/** densable KE */
const LIVE_DOC_KIND = 'live-doc'
/** densable I7e */
const BOOT_ORG_MISMATCH = 'boot_org_mismatch'
/** densable ie */
const ACCOUNT_CHANGED = 'account_changed'
/** densable Xn */
const ARTIFACT_SLUG_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** densable Fe */
const ATTESTED_RANK: Record<AttestedTypeKind, number> = {
  first_party_type: 0,
  org_pinned_instance: 1,
  pipeline_instance: 2,
  template_instance: 3,
}
/** densable rn */
const TYPE_PREFETCH_BUDGET_MS = 3000
/** densable Ln (veeqfwp6) */
const TYPE_DESCRIPTION_TTL_MS = 600_000
/** densable Mn */
const TYPE_DESCRIPTION_ERROR_TTL_MS = 60_000
/** densable Et (3qe768sr) */
const TYPE_DESCRIBE_MAX_BYTES = 1_048_576
/** densable kt (1djxnjdt) */
const SANDBOX_EGRESS_TTL_MS = 600_000
/** densable P / M / N (fmsfw5my) */
const EGRESS_PROBE_TIMEOUT_MS = 3000
const EGRESS_PROBE_FRESH_MS = 600_000
const EGRESS_PROBE_MAX_BYTES = 262_144
/** densable s (VKt) */
const COWORK_REMOTE_ENTRYPOINTS = new Set([
  'remote_cowork',
  'remote_cowork_trigger',
])

/** densable xFe */
const OTHER_ORG_ARTIFACT =
  "this Artifact is in another of the user's organizations, not the one this session is signed in to"
/** densable PFe */
const OTHER_ORG_REMEDY =
  'the user runs /login and signs in to that organization'
/** densable Mlt */
const OTHER_ORG_UNREACHABLE = `${OTHER_ORG_ARTIFACT} — nothing in this session can reach it until ${OTHER_ORG_REMEDY}`
/** densable BRr */
const OTHER_ORG_REASON = "Artifact is in another of the user's organizations"

/** densable mo */
function mo(): 'prod' | 'staging' {
  return getOauthConfig().CLAUDE_AI_ORIGIN.includes('staging')
    ? 'staging'
    : 'prod'
}

/** densable yWe */
function yWe(parsed: ParsedArtifactUrl): string {
  return `https://${parsed.slug}.frame.${parsed.env === 'staging' ? 'staging.' : ''}claudeusercontent.com`
}

/** densable An */
function An(parsed: ParsedArtifactUrl): string {
  return `https://claude.ai/code/artifact/${parsed.slug}`
}

/** densable de — permission context mode after permission_mode layers. */
function de(
  context: Pick<ToolUseContext, 'getAppState' | 'permissionLayers'>,
): string {
  const permissions = context.getAppState().toolPermissionContext
  let mode: string = permissions.mode
  for (const layer of context.permissionLayers ?? []) {
    if (layer.kind !== 'permission_mode') continue
    const next = Reflect.get(layer, 'mode')
    if (typeof next !== 'string') continue
    if (
      next === 'bypassPermissions' &&
      !permissions.isBypassPermissionsModeAvailable
    ) {
      continue
    }
    mode = next
  }
  return mode
}

/** densable yt — share / ownership status for a slug. */
export function yt(slug: string): ArtifactProvenanceStatus | undefined {
  return ip(slug)
}

/** densable zl — confirmed the user's own artifact. */
export function zl(status: ArtifactProvenanceStatus | undefined): boolean {
  return jnt(status)
}

/** densable jD — confirmed someone else's artifact. */
export function jD(status: ArtifactProvenanceStatus | undefined): boolean {
  return Tgr(status)
}

/** densable v1 — co-written or a live doc. */
export function v1(status: ArtifactProvenanceStatus | undefined): boolean {
  return status?.cowritten === true || status?.artifactKind === LIVE_DOC_KIND
}

/** densable B5 — made from an artifact type. */
export function B5(status: ArtifactProvenanceStatus | undefined): boolean {
  return status?.typeLocked === true || status?.typeLock != null
}

/** densable xN — own artifact made from a type (not a live doc). */
export function xN(
  status: ArtifactProvenanceStatus | undefined,
  own: boolean = zl(status),
): boolean {
  return own && B5(status) && status?.artifactKind !== LIVE_DOC_KIND
}

/** densable wF */
function wF(status: ArtifactProvenanceStatus | undefined): string | undefined {
  return status?.typeLock?.slug ?? status?.typeSlug
}

/** densable aKe — own artifact made from a published first-party type. */
export function aKe(
  status: ArtifactProvenanceStatus | undefined,
  own: boolean = zl(status),
): boolean {
  const typeSlug = wF(status)
  return (
    xN(status, own) &&
    typeSlug !== undefined &&
    Sh(typeSlug) === 'first_party_type'
  )
}

/** densable qH — issued before the last account switch. */
function qH(issuedAt: number): boolean {
  const { accountBoundaryAt } = provenanceState()
  return accountBoundaryAt !== undefined && issuedAt <= accountBoundaryAt
}

/** densable Yjt */
function Yjt(status: ArtifactProvenanceStatus | undefined): boolean {
  return (
    status?.probeFailed === true && status.probeErrorCode === BOOT_ORG_MISMATCH
  )
}

/** densable Sh — attested catalog tier for a slug. */
export function Sh(slug: string): AttestedTypeKind | undefined {
  return provenanceState().attestedTypeArtifacts.get(slug)?.mark?.kind
}

/** densable vRo */
function vRo(slug: string): boolean {
  return Sh(slug) !== undefined
}

/** densable xct — tier label for "Reading the files of X needs no approval". */
export function xct(tier: AttestedTypeKind): string | undefined {
  switch (tier) {
    case 'first_party_type':
      return 'a published first-party Artifact type'
    case 'org_pinned_instance':
      return "an Artifact the organization's admins pinned for its type (its design system or template)"
    case 'pipeline_instance':
      return "a template the organization's publishing pipeline owns"
    case 'template_instance':
      return "a design system (an Artifact made from a template Artifact type) in the user's organization"
  }
}

/** densable GHt — mark slug with an attested tier. */
export function GHt(
  slug: string,
  kind: AttestedTypeKind,
  issuedAt: number,
): void {
  if (qH(issuedAt)) return
  const { attestedTypeArtifacts } = provenanceState()
  const entry = attestedTypeArtifacts.get(slug) ?? {}
  const revoked = entry.revokedAt?.[kind]
  if (revoked !== undefined && issuedAt <= revoked) return
  const mark = entry.mark
  if (
    mark === undefined ||
    issuedAt > mark.issuedAt ||
    (issuedAt === mark.issuedAt &&
      ATTESTED_RANK[kind] < ATTESTED_RANK[mark.kind])
  ) {
    attestedTypeArtifacts.set(slug, { ...entry, mark: { kind, issuedAt } })
  }
}

/** densable bWn — revoke attested tiers for slug. */
export function bWn(
  slug: string,
  kinds: AttestedTypeKind[],
  issuedAt: number,
): void {
  if (qH(issuedAt)) return
  const { attestedTypeArtifacts } = provenanceState()
  const entry = attestedTypeArtifacts.get(slug) ?? {}
  const revokedAt = { ...entry.revokedAt }
  for (const kind of kinds) {
    revokedAt[kind] = Math.max(revokedAt[kind] ?? issuedAt, issuedAt)
  }
  const mark = entry.mark
  const kept =
    mark !== undefined &&
    !(kinds.includes(mark.kind) && mark.issuedAt <= issuedAt)
      ? mark
      : undefined
  attestedTypeArtifacts.set(slug, {
    ...(kept !== undefined ? { mark: kept } : {}),
    revokedAt,
  })
}

/** densable pe (3qe768sr) — a listing scoped to anthropic. */
function hasFirstPartyListing(listings: unknown): boolean {
  if (!Array.isArray(listings)) return false
  return listings.some(
    listing =>
      listing !== null &&
      typeof listing === 'object' &&
      Reflect.get(listing, 'scope') === 'anthropic',
  )
}

/** densable Oe */
function Oe(slug: string, listings: unknown, issuedAt: number): void {
  if (hasFirstPartyListing(listings)) GHt(slug, 'first_party_type', issuedAt)
  else bWn(slug, ['first_party_type'], issuedAt)
}

/** densable Li / eV (Qke) */
function Qke(): boolean {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) return false
  const kind = process.env.CLAUDE_CODE_ENVIRONMENT_KIND
  return kind === undefined || kind === 'byoc'
}

/** densable Ue — record (or withdraw) the sandbox egress setting for env. */
export function Ue(env: string, setting: string | undefined): void {
  const st = provenanceState()
  if (setting === undefined) {
    if (st.sandboxEgress.delete(env)) {
      logForDebugging(`[artifact] sandbox egress setting for ${env} withdrawn`)
    }
    return
  }
  st.sandboxEgress.set(env, { setting, at: Date.now() })
  logForDebugging(`[artifact] sandbox egress setting for ${env}: ${setting}`)
}

/** densable CRo — sandbox network off for env (undefined = unknown). */
function CRo(env: string = mo()): boolean | undefined {
  if (!Qke()) {
    return isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
      process.env.CLAUDE_CODE_ENVIRONMENT_KIND !== 'bridge'
      ? undefined
      : false
  }
  const entry = provenanceState().sandboxEgress.get(env)
  if (entry === undefined || Date.now() - entry.at >= SANDBOX_EGRESS_TTL_MS) {
    return undefined
  }
  return entry.setting === 'disabled'
}

/** densable Oat */
export function Oat(
  parsed: ParsedArtifactUrl | undefined,
): boolean | undefined {
  return CRo(parsed?.env)
}

/** densable GQ bag — iz also accepts the gold jjt fake context. */
export type ArtifactConsentSlugBag = {
  artifactConsentEpoch?: unknown
  artifactReadConsentSlugs?: unknown
  artifactAssetReadHumanConsentSlugs?: unknown
  artifactAssetReadConsentSlugs?: unknown
  getAppState?: () => Record<string, unknown>
}

/** densable iz(CJe(context)) — GQ epoch-guarded AppState consent slug map. */
export function iz(
  context: ArtifactConsentSlugBag | Pick<ToolUseContext, 'getAppState'>,
  key: string,
  slug: string,
): boolean {
  const appState =
    typeof context.getAppState === 'function' ? context.getAppState() : context
  const epoch = Reflect.get(appState, 'artifactConsentEpoch') ?? 0
  if (epoch !== un().accountEpoch) return false
  const bySlug = Reflect.get(appState, key)
  if (bySlug === null || typeof bySlug !== 'object') return false
  return Reflect.get(bySlug, slug) === true
}

/**
 * densable artifactRegistries — consentEpoch + sharedReadConsent getters.
 * Gold lives on ToolUseContext; tip analog is AppState maps.
 */
export type ArtifactRegistries = {
  consentEpoch: { get(): number }
  sharedReadConsent: { get(): Record<string, boolean> | undefined }
}

/** densable jjt — iz on registries' sharedReadConsent map. */
export function jjt(
  registries: ArtifactRegistries | undefined,
  slug: string,
): boolean {
  if (registries === undefined) return false
  return iz(
    {
      artifactConsentEpoch: registries.consentEpoch.get(),
      artifactReadConsentSlugs: registries.sharedReadConsent.get(),
    },
    'artifactReadConsentSlugs',
    slug,
  )
}

/** AppState analog of gold `n.artifactRegistries`. */
export function artifactRegistriesFromContext(
  context: Pick<ToolUseContext, 'getAppState'> & {
    artifactRegistries?: ArtifactRegistries
  },
): ArtifactRegistries | undefined {
  if (context.artifactRegistries !== undefined)
    return context.artifactRegistries
  const appState = context.getAppState() as Record<string, unknown>
  return {
    consentEpoch: {
      get: () => Number(Reflect.get(appState, 'artifactConsentEpoch') ?? 0),
    },
    sharedReadConsent: {
      get: () =>
        Reflect.get(appState, 'artifactReadConsentSlugs') as
          | Record<string, boolean>
          | undefined,
    },
  }
}

/** densable HPe / VKt — remote Cowork surface. */
function HPe(): boolean {
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  return entrypoint !== undefined && COWORK_REMOTE_ENTRYPOINTS.has(entrypoint)
}

/** densable ZGo */
function ZGo(parsed: ParsedArtifactUrl): boolean {
  return (
    un().contentHostEgressDenied.has(parsed.env) ||
    provenanceState().contentHostEgressUnanswered.has(yWe(parsed))
  )
}

/** densable _b */
function _b(parsed: ParsedArtifactUrl | undefined): boolean {
  return parsed !== undefined && HPe() && ZGo(parsed)
}

/** densable Hoe (U7n === "person") */
function Hoe(slug: string): boolean {
  return G0(yt(slug))
}

/**
 * densable `_b(ge(e))` — remote Cowork content-host egress is denied / unanswered.
 * Semantic export for page-consent NCo (invent-ban `export function _b`).
 */
export function isRemoteCoworkContentHostDenied(
  parsed: ParsedArtifactUrl | undefined,
): boolean {
  return _b(parsed)
}

/**
 * densable Hoe — outside-org public reader (Yw on) needs a person answer.
 * Semantic export for page-consent NCo (invent-ban `export function Hoe`).
 */
export function isOutsideOrgPersonAsk(slug: string): boolean {
  return Hoe(slug)
}

/** densable Pbe — only a person can answer this ask. */
export function Pbe(isOwn: boolean, parsed: ParsedArtifactUrl): boolean {
  return !isOwn && (_b(parsed) || Hoe(parsed.slug))
}

/** densable f — attested someone-else's artifact with a fresh probe. */
function f(slug: string): boolean {
  const status = yt(slug)
  return (
    jD(status) &&
    !G0(status) &&
    status?.lastProbeIssuedAt !== undefined &&
    !qH(status.lastProbeIssuedAt) &&
    vRo(slug)
  )
}

/** densable p — probed-gone first-party-type artifact, attested this account. */
export function attestedGoneTypeRead(
  context: Pick<ToolUseContext, 'getAppState' | 'permissionLayers'>,
  slug: string,
): boolean {
  const status = yt(slug)
  return (
    de(context) !== 'plan' &&
    status?.probeFailed === true &&
    status.probeGone === true &&
    status.lastProbeIssuedAt !== undefined &&
    !qH(status.lastProbeIssuedAt) &&
    Sh(slug) === 'first_party_type'
  )
}

/** densable fq — attested foreign read outside plan mode. */
export function fq(
  context: Pick<ToolUseContext, 'getAppState' | 'permissionLayers'>,
  slug: string,
): boolean {
  return de(context) !== 'plan' && f(slug)
}

/** densable ine — read of this artifact already approved this conversation. */
export function ine(
  context: Pick<ToolUseContext, 'getAppState' | 'permissionLayers'>,
  parsed: ParsedArtifactUrl,
  isOwn: boolean,
): boolean {
  if (fq(context, parsed.slug) || aKe(yt(parsed.slug), isOwn)) return true
  const planned = de(context) === 'plan'
  if (md() && !planned) {
    const status = yt(parsed.slug)
    if (G0(status)) {
      return (
        R7e('foreign_read', parsed.slug) ||
        iz(context, 'artifactAssetReadHumanConsentSlugs', parsed.slug)
      )
    }
    return (
      isOwn ||
      (jD(status) && Oat(parsed) === false) ||
      (Pbe(isOwn, parsed)
        ? R7e('foreign_read', parsed.slug)
        : _U('foreign_read', parsed.slug))
    )
  }
  return iz(
    context,
    planned || Pbe(isOwn, parsed)
      ? 'artifactAssetReadHumanConsentSlugs'
      : 'artifactAssetReadConsentSlugs',
    parsed.slug,
  )
}

/** densable WQ / Z */
function denyReasonHeader(headers: Headers): string | undefined {
  const value = headers.get('x-deny-reason')
  return value !== null && value.length <= 64 && /^[a-z0-9_]+$/.test(value)
    ? value
    : undefined
}

/** densable pe (nykhqmnf) — media type before `;`, trimmed, lowercased. */
function mediaType(headers: Headers): string {
  const raw = headers.get('content-type')
  if (raw === null) return ''
  const semi = raw.indexOf(';')
  return (semi === -1 ? raw : raw.slice(0, semi)).trim().toLowerCase()
}

/** densable Ibe / Ujt — the content host's own plain-text answer. */
function isHostPlainAnswer(
  headers: Headers,
  body: string,
  reason: string,
): boolean {
  return (
    mediaType(headers) === 'text/plain' &&
    body.trim() === reason &&
    headers.get('x-proxy-error') === null &&
    denyReasonHeader(headers) === undefined
  )
}

/** densable k2 */
function isProxyAllowlistDenial(status: number, headers: Headers): boolean {
  return (
    status === 403 &&
    (headers.get('x-proxy-error') === 'blocked-by-allowlist' ||
      headers.get('x-deny-reason') === 'host_not_allowed')
  )
}

/** densable j (fmsfw5my) — one `/_warmup` egress probe of the content host. */
async function probeContentHost(
  parsed: ParsedArtifactUrl,
  host: string,
  signal: AbortSignal,
): Promise<void> {
  const st = provenanceState()
  const answered = (): void => {
    st.contentHostEgressUnanswered.delete(host)
    st.contentHostEgressProbed.set(host, Date.now())
  }
  const unreachable = (why: string): void => {
    logForDebugging(
      `[artifact] egress probe of ${host}: ${why}; reading the host as unreachable for this check`,
    )
    st.contentHostEgressProbed.delete(host)
    st.contentHostEgressUnanswered.add(host)
  }
  const denied = (): void => {
    st.contentHostEgressProbed.delete(host)
    st.contentHostEgressUnanswered.add(host)
    un().contentHostEgressDenied.add(parsed.env)
  }
  const fetchImpl = depsOverride?.fetch ?? globalThis.fetch
  let res: Response
  let body: string
  try {
    res = await fetchImpl(`${host}/_warmup`, {
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(EGRESS_PROBE_TIMEOUT_MS),
      ]),
      redirect: 'manual',
    })
    const buf = await res.arrayBuffer()
    if (buf.byteLength > EGRESS_PROBE_MAX_BYTES) {
      return unreachable('an answer larger than the cap')
    }
    body = new TextDecoder('utf-8').decode(buf)
  } catch (error) {
    if (signal.aborted) throw error
    return unreachable('no answer')
  }
  if (isProxyAllowlistDenial(res.status, res.headers)) return denied()
  if (
    !(
      (res.status >= 200 && res.status < 300) ||
      (res.status === 403 &&
        isHostPlainAnswer(res.headers, body, 'forbidden')) ||
      (res.status === 404 && isHostPlainAnswer(res.headers, body, 'not found'))
    )
  ) {
    return unreachable(`unrecognised HTTP ${res.status}`)
  }
  return answered()
}

/** densable GBe — content-host egress probe, deduped per host. */
async function GBe(
  parsed: ParsedArtifactUrl,
  signal: AbortSignal,
): Promise<void> {
  const st = provenanceState()
  const host = yWe(parsed)
  if (un().contentHostEgressDenied.has(parsed.env)) {
    st.contentHostEgressProbed.delete(host)
    st.contentHostEgressUnanswered.add(host)
    return
  }
  const probedAt = st.contentHostEgressProbed.get(host)
  if (probedAt !== undefined && Date.now() - probedAt < EGRESS_PROBE_FRESH_MS) {
    return
  }
  const inFlight = st.contentHostEgressInFlight.get(host)
  if (inFlight !== undefined) {
    return inFlight.catch(error => {
      if (signal.aborted) throw error
      return GBe(parsed, signal)
    })
  }
  const run = probeContentHost(parsed, host, signal).finally(() => {
    st.contentHostEgressInFlight.delete(host)
  })
  st.contentHostEgressInFlight.set(host, run)
  return run
}

type CapsReadBack = {
  capabilities?: unknown
  contract?: unknown
  typeLock?: { current?: unknown; latest?: unknown }
}

type ProvenanceProbeResult = OwnershipProbeResult & {
  outsideOrgReader?: boolean
  provenance?: Partial<ArtifactProvenanceStatus>
  /** densable a.boot — non-err frame boot for probeBoots write. */
  boot?: import('../store.js').ProbeCachedBoot
  /** densable Oe — parsed boot.readback when Tu asked readBack. */
  readBack?: CapsReadBack
}

/** densable Obe */
function Obe(value: unknown): boolean | undefined {
  return value === true ? true : value === false ? false : undefined
}

/** densable Rt — boot `typeFacts`. */
type BootTypeFacts = {
  firstPartyType?: boolean
  typeFirstParty?: boolean
  template?: boolean
}

function parseTypeFacts(value: unknown): BootTypeFacts | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const facts: BootTypeFacts = {}
  for (const key of ['firstPartyType', 'typeFirstParty', 'template'] as const) {
    const v = Reflect.get(value, key)
    if (v === undefined) continue
    if (typeof v !== 'boolean') return undefined
    facts[key] = v
  }
  return facts
}

/** densable De — attest catalog tiers from boot `typeFacts`. */
function De(
  slug: string,
  typeFacts: unknown,
  typeSlug: string | undefined,
  issuedAt: number,
  opts: { external: boolean },
): void {
  if (typeFacts === undefined) return
  const facts = parseTypeFacts(typeFacts)
  if (facts === undefined) return
  if (facts.firstPartyType === true) {
    if (!opts.external) GHt(slug, 'first_party_type', issuedAt)
    return
  }
  if (facts.typeFirstParty !== true) return
  if (typeSlug !== undefined && ARTIFACT_SLUG_RE.test(typeSlug)) {
    GHt(typeSlug, 'first_party_type', issuedAt)
  }
  if (opts.external) return
  if (facts.template === true) GHt(slug, 'template_instance', issuedAt)
  else bWn(slug, ['template_instance'], issuedAt)
}

/**
 * densable kin success tail — Fzr / Bht / Nzr / Lzr / jht / De, as fields
 * for Uht to land (the local row rewrite would drop them otherwise).
 */
function bootProvenance(
  slug: string,
  data: Record<string, unknown>,
  tokenless: boolean,
  issuedAt: number,
): Partial<ArtifactProvenanceStatus> {
  const prev = yt(slug)
  const out: Partial<ArtifactProvenanceStatus> = {}
  if (data.authoredByOthers === true) out.authoredByOthers = true
  const outsideWriter = Obe(data.outsideWriter)
  if (outsideWriter !== undefined && prev?.outsideWriter !== true) {
    out.outsideWriter = outsideWriter
  }
  const lean = data.lean === true
  const external = data.mode === 'external'
  const isPublic = data.mode === 'public' || data.kind === 'public'
  if (!lean && (prev !== undefined || external)) out.external = external
  if (Yw() && (prev !== undefined || tokenless)) {
    out.outsideOrgReader = tokenless
  }
  const type = data.type
  if (type !== null && typeof type === 'object') {
    const rawSlug = Reflect.get(type, 'slug')
    const typeSlug =
      typeof rawSlug === 'string' && ARTIFACT_SLUG_RE.test(rawSlug)
        ? rawSlug
        : undefined
    if (
      !(
        prev?.typeLocked === true &&
        (prev.typeSlug !== undefined || typeSlug === undefined)
      )
    ) {
      out.typeLocked = true
      if (typeSlug !== undefined && prev?.typeSlug === undefined) {
        out.typeSlug = typeSlug
      }
    }
  }
  const perm = data.perm
  const role =
    perm !== null && typeof perm === 'object'
      ? Reflect.get(perm, 'role')
      : undefined
  if (!lean && !isPublic && (!external || role === 'writer')) {
    De(
      slug,
      data.typeFacts,
      prev?.typeLock?.slug ?? prev?.typeSlug ?? out.typeSlug,
      issuedAt,
      { external },
    )
  }
  return out
}

/** densable P4e / kin — frame boot ownership probe. */
async function P4e(
  parsed: ParsedArtifactUrl,
  signal: AbortSignal,
  opts?: { readBack?: boolean },
): Promise<ProvenanceProbeResult> {
  const issuedAt = Date.now()
  const env = mo()
  if (parsed.env !== env) {
    return {
      err: `that artifact URL is for ${parsed.env} claude.ai, but this session targets ${env}`,
      errorCode: 'env_mismatch',
    }
  }
  const boot = await fetchFrameBoot(parsed.slug, signal, {
    kind: 'probe',
    probe: true,
    readBack: opts?.readBack === true,
    // densable share-probe defaults gatePublicRead true (omit → aT default).
    // Content/list paths still pass false separately and keep admit after Yw.
  })
  if (boot.err !== null) return { err: boot.err, errorCode: boot.errorCode }
  const perm = boot.data.perm
  const tokenless = boot.assetToken === undefined
  const provenance = bootProvenance(parsed.slug, boot.data, tokenless, issuedAt)
  const roleRaw =
    perm !== null && typeof perm === 'object'
      ? Reflect.get(perm, 'role')
      : undefined
  const modeRaw =
    perm !== null && typeof perm === 'object'
      ? Reflect.get(perm, 'mode')
      : undefined
  const role =
    roleRaw === 'owner' ||
    roleRaw === 'writer' ||
    roleRaw === 'reader' ||
    roleRaw === 'commenter' ||
    roleRaw === 'viewer'
      ? roleRaw
      : roleRaw === undefined || roleRaw === ''
        ? undefined
        : 'unknown'
  const capsReadBack = parseCapsReadBack(boot.data)
  return {
    provenance,
    err: null,
    mode: tokenless ? 'public' : String(modeRaw ?? boot.data.mode ?? 'owner'),
    shared: boot.data.shared,
    role: tokenless && role === 'owner' ? undefined : role,
    outsideOrgReader: tokenless,
    cowritten: boot.data.cowritten === true,
    ...(typeof boot.data.title === 'string' ? { title: boot.data.title } : {}),
    ...(capsReadBack !== undefined ? { readBack: capsReadBack } : {}),
    boot: {
      err: null,
      data: boot.data,
      ver: boot.ver,
      assetToken: boot.assetToken,
      ...(boot.route !== undefined ? { route: boot.route } : {}),
    },
  }
}

/** densable NWn / Oe @194044140 / @194205911 — parse boot.readback. */
function parseCapsReadBack(
  data: Record<string, unknown>,
): CapsReadBack | undefined {
  if (data.readback === undefined || typeof data.typeInstance !== 'boolean') {
    return undefined
  }
  const raw = data.readback
  if (raw === null || typeof raw !== 'object') return undefined
  const body = raw as Record<string, unknown>
  const typeLockRaw = body.typeLock
  const typeLock =
    typeLockRaw !== null && typeof typeLockRaw === 'object'
      ? (typeLockRaw as { current?: unknown; latest?: unknown })
      : undefined
  const parsed: CapsReadBack = {
    contract: body.contract,
    ...(body.capabilities !== undefined
      ? { capabilities: body.capabilities }
      : {}),
    ...(typeLock !== undefined ? { typeLock } : {}),
  }
  const typed =
    data.typeInstance === true ||
    (data.type !== null && typeof data.type === 'object')
  if (typed && parsed.typeLock === undefined) return undefined
  if (
    parsed.typeLock?.latest !== undefined &&
    parsed.typeLock.latest !== parsed.typeLock.current
  ) {
    return undefined
  }
  return parsed
}

/**
 * densable Wjt @186930610 — land capabilities; omit capabilitiesUnknown
 * unless this write marks unknown (destructure drops the prior flag).
 */
export function Wjt(
  slug: string,
  capabilities: unknown,
  opts?: {
    unknown?: boolean
    toolUseId?: string
    source?: { readAt?: number; issuedAt: number }
  },
): void {
  const cur = yt(slug) ?? { mode: 'owner', isSharedLive: false }
  const {
    capabilitiesUnknown: _unknown,
    lastCapsReadAt,
    lastCapsLandedAt,
    lastCapsIssuedAt,
    ...rest
  } = cur
  void _unknown
  const source = opts?.source
  const stamps =
    source === undefined
      ? {
          ...(lastCapsReadAt !== undefined ? { lastCapsReadAt } : {}),
          ...(lastCapsLandedAt !== undefined ? { lastCapsLandedAt } : {}),
          ...(lastCapsIssuedAt !== undefined ? { lastCapsIssuedAt } : {}),
        }
      : {
          ...(source.readAt !== undefined || lastCapsReadAt !== undefined
            ? { lastCapsReadAt: source.readAt ?? lastCapsReadAt }
            : {}),
          lastCapsLandedAt: source.readAt ?? Date.now(),
          lastCapsIssuedAt: source.issuedAt,
        }
  un().shareStatus.bySlug.set(slug, {
    ...rest,
    capabilities,
    ...(opts?.unknown ? { capabilitiesUnknown: true } : {}),
    ...(opts?.toolUseId !== undefined
      ? { lastCapsReadToolUseId: opts.toolUseId }
      : {}),
    ...stamps,
  })
}

/** densable zjt subset — land Oe readBack after the probe row write. */
function landCapsReadBack(
  slug: string,
  readBack: CapsReadBack,
  toolUseId: string | undefined,
  issuedAt: number,
): void {
  const now = Date.now()
  Wjt(slug, readBack.capabilities, {
    ...(toolUseId !== undefined ? { toolUseId } : {}),
    source: { readAt: now, issuedAt },
  })
}

/** densable A — provenance fields gold carries across a status rewrite. */
function carriedProvenance(
  status: ArtifactProvenanceStatus | undefined,
): Partial<ArtifactProvenanceStatus> {
  if (status === undefined) return {}
  return {
    ...(status.outsideOrgReader !== undefined
      ? { outsideOrgReader: status.outsideOrgReader }
      : {}),
    ...(status.external !== undefined ? { external: status.external } : {}),
    ...(status.typeLocked === true ? { typeLocked: true } : {}),
    ...(status.typeSlug !== undefined ? { typeSlug: status.typeSlug } : {}),
    ...(status.typeLock !== undefined ? { typeLock: status.typeLock } : {}),
    ...(status.authoredByOthers === true ? { authoredByOthers: true } : {}),
    ...(status.outsideWriter !== undefined
      ? { outsideWriter: status.outsideWriter }
      : {}),
  }
}

/** densable Uht — land a probe result (via Kgl) keeping provenance fields. */
function Uht(
  slug: string,
  result: ProvenanceProbeResult,
  meta: {
    consumedByCheck: boolean
    toolUseId?: string
    issuedAt: number
    debugLabel: string
  },
): void {
  const prev = yt(slug)
  const landed: ProvenanceProbeResult = qH(meta.issuedAt)
    ? {
        err: 'the signed-in account changed while probing',
        errorCode: ACCOUNT_CHANGED,
      }
    : result
  if (landed.err !== null) {
    logForDebugging(
      `[artifact] ${meta.debugLabel} share probe failed: ${landed.err}`,
    )
  }
  Kgl(slug, landed, meta)
  const next = yt(slug)
  if (next === undefined) return
  const row: ArtifactProvenanceStatus = {
    ...carriedProvenance(prev),
    ...next,
    ...(landed.err === null
      ? {
          outsideOrgReader: landed.outsideOrgReader === true,
          ...landed.provenance,
        }
      : {}),
  }
  un().shareStatus.bySlug.set(slug, row)
  // densable write site: boot && !lean && lastProbeToolUseId && !agentPeer
  if (landed.err === null && landed.boot !== undefined) {
    rememberProbeBoot(slug, landed.boot, {
      toolUseId: row.lastProbeToolUseId ?? meta.toolUseId,
      issuedAt: meta.issuedAt,
    })
  }
  if (landed.err === null && landed.readBack !== undefined) {
    landCapsReadBack(
      slug,
      landed.readBack,
      row.lastProbeToolUseId ?? meta.toolUseId,
      meta.issuedAt,
    )
  }
}

/** densable Tu — ownership probe once per toolUseId before deciding. */
export async function Tu(
  parsed: ParsedArtifactUrl,
  context: Pick<ToolUseContext, 'toolUseId' | 'abortController'>,
  action: string,
  opts?: { readBack?: boolean },
): Promise<void> {
  const status = yt(parsed.slug)
  if (!!context.toolUseId && status?.lastProbeToolUseId === context.toolUseId) {
    // Same toolUseId already probed. Re-run only when Jr() asked
    // readBack and that probe never landed caps.
    if (
      opts?.readBack !== true ||
      status.lastCapsReadAt !== undefined ||
      status.lastCapsReadToolUseId === context.toolUseId
    ) {
      return
    }
  }
  const issuedAt = Date.now()
  const signal = context.abortController.signal
  const [result] = await Promise.all([
    P4e(parsed, signal, { readBack: opts?.readBack === true }),
    HPe() ? GBe(parsed, signal) : undefined,
  ])
  Uht(parsed.slug, result, {
    consumedByCheck: true,
    toolUseId: context.toolUseId,
    issuedAt,
    debugLabel: action,
  })
}

/** densable j7 subset — GET /api/frame/types/:slug, attesting via Oe. */
async function describeType(
  typeSlug: string,
  opts: { signal: AbortSignal; credentials?: unknown },
): Promise<TypeDescribeResult> {
  if (!ARTIFACT_SLUG_RE.test(typeSlug)) {
    return {
      err: 'type_url does not name an Artifact type',
      reason: 'invalid_slug',
    }
  }
  const issuedAt = Date.now()
  const res = await DL.getRelayBound(
    `/api/frame/types/${encodeURIComponent(typeSlug)}`,
    {
      refreshOAuth: true,
      headers: frameControlPlaneHeaders(),
      timeoutMs: 15_000,
      maxContentLength: TYPE_DESCRIBE_MAX_BYTES,
      signal: opts.signal,
      ...(opts.credentials !== undefined
        ? { credentials: opts.credentials }
        : {}),
    },
  )
  if (!res.ok) {
    return res.reason === 'max_content_length'
      ? {
          err: 'the Artifact type could not be read (the response was larger than this client accepts)',
          reason: 'oversize_body',
        }
      : {
          err: `the Artifact type unavailable here: ${res.reason}`,
          reason: 'not_ok',
        }
  }
  if (res.fromFrame && res.status === 404) {
    return {
      err: 'Artifact type not found in this account\'s catalog — check the link (use a `type_url` from action "list_types"); a type that exists but isn\'t listed for this account, a single-file page, or the catalog not being available to this account all answer this way',
      reason: 'not_found',
    }
  }
  if (!res.fromFrame || res.status !== 200) {
    return {
      err: `the Artifact type could not be read (HTTP ${res.status})`,
      reason: res.fromFrame ? 'http_error' : 'relay_error',
    }
  }
  const data = res.data
  const slug =
    data !== null && typeof data === 'object'
      ? Reflect.get(data, 'slug')
      : undefined
  if (slug !== typeSlug || data === null || typeof data !== 'object') {
    return {
      err: 'the Artifact type could not be read (malformed response)',
      reason: 'malformed_body',
    }
  }
  const listings = Reflect.get(data, 'listings')
  Oe(typeSlug, listings, issuedAt)
  const title = Reflect.get(data, 'title')
  return {
    err: null,
    detail: {
      slug: typeSlug,
      ...(typeof title === 'string' ? { title } : {}),
      firstParty: hasFirstPartyListing(listings),
    },
  }
}

/** densable btn — cached type description per `${env}:${typeSlug}`. */
function btn(
  typeSlug: string,
  env: string,
  opts: { signal: AbortSignal; credentials?: unknown },
): TypeDescription {
  const now = Date.now()
  if (!ARTIFACT_SLUG_RE.test(typeSlug)) {
    return { askedAt: now, until: now, answer: Promise.resolve(undefined) }
  }
  const cache = provenanceState().typeDescriptions
  const key = `${env}:${typeSlug}`
  const cached = cache.get(key)
  if (cached !== undefined && now < cached.until) return cached
  const pending = describeType(typeSlug, opts).catch(() => undefined)
  const entry: TypeDescription = {
    askedAt: now,
    until: now + TYPE_DESCRIPTION_TTL_MS,
    answer: pending.then(r => (r?.err === null ? r.detail : undefined)),
  }
  cache.set(key, entry)
  void pending.then(r => {
    if (cache.get(key) !== entry) return
    if (r === undefined) cache.delete(key)
    else if (r.err !== null && r.reason !== 'not_found') {
      entry.until = Math.min(
        entry.until,
        Date.now() + TYPE_DESCRIPTION_ERROR_TTL_MS,
      )
    }
  })
  return entry
}

/** densable st — race a promise against a timer. */
function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  let clear = (): void => {}
  const timer = new Promise<undefined>(resolve => {
    const handle = setTimeout(() => resolve(undefined), ms)
    clear = () => clearTimeout(handle)
  })
  return Promise.race([promise, timer]).finally(clear)
}

/** densable hat — prefetch the source type listing before a file read. */
export async function hat(
  parsed: ParsedArtifactUrl,
  opts: { signal: AbortSignal; credentials?: unknown },
): Promise<void> {
  const status = yt(parsed.slug)
  const typeSlug = wF(status)
  if (!xN(status) || typeSlug === undefined || Sh(typeSlug) !== undefined)
    return
  const { askedAt, answer } = btn(typeSlug, parsed.env, opts)
  await raceTimeout(
    answer,
    Math.max(0, TYPE_PREFETCH_BUDGET_MS - (Date.now() - askedAt)),
  )
}

/** densable AE — artifact in another of the user's organizations. */
export function AE(
  parsed: ParsedArtifactUrl,
  nothingMsg: string,
): PermissionDenyDecision | null {
  if (!Yjt(yt(parsed.slug))) return null
  return {
    behavior: 'deny',
    message: `${An(parsed)}: ${OTHER_ORG_UNREACHABLE}. ${nothingMsg}; tell the user.`,
    decisionReason: { type: 'other', reason: OTHER_ORG_REASON },
  }
}
