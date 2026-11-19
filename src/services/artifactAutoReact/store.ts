/**
 * densable un() / Zsr / sxv — Artifact autoReact product store (2.1.239).
 * Source: gold-sxv-239 / gold-Y4n-239 / gold-eDa-239.
 */

export type AutoReactWiring = {
  title?: string
  [key: string]: unknown
}

export type Supervisor = {
  slug: string
  url?: string
  getKnownVer?: unknown
  ownPublishes?: unknown
  context?: unknown
  abort: AbortController
  explicit: boolean
  stopped: boolean
  watchedSince: number
  lastActivityAt: number
  armedVia?: string
  consecutiveFailures: number
  carriedVer?: unknown
  autoReactWiring?: AutoReactWiring
  taskId?: string
  timer?: ReturnType<typeof setTimeout>
  stalledSince?: number
  lastStalledAt?: number
  lease?: unknown
  renewable?: unknown
}

export type BootingWiredArm = {
  scanGeneration: number
  freshPublish?: boolean
  stopGeneration?: number
  title?: string
  [key: string]: unknown
}

/** densable eDa — durable stop latches. */
export class StopLatches {
  #latches = new Map<
    string,
    { pending: number; confirmed: boolean; generation: number }
  >()
  #generation = 1
  #clearedByRewatch = new Set<string>()
  /** densable noteRelatchAsk / takeRelatchAsk — toolUseId → slug → generation. */
  #relatchAsks = new Map<string, Map<string, number>>()
  /** densable noteApprovedWatch — slugs approved after first-watch ask. */
  #approvedWatches = new Set<string>()

  isStopped(slug: string): boolean {
    return this.#latches.has(slug)
  }

  latchGeneration(slug: string): number | undefined {
    return this.#latches.get(slug)?.generation
  }

  confirmStop(slug: string): void {
    this.#clearedByRewatch.delete(slug)
    const cur = this.#latches.get(slug)
    if (cur === undefined) {
      this.#latches.set(slug, {
        pending: 0,
        confirmed: true,
        generation: this.#generation++,
      })
    } else {
      cur.confirmed = true
      cur.generation = this.#generation++
    }
  }

  /**
   * densable recordStop — latch + return settle handle (wasWatching/teardown bookkeeping).
   */
  recordStop(slug: string): {
    settle: (info: { wasWatching: boolean; teardown?: unknown }) => void
  } {
    this.confirmStop(slug)
    return {
      settle: (_info: { wasWatching: boolean; teardown?: unknown }) => {
        /* densable settle pins latch; tip confirmStop already latched */
        void _info
      },
    }
  }

  reaffirmStop(slug: string): void {
    this.#clearedByRewatch.delete(slug)
    const cur = this.#latches.get(slug)
    if (cur === undefined) this.confirmStop(slug)
    else cur.confirmed = true
  }

  wasClearedByRewatch(slug: string): boolean {
    return this.#clearedByRewatch.has(slug) && !this.#latches.has(slug)
  }

  clearByApprovedRewatch(slug: string, generation: number): void {
    const cur = this.#latches.get(slug)
    if (cur === undefined || cur.generation !== generation) return
    this.#latches.delete(slug)
    this.#clearedByRewatch.add(slug)
  }

  /** densable noteRelatchAsk */
  noteRelatchAsk(toolUseId: string, slug: string): void {
    const gen = this.#latches.get(slug)?.generation
    if (gen === undefined) return
    let bySlug = this.#relatchAsks.get(toolUseId)
    if (!bySlug) {
      bySlug = new Map()
      this.#relatchAsks.set(toolUseId, bySlug)
    }
    bySlug.set(slug, gen)
  }

  /** densable takeRelatchAsk — consume noted generation for approved rewatch. */
  takeRelatchAsk(toolUseId: string, slug: string): number | undefined {
    const bySlug = this.#relatchAsks.get(toolUseId)
    if (!bySlug) return undefined
    const gen = bySlug.get(slug)
    bySlug.delete(slug)
    if (bySlug.size === 0) this.#relatchAsks.delete(toolUseId)
    return gen
  }

  /** densable noteApprovedWatch */
  noteApprovedWatch(slug: string): void {
    this.#approvedWatches.add(slug)
  }

  wasApprovedWatch(slug: string): boolean {
    return this.#approvedWatches.has(slug)
  }
}

export type CommentMonitorIntentLine = {
  state: 'armed' | 'stopped'
  writtenAtMs: number
  title?: string
  holder?: 'bg' | string
}

export type DurableWatchRow = {
  slug: string
  triggerId: string
  since: string
  events: string[]
  unreleased?: string[]
  restored?: boolean
}

export type LedgerThreadSnapshot = {
  id: string
  activatedAt: string | null
  activatedAtObserved: boolean
  seen: string[]
  sent: Array<[string, number | null]>
  ownReplyIds: string[]
  ownReplyIdsIncomplete?: boolean
}

export type LedgerArtifactSnapshot = {
  savedAt: number
  stampHighWater: string | null
  everBaselined: boolean
  everHadThreads: boolean
  turnTimestamps: number[]
  threads?: LedgerThreadSnapshot[]
  interrupted?: boolean
}

export type PendingLedger = {
  sid: string
  accountUuid: string | null
  slugs: Map<string, LedgerArtifactSnapshot>
}

