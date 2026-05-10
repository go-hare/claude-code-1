import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { QueryEngine } from '../../QueryEngine.js'
import type { SDKMessage } from '../../entrypoints/sdk/coreTypes.generated.js'
import type {
  AgentContent,
  AgentInput,
  AgentTurnExecutionContext,
  AgentTurnExecutor,
} from '../types.js'
import { projectQueryEventToAgentEvents } from './queryToAgentEvents.js'

type QueryEngineLike = Pick<QueryEngine, 'submitMessage'>

export type QueryEngineExecutorOptions = {
  queryEngine: QueryEngineLike
}

function inputToPrompt(input: AgentInput): string | ContentBlockParam[] {
  const textParts: string[] = []
  const blocks: ContentBlockParam[] = []

  for (const content of input.content) {
    if (content.type === 'text') {
      textParts.push(content.text)
      continue
    }
    const block = contentToContentBlock(content)
    if (block) {
      blocks.push(block)
    }
  }

  if (blocks.length === 0) {
    return textParts.join('\n')
  }

  return [
    ...textParts.map(text => ({ type: 'text' as const, text })),
    ...blocks,
  ]
}

function contentToContentBlock(
  content: AgentContent,
): ContentBlockParam | undefined {
  if (content.type === 'image') {
    return {
      type: 'image',
      source: content.source,
    } as unknown as ContentBlockParam
  }
  if (content.type === 'resource') {
    return {
      type: 'text',
      text: content.text ?? content.uri,
    }
  }
  return undefined
}

export function createQueryEngineExecutor(
  options: QueryEngineExecutorOptions,
): AgentTurnExecutor {
  return async function* queryEngineExecutor(
    input: AgentInput,
    context: AgentTurnExecutionContext,
  ) {
    const prompt = inputToPrompt(input)
    for await (const message of options.queryEngine.submitMessage(prompt)) {
      yield* projectQueryEventToAgentEvents(message, context)
    }
  }
}

/**
 * Backward-compatible alias for older callers.
 */
export function createSessionRuntimeExecutor(options: {
  runtime: QueryEngineLike
}): AgentTurnExecutor {
  return createQueryEngineExecutor({ queryEngine: options.runtime })
}

export type SubmitMessageRuntime = {
  submitMessage(
    prompt: string | ContentBlockParam[],
  ): AsyncGenerator<SDKMessage, void, unknown>
}
