/**
 * densable Artifact read consent ruling (2.1.289).
 *
 * Gold symbols, by defining chunk:
 * - chunk-nykhqmnf: md, Sb (+ b), VBe, _U, Ozr, Doe, Hzr, B7n, NPe, X_n, qBe,
 *   R7e, KBe (+ R) — consent ledger kept on bootstrap `X()`.
 * - chunk-aw8dyr84: Wu, qm, OP, TE, eH, $tn markers; dD / yNe, Ge / We / ce /
 *   He, Gtn, ztn, xAr, jtn, Iat / Ue / $A / se, Mat, cne, eBn-backed L.
 * - chunk-xwgfbhhb: E7.  chunk-fmsfw5my: Pbe, G0.  chunk-2vfztqzn: Yw.
 * - chunk-fvtx9p4b: vm.  chunk-63av4j33: p$ (artifactCardTitle) and its
 *   bWe / fw / Zd / lC sanitizer chain.
 * - chunk-cx175mfd: Im, vg, b_ (consent surface).  chunk-fmsfw5my: ik, oz.
 *
 * Share status (yt) and the attested / egress probes (fq, p, tke, _b) belong
 * to `readPerm/provenance.ts`; this module takes their results as parameters.
 */
import { getIsInteractive } from 'src/bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import type { ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import type {
  PermissionAllowDecision,
  PermissionAskDecision,
  PermissionDenyDecision,
  PermissionMode,
  PermissionRule,
} from 'src/types/permissions.js'
import {
  artifactViewerUrlFor,
  type ParsedArtifactUrl,
  parseArtifactUrl,
} from 'src/utils/artifactUrl.js'
import { isEnvDefinedFalsy, isEnvTruthy } from 'src/utils/envUtils.js'
import { isAutoModeActive } from 'src/utils/permissions/autoModeState.js'
import { getRuleByContentsForToolName } from 'src/utils/permissions/permissions.js'
import { isStrictHumanTurnTail } from 'src/utils/turnTail.js'
import { un } from '../store.js'

/** densable Wu */
export const Wu = '__artifactConsentAskCanReachUser'
/** densable qm */
export const qm = '__artifactPlanConsentAsk'
/** densable OP */
export const OP = '__artifactUserOnlyConsentAsk'
/** densable TE */
export const TE = '__artifactDisplayTarget'
/** densable eH — the list/read files/assets target pin. */
export const eH = '__artifactAssetTargetPin'
/** densable Ltn @199726120 — page `action:"read"` target pin. */
export const Ltn = '__artifactReadTargetPin'
/** densable hp @211221195 page-read ask — untrusted-content clause. */
export const hp =
  'as an isolated summary, or in full wrapped as untrusted content where full reads of shared artifacts are enabled or it was published in your Slack channel'
/** densable pp @211221195 page-read ask — conversation reread cover. */
export const pp =
  'approving covers re-reads of this artifact for the rest of the conversation'
/** densable Rat — delete ask/dD target pin. */
export const Rat = '__artifactDeleteTarget'
/** densable gNe — upload_asset approval pin. */
export const gNe = '__artifactAssetUploadPin'
/** densable v — comments consent pin key. */
export const v = '__artifactConsentPin'
/** densable $tn */
export const $tn = '__artifactAsk'
/** densable Q @186925449 — public-write latch for Izr (constant true in 2.1.289). */
const Q = true
/** densable kc — zen allow-rule actions on the comments family. */
const ZEN_COMMENT_ACTIONS = ['reply', 'comments'] as const
/** densable Gtn */
export const Gtn = 'This artifact was created outside your organization.'

export type AskClass =
  | 'delete'
  | 'access_change'
  | 'standing_job'
  | 'public_change'
  | 'foreign_read'

export type AskClassAsk = {
  ask: true
  class: AskClass
  answeredBy: 'person' | 'classifier'
  remember: 'this_call' | 'artifact'
  basis: 'known' | 'unattended' | 'facts_missing'
  missing?: 'public' | 'owned' | 'networkOff'
  about?: 'someone_else' | 'outside_org'
  endpoint?: boolean
  informedOnly?: boolean
}

export type AskClassNoAsk = {
  ask: false
  foreignRead: boolean
  attested?: boolean
}

export type AskClassRuling = AskClassAsk | AskClassNoAsk

export type ClassOperation =
  | 'delete'
  | 'change_access'
  | 'standing_job'
  | 'write'
  | 'read'

export type ClassFacts = {
  operation: ClassOperation
  artifactId?: string
  owned?: boolean
  public?: boolean
  outsideOrg?: boolean
  invitedByOtherOrg?: boolean
  networkOff?: boolean
  turnStartedByHuman?: boolean
  canWrite?: boolean
  routineWrite?: boolean
  commentWrite?: boolean
}

/** The `yt(slug)` share-status fields the rulings read. */
export type ShareStatusFacts = {
  external?: boolean
  probeFailed?: boolean
  mode?: string
  role?: string
  outsideOrgReader?: boolean
  lastProbeToolUseId?: string
}

export type ShareClassFacts = {
  owned: boolean | undefined
  public: boolean | undefined
  outsideOrg: boolean | undefined
  invitedByOtherOrg: boolean
  canWrite?: true
}

export type ArtifactDisplay = { url: string; title?: string }

export type ReadProvenanceKind =
  | 'cowritten'
  | 'from_type'
  | 'someone_else'
  | 'unknown'

export type ConsentContext = Pick<ToolUseContext, 'getAppState' | 'toolUseId'> &
  Partial<Pick<ToolUseContext, 'messages'>>

type PendingClassAsk = {
  class: AskClass
  remember: AskClassAsk['remember']
  endpoint?: true
  slug: string
  url: string
  title?: string
  reachable: boolean
  askedIn: string
}

type ClassAskCard = {
  stamp: string
  parts: string[]
  saysPublic: boolean
  reason: string
}

type ConsentState = {
  askClassLatch: boolean | null
  askClassConsent: Set<string>
  askClassPersonConsent: Set<string>
  askClassOutsideOrgConsent: Set<string>
  askNamedOtherOrg: Map<string, string[]>
  askClassPending: Map<string, PendingClassAsk[]>
  askClassPersonAsked: Map<string, true>
  askClassNoClassifier: Map<string, true>
  askClassCards: Map<string, ClassAskCard>
  askClassTaken: Map<string, PendingClassAsk[]>
  askClassTakenByPerson: Map<string, true>
  consentCheckScopes: Map<string, string>
  consentCheckScopesEvicted: boolean
}

