import {
  getMainThreadAgentType,
  getPromptId,
  getSessionId,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import type {
  HookCallback,
  PermissionRequestResult,
} from '../../types/hooks.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  type EffortValue,
  modelSupportsEffort,
  pdSessionEffort,
  resolveHookStdinEffort,
} from '../effort.js'
import { errorMessage } from '../errors.js'
import {
  getProjectTempDir,
  isScratchpadEnabled,
} from '../permissions/filesystem.js'
import { getPlatform } from '../platform.js'
import { getTranscriptPathForSession } from '../sessionPaths.js'
import { getSettingsForSource } from '../settings/settings.js'
import type { HookCommand } from '../settings/types.js'
import { jsonStringify } from '../slowOperations.js'
import { findGitBashPathOrNull } from '../windowsPaths.js'
import {
  isSeveralJsonDocuments,
  validateHookJson,
} from './hookOutputValidation.js'
import { getHookDisplayText } from './hooksSettings.js'
import type {
  HookCommandResult,
  HookOutsideReplResult,
  HookResult,
} from './hookTypes.js'
import type { FunctionHook } from './sessionHooks.js'
import { join as joinPath } from 'path'
import type {
  HookEvent,
  HookJSONOutput,
} from 'src/entrypoints/agentSdkTypes.js'

export const TOOL_HOOK_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000

/** densable `HFe` — UserPromptSubmit per-hook timeout. */
export const USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS = 30_000

/**
 * Creates the base hook input that's common to all hook types
 */
export function createBaseHookInput(
  permissionMode?: string,
  sessionId?: string,
  // Typed narrowly (not ToolUseContext) so callers can pass toolUseContext
  // directly via structural typing without this function depending on Tool.ts.
  agentInfo?: {
    agentId?: string
    agentType?: string
    options?: { mainLoopModel?: string }
    getAppState?: () => AppState
    remoteCall?: { origin?: { callerSessionId?: string } }
    permissionLayers?: Array<{ kind: string; effort?: unknown }>
  },
): {
  session_id: string
  transcript_path: string
  cwd: string
  scratchpad_dir?: string
  prompt_id?: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
  effort?: { level: EffortLevel }
} {
  const resolvedSessionId = sessionId ?? getSessionId()
  // agent_type: subagent's type (from toolUseContext) takes precedence over
  // the session's --agent flag. Hooks use agent_id presence to distinguish
  // subagent calls from main-thread calls in a --agent session.
  const resolvedAgentType = agentInfo?.agentType ?? getMainThreadAgentType()
  const remoteCaller = agentInfo?.remoteCall?.origin?.callerSessionId
  const effortField = resolveBaseHookEffort(agentInfo ?? {})
  if (agentInfo?.remoteCall !== undefined) {
    const servedId =
      remoteCaller && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(remoteCaller)
        ? remoteCaller
        : 'unknown'
    return {
      session_id: `served:${servedId}`,
      transcript_path: '',
      cwd: getCwd(),
      permission_mode: permissionMode,
      agent_id: agentInfo.agentId,
      ...(effortField !== undefined ? { effort: effortField } : {}),
    }
  }
  const promptId = getPromptId()
  return {
    session_id: resolvedSessionId,
    transcript_path: getTranscriptPathForSession(resolvedSessionId),
    cwd: getCwd(),
    ...resolveScratchpadDirField(resolvedSessionId),
    ...(promptId ? { prompt_id: promptId } : {}),
    permission_mode: permissionMode,
    agent_id: agentInfo?.agentId,
    agent_type: resolvedAgentType,
    ...(effortField !== undefined ? { effort: effortField } : {}),
  }
}

