import { randomUUID } from 'crypto'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import { queryModelWithoutStreaming } from '../../services/api/claude.js'
import { isPromptTooLongMessage } from '../../services/api/errors.js'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { resolveToolPermissionContext } from '../contextLayers.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import type { HookResult } from '../hooks.js'
import { safeParseJSON } from '../json.js'
import { createUserMessage, extractTextContent } from '../messages.js'
import { getSmallFastModel } from '../model/model.js'
import type { PromptHook } from '../settings/types.js'
import { stripOuterMarkdownFences } from '../stripFencedCode.js'
import { asSystemPrompt } from '../systemPromptType.js'
import { addArgumentsToPrompt, hookResponseSchema } from './hookHelpers.js'
import {
  HOOK_TRANSCRIPT_BUDGET_FRACTION,
  truncateTranscriptForHookEvaluator,
} from './truncateHookTranscript.js'

/**
 * densable okd — execute a prompt-based hook using an LLM.
 * Stop/SubagentStop use a transcript-evidence system prompt + impossible schema.
 */
export async function execPromptHook(
  hook: PromptHook,
  hookName: string,
  hookEvent: HookEvent,
  jsonInput: string,
  signal: AbortSignal,
  toolUseContext: ToolUseContext,
  messages?: Message[],
  toolUseID?: string,
): Promise<HookResult> {
  // Use provided toolUseID or generate a new one
  const effectiveToolUseID = toolUseID || `hook-${randomUUID()}`
  // densable okd: c = Stop || SubagentStop
  const isStopEvent = hookEvent === 'Stop' || hookEvent === 'SubagentStop'
  try {
    // densable: Stop events rephrase the user prompt as a transcript question
    const rawPrompt = isStopEvent
      ? `Based on the conversation transcript above, has the following stopping condition been satisfied? Answer based on transcript evidence only.\n\nCondition: ${hook.prompt}`
      : hook.prompt
    const processedPrompt = addArgumentsToPrompt(rawPrompt, jsonInput)
    logForDebugging(
      `Hooks: Processing prompt hook with prompt: ${processedPrompt}`,
    )

    // Create user message directly - no need for processUserInput which would
    // trigger UserPromptSubmit hooks and cause infinite recursion
    const userMessage = createUserMessage({ content: processedPrompt })
    // densable f = e.model??rP()
    const evaluatorModel = hook.model ?? getSmallFastModel()

    // densable m(E)=>s&&s.length>0?[...z2y(s,f,E),p]:[p]
    const buildMessages = (
      budgetFraction: number = HOOK_TRANSCRIPT_BUDGET_FRACTION,
    ): Message[] =>
      messages && messages.length > 0
        ? [
            ...truncateTranscriptForHookEvaluator(
              messages,
              evaluatorModel,
              budgetFraction,
            ),
            userMessage,
          ]
        : [userMessage]

    let messagesToQuery = buildMessages()

    logForDebugging(
      `Hooks: Querying model with ${messagesToQuery.length} messages`,
    )

    // Query the model with Haiku
    const hookTimeoutMs = hook.timeout ? hook.timeout * 1000 : 30000

    // Combined signal: aborts if either the hook signal or timeout triggers
    const { signal: combinedSignal, cleanup: cleanupSignal } =
      createCombinedAbortSignal(signal, { timeoutMs: hookTimeoutMs })

    // densable okd system prompts (stop vs generic)
    const systemPromptText = isStopEvent
      ? `You are evaluating a stop-condition hook in Claude Code. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
- {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.

Only use {"ok": false, "impossible": true} when the condition is genuinely unachievable in this session — for example: the condition is self-contradictory, it depends on a resource or capability that is unavailable, or the assistant has explicitly tried, exhausted reasonable approaches, and stated it cannot be done. Apply your own judgment when deciding this — the assistant claiming the goal is impossible is evidence, not proof; independently confirm the condition is genuinely unachievable rather than deferring to the assistant's self-assessment. Do not use it just because the goal has not been reached yet or because progress is slow. When in doubt, return {"ok": false} without "impossible".`
      : `You are evaluating a hook condition in Claude Code. Judge whether the user-provided condition is met.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<reason the condition is met>"}
- {"ok": false, "reason": "<reason the condition is not met>"}

Always include a "reason" field.`

    try {
      // densable okd: tools:[] (evaluator is JSON-only; no agent tools)
      // getToolPermissionContext: async()=>Tn(i)
      // outputFormat includes optional impossible for Stop path
      const runEvaluator = (msgs: Message[]) =>
        queryModelWithoutStreaming({
          messages: msgs,
          systemPrompt: asSystemPrompt([systemPromptText]),
          thinkingConfig: { type: 'disabled' as const },
          tools: [],
          signal: combinedSignal,
          options: {
            async getToolPermissionContext(): Promise<ToolPermissionContext> {
              // densable Tn(i) — types/permissions ReadonlyMap vs Tool.ts Map cast
              return resolveToolPermissionContext(
                toolUseContext,
              ) as ToolPermissionContext
            },
            model: evaluatorModel,
            toolChoice: undefined,
            isNonInteractiveSession: true,
            hasAppendSystemPrompt: false,
            agents: [],
            querySource: 'hook_prompt',
            mcpTools: [],
            agentId: toolUseContext.agentId,
            langfuseTrace: toolUseContext.langfuseTrace,
            outputFormat: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  reason: { type: 'string' },
                  impossible: { type: 'boolean' },
                },
                // densable required:["ok","reason"]
                required: ['ok', 'reason'],
                additionalProperties: false,
              },
            },
          },
        })

      let response = await runEvaluator(messagesToQuery)

      // densable ZOe(x)&&s&&s.length>0 → retry with ikd/2 budget
      if (
        isPromptTooLongMessage(response) &&
        messages &&
        messages.length > 0
      ) {
        messagesToQuery = buildMessages(HOOK_TRANSCRIPT_BUDGET_FRACTION / 2)
        logForDebugging(
          `Hooks: evaluator prompt too long; retrying with ${messagesToQuery.length} messages`,
        )
        response = await runEvaluator(messagesToQuery)
      }

      cleanupSignal()

      // densable: API error message → non_blocking_error (before JSON parse)
      if (response.isApiErrorMessage) {
        const apiErr = extractTextContent(
          Array.isArray(response.message.content)
            ? response.message.content
            : [],
        ).trim()
        logForDebugging(`Hooks: prompt-hook evaluator API error: ${apiErr}`, {
          level: 'error',
        })
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: `Hook evaluator API error: ${apiErr}`,
            stdout: '',
            exitCode: 1,
          }),
        }
      }

      // Extract text content from response
      const content = extractTextContent(
        Array.isArray(response.message.content) ? response.message.content : [],
      )

      // Update response length for spinner display
      toolUseContext.setResponseLength(length => length + content.length)

      const fullResponse = content.trim()
      logForDebugging(`Hooks: Model response: ${fullResponse}`)

      // densable eee — strip outer markdown fences before JSON parse
      const json = safeParseJSON(stripOuterMarkdownFences(fullResponse))
      if (!json) {
        logForDebugging(
          `Hooks: error parsing response as JSON: ${fullResponse}`,
        )
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: 'JSON validation failed',
            stdout: fullResponse,
            exitCode: 1,
          }),
        }
      }

      const parsed = hookResponseSchema().safeParse(json)
      if (!parsed.success) {
        logForDebugging(
          `Hooks: model response does not conform to expected schema: ${parsed.error.message}`,
        )
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: `Schema validation failed: ${parsed.error.message}`,
            stdout: fullResponse,
            exitCode: 1,
          }),
        }
      }

      // Failed to meet condition
      if (!parsed.data.ok) {
        // densable: impossible on Stop → success + impossible (goal failed path)
        if (parsed.data.impossible === true && isStopEvent) {
          logForDebugging(
            `Hooks: Prompt hook condition judged impossible: ${parsed.data.reason}`,
          )
          return {
            hook,
            outcome: 'success',
            impossible: true,
            stopReason: parsed.data.reason,
            message: createAttachmentMessage({
              type: 'hook_success',
              hookName,
              toolUseID: effectiveToolUseID,
              hookEvent,
              content: '',
            }),
          }
        }

        logForDebugging(
          `Hooks: Prompt hook condition was not met: ${parsed.data.reason}`,
        )
        // densable: preventContinuation:!c&&e.continueOnBlock!==!0
        // Stop/SubagentStop never set preventContinuation; continueOnBlock also skips.
        const preventContinuation =
          !isStopEvent && hook.continueOnBlock !== true
        return {
          hook,
          outcome: 'blocking',
          blockingError: {
            // densable `[${e.prompt}]: ${reason}`
            blockingError: `[${hook.prompt}]: ${parsed.data.reason}`,
            command: hook.prompt,
          },
          preventContinuation,
          stopReason: parsed.data.reason,
        }
      }

      // Condition was met
      logForDebugging(
        `Hooks: Prompt hook condition was met: ${parsed.data.reason}`,
      )
      return {
        hook,
        outcome: 'success',
        stopReason: parsed.data.reason,
        message: createAttachmentMessage({
          type: 'hook_success',
          hookName,
          toolUseID: effectiveToolUseID,
          hookEvent,
          content: '',
        }),
      }
    } catch (error) {
      cleanupSignal()

      if (combinedSignal.aborted) {
        return {
          hook,
          outcome: 'cancelled',
        }
      }
      throw error
    }
  } catch (error) {
    const errorMsg = errorMessage(error)
    logForDebugging(`Hooks: Prompt hook error: ${errorMsg}`)
    return {
      hook,
      outcome: 'non_blocking_error',
      message: createAttachmentMessage({
        type: 'hook_non_blocking_error',
        hookName,
        toolUseID: effectiveToolUseID,
        hookEvent,
        stderr: `Error executing prompt hook: ${errorMsg}`,
        stdout: '',
        exitCode: 1,
      }),
    }
  }
}
