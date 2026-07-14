/**
 * Official Bie / SXl portable — CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK.
 *
 * Refusal fallback (switch-model-on-flag path) is on by default; env
 * CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK turns it off. Local requestDialog is
 * used; bridge-forward tJl is optional via bridgeDialog adapter selection.
 *
 * CLAUDE_CODE_REFUSAL_FALLBACK_CATCH_ALL — catch-all route for non-mapped models.
 *
 * Dialog decision densables (OXl / LXl / PXl / x_i / NXl) + FXl show densable.
 * Silent-arm densables (m1u / w_i / g_i / PJe / fallback_request).
 * Latch arm/restore densables below; query/withRetry consumers wire them.
 */

import { isEnvTruthy } from './envUtils.js'
import {
  REFUSAL_FALLBACK_DIALOG_KIND,
  type RefusalFallbackResult,
  refusalFallbackDialogSpec,
} from './printRequestDialog.js'

export function isRefusalFallbackEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isEnvTruthy(env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK)
}

export function isRefusalFallbackCatchAllEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isEnvTruthy(env.CLAUDE_CODE_REFUSAL_FALLBACK_CATCH_ALL)
}

/** Official OXl suppress reasons for showing the refusal_fallback dialog. */
export type RefusalDialogSuppressReason =
  | 'silent_ab'
  | 'subagent'
  | 'no_dialog_host'
  | 'setting'
  | 'no_consumer_capability'

export type RefusalDialogDecisionInput = {
  silentAttempt?: boolean
  isMainThread?: boolean
  /** Official requestDialog host present. */
  requestDialog?: unknown
  /**
   * Official $c("switchModelsOnFlag", true).value — when true, auto-switch
   * without dialog (suppress reason "setting").
   */
  switchModelsOnFlag?: boolean
  consumerLacksDialogCapability?: boolean
}

/**
 * Official OXl — reason the refusal_fallback dialog is suppressed, or
 * undefined when the dialog may be shown.
 */
export function resolveRefusalDialogSuppressReason(
  input: RefusalDialogDecisionInput,
): RefusalDialogSuppressReason | undefined {
  if (input.silentAttempt) return 'silent_ab'
  if (input.isMainThread === false) return 'subagent'
  if (input.requestDialog === undefined) return 'no_dialog_host'
  if (input.switchModelsOnFlag === true) return 'setting'
  if (input.consumerLacksDialogCapability) return 'no_consumer_capability'
  return undefined
}

/**
 * Official LXl — true when main thread has no dialog host/capability AND
 * switchModelsOnFlag is explicitly false (cannot auto-switch either).
 */
export function isRefusalFallbackStuckWithoutDialog(
  input: RefusalDialogDecisionInput,
): boolean {
  return (
    input.isMainThread === true &&
    (input.requestDialog === undefined ||
      input.consumerLacksDialogCapability === true) &&
    input.switchModelsOnFlag === false
  )
}

/**
 * Official PXl — host is active but did not declare refusal_fallback_prompt
 * in supportedDialogKinds (consumer lacks capability).
 */
export function isRefusalDialogConsumerLackingCapability(input: {
  dialogHostActive: boolean
  supportedDialogKinds: readonly string[] | undefined | null
}): boolean {
  if (!input.dialogHostActive) return false
  const kinds = input.supportedDialogKinds ?? []
  return !kinds.includes(REFUSAL_FALLBACK_DIALOG_KIND)
}

/**
 * Official x_i — choice labels for refusal_fallback_prompt options.
 */
export function buildRefusalFallbackChoiceLabels(
  originalModelDisplay: string,
  fallbackModelDisplay: string,
): { retry_fallback: string; edit_prompt: string } {
  return {
    retry_fallback: `Switch to ${fallbackModelDisplay}`,
    edit_prompt: `Edit prompt and retry with ${originalModelDisplay}`,
  }
}

/**
 * Official NXl — return bridge dialog adapter only when it supports
 * refusal_fallback_prompt and gate() is true.
 */
export function selectRefusalBridgeDialogAdapter<
  T extends { supportsKind: (kind: string) => boolean },
>(adapter: T | undefined | null, gate: () => boolean): T | undefined {
  if (adapter === undefined || adapter === null) return undefined
  if (!adapter.supportsKind(REFUSAL_FALLBACK_DIALOG_KIND)) return undefined
  if (!gate()) return undefined
  return adapter
}

/**
 * Official MXl — provider guidance when not first-party Anthropic.
 * Returns undefined for first-party so the dialog omits the env-hint text.
 */
export function getProviderRefusalFallbackGuidanceText(
  isFirstPartyProvider: boolean,
): string | undefined {
  if (isFirstPartyProvider) return undefined
  return 'To enable automatic fallback on this provider, set `ANTHROPIC_DEFAULT_FABLE_MODEL` to your Fable 5 model ID and `ANTHROPIC_DEFAULT_OPUS_MODEL` to your Opus 4.8 model ID.'
}

