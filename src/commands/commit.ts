import type { Command } from '../commands.js'
import * as attributionMod from '../utils/attribution.js'
import {
  hasMatchingFunctionHook,
  runFunctionHookChain,
} from '../utils/plugins/functionHooksModules.js'
import { executeShellCommandsInPrompt } from '../utils/promptShellExecution.js'
import { getUndercoverInstructions, isUndercover } from '../utils/undercover.js'

const ALLOWED_TOOLS = [
  'Bash(git add:*)',
  'Bash(git status:*)',
  'Bash(git commit:*)',
]

const ATTRIBUTION_TEXT_SITE = {
  checkArgument: (
    passed: Record<string, unknown>,
    original: Record<string, unknown>,
  ): string | undefined => {
    if (typeof passed.kind !== 'string') return 'no { kind }'
    if (passed.kind !== original.kind) {
      return 'a changed kind (the hooks beneath match on it)'
    }
    return typeof passed.text === 'string' ? undefined : 'no { text }'
  },
}

async function resolveHookAttributionText(
  kind: 'commit' | 'pr',
  text: string,
): Promise<string> {
  const maybeResolve = (
    attributionMod as Partial<typeof import('../utils/attribution.js')>
  ).resolveAttributionText
  if (typeof maybeResolve === 'function') {
    return maybeResolve(kind, text)
  }
  if (!hasMatchingFunctionHook('attribution.text', { kind })) {
    return text
  }
  const payload: Record<string, unknown> = { kind, text }
  const tail = async (
    event: Record<string, unknown>,
  ): Promise<{ text: string }> => ({
    text: typeof event.text === 'string' ? event.text : text,
  })
  try {
    const result = await runFunctionHookChain(
      'attribution.text',
      payload,
      tail,
      undefined,
      undefined,
      { site: ATTRIBUTION_TEXT_SITE },
    )
    if (
      result !== null &&
      typeof result === 'object' &&
      'text' in result &&
      typeof (result as { text?: unknown }).text === 'string'
    ) {
      return (result as { text: string }).text
    }
  } catch {
    // Preserve base text on hook error
  }
  return text
}

async function getPromptContent(): Promise<string> {
  const baseAttribution = attributionMod.getAttributionTexts()
  let commitAttribution = baseAttribution.commit
  if (
    !(process.env.USER_TYPE === 'ant' && isUndercover()) &&
    hasMatchingFunctionHook('attribution.text')
  ) {
    commitAttribution = await resolveHookAttributionText(
      'commit',
      commitAttribution,
    )
  }

  let prefix = ''
  if (process.env.USER_TYPE === 'ant' && isUndercover()) {
    prefix = getUndercoverInstructions() + '\n'
  }

  return `${prefix}## Context

- Current git status: !\`git status\`
- Current git diff (staged and unstaged changes): !\`git diff HEAD\`
- Current branch: !\`git branch --show-current\`
- Recent commits: !\`git log --oneline -10\`

## Git Safety Protocol

- NEVER update the git config
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- CRITICAL: ALWAYS create NEW commits. NEVER use git commit --amend, unless the user explicitly requests it
- Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported

## Your task

Based on the above changes, create a single git commit:

1. Analyze all staged changes and draft a commit message:
   - Look at the recent commits above to follow this repository's commit message style
   - Summarize the nature of the changes (new feature, enhancement, bug fix, refactoring, test, docs, etc.)
   - Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.)
   - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"

2. Stage relevant files and create the commit using HEREDOC syntax:
\`\`\`
git commit -m "$(cat <<'EOF'
Commit message here.${commitAttribution ? `\n\n${commitAttribution}` : ''}
EOF
)"
\`\`\`

You have the capability to call multiple tools in a single response. Stage and create the commit using a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls.`
}

const command = {
  type: 'prompt',
  name: 'commit',
  description: 'Create a git commit',
  userInvocable: true,
  allowedTools: ALLOWED_TOOLS,
  contentLength: 0, // Dynamic content
  progressMessage: 'creating commit',
  source: 'builtin',
  async getPromptForCommand(_args, context) {
    const promptContent = await getPromptContent()
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
            },
          }
        },
      },
      '/commit',
    )

    return [{ type: 'text', text: finalContent }]
  },
} satisfies Command

export default command
