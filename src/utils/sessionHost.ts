/**
 * densable `k.host`. Official `sn()` mints `new Ke({…})`.
 * Leftover `LaunchOptions` is official Ie @178534988.
 * Leftover `SettingsSource` is official Fe @178537943.
 * Leftover `ExtensionsConfig` is official Oe @178538900.
 * Leftover host bags Ee/He/Ue/_e/qe/We/Ge/Ne/Be landed.
 * `n()` siblings live in sessionRoot / sessionSlots. `fn`/`bn` stay UNKNOWN.
 *
 * `getReplDiffHost()` is `k.host` (one `sn()` per process). Forks share
 * `root.host`; this is not a Map-by-sessionId stand-in.
 */

import { HostSlot, RootSessionSlot } from './hostSlot.js'
import {
  AccountCreditLatches,
  BackgroundHousekeeping,
  CredentialSlots,
  Diagnostics,
  McpProcessWiring,
  ModelStringsCache,
  Proactivity,
  RequestLatches,
  TelemetryHandles,
} from './sessionSlots.js'
import { createSignal, type Signal } from './signal.js'

/** Official `kei` / `Iei` object on `Ie.#L`. */
export type LaunchForkReplayConfig = {
  appendSystemPrompt?: string
  agent?: string
  agents?: string
  systemPromptSnapshot?: boolean
}

/**
 * Official Ie @178534988. Gold reset @178537925.
 * Wrappers: Yk/c7e, KEn/YEn, AL/Rwn, GC/Cwn, De/vu/AEn and leftover
 * STATE getters — all `n().host.launchOptions`.
 */
export class LaunchOptions {
  #e = false
  #t: string | null = null
  #n = false
  #o: string | undefined
  #r = false
  #i = false
  #a = false
  #s: string | undefined
  #d = false
  #l = false
  #c = 'cli'
  #p = 'fresh'
  #u: string | undefined
  #g: string[] = []
  #h = false
  #m = false
  #f = false
  #v = false
  #b = false
  #S = false
  #C = false
  #k = false
  #y = false
  #x = true
  #A: 'forward' | null = null
  #T = false
  #P: unknown = null
  #M = false
  #w = false
  #L: LaunchForkReplayConfig = {}
  /** densable spareClaimState — parked | claiming | claimed | failed. */
  #spareClaim: 'parked' | 'claiming' | 'claimed' | 'failed' | undefined
  #spareParkedAtMs: number | undefined
  /** densable Mcn / markWarmSpareClaimed @179677493 */
  #warmSpareClaimed = false
  /** densable `Ie.diskless` — default false; no local diskless-true host. */
  #diskless = false