/** densable rd `ck(h, Pd(appState), Ly(permissionLayers))`. */
function resolveBaseHookEffort(agentInfo: {
  options?: { mainLoopModel?: string }
  getAppState?: () => AppState
  permissionLayers?: Array<{ kind: string; effort?: unknown }>
}): { level: EffortLevel } | undefined {
  const model = agentInfo?.options?.mainLoopModel
  if (!model || !agentInfo.getAppState || !modelSupportsEffort(model)) {
    return undefined
  }
  const state = agentInfo.getAppState()
  const pd = pdSessionEffort(state, model)
  let turnEffort: EffortValue | undefined
  for (const layer of agentInfo.permissionLayers ?? []) {
    if (layer?.kind === 'effort') {
      turnEffort = layer.effort as EffortValue
    }
  }
  const applied = resolveHookStdinEffort(model, pd, turnEffort)
  return {
    level: applied === undefined ? 'high' : convertEffortValueToLevel(applied),
  }
}

/** densable QE — join failure is null, omitted from stdin (`?? void 0`). */
function resolveScratchpadDirField(
  sessionId: string,
): { scratchpad_dir: string } | Record<string, never> {
  if (!isScratchpadEnabled()) {
    return {}
  }
  try {
    return {
      scratchpad_dir: joinPath(getProjectTempDir(), sessionId, 'scratchpad'),
    }
  } catch {
    return {}
  }
}

/**
 * densable 2.1.248 kwt @186236662 — Expected schema dumped after Swt.
 */
export function kwt(): string {
  return jsonStringify(
    {
      continue: 'boolean (optional)',
      suppressOutput: 'boolean (optional)',
      stopReason: 'string (optional)',
      decision: '"approve" | "block" (optional)',
      reason: 'string (optional)',
      systemMessage: 'string (optional)',
      terminalSequence: 'string (optional)',
      hookSpecificOutput: {
        'for PreToolUse': {
          hookEventName: '"PreToolUse"',
          permissionDecision: '"allow" | "deny" | "ask" | "defer" (optional)',
          permissionDecisionReason: 'string (optional)',
          updatedInput: 'object (optional) - Modified tool input to use',
        },
        'for PermissionRequest': {
          hookEventName: '"PermissionRequest"',
          decision: {
            'to allow': {
              behavior: '"allow"',
              updatedInput: 'object (optional) - Modified tool input to use',
              updatedPermissions: 'array (optional) - Permission updates',
            },
            'to deny': {
              behavior: '"deny"',
              message: 'string (optional)',
              interrupt: 'boolean (optional)',
            },
          },
        },
        'for UserPromptSubmit': {
          hookEventName: '"UserPromptSubmit"',
          additionalContext: 'string (optional)',
        },
        'for UserPromptExpansion': {
          hookEventName: '"UserPromptExpansion"',
          additionalContext: 'string (optional)',
          suppressOriginalPrompt: 'boolean (optional)',
        },
        'for PostToolUse': {
          hookEventName: '"PostToolUse"',
          additionalContext: 'string (optional)',
        },
        'for PostToolBatch': {
          hookEventName: '"PostToolBatch"',
          additionalContext: 'string (optional)',
        },
        'for Stop / SubagentStop': {
          hookEventName: '"Stop" | "SubagentStop"',
          additionalContext:
            'string (optional) - Feedback for the model; the conversation continues so the model can act on it',
        },
      },
    },
    null,
    2,
  )
}

export function parseHookOutput(stdout: string): {
  json?: HookJSONOutput
  plainText?: string
  validationError?: string
} {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith('{')) {
    logForDebugging('Hook output does not start with {, treating as plain text')
    return { plainText: stdout }
  }

  try {
    const result = validateHookJson(trimmed)
    if ('json' in result) {
      return result
    }
    // densable 2.1.248 lIe: Swt + Expected schema from kwt()
    const errorMessage = `${result.validationError}\n\nExpected schema:\n${kwt()}`
    logForDebugging(errorMessage)
    return { plainText: stdout, validationError: errorMessage }
  } catch (e) {
    if (!trimmed.endsWith('}')) {
      logForDebugging(
        `Hook output starts with { but is not a JSON object, treating as plain text: ${errorMessage(e)}`,
      )
      return { plainText: stdout }
    }
    if (isSeveralJsonDocuments(trimmed)) {
      logForDebugging(
        'Hook output is several JSON documents, treating as plain text',
      )
      return { plainText: stdout }
    }
    const validationError = `Hook output looks like a JSON object but is not valid JSON — ${errorMessage(e)}. Emit the payload with a JSON encoder (jq, ConvertTo-Json, json.dumps) rather than string concatenation so backslashes and quotes inside strings are escaped.`
    logForDebugging(validationError)
    return { plainText: stdout, validationError }
  }
}

