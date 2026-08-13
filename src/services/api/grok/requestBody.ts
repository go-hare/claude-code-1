/**
 * Pure Grok chat.completions body helpers.
 * Extracted so tests can assert reasoning_effort without loading queryModelGrok.
 *
 * xAI Chat Completions accepts OpenAI-shaped `reasoning_effort`:
 *   grok-4.5 / grok-4.20-reasoning → low | medium | high
 *   grok-4.6 / grok-4.20-multi-agent → low | medium | high | xhigh
 *   (4.6 = depth; multi-agent = agent count)
 * `max` is not an xAI value — drop it (caller should have clamped first).
 *
 * @see https://docs.x.ai/developers/model-capabilities/text/reasoning
 */
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions/completions.mjs'
import type { EffortValue } from '../../../utils/effort.js'

export type GrokReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

export function toGrokReasoningEffort(
  effortValue: EffortValue | undefined,
): GrokReasoningEffort | undefined {
  if (
    effortValue === 'low' ||
    effortValue === 'medium' ||
    effortValue === 'high' ||
    effortValue === 'xhigh'
  ) {
    return effortValue
  }
  return undefined
}

export function buildGrokChatCompletionsBody(params: {
  model: string
  messages: ChatCompletionCreateParamsStreaming['messages']
  tools?: ChatCompletionCreateParamsStreaming['tools'] | unknown[]
  toolChoice?: unknown
  temperatureOverride?: number
  effortValue?: EffortValue
}): ChatCompletionCreateParamsStreaming {
  const {
    model,
    messages,
    tools,
    toolChoice,
    temperatureOverride,
    effortValue,
  } = params
  const reasoningEffort = toGrokReasoningEffort(effortValue)
  const typedTools = tools as ChatCompletionCreateParamsStreaming['tools']
  const typedChoice =
    toolChoice as ChatCompletionCreateParamsStreaming['tool_choice']
  return {
    model,
    messages,
    ...(typedTools &&
      typedTools.length > 0 && {
        tools: typedTools,
        ...(typedChoice && { tool_choice: typedChoice }),
      }),
    stream: true,
    stream_options: { include_usage: true },
    ...(temperatureOverride !== undefined && {
      temperature: temperatureOverride,
    }),
    ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
  }
}
