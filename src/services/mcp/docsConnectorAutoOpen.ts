/**
 * #2037: Auto-open documents created through the Claude Docs connector in the
 * user's browser when working in an interactive terminal session.
 *
 * Matches official `G9a` + `kUi` + `openDocCreatedInTerminal`.
 */
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { getOauthConfig } from '../../constants/oauth.js'
import type { Tool } from '../../Tool.js'
import { openBrowser } from '../../utils/browser.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logEvent } from '../analytics/index.js'
import type { ScopedMcpServerConfig } from './types.js'

const DOCS_CONNECTOR_IDS = new Set([
  '758bbc64-7e6c-5dab-a3a5-2a4c7ca423fc',
  '667a974b-0f6b-57fc-8973-52854120fcb3',
  '1a59c906-04da-521d-bda7-7f71b9f9e01c',
])

const DOCS_CONNECTOR_NAMES = new Set([
  'Claude_Docs',
  'Claude_Pages',
  'claude_ai_Claude_Docs',
  'claude_ai_Claude_Pages',
])

const DOCS_BATCH_TOOL_NAME = 'batch'
const DOC_SLUG_RE = /^[a-zA-Z0-9_-]{4,128}$/

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isClaudeDocsConnectorServer(
  serverName: string,
  config: ScopedMcpServerConfig,
): boolean {
  if (DOCS_CONNECTOR_NAMES.has(serverName)) {
    return config.type === 'claudeai-proxy' || config.scope === 'claudeai'
  }
  if (config.type === 'claudeai-proxy' && config.id) {
    if (DOCS_CONNECTOR_IDS.has(config.id)) return true
  }
  if ('url' in config && typeof config.url === 'string') {
    if (config.url.includes('/v1/pages/mcp')) return true
  }
  return false
}

function collectTextCandidates(data: unknown): string[] {
  const out: string[] = []
  if (typeof data === 'string') {
    out.push(data)
    return out
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      if (
        isPlainRecord(item) &&
        item.type === 'text' &&
        typeof item.text === 'string'
      ) {
        out.push(item.text)
      }
    }
    return out
  }
  if (isPlainRecord(data)) {
    if (typeof data.content === 'string') {
      out.push(data.content)
    } else if (Array.isArray(data.content)) {
      for (const item of data.content) {
        if (
          isPlainRecord(item) &&
          item.type === 'text' &&
          typeof item.text === 'string'
        ) {
          out.push(item.text)
        }
      }
    }
  }
  return out
}

/**
 * Official `kUi` — extract the newly created document slug from a Claude Docs
 * `batch` tool response.
 */
export function extractCreatedDocSlugFromToolResult(
  data: unknown,
): string | null {
  const texts = collectTextCandidates(data)
  const last = texts.at(-1)
  if (!last) return null
  try {
    const parsed: unknown = JSON.parse(last)
    if (!isPlainRecord(parsed)) return null
    const created = parsed.created
    const frame = parsed.frame
    if (!isPlainRecord(created) || !isPlainRecord(frame)) return null
    if (created.verdict !== 'allow' || typeof created.minted !== 'string') {
      return null
    }
    if (typeof frame.slug !== 'string' || !DOC_SLUG_RE.test(frame.slug)) {
      return null
    }
    const mintedTail = created.minted.slice(created.minted.lastIndexOf('/') + 1)
    return frame.slug === mintedTail ? frame.slug : null
  } catch {
    return null
  }
}

export function buildDocsArtifactUrl(slug: string): string {
  const origin = getOauthConfig().CLAUDE_AI_ORIGIN.replace(/\/$/, '')
  return `${origin}/code/artifact/${slug}`
}

/**
 * #2037: Wrap a Claude Docs connector `batch` tool so that when Claude creates
 * a document in an interactive terminal session, the newly created doc URL is
 * opened in the user's browser.
 */
export function wrapDocsConnectorToolForTerminalAutoOpen(
  tool: Tool,
  serverName: string,
  config: ScopedMcpServerConfig,
  openUrl: (url: string) => Promise<boolean> = openBrowser,
): Tool {
  if (!isClaudeDocsConnectorServer(serverName, config)) {
    return tool
  }
  if (tool.mcpInfo?.toolName !== DOCS_BATCH_TOOL_NAME) {
    return tool
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return tool
  }
  if (getIsNonInteractiveSession() || config.scope !== 'claudeai') {
    return tool
  }

  const originalCall = tool.call
  return {
    ...tool,
    async call(input, context, canUseTool, parentMessage, onProgress) {
      const result = await originalCall.call(
        this,
        input,
        context,
        canUseTool,
        parentMessage,
        onProgress,
      )
      try {
        if (
          !isPlainRecord(input) ||
          !isPlainRecord(input.container) ||
          !isPlainRecord(input.container.create)
        ) {
          return result
        }
        // Only open in interactive main-thread terminal sessions.
        if (
          context.agentId !== undefined ||
          context.options?.isNonInteractiveSession ||
          context.abortController?.signal?.aborted
        ) {
          return result
        }
        const slug = extractCreatedDocSlugFromToolResult(result.data)
        if (!slug) {
          return result
        }
        const url = buildDocsArtifactUrl(slug)
        void openUrl(url)
          .then(opened => {
            logEvent('tengu_artifact_docs_create_open', {
              opened,
            })
            if (!opened) {
              logForDebugging(
                `[docs-connector] Failed to open created doc in browser: ${url}`,
              )
            }
          })
          .catch(() => {})
      } catch (err) {
        logForDebugging(
          `[docs-connector] Auto-open failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return result
    },
  }
}
