import { setMaxListeners } from 'events'

/**
 * Default max listeners for standard operations
 */
const DEFAULT_MAX_LISTENERS = 50

/**
 * Creates an AbortController with proper event listener limits set.
 * This prevents MaxListenersExceededWarning when multiple listeners
 * are attached to the abort signal.
 *
 * @param maxListeners - Maximum number of listeners (default: 50)
 * @returns AbortController with configured listener limit
 */
export function createAbortController(
  maxListeners: number = DEFAULT_MAX_LISTENERS,
): AbortController {
  const controller = new AbortController()
  setMaxListeners(maxListeners, controller.signal)
  return controller
}

/**
 * Propagates abort from a parent to a weakly-referenced child controller.
 * Both parent and child are weakly held — neither direction creates a
 * strong reference that could prevent GC.
 * Module-scope function avoids per-call closure allocation.
 */
function propagateAbort(
  this: WeakRef<AbortController>,
  weakChild: WeakRef<AbortController>,
): void {
  const parent = this.deref()
  weakChild.deref()?.abort(parent?.signal.reason)
}

/**
 * Removes an abort handler from a weakly-referenced parent signal.
 * Both parent and handler are weakly held — if either has been GC'd
 * or the parent already aborted ({once: true}), this is a no-op.
 * Module-scope function avoids per-call closure allocation.
 */
function removeAbortHandler(
  this: WeakRef<AbortController>,
  weakHandler: WeakRef<(...args: unknown[]) => void>,
): void {
  const parent = this.deref()
  const handler = weakHandler.deref()
  if (parent && handler) {
    parent.signal.removeEventListener('abort', handler)
  }
}

/**
 * Creates a child AbortController that aborts when its parent aborts.
 * Aborting the child does NOT affect the parent.
 *
 * Memory-safe: Uses WeakRef so the parent doesn't retain abandoned children.
 * If the child is dropped without being aborted, it can still be GC'd.
 * When the child IS aborted, the parent listener is removed to prevent
 * accumulation of dead handlers.
 *
 * @param parent - The parent AbortController
 * @param maxListeners - Maximum number of listeners (default: 50)
 * @returns Child AbortController
 */
/**
 * densable RT — normalize AbortSignal.reason for classification.
 * DOMException AbortError uses `.message` as the reason string.
 */
export function normalizeAbortReason(reason: unknown): unknown {
  if (reason instanceof DOMException && reason.name === 'AbortError') {
    return reason.message
  }
  return reason
}

/**
 * densable TVt — map abort reason → analytics abortKind for
 * tengu_tool_use_cancelled / compact failure telemetry.
 *
 * Known densable reasons: user-cancel, remote-cancel, interrupt, background,
 * recovery-timeout, server-fallback-tombstone; all other → turn_teardown.
 */
export function classifyAbortKindForAnalytics(reason: unknown): string {
  const normalized = normalizeAbortReason(reason)
  switch (normalized) {
    case 'user-cancel':
      return 'user_cancel'
    case 'remote-cancel':
      return 'remote_cancel'
    case 'interrupt':
      return 'interrupt'
    case 'background':
      return 'background'
    case 'recovery-timeout':
      return 'recovery_timeout'
    case 'server-fallback-tombstone':
      return 'server_fallback_tombstone'
    default:
      return 'turn_teardown'
  }
}

/**
 * densable XMi — whether the abort kind is a user-facing cancel vs
 * internal turn teardown (used by compact/recovery paths).
 */
export function isUserFacingAbortKind(kind: string): boolean {
  switch (kind) {
    case 'user_cancel':
    case 'remote_cancel':
    case 'interrupt':
    case 'background':
      return true
    case 'turn_teardown':
    case 'recovery_timeout':
    case 'server_fallback_tombstone':
      return false
    default:
      return false
  }
}

/** densable qjn — reason string for server-fallback tombstone aborts. */
export const SERVER_FALLBACK_TOMBSTONE_REASON = 'server-fallback-tombstone'

/** densable recovery-timeout reason (QMi / t6h). */
export const RECOVERY_TIMEOUT_REASON = 'recovery-timeout'

/**
 * densable Y9h — reasons that propagate from parent → recovery child (FLc).
 * Distinct from isUserFacingAbortKind which also treats background as user-facing.
 */
export const PROPAGATING_CANCEL_ABORT_REASONS: ReadonlySet<string> = new Set([
  'user-cancel',
  'remote-cancel',
  'interrupt',
])

/** densable jjn — default recovery abort timeout (10 minutes). */
export const RECOVERY_ABORT_TIMEOUT_MS = 600_000

/**
 * densable abort reason when user picks edit_prompt on refusal_fallback dialog.
 * Query/stream aborts with this so REPL auto-restore rewinds the last human turn.
 */
