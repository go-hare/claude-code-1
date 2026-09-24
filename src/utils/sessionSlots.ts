/**
 * Official n() sibling + host bag classes (248 gold-248-n-root).
 * Leftover names. Do not mint official minified slot identifiers.
 */
import { LRUCache } from 'lru-cache'
import { createSignal } from './signal.js'

/** densable `Yt` — gzipRequestBody telemetry LRU cap. */
const GZIP_REQUEST_BODY_TELEMETRY_MAX = 256
/** densable `ld({max:64})` on streamFirstByteArmedRequestIds. */
const STREAM_FIRST_BYTE_ARMED_MAX = 64

function usageBag(
  e?: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.assign(Object.create(null), e)
}

function sumUsageField(rows: Record<string, unknown>[], key: string): number {
  let n = 0
  for (const row of rows) {
    const v = row[key]
    if (typeof v === 'number') n += v
  }
  return n
}

function mapUsageValues(
  e: Record<string, Record<string, unknown>>,
  t: (v: Record<string, unknown>) => Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const o: Record<string, Record<string, unknown>> = Object.create(null)
  for (const k of Object.keys(e)) {
    o[k] = t(e[k]!)
  }
  return o
}

/** Official re @178514241 */
export class CostLedger {
  #e = 0
  #t = 0
  #n = 0
  #o = 0
  #r = Date.now()
  #i: number | undefined
  #a = 0
  #s = 0
  #d = false
  #l: Record<string, Record<string, unknown>> = usageBag()
  #c: ((e: unknown) => void) | null = null
  #p: ((e: unknown, t: unknown) => void) | null = null
  #u: string | null = null

