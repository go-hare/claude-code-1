/**
 * densable 2.1.289 AVt / I$ / ylt / ere / tre / Rq.
 *
 * Managed PreToolUse runs before tool.call core, stashes `managedPass` on the
 * cloned context, and PostToolUse excludes policy hooks when I$ holds.
 */
import { isDeepStrictEqual } from 'util'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { logForDebugging } from '../debug.js'
import { pinValue } from '../plugins/functionHooksHop.js'

export type ManagedPreToolPassResult = {
  deny?: string
  ask?: string
  allow?: boolean
  updatedInput?: Record<string, unknown>
  additionalContext?: string[]
}

export type ManagedHookPass = {
  result: ManagedPreToolPassResult
  yields: unknown[]
}

/** densable `r.managedPass` / `s.managedPass`. */
export type ToolCallManagedPass = {
  toolUseId: string
  input: unknown
  inputKey: () => string
  pass: ManagedHookPass
}

/**
 * densable I$ — managed PostToolUse is excluded from the in-tool pass (and
 * kce runs it after tool.call) when the result is kept for the caller.
 */
export function shouldPreserveManagedToolHookPass(
  context: { agentId?: string; preserveToolUseResults?: boolean },
  tool: Pick<Tool, 'preserveToolUseResultInSubagents'>,
): boolean {
  return (
    !context.agentId ||
    context.preserveToolUseResults === true ||
    tool.preserveToolUseResultInSubagents === true
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** densable ylt — shallow enumerable Object.is, else pin equality. */
export function managedPassInputMatches(
  stored: unknown,
  incoming: unknown,
  inputKey: () => string,
): boolean {
  if (
    isPlainObject(stored) &&
    isPlainObject(incoming) &&
    typeof (stored as { toJSON?: unknown }).toJSON !== 'function' &&
    typeof (incoming as { toJSON?: unknown }).toJSON !== 'function' &&
    Object.keys(stored).length === Object.keys(incoming).length &&
    Object.keys(stored).every(
      key =>
        Object.prototype.propertyIsEnumerable.call(incoming, key) &&
        Object.is(stored[key], incoming[key]),
    )
  ) {
    return true
  }
  return inputKey() === pinValue(incoming)
}

export function matchToolCallManagedPass(
  pass: ToolCallManagedPass | undefined,
  toolUseId: string,
  input: unknown,
): ManagedHookPass | undefined {
  if (pass === undefined || pass.toolUseId !== toolUseId) {
    return undefined
  }
  if (!managedPassInputMatches(pass.input, input, pass.inputKey)) {
    return undefined
  }
  return pass.pass
}

type AccountMemoryMcpInfoCarrier = {
  mcpInfo?: {
    accountMemory?: boolean
    accountMemoryServer?: boolean
  }
}

/** densable _O @187741135 — `e.mcpInfo?.accountMemoryServer === true`. */
export function isAccountMemoryHookTool(
  tool: AccountMemoryMcpInfoCarrier,
): boolean {
  return tool.mcpInfo?.accountMemoryServer === true
}

/**
 * densable ere @187741135 — `_O(e) && r !== undefined && !(s && Object.keys(r).length === 0) && !x5e(r, n)`.
 */
export function didAccountMemoryHookRewriteInput(
  tool: AccountMemoryMcpInfoCarrier,
  originalInput: unknown,
  updatedInput: unknown,
  allowEmptyObject = false,
): boolean {
  if (!isAccountMemoryHookTool(tool) || updatedInput === undefined) {
    return false
  }
  if (
    allowEmptyObject &&
    isPlainObject(updatedInput) &&
    Object.keys(updatedInput).length === 0
  ) {
    return false
  }
  return !isDeepStrictEqual(updatedInput, originalInput)
}

/** densable tre */
export function accountMemoryHookRewriteDenied(
  tool: Pick<Tool, 'name'>,
  hookEvent: 'PreToolUse' | 'PermissionRequest' | 'tool.call hook',
  hookSource?: string,
): { message: string } {
  const message = `A ${hookEvent} hook rewrote the ${tool.name} call to the account memory server; a hook may allow or deny such a call but not change it. The call is denied.`
  logForDebugging(message, { level: 'warn' })
  logEvent('tengu_account_memory_hook_rewrite_denied', {
    hook_event:
      hookEvent as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    tool_name: sanitizeToolNameForAnalytics(tool.name),
    ...(hookSource !== undefined
      ? {
          hook_source:
            hookSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
  })
  return { message }
}
