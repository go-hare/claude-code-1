/**
 * /code-review — Thorough code review covering bugs, security, performance,
 * and maintainability. Supports effort levels and --comment/--fix flags.
 *
 * Upstream: kY_ function registers 'code-review' and 'simplify' commands.
 * /simplify is an alias for /code-review --fix.
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type EffortLevel = (typeof EFFORT_LEVELS)[number]

const COMMENT_INSTRUCTIONS = `
## Posting to GitHub (--comment)
The \`--comment\` flag was passed. After producing the findings list, if the
review target is a GitHub PR, post each finding as an inline PR comment via
\`gh api repos/{owner}/{repo}/pulls/{pr}/comments\` with a suggestion block
when the fix is clear. If the target is not a PR, print the findings to the
terminal and note that \`--comment\` was ignored.`

const FIX_INSTRUCTIONS = `
## Applying fixes (--fix)
The \`--fix\` flag was passed. After the review phase completes, apply each
confirmed finding to the working tree. For each fix:
1. Make the minimal change that addresses the finding
2. Run the project's lint/typecheck if available
3. If a fix introduces new issues, revert it and note why
Summarize what was fixed and what was skipped.`

function parseArgs(args: string): {
  level: EffortLevel
  target: string
  comment: boolean
  fix: boolean
} {
  const parts = args.trim().split(/\s+/)
  let level: EffortLevel = 'medium'
  let comment = false
  let fix = false
  const remaining: string[] = []

  for (const part of parts) {
    if (part === '--comment') {
      comment = true
      continue
    }
    if (part === '--fix') {
      fix = true
      continue
    }
    const lower = part.toLowerCase()
    const matched = EFFORT_LEVELS.find(l => l.startsWith(lower.slice(0, 3)))
    if (matched && !remaining.length) {
      level = matched
      continue
    }
    remaining.push(part)
  }

  return { level, target: remaining.join(' '), comment, fix }
}

function buildPrompt(
  level: EffortLevel,
  target: string,
  comment: boolean,
  fix: boolean,
): string {
  const header = `You are performing a thorough code review at **${level}** effort level.`

  const targetInstr = target
    ? `Review target: \`${target}\`\n\nIf this is a PR number, run \`gh pr diff ${target}\` to get the diff. If it's a file path, read the file. If empty, review the current git diff (\`git diff HEAD\`).`
    : 'Review the current changes: run `git diff HEAD` (or `git diff --cached` if staged).'

  const phases = `
## Review Process

### Phase 1 — Gather context
1. Get the diff (see target above)
2. Read any files referenced in the diff that need full context
3. Check for test files related to changed code

### Phase 2 — Find issues (${level === 'low' ? '3' : level === 'medium' ? '5' : '7'} angles)
Run independent analysis passes looking for:

**Correctness angles:**
- Logic errors, off-by-one, null/undefined paths
- Race conditions, async/await misuse
- Type mismatches the compiler can't catch

**Quality angles:**
- Code that duplicates existing utilities (check imports)
- Missing error handling at system boundaries
- Performance: O(n²) where O(n) exists, unnecessary allocations

${
  level !== 'low'
    ? `**Altitude angle:**
- Does the change fit the project's architecture?
- Are there simpler approaches the author may have missed?`
    : ''
}

For each finding, note: file, line, severity (bug/perf/style), one-line summary, and a concrete failure scenario.

### Phase 3 — Verify (adversarial)
For each candidate finding, ask: "Can I construct a specific input or sequence that triggers this?" Drop findings where the answer is no.

### Phase 4 — Report
Present confirmed findings as a numbered list:
\`\`\`
1. [severity] file:line — title
   Description of the issue and how to fix it.
\`\`\`

Cap at ${level === 'low' ? '5' : level === 'medium' ? '8' : '10'} findings. Prioritize bugs over style.
If no issues found, say so clearly.`

  return [
    header,
    targetInstr,
    phases,
    comment ? COMMENT_INSTRUCTIONS : '',
    fix ? FIX_INSTRUCTIONS : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const codeReview = {
  type: 'prompt',
  name: 'code-review',
  description:
    'Thorough code review covering bugs, security, performance, and maintainability',
  argumentHint: '[low|medium|high|xhigh|max] [--comment] [--fix] [<target>]',
  userInvocable: true,
  // densable 2.1.215: model must not auto-run /code-review; user slash only
  disableModelInvocation: true,
  source: 'builtin' as const,
  progressMessage: 'Reviewing code...',
  contentLength: 2000,
  async getPromptForCommand(
    args: string,
    _context: ToolUseContext,
  ): Promise<ContentBlockParam[]> {
    const { level, target, comment, fix } = parseArgs(args)
    const prompt = buildPrompt(level, target, comment, fix)
    return [{ type: 'text', text: prompt }]
  },
} satisfies Command

const simplify = {
  type: 'prompt',
  name: 'simplify',
  description:
    'Review the current diff and apply the fixes — equivalent to /code-review --fix',
  argumentHint: '[low|medium|high] [--comment] [<target>]',
  userInvocable: true,
  source: 'builtin' as const,
  progressMessage: 'Reviewing and fixing...',
  contentLength: 2000,
  async getPromptForCommand(
    args: string,
    context: ToolUseContext,
  ): Promise<ContentBlockParam[]> {
    return codeReview.getPromptForCommand(`${args} --fix`.trim(), context)
  },
} satisfies Command

export { codeReview, simplify }
