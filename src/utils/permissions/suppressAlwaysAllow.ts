/**
 * densable nLe / rLe residual — strip bare always-allow permission updates
 * when a tool opts into suppressesAlwaysAllowRule for the current input.
 *
 * - nLe: tool identity + reverse toolAliases (b5t)
 * - rLe: filter addRules/replaceRules allow updates; drop bare rules whose
 *   toolName is in the suppress set; keep content-scoped rules; keep updates
 *   when destination already has a matching bare allow (nAe)
 * - showAlwaysAllow (EYt + suppress gates): hide permanent-allow UI options
 */
import type { Tool, ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../types/permissions.js'
import { shouldShowAlwaysAllowOptions } from './permissionsLoader.js'
import { toolNamesForAlwaysAllowSuppress } from '../../Tool.js'
import type { PermissionRuleSource } from '../../types/permissions.js'
import type { PermissionRuleValue } from './PermissionRule.js'
import type { PermissionUpdate } from './PermissionUpdateSchema.js'
import { permissionRuleValueFromString } from './permissionRuleParser.js'

/**
 * densable showAlwaysAllow:
 *   EYt() && !(ask && suppressAlwaysAllowRule) && tool.suppressesAlwaysAllowRule?.(input) !== true
 * plus local isAskCappedByOrg (mcp effectiveMaxPermission === 'ask').
 *
 * @param extraGate optional additional AND (e.g. WebFetch non-empty hostname)
 */
export function computeShowAlwaysAllowOptions(opts: {
  tool: Tool
  input: { [key: string]: unknown }
  permissionResult?: PermissionDecision | null
  /** When false, always hide (e.g. empty hostname). Default true. */
  extraGate?: boolean
}): boolean {
  if (!shouldShowAlwaysAllowOptions()) return false
  if (opts.extraGate === false) return false
  if (opts.tool.mcpInfo?.effectiveMaxPermission === 'ask') return false
  const pr = opts.permissionResult
  if (
    pr &&
    pr.behavior === 'ask' &&
    'suppressAlwaysAllowRule' in pr &&
    pr.suppressAlwaysAllowRule === true
  ) {
    return false
  }
  try {
    if (opts.tool.suppressesAlwaysAllowRule?.(opts.input) === true) {
      return false
    }
  } catch {
    // Tool suppress check must not break the prompt
  }
  return true
}

function isBareRuleForSuppressSet(
  rule: PermissionRuleValue,
  suppressNames: ReadonlySet<string>,
): boolean {
  return rule.ruleContent === undefined && suppressNames.has(rule.toolName)
}

/**
 * densable nAe — destination already has a bare always-allow for this tool.
 * When true, rLe keeps the whole allow-update (idempotent destination).
 */
export function destinationHasBareAlwaysAllow(
  context: ToolPermissionContext,
  tool: { name: string; mcpInfo?: { serverName: string; toolName: string } },
  destination: string,
): boolean {
  const suppressNames = toolNamesForAlwaysAllowSuppress(
    tool,
    context.toolAliases,
  )
  const rules =
    context.alwaysAllowRules[destination as PermissionRuleSource] ?? []
  for (const ruleStr of rules) {
    const parsed = permissionRuleValueFromString(ruleStr)
    if (isBareRuleForSuppressSet(parsed, suppressNames)) {
      return true
    }
  }
  return false
}

/**
 * densable rLe — filter permission updates under suppressAlwaysAllow.
 *
 * @param updates permission updates from user/hook/SDK
 * @param suppressNames nLe set (tool name + reverse aliases)
 * @param keepDestination when true for a destination, keep allow-update intact
 */
export function filterAlwaysAllowUpdatesForSuppress(
  updates: readonly PermissionUpdate[],
  suppressNames: ReadonlySet<string>,
  keepDestination: (destination: string) => boolean = () => false,
): PermissionUpdate[] {
  const out: PermissionUpdate[] = []
  for (const update of updates) {
    if (
      !(
        (update.type === 'addRules' || update.type === 'replaceRules') &&
        update.behavior === 'allow'
      )
    ) {
      out.push(update)
      continue
    }
    if (keepDestination(update.destination)) {
      out.push(update)
      continue
    }
    const kept = update.rules.filter(
      rule => !isBareRuleForSuppressSet(rule, suppressNames),
    )
    if (kept.length === update.rules.length) {
      out.push(update)
    } else if (kept.length > 0) {
      out.push({ ...update, rules: kept })
    }
    // else: drop the update entirely (all bare-allow rules stripped)
  }
  return out
}

/**
 * densable call sites:
 *   tool.suppressesAlwaysAllowRule?.(input) === true
 *     ? rLe(updates, nLe(tool, context), dest => nAe(context, tool, dest))
 *     : updates
 */
export function maybeStripAlwaysAllowPermissions(
  updates: readonly PermissionUpdate[] | undefined,
  tool: Tool,
  input: { [key: string]: unknown },
  permissionContext: ToolPermissionContext,
): PermissionUpdate[] {
  const list = updates ? [...updates] : []
  if (list.length === 0) return list
  try {
    if (tool.suppressesAlwaysAllowRule?.(input) !== true) {
      return list
    }
  } catch {
    // Tool suppress check must not break allow path
    return list
  }
  const suppressNames = toolNamesForAlwaysAllowSuppress(
    tool,
    permissionContext.toolAliases,
  )
  return filterAlwaysAllowUpdatesForSuppress(list, suppressNames, destination =>
    destinationHasBareAlwaysAllow(permissionContext, tool, destination),
  )
}

/** Convenience: resolve permission context from ToolUseContext. */
export function maybeStripAlwaysAllowPermissionsFromContext(
  updates: readonly PermissionUpdate[] | undefined,
  tool: Tool,
  input: { [key: string]: unknown },
  toolUseContext: ToolUseContext,
): PermissionUpdate[] {
  return maybeStripAlwaysAllowPermissions(
    updates,
    tool,
    input,
    toolUseContext.getAppState().toolPermissionContext,
  )
}