/**
 * Gold #542 — format `--debug` completion log for command hooks on tool calls,
 * prompts, SessionStart, and Stop (command, plugin, outcome, durationMs).
 */
export function formatHookCompletionDebugLog({
  hookName,
  command,
  pluginId,
  result,
  timeoutMs,
  durationMs,
  parentAborted,
}: {
  hookName: string
  command: string
  pluginId?: string
  result: Pick<
    HookCommandResult,
    'aborted' | 'backgrounded' | 'spawnFailed' | 'status'
  >
  timeoutMs: number
  durationMs: number
  parentAborted: boolean
}): string {
  const outcome = result.aborted
    ? parentAborted
      ? 'cancelled'
      : `timed out after ${timeoutMs}ms`
    : result.backgrounded
      ? 'moved to the background'
      : result.spawnFailed
        ? 'failed to start'
        : `finished with status ${result.status}`
  return `Hooks: ${hookName} [${command}]${pluginId ? ` (plugin ${pluginId})` : ''} ${outcome} (${durationMs}ms)`
}

export function isManagedEnabledPlugin(
  pluginId?: string,
  pluginName?: string,
): boolean {
  const policyEnabled = getSettingsForSource('policySettings')?.enabledPlugins
  if (!policyEnabled) return false
  const isEnabledEntry = (v: unknown): boolean =>
    v === true || (Array.isArray(v) && v.length > 0)
  if (pluginId) {
    // Exact pluginId match only — never fall back to short pluginName, and
    // explicit false never falls through.
    return isEnabledEntry(policyEnabled[pluginId])
  }
  if (pluginName) {
    if (Object.hasOwn(policyEnabled, pluginName)) {
      return isEnabledEntry(policyEnabled[pluginName])
    }
    const prefix = `${pluginName}@`
    for (const [key, val] of Object.entries(policyEnabled)) {
      if (key.startsWith(prefix) && isEnabledEntry(val)) {
        return true
      }
    }
  }
  return false
}

export function areHookObjectsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    return false
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false
    }
    return a.every((item, i) => areHookObjectsEqual(item, b[i]))
  }
  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const keysA = Object.keys(objA).filter(k => objA[k] !== undefined)
  const keysB = Object.keys(objB).filter(k => objB[k] !== undefined)
  if (keysA.length !== keysB.length) return false
  return keysA.every(
    k => Object.hasOwn(objB, k) && areHookObjectsEqual(objA[k], objB[k]),
  )
}

export function isManagedSettingsHook(
  hook: HookCommand | HookCallback | FunctionHook,
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion',
  pluginRoot?: string,
  pluginId?: string,
  skillRoot?: string,
  pluginName?: string,
): boolean {
  if (skillRoot !== undefined) {
    return false
  }
  if (pluginRoot !== undefined) {
    return isManagedEnabledPlugin(pluginId, pluginName)
  }
  if (hookEvent === 'StatusLine' || hookEvent === 'FileSuggestion') {
    const policy = getSettingsForSource('policySettings')
    const entry =
      hookEvent === 'StatusLine' ? policy?.statusLine : policy?.fileSuggestion
    return (
      hook.type === 'command' &&
      entry?.type === 'command' &&
      entry.command === hook.command
    )
  }
  const matchers = getSettingsForSource('policySettings')?.hooks?.[hookEvent]
  if (!matchers) return false
  return matchers.some(m =>
    m.hooks.some(h => h.type === hook.type && areHookObjectsEqual(h, hook)),
  )
}