/**
 * densable shareStatus.noticeReadSights row (`class u` @186730680).
 * note(toolUseId, slug, seen); take(toolUseId, slug) consumes the call.
 */
export class NoticeReadSights {
  #byCall = new Map<string, Map<string, boolean>>()
  #evicted = new Set<string>()

  note(toolUseId: string, slug: string, seen: boolean): void {
    if (this.#evicted.has(toolUseId)) return
    const cur = this.#byCall.get(toolUseId)
    if (cur !== undefined) {
      if (cur.has(slug)) return
      if (cur.size >= 4) {
        this.#evict(toolUseId)
        return
      }
      cur.set(slug, seen)
      return
    }
    if (this.#byCall.size >= 256) {
      let drop = 128
      for (const id of this.#byCall.keys()) {
        this.#evict(id)
        if (--drop === 0) break
      }
    }
    this.#byCall.set(toolUseId, new Map([[slug, seen]]))
  }

  take(toolUseId: string, slug: string): boolean | undefined {
    const cur = this.#byCall.get(toolUseId)
    this.#byCall.delete(toolUseId)
    return cur?.get(slug)
  }

  #evict(toolUseId: string): void {
    this.#byCall.delete(toolUseId)
    this.#evicted.add(toolUseId)
  }
}

/**
 * densable P() row @186941645 — other-comments sightings for one slug.
 * Gold: `{sightings, judged, judgedSends, lastText, textsForgotten}`.
 */
export type OtherCommentSighting =
  | { seq: number; kind: 'row'; key: string; authorship: string }
  | { seq: number; kind: 'gap' }
  | { seq: number; kind: 'handIn'; threadId: string; gestureAt: number }

export type OtherCommentsRow = {
  sightings: OtherCommentSighting[]
  judged: Map<string, unknown>
  judgedSends: Map<string, unknown>
  lastText: Map<string, string>
  textsForgotten: boolean
}

function emptyOtherCommentsRow(): OtherCommentsRow {
  return {
    sightings: [],
    judged: new Map(),
    judgedSends: new Map(),
    lastText: new Map(),
    textsForgotten: false,
  }
}

/** densable P(e) — get-or-create otherComments row for slug. */
export function otherCommentsRow(slug: string): OtherCommentsRow {
  const rows = un().shareStatus.otherComments
  let row = rows.get(slug)
  if (row === undefined) {
    row = emptyOtherCommentsRow()
    rows.set(slug, row)
  }
  return row
}

/** densable T() — bump otherCommentSeq. */
export function nextOtherCommentSeq(): number {
  const status = un().shareStatus
  status.otherCommentSeq += 1
  return status.otherCommentSeq
}

/** densable zht(e) — last sighting seq, or undefined. */
export function latestOtherCommentSeq(slug: string): number | undefined {
  return un().shareStatus.otherComments.get(slug)?.sightings.at(-1)?.seq
}

/**
 * densable Ght(e) — true when the slug has at least one sighting.
 */
export function hasOtherCommentSightings(slug: string): boolean {
  const row = un().shareStatus.otherComments.get(slug)
  return row !== undefined && row.sightings.length > 0
}

/**
 * densable Bzr(e,n) — drop sightings with seq ≤ n. No-op if the row
 * is missing or n is undefined (gold `r===void 0||n===void 0`).
 */
export function forgetOtherCommentSightings(
  slug: string,
  afterSeq?: number,
): void {
  const row = un().shareStatus.otherComments.get(slug)
  if (row === undefined || afterSeq === undefined) return
  row.sightings = row.sightings.filter(s => s.seq > afterSeq)
}

/** densable `z` @186941645 — sightings ring cap. */
const OTHER_COMMENT_SIGHTINGS_CAP = 64

/**
 * densable D(e,n) — push a sighting, then splice down to the last 64.
 */
function D(row: OtherCommentsRow, sighting: OtherCommentSighting): void {
  row.sightings.push(sighting)
  if (row.sightings.length > OTHER_COMMENT_SIGHTINGS_CAP) {
    row.sightings.splice(0, row.sightings.length - OTHER_COMMENT_SIGHTINGS_CAP)
  }
}

/**
 * densable D(P(e), {seq:T(), ...}) — production sightings.push.
 */
export type OtherCommentDraft = OtherCommentSighting extends infer T
  ? T extends OtherCommentSighting
    ? Omit<T, 'seq'>
    : never
  : never

export function recordOtherCommentSighting(
  slug: string,
  sighting: OtherCommentDraft,
): void {
  D(otherCommentsRow(slug), {
    ...sighting,
    seq: nextOtherCommentSeq(),
  } as OtherCommentSighting)
}

/** densable XBe(e) — record a gap sighting. */
export function noteOtherCommentGap(slug: string): void {
  D(otherCommentsRow(slug), { seq: nextOtherCommentSeq(), kind: 'gap' })
}

/** densable o0t / M3i comment census row */
export type CommentCensusEntry = {
  readIds: Set<string> | null
  sinceMs: number
  dirty: boolean
  generation: number
  plain: number
  awaiting: number
  partial: boolean
}

/** densable jAr E() opening-comment preview `by`. */
export type CommentThreadPreviewBy = 'user' | 'claude' | 'viewer' | 'unknown'