/** Official payload builder for refusal_fallback_prompt (ZW.payload). */
export function buildRefusalFallbackDialogPayload(input: {
  originalModel: string
  fallbackModel: string
  apiRefusalCategory?: string | null
  retractedMessageUuids?: readonly string[]
  guidanceText?: string
}): {
  originalModel: string
  fallbackModel: string
  apiRefusalCategory?: string | null
  guidanceText?: string
  retractedMessageUuids?: string[]
} {
  return {
    originalModel: input.originalModel,
    fallbackModel: input.fallbackModel,
    ...(input.apiRefusalCategory !== undefined && {
      apiRefusalCategory: input.apiRefusalCategory,
    }),
    ...(input.guidanceText !== undefined && {
      guidanceText: input.guidanceText,
    }),
    ...(input.retractedMessageUuids !== undefined && {
      retractedMessageUuids: [...input.retractedMessageUuids],
    }),
  }
}

/**
 * Official Gi default before FXl — when suppress is no_consumer_capability,
 * treat as cancelled (do not auto-switch); otherwise default retry_fallback
 * (auto-switch when dialog is suppressed for other reasons / silent paths).
 */
export function resolveInitialRefusalFallbackChoice(
  suppressReason: RefusalDialogSuppressReason | undefined,
): RefusalFallbackResult {
  if (suppressReason === 'no_consumer_capability') return 'cancelled'
  return 'retry_fallback'
}

/**
 * Whether FXl should be invoked: suppress undefined AND requestDialog present.
 */
export function shouldInvokeRefusalFallbackDialog(
  suppressReason: RefusalDialogSuppressReason | undefined,
  requestDialog: unknown,
): boolean {
  return suppressReason === undefined && requestDialog !== undefined
}

