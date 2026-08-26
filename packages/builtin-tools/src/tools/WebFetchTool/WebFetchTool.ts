import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import type { PermissionUpdate } from 'src/types/permissions.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import {
  getDenyRuleForTool,
  getRuleByContentsForTool,
} from 'src/utils/permissions/permissions.js'
import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'
import {
  isWebFetchArtifactExceptionEnabled,
  OFFICIAL_ARTIFACT_TOOL_NAME,
  tryArtifactWebFetchFail,
} from 'src/utils/artifactUrl.js'
import { isWebFetchAgentRuntimeContext } from '../AgentTool/built-in/webFetchAgent.js'
import { isPreapprovedHost } from './preapproved.js'
import { getWebFetchPrompt, WEB_FETCH_TOOL_NAME } from './prompt.js'
import {
  formatWebFetchBinaryNote,
  wrapRawFetchedWebContent,
} from './rawWrap.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import {
  applyPromptToMarkdown,
  type FetchedContent,
  fetchContentWithTavily,
  getURLMarkdownContent,
  isPreapprovedUrl,
  MAX_MARKDOWN_LENGTH,
} from './utils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to fetch content from'),
    prompt: z.string().describe('The prompt to run on the fetched content'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    bytes: z.number().describe('Size of the fetched content in bytes'),
    code: z.number().describe('HTTP response code'),
    codeText: z.string().describe('HTTP response code text'),
    result: z
      .string()
      .describe('Processed result from applying the prompt to the content'),
    durationMs: z
      .number()
      .describe('Time taken to fetch and process the content'),
    url: z.string().describe('The URL that was fetched'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function webFetchToolInputToPermissionRuleContent(input: {
  [k: string]: unknown
}): string {
  try {
    const parsedInput = WebFetchTool.inputSchema.safeParse(input)
    if (!parsedInput.success) {
      return `input:${input.toString()}`
    }
    const { url } = parsedInput.data
    const hostname = new URL(url).hostname
    return `domain:${hostname}`
  } catch {
    return `input:${input.toString()}`
  }
}

export const WebFetchTool = buildTool({
  name: WEB_FETCH_TOOL_NAME,
  searchHint: 'fetch and extract content from a URL',
  // 100K chars - tool result persistence threshold
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    const { url } = input as { url: string }
    try {
      const hostname = new URL(url).hostname
      return `Claude wants to fetch content from ${hostname}`
    } catch {
      return `Claude wants to fetch content from this URL`
    }
  },
  userFacingName() {
    return 'Fetch'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Fetching ${summary}` : 'Fetching web page'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.prompt ? `${input.url}: ${input.prompt}` : input.url
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    const permissionContext = appState.toolPermissionContext

    // Check if the hostname is in the preapproved list
    try {
      const { url } = input as { url: string }
      const parsedUrl = new URL(url)
      if (isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname)) {
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionReason: { type: 'other', reason: 'Preapproved host' },
        }
      }
    } catch {
      // If URL parsing fails, continue with normal permission checks
    }

    // Check for a rule specific to the tool input (matching hostname)
    const ruleContent = webFetchToolInputToPermissionRuleContent(input)

    const denyRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `${WebFetchTool.name} denied access to ${ruleContent}.`,
        decisionReason: {
          type: 'rule',
          rule: denyRule,
        },
      }
    }

    const askRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'ask',
    ).get(ruleContent)
    if (askRule) {
      return {
        behavior: 'ask',
        message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`,
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
        suggestions: buildSuggestions(ruleContent),
      }
    }

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      WebFetchTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'rule',
          rule: allowRule,
        },
      }
    }

    return {
      behavior: 'ask',
      message: `Claude requested permissions to use ${WebFetchTool.name}, but you haven't granted it yet.`,
      suggestions: buildSuggestions(ruleContent),
    }
  },
  async prompt({ model, tools }) {
    return getWebFetchPrompt(
      model,
      await isWebFetchArtifactExceptionEnabled(tools),
    )
  },
  async validateInput(input) {
    const { url } = input
    try {
      new URL(url)
    } catch {
      return {
        result: false,
        message: `Error: Invalid URL "${url}". The URL provided could not be parsed.`,
        meta: { reason: 'invalid_url' },
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call({ url, prompt }, context) {
    const {
      abortController,
      options: { isNonInteractiveSession, tools },
    } = context
    const start = Date.now()
    const artifactFail = await tryArtifactWebFetchFail(
      url,
      tools,
      isWebFetchAgentRuntimeContext(getAgentContext() ?? {}),
      start,
      getDenyRuleForTool(context.getAppState().toolPermissionContext, {
        name: OFFICIAL_ARTIFACT_TOOL_NAME,
      }) !== null,
    )
    if (artifactFail) return artifactFail

    // Select backend: settings.webFetchAdapter → default 'tavily'
    const settings = getSettings_DEPRECATED()
    const backend = settings.webFetchAdapter ?? 'tavily'

    // Tavily path: /extract returns Markdown directly — skip turndown + queryHaiku
    if (backend === 'tavily') {
      const response = await fetchContentWithTavily(url, abortController)

      if ('type' in response && response.type === 'redirect') {
        const statusText = 'See Other'
        const message = `REDIRECT DETECTED: The URL redirects to a different host.
Original URL: ${(response as { originalUrl: string }).originalUrl}
Redirect URL: ${(response as { redirectUrl: string }).redirectUrl}

Please use WebFetch again with the redirect URL.`

        const output: Output = {
          bytes: Buffer.byteLength(message),
          code: 302,
          codeText: statusText,
          result: message,
          durationMs: Date.now() - start,
          url,
        }
        return { data: output }
      }

      const {
        content,
        bytes,
        code,
        codeText,
        contentType,
        persistedPath,
        persistedSize,
      } = response as FetchedContent

      const result = prompt
        ? await formatFetchedWebResult({
            url,
            prompt,
            content,
            contentType,
            code,
            bytes,
            persistedPath,
            persistedSize,
            abortController,
            isNonInteractiveSession,
          })
        : content

      const output: Output = {
        bytes,
        code,
        codeText,
        result,
        durationMs: Date.now() - start,
        url,
      }
      return { data: output }
    }

    // HTTP direct path (original behavior): fetch + turndown + queryHaiku
    const response = await getURLMarkdownContent(url, abortController)

    // Check if we got a redirect to a different host
    if ('type' in response && response.type === 'redirect') {
      const statusText =
        response.statusCode === 301
          ? 'Moved Permanently'
          : response.statusCode === 308
            ? 'Permanent Redirect'
            : response.statusCode === 307
              ? 'Temporary Redirect'
              : 'Found'

      const message = `REDIRECT DETECTED: The URL redirects to a different host.

Original URL: ${response.originalUrl}
Redirect URL: ${response.redirectUrl}
Status: ${response.statusCode} ${statusText}

To complete your request, I need to fetch content from the redirected URL. Please use WebFetch again with these parameters:
- url: "${response.redirectUrl}"
- prompt: "${prompt}"`

      const output: Output = {
        bytes: Buffer.byteLength(message),
        code: response.statusCode,
        codeText: statusText,
        result: message,
        durationMs: Date.now() - start,
        url,
      }

      return {
        data: output,
      }
    }

    const {
      content,
      bytes,
      code,
      codeText,
      contentType,
      persistedPath,
      persistedSize,
    } = response as FetchedContent

    const result = await formatFetchedWebResult({
      url,
      prompt,
      content,
      contentType,
      code,
      bytes,
      persistedPath,
      persistedSize,
      abortController,
      isNonInteractiveSession,
    })

    const output: Output = {
      bytes,
      code,
      codeText,
      result,
      durationMs: Date.now() - start,
      url,
    }

    return {
      data: output,
    }
  },
  mapToolResultToToolResultBlockParam({ result }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: result,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

async function formatFetchedWebResult({
  url,
  prompt,
  content,
  contentType,
  code,
  bytes,
  persistedPath,
  persistedSize,
  abortController,
  isNonInteractiveSession,
}: {
  url: string
  prompt: string
  content: string
  contentType: string
  code: number
  bytes: number
  persistedPath?: string
  persistedSize?: number
  abortController: AbortController
  isNonInteractiveSession: boolean
}): Promise<string> {
  const isWebFetchAgent = isWebFetchAgentRuntimeContext(getAgentContext() ?? {})
  const isPreapproved = isPreapprovedUrl(url)
  let result: string
  if (isWebFetchAgent) {
    result = await wrapRawFetchedWebContent({
      url,
      code,
      contentType,
      content,
      isPreapproved,
      summarizeRemainder: remainder =>
        applyPromptToMarkdown(
          prompt,
          remainder,
          abortController.signal,
          isNonInteractiveSession,
          isPreapproved,
        ),
    })
  } else if (
    isPreapproved &&
    contentType.includes('text/markdown') &&
    content.length < MAX_MARKDOWN_LENGTH
  ) {
    result = content
  } else {
    result = await applyPromptToMarkdown(
      prompt,
      content,
      abortController.signal,
      isNonInteractiveSession,
      isPreapproved,
    )
  }
  if (persistedPath) {
    result += formatWebFetchBinaryNote(
      isWebFetchAgent,
      contentType,
      persistedSize ?? bytes,
      persistedPath,
    )
  }
  return result
}

function buildSuggestions(ruleContent: string): PermissionUpdate[] {
  return [
    {
      type: 'addRules',
      destination: 'localSettings',
      rules: [{ toolName: WEB_FETCH_TOOL_NAME, ruleContent }],
      behavior: 'allow',
    },
  ]
}
