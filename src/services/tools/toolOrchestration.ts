import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import {
  applyContextLayers,
  type ContextLayer,
} from '../../utils/contextLayers.js'
import { all } from '../../utils/generators.js'
import { resolveMaxToolUseConcurrency } from '../../utils/residualMsEnvGates.js'
import { type MessageUpdateLazy, runToolUse } from './toolExecution.js'
import { createToolBatchSpan, endToolBatchSpan } from '../langfuse/index.js'

function getMaxToolUseConcurrency(): number {
  return resolveMaxToolUseConcurrency()
}

export type MessageUpdate = {
  message?: Message
  newContext: ToolUseContext
  contextLayers?: {
    toolUseID: string
    layers: ContextLayer[]
  }
}

export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  // Wrap all tool calls in this turn under a single Langfuse turn span
  const turnSpan =
    toolUseMessages.length > 0
      ? createToolBatchSpan(toolUseContext.langfuseTrace ?? null, {
          toolNames: toolUseMessages.map(b => b.name),
          batchIndex: 0,
        })
      : null
  const contextWithTurn = turnSpan
    ? { ...toolUseContext, langfuseBatchSpan: turnSpan }
    : toolUseContext

  let currentContext = contextWithTurn
  for (const { isConcurrencySafe, blocks } of partitionToolCalls(
    toolUseMessages,
    currentContext,
  )) {
    if (isConcurrencySafe) {
      const queuedContextModifiers: Record<
        string,
        ((context: ToolUseContext) => ToolUseContext)[]
      > = {}
      // densable concurrent contextLayers aggregation keyed by toolUseID
      const queuedContextLayers: Record<string, ContextLayer[]> = {}
      // Run read-only batch concurrently
      for await (const update of runToolsConcurrently(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
        if (update.contextModifier) {
          const { toolUseID, modifyContext } = update.contextModifier
          if (!queuedContextModifiers[toolUseID]) {
            queuedContextModifiers[toolUseID] = []
          }
          queuedContextModifiers[toolUseID].push(modifyContext)
        }
        if (update.contextLayers) {
          const { toolUseID, layers } = update.contextLayers
          if (!queuedContextLayers[toolUseID]) {
            queuedContextLayers[toolUseID] = []
          }
          queuedContextLayers[toolUseID].push(...layers)
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
      for (const block of blocks) {
        const modifiers = queuedContextModifiers[block.id]
        if (modifiers) {
          for (const modifier of modifiers) {
            currentContext = modifier(currentContext)
          }
        }
        // densable Ter after concurrent batch, in tool-use order
        const layers = queuedContextLayers[block.id]
        if (layers && layers.length > 0) {
          currentContext = applyContextLayers(currentContext, layers)
        }
      }
      yield { newContext: currentContext }
    } else {
      // Run non-read-only batch serially
      for await (const update of runToolsSerially(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
        if (update.newContext) {
          currentContext = update.newContext
        }
        // densable serial: Ter layers on each update before yield
        if (update.contextLayers?.layers?.length) {
          currentContext = applyContextLayers(
            currentContext,
            update.contextLayers.layers,
          )
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
    }
  }

  endToolBatchSpan(turnSpan)
}

type Batch = { isConcurrencySafe: boolean; blocks: ToolUseBlock[] }

/**
 * Partition tool calls into batches where each batch is either:
 * 1. A single non-read-only tool, or
 * 2. Multiple consecutive read-only tools
 */
function partitionToolCalls(
  toolUseMessages: ToolUseBlock[],
  toolUseContext: ToolUseContext,
): Batch[] {
  return toolUseMessages.reduce((acc: Batch[], toolUse) => {
    // densable Tc: pass options.toolAliases for session alias remap
    const tool = findToolByName(
      toolUseContext.options.tools,
      toolUse.name,
      toolUseContext.options.toolAliases,
    )
    const parsedInput = tool?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(tool?.isConcurrencySafe(parsedInput.data))
          } catch {
            // If isConcurrencySafe throws (e.g., due to shell-quote parse failure),
            // treat as not concurrency-safe to be conservative
            return false
          }
        })()
      : false
    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }
    return acc
  }, [])
}

async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext
  const priorBlocks: ToolUseBlock[] = []

  for (const toolUse of toolUseMessages) {
    toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(toolUse.id),
    )
    const assistantMessage = assistantMessages.find(
      _ =>
        Array.isArray(_.message.content) &&
        _.message.content.some(
          _ => _.type === 'tool_use' && _.id === toolUse.id,
        ),
    )!
    // Official sameTurnToolUses for non-streaming serial path: prior blocks
    // from this batch (siblings that started before this tool).
    const sameTurnToolUses =
      priorBlocks.length > 0
        ? [
            {
              ...assistantMessage,
              message: {
                ...assistantMessage.message,
                content: [...priorBlocks],
              },
            },
          ]
        : undefined
    for await (const update of runToolUse(
      toolUse,
      assistantMessage,
      canUseTool,
      sameTurnToolUses
        ? { ...currentContext, sameTurnToolUses }
        : currentContext,
    )) {
      if (update.contextModifier) {
        currentContext = update.contextModifier.modifyContext(currentContext)
      }
      yield {
        message: update.message,
        newContext: currentContext,
        contextLayers: update.contextLayers,
      }
    }
    priorBlocks.push(toolUse)
    markToolUseAsComplete(toolUseContext, toolUse.id)
  }
}

async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  yield* all(
    toolUseMessages.map(async function* (toolUse, index) {
      toolUseContext.setInProgressToolUseIDs(prev =>
        new Set(prev).add(toolUse.id),
      )
      const assistantMessage = assistantMessages.find(
        _ =>
          Array.isArray(_.message.content) &&
          _.message.content.some(
            _ => _.type === 'tool_use' && _.id === toolUse.id,
          ),
      )!
      // Prior tools in this concurrent batch (official buildSameTurnToolUses).
      const prior = toolUseMessages.slice(0, index)
      const sameTurnToolUses =
        prior.length > 0
          ? [
              {
                ...assistantMessage,
                message: {
                  ...assistantMessage.message,
                  content: prior,
                },
              },
            ]
          : undefined
      yield* runToolUse(
        toolUse,
        assistantMessage,
        canUseTool,
        sameTurnToolUses
          ? { ...toolUseContext, sameTurnToolUses }
          : toolUseContext,
      )
      markToolUseAsComplete(toolUseContext, toolUse.id)
    }),
    getMaxToolUseConcurrency(),
  )
}

function markToolUseAsComplete(
  toolUseContext: ToolUseContext,
  toolUseID: string,
) {
  toolUseContext.setInProgressToolUseIDs(prev => {
    const next = new Set(prev)
    next.delete(toolUseID)
    return next
  })
}