function freshState(): ConsentState {
  return {
    askClassLatch: null,
    askClassConsent: new Set(),
    askClassPersonConsent: new Set(),
    askClassOutsideOrgConsent: new Set(),
    askNamedOtherOrg: new Map(),
    askClassPending: new Map(),
    askClassPersonAsked: new Map(),
    askClassNoClassifier: new Map(),
    askClassCards: new Map(),
    askClassTaken: new Map(),
    askClassTakenByPerson: new Map(),
    consentCheckScopes: new Map(),
    consentCheckScopesEvicted: false,
  }
}

let state = freshState()

/** Read-only view of the consent ledger (densable `X()` ask-class fields). */
export function getConsentStateForTests(): Readonly<ConsentState> {
  return state
}

export function resetConsentStateForTests(): void {
  state = freshState()
}

const ASK_NAMED_OTHER_ORG_CAP = 512
const ASK_CLASS_MAP_CAP = 64
/** densable me */
const CONSENT_CHECK_SCOPES_CAP = 256

/** densable cne — LRU-ish set with oldest-key eviction. */
function cne<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key)
  map.set(key, value)
  if (map.size > ASK_CLASS_MAP_CAP) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
}

/** densable Yw — public reads from outside the org surface as their own class. */
export function Yw(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_plinth_sedge', false)
}

/** densable Ln.X env coerce — undefined when unset or unrecognised. */
function envBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined
  if (isEnvTruthy(value)) return true
  if (isEnvDefinedFalsy(value)) return false
  return undefined
}

/** densable md — five-class ask latch. */
export function md(): boolean {
  if (state.askClassLatch === null) {
    state.askClassLatch =
      envBoolean(process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS) ??
      getFeatureValue_CACHED_MAY_BE_STALE<boolean>(
        'tengu_cobalt_plinth_bryony',
        false,
      ) === true
    logEvent('tengu_artifact_five_class_asks', { on: state.askClassLatch })
  }
  return state.askClassLatch
}

/** densable KBe — `${accountEpoch}:${conversationEpoch}` from the artifact store. */
export function KBe(): string {
  const { accountEpoch, conversationEpoch } = un()
  return `${accountEpoch}:${conversationEpoch}`
}

function consentKey(cls: string, slug: string): string {
  return `${KBe()}:${cls}:${slug}`
}

function ask(
  cls: AskClass,
  answeredBy: AskClassAsk['answeredBy'],
  remember: AskClassAsk['remember'],
  basis: AskClassAsk['basis'],
  missing?: AskClassAsk['missing'],
): AskClassAsk {
  return {
    ask: true,
    class: cls,
    answeredBy,
    remember,
    basis,
    ...(missing !== undefined && { missing }),
  }
}

const NO_ASK: AskClassNoAsk = { ask: false, foreignRead: false }

/** densable Sb — class ruling for one artifact operation. */
export function Sb(facts: ClassFacts): AskClassRuling {
  switch (facts.operation) {
    case 'delete':
      return ask('delete', 'person', 'this_call', 'known')
    case 'change_access':
      return ask('access_change', 'person', 'this_call', 'known')
    case 'standing_job':
      return facts.turnStartedByHuman
        ? ask('standing_job', 'classifier', 'artifact', 'known')
        : ask('standing_job', 'classifier', 'this_call', 'unattended')
    case 'write': {
      if (!facts.turnStartedByHuman) {
        if (
          (facts.routineWrite === true || facts.commentWrite === true) &&
          facts.public === false &&
          facts.canWrite === true &&
          facts.invitedByOtherOrg !== true
        )
          return { ...NO_ASK }
        return ask('public_change', 'classifier', 'this_call', 'unattended')
      }
      if (facts.public === true)
        return ask('public_change', 'classifier', 'artifact', 'known')
      if (facts.public === undefined)
        return ask(
          'public_change',
          'classifier',
          'this_call',
          'facts_missing',
          'public',
        )
      if (facts.invitedByOtherOrg === true)
        return {
          ...ask('public_change', 'classifier', 'artifact', 'known'),
          about: 'someone_else',
        }
      return { ...NO_ASK }
    }
    case 'read': {
      if (facts.owned === true) return { ...NO_ASK }
      if (facts.outsideOrg === true)
        return {
          ...ask(
            'foreign_read',
            'person',
            facts.turnStartedByHuman ? 'artifact' : 'this_call',
            'known',
          ),
          about: 'outside_org',
        }
      if (facts.owned === undefined)
        return ask(
          'foreign_read',
          'classifier',
          'this_call',
          'facts_missing',
          'owned',
        )
      if (facts.networkOff === undefined)
        return ask(
          'foreign_read',
          'classifier',
          'this_call',
          'facts_missing',
          'networkOff',
        )
      if (facts.networkOff)
        return ask(
          'foreign_read',
          'classifier',
          facts.turnStartedByHuman ? 'artifact' : 'this_call',
          'known',
        )
      return { ask: false, foreignRead: true }
    }
  }
}

/**
 * densable Izr @186925458 — write-class ruling when nke is on.
 * `Q` is constant true in this build: private (`public===false`) does not ask;
 * public asks `public_change` this_call known; unknown public is facts_missing.
 */
export function Izr(facts: Pick<ClassFacts, 'public'>): AskClassRuling {
  if (!Q || facts.public === false) return { ask: false, foreignRead: false }
  return facts.public === true
    ? ask('public_change', 'classifier', 'this_call', 'known')
    : ask('public_change', 'classifier', 'this_call', 'facts_missing', 'public')
}

/** densable G0 — outside-org public artifact (only while Yw is on). */
export function G0(status: ShareStatusFacts | undefined): boolean {
  return status !== undefined && status.outsideOrgReader === true && Yw()
}

function outsideOrgUnknown(): false | undefined {
  return Yw() ? undefined : false
}

/** densable Iat — class facts from a share-status entry. */
export function Iat(status: ShareStatusFacts | undefined): ShareClassFacts {
  const invitedByOtherOrg = status?.external === true
  if (status === undefined || status.probeFailed === true)
    return {
      owned: undefined,
      public: undefined,
      outsideOrg: G0(status) || outsideOrgUnknown(),
      invitedByOtherOrg,
    }
  const isPublic =
    status.mode === 'unknown' ? undefined : status.mode === 'public'
  const outsideOrg = G0(status)
  if (status.role === undefined)
    return {
      owned: isPublic === true ? false : undefined,
      public: isPublic,
      outsideOrg,
      invitedByOtherOrg,
    }
  return {
    owned: status.role === 'unknown' ? undefined : status.role === 'owner',
    public: isPublic,
    outsideOrg,
    invitedByOtherOrg,
    ...((status.role === 'owner' || status.role === 'writer') && {
      canWrite: true as const,
    }),
  }
}

