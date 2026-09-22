import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { Attributes, Meter, MetricOptions } from '@opentelemetry/api'
import type { logs } from '@opentelemetry/api-logs'
import type { LoggerProvider } from '@opentelemetry/sdk-logs'
import type { MeterProvider } from '@opentelemetry/sdk-metrics'
import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import sumBy from 'lodash-es/sumBy.js'
import type { HookEvent, ModelUsage } from 'src/entrypoints/agentSdkTypes.js'
import type { AgentColorName } from '@claude-code/builtin-tools/tools/AgentTool/agentColorManager.js'
import type { HookCallbackMatcher } from 'src/types/hooks.js'
// Indirection for browser-sdk build (package.json "browser" field swaps
// crypto.ts for crypto.browser.ts). Pure leaf re-export of node:crypto —
// zero circular-dep risk. Path-alias import bypasses bootstrap-isolation
// (rule only checks ./ and / prefixes); explicit disable documents intent.
// eslint-disable-next-line custom-rules/bootstrap-isolation
import { randomUUID } from 'src/utils/crypto.js'
import type { ModelSetting } from 'src/utils/model/model.js'
import type { ModelStrings } from 'src/utils/model/modelStrings.js'
import type { SettingSource } from 'src/utils/settings/constants.js'
import { resetSettingsCache } from 'src/utils/settings/settingsCache.js'
import type { PluginHookMatcher } from 'src/utils/settings/types.js'
import { createSignal } from 'src/utils/signal.js'
// Path-alias import bypasses bootstrap-isolation (same pattern as crypto).
// Official Ie/Fe/Oe wrappers go through n().host.launchOptions /
// settingsSource / extensionsConfig.
// eslint-disable-next-line custom-rules/bootstrap-isolation
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  resetSessionHostForTests,
} from 'src/utils/sessionHost.js'

// Union type for registered hooks - can be SDK callbacks or native plugin hooks
type RegisteredHookMatcher = HookCallbackMatcher | PluginHookMatcher

import type { SessionId } from 'src/types/ids.js'

// DO NOT ADD MORE STATE HERE - BE JUDICIOUS WITH GLOBAL STATE

// dev: true on entries that came via --dangerously-load-development-channels.
// The allowlist gate checks this per-entry (not the session-wide
// hasDevChannels bit) so passing both flags doesn't let the dev dialog's
// acceptance leak allowlist-bypass to the --channels entries.
export type ChannelEntry =
  | { kind: 'plugin'; name: string; marketplace: string; dev?: boolean }
  | { kind: 'server'; name: string; dev?: boolean }

export type AttributedCounter = {
  add(value: number, additionalAttributes?: Attributes): void
}

type State = {
  /**
   * LAND cut (248): bag-owned type/init mirrors removed — costLedger
   * (totalCostUSD / totalAPIDuration*), lastInteractionTime - LAND cut,
   * mainLoopBusy - LAND cut, teleportedSessionInfo - LAND cut,
   * loopChainStartedAt / loopEnded / loopTick*, midConv/stickyBetas - LAND cut /
   * foundry/allowlist/directConnect/replBridge/hooks, Ie/Fe/Oe/credential/telemetry
   * mirrors, pendingPrLinks/pendingBranchLinks, etc. Accessors stay bag-only.
   * Gold: gold-248-state-dead-fields.txt
   */
  turnHookDurationMs: number
  turnToolDurationMs: number
  turnClassifierDurationMs: number
  turnToolCount: number
  turnHookCount: number
  turnClassifierCount: number
  /**
   * Residual leftover-only kairosActive (no official n() sibling bag).
   * Gold 248 redig (gold-248-kairosActive-redig.txt): SEA string/export hits=0;
   * ge @178521439 / Ie @178534988 have no kairos* slot.
   */
  kairosActive: boolean
  // KEEP g() type residual — official dual-path; leftover accessors bag-only
  cachedClaudeMdContent: string | null
  claudeInChromeSessionPromptActive: boolean
  sessionCronTasks: SessionCronTask[]
  registeredHooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>> | null
  /**
   * KEEP STATE - official `Qo().teleportedSessionIds` on host-keyed class `s`
   * (`i.of(z().host)` @179876551), NOT n().host.* / n() sibling bags.
   */
  teleportedSessionIds: Set<string>
  mainThreadAgentType: string | undefined
  // mainThreadAgentHooks - LAND cut; bag = n().hookRegistry (se)
  // via Yne/b1r @178579577. No STATE dual-write.
  // replBridgeActive - LAND cut; bag = n().surfaceCapabilities (he)
  // via Pl/Qne @178583588. No STATE dual-write.
  /**
   * KEEP STATE - official `replBridgeSessionId` lives on AppState (React store),
   * not n() bags. SEA get/setReplBridgeSessionId export aliases hits=0.
   * invent-ban inventing a bootstrap bag slot for it.
   */
  replBridgeSessionId: string | undefined
  // KEEP STATE - SEA `"promptCache1hEligible"` hits=0; invent-ban bag slot.
  promptCache1hEligible: boolean | null
  // densable 2.1.248 `zce` / `rl().pinnedFeatureValues` - first GB read wins.
  pinnedFeatureValues: Map<string, unknown> | undefined
  // Sticky-on latch for AFK_MODE_BETA_HEADER. Once auto mode is first
  // activated, keep sending the header for the rest of the session so
  // Shift+Tab toggles don't bust the ~50-70K token prompt cache.
  afkModeHeaderLatched: boolean | null
  // Sticky-on latch for FAST_MODE_BETA_HEADER. Once fast mode is first
  // enabled, keep sending the header so cooldown enter/exit doesn't
  // double-bust the prompt cache. The `speed` body param stays dynamic.
  fastModeHeaderLatched: boolean | null
  // Sticky-on latch for the cache-editing beta header. Once cached
  // microcompact is first enabled, keep sending the header so mid-session
  // GrowthBook/settings toggles don't bust the prompt cache.
  cacheEditingHeaderLatched: boolean | null
}

// ALSO HERE - THINK THRICE BEFORE MODIFYING
function getInitialState(): State {
  const state: State = {
    turnHookDurationMs: 0,
    turnToolDurationMs: 0,
    turnClassifierDurationMs: 0,
    turnToolCount: 0,
    turnHookCount: 0,
    turnClassifierCount: 0,
    kairosActive: false,
    cachedClaudeMdContent: null,
    claudeInChromeSessionPromptActive: false,
    sessionCronTasks: [],
    registeredHooks: null,
    teleportedSessionIds: new Set(),
    mainThreadAgentType: undefined,
    replBridgeSessionId: undefined,
    promptCache1hEligible: null,
    pinnedFeatureValues: undefined,
    afkModeHeaderLatched: null,
    fastModeHeaderLatched: null,
    cacheEditingHeaderLatched: null,
  }

  return state
}

// AND ESPECIALLY HERE
const STATE: State = getInitialState()

export function getSessionId(): SessionId {
  return getBootstrapSession().id as SessionId
}

/**
 * densable eNn()  - process-global Set of in-flight PR-link promises.
 */
export function getPendingPrLinks(): Set<Promise<unknown>> {
  return getBootstrapSession().sessionScratch.pendingPrLinks() as Set<
    Promise<unknown>
  >
}

/**
 * densable Lzr()  - process-global Map of branches awaiting PR discovery after push.
 */
export function getPendingBranchLinks(): Map<
  string,
  { cwd: string; branch: string; attempts: number }
> {
  return getBootstrapSession().sessionScratch.pendingBranchLinks() as Map<
    string,
    { cwd: string; branch: string; attempts: number }
  >
}

/**
 * densable `mi()`  - main-thread AgentId for queue AL / BRt / Zeo (2.1.211).
 *
 * Gold:
 * ```
 * function mi(){
 *   let e = VO()?.sessionId;
 *   if (e) return Qc(e);
 *   return Ot.mainAgentId ??= Qc(Ot.sessionId), Ot.mainAgentId
 * }
 * ```
 * VO is an optional process overlay (default `() => {}`  - no sessionId); CLI
 * path latches sticky `Ot.mainAgentId` on first call and never clears it on
 * mJo(/clear) or ZR(/resume). Queue IT/cf do not auto-stamp or rewrite agentId
 * on session rebind  - callers that omit agentId leave AL miss (official).
 * Call sites that need live session as string still use getSessionId().
 */
export function getMainThreadAgentId(): import('src/types/ids.js').AgentId {
  const s = getBootstrapSession()
  return s.identity.mainAgentId(s.id) as import('src/types/ids.js').AgentId
}

/**
 * densable `AL(cmd)`: main-thread queue entry is `cmd.agentId === mi()`.
 * Not dual-OR with undefined  - callers must stamp mi() for main (enqueue does
 * not auto-stamp in densable; local withMainThreadAgentId is a local fortify).
 */
export function isMainThreadQueuedCommand(cmd: {
  agentId?: string | null
}): boolean {
  return cmd.agentId === getMainThreadAgentId()
}

/** leftover 239 oU / RDl session-switch reason. */
export type SessionSwitchReason =
  | 'clear'
  | 'resume'
  | 'remote_attach'
  | 'fork'
  | 'cd'
  | 'spare_claim'
  | 'hydrate'
  | 'startup_custom_id'

export function regenerateSessionId(
  options: { setCurrentAsParent?: boolean } = {},
): SessionId {
  if (options.setCurrentAsParent) {
    getBootstrapSession().update({ parentId: getSessionId() })
  }
  // Drop the outgoing session's plan-slug entry so the Map doesn't
  // accumulate stale keys. Callers that need to carry the slug across
  // (REPL.tsx clearContext) read it before calling clearConversation.
  getBootstrapSession().sessionScratch.forgetPlanSlug(getSessionId())
  // Official X8o + JUa densable on session clear/regenerate.
  clearRefusalFallbackOccurred()
  // Fable key-less consent is conversation-session scoped (/clear starts fresh).
  setFableSessionFallbackConsented(false)
  const latchReset = consumeRefusalFallbackModelLatch()
  // Regenerated sessions live in the current project: reset projectDir to
  // null so getTranscriptPath() derives from originalCwd.
  const nextId = randomUUID() as SessionId
  getBootstrapSession().update({ id: nextId })
  getBootstrapSession().identity.replaceProjectDir(null)
  // official uwn  - requestJournal.replacePromptIndex(0) on clear/regenerate
  getBootstrapSession().requestJournal.replacePromptIndex(0)
  // Official BMg densable  - pure rebind plan available via latchReset for
  // callers with setAppState; override already restored by consume above.
  if (latchReset) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { planRefusalFallbackAppStateRebind } =
        require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
      // Override already restored; emit plan for optional AppState hosts.
      void planRefusalFallbackAppStateRebind({
        appStateModel: latchReset.appStateModel,
        forSessionValue: latchReset.forSessionValue,
        overrideValue: latchReset.overrideValue,
      })
    } catch {
      // densable optional
    }
  }
  // leftover 239 oU('clear')  - /clear uses regenerate, not switchSession.
  sessionSwitched.emit(nextId, 'clear')
  return nextId
}

export function getParentSessionId(): SessionId | undefined {
  return getBootstrapSession().parentId as SessionId | undefined
}

/**
 * Atomically switch the active session. `sessionId` and `sessionProjectDir`
 * always change together  - there is no separate setter for either, so they
 * cannot drift out of sync (CC-34).
 *
 * @param projectDir  - directory containing `<sessionId>.jsonl`. Omit (or
 *   pass `null`) for sessions in the current project  - the path will derive
 *   from originalCwd at read time. Pass `dirname(transcriptPath)` when the
 *   session lives in a different project directory (git worktrees,
 *   cross-project resume). Every call resets the project dir; it never
 *   carries over from the previous session.
 */
export function switchSession(
  sessionId: SessionId,
  projectDir: string | null = null,
  reason?: SessionSwitchReason,
): void {
  // Drop the outgoing session's plan-slug entry so the Map stays bounded
  // across repeated /resume. Only the current session's slug is ever read
  // (plans.ts getPlanSlug defaults to getSessionId()).
  const currentId = getSessionId()
  getBootstrapSession().sessionScratch.forgetPlanSlug(currentId)
  // Official: when session id changes, clear refusalFallbackOccurred and
  // consume latch (JUa restores previous override if still on fallback).
  // Fable key-less consent is also conversation-session scoped (/resume).
  if (currentId !== sessionId) {
    clearRefusalFallbackOccurred()
    setFableSessionFallbackConsented(false)
    void consumeRefusalFallbackModelLatch()
    getBootstrapSession().update({ id: sessionId, parentId: undefined })
  } else {
    getBootstrapSession().update({ id: sessionId })
  }
  getBootstrapSession().identity.replaceProjectDir(projectDir)
  sessionSwitched.emit(sessionId, reason)
}

const sessionSwitched =
  createSignal<[id: SessionId, reason?: SessionSwitchReason]>()

/**
 * Register a callback that fires when switchSession changes the active
 * sessionId. bootstrap can't import listeners directly (DAG leaf), so
 * callers register themselves. concurrentSessions.ts uses this to keep the
 * PID file's sessionId in sync with --resume.
 */
export const onSessionSwitch = sessionSwitched.subscribe

/**
 * Project directory the current session's transcript lives in, or `null` if
 * the session was created in the current project (common case  - derive from
 * originalCwd). See `switchSession()`.
 */