/** densable jAr E() return — ask-copy target for a comment thread. */
export type CommentThreadPreview = {
  display: {
    thread_id: string
    by: CommentThreadPreviewBy
    excerpt: string
    replies: number
    resolved: boolean
  }
  access?: string
}

/** densable commentTargets cache row. */
export type CommentTargetCacheEntry = {
  target: CommentThreadPreview
  toolUseId?: string
}

export type ArtifactAutoReactStore = {
  live: {
    handoffGeneration: number
    inFlightSubscribes: Set<string>
    inFlightWiredIntent: Set<string>
    retiredInFlightArms: Set<string>
    bootingWiredArms: Map<string, BootingWiredArm>
    pendingInFlightWiring: Map<string, unknown>
    supervisors: Map<string, Supervisor>
    commentCensus: Map<string, CommentCensusEntry>
    pendingRegistrations: number
    mostRecentPublishSlug?: string
    disposed: boolean
    endAll?: (reason?: string) => void
    /** densable live.heardVersions — F7e clears on a new conversation. */
    heardVersions: Map<string, unknown>
    /** densable live.nonEditorSlugs */
    nonEditorSlugs: Set<string>
    /** densable live.pendingSubagentArms */
    pendingSubagentArms: Map<string, unknown>
    /** densable live.finishedSubagentAdopters */
    finishedSubagentAdopters: Set<string>
    /** densable live.repliesConsent */
    repliesConsent: {
      outstanding: Map<string, unknown>
      declined: Map<string, unknown>
      approved: Set<string>
    }
  }
  autoReact: {
    artifacts: Map<string, unknown>
    optIn: boolean | null
    responderDispatchOptIn: boolean | null
    userDisarmed: boolean
    enabledMemo: boolean | null
    unattendedReplies: Map<string, number>
    postSeq: number
    probeSeq: number
    coalesceMsOverride: number | null
    maxAutoTurnsOverride: number | null
    confirmDwellMsOverride: number | null
    pendingLedger: PendingLedger | null
    ledgerLastWritten: string | null
    ledgerLastWriteAt: number | null
    ledgerLastWriteSid: string | null
    ledgerLastWriteAccount: string | null | undefined
    ledgerFailureSeqAtWrite: number | null
    ledgerDeferredSince: number | null
    ledgerLastAppend: Promise<void> | undefined
    ledgerOwnerSid: string | null
    ledgerRetiredSids: Set<string>
    ledgerSupersedable: boolean
    ledgerTimer: ReturnType<typeof setTimeout> | undefined
    ledgerDebounceMsOverride: number | null
    ledgerMaxAgeMsOverride: number | null
    ledgerStorageV5: unknown
    ledgerExitCleanup: (() => void) | undefined
    ledgerExitReStamp: (() => void) | undefined
    /** densable fastAckSelectDeadlineMsOverride — KPw select cap. */
    fastAckSelectDeadlineMsOverride: number | null
  }
  wakes: {
    wakes: Map<string, unknown>
    stoppedSlugs: Set<string>
    sweptSlugs: Set<string>
    orphanedSweptSlugs: Set<string>
    scanGeneration: number
    stopGenerations: Map<string, number>
    pendingResumeDisclosure: Set<string>
  }
  durable: {
    rows: Map<string, DurableWatchRow>
    registrySink:
      | ((payload: { artifact_durable_watches: unknown }) => void)
      | null
    registryPublished: string
    unwatchedSlugs: Set<string>
    orphanTriggers: Set<string>
    pendingRestoredRows: Map<string, DurableWatchRow>
    slugOps: Map<string, unknown>
    stopLatches: StopLatches
    pendingOps: Set<Promise<unknown>>
    originatorRefused: boolean
    watchUrlWithheld: string | null
    watchUrlGranted: boolean
    armsInFlight: Map<string, unknown>
    armOutcomes: Map<string, unknown>
    announcedArmFailures: Set<string>
  }
  commentMonitorIntent: {
    sid: string | null
    bySlug: Map<string, CommentMonitorIntentLine>
    parked: Map<
      string,
      {
        path?: string
        line: Record<string, CommentMonitorIntentLine>
        traveling?: Set<string>
      }
    >
    forgottenAt: Map<string, number>
    onFile: boolean
    adoptPendingFor: string | null
    earlySeed:
      | Map<string, CommentMonitorIntentLine>
      | Record<string, CommentMonitorIntentLine>
      | undefined
    tornStops: Set<string>
    leftWith: string | null
    pendingRestore: Map<string, CommentMonitorIntentLine> | null
  }
  /** densable oSe.unresumedFrameLive — awh/lwh park. */
  unresumedFrameLive: Map<
    string,
    { entries: Array<Record<string, unknown>>; owner: string }
  >
  /** densable oSe.exitRetryFrameLive */
  exitRetryFrameLive: Map<string, Array<Record<string, unknown>>>
  /** densable noticeCoalesce — cvl / Ygw burst queue. */
  noticeCoalesce: Map<string, NoticeCoalesceEntry>
  /**
   * densable contentHostEgressDenied — once content-host JSON egress fails for
   * an env, fall back to control-plane comments until a successful Y0m clears it.
   */
  contentHostEgressDenied: Set<string>
  /**
   * densable assetsOnRoster — frame contract declared `assets` (rxl gate when !sEe).
   */
  assetsOnRoster: boolean
  /**
   * densable summonSeeds — desktop visible-handoff claims keyed by Bkl(slug,thread,toClaudeAt).
   */
  summonSeeds: {
    claims: Set<string>
    graceMsOverride: number | null
  }
  /** densable accountEpoch — reply echo epoch stamp. */
  accountEpoch: number
  /**
   * densable conversationEpoch — F7e bumps this on a new conversation
   * (`/clear`, rewind) unless `continuesConversation`. `KBe()` keys five-class
   * consent and OCo/D1n scopes as `${accountEpoch}:${conversationEpoch}`.
   */
  conversationEpoch: number
  /** densable ownPublishedSlugs — F7e clears unless continuesConversation. */
  ownPublishedSlugs: Map<string, unknown>
  /** Official 325 #1756 — 1h cache of artifacts known to have no database. */
  dbUndeclaredAt: Map<string, number>
  dbUndeclaredDroppedAt: Map<string, number>
  /** densable ownCreatedSlugs */
  ownCreatedSlugs: Map<string, unknown>
  /** densable strandedMints */
  strandedMints: Map<string, unknown>
  /** densable reservedMints */
  reservedMints: Set<string>
  /** densable roomJoinArming */
  roomJoinArming: Set<string>
  /** densable roomStoppedByUser */
  roomStoppedByUser: Set<string>
  /** densable roomArmAsked */
  roomArmAsked: Map<string, unknown>
  /** densable roomArmRefusedByUser */
  roomArmRefusedByUser: Set<string>
  /** densable deferredSurface */
  deferredSurface: Map<string, unknown>
  /** densable remoteControlSkippedSlugs */
  remoteControlSkippedSlugs: Set<string>
  /**
   * densable createdFromType — F7e always clears; N9e restores from resume
   * seed (`mNr` empty when !local / !seedEligible).
   */
  createdFromType: Map<string, unknown>
  /** densable verify — F7e always drops lastPublish and clears reads. */
  verify: {
    lastPublish: unknown
    reads: Map<string, unknown>
  }
  /** densable pathPinSeq — QXt stamps seq on restore. */
  pathPinSeq: number
  /** densable pathPins — F7e clears unless continuesConversation. */
  pathPins: Map<string, Map<string, PathPinEntry>>
  /** densable refusedPublishBodies — optimistic-concurrency resend guard. */
  refusedPublishBodies: Map<string, RefusedPublishBodyEntry>
  /** densable resultNotes — F7e resets unless continuesConversation. */
  resultNotes: {
    kindSaid: boolean
    watchCodesSaid: Set<string>
    previewedPaths: Set<string>
    previewHintedPaths: Set<string>
  }
  /**
   * densable commentTargets — jAr @194348914 thread-preview cache.
   * Key `${slug}/${threadId}`.
   */
  commentTargets: Map<string, CommentTargetCacheEntry>
  /**
   * densable shareStatus — ownership / share probe cache (ip / Kgl / Fee).
   * densable 2.1.289: probeBoots reuses a non-lean boot within the same toolUseId.
   */
  shareStatus: {
    bySlug: Map<string, ArtifactShareStatus>
    filePathToSlug: Map<string, string>
    pendingNoticeSlugs: Set<string>
    /**
     * densable probeBoots — keyed by slug; TTL 60s (Ze).
     * boot shape matches fetchFrameBoot ok result (not lean).
     */
    probeBoots: Map<
      string,
      {
        toolUseId: string
        issuedAt: number
        boot: ProbeCachedBoot
      }
    >
    /**
     * densable k7 @199727074 — Fee-notice read sightings keyed by action.
     */
    noticeReadSights: {
      comments: NoticeReadSights
      read: NoticeReadSights
      verify: NoticeReadSights
    }
    /**
     * densable shareStatus.otherComments — Ght / Bzr / P() @186941645.
     * Keyed by artifact slug. qIt calls Bzr after an approved upload.
     */
    otherComments: Map<string, OtherCommentsRow>
    /** densable otherCommentSeq — P()/T() sighting sequence. */
    otherCommentSeq: number
  }
  /**
   * densable frameRelay — ccr-gateway decline/serve windows (sEe / tgr / _zt).
   */
  frameRelay: {
    declinedUntil: Map<string, number>
    servedUntil: Map<string, number>
  }
  /**
   * densable kGi interactionSchemas — lazy via ensureInteractionSchemas().
   */
  interactionSchemas?: {
    byName: Map<
      string,
      {
        doc: {
          format: number
          name: string
          island: string
          key: string
          maxEntries: number
          fields: Record<string, unknown>
          invariants: unknown[]
        }
        enabled: () => boolean
        derive?: (entries: unknown) => Record<string, string>
      }
    >
    islandOwners: Map<string, string>
    metaVerdicts: Map<string, null | 'invalid'>
  }
  /** densable frozenReadPageDataSchemaNames — set at Artifact input-schema build. */
  frozenReadPageDataSchemaNames?: Set<string>
  /**
   * densable frozenArtifactTypes — Qps / bu pin. Default undefined
   * (no typesOn assignment from ZKe/MP).
   */
  frozenArtifactTypes?: {
    typesOn: boolean
    typeCreateOn: boolean
    typeCatalogOn: boolean
    quickstartOn?: boolean
  }
  workshopTelemetry: {
    startedSeen: string[]
    completedSeen: string[]
    startedPublishes: Record<string, number>
    publishedSeen: string[]
    invokeT0: number | null
  }
  /**
   * densable verifiedAttachments — en() chat-attachment identity by real path.
   */
  verifiedAttachments: Map<string, ArtifactAttachmentIdentity>
}

