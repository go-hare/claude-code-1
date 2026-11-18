import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from 'src/Tool.js'
import type { PermissionUpdate } from 'src/types/permissions.js'
import { getAgentContext } from 'src/utils/agentContext.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import {
  getDenyRuleForTool,
  getRuleByContentsForTool,
} from 'src/utils/permissions/permissions.js'
import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
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
  formatWebFetchReadOnNote,
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
  sliceFromOffset,
  sliceToMax,
} from './utils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().url().describe('The URL to fetch content from'),
    prompt: z.string().describe('The prompt to run on the fetched content'),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Character position in the page text to start reading from. Use it to read on through a page too long for one call, with the value the previous result gave.',
      ),
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

export const WebFetchTool = Object.assign(
  buildTool({
    name: WEB_FETCH_TOOL_NAME,
    searchHint: 'fetch and extract content from a URL',
    backgrounding: 'detach',
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
    // densable 2.1.289: isEnabled(){return!a.CLAUDE_CODE_DISABLE_WEB_FETCH&&sn(mwe)}
    // mwe = allow_web_fetch (policy/GB). Env alone is the product kill switch for forks.
    isEnabled() {
      return !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_WEB_FETCH)
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
    async prompt(options) {
      const model = options?.model
      const tools = options?.tools
      const leanPrompt = (options as { leanPrompt?: boolean } | undefined)
        ?.leanPrompt
      const enabled = await isWebFetchArtifactExceptionEnabled(tools)
      const hasArtifactTool =
        enabled &&
        (tools?.some(tool => tool.name === OFFICIAL_ARTIFACT_TOOL_NAME) ??
          false)
      return getWebFetchPrompt(
        model,
        hasArtifactTool ? 'artifact-tool' : enabled ? 'webfetch' : 'none',
        leanPrompt,
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
    async call({ url, prompt, offset = 0 }, context) {
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
              offset,
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
- prompt: "${prompt}"${offset > 0 ? `\n- offset: ${offset}` : ''}`

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
        offset,
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
  } satisfies ToolDef<InputSchema, Output>),
  {
    permissionCheckFailureDecision(
      input: unknown,
      _context?: ToolUseContext,
    ): PermissionDecision | undefined {
      if (
        typeof input !== 'object' ||
        input === null ||
        Array.isArray(input) ||
        !Object.keys(input).some(
          k => k !== 'url' && k !== 'prompt' && k !== 'offset',
        )
      ) {
        return undefined
      }
      return {
        behavior: 'deny',
        message:
          'Nothing was fetched. A PermissionRequest hook approved this fetch with arguments attached that WebFetch cannot check. Have the hook approve without sending arguments back, or send back only url, prompt and offset.',
        decisionReason: {
          type: 'safetyCheck',
          reason:
            'A PermissionRequest hook approved this fetch with arguments WebFetch cannot check, so the fetch did not run.',
          classifierApprovable: false,
        },
      }
    },
  },
)

export async function formatFetchedWebResult({
  url,
  prompt,
  offset = 0,
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
  offset?: number
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
  const remaining = sliceFromOffset(content, offset)
  let result: string
  if (isWebFetchAgent) {
    result = await wrapRawFetchedWebContent({
      url,
      code,
      contentType,
      content,
      offset,
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
  } else if (offset > 0 && remaining === '') {
    result = `Nothing left to read from offset ${offset}: this page's text is ${content.length} characters long.`
  } else if (
    isPreapproved &&
    contentType.includes('text/markdown') &&
    remaining.length < MAX_MARKDOWN_LENGTH
  ) {
    result = remaining
  } else {
    const contentLead =
      offset > 0
        ? `The content below is one part of a longer page: it starts ${offset} characters into the page's ${content.length}.\n`
        : ''
    result = await applyPromptToMarkdown(
      prompt,
      remaining,
      abortController.signal,
      isNonInteractiveSession,
      isPreapproved,
      contentLead,
    )
    const startOffset = content.length - remaining.length
    const endOffset =
      startOffset + sliceToMax(remaining, MAX_MARKDOWN_LENGTH).length
    if (endOffset < content.length) {
      result += `\n\n[${WEB_FETCH_TOOL_NAME} note: this page's text is ${content.length} characters long and the answer above covers only characters ${startOffset} to ${endOffset}; the final ${content.length - endOffset} were not read${formatWebFetchReadOnNote(endOffset)}.]`
    }
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
