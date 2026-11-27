/**
 * Mid-turn cloud UserPromptSubmit hook evaluation and headless tool permission prompts.
 */
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { formatCloudUserPromptSubmitBlockError } from 'src/utils/hooks/hookErrorDisplay.js'
import { createAbortController } from 'src/utils/abortController.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import type { PermissionPromptTool } from 'src/utils/queryHelpers.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js'
import { createCombinedAbortSignal } from 'src/utils/combinedAbortSignal.js'
import {
  canUseToolAbortedDenyReason,
  PERMISSION_RESULT_SHAPE_HINT,
  canUseToolInvalidResultDenyReason,
} from 'src/utils/permissions/permissionDecisionReasons.js'
import {
  notifyNestedPromptBlocking,
  notifyNestedPromptUnblocking,
  reteeWaitingOnUser,
  type RequiresActionDetails,
} from 'src/utils/sessionState.js'
import {
  outputSchema as permissionToolOutputSchema,
  permissionPromptToolResultToPermissionDecision,
} from 'src/utils/permissions/PermissionPromptToolResultSchema.js'
import { safeParseJSON } from 'src/utils/json.js'
import { StructuredIO } from 'src/cli/structuredIO.js'
import { type Tool, toolMatchesName } from 'src/Tool.js'
import { gracefulShutdownSync } from 'src/utils/gracefulShutdown.js'
import { guardAskUserQuestionAfkTimeout } from './startupAndAccount.js'

export type MidTurnCloudHookOutcome =
  | { kind: 'blocked'; message: string }
  | { kind: 'stopped'; message: string }
  | { kind: 'cancelled' }
  | {
      kind: 'allow'
      additionalContexts: string[]
      sessionTitle?: string
    }

/**
 * Append non-blocking `UserPromptSubmit` hook `additionalContexts` onto a
 * mid-turn prompt payload so both mid-turn `queued_command` drains and
 * between-turn `processUserInput` runs receive them without re-executing hooks.
 */
export function appendHookAdditionalContextToPromptContent<
  T extends string | ContentBlockParam[],
>(content: T, additionalContexts: readonly string[]): T {
  if (additionalContexts.length === 0) return content
  const reminder = `<system-reminder>\nUserPromptSubmit hook additional context: ${additionalContexts.join('\n')}\n</system-reminder>`
  if (typeof content === 'string') {
    return `${content}\n\n${reminder}` as T
  }
  return [...content, { type: 'text', text: reminder }] as T
}

/**
 * Evaluate `UserPromptSubmit` hooks for a mid-turn cloud message, capturing
 * blocking errors, `preventContinuation`, `additionalContexts`, and
 * `sessionTitle` in a single pass.
 *
 * Note: per `coreSchemas.ts`, `promptSubmit.ts`, and official 2.1.328
 * (`@300834196`), `suppressOriginalPrompt` only omits the original prompt from
 * `decision: "block"` messages — never from allowed prompts. Cloud mid-turn
 * block messages (`formatCloudUserPromptSubmitBlockError`) already omit the
 * original prompt unconditionally.
 */
export async function evaluateMidTurnCloudUserPromptSubmitHooks(
  _promptText: string,
  evaluate: () => AsyncIterable<{
    blockingError?: { blockingError: string }
    preventContinuation?: boolean
    stopReason?: string
    additionalContexts?: string[]
    sessionTitle?: string
    suppressOriginalPrompt?: boolean
  }>,
  signal: AbortSignal,
): Promise<MidTurnCloudHookOutcome> {
  const additionalContexts: string[] = []
  let sessionTitle: string | undefined
  for await (const hookResult of evaluate()) {
    if (signal.aborted) {
      return { kind: 'cancelled' }
    }
    if (hookResult.sessionTitle) {
      sessionTitle = hookResult.sessionTitle
    }
    if (hookResult.blockingError) {
      return {
        kind: 'blocked',
        message: formatCloudUserPromptSubmitBlockError(
          hookResult.blockingError.blockingError,
        ),
      }
    }
    if (hookResult.preventContinuation) {
      return {
        kind: 'stopped',
        message: hookResult.stopReason
          ? `Operation stopped by hook: ${hookResult.stopReason}`
          : 'Operation stopped by hook',
      }
    }
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      additionalContexts.push(...hookResult.additionalContexts)
    }
  }
  if (signal.aborted) {
    return { kind: 'cancelled' }
  }
  return {
    kind: 'allow',
    additionalContexts,
    sessionTitle,
  }
}

/**
 * Serialized non-blocking runner for mid-turn cloud `UserPromptSubmit` hook
 * evaluation. Keeps user messages in strict arrival order while ensuring slow
 * hooks never stall `interrupt` / `end_session` / `stop_task` control requests.
 */