export type ArtifactShareRole =
  | 'owner'
  | 'writer'
  | 'reader'
  | 'commenter'
  | 'viewer'
  | 'unknown'

export type ArtifactShareStatus = {
  mode: string
  isSharedLive: boolean
  role?: ArtifactShareRole
  cowritten?: boolean
  title?: string
  probeFailed?: boolean
  probeErrorCode?: string
  artifactKind?: string
  lastProbeToolUseId?: string
  /**
   * 2.1.325 #2312 (SEA `zBe` / `mFo` @286618701): concurrent/overlapping tool
   * calls that shared the same ownership probe so parallel `read` + `read_db`
   * calls on the user's own artifact all recognize confirmed ownership.
   */
  probeSharedWith?: string[]
  outsideAudience?: boolean
  lastProbeAt?: number
  lastProbeLandedAt?: number
  lastProbeIssuedAt?: number
  /** densable Wjt — page capability snapshot from Tu readBack. */
  capabilities?: unknown
  capabilitiesUnknown?: boolean
  lastCapsReadAt?: number
  lastCapsLandedAt?: number
  lastCapsIssuedAt?: number
  lastCapsReadToolUseId?: string
}

/** densable en / xKe identity for a session chat-attachment pin. */
export type ArtifactAttachmentIdentity = {
  dev: number
  ino: number
}