export type ShowRefusalFallbackDialogInput = {
  requestDialog: (
    spec: {
      kind: string
      default: RefusalFallbackResult
      result?: () => {
        safeParse: (v: unknown) => { success: boolean; data?: unknown }
      }
    },
    payload: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>
  signal?: AbortSignal
  payload: {
    originalModel: string
    fallbackModel: string
    apiRefusalCategory?: string | null
    guidanceText?: string
    retractedMessageUuids?: readonly string[]
  }
  /**
   * Official bridgeDialog + hasQueuedPrompts: when both present and queue
   * non-empty, cancel with queued_at_park without showing.
   */
  bridgeDialog?: unknown
  hasQueuedPrompts?: () => boolean
  /**
   * Optional bridge path densable: when bridgeDialog set and queue empty,
   * callers may still use requestDialog locally (full tJl bridge denser).
   */
}

/**
 * Official FXl densable — show refusal_fallback_prompt via requestDialog.
 * When bridgeDialog is set and queue empty, still uses local requestDialog.
 */
export async function showRefusalFallbackDialog(
  input: ShowRefusalFallbackDialogInput,
): Promise<RefusalFallbackResult> {
  if (input.bridgeDialog && input.hasQueuedPrompts?.()) {
    return 'cancelled'
  }
  const payload = buildRefusalFallbackDialogPayload(input.payload)
  const result = await input.requestDialog(
    {
      kind: refusalFallbackDialogSpec.kind,
      default: refusalFallbackDialogSpec.default,
      result: () => ({
        safeParse: (v: unknown) => {
          const parsed = refusalFallbackDialogSpec.parseResult?.(v)
          if (parsed?.success) return { success: true, data: parsed.data }
          return { success: false }
        },
      }),
    },
    payload,
    { signal: input.signal },
  )
  if (
    result === 'retry_fallback' ||
    result === 'edit_prompt' ||
    result === 'cancelled'
  ) {
    return result
  }
  return 'cancelled'
}

/** Spec constant for requestDialog(ZW, ...) call sites. */
export const REFUSAL_FALLBACK_REQUEST_DIALOG_SPEC = {
  kind: REFUSAL_FALLBACK_DIALOG_KIND,
  default: 'cancelled' as const satisfies RefusalFallbackResult,
}

export type RefusalFallbackDialogFlowResult = {
  choice: RefusalFallbackResult
  suppressReason: RefusalDialogSuppressReason | undefined
  /** True when FXl was actually invoked. */
  dialogShown: boolean
  /**
   * Official: when choice is retry_fallback, callers switch model;
   * edit_prompt / cancelled leave model alone.
   */
  shouldSwitchToFallback: boolean
}

/**
 * Official refusal dialog decision + FXl densable consumer.
 * requestDialog-armed decision path; query/withRetry apply latch after accept.
 */
export async function runRefusalFallbackDialogFlow(input: {
  decision: RefusalDialogDecisionInput
  requestDialog?: ShowRefusalFallbackDialogInput['requestDialog']
  signal?: AbortSignal
  payload: ShowRefusalFallbackDialogInput['payload']
  bridgeDialog?: unknown
  hasQueuedPrompts?: () => boolean
}): Promise<RefusalFallbackDialogFlowResult> {
  const decision = {
    ...input.decision,
    requestDialog: input.decision.requestDialog ?? input.requestDialog,
  }
  const suppressReason = resolveRefusalDialogSuppressReason(decision)
  const requestDialog = input.requestDialog
  if (!shouldInvokeRefusalFallbackDialog(suppressReason, requestDialog)) {
    const choice = resolveInitialRefusalFallbackChoice(suppressReason)
    return {
      choice,
      suppressReason,
      dialogShown: false,
      shouldSwitchToFallback: choice === 'retry_fallback',
    }
  }
  const choice = await showRefusalFallbackDialog({
    requestDialog: requestDialog!,
    signal: input.signal,
    payload: input.payload,
    bridgeDialog: input.bridgeDialog,
    hasQueuedPrompts: input.hasQueuedPrompts,
  })
  return {
    choice,
    suppressReason: undefined,
    dialogShown: true,
    shouldSwitchToFallback: choice === 'retry_fallback',
  }
}

/**
 * Official latch apply densable — after dialog accept (retry_fallback), arm
 * bootstrap latch + main-loop model override. Injectable for tests.
 */
export function applyRefusalFallbackLatchArm(input: {
  fallbackModel: string
  previousOverride?: string | null
  previousAppStateModel?: string | null
  previousModelForSession?: string | null
  setLatch?: (arm: ReturnType<typeof buildRefusalFallbackLatchArm>) => void
  setMainLoopModelOverride?: (model: string | undefined) => void
  markOccurred?: () => void
}): ReturnType<typeof buildRefusalFallbackLatchArm> {
  const arm = buildRefusalFallbackLatchArm({
    fallbackModel: input.fallbackModel,
    previousOverride: input.previousOverride,
    previousAppStateModel: input.previousAppStateModel,
    previousModelForSession: input.previousModelForSession,
  })
  try {
    if (input.setLatch) {
      input.setLatch(arm)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const state = require('../bootstrap/state.js') as {
        setRefusalFallbackModelLatch?: (v: unknown) => void
      }
      state.setRefusalFallbackModelLatch?.(arm)
    }
    if (input.setMainLoopModelOverride) {
      input.setMainLoopModelOverride(arm.fallbackModel)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const state = require('../bootstrap/state.js') as {
        setMainLoopModelOverride?: (v: string | undefined) => void
      }
      state.setMainLoopModelOverride?.(arm.fallbackModel)
    }
    input.markOccurred?.()
  } catch {
    // best-effort densable apply
  }
  return arm
}

/**
 * Official session-switch latch consume densable — restore previous override
 * when still on latched fallback. Injectable for tests.
 */
export function applyRefusalFallbackLatchRestore(input: {
  latch?: Parameters<typeof resolveRefusalFallbackLatchRestore>[0]['latch']
  currentOverride?: string
  getLatch?: () =>
    | Parameters<typeof resolveRefusalFallbackLatchRestore>[0]['latch']
    | undefined
  getCurrentOverride?: () => string | undefined
  clearLatch?: () => void
  setMainLoopModelOverride?: (model: string | undefined) => void
}): ReturnType<typeof resolveRefusalFallbackLatchRestore> {
  let latch = input.latch
  let current = input.currentOverride
  try {
    if (latch === undefined && input.getLatch) latch = input.getLatch()
    if (latch === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const state = require('../bootstrap/state.js') as {
        getRefusalFallbackModelLatch?: () =>
          | Parameters<typeof resolveRefusalFallbackLatchRestore>[0]['latch']
          | undefined
      }
      latch = state.getRefusalFallbackModelLatch?.()
    }
    if (current === undefined && input.getCurrentOverride) {
      current = input.getCurrentOverride()
    }
    if (current === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const state = require('../bootstrap/state.js') as {
        getMainLoopModelOverride?: () => string | undefined
      }
      current = state.getMainLoopModelOverride?.()
    }
  } catch {
    // ignore
  }
  const restored = resolveRefusalFallbackLatchRestore({
    latch,
    currentOverride: current,
  })
  if (!restored) return undefined
  try {
    if (input.setMainLoopModelOverride) {
      input.setMainLoopModelOverride(restored.restoredOverride)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const state = require('../bootstrap/state.js') as {
        setMainLoopModelOverride?: (v: string | undefined) => void
      }
      state.setMainLoopModelOverride?.(restored.restoredOverride)
    }
    if (input.clearLatch) {
      input.clearLatch()
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const state = require('../bootstrap/state.js') as {
        setRefusalFallbackModelLatch?: (v: null) => void
      }
      state.setRefusalFallbackModelLatch?.(null)
    }
  } catch {
    // best-effort
  }
  return restored
}

// ---------------------------------------------------------------------------
// Silent-arm densables (official m1u / w_i / g_i / PJe / fallback_request)
// ---------------------------------------------------------------------------

/** Official rbt — cyber/bio categories that get the long safeguards copy. */
export function isCyberOrBioRefusalCategory(
  category: string | null | undefined,
): boolean {
  return category === 'cyber' || category === 'bio'
}

/** Official h_i — frontier_llm / reasoning_extraction keep their names. */
export function isFrontierOrReasoningRefusalCategory(
  category: string | null | undefined,
): boolean {
  return category === 'frontier_llm' || category === 'reasoning_extraction'
}

/**
 * Official PJe — normalize api refusal category for telemetry/route.
 * Known categories pass through; everything else becomes "other".
 */
export function normalizeApiRefusalCategory(
  category: string | null | undefined,
): string | undefined {
  if (category == null) return undefined
  if (
    isCyberOrBioRefusalCategory(category) ||
    isFrontierOrReasoningRefusalCategory(category)
  ) {
    return category
  }
  return 'other'
}

/**
 * Official Geh default routes (m_i permanently false in 2.1.207 → Veh unused).
 * Route target is the canonical opus-4-8 id; Yeh only resolves when target is
 * exactly that id, returning the armed fallback model string.
 */
export const REFUSAL_FALLBACK_CATEGORY_ROUTES_DEFAULT: Readonly<
  Record<string, string>
> = Object.freeze({ cyber: 'claude-opus-4-8' })

/** Official Veh EAP routes (m_i false → unused unless routesOverride). */
export const REFUSAL_FALLBACK_CATEGORY_ROUTES_EAP: Readonly<
  Record<string, string>
> = Object.freeze({
  bio: 'claude-opus-4-8',
  cyber: 'claude-opus-4-8',
})

/** Official Yeh — only claude-opus-4-8 route targets resolve to armed model. */
export function resolveRefusalRouteTarget(
  routeTarget: string,
  armedFallbackModel: string,
): string | undefined {
  return routeTarget === 'claude-opus-4-8' ? armedFallbackModel : undefined
}

export type RefusalRouteMatch =
  | { matched: 'category'; model: string }
  | { matched: 'catch_all'; model: string }
  | {
      matched: 'none'
      model: undefined
      reason: 'mapped_target_unresolvable' | 'unmapped'
    }

/**
 * Official g_i — match apiRefusalCategory against routes, else catch-all.
 */
export function matchRefusalFallbackRoute(input: {
  originalModelCanonical: string
  armedFallbackModel: string
  apiRefusalCategory?: string | null
  routesOverride?: Readonly<Record<string, string>>
  /** Official m_i — permanently false in 2.1.207; injectable for densable. */
  isEapModel?: (canonical: string) => boolean
  resolveRouteTarget?: (
    routeTarget: string,
    armedFallbackModel: string,
  ) => string | undefined
  catchAllEnabled?: boolean
}): RefusalRouteMatch {
  const isEap = input.isEapModel?.(input.originalModelCanonical) === true
  const routes =
    input.routesOverride ??
    (isEap
      ? REFUSAL_FALLBACK_CATEGORY_ROUTES_EAP
      : REFUSAL_FALLBACK_CATEGORY_ROUTES_DEFAULT)
  const resolve = input.resolveRouteTarget ?? resolveRefusalRouteTarget
  const category = input.apiRefusalCategory
  const routeTarget =
    category != null && Object.hasOwn(routes, category)
      ? routes[category]
      : undefined
  if (routeTarget !== undefined) {
    const resolved = resolve(routeTarget, input.armedFallbackModel)
    if (resolved !== undefined) {
      return { matched: 'category', model: resolved }
    }
    return {
      matched: 'none',
      model: undefined,
      reason: 'mapped_target_unresolvable',
    }
  }
  const catchAll = input.catchAllEnabled ?? isRefusalFallbackCatchAllEnabled()
  if (catchAll) {
    return { matched: 'catch_all', model: input.armedFallbackModel }
  }
  return { matched: 'none', model: undefined, reason: 'unmapped' }
}

export type RefusalFallbackServerLane = {
  forModel: string
  model: string
}

export type RefusalFallbackArmPlan = {
  /** Official visibleModel — client-side armed fallback when not stuck. */
  visibleModel: string | undefined
  /**
   * Official serverLane — when switchModelsOnFlag + lane gate + sticky free,
   * server applies fallback; visibleModel still set but query prefers lane.
   */
  serverLane: RefusalFallbackServerLane | undefined
  /** Official shouldLogSuppression — log tengu_refusal_fallback_suppressed. */
  shouldLogSuppression: boolean
}

/**
 * Official m1u — plan visible / server-lane arm for the current query model.
 * resolveArmedFallbackModel is EXl densable injectable (caller supplies).
 */
export function planRefusalFallbackArm(input: {
  currentModel: string
  alreadyUsed?: boolean
  declined?: boolean
  suppressionAlreadyLogged?: boolean
  requestDialog?: unknown
  isMainThread?: boolean
  consumerLacksDialogCapability?: boolean
  /**
   * Official $c("switchModelsOnFlag", true).value — default true means LXl
   * stuck is false unless explicitly disabled.
   */
  switchModelsOnFlag?: boolean
  /** Official pht(sticky, B5) — server-lane sticky already rejected. */
  stickyRejectedServerLane?: boolean
  /**
   * Official EXl — resolve the armed fallback model for currentModel.
   * When omitted, no model is armed (visible/server both undefined).
   */
  resolveArmedFallbackModel?: (currentModel: string) => string | undefined
  refusalFallbackEnabled?: boolean
  /**
   * Official SXl — Bie && switchModelsOnFlag && Rpe().
   * When true and sticky free, serverLane is populated.
   */
  serverLaneEnabled?: boolean
}): RefusalFallbackArmPlan {
  const enabled = input.refusalFallbackEnabled ?? isRefusalFallbackEnabled()
  // Official LXl: isMainThread && (no host || no cap) && setting === false.
  const stuck = isRefusalFallbackStuckWithoutDialog({
    requestDialog: input.requestDialog,
    isMainThread: input.isMainThread,
    consumerLacksDialogCapability: input.consumerLacksDialogCapability,
    switchModelsOnFlag: input.switchModelsOnFlag ?? true,
  })
  const resolvedArmed = input.resolveArmedFallbackModel?.(input.currentModel)
  // Official: o = !alreadyUsed && !declined && Bie && !LXl ? EXl : void 0
  const visibleModel =
    !input.alreadyUsed && !input.declined && enabled && !stuck
      ? resolvedArmed
      : undefined
  // Official: i = o !== void 0 && SXl() && !pht(sticky,B5) ? {forModel,model:o}
  const serverLane =
    visibleModel !== undefined &&
    input.serverLaneEnabled === true &&
    input.stickyRejectedServerLane !== true
      ? { forModel: input.currentModel, model: visibleModel }
      : undefined
  // Official: !suppressionAlreadyLogged && Bie && LXl && EXl !== void 0
  const shouldLogSuppression =
    !input.suppressionAlreadyLogged &&
    enabled &&
    stuck &&
    resolvedArmed !== undefined

  return {
    visibleModel,
    serverLane,
    shouldLogSuppression,
  }
}

/**
 * Official w_i — silent rearm model when current is NOT visibly armable
 * (__i false) but silent-rearm gate is on and model strips to default opus.
 */
export function resolveSilentRearmModel(input: {
  currentModel: string
  /** Official __i — when true, silent rearm is not used. */
  isVisiblyArmable?: boolean
  /** Official C_i — GrowthBook/gate for silent rearm. */
  silentRearmGateEnabled?: boolean
  /** Official db() — default opus model string. */
  defaultOpusModel?: string
  /** Official Kp — strip [1m]/[2m] modifiers for comparison. */
  stripModelModifiers?: (model: string) => string
}): string | undefined {
  if (input.isVisiblyArmable) return undefined
  if (!input.silentRearmGateEnabled) return undefined
  const strip =
    input.stripModelModifiers ?? ((m: string) => m.replace(/\[(1|2)m\]/gi, ''))
  const defaultOpus = input.defaultOpusModel
  if (defaultOpus === undefined) return undefined
  if (strip(input.currentModel) !== strip(defaultOpus)) return undefined
  return input.currentModel
}

export type RefusalFallbackModelLane = 'visible' | 'silent'

/**
 * Official query options densable for refusalFallbackModel / Lane / silentArm.
 * When serverLane is set, visible is deferred (Ks = la===void 0 ? visible : void 0).
 */
export function resolveRefusalFallbackModelAndLane(input: {
  declined?: boolean
  visibleModel?: string
  silentRearmModel?: string
  serverLane?: RefusalFallbackServerLane
}): {
  refusalFallbackModel: string | undefined
  refusalFallbackModelLane: RefusalFallbackModelLane | undefined
  /** Official pi — silent arm active when rearm set and no visible/server/credit. */
  refusalFallbackSilentArmActive: boolean
  serverRefusalFallback: RefusalFallbackServerLane | undefined
} {
  if (input.declined) {
    return {
      refusalFallbackModel: undefined,
      refusalFallbackModelLane: undefined,
      refusalFallbackSilentArmActive: false,
      serverRefusalFallback: undefined,
    }
  }
  const server = input.serverLane
  const visible = server === undefined ? input.visibleModel : undefined
  const silent = input.silentRearmModel
  const model = visible ?? silent
  const lane: RefusalFallbackModelLane | undefined =
    visible !== undefined
      ? 'visible'
      : silent !== undefined
        ? 'silent'
        : undefined
  const silentArmActive =
    silent !== undefined && visible === undefined && server === undefined
  return {
    refusalFallbackModel: model,
    refusalFallbackModelLane: lane,
    refusalFallbackSilentArmActive: silentArmActive,
    serverRefusalFallback: server,
  }
}

export type FallbackRequestEvent = {
  type: 'fallback_request'
  trigger: 'refusal'
  originalModel: string
  fallbackModel: string
  requestId: string | null
  apiRefusalCategory: string | null
  apiRefusalExplanation: string | null
  creditCode: string | null
  silentArmAtTrigger?: boolean
  routeMatched: 'category' | 'catch_all' | null
}

/**
 * Official stream fallback_request densable (yield shape before query
 * consumer parks dialog / throws FallbackTriggeredError).
 */
export function buildFallbackRequestEvent(input: {
  originalModel: string
  fallbackModel: string
  requestId?: string | null
  apiRefusalCategory?: string | null
  apiRefusalExplanation?: string | null
  creditCode?: string | null
  silentArmAtTrigger?: boolean
  routeMatched?: 'category' | 'catch_all' | 'none' | null
}): FallbackRequestEvent {
  const route =
    input.routeMatched === 'category' || input.routeMatched === 'catch_all'
      ? input.routeMatched
      : null
  return {
    type: 'fallback_request',
    trigger: 'refusal',
    originalModel: input.originalModel,
    fallbackModel: input.fallbackModel,
    requestId: input.requestId ?? null,
    apiRefusalCategory: input.apiRefusalCategory ?? null,
    apiRefusalExplanation: input.apiRefusalExplanation ?? null,
    creditCode: input.creditCode ?? null,
    ...(input.silentArmAtTrigger === true && { silentArmAtTrigger: true }),
    routeMatched: route,
  }
}

/**
 * Resolve the stream-path fallback target: apply g_i category route when
 * category present, else use armed model (catch-all / unmapped handled by
 * matchRefusalFallbackRoute).
 */
export function resolveStreamRefusalFallbackTarget(input: {
  originalModel: string
  armedFallbackModel: string | undefined
  apiRefusalCategory?: string | null
  catchAllEnabled?: boolean
  isEapModel?: (canonical: string) => boolean
}): {
  fallbackModel: string | undefined
  route: RefusalRouteMatch | undefined
} {
  if (input.armedFallbackModel === undefined) {
    return { fallbackModel: undefined, route: undefined }
  }
  const route = matchRefusalFallbackRoute({
    originalModelCanonical: input.originalModel,
    armedFallbackModel: input.armedFallbackModel,
    apiRefusalCategory: input.apiRefusalCategory,
    catchAllEnabled: input.catchAllEnabled,
    isEapModel: input.isEapModel,
  })
  return {
    fallbackModel: route.model,
    route,
  }
}

/**
 * Official silentAttempt for OXl: true when silent rearm is active or the
 * fallback_request was armed at trigger (silentArmAtTrigger).
 */
export function resolveRefusalSilentAttempt(input: {
  silentArmActive?: boolean
  silentArmAtTrigger?: boolean
  modelLane?: RefusalFallbackModelLane
}): boolean {
  return (
    input.silentArmActive === true ||
    input.silentArmAtTrigger === true ||
    input.modelLane === 'silent'
  )
}

/**
 * Official latch arm densable payload after user accepts refusal fallback.
 * Callers apply via bootstrap setRefusalFallbackModelLatch + markOccurred +
 * setMainLoopModelOverride(fallbackModel). Full AppState BMg denser.
 */
export function buildRefusalFallbackLatchArm(input: {
  fallbackModel: string
  previousOverride: string | undefined | null
  previousAppStateModel?: string | undefined | null
  previousModelForSession?: string | undefined | null
}): {
  fallbackModel: string
  previousOverride: string | undefined
  previousAppStateModel?: string | undefined
  previousModelForSession?: string | undefined
} {
  return {
    fallbackModel: input.fallbackModel,
    previousOverride: input.previousOverride ?? undefined,
    ...(input.previousAppStateModel !== undefined &&
    input.previousAppStateModel !== null
      ? { previousAppStateModel: input.previousAppStateModel }
      : {}),
    ...(input.previousModelForSession !== undefined &&
    input.previousModelForSession !== null
      ? { previousModelForSession: input.previousModelForSession }
      : {}),
  }
}

/**
 * Official session-switch latch consume densable (JUa pure).
 * When currentOverride still equals latched fallback, restore previous.
 */
export function resolveRefusalFallbackLatchRestore(input: {
  latch:
    | {
        fallbackModel: string
        previousOverride: string | undefined
        previousAppStateModel?: string | undefined
        previousModelForSession?: string | undefined
      }
    | undefined
  currentOverride: string | undefined
}):
  | {
      restoredOverride: string | undefined
      restoredToExplicitOverride: boolean
      appStateModel: string | undefined
      forSessionValue: string | undefined
      fallbackModel: string
    }
  | undefined {
  const latch = input.latch
  if (!latch || input.currentOverride !== latch.fallbackModel) return undefined
  return {
    restoredOverride: latch.previousOverride,
    restoredToExplicitOverride: latch.previousOverride !== undefined,
    appStateModel: latch.previousAppStateModel,
    forSessionValue: latch.previousModelForSession,
    fallbackModel: latch.fallbackModel,
  }
}

/**
 * Official BMg densable — plan AppState model rebinding after latch arm/consume.
 * Caller applies via setAppState + setMainLoopModelOverride(overrideValue).
 */
export function planRefusalFallbackAppStateRebind(input: {
  /** Target mainLoopModel for AppState (arm: fallback; restore: previousAppState). */
  appStateModel: string | null | undefined
  /** Target mainLoopModelForSession (arm: null; restore: previousModelForSession). */
  forSessionValue?: string | null | undefined
  /** Override to apply via setMainLoopModelOverride (arm: fallback; restore: previous). */
  overrideValue?: string | null | undefined
  currentMainLoopModel?: string | null | undefined
  currentMainLoopModelForSession?: string | null | undefined
  fastMode?: boolean
  /** Official ty(model) — when false and fastMode, disable fast mode. */
  isFastModeSupportedForModel?: (model: string | undefined) => boolean
}): {
  mainLoopModel: string | null | undefined
  mainLoopModelForSession: string | null | undefined
  overrideValue: string | null | undefined
  disableFastMode: boolean
  changed: boolean
} {
  const nextModel = input.appStateModel
  const nextSession = input.forSessionValue ?? null
  const resolvedForFast =
    input.overrideValue ?? input.forSessionValue ?? input.appStateModel
  const fastSupported =
    input.isFastModeSupportedForModel?.(
      resolvedForFast === null || resolvedForFast === undefined
        ? undefined
        : String(resolvedForFast),
    ) ?? true
  const disableFastMode = input.fastMode === true && fastSupported === false
  const changed =
    input.currentMainLoopModel !== nextModel ||
    input.currentMainLoopModelForSession !== nextSession ||
    disableFastMode
  return {
    mainLoopModel: nextModel,
    mainLoopModelForSession: nextSession,
    overrideValue: input.overrideValue,
    disableFastMode,
    changed,
  }
}

/**
 * Official BMg consumer densable — apply plan via setAppState + override setter.
 */
export function applyRefusalFallbackAppStateRebind(input: {
  plan: ReturnType<typeof planRefusalFallbackAppStateRebind>
  setAppState?: (
    f: (prev: {
      mainLoopModel?: string | null
      mainLoopModelForSession?: string | null
      fastMode?: boolean
      [k: string]: unknown
    }) => {
      mainLoopModel?: string | null
      mainLoopModelForSession?: string | null
      fastMode?: boolean
      [k: string]: unknown
    },
  ) => void
  setMainLoopModelOverride?: (model: string | undefined) => void
}): boolean {
  if (!input.plan.changed && input.setAppState === undefined) {
    input.setMainLoopModelOverride?.(
      input.plan.overrideValue === null
        ? undefined
        : (input.plan.overrideValue ?? undefined),
    )
    return false
  }
  if (input.setAppState) {
    const plan = input.plan
    input.setAppState(prev => {
      if (
        prev.mainLoopModel === plan.mainLoopModel &&
        prev.mainLoopModelForSession === plan.mainLoopModelForSession &&
        !(plan.disableFastMode && prev.fastMode)
      ) {
        return prev
      }
      return {
        ...prev,
        mainLoopModel: plan.mainLoopModel as typeof prev.mainLoopModel,
        mainLoopModelForSession:
          plan.mainLoopModelForSession as typeof prev.mainLoopModelForSession,
        ...(plan.disableFastMode ? { fastMode: false } : {}),
      }
    })
  }
  input.setMainLoopModelOverride?.(
    input.plan.overrideValue === null
      ? undefined
      : (input.plan.overrideValue ?? undefined),
  )
  return true
}

/**
 * Official ues — extract fallback_credit_token from stream/event payload.
 * Token must be non-empty string ≤ 2048 chars.
 */
export function extractFallbackCreditToken(
  payload: unknown,
): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const token = (payload as { fallback_credit_token?: unknown })
    .fallback_credit_token
  return typeof token === 'string' && token.length > 0 && token.length <= 2048
    ? token
    : undefined
}

