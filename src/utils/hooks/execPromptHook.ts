import { randomUUID } from 'crypto'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import { queryModelWithoutStreaming } from '../../services/api/claude.js'
import { isPromptTooLongMessage } from '../../services/api/errors.js'
import { roughTokenCountEstimationForMessage } from '../../services/tokenEstimation.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { catalogDeclaresNative1mWindow, has1mContext } from '../context.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import type { HookResult } from '../hooks.js'
import { safeParseJSON } from '../json.js'
import {
  createUserMessage,
  extractTextContent,
  SYNTHETIC_MODEL,
} from '../messages.js'
import { getSmallFastModel } from '../model/model.js'
import type { PromptHook } from '../settings/types.js'
import { jsonStringify } from '../slowOperations.js'
import { asSystemPrompt } from '../systemPromptType.js'
import { truncateCodeUnitsSafe } from '../stringUtils.js'
import { getTokenCountFromUsage } from '../tokens.js'
import { addArgumentsToPrompt, hookResponseSchema } from './hookHelpers.js'

// densable hzo/mzo/gzo: measure the last metered response, then retain whole
// API rounds from the end. Always retain the final round, even over budget.
function trimHookHistory(
  messages: Message[],
  model: string,
  fraction = 0.5,
): Message[] {
  const budget = Math.floor(
    (has1mContext(model) || catalogDeclaresNative1mWindow(model)
      ? 1_000_000
      : 200_000) * fraction,
  )
  let tokens = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (
      message.type === 'assistant' &&
      message.message &&
      message.message.model !== SYNTHETIC_MODEL &&
      message.isUnmetered !== true &&
      message.message.usage
    ) {
      tokens = getTokenCountFromUsage(
        message.message.usage as Parameters<typeof getTokenCountFromUsage>[0],
      )
      break
    }
  }
  if (tokens <= budget) return messages
  const groups: Message[][] = []
  let current: Message[] = []
  let lastAssistantId: string | undefined
  for (const message of messages) {
    if (
      (message.type === 'user' || message.type === 'assistant') &&
      message.isVirtual === true
    ) {
      current.push(message)
      continue
    }
    if (
      message.type === 'assistant' &&
      message.message?.id !== lastAssistantId &&
      !message.resumedFromIncompleteThinking &&
      current.length > 0
    ) {
      groups.push(current)
      current = [message]
    } else current.push(message)
    if (message.type === 'assistant') lastAssistantId = message.message?.id
  }
  if (current.length) groups.push(current)
  let total = 0
  let start = groups.length
  for (let i = groups.length - 1; i >= 0; i--) {
    const size = Math.ceil(
      groups[i]!.reduce(
        (sum, message) =>
          sum +
          (message.type === 'assistant' || message.type === 'user'
            ? roughTokenCountEstimationForMessage(message)
            : jsonStringify(message).length / 4),
        0,
      ),
    )
    if (start < groups.length && total + size > budget) break
    total += size
    start = i
  }
  const kept = groups.slice(start).flat()
  const dropped = messages.length - kept.length
  if (dropped <= 0) return messages
  return [
    createUserMessage({
      content: `[Earlier conversation truncated to fit the hook evaluator's context window — ${dropped} earlier messages omitted. Evaluate the condition against the recent transcript below; if the required evidence may be in the omitted prefix, return {"ok": false, "reason": "insufficient evidence in transcript"}.]`,
    }),
    ...kept,
  ]
}

