/**
 * densable Edit read-guard skip residual (Ywi / ZCg / SKi / vKi).
 *
 * densable:
 *   Ywi(model)  — legacy model set after strip trailing [1m]
 *   ZCg(ctx)    — toolset has Edit AND lacks Read AND lacks REPL
 *   SKi(path,ctx) = !ZCg(ctx) && vKi(path, Tn(ctx))
 *   vKi(path,perm) —
 *     whole-tool deny/ask for Read → false
 *     path read decision allow → true
 *     path ask + bypassPermissions + not ask-rule → true
 *     else false
 *
 * Edit validateInput:
 *   guardSkipped = !Ywi(model) && SKi(path, ctx)
 *   recovered (stale) = EKi === "applies" && SKi(path, ctx)
 *
 * Behavior only — analytics stamps use the boolean elsewhere.
 */

import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import type { Tool, ToolUseContext } from '../Tool.js'
import type { ToolPermissionContext } from '../types/permissions.js'
import { applyPermissionLayers } from './contextLayers.js'
import {
  checkReadPermissionForTool,
} from './permissions/filesystem.js'
import {
  getAskRules,
  getDenyRules,
} from './permissions/permissions.js'

/** densable uTh — legacy models still force the read-before-edit guard. */
const LEGACY_EDIT_READ_GUARD_MODELS = new Set([
  'claude-opus-4-6',
  'claude-haiku-4-5',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-opus-4-0',
  'claude-sonnet-4-5',
  'claude-sonnet-4-0',
  'claude-3-7-sonnet',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
])

/** densable REPL tool name (rg) — ZCg checks this, not Write. */
const REPL_TOOL_NAME = 'REPL'

/** densable ks — strip trailing [1m] only. */
export function stripOneMSuffix(model: string): string {
  return model.replace(/\[1m\]$/i, '')
}

/**
 * densable Ywi(model) — true when model is in the legacy set that always
 * enforces read-before-edit (guardSkipped stays false).
 */
export function isLegacyModelForEditReadGuard(model: string): boolean {
  return LEGACY_EDIT_READ_GUARD_MODELS.has(stripOneMSuffix(model))
}

/**
 * densable ZCg(ctx) — Edit present, Read absent, REPL absent.
 * When true, SKi is false (cannot skip the read guard).
 */
export function isEditOnlyWithoutReadOrRepl(
  tools: readonly { name: string }[] | undefined | null,
): boolean {
  const list = tools ?? []
  const hasEdit = list.some(t => t.name === FILE_EDIT_TOOL_NAME)
  if (!hasEdit) return false
  const hasRead = list.some(t => t.name === FILE_READ_TOOL_NAME)
  const hasRepl = list.some(t => t.name === REPL_TOOL_NAME)
  return !hasRead && !hasRepl
}

/** densable Est probe — minimal Read tool for path permission check. */
const READ_PATH_PROBE = {
  name: FILE_READ_TOOL_NAME,
  getPath: (input: { file_path?: string }) => String(input.file_path ?? ''),
} as unknown as Tool

/**
 * densable h8/kqe whole-tool match — deny/ask rules for tool name with no content.
 */
function hasWholeToolRule(
  rules: ReturnType<typeof getDenyRules>,
  toolName: string,
): boolean {
  return rules.some(
    r =>
      r.ruleValue.toolName === toolName &&
      r.ruleValue.ruleContent === undefined,
  )
}

/**
 * densable vKi(path, permCtx) — can treat path as auto-readable for guard skip.
 */
export function isPathAutoReadableForEditGuard(
  absolutePath: string,
  permCtx: ToolPermissionContext,
): boolean {
  if (hasWholeToolRule(getDenyRules(permCtx), FILE_READ_TOOL_NAME)) {
    return false
  }
  if (hasWholeToolRule(getAskRules(permCtx), FILE_READ_TOOL_NAME)) {
    return false
  }

  const decision = checkReadPermissionForTool(
    READ_PATH_PROBE,
    { file_path: absolutePath },
    permCtx,
  )
  if (decision.behavior === 'allow') return true
  if (decision.behavior !== 'ask') return false
  if (permCtx.mode !== 'bypassPermissions') return false
  const reason = decision.decisionReason
  if (reason?.type === 'rule' && reason.rule.ruleBehavior === 'ask') {
    return false
  }
  return true
}

/** densable Tn fold for guard path. */
export function resolvePermissionContextForEditGuard(context: {
  permissionLayers?: ToolUseContext['permissionLayers']
  getAppState: () => { toolPermissionContext: ToolPermissionContext }
}): ToolPermissionContext {
  return applyPermissionLayers(
    context.getAppState().toolPermissionContext,
    context.permissionLayers,
  )
}

/**
 * densable SKi(path, toolUseContext) — whether Edit may skip/recover past
 * the read-before-edit / stale-read guards for this path.
 */
export function canSkipEditReadGuard(
  absolutePath: string,
  context: {
    options: { tools?: readonly { name: string }[] }
    permissionLayers?: ToolUseContext['permissionLayers']
    getAppState: () => { toolPermissionContext: ToolPermissionContext }
  },
): boolean {
  if (isEditOnlyWithoutReadOrRepl(context.options.tools)) {
    return false
  }
  const perm = resolvePermissionContextForEditGuard(context)
  return isPathAutoReadableForEditGuard(absolutePath, perm)
}

/**
 * densable Edit not-read guardSkipped:
 *   !Ywi(model) && SKi(path, ctx)
 */
export function shouldSkipEditNotReadGuard(input: {
  absolutePath: string
  model: string
  context: {
    options: { tools?: readonly { name: string }[] }
    permissionLayers?: ToolUseContext['permissionLayers']
    getAppState: () => { toolPermissionContext: ToolPermissionContext }
  }
}): boolean {
  if (isLegacyModelForEditReadGuard(input.model)) return false
  return canSkipEditReadGuard(input.absolutePath, input.context)
}

/**
 * densable Edit stale-read recovered:
 *   EKi === "applies" && SKi(path, ctx)
 */
export function shouldRecoverStaleEditRead(input: {
  absolutePath: string
  applyOutcome: 'no_match' | 'ambiguous' | 'applies'
  context: {
    options: { tools?: readonly { name: string }[] }
    permissionLayers?: ToolUseContext['permissionLayers']
    getAppState: () => { toolPermissionContext: ToolPermissionContext }
  }
}): boolean {
  if (input.applyOutcome !== 'applies') return false
  return canSkipEditReadGuard(input.absolutePath, input.context)
}