export type ClassFactsEnv = {
  /** densable Oat(parsed) — sandbox egress off for the artifact host. */
  networkOff: boolean | undefined
  /** densable oO(context.messages) */
  turnStartedByHuman: boolean
}

/** densable $A (+ Ue) — facts for one operation on one artifact. */
export function $A(
  operation: ClassOperation,
  parsed: ParsedArtifactUrl,
  context: Pick<ToolUseContext, 'toolUseId'>,
  status: ShareStatusFacts | undefined,
  env: ClassFactsEnv,
): ClassFacts {
  const share: ShareClassFacts =
    context.toolUseId !== undefined &&
    status?.lastProbeToolUseId === context.toolUseId
      ? Iat(status)
      : {
          owned: undefined,
          public: undefined,
          outsideOrg: G0(status) || outsideOrgUnknown(),
          invitedByOtherOrg: status?.external === true,
        }
  return {
    operation,
    artifactId: parsed.slug,
    owned: share.owned,
    public: share.public,
    outsideOrg: share.outsideOrg,
    invitedByOtherOrg: share.invitedByOtherOrg,
    networkOff: env.networkOff,
    turnStartedByHuman: env.turnStartedByHuman,
    ...(share.canWrite === true && { canWrite: true }),
  }
}

export type ReadRulingInputs = ClassFactsEnv & {
  status: ShareStatusFacts | undefined
  /**
   * densable `fq(context, slug) || p(context, slug)` — or `tke(context, slug)`
   * on the attested-data variant.
   */
  attested: boolean
}

/** densable E7 — read ruling for one artifact. */
export function E7(
  parsed: ParsedArtifactUrl,
  context: Pick<ToolUseContext, 'toolUseId'>,
  inputs: ReadRulingInputs,
): AskClassRuling {
  const facts = $A('read', parsed, context, inputs.status, inputs)
  return inputs.attested
    ? { ask: false, foreignRead: true, attested: true }
    : Sb(facts)
}

/** densable VBe */
export function VBe(ruling: Pick<AskClassAsk, 'class' | 'endpoint'>): string {
  return ruling.endpoint ? `${ruling.class}:endpoint` : ruling.class
}

/** densable _U */
export function _U(cls: string, slug: string): boolean {
  return state.askClassConsent.has(consentKey(cls, slug))
}

/**
 * densable Be / IAr — this call's taken ask remembered `artifact` for
 * (askClass, slug), and the conversation still holds that consent.
 * Semantic export only (invent-ban `export function IAr|Be`).
 */
export function hasAskClassArtifactRemembered(
  context: Pick<ToolUseContext, 'toolUseId'>,
  askClass: AskClass | string,
  slug: string,
): boolean {
  const toolUseId = context.toolUseId
  const taken =
    toolUseId === undefined ? undefined : state.askClassTaken.get(toolUseId)
  return (
    taken !== undefined &&
    taken.some(
      ruling =>
        VBe(ruling) === askClass &&
        ruling.slug === slug &&
        ruling.remember === 'artifact',
    ) &&
    _U(askClass, slug)
  )
}

/** densable Ozr */
export function Ozr(cls: string, slug: string, byPerson = false): void {
  state.askClassConsent.add(consentKey(cls, slug))
  if (byPerson) state.askClassPersonConsent.add(consentKey(cls, slug))
}

/** densable R7e */
export function R7e(cls: string, slug: string): boolean {
  return state.askClassPersonConsent.has(consentKey(cls, slug))
}

/** densable Hzr */
export function Hzr(slug: string): void {
  state.askClassOutsideOrgConsent.add(consentKey('foreign_read', slug))
}

/** densable B7n */
export function B7n(slug: string): boolean {
  return state.askClassOutsideOrgConsent.has(consentKey('foreign_read', slug))
}

/** densable Bjt — a class ask remembered on the artifact. */
export function Bjt(ruling: AskClassRuling): ruling is AskClassAsk {
  return ruling.ask === true && ruling.remember === 'artifact'
}

/** densable Doe — a held yes still stands for this ruling. */
export function Doe(
  ruling: AskClassAsk,
  slug: string,
  userOnly = false,
): boolean {
  const key = VBe(ruling)
  return ruling.informedOnly
    ? B7n(slug)
    : ruling.answeredBy === 'person' || userOnly
      ? R7e(key, slug)
      : _U(key, slug)
}

/** densable NPe — remember which outside-org slugs this call's ask named. */
export function NPe(
  context: Pick<ToolUseContext, 'toolUseId'>,
  slugs: string[],
  canReachUser: boolean,
): void {
  if (context.toolUseId === undefined) return
  const named = state.askNamedOtherOrg
  const prior = named.get(context.toolUseId)
  const next = canReachUser ? slugs : []
  const kept =
    prior === undefined ? next : next.filter(slug => prior.includes(slug))
  named.delete(context.toolUseId)
  named.set(context.toolUseId, kept)
  if (named.size > ASK_NAMED_OTHER_ORG_CAP) {
    const oldest = named.keys().next().value
    if (oldest !== undefined) named.delete(oldest)
  }
}

/** densable X_n */
export function X_n(context: Pick<ToolUseContext, 'toolUseId'>): void {
  if (context.toolUseId !== undefined)
    state.askNamedOtherOrg.delete(context.toolUseId)
}

/** densable qBe */
export function qBe(
  context: Pick<ToolUseContext, 'toolUseId'>,
  slug: string,
): boolean {
  return (
    context.toolUseId !== undefined &&
    (state.askNamedOtherOrg.get(context.toolUseId) ?? []).includes(slug)
  )
}

function normalizedEntrypoint(): string | undefined {
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  return entrypoint === 'local_agent' ? 'local-agent' : entrypoint || undefined
}

const REMOTE_COWORK_ENTRYPOINTS = new Set([
  'remote_cowork',
  'remote_cowork_trigger',
])

/** densable ik — Cowork frame session (local-agent host with frame artifacts). */
function isCoworkFrameSession(): boolean {
  return (
    normalizedEntrypoint() === 'local-agent' &&
    !isEnvTruthy(process.env.CLAUDE_CODE_CHILD_SESSION) &&
    !isEnvTruthy(process.env.CLAUDECODE) &&
    isEnvTruthy(process.env.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS)
  )
}

