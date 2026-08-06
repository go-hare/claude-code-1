/**
 * densable 2.1.212 #23 — streaming control_request lifecycle ownership.
 *
 * densable print stdin loop (verbatim shape):
 * ```js
 * if (Rr && We.type !== "user" && We.type !== "bash_command"
 *     && We.type !== "control_response" && We.type !== "control_request")
 *   e.onCommandLifecycle?.(Rr, "completed")
 * if (We.type === "control_request") {
 *   let Ko = false
 *   let ra = (Fr) => { // started now; completed after Fr settles
 *     Ko = true
 *     if (Rr) e.onCommandLifecycle?.(Rr, "started")
 *     Promise.resolve().then(Fr).finally(() => {
 *       if (Rr) e.onCommandLifecycle?.(Rr, "completed")
 *     }).catch(...)
 *   }
 *   let Ns = (Fr) => { // completed now; Fr continues (mcp_call)
 *     Ko = true
 *     if (Rr) e.onCommandLifecycle?.(Rr, "completed")
 *     Promise.resolve().then(Fr).catch(...)
 *   }
 *   try { /* handlers; some call ra/Ns *\/ }
 *   finally {
 *     if (Rr && !Ko) e.onCommandLifecycle?.(Rr, "completed")
 *   }
 * }
 * ```
 *
 * Bug fixed: marking control_request complete before its handler finished
 * (outer immediate completed) could lose the request on session restart.
 */

/**
 * densable outer-loop filter: which non-user event types still get
 * immediate `completed` on the stdin tick.
 * control_request / control_response / bash_command own their lifecycle.
 */
export function shouldCompleteEventLifecycleImmediately(
  messageType: string,
): boolean {
  return (
    messageType !== 'user' &&
    messageType !== 'bash_command' &&
    messageType !== 'control_response' &&
    messageType !== 'control_request'
  )
}

/**
 * densable finally: emit completed only when ra/Ns did not claim ownership.
 */
export function shouldEmitControlFinallyCompleted(
  deferred: boolean,
  hasEventId: boolean,
): boolean {
  return hasEventId && !deferred
}