/**
 * densable probeBoots entry boot — frame boot ok shape cached for reuse.
 * Matches mint `FrameBootOk` (kept here to avoid store↔mint import cycle).
 */
export type ProbeCachedBoot = {
  err: null
  data: Record<string, unknown>
  ver: string
  assetToken: string | undefined
  route?: 'direct' | 'relay'
  reused?: boolean
}

export type NoticeCoalesceFamily =
  | 'artifact-auto-react'
  | 'artifact-changed'
  | 'auto-replied'
  | 'auto-edited'

export type NoticeCoalesceEntry = {
  slug: string
  family: NoticeCoalesceFamily
  artifactName: string
  mergeDetails: 'append' | 'latest'
  count: number
  threadIds: Set<string>
  firstAt: number
  details: string[]
  droppedDetails: number
  suppressedPrior: number
  queue?: {
    enqueuePendingNotification: typeof import('../../utils/messageQueueManager.js').enqueuePendingNotification
  }
  timer?: ReturnType<typeof setTimeout>
}

export const MAX_WATCHED_ARTIFACTS = 25 // Official `BR` (2.1.299 #712: raised from 10 to 25)
export const MAX_RECENT_ARTIFACTS = 3 * MAX_WATCHED_ARTIFACTS

const REWATCH_TIMING = {
  baseMs: 1000,
  capMs: 30_000,
  minUptimeMs: 60_000,
  maxConsecutiveFailures: 10,
  idleTtlMs: 0,
}

