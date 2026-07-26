export const BASE_CHROME_PROMPT = `# Claude in Chrome browser automation

You have access to browser automation tools (mcp__claude-in-chrome__*) for interacting with web pages in Chrome. Follow these guidelines for effective browser automation.

## GIF recording

When performing multi-step browser interactions that the user may want to review or share, use mcp__claude-in-chrome__gif_creator to record them.

You must ALWAYS:
* Capture extra frames before and after taking actions to ensure smooth playback
* Name the file meaningfully to help the user identify it later (e.g., "login_process.gif")

## Console log debugging

You can use mcp__claude-in-chrome__read_console_messages to read console output. Console output may be verbose. If you are looking for specific log entries, use the 'pattern' parameter with a regex-compatible pattern. This filters results efficiently and avoids overwhelming output. For example, use pattern: "[MyApp]" to filter for application-specific logs rather than reading all console output.

## Alerts and dialogs

IMPORTANT: Do not trigger JavaScript alerts, confirms, prompts, or browser modal dialogs through your actions. These browser dialogs block all further browser events and will prevent the extension from receiving any subsequent commands. Instead, when possible, use console.log for debugging and then use the mcp__claude-in-chrome__read_console_messages tool to read those log messages. If a page has dialog-triggering elements:
1. Avoid clicking buttons or links that may trigger alerts (e.g., "Delete" buttons with confirmation dialogs)
2. If you must interact with such elements, warn the user first that this may interrupt the session
3. Use mcp__claude-in-chrome__javascript_tool to check for and dismiss any existing dialogs before proceeding

If you accidentally trigger a dialog and lose responsiveness, inform the user they need to manually dismiss it in the browser.

## Avoid rabbit holes and loops

When using browser automation tools, stay focused on the specific task. If you encounter any of the following, stop and ask the user for guidance:
- Unexpected complexity or tangential browser exploration
- Browser tool calls failing or returning errors after 2-3 attempts
- No response from the browser extension
- Page elements not responding to clicks or input
- Pages not loading or timing out
- Unable to complete the browser task despite multiple approaches

Explain what you attempted, what went wrong, and ask how the user would like to proceed. Do not keep retrying the same failing browser action or explore unrelated pages without checking in first.

## Tab context and session startup

IMPORTANT: At the start of each browser automation session, call mcp__claude-in-chrome__tabs_context_mcp **with createIfEmpty: true** (or omit createIfEmpty — the Host defaults it to true) first. That creates the MCP tab group if none exists and returns tab IDs. **tabs_create_mcp alone cannot create the group** — it only adds a tab inside an existing group; without a prior context bootstrap you get "No MCP tab group exists".

Never reuse tab IDs from a previous/other session. Follow these guidelines:
1. First: tabs_context_mcp (createIfEmpty true / omitted) — bootstrap group + list tabs
2. Only reuse an existing tab if the user explicitly asks to work with it
3. Otherwise, create a new tab with mcp__claude-in-chrome__tabs_create_mcp (after step 1)
4. Navigate / computer / read_page always need a tabId from context or create
5. If a tool returns an error indicating the tab doesn't exist or is invalid, call tabs_context_mcp again (createIfEmpty true) for fresh tab IDs
6. When a tab is closed by the user or a navigation error occurs, call tabs_context_mcp to see what tabs are available`

/**
 * Additional instructions for chrome tools when tool search is enabled.
 * These instruct the model to load chrome tools via SearchExtraTools before using them.
 * Only injected when tool search is actually enabled (not just optimistically possible).
 */
export const CHROME_SEARCH_EXTRA_TOOLS_INSTRUCTIONS = `**IMPORTANT: Before using any chrome browser tools, you MUST first load them using SearchExtraTools.**

Chrome browser tools are MCP tools that require loading before use. Before calling any mcp__claude-in-chrome__* tool:
1. Use SearchExtraTools with \`select:mcp__claude-in-chrome__<tool_name>\` to load the specific tool
2. Then call the tool

For example, to get tab context:
1. First: SearchExtraTools with query "select:mcp__claude-in-chrome__tabs_context_mcp"
2. Then: Call mcp__claude-in-chrome__tabs_context_mcp`