/** densable oz — the session is a task, not a conversation. */
function isTaskSession(): boolean {
  const entrypoint = normalizedEntrypoint()
  return (
    (entrypoint !== undefined &&
      REMOTE_COWORK_ENTRYPOINTS.has(entrypoint) &&
      !isEnvTruthy(process.env.CLAUDE_CODE_CHILD_SESSION)) ||
    isCoworkFrameSession()
  )
}

function permissionContext(
  context: Pick<ToolUseContext, 'getAppState'>,
): ToolPermissionContext {
  return context.getAppState().toolPermissionContext
}

/** densable Im — an ask can reach a person in this session. */
export function canReachUser(
  context: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  const ctx = permissionContext(context)
  return (
    ctx.mode !== 'bypassPermissions' &&
    !(
      ctx.mode === 'plan' &&
      ctx.isBypassPermissionsModeAvailable === true &&
      getIsInteractive()
    )
  )
}

/** densable Im alias. */
export const Im = canReachUser

/** densable vg */
function consentMustDeny(
  context: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  return (
    !canReachUser(context) ||
    permissionContext(context).shouldAvoidPermissionPrompts === true
  )
}

/** densable b_ */
export function planConsentMustDeny(
  context: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  if (permissionContext(context).mode !== 'plan') return false
  return consentMustDeny(context)
}

/** densable qi */
function classifierDecides(mode: PermissionMode, ignorePlan = false): boolean {
  return (
    mode === 'auto' || (mode === 'plan' && !ignorePlan && isAutoModeActive())
  )
}

type ToolDecisionContext = Pick<
  ToolUseContext,
  'getAppState' | 'toolUseId' | 'toolDecisions'
>

function toolDecisionOf(context: ToolDecisionContext) {
  return context.toolUseId === undefined
    ? undefined
    : context.toolDecisions?.get(context.toolUseId)
}

/** densable hNe — the user answered this call's permission prompt. */
export function answeredByUser(context: ToolDecisionContext): boolean {
  const source = toolDecisionOf(context)?.source
  return source === 'user_temporary' || source === 'user_permanent'
}

/** densable rye — allowed without a user answer (rule, classifier, config). */
export function allowedWithoutUser(context: ToolDecisionContext): boolean {
  const decision = toolDecisionOf(context)
  return (
    decision !== undefined &&
    decision.decision !== 'reject' &&
    decision.source !== 'user_temporary' &&
    decision.source !== 'user_permanent'
  )
}

/** densable ue — a permission hook allowed this call. */
function allowedByHook(context: ToolDecisionContext): boolean {
  const decision = toolDecisionOf(context)
  return decision?.source === 'hook' && decision.decision !== 'reject'
}

/**
 * densable PAr — on the approved call, take this call's pending class asks
 * and remember the `remember: "artifact"` ones for the conversation.
 */
export function PAr(context: ToolDecisionContext): void {
  const toolUseId = context.toolUseId
  if (toolUseId === undefined) return
  const pending = state.askClassPending.get(toolUseId) ?? []
  state.askClassPending.delete(toolUseId)
  const personAsked = state.askClassPersonAsked.get(toolUseId)
  state.askClassPersonAsked.delete(toolUseId)
  const noClassifier = state.askClassNoClassifier.get(toolUseId)
  state.askClassNoClassifier.delete(toolUseId)
  const byUser = answeredByUser(context)
  const byPerson =
    !consentMustDeny(context) &&
    !allowedWithoutUser(context) &&
    (byUser ||
      personAsked === true ||
      (noClassifier === true &&
        !classifierDecides(permissionContext(context).mode)))
  if (
    pending[0]?.reachable !== true ||
    pending[0].askedIn !== KBe() ||
    !canReachUser(context)
  ) {
    return
  }
  cne(state.askClassTaken, toolUseId, pending)
  if (byPerson) cne(state.askClassTakenByPerson, toolUseId, true)
  for (const taken of pending) {
    if (taken.remember !== 'artifact' || (!byUser && taken.endpoint)) continue
    Ozr(VBe(taken), taken.slug, byPerson)
    if (
      !taken.endpoint &&
      qBe(context, taken.slug) &&
      (byPerson || (personAsked !== true && !allowedByHook(context)))
    ) {
      Hzr(taken.slug)
    }
  }
}

/** densable OCo — stamp the account/conversation scope this call was checked in. */
export function OCo(context: Pick<ToolUseContext, 'toolUseId'>): void {
  const toolUseId = context.toolUseId
  if (toolUseId === undefined) return
  const scopes = state.consentCheckScopes
  scopes.delete(toolUseId)
  if (scopes.size >= CONSENT_CHECK_SCOPES_CAP) {
    const oldest = scopes.keys().next().value
    if (oldest !== undefined) {
      scopes.delete(oldest)
      state.consentCheckScopesEvicted = true
    }
  }
  scopes.set(toolUseId, KBe())
}

/** densable checkPermissions prologue — drop stale pending asks, then OCo. */
export function beginArtifactConsentCheck(
  context: Pick<ToolUseContext, 'toolUseId'>,
): void {
  if (context.toolUseId !== undefined)
    state.askClassPending.delete(context.toolUseId)
  OCo(context)
}

/** densable D1n — the scope changed since this call was checked (or is lost). */
export function D1n(context: Pick<ToolUseContext, 'toolUseId'>): boolean {
  if (context.toolUseId === undefined) return false
  const scope = state.consentCheckScopes.get(context.toolUseId)
  return scope === undefined ? state.consentCheckScopesEvicted : scope !== KBe()
}

/** densable U5 — the approved ask could reach a person, in the same scope. */
export function U5(
  input: Record<string, unknown>,
  context: Pick<ToolUseContext, 'getAppState' | 'toolUseId'>,
): boolean {
  return input[Wu] === true && canReachUser(context) && !D1n(context)
}

/** densable vg — no permission prompt can surface in this session. */
export function arePermissionPromptsUnavailable(
  context: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  return consentMustDeny(context)
}

/** densable iKe — a yes here counts as the person's own (plan ask or user-only). */
export function iKe(
  input: Record<string, unknown>,
  context: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  return (
    (input[qm] === true && permissionContext(context).mode === 'plan') ||
    input[OP] === true
  )
}

/** densable qi(de(n).mode) */
export function classifierDecidesFor(
  context: Pick<ToolUseContext, 'getAppState'>,
): boolean {
  return classifierDecides(permissionContext(context).mode)
}