export function getSessionProjectDir(): string | null {
  return getBootstrapSession().identity.projectDir()
}

export function getOriginalCwd(): string {
  return getBootstrapSession().project.originalCwd
}

/**
 * Get the stable project root directory.
 * Unlike getOriginalCwd(), this is never updated by mid-session EnterWorktreeTool
 * (so skills/history stay stable when entering a throwaway worktree).
 * It IS set at startup by --worktree, since that worktree is the session's project.
 * Use for project identity (history, skills, sessions) not file operations.
 */
export function getProjectRoot(): string {
  return getBootstrapSession().project.projectRoot
}

export function setOriginalCwd(cwd: string): void {
  const next = cwd.normalize('NFC')
  getBootstrapSession().update({ project: { originalCwd: next } })
}

/**
 * Only for --worktree startup flag. Mid-session EnterWorktreeTool must NOT
 * call this  - skills/history should stay anchored to where the session started.
 */
export function setProjectRoot(cwd: string): void {
  const next = cwd.normalize('NFC')
  getBootstrapSession().update({ project: { projectRoot: next } })
}

export function getCwdState(): string {
  return getBootstrapSession().project.cwd
}

export function setCwdState(cwd: string): void {
  const next = cwd.normalize('NFC')
  getBootstrapSession().setCwd(next)
}

export function getDirectConnectServerUrl(): string | undefined {
  return getBootstrapSessionHost().mcpProcessWiring.directConnectServerUrl()
}

export function setDirectConnectServerUrl(url: string): void {
  getBootstrapSessionHost().mcpProcessWiring.replaceDirectConnectServerUrl(url)
}

/**
 * official pde @178551845
 * `function pde(){return n().host.mcpProcessWiring.connectNonBlocking()}`
 */
export function getConnectNonBlocking(): boolean {
  return getBootstrapSessionHost().mcpProcessWiring.connectNonBlocking()
}

/**
 * official mwn @178551908
 * `function mwn(e){n().host.mcpProcessWiring.replaceConnectNonBlocking(e)}`
 */
export function setConnectNonBlocking(value: boolean): void {
  getBootstrapSessionHost().mcpProcessWiring.replaceConnectNonBlocking(value)
}

/**
 * official TL @178552986
 * `function TL(){return n().host.mcpProcessWiring.strictConfig()}`
 */
export function getStrictMcpConfig(): boolean {
  return getBootstrapSessionHost().mcpProcessWiring.strictConfig()
}

/**
 * official Awn @178553048
 * `function Awn(e){n().host.mcpProcessWiring.replaceStrictConfig(e)}`
 */
export function setStrictMcpConfig(value: boolean): void {
  getBootstrapSessionHost().mcpProcessWiring.replaceStrictConfig(value)
}

/**
 * official zLe @178559140
 * `function zLe(){return n().host.accountCreditLatches.longContext1mCreditsBlocked()}`
 */
export function getLongContext1mCreditsBlocked(): boolean {
  return getBootstrapSessionHost().accountCreditLatches.longContext1mCreditsBlocked()
}

/**
 * official eEn @178559207
 * `function eEn(e){n().host.accountCreditLatches.replaceLongContext1mCreditsBlocked(e)}`
 */
export function setLongContext1mCreditsBlocked(value: boolean): void {
  getBootstrapSessionHost().accountCreditLatches.replaceLongContext1mCreditsBlocked(
    value,
  )
}

/**
 * official tEn @178559306
 * `function tEn(){return n().host.accountCreditLatches.fableCreditsRequired()}`
 */
export function getFableCreditsRequired(): boolean {
  return getBootstrapSessionHost().accountCreditLatches.fableCreditsRequired()
}

/**
 * official fvt @178559366
 * `function fvt(e){n().host.accountCreditLatches.replaceFableCreditsRequired(e)}`
 */
export function setFableCreditsRequired(value: boolean): void {
  getBootstrapSessionHost().accountCreditLatches.replaceFableCreditsRequired(
    value,
  )
}

/**
 * official bEr @178574149
 * `function bEr(){return n().host.proactivity.selectorGate()}`
 */
export function getSelectorGate(): boolean {
  return getBootstrapSessionHost().proactivity.selectorGate()
}

/**
 * official _Er @178574207
 * `function _Er(){return n().host.proactivity.selectorGateEverOn()}`
 */
export function getSelectorGateEverOn(): boolean {
  return getBootstrapSessionHost().proactivity.selectorGateEverOn()
}

/**
 * official SEr @178574255
 * `function SEr(){n().host.proactivity.inheritSelectorGateEverOn()}`
 */
export function inheritSelectorGateEverOn(): void {
  getBootstrapSessionHost().proactivity.inheritSelectorGateEverOn()
}

/**
 * official vEr @178574341
 * `function vEr(e){n().host.proactivity.replaceSelectorGate(e)}`
 */
export function setSelectorGate(value: boolean): void {
  getBootstrapSessionHost().proactivity.replaceSelectorGate(value)
}

/**
 * official wEr @178574380
 * `function wEr(e){n().host.proactivity.resampleSelectorGate(e)}`
 */
export function resampleSelectorGate(value: boolean): void {
  getBootstrapSessionHost().proactivity.resampleSelectorGate(value)
}

/**
 * official EEr @178574448
 * `function EEr(e){return n().host.proactivity.subscribeSelectorGateChanged(e)}`
 */
export function onSelectorGateChanged(
  listener: (on: boolean) => void,
): () => void {
  return getBootstrapSessionHost().proactivity.subscribeSelectorGateChanged(
    listener,
  )
}

/**
 * official kEr @178574380
 * `function kEr(e){n().host.proactivity.replaceHostGateSubscription(e)}`
 */
export function replaceHostGateSubscription(unsub: () => void): void {
  getBootstrapSessionHost().proactivity.replaceHostGateSubscription(unsub)
}

/**
 * official Ge.dropHostGateSubscription
 * `dropHostGateSubscription(){this.replaceHostGateSubscription(rn)}`
 */
export function dropHostGateSubscription(): void {
  getBootstrapSessionHost().proactivity.dropHostGateSubscription()
}

/**
 * official w7e @178575755
 * `function w7e(e){n().host.mcpProcessWiring.registerEnsureConnectedClient(e)}`
 */
export function registerEnsureConnectedClient(fn: unknown): void {
  getBootstrapSessionHost().mcpProcessWiring.registerEnsureConnectedClient(fn)
}

/**
 * official vx @178575755
 * `function vx(){return n().host.mcpProcessWiring.ensureConnectedClient()}`
 * Returns the registered dial fn (or undefined)  - not the MCP impl itself.
 */
export function ensureConnectedClient(): unknown {
  return getBootstrapSessionHost().mcpProcessWiring.ensureConnectedClient()
}

/**
 * official Ne.claim  - first caller wins.
 */
export function claimBackgroundHousekeeping(): boolean {
  return getBootstrapSessionHost().backgroundHousekeeping.claim()
}

/**
 * official Ne.claimStagingReap  - first staging reap wins.
 */
export function claimStagingReap(): boolean {
  return getBootstrapSessionHost().backgroundHousekeeping.claimStagingReap()
}

export function addToTotalDurationState(
  duration: number,
  durationWithoutRetries: number,
): void {
  getBootstrapSession().costLedger.recordApiDuration(
    duration,
    durationWithoutRetries,
  )
}

export function resetTotalDurationStateAndCost_FOR_TESTS_ONLY(): void {
  getBootstrapSession().costLedger.zeroDurationsAndCostForTests()
}

export function addToTotalCostState(
  cost: number,
  modelUsage: ModelUsage,
  model: string,
): void {
  getBootstrapSession().costLedger.recordCost(
    cost,
    modelUsage as unknown as Record<string, unknown>,
    model,
  )
}

export function getTotalCostUSD(): number {
  return getBootstrapSession().costLedger.totalCostUSD()
}

export function getTotalAPIDuration(): number {
  return getBootstrapSession().costLedger.totalAPIDuration()
}

export function getTotalDuration(): number {
  return getBootstrapSession().costLedger.totalDuration()
}

/** densable `GZt`  - costLedger.sessionStartTime(). */
export function getSessionStartTime(): number {
  return getBootstrapSession().costLedger.sessionStartTime()
}

export function getTotalAPIDurationWithoutRetries(): number {
  return getBootstrapSession().costLedger.totalAPIDurationWithoutRetries()
}

export function getTotalToolDuration(): number {
  return getBootstrapSession().costLedger.totalToolDuration()
}

export function addToToolDuration(duration: number): void {
  getBootstrapSession().costLedger.recordToolDuration(duration)
  // Turn-scoped leftover counters (no official CostLedger sibling).
  STATE.turnToolDurationMs += duration
  STATE.turnToolCount++
}

export function getTurnHookDurationMs(): number {
  return STATE.turnHookDurationMs
}

export function addToTurnHookDuration(duration: number): void {
  STATE.turnHookDurationMs += duration
  STATE.turnHookCount++
}

export function resetTurnHookDuration(): void {
  STATE.turnHookDurationMs = 0
  STATE.turnHookCount = 0
}

export function getTurnHookCount(): number {
  return STATE.turnHookCount
}

export function getTurnToolDurationMs(): number {
  return STATE.turnToolDurationMs
}

export function resetTurnToolDuration(): void {
  STATE.turnToolDurationMs = 0
  STATE.turnToolCount = 0
}

export function getTurnToolCount(): number {
  return STATE.turnToolCount
}

export function getTurnClassifierDurationMs(): number {
  return STATE.turnClassifierDurationMs
}

export function addToTurnClassifierDuration(duration: number): void {
  STATE.turnClassifierDurationMs += duration
  STATE.turnClassifierCount++
}

export function resetTurnClassifierDuration(): void {
  STATE.turnClassifierDurationMs = 0
  STATE.turnClassifierCount = 0
}

export function getTurnClassifierCount(): number {
  return STATE.turnClassifierCount
}

export function getStatsStore(): {
  observe(name: string, value: number): void
} | null {
  return getBootstrapSessionHost().telemetryHandles.statsStore() as {
    observe(name: string, value: number): void
  } | null
}

export function setStatsStore(
  store: { observe(name: string, value: number): void } | null,
): void {
  getBootstrapSessionHost().telemetryHandles.replaceStatsStore(store)
}

/**
 * Marks that an interaction occurred.
 *
 * By default the actual Date.now() call is deferred until the next Ink render
 * frame (via flushInteractionTime()) so we avoid calling Date.now() on every
 * single keypress.
 *
 * Pass `immediate = true` when calling from React useEffect callbacks or
 * other code that runs *after* the Ink render cycle has already flushed.
 * Without it the timestamp stays stale until the next render, which may never
 * come if the user is idle (e.g. permission dialog waiting for input).
 */
export function updateLastInteractionTime(immediate?: boolean): void {
  // Official Dq  - n().userPresence.recordInteraction(e)
  getBootstrapSession().userPresence.recordInteraction(immediate)
}

/**
 * If an interaction was recorded since the last flush, update the timestamp
 * now. Called by Ink before each render cycle so we batch many keypresses into
 * a single Date.now() call.
 * Official Mq  - n().userPresence.flushIfDirty()
 */
export function flushInteractionTime(): void {
  getBootstrapSession().userPresence.flushIfDirty()
}

/**
 * Official A4  - n().userPresence.interactionFired.subscribe(e).
 * Fires when user interaction is flushed (keypress/click  - update  - flush).
 * useReplBridge uses this as the A.current latch for ready-push suppression.
 */
export function onInteraction(listener: () => void): () => void {
  return getBootstrapSession().userPresence.interactionFired.subscribe(listener)
}

export function addToTotalLinesChanged(added: number, removed: number): void {
  getBootstrapSession().costLedger.recordLinesChanged(added, removed)
}

export function getTotalLinesAdded(): number {
  return getBootstrapSession().costLedger.totalLinesAdded()
}

export function getTotalLinesRemoved(): number {
  return getBootstrapSession().costLedger.totalLinesRemoved()
}

export function getTotalInputTokens(): number {
  return getBootstrapSession().costLedger.totalInputTokens()
}

export function getTotalOutputTokens(): number {
  return getBootstrapSession().costLedger.totalOutputTokens()
}

export function getTotalCacheReadInputTokens(): number {
  return getBootstrapSession().costLedger.totalCacheReadInputTokens()
}

export function getTotalCacheCreationInputTokens(): number {
  return getBootstrapSession().costLedger.totalCacheCreationInputTokens()
}

export function getTotalWebSearchRequests(): number {
  return getBootstrapSession().costLedger.totalWebSearchRequests()
}

/** Official FLe/ULe/oEr/iEr/sEr  - n().turnBudget (me @178526864). */
export function getTurnOutputTokens(): number {
  return (
    getTotalOutputTokens() -
    getBootstrapSession().turnBudget.outputTokensAtTurnStart()
  )
}
export function getCurrentTurnTokenBudget(): number | null {
  return getBootstrapSession().turnBudget.budget()
}
export function snapshotOutputTokensForTurn(budget: number | null): void {
  getBootstrapSession().turnBudget.snapshotForTurn(
    getTotalOutputTokens(),
    budget,
  )
}
export function getBudgetContinuationCount(): number {
  return getBootstrapSession().turnBudget.continuationCount()
}
export function incrementBudgetContinuationCount(): void {
  getBootstrapSession().turnBudget.incrementContinuation()
}