  isInteractive(): boolean {
    return this.#e
  }
  replaceIsInteractive(e: boolean): void {
    this.#e = e
  }
  printOutputFormat(): string | null {
    return this.#t
  }
  replacePrintOutputFormat(e: string | null): void {
    this.#t = e
  }
  thinkingDisplayExplicit(): boolean {
    return this.#n
  }
  replaceThinkingDisplayExplicit(e: boolean): void {
    this.#n = e
  }
  permissionPromptToolName(): string | undefined {
    return this.#o
  }
  replacePermissionPromptToolName(e: string | undefined): void {
    this.#o = e
  }
  hasStreamingInput(): boolean {
    return this.#r
  }
  replaceHasStreamingInput(e: boolean): void {
    this.#r = e
  }
  singleShotPrintSession(): boolean {
    return this.#i
  }
  replaceSingleShotPrintSession(e: boolean): void {
    this.#i = e
  }
  modelOverrideOptOutForSession(): boolean {
    return this.#a
  }
  replaceModelOverrideOptOutForSession(e: boolean): void {
    this.#a = e
  }
  rendererMode(): string | undefined {
    return this.#s
  }
  replaceRendererMode(e: string | undefined): void {
    this.#s = e
  }
  strictToolResultPairing(): boolean {
    return this.#d
  }
  replaceStrictToolResultPairing(e: boolean): void {
    this.#d = e
  }
  restrictedSession(): boolean {
    return this.#l
  }
  replaceRestrictedSession(e: boolean): void {
    this.#l = e
  }
  clientType(): string {
    return this.#c
  }
  replaceClientType(e: string): void {
    this.#c = e
  }
  sessionStartType(): string {
    return this.#p
  }
  replaceSessionStartType(e: string): void {
    this.#p = e
  }
  questionPreviewFormat(): string | undefined {
    return this.#u
  }
  replaceQuestionPreviewFormat(e: string | undefined): void {
    this.#u = e
  }
  replConfigArgv(): string[] {
    return this.#g
  }
  replaceReplConfigArgv(e: string[]): void {
    this.#g = e
  }
  userMsgOptIn(): boolean {
    return this.#h
  }
  replaceUserMsgOptIn(e: boolean): void {
    this.#h = e
  }
  searchToolsOptIn(): boolean {
    return this.#m
  }
  replaceSearchToolsOptIn(e: boolean): void {
    this.#m = e
  }
  todoToolsOptIn(): boolean {
    return this.#f
  }
  replaceTodoToolsOptIn(e: boolean): void {
    this.#f = e
  }
  wizardOperatorToolsEnabled(): boolean {
    return this.#v
  }
  replaceWizardOperatorToolsEnabled(e: boolean): void {
    this.#v = e
  }
  pollEventIngressWired(): boolean {
    return this.#b
  }
  markPollEventIngressWired(): void {
    this.#b = true
  }
  sdkAgentProgressSummariesEnabled(): boolean {
    return this.#S
  }
  replaceSdkAgentProgressSummariesEnabled(e: boolean): void {
    this.#S = e
  }
  sessionPersistenceDisabled(): boolean {
    return this.#C
  }
  replaceSessionPersistenceDisabled(e: boolean): void {
    this.#C = e
  }
  sessionBypassPermissionsMode(): boolean {
    return this.#k
  }
  replaceSessionBypassPermissionsMode(e: boolean): void {
    this.#k = e
  }
  disableSlashCommands(): boolean {
    return this.#y
  }
  replaceDisableSlashCommands(e: boolean): void {
    this.#y = e
  }
  mayForwardHomeSettings(): boolean {
    return this.#x
  }
  replaceMayForwardHomeSettings(e: boolean): void {
    this.#x = e
  }
  homeSettingsHostConsent(): 'forward' | null {
    return this.#A
  }
  replaceHomeSettingsHostConsent(e: 'forward' | null): void {
    this.#A = e
  }
  scheduledTasksEnabled(): boolean {
    return this.#T
  }
  replaceScheduledTasksEnabled(e: boolean): void {
    this.#T = e
  }
  initJsonSchema(): unknown {
    return this.#P
  }
  replaceInitJsonSchema(e: unknown): void {
    this.#P = e
  }
  cliSessionConfigCarried(): boolean {
    return this.#M
  }
  replaceCliSessionConfigCarried(e: boolean): void {
    this.#M = e
  }
  forkRestrictedLaunchConfig(): boolean {
    return this.#w
  }
  replaceForkRestrictedLaunchConfig(e: boolean): void {
    this.#w = e
  }
  forkReplayLaunchConfig(): LaunchForkReplayConfig {
    return this.#L
  }
  replaceForkReplayLaunchConfig(e: LaunchForkReplayConfig): void {
    this.#L = e
  }
  spareClaimState(): 'parked' | 'claiming' | 'claimed' | 'failed' | undefined {
    return this.#spareClaim
  }
  replaceSpareClaimState(
    e: 'parked' | 'claiming' | 'claimed' | 'failed' | undefined,
  ): void {
    this.#spareClaim = e
  }
  spareParkedAtMs(): number | undefined {
    return this.#spareParkedAtMs
  }
  replaceSpareParkedAtMs(e: number | undefined): void {
    this.#spareParkedAtMs = e
  }
  markWarmSpareClaimed(): void {
    this.#warmSpareClaimed = true
  }
  wasWarmSpareClaimed(): boolean {
    return this.#warmSpareClaimed
  }
  /** densable `Nt()` — `n().host.launchOptions.diskless()`. */
  diskless(): boolean {
    return this.#diskless
  }
  replaceDiskless(e: boolean): void {
    this.#diskless = e
  }
  reset(): void {
    this.#e = false
    this.#t = null
    this.#n = false
    this.#o = undefined
    this.#r = false
    this.#i = false
    this.#a = false
    this.#s = undefined
    this.#d = false
    this.#l = false
    this.#c = 'cli'
    this.#p = 'fresh'
    this.#u = undefined
    this.#g = []
    this.#h = false
    this.#m = false
    this.#f = false
    this.#v = false
    this.#b = false
    this.#S = false
    this.#C = false
    this.#k = false
    this.#y = false
    this.#x = true
    this.#A = null
    this.#T = false
    this.#P = null
    this.#M = false
    this.#w = false
    this.#L = {}
    this.#spareClaim = undefined
    this.#spareParkedAtMs = undefined
    this.#warmSpareClaimed = false
    this.#diskless = false
  }
}

