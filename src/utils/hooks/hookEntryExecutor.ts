import type { ToolUseContext } from '../../Tool.js'
import {
  isAsyncHookJSONOutput,
  isSyncHookJSONOutput,
  type PromptRequest,
  type PromptResponse,
} from '../../types/hooks.js'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { execAgentHook } from './execAgentHook.js'
import { execHttpHook } from './execHttpHook.js'
import { execMcpToolHook } from './execMcpToolHook.js'
import { execPromptHook } from './execPromptHook.js'
import { remapHookInputForMatchedHook } from './hookConfigRegistry.js'
import {
  escapeSystemReminderTags,
  formatHookCompletionDebugLog,
  type MatchedHook,
  parseHookOutput,
  shouldBlockOnFailureForEvent,
  type TypedSyncHookOutput,
} from './hookCore.js'
import {
  formatHookErrorOutput,
  HOOK_EXIT_127_PRETOOL_MESSAGE,
} from './hookErrorDisplay.js'
import { emitHookResponse, emitHookStarted } from './hookEvents.js'
import {
  shouldDowngradeMissingHookScriptExit2,
  shouldFailClosedHookInput,
} from './hookInputHelpers.js'
import {
  executeFunctionHook,
  executeHookCallback,
  processHookJSONOutput,
} from './hookOutputProcessor.js'
import { parseHttpHookOutput, Uct } from './hookOutputValidation.js'
import { execCommandHook } from './hookShellRunner.js'
import { getHookDisplayText } from './hooksSettings.js'
import {
  getHookStdioError,
  selectCompleteHookOutput,
  stdioFailClosedEvents,
} from './hookStdIO.js'
import type { HookCommandResult, HookResult } from './hookTypes.js'
import { persistHookOutput } from './persistHookOutput.js'
import chalk from 'chalk'
import { randomUUID } from 'crypto'
import type { HookEvent, HookInput } from 'src/entrypoints/agentSdkTypes.js'

export type HookJsonInputResult =
  | { ok: true; value: string }
  | { ok: false; error: unknown }

export type RunSingleMatchedHookParams = {
  matchedHook: MatchedHook
  hookIndex: number
  hookInput: HookInput
  hookEvent: HookEvent
  hookName: string
  toolUseID: string
  signal?: AbortSignal
  timeoutMs: number
  toolUseContext?: ToolUseContext
  messages?: Message[]
  forceSyncExecution?: boolean
  boundRequestPrompt?: (request: PromptRequest) => Promise<PromptResponse>
  persistStorageV5?: unknown
  persistCredentials?: unknown
  getJsonInput: (
    forOwnTool?: boolean,
    familyMatched?: MatchedHook,
  ) => HookJsonInputResult
}

/**
 * Executes a single matched hook entry (callback, function, prompt, agent,
 * http, mcp_tool, or command) and yields its HookResult.
 */
export async function* runSingleMatchedHook({
  matchedHook,
  hookIndex,
  hookInput,
  hookEvent,
  hookName,
  toolUseID,
  signal,
  timeoutMs,
  toolUseContext,
  messages,
  forceSyncExecution,
  boundRequestPrompt,
  persistStorageV5,
  persistCredentials,
  getJsonInput,
}: RunSingleMatchedHookParams): AsyncGenerator<HookResult> {
  const { hook, pluginRoot, pluginId, skillRoot, asOwnTool } = matchedHook
  if (hook.type === 'callback') {
    const callbackTimeoutMs = hook.timeout ? hook.timeout * 1000 : timeoutMs
    const { signal: abortSignal, cleanup } = createCombinedAbortSignal(signal, {
      timeoutMs: callbackTimeoutMs,
    })
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
  const { signal: abortSignal, cleanup } = createCombinedAbortSignal(signal, {
    timeoutMs: commandTimeoutMs,
  })
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
        throw new Error('Agent hooks are not supported for PermissionRequest.')
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
          ? await execHttpHook(hook, hookEvent, jsonInput, signal, timeoutMs, {
              hookSource: matchedHook.hookSource,
              isManagedHook: matchedHook.isManagedHook,
            })
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
            ...((result.stdioIncomplete || result.stdioClosedWithoutEnd) && {
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
    // Official 2.1.326 #249 (`wx` @318308740): When a PreToolUse hook exits
    // 127 (command/program not found), surface an error noting that its
    // check may not have run.
    const rawNonBlockingStderr = result.stderr.trim()
    const summarizedError = formatHookErrorOutput(
      result.stderr,
      result.stdout,
      false,
    )
    const nonBlockingStderr =
      hookEvent === 'PreToolUse' && result.status === 127
        ? rawNonBlockingStderr
          ? `${HOOK_EXIT_127_PRETOOL_MESSAGE}\n${rawNonBlockingStderr}`
          : HOOK_EXIT_127_PRETOOL_MESSAGE
        : `Failed with non-blocking status code: ${summarizedError || rawNonBlockingStderr || 'No stderr output'}`
    yield {
      message: createAttachmentMessage({
        type: 'hook_non_blocking_error',
        hookName,
        toolUseID,
        hookEvent,
        stderr: nonBlockingStderr,
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

    const errorMessage = error instanceof Error ? error.message : String(error)
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
}
