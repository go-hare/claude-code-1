/**
 * API-based search adapter — delegates to Anthropic's server-side
 * web_search_20250305 tool via a secondary API call.
 */

import type {
  BetaContentBlock,
  BetaWebSearchTool20250305,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { queryModelWithStreaming } from 'src/services/api/claude.js'
import {
  createTrace,
  endTrace,
  isLangfuseEnabled,
} from 'src/services/langfuse/index.js'
import { getSessionId } from 'src/bootstrap/state.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import {
  resolveEffortValue,
  resolveToolPermissionContext,
} from 'src/utils/contextLayers.js'
import { createUserMessage } from 'src/utils/messages.js'
import { getMainLoopModel, getSmallFastModel } from 'src/utils/model/model.js'
import { jsonParse } from 'src/utils/slowOperations.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import type { SearchResult, SearchOptions, WebSearchAdapter } from './types.js'

function makeToolSchema(input: {
  allowedDomains?: string[]
  blockedDomains?: string[]
}): BetaWebSearchTool20250305 {
  return {
    type: 'web_search_20250305',
    name: 'web_search',
    allowed_domains: input.allowedDomains,
    blocked_domains: input.blockedDomains,
    max_uses: 8,
  }
}

export class ApiSearchAdapter implements WebSearchAdapter {
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const {
      signal,
      onProgress,
      allowedDomains,
      blockedDomains,
      toolUseContext,
    } = options

    const userMessage = createUserMessage({
      content: 'Perform a web search for the query: ' + query,
    })
    const toolSchema = makeToolSchema({ allowedDomains, blockedDomains })

    const useHaiku = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_plum_vx3',
      false,
    )
    // densable: et("tengu_plum_vx3")?rP():t.options.mainLoopModel (bare, not X$)
    const model = useHaiku
      ? getSmallFastModel()
      : (toolUseContext?.options.mainLoopModel ?? getMainLoopModel())
    const langfuseTrace = isLangfuseEnabled()
      ? createTrace({
          sessionId: getSessionId(),
          model,
          provider: getAPIProvider(),
          name: 'web-search-tool',
        })
      : null

    // densable: effortValue:P_(t), getToolPermissionContext:async()=>Tn(t)
    const effortValue = toolUseContext
      ? resolveEffortValue(toolUseContext)
      : undefined

    const queryStream = queryModelWithStreaming({
      messages: [userMessage],
      systemPrompt: asSystemPrompt([
        'You are an assistant for performing a web search tool use',
      ]),
      // densable: thinkingConfig:{type:"disabled"} always (not haiku-gated)
      thinkingConfig: { type: 'disabled' as const },
      tools: [],
      signal: signal ?? toolUseContext?.abortController.signal ?? new AbortController().signal,
      options: {
        getToolPermissionContext: async (): Promise<ToolPermissionContext> => {
          if (toolUseContext) {
            // densable Tn(t) — types/permissions ReadonlyMap vs Tool.ts Map cast
            return resolveToolPermissionContext(
              toolUseContext,
            ) as ToolPermissionContext
          }
          return {
            mode: 'default' as const,
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          }
        },
        model,
        // densable: toolChoice:{type:"tool",name:"web_search"} always
        toolChoice: { type: 'tool' as const, name: 'web_search' },
        isNonInteractiveSession:
          toolUseContext?.options.isNonInteractiveSession ?? false,
        hasAppendSystemPrompt: !!toolUseContext?.options.appendSystemPrompt,
        extraToolSchemas: [toolSchema],
        querySource: 'web_search_tool' as const,
        // densable enablePromptCaching:!1
        enablePromptCaching: false,
        agents: toolUseContext?.options.agentDefinitions.activeAgents ?? [],
        mcpTools: [],
        agentId: toolUseContext?.agentId,
        effortValue,
        langfuseTrace,
      },
    })

    const allContentBlocks: BetaContentBlock[] = []
    let currentToolUseId: string | null = null
    let currentToolUseJson = ''
    const toolUseQueries = new Map<string, string>()
    let progressCounter = 0

    for await (const event of queryStream) {
      if (event.type === 'assistant') {
        const msg = event as { message: { content: BetaContentBlock[] } }
        allContentBlocks.push(...msg.message.content)
        continue
      }

      if (event.type === 'stream_event') {
        const streamEvt = event as {
          event?: {
            type: string
            content_block?: {
              type: string
              id?: string
              tool_use_id?: string
              content?: unknown
              [key: string]: unknown
            }
            delta?: {
              type: string
              partial_json?: string
              [key: string]: unknown
            }
            [key: string]: unknown
          }
        }

        if (streamEvt.event?.type === 'content_block_start') {
          const contentBlock = streamEvt.event.content_block
          if (contentBlock && contentBlock.type === 'server_tool_use') {
            currentToolUseId = contentBlock.id as string
            currentToolUseJson = ''
            continue
          }
        }

        if (
          currentToolUseId &&
          streamEvt.event?.type === 'content_block_delta'
        ) {
          const delta = streamEvt.event.delta
          if (delta?.type === 'input_json_delta' && delta.partial_json) {
            currentToolUseJson += delta.partial_json
            try {
              const queryMatch = currentToolUseJson.match(
                /"query"\s*:\s*"((?:[^"\\]|\\.)*)"/,
              )
              if (queryMatch && queryMatch[1]) {
                const parsedQuery = jsonParse('"' + queryMatch[1] + '"')
                if (
                  !toolUseQueries.has(currentToolUseId) ||
                  toolUseQueries.get(currentToolUseId) !== parsedQuery
                ) {
                  toolUseQueries.set(currentToolUseId, parsedQuery)
                  progressCounter++
                  onProgress?.({
                    type: 'query_update',
                    query: parsedQuery,
                  })
                }
              }
            } catch {
              // Ignore parsing errors for partial JSON
            }
          }
        }

        if (streamEvt.event?.type === 'content_block_start') {
          const contentBlock = streamEvt.event.content_block
          if (contentBlock && contentBlock.type === 'web_search_tool_result') {
            const toolUseId = contentBlock.tool_use_id as string
            const actualQuery = toolUseQueries.get(toolUseId) || query
            const content = contentBlock.content
            progressCounter++
            onProgress?.({
              type: 'search_results_received',
              resultCount: Array.isArray(content) ? content.length : 0,
              query: actualQuery,
            })
          }
        }
      }
    }

    endTrace(langfuseTrace)

    // Extract SearchResult[] from content blocks
    return extractSearchResults(allContentBlocks)
  }
}

function extractSearchResults(blocks: BetaContentBlock[]): SearchResult[] {
  const results: SearchResult[] = []

  for (const block of blocks) {
    if (
      block.type === 'web_search_tool_result' &&
      Array.isArray(block.content)
    ) {
      for (const r of block.content as Array<{
        title: string
        url: string
        page_age?: string
        type?: string
      }>) {
        results.push({
          title: r.title,
          url: r.url,
        })
      }
    }
  }

  return results
}