export function createMidTurnHookRunner(): {
  readonly hasPending: boolean
  schedule: (
    task: (signal: AbortSignal) => Promise<void>,
    onCancel?: () => void,
  ) => void
  abortAll: () => void
  waitForIdle: () => Promise<void>
} {
  let chain: Promise<void> = Promise.resolve()
  let pendingCount = 0
  type RunnerEntry = {
    controller: AbortController
    started: boolean
    cancelled: boolean
    onCancel?: () => void
  }
  const activeEntries = new Set<RunnerEntry>()
  const fireCancelOnce = (entry: RunnerEntry): void => {
    if (entry.cancelled) return
    entry.cancelled = true
    try {
      entry.onCancel?.()
    } catch {
      // best-effort cancel notification
    }
  }
  return {
    get hasPending(): boolean {
      return pendingCount > 0
    },
    schedule(
      task: (signal: AbortSignal) => Promise<void>,
      onCancel?: () => void,
    ): void {
      pendingCount++
      const entry: RunnerEntry = {
        controller: createAbortController(),
        started: false,
        cancelled: false,
        onCancel,
      }
      activeEntries.add(entry)
      chain = chain
        .then(async () => {
          if (entry.controller.signal.aborted) {
            fireCancelOnce(entry)
            return
          }
          entry.started = true
          await task(entry.controller.signal)
        })
        .catch(err => {
          logForDebugging(
            `[print.ts] Mid-turn cloud UserPromptSubmit hook error: ${errorMessage(err)}`,
            { level: 'warn' },
          )
        })
        .finally(() => {
          activeEntries.delete(entry)
          pendingCount--
        })
    },
    abortAll(): void {
      for (const entry of activeEntries) {
        if (!entry.controller.signal.aborted) {
          entry.controller.abort()
        }
        if (!entry.started) {
          fireCancelOnce(entry)
        }
      }
    },
    waitForIdle(): Promise<void> {
      return chain
    },
  }
}

/**
 * Creates a CanUseToolFn that incorporates a custom permission prompt tool.
 * This function converts the permissionPromptTool into a CanUseToolFn that can be used in ask.tsx
 */
export function createCanUseToolWithPermissionPrompt(
  permissionPromptTool: PermissionPromptTool,
): CanUseToolFn {
  const canUseTool: CanUseToolFn = async (
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseId,
    forceDecision,
  ) => {
    const mainPermissionResult =
      forceDecision ??
      (await hasPermissionsToUseTool(
        tool,
        input,
        toolUseContext,
        assistantMessage,
        toolUseId,
      ))

    // If the tool is allowed or denied, return the result
    if (
      mainPermissionResult.behavior === 'allow' ||
      mainPermissionResult.behavior === 'deny'
    ) {
      return mainPermissionResult
    }

    // Race the permission prompt tool against the abort signal.
    //
    // Why we need this: The permission prompt tool may block indefinitely waiting
    // for user input (e.g., via stdin or a UI dialog). If the user triggers an
    // interrupt (Ctrl+C), we need to detect it even while the tool is blocked.
    // Without this race, the abort check would only run AFTER the tool completes,
    // which may never happen if the tool is waiting for input that will never come.
    //
    // The second check (combinedSignal.aborted) handles a race condition where
    // abort fires after Promise.race resolves but before we reach this check.
    const { signal: combinedSignal, cleanup: cleanupAbortListener } =
      createCombinedAbortSignal(toolUseContext.abortController.signal)

    // Check if already aborted before starting the race
    // densable Nnm: decisionReason g8t (other+h8t) → OTel user_abort, not
    // permissionPromptTool (which would mis-count as user_reject).
    if (combinedSignal.aborted) {
      cleanupAbortListener()
      return {
        behavior: 'deny',
        message: 'Permission prompt was aborted.',
        decisionReason: canUseToolAbortedDenyReason,
      }
    }

    // Official Imn densable: nested agent permission parks block waitingOnUser
    // (parity with structuredIO.createCanUseTool).
    const nestedAgentId = toolUseContext.agentId
    let nestedBlocked = false
    if (nestedAgentId !== undefined) {
      nestedBlocked = true
      notifyNestedPromptBlocking(nestedAgentId)
    }

    try {
      const abortPromise = new Promise<'aborted'>(resolve => {
        combinedSignal.addEventListener('abort', () => resolve('aborted'), {
          once: true,
        })
      })

      const toolCallPromise = permissionPromptTool.call(
        {
          tool_name: tool.name,
          input,
          tool_use_id: toolUseId,
        },
        toolUseContext,
        canUseTool,
        assistantMessage,
      )

      const raceResult = await Promise.race([toolCallPromise, abortPromise])
      cleanupAbortListener()

      if (raceResult === 'aborted' || combinedSignal.aborted) {
        return {
          behavior: 'deny',
          message: 'Permission prompt was aborted.',
          decisionReason: canUseToolAbortedDenyReason,
        }
      }

      // TypeScript narrowing: after the abort check, raceResult must be ToolResult
      const result = raceResult as Awaited<typeof toolCallPromise>

      const permissionToolResultBlockParam =
        permissionPromptTool.mapToolResultToToolResultBlockParam(
          result.data,
          '1',
        )
      if (
        !permissionToolResultBlockParam.content ||
        !Array.isArray(permissionToolResultBlockParam.content) ||
        !permissionToolResultBlockParam.content[0] ||
        permissionToolResultBlockParam.content[0].type !== 'text' ||
        typeof permissionToolResultBlockParam.content[0].text !== 'string'
      ) {
        throw new Error(
          'Permission prompt tool returned an invalid result. Expected a single text block param with type="text" and a string text value.',
        )
      }
      // densable Nnm: safeParse → schema-invalid deny with iNr (config), not throw
      // (throw would bubble as unhandled / mis-count as user_reject).
      const parsed = permissionToolOutputSchema().safeParse(
        safeParseJSON(permissionToolResultBlockParam.content[0].text),
      )
      if (!parsed.success) {
        logForDebugging(
          `Permission prompt tool returned a schema-invalid result for ${tool.name}: ${parsed.error.message.slice(0, 2000)}`,
          { level: 'error' },
        )
        return {
          behavior: 'deny',
          message: `The permission prompt tool returned an invalid permission result. ${PERMISSION_RESULT_SHAPE_HINT}`,
          decisionReason: canUseToolInvalidResultDenyReason,
        }
      }
      return permissionPromptToolResultToPermissionDecision(
        parsed.data,
        permissionPromptTool,
        input,
        toolUseContext,
        {
          askSuppressesAlwaysAllowRule:
            mainPermissionResult.suppressAlwaysAllowRule === true ||
            (toolUseContext as { hookCaller?: unknown }).hookCaller !==
              undefined,
        },
      )
    } finally {
      if (nestedBlocked && nestedAgentId !== undefined) {
        notifyNestedPromptUnblocking(nestedAgentId)
      }
      // Survivors of concurrent parks: re-tee waitingOnUser when still blocked.
      reteeWaitingOnUser()
    }
  }
  return canUseTool
}