export function setHasUnknownModelCost(): void {
  getBootstrapSession().costLedger.markUnknownModelCost()
}

export function hasUnknownModelCost(): boolean {
  return getBootstrapSession().costLedger.hasUnknownModelCost()
}

/**
 * Official EEe @178555535  - `n().requestJournal.lastMainRequestId()`
 * export alias `EEe as getLastMainRequestId`
 */
export function getLastMainRequestId(): string | undefined {
  return getBootstrapSession().requestJournal.lastMainRequestId()
}

/**
 * Official Own @178555590  - `n().requestJournal.replaceLastMainRequestId(e)`
 * export alias `Own as setLastMainRequestId`
 */
export function setLastMainRequestId(requestId: string): void {
  getBootstrapSession().requestJournal.replaceLastMainRequestId(requestId)
}

/**
 * Official l7  - `n().requestJournal.lastApiCompletionTimestamp()`
 * export alias `l7 as getLastApiCompletionTimestamp`
 */
export function getLastApiCompletionTimestamp(): number | null {
  return getBootstrapSession().requestJournal.lastApiCompletionTimestamp()
}

/**
 * Official pvt  - `n().requestJournal.replaceLastApiCompletionTimestamp(e)`
 * export alias `pvt as setLastApiCompletionTimestamp`
 */
export function setLastApiCompletionTimestamp(timestamp: number): void {
  getBootstrapSession().requestJournal.replaceLastApiCompletionTimestamp(
    timestamp,
  )
}

/**
 * Official XYe @178555998  - `n().requestJournal.replacePendingPostCompaction(!0)`
 * Mark that a compaction just occurred. The next API success event will
 * include isPostCompaction=true, then the flag auto-resets.
 */
export function markPostCompaction(): void {
  getBootstrapSession().requestJournal.replacePendingPostCompaction(true)
}

/**
 * Official $wn @178556075  - read + replacePendingPostCompaction(!1).
 * Consume the post-compaction flag. Returns true once after compaction,
 * then returns false until the next compaction.
 * export alias `$wn as consumePostCompaction`
 */
export function consumePostCompaction(): boolean {
  const was = getBootstrapSession().requestJournal.pendingPostCompaction()
  getBootstrapSession().requestJournal.replacePendingPostCompaction(false)
  return was
}

export function getLastInteractionTime(): number {
  return getBootstrapSession().userPresence.lastInteractionTime()
}

/** Official qGo  - main query loop is mid-turn. */
export function getMainLoopBusy(): boolean {
  return getBootstrapSession().surfaceCapabilities.mainLoopBusy()
}

const mainLoopBusyListeners = new Set<() => void>()

/** useSyncExternalStore subscribe for densable vou() live busy. */
export function subscribeMainLoopBusy(listener: () => void): () => void {
  mainLoopBusyListeners.add(listener)
  return () => {
    mainLoopBusyListeners.delete(listener)
  }
}

/** Official jGo  - set while REPL onQuery owns the queryGuard. */
export function setMainLoopBusy(value: boolean): void {
  if (getBootstrapSession().surfaceCapabilities.mainLoopBusy() === value) return
  getBootstrapSession().surfaceCapabilities.replaceMainLoopBusy(value)
  for (const listener of mainLoopBusyListeners) {
    listener()
  }
}

/**
 * official mde @178556584
 * `function mde(){return n().userPresence.scrollDraining()}`
 */
export function getIsScrollDraining(): boolean {
  return getBootstrapSession().userPresence.scrollDraining()
}

/**
 * official JYe @178556646
 * `async function JYe(){return n().userPresence.waitForScrollIdle()}`
 */
export async function waitForScrollIdle(): Promise<void> {
  return getBootstrapSession().userPresence.waitForScrollIdle()
}

export function getModelUsage(): { [modelName: string]: ModelUsage } {
  return getBootstrapSession().costLedger.modelUsage() as {
    [modelName: string]: ModelUsage
  }
}

export function getUsageForModel(model: string): ModelUsage | undefined {
  return getBootstrapSession().costLedger.usageForModel(model) as
    | ModelUsage
    | undefined
}

/**
 * Gets the model override set from the --model CLI flag or after the user
 * updates their configured model.
 */
export function getMainLoopModelOverride(): ModelSetting | undefined {
  return getBootstrapSession().modelSelection.mainLoopModelOverride() as
    | ModelSetting
    | undefined
}

export function getInitialMainLoopModel(): ModelSetting {
  return getBootstrapSession().modelSelection.initialMainLoopModel() as ModelSetting
}

export function setMainLoopModelOverride(
  model: ModelSetting | undefined,
): void {
  getBootstrapSession().modelSelection.overrideMainLoopModel(model)
}

export function setInitialMainLoopModel(model: ModelSetting): void {
  getBootstrapSession().modelSelection.replaceInitialMainLoopModel(model)
}

/** Official KVo  - session-resolved org default model. */
export function getResolvedOrgDefault(): string | null | undefined {
  return getBootstrapSession().modelSelection.resolvedOrgDefault() as
    | string
    | null
    | undefined
}

/** Official wgt  - set session-resolved org default model. */
export function setResolvedOrgDefault(model: string | null | undefined): void {
  getBootstrapSession().modelSelection.replaceResolvedOrgDefault(model)
}

/** densable `vxs`  - latched ANTHROPIC_DEFAULT_MODEL (undefined = read live env). */
export function getInitialEnvDefaultModel(): string | null | undefined {
  return getBootstrapSession().modelSelection.initialEnvDefaultModel() as
    | string
    | null
    | undefined
}

/** densable `Txs`  - latch ANTHROPIC_DEFAULT_MODEL at startup resolve. */
export function setInitialEnvDefaultModel(
  model: string | null | undefined,
): void {
  getBootstrapSession().modelSelection.replaceInitialEnvDefaultModel(model)
}

/** Session latch for Fable consent when no org/account consent key exists. */
export function getFableSessionFallbackConsented(): boolean {
  return getBootstrapSession().fableConsentSlots.fableConsentSessionFallback()
}

export function setFableSessionFallbackConsented(value: boolean): void {
  getBootstrapSession().fableConsentSlots.replaceFableConsentSessionFallback(
    value,
  )
}

/** Official Ryn  - mark that a refusal fallback switch occurred. */
export function markRefusalFallbackOccurred(): void {
  getBootstrapSession().modelSelection.markRefusalFallbackOccurred()
}

/** Official F7e  - whether a refusal fallback switch occurred this session. */
export function hasRefusalFallbackOccurred(): boolean {
  return getBootstrapSession().modelSelection.refusalFallbackOccurred()
}

/** Official X8o  - clear refusalFallbackOccurred. */
export function clearRefusalFallbackOccurred(): void {
  getBootstrapSession().modelSelection.forgetRefusalFallbackOccurred()
}

export type RefusalFallbackModelLatch = {
  fallbackModel: string
  previousOverride: ModelSetting | undefined
  previousAppStateModel?: ModelSetting | undefined
  previousModelForSession?: ModelSetting | undefined
}

/**
 * Official b$t  - set/update the refusal fallback model latch.
 * When already latched to the current override, only update fallbackModel.
 */
export function setRefusalFallbackModelLatch(
  latch: RefusalFallbackModelLatch,
): void {
  const session = getBootstrapSession()
  const cur = session.modelSelection.refusalFallbackModelLatch() as
    | RefusalFallbackModelLatch
    | undefined
  const override = session.modelSelection.mainLoopModelOverride() as
    | ModelSetting
    | undefined
  if (cur && override === cur.fallbackModel) {
    const next = {
      ...cur,
      fallbackModel: latch.fallbackModel,
    }
    session.modelSelection.replaceRefusalFallbackModelLatch(next)
    return
  }
  session.modelSelection.replaceRefusalFallbackModelLatch(latch)
}

/** Official rke  - clear latch without restoring override. */
export function clearRefusalFallbackModelLatch(): void {
  getBootstrapSession().modelSelection.unlatchRefusalFallbackModel()
}

/** Official Y8o  - read latch. */
export function getRefusalFallbackModelLatch():
  | RefusalFallbackModelLatch
  | undefined {
  return getBootstrapSession().modelSelection.refusalFallbackModelLatch() as
    | RefusalFallbackModelLatch
    | undefined
}

/**
 * Official J8o  - if latched, update previousOverride (user changed model
 * while latched).
 */
export function updateRefusalFallbackLatchPreviousOverride(
  previousOverride: ModelSetting | undefined,
): void {
  const session = getBootstrapSession()
  const cur = session.modelSelection.refusalFallbackModelLatch() as
    | RefusalFallbackModelLatch
    | undefined
  if (!cur) return
  const next = {
    ...cur,
    previousOverride,
  }
  session.modelSelection.replaceRefusalFallbackModelLatch(next)
}

export type RefusalFallbackLatchResetResult = {
  appStateModel: ModelSetting | undefined
  forSessionValue: ModelSetting | undefined
  overrideValue: ModelSetting | undefined
  restoredToExplicitOverride: boolean
  fallbackModel: string
}

/**
 * Official JUa densable  - clear latch and restore mainLoopModelOverride when
 * it still equals the latched fallback model. Returns restore payload for
 * AppState rebinding (BMg denser consumer).
 */
export function consumeRefusalFallbackModelLatch():
  | RefusalFallbackLatchResetResult
  | undefined {
  const session = getBootstrapSession()
  const latch = session.modelSelection.refusalFallbackModelLatch() as
    | RefusalFallbackModelLatch
    | undefined
  session.modelSelection.unlatchRefusalFallbackModel()
  const current = session.modelSelection.mainLoopModelOverride() as
    | ModelSetting
    | undefined
  if (!latch || current !== latch.fallbackModel) {
    return undefined
  }
  session.modelSelection.overrideMainLoopModel(latch.previousOverride)
  return {
    appStateModel: latch.previousAppStateModel,
    forSessionValue: latch.previousModelForSession,
    overrideValue: latch.previousOverride,
    restoredToExplicitOverride: latch.previousOverride !== undefined,
    fallbackModel: latch.fallbackModel,
  }
}

export function getSdkBetas(): string[] | undefined {
  return getBootstrapSession().surfaceCapabilities.sdkBetas()
}

export function setSdkBetas(betas: string[] | undefined): void {
  getBootstrapSession().surfaceCapabilities.replaceSdkBetas(betas)
}

/**
 * Official hht  - declared request_user_dialog kinds the SDK host supports.
 */
export function getSdkSupportedDialogKinds(): string[] | undefined {
  return getBootstrapSession().surfaceCapabilities.sdkSupportedDialogKinds()
}

/**
 * Official xyn  - set declared dialog kinds + source ('initialize' | 'restored').
 * Pass undefined to clear.
 */
export function setSdkSupportedDialogKinds(
  kinds: string[] | undefined,
  source?: string,
): void {
  getBootstrapSession().surfaceCapabilities.declareDialogKinds(
    kinds,
    kinds === undefined ? undefined : (source ?? 'initialize'),
  )
}

/** Official Z8o  - source of declared kinds, or 'none' when unset. */
export function getSdkSupportedDialogKindsSource(): string {
  const kinds =
    getBootstrapSession().surfaceCapabilities.sdkSupportedDialogKinds()
  if (kinds === undefined) return 'none'
  return (
    getBootstrapSession().surfaceCapabilities.sdkSupportedDialogKindsSource() ??
    'none'
  )
}

/** Official Q8o  - mark print requestDialog host active. */
export function setSdkDialogHostActive(active: boolean): void {
  getBootstrapSession().surfaceCapabilities.markSdkDialogHostActive(active)
}

/** Official mht  - whether createPrintRequestDialog host is armed. */
export function isSdkDialogHostActive(): boolean {
  return getBootstrapSession().surfaceCapabilities.sdkDialogHostActive()
}

export function resetCostState(): void {
  const s = getBootstrapSession()
  s.costLedger.reset(s.id)
  s.requestJournal.replacePromptId(null)
}

/**
 * Sets cost state values for session restore.
 * Called by restoreCostStateForSession in cost-tracker.ts.
 */
export function setCostStateForRestore({
  totalCostUSD,
  totalAPIDuration,
  totalAPIDurationWithoutRetries,
  totalToolDuration,
  totalLinesAdded,
  totalLinesRemoved,
  lastDuration,
  modelUsage,
}: {
  totalCostUSD: number
  totalAPIDuration: number
  totalAPIDurationWithoutRetries: number
  totalToolDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  lastDuration: number | undefined
  modelUsage: { [modelName: string]: ModelUsage } | undefined
}): void {
  getBootstrapSession().costLedger.restore({
    totalCostUSD,
    totalAPIDuration,
    totalAPIDurationWithoutRetries,
    totalToolDuration,
    totalLinesAdded,
    totalLinesRemoved,
    lastDuration,
    modelUsage: modelUsage as
      | Record<string, Record<string, unknown>>
      | undefined,
  })
}

// Only used in tests
export function resetStateForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetStateForTests can only be called in tests')
  }
  Object.entries(getInitialState()).forEach(([key, value]) => {
    STATE[key as keyof State] = value as never
  })
  sessionSwitched.clear()
  resetSessionHostForTests()
}

// You shouldn't use this directly. See src/utils/model/modelStrings.ts::getModelStrings()
export function getModelStrings(): ModelStrings | null {
  return getBootstrapSessionHost().modelStringsCache.modelStrings() as ModelStrings | null
}