  totalCostUSD(): number {
    return this.#e
  }
  totalAPIDuration(): number {
    return this.#t
  }
  totalAPIDurationWithoutRetries(): number {
    return this.#n
  }
  totalToolDuration(): number {
    return this.#o
  }
  totalDuration(): number {
    return Math.max(0, Date.now() - this.#r)
  }
  sessionStartTime(): number {
    return this.#i ?? this.#r
  }
  totalLinesAdded(): number {
    return this.#a
  }
  totalLinesRemoved(): number {
    return this.#s
  }
  hasUnknownModelCost(): boolean {
    return this.#d
  }
  modelUsage(): Record<string, Record<string, unknown>> {
    return this.#l
  }
  usageForModel(e: string): Record<string, unknown> | undefined {
    return this.#l[e]
  }
  totalInputTokens(): number {
    return sumUsageField(Object.values(this.#l), 'inputTokens')
  }
  totalOutputTokens(): number {
    return sumUsageField(Object.values(this.#l), 'outputTokens')
  }
  totalCacheReadInputTokens(): number {
    return sumUsageField(Object.values(this.#l), 'cacheReadInputTokens')
  }
  totalCacheCreationInputTokens(): number {
    return sumUsageField(Object.values(this.#l), 'cacheCreationInputTokens')
  }
  totalWebSearchRequests(): number {
    return sumUsageField(Object.values(this.#l), 'webSearchRequests')
  }
  recordApiDuration(e: number, t: number): void {
    this.#t += e
    this.#n += t
  }
  recordCost(e: number, t: Record<string, unknown>, o: string): void {
    this.#l[o] = t
    this.#e += e
  }
  recordToolDuration(e: number): void {
    this.#o += e
  }
  recordLinesChanged(e: number, t: number): void {
    this.#a += e
    this.#s += t
  }
  markUnknownModelCost(): void {
    this.#d = true
  }
  zeroDurationsAndCostForTests(): void {
    this.#t = 0
    this.#n = 0
    this.#e = 0
  }
  restartClock(): void {
    this.#r = Date.now()
    this.anchorLogicalStart(undefined)
  }
  anchorLogicalStart(e: number | undefined): void {
    this.#i = e === undefined ? undefined : Math.min(e, this.#r)
  }
  restore(
    e: {
      totalCostUSD: number
      totalAPIDuration: number
      totalAPIDurationWithoutRetries: number
      totalToolDuration: number
      totalLinesAdded: number
      totalLinesRemoved: number
      lastDuration?: number
      startTime?: number
      modelUsage?: Record<string, Record<string, unknown>>
      hasUnknownModelCost?: boolean
    },
    S?: string | null,
  ): void {
    this.#u = S ?? null
    this.#e = e.totalCostUSD
    this.#t = e.totalAPIDuration
    this.#n = e.totalAPIDurationWithoutRetries
    this.#o = e.totalToolDuration
    this.#a = e.totalLinesAdded
    this.#s = e.totalLinesRemoved
    this.#d = e.hasUnknownModelCost ?? false
    if (e.modelUsage) this.#l = usageBag(e.modelUsage)
    if (e.lastDuration !== undefined) this.#r = Date.now() - e.lastDuration
    this.anchorLogicalStart(e.startTime)
  }
  registerSaver(e: (row: unknown) => void): void {
    this.#c = e
  }
  runSaver(e: unknown, t?: CostLedger): void {
    ;(this.#c ?? (t ? t.#c : null))?.(e)
  }
  registerTranscriptRecorder(e: (a: unknown, b: unknown) => void): void {
    this.#p = e
  }
  runTranscriptRecorder(e: unknown, t: unknown, o?: CostLedger): void {
    ;(this.#p ?? (o ? o.#p : null))?.(e, t)
  }
  snapshot(): Record<string, unknown> {
    return {
      ownerSessionId: this.#u,
      totalCostUSD: this.#e,
      totalAPIDuration: this.#t,
      totalAPIDurationWithoutRetries: this.#n,
      totalToolDuration: this.#o,
      startTime: this.#r,
      sessionLogicalStartTime: this.#i,
      totalLinesAdded: this.#a,
      totalLinesRemoved: this.#s,
      hasUnknownModelCost: this.#d,
      modelUsage: mapUsageValues(this.#l, row => ({ ...row })),
    }
  }
  restoreSnapshot(e: {
    ownerSessionId: string | null
    totalCostUSD: number
    totalAPIDuration: number
    totalAPIDurationWithoutRetries: number
    totalToolDuration: number
    startTime: number
    sessionLogicalStartTime: number | undefined
    totalLinesAdded: number
    totalLinesRemoved: number
    hasUnknownModelCost: boolean
    modelUsage: Record<string, Record<string, unknown>>
  }): void {
    this.#u = e.ownerSessionId
    this.#e = e.totalCostUSD
    this.#t = e.totalAPIDuration
    this.#n = e.totalAPIDurationWithoutRetries
    this.#o = e.totalToolDuration
    this.#r = e.startTime
    this.#i = e.sessionLogicalStartTime
    this.#a = e.totalLinesAdded
    this.#s = e.totalLinesRemoved
    this.#d = e.hasUnknownModelCost
    this.#l = usageBag(mapUsageValues(e.modelUsage, t => ({ ...t })))
  }
  claim(e: string): void {
    this.#u ??= e
  }
  scopeTo(e: string): void {
    this.#u = e
  }
  ownerSessionId(): string | null {
    return this.#u
  }
  belongsTo(e: string): boolean {
    return this.#u === e
  }
  reset(e?: string | null): void {
    this.#u = e ?? null
    this.#e = 0
    this.#t = 0
    this.#n = 0
    this.#o = 0
    this.#r = Date.now()
    this.anchorLogicalStart(undefined)
    this.#a = 0
    this.#s = 0
    this.#d = false
    this.#l = usageBag()
  }
}

/** Official ge @178521439 */
export class SessionFlags {
  #e = false
  #t = false
  #n = false
  #o = false
  #r = false
  #i = false
  #a = false
  #s = false
  #d = false
  #l: unknown = null
  #c: unknown = null
  #p: unknown = null
  #u = false
  #g: unknown = null
  #h = false
  #m = false
  #f = false
  #v = false
  #b = false
  #S: unknown
  #C: unknown
  #k: unknown
  #y: {
    isTeleported?: boolean
    hasLoggedFirstMessage?: boolean
    sessionId?: string | null
  } | null = null
  #x: string | null = null

  onboardingShownThisSession(): boolean {
    return this.#e
  }
  replaceOnboardingShownThisSession(e: boolean): void {
    this.#e = e
  }
  lspRecommendationShownThisSession(): boolean {
    return this.#t
  }
  replaceLspRecommendationShownThisSession(e: boolean): void {
    this.#t = e
  }
  sessionTrustAccepted(): boolean {
    return this.#n
  }
  replaceSessionTrustAccepted(e: boolean): void {
    this.#n = e
  }
  homeTrustDialogAccepted(): boolean {
    return this.#o
  }
  replaceHomeTrustDialogAccepted(e: boolean): void {
    this.#o = e
  }
  hasExitedPlanMode(): boolean {
    return this.#r
  }
  replaceHasExitedPlanMode(e: boolean): void {
    this.#r = e
  }
  needsPlanModeExitAttachment(): boolean {
    return this.#i
  }
  replaceNeedsPlanModeExitAttachment(e: boolean): void {
    this.#i = e
  }
  needsAutoModeExitAttachment(): boolean {
    return this.#a
  }
  replaceNeedsAutoModeExitAttachment(e: boolean): void {
    this.#a = e
  }
  memoryToggledOff(): boolean {
    return this.#s
  }
  replaceMemoryToggledOff(e: boolean): void {
    this.#s = e
  }
  teardownUnwindRequested(): boolean {
    return this.#u
  }
  replaceTeardownUnwindRequested(e: boolean): void {
    this.#u = e
  }
  backgroundAutoModeSetupInFlight(): boolean {
    return this.#d
  }
  replaceBackgroundAutoModeSetupInFlight(e: boolean): void {
    this.#d = e
  }
  deferredToolStubGateLatch(): unknown {
    return this.#l
  }
  replaceDeferredToolStubGateLatch(e: unknown): void {
    this.#l = e
  }
  verifySkillRolloutGateLatch(): unknown {
    return this.#c
  }
  replaceVerifySkillRolloutGateLatch(e: unknown): void {
    this.#c = e
  }
  commitSkillRolloutGateLatch(): unknown {
    return this.#p
  }
  replaceCommitSkillRolloutGateLatch(e: unknown): void {
    this.#p = e
  }
  memoryToolsShapeLatch(): unknown {
    return this.#g
  }
  replaceMemoryToolsShapeLatch(e: unknown): void {
    this.#g = e
  }
  proposeGoalAvailabilityLogged(): boolean {
    return this.#h
  }
  markProposeGoalAvailabilityLogged(): void {
    this.#h = true
  }
  activeRoutine(): unknown {
    return this.#C
  }
  replaceActiveRoutine(e: unknown): void {
    this.#C = e
  }
  inheritedTeamName(): unknown {
    return this.#k
  }
  replaceInheritedTeamName(e: unknown): void {
    this.#k = e
  }
  teleportedSessionInfo(): {
    isTeleported?: boolean
    hasLoggedFirstMessage?: boolean
    sessionId?: string | null
  } | null {
    return this.#y
  }
  replaceTeleportedSessionInfo(
    e: {
      isTeleported?: boolean
      hasLoggedFirstMessage?: boolean
      sessionId?: string | null
    } | null,
  ): void {
    this.#y = e
  }
  markFirstTeleportMessageLogged(): void {
    if (this.#y) this.#y.hasLoggedFirstMessage = true
  }
  cachedClaudeMdContent(): string | null {
    return this.#x
  }
  replaceCachedClaudeMdContent(e: string | null): void {
    this.#x = e
  }
  accountSkillsSyncEnabled(): boolean {
    return this.#m
  }
  replaceAccountSkillsSyncEnabled(e: boolean): void {
    this.#m = e
  }
  skillsSyncVetoed(): boolean {
    return this.#f
  }
  replaceSkillsSyncVetoed(e: boolean): void {
    this.#f = e
  }
  accountPluginsSyncEnabled(): boolean {
    return this.#v
  }
  replaceAccountPluginsSyncEnabled(e: boolean): void {
    this.#v = e
  }
  pluginsSyncVetoed(): boolean {
    return this.#b
  }
  replacePluginsSyncVetoed(e: boolean): void {
    this.#b = e
  }
  armPendingContextCompacted(e: unknown): void {
    this.#S = e
  }
  consumePendingContextCompacted(): unknown {
    const e = this.#S
    this.#S = undefined
    return e
  }
  forgetPendingContextCompacted(): void {
    this.#S = undefined
  }
  reset(): void {
    this.#m = false
    this.#f = false
    this.#v = false
    this.#b = false
    this.#e = false
    this.#t = false
    this.#n = false
    this.#o = false
    this.#r = false
    this.#i = false
    this.#a = false
    this.#s = false
    this.#u = false
    this.#d = false
    this.#l = null
    this.#c = null
    this.#p = null
    this.#g = null
    this.#h = false
    this.#C = undefined
    this.#k = undefined
    this.#y = null
    this.#x = null
    this.#S = undefined
  }
}

/** Official ae @178517426 */
export class InvokedSkills {
  #e = new Map<string, unknown>()
  skills(): Map<string, unknown> {
    return this.#e
  }
  lookup(e: string): unknown {
    return this.#e.get(e)
  }
  record(e: string, t: unknown): void {
    this.#e.set(e, t)
  }
  forget(e: string): void {
    this.#e.delete(e)
  }
  forgetAll(): void {
    this.#e.clear()
  }
  reset(): void {
    this.#e = new Map()
  }
}

/** Official le @178517612 */
export class McpSessionWiring {
  #e: { name: string; workspaceKey: string }[] = []
  #t: (() => unknown) | undefined
  #n: unknown
  #o: ((e: unknown, t: unknown) => boolean) | undefined
  approvedServers(): { name: string; workspaceKey: string }[] {
    return this.#e
  }
  approveServers(e: string, t: string[]): void {
    for (const o of t) {
      if (!this.#e.some(r => r.name === o && r.workspaceKey === e)) {
        this.#e.push({ name: o, workspaceKey: e })
      }
    }
  }
  registerClientsAccessor(e: () => unknown): void {
    this.#t = e
  }
  acquireClientsAccessor(e: () => unknown): () => void {
    if (this.#t) return () => {}
    this.#t = e
    return () => {
      if (this.#t === e) this.#t = undefined
    }
  }
  clientsFromAccessor(): unknown {
    return this.#t?.()
  }
  registerConnectedClientWiring(e: unknown): void {
    this.#n = e
  }
  connectedClientWiring(): unknown {
    return this.#n
  }
  registerToolsSwapper(e: (a: unknown, b: unknown) => boolean): void {
    this.#o = e
  }
  acquireToolsSwapper(e: (a: unknown, b: unknown) => boolean): () => void {
    if (this.#o) return () => {}
    this.#o = e
    return () => {
      if (this.#o === e) this.#o = undefined
    }
  }
  swapServerTools(e: unknown, t: unknown): boolean {
    if (!this.#o) return false
    return this.#o(e, t)
  }
  reset(): void {
    this.#e = []
    this.#t = undefined
  }
}

/** Official ye @178529589. Official eo @178494985 is `function eo(e){return e}`. */
export class SessionIdentity {
  #e: string | null = null
  #t: string | null = null
  mainAgentId(e: string): string {
    return (this.#e ??= e)
  }
  projectDir(): string | null {
    return this.#t
  }
  replaceProjectDir(e: string | null): void {
    this.#t = e
  }
}

/** Official de @178518290 */
export class ModelSelection {
  #e: unknown
  #t: unknown
  #n: unknown
  #o: unknown
  #r = false
  #i = false
  #a: unknown
  #s: unknown
  mainLoopModelOverride(): unknown {
    return this.#e
  }
  overrideMainLoopModel(e: unknown): void {
    this.#e = e
  }
  initialMainLoopModel(): unknown {
    return this.#t
  }
  replaceInitialMainLoopModel(e: unknown): void {
    this.#t = e
  }
  resolvedOrgDefault(): unknown {
    return this.#n
  }
  replaceResolvedOrgDefault(e: unknown): void {
    this.#n = e
  }
  initialEnvDefaultModel(): unknown {
    return this.#o
  }
  replaceInitialEnvDefaultModel(e: unknown): void {
    this.#o = e
  }
  refusalFallbackOccurred(): boolean {
    return this.#r
  }
  markRefusalFallbackOccurred(e?: unknown): void {
    this.#r = true
    this.#a ??= e
  }
  refusalFallbackHeaderArmed(): boolean {
    return this.#i
  }
  armRefusalFallbackHeader(e?: unknown): void {
    this.#i = true
    this.#a ??= e
  }
  refusalFallbackLatchOriginRequestId(): unknown {
    return this.#a
  }
  forgetRefusalFallbackOccurred(): void {
    this.#r = false
    this.#i = false
    this.#a = undefined
  }
  refusalFallbackModelLatch(): unknown {
    return this.#s
  }
  replaceRefusalFallbackModelLatch(e: unknown): void {
    this.#s = e
  }
  unlatchRefusalFallbackModel(): void {
    this.#s = undefined
  }
  reset(): void {
    this.#e = undefined
    this.#t = undefined
    this.#n = undefined
    this.#o = undefined
    this.#r = false
    this.#i = false
    this.#a = undefined
    this.#s = undefined
  }
}

/**
 * densable 2.1.251 `Ge` — per-root session bag keyed by `Ln.of(G())`.
 * Shape-only sibling fields (no persist writers). `once` / `firedOnceKeys`
 * are the #13 contract. Not leftover 248 `Proactivity` (selectorGate) and
 * not `RequestLatches` (`qe`).
 */
export class SessionOnceLatches {
  promptCacheBreak: {
    previousStateBySource: Map<unknown, unknown>
    hydrationAttempted: boolean
    pendingPersist: Promise<void>
    latestQueuedPersist: unknown
  } = {
    previousStateBySource: new Map(),
    hydrationAttempted: false,
    pendingPersist: Promise.resolve(),
    latestQueuedPersist: null,
  }
  threadDecisionTracker: unknown
  dumpPrompts: {
    recentRequests: unknown[]
    stateByAgent: Map<unknown, unknown>
  } = {
    recentRequests: [],
    stateByAgent: new Map(),
  }
  lastIngressUuidBySession = new Map<unknown, unknown>()
  /** densable `qe()` */
  cacheCoverage = new WeakMap<object, unknown>()
  gzipRequestBody: {
    latchedOff: boolean
    rejectedThisProcess: boolean
    persistedLatchChecked: boolean
    persistedLatchInEffect: boolean
    telemetryByClientRequestId: LRUCache<string, unknown>
    ccrWorkerSkipReasonsLogged: Set<unknown>
  } = {
    latchedOff: false,
    rejectedThisProcess: false,
    persistedLatchChecked: false,
    persistedLatchInEffect: false,
    telemetryByClientRequestId: new LRUCache({
      max: GZIP_REQUEST_BODY_TELEMETRY_MAX,
    }),
    ccrWorkerSkipReasonsLogged: new Set(),
  }
  sentPrefix: {
    ledger: unknown
    mode: unknown
    persist: Promise<void>
    persisted: unknown
    pendingSeed: unknown
    lastReport: WeakMap<object, unknown>
    lastVerdict: WeakMap<object, unknown>
    renderEpochs: WeakMap<object, unknown>
    excuse: WeakMap<object, unknown>
  } = {
    ledger: undefined,
    mode: undefined,
    persist: Promise.resolve(),
    persisted: undefined,
    pendingSeed: undefined,
    lastReport: new WeakMap(),
    lastVerdict: new WeakMap(),
    renderEpochs: new WeakMap(),
    excuse: new WeakMap(),
  }
  keepForeignThinkingOnUpgrade: unknown
  streamFirstByteArmedRequestIds = new LRUCache<string, unknown>({
    max: STREAM_FIRST_BYTE_ARMED_MAX,
  })
  skillHealthMap: unknown
  firedOnceKeys = new Set<string>()
  hasFired(e: string): boolean {
    return this.firedOnceKeys.has(e)
  }
  markFired(e: string): void {
    this.firedOnceKeys.add(e)
  }
  once(e: string): boolean {
    if (this.firedOnceKeys.has(e)) return false
    this.firedOnceKeys.add(e)
    return true
  }
  resetStreamNoEventsWarningLatch(): void {
    this.firedOnceKeys.delete('stream_no_events_fallback_warning')
  }
}

/** Official fe @178524094 */
export class SessionScratch {
  #e = new Map<string, unknown>()
  #t = new Map<string, unknown>()
  #n: unknown = null
  #o = new Map<string, unknown>()
  #r = new Set<unknown>()
  #i = new Set<unknown>()
  #a = new Set<unknown>()
  #s = new Set<unknown>()
  #d = new Set<unknown>()
  #l = new Set<unknown>()
  #c = new Set<unknown>()
  #p = new Set<unknown>()
  #u = new Map<string, unknown>()
  #g = new Set<unknown>()
  #h: number | undefined
  #m: ReturnType<typeof setTimeout> | undefined
  #f: { timer?: ReturnType<typeof setInterval> } | undefined
  planSlugCache(): Map<string, unknown> {
    return this.#e
  }
  forgetPlanSlug(e: string): void {
    this.#e.delete(e)
  }
  pendingBranchLinks(): Map<string, unknown> {
    return this.#t
  }
  replacePendingBranchLinks(): void {
    this.#t = new Map()
  }
  vimSharedState(): unknown {
    return this.#n
  }
  replaceVimSharedState(e: unknown): void {
    this.#n = e
  }
  agentColorMap(): Map<string, unknown> {
    return this.#o
  }
  sessionCreatedTeams(): Set<unknown> {
    return this.#r
  }
  surfacedHookSpawnFailures(): Set<unknown> {
    return this.#i
  }
  bareMcpServerMatchersWarned(): Set<unknown> {
    return this.#a
  }
  pendingConversationEditKinds(): Set<unknown> {
    return this.#s
  }
  clientTruncatedAssistantIds(): Set<unknown> {
    return this.#d
  }
  unsupportedThreadKeys(): Set<unknown> {
    return this.#l
  }
  pendingPrLinks(): Set<unknown> {
    return this.#c
  }
  policyPredicateTelemetryEmitted(): Set<unknown> {
    return this.#p
  }
  humanAttachmentDigests(): Map<string, unknown> {
    return this.#u
  }
  chromeAvailabilityStagesLogged(): Set<unknown> {
    return this.#g
  }
  replaceChromeAvailabilityStagesLogged(e?: unknown): void {
    this.#g = new Set()
    if (e) this.#h = Date.now()
  }
  chromeAvailabilityAnchorMs(): number | undefined {
    return this.#h
  }
  pendingGoalIdleCheckin(): ReturnType<typeof setTimeout> | undefined {
    return this.#m
  }
  replacePendingGoalIdleCheckin(
    e: ReturnType<typeof setTimeout> | undefined,
  ): void {
    this.#m = e
  }
  workerCheckin(): { timer?: ReturnType<typeof setInterval> } | undefined {
    return this.#f
  }
  replaceWorkerCheckin(
    e: { timer?: ReturnType<typeof setInterval> } | undefined,
  ): void {
    this.#f = e
  }
  reset(): void {
    this.#e = new Map()
    this.#t = new Map()
    this.#n = null
    this.#o = new Map()
    this.#r = new Set()
    this.#i = new Set()
    this.#a = new Set()
    this.#s = new Set()
    this.#d = new Set()
    this.#l = new Set()
    this.#c = new Set()
    this.#p = new Set()
    this.#u = new Map()
    this.#g = new Set()
    this.#h = undefined
    clearTimeout(this.#m)
    this.#m = undefined
    clearInterval(this.#f?.timer)
    this.#f = undefined
  }
}

/** Official me @178526864 */
export class TurnBudget {
  #e = 0
  #t: number | null = null
  #n = 0
  outputTokensAtTurnStart(): number {
    return this.#e
  }
  budget(): number | null {
    return this.#t
  }
  continuationCount(): number {
    return this.#n
  }
  snapshotForTurn(e: number, t: number | null): void {
    this.#e = e
    this.#t = t
    this.#n = 0
  }
  incrementContinuation(): void {
    this.#n++
  }
  reset(): void {
    this.#e = 0
    this.#t = null
    this.#n = 0
  }
}

/** Official Ee @178539976 */
export class ModelStringsCache {
  #e: unknown = null
  #t: unknown = null
  modelStrings(): unknown {
    return this.#e
  }
  replaceModelStrings(e: unknown): void {
    this.#e = e
  }
  invalidate(): void {
    this.#e = null
  }
  admin3PSteeringSnapshot(): unknown {
    return this.#t
  }
  recordAdmin3PSteeringSnapshot(e: unknown): void {
    this.#t = e
  }
  reset(): void {
    this.#e = null
    this.#t = null
  }
}

/** Official nn @178540213 — empty sentinel returned by He.slowOperations when #t empty. */
const EMPTY_SLOW: readonly unknown[] = []

/**
 * Official Yt @178525553 — constant object default for he.#s (NOT a class).
 * `var Yt={renderTarget:"ink",workspace:"local",canDrive:!0,transcriptSource:"local-jsonl",remote:null}`
 */
export type SurfaceCaps = {
  renderTarget: 'ink'
  workspace: 'local' | 'remote'
  canDrive: boolean
  transcriptSource: 'local-jsonl'
  remote: unknown
}

export const DEFAULT_SURFACE_CAPS: SurfaceCaps = {
  renderTarget: 'ink',
  workspace: 'local',
  canDrive: true,
  transcriptSource: 'local-jsonl',
  remote: null,
}

/**
 * Official on() @178540750 — host otel rate bag (NOT $e/createSignal).
 * `function on(){return{rateTokens:null,rateLastRefillMs:null,featureOkLogged:!1,reportedDropReasons:new Set}}`
 */
export type HostOtelBag = {
  rateTokens: number | null
  rateLastRefillMs: number | null
  featureOkLogged: boolean
  reportedDropReasons: Set<unknown>
}

function createHostOtelBag(): HostOtelBag {
  return {
    rateTokens: null,
    rateLastRefillMs: null,
    featureOkLogged: false,
    reportedDropReasons: new Set(),
  }
}

/**
 * Official Be @178540857 sha=08a0c2551f39cfac
 * Leftover name TelemetryHandles — mint on k.host, not empty {}.
 */
export class TelemetryHandles {
  #e: unknown = null
  #t: unknown = null
  #n: unknown = null
  #o: unknown = null
  #r: unknown = null
  #i: unknown = null
  #a: unknown = null
  #s: unknown = null
  #d: unknown = null
  #l: unknown = null
  #c: unknown = null
  #p: unknown = null
  #u: unknown = null
  #g: unknown[] | null = []
  #h: unknown = null
  /** Official #m=on() — rate bag, not signal. */
  #m: HostOtelBag = createHostOtelBag()
  #f: unknown = null
  #v: unknown = null
  #b: unknown = null
  #S: { direct: unknown; proxied: unknown } = { direct: null, proxied: null }

  installMeter(
    e: unknown,
    t: (name: string, options: Record<string, unknown>) => unknown,
    { omitUnits: o = false }: { omitUnits?: boolean } = {},
  ): void {
    this.#e = e
    const r = (i: string): string | undefined => (o ? undefined : i)
    this.#t = t('claude_code.session.count', {
      description: 'Count of CLI sessions started',
    })
    this.#n = t('claude_code.lines_of_code.count', {
      description:
        "Count of lines of code modified, with the 'type' attribute indicating whether lines were added or removed and the 'model' attribute indicating which model made the change",
    })
    this.#o = t('claude_code.pull_request.count', {
      description: 'Number of pull requests created',
    })
    this.#r = t('claude_code.commit.count', {
      description: 'Number of git commits created',
    })
    this.#i = t('claude_code.cost.usage', {
      description: 'Cost of the Claude Code session',
      unit: r('USD'),
    })
    this.#a = t('claude_code.token.usage', {
      description: 'Number of tokens used',
      unit: r('tokens'),
    })
    this.#s = t('claude_code.code_edit_tool.decision', {
      description:
        'Count of code editing tool permission decisions (accept/reject) for Edit, Write, and NotebookEdit tools',
    })
    this.#d = t('claude_code.active_time.total', {
      description: 'Total active time in seconds',
      unit: r('s'),
    })
  }
  meter(): unknown {
    return this.#e
  }
  sessionCounter(): unknown {
    return this.#t
  }
  locCounter(): unknown {
    return this.#n
  }
  prCounter(): unknown {
    return this.#o
  }
  commitCounter(): unknown {
    return this.#r
  }
  costCounter(): unknown {
    return this.#i
  }
  tokenCounter(): unknown {
    return this.#a
  }
  codeEditToolDecisionCounter(): unknown {
    return this.#s
  }
  activeTimeCounter(): unknown {
    return this.#d
  }
  statsStore(): unknown {
    return this.#l
  }
  replaceStatsStore(e: unknown): void {
    this.#l = e
  }
  loggerProvider(): unknown {
    return this.#c
  }
  replaceLoggerProvider(e: unknown): void {
    this.#c = e
  }
  eventLogger(): unknown {
    return this.#p
  }
  eventLoggerOwner(): unknown {
    return this.#u
  }
  /** Official attachEventLogger — drain #g then null the window. */
  attachEventLogger(e: unknown, t: unknown = 'org'): void {
    this.#p = e
    this.#u = e ? t : null
    if (!e) return
    const o = this.#g
    this.#g = null
    if (o) {
      for (const r of o) {
        ;(e as { emit: (ev: unknown) => void }).emit(r)
      }
    }
  }
  bufferPendingEvent(e: unknown): boolean {
    if (this.#g === null || this.#g.length >= 100) return false
    this.#g.push(e)
    return true
  }
  closeWindow(e: unknown): void {
    this.#g = null
    this.#h = e
  }
  windowCloseCause(): unknown {
    return this.#h
  }
  isWindowOpen(): boolean {
    return this.#g !== null
  }
  hostOtel(): HostOtelBag {
    return this.#m
  }
  meterProvider(): unknown {
    return this.#f
  }
  replaceMeterProvider(e: unknown): void {
    this.#f = e
  }
  tracerProvider(): unknown {
    return this.#v
  }
  replaceTracerProvider(e: unknown): void {
    this.#v = e
  }
  cachedTelemetryResource(): unknown {
    return this.#b
  }
  replaceCachedTelemetryResource(e: unknown): void {
    this.#b = e
  }
  cachedOtlpHttpAgentFactory(e: boolean): unknown {
    return this.#S[e ? 'proxied' : 'direct']
  }
  replaceCachedOtlpHttpAgentFactory(e: boolean, t: unknown): void {
    this.#S[e ? 'proxied' : 'direct'] = t
  }
  reset(): void {
    this.#e = null
    this.#t = null
    this.#n = null
    this.#o = null
    this.#r = null
    this.#i = null
    this.#a = null
    this.#s = null
    this.#d = null
    this.#l = null
    this.#c = null
    this.#p = null
    this.#u = null
    this.#g = []
    this.#h = null
    this.#m = createHostOtelBag()
    this.#f = null
    this.#v = null
    this.#b = null
    this.#S = { direct: null, proxied: null }
  }
}

/** Official He @178540219. recordSlowOperation official body is empty. Leftover name Diagnostics (not TelemetryHandles/Be). */
export class Diagnostics {
  #e: { error: string; timestamp: string }[] = []
  #t: { timestamp: number }[] = []
  #n: { timestamp: number } | undefined
  errorLog(): { error: string; timestamp: string }[] {
    return this.#e
  }
  recordError(e: { error: string; timestamp: string }): void {
    if (this.#e.length >= 100) this.#e.shift()
    this.#e.push(e)
  }
  recordSlowOperation(_e?: unknown, _t?: unknown): void {
    return
  }
  slowOperations(): readonly unknown[] {
    if (this.#t.length === 0) return EMPTY_SLOW
    const e = Date.now()
    if (this.#t.some(t => e - t.timestamp >= 1e4)) {
      this.#t = this.#t.filter(t => e - t.timestamp < 1e4)
      if (this.#t.length === 0) return EMPTY_SLOW
    }
    return this.#t
  }
  recordDevBarAlert(_e?: unknown): void {
    return
  }
  devBarAlert(): { timestamp: number } | undefined {
    const e = this.#n
    if (e && Date.now() - e.timestamp >= 60000) {
      this.#n = undefined
      return
    }
    return e
  }
  reset(): void {
    this.#e = []
    this.#t = []
    this.#n = undefined
  }
}

/** Official ne @178510031 */
export class SessionObservers {
  spawner: unknown
  pairings = new Map<unknown, unknown>()
  mainEnsureInFlight = false
  mainSlotBlocked = false
}

/** Official Pe @178530290 */
export class AutonomousLoopPreamble {
  autonomousPreambleDelivered = false
  lastLoopFileDelivered: string | null = null
  reset(): void {
    this.autonomousPreambleDelivered = false
    this.lastLoopFileDelivered = null
  }
}

/** Official be @178527985 — wi leftover empty (no invent). */
export class Precompute {
  byAgent = new Map<string, unknown>()
  attemptsByAgent = new Map<string, number>()
  cappedFailuresByAgent = new Map<string, number>()
  armGateEventEmitted = new Set<string>()
  sidecarIo: Promise<unknown> = Promise.resolve()
  rehydrateAttemptedSessions = new Set<string>()
  sidecarReadsAhead = new Map<string, unknown>()
  get(e: string): unknown {
    return this.byAgent.get(e)
  }
  has(e: string): boolean {
    return this.byAgent.has(e)
  }
  put(e: string, t: unknown): void {
    this.byAgent.set(e, t)
  }
  remove(e: string): void {
    this.byAgent.delete(e)
  }
  nextAttemptNumber(e: string): number {
    const t = (this.attemptsByAgent.get(e) ?? 0) + 1
    this.attemptsByAgent.set(e, t)
    return t
  }
  consecutiveCountedFailures(e: string): number {
    return this.cappedFailuresByAgent.get(e) ?? 0
  }
  recordCountedFailure(e: string): number {
    const t = (this.cappedFailuresByAgent.get(e) ?? 0) + 1
    this.cappedFailuresByAgent.set(e, t)
    return t
  }
  clearCountedFailures(e: string): void {
    this.cappedFailuresByAgent.delete(e)
  }
  latchArmGateEvent(e: string): boolean {
    if (this.armGateEventEmitted.has(e)) return false
    this.armGateEventEmitted.add(e)
    return true
  }
  enqueueSidecarIo(
    e: () => unknown,
    t: (err: unknown) => unknown,
  ): Promise<unknown> {
    this.sidecarIo = this.sidecarIo.then(e, e).catch(t)
    return this.sidecarIo
  }
  sidecarIoSettled(): Promise<unknown> {
    return this.sidecarIo
  }
  hasAttemptedRehydrate(e: string): boolean {
    return this.rehydrateAttemptedSessions.has(e)
  }
  markRehydrateAttempted(e: string): void {
    this.rehydrateAttemptedSessions.add(e)
  }
  keepSidecarReadAhead(e: string, t: unknown): void {
    this.sidecarReadsAhead.delete(e)
    while (this.sidecarReadsAhead.size >= 8) {
      const o = this.sidecarReadsAhead.keys().next().value
      if (o === undefined) break
      this.sidecarReadsAhead.delete(o)
    }
    this.sidecarReadsAhead.set(e, t)
  }
  takeSidecarReadAhead(e: string): unknown {
    const t = this.sidecarReadsAhead.get(e)
    this.sidecarReadsAhead.delete(e)
    return t
  }
  dropSidecarReadAhead(e: string): void {
    this.sidecarReadsAhead.delete(e)
  }
  forgetSubagentTelemetry(e: string): void {
    this.attemptsByAgent.delete(e)
    this.cappedFailuresByAgent.delete(e)
  }
}

/** Official Me @178530434 */
export class BtwHistory {
  exchanges: unknown[] = []
  replace(e: unknown[]): void {
    this.exchanges = e
  }
  append(e: unknown, t: unknown, o?: unknown): void {
    const next =
      o !== undefined && o !== null
        ? { question: e, response: t, fallbackNotice: o }
        : { question: e, response: t }
    this.exchanges = [...this.exchanges, next].slice(-20)
  }
}

/** Official ke @178529797 */
export class CcrRecap {
  inFlight: AbortController | null = null
  startedForTurnEnd = false
  reset(): void {
    this.inFlight?.abort()
    this.inFlight = null
    this.startedForTurnEnd = false
  }
}

/** Official k4 / oe @178510113 */
export class ConversationLatches {
  #e: { sent: Set<unknown>; rejected: Set<unknown> } = {
    sent: new Set(),
    rejected: new Set(),
  }
  #t = new Map<unknown, unknown>()
  #n: unknown
  stickyBetas(): { sent: Set<unknown>; rejected: Set<unknown> } {
    return this.#e
  }
  unlatchStickyBetas(): void {
    this.#e = { sent: new Set(), rejected: new Set() }
  }
  perTurnEffortPins(): Map<unknown, unknown> {
    return this.#t
  }
  atisLatch(): unknown {
    return this.#n
  }
  replaceAtisLatch(e: unknown): void {
    this.#n = e
  }
  reset(): void {
    this.#e = { sent: new Set(), rejected: new Set() }
    this.#t = new Map()
    this.#n = undefined
  }
}

/** Official ie @178516993 */
export class FableConsentSlots {
  #e = false
  fableConsentSessionFallback(): boolean {
    return this.#e
  }
  replaceFableConsentSessionFallback(e: boolean): void {
    this.#e = e
  }
  reset(): void {
    this.#e = false
  }
}

/** Official se @178517121 */
export class HookRegistry {
  #e: { registeredHooks: unknown } = { registeredHooks: null }
  #t: unknown
  #n: unknown
  holder(): { registeredHooks: unknown } {
    return this.#e
  }
  mainThreadAgentType(): unknown {
    return this.#t
  }
  replaceMainThreadAgentType(e: unknown): void {
    this.#t = e
  }
  mainThreadAgentHooks(): unknown {
    return this.#n
  }
  replaceMainThreadAgentHooks(e: unknown): void {
    this.#n = e
  }
  reset(): void {
    this.#e = { registeredHooks: null }
    this.#t = undefined
    this.#n = undefined
  }
}

/** Official ue @178519249 */
export class PromptAssembly {
  #e = new Map<string, unknown>()
  #t: string | null = null
  #n = 0
  #o: ((e?: unknown) => void) | null = null
  sections(): Map<string, unknown> {
    return this.#e
  }
  recordSection(e: string, t: unknown): void {
    this.#e.set(e, t)
  }
  forgetAllSections(): void {
    this.#e.clear()
  }
  noteInvalidation(): void {
    this.#n += 1
  }
  epoch(): number {
    return this.#n
  }
  registerWordingLatchClear(e: (row?: unknown) => void): void {
    this.#o = e
  }
  clearWordingLatch(e?: PromptAssembly): void {
    ;(this.#o ?? (e ? e.#o : null))?.()
  }
  lastEmittedDate(): string | null {
    return this.#t
  }
  replaceLastEmittedDate(e: string | null): void {
    this.#t = e
  }
  reset(): void {
    this.#e = new Map()
    this.#t = null
  }
}

/** Official Ae @178530036 */
export class PromptSuggestion {
  abortController: AbortController | null = null
  reset(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}

/** Official we @178530594 */
export class PendingHint {
  pending: unknown = null
  shownThisSession = false
  changed = createSignal()
  subscribe = this.changed.subscribe
  getSnapshot = (): unknown => this.pending
  offer(e: unknown): void {
    if (this.shownThisSession) return
    this.pending = e
    this.changed.emit()
  }
  dismiss(): void {
    if (this.pending !== null) {
      this.pending = null
      this.changed.emit()
    }
  }
  markShown(): void {
    this.shownThisSession = true
  }
}

/** Official xe @178529918 */
export class PluginsSync {
  firstSyncPromise: Promise<unknown> | null = null
  syncErrors: unknown[] = []
  syncedLaneOpened = false
  removalsDeferredHere = new Set<unknown>()
  pendingTrashRemovals: unknown[] = []
}

/** Official ce @178519637 */
export type ModelSwitchResumeSeed = {
  sessionId?: string
  contextTokens: number
  requestAt: number | null
  ttlMs: number | null
}

export class RequestJournal {
  #e: unknown = null
  #t: unknown = null
  #n: unknown = null
  #o: unknown = null
  #r: string | null = null
  #i = 0
  #a: string | undefined
  #s: number | null = null
  #d: number | null = null
  #l: number | null = null
  #c = false
  /** densable gRn applyResumeSeed / stageResumeSeed bag (2.1.251 #1). */
  #resumeSeed: ModelSwitchResumeSeed | null = null
  #stagedResumeSeed: ModelSwitchResumeSeed | null = null
  lastAPIRequest(): unknown {
    return this.#e
  }
  replaceLastAPIRequest(e: unknown): void {
    this.#e = e
  }
  lastCancelledAPIMessageId(): unknown {
    return this.#t
  }
  replaceLastCancelledAPIMessageId(e: unknown): void {
    this.#t = e
  }
  lastAPIRequestMessages(): unknown {
    return this.#n
  }
  replaceLastAPIRequestMessages(e: unknown): void {
    this.#n = e
  }
  lastClassifierRequests(): unknown {
    return this.#o
  }
  replaceLastClassifierRequests(e: unknown): void {
    this.#o = e
  }
  promptId(): string | null {
    return this.#r
  }
  replacePromptId(e: string | null): void {
    this.#r = e
  }
  promptIndex(): number {
    return this.#i
  }
  replacePromptIndex(e: number): void {
    this.#i = e
  }
  incrementPromptIndex(): number {
    return ++this.#i
  }
  lastMainRequestId(): string | undefined {
    return this.#a
  }
  replaceLastMainRequestId(e: string | undefined): void {
    this.#a = e
  }
  lastMainThreadCacheTtlMs(): number | null {
    return this.#s
  }
  replaceLastMainThreadCacheTtlMs(e: number | null): void {
    this.#s = e
    this.#d = Date.now()
  }
  lastMainThreadRequestAt(): number | null {
    return this.#d
  }
  clearLastMainThreadRequest(): void {
    this.#s = null
    this.#d = null
  }
  lastApiCompletionTimestamp(): number | null {
    return this.#l
  }
  replaceLastApiCompletionTimestamp(e: number | null): void {
    this.#l = e
  }
  pendingPostCompaction(): boolean {
    return this.#c
  }
  replacePendingPostCompaction(e: boolean): void {
    this.#c = e
  }
  /**
   * densable gRn apply path — seed belongs to this session id.
   */
  applyResumeSeed(e: ModelSwitchResumeSeed): void {
    this.#resumeSeed = e
    this.#stagedResumeSeed = null
  }
  /**
   * densable gRn stage path — seed for a different session id.
   */
  stageResumeSeed(e: ModelSwitchResumeSeed): void {
    this.#stagedResumeSeed = e
  }
  resumeSeed(): ModelSwitchResumeSeed | null {
    return this.#resumeSeed
  }
  stagedResumeSeed(): ModelSwitchResumeSeed | null {
    return this.#stagedResumeSeed
  }
  reset(): void {
    this.#e = null
    this.#t = null
    this.#n = null
    this.#o = null
    this.#r = null
    this.#i = 0
    this.#a = undefined
    this.#s = null
    this.#d = null
    this.#l = null
    this.#c = false
    this.#resumeSeed = null
    this.#stagedResumeSeed = null
  }
}

/** Official pe @178520813 */
export class SessionCron {
  #e: unknown[] = []
  #t: Record<string, unknown> = Object.create(null)
  #n: unknown = null
  #o = 0
  #r = false
  #i = 0
  tasks(): unknown[] {
    return this.#e
  }
  schedule(e: unknown): void {
    this.#e.push(e)
  }
  replaceTasks(e: unknown[]): void {
    this.#e = e
  }
  chainStartedAt(e: string): unknown {
    return this.#t[e]
  }
  recordChainStart(e: string, t: unknown): void {
    this.#t[e] = t
  }
  forgetChainStart(e: string): void {
    delete this.#t[e]
  }
  tickInFlightPrompt(): unknown {
    return this.#n
  }
  replaceTickInFlightPrompt(e: unknown): void {
    this.#n = e
  }
  consecutiveKeepalives(): number {
    return this.#o
  }
  replaceConsecutiveKeepalives(e: number): void {
    this.#o = e
  }
  ended(): boolean {
    return this.#r
  }
  replaceEnded(e: boolean): void {
    this.#r = e
  }
  wakeFires(): number {
    return this.#i
  }
  recordWakeFire(): void {
    this.#i++
  }
  resetWakeFires(): void {
    this.#i = 0
  }
  reset(): void {
    this.#e = []
    this.#t = Object.create(null)
    this.#n = null
    this.#o = 0
    this.#r = false
    this.#i = 0
  }
}

/** Official Te @178530131 */
export class SessionRefsGate {
  #e: unknown
  #t: unknown
  ccrSessionID(): unknown {
    return this.#e
  }
  latchCcrSessionID(e: unknown): void {
    this.#e = e
  }
  syncEnabled(): unknown {
    return this.#t
  }
  latchSyncEnabled(e: unknown): unknown {
    return (this.#t = e)
  }
}

/**
 * Official he @178525654.
 * Default #s = official Yt constant (DEFAULT_SURFACE_CAPS) — not {}.
 */
export class SurfaceCapabilities {
  #e = false
  #t: string[] | undefined
  #n: string | undefined
  #o: unknown
  #r: Record<string, unknown> | null = null
  #i = false
  #a: string[] | undefined
  /** Official default: Yt constant object (leftover DEFAULT_SURFACE_CAPS). */
  #s: SurfaceCaps = DEFAULT_SURFACE_CAPS
  #d = false
  #l = false
  attacherCapsChanged = createSignal()
  rvSupervisorLinkChanged = createSignal()
  sdkDialogHostActive(): boolean {
    return this.#e
  }
  markSdkDialogHostActive(e: boolean): void {
    this.#e = e
  }
  sdkSupportedDialogKinds(): string[] | undefined {
    return this.#t
  }
  sdkSupportedDialogKindsSource(): string | undefined {
    return this.#n
  }
  declareDialogKinds(e: string[] | undefined, t?: string): void {
    this.#t = e
    this.#n = e === undefined ? undefined : t
  }
  sdkPerTaskStopAffordance(): unknown {
    return this.#o
  }
  declarePerTaskStopAffordance(e: unknown): void {
    this.#o = e
  }
  attacherCaps(): Record<string, unknown> | null {
    return this.#r
  }
  replaceAttacherCaps(e: Record<string, unknown> | null): void {
    this.#r = e
    this.attacherCapsChanged.emit()
  }
  rvSupervisorLinkLive(): boolean {
    return this.#i
  }
  replaceRvSupervisorLinkLive(e: boolean): void {
    if (this.#i === e) return
    this.#i = e
    this.rvSupervisorLinkChanged.emit()
  }
  sdkBetas(): string[] | undefined {
    return this.#a
  }
  replaceSdkBetas(e: string[] | undefined): void {
    this.#a = e
  }
  caps(): SurfaceCaps {
    return this.#s
  }
  replaceCaps(e: SurfaceCaps): void {
    this.#s = e
  }
  markRemote(e: boolean): void {
    this.#s = { ...this.#s, workspace: e ? 'remote' : 'local' }
  }
  replBridgeActive(): boolean {
    return this.#d
  }
  replaceReplBridgeActive(e: boolean): void {
    if (this.#d === e) return
    this.#d = e
  }
  mainLoopBusy(): boolean {
    return this.#l
  }
  replaceMainLoopBusy(e: boolean): void {
    this.#l = e
  }
  reset(): void {
    this.#e = false
    this.#t = undefined
    this.#n = undefined
    this.#o = undefined
    this.#r = null
    this.#a = undefined
    this.#s = DEFAULT_SURFACE_CAPS
    this.#d = false
    this.#l = false
    this.#i = false
    this.attacherCapsChanged.clear()
    this.rvSupervisorLinkChanged.clear()
  }
}

/** Official Le @178530896 */
export class ToolProgressThrottle {
  lastEmittedAt = new Map<string, number>()
  shouldEmit(e: string, t: number, o: number): boolean {
    const r = this.lastEmittedAt.get(e) || 0
    if (t - r < o) return false
    if (this.lastEmittedAt.size >= 100) {
      const i = this.lastEmittedAt.keys().next().value
      if (i !== undefined) this.lastEmittedAt.delete(i)
    }
    this.lastEmittedAt.set(e, t)
    return true
  }
}

/** Official Zt @178527118 */
const SCROLL_IDLE_MS = 150

/** Official Se @178527129 */
export class UserPresence {
  #e = Date.now()
  #t = false
  interactionFired = createSignal()
  #n: unknown
  terminalFocusFired = createSignal()
  #o = false
  #r: ReturnType<typeof setTimeout> | undefined
  lastInteractionTime(): number {
    return this.#e
  }
  recordInteraction(e?: boolean): void {
    if (e) this.#i()
    else this.#t = true
  }
  flushIfDirty(): void {
    if (this.#t) this.#i()
  }
  #i(): void {
    this.#e = Date.now()
    this.#t = false
    this.interactionFired.emit()
  }
  resetBaseline(): void {
    this.#e = Date.now()
    this.#t = false
  }
  terminalFocus(): unknown {
    return this.#n
  }
  updateTerminalFocus(e: unknown): void {
    this.#n = e
    this.terminalFocusFired.emit()
  }
  scrollDraining(): boolean {
    return this.#o
  }
  markScrollActivity(): void {
    this.#o = true
    if (this.#r) clearTimeout(this.#r)
    this.#r = setTimeout(() => {
      this.#o = false
      this.#r = undefined
    }, SCROLL_IDLE_MS)
    this.#r.unref?.()
  }
  async waitForScrollIdle(): Promise<void> {
    while (this.#o) {
      await new Promise(e => setTimeout(e, SCROLL_IDLE_MS))
    }
  }
  reset(): void {
    this.#e = Date.now()
    this.#n = undefined
    this.interactionFired.clear()
    this.terminalFocusFired.clear()
    this.#o = false
    if (this.#r) clearTimeout(this.#r)
    this.#r = undefined
  }
}

/** Official Ce @178529720 */
export class WorkflowUsageConsent {
  granted = false
  isGranted(): boolean {
    return this.granted
  }
  grant(): void {
    this.granted = true
  }
}

/** Official Re / Qt @178531158 */
export class WritePermissionStash {
  pathsByToolUse = new Map<string, string[]>()
  stash(e: string | undefined, t: string, o: string[]): void {
    if (e === undefined) return
    const r = `${e}\0${t}`
    const i = this.pathsByToolUse.get(r)
    if (i !== undefined) {
      const s = new Set(o)
      this.pathsByToolUse.set(
        r,
        i.filter(a => s.has(a)),
      )
      return
    }
    if (this.pathsByToolUse.size >= 256) {
      const s = this.pathsByToolUse.keys().next().value
      if (s !== undefined) this.pathsByToolUse.delete(s)
    }
    this.pathsByToolUse.set(r, o)
  }
  consume(e: string | undefined, t: string): string[] | undefined {
    if (e === undefined) return
    const o = this.pathsByToolUse.get(`${e}\0${t}`)
    const r = `${e}\0`
    for (const i of this.pathsByToolUse.keys()) {
      if (i.startsWith(r)) this.pathsByToolUse.delete(i)
    }
    return o
  }
}

/** Official Ne @178547122 */
export class BackgroundHousekeeping {
  started = false
  stagingReaped = false
  claim(): boolean {
    if (this.started) return false
    this.started = true
    return true
  }
  claimStagingReap(): boolean {
    if (this.stagingReaped) return false
    this.stagingReaped = true
    return true
  }
}

/** Official Ue @178545071 */
export class McpProcessWiring {
  #e: string | undefined
  #t = false
  #n = false
  #o: unknown
  directConnectServerUrl(): string | undefined {
    return this.#e
  }
  replaceDirectConnectServerUrl(e: string | undefined): void {
    this.#e = e
  }
  connectNonBlocking(): boolean {
    return this.#t
  }
  replaceConnectNonBlocking(e: boolean): void {
    this.#t = e
  }
  strictConfig(): boolean {
    return this.#n
  }
  replaceStrictConfig(e: boolean): void {
    this.#n = e
  }
  registerEnsureConnectedClient(e: unknown): void {
    this.#o = e
  }
  ensureConnectedClient(): unknown {
    return this.#o
  }
  reset(): void {
    this.#e = undefined
    this.#t = false
    this.#n = false
  }
}

/** Official _e @178543532 */
export class CredentialSlots {
  #e: string | null | undefined
  #t: string | null | undefined
  #n = false
  #o: unknown
  #r: string | null | undefined
  #i: unknown = null
  #a: unknown = null
  #s = 0
  #d = false
  #l: unknown = null
  #c: unknown
  #p: unknown = null
  #u: unknown = null
  sessionIngressToken(): string | null | undefined {
    return this.#e
  }
  replaceSessionIngressToken(e: string | null | undefined): void {
    this.#e = e
  }
  oauthTokenFromFd(): string | null | undefined {
    return this.#t
  }
  replaceOauthTokenFromFd(e: string | null | undefined): void {
    this.#t = e
  }
  oauthTokenFromBgSnapshot(): boolean {
    return this.#n
  }
  replaceOauthTokenFromBgSnapshot(e: boolean): void {
    this.#n = e
  }
  oauthScopesFromFd(): unknown {
    return this.#o
  }
  replaceOauthScopesFromFd(e: unknown): void {
    this.#o = e
  }
  apiKeyFromFd(): string | null | undefined {
    return this.#r
  }
  replaceApiKeyFromFd(e: string | null | undefined): void {
    this.#r = e
  }
  resetFdCredentialState(): void {
    this.#e = undefined
    this.#t = undefined
    this.#n = false
    this.#o = undefined
    this.#r = undefined
  }
  gatewayAuth(): unknown {
    return this.#i
  }
  replaceGatewayAuth(e: unknown): void {
    this.#i = e
  }
  gatewayServerProcess(): boolean {
    return this.#d
  }
  replaceGatewayServerProcess(e: boolean): void {
    this.#d = e
  }
  authenticatedAccount(): unknown {
    return this.#a
  }
  authenticatedAccountEpoch(): number {
    return this.#s
  }
  stampAuthenticatedAccount(
    e: {
      accountUuid?: string
      emailAddress?: string
      organizationUuid?: string
    } | null,
  ): void {
    const t = this.#a as typeof e
    if (
      e !== null &&
      t !== null &&
      e.accountUuid === t.accountUuid &&
      e.emailAddress === t.emailAddress &&
      e.organizationUuid === t.organizationUuid
    ) {
      return
    }
    this.#s += 1
    this.#a = e
  }
  startupPolicySnapshot(): unknown {
    return this.#c
  }
  replaceStartupPolicySnapshot(e: unknown): void {
    this.#c = e
  }
  gatewayRefreshInFlight(): unknown {
    return this.#l
  }
  replaceGatewayRefreshInFlight(e: unknown): void {
    this.#l = e
  }
  sdkOAuthTokenRefreshCallback(): unknown {
    return this.#p
  }
  replaceSdkOAuthTokenRefreshCallback(e: unknown): void {
    this.#p = e
  }
  hostAuthTokenRefreshCallback(): unknown {
    return this.#u
  }
  replaceHostAuthTokenRefreshCallback(e: unknown): void {
    this.#u = e
  }
  resetForTests(): void {
    this.#e = null
    this.#t = null
    this.#n = false
    this.#o = undefined
    this.#r = null
    this.#i = null
    this.#a = null
    this.#s = 0
    this.#d = false
    this.#l = null
    this.#c = undefined
    this.#p = null
    this.#u = null
  }
}

/** Official qe @178545454 */
export class RequestLatches {
  #e: string[] | null = null
  #t = new Map<unknown, unknown>()
  #n = new Map<unknown, unknown>()
  #o = new Set<unknown>()
  #r = false
  #i = false
  #a = false
  #s = new Map<unknown, unknown>()
  #d = new Map<unknown, unknown>()
  promptCache1hAllowlist(): string[] | null {
    return this.#e
  }
  replacePromptCache1hAllowlist(e: string[] | null): void {
    this.#e = e
  }
  thinkingTypeOverrides(): Map<unknown, unknown> {
    return this.#t
  }
  recordThinkingTypeOverride(e: unknown, t: unknown): void {
    this.#t.set(e, t)
  }
  servedModelsByRequestedModel(): Map<unknown, unknown> {
    return this.#n
  }
  recordServedModels(e: unknown, t: unknown): void {
    this.#n.set(e, t)
  }
  effortUnsupportedModels(): Set<unknown> {
    return this.#o
  }
  markEffortUnsupported(e: unknown): void {
    this.#o.add(e)
  }
  midConvCachePromotionRejected(): boolean {
    return this.#r
  }
  markMidConvCachePromotionRejected(): void {
    this.#r = true
  }
  strictPrefixLockStoodDown(): boolean {
    return this.#i
  }
  markStrictPrefixLockStoodDown(): void {
    this.#i = true
  }
  perTurnEffortOkEmitted(): boolean {
    return this.#a
  }
  markPerTurnEffortOkEmitted(): void {
    this.#a = true
  }
  inferenceProfileBackingModels(): Map<unknown, unknown> {
    return this.#s
  }
  recordInferenceProfileBackingModel(e: unknown, t: unknown): void {
    this.#s.set(e, t)
  }
  foundryDeploymentCapabilities(): Map<unknown, unknown> {
    return this.#d
  }
  reset(): void {
    this.#e = null
    this.#t = new Map()
    this.#n = new Map()
    this.#o = new Set()
    this.#r = false
    this.#i = false
    this.#a = false
    this.#s = new Map()
    this.#d = new Map()
  }
}

/** Official We @178546429 */
export class AccountCreditLatches {
  #e = false
  #t = false
  longContext1mCreditsBlocked(): boolean {
    return this.#e
  }
  replaceLongContext1mCreditsBlocked(e: boolean): void {
    this.#e = e
  }
  fableCreditsRequired(): boolean {
    return this.#t
  }
  replaceFableCreditsRequired(e: boolean): void {
    this.#t = e
  }
  reset(): void {
    this.#e = false
    this.#t = false
  }
}

function emptyUnsub(): void {}

/** Official Ge @178546653 */
export class Proactivity {
  #e = false
  #t = false
  #n: () => void = emptyUnsub
  #o = createSignal<[boolean]>()
  selectorGate(): boolean {
    return this.#e
  }
  selectorGateEverOn(): boolean {
    return this.#t
  }
  replaceSelectorGate(e: boolean): void {
    this.#e = e
    this.#t ||= e
  }
  inheritSelectorGateEverOn(): void {
    this.#t = true
  }
  resampleSelectorGate(e: boolean): void {
    const t = this.#e
    this.#e = e
    this.#t ||= e
    if (t !== e) this.#o.emit(e)
  }
  subscribeSelectorGateChanged(e: (on: boolean) => void): () => void {
    return this.#o.subscribe(e)
  }
  replaceHostGateSubscription(e: () => void): void {
    const t = this.#n
    this.#n = e
    t()
  }
  dropHostGateSubscription(): void {
    this.replaceHostGateSubscription(emptyUnsub)
  }
}