export const REFUSAL_FALLBACK_EDIT_REASON = 'refusal-fallback-edit'

/** densable restore-source tag for Esc / onCancel auto-restore. */
export const AUTO_RESTORE_SOURCE_USER_CANCEL = 'auto_restore_cancel'

/** densable restore-source tag for refusal edit_prompt auto-restore. */
export const AUTO_RESTORE_SOURCE_REFUSAL_EDIT = 'refusal_fallback_edit'

export type AutoRestoreSource =
  | typeof AUTO_RESTORE_SOURCE_USER_CANCEL
  | typeof AUTO_RESTORE_SOURCE_REFUSAL_EDIT

/** densable LLc — cache AbortError DOMExceptions by reason message (J0). */
const abortErrorDomCache = new Map<string, DOMException>()

/**
 * densable J0 — stable AbortError DOMException for a reason string.
 * Gold aborts via abort(J0("refusal-fallback-edit")) so RT(reason) recovers
 * the string from DOMException.message.
 */
export function abortReasonAsDOMException(reason: string): DOMException {
  let cached = abortErrorDomCache.get(reason)
  if (!cached) {
    cached = new DOMException(reason, 'AbortError')
    abortErrorDomCache.set(reason, cached)
  }
  return cached
}

/**
 * densable restore-gate reasons: user-cancel | refusal-fallback-edit
 * (RT-normalized). Used by REPL onQuery finally auto-restore.
 */
export function isAutoRestoreAbortReason(reason: unknown): boolean {
  const normalized = normalizeAbortReason(reason)
  return (
    normalized === 'user-cancel' ||
    normalized === REFUSAL_FALLBACK_EDIT_REASON
  )
}

/**
 * densable Hus — abort reasons that skip the user-visible interruption
 * message yield (dye). Gold: `Hus=new Set(["interrupt","refusal-fallback-edit"])`
 * and `if(!Hus.has(RT(reason))) yield dye(...)`.
 */
export const SKIP_INTERRUPTION_MESSAGE_REASONS: ReadonlySet<string> = new Set([
  'interrupt',
  REFUSAL_FALLBACK_EDIT_REASON,
])

/**
 * densable Hus.has(RT(reason)) — true when createUserInterruptionMessage
 * should be suppressed (submit-interrupt or refusal edit_prompt restore).
 */
export function shouldSkipInterruptionMessage(reason: unknown): boolean {
  const normalized = normalizeAbortReason(reason)
  return (
    typeof normalized === 'string' &&
    SKIP_INTERRUPTION_MESSAGE_REASONS.has(normalized)
  )
}

/**
 * densable Ad / restore source picker:
 * refusal-fallback-edit → "refusal_fallback_edit", else user-cancel path →
 * "auto_restore_cancel". Undefined when reason is not a restore trigger.
 */
export function resolveAutoRestoreSource(
  reason: unknown,
): AutoRestoreSource | undefined {
  const normalized = normalizeAbortReason(reason)
  if (normalized === REFUSAL_FALLBACK_EDIT_REASON) {
    return AUTO_RESTORE_SOURCE_REFUSAL_EDIT
  }
  if (normalized === 'user-cancel') {
    return AUTO_RESTORE_SOURCE_USER_CANCEL
  }
  return undefined
}

/**
 * densable H9e — true when signal aborted specifically with
 * server-fallback-tombstone reason (RT-normalized). Used by multiphase
 * Auo cancel checkpoints (validate_input / permission / pre_call / call)
 * so only this abort kind short-circuits as a clean cancel mid-tool.
 */
export function isServerFallbackTombstoneAbort(
  signal: AbortSignal,
): boolean {
  return (
    signal.aborted &&
    normalizeAbortReason(signal.reason) === SERVER_FALLBACK_TOMBSTONE_REASON
  )
}

/**
 * densable FLc — true when RT(reason) is in Y9h (user-cancel | remote-cancel |
 * interrupt). Used by recovery child propagation (e6h).
 */
export function isUserFacingCancelAbortReason(reason: unknown): boolean {
  const normalized = normalizeAbortReason(reason)
  return (
    typeof normalized === 'string' &&
    PROPAGATING_CANCEL_ABORT_REASONS.has(normalized)
  )
}

/**
 * densable gzr — resolve interruptedMessageId for dye on cancel.
 * Gold: `if(e.agentId)return; let t=RT(reason); if(t!=="user-cancel"&&t!=="remote-cancel")return; return b_t()??void 0`
 * Subagent contexts never stamp; only user/remote cancel reasons carry the
 * lastCancelledAPIMessageId captured on Esc.
 */
