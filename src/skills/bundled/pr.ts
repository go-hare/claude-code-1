import { getDefaultBranch } from '../../utils/git.js'
import { registerBundledSkill } from '../bundledSkills.js'

function buildPrPrompt(guidance: string, defaultBranch: string): string {
  const g = guidance.trim()
  return `## Context

- Current git status: !\`git status\`
- Current branch: !\`git branch --show-current\`
- Commits since origin/${defaultBranch}: !\`git log --oneline origin/${defaultBranch}..HEAD\`
- Full diff vs origin/${defaultBranch}: !\`git diff origin/${defaultBranch}...HEAD\`
${g ? `\nUser guidance for this PR: ${g}\n` : ''}
## Git Safety Protocol

- NEVER update the git config
- NEVER force push to main/master; warn the user if they request it
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported
- Use the gh command for ALL GitHub-related tasks including issues, pull requests, checks, and releases. If given a GitHub URL, use gh to fetch it

## Your task

Based on the changes above, open a single pull request:

1. Analyze ALL changes that will be included in the PR (every commit since ${defaultBranch}, not just the latest), then draft a title and body:
   - Keep the title short (under 70 characters); put detail in the body

2. Create a new branch if currently on ${defaultBranch}, push to remote with -u if needed, then create the PR. To ensure good formatting, ALWAYS pass the body inline via a HEREDOC, never from a file or stdin (\`--body-file\`/\`-F\`, even \`--body-file -\`, is refused while this skill runs):
\`\`\`
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]
EOF
)"
\`\`\`

3. Return the PR URL when you're done, so the user can see it.

You have the capability to call multiple tools in a single response. Branch, push, and create the PR using a single message. Do not run additional commands to read or explore code beyond the git context above, and do not use any non-git tools for this task.`
}

export function registerPrSkill(): void {
  registerBundledSkill({
    name: 'pr',
    menuDescription: 'Create a pull request',
    description:
      'Create a GitHub pull request. Use whenever you are about to open a PR, whether the user asked for one or it is a step in your current task — it gathers branch context and applies the required PR workflow (gh CLI, title/body format, attribution).',
    argumentHint: '[guidance]',
    userInvocable: true,
    progressMessage: 'creating pull request',
    async getPromptForCommand(args) {
      const branch = (await getDefaultBranch()) || 'main'
      return [{ type: 'text', text: buildPrPrompt(args, branch) }]
    },
  })
}