/** densable sxv — product-relevant subset (Irs / Stn / wtn / $so / Dso / durable / reply). */
export function createArtifactAutoReactStore(): ArtifactAutoReactStore {
  return {
    live: {
      handoffGeneration: 0,
      inFlightSubscribes: new Set(),
      inFlightWiredIntent: new Set(),
      retiredInFlightArms: new Set(),
      bootingWiredArms: new Map(),
      pendingInFlightWiring: new Map(),
      supervisors: new Map(),
      commentCensus: new Map(),
      pendingRegistrations: 0,
      mostRecentPublishSlug: undefined,
      disposed: false,
      heardVersions: new Map(),
      nonEditorSlugs: new Set(),
      pendingSubagentArms: new Map(),
      finishedSubagentAdopters: new Set(),
      repliesConsent: {
        outstanding: new Map(),
        declined: new Map(),
        approved: new Set(),
      },
    },
    autoReact: {
      artifacts: new Map(),
      optIn: null,
      responderDispatchOptIn: null,
      userDisarmed: false,
      enabledMemo: null,
      unattendedReplies: new Map(),
      postSeq: 0,
      probeSeq: 0,
      coalesceMsOverride: null,
      maxAutoTurnsOverride: null,
      confirmDwellMsOverride: null,
      pendingLedger: null,
      ledgerLastWritten: null,
      ledgerLastWriteAt: null,
      ledgerLastWriteSid: null,
      ledgerLastWriteAccount: undefined,
      ledgerFailureSeqAtWrite: null,
      ledgerDeferredSince: null,
      ledgerLastAppend: undefined,
      ledgerOwnerSid: null,
      ledgerRetiredSids: new Set(),
      ledgerSupersedable: false,
      ledgerTimer: undefined,
      ledgerDebounceMsOverride: null,
      ledgerMaxAgeMsOverride: null,
      ledgerStorageV5: undefined,
      ledgerExitCleanup: undefined,
      ledgerExitReStamp: undefined,
      fastAckSelectDeadlineMsOverride: null,
    },
    wakes: {
      wakes: new Map(),
      stoppedSlugs: new Set(),
      sweptSlugs: new Set(),
      orphanedSweptSlugs: new Set(),
      scanGeneration: 0,
      stopGenerations: new Map(),
      pendingResumeDisclosure: new Set(),
    },
    durable: {
      rows: new Map(),
      registrySink: null,
      registryPublished: '',
      unwatchedSlugs: new Set(),
      orphanTriggers: new Set(),
      pendingRestoredRows: new Map(),
      slugOps: new Map(),
      stopLatches: new StopLatches(),
      pendingOps: new Set(),
      originatorRefused: false,
      watchUrlWithheld: null,
      watchUrlGranted: false,
      armsInFlight: new Map(),
      armOutcomes: new Map(),
      announcedArmFailures: new Set(),
    },
    commentMonitorIntent: {
      sid: null,
      bySlug: new Map(),
      parked: new Map(),
      forgottenAt: new Map(),
      onFile: false,
      adoptPendingFor: null,
      earlySeed: undefined,
      tornStops: new Set(),
      leftWith: null,
      pendingRestore: null,
    },
    unresumedFrameLive: new Map(),
    exitRetryFrameLive: new Map(),
    noticeCoalesce: new Map(),
    contentHostEgressDenied: new Set(),
    assetsOnRoster: false,
    summonSeeds: {
      claims: new Set(),
      graceMsOverride: null,
    },
    accountEpoch: 0,
    conversationEpoch: 0,
    ownPublishedSlugs: new Map(),
    ownCreatedSlugs: new Map(),
    dbUndeclaredAt: new Map(),
    dbUndeclaredDroppedAt: new Map(),
    strandedMints: new Map(),
    reservedMints: new Set(),
    roomJoinArming: new Set(),
    roomStoppedByUser: new Set(),
    roomArmAsked: new Map(),
    roomArmRefusedByUser: new Set(),
    deferredSurface: new Map(),
    remoteControlSkippedSlugs: new Set(),
    createdFromType: new Map(),
    verify: {
      lastPublish: undefined,
      reads: new Map(),
    },
    pathPinSeq: 0,
    pathPins: new Map(),
    refusedPublishBodies: new Map(),
    resultNotes: {
      kindSaid: false,
      watchCodesSaid: new Set(),
      previewedPaths: new Set(),
      previewHintedPaths: new Set(),
    },
    commentTargets: new Map(),
    shareStatus: {
      bySlug: new Map(),
      filePathToSlug: new Map(),
      pendingNoticeSlugs: new Set(),
      probeBoots: new Map(),
      noticeReadSights: {
        comments: new NoticeReadSights(),
        read: new NoticeReadSights(),
        verify: new NoticeReadSights(),
      },
      otherComments: new Map(),
      otherCommentSeq: 0,
    },
    frameRelay: {
      declinedUntil: new Map(),
      servedUntil: new Map(),
    },
    workshopTelemetry: {
      startedSeen: [],
      completedSeen: [],
      startedPublishes: {},
      publishedSeen: [],
      invokeT0: null,
    },
    verifiedAttachments: new Map(),
  }
}

/** densable Lwp / Zsr / axv.of(ar()) — process singleton holder. */
class StoreHolder {
  current: ArtifactAutoReactStore | undefined = undefined
}

const holder = new StoreHolder()

/** densable Zsr */
export function getArtifactAutoReactHolder(): StoreHolder {
  return holder
}

/** densable un() */
export function un(): ArtifactAutoReactStore {
  const h = getArtifactAutoReactHolder()
  h.current ??= createArtifactAutoReactStore()
  return h.current
}

/** Test helper — drop store (densable account-switch wipe subset). */
export function resetArtifactAutoReactStoreForTests(): void {
  holder.current = undefined
}

export type RefusedPublishBodyEntry = {
  sha256: string
  live?: string
  forceRefused?: boolean
  batch?: string
  observedFrom?: string
  unreadSourcePath?: string
  unviewed?: boolean
}

export type PathPinBehind = {
  sha256: string | null
  sizeBytes?: number
  ver: string
}

export type PathPinEntry = {
  seq?: number
  sha256?: string | null
  ver?: string
  via?: 'read' | 'list' | 'publish'
  behind?: PathPinBehind
}

const PATH_PIN_CONFLICT_LEAD =
  'Nothing was published or removed: this publish touches files whose published content is not what you last saw'
const PATH_PIN_CHANGED_HEADER = 'Changed since you last saw them:'
const PATH_PIN_UNREAD_HEADER =
  'Already published, and not read as published or listed by you in this session:'
const PATH_PIN_HIDDEN_HEADER = 'Already published, and not shown to you:'
const PATH_PIN_MAX_LISTED = 20

function getSlugPins(slug: string): Map<string, PathPinEntry> {
  const store = un()
  let pins = store.pathPins.get(slug)
  if (pins === undefined) {
    pins = new Map()
    store.pathPins.set(slug, pins)
  }
  return pins
}

function nextPathPinSeq(): number {
  const store = un()
  store.pathPinSeq += 1
  return store.pathPinSeq
}

function setPinIfNotStale(
  pins: Map<string, PathPinEntry>,
  path: string,
  entry: Omit<PathPinEntry, 'seq'>,
  seq: number,
): void {
  const existing = pins.get(path)
  if (existing !== undefined && (existing.seq ?? 0) > seq) return
  pins.set(path, { ...entry, seq })
}