export function isManagedCommandHook(
  hook: HookCommand & { type: 'command' },
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion',
  pluginRoot?: string,
  skillRoot?: string,
): boolean {
  if (pluginRoot !== undefined || skillRoot !== undefined) {
    return false
  }
  return isManagedSettingsHook(
    hook,
    hookEvent,
    pluginRoot,
    undefined,
    skillRoot,
  )
}

/**
 * #696 (SEA `dX` / `F2e` / `lEn`): When a command hook comes from managed
 * settings (`policySettings`), strip repository (`projectSettings` /
 * `localSettings`) env vars that are not also set by `policySettings` or
 * `userSettings` so project env cannot hijack `CLAUDE_CODE_SHELL_PREFIX` or
 * managed hook execution environment.
 */
export function buildManagedHookIsolatedEnv(baseEnv: NodeJS.ProcessEnv): {
  env: NodeJS.ProcessEnv
  strippedKeys: string[]
} {
  const policyEnv = getSettingsForSource('policySettings')?.env ?? {}
  const userEnv = getSettingsForSource('userSettings')?.env ?? {}
  const projectEnv = getSettingsForSource('projectSettings')?.env ?? {}
  const localEnv = getSettingsForSource('localSettings')?.env ?? {}

  const strippedKeys: string[] = []
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  for (const key of new Set([
    ...Object.keys(projectEnv),
    ...Object.keys(localEnv),
  ])) {
    if (
      !Object.hasOwn(policyEnv, key) &&
      !Object.hasOwn(userEnv, key) &&
      Object.hasOwn(env, key)
    ) {
      delete env[key]
      strippedKeys.push(key)
    }
  }
  return { env, strippedKeys }
}

/** Typed representation of sync hook JSON output, matching the syncHookResponseSchema Zod schema. */
export interface TypedSyncHookOutput {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  reason?: string
  systemMessage?: string
  terminalSequence?: string
  hookSpecificOutput?:
    | {
        hookEventName: 'PreToolUse'
        permissionDecision?: 'ask' | 'deny' | 'allow' | 'passthrough' | 'defer'
        permissionDecisionReason?: string
        updatedInput?: Record<string, unknown>
        additionalContext?: string
      }
    | {
        hookEventName: 'UserPromptSubmit'
        additionalContext?: string
        sessionTitle?: string
        suppressOriginalPrompt?: boolean
      }
    | {
        hookEventName: 'UserPromptExpansion'
        additionalContext?: string
        suppressOriginalPrompt?: boolean
      }
    | {
        hookEventName: 'SessionStart'
        additionalContext?: string
        initialUserMessage?: string
        sessionTitle?: string
        watchPaths?: string[]
        reloadSkills?: boolean
      }
    | {
        hookEventName: 'Setup'
        additionalContext?: string
      }
    | {
        hookEventName: 'PreModelSwitch'
        permissionDecision?: 'allow' | 'deny' | 'ask'
        permissionDecisionReason?: string
      }
    | {
        hookEventName: 'PostModelSwitch'
        additionalContext?: string
      }
    | {
        hookEventName: 'SubagentStart'
        additionalContext?: string
      }
    | {
        hookEventName: 'PostToolUse'
        additionalContext?: string
        updatedToolOutput?: unknown
        classifierContext?: string
        updatedMCPToolOutput?: unknown
      }
    | {
        hookEventName: 'PostToolUseFailure'
        additionalContext?: string
      }
    | {
        hookEventName: 'PostToolBatch'
        additionalContext?: string
      }
    | {
        hookEventName: 'Stop'
        additionalContext?: string
      }
    | {
        hookEventName: 'SubagentStop'
        additionalContext?: string
      }
    | {
        hookEventName: 'PermissionDenied'
        retry?: boolean
      }
    | {
        hookEventName: 'Notification'
        additionalContext?: string
      }
    | {
        hookEventName: 'PermissionRequest'
        decision?: PermissionRequestResult
      }
    | {
        hookEventName: 'Elicitation'
        action?: 'accept' | 'decline' | 'cancel'
        content?: Record<string, unknown>
      }
    | {
        hookEventName: 'ElicitationResult'
        action?: 'accept' | 'decline' | 'cancel'
        content?: Record<string, unknown>
      }
    | {
        hookEventName: 'CwdChanged'
        watchPaths?: string[]
      }
    | {
        hookEventName: 'FileChanged'
        watchPaths?: string[]
      }
    | {
        hookEventName: 'WorktreeCreate'
        worktreePath: string
      }
    | {
        hookEventName: 'MessageDisplay'
        displayContent?: string
      }
}

