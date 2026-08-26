import { setMaxListeners } from 'events'

/**
 * Default max listeners for standard operations
 */
const DEFAULT_MAX_LISTENERS = 50

/**
 * densable J0 — cache DOMException AbortError reasons for stable identity.
 * Prefer abort with string "background" or this helper so RT(reason)==="background".
 */
const abortReasonCache = new Map<string, DOMException>()

export function createAbortErrorReason(message: string): DOMException {
  let cached = abortReasonCache.get(message)
  if (!cached) {
    cached = new DOMException(message, 'AbortError')
    abortReasonCache.set(message, cached)
  }
  return cached
}

/**
 * densable RT — extract comparable abort reason message.
 * DOMException AbortError → .message; string passthrough; Error → .message.
 */
export function getAbortReasonMessage(reason: unknown): string | undefined {
  if (reason == null) return undefined
  if (typeof reason === 'string') return reason
  if (typeof DOMException !== 'undefined' && reason instanceof DOMException) {
    return reason.message
  }
  if (reason instanceof Error) return reason.message
  return String(reason)
}

/** densable RT(signal.reason) === "background" — left-arrow / exit checkpoint abort. */
export function isBackgroundAbortReason(reason: unknown): boolean {
  return getAbortReasonMessage(reason) === 'background'
}

/**
 * densable q_(signal.reason) === "interrupt" — high-priority / submit-interrupt
 * (REPL priority==='now', handlePromptSubmit). Async bg agent spawn must not
 * treat this as fatal during the startup window (2.1.216 #15).
 */
export function isInterruptAbortReason(reason: unknown): boolean {
  return getAbortReasonMessage(reason) === 'interrupt'
}

/**
 * densable `m0e` / `Cxg` — abort reasons that must NOT yield
 * `[Request interrupted by user]` (2.1.218 #12 + 2.1.236 #27):
 * - `interrupt`: submit-interrupt; the following user message is enough context
 * - `refusal-fallback-edit`: model refusal → edit-prompt abort; not a user cancel
 * - `remote-cancel`: print/SDK SIGTERM (`nC("remote-cancel")`); no interrupted-turn
 */
const SUPPRESS_INTERRUPTION_MESSAGE_REASONS = new Set([
  'interrupt',
  'refusal-fallback-edit',
  'remote-cancel',
])

export function shouldSuppressInterruptionMessage(reason: unknown): boolean {
  const msg = getAbortReasonMessage(reason)
  return msg !== undefined && SUPPRESS_INTERRUPTION_MESSAGE_REASONS.has(msg)
}

/** densable print/SDK SIGTERM reason (`nC("remote-cancel")`). */
export function isRemoteCancelAbortReason(reason: unknown): boolean {
  return getAbortReasonMessage(reason) === 'remote-cancel'
}

/** densable `Ede` — shutdown / SIGTERM abort → mark interrupt for resume. */
export function isShutdownAbortReason(reason: unknown): boolean {
  const msg = getAbortReasonMessage(reason)
  return msg === 'shutdown' || msg === 'remote-cancel'
}

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
export function createChildAbortController(
  parent: AbortController,
  maxListeners?: number,
): AbortController {
  const child = createAbortController(maxListeners)

  // Fast path: parent already aborted, no listener setup needed
  if (parent.signal.aborted) {
    child.abort(parent.signal.reason)
    return child
  }

  // WeakRef prevents the parent from keeping an abandoned child alive.
  // If all strong references to child are dropped without aborting it,
  // the child can still be GC'd — the parent only holds a dead WeakRef.
  const weakChild = new WeakRef(child)
  const weakParent = new WeakRef(parent)
  const handler = propagateAbort.bind(weakParent, weakChild)

  parent.signal.addEventListener('abort', handler, { once: true })

  // Auto-cleanup: remove parent listener when child is aborted (from any source).
  // Both parent and handler are weakly held — if either has been GC'd or the
  // parent already aborted ({once: true}), the cleanup is a harmless no-op.
  child.signal.addEventListener(
    'abort',
    removeAbortHandler.bind(weakParent, new WeakRef(handler)),
    { once: true },
  )

  return child
}