/**
 * Official tn @178538797 sha=4c7707fa4d321be9
 * `function tn(){return["userSettings","projectSettings","localSettings","flagSettings","policySettings"]}`
 * Hardcoded: sessionHost must not import settings/constants.
 */
function defaultAllowedSettingSources(): string[] {
  return [
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ]
}

/**
 * Official Fe @178537943 sha=0ab3d41a6899e314. Gold reset via tn() @178538797.
 * Leftover wrappers xL/XEn, x2/AEe, ZEn/ekn, kde/mkn, y7e/G$ go through
 * n().host.settingsSource. Do not invent leftover expected/pinned getters.
 */
export class SettingsSource {
  #e: string | undefined = undefined
  #t: unknown = undefined
  #n: unknown = undefined
  #o: Record<string, unknown> | null = null
  #r: Record<string, unknown> | null = null
  #i = false
  #a = defaultAllowedSettingSources()
  #s = false

  flagSettingsPath(): string | undefined {
    return this.#e
  }
  replaceFlagSettingsPath(e: string | undefined): void {
    this.#e = e
  }
  flagSettingsExpectedContent(): unknown {
    return this.#t
  }
  replaceFlagSettingsExpectedContent(e: unknown): void {
    this.#t = e
  }
  flagSettingsFilePinnedContent(): unknown {
    return this.#n
  }
  replaceFlagSettingsFilePinnedContent(e: unknown): void {
    this.#n = e
  }
  flagSettingsInline(): Record<string, unknown> | null {
    return this.#o
  }
  replaceFlagSettingsInline(e: Record<string, unknown> | null): void {
    this.#o = e
  }
  parentManagedSettings(): Record<string, unknown> | null {
    return this.#r
  }
  replaceParentManagedSettings(e: Record<string, unknown> | null): void {
    this.#r = e
  }
  parentManagedSettingsInvalid(): boolean {
    return this.#i
  }
  replaceParentManagedSettingsInvalid(e: boolean): void {
    this.#i = e
  }
  allowedSettingSources(): string[] {
    return this.#a
  }
  replaceAllowedSettingSources(e: string[]): void {
    this.#a = e
  }
  useCoworkPlugins(): boolean {
    return this.#s
  }
  replaceUseCoworkPlugins(e: boolean): void {
    this.#s = e
  }
  reset(): void {
    this.#e = undefined
    this.#t = undefined
    this.#n = undefined
    this.#o = null
    this.#r = null
    this.#i = false
    this.#a = defaultAllowedSettingSources()
    this.#s = false
  }
}

/**
 * Official Oe @178538900. Gold reset @178538900.
 * Leftover wrappers C4/m7e, R4/h7e, Vne/hkn, xEe/Tde, Ade/Skn, _m/D4,
 * Bp/p7, R7e/o3t go through n().host.extensionsConfig.
 * Do not invent leftover sessionSkillAllowlist / teammateAgentId wrappers.
 */
export class ExtensionsConfig {
  #e: string[] = []
  #t: string[] = []
  #n: string[] = []
  #o: string[] | undefined = undefined
  #r: string[] = []
  #i: unknown[] = []
  #a = false
  #s: unknown = undefined
  #d: boolean | undefined = undefined
  #l: unknown = undefined

