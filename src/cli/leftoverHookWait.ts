/**
 * densable 2.1.283 leftover unique wrap (no hook fleet / permission engine).
 *
 * Gold SEA `/tmp/official-283/package/claude` + `/tmp/gold-leftover-unique-miss.txt`.
 * gold `bSn` @202277620 · gold `Et` @202305320 · gold `qn` @202305373
 * gold `Li` @202277796 · gold `_s` @202329864 · gold `$t` @202334568
 * gold `Os` @202334745 · gold `As` @202334800
 *
 * Semantic English exports; minify names stay in comments.
 */
import { logForDebugging } from 'src/utils/debug.js'

/**
 * gold `bSn` @202277620
 * `function bSn(e,n){let r=setTimeout(e,n);return r.unref(),{clear:()=>clearTimeout(r)}}`
 */
export function unrefTimeout(
  fn: () => void,
  ms: number,
): { clear: () => void } {
  const r = setTimeout(fn, ms)
  r.unref()
  return { clear: () => clearTimeout(r) }
}

/**
 * gold `Et` @202305320
 * `function Et(e){return"replayed"in e&&e.replayed===!0}`
 */
export function isReplayedForwardedHookCall(e: {
  replayed?: unknown
}): boolean {
  return 'replayed' in e && e.replayed === true
}

/**
 * gold `qn` @202305373
 * `function qn(e){return(e.outcome==="failed"||e.outcome==="refused"&&e.code!=="unknown_call")&&!Et(e)}`
 */
export function isFailedForwardedHookCall(e: {
  outcome?: string
  code?: string
  replayed?: unknown
}): boolean {
  return (
    (e.outcome === 'failed' ||
      (e.outcome === 'refused' && e.code !== 'unknown_call')) &&
    !isReplayedForwardedHookCall(e)
  )
}

/**
 * gold `Li` @202277796 unique copy.
 */
export const FORWARDED_HOOK_INTERNAL_ERROR_RETRY =
  'A hook on your machine could not be run for this call (internal error); retry'

export type ForwardedHookWaitHost = {
  servicer: {
    serve: (
      hook: { requestId: string; callbackId?: unknown },
      state: unknown,
    ) => Promise<
      | { kind: 'silent'; reason?: string }
      | { kind: string; answer?: unknown }
    >
    cancel: (requestId: string, reason: string) => boolean
    cancelAll: () => void
  }
  release: (requestId: string) => void
  respond: (requestId: string, answer: unknown) => void
  logError: (err: unknown) => void
  staging: { dispose: () => Promise<void> | void }
  /** gold `Bre` seam — no callback-id engine. */
  lookupCallback?: (callbackId: unknown) => { event?: string } | undefined
}

/**
 * gold `Li` @202277796 factory (state / setState / handleForwardedHook /
 * handleCancelled / onStoppedWhileRunning / dispose).
 * Sits next to leftover `RWt` `createBoundCreatePack` — no servicer/staging invent.
 */
export function createForwardedHookWait(e: ForwardedHookWaitHost): {
  state: () => unknown
  setState: (h: unknown) => void
  handleForwardedHook: (h: {
    requestId: string
    callbackId?: unknown
  }) => Promise<void>
  handleCancelled: (h: string, g: string) => void
  onStoppedWhileRunning: (h: () => void) => () => void
  dispose: () => Promise<void>
} {
  let n: unknown = null
  let r = false
  const s = new Set<() => void>()
  const lookupCallback = e.lookupCallback ?? (() => undefined)
  return {
    state: () => n,
    setState(h) {
      n = r ? null : h
    },
    async handleForwardedHook(h) {
      if (r) return
      try {
        const g = await e.servicer.serve(h, n)
        if (r) return
        if (g.kind === 'silent') {
          if (
            g.reason === 'not_mine' ||
            g.reason === 'no_state' ||
            g.reason === 'withdrawn'
          ) {
            e.release(h.requestId)
          }
          return
        }
        e.respond(h.requestId, g.answer)
      } catch (g) {
        e.logError(g)
        if (lookupCallback(h.callbackId)?.event === 'PreToolUse' && !r) {
          try {
            e.respond(h.requestId, {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: FORWARDED_HOOK_INTERNAL_ERROR_RETRY,
              },
            })
          } catch {
            /* gold Li empty catch */
          }
        }
      }
    },
    handleCancelled(h, g) {
      if (r || !e.servicer.cancel(h, g) || g !== 'worker') return
      for (const v of s) v()
    },
    onStoppedWhileRunning(h) {
      s.add(h)
      return () => {
        s.delete(h)
      }
    },
    async dispose() {
      r = true
      n = null
      s.clear()
      e.servicer.cancelAll()
      await e.staging.dispose()
    },
  }
}