export function pinArtifactPath(
  slug: string,
  path: string,
  sha256: string | null,
  ver: string,
  via: 'read' | 'list',
  seq = nextPathPinSeq(),
): void {
  setPinIfNotStale(getSlugPins(slug), path, { sha256, ver, via }, seq)
}

export function unpinArtifactPath(
  slug: string,
  path: string,
  seq = nextPathPinSeq(),
): void {
  const pins = un().pathPins.get(slug)
  const existing = pins?.get(path)
  if (existing !== undefined && (existing.seq ?? 0) < seq) {
    pins?.delete(path)
  }
}

export function recordPublishedPathPins(
  slug: string,
  ver: string,
  committed: {
    written: Array<{ path: string; sha256?: string }>
    removed: string[]
  },
): void {
  const pins = getSlugPins(slug)
  const seq = nextPathPinSeq()
  for (const w of committed.written) {
    if (w.sha256 === undefined) {
      pins.delete(w.path)
    } else {
      setPinIfNotStale(
        pins,
        w.path,
        { sha256: w.sha256, ver, via: 'publish' },
        seq,
      )
    }
  }
  for (const removedPath of committed.removed) {
    setPinIfNotStale(
      pins,
      removedPath,
      { sha256: null, ver, via: 'publish' },
      seq,
    )
  }
}

export type PathPinWriteInput = { path: string; sha256?: string }

export type PathPinDiffItem =
  | {
      kind: 'unread'
      path: string
      operation: 'write' | 'remove'
    }
  | {
      kind: 'changed'
      path: string
      operation: 'write' | 'remove'
      readSha256: string | null | undefined
      readVer: string | undefined
      readVia: 'read' | 'list' | 'publish' | undefined
      liveSha256: string | null
    }

/** Gold `D()` — evaluate path pins against live file sha256s and `overwrite_unread` (`acknowledged`). */
export function diffPublishPathPins(input: {
  pins: Map<string, PathPinEntry> | undefined
  live: Map<string, string | null>
  liveDocs?: Set<string>
  writes: PathPinWriteInput[]
  removes: string[]
  acknowledged: Set<string>
}): PathPinDiffItem[] {
  const conflicts: PathPinDiffItem[] = []
  const ops: Array<{
    path: string
    operation: 'write' | 'remove'
    sha256?: string
  }> = [
    ...input.writes.map(w => ({ ...w, operation: 'write' as const })),
    ...input.removes.map(p => ({
      path: p,
      operation: 'remove' as const,
      sha256: undefined,
    })),
  ]
  for (const op of ops) {
    if (input.liveDocs?.has(op.path)) continue
    const pin = input.pins?.get(op.path)
    const liveSha = input.live.get(op.path) ?? null
    if (pin === undefined) {
      if (liveSha === null || input.acknowledged.has(op.path)) continue
      if (op.operation === 'write' && op.sha256 === liveSha) continue
      conflicts.push({ kind: 'unread', path: op.path, operation: op.operation })
      continue
    }
    if (pin.sha256 === liveSha) continue
    if (
      op.operation === 'write' &&
      op.sha256 !== undefined &&
      op.sha256 === liveSha
    ) {
      continue
    }
    if (op.operation === 'remove' && liveSha === null) continue
    conflicts.push({
      kind: 'changed',
      path: op.path,
      operation: op.operation,
      readSha256: pin.sha256,
      readVer: pin.ver,
      readVia: pin.via,
      liveSha256: liveSha,
    })
  }
  return conflicts
}

function formatPinChangedLine(
  item: Extract<PathPinDiffItem, { kind: 'changed' }>,
  liveVer: string,
  files: Map<string, { sha256: string; sizeBytes?: number }>,
): string {
  const seenNote =
    item.readSha256 !== null
      ? `you last saw it at version ${item.readVer ?? 'unknown'}`
      : item.readVia === 'publish'
        ? `you removed it at version ${item.readVer ?? 'unknown'}`
        : `it was gone when you last checked (version ${item.readVer ?? 'unknown'})`
  const nowNote =
    item.liveSha256 === null
      ? `it has since been removed (version ${liveVer})`
      : item.readSha256 === null
        ? `someone has since published a file there (version ${liveVer})`
        : `someone has since replaced it (version ${liveVer})`
  const info = files.get(item.path)
  const detail =
    info === undefined
      ? '  now: deleted; publishing this path again creates it afresh, so do that only if the user wants it back'
      : `  now: sha256 ${info.sha256}${info.sizeBytes !== undefined ? `, ${info.sizeBytes} ${info.sizeBytes === 1 ? 'byte' : 'bytes'}` : ''}`
  return `- ${JSON.stringify(item.path)}: ${seenNote}; ${nowNote}\n${detail}`
}