  inlinePlugins(): string[] {
    return this.#e
  }
  replaceInlinePlugins(e: string[]): void {
    this.#e = e
  }
  inlinePluginsNoMcp(): string[] {
    return this.#t
  }
  replaceInlinePluginsNoMcp(e: string[]): void {
    this.#t = e
  }
  inlinePluginUrls(): string[] {
    return this.#n
  }
  replaceInlinePluginUrls(e: string[]): void {
    this.#n = e
  }
  syncedPluginDirs(): string[] {
    return this.#o ?? []
  }
  syncedPluginDirsRegistered(): boolean {
    return this.#o !== undefined
  }
  replaceSyncedPluginDirs(e: string[]): void {
    this.#o = e
  }
  clearSyncedPluginDirs(): void {
    this.#o = undefined
  }
  additionalDirectoriesForClaudeMd(): string[] {
    return this.#r
  }
  replaceAdditionalDirectoriesForClaudeMd(e: string[]): void {
    this.#r = e
  }
  allowedChannels(): unknown[] {
    return this.#i
  }
  replaceAllowedChannels(e: unknown[]): void {
    this.#i = e
  }
  hasDevChannels(): boolean {
    return this.#a
  }
  replaceHasDevChannels(e: boolean): void {
    this.#a = e
  }
  sessionSkillAllowlist(): unknown {
    return this.#s
  }
  replaceSessionSkillAllowlist(e: unknown): void {
    this.#s = e
  }
  chromeFlagOverride(): boolean | undefined {
    return this.#d
  }
  replaceChromeFlagOverride(e: boolean | undefined): void {
    this.#d = e
  }
  teammateAgentId(): unknown {
    return this.#l
  }
  replaceTeammateAgentId(e: unknown): void {
    this.#l = e
  }
  reset(): void {
    this.#e = []
    this.#t = []
    this.#n = []
    this.clearSyncedPluginDirs()
    this.#r = []
    this.#i = []
    this.#a = false
    this.#s = undefined
    this.#d = undefined
    this.#l = undefined
  }
}

type SessionWorkingState = { working: boolean }
type UserPromptState = { waitingFor: string | undefined }

/**
 * densable `xn.working` — `Ds({working:!1})`.
 */
export class SessionWorkingSlot {
  #state: SessionWorkingState = { working: false }
  #changed: Signal = createSignal()
  getState(): SessionWorkingState {
    return this.#state
  }
  setState(updater: (prev: SessionWorkingState) => SessionWorkingState): void {
    const prev = this.#state
    const next = updater(prev)
    if (next === prev) return
    this.#state = next
    this.#changed.emit()
  }
  subscribe(listener: () => void): () => void {
    return this.#changed.subscribe(listener)
  }
}

/**
 * densable `xn.userPrompt` — `Ds({waitingFor:void 0})`.
 */
export class UserPromptSlot {
  #state: UserPromptState = { waitingFor: undefined }
  #changed: Signal = createSignal()
  getState(): UserPromptState {
    return this.#state
  }
  setState(updater: (prev: UserPromptState) => UserPromptState): void {
    const prev = this.#state
    const next = updater(prev)
    if (next === prev) return
    this.#state = next
    this.#changed.emit()
  }
  subscribe(listener: () => void): () => void {
    return this.#changed.subscribe(listener)
  }
}

/** densable `xn`. */
class SessionPromptBag {
  working = new SessionWorkingSlot()
  userPrompt = new UserPromptSlot()
}

/**
 * densable `Se` / `Ct` — WeakMap keyed by session object, not SessionHost.
 */
const Se = new WeakMap<object, SessionPromptBag>()

function ofSession(session: object): SessionPromptBag {
  const existing = Se.get(session)
  if (existing) return existing
  const created = new SessionPromptBag()
  Se.set(session, created)
  return created
}

/**
 * Official 2.1.331 `zVs` — host-owned clock abstraction (`SessionHost.clock`).
 * Wraps wall-clock `Date.now()`, monotonic `performance.now()`, and timers so
 * multi-host environments and tests can inspect or override host time.
 */
export class HostClock {
  now(): number {
    return Date.now()
  }

  monotonicNow(): number {
    return typeof performance !== 'undefined' &&
      typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  }