/**
 * Official Lto — extract model string from opaque object payloads.
 */
export function extractModelFieldFromPayload(
  payload: unknown,
): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const model = (payload as { model?: unknown }).model
  return typeof model === 'string' && model.length > 0 ? model : undefined
}

/**
 * Official des densable — fallback_message shaped object for stream stitch.
 */
export function buildServerFallbackMessageShape(input: {
  fromModel: string
  model: string
}): {
  type: 'fallback'
  from: { model: string }
  to: { model: string }
} {
  return {
    type: 'fallback',
    from: { model: input.fromModel },
    to: { model: input.model },
  }
}

/**
 * Official d1u densable — parse stop_details-like refusal object.
 */
export function parseApiRefusalStopDetails(payload: unknown): {
  type: 'refusal'
  category: string | null
  explanation: string | null
} | null {
  if (typeof payload !== 'object' || payload === null) return null
  const t = payload as {
    type?: unknown
    category?: unknown
    explanation?: unknown
  }
  if (t.type !== 'refusal') return null
  return {
    type: 'refusal',
    category: typeof t.category === 'string' ? t.category : null,
    explanation: typeof t.explanation === 'string' ? t.explanation : null,
  }
}

/** Official nth — minimum salvageable partial text length. */
export const REFUSAL_SALVAGE_MIN_CHARS = 24