const stopEvaluatorPrompt = `You are evaluating a stop-condition hook in Claude Code. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
- {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.

Only use {"ok": false, "impossible": true} when the condition is genuinely unachievable in this session — for example: the condition is self-contradictory, it depends on a resource or capability that is unavailable, or the assistant has explicitly tried, exhausted reasonable approaches, and stated it cannot be done. Apply your own judgment when deciding this — the assistant claiming the goal is impossible is evidence, not proof; independently confirm the condition is genuinely unachievable rather than deferring to the assistant's self-assessment. Do not use it just because the goal has not been reached yet or because progress is slow. When in doubt, return {"ok": false} without "impossible".`
const evaluatorPrompt = `You are evaluating a hook condition in Claude Code. Judge whether the user-provided condition is met.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<reason the condition is met>"}
- {"ok": false, "reason": "<reason the condition is not met>"}

Always include a "reason" field.`

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
  const effectiveToolUseID = toolUseID || `hook-${randomUUID()}`
  const isStop = hookEvent === 'Stop' || hookEvent === 'SubagentStop'
  const failure = (stderr: string, stdout = ''): HookResult => ({
    hook,
    outcome: 'non_blocking_error',
    message: createAttachmentMessage({
      type: 'hook_non_blocking_error',
      hookName,
      toolUseID: effectiveToolUseID,
      hookEvent,
      stderr,
      stdout,
      exitCode: 1,
    }),
  })
  try {
    const prompt = isStop
      ? `Based on the conversation transcript above, has the following stopping condition been satisfied? Answer based on transcript evidence only.

Condition: ${hook.prompt}`
      : hook.prompt
    const userMessage = createUserMessage({
      content: addArgumentsToPrompt(prompt, jsonInput),
    })
    const model = hook.model ?? getSmallFastModel()
    const buildMessages = (fraction?: number) =>
      messages?.length
        ? [...trimHookHistory(messages, model, fraction), userMessage]
        : [userMessage]
    const hookTimeoutMs = hook.timeout ? hook.timeout * 1000 : 30000
    const { signal: combinedSignal, cleanup } = createCombinedAbortSignal(
      signal,
      { timeoutMs: hookTimeoutMs },
    )
    try {
      const evaluate = (history: Message[]) =>
        queryModelWithoutStreaming({
          messages: history,
          systemPrompt: asSystemPrompt([
            isStop ? stopEvaluatorPrompt : evaluatorPrompt,
          ]),
          thinkingConfig: { type: 'disabled', mechanical: true },
          tools: [],
          signal: combinedSignal,
          options: {
            async getToolPermissionContext() {
              return toolUseContext.getAppState().toolPermissionContext
            },
            model,
            toolChoice: undefined,
            isNonInteractiveSession: true,
            hasAppendSystemPrompt: false,
            agents: [],
            querySource: 'hook_prompt',
            promptTooLongIsHandled: true,
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
                required: ['ok', 'reason'],
                additionalProperties: false,
              },
            },
          },
        })
      let response = await evaluate(buildMessages())
      if (isPromptTooLongMessage(response) && messages?.length)
        response = await evaluate(buildMessages(0.25))
      const content = extractTextContent(
        Array.isArray(response.message.content) ? response.message.content : [],
      ).trim()
      if (response.isApiErrorMessage)
        return failure(`Hook evaluator API error: ${content}`)
      toolUseContext.setResponseLength(length => length + content.length)
      const json = safeParseJSON(
        content.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1'),
      )
      if (!json) return failure('JSON validation failed', content)
      const parsed = hookResponseSchema().safeParse(json)
      if (!parsed.success)
        return failure(
          `Schema validation failed: ${parsed.error.message}`,
          content,
        )
      if (!parsed.data.ok && !(isStop && parsed.data.impossible === true)) {
        const repeated = messages?.some(
          message =>
            message.type === 'user' &&
            (typeof message.message?.content === 'string'
              ? message.message.content
              : extractTextContent(
                  Array.isArray(message.message?.content)
                    ? message.message.content
                    : [],
                )
            ).includes(`[${hook.prompt}]:`),
        )
        const prefix = truncateCodeUnitsSafe(hook.prompt, 500)
        const command =
          repeated && hook.prompt.length > 500
            ? `${prefix}… [+${hook.prompt.length - prefix.length} chars]`
            : hook.prompt
        return {
          hook,
          outcome: 'blocking',
          blockingError: {
            blockingError: `[${command}]: ${parsed.data.reason}`,
            command,
          },
          preventContinuation: !isStop && hook.continueOnBlock !== true,
          stopReason: parsed.data.reason,
        }
      }
      return {
        hook,
        outcome: 'success',
        ...(isStop && !parsed.data.ok && parsed.data.impossible === true
          ? { impossible: true }
          : {}),
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
      if (combinedSignal.aborted)
        return {
          hook,
          outcome: 'cancelled',
          timedOut: !toolUseContext.abortController.signal.aborted,
        }
      throw error
    } finally {
      cleanup()
    }
  } catch (error) {
    const errorMsg = errorMessage(error)
    logForDebugging(`Hooks: Prompt hook error: ${errorMsg}`)
    return failure(`Error executing prompt hook: ${errorMsg}`)
  }
}