  setTimeout(
    fn: () => void,
    ms: number,
    opts?: { unref?: boolean },
  ): ReturnType<typeof setTimeout> {
    const id = globalThis.setTimeout(fn, ms)
    if (
      opts?.unref &&
      typeof id === 'object' &&
      id !== null &&
      'unref' in id &&
      typeof id.unref === 'function'
    ) {
      id.unref()
    }
    return id
  }

  clearTimeout(id: ReturnType<typeof setTimeout>): void {
    globalThis.clearTimeout(id)
  }
}

export class SessionHost {
  backgroundHousekeeping: BackgroundHousekeeping
  launchOptions: LaunchOptions
  settingsSource: SettingsSource
  extensionsConfig: ExtensionsConfig
  modelStringsCache: ModelStringsCache
  diagnostics: Diagnostics
  telemetryHandles: TelemetryHandles
  credentialSlots: CredentialSlots
  mcpProcessWiring: McpProcessWiring
  requestLatches: RequestLatches
  accountCreditLatches: AccountCreditLatches
  proactivity: Proactivity
  clock: HostClock
  /** densable qhe @178133390 — process-env change emit (Fc/IE). */
  envChange: Signal = createSignal()

  constructor(e: {
    backgroundHousekeeping: BackgroundHousekeeping
    launchOptions: LaunchOptions
    settingsSource: SettingsSource
    extensionsConfig: ExtensionsConfig
    modelStringsCache: ModelStringsCache
    diagnostics: Diagnostics
    telemetryHandles: TelemetryHandles
    credentialSlots: CredentialSlots
    mcpProcessWiring: McpProcessWiring
    requestLatches: RequestLatches
    accountCreditLatches: AccountCreditLatches
    proactivity: Proactivity
    clock?: HostClock
  }) {
    this.backgroundHousekeeping = e.backgroundHousekeeping
    this.launchOptions = e.launchOptions
    this.settingsSource = e.settingsSource
    this.extensionsConfig = e.extensionsConfig
    this.modelStringsCache = e.modelStringsCache
    this.diagnostics = e.diagnostics
    this.telemetryHandles = e.telemetryHandles
    this.credentialSlots = e.credentialSlots
    this.mcpProcessWiring = e.mcpProcessWiring
    this.requestLatches = e.requestLatches
    this.accountCreditLatches = e.accountCreditLatches
    this.proactivity = e.proactivity
    this.clock = e.clock ?? new HostClock()
  }
}

/** densable `K3e`. */
export function setSessionWorking(session: object, next: boolean): void {
  ofSession(session).working.setState(prev =>
    prev.working === next ? prev : { working: next },
  )
}

/** densable `Fen`. */
export function isSessionWorking(session: object): boolean {
  return ofSession(session).working.getState().working
}

/** densable `V$n`. */
export function subscribeSessionWorking(
  session: object,
  listener: () => void,
): () => void {
  return ofSession(session).working.subscribe(listener)
}

/** densable `$en`. */
export function setUserPromptWaitingFor(
  session: object,
  next: string | undefined,
): void {
  ofSession(session).userPrompt.setState(prev =>
    prev.waitingFor === next ? prev : { waitingFor: next },
  )
}

/** densable `iCr`. */
export function getUserPromptWaitingFor(session: object): string | undefined {
  return ofSession(session).userPrompt.getState().waitingFor
}

/** densable `vEo`. */
export function isUserPromptWaiting(session: object): boolean {
  return getUserPromptWaitingFor(session) !== undefined
}

/** densable `CEo`. */
export function subscribeUserPromptWaiting(
  session: object,
  listener: () => void,
): () => void {
  return ofSession(session).userPrompt.subscribe(listener)
}

/** Official sn @178548001 */
export function createSessionHost(opts?: { clock?: HostClock }): SessionHost {
  return new SessionHost({
    backgroundHousekeeping: new BackgroundHousekeeping(),
    launchOptions: new LaunchOptions(),
    settingsSource: new SettingsSource(),
    extensionsConfig: new ExtensionsConfig(),
    modelStringsCache: new ModelStringsCache(),
    diagnostics: new Diagnostics(),
    telemetryHandles: new TelemetryHandles(),
    credentialSlots: new CredentialSlots(),
    mcpProcessWiring: new McpProcessWiring(),
    requestLatches: new RequestLatches(),
    accountCreditLatches: new AccountCreditLatches(),
    proactivity: new Proactivity(),
    clock: opts?.clock ?? new HostClock(),
  })
}