/**
 * Official oth densable — trim trailing incomplete sentence fragment.
 * If text does not end with sentence punctuation, cut back to last
 * whitespace within the final 48 chars.
 */
export function trimIncompleteRefusalSalvageText(text: string): string {
  let t = text
  if (t.length > 0 && !/[.!?\u2026\u3002\uFF01\uFF1F'")\]]$/.test(t)) {
    const windowStart = Math.max(0, t.length - 48)
    const cut = Math.max(
      t.lastIndexOf(' '),
      t.lastIndexOf('\n'),
      t.lastIndexOf('\t'),
    )
    if (cut > 0 && cut >= windowStart) {
      t = t.slice(0, cut).trimEnd()
    }
  }
  return t.trimEnd()
}

export type RefusalPartialSalvageResult = {
  partialTextChars: number
  toolUseCount: number
  hadEmptyInputToolUse: boolean
  salvageText?: string
  skipReason?: 'no_text' | 'too_short' | 'mid_tool_input'
}

/**
 * Official IXl densable — decide whether mid-stream partial assistant text
 * is salvageable when a refusal/fallback rewinds the turn.
 *
 * messages: assistant-like objects with message.content array of blocks.
 */
export function salvageRefusalPartialText(input: {
  messages: readonly {
    isApiErrorMessage?: boolean
    message?: { content?: unknown }
  }[]
  minChars?: number
  isEmptyToolInput?: (input: unknown) => boolean
}): RefusalPartialSalvageResult {
  const minChars = input.minChars ?? REFUSAL_SALVAGE_MIN_CHARS
  const isEmpty =
    input.isEmptyToolInput ??
    ((v: unknown) =>
      (typeof v === 'object' &&
        v !== null &&
        Object.keys(v as object).length === 0) ||
      v === undefined ||
      v === null ||
      v === '')

  const blocks = input.messages.flatMap(m => {
    if (m.isApiErrorMessage) return []
    const content = m.message?.content
    return Array.isArray(content) ? content : []
  }) as Array<{ type?: string; text?: string; input?: unknown }>

  const joined = blocks
    .flatMap(b =>
      b.type === 'text' && typeof b.text === 'string' ? [b.text] : [],
    )
    .join('\n')
    .trim()
  const text = trimIncompleteRefusalSalvageText(joined)
  const toolInputs = blocks.flatMap(b =>
    b.type === 'tool_use' ? [b.input] : [],
  )
  const hadEmptyInputToolUse = toolInputs.some(isEmpty)
  const base = {
    partialTextChars: text.length,
    toolUseCount: toolInputs.length,
    hadEmptyInputToolUse,
  }
  if (text.length === 0) return { ...base, skipReason: 'no_text' }
  if (text.length < minChars) return { ...base, skipReason: 'too_short' }
  if (hadEmptyInputToolUse) return { ...base, skipReason: 'mid_tool_input' }
  return { ...base, salvageText: text }
}

/** Official Mto — reason is user-visible for refusal or sticky. */
export function isUserVisibleRefusalFallbackReason(
  reason: string | undefined,
): boolean {
  return reason === 'refusal' || reason === 'sticky'
}

/** Official jLg — telemetry reason bucket. */
export function normalizeRefusalFallbackTelemetryReason(
  reason: string | undefined,
): 'refusal' | 'sticky' | 'other' {
  if (reason === 'refusal' || reason === 'sticky') return reason
  return 'other'
}

/**
 * Official h1u densable — plan post-fallback UI/telemetry flags.
 */
export function planRefusalFallbackPresentation(input: {
  reason: string
  midStream: boolean
  discardedMessages: readonly {
    message?: { content?: readonly { type?: string }[] }
  }[]
  requestId?: string | null
  fromModel: string
  finalStopReason?: string | null
  apiRefusalCategory?: string | null
  isMainThread?: boolean
  originalModelScope?: string
}): {
  telemetry: {
    reason: 'refusal' | 'sticky' | 'other'
    midStream: boolean
    discardedBlockCount: number
    tombstonedHadToolUse: boolean
    requestId?: string | null
    originalModelScope?: string
    finalStopReason?: string | null
    apiRefusalCategory?: string
  }
  userVisible: boolean
  tombstonedToolUse: boolean
  swapSession: boolean
  showBanner: boolean
} {
  const tombstonedHadToolUse = input.discardedMessages.some(m =>
    (m.message?.content ?? []).some(b => b.type === 'tool_use'),
  )
  const userVisible = isUserVisibleRefusalFallbackReason(input.reason)
  const swapSession = userVisible && input.isMainThread === true
  return {
    telemetry: {
      reason: normalizeRefusalFallbackTelemetryReason(input.reason),
      midStream: input.midStream,
      discardedBlockCount: input.discardedMessages.length,
      tombstonedHadToolUse,
      requestId: input.requestId,
      originalModelScope: input.originalModelScope,
      finalStopReason: input.finalStopReason,
      ...(input.apiRefusalCategory != null
        ? {
            apiRefusalCategory: normalizeApiRefusalCategory(
              input.apiRefusalCategory,
            ),
          }
        : {}),
    },
    userVisible,
    tombstonedToolUse: tombstonedHadToolUse,
    swapSession,
    showBanner: swapSession,
  }
}

/**
 * Official g1u densable — system model_refusal_fallback banner payload.
 * Content strings (V1n/RXl) remain denser; content is caller-supplied.
 */
export function buildModelRefusalFallbackSystemMessage(input: {
  content: string
  fromModel: string
  toModel: string
  requestId?: string | null
  apiRefusalCategory?: string | null
  timestamp: string
  uuid: string
  reason?: 'refusal' | 'sticky' | string
}): {
  type: 'system'
  subtype: 'model_refusal_fallback'
  direction: 'retry'
  content: string
  level: 'warning'
  trigger: 'refusal'
  originalModel: string
  fallbackModel: string
  requestId: string | null | undefined
  apiRefusalCategory: string | null | undefined
  apiRefusalExplanation: null
  isMeta: false
  timestamp: string
  uuid: string
} {
  return {
    type: 'system',
    subtype: 'model_refusal_fallback',
    direction: 'retry',
    content: input.content,
    level: 'warning',
    trigger: 'refusal',
    originalModel: input.fromModel,
    fallbackModel: input.toModel,
    requestId: input.requestId,
    apiRefusalCategory: input.apiRefusalCategory,
    apiRefusalExplanation: null,
    isMeta: false,
    timestamp: input.timestamp,
    uuid: input.uuid,
  }
}
