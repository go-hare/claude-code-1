/**
 * densable 2.1.289 Artifact read grants — `cKe` records, on an approved
 * list/read call, that reading this artifact's files and assets needs no
 * further approval this conversation (`artifactAssetRead*ConsentSlugs`, plus
 * `artifactOutsideOrgConsentSlugs` when the ask named an outside-org slug).
 * Page HTML `action:"read"` uses densable `NCo` → `artifactReadConsentSlugs`.
 * Hosted `upload_asset` uses densable `qIt` → `artifactAssetUpload*ConsentSlugs`.
 *
 * Gold `Xo(n.agentContext)` @199721413 / @199721948 / @199722136 is
 * `isDelegatedObservation(getAgentContext())` — tip ToolUseContext has no
 * `agentContext` field (KEEP).
 */
import type { AppState } from 'src/state/AppStateStore.js'
import type { ToolUseContext } from 'src/Tool.js'
import {
  getAgentContext,
  isDelegatedObservation,
} from 'src/utils/agentContext.js'
import { parseArtifactUrlAnyCase } from 'src/utils/artifactUrl.js'
import { forgetOtherCommentSightings, un } from '../store.js'
import {
  allowedWithoutUser,
  answeredByUser,
  arePermissionPromptsUnavailable,
  classifierDecidesFor,
  D1n,
  eH,
  iKe,
  Ke,
  qBe,
  U5,
} from './consent.js'
import {
  B5,
  isOutsideOrgPersonAsk,
  isRemoteCoworkContentHostDenied,
  iz,
  v1,
  yt,
  zl,
} from './provenance.js'
import { getToolPermissionContext } from './rules.js'

export type ReadGrantContext = Pick<
  ToolUseContext,
  | 'getAppState'
  | 'setAppState'
  | 'toolUseId'
  | 'toolDecisions'
  | 'permissionLayers'
>

/**
 * densable mKe kind: `'page'` → `artifactReadConsentSlugs`; `'files'` /
 * `'assets'` → `artifactAssetReadHumanConsentSlugs` (same human asset map).
 */
export type ArtifactReadAdmitKind = 'page' | 'files' | 'assets'

/** Maps this file actually writes (cKe / NCo / qIt). */
type LiveConsentSlugKey =
  | 'artifactReadConsentSlugs'
  | 'artifactAssetReadConsentSlugs'
  | 'artifactAssetReadHumanConsentSlugs'
  | 'artifactOutsideOrgConsentSlugs'
  | 'artifactAssetUploadConsentSlugs'
  | 'artifactAssetUploadHumanConsentSlugs'

/**
 * Gold Vtn bags with no tip writer. Listed so E() can reset them on an
 * account-epoch change; reading them is never a grant.
 */
type ReservedConsentSlugKey =
  | 'artifactDbReadConsentSlugs'
  | 'artifactDbReadHumanConsentSlugs'
  | 'artifactHandlersReadConsentSlugs'
  | 'artifactHandlersReadHumanConsentSlugs'
  | 'artifactHandlersWriteConsentSlugs'
  | 'artifactHandlersWriteHumanConsentSlugs'

type ConsentSlugKey = LiveConsentSlugKey | ReservedConsentSlugKey

function pinFlag(input: Record<string, unknown>, key: string): boolean {
  const pin = input[eH]
  return (
    typeof pin === 'object' && pin !== null && Reflect.get(pin, key) === true
  )
}

/** densable V */
function V(input: Record<string, unknown>, context: ReadGrantContext): boolean {
  return U5(input, context) && !arePermissionPromptsUnavailable(context)
}

/** densable Te */
function Te(
  input: Record<string, unknown>,
  context: ReadGrantContext,
): boolean {
  return iKe(input, context) && !allowedWithoutUser(context)
}