/** densable Ke — a person consented to reading this foreign artifact. */
export function Ke(context: ToolDecisionContext, slug: string): boolean {
  const toolUseId = context.toolUseId
  return (
    (toolUseId !== undefined &&
      state.askClassTakenByPerson.get(toolUseId) === true &&
      (state.askClassTaken
        .get(toolUseId)
        ?.some(taken => VBe(taken) === 'foreign_read' && taken.slug === slug) ??
        false)) ||
    answeredByUser(context) ||
    R7e('foreign_read', slug)
  )
}

/** densable jtn — content of an artifact not the user's own has no answerer. */
export function jtn(
  context: Pick<ToolUseContext, 'getAppState'>,
  userOnly: boolean,
): boolean {
  return consentMustDeny(context) && (isCoworkFrameSession() || userOnly)
}

/** densable K_ — comments consent pin on updatedInput. */
export function K_(
  action: string,
  parsed: { slug: string } | null,
): { [v]: { action: string; slug: string } | null } {
  return { [v]: parsed === null ? null : { action, slug: parsed.slug } }
}

/**
 * densable ie @199734790 — Cowork frame and no one can answer a prompt.
 * User map: cowork session; gold is `ik()&&vg(e)`.
 */
function ie(context: Pick<ToolUseContext, 'getAppState'>): boolean {
  return isCoworkFrameSession() && consentMustDeny(context)
}

/**
 * densable T7 @199734824 — Fee-notice deny when Cowork+non-human-turn or
 * plan has no consent surface.
 */
export function T7(
  context: Pick<ToolUseContext, 'getAppState' | 'messages'>,
  nothingMsg: string,
  feeAskCopy: string,
): PermissionDenyDecision | null {
  const coworkUnattended =
    ie(context) && !isStrictHumanTurnTail(context.messages)
  if (!coworkUnattended && !planConsentMustDeny(context)) return null
  const ask = feeAskCopy.endsWith('.') ? feeAskCopy : `${feeAskCopy}.`
  return {
    behavior: 'deny',
    message: `${nothingMsg}. This needs a yes to: ${ask} ${
      coworkUnattended
        ? "No one can answer that prompt in this Cowork session, and this turn was not started by the user's own message — tell the user in chat; do not retry it on this turn."
        : 'No one can answer that prompt from plan mode in this session — keep planning in the plan file and raise it with the user in chat; do not retry while plan mode is on.'
    }`,
    decisionReason: {
      type: 'safetyCheck',
      reason: coworkUnattended
        ? "Artifact call with a new-comments notice pending, on a turn the user's own message did not start, in a Cowork session that has no one to answer its prompt"
        : 'Notification-triggered artifact call in plan mode has no one to answer its prompt',
      classifierApprovable: false,
    },
  }
}

/**
 * densable Xle @199735656 — foreign/unconfirmed read has no answerer.
 */
export function Xle(
  context: Pick<ToolUseContext, 'getAppState'>,
  nothingMsg: string,
  userOnly: boolean,
): PermissionDenyDecision | null {
  if (!jtn(context, userOnly)) return null
  return {
    behavior: 'deny',
    message: `${nothingMsg}. Reading content of an artifact the user does not own, or whose ownership couldn't be confirmed, needs a person's yes, and no one can answer the prompt in this session — tell the user in chat instead of retrying.`,
    decisionReason: {
      type: 'safetyCheck',
      reason:
        "Reading content of an artifact that is not confirmed to be the user's own requires a live human consent surface in this session",
      classifierApprovable: false,
    },
  }
}

/** densable c1n — `tengu_ochre_plover` (default false). */
export function c1n(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_ochre_plover', false)
}

/** densable Fn — `action:` rule content. */
function actionRuleContent(content: string): string | null {
  const sep = content.indexOf(':')
  if (sep <= 0) return null
  const key = content.slice(0, sep).trim()
  const value = content.slice(sep + 1).trim()
  return key === 'action' && value !== '' ? value : null
}