/**
 * Gold `bO` / `XBt` — escape `<system-reminder>` and `</system-reminder>`
 * (plus trailing `<` / `</`) in hook outputs before they reach Claude (#255).
 */
export function escapeSystemReminderTags(text: string): string {
  return text
    .replaceAll(/<(?=\s*(?:\/\s*)?system-reminder\b)/gi, '&lt;')
    .replace(/<(?=\s*(?:\/\s*)?$)/, '&lt;')
}

/**
 * Gold `jse` — hook events where `onFailure: "block"` is ignored because
 * blocking those events on hook failure would trap the session/task (#343).
 */
export const ON_FAILURE_BLOCK_IGNORED_EVENTS: ReadonlySet<HookEvent> =
  new Set<HookEvent>(['Stop', 'SubagentStop', 'TaskCompleted', 'TeammateIdle'])

export type HookWithOnFailure = {
  type: string
  async?: boolean
  asyncRewake?: boolean
  onFailure?: 'continue' | 'block'
}

/**
 * Gold `HG` — returns true when the hook is configured with `onFailure: "block"`
 * (excluding async/asyncRewake command hooks and non-command/http/callback hooks).
 */
export function isOnFailureBlock(hook: HookWithOnFailure): boolean {
  switch (hook.type) {
    case 'command':
      return (
        hook.onFailure === 'block' &&
        hook.async !== true &&
        hook.asyncRewake !== true
      )
    case 'http':
    case 'mcp_tool':
    case 'callback':
      return hook.onFailure === 'block'
    default:
      return false
  }
}

/**
 * Gold `YQe` — true when `onFailure: "block"` applies to this hook + event.
 */
const PS_NAMED_BLOCKS = 'begin|process|end|clean|dynamicparam'

const PS_NAMED_BLOCK_START_RE = new RegExp(`^(${PS_NAMED_BLOCKS})\\s*\\{`, 'i')

const PS_NAMED_BLOCK_ANY_RE = new RegExp(
  `(?:^|[^-$.\\w])(?:${PS_NAMED_BLOCKS})(?=[\\s\\u0085]*(?:\\{|#|<#|\`))`,
  'i',
)

