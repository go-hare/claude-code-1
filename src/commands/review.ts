import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import type { Command } from '../commands.js'
import { isUltrareviewEnabled } from './review/ultrareviewEnabled.js'

// Legal wants the explicit surface name plus a docs link visible before the
// user triggers, so the description carries "Claude Code on the web" + URL.
const CCR_TERMS_URL = 'https://code.claude.com/docs/en/claude-code-on-the-web'

const LOCAL_REVIEW_PROMPT = (args: string) => `
      You are an expert code reviewer. Follow these steps:

      1. If no PR number is provided in the args, run \`gh pr list\` to show open PRs
      2. If a PR number is provided, run \`gh pr view <number>\` to get PR details
      3. Run \`gh pr diff <number>\` to get the diff
      4. Analyze the changes and provide a thorough code review that includes:
         - Overview of what the PR does
         - Analysis of code quality and style
         - Specific suggestions for improvements
         - Any potential issues or risks

      Keep your review concise but thorough. Focus on:
      - Code correctness
      - Following project conventions
      - Performance implications
      - Test coverage
      - Security considerations

      Format your review with clear sections and bullet points.

      PR number: ${args}
    `

/**
 * densable 2.1.223: `/review` is an alias of `/code-review` (see codeReview.ts).
 * Keep this legacy prompt command hidden so name resolution prefers the alias
 * on code-review; residual for any direct import/tests that still load it.
 */
const review: Command = {
  type: 'prompt',
  name: 'review',
  description: 'Review a pull request (deprecated — use /code-review)',
  progressMessage: 'reviewing pull request',
  contentLength: 0,
  source: 'builtin',
  // Prefer code-review's aliases:['review'] for dispatch/menu.
  isHidden: true,
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    return [{ type: 'text', text: LOCAL_REVIEW_PROMPT(args) }]
  },
}

// densable 2.1.218: preferred entry is `/code-review ultra` (subcommand redirect).
// /ultrareview remains as deprecated alias. /review stays purely local.
// local-jsx type renders the overage permission dialog when free reviews are exhausted.
// densable dual registration (nGd local-jsx + oGd local supportsNonInteractive):
// interactive → dialog; non-interactive (-p) → headless cloud launch without JSX.
const ultrareview: Command = {
  type: 'local-jsx',
  name: 'ultrareview',
  description: `~10–20 min · Finds and verifies bugs using a multi-agent review fleet. Prefer /code-review ultra. Runs in Claude Code on the web. See ${CCR_TERMS_URL}`,
  isEnabled: () => isUltrareviewEnabled() && !getIsNonInteractiveSession(),
  load: () => import('./review/ultrareviewCommand.js'),
}

/**
 * densable oGd — headless /ultrareview for -p / non-interactive sessions.
 * Hidden in interactive (local-jsx sibling owns the menu).
 */
const ultrareviewNonInteractive: Command = {
  type: 'local',
  name: 'ultrareview',
  description: `~10–20 min · Finds and verifies bugs using a multi-agent review fleet. Prefer /code-review ultra. Runs in Claude Code on the web. See ${CCR_TERMS_URL}`,
  supportsNonInteractive: true,
  isEnabled: () => isUltrareviewEnabled() && getIsNonInteractiveSession(),
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  load: () => import('./review/ultrareviewHeadless.js'),
}

export default review
export { ultrareview, ultrareviewNonInteractive }