// You shouldn't use this directly. See src/utils/model/modelStrings.ts
export function setModelStrings(modelStrings: ModelStrings): void {
  getBootstrapSessionHost().modelStringsCache.replaceModelStrings(modelStrings)
}

// Test utility function to reset model strings for re-initialization.
// Separate from setModelStrings because we only want to accept 'null' in tests.
export function resetModelStringsForTestingOnly() {
  getBootstrapSessionHost().modelStringsCache.invalidate()
}

export function setMeter(
  meter: Meter,
  createCounter: (name: string, options: MetricOptions) => AttributedCounter,
): void {
  // official mEn  - n().host.telemetryHandles.installMeter(e,t,o)
  getBootstrapSessionHost().telemetryHandles.installMeter(
    meter,
    createCounter as (
      name: string,
      options: Record<string, unknown>,
    ) => unknown,
  )
}

export function getMeter(): Meter | null {
  return getBootstrapSessionHost().telemetryHandles.meter() as Meter | null
}

export function getSessionCounter(): AttributedCounter | null {
  return getBootstrapSessionHost().telemetryHandles.sessionCounter() as AttributedCounter | null
}

export function getLocCounter(): AttributedCounter | null {
  return getBootstrapSessionHost().telemetryHandles.locCounter() as AttributedCounter | null
}

export function getPrCounter(): AttributedCounter | null {
  return getBootstrapSessionHost().telemetryHandles.prCounter() as AttributedCounter | null
}

export function getCommitCounter(): AttributedCounter | null {
  return getBootstrapSessionHost().telemetryHandles.commitCounter() as AttributedCounter | null
}

export function getCostCounter(): AttributedCounter | null {
  return getBootstrapSessionHost().telemetryHandles.costCounter() as AttributedCounter | null
}

export function getTokenCounter(): AttributedCounter | null {
  return getBootstrapSessionHost().telemetryHandles.tokenCounter() as AttributedCounter | null
}

export function getCodeEditToolDecisionCounter(): AttributedCounter | null {
  return getBootstrapSessionHost().telemetryHandles.codeEditToolDecisionCounter() as AttributedCounter | null
}

export function getActiveTimeCounter(): AttributedCounter | null {
  return getBootstrapSessionHost().telemetryHandles.activeTimeCounter() as AttributedCounter | null
}

export function getLoggerProvider(): LoggerProvider | null {
  return getBootstrapSessionHost().telemetryHandles.loggerProvider() as LoggerProvider | null
}

export function setLoggerProvider(provider: LoggerProvider | null): void {
  getBootstrapSessionHost().telemetryHandles.replaceLoggerProvider(provider)
}

export function getEventLogger(): ReturnType<typeof logs.getLogger> | null {
  return getBootstrapSessionHost().telemetryHandles.eventLogger() as ReturnType<
    typeof logs.getLogger
  > | null
}

export function setEventLogger(
  logger: ReturnType<typeof logs.getLogger> | null,
): void {
  // official DGt  - attachEventLogger(e, t="org")
  getBootstrapSessionHost().telemetryHandles.attachEventLogger(logger, 'org')
}

export function getMeterProvider(): MeterProvider | null {
  return getBootstrapSessionHost().telemetryHandles.meterProvider() as MeterProvider | null
}

export function setMeterProvider(provider: MeterProvider | null): void {
  getBootstrapSessionHost().telemetryHandles.replaceMeterProvider(provider)
}
export function getTracerProvider(): BasicTracerProvider | null {
  return getBootstrapSessionHost().telemetryHandles.tracerProvider() as BasicTracerProvider | null
}
export function setTracerProvider(provider: BasicTracerProvider | null): void {
  getBootstrapSessionHost().telemetryHandles.replaceTracerProvider(provider)
}

/**
 * densable `vqr`  - Foundry deployment capability map (unsupported features).
 */
export function getFoundryDeploymentCapabilities(): Map<string, Set<string>> {
  return getBootstrapSessionHost().requestLatches.foundryDeploymentCapabilities() as Map<
    string,
    Set<string>
  >
}

/**
 * official De @178562998 sha=24d56d9e8d939b15
 * `function De(){return!n().host.launchOptions.isInteractive()}`
 * export alias `De as getIsNonInteractiveSession`
 */
export function getIsNonInteractiveSession(): boolean {
  return !getBootstrapSessionHost().launchOptions.isInteractive()
}

/**
 * official vu @178563058 sha=d1703532effe70e3
 * `function vu(){return n().host.launchOptions.isInteractive()}`
 * export alias `vu as getIsInteractive`
 */
export function getIsInteractive(): boolean {
  return getBootstrapSessionHost().launchOptions.isInteractive()
}

/**
 * official AEn @178563118 sha=14e588a7fc2b68bb
 * `function AEn(e){n().host.launchOptions.replaceIsInteractive(e)}`
 * export alias `AEn as setIsInteractive`
 */
export function setIsInteractive(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceIsInteractive(value)
}

/**
 * official xEn @178563181
 * `function xEn(){return n().host.launchOptions.printOutputFormat()}`
 * export alias `xEn as getPrintOutputFormat`
 */
export function getPrintOutputFormat(): string | null {
  return getBootstrapSessionHost().launchOptions.printOutputFormat()
}

/**
 * official CEn @178563181
 * `function CEn(e){n().host.launchOptions.replacePrintOutputFormat(e)}`
 * export alias `CEn as setPrintOutputFormat`
 */
export function setPrintOutputFormat(format: string | null): void {
  getBootstrapSessionHost().launchOptions.replacePrintOutputFormat(format)
}

/**
 * official bvt @178563313
 * `function bvt(){return n().host.launchOptions.thinkingDisplayExplicit()}`
 * export alias `bvt as getThinkingDisplayExplicit`
 */
export function getThinkingDisplayExplicit(): boolean {
  return getBootstrapSessionHost().launchOptions.thinkingDisplayExplicit()
}

/**
 * official qLe @178563384
 * `function qLe(e){n().host.launchOptions.replaceThinkingDisplayExplicit(e)}`
 * export alias `qLe as setThinkingDisplayExplicit`
 */
export function setThinkingDisplayExplicit(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceThinkingDisplayExplicit(value)
}

/**
 * official W$ @178563384 cluster
 * `function W$(){return n().host.launchOptions.permissionPromptToolName()}`
 * export alias `W$ as getPermissionPromptToolName`
 */
export function getPermissionPromptToolName(): string | undefined {
  return getBootstrapSessionHost().launchOptions.permissionPromptToolName()
}

/**
 * official REn
 * `function REn(e){n().host.launchOptions.replacePermissionPromptToolName(e)}`
 * export alias `REn as setPermissionPromptToolName`
 */
export function setPermissionPromptToolName(name: string | undefined): void {
  getBootstrapSessionHost().launchOptions.replacePermissionPromptToolName(name)
}

/**
 * official s7e @178564184 sha=ff82b7610114e372
 * `function s7e(){return n().host.launchOptions.hasStreamingInput()}`
 * export alias `s7e as getHasStreamingInput`
 */
export function getHasStreamingInput(): boolean {
  return getBootstrapSessionHost().launchOptions.hasStreamingInput()
}

/**
 * official DEn @178564288
 * `function DEn(e){n().host.launchOptions.replaceHasStreamingInput(e)}`
 * export alias `DEn as setHasStreamingInput`
 */
export function setHasStreamingInput(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceHasStreamingInput(value)
}

/**
 * official NEn @178564512 sha=e84db354ee3682be
 * `function NEn(){return n().host.launchOptions.singleShotPrintSession()}`
 * export alias `NEn as isSingleShotPrintSession`
 */
export function isSingleShotPrintSession(): boolean {
  return getBootstrapSessionHost().launchOptions.singleShotPrintSession()
}

/**
 * official LEn
 * `function LEn(e){n().host.launchOptions.replaceSingleShotPrintSession(e)}`
 * export alias `LEn as setSingleShotPrintSession`
 */
export function setSingleShotPrintSession(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceSingleShotPrintSession(value)
}

/**
 * densable uE  - truthy when a terminal is attached to this bg session.
 */
export function getAttacherCaps(): Record<string, unknown> | null {
  return getBootstrapSession().surfaceCapabilities.attacherCaps()
}

/** densable Tci listeners  - REt = Tci.subscribe; Eci setAttacherCaps emits. */
const attacherCapsListeners = new Set<() => void>()

/**
 * densable REt / Tci.subscribe  - fire when attacher caps change (attach/detach).
 * Used by CUt park restore: when SB() becomes false (terminal attached),
 * clear the parked needs and restore prior tempo.
 */
export function subscribeAttacherCaps(listener: () => void): () => void {
  attacherCapsListeners.add(listener)
  return () => {
    attacherCapsListeners.delete(listener)
  }
}

/**
 * densable tii / Eci  - set/clear attacher caps from rendezvous `attacher-caps`.
 * Emits Tci so parked CUt restores prior job tempo on attach.
 */
export function setAttacherCaps(
  caps: Record<string, unknown> | null | undefined,
): void {
  getBootstrapSession().surfaceCapabilities.replaceAttacherCaps(caps ?? null)
  for (const l of attacherCapsListeners) {
    try {
      l()
    } catch {
      // ignore listener errors
    }
  }
}

/**
 * official a7e @178564582 sha=2f8bbb80e1ffd52a
 * `function a7e(){return n().host.launchOptions.clientType()}`
 * export alias `a7e as getClientType`
 */
export function getClientType(): string {
  return getBootstrapSessionHost().launchOptions.clientType()
}

/**
 * official $En @178564640 sha=7785748c61755ff3
 * `function $En(e){n().host.launchOptions.replaceClientType(e)}`
 * export alias `$En as setClientType`
 */
export function setClientType(type: string): void {
  getBootstrapSessionHost().launchOptions.replaceClientType(type)
}

/**
 * official _de @178564700 sha=e6cf26bd0be95d4d
 * `function _de(){return n().host.launchOptions.sdkAgentProgressSummariesEnabled()}`
 * export alias `_de as getSdkAgentProgressSummariesEnabled`
 */
export function getSdkAgentProgressSummariesEnabled(): boolean {
  return getBootstrapSessionHost().launchOptions.sdkAgentProgressSummariesEnabled()
}

/**
 * official FEn @178564780 sha=6d323909ce362264
 * `function FEn(e){n().host.launchOptions.replaceSdkAgentProgressSummariesEnabled(e)}`
 * export alias `FEn as setSdkAgentProgressSummariesEnabled`
 */
export function setSdkAgentProgressSummariesEnabled(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceSdkAgentProgressSummariesEnabled(
    value,
  )
}

/**
 * official jEn @178565376
 * `function jEn(e){if(e===!1)throw Error("setWizardOperatorToolsEnabled(false) is test-only: …");n().host.launchOptions.replaceWizardOperatorToolsEnabled(e)}`
 * export alias `jEn as setWizardOperatorToolsEnabled`
 */
export function setWizardOperatorToolsEnabled(value: boolean): void {
  if (value === false) {
    throw new Error(
      'setWizardOperatorToolsEnabled(false) is test-only: the wizard latch is one-way in production',
    )
  }
  getBootstrapSessionHost().launchOptions.replaceWizardOperatorToolsEnabled(
    value,
  )
}

/**
 * official zEn @178565570
 * `function zEn(){return n().host.launchOptions.wizardOperatorToolsEnabled()}`
 * export alias `zEn as getWizardOperatorToolsEnabled`
 */
export function getWizardOperatorToolsEnabled(): boolean {
  return getBootstrapSessionHost().launchOptions.wizardOperatorToolsEnabled()
}

/**
 * official WEn @178565644 sha=c33de4f025e14564
 * `function WEn(){return n().host.launchOptions.pollEventIngressWired()}`
 * export alias `WEn as isPollEventIngressWired`
 */
export function isPollEventIngressWired(): boolean {
  return getBootstrapSessionHost().launchOptions.pollEventIngressWired()
}

/**
 * official GEn @178565713 sha=a6fc7bd3515ccfe9
 * `function GEn(){n().host.launchOptions.markPollEventIngressWired()}`
 * export alias `GEn as markPollEventIngressWired`
 */
export function markPollEventIngressWired(): void {
  getBootstrapSessionHost().launchOptions.markPollEventIngressWired()
}

/**
 * official VEn @178565899
 * `function VEn(){return n().host.launchOptions.searchToolsOptIn()}`
 * export alias `VEn as getSearchToolsOptIn`
 */
export function getSearchToolsOptIn(): boolean {
  return getBootstrapSessionHost().launchOptions.searchToolsOptIn()
}

/**
 * official qEn @178565963
 * `function qEn(e){n().host.launchOptions.replaceSearchToolsOptIn(e)}`
 * export alias `qEn as setSearchToolsOptIn`
 */
export function setSearchToolsOptIn(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceSearchToolsOptIn(value)
}

/**
 * Residual leftover-only kairosActive (no official n() sibling bag).
 * Gold 248 redig: SEA hits=0; ge @178521439 / Ie @178534988  - no kairos* slot;
 * export aliases absent; Hbe=_x()&&Jdt()||Zan() (userMsgOptIn only, not kairos OR);
 * is_assistant_mode/--assistant/tengu_kairos_assistant hits=0.
 * (docs/upstream-extraction/v2.1.248/snippets/gold-248-kairosActive-redig.txt).
 * Do NOT collapse onto launchOptions.userMsgOptIn.
 */
