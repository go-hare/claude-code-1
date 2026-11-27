/**
 * Code Mode `REPLTool` wrapper (`wrapReplToolForCodeModeWithExecutor`),
 * `Tool.create(deps)` DI adapter (E3-P1-3), async REPL dispatch/settle, and
 * per-session MCP/unset-var result assembly.
 */
import {
  isReplModeEnabled,
  REPL_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/REPLTool/constants.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import {
  createDefaultCanUseTool,
  resolveToolUseContext,
  type Tool,
  type ToolDeps,
  type ToolUseContext,
} from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import { getCwd } from '../../../utils/cwd.js'
import { getBootstrapSession } from '../../../utils/sessionHost.js'
import { saveReplMode } from '../../../utils/sessionStorage.js'
import {
  buildCodeModeMcpStatusDelta,
  CODE_MODE_STATIC_MCP_GUIDANCE,
} from '../../../utils/simpleSystemPrompt.js'
import {
  attachToolCreateAndRemoteRuntime,
  type RemoteNativeToolSession,
} from '../../../utils/toolCreateRuntime.js'
import { REPL_DETACH_AFTER_MS, REPL_SETTLE_WINDOW_MS } from '../constants.js'
import * as optInModule from '../optIn.js'
import { isCodeModeEnabled } from '../optIn.js'
import {
  ASYNC_REPL_MAX_EVALS,
  formatReplOutputEnvelope,
  getReplSessions,
} from '../replSessions.js'
import {
  CODE_MODE_HOOK_REWRITE_REASON,
  CODE_MODE_HOOK_REWRITE_REFUSAL,
  CODE_MODE_UNICODE_ESCAPE_REASON,
  CODE_MODE_UNICODE_ESCAPE_REFUSAL,
  formatAutoModeScriptBlockedMessage,
  getCodeModePostScriptPauseMs,
  hasUnicodeHexEscape,
} from './autoVerdict.js'
import {
  extractAssignedVars,
  extractTopLevelDeclaredVars,
} from './jsSourceAnalysis.js'
import { createCodeModeToolBridge } from './toolBridge.js'
import {
  buildConciseCodeModeToolDescription,
  diffCodeModeMcpServerStatus,
  resolveCodeModeEffectiveTools,
} from './toolHelpers.js'
import type {
  CodeModeExecutionResult,
  ExecuteCodeModeScriptOptions,
} from './types.js'
import { getExecutorSessionState } from './vmSession.js'

/**
 * Wraps the base `REPLTool` so that when Code Mode is active, `call()` executes
 * JavaScript in the VM sandbox via `executeScript` and routes every nested tool
 * invocation through `canUseTool` + the target tool's `call()` implementation.
 */
export function wrapReplToolForCodeModeWithExecutor(
  baseReplTool: Tool,
  resolveAvailableTools: () => readonly Tool[],
  executeScript: (
    options: ExecuteCodeModeScriptOptions,
  ) => Promise<CodeModeExecutionResult>,
): Tool {
  // Preserve lazy getters (e.g. `inputSchema`, `outputSchema`) from
  // `baseReplTool` without invoking them, and strip runtime methods so
  // `attachToolCreateAndRemoteRuntime` installs unified `create(deps)` +
  // remote-native-tool dispatch (E3-P1-3).
  const baseDescriptors: Record<string, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(baseReplTool)
  delete baseDescriptors.create
  delete baseDescriptors.call
  delete baseDescriptors.validateInput
  delete baseDescriptors.checkPermissions
  delete baseDescriptors.permissionCheckFailureDecision
  delete baseDescriptors.deriveObservableInput

  const built = Object.defineProperties({}, baseDescriptors) as Record<
    string,
    unknown
  >
  Object.assign(built, {
    aliases: ['Eval'],
    isEnabled() {
      return isCodeModeEnabled() || isReplModeEnabled()
    },
    userFacingName() {
      return isCodeModeEnabled() ? 'Code' : baseReplTool.name
    },
    toAutoClassifierInput(input: unknown) {
      return input &&
        typeof input === 'object' &&
        typeof (input as { code?: unknown }).code === 'string'
        ? (input as { code: string }).code
        : ''
    },
    suppressesAlwaysAllowRule() {
      return isCodeModeEnabled()
    },
    permissionNote(input: unknown, mode?: string) {
      if (!isCodeModeEnabled()) return undefined
      const desc =
        typeof input === 'object' &&
        input !== null &&
        'description' in input &&
        typeof (input as { description?: unknown }).description === 'string'
          ? (input as { description: string }).description.trim()
          : ''
      const baseNote =
        desc === ''
          ? "Yes runs Claude's code."
          : "Yes runs Claude's code. The line at the top is Claude's own summary of it, and nothing checks it against the code."
      return mode === undefined || mode === 'bypassPermissions'
        ? baseNote
        : `${baseNote} Each tool call that needs approval while this code runs is still checked on its own, by auto mode, by you or by a hook you've set up.`
    },
    async prompt(options: Parameters<Tool['prompt']>[0]) {
      const basePrompt = await baseReplTool.prompt(options)
      if (!isCodeModeEnabled()) {
        return basePrompt
      }
      const available = resolveAvailableTools().filter(
        t => t.name !== baseReplTool.name,
      )
      const conciseLines = await Promise.all(
        available.map(async t => {
          const rawDesc =
            typeof t.description === 'function'
              ? await t.description({} as never, {
                  isNonInteractiveSession: false,
                  toolPermissionContext: {
                    mode: 'default',
                    additionalWorkingDirectories: new Map(),
                    alwaysAllowRules: {},
                    alwaysDenyRules: {},
                    alwaysAskRules: {},
                    isBypassPermissionsModeAvailable: false,
                  },
                  tools: available,
                })
              : ''
          return `- ${t.name}: ${buildConciseCodeModeToolDescription(t.name, rawDesc)}`
        }),
      )
      const toolsBlock =
        conciseLines.length > 0
          ? `\n\nAvailable Code Mode tools (callable as async global functions, e.g. \`await Read({ file_path })\`, \`await Bash({ command })\`, or via \`callTool(name, input)\`):\n${conciseLines.join('\n')}`
          : ''
      const runtimeGuidance = [
        'VM Runtime Globals & Helpers:',
        '- Available tools are exposed as async global functions by name (PascalCase, e.g. `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `PowerShell`, `NotebookEdit`, `Agent`, and connected `mcp__*` tools) as well as lowercase shorthands.',
        '- `$` shell template helper: ``await $`git status` `` with safe quoting, `.nothrow()`, `.throws()`, `.quiet()`, `.timeout(ms)`, `.cwd(dir)`, `.env(obj)`, `.text()`, `.lines()`, `.json()`, `$.escape(s)`, and script-authored `{ raw: "..." }` literals.',
        '- Logging & inspection: `console.log`/`self.log`/`log`, `console.tail(n)`, `console.buffer()`, `console.dropped()`, `preview(value, maxChars)`, `searchTools(query, limit)`, `describeTool(name)`, `tools.list()`.',
        '- Top-level bindings (`const`/`let`/`var`/`function`/`class`) persist across calls in the same session.',
      ].join('\n')
      return `${basePrompt}\n\n${runtimeGuidance}${toolsBlock}\n\n${CODE_MODE_STATIC_MCP_GUIDANCE}`
    },
  })

  let wrappedTool!: Tool

  const wrappedDef = {
    name: baseReplTool.name,
    create(deps: ToolDeps) {
      let cachedBaseInstance:
        | ReturnType<NonNullable<Tool['create']>>
        | undefined
      const getBaseInstance = () => {
        if (
          cachedBaseInstance === undefined &&
          typeof baseReplTool.create === 'function'
        ) {
          cachedBaseInstance = baseReplTool.create(deps)
        }
        return cachedBaseInstance
      }

      return {
        async checkPermissions(
          input: unknown,
          callCtx: Parameters<
            NonNullable<
              ReturnType<NonNullable<Tool['create']>>['checkPermissions']
            >
          >[1],
        ) {
          const context = resolveToolUseContext(deps, callCtx)
          const mode =
            context.getAppState?.()?.toolPermissionContext?.mode ??
            deps.permissions?.()?.mode
          if (mode === 'auto') {
            const hookRewriteCtx = context as {
              inputChangedByHook?: boolean
              serverClassifierInputRewritten?: boolean
            }
            if (
              isCodeModeEnabled() &&
              (hookRewriteCtx.inputChangedByHook === true ||
                hookRewriteCtx.serverClassifierInputRewritten === true)
            ) {
              return {
                behavior: 'deny' as const,
                message: CODE_MODE_HOOK_REWRITE_REFUSAL,
                decisionReason: {
                  type: 'other' as const,
                  reason: CODE_MODE_HOOK_REWRITE_REASON,
                },
              }
            }
            const code =
              input &&
              typeof input === 'object' &&
              typeof (input as { code?: unknown }).code === 'string'
                ? (input as { code: string }).code
                : undefined
            if (
              isCodeModeEnabled() &&
              code !== undefined &&
              hasUnicodeHexEscape(code)
            ) {
              return {
                behavior: 'deny' as const,
                message: CODE_MODE_UNICODE_ESCAPE_REFUSAL,
                decisionReason: {
                  type: 'other' as const,
                  reason: CODE_MODE_UNICODE_ESCAPE_REASON,
                },
              }
            }
            return {
              behavior: 'passthrough' as const,
              message: `${REPL_TOOL_NAME} script requires classifier review.`,
            }
          }
          return {
            behavior: 'allow' as const,
            updatedInput: input as Record<string, unknown>,
          }
        },
        ...(baseReplTool.validateInput !== undefined
          ? {
              async validateInput(
                input: unknown,
                callCtx: Parameters<
                  NonNullable<
                    ReturnType<NonNullable<Tool['create']>>['validateInput']
                  >
                >[1],
              ) {
                const baseInst = getBaseInstance()
                if (typeof baseInst?.validateInput === 'function') {
                  return baseInst.validateInput(input as never, callCtx)
                }
                return baseReplTool.validateInput!(
                  input as never,
                  resolveToolUseContext(deps, callCtx),
                )
              },
            }
          : {}),
        async call(
          rawArgs: unknown,
          callCtx: Parameters<
            ReturnType<NonNullable<Tool['create']>>['call']
          >[1],
        ) {
          const input = rawArgs as {
            code: string
            description?: string
            timeout?: number
          }
          if (!isCodeModeEnabled()) {
            const baseInst = getBaseInstance()
            if (baseInst !== undefined) {
              return await baseInst.call(input as never, callCtx)
            }
            return await baseReplTool.call(
              input as never,
              resolveToolUseContext(deps, callCtx),
              callCtx.canUseTool ?? createDefaultCanUseTool(),
              callCtx.parentMessage as Parameters<Tool['call']>[3],
              callCtx.onProgress,
            )
          }

          const context = resolveToolUseContext(deps, callCtx)
          const canUseTool: CanUseToolFn =
            callCtx.canUseTool ?? createDefaultCanUseTool()
          const parentMessage = callCtx.parentMessage as AssistantMessage
          const onProgress = callCtx.onProgress

          const activeSession =
            deps.session ??
            (context.session as RemoteNativeToolSession | undefined) ??
            getBootstrapSession()

          const initialCwd = deps.cwd?.() ?? getCwd()
          const currentPermissionMode =
            context.getAppState?.()?.toolPermissionContext?.mode ??
            deps.permissions?.()?.mode
          // Official `chunk@294254613.js @3674600-3675200`: defense-in-depth in
          // auto mode — refuse hook-rewritten scripts and `\\uXXXX` escapes.
          if (currentPermissionMode === 'auto') {
            const hookRewriteCtx = context as {
              inputChangedByHook?: boolean
              serverClassifierInputRewritten?: boolean
            }
            const inputChangedByHook =
              hookRewriteCtx.inputChangedByHook === true ||
              hookRewriteCtx.serverClassifierInputRewritten === true ||
              (parentMessage as { serverClassifierInputRewritten?: boolean })
                ?.serverClassifierInputRewritten === true
            if (inputChangedByHook) {
              return {
                data: {
                  result: `Error: ${CODE_MODE_HOOK_REWRITE_REFUSAL}`,
                  tool_calls: 0,
                },
              }
            }
            if (
              typeof input.code === 'string' &&
              hasUnicodeHexEscape(input.code)
            ) {
              return {
                data: {
                  result: `Error: ${CODE_MODE_UNICODE_ESCAPE_REFUSAL}`,
                  tool_calls: 0,
                },
              }
            }
          }
          const executorState = getExecutorSessionState(activeSession)
          const { codeModeAutoVerdictTracker, sessionUnsetVarsByKey } =
            executorState
          const scriptId =
            context.toolUseId ?? `repl-${++executorState.codeModeScriptSeq}`
          const unsetKey = context.agentId ?? 'main'
          const priorUnsetVars = sessionUnsetVarsByKey.get(unsetKey)

          // Official 2.1.328: persist replMode=true for this session so resume
          // recovers Code Mode cleanly.
          try {
            saveReplMode(true)
          } catch {
            // Best-effort outside full session storage lifecycle (e.g. unit tests)
          }

          // Per-script abort controller wired to parent abort + auto-mode stop chain
          const scriptAbortController = new AbortController()
          const parentSignal = context.abortController.signal
          let onParentAbort: (() => void) | undefined
          if (parentSignal.aborted) {
            scriptAbortController.abort(parentSignal.reason)
          } else {
            onParentAbort = () =>
              scriptAbortController.abort(parentSignal.reason)
            parentSignal.addEventListener('abort', onParentAbort, {
              once: true,
            })
          }
          let scriptAutoBlockedReason: string | undefined

          // Official 2.1.327 (#386) & 2.1.328 (`J.scriptChecks`):
          // Do NOT unconditionally mark `auto` mode scripts allowed.
          // - `bypassPermissions` or already-classified `autoModeClassified` -> allowed
          // - `auto` with `autoModeScriptCheckDeferred` -> queued as `unchecked`
          //   with deferred classifier check & stop chain
          // - unclassified `auto` script -> mark unclassifiedCodeRan & drop unchecked
          const autoModeClassified =
            (context as { autoModeClassified?: boolean }).autoModeClassified ===
            true
          const autoModeScriptCheckDeferred =
            (context as { autoModeScriptCheckDeferred?: boolean })
              .autoModeScriptCheckDeferred === true

          codeModeAutoVerdictTracker.registerScript(scriptId)
          if (currentPermissionMode === 'bypassPermissions') {
            codeModeAutoVerdictTracker.markAllowed(scriptId)
          } else if (currentPermissionMode === 'auto') {
            if (autoModeClassified) {
              codeModeAutoVerdictTracker.markAllowed(scriptId)
            } else if (
              autoModeScriptCheckDeferred &&
              !codeModeAutoVerdictTracker.hasUnclassifiedCodeRan()
            ) {
              codeModeAutoVerdictTracker.addDeferredCheck({
                id: scriptId,
                code: input.code,
                toolUseId: scriptId,
                runCheck: async (combinedCode, checkCtx, checkCanUseTool) =>
                  checkCanUseTool(
                    wrappedTool,
                    { ...input, code: combinedCode },
                    {
                      ...checkCtx,
                      replScriptCheckNow: true,
                    } as ToolUseContext,
                    parentMessage,
                    scriptId,
                  ),
                stop: (reason, batchSize, cause) => {
                  scriptAutoBlockedReason = formatAutoModeScriptBlockedMessage(
                    reason,
                    batchSize,
                    cause,
                  )
                  if (!scriptAbortController.signal.aborted) {
                    scriptAbortController.abort(
                      new Error(scriptAutoBlockedReason),
                    )
                  }
                },
              })
            } else {
              codeModeAutoVerdictTracker.markUnclassifiedCodeRan()
              codeModeAutoVerdictTracker.dropUnchecked()
            }
          }

          // Official 2.1.328 (#581): compute the tool names allowed for this
          // session/subagent without unconditionally unioning Write/Edit into
          // restricted or read-only subagents.
          const initialTools = resolveCodeModeEffectiveTools(
            baseReplTool.name,
            resolveAvailableTools,
            context,
          )
          const allowedToolNames =
            initialTools.length > 0 ||
            context.agentId !== undefined ||
            Array.isArray(context.options?.tools)
              ? new Set(initialTools.map(t => t.name))
              : undefined

          const bridge = createCodeModeToolBridge({
            baseReplToolName: baseReplTool.name,
            resolveAvailableTools,
            initialContext: context,
            initialCwd,
            getDepsCwd: deps.cwd,
            canUseTool,
            parentMessage,
            currentPermissionMode,
            codeModeAutoVerdictTracker,
            scriptId,
            scriptAbortController,
            getScriptAutoBlockedReason: () => scriptAutoBlockedReason,
            allowedToolNames,
          })

          const runScript = (
            overrideSignal: AbortSignal,
            assignedEvalId?: number,
          ): Promise<CodeModeExecutionResult> =>
            executeScript({
              code: input.code,
              timeoutMs: input.timeout,
              signal: overrideSignal,
              sessionKey: unsetKey,
              session: activeSession,
              evalId: assignedEvalId,
              allowedTools: allowedToolNames,
              availableToolNames: initialTools.map(t => t.name),
              unsetVars: priorUnsetVars,
              permissionMode: currentPermissionMode,
              getCachedFileContent: bridge.getCachedFileContent,
              onProgress: onProgress
                ? event => {
                    onProgress({
                      toolUseID: context.toolUseId ?? 'repl',
                      data: { type: 'code_mode_progress', event } as never,
                    })
                  }
                : undefined,
              invokeTool: bridge.invokeTool,
            })

          const optInAsync = optInModule as {
            isAsyncReplEnabled?: () => boolean
            isAsyncLaneMode?: (mode?: string) => boolean
          }
          const isAsyncReplActive =
            optInAsync.isAsyncReplEnabled?.() === true &&
            optInAsync.isAsyncLaneMode?.(currentPermissionMode) === true

          let execution: CodeModeExecutionResult
          if (isAsyncReplActive) {
            const sessions = getReplSessions()
            if (sessions.depth(unsetKey) >= ASYNC_REPL_MAX_EVALS) {
              codeModeAutoVerdictTracker.endScript(scriptId)
              if (onParentAbort !== undefined) {
                parentSignal.removeEventListener('abort', onParentAbort)
              }
              return {
                data: {
                  result: `Error: async REPL dispatch rejected: ${sessions.depth(unsetKey)} evals already waiting or running on this context — wait for their settles (Poll) before dispatching more`,
                  tool_calls: 0,
                  asyncDispatched: true,
                },
              }
            }

            const evalStartMs = Date.now()
            let returnedReceipt = false
            let settledExecution: CodeModeExecutionResult | undefined
            let resolveSettled:
              | ((res: CodeModeExecutionResult) => void)
              | undefined
            const settledPromise = new Promise<CodeModeExecutionResult>(
              resolve => {
                resolveSettled = resolve
              },
            )

            let dispatchedEvalId = 0
            const handle = sessions.dispatch(
              unsetKey,
              async controller => {
                try {
                  const res = await runScript(
                    controller.signal,
                    dispatchedEvalId,
                  )
                  settledExecution = res
                  return res.result
                } finally {
                  codeModeAutoVerdictTracker.endScript(scriptId)
                  if (onParentAbort !== undefined) {
                    parentSignal.removeEventListener('abort', onParentAbort)
                  }
                }
              },
              {
                description: input.description,
                toolUseId: context.toolUseId,
                signal: scriptAbortController.signal,
                detachAfterMs: REPL_DETACH_AFTER_MS,
                deliver: async (evalId, output, isError, retired) => {
                  const elapsedMs = Date.now() - evalStartMs
                  const finalExec: CodeModeExecutionResult = settledExecution
                    ? { ...settledExecution, evalId, ms: elapsedMs }
                    : {
                        result: output,
                        tool_calls: 0,
                        evalId,
                        ms: elapsedMs,
                      }
                  if (!returnedReceipt) {
                    resolveSettled?.(finalExec)
                    return
                  }
                  if (retired) return
                  try {
                    const mqm = (await import(
                      '../../../utils/messageQueueManager.js'
                    )) as {
                      enqueueReplEvalPollEvent?: (opts: {
                        evalId: number
                        content: string
                        isError?: boolean
                        ms?: number
                        agentId?: string
                        toolUseId?: string
                        startsTurn?: boolean
                        wake?: boolean
                        media?: unknown[]
                      }) => void
                    }
                    mqm.enqueueReplEvalPollEvent?.({
                      evalId,
                      content: output,
                      isError,
                      ms: elapsedMs,
                      agentId: context.agentId,
                      toolUseId: context.toolUseId,
                      startsTurn: true,
                      wake: true,
                      media:
                        bridge.collectedMedia.length > 0
                          ? [...bridge.collectedMedia]
                          : undefined,
                    })
                  } catch {
                    // Best-effort outside full message queue lifecycle.
                  }
                },
              },
              input.code,
            )
            dispatchedEvalId = handle.evalId

            const rawSettleWindowMs = (
              input as unknown as { settleWindowMs?: unknown }
            ).settleWindowMs
            const settleWindowMs =
              typeof rawSettleWindowMs === 'number'
                ? Math.max(0, rawSettleWindowMs)
                : REPL_SETTLE_WINDOW_MS

            let windowTimer: ReturnType<typeof setTimeout> | undefined
            const raced = await Promise.race<
              | { kind: 'settled'; execution: CodeModeExecutionResult }
              | { kind: 'dispatched' }
            >([
              settledPromise.then(execRes => ({
                kind: 'settled' as const,
                execution: execRes,
              })),
              new Promise<{ kind: 'dispatched' }>(resolve => {
                windowTimer = setTimeout(
                  () => resolve({ kind: 'dispatched' }),
                  settleWindowMs,
                )
                windowTimer.unref?.()
              }),
            ])
            if (windowTimer !== undefined) clearTimeout(windowTimer)

            if (raced.kind === 'dispatched') {
              returnedReceipt = true
              sessions.callReturned(unsetKey, handle.evalId)
              return {
                data: {
                  result: `(dispatched #${handle.evalId})`,
                  tool_calls: 0,
                  evalId: handle.evalId,
                  asyncDispatched: true,
                },
              }
            }
            const settledResult = raced.execution
            const isSettledError = settledResult.result.startsWith('Error:')
            execution = {
              ...settledResult,
              result: formatReplOutputEnvelope({
                evalId: settledResult.evalId ?? handle.evalId,
                ms: settledResult.ms ?? Math.max(0, Date.now() - evalStartMs),
                result: isSettledError
                  ? settledResult.result.replace(/^Error:\s*/, '')
                  : settledResult.result,
                isError: isSettledError,
              }),
            }
          } else {
            try {
              execution = await runScript(scriptAbortController.signal)
            } finally {
              codeModeAutoVerdictTracker.endScript(scriptId)
              if (onParentAbort !== undefined) {
                parentSignal.removeEventListener('abort', onParentAbort)
              }
            }
          }

          // Official 2.1.328 (#576): track top-level variables declared in a failed
          // script so subsequent scripts guard against silently reading `undefined`.
          if (execution.unsetVariables && execution.unsetVariables.length > 0) {
            const nextSet = new Set(priorUnsetVars)
            for (const v of execution.unsetVariables) {
              nextSet.add(v)
            }
            sessionUnsetVarsByKey.set(unsetKey, nextSet)
          } else if (priorUnsetVars && priorUnsetVars.size > 0) {
            const newlySet = [
              ...extractTopLevelDeclaredVars(input.code),
              ...extractAssignedVars(input.code),
            ]
            for (const v of newlySet) {
              priorUnsetVars.delete(v)
            }
            if (priorUnsetVars.size === 0) {
              sessionUnsetVarsByKey.delete(unsetKey)
            }
          }

          // Official 2.1.328 (#648): post-script pause (0ms in auto/bypass/default).
          const postPauseMs = getCodeModePostScriptPauseMs(
            currentPermissionMode,
          )
          if (postPauseMs > 0) {
            await new Promise<void>(r => setTimeout(r, postPauseMs))
          }

          // Official 2.1.328 (#649): dynamic MCP status delta without mutating the
          // static prompt-cached system prompt (isolated per root session, E3-P1-3).
          const mcpClients = context.getAppState?.()?.mcp?.clients
          let mcpDeltaNotice: string | null = null
          if (Array.isArray(mcpClients) && mcpClients.length > 0) {
            const diff = diffCodeModeMcpServerStatus(
              executorState.prevConnectedMcpServers,
              mcpClients,
            )
            const hadPrev = executorState.prevConnectedMcpServers.size > 0
            executorState.prevConnectedMcpServers = diff.connected
            mcpDeltaNotice = buildCodeModeMcpStatusDelta({
              pendingServers: diff.pending,
              addedServers: hadPrev ? diff.added : undefined,
              removedServers: hadPrev ? diff.removed : undefined,
            })
          }

          const trailingBlocks: string[] = []
          if (bridge.collectedFeedback.length > 0) {
            trailingBlocks.push(
              bridge.collectedFeedback
                .map(f => `[User feedback]: ${f}`)
                .join('\n'),
            )
          }
          if (mcpDeltaNotice) {
            trailingBlocks.push(mcpDeltaNotice)
          }

          const hookAdditionalContexts: string[] = []
          const hookBlockingErrors: string[] = []
          for (const msg of bridge.collectedHookMessages) {
            const att = msg.attachment as {
              type?: string
              content?: unknown
              blockingError?: { blockingError?: string }
            }
            if (
              att.type === 'hook_additional_context' &&
              Array.isArray(att.content)
            ) {
              for (const entry of att.content) {
                if (typeof entry === 'string' && entry.length > 0) {
                  hookAdditionalContexts.push(entry)
                }
              }
            } else if (
              att.type === 'hook_blocking_error' &&
              typeof att.blockingError?.blockingError === 'string' &&
              att.blockingError.blockingError.length > 0
            ) {
              hookBlockingErrors.push(att.blockingError.blockingError)
            }
          }

          const scriptHookHalted = bridge.isHookHalted()
          const scriptHookStopReason = bridge.getHookStopReason()
          const resultData: CodeModeExecutionResult = {
            ...execution,
            ...(trailingBlocks.length > 0
              ? {
                  result: execution.result
                    ? `${execution.result}\n\n${trailingBlocks.join('\n\n')}`
                    : trailingBlocks.join('\n\n'),
                }
              : {}),
            ...(bridge.collectedFeedback.length > 0
              ? { userFeedback: bridge.collectedFeedback }
              : {}),
            ...(scriptHookHalted ? { hookStoppedContinuation: true } : {}),
            ...(scriptHookStopReason !== undefined
              ? { hookStopReason: scriptHookStopReason }
              : {}),
            ...(hookAdditionalContexts.length > 0
              ? { hookAdditionalContext: hookAdditionalContexts }
              : {}),
            ...(hookBlockingErrors.length > 0 ? { hookBlockingErrors } : {}),
            ...(bridge.collectedMedia.length > 0
              ? { media: bridge.collectedMedia }
              : {}),
          }

          const allNewMessages = [
            ...bridge.collectedHookMessages,
            ...bridge.collectedToolNewMessages,
          ]
          const composedContextModifier =
            bridge.collectedContextModifiers.length > 0
              ? (ctx: ToolUseContext) =>
                  bridge.collectedContextModifiers.reduce(
                    (acc, mod) => mod(acc),
                    ctx,
                  )
              : undefined

          return {
            data: resultData,
            ...(allNewMessages.length > 0
              ? { newMessages: allNewMessages }
              : {}),
            ...(composedContextModifier
              ? { contextModifier: composedContextModifier }
              : {}),
            ...(bridge.collectedContextLayers.length > 0
              ? { contextLayers: bridge.collectedContextLayers }
              : {}),
          }
        },
      }
    },
  }

  wrappedTool = attachToolCreateAndRemoteRuntime(
    wrappedDef as unknown as Parameters<
      typeof attachToolCreateAndRemoteRuntime
    >[0],
    built as unknown as Tool,
  )
  return wrappedTool
}
