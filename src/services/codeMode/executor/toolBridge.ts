/**
 * In-VM inner tool dispatch bridge for Code Mode scripts.
 *
 * Routes every nested tool call inside a Code Mode script through:
 * - live effective tool pool enforcement & path normalization (`~` + worktree cwd)
 * - schema validation (`safeParseWithCircularTransformGuard`) & `validateInput`
 * - prefixed shell `dangerousRemoval` circuit-breaker check
 * - managed PreToolUse pre-pass + `runPreToolUseHooks` (`updatedInput`, `continue: false`)
 * - deferred auto-mode script classification (`awaitVerdict`) & stop chain
 * - permission pipeline (`resolveHookPermissionDecision`, `sandbox_auto_allow_suspended`)
 * - remote native tool TOCTOU guard (`permissionCheckedFor` / `runnerCheckedHere`)
 * - `PostToolUse` / `PostToolUseFailure` hooks, `EnterWorktree` cwd sync,
 *   expired MCP auth sync, approval feedback, Skill body & media extraction.
 */
import type { REPLMediaBlock } from '@claude-code/builtin-tools/tools/REPLTool/REPLTool.js'
import { setCwdState } from '../../../bootstrap/state.js'
import type { HostPermissionLayer } from '../../../engine/hostPermissionLayers.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import {
  consumeRemoteNativeToolLocallyChecked,
  getRemoteNativeToolCheck,
  getRemoteNativeToolRunner,
  type Tool,
  type ToolResult,
  type ToolUseContext,
} from '../../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
} from '../../../types/message.js'
import { createAttachmentMessage } from '../../../utils/attachments.js'
import { getCwd } from '../../../utils/cwd.js'
import type {
  ManagedPreToolPassResult,
  ToolCallManagedPass,
} from '../../../utils/hooks/toolCallManagedPass.js'
import type { PermissionResult } from '../../../utils/permissions/PermissionResult.js'
import { safeParseWithCircularTransformGuard } from '../replDosGuards.js'
import type { CodeModeAutoVerdictTracker } from './autoVerdict.js'
import { checkPrefixedCodeModeShellCommand } from './shellTemplate.js'
import {
  extractApprovalUserFeedback,
  extractEnteredWorktreePath,
  extractMediaBlocksFromToolData,
  normalizeCodeModeToolInput,
  resolveCodeModeEffectiveTools,
  syncExpiredMcpAuthInCodeMode,
} from './toolHelpers.js'
import type { CodeModeToolInvoker } from './types.js'

const CODE_MODE_HOOK_HALT_REFUSAL =
  "This tool call did not run. A hook returned continue: false for another tool call from the same piece of code, so every further tool call from it is refused. The hook's reason is sent with that code's result."

// Official 2.1.328 (@325273887): inner hook feedback attachment types
// surfaced on the Code Mode script result via ToolResult.newMessages.
const CODE_MODE_HOOK_FEEDBACK_TYPES = new Set([
  'hook_blocking_error',
  'hook_additional_context',
  'hook_stopped_continuation',
  'hook_system_message',
])

function extractTextFromSkillMessages(
  msgs: NonNullable<ToolResult<unknown>['newMessages']>,
): string {
  const chunks: string[] = []
  for (const m of msgs) {
    if (m.type !== 'user' || !('message' in m) || !m.message) continue
    const content = m.message.content
    if (typeof content === 'string') {
      const trimmed = content.trim()
      if (trimmed.length > 0) chunks.push(trimmed)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string'
        ) {
          const trimmed = (block as { text: string }).text.trim()
          if (trimmed.length > 0) chunks.push(trimmed)
        }
      }
    }
  }
  return chunks.join('\n\n')
}

function extractHookAttachmentMessage(
  entry: unknown,
): AttachmentMessage | undefined {
  if (!entry || typeof entry !== 'object') return undefined
  const obj = entry as { type?: string; message?: unknown }
  if (obj.type === 'attachment' && 'attachment' in obj) {
    return obj as AttachmentMessage
  }
  if (
    obj.message &&
    typeof obj.message === 'object' &&
    (obj.message as { type?: string }).type === 'attachment' &&
    'attachment' in (obj.message as object)
  ) {
    return obj.message as AttachmentMessage
  }
  return undefined
}