/** densable zY — glob match used by zen. */
function actionGlobMatches(pattern: string, value: string): boolean {
  return new RegExp(
    `^${pattern
      .split('*')
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    's',
  ).test(value)
}

/**
 * densable zen @194385473 — when ochre_plover is on, an Artifact
 * `action:reply` (or comments-family) allow rule admits the call.
 */
export function zen(
  perms: ToolPermissionContext,
  parsed: ParsedArtifactUrl | null,
  actions: readonly string[] = ZEN_COMMENT_ACTIONS,
): PermissionRule | null {
  if (!c1n() || perms.mode === 'plan' || parsed === null) return null
  for (const [content, rule] of getRuleByContentsForToolName(
    perms,
    'Artifact',
    'allow',
  )) {
    const action = actionRuleContent(content)
    if (
      action !== null &&
      actions.some(name => actionGlobMatches(action, name))
    ) {
      return rule
    }
  }
  return null
}

/**
 * densable k7 @199727074 — Fee-notice read sighting for this toolUseId.
 */
export function k7(
  action: 'comments' | 'read' | 'verify',
  context: Pick<ToolUseContext, 'getAppState' | 'toolUseId'>,
  slug: string,
  seen: boolean,
  askRule = false,
): void {
  if (context.toolUseId === undefined) return
  un().shareStatus.noticeReadSights[action].note(
    context.toolUseId,
    slug,
    seen && (askRule || canReachUser(context)),
  )
}

const CARD_TITLE_MAX = 80
const TITLE_FIELD_MAX = 280
const BRACKET_EXTRA =
  '\u02F9-\u02FC\u230C-\u230F\u231C-\u231F\u239B-\u23CC\u23DC-\u23E1\u2E00-\u2E0D\u2E1C\u2E1D\u2500-\u257F'
const BRACKET = `(?![(){}])[\\p{Ps}\\p{Pe}${BRACKET_EXTRA}]`
const BRACKET_RUN_RE = new RegExp(
  `(?<!\\s)\\s*${BRACKET}(?:\\s|${BRACKET})*`,
  'gu',
)
const ANGLE_BRACKET_RUN_RE = /[<>\uFE64\uFE65\uFF1C\uFF1E]+/gu
const SCHEME_SEPARATOR_RE = /[:\uFE13\uFE55\uFF1A][/\uFF0F][/\uFF0F]/gu
const SCHEME_SEPARATOR_NEUTRAL = ':\u2215\u2215'
const IGNORABLE_RE =
  /[\p{Default_Ignorable_Code_Point}\u2800\u{1D159}\u{13441}\u{13442}\uFFFC]/gu
const ARROW_SHAFT_SYMBOLS = String.raw`\u002b\u003d\u005e\u007c\u007e\u00a2-\u00a5\u00a8\u00ac\u00af\u00b1\u00b4\u00b8\u00d7\u00f7\u02c2-\u02c5\u02d2-\u02df\u02e5-\u02eb\u02ed\u02ef-\u02ff\u0375\u0384\u0385\u03f6\u058f\u0606-\u0608\u060b\u07fe\u07ff\u0888\u09f2\u09f3\u09fb\u0af1\u0bf9\u0e3f\u17db\u1fbd\u1fbf-\u1fc1\u1fcd-\u1fcf\u1fdd-\u1fdf\u1fed-\u1fef\u1ffd\u1ffe\u2044\u2052\u207a-\u207c\u208a-\u208c\u20a0-\u20c1\u2118\u2140-\u2144\u214b\u2190-\u2194\u219a\u219b\u21a0\u21a3\u21a6\u21ae\u21ce\u21cf\u21d2\u21d4\u21f4-\u22ff\u2320\u2321\u237c\u239b-\u23b3\u23dc-\u23e1\u25b7\u25c1\u25f8-\u25ff\u266f\u27c0-\u27c4\u27c7-\u27e5\u27f0-\u27ff\u2900-\u2982\u2999-\u29d7\u29dc-\u29fb\u29fe-\u2aff\u2b30-\u2b44\u2b47-\u2b4c\u309b\u309c\ua700-\ua716\ua720\ua721\ua789\ua78a\ua838\uab5b\uab6a\uab6b\ufb29\ufbb2-\ufbc2\ufdfc\ufe62\ufe64-\ufe66\ufe69\uff04\uff0b\uff1c-\uff1e\uff3e\uff40\uff5c\uff5e\uffe0-\uffe3\uffe5\uffe6\uffe9-\uffec\u{10d8e}\u{10d8f}\u{11fdd}-\u{11fe0}\u{1cef0}\u{1d6c1}\u{1d6db}\u{1d6fb}\u{1d715}\u{1d735}\u{1d74f}\u{1d76f}\u{1d789}\u{1d7a9}\u{1d7c3}\u{1e2ff}\u{1ecb0}\u{1eef0}\u{1eef1}\u{1f3fb}-\u{1f3ff}\u{1f8d0}-\u{1f8d8}`
const DASH_LIKE =
  '\\p{Pd}\\u2212\\u207b\\u208b\\u02d7\\u2796\\u2043\\u30fc\\uff70'
const ARROW_SHAFT = `[\\p{So}${ARROW_SHAFT_SYMBOLS}\\p{Pd}\\p{Pc}\\p{Mn}\\p{Me}${DASH_LIKE}\\u02c9\\u02cd\\u2017\\u2053\\u203e\\ufe49-\\ufe4c\\u0640\\u07fa\\u1173\\u1428\\u180a\\u2e0f\\u2f00\\u3127\\u3161\\u3192\\u31d0\\u4e00\\ua4ff\\ua7f7\\ua8fb\\uffda]`
const DRAWN_ARROW_RE = new RegExp(`(?<!${ARROW_SHAFT})${ARROW_SHAFT}+>`, 'gu')
const ARROW_LOOKALIKE_RE =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: combining arrow marks U+20D0–20EF are matched one code point at a time on purpose
  /[\u00bb\u02c2-\u02c5\u02ef-\u02ff\u1405\u1406\u1409\u1433\u1434\u1450\u1451\u15d2\u2023\u203a\u204d\u20d0-\u20ef\u2044\u2190-\u21ff\u2215\u226b\u227b\u227d\u227f\u2283\u22b1\u22b3\u22d7\u22d9\u2571\u2572\u2303-\u2304\u232a\u2344\u2348\u23e9-\u23ef\u23f5\u25b6-\u25bb\u261b\u261e\u276d\u276f\u2771\u2794-\u27bf\u27e9\u27eb\u27f0-\u27ff\u2900-\u297f\u29a8-\u29af\u2992\u2994\u29c1\u29d0\u29f5\u29f8\u29fd\u2a20\u2a7a\u2aa2\u2aa7\u2aa9\u2aab\u2aad\u2ab0\u2ab2\u2ab4\u2ab6\u2ab8\u2aba\u2abc\u2af8\u2b00-\u2bff\u3009\u300b\ue000-\uf8ff\ufe65\ufe68\uff0f\uff1e\uff3c\uffe9-\uffec\u{1f449}\u{1f599}\u{1f59b}\u{1f59d}\u{1f782}\u{1f800}-\u{1f8ff}\u{1faf1}\u{1fbc1}-\u{1fbc3}\u{1fbb0}-\u{1fbb8}\u{f0000}-\u{ffffd}\u{100000}-\u{10fffd}]/gu

/** densable Zx */
function isInvisibleCodePoint(cp: number): boolean {
  return (
    cp <= 31 ||
    (cp >= 127 && cp <= 159) ||
    cp === 173 ||
    cp === 1564 ||
    (cp >= 8203 && cp <= 8207) ||
    cp === 8232 ||
    cp === 8233 ||
    (cp >= 8234 && cp <= 8238) ||
    (cp >= 8288 && cp <= 8297) ||
    (cp >= 65024 && cp <= 65039) ||
    cp === 65279 ||
    (cp >= 65529 && cp <= 65531) ||
    cp === 94180 ||
    (cp >= 917504 && cp <= 917999)
  )
}

/** densable fw */
function titleField(raw: string): string | null {
  const flat = Array.from(raw, ch => {
    const cp = ch.codePointAt(0) ?? 0
    return cp <= 31 || (cp >= 127 && cp <= 159) ? ' ' : ch
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat === '') return null
  const chars = Array.from(flat)
  return chars.length > TITLE_FIELD_MAX
    ? chars.slice(0, TITLE_FIELD_MAX).join('')
    : flat
}

/** densable Zd */
function blankInvisibles(text: string): string {
  return Array.from(text, ch =>
    isInvisibleCodePoint(ch.codePointAt(0) ?? 0) ? ' ' : ch,
  )
    .join('')
    .replace(IGNORABLE_RE, ' ')
    .replace(/"/g, "'")
}

/** densable lC */
function neutralizeArrows(text: string): string {
  return text.replace(ARROW_LOOKALIKE_RE, '?').replace(DRAWN_ARROW_RE, '?')
}

/** densable re */
function truncateUtf16(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const last = head.charCodeAt(max - 1)
  const cut = last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head
  return Buffer.from(cut, 'utf16le').toString('utf16le')
}

/** densable p$ (bWe + Bls) — artifact card title. */
function artifactCardTitle(raw: string | undefined): string {
  const clean = neutralizeArrows(
    blankInvisibles(titleField(raw ?? '') ?? '')
      .replace(BRACKET_RUN_RE, ' ')
      .replace(/:\u2215\u2215/g, '://'),
  )
    .replace(ANGLE_BRACKET_RUN_RE, ' ')
    .replace(SCHEME_SEPARATOR_RE, SCHEME_SEPARATOR_NEUTRAL)
    .replace(/\s+/g, ' ')
    .trim()
  const cut = truncateUtf16(clean, CARD_TITLE_MAX)
  if (cut === clean) return clean
  return `${cut.endsWith(':\u2215') ? cut.slice(0, -1) : cut}\u2026`
}

/** densable N9e / vm frameUrls entry. */
export type FrameUrlEntry = {
  url: string
  title?: string
  updatedAt?: number
  sessionMinted?: boolean
}

/** densable Loe — share-mode noun for Jrs. */
export function Loe(mode: string): string {
  if (mode === 'org') return 'your organization'
  if (mode === 'users') return 'specific users'
  if (mode === 'public') return 'anyone with the link'
  if (mode === 'agent_scoped') {
    return 'everyone with access to the agent that created it'
  }
  return 'others (unrecognized share mode — treating as shared)'
}

/**
 * densable Jrs @211177457 — audience clause for the delete ask.
 */
export function Jrs(status: { mode?: string } | undefined): string {
  const mode = status?.mode
  switch (mode) {
    case undefined:
    case 'owner':
      return 'private to the user'
    case 'unknown':
      return 'shared, audience unrecognized'
    default:
      return `shared with ${Loe(mode)}`
  }
}

/**
 * densable Qre / jUe / ZP / mp — this conversation published the slug
 * if a non-opened frameUrls row names it (prefer sessionMinted).
 */
export function mp(
  frameUrls: Record<string, FrameUrlEntry> | undefined,
  slug: string,
): FrameUrlEntry | undefined {
  const frames = Object.entries(frameUrls ?? {}).filter(([key, frame]) => {
    if (key.startsWith('opened:') || key.startsWith('attached:')) return false
    return parseArtifactUrl(frame.url)?.slug === slug
  })
  return (
    frames.find(([, frame]) => frame.sessionMinted === true)?.[1] ??
    frames[0]?.[1]
  )
}

/** densable vm — url + card title for the consent prompt. */
export function vm(
  parsed: ParsedArtifactUrl,
  context: Pick<ToolUseContext, 'getAppState'>,
  shareTitle?: string,
): ArtifactDisplay {
  const frameUrls = context.getAppState().frameUrls ?? {}
  const frameTitle = Object.entries(frameUrls)
    .filter(([key]) => !key.startsWith('opened:'))
    .find(
      ([, frame]) =>
        frame.title && parseArtifactUrl(frame.url)?.slug === parsed.slug,
    )?.[1].title
  const title = artifactCardTitle(shareTitle || frameTitle)
  return { url: artifactViewerUrlFor(parsed), ...(title && { title }) }
}

const THIS_ARTIFACT = 'this artifact'

/** densable ztn — the read ask sentence. */
export function ztn(
  kind: ReadProvenanceKind,
  title: string | undefined,
  saveClause?: string,
): string {
  const card = artifactCardTitle(title)
  const named = card ? `"${card}"` : THIS_ARTIFACT
  const lead = card ? `"${card}"` : 'This artifact'
  const question = `Let Claude read it${saveClause ? ` and ${saveClause}` : ''}?`
  switch (kind) {
    case 'someone_else':
      return `${lead} was made by someone else. ${question}`
    case 'unknown':
      return `Claude couldn't check who made ${named}. ${question}`
    case 'cowritten':
      return `Other people can edit ${named}. ${question}`
    case 'from_type':
      return `${lead} was made from someone else's artifact type. ${question}`
  }
}