// Exported for testing — regression: this used to crash at construction when
// getMcpTools() was empty (before per-server connects populated appState).
export function getCanUseToolFn(
  permissionPromptToolName: string | undefined,
  structuredIO: StructuredIO,
  getMcpTools: () => Tool[],
  onPermissionPrompt?: (details: RequiresActionDetails) => void,
): CanUseToolFn {
  if (permissionPromptToolName === 'stdio') {
    return guardAskUserQuestionAfkTimeout(
      structuredIO.createCanUseTool(onPermissionPrompt),
    )
  }
  if (!permissionPromptToolName) {
    return async (
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseId,
      forceDecision,
    ) =>
      forceDecision ??
      (await hasPermissionsToUseTool(
        tool,
        input,
        toolUseContext,
        assistantMessage,
        toolUseId,
      ))
  }
  // Lazy lookup: MCP connects are per-server incremental in print mode, so
  // the tool may not be in appState yet at init time. Resolve on first call
  // (first permission prompt), by which point connects have had time to finish.
  let resolved: CanUseToolFn | null = null
  return async (
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseId,
    forceDecision,
  ) => {
    if (!resolved) {
      const mcpTools = getMcpTools()
      const permissionPromptTool = mcpTools.find(t =>
        toolMatchesName(t, permissionPromptToolName),
      ) as PermissionPromptTool | undefined
      if (!permissionPromptTool) {
        const error = `Error: MCP tool ${permissionPromptToolName} (passed via --permission-prompt-tool) not found. Available MCP tools: ${mcpTools.map(t => t.name).join(', ') || 'none'}`
        process.stderr.write(`${error}\n`)
        gracefulShutdownSync(1)
        throw new Error(error)
      }
      if (!permissionPromptTool.inputJSONSchema) {
        const error = `Error: tool ${permissionPromptToolName} (passed via --permission-prompt-tool) must be an MCP tool`
        process.stderr.write(`${error}\n`)
        gracefulShutdownSync(1)
        throw new Error(error)
      }
      resolved = guardAskUserQuestionAfkTimeout(
        createCanUseToolWithPermissionPrompt(permissionPromptTool),
      )
    }
    return resolved(
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseId,
      forceDecision,
    )
  }
}
