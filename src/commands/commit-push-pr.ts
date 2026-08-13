import type { Command } from '../commands.js'
import {
  getAttributionTexts,
  getEnhancedPRAttribution,
} from '../utils/attribution.js'
import { getDefaultBranch } from '../utils/git.js'
import { executeShellCommandsInPrompt } from '../utils/promptShellExecution.js'
import { getUndercoverInstructions, isUndercover } from '../utils/undercover.js'

/**
 * densable 2.1.229 #28 — commit-push-pr allow/deny tool lists.
 *
 * SEA (`aPp` / `Wjb` / `oPp` / `Vjb` via `Y8e`+`BOn`):
 * - Allow only specific safe prefixes (`git commit -m *`, `git push origin *`, …)
 *   — NOT broad `git commit:*` / `git push:*` (dangerous flags no longer auto-match).
 * - Deny dangerous flag shapes even if an allow prefix would otherwise match.
 * - `Y8e` dual-wraps Bash + PowerShell; `BOn` drops `PowerShell(git checkout -b *)`.
 */

/** densable aPp + push origin variants */
const COMMIT_PUSH_PR_ALLOW_PATTERNS = [
  'git checkout -b *',
  'git add *',
  'git status *',
  'git commit -m *',
  'gh pr create --title * --body *',
  'gh pr edit --title * --body *',
  'gh pr view *',
  'git push origin *',
  'git push -u origin *',
] as const

/** densable Wjb */
const COMMIT_PUSH_PR_EXTRA_TOOLS = [
  'ToolSearch',
  'mcp__slack__send_message',
  'mcp__claude_ai_Slack__slack_send_message',
] as const

/**
 * densable disallowed clusters for commit-push-pr (`WXo`+`UXo`+`qXo`+`jXo`+`zXo`+`ZIp`).
 * Patterns use mid-command wildcards so `git commit -m "x" --no-verify` still denies.
 */
const COMMIT_PUSH_PR_DENY_PATTERNS = [
  // WXo — force/chmod add
  'git add --f*',
  'git add * --f*',
  'git add -f*',
  'git add * -f*',
  'git add --c*',
  'git add * --c*',
  // UXo — commit dangerous flags
  'git commit *--fil*',
  'git commit * -F*',
  'git commit *--te*',
  'git commit * -t*',
  'git commit *--pathspec-fr*',
  'git commit *--no-veri*',
  'git commit *--no-g*',
  'git commit *--am*',
  'git commit *--allow-empty*',
  'git commit *--reu*',
  'git commit *--ree*',
  // qXo — force checkout
  'git checkout *--f*',
  'git checkout * -f*',
  // jXo — force/delete/mirror push
  'git push *--force*',
  'git push * -f*',
  'git push *--de*',
  'git push * -d*',
  'git push * :**',
  'git push *":**',
  "git push *':**",
  'git push * +*',
  'git push *"+*',
  "git push *'+*",
  'git push *--pu*',
  'git push * -o*',
  'git push *--m*',
  'git push *--pru*',
  'git push *--no-veri*',
  'git push *--rece*',
  'git push *--e*',
  // densable QIp=["git *--output*"] exists in SEA but is NOT in Vjb
  // (Vjb = Y8e([...WXo,...UXo,...qXo,...jXo,...zXo,...ZIp])). QIp is used by
  // a different densable deny list (Ddw), not commit-push-pr.
  // zXo — gh pr create dangerous
  'gh pr create *--repo*',
  'gh pr create * -R*',
  'gh pr create *--body-file*',
  'gh pr create * -F*',
  'gh pr create *--head*',
  'gh pr create * -H*',
  'gh pr create *--base*',
  'gh pr create * -B*',
  'gh pr create *--recover*',
  // ZIp — gh pr edit dangerous
  'gh pr edit *--repo*',
  'gh pr edit -R*',
  'gh pr edit * -R*',
  'gh pr edit *--body-file*',
  'gh pr edit -F*',
  'gh pr edit * -F*',
  'gh pr edit *--base*',
  'gh pr edit -B*',
  'gh pr edit * -B*',
  'gh pr edit http*',
] as const

/** densable Y8e — dual-wrap Bash + PowerShell */
function wrapShellToolPatterns(patterns: readonly string[]): string[] {
  return patterns.flatMap(p => [`Bash(${p})`, `PowerShell(${p})`])
}

/** densable BOn — drop PowerShell checkout -b (Windows path quirk) */
function filterPowerShellCheckout(tools: string[]): string[] {
  return tools.filter(t => t !== 'PowerShell(git checkout -b *)')
}

const ALLOWED_TOOLS = [
  ...filterPowerShellCheckout(
    wrapShellToolPatterns(COMMIT_PUSH_PR_ALLOW_PATTERNS),
  ),
  ...COMMIT_PUSH_PR_EXTRA_TOOLS,
]

const DISALLOWED_TOOLS = wrapShellToolPatterns(COMMIT_PUSH_PR_DENY_PATTERNS)