/** densable E — scope-checked write; a new account epoch starts the maps over. */
function E(
  prev: AppState,
  context: ReadGrantContext,
  update: (state: AppState) => AppState,
): AppState {
  if (D1n(context)) return prev
  const epoch = un().accountEpoch
  if ((prev.artifactConsentEpoch ?? 0) === epoch) return update(prev)
  return update({
    ...prev,
    artifactReadConsentSlugs: {},
    artifactAssetReadConsentSlugs: {},
    artifactAssetReadHumanConsentSlugs: {},
    artifactOutsideOrgConsentSlugs: {},
    artifactDbReadConsentSlugs: {},
    artifactDbReadHumanConsentSlugs: {},
    artifactAssetUploadConsentSlugs: {},
    artifactAssetUploadHumanConsentSlugs: {},
    artifactHandlersReadConsentSlugs: {},
    artifactHandlersReadHumanConsentSlugs: {},
    artifactHandlersWriteConsentSlugs: {},
    artifactHandlersWriteHumanConsentSlugs: {},
    artifactConsentEpoch: epoch,
  })
}

/** densable x */
function x(
  prev: AppState,
  context: ReadGrantContext,
  keys: readonly ConsentSlugKey[],
  slug: string,
): AppState {
  return E(prev, context, state => {
    if (keys.every(key => state[key]?.[slug] === true)) return state
    const next: Partial<Record<ConsentSlugKey, Record<string, true>>> = {}
    for (const key of keys) next[key] = { ...state[key], [slug]: true }
    return { ...state, ...next }
  })
}

/**
 * densable mKe(e, n, t, s) — an outside-org / shared read the asker may admit.
 * `kind: 'page'` consults `artifactReadConsentSlugs`; `'files'` / `'assets'`
 * (default `'files'`) consult `artifactAssetReadHumanConsentSlugs`.
 */
function mKe(
  input: Record<string, unknown>,
  context: ReadGrantContext,
  slug: string,
  kind: ArtifactReadAdmitKind = 'files',
): boolean {
  if (Ke(context, slug)) return true
  if (
    iz(
      context,
      kind === 'page'
        ? 'artifactReadConsentSlugs'
        : 'artifactAssetReadHumanConsentSlugs',
      slug,
    )
  ) {
    return true
  }
  if (arePermissionPromptsUnavailable(context) || allowedWithoutUser(context))
    return false
  return (
    iKe(input, context) ||
    (!classifierDecidesFor(context) &&
      !pinFlag(input, 'classifier') &&
      U5(input, context))
  )
}

/** densable Do — files/assets outside-org admit (keeps files kind). */
function Do(
  input: Record<string, unknown>,
  context: ReadGrantContext,
  slug: string,
): boolean {
  return qBe(context, slug) && mKe(input, context, slug, 'files')
}

/**
 * Gold W @199720211 — consent + optional Human map for a slug prefix.
 * Semantic only (invent-ban `export function W`).
 */
function uploadConsentKeys(human: boolean): LiveConsentSlugKey[] {
  return human
    ? [
        'artifactAssetUploadConsentSlugs',
        'artifactAssetUploadHumanConsentSlugs',
      ]
    : ['artifactAssetUploadConsentSlugs']
}

/** densable cKe — files/assets session grant. */
function cKe(
  input: Record<string, unknown>,
  context: ReadGrantContext,
  slug: string,
  outsideOrgAsked = false,
): void {
  // Gold Xo(n.agentContext) @199721413 — ALS via getAgentContext().
  if (isDelegatedObservation(getAgentContext())) return
  const status = yt(slug)
  const classifier =
    pinFlag(input, 'classifier') ||
    (getToolPermissionContext(context).mode === 'auto' &&
      !pinFlag(input, 'userOnly'))
  if (
    !V(input, context) ||
    pinFlag(input, 'once') ||
    classifier ||
    (zl(status) && !v1(status) && !B5(status))
  ) {
    return
  }
  const human =
    Te(input, context) || (outsideOrgAsked && answeredByUser(context))
  const outsideOrg = outsideOrgAsked && !allowedWithoutUser(context)
  const keys: ConsentSlugKey[] = [
    'artifactAssetReadConsentSlugs',
    ...(human ? (['artifactAssetReadHumanConsentSlugs'] as const) : []),
    ...(outsideOrg ? (['artifactOutsideOrgConsentSlugs'] as const) : []),
  ]
  context.setAppState(prev => x(prev, context, keys, slug))
}