export function getKairosActive(): boolean {
  return STATE.kairosActive
}

export function setKairosActive(value: boolean): void {
  STATE.kairosActive = value
}

/**
 * official BEn @178564984 sha=fb757c8b36edec71
 * `function BEn(){return n().host.launchOptions.strictToolResultPairing()}`
 * export alias `BEn as getStrictToolResultPairing`
 */
export function getStrictToolResultPairing(): boolean {
  return getBootstrapSessionHost().launchOptions.strictToolResultPairing()
}

/**
 * official hEr @178565055 sha=485aa9835cb72f8c
 * `function hEr(e){n().host.launchOptions.replaceStrictToolResultPairing(e)}`
 * export alias `hEr as setStrictToolResultPairing`
 */
export function setStrictToolResultPairing(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceStrictToolResultPairing(value)
}

// Field name 'userMsgOptIn' avoids excluded-string substrings ('BriefTool',
// 'SendUserMessage'  - case-insensitive). All callers are inside feature()
// guards so these accessors don't need their own (matches getKairosActive).
/**
 * official _x @178565779 sha=c390e1eab3ea545b
 * `function _x(){return n().host.launchOptions.userMsgOptIn()}`
 * export alias `_x as getUserMsgOptIn`
 */
export function getUserMsgOptIn(): boolean {
  return getBootstrapSessionHost().launchOptions.userMsgOptIn()
}

/**
 * official c7 @178565838 sha=6a1148ff6d34ee9e
 * `function c7(e){n().host.launchOptions.replaceUserMsgOptIn(e)}`
 * export alias `c7 as setUserMsgOptIn`
 */
export function setUserMsgOptIn(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceUserMsgOptIn(value)
}

/**
 * official KEn @178566074
 * `function KEn(){return n().host.launchOptions.todoToolsOptIn()}`
 * export alias `KEn as getTodoToolsOptIn`
 */
export function getTodoToolsOptIn(): boolean {
  return getBootstrapSessionHost().launchOptions.todoToolsOptIn()
}

/**
 * official YEn @178566130
 * `function YEn(e){n().host.launchOptions.replaceTodoToolsOptIn(e)}`
 * export alias `YEn as setTodoToolsOptIn`
 */
export function setTodoToolsOptIn(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceTodoToolsOptIn(value)
}

/**
 * official xwn @178553113
 * `function xwn(){return n().host.launchOptions.cliSessionConfigCarried()}`
 * export alias `xwn as getCliSessionConfigCarried`
 */
export function getCliSessionConfigCarried(): boolean {
  return getBootstrapSessionHost().launchOptions.cliSessionConfigCarried()
}

/**
 * official qYe @178553184
 * `function qYe(e){n().host.launchOptions.replaceCliSessionConfigCarried(e)}`
 * export alias `qYe as setCliSessionConfigCarried`
 */
export function setCliSessionConfigCarried(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceCliSessionConfigCarried(value)
}

/**
 * official Yk @178565128 sha=004e8eb906e6711a
 * `function Yk(){return n().host.launchOptions.restrictedSession()}`
 * export alias `Yk as isRestrictedSession`
 */
export function getRestrictedSession(): boolean {
  return getBootstrapSessionHost().launchOptions.restrictedSession()
}

/**
 * official c7e @178565192 sha=97529dc3fc652d06
 * `function c7e(e){n().host.launchOptions.replaceRestrictedSession(e)}`
 * export alias `c7e as setRestrictedSession`
 */
export function setRestrictedSession(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceRestrictedSession(value)
}

/**
 * official NGt @178566285 sha=6dec09ff225b5afe
 * `function NGt(){return n().host.launchOptions.questionPreviewFormat()}`
 * export alias `NGt as getQuestionPreviewFormat`
 */
export function getQuestionPreviewFormat(): 'markdown' | 'html' | undefined {
  return getBootstrapSessionHost().launchOptions.questionPreviewFormat() as
    | 'markdown'
    | 'html'
    | undefined
}

/**
 * official $Gt @178566354 sha=d4d32e9f74d592d4
 * `function $Gt(e){n().host.launchOptions.replaceQuestionPreviewFormat(e)}`
 * export alias `$Gt as setQuestionPreviewFormat`
 */
export function setQuestionPreviewFormat(format: 'markdown' | 'html'): void {
  getBootstrapSessionHost().launchOptions.replaceQuestionPreviewFormat(format)
}

export function getAgentColorMap(): Map<string, AgentColorName> {
  return getBootstrapSession().sessionScratch.agentColorMap() as Map<
    string,
    AgentColorName
  >
}

/**
 * official xL @178566482 sha=24a623548308081d
 * `function xL(){return n().host.settingsSource.flagSettingsPath()}`
 * export alias `xL as getFlagSettingsPath`
 */
export function getFlagSettingsPath(): string | undefined {
  return getBootstrapSessionHost().settingsSource.flagSettingsPath()
}

/**
 * official XEn @178566546 sha=303873f56ed30ce1
 * `function XEn(e){n().host.settingsSource.replaceFlagSettingsPath(e)}`
 * export alias `XEn as setFlagSettingsPath`
 */
export function setFlagSettingsPath(path: string | undefined): void {
  getBootstrapSessionHost().settingsSource.replaceFlagSettingsPath(path)
}

/**
 * official b0 @178566600 cluster
 * `function b0(){return n().host.settingsSource.flagSettingsExpectedContent()}`
 * export alias `b0 as getFlagSettingsExpectedContent`
 */
export function getFlagSettingsExpectedContent(): unknown {
  return getBootstrapSessionHost().settingsSource.flagSettingsExpectedContent()
}

/**
 * official JEn
 * `function JEn(e){n().host.settingsSource.replaceFlagSettingsExpectedContent(e)}`
 * export alias `JEn as setFlagSettingsExpectedContent`
 */
export function setFlagSettingsExpectedContent(content: unknown): void {
  getBootstrapSessionHost().settingsSource.replaceFlagSettingsExpectedContent(
    content,
  )
}

/**
 * official vde
 * `function vde(){return n().host.settingsSource.flagSettingsFilePinnedContent()}`
 * export alias `vde as getFlagSettingsFilePinnedContent`
 */
export function getFlagSettingsFilePinnedContent(): unknown {
  return getBootstrapSessionHost().settingsSource.flagSettingsFilePinnedContent()
}

/**
 * official QEn
 * `function QEn(e){n().host.settingsSource.replaceFlagSettingsFilePinnedContent(e)}`
 * export alias `QEn as setFlagSettingsFilePinnedContent`
 */
export function setFlagSettingsFilePinnedContent(content: unknown): void {
  getBootstrapSessionHost().settingsSource.replaceFlagSettingsFilePinnedContent(
    content,
  )
}

/**
 * official x2 @178566924 sha=db64f18924e34971
 * `function x2(){return n().host.settingsSource.flagSettingsInline()}`
 * export alias `x2 as getFlagSettingsInline`
 */
export function getFlagSettingsInline(): Record<string, unknown> | null {
  return getBootstrapSessionHost().settingsSource.flagSettingsInline()
}

/**
 * official AEe @178566990 sha=1a22b65420e75761
 * `function AEe(e){n().host.settingsSource.replaceFlagSettingsInline(e)}`
 * export alias `AEe as setFlagSettingsInline`
 */
export function setFlagSettingsInline(
  settings: Record<string, unknown> | null,
): void {
  getBootstrapSessionHost().settingsSource.replaceFlagSettingsInline(settings)
}

/**
 * official ZEn @178567059 sha=58473ba8ed203462
 * `function ZEn(){return n().host.settingsSource.parentManagedSettings()}`
 * export alias `ZEn as getParentManagedSettings`
 */
export function getParentManagedSettings(): Record<string, unknown> | null {
  return getBootstrapSessionHost().settingsSource.parentManagedSettings()
}

/**
 * official ekn @178567129 sha=3a3b6bea328da4d2
 * `function ekn(e){n().host.settingsSource.replaceParentManagedSettings(e)}`
 * export alias `ekn as setParentManagedSettings`
 * leftover: resetSettingsCache  - mGt.of(host).invalidateAll() (SettingsOwner).
 */
export function setParentManagedSettings(
  settings: Record<string, unknown> | null,
): void {
  getBootstrapSessionHost().settingsSource.replaceParentManagedSettings(
    settings,
  )
  resetSettingsCache()
}

export function getSessionIngressToken(): string | null | undefined {
  return getBootstrapSessionHost().credentialSlots.sessionIngressToken()
}

export function setSessionIngressToken(token: string | null): void {
  getBootstrapSessionHost().credentialSlots.replaceSessionIngressToken(token)
}

export function getOauthTokenFromFd(): string | null | undefined {
  return getBootstrapSessionHost().credentialSlots.oauthTokenFromFd()
}

export function setOauthTokenFromFd(token: string | null): void {
  getBootstrapSessionHost().credentialSlots.replaceOauthTokenFromFd(token)
}

export function getApiKeyFromFd(): string | null | undefined {
  return getBootstrapSessionHost().credentialSlots.apiKeyFromFd()
}

export function setApiKeyFromFd(key: string | null): void {
  getBootstrapSessionHost().credentialSlots.replaceApiKeyFromFd(key)
}

/**
 * official Gne  - `n().host.credentialSlots.oauthTokenFromBgSnapshot()`
 * export alias `Gne as isOauthTokenFromBgSnapshot`
 */
export function isOauthTokenFromBgSnapshot(): boolean {
  return getBootstrapSessionHost().credentialSlots.oauthTokenFromBgSnapshot()
}

export function setOauthTokenFromBgSnapshot(value: boolean): void {
  getBootstrapSessionHost().credentialSlots.replaceOauthTokenFromBgSnapshot(
    value,
  )
}

export function getOauthScopesFromFd(): unknown {
  return getBootstrapSessionHost().credentialSlots.oauthScopesFromFd()
}

export function setOauthScopesFromFd(scopes: unknown): void {
  getBootstrapSessionHost().credentialSlots.replaceOauthScopesFromFd(scopes)
}

export function resetFdCredentialState(): void {
  getBootstrapSessionHost().credentialSlots.resetFdCredentialState()
}

export function getAuthenticatedAccount(): unknown {
  return getBootstrapSessionHost().credentialSlots.authenticatedAccount()
}

export function getAuthenticatedAccountEpoch(): number {
  return getBootstrapSessionHost().credentialSlots.authenticatedAccountEpoch()
}

export function stampAuthenticatedAccount(
  account: {
    accountUuid?: string
    emailAddress?: string
    organizationUuid?: string
  } | null,
): void {
  getBootstrapSessionHost().credentialSlots.stampAuthenticatedAccount(account)
}

export function isGatewayServerProcess(): boolean {
  return getBootstrapSessionHost().credentialSlots.gatewayServerProcess()
}

export function setGatewayServerProcess(value: boolean): void {
  getBootstrapSessionHost().credentialSlots.replaceGatewayServerProcess(value)
}

export function getStartupPolicySnapshot(): unknown {
  return getBootstrapSessionHost().credentialSlots.startupPolicySnapshot()
}

export function setStartupPolicySnapshot(snapshot: unknown): void {
  getBootstrapSessionHost().credentialSlots.replaceStartupPolicySnapshot(
    snapshot,
  )
}

/**
 * official JLe  - `n().host.credentialSlots.gatewayRefreshInFlight()`
 * export alias `JLe as getGatewayRefreshInFlight`
 */
export function getGatewayRefreshInFlight(): unknown {
  return getBootstrapSessionHost().credentialSlots.gatewayRefreshInFlight()
}

/**
 * official jGt  - `n().host.credentialSlots.replaceGatewayRefreshInFlight(e)`
 */
export function setGatewayRefreshInFlight(promise: unknown): void {
  getBootstrapSessionHost().credentialSlots.replaceGatewayRefreshInFlight(
    promise,
  )
}

/**
 * official kEe  - `n().host.credentialSlots.sdkOAuthTokenRefreshCallback()`
 * export alias `kEe as getSdkOAuthTokenRefreshCallback`
 */
export function getSdkOAuthTokenRefreshCallback(): unknown {
  return getBootstrapSessionHost().credentialSlots.sdkOAuthTokenRefreshCallback()
}

/**
 * official WLe  - `n().host.credentialSlots.replaceSdkOAuthTokenRefreshCallback(e)`
 */
export function setSdkOAuthTokenRefreshCallback(cb: unknown): void {
  getBootstrapSessionHost().credentialSlots.replaceSdkOAuthTokenRefreshCallback(
    cb,
  )
}

/**
 * official e7e  - `n().host.credentialSlots.hostAuthTokenRefreshCallback()`
 * export alias `e7e as getHostAuthTokenRefreshCallback`
 */
export function getHostAuthTokenRefreshCallback(): unknown {
  return getBootstrapSessionHost().credentialSlots.hostAuthTokenRefreshCallback()
}

export function setHostAuthTokenRefreshCallback(cb: unknown): void {
  getBootstrapSessionHost().credentialSlots.replaceHostAuthTokenRefreshCallback(
    cb,
  )
}

export function setLastAPIRequest(
  params: Omit<BetaMessageStreamParams, 'messages'> | null,
): void {
  getBootstrapSession().requestJournal.replaceLastAPIRequest(params)
}

