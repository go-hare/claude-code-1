import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  buildTool,
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../../Tool.js'
import { createAssistantMessage } from '../../../utils/messages.js'
import { runTools } from '../toolOrchestration.js'

function makeLayerTool(opts: {
  name: string
  concurrencySafe: boolean
  call: (
    input: Record<string, never>,
    context: ToolUseContext,
  ) => Promise<{
    data: string
    contextLayers?: NonNullable<ToolUseContext['permissionLayers']>
  }>
}) {
  return buildTool({
    name: opts.name,
    inputSchema: z.object({}),
    description: async () => opts.name,
    prompt: async () => opts.name,
    userFacingName: () => opts.name,
    isConcurrencySafe: () => opts.concurrencySafe,
    isReadOnly: () => opts.concurrencySafe,
    call: opts.call,
    mapToolResultToToolResultBlockParam: (
      content: unknown,
      toolUseID: string,
    ) => ({
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: String(content),
    }),
  } as unknown as Parameters<typeof buildTool>[0])
}

function makeContext(
  tools: ToolUseContext['options']['tools'],
): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools,
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { builtinAgents: [], customAgents: [] },
      settingsHooksOff: true,
    },
    abortController: new AbortController(),
    readFileState: new Map() as never,
    getAppState: () =>
      ({
        toolPermissionContext: getEmptyToolPermissionContext(),
        sessionHooks: new Map(),
      }) as never,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

describe('#1894 toolOrchestration applies update.contextLayers in concurrent and serial paths', () => {
  test('concurrent batch applies contextLayers in block order on final newContext', async () => {
    const readToolA = makeLayerTool({
      name: 'LayerReadA',
      concurrencySafe: true,
      async call() {
        return {
          data: 'ok-a',
          contextLayers: [
            { kind: 'model' as const, mainLoopModel: 'claude-layer-a' },
          ],
        }
      },
    })
    const readToolB = makeLayerTool({
      name: 'LayerReadB',
      concurrencySafe: true,
      async call() {
        return {
          data: 'ok-b',
          contextLayers: [
            { kind: 'max_thinking_tokens' as const, maxThinkingTokens: 4096 },
          ],
        }
      },
    })

    const blocks = [
      { type: 'tool_use' as const, id: 'tu-a', name: 'LayerReadA', input: {} },
      { type: 'tool_use' as const, id: 'tu-b', name: 'LayerReadB', input: {} },
    ] as unknown as ToolUseBlock[]
    const assistantMsg = createAssistantMessage({ content: blocks })
    const ctx = makeContext([readToolA, readToolB])
    const canUseTool = async (_t: unknown, input: Record<string, unknown>) => ({
      behavior: 'allow' as const,
      updatedInput: input,
    })

    let latestCtx: ToolUseContext | undefined
    for await (const update of runTools(
      blocks,
      [assistantMsg],
      canUseTool as never,
      ctx,
    )) {
      if (update.newContext) {
        latestCtx = update.newContext
      }
    }

    expect(latestCtx?.permissionLayers).toHaveLength(2)
    expect(latestCtx?.options.mainLoopModel).toBe('claude-layer-a')
    expect(latestCtx?.options.thinkingConfig).toEqual({
      type: 'enabled',
      budgetTokens: 4096,
    })
  })

  test('serial batch applies contextLayers immediately for subsequent tools', async () => {
    let secondToolSawModel: string | undefined
    const serialTool1 = makeLayerTool({
      name: 'LayerSerial1',
      concurrencySafe: false,
      async call() {
        return {
          data: 'ok-1',
          contextLayers: [
            { kind: 'model' as const, mainLoopModel: 'claude-serial-next' },
          ],
        }
      },
    })
    const serialTool2 = makeLayerTool({
      name: 'LayerSerial2',
      concurrencySafe: false,
      async call(_input, context) {
        secondToolSawModel = context.options.mainLoopModel
        return { data: 'ok-2' }
      },
    })

    const blocks = [
      {
        type: 'tool_use' as const,
        id: 'tu-s1',
        name: 'LayerSerial1',
        input: {},
      },
      {
        type: 'tool_use' as const,
        id: 'tu-s2',
        name: 'LayerSerial2',
        input: {},
      },
    ] as unknown as ToolUseBlock[]
    const assistantMsg = createAssistantMessage({ content: blocks })
    const ctx = makeContext([serialTool1, serialTool2])
    const canUseTool = async (_t: unknown, input: Record<string, unknown>) => ({
      behavior: 'allow' as const,
      updatedInput: input,
    })

    let latestCtx: ToolUseContext | undefined
    for await (const update of runTools(
      blocks,
      [assistantMsg],
      canUseTool as never,
      ctx,
    )) {
      if (update.newContext) {
        latestCtx = update.newContext
      }
    }

    expect(secondToolSawModel).toBe('claude-serial-next')
    expect(latestCtx?.options.mainLoopModel).toBe('claude-serial-next')
    expect(latestCtx?.permissionLayers).toHaveLength(1)
  })
})