export type CreateCodeModeToolBridgeOptions = {
  baseReplToolName: string
  resolveAvailableTools: () => readonly Tool[]
  initialContext: ToolUseContext
  initialCwd: string
  getDepsCwd?: () => string | undefined
  canUseTool: CanUseToolFn
  parentMessage: AssistantMessage
  currentPermissionMode: string | undefined
  codeModeAutoVerdictTracker: CodeModeAutoVerdictTracker
  scriptId: string
  scriptAbortController: AbortController
  getScriptAutoBlockedReason: () => string | undefined
  allowedToolNames: ReadonlySet<string> | undefined
}

export type CodeModeToolBridge = {
  invokeTool: CodeModeToolInvoker
  getCachedFileContent: ((filePath: string) => string | undefined) | undefined
  collectedFeedback: string[]
  collectedHookMessages: AttachmentMessage[]
  collectedToolNewMessages: NonNullable<ToolResult<unknown>['newMessages']>
  collectedContextModifiers: Array<
    NonNullable<ToolResult<unknown>['contextModifier']>
  >
  collectedContextLayers: NonNullable<ToolResult<unknown>['contextLayers']>
  collectedMedia: REPLMediaBlock[]
  isHookHalted: () => boolean
  getHookStopReason: () => string | undefined
}