/** densable xAr — what approving the read covers; `copyFrom` is densable Q6(). */
export function xAr(copyFrom: boolean): string {
  return `Approving covers its files${copyFrom ? ', and copying them into other artifacts,' : ''} for the rest of the conversation.`
}

/** densable ce */
function saysPublic(ruling: AskClassAsk): boolean {
  return (
    ruling.class === 'public_change' &&
    ruling.basis !== 'unattended' &&
    ruling.about !== 'someone_else' &&
    ruling.missing !== 'public'
  )
}

/** densable We */
function classQuestion(
  ruling: AskClassAsk,
  title: string | undefined,
  url: string | undefined,
): string {
  const card = artifactCardTitle(title)
  const named = card ? `"${card}"` : THIS_ARTIFACT
  const lead = card ? `"${card}"` : 'This artifact'
  switch (ruling.class) {
    case 'delete':
      return `Permanently delete ${card || url === undefined ? named : url}?`
    case 'public_change':
      if (saysPublic(ruling))
        return `${lead} is public. Allow Claude to change it?`
      if (ruling.basis === 'unattended')
        return `Allow Claude to change ${named}?`
      if (ruling.about === 'someone_else')
        return ruling.missing === 'owned'
          ? `Claude couldn't check who made ${named}. Allow Claude to change it?`
          : `${lead} was made by someone else. Allow Claude to change it?`
      return `Claude couldn't check who can see ${named}. Allow Claude to change it?`
    case 'access_change':
      return `Allow Claude to change who can open or comment on ${named}?`
    case 'standing_job':
      return `Allow Claude to keep replying to comments on ${named}?`
    case 'foreign_read':
      return ztn(ruling.missing === 'owned' ? 'unknown' : 'someone_else', title)
  }
}

/** densable Ge */
function rememberedQuestion(
  ruling: AskClassAsk,
  title: string | undefined,
  url: string | undefined,
): string {
  const question = classQuestion(ruling, title, url)
  if (ruling.remember !== 'artifact') return question
  const span = isTaskSession() ? 'task' : 'conversation'
  return question.replace(/\?$/, ` for the rest of this ${span}?`)
}

/** densable He */
function outsideOrgNote(ruling: AskClassAsk): string | undefined {
  return ruling.about === 'outside_org' ? Gtn : undefined
}