/** Official `FCe` + `cen`: detect PowerShell script headers where trailing `; if (-not $?) ...` is invalid. */
function isPowerShellScriptHeader(command: string): boolean {
  let i = 0
  for (;;) {
    while (i < command.length && /[\s;]/.test(command[i]!)) i++
    if (command[i] === '#') {
      while (i < command.length && command[i] !== '\n') i++
      continue
    }
    if (command.startsWith('<#', i)) {
      const close = command.indexOf('#>', i + 2)
      i = close === -1 ? command.length : close + 2
      continue
    }
    break
  }
  const rest = command.slice(i)
  const startsHeader =
    /^using\s+(namespace|module|assembly)\b/i.test(rest) ||
    /^param\s*\(/i.test(rest) ||
    PS_NAMED_BLOCK_START_RE.test(rest) ||
    (/^\[\w/.test(rest) && !/^\[[\w.]+\]::/.test(rest))
  return startsHeader && PS_NAMED_BLOCK_ANY_RE.test(command)
}

/**
 * #1149: propagate native program exit code 2 from PowerShell hooks
 * (PowerShell otherwise swallows `$LASTEXITCODE` on non-PermissionRequest hooks).
 */
export function wrapPowerShellHookCommand(
  command: string,
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion',
): string {
  if (hookEvent === 'PermissionRequest' || isPowerShellScriptHeader(command)) {
    return command
  }
  return `${command}\n; if (-not $?) { if ($LASTEXITCODE -eq 2) { exit 2 } }`
}

const NO_BASH_ONLY_STRINGS_EXIT_CODE = 127

export function wrapPowerShellHookWithNoBashAstGuard(
  command: string,
  hook: HookWithOnFailure & {
    type?: string
    shell?: string
    args?: unknown
    async?: boolean
    asyncRewake?: boolean
  },
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion',
  isWindows = getPlatform() === 'windows',
  hasGitBash = isWindows ? findGitBashPathOrNull() !== null : true,
): string {
  const base = wrapPowerShellHookCommand(command, hookEvent)
  if (
    isPowerShellScriptHeader(command) ||
    hook.shell !== undefined ||
    hookEvent === 'StatusLine' ||
    hookEvent === 'FileSuggestion' ||
    !shouldBlockNoBashGuard(hook, hookEvent, isWindows, hasGitBash)
  ) {
    return base
  }
  return (
    base +
    `\n; if (-not $?) { exit 1 }\n` +
    `; $claudeNoVerdict = $false\n` +
    `; try { $claudeSeen = $false; $claudeOnlyStrings = $true; foreach ($claudeStatement in $MyInvocation.MyCommand.ScriptBlock.Ast.EndBlock.Statements) { if ($claudeStatement.Extent.StartOffset -lt ${command.length}) { $claudeSeen = $true; $claudeElements = 0; foreach ($claudeElement in $claudeStatement.PipelineElements) { $claudeElements++; if ($claudeElement.PSTypeNames -notcontains 'System.Management.Automation.Language.CommandExpressionAst') { $claudeOnlyStrings = $false } elseif ($claudeElement.Expression.PSTypeNames -contains 'System.Management.Automation.Language.ExpandableStringExpressionAst') { foreach ($claudeNested in $claudeElement.Expression.NestedExpressions) { if ($claudeNested.PSTypeNames -contains 'System.Management.Automation.Language.SubExpressionAst') { $claudeOnlyStrings = $false } } } elseif ($claudeElement.Expression.PSTypeNames -notcontains 'System.Management.Automation.Language.StringConstantExpressionAst') { $claudeOnlyStrings = $false } }; if ($claudeElements -ne 1) { $claudeOnlyStrings = $false } } }; $claudeNoVerdict = $claudeSeen -and $claudeOnlyStrings } catch { }\n` +
    `; if ($claudeNoVerdict) { exit ${NO_BASH_ONLY_STRINGS_EXIT_CODE} }\n` +
    `; $claudeNoVerdict = $false`
  )
}

/**
 * Official rRe(e, n) (#698, #1149): on Windows without Git for Windows, a PreToolUse
 * or PermissionRequest command hook (even with `shell: "powershell"`) that sets
 * no `args` and no `onFailure: "continue"` acts as a guard — if it fails, block
 * the call instead of failing open.
 */
export function shouldBlockNoBashGuard(
  hook: HookWithOnFailure & {
    type?: string
    shell?: string
    args?: unknown
    async?: boolean
    asyncRewake?: boolean
  },
  hookEvent: HookEvent,
  isWindows = getPlatform() === 'windows',
  hasGitBash = isWindows ? findGitBashPathOrNull() !== null : true,
): boolean {
  return (
    hook.type === 'command' &&
    hook.async !== true &&
    hook.asyncRewake !== true &&
    hook.args === undefined &&
    hook.onFailure !== 'continue' &&
    isWindows &&
    !hasGitBash &&
    (hookEvent === 'PreToolUse' || hookEvent === 'PermissionRequest')
  )
}

export function shouldBlockOnFailureForEvent(
  hook: HookWithOnFailure,
  hookEvent: HookEvent,
): boolean {
  return (
    (isOnFailureBlock(hook) &&
      !ON_FAILURE_BLOCK_IGNORED_EVENTS.has(hookEvent)) ||
    shouldBlockNoBashGuard(hook, hookEvent)
  )
}

/**
 * Gold `$in` — convert a failed or timed-out hook result into a blocking
 * result when `onFailure: "block"` is active for the hook and event (#343),
 * or when a Windows PreToolUse/PermissionRequest guard fails without Git Bash (#698).
 */
export function applyOnFailureBlockToHookResult(
  result: HookResult,
  hookEvent: HookEvent,
  signal?: AbortSignal,
  isWindows = getPlatform() === 'windows',
  hasGitBash = isWindows ? findGitBashPathOrNull() !== null : true,
): HookResult {
  const hook = result.hook as HookResult['hook'] & HookWithOnFailure
  const blockReason = isOnFailureBlock(hook)
    ? 'setting'
    : shouldBlockNoBashGuard(hook, hookEvent, isWindows, hasGitBash)
      ? 'noBash'
      : undefined
  if (blockReason === undefined) return result

  const stoppedAfterItsTimeout =
    (result as HookResult & { stoppedAfterItsTimeout?: boolean })
      .stoppedAfterItsTimeout === true
  const failureKind =
    result.outcome === 'cancelled' &&
    hook.type !== 'callback' &&
    (signal?.aborted !== true || stoppedAfterItsTimeout)
      ? 'timed out'
      : result.outcome === 'non_blocking_error'
        ? 'failed'
        : undefined
  if (failureKind === undefined) return result

  if (ON_FAILURE_BLOCK_IGNORED_EVENTS.has(hookEvent)) {
    logForDebugging(
      `Hooks: ${hookEvent} ${hook.type} hook ${failureKind}; not blocking (onFailure: "block" is ignored on ${hookEvent})`,
      { level: 'warn' },
    )
    return result
  }

  const command = getHookDisplayText(hook)
  const att =
    result.message &&
    typeof result.message === 'object' &&
    'type' in result.message &&
    result.message.type === 'attachment' &&
    'attachment' in result.message
      ? (result.message.attachment as {
          type?: string
          stderr?: string
          exitCode?: number
        })
      : undefined
  const detail =
    att?.type === 'hook_non_blocking_error' && typeof att.stderr === 'string'
      ? att.stderr.trim()
      : ''
  const sanitizedDetail = escapeSystemReminderTags(detail)
  const onlyStringsNoBash =
    !ON_FAILURE_BLOCK_IGNORED_EVENTS.has(hookEvent) &&
    att?.type === 'hook_non_blocking_error' &&
    att.exitCode === NO_BASH_ONLY_STRINGS_EXIT_CODE &&
    hook.type === 'command' &&
    (hook as { shell?: string }).shell === undefined &&
    shouldBlockNoBashGuard(hook, hookEvent, isWindows, hasGitBash)
  const reasonPhrase = onlyStringsNoBash
    ? `blocking because Git Bash wasn't found, so only exit code 0 or 2 counts as this hook's verdict. The hook ended with exit code 127. If its command is only quoted strings, PowerShell started no program. To run a program, install Git for Windows (https://git-scm.com/downloads/win) and start a new session, or put the program in "command" and its arguments in "args" ("args": [] if it has none) and set "onFailure" to "block" so that failures still block. To print this text, such as a JSON answer, set "shell" to "powershell". The user needs to do this; Claude should not change the hook.`
    : blockReason === 'noBash'
      ? hook.type === 'command' &&
        (hook as { shell?: string }).shell === 'powershell'
        ? 'blocking because Git Bash wasn\'t found, so only exit code 0 or 2 counts as this hook\'s verdict. Make the hook end with exit code 0 or 2, or set "onFailure" to "continue" to let its failures pass.'
        : "blocking because Git Bash wasn't found"
      : 'blocking because onFailure is "block"'
  const blockingText = `[${command}]: ${failureKind}; ${reasonPhrase}${sanitizedDetail === '' ? '' : `\n${sanitizedDetail}`}`

  logForDebugging(
    `Hooks: ${hookEvent} ${hook.type} hook ${failureKind}; ${reasonPhrase}`,
    { level: 'warn' },
  )

  return {
    ...result,
    message: undefined,
    blockingError: {
      blockingError: blockingText,
      command,
    },
    ...(hookEvent === 'PermissionRequest' && {
      permissionRequestResult: {
        behavior: 'deny' as const,
        message: blockingText,
      },
    }),
    suppressOriginalPrompt: true,
    outcome: 'blocking',
  }
}

/**
 * Gold `Hin` — convert an unsuccessful, non-cancelled outside-REPL hook result
 * into a blocked result when `onFailure: "block"` is set (#343).
 */
export function applyOnFailureBlockToAggregatedHookResult(
  hook: HookWithOnFailure,
  aggregated: HookOutsideReplResult,
  hookEvent?: HookEvent,
): HookOutsideReplResult {
  if (
    (hookEvent !== undefined &&
      ON_FAILURE_BLOCK_IGNORED_EVENTS.has(hookEvent)) ||
    !isOnFailureBlock(hook) ||
    aggregated.succeeded ||
    aggregated.blocked ||
    aggregated.cancelled === true
  ) {
    return aggregated
  }
  const timedOut = aggregated.output === 'Hook cancelled'
  const detail = timedOut ? '' : aggregated.output.trim()
  return {
    ...aggregated,
    blocked: true,
    output: `${timedOut ? 'timed out' : 'failed'}; blocking because onFailure is "block"${detail === '' ? '' : `\n${detail}`}`,
  }
}

export type IfConditionMatcher = (ifCondition: string) => boolean

export type FunctionHookMatcher = {
  matcher: string
  hooks: FunctionHook[]
}

/**
 * A hook paired with optional plugin context.
 * Used when returning matched hooks so we can apply plugin env vars at execution time.
 */
export type MatchedHook = {
  hook: HookCommand | HookCallback | FunctionHook
  pluginRoot?: string
  pluginId?: string
  skillRoot?: string
  hookSource?: string
  isManagedHook?: boolean
  projectRoot?: string
  matcherIsMatchAll?: boolean
  /** densable TVt asOwnTool — plugin matcher hit the remapped own tool. */
  asOwnTool?: boolean
  /** densable TVt asStandIn — matcher also hits the original tool_name. */
  asStandIn?: boolean
  /** Official #1386 — matcher matched via a family/stand-in name (e.g. Monitor -> Bash). */
  matcherMetThroughOtherName?: string
  /** Official #1386 — hook should receive the remapped family stand-in input. */
  throughFamilyOnly?: boolean
  /** Official #1868 — SDK host callback metadata for ask-reason precedence. */
  sdkHost?: boolean
  hostOwnsStdin?: boolean
  deviceForwarded?: boolean
  sessionServer?: boolean
}

export type PluginHookMatcherIdentity = {
  pluginId: string
  pluginName: string
}

export type SessionStartHookExecutionOptions = {
  newPluginsOnly?: {
    owed: (
      plugins: readonly PluginHookMatcherIdentity[],
    ) => PluginHookMatcherIdentity[]
  }
  onMatched?: (
    matchedPlugins: readonly PluginHookMatcherIdentity[],
    matchedCount: number,
  ) => void
  orphaned?: AbortSignal
  storageV5?: unknown
  /** 2.1.323 #2103: subagent id forwarded on post-compaction SessionStart hooks. */
  agentId?: string
}