function getPromptContent(
  defaultBranch: string,
  prAttribution?: string,
): string {
  const { commit: commitAttribution, pr: defaultPrAttribution } =
    getAttributionTexts()
  // Use provided PR attribution or fall back to default
  const effectivePrAttribution = prAttribution ?? defaultPrAttribution
  const safeUser = process.env.SAFEUSER || ''
  const username = process.env.USER || ''

  let prefix = ''
  let reviewerArg = ' and `--reviewer anthropics/claude-code`'
  let addReviewerArg = ' (and add `--add-reviewer anthropics/claude-code`)'
  let changelogSection = `

## Changelog
<!-- CHANGELOG:START -->
[If this PR contains user-facing changes, add a changelog entry here. Otherwise, remove this section.]
<!-- CHANGELOG:END -->`
  let slackStep = `

5. After creating/updating the PR, check if the user's CLAUDE.md mentions posting to Slack channels. If it does, use SearchExtraTools to search for "slack send message" tools. If SearchExtraTools finds a Slack tool, ask the user if they'd like you to post the PR URL to the relevant Slack channel. Only post if the user confirms. If SearchExtraTools returns no results or errors, skip this step silently—do not mention the failure, do not attempt workarounds, and do not try alternative approaches.`
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    prefix = getUndercoverInstructions() + '\n'
    reviewerArg = ''
    addReviewerArg = ''
    changelogSection = ''
    slackStep = ''
  }

  return `${prefix}## Context

- \`SAFEUSER\`: ${safeUser}
- \`whoami\`: ${username}
- \`git status\`: !\`git status\`
- \`git diff HEAD\`: !\`git diff HEAD\`
- \`git branch --show-current\`: !\`git branch --show-current\`
- \`git diff ${defaultBranch}...HEAD\`: !\`git diff ${defaultBranch}...HEAD\`
- \`gh pr view --json number 2>/dev/null || true\`: !\`gh pr view --json number 2>/dev/null || true\`

## Git Safety Protocol

- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc) unless the user explicitly requests them
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- Do not commit files that likely contain secrets (.env, credentials.json, etc)
- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported

## Your task

Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request from the git diff ${defaultBranch}...HEAD output above).

Based on the above changes:
1. Create a new branch if on ${defaultBranch} (use SAFEUSER from context above for the branch name prefix, falling back to whoami if SAFEUSER is empty, e.g., \`username/feature-name\`)
2. Create a single commit with an appropriate message using heredoc syntax${commitAttribution ? `, ending with the attribution text shown in the example below` : ''}:
\`\`\`
git commit -m "$(cat <<'EOF'
Commit message here.${commitAttribution ? `\n\n${commitAttribution}` : ''}
EOF
)"
\`\`\`
3. Push the branch to origin
4. If a PR already exists for this branch (check the gh pr view output above), update the PR title and body using \`gh pr edit\` to reflect the current diff${addReviewerArg}. Otherwise, create a pull request using \`gh pr create\` with heredoc syntax for the body${reviewerArg}.
   - IMPORTANT: Keep PR titles short (under 70 characters). Use the body for details.
\`\`\`
gh pr create --title "Short, descriptive title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]${changelogSection}${effectivePrAttribution ? `\n\n${effectivePrAttribution}` : ''}
EOF
)"
\`\`\`

You have the capability to call multiple tools in a single response. You MUST do all of the above in a single message.${slackStep}

Return the PR URL when you're done, so the user can see it.`
}

const command = {
  type: 'prompt',
  name: 'commit-push-pr',
  description: 'Commit, push, and open a PR',
  allowedTools: ALLOWED_TOOLS,
  // densable Vjb — deny dangerous git/gh flags even under allow prefixes
  disallowedTools: DISALLOWED_TOOLS,
  get contentLength() {
    // Use 'main' as estimate for content length calculation
    return getPromptContent('main').length
  },
  progressMessage: 'creating commit and PR',
  source: 'builtin',
  async getPromptForCommand(args, context) {
    // Get default branch and enhanced PR attribution
    const [defaultBranch, prAttribution] = await Promise.all([
      getDefaultBranch(),
      getEnhancedPRAttribution(context.getAppState),
    ])
    let promptContent = getPromptContent(defaultBranch, prAttribution)

    // Append user instructions if args provided
    const trimmedArgs = args?.trim()
    if (trimmedArgs) {
      promptContent += `\n\n## Additional instructions from user\n\n${trimmedArgs}`
    }

    const finalContent = await executeShellCommandsInPrompt(
      promptContent,
      {
        ...context,
        getAppState() {
          const appState = context.getAppState()
          return {
            ...appState,
            toolPermissionContext: {
              ...appState.toolPermissionContext,
              alwaysAllowRules: {
                ...appState.toolPermissionContext.alwaysAllowRules,
                command: ALLOWED_TOOLS,
              },
              alwaysDenyRules: {
                ...appState.toolPermissionContext.alwaysDenyRules,
                command: [
                  ...(appState.toolPermissionContext.alwaysDenyRules?.command ??
                    []),
                  ...DISALLOWED_TOOLS,
                ],
              },
            },
          }
        },
      },
      '/commit-push-pr',
    )

    return [{ type: 'text', text: finalContent }]
  },
} satisfies Command

export default command

/** @internal densable 2.1.229 tests */
export const __test = {
  ALLOWED_TOOLS,
  DISALLOWED_TOOLS,
  COMMIT_PUSH_PR_ALLOW_PATTERNS,
  COMMIT_PUSH_PR_DENY_PATTERNS,
}
