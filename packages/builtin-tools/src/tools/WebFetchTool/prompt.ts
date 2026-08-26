import { shouldUseSimpleSystemPrompt } from 'src/utils/simpleSystemPrompt.js'
import { plural } from 'src/utils/stringUtils.js'

const DEFAULT_WEBFETCH_CACHE_TTL_MS = 900_000

/** Official `C1a` — env or 900000. Shared memo lives in utils.ts for the LRU. */
function webFetchCacheTtlMs(): number {
  const raw = process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  return DEFAULT_WEBFETCH_CACHE_TTL_MS
}

export const WEB_FETCH_TOOL_NAME = 'WebFetch'

/** Official `x1a` — quote rules when the page is not preapproved. */
export const WEB_FETCH_QUOTE_RULES = ` - Enforce a strict 125-character maximum for quotes from any source document. Open Source Software is ok as long as we respect the license.
 - Use quotation marks for exact language from articles; any language outside of the quotation should never be word-for-word the same.
 - You are not a lawyer and never comment on the legality of your own prompts and responses.
 - Never produce or reproduce exact song lyrics.`

/**
 * Official `eC` / `QEv` for WebFetch: no model → false (before env).
 * When model is present, leanPrompt is the simple-system-prompt host.
 */
export function isLeanWebFetchPrompt(model?: string): boolean {
  if (!model) return false
  return shouldUseSimpleSystemPrompt({ model })
}

/** Official `KHp` / `C1a`. */
export function formatWebFetchCacheTtl(): string {
  const minutes = Math.max(1, Math.round(webFetchCacheTtlMs() / 60_000))
  return `${minutes} ${plural(minutes, 'minute')}`
}

/** Official `SFv`. */
export function getWebFetchUsageNotes(): string {
  return `
- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning cache (entries expire after ${formatWebFetchCacheTtl()}) for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
`
}

/** @deprecated Official `SFv` — use getWebFetchUsageNotes(). */
export const DESCRIPTION = getWebFetchUsageNotes()

/**
 * Official `YHp(model, artifactException=false)`.
 */
export function getWebFetchPrompt(
  model?: string,
  artifactException = false,
): string {
  if (isLeanWebFetchPrompt(model)) {
    return `Fetches a URL, converts the page to markdown, and answers \`prompt\` against it using a small fast model.

- Fails on authenticated/private URLs — use an authenticated MCP tool or \`gh\` for those instead.${artifactException ? ' Exception: claude.ai/code/artifact/{uuid} URLs ARE fetchable via your claude.ai login — use WebFetch, not curl (curl gets the SPA shell or a Cloudflare 403).' : ''}
- HTTP is upgraded to HTTPS. Cross-host redirects are returned to you rather than followed; call again with the redirect URL.
- Responses are cached for ${formatWebFetchCacheTtl()} per URL.`
  }
  return `IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, look for a specialized MCP tool that provides authenticated access.
${
  artifactException
    ? `- Exception: claude.ai/code/artifact/{uuid} URLs (including preview.claude.ai) ARE fetchable — WebFetch uses your claude.ai login. Use WebFetch for these, not curl or a headless browser (those return the SPA shell or a Cloudflare 403, not the content).
`
    : ''
}${getWebFetchUsageNotes()}`
}

export function makeSecondaryModelPrompt(
  markdownContent: string,
  prompt: string,
  isPreapprovedDomain: boolean,
): string {
  const guidelines = isPreapprovedDomain
    ? `Provide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed.`
    : `Provide a concise response based only on the content above. In your response:
${WEB_FETCH_QUOTE_RULES}`

  return `
Web page content:
---
${markdownContent}
---

${prompt}

${guidelines}
`
}
