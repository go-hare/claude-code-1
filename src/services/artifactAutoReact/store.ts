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
    pendingOps: Set<string>
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
   * densable shareStatus — ownership / share probe cache (ip / Kgl / Fee).
   */
  shareStatus: {
    bySlug: Map<string, ArtifactShareStatus>
    filePathToSlug: Map<string, string>
    pendingNoticeSlugs: Set<string>
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
  workshopTelemetry: {
    startedSeen: string[]
    completedSeen: string[]
    startedPublishes: Record<string, number>
    publishedSeen: string[]
    invokeT0: number | null
  }
}

export type ArtifactShareRole = 'owner' | 'writer' | 'reader' | 'unknown'

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
  lastProbeAt?: number
  lastProbeLandedAt?: number
  lastProbeIssuedAt?: number
}

export type NoticeCoalesceFamily = 'artifact-auto-react' | 'artifact-changed'

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
  timer?: ReturnType<typeof setTimeout>
}

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
    shareStatus: {
      bySlug: new Map(),
      filePathToSlug: new Map(),
      pendingNoticeSlugs: new Set(),
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

void REWATCH_TIMING
