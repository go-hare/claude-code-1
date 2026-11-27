import { logError } from '../../utils/log.js'

/**
 * Official 2.1.331 chunk `#3564` (`UKs`/`BKs`) & chunk `#775`
 * (`mle`/`VQt`/`gss`/`YQt`/`yxe`): `claudecode/editResult` MCP `_meta`
 * negotiation and `subagentFrameResult` symbol carry-through helpers.
 */

export const EDIT_RESULT_META_KEY = 'claudecode/editResult'
export const EDIT_RESULT_META_VERSION = '1'

export const SUBAGENT_FRAME_RESULT_SYMBOL = Symbol('subagentFrameResult')

export type SubagentFrameResultCarrier = {
  readonly [SUBAGENT_FRAME_RESULT_SYMBOL]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Official `UKs`: returns true when an MCP `tools/call` request asks for the
 * `claudecode/editResult` v1 structured payload on the `Edit` tool.
 */
export function isEditResultMetaRequested(
  toolName: string,
  meta: unknown,
): boolean {
  return (
    toolName === 'Edit' &&
    isRecord(meta) &&
    meta[EDIT_RESULT_META_KEY] === EDIT_RESULT_META_VERSION
  )
}

export const SUBAGENT_FRAME_RESULT_HOLDS_TIMEOUT_MS = 5_000

/**
 * Evaluates a `subagentFrameResultHolds` freshness predicate with an abort
 * signal and bounded timeout (default 5s). Abort, timeout, or thrown error
 * are treated conservatively as `false`.
 */
export async function evaluateSubagentFrameResultHolds(
  holdsFn: () => boolean | Promise<boolean>,
  options?: {
    signal?: AbortSignal
    timeoutMs?: number
  },
): Promise<boolean> {
  const signal = options?.signal
  if (signal?.aborted) {
    return false
  }
  const timeoutMs = options?.timeoutMs ?? SUBAGENT_FRAME_RESULT_HOLDS_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const holdsPromise = Promise.resolve().then(() => holdsFn())
    void holdsPromise.catch(() => {})
    const guardPromise = new Promise<boolean>(resolve => {
      if (signal) {
        onAbort = () => resolve(false)
        signal.addEventListener('abort', onAbort, { once: true })
      }
      if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
        timer = setTimeout(() => {
          timer = undefined
          resolve(false)
        }, timeoutMs)
        if (
          typeof timer === 'object' &&
          timer !== null &&
          'unref' in timer &&
          typeof timer.unref === 'function'
        ) {
          timer.unref()
        }
      }
    })
    return Boolean(await Promise.race([holdsPromise, guardPromise]))
  } catch (error) {
    logError(error)
    return false
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    if (signal && onAbort) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

/**
 * Official `BKs`: attaches `toolResult.subagentFrameResult` to an MCP
 * `CallToolResult`'s `_meta['claudecode/editResult']`, skipping attachment if
 * the tool errored, if no frame result is present, or if
 * `subagentFrameResultHolds()` resolves to `false`, times out, aborts, or throws.
 */
export async function attachSubagentFrameResultMeta<
  T extends { isError?: boolean; _meta?: Record<string, unknown> },
>(
  callToolResult: T,
  toolResult: {
    subagentFrameResult?: unknown
    subagentFrameResultHolds?: () => boolean | Promise<boolean>
  },
  options?: {
    signal?: AbortSignal
    timeoutMs?: number
  },
): Promise<T> {
  if (
    callToolResult.isError === true ||
    toolResult.subagentFrameResult === undefined
  ) {
    return callToolResult
  }

  if (toolResult.subagentFrameResultHolds !== undefined) {
    const holds = await evaluateSubagentFrameResultHolds(
      toolResult.subagentFrameResultHolds,
      options,
    )
    if (!holds) {
      return callToolResult
    }
  }

  return {
    ...callToolResult,
    _meta: {
      ...callToolResult._meta,
      [EDIT_RESULT_META_KEY]: toolResult.subagentFrameResult,
    },
  }
}

/**
 * Official `VQt`: checks whether an object carries `SUBAGENT_FRAME_RESULT_SYMBOL`.
 */
export function hasSubagentFrameResult(
  obj: unknown,
): obj is SubagentFrameResultCarrier {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    SUBAGENT_FRAME_RESULT_SYMBOL in obj
  )
}

/**
 * Official `gss`: reads the carried `subagentFrameResult` payload if present.
 */
export function getSubagentFrameResult(obj: unknown): unknown {
  return hasSubagentFrameResult(obj)
    ? obj[SUBAGENT_FRAME_RESULT_SYMBOL]
    : undefined
}

/**
 * Official `YQt`: returns a spreadable property bag that preserves
 * `SUBAGENT_FRAME_RESULT_SYMBOL` from `obj` when present.
 */
export function carrySubagentFrameResult(
  obj: unknown,
): Partial<SubagentFrameResultCarrier> {
  if (!hasSubagentFrameResult(obj)) {
    return {}
  }
  return {
    [SUBAGENT_FRAME_RESULT_SYMBOL]: obj[SUBAGENT_FRAME_RESULT_SYMBOL],
  }
}

/**
 * Official `yxe`: returns a spreadable property bag carrying `value` under
 * `SUBAGENT_FRAME_RESULT_SYMBOL` (or `{}` when `value === undefined`).
 */
export function withSubagentFrameResult(
  value: unknown,
): Partial<SubagentFrameResultCarrier> {
  if (value === undefined) {
    return {}
  }
  return {
    [SUBAGENT_FRAME_RESULT_SYMBOL]: value,
  }
}