/**
 * gold leftover `_s` Pa @176286952 — plain object shown-input gate (seam).
 */
export function isShownHostInput(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const n = Object.getPrototypeOf(e)
  return n === Object.prototype || n === null
}

/**
 * gold leftover `_s` XG seam — identity unless a filter is injected.
 * Do not invent Yit permission-input engine.
 */
export function shownInputForTool(
  _toolName: string,
  input: unknown,
): unknown {
  return input
}

/**
 * gold `_s` @202329864
 * Completes host allow with the shown input when deny is not set and
 * updatedInput is empty. Returns `{...e, toolUseID}` / log. No permission engine.
 */
export function completeHostAllowWithShownInput<
  T extends {
    behavior?: string
    toolUseID?: string
    updatedInput?: Record<string, unknown>
  },
>(
  e: T,
  n: { tool_use_id?: string; tool_name?: string; input?: unknown },
  seams?: {
    isShownInput?: (input: unknown) => boolean
    shownInputForTool?: (toolName: string, input: unknown) => unknown
    log?: (line: string) => void
  },
): T & { toolUseID?: string; updatedInput?: unknown } {
  const s = n.tool_use_id ?? e.toolUseID
  if (e.behavior === 'deny') return { ...e, toolUseID: s }
  const isShownInput = seams?.isShownInput ?? isShownHostInput
  const filter = seams?.shownInputForTool ?? shownInputForTool
  const log = seams?.log ?? logForDebugging
  const h =
    !(e.updatedInput !== undefined && Object.keys(e.updatedInput).length > 0) &&
    isShownInput(n.input)
  if (h) {
    log(
      "[headlessCloudClient] completing the host's allow with the shown input",
    )
  }
  return {
    ...e,
    toolUseID: s,
    updatedInput: h ? filter(n.tool_name ?? '', n.input) : e.updatedInput,
  }
}

/**
 * gold `$t` @202334568 — leftover unique frame keep flags (gold dump keys only).
 * `heartbeat_probe` is NOT a `$t` key.
 */
export const HEADLESS_CLOUD_FRAME_KEEP = {
  assistant: true,
  user: true,
  result: true,
  system: true,
  stream_event: true,
  tool_progress: true,
  tool_use_summary: true,
  rate_limit_event: true,
  prompt_suggestion: true,
  conversation_reset: true,
  command_lifecycle: true,
  transcript_mirror: false,
  auth_status: false,
  active_goal: false,
  autocompact_state: false,
  keep_alive: false,
  control_request: false,
  control_response: false,
  control_cancel_request: false,
} as const

/**
 * gold `Os` @202334745
 * `function Os(e){return Object.hasOwn($t,e)?$t[e]:void 0}`
 */
export function lookupHeadlessCloudFrameKeep(
  e: string,
): boolean | undefined {
  return Object.hasOwn(HEADLESS_CLOUD_FRAME_KEEP, e)
    ? HEADLESS_CLOUD_FRAME_KEEP[e as keyof typeof HEADLESS_CLOUD_FRAME_KEEP]
    : undefined
}

/**
 * gold `As` @202334800 — leftover unique service-event names.
 * `heartbeat_probe` lives here, not on `$t`.
 */
export const HEADLESS_SERVICE_EVENT_NAMES = new Set([
  'synced_file_changed',
  'mcp_auth_required',
  'tunnel_stream_interrupted',
  'composer_notice',
  'composer_notice_dismissed',
  'workflow_launch',
  'queued_notification',
  'heartbeat_probe',
])

/** gold `As.has` leftover unique. */
export function isHeadlessServiceEvent(name: string): boolean {
  return HEADLESS_SERVICE_EVENT_NAMES.has(name)
}