/**
 * Get the base chrome system prompt (without tool search instructions).
 * Tool search instructions are injected separately at request time in claude.ts
 * based on the actual tool search enabled state.
 */
export function getChromeSystemPrompt(): string {
  return BASE_CHROME_PROMPT
}

const CHROME_PROMPT_MARKER = '# Claude in Chrome browser automation'

/**
 * Merge or strip the full chrome system prompt for the current session.
 *
 * Launch `--chrome` bakes the prompt into appendSystemPrompt once; mid-session
 * `/chrome` This session On/Off toggles bootstrap
 * `claudeInChromeSessionPromptActive` so later turns can inject without a
 * restart (and Off can drop launch-baked chrome text).
 *
 * Auto-enable skill hints stay when full chrome is inactive. When full chrome
 * becomes active (This session On after YOs auto-enable), skill hints are
 * stripped so the model does not get skill-invoke + full BASE stack.
 */
export function resolveChromeAppendSystemPrompt(
  append?: string,
): string | undefined {
  // Lazy import keeps prompt.ts free of bootstrap cycles at module eval.
  const { getClaudeInChromeSessionPromptActive } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../bootstrap/state.js') as typeof import('../../bootstrap/state.js')

  const active = getClaudeInChromeSessionPromptActive()
  const chrome = getChromeSystemPrompt()
  let base = append?.trim() ? append : undefined

  if (base?.includes(CHROME_PROMPT_MARKER)) {
    if (active) {
      // Full chrome already present — drop any leftover auto-enable skill hint.
      const cleaned = stripChromeSkillHints(base)
      return cleaned?.trim() ? cleaned : chrome
    }
    base = stripChromeSystemPromptBlock(base, chrome)
  }

  if (!active) {
    return base?.trim() ? base : undefined
  }

  // Full enable supersedes skill-only auto-enable hint.
  base = stripChromeSkillHints(base)
  return base ? `${chrome}\n\n${base}` : chrome
}

function stripChromeSkillHints(append: string | undefined): string | undefined {
  if (!append) return undefined
  let out = append
  // Longer variant first so the shorter hint is not a partial residue.
  if (out.includes(CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER)) {
    out = out.split(CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER).join('')
  }
  if (out.includes(CLAUDE_IN_CHROME_SKILL_HINT)) {
    out = out.split(CLAUDE_IN_CHROME_SKILL_HINT).join('')
  }
  return out.replace(/\n{3,}/g, '\n\n').trim() || undefined
}

function stripChromeSystemPromptBlock(append: string, chrome: string): string {
  if (append === chrome) {
    return ''
  }
  if (append.startsWith(`${chrome}\n\n`)) {
    return append.slice(chrome.length + 2)
  }
  if (append.endsWith(`\n\n${chrome}`)) {
    return append.slice(0, -(chrome.length + 2))
  }
  return append
    .split(chrome)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Minimal hint about Claude in Chrome skill availability. This is injected at startup when the extension is installed
 * to guide the model to invoke the skill before using the MCP tools.
 */
export const CLAUDE_IN_CHROME_SKILL_HINT = `**Browser Automation**: Chrome browser tools are available via the "claude-in-chrome" skill. CRITICAL: Before using any mcp__claude-in-chrome__* tools, invoke the skill by calling the Skill tool with skill: "claude-in-chrome". The skill provides browser automation instructions and enables the tools.`

/**
 * Variant when the built-in WebBrowser tool is also available — steer
 * dev-loop tasks to WebBrowser and reserve the extension for the user's
 * authenticated Chrome (logged-in sites, OAuth, computer-use).
 */
export const CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER = `**Browser Automation**: Use WebBrowser for development (dev servers, JS eval, console, screenshots). Use claude-in-chrome for the user's real Chrome when you need logged-in sessions, OAuth, or computer-use — invoke Skill(skill: "claude-in-chrome") before any mcp__claude-in-chrome__* tool.`