import { getBootstrapSessionHost } from './sessionRoot.js'

export {
  EngineStore,
  exitSessionContext,
  getActiveSessionFromAls,
  getActiveSubconversation,
  getActiveSubconversationFromAls,
  getBootstrapSession,
  getBootstrapSessionHost,
  getReplDiffHost,
  getSessionSwitchSignal,
  hasActiveSessionAls,
  HostSlot,
  isSharedBackend,
  type NewHostSessionOptions,
  ofDefaultHost,
  registerSessionContextReader,
  type RootSessionAlsContext,
  RootSessionSlot,
  resetSessionHostForTests,
  runWithNewHostSession,
  runWithSession,
  runWithSubconversationContext,
  type SessionAlsContext,
  sessionContextAls,
  setSessionOverridesGetter,
  setSharedBackendMode,
  type SubconversationAlsContext,
} from './sessionRoot.js'

function bootstrapHost(): SessionHost {
  return getBootstrapSessionHost()
}

/** densable qhe @178133390 `Fc().emit()` */
export function emitProcessEnvChange(): void {
  bootstrapHost().envChange.emit()
}

/** densable dHo @178133417 */
export function subscribeProcessEnvChange(listener: () => void): () => void {
  return bootstrapHost().envChange.subscribe(listener)
}

/** densable Mcn @179677493 */
export function markWarmSpareClaimed(): void {
  bootstrapHost().launchOptions.markWarmSpareClaimed()
}

/** densable sIo @179677540 */
export function wasWarmSpareClaimed(): boolean {
  return bootstrapHost().launchOptions.wasWarmSpareClaimed()
}

/** densable `Nt()` — LaunchOptions.diskless(), default false. */
export function isDisklessLaunch(): boolean {
  return bootstrapHost().launchOptions.diskless()
}

/**
 * Official `Kr().teleportedSessionIds` @181213749 — host-keyed `HostSlot<Set<string>>`
 * (`var ano = new z(() => new i); function Kr() { return ano.of(U().host) }`).
 */
const teleportedSessionIdsByHost = new HostSlot<Set<string>>(() => new Set())

export function getHostTeleportedSessionIds(): Set<string> {
  return teleportedSessionIdsByHost.of(bootstrapHost())
}

/**
 * Official 325 `T1o.installStoppedByPerson` / `Pzi` (#1913) — host-injected
 * predicate distinguishing whether a stopped background agent was explicitly
 * stopped by a person vs interrupted by a cloud service disconnect.
 */
type StoppedByPersonPredicate = (agentId: string) => boolean
const stoppedByPersonByHost = new WeakMap<object, StoppedByPersonPredicate>()

export function installStoppedByPerson(
  predicate: StoppedByPersonPredicate,
): void {
  const host = bootstrapHost()
  if (stoppedByPersonByHost.has(host)) {
    throw new Error('A stoppedByPerson question is already installed')
  }
  stoppedByPersonByHost.set(host, predicate)
}

export function getStoppedByPerson(): StoppedByPersonPredicate | undefined {
  return stoppedByPersonByHost.get(bootstrapHost())
}

/**
 * Determine if `agentId` was explicitly stopped by a person (`#1913`).
 * When a host installs a `stoppedByPerson` predicate (e.g. cloud session host),
 * delegate to it so service interruptions are not misclassified as user stops;
 * otherwise fall back to the local `taskStoppedByUser` flag.
 */
export function isAgentStoppedByPerson(
  agentId: string,
  taskStoppedByUser: boolean | undefined,
): boolean {
  const predicate = getStoppedByPerson()
  if (predicate !== undefined) {
    try {
      return predicate(agentId)
    } catch {
      return Boolean(taskStoppedByUser)
    }
  }
  return taskStoppedByUser === true
}

export function resetStoppedByPersonForTests(): void {
  stoppedByPersonByHost.delete(bootstrapHost())
}