export function getLastAPIRequest(): Omit<
  BetaMessageStreamParams,
  'messages'
> | null {
  return getBootstrapSession().requestJournal.lastAPIRequest() as Omit<
    BetaMessageStreamParams,
    'messages'
  > | null
}

export function setLastAPIRequestMessages(
  messages: BetaMessageStreamParams['messages'] | null,
): void {
  getBootstrapSession().requestJournal.replaceLastAPIRequestMessages(messages)
}

export function getLastAPIRequestMessages():
  | BetaMessageStreamParams['messages']
  | null {
  return getBootstrapSession().requestJournal.lastAPIRequestMessages() as
    | BetaMessageStreamParams['messages']
    | null
}

export function setLastClassifierRequests(requests: unknown[] | null): void {
  getBootstrapSession().requestJournal.replaceLastClassifierRequests(requests)
}

export function getLastClassifierRequests(): unknown[] | null {
  return getBootstrapSession().requestJournal.lastClassifierRequests() as
    | unknown[]
    | null
}

export function setCachedClaudeMdContent(content: string | null): void {
  getBootstrapSession().sessionFlags.replaceCachedClaudeMdContent(content)
}

export function getCachedClaudeMdContent(): string | null {
  return getBootstrapSession().sessionFlags.cachedClaudeMdContent()
}

export function addToInMemoryErrorLog(errorInfo: {
  error: string
  timestamp: string
}): void {
  // Official He.recordError  - bag is SoT (cut STATE dual-write).
  getBootstrapSessionHost().diagnostics.recordError(errorInfo)
}

/**
 * official kde @178569888 sha=ba9ccdd1990b29b7
 * `function kde(){return n().host.settingsSource.allowedSettingSources()}`
 * export alias `kde as getAllowedSettingSources`
 */
export function getAllowedSettingSources(): SettingSource[] {
  return getBootstrapSessionHost().settingsSource.allowedSettingSources() as SettingSource[]
}

/**
 * official mkn @178569958 sha=142a9cea176da4d4
 * `function mkn(e){n().host.settingsSource.replaceAllowedSettingSources(e)}`
 * export alias `mkn as setAllowedSettingSources`
 */
export function setAllowedSettingSources(sources: SettingSource[]): void {
  getBootstrapSessionHost().settingsSource.replaceAllowedSettingSources(sources)
}

/**
 * official f7e @178570030 sha=8c25954fc4115dac
 * `function f7e(){return De()&&n().host.launchOptions.clientType()!=="claude-vscode"}`
 * IDE extension should behave as 1P for authentication reasons.
 */
export function preferThirdPartyAuthentication(): boolean {
  return getIsNonInteractiveSession() && getClientType() !== 'claude-vscode'
}

/**
 * official m7e @178570112 sha=ea4a9d396eb30fb4
 * `function m7e(e){n().host.extensionsConfig.replaceInlinePlugins(e)}`
 * export alias `m7e as setInlinePlugins`
 */
export function setInlinePlugins(plugins: Array<string>): void {
  getBootstrapSessionHost().extensionsConfig.replaceInlinePlugins(plugins)
}

/**
 * official C4 @178570178 sha=bde3aecf59bfb66e
 * `function C4(){return n().host.extensionsConfig.inlinePlugins()}`
 * export alias `C4 as getInlinePlugins`
 */
export function getInlinePlugins(): Array<string> {
  return getBootstrapSessionHost().extensionsConfig.inlinePlugins()
}

/**
 * official h7e @178570241 sha=e7c19f8b6f92af8c
 * `function h7e(e){n().host.extensionsConfig.replaceInlinePluginsNoMcp(e)}`
 * export alias `h7e as setInlinePluginsNoMcp`
 */
export function setInlinePluginsNoMcp(plugins: Array<string>): void {
  getBootstrapSessionHost().extensionsConfig.replaceInlinePluginsNoMcp(plugins)
}

/**
 * official R4 @178570312 sha=f9416924118f1b70
 * `function R4(){return n().host.extensionsConfig.inlinePluginsNoMcp()}`
 * export alias `R4 as getInlinePluginsNoMcp`
 */
export function getInlinePluginsNoMcp(): Array<string> {
  return getBootstrapSessionHost().extensionsConfig.inlinePluginsNoMcp()
}

/**
 * official hkn @178570380 sha=0218cc636114e1c1
 * `function hkn(e){n().host.extensionsConfig.replaceInlinePluginUrls(e)}`
 * export alias `hkn as setInlinePluginUrls`
 */
export function setInlinePluginUrls(urls: Array<string>): void {
  getBootstrapSessionHost().extensionsConfig.replaceInlinePluginUrls(urls)
}

/**
 * official Vne @178570449 sha=9d232015003264f3
 * `function Vne(){return n().host.extensionsConfig.inlinePluginUrls()}`
 * export alias `Vne as getInlinePluginUrls`
 */
export function getInlinePluginUrls(): Array<string> {
  return getBootstrapSessionHost().extensionsConfig.inlinePluginUrls()
}

/**
 * official Tde @178570516 sha=19533a129f85d650
 * `function Tde(e){n().host.extensionsConfig.replaceSyncedPluginDirs(e)}`
 * export alias `Tde as setSyncedPluginDirs`
 */
export function setSyncedPluginDirs(dirs: Array<string>): void {
  getBootstrapSessionHost().extensionsConfig.replaceSyncedPluginDirs(dirs)
}

/**
 * official xEe @178570914 sha=fd08c415b0ad3587
 * `function xEe(){return n().host.extensionsConfig.syncedPluginDirs()}`
 * export alias `xEe as getSyncedPluginDirs`
 */
export function getSyncedPluginDirs(): Array<string> {
  return getBootstrapSessionHost().extensionsConfig.syncedPluginDirs()
}

/**
 * official Skn @178571487 sha=45d67edaf40e0af6
 * `function Skn(e){n().host.extensionsConfig.replaceChromeFlagOverride(e)}`
 * export alias `Skn as setChromeFlagOverride`
 */
export function setChromeFlagOverride(value: boolean | undefined): void {
  getBootstrapSessionHost().extensionsConfig.replaceChromeFlagOverride(value)
}

/**
 * official Ade @178571558 sha=60311b7a51c6b5e6
 * `function Ade(){return n().host.extensionsConfig.chromeFlagOverride()}`
 * export alias `Ade as getChromeFlagOverride`
 */
export function getChromeFlagOverride(): boolean | undefined {
  return getBootstrapSessionHost().extensionsConfig.chromeFlagOverride()
}

export function setClaudeInChromeSessionPromptActive(value: boolean): void {
  STATE.claudeInChromeSessionPromptActive = value
}

export function getClaudeInChromeSessionPromptActive(): boolean {
  return STATE.claudeInChromeSessionPromptActive
}

/**
 * official G$ @178571899 sha=7510de2679e5128a
 * `function G$(e){let t=n();t.host.settingsSource.replaceUseCoworkPlugins(e),mGt.of(t.host).invalidateAll()}`
 * export alias `G$ as setUseCoworkPlugins`
 * leftover: resetSettingsCache  - mGt.of(host).invalidateAll() (SettingsOwner).
 */
export function setUseCoworkPlugins(value: boolean): void {
  getBootstrapSessionHost().settingsSource.replaceUseCoworkPlugins(value)
  resetSettingsCache()
}

/**
 * official y7e @178572004 sha=debaad53d2b4c710
 * `function y7e(){return n().host.settingsSource.useCoworkPlugins()}`
 * export alias `y7e as getUseCoworkPlugins`
 */
export function getUseCoworkPlugins(): boolean {
  return getBootstrapSessionHost().settingsSource.useCoworkPlugins()
}

/**
 * official kkn @178572069
 * `function kkn(e){n().host.launchOptions.replaceDisableSlashCommands(e)}`
 * export alias `kkn as setDisableSlashCommands`
 */
export function setDisableSlashCommands(value: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceDisableSlashCommands(value)
}

/**
 * official vg @178572139
 * `function vg(){return n().host.launchOptions.disableSlashCommands()}`
 * export alias `vg as getDisableSlashCommands`
 */
export function getDisableSlashCommands(): boolean {
  return getBootstrapSessionHost().launchOptions.disableSlashCommands()
}

/**
 * official Tkn @178572206 sha=d4220a054ab217f8
 * `function Tkn(e){n().host.launchOptions.replaceSessionBypassPermissionsMode(e)}`
 * export alias `Tkn as setSessionBypassPermissionsMode`
 */
export function setSessionBypassPermissionsMode(enabled: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceSessionBypassPermissionsMode(
    enabled,
  )
}

/**
 * official H4 @178572284 sha=21fd15a79f014c6f
 * `function H4(){return n().host.launchOptions.sessionBypassPermissionsMode()}`
 * export alias `H4 as getSessionBypassPermissionsMode`
 */
export function getSessionBypassPermissionsMode(): boolean {
  return getBootstrapSessionHost().launchOptions.sessionBypassPermissionsMode()
}

/**
 * official V$ @178572359 sha=6283865dd6f83685
 * `function V$(e){n().host.launchOptions.replaceScheduledTasksEnabled(e)}`
 * export alias `V$ as setScheduledTasksEnabled`
 */
export function setScheduledTasksEnabled(enabled: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceScheduledTasksEnabled(enabled)
}

/**
 * official b7e @178572429 sha=c7d35a518554ada9
 * `function b7e(){return n().host.launchOptions.scheduledTasksEnabled()}`
 * export alias `b7e as getScheduledTasksEnabled`
 */
export function getScheduledTasksEnabled(): boolean {
  return getBootstrapSessionHost().launchOptions.scheduledTasksEnabled()
}

export type SessionCronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  recurring?: boolean
  /**
   * densable `kind:"loop"`  - ScheduleWakeup dynamic-loop one-shot wakeups.
   * Session-only; never written to disk.
   */
  kind?: 'loop'
  /**
   * When set, the task was created by an in-process teammate (not the team lead).
   * The scheduler routes fires to that teammate's pendingUserMessages queue
   * instead of the main REPL command queue. Session-only  - never written to disk.
   */
  agentId?: string
}

export type LoopChainState = {
  startedAt: number
  lastScheduledFor: number
  agedOut?: boolean
}

export function getSessionCronTasks(): SessionCronTask[] {
  return getBootstrapSession().sessionCron.tasks() as SessionCronTask[]
}

export function addSessionCronTask(task: SessionCronTask): void {
  getBootstrapSession().sessionCron.schedule(task)
}

/**
 * Returns the number of tasks actually removed. Callers use this to skip
 * downstream work (e.g. the disk read in removeCronTasks) when all ids
 * were accounted for here.
 */
export function removeSessionCronTasks(ids: readonly string[]): number {
  if (ids.length === 0) return 0
  const idSet = new Set(ids)
  const cron = getBootstrapSession().sessionCron
  const current = cron.tasks() as SessionCronTask[]
  const remaining = current.filter(t => !idSet.has(t.id))
  const removed = current.length - remaining.length
  if (removed === 0) return 0
  cron.replaceTasks(remaining)
  return removed
}

/** densable `kLi` */
export function getLoopChainStartedAt(
  prompt: string,
): LoopChainState | undefined {
  return getBootstrapSession().sessionCron.chainStartedAt(prompt) as
    | LoopChainState
    | undefined
}

/** densable `$Wn` */
export function setLoopChainStartedAt(
  prompt: string,
  state: LoopChainState,
): void {
  getBootstrapSession().sessionCron.recordChainStart(prompt, state)
}

/** densable `CZt` */
export function clearLoopChainStartedAt(prompt: string): void {
  getBootstrapSession().sessionCron.forgetChainStart(prompt)
}

/** densable `AZt` / `aPt` */
export function getLoopTickInFlightPrompt(): string | null {
  return getBootstrapSession().sessionCron.tickInFlightPrompt() as string | null
}

export function setLoopTickInFlightPrompt(prompt: string | null): void {
  getBootstrapSession().sessionCron.replaceTickInFlightPrompt(prompt)
}

/** densable `FWn` / `RZt` */
export function getLoopConsecutiveKeepalives(): number {
  return getBootstrapSession().sessionCron.consecutiveKeepalives()
}

export function setLoopConsecutiveKeepalives(n: number): void {
  getBootstrapSession().sessionCron.replaceConsecutiveKeepalives(n)
}

/** densable `xLi` / `Dqr` */
export function getLoopEnded(): boolean {
  return getBootstrapSession().sessionCron.ended()
}

export function setLoopEnded(ended: boolean): void {
  getBootstrapSession().sessionCron.replaceEnded(ended)
}

export function setSessionTrustAccepted(accepted: boolean): void {
  getBootstrapSession().sessionFlags.replaceSessionTrustAccepted(accepted)
}

export function getSessionTrustAccepted(): boolean {
  return getBootstrapSession().sessionFlags.sessionTrustAccepted()
}

/**
 * official Rkn @178573850 sha=faa245bb728c3110
 * `function Rkn(e){n().host.launchOptions.replaceSessionPersistenceDisabled(e)}`
 * export alias `Rkn as setSessionPersistenceDisabled`
 */
export function setSessionPersistenceDisabled(disabled: boolean): void {
  getBootstrapSessionHost().launchOptions.replaceSessionPersistenceDisabled(
    disabled,
  )
}