/** densable eBn — key-sorted JSON. */
function stableStringify(value: unknown): string | undefined {
  if (Array.isArray(value))
    return `[${value.map(item => stableStringify(item) ?? 'null').join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .flatMap(key => {
        const encoded = stableStringify(record[key])
        return encoded === undefined
          ? []
          : [`${JSON.stringify(key)}:${encoded}`]
      })
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** densable L */
function stampOf(value: unknown): string | undefined {
  try {
    return value === undefined ? undefined : stableStringify(value)
  } catch {
    return undefined
  }
}

function analyticsId(
  id: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return (
    /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : 'nonconforming'
  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/** densable Mat */
function recordUnaskedForeignRead(
  action: string,
  slug: string,
  ownerAccountId: string | undefined,
  attested: boolean | undefined,
): void {
  logEvent('tengu_artifact_foreign_read_unasked', {
    action:
      action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    artifact_id: analyticsId(slug),
    ...(ownerAccountId !== undefined && {
      owner_account_id: analyticsId(ownerAccountId),
    }),
    ...(attested && { attested: true }),
  })
}

export type ClassAskEntry = {
  ruling: AskClassRuling
  slug: string
  display: ArtifactDisplay
  action: string
  userOnly?: boolean
  ownerAccountId?: string
  consentHeld?: boolean
  heldYesDoesNotCover?: boolean
  /** Extra sentence spoken after this entry's question. */
  note?: string
}

export type ClassAskDecision<I extends Record<string, unknown>> =
  PermissionAskDecision<I> & {
    defaultToNo?: true
    personOnly?: true
  }

export type ClassDecision<I extends Record<string, unknown>> =
  | PermissionAllowDecision<I>
  | ClassAskDecision<I>
  | PermissionDenyDecision

type AskingEntry = ClassAskEntry & { ruling: AskClassAsk }

/** densable yNe — one decision for several class rulings on one call. */
export function yNe<I extends Record<string, unknown>>(
  input: I,
  context: ConsentContext,
  entries: ClassAskEntry[],
): ClassDecision<I> {
  const toolUseId = context.toolUseId
  if (toolUseId !== undefined) {
    state.askClassPending.delete(toolUseId)
    state.askClassCards.delete(toolUseId)
  }
  const asking: AskingEntry[] = []
  for (const entry of entries) {
    const ruling = entry.ruling
    if (!ruling.ask) {
      if (ruling.foreignRead)
        recordUnaskedForeignRead(
          entry.action,
          entry.slug,
          entry.ownerAccountId,
          ruling.attested,
        )
    } else if (
      ruling.remember !== 'artifact' ||
      !(
        entry.consentHeld ?? Doe(ruling, entry.slug, entry.userOnly === true)
      ) ||
      entry.heldYesDoesNotCover === true
    ) {
      asking.push({ ...entry, ruling })
    }
  }
  if (asking.length === 0)
    return { behavior: 'allow', updatedInput: { ...input, [Wu]: false } }

  const personAnswers = (entry: AskingEntry): boolean =>
    entry.ruling.answeredBy === 'person' || entry.userOnly === true
  asking.sort((a, b) => Number(personAnswers(b)) - Number(personAnswers(a)))
  const personOnly = asking.some(personAnswers)
  const cards = asking.map(entry => ({
    display: entry.display,
    question: rememberedQuestion(
      entry.ruling,
      entry.display.title,
      entry.display.url,
    ),
    note: outsideOrgNote(entry.ruling),
    linked:
      entry.ruling.class === 'foreign_read' ||
      entry.ruling.about === 'someone_else' ||
      entry.ruling.missing === 'owned',
    reach: entry.note,
  }))
  const message = cards
    .flatMap(card =>
      card.reach === undefined ? [card.question] : [card.question, card.reach],
    )
    .join(' ')

  if (
    personOnly
      ? consentMustDeny(context)
      : planConsentMustDeny(context) ||
        (asking.some(entry => entry.ruling.class === 'foreign_read') &&
          isCoworkFrameSession() &&
          consentMustDeny(context))
  )
    return {
      behavior: 'deny',
      message: `Nothing was done. This needs a yes to: ${cards.map(card => card.question).join(' ')} No one can answer in this session.`,
      decisionReason: {
        type: 'safetyCheck',
        reason: `Artifact ${asking.map(entry => entry.ruling.class).join(', ')} ask has no one to answer it`,
        classifierApprovable: false,
      },
    }

  const reachable = canReachUser(context)
  const askedIn = KBe()
  const pending: PendingClassAsk[] = asking.map(entry => ({
    class: entry.ruling.class,
    remember: entry.ruling.remember,
    ...(entry.ruling.endpoint && { endpoint: true as const }),
    slug: entry.slug,
    url: entry.display.url,
    ...(entry.display.title !== undefined && { title: entry.display.title }),
    reachable,
    askedIn,
  }))
  NPe(
    context,
    asking
      .filter(
        entry => entry.ruling.about === 'outside_org' && !entry.ruling.endpoint,
      )
      .map(entry => entry.slug),
    reachable,
  )
  const target = pending.length === 1 ? pending[0] : pending
  if (toolUseId !== undefined) {
    cne(state.askClassPending, toolUseId, pending)
    if (personOnly) cne(state.askClassPersonAsked, toolUseId, true)
    else state.askClassPersonAsked.delete(toolUseId)
    if (classifierDecides(permissionContext(context).mode))
      state.askClassNoClassifier.delete(toolUseId)
    else cne(state.askClassNoClassifier, toolUseId, true)
    const stamp = stampOf(target)
    if (stamp !== undefined) {
      const parts = cards.flatMap(
        ({ display, question, note, linked, reach }) => [
          question,
          ...(note === undefined ? [] : [note]),
          ...(question.includes(display.url) ||
          (!linked && artifactCardTitle(display.title))
            ? []
            : [display.url]),
          ...(reach === undefined ? [] : [reach]),
        ],
      )
      cne(state.askClassCards, toolUseId, {
        stamp,
        parts,
        saysPublic: asking.some(entry => saysPublic(entry.ruling)),
        reason: message,
      })
    }
  }
  return {
    behavior: 'ask',
    message,
    updatedInput: { ...input, [Wu]: false, [$tn]: target },
    ...(asking.some(
      entry =>
        entry.ruling.class === 'delete' ||
        entry.ruling.class === 'access_change',
    ) && {
      defaultToNo: true as const,
    }),
    ...(asking.some(entry => entry.ruling.class === 'access_change') && {
      personOnly: true as const,
    }),
    suppressAlwaysAllowRule: true,
    localDisplayOnly: true,
    decisionReason: {
      type: 'safetyCheck',
      reason: message,
      classifierApprovable: !personOnly,
    },
  }
}

/** densable dD — decide one class ruling. */
export function dD<I extends Record<string, unknown>>(
  args: ClassAskEntry & { input: I; context: ConsentContext },
): ClassDecision<I> {
  return yNe(args.input, args.context, [args])
}
