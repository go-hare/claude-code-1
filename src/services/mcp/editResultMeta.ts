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

/**
 * Official `BKs`: attaches `toolResult.subagentFrameResult` to an MCP
 * `CallToolResult`'s `_meta['claudecode/editResult']`, skipping attachment if
 * the tool errored, if no frame result is present, or if
 * `subagentFrameResultHolds()` resolves to `false` or throws.
 */
export async function attachSubagentFrameResultMeta<
  T extends { isError?: boolean; _meta?: Record<string, unknown> },
>(
  callToolResult: T,
  toolResult: {
    subagentFrameResult?: unknown
    subagentFrameResultHolds?: () => boolean | Promise<boolean>
  },
): Promise<T> {
  if (
    callToolResult.isError === true ||
    toolResult.subagentFrameResult === undefined
  ) {
    return callToolResult
  }

  if (toolResult.subagentFrameResultHolds !== undefined) {
    try {
      const holds = await toolResult.subagentFrameResultHolds()
      if (!holds) {
        return callToolResult
      }
    } catch (error) {
      logError(error)
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