/**
 * official qC @178573926 sha=d11e4c26440cc7fc
 * `function qC(){return n().host.launchOptions.sessionPersistenceDisabled()}`
 * export alias `qC as isSessionPersistenceDisabled`
 * FORCE env is official Kce/x0t nested-marker only  - not in qC.
 */
export function isSessionPersistenceDisabled(): boolean {
  return getBootstrapSessionHost().launchOptions.sessionPersistenceDisabled()
}

export function hasExitedPlanModeInSession(): boolean {
  return getBootstrapSession().sessionFlags.hasExitedPlanMode()
}

export function setHasExitedPlanMode(value: boolean): void {
  getBootstrapSession().sessionFlags.replaceHasExitedPlanMode(value)
}

export function needsPlanModeExitAttachment(): boolean {
  return getBootstrapSession().sessionFlags.needsPlanModeExitAttachment()
}

export function setNeedsPlanModeExitAttachment(value: boolean): void {
  getBootstrapSession().sessionFlags.replaceNeedsPlanModeExitAttachment(value)
}

export function handlePlanModeTransition(
  fromMode: string,
  toMode: string,
): void {
  // If switching TO plan mode, clear any pending exit attachment
  // This prevents sending both plan_mode and plan_mode_exit when user toggles quickly
  if (toMode === 'plan' && fromMode !== 'plan') {
    setNeedsPlanModeExitAttachment(false)
  }

  // If switching out of plan mode, trigger the plan_mode_exit attachment
  if (fromMode === 'plan' && toMode !== 'plan') {
    setNeedsPlanModeExitAttachment(true)
  }
}

export function needsAutoModeExitAttachment(): boolean {
  return getBootstrapSession().sessionFlags.needsAutoModeExitAttachment()
}

export function setNeedsAutoModeExitAttachment(value: boolean): void {
  getBootstrapSession().sessionFlags.replaceNeedsAutoModeExitAttachment(value)
}

/** Official vy  - n().sessionFlags.memoryToggledOff() */
export function memoryToggledOff(): boolean {
  return getBootstrapSession().sessionFlags.memoryToggledOff()
}

/** Official by / Yv  - n().sessionFlags.replaceMemoryToggledOff(e) */
export function replaceMemoryToggledOff(value: boolean): void {
  getBootstrapSession().sessionFlags.replaceMemoryToggledOff(value)
}

export function handleAutoModeTransition(
  fromMode: string,
  toMode: string,
): void {
  // Auto↔plan transitions are handled by prepareContextForPlanMode (auto may
  // stay active through plan if opted in) and ExitPlanMode (restores mode).
  // Skip both directions so this function only handles direct auto transitions.
  if (
    (fromMode === 'auto' && toMode === 'plan') ||
    (fromMode === 'plan' && toMode === 'auto')
  ) {
    return
  }
  const fromIsAuto = fromMode === 'auto'
  const toIsAuto = toMode === 'auto'

  // If switching TO auto mode, clear any pending exit attachment
  // This prevents sending both auto_mode and auto_mode_exit when user toggles quickly
  if (toIsAuto && !fromIsAuto) {
    setNeedsAutoModeExitAttachment(false)
  }

  // If switching out of auto mode, trigger the auto_mode_exit attachment
  if (fromIsAuto && !toIsAuto) {
    setNeedsAutoModeExitAttachment(true)
  }
}

// LSP plugin recommendation session tracking
export function hasShownLspRecommendationThisSession(): boolean {
  return getBootstrapSession().sessionFlags.lspRecommendationShownThisSession()
}

export function setLspRecommendationShownThisSession(value: boolean): void {
  getBootstrapSession().sessionFlags.replaceLspRecommendationShownThisSession(
    value,
  )
}

// SDK init event state
/**
 * official Dkn @178575415 sha=f0b5ffbd9842d8ea
 * `function Dkn(e){n().host.launchOptions.replaceInitJsonSchema(e)}`
 * export alias `Dkn as setInitJsonSchema`
 */
export function setInitJsonSchema(
  schema: Record<string, unknown> | null,
): void {
  getBootstrapSessionHost().launchOptions.replaceInitJsonSchema(schema)
}

/**
 * official xvt @178575479 sha=39d7b198486e4839
 * `function xvt(){return n().host.launchOptions.initJsonSchema()}`
 * export alias `xvt as getInitJsonSchema`
 */
export function getInitJsonSchema(): Record<string, unknown> | null {
  return getBootstrapSessionHost().launchOptions.initJsonSchema() as Record<
    string,
    unknown
  > | null
}

function registeredHookHolder(): {
  registeredHooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>> | null
} {
  return getBootstrapSession().hookRegistry.holder() as {
    registeredHooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>> | null
  }
}

export function registerHookCallbacks(
  hooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>>,
): void {
  const holder = registeredHookHolder()
  if (!holder.registeredHooks) {
    holder.registeredHooks = {}
  }

  // `registerHookCallbacks` may be called multiple times, so we need to merge (not overwrite)
  for (const [event, matchers] of Object.entries(hooks)) {
    const eventKey = event as HookEvent
    if (!holder.registeredHooks[eventKey]) {
      holder.registeredHooks[eventKey] = []
    }
    holder.registeredHooks[eventKey]!.push(...(matchers ?? []))
  }
}

export function getRegisteredHooks(): Partial<
  Record<HookEvent, RegisteredHookMatcher[]>
> | null {
  return registeredHookHolder().registeredHooks
}

export function clearRegisteredPluginHooks(): void {
  const holder = registeredHookHolder()
  if (!holder.registeredHooks) {
    return
  }

  const filtered: Partial<Record<HookEvent, RegisteredHookMatcher[]>> = {}
  for (const [event, matchers] of Object.entries(holder.registeredHooks)) {
    // Keep only callback hooks (those without pluginRoot)
    const callbackHooks = (matchers ?? []).filter(m => !('pluginRoot' in m))
    if (callbackHooks.length > 0) {
      filtered[event as HookEvent] = callbackHooks
    }
  }

  holder.registeredHooks = Object.keys(filtered).length > 0 ? filtered : null
}

export function resetSdkInitState(): void {
  setInitJsonSchema(null)
  registeredHookHolder().registeredHooks = null
}

export function getPlanSlugCache(): Map<string, string> {
  return getBootstrapSession().sessionScratch.planSlugCache() as Map<
    string,
    string
  >
}

export function setPlanSlugCacheEntry(sessionId: string, slug: string): void {
  const cache = getBootstrapSession().sessionScratch.planSlugCache()
  if (cache.size >= 50) {
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) {
      cache.delete(firstKey)
    }
  }
  cache.set(sessionId, slug)
}

export function getSessionCreatedTeams(): Set<string> {
  return getBootstrapSession().sessionScratch.sessionCreatedTeams() as Set<string>
}

// Teleported session tracking for reliability logging
export function setTeleportedSessionInfo(info: {
  sessionId: string | null
}): void {
  const next = {
    isTeleported: true,
    hasLoggedFirstMessage: false,
    sessionId: info.sessionId,
  }
  getBootstrapSession().sessionFlags.replaceTeleportedSessionInfo(next)
  // densable zNn: register id for bridge G7 remint suppression
  if (info.sessionId) {
    markTeleportedSessionId(info.sessionId)
  }
}

export function getTeleportedSessionInfo(): {
  isTeleported: boolean
  hasLoggedFirstMessage: boolean
  sessionId: string | null
} | null {
  return getBootstrapSession().sessionFlags.teleportedSessionInfo() as {
    isTeleported: boolean
    hasLoggedFirstMessage: boolean
    sessionId: string | null
  } | null
}

export function markFirstTeleportMessageLogged(): void {
  getBootstrapSession().sessionFlags.markFirstTeleportMessageLogged()
}

/** densable Dm  - strip session_/cse_ prefix for teleportedSessionIds key. */
export function normalizeTeleportedSessionId(id: string): string {
  return id.replace(/^(?:session|cse)_/, '')
}

const TELEPORTED_SESSION_IDS_CAP = 64

/**
 * densable zNn  - mark session as teleported to cloud (FIFO cap 64).
 * Call on teleport start (local id) and success/may-have-committed (remote id).
 */
export function markTeleportedSessionId(sessionId: string): void {
  if (!sessionId) return
  const key = normalizeTeleportedSessionId(sessionId)
  if (!key) return
  const set = STATE.teleportedSessionIds
  // Re-add to move to insertion end (freshest) when already present
  if (set.has(key)) set.delete(key)
  set.add(key)
  while (set.size > TELEPORTED_SESSION_IDS_CAP) {
    const oldest = set.values().next().value
    if (oldest === undefined) break
    set.delete(oldest)
  }
}

/** densable G7  - true if session was teleported to cloud. */
export function isTeleportedSessionId(sessionId: string): boolean {
  if (!sessionId) return false
  return STATE.teleportedSessionIds.has(normalizeTeleportedSessionId(sessionId))
}

/** densable Ljp  - clear teleported mark (rare; tests / session recycle). */
export function clearTeleportedSessionId(sessionId: string): void {
  if (!sessionId) return
  STATE.teleportedSessionIds.delete(normalizeTeleportedSessionId(sessionId))
}

// Invoked skills tracking for preservation across compaction
export type InvokedSkillInfo = {
  skillName: string
  skillPath: string
  content: string
  invokedAt: number
  agentId: string | null
}

export function addInvokedSkill(
  skillName: string,
  skillPath: string,
  content: string,
  agentId: string | null = null,
): void {
  const key = `${agentId ?? ''}:${skillName}`
  const info = {
    skillName,
    skillPath,
    content,
    invokedAt: Date.now(),
    agentId,
  }
  getBootstrapSession().invokedSkills.record(key, info)
}

export function getInvokedSkillsForAgent(
  agentId: string | undefined | null,
): Map<string, InvokedSkillInfo> {
  const normalizedId = agentId ?? null
  const filtered = new Map<string, InvokedSkillInfo>()
  for (const [
    key,
    skill,
  ] of getBootstrapSession().invokedSkills.skills() as Map<
    string,
    InvokedSkillInfo
  >) {
    if (skill.agentId === normalizedId) {
      filtered.set(key, skill)
    }
  }
  return filtered
}

export function clearInvokedSkills(
  preservedAgentIds?: ReadonlySet<string>,
): void {
  const bag = getBootstrapSession().invokedSkills
  if (!preservedAgentIds || preservedAgentIds.size === 0) {
    bag.forgetAll()
    return
  }
  for (const [key, skill] of [
    ...(bag.skills() as Map<string, InvokedSkillInfo>),
  ]) {
    if (skill.agentId === null || !preservedAgentIds.has(skill.agentId)) {
      bag.forget(key)
    }
  }
}

export function clearInvokedSkillsForAgent(agentId: string): void {
  const bag = getBootstrapSession().invokedSkills
  for (const [key, skill] of [
    ...(bag.skills() as Map<string, InvokedSkillInfo>),
  ]) {
    if (skill.agentId === agentId) {
      bag.forget(key)
    }
  }
}

/**
 * Official xEr/CEr @178579251  - n().host.diagnostics.
 * recordSlowOperation official body is empty; getter filters #t (never filled).
 */
export function addSlowOperation(operation: string, durationMs: number): void {
  getBootstrapSessionHost().diagnostics.recordSlowOperation(
    operation,
    durationMs,
  )
}

export function getSlowOperations(): ReadonlyArray<{
  operation: string
  durationMs: number
  timestamp: number
}> {
  return getBootstrapSessionHost().diagnostics.slowOperations() as ReadonlyArray<{
    operation: string
    durationMs: number
    timestamp: number
  }>
}

/** Official REr @178579251  - n().host.diagnostics.recordDevBarAlert (empty body). */
export function addDevBarAlert(alert: unknown): void {
  getBootstrapSessionHost().diagnostics.recordDevBarAlert(alert)
}

/** Official IEr  - n().host.diagnostics.devBarAlert. */
export function getDevBarAlert(): { timestamp: number } | undefined {
  return getBootstrapSessionHost().diagnostics.devBarAlert()
}

export function getMainThreadAgentType(): string | undefined {
  return getBootstrapSession().hookRegistry.mainThreadAgentType() as
    | string
    | undefined
}

export function setMainThreadAgentType(agentType: string | undefined): void {
  getBootstrapSession().hookRegistry.replaceMainThreadAgentType(agentType)
}

/** densable fne  - main-thread agent frontmatter hooks (after QEt trust gate). */
export function getMainThreadAgentHooks():
  | import('../utils/settings/types.js').HooksSettings
  | undefined {
  return getBootstrapSession().hookRegistry.mainThreadAgentHooks() as
    | import('../utils/settings/types.js').HooksSettings
    | undefined
}

/** densable b1r */
export function setMainThreadAgentHooks(
  hooks: import('../utils/settings/types.js').HooksSettings | undefined,
): void {
  getBootstrapSession().hookRegistry.replaceMainThreadAgentHooks(hooks)
}

/**
 * Official On @178580174  - `n().surfaceCapabilities.caps().workspace==="remote"`
 * (export alias getIsRemoteMode). Not a STATE latch.
 */
export function getIsRemoteMode(): boolean {
  return getBootstrapSession().surfaceCapabilities.caps().workspace === 'remote'
}

/**
 * Official P4 @178580241  - `n().surfaceCapabilities.markRemote(e)`
 * (export alias setIsRemoteMode).
 */