/**
 * densable `if (De) cKe(g, n, D.slug, Do(g, n, D.slug))` — only calls that
 * carry the check-time approval pin record a grant.
 */
export function recordArtifactReadGrant(
  input: Record<string, unknown>,
  context: ReadGrantContext,
  slug: string,
): void {
  const pin = input[eH]
  if (pin === undefined || pin === null) return
  cKe(input, context, slug, Do(input, context, slug))
}

/**
 * densable NCo — after an approved page `action:"read"`, remember the slug on
 * `artifactReadConsentSlugs` so later page reads may admit without asking.
 * Semantic export only (invent-ban `export function NCo`).
 *
 * Gold: `if(!V(e,n)||rye(n)||de(n).mode==="auto"&&!_b(ge(e))&&!Hoe(t)||zl(yt(t)))return`
 */
export function recordArtifactPageReadGrant(
  input: Record<string, unknown>,
  context: ReadGrantContext,
  slug: string,
): void {
  // Gold Xo(n.agentContext) @199721948 — ALS via getAgentContext().
  if (isDelegatedObservation(getAgentContext())) return
  if (!V(input, context) || allowedWithoutUser(context)) return
  const mode = getToolPermissionContext(context).mode
  const parsed =
    typeof input.url === 'string' ? parseArtifactUrlAnyCase(input.url) : null
  if (
    mode === 'auto' &&
    !isRemoteCoworkContentHostDenied(parsed ?? undefined) &&
    !isOutsideOrgPersonAsk(slug)
  ) {
    return
  }
  if (zl(yt(slug))) return
  context.setAppState(prev =>
    x(prev, context, ['artifactReadConsentSlugs'], slug),
  )
}

/**
 * densable mKe — admit a public / outside-org content read (fetch
 * `admitPublicRead` hook). Semantic export only (invent-ban `export function mKe`).
 */
export function mayAdmitOutsideOrgArtifactRead(
  input: Record<string, unknown>,
  context: ReadGrantContext,
  slug: string,
  kind: ArtifactReadAdmitKind = 'files',
): boolean {
  return mKe(input, context, slug, kind)
}

/** Clearer alias for the fetch `admitPublicRead` hook (same as mKe). */
export function mayAdmitPublicArtifactRead(
  input: Record<string, unknown>,
  context: ReadGrantContext,
  slug: string,
  kind: ArtifactReadAdmitKind = 'files',
): boolean {
  return mKe(input, context, slug, kind)
}

/**
 * Gold Xqe @210614011 — already-approved upload_asset this conversation.
 * Auto (current or modeBeforeRewrite) never consults the maps.
 * Plan reads the Human map; other modes read `artifactAssetUploadConsentSlugs`.
 * Semantic export only (invent-ban `export function Xqe`).
 */
export function hasArtifactAssetUploadConsent(
  context: ReadGrantContext,
  slug: string,
): boolean {
  const { mode, modeBeforeRewrite } = getToolPermissionContext(context)
  if (mode === 'auto' || modeBeforeRewrite === 'auto') return false
  return iz(
    context,
    mode === 'plan'
      ? 'artifactAssetUploadHumanConsentSlugs'
      : 'artifactAssetUploadConsentSlugs',
    slug,
  )
}

/**
 * Gold qIt @199722114 — after an approved upload_asset, remember the slug on
 * `artifactAssetUploadConsentSlugs` (+ Human when iKe). Gold `qIt(e,n,t,s)`
 * calls `Bzr(t,s)` then writes ConsentSlugs.
 * Semantic export only (invent-ban `export function qIt`).
 */
export function recordArtifactAssetUploadGrant(
  input: Record<string, unknown>,
  context: ReadGrantContext,
  slug: string,
  afterSeq?: number,
): void {
  // Gold Xo(n.agentContext) @199722136 — ALS via getAgentContext().
  if (isDelegatedObservation(getAgentContext())) return
  if (!U5(input, context) || getToolPermissionContext(context).mode === 'auto')
    return
  forgetOtherCommentSightings(slug, afterSeq)
  context.setAppState(prev =>
    x(prev, context, uploadConsentKeys(iKe(input, context)), slug),
  )
}
