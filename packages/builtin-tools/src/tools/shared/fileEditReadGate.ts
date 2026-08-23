/**
 * densable 2.1.228 #17 — Write/Edit unread-overwrite gate (Jqy / J4t / MCt / ZYd)
 * plus densable l8t Read-deny early gate (errorCode 13).
 *
 * Write validateInput (SEA):
 *   after edit-deny: if (l8t(n, yn(r))) return ECs errorCode 13
 *   f = !c && !ZYd(n) && !J4t(d) && MCt(nu, n, r, yn(r))
 * Edit validateInput (SEA):
 *   after edit-deny: if (l8t(s, yn(t))) return vCs errorCode 13
 *   b = !J4t(y) && MCt(kl, s, t, yn(t))
 *
 * Legacy model set (Jqy) still requires prior read; non-legacy models may skip
 * when Read is auto-allowed (MCt).
 */
import { extname } from 'path'
import {
  getMainLoopModelFromLayers,
  getToolPermissionContextFromLayers,
} from 'src/engine/permissionLayerReaders.js'
import type { Tool, ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import { toolMatchesName } from 'src/Tool.js'
import { getCanonicalName } from 'src/utils/model/model.js'
import {
  checkReadPermissionForTool,
  matchingRuleForInput,
} from 'src/utils/permissions/filesystem.js'
import {
  getAskRuleForTool,
  getDenyRuleForTool,
} from 'src/utils/permissions/permissions.js'
import { FILE_EDIT_TOOL_NAME } from '../FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../FileWriteTool/prompt.js'

/**
 * densable vCs — Edit blocked because path/tool is under a Read deny rule.
 * Distinct from generic unread ("File has not been read yet…").
 */
export const FILE_READ_DENY_CANNOT_EDIT =
  'File is covered by a Read deny rule in your permission settings and cannot be edited.'

/**
 * densable ECs — Write blocked because path/tool is under a Read deny rule.
 */
export const FILE_READ_DENY_CANNOT_WRITE =
  'File is covered by a Read deny rule in your permission settings and cannot be written.'

/**
 * densable KqS — tool-level Read denies from these sources do not trip l8t
 * (session tool-narrowing / CLI disallowed-tools / command disallowed-tools).
 * densable includes `toolsNarrowing` which we may not surface as a typed source.
 */
const L8T_EXCLUDED_TOOL_DENY_SOURCES = new Set([
  'toolsNarrowing',
  'cliArg',
  'command',
])

/** densable Jqy — models that still enforce unread Write/Edit gate. */
export const LEGACY_WRITE_READ_GATE_MODELS = new Set([
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

/** densable Ma — strip trailing [1m] only. */
function stripOneMSuffix(model: string): string {
  return model.replace(/\[1m\]$/i, '')
}

/**
 * densable J4t(e) — true when model is in the legacy set that must read first.
 * Match both Ma(model) and getCanonicalName for provider-resolved IDs.
 */
export function isLegacyWriteReadGateModel(model: string): boolean {
  const stripped = stripOneMSuffix(model)
  if (LEGACY_WRITE_READ_GATE_MODELS.has(stripped)) return true
  try {
    const canonical = getCanonicalName(model)
    if (LEGACY_WRITE_READ_GATE_MODELS.has(canonical)) return true
    if (LEGACY_WRITE_READ_GATE_MODELS.has(stripOneMSuffix(canonical)))
      return true
  } catch {
    // ignore bad model strings
  }
  return false
}

/** densable ZYd — notebook path (strip trailing dots/spaces, then .ipynb). */
export function isNotebookPath(filePath: string): boolean {
  return extname(filePath.replace(/[. ]+$/, '')).toLowerCase() === '.ipynb'
}

/** densable u2e probe — Read tool stub for permission decision. */
const READ_PROBE = {
  name: FILE_READ_TOOL_NAME,
  mcpInfo: undefined,
  getPath: (input: { [key: string]: unknown }) => String(input.file_path),
} as Tool

/**
 * densable YqS — tool list has Write/Edit but neither Read nor REPL.
 * When true, MCt returns false (cannot skip unread gate).
 */
function hasWriteWithoutReadOrRepl(
  toolName: string,
  toolUseContext: ToolUseContext,
): boolean {
  const tools = toolUseContext.options.tools ?? []
  const hasSelf = tools.some(t => toolMatchesName(t, toolName))
  if (!hasSelf) return false
  const hasRead = tools.some(t => toolMatchesName(t, FILE_READ_TOOL_NAME))
  const hasRepl = tools.some(t => toolMatchesName(t, 'REPL'))
  return hasSelf && !hasRead && !hasRepl
}

/**
 * densable Qxf — path is auto-allowed for Read (or bypassPermissions ask
 * without an explicit ask rule).
 */
function isPathReadAutoAllowed(
  fullFilePath: string,
  permissionContext: ToolPermissionContext,
): boolean {
  // densable hB/d2e: tool-level deny/ask for Read blocks auto-allow
  if (getDenyRuleForTool(permissionContext, READ_PROBE) !== null) return false
  if (getAskRuleForTool(permissionContext, READ_PROBE) !== null) return false

  // densable Ast → YTe(Read, {file_path})
  const decision = checkReadPermissionForTool(
    READ_PROBE,
    { file_path: fullFilePath },
    permissionContext,
  )
  if (decision.behavior === 'allow') return true
  if (decision.behavior !== 'ask') return false
  if (permissionContext.mode !== 'bypassPermissions') return false
  const reason = decision.decisionReason
  if (reason?.type === 'rule' && reason.rule.ruleBehavior === 'ask') {
    return false
  }
  return true
}

/**
 * densable MCt(toolName, path, toolUseContext, permissionContext).
 * True when the unread Write/Edit gate may be skipped for this path.
 */
export function isReadAutoAllowedForEditGate(
  toolName: typeof FILE_WRITE_TOOL_NAME | typeof FILE_EDIT_TOOL_NAME | string,
  fullFilePath: string,
  toolUseContext: ToolUseContext,
  permissionContext?: ToolPermissionContext,
): boolean {
  if (hasWriteWithoutReadOrRepl(toolName, toolUseContext)) return false
  const ctx =
    permissionContext ?? getToolPermissionContextFromLayers(toolUseContext)
  return isPathReadAutoAllowed(fullFilePath, ctx)
}

/**
 * densable l8t(path, permissionContext):
 *   if (hB(ctx, Read, denyRules.filter(!KqS)) !== null) return true
 *   if (LNa(ctx, "read", "deny").size === 0) return false
 *   return fT(path).some(p => Dk(p, ctx, "read", "deny") !== null)
 *
 * Early Write/Edit validateInput gate (errorCode 13) — separate from unread
 * errorCode 2/6. User-facing copy is FILE_READ_DENY_CANNOT_{EDIT,WRITE}.
 */
export function isPathCoveredByReadDenyRule(
  fullFilePath: string,
  permissionContext: ToolPermissionContext,
): boolean {
  // Tool-level Read deny, excluding densable KqS sources.
  const alwaysDenyRules = permissionContext.alwaysDenyRules ?? {}
  const filteredDenyRules = Object.fromEntries(
    Object.entries(alwaysDenyRules).filter(
      ([source]) => !L8T_EXCLUDED_TOOL_DENY_SOURCES.has(source),
    ),
  ) as ToolPermissionContext['alwaysDenyRules']
  const filteredContext: ToolPermissionContext = {
    ...permissionContext,
    alwaysDenyRules: filteredDenyRules,
  }
  if (getDenyRuleForTool(filteredContext, READ_PROBE) !== null) {
    return true
  }

  // Path-level Read deny (densable LNa + Dk). matchingRuleForInput already
  // expands Windows path forms; symlink multi-path fT is best-effort via the
  // single expanded path (same as Edit/Write edit-deny checks).
  return (
    matchingRuleForInput(fullFilePath, permissionContext, 'read', 'deny') !==
    null
  )
}

/**
 * densable Write guardSkipped:
 *   !readState && !ipynb && !legacyModel && MCt(Write, ...)
 */
export function shouldSkipWriteUnreadGate(
  fullFilePath: string,
  toolUseContext: ToolUseContext,
  hasReadState: boolean,
  isPartialView: boolean,
): boolean {
  // densable: only completely unread (!c), never partial
  if (hasReadState || isPartialView) return false
  if (isNotebookPath(fullFilePath)) return false
  const model = getMainLoopModelFromLayers(toolUseContext)
  if (isLegacyWriteReadGateModel(model)) return false
  const permCtx = getToolPermissionContextFromLayers(toolUseContext)
  return isReadAutoAllowedForEditGate(
    FILE_WRITE_TOOL_NAME,
    fullFilePath,
    toolUseContext,
    permCtx,
  )
}

/**
 * densable Edit guardSkipped:
 *   !legacyModel && MCt(Edit, ...)  — partial views may skip too
 */
export function shouldSkipEditUnreadGate(
  fullFilePath: string,
  toolUseContext: ToolUseContext,
): boolean {
  const model = getMainLoopModelFromLayers(toolUseContext)
  if (isLegacyWriteReadGateModel(model)) return false
  const permCtx = getToolPermissionContextFromLayers(toolUseContext)
  return isReadAutoAllowedForEditGate(
    FILE_EDIT_TOOL_NAME,
    fullFilePath,
    toolUseContext,
    permCtx,
  )
}

/**
 * densable call-path (Write/Edit after validateInput): missing or partial
 * readFileState must NOT always throw FILE_UNEXPECTEDLY_MODIFIED — when
 * validate would have set guardSkipped, call must allow the write/edit.
 *
 * Stale mtime with a full prior read is a separate branch (HOe+xOe).
 */
export function shouldAllowCallDespiteMissingOrPartialRead(
  kind: 'write' | 'edit',
  fullFilePath: string,
  toolUseContext: ToolUseContext,
  lastRead: { isPartialView?: boolean } | null | undefined,
): boolean {
  if (kind === 'write') {
    return shouldSkipWriteUnreadGate(
      fullFilePath,
      toolUseContext,
      Boolean(lastRead),
      lastRead?.isPartialView === true,
    )
  }
  return shouldSkipEditUnreadGate(fullFilePath, toolUseContext)
}