export function setIsRemoteMode(value: boolean): void {
  getBootstrapSession().surfaceCapabilities.markRemote(value)
}

// System prompt section accessors

export function getSystemPromptSectionCache(): Map<string, string | null> {
  return getBootstrapSession().promptAssembly.sections() as Map<
    string,
    string | null
  >
}

/**
 * Official Jkn @178580352  - `n().promptAssembly.recordSection(e,t)`
 * (no size cap; no STATE dual-write).
 */
export function setSystemPromptSectionCacheEntry(
  name: string,
  value: string | null,
): void {
  getBootstrapSession().promptAssembly.recordSection(name, value)
}

/**
 * Official A7e @178580408  - `forgetAllSections(),Ivt()` where
 * Ivt=`noteInvalidation()`.
 */
export function clearSystemPromptSectionState(): void {
  const pa = getBootstrapSession().promptAssembly
  pa.forgetAllSections()
  pa.noteInvalidation()
}

// Last emitted date accessors (for detecting midnight date changes)

export function getLastEmittedDate(): string | null {
  return getBootstrapSession().promptAssembly.lastEmittedDate()
}

export function setLastEmittedDate(date: string | null): void {
  getBootstrapSession().promptAssembly.replaceLastEmittedDate(date)
}

/**
 * official _m @178580940 sha=41b8506aa8b530d5
 * `function _m(){return n().host.extensionsConfig.additionalDirectoriesForClaudeMd()}`
 * export alias `_m as getAdditionalDirectoriesForClaudeMd`
 */
export function getAdditionalDirectoriesForClaudeMd(): string[] {
  return getBootstrapSessionHost().extensionsConfig.additionalDirectoriesForClaudeMd()
}

/**
 * official D4 @178581022 sha=51805e3e12b764db
 * `function D4(e){n().host.extensionsConfig.replaceAdditionalDirectoriesForClaudeMd(e)}`
 * export alias `D4 as setAdditionalDirectoriesForClaudeMd`
 */
export function setAdditionalDirectoriesForClaudeMd(
  directories: string[],
): void {
  getBootstrapSessionHost().extensionsConfig.replaceAdditionalDirectoriesForClaudeMd(
    directories,
  )
}

/**
 * official Bp @178581106 sha=d2fd1b015c09a08d
 * `function Bp(){return n().host.extensionsConfig.allowedChannels()}`
 * export alias `Bp as getAllowedChannels`
 */
export function getAllowedChannels(): ChannelEntry[] {
  return getBootstrapSessionHost().extensionsConfig.allowedChannels() as ChannelEntry[]
}

/**
 * official p7 @178581171 sha=0ec0fb0d6194dea5
 * `function p7(e){n().host.extensionsConfig.replaceAllowedChannels(e)}`
 * export alias `p7 as setAllowedChannels`
 */
export function setAllowedChannels(entries: ChannelEntry[]): void {
  getBootstrapSessionHost().extensionsConfig.replaceAllowedChannels(entries)
}

/**
 * official R7e @178581238 sha=a58ab8848a3ee024
 * `function R7e(){return n().host.extensionsConfig.hasDevChannels()}`
 * export alias `R7e as getHasDevChannels`
 */
export function getHasDevChannels(): boolean {
  return getBootstrapSessionHost().extensionsConfig.hasDevChannels()
}

/**
 * official o3t @178581303 sha=3b9864cc162f6f6c
 * `function o3t(e){n().host.extensionsConfig.replaceHasDevChannels(e)}`
 * export alias `o3t as setHasDevChannels`
 */
export function setHasDevChannels(value: boolean): void {
  getBootstrapSessionHost().extensionsConfig.replaceHasDevChannels(value)
}

export function getPromptCache1hAllowlist(): string[] | null {
  return getBootstrapSessionHost().requestLatches.promptCache1hAllowlist()
}

export function setPromptCache1hAllowlist(allowlist: string[] | null): void {
  getBootstrapSessionHost().requestLatches.replacePromptCache1hAllowlist(
    allowlist,
  )
}

/**
 * official oTn  - `n().host.requestLatches.thinkingTypeOverrides().get(e)`
 * export alias `oTn as getThinkingTypeOverride`
 */
export function getThinkingTypeOverride(model: unknown): unknown {
  return getBootstrapSessionHost()
    .requestLatches.thinkingTypeOverrides()
    .get(model)
}

/**
 * official iTn  - `recordThinkingTypeOverride`
 * export alias `iTn as setThinkingTypeOverride`
 */
export function setThinkingTypeOverride(model: unknown, value: unknown): void {
  getBootstrapSessionHost().requestLatches.recordThinkingTypeOverride(
    model,
    value,
  )
}

/**
 * official sTn  - `getServedModelsForRequestedModel`
 */
export function getServedModelsForRequestedModel(model: unknown): unknown {
  return getBootstrapSessionHost()
    .requestLatches.servedModelsByRequestedModel()
    .get(model)
}

export function recordServedModels(model: unknown, served: unknown): void {
  getBootstrapSessionHost().requestLatches.recordServedModels(model, served)
}

/**
 * official Hvt  - `effortUnsupportedModels().has(e)`
 */
export function isEffortUnsupported(model: unknown): boolean {
  return getBootstrapSessionHost()
    .requestLatches.effortUnsupportedModels()
    .has(model)
}

/**
 * official s3t  - `markEffortUnsupported`
 */
export function markEffortUnsupported(model: unknown): void {
  getBootstrapSessionHost().requestLatches.markEffortUnsupported(model)
}

/**
 * official uTn  - `isStrictPrefixLockStoodDown`
 */
export function isStrictPrefixLockStoodDown(): boolean {
  return getBootstrapSessionHost().requestLatches.strictPrefixLockStoodDown()
}

/**
 * official HEr  - `markStrictPrefixLockStoodDown`
 */
export function markStrictPrefixLockStoodDown(): void {
  getBootstrapSessionHost().requestLatches.markStrictPrefixLockStoodDown()
}

/**
 * official dTn  - `isPerTurnEffortOkEmitted`
 */
export function isPerTurnEffortOkEmitted(): boolean {
  return getBootstrapSessionHost().requestLatches.perTurnEffortOkEmitted()
}

export function markPerTurnEffortOkEmitted(): void {
  getBootstrapSessionHost().requestLatches.markPerTurnEffortOkEmitted()
}

/**
 * official Xne  - `getInferenceProfileBackingModelCached`
 */
export function getInferenceProfileBackingModelCached(model: unknown): unknown {
  return getBootstrapSessionHost()
    .requestLatches.inferenceProfileBackingModels()
    .get(model)
}

/**
 * official fTn  - `setInferenceProfileBackingModel` / recordInferenceProfileBackingModel
 */
export function setInferenceProfileBackingModel(
  model: unknown,
  backing: unknown,
): void {
  getBootstrapSessionHost().requestLatches.recordInferenceProfileBackingModel(
    model,
    backing,
  )
}

/**
 * KEEP STATE - SEA `"promptCache1hEligible"` hits=0. Official qe/requestLatches
 * has `promptCache1hAllowlist` only (nTn/rTn @178581416). invent-ban bag slot.
 */
export function getPromptCache1hEligible(): boolean | null {
  return STATE.promptCache1hEligible
}

export function setPromptCache1hEligible(eligible: boolean | null): void {
  STATE.promptCache1hEligible = eligible
}

/** densable 2.1.248 `rl().pinnedFeatureValues ??= new Map` */
export function getPinnedFeatureValues(): Map<string, unknown> {
  return (STATE.pinnedFeatureValues ??= new Map())
}

/**
 * KEEP STATE - SEA `"afkModeHeaderLatched"` / `"fastModeHeaderLatched"` /
 * `"cacheEditingHeaderLatched"` hits=0; not on qe/Ee/he/ge. invent-ban bag.
 */
export function getAfkModeHeaderLatched(): boolean | null {
  return STATE.afkModeHeaderLatched
}

export function setAfkModeHeaderLatched(v: boolean): void {
  STATE.afkModeHeaderLatched = v
}

export function getFastModeHeaderLatched(): boolean | null {
  return STATE.fastModeHeaderLatched
}

export function setFastModeHeaderLatched(v: boolean): void {
  STATE.fastModeHeaderLatched = v
}

export function getCacheEditingHeaderLatched(): boolean | null {
  return STATE.cacheEditingHeaderLatched
}

export function setCacheEditingHeaderLatched(v: boolean): void {
  STATE.cacheEditingHeaderLatched = v
}

/**
 * Official Pvt @178583191 (gold-248-stickyBetas):
 * `if(g()) e.stickyBetas=k4(); else n().conversationLatches.unlatchStickyBetas();
 *  e?.perTurnEffortPins.clear()`  - no header nulls, no requestLatches.reset.
 * Leftover: bag unlatch (C()/g() empty) + KEEP header nulls + resetRequestLatches.
 * Callers that also need getAllModelBetas re-evaluation must clearBetasCaches().
 */
export function clearBetaHeaderLatches(): void {
  STATE.afkModeHeaderLatched = null
  STATE.fastModeHeaderLatched = null
  STATE.cacheEditingHeaderLatched = null
  getBootstrapSession().conversationLatches.unlatchStickyBetas()
  resetRequestLatches()
}

export function getPromptId(): string | null {
  return getBootstrapSession().requestJournal.promptId()
}

export function setPromptId(id: string | null): void {
  getBootstrapSession().requestJournal.replacePromptId(id)
}

/**
 * official mTn @178583424
 * `function mTn(){return n().requestJournal.incrementPromptIndex()}`
 * export alias `mTn as incrementPromptIndex`
 */
export function incrementPromptIndex(): number {
  return getBootstrapSession().requestJournal.incrementPromptIndex()
}

/**
 * official Dvt @178583488
 * `function Dvt(){return n().requestJournal.promptIndex()}`
 * export alias `Dvt as getPromptIndex`
 * No official setPromptIndex export; uwn clear uses replacePromptIndex(0).
 */
export function getPromptIndex(): number {
  return getBootstrapSession().requestJournal.promptIndex()
}

/** densable FC  - true while REPL Remote Control bridge is live. */
export function isReplBridgeActive(): boolean {
  return getBootstrapSession().surfaceCapabilities.replBridgeActive()
}

/** densable eDe  - set when bridge connects / fails / tears down. */
export function setReplBridgeActive(active: boolean): void {
  if (getBootstrapSession().surfaceCapabilities.replBridgeActive() === active) {
    return
  }
  getBootstrapSession().surfaceCapabilities.replaceReplBridgeActive(active)
  // Do NOT clear replBridgeSessionId here  - failed→ready reconnect must
  // keep the cse_* so teleport/G7 still match. Clear only on teardown via
  // setReplBridgeSessionId(undefined).
}

/** densable bridge cse_* id for G7 teleport mark + remint suppress. */
export function getReplBridgeSessionId(): string | undefined {
  return STATE.replBridgeSessionId
}

export function setReplBridgeSessionId(sessionId: string | undefined): void {
  STATE.replBridgeSessionId = sessionId
}

/**
 * Official Yd @178582915  - `g()?.stickyBetas??n().conversationLatches.stickyBetas()`.
 * Leftover C()/g() empty  - bag only.
 */
export function getStickyBetas(): { sent: Set<string>; rejected: Set<string> } {
  return getBootstrapSession().conversationLatches.stickyBetas() as {
    sent: Set<string>
    rejected: Set<string>
  }
}

/**
 * Leftover resetStickyBetas (historical densable GRe name)  - bag unlatch.
 * SEA has no export resetStickyBetas; session clear sticky via Pvt.
 */
export function resetStickyBetas(): void {
  getBootstrapSession().conversationLatches.unlatchStickyBetas()
}

/** densable DV  - sticky-reject a beta until session clear. */
export function stickyRejectBeta(beta: string): void {
  const betas = getStickyBetas()
  betas.sent.delete(beta)
  betas.rejected.add(beta)
}

/** densable Iz  - has beta been sticky-rejected? */
export function isStickyBetaRejected(beta: string): boolean {
  return getStickyBetas().rejected.has(beta)
}

/**
 * densable tHe  - mark beta as sent (if not already rejected).
 * Used by ekd/rkd when arming server-side-fallback / fallback-credit.
 */
export function stickySendBeta(beta: string): void {
  const betas = getStickyBetas()
  if (!betas.rejected.has(beta)) {
    betas.sent.add(beta)
  }
}

/**
 * densable uFe  - beta was sent and is still active (not rejected).
 */
export function isStickyBetaSentActive(beta: string): boolean {
  return getStickyBetas().sent.has(beta) && !getStickyBetas().rejected.has(beta)
}

/** densable Gri / lTn  - `n().host.requestLatches.midConvCachePromotionRejected()`. */
export function getMidConvCachePromotionRejected(): boolean {
  return getBootstrapSessionHost().requestLatches.midConvCachePromotionRejected()
}

/**
 * densable Vri / cTn  - one-way mark.
 * `function cTn(){n().host.requestLatches.markMidConvCachePromotionRejected()}`
 */
export function markMidConvCachePromotionRejected(): void {
  getBootstrapSessionHost().requestLatches.markMidConvCachePromotionRejected()
}

/**
 * /clear /compact / tests  - official remints or resets qe; leftover calls reset().
 */
export function resetRequestLatches(): void {
  getBootstrapSessionHost().requestLatches.reset()
}