export function resolveInterruptedMessageId(ctx: {
  agentId?: string
  abortController: AbortController
}): string | undefined {
  if (ctx.agentId) return undefined
  const reason = normalizeAbortReason(ctx.abortController.signal.reason)
  if (reason !== 'user-cancel' && reason !== 'remote-cancel') {
    return undefined
  }
  // Lazy require keeps abortController free of bootstrap static import cycles
  // in some test/bootstrap paths; bootstrap is still the densable b_t source.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLastCancelledAPIMessageId } =
    require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
  return getLastCancelledAPIMessageId() ?? undefined
}

/**
 * densable e6h — parent→child abort for recovery controllers: only propagate
 * when parent reason is FLc/Y9h. Background / turn_teardown do not kill an
 * in-flight PTL/media recovery child.
 */
function propagateUserFacingAbortOnly(
  this: WeakRef<AbortController>,
  weakChild: WeakRef<AbortController>,
): void {
  const parent = this.deref()
  if (!parent || !isUserFacingCancelAbortReason(parent.signal.reason)) {
    return
  }
  weakChild.deref()?.abort(parent.signal.reason)
}

/** densable t6h — fire recovery-timeout on a weakly-held controller. */
function fireRecoveryTimeout(weakController: WeakRef<AbortController>): void {
  weakController
    .deref()
    ?.abort(abortReasonAsDOMException(RECOVERY_TIMEOUT_REASON))
}

function attachParentAbortRelay(
  parent: AbortController,
  child: AbortController,
  propagate:
    | typeof propagateAbort
    | typeof propagateUserFacingAbortOnly,
): void {
  // Fast path: parent already aborted — apply policy immediately
  if (parent.signal.aborted) {
    if (propagate === propagateAbort) {
      child.abort(parent.signal.reason)
    } else if (isUserFacingCancelAbortReason(parent.signal.reason)) {
      child.abort(parent.signal.reason)
    }
    return
  }

  const weakChild = new WeakRef(child)
  const weakParent = new WeakRef(parent)
  const handler = propagate.bind(weakParent, weakChild)
  parent.signal.addEventListener('abort', handler, { once: true })
  child.signal.addEventListener(
    'abort',
    removeAbortHandler.bind(weakParent, new WeakRef(handler)),
    { once: true },
  )
}

export function createChildAbortController(
  parent: AbortController,
  maxListeners?: number,
): AbortController {
  const child = createAbortController(maxListeners)
  attachParentAbortRelay(parent, child, propagateAbort)
  return child
}

/**
 * densable QMi — recovery AbortController for PTL/media reactive compact.
 * Child of parent with FLc-filtered propagation + recovery-timeout timer
 * (default 10m / jjn). User Esc cancels recovery; background does not.
 */
export function createRecoveryAbortController(
  parent: AbortController,
  timeoutMs: number = RECOVERY_ABORT_TIMEOUT_MS,
): AbortController {
  const child = createAbortController()
  attachParentAbortRelay(parent, child, propagateUserFacingAbortOnly)
  if (child.signal.aborted) {
    return child
  }
  const timer = setTimeout(
    fireRecoveryTimeout,
    timeoutMs,
    new WeakRef(child),
  )
  timer.unref?.()
  child.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer)
    },
    { once: true },
  )
  return child
}

/**
 * densable YMi — attach a detachable abort relay from parent → child.
 * Unlike createChildAbortController (permanent WeakRef relay), the returned
 * cleanup removes the listener so parent abort no longer reaches child
 * (AgentTool foreground→background: Ct() detaches before async_launched).
 *
 * Gold: `function YMi(e,t){if(e.signal.aborted)return t.abort(e.signal.reason),()=>{};
 * let r=()=>t.abort(e.signal.reason);return e.signal.addEventListener("abort",r,{once:!0}),
 * ()=>e.signal.removeEventListener("abort",r)}`
 */
export function attachDetachableAbortRelay(
  parent: AbortController,
  child: AbortController,
): () => void {
  if (parent.signal.aborted) {
    child.abort(parent.signal.reason)
    return () => {}
  }
  const handler = (): void => {
    child.abort(parent.signal.reason)
  }
  parent.signal.addEventListener('abort', handler, { once: true })
  return () => {
    parent.signal.removeEventListener('abort', handler)
  }
}

/** densable JMi — reason string for subagent-park aborts. */
export const SUBAGENT_PARK_REASON = 'subagent-park'

/** densable X9h / Q9h — cached AbortError DOMException for subagent-park. */
export function subagentParkAbortReason(): DOMException {
  return abortReasonAsDOMException(SUBAGENT_PARK_REASON)
}

/**
 * densable Z9h — true when signal aborted specifically with subagent-park
 * reason (RT-normalized). Export-only in densable 2.1.211 (no call sites
 * outside the abort module yet).
 */
export function isSubagentParkAbort(signal: AbortSignal): boolean {
  return (
    signal.aborted &&
    normalizeAbortReason(signal.reason) === SUBAGENT_PARK_REASON
  )
}