export function createCodeModeToolBridge(
  opts: CreateCodeModeToolBridgeOptions,
): CodeModeToolBridge {
  const {
    baseReplToolName,
    resolveAvailableTools,
    initialContext,
    initialCwd,
    getDepsCwd,
    canUseTool,
    parentMessage,
    currentPermissionMode,
    codeModeAutoVerdictTracker,
    scriptId,
    scriptAbortController,
    getScriptAutoBlockedReason,
    allowedToolNames,
  } = opts

  let activeCwd = initialCwd
  let activeScriptContext: ToolUseContext = initialContext
  let scriptHookHalted = false
  let scriptHookStopReason: string | undefined
  let innerCallSeq = 0

  const collectedFeedback: string[] = []
  const collectedHookMessages: AttachmentMessage[] = []
  const collectedToolNewMessages: NonNullable<
    ToolResult<unknown>['newMessages']
  > = []
  const seenToolNewMessageKeys = new Set<string>()
  const collectedContextModifiers: Array<
    NonNullable<ToolResult<unknown>['contextModifier']>
  > = []
  const collectedContextLayers: NonNullable<
    ToolResult<unknown>['contextLayers']
  > = []
  const collectedMedia: REPLMediaBlock[] = []

  const recordHookFeedbackMessage = (
    msg: AttachmentMessage | undefined,
  ): void => {
    if (!msg || msg.type !== 'attachment') return
    const att = msg.attachment as {
      type?: string
      message?: string
    }
    if (!att?.type || !CODE_MODE_HOOK_FEEDBACK_TYPES.has(att.type)) return
    if (att.type === 'hook_stopped_continuation') {
      if (scriptHookHalted && scriptHookStopReason !== undefined) {
        return
      }
      scriptHookHalted = true
      if (typeof att.message === 'string' && att.message.length > 0) {
        scriptHookStopReason = att.message
      }
      if (
        !collectedHookMessages.some(
          m => m.attachment.type === 'hook_stopped_continuation',
        )
      ) {
        collectedHookMessages.push(msg)
      }
      return
    }
    collectedHookMessages.push(msg)
  }

  const getCachedFileContent:
    | ((filePath: string) => string | undefined)
    | undefined =
    !allowedToolNames || allowedToolNames.has('Read')
      ? filePath => {
          const normalized = normalizeCodeModeToolInput(
            'Read',
            { file_path: filePath },
            activeCwd,
          )
          const resolvedPath =
            typeof normalized.file_path === 'string'
              ? normalized.file_path
              : filePath
          const entry =
            activeScriptContext.readFileState?.get(resolvedPath) ??
            activeScriptContext.readFileState?.get(filePath)
          return typeof entry?.content === 'string' && entry.content.length > 0
            ? entry.content
            : undefined
        }
      : undefined

  const invokeTool: CodeModeToolInvoker = async (
    toolName,
    rawInput,
    execSignal,
  ) => {
    const blockedReason = getScriptAutoBlockedReason()
    if (blockedReason !== undefined) {
      throw new Error(blockedReason)
    }
    if (execSignal?.aborted || scriptAbortController.signal.aborted) {
      throw new Error(
        getScriptAutoBlockedReason() ?? 'Code Mode script aborted',
      )
    }
    if (scriptHookHalted) {
      throw new Error(CODE_MODE_HOOK_HALT_REFUSAL)
    }
    // Official 2.1.328 (#572 & #581): re-resolve live MCP tools on main
    // thread while continuing to enforce restricted/subagent tool pools.
    const allTools = resolveCodeModeEffectiveTools(
      baseReplToolName,
      resolveAvailableTools,
      activeScriptContext,
    )
    const target = allTools.find(
      t => t.name === toolName && t.name !== baseReplToolName,
    )
    if (!target) {
      throw new Error(`Tool not available in Code Mode: ${toolName}`)
    }
    // Official 2.1.325 #2314: always read live cwd (follows EnterWorktree)
    // and expand `~` / relative paths against it before schema validation.
    activeCwd = getDepsCwd?.() || getCwd() || activeCwd
    const normalizedInput = normalizeCodeModeToolInput(
      toolName,
      rawInput,
      activeCwd,
    )
    const parsed = safeParseWithCircularTransformGuard(
      target.inputSchema,
      normalizedInput,
    )
    if (!parsed.success) {
      throw new Error(
        `Invalid input for ${toolName}: ${parsed.error?.message ?? 'validation failed'}`,
      )
    }
    // Official 2.1.326 #232: run tool.validateInput before canUseTool,
    // check prefixed shell commands for dangerousRemoval circuit breakers,
    // and suspend sandbox auto-allow on inner Code Mode calls so more
    // sandboxed commands go through normal permission checks / ask / refuse.
    if (typeof target.validateInput === 'function') {
      const validation = await target.validateInput(
        parsed.data as never,
        activeScriptContext,
      )
      if (validation && validation.result === false) {
        throw new Error(validation.message ?? `Invalid input for ${toolName}`)
      }
    }
    if (toolName === 'Bash' || toolName === 'PowerShell') {
      const prefixedRefusal = await checkPrefixedCodeModeShellCommand(
        target,
        parsed.data as Record<string, unknown>,
        activeScriptContext,
      )
      if (prefixedRefusal !== undefined) {
        throw new Error(prefixedRefusal)
      }
    }

    const innerToolUseId = `${initialContext.toolUseId ?? 'repl'}:${toolName}:${++innerCallSeq}`
    const defaultPermissionContext = {
      mode: 'default' as const,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    }
    const safeGetAppState: ToolUseContext['getAppState'] =
      typeof activeScriptContext.getAppState === 'function'
        ? () => {
            const st = activeScriptContext.getAppState()
            if (st?.toolPermissionContext && st?.sessionHooks) return st
            return {
              ...st,
              ...(st?.toolPermissionContext
                ? {}
                : {
                    toolPermissionContext: defaultPermissionContext,
                  }),
              ...(st?.sessionHooks ? {} : { sessionHooks: new Map() }),
            }
          }
        : () =>
            ({
              toolPermissionContext: defaultPermissionContext,
              sessionHooks: new Map(),
            }) as ReturnType<ToolUseContext['getAppState']>

    // Wire per-call AbortController so script timeout / auto-mode stop
    // aborts in-flight inner tools immediately.
    const innerCallAbortController = new AbortController()
    let onExecAbort: (() => void) | undefined
    if (execSignal?.aborted || scriptAbortController.signal.aborted) {
      innerCallAbortController.abort(
        execSignal?.reason ?? scriptAbortController.signal.reason,
      )
    } else {
      onExecAbort = () =>
        innerCallAbortController.abort(
          execSignal?.reason ?? scriptAbortController.signal.reason,
        )
      execSignal?.addEventListener('abort', onExecAbort, {
        once: true,
      })
      scriptAbortController.signal.addEventListener('abort', onExecAbort, {
        once: true,
      })
    }

    const innerHookContext: ToolUseContext = {
      ...activeScriptContext,
      abortController: innerCallAbortController,
      toolUseId: innerToolUseId,
      options: activeScriptContext.options ?? ({} as ToolUseContext['options']),
      getAppState: safeGetAppState,
    }
    const hooksActive =
      innerHookContext.options.settingsHooksOff !== true &&
      innerHookContext.options.bareFork !== true
    const messageId = parentMessage?.message?.id ?? ''
    const requestId = parentMessage?.requestId

    let currentInput = parsed.data as Record<string, unknown>
    let managedPrePassRan = false
    let hookPermissionResult: PermissionResult | undefined
    let shouldPreventContinuation = false
    let stopReason: string | undefined

    // Lazy-load hook & permission modules to avoid static import cycles
    // (hooks.ts -> settings/tools -> codeMode/executor.ts).
    const [
      hooksMod,
      toolHooksMod,
      managedPassMod,
      functionHooksHopMod,
      mcpUtilsMod,
    ] = await Promise.all([
      import('../../../utils/hooks.js'),
      import('../../tools/toolHooks.js'),
      import('../../../utils/hooks/toolCallManagedPass.js'),
      import('../../../utils/plugins/functionHooksHop.js'),
      import('../../mcp/utils.js'),
    ])
    const { executePreToolHooks } = hooksMod
    const {
      collectManagedOnlyPostToolUse,
      resolveHookPermissionDecision,
      runPostToolUseFailureHooks,
      runPostToolUseHooks,
      runPreToolUseHooks,
    } = toolHooksMod
    const { shouldPreserveManagedToolHookPass } = managedPassMod
    const { pinValue } = functionHooksHopMod
    const { isMcpTool } = mcpUtilsMod

    // Official 2.1.328 (@325454468 / @325274402): wire full PreToolUse
    // hooks (including managed pre-pass, updatedInput, and continue:false
    // halting subsequent inner calls in the script) before permission/call.
    if (hooksActive) {
      const managedMode = safeGetAppState().toolPermissionContext.mode
      const managedResult: ManagedPreToolPassResult = {}
      const managedReplayYields: unknown[] = []
      for await (const item of executePreToolHooks(
        target.name,
        innerToolUseId,
        currentInput,
        innerHookContext,
        managedMode,
        innerHookContext.abortController.signal,
        undefined,
        undefined,
        target.getToolUseSummary?.(currentInput),
        { managedHooksOnly: true },
      )) {
        if (item.preventContinuation) {
          const reason =
            item.stopReason || 'Execution stopped by PreToolUse hook'
          scriptHookHalted = true
          if (!innerHookContext.abortController.signal.aborted) {
            recordHookFeedbackMessage(
              createAttachmentMessage({
                type: 'hook_stopped_continuation',
                message: reason,
                hookName: `PreToolUse:${target.name}`,
                toolUseID: innerToolUseId,
                hookEvent: 'PreToolUse',
              }),
            )
          }
          throw new Error(reason)
        }
        if (item.blockingError) {
          const msg =
            item.blockingError.blockingError ||
            `PreToolUse hook blocked ${toolName}`
          managedResult.deny = msg
          throw new Error(msg)
        }
        if (item.permissionBehavior === 'deny') {
          const msg =
            item.hookPermissionDecisionReason ||
            `PreToolUse hook denied ${toolName}`
          managedResult.deny = msg
          throw new Error(msg)
        }
        if (item.permissionBehavior === 'ask') {
          managedResult.ask =
            item.hookPermissionDecisionReason ||
            `PreToolUse hook requires confirmation for ${toolName}`
        } else if (item.permissionBehavior === 'allow') {
          managedResult.allow = true
        }
        if (item.updatedInput !== undefined) {
          const parsedUpdated = safeParseWithCircularTransformGuard(
            target.inputSchema,
            item.updatedInput,
          )
          const remainingIssues = parsedUpdated.success
            ? []
            : (parsedUpdated.error?.issues ?? []).filter(
                issue => issue.code !== 'unrecognized_keys',
              )
          if (!parsedUpdated.success && remainingIssues.length > 0) {
            throw new Error(
              `PreToolUse hook for ${toolName} returned updatedInput that failed schema validation`,
            )
          }
          currentInput = normalizeCodeModeToolInput(
            toolName,
            item.updatedInput,
            activeCwd,
          )
          managedResult.updatedInput = currentInput
        }
        if (item.additionalContexts?.length) {
          managedResult.additionalContext = [
            ...(managedResult.additionalContext ?? []),
            ...item.additionalContexts,
          ]
        }
        const {
          permissionBehavior,
          hookPermissionDecisionReason: _reason,
          blockingError: _blocking,
          updatedInput: _input,
          additionalContexts: _contexts,
          ...rest
        } = item as Record<string, unknown>
        if (permissionBehavior === 'defer') {
          managedReplayYields.push({
            permissionBehavior,
            hookSource: rest.hookSource,
          })
        }
        if (Object.keys(rest).some(key => key !== 'hookSource')) {
          managedReplayYields.push(rest)
        }
      }
      const managedPass: ToolCallManagedPass = {
        toolUseId: innerToolUseId,
        input: currentInput,
        inputKey: () => pinValue(currentInput),
        pass: {
          result: managedResult,
          yields: managedReplayYields,
        },
      }
      innerHookContext.managedPass = managedPass
      managedPrePassRan = true

      for await (const hookRes of runPreToolUseHooks(
        innerHookContext,
        target,
        currentInput,
        innerToolUseId,
        messageId,
        requestId,
        undefined,
        undefined,
      )) {
        switch (hookRes.type) {
          case 'message':
            recordHookFeedbackMessage(
              extractHookAttachmentMessage(hookRes.message),
            )
            break
          case 'additionalContext':
            recordHookFeedbackMessage(
              extractHookAttachmentMessage(hookRes.message),
            )
            break
          case 'hookPermissionResult':
            if (
              hookPermissionResult?.behavior !== 'deny' ||
              hookRes.hookPermissionResult.behavior === 'deny'
            ) {
              hookPermissionResult = hookRes.hookPermissionResult
            }
            break
          case 'hookUpdatedInput':
            currentInput = normalizeCodeModeToolInput(
              toolName,
              hookRes.updatedInput,
              activeCwd,
            )
            break
          case 'preventContinuation':
            if (hookRes.shouldPreventContinuation) {
              shouldPreventContinuation = true
              scriptHookHalted = true
            }
            break
          case 'stopReason':
            stopReason = hookRes.stopReason
            break
          case 'stop': {
            const reason =
              hookRes.stopReason ??
              stopReason ??
              'Execution stopped by PreToolUse hook'
            if (shouldPreventContinuation || hookRes.stopReason) {
              scriptHookHalted = true
              if (!innerHookContext.abortController.signal.aborted) {
                recordHookFeedbackMessage(
                  createAttachmentMessage({
                    type: 'hook_stopped_continuation',
                    message: reason,
                    hookName: `PreToolUse:${target.name}`,
                    toolUseID: innerToolUseId,
                    hookEvent: 'PreToolUse',
                  }),
                )
              }
            }
            throw new Error(reason)
          }
          case 'defer':
            throw new Error(
              `PreToolUse hook ${hookRes.hookName} returned permissionDecision=defer, which is not supported inside Code Mode`,
            )
        }
      }
      if (shouldPreventContinuation) {
        const reason = stopReason ?? 'Execution stopped by PreToolUse hook'
        scriptHookHalted = true
        if (!innerHookContext.abortController.signal.aborted) {
          recordHookFeedbackMessage(
            createAttachmentMessage({
              type: 'hook_stopped_continuation',
              message: reason,
              hookName: `PreToolUse:${target.name}`,
              toolUseID: innerToolUseId,
              hookEvent: 'PreToolUse',
            }),
          )
        }
        throw new Error(reason)
      }
    }

    // Official 2.1.328 (`J.scriptChecks.awaitVerdict`): if this script
    // or any queued script in the batch has a deferred auto-mode check,
    // run it before executing the inner tool and fire the stop chain if blocked.
    const scriptRecord = codeModeAutoVerdictTracker.getRecord(scriptId)
    if (
      scriptRecord?.state === 'unchecked' ||
      codeModeAutoVerdictTracker.hasUnchecked()
    ) {
      const deferredVerdict = await codeModeAutoVerdictTracker.awaitVerdict(
        scriptId,
        innerHookContext,
        canUseTool,
      )
      if (deferredVerdict.kind === 'blocked') {
        const blockedMsg =
          getScriptAutoBlockedReason() ??
          (deferredVerdict.decision.behavior === 'deny'
            ? deferredVerdict.decision.message
            : undefined) ??
          `Permission denied for ${toolName}`
        throw new Error(blockedMsg)
      }
    }
    const postVerdictBlockedReason = getScriptAutoBlockedReason()
    if (postVerdictBlockedReason !== undefined) {
      throw new Error(postVerdictBlockedReason)
    }

    const ridesAutoVerdict = codeModeAutoVerdictTracker.ridesNow(scriptId)
    const currentScriptState =
      codeModeAutoVerdictTracker.getRecord(scriptId)?.state
    const suspendLayer: HostPermissionLayer = {
      kind: 'sandbox_auto_allow_suspended',
      allowOnly: true,
    }
    const innerPermissionContext: ToolUseContext = {
      ...innerHookContext,
      ...(ridesAutoVerdict ? { replScriptInner: true } : {}),
      ...(currentScriptState === 'atLimit' ? { replScriptAtLimit: true } : {}),
      permissionLayers: [
        ...(activeScriptContext.permissionLayers ?? []),
        suspendLayer,
      ],
    }
    const innerRemoteRunnerAtStart = getRemoteNativeToolRunner(
      innerPermissionContext.session,
      target.name,
    )
    const innerRemotePermCheckedFor =
      getRemoteNativeToolCheck(innerPermissionContext.session, target.name) !==
      undefined
        ? innerRemoteRunnerAtStart
        : innerRemoteRunnerAtStart === undefined
          ? null
          : undefined
    const innerRemoteRunnerCheckedHere =
      innerRemotePermCheckedFor !== undefined &&
      innerRemotePermCheckedFor !== null
        ? undefined
        : innerRemoteRunnerAtStart
    const resolved = await resolveHookPermissionDecision(
      hookPermissionResult,
      target,
      currentInput,
      innerPermissionContext,
      canUseTool,
      parentMessage,
      innerToolUseId,
    )
    const permission = resolved.decision
    if (permission.behavior !== 'allow') {
      if (currentPermissionMode === 'auto') {
        codeModeAutoVerdictTracker.markBlocked(
          scriptId,
          permission.message ?? `Permission denied for ${toolName}`,
          permission,
        )
      }
      throw new Error(permission.message ?? `Permission denied for ${toolName}`)
    }
    const finalInput = normalizeCodeModeToolInput(
      toolName,
      (permission.updatedInput as Record<string, unknown> | undefined) ??
        resolved.input,
      activeCwd,
    )
    const callStartMs = Date.now()
    const innerLocalCheckDeferred = consumeRemoteNativeToolLocallyChecked(
      innerHookContext.session,
      innerToolUseId,
    )
    let out: ToolResult<unknown>
    try {
      out = (await target.call(
        finalInput as never,
        innerHookContext,
        canUseTool,
        parentMessage,
        undefined,
        {
          userModified: permission.userModified ?? false,
          permissionCheckedFor: innerRemoteRunnerAtStart ?? null,
          runnerCheckedHere: innerLocalCheckDeferred
            ? innerRemoteRunnerAtStart
            : innerRemoteRunnerCheckedHere,
        },
      )) as ToolResult<unknown>
    } catch (callErr) {
      // Official 2.1.325 #2314: sync expired MCP server auth to /mcp.
      syncExpiredMcpAuthInCodeMode(
        toolName,
        callErr,
        initialContext.setAppState,
      )
      if (hooksActive) {
        const errText =
          callErr instanceof Error ? callErr.message : String(callErr)
        try {
          for await (const failureRes of runPostToolUseFailureHooks(
            innerHookContext,
            target,
            innerToolUseId,
            messageId,
            finalInput,
            errText,
            innerHookContext.abortController.signal.aborted,
            requestId,
            undefined,
            undefined,
            Date.now() - callStartMs,
          )) {
            if ('message' in failureRes) {
              recordHookFeedbackMessage(
                extractHookAttachmentMessage(failureRes.message),
              )
            }
          }
        } catch {
          // Never swallow the underlying tool error
        }
      }
      throw callErr
    } finally {
      if (onExecAbort !== undefined) {
        execSignal?.removeEventListener('abort', onExecAbort)
        scriptAbortController.signal.removeEventListener('abort', onExecAbort)
      }
    }
    const callDurationMs = Date.now() - callStartMs
    if (hooksActive) {
      let hookData = out.data
      for await (const postRes of runPostToolUseHooks(
        innerHookContext,
        target,
        innerToolUseId,
        messageId,
        finalInput,
        hookData,
        requestId,
        undefined,
        undefined,
        callDurationMs,
      )) {
        if ('message' in postRes) {
          recordHookFeedbackMessage(
            extractHookAttachmentMessage(postRes.message),
          )
        }
        if (
          'updatedToolOutput' in postRes &&
          (isMcpTool(target) ||
            target.outputSchema?.safeParse(postRes.updatedToolOutput)
              ?.success !== false)
        ) {
          hookData = postRes.updatedToolOutput
        }
      }
      if (
        managedPrePassRan &&
        (shouldPreserveManagedToolHookPass(innerHookContext, target) ||
          target.preserveToolUseResultInSubagents === true)
      ) {
        const managedPost = await collectManagedOnlyPostToolUse({
          tool: target,
          toolUseID: innerToolUseId,
          toolInput: finalInput,
          output: hookData,
          toolUseContext: innerHookContext,
          durationMs: callDurationMs,
        })
        if (
          managedPost.rewritten &&
          (isMcpTool(target) ||
            target.outputSchema?.safeParse(managedPost.output)?.success !==
              false)
        ) {
          hookData = managedPost.output
        }
        for (const m of managedPost.messages) {
          recordHookFeedbackMessage(extractHookAttachmentMessage(m))
        }
      }
      out = { ...out, data: hookData }
    }
    // Official 2.1.328 (@325563762): forward inner Skill (and any inner
    // tool's) `newMessages`, `contextModifier`, and `contextLayers` to
    // the outer REPLTool result and apply modifiers immediately for
    // subsequent calls within the same script.
    if (Array.isArray(out.newMessages) && out.newMessages.length > 0) {
      for (const m of out.newMessages) {
        let dedupeKey: string
        try {
          dedupeKey = JSON.stringify(
            (m.type === 'user' || m.type === 'assistant') && 'message' in m
              ? [m.type, m.message?.content]
              : m,
          )
        } catch {
          dedupeKey = String(collectedToolNewMessages.length)
        }
        if (seenToolNewMessageKeys.has(dedupeKey)) continue
        seenToolNewMessageKeys.add(dedupeKey)
        collectedToolNewMessages.push(m)
      }
    }
    if (typeof out.contextModifier === 'function') {
      collectedContextModifiers.push(out.contextModifier)
      activeScriptContext = out.contextModifier(activeScriptContext)
    }
    if (Array.isArray(out.contextLayers) && out.contextLayers.length > 0) {
      collectedContextLayers.push(...out.contextLayers)
      activeScriptContext = {
        ...activeScriptContext,
        permissionLayers: [
          ...(activeScriptContext.permissionLayers ?? []),
          ...out.contextLayers,
        ],
      }
    }

    // Official 2.1.325 #2314: follow newly entered worktree immediately.
    const enteredWorktree = extractEnteredWorktreePath(toolName, out.data)
    if (enteredWorktree) {
      activeCwd = enteredWorktree
      setCwdState(enteredWorktree)
    }
    // Official 2.1.325 #2315: forward words typed with Yes at permission
    // dialog or plan approval back to Claude.
    const feedback = extractApprovalUserFeedback(permission, out.data)
    if (feedback) {
      collectedFeedback.push(feedback)
    }
    if (
      toolName === 'Skill' &&
      Array.isArray(out.newMessages) &&
      out.newMessages.length > 0 &&
      out.data &&
      typeof out.data === 'object' &&
      !Array.isArray(out.data)
    ) {
      const rec = out.data as Record<string, unknown>
      if (
        rec.body === undefined &&
        rec.content === undefined &&
        rec.prompt === undefined
      ) {
        const body = extractTextFromSkillMessages(out.newMessages)
        if (body.length > 0) {
          return { ...rec, body }
        }
      }
    }
    const mediaBlocks = extractMediaBlocksFromToolData(out.data)
    if (mediaBlocks.length > 0) {
      collectedMedia.push(...mediaBlocks)
    }
    return out.data
  }

  return {
    invokeTool,
    getCachedFileContent,
    collectedFeedback,
    collectedHookMessages,
    collectedToolNewMessages,
    collectedContextModifiers,
    collectedContextLayers,
    collectedMedia,
    isHookHalted: () => scriptHookHalted,
    getHookStopReason: () => scriptHookStopReason,
  }
}