/** Gold `H()` — format path-pin refusal message for `changed` and `unread` conflicts. */
export function formatPathPinRefusalMessage(
  conflicts: PathPinDiffItem[],
  liveVer: string,
  opts: {
    files: Map<string, { sha256: string; sizeBytes?: number }>
    forced: boolean
    ackOffered?: boolean
  },
): string {
  const changed = conflicts.filter(
    (c): c is Extract<PathPinDiffItem, { kind: 'changed' }> =>
      c.kind === 'changed',
  )
  const unread = conflicts.filter(
    (c): c is Extract<PathPinDiffItem, { kind: 'unread' }> =>
      c.kind === 'unread',
  )
  const sections: string[] = [
    changed.length > 0
      ? `${PATH_PIN_CONFLICT_LEAD}, and sending your copy would replace a newer edit.`
      : `${PATH_PIN_CONFLICT_LEAD}, and sending your copy could discard content you have not read.`,
  ]
  const changedSlice = changed.slice(0, PATH_PIN_MAX_LISTED)
  if (changed.length > 0) {
    const hasDeleted = changed.some(c => c.liveSha256 === null)
    sections.push(
      `${PATH_PIN_CHANGED_HEADER}\n${changedSlice.map(c => formatPinChangedLine(c, liveVer, opts.files)).join('\n')}\nRead each one${hasDeleted ? ' that still exists' : ''} again (action "read_file"), re-apply your change to what it holds now, and publish again${hasDeleted ? '; a deleted one needs no read' : ''}. Never resend your earlier copy.${opts.forced ? ' `force` does not override this.' : ''}`,
    )
  }
  if (unread.length > 0) {
    const unreadSlice = unread.slice(
      0,
      Math.max(0, PATH_PIN_MAX_LISTED - changedSlice.length),
    )
    sections.push(
      `${PATH_PIN_UNREAD_HEADER}\n${unreadSlice.map(u => `- ${JSON.stringify(u.path)}`).join('\n')}\nRead each one first (action "read_file") and build on it.${opts.ackOffered === false ? ' Do so even when the user wants the file replaced outright.' : ' Only when the user asked for the file to be replaced without looking, name it in `overwrite_unread`.'}`,
    )
  }
  return sections.join('\n\n')
}

/** Gold `AUi()` — concise UI error summary for path-pin refusals. */
export function formatPathPinConflictUiMessage(
  errorText: string,
): string | undefined {
  if (!errorText.startsWith(PATH_PIN_CONFLICT_LEAD)) return undefined
  const sliceSection = (start: number, ends: number[]): string => {
    if (start === -1) return ''
    const end = ends.filter(e => e > start).sort((a, b) => a - b)[0]
    return errorText.slice(start, end)
  }
  const changedIdx = errorText.indexOf(`\n${PATH_PIN_CHANGED_HEADER}`)
  const unreadIdx = errorText.indexOf(`\n${PATH_PIN_UNREAD_HEADER}`)
  const hiddenIdx = errorText.indexOf(`\n${PATH_PIN_HIDDEN_HEADER}`)
  const changedSec = sliceSection(changedIdx, [unreadIdx, hiddenIdx])
  const unreadSec = sliceSection(unreadIdx, [hiddenIdx])
  const hiddenSec = sliceSection(hiddenIdx, [])
  const matchPaths = (sec: string): string[] =>
    [...sec.matchAll(/^- ("(?:[^"\\]|\\.)*")/gm)].map(m => m[1]!)
  const matchExtra = (sec: string): number =>
    Number(
      /^- (?:and )?(\d+) (?:more|paths?, not named here):/m.exec(sec)?.[1] ?? 0,
    )
  const changedPaths = matchPaths(changedSec)
  const unreadPaths = matchPaths(unreadSec)
  const changedCount = changedPaths.length + matchExtra(changedSec)
  const unreadCount = unreadPaths.length + matchExtra(unreadSec)
  const hiddenPaths = matchPaths(hiddenSec)
  const removedCount = [
    ...changedSec.matchAll(
      /^- "(?:[^"\\]|\\.)*": [^\n]*it has since been removed/gm,
    ),
  ].length
  if (hiddenPaths.length > 0) {
    if (changedCount > 0 || unreadCount > 0) {
      return "Not published: some files on the artifact changed or haven't been read by Claude, and others Claude can't see. Claude needs to read the ones it can, and won't replace the others unless you ask."
    }
    return hiddenPaths.length === 1
      ? `Not published: ${hiddenPaths[0]} is already on the artifact and Claude can't see it. Claude won't replace or remove it unless you ask.`
      : `Not published: ${hiddenPaths.length} files are already on the artifact and Claude can't see them. Claude won't replace or remove them unless you ask.`
  }
  if (changedCount > 0 && unreadCount > 0) {
    return 'Not published: some files on the artifact changed since Claude last saw them, and others Claude has not read yet. Claude needs to read the latest versions before publishing again.'
  }
  if (changedCount === 1) {
    return removedCount === 1
      ? `Not published: ${changedPaths[0]} was removed from the artifact since Claude last saw it. Publishing again creates it afresh.`
      : `Not published: ${changedPaths[0]} changed on the artifact since Claude last saw it. Claude needs to read the latest version before publishing again.`
  }
  if (changedCount > 1) {
    return `Not published: ${changedCount} files changed on the artifact since Claude last saw them. Claude needs to read the latest versions before publishing again.`
  }
  if (unreadCount === 1) {
    return `Not published: ${unreadPaths[0]} is already on the artifact and Claude has not read it. Claude needs to read it before replacing or removing it.`
  }
  return `Not published: ${unreadCount} files are already on the artifact and Claude has not read them. Claude needs to read them before replacing or removing them.`
}

void REWATCH_TIMING
