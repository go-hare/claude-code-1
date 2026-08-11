/**
 * /code-review — Thorough code review covering bugs, security, performance,
 * and maintainability. Supports effort levels and --comment/--fix flags.
 *
 * densable 2.1.218 WJf / HBT / xol / sdr:
 * - context: fork by default (background subagent via shouldBackgroundForkedSkill)
 * - subcommands: { ultra: "ultrareview" } → `/code-review ultra` redirects to cloud
 * - disableModelInvocation: true (215)
 * - /simplify is an alias for /code-review --fix
 *
 * densable 2.1.223:
 * - aliases: ['review'] — `/review` is `/code-review`
 * - codeReviewLastEffort — no-level reuses last typed effort
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { isUltrareviewEnabled } from './review/ultrareviewEnabled.js'

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

/**
 * densable AJf — strip `--comment`/`--fix` tokens anywhere; keep raw first token
 * (pre-strip) for ultra detection and return the residual scope string.
 */
export function parseCodeReviewFlagArgs(
  args: string,
  flagNames: readonly string[] = ['comment', 'fix'],
): {
  rawFirstToken: string
  flags: Set<string>
  rest: string
} {
  const trimmed = args.trim()
  const rawFirstToken = trimmed.split(/\s+/, 1)[0] ?? ''
  const flags = new Set<string>()
  let rest = trimmed
  for (const name of flagNames) {
    const re = new RegExp(`(?:^|\\s)--${name}(?=\\s|$)`, 'g')
    const next = rest.replace(re, '')
    if (next !== rest) {
      flags.add(name)
      rest = next.trim()
    }
  }
  return { rawFirstToken, flags, rest }
}

/** densable DBT — effort-like token that is not a known level. */
const UNRECOGNIZED_EFFORT_RE = new RegExp(
  `^(${EFFORT_LEVELS.map(l => l.slice(0, 3)).join('|')})[a-z]*$`,
  'i',
)

/** densable okt — exact effort level (case-insensitive). */
function parseEffortLevelToken(token: string): EffortLevel | undefined {
  const lower = token.trim().toLowerCase()
  return (EFFORT_LEVELS as readonly string[]).includes(lower)
    ? (lower as EffortLevel)
    : undefined
}

/**
 * densable xol — parse effort / ultra / --comment / --fix / target.
 * First token `ultra` → ultraFallback (subcommand redirect handles real launch;
 * this is for getPrompt when ultra is not redirected).
 *
 * densable 2.1.223: when no explicit level, prefer `lastEffort` (codeReviewLastEffort)
 * over hard-coded medium.
 */
export function parseCodeReviewArgs(
  args: string,
  lastEffort?: EffortLevel,
): {
  level: EffortLevel
  target: string
  comment: boolean
  fix: boolean
  ultraFallback: boolean
  unrecognizedLevel?: string
  /** densable xol.explicit — set only when user named a valid effort level. */
  explicit?: EffortLevel
  /** densable: last stored effort reused when user typed no level. */
  reusedLastEffort?: EffortLevel
} {
  const { rawFirstToken, flags, rest } = parseCodeReviewFlagArgs(args)
  const comment = flags.has('comment')
  const fix = flags.has('fix')
  const tokens = rest.split(/\s+/).filter(Boolean)
  const first = tokens[0] ?? ''

  // densable: ultra is detected on raw first token (before flag strip)
  if (rawFirstToken.toLowerCase() === 'ultra') {
    return {
      level: 'max',
      target: tokens.slice(1).join(' '),
      comment,
      fix,
      ultraFallback: true,
    }
  }

  const explicit =
    first.toLowerCase() === 'ultra' ? undefined : parseEffortLevelToken(first)
  if (explicit !== undefined) {
    return {
      level: explicit,
      explicit,
      target: tokens.slice(1).join(' '),
      comment,
      fix,
      ultraFallback: false,
    }
  }

  // densable: unrecognized effort-like token keeps full rest as target
  const unrecognizedLevel = UNRECOGNIZED_EFFORT_RE.test(first)
    ? first
    : undefined
  const fallback = lastEffort ?? 'medium'
  return {
    level: fallback,
    target: rest,
    comment,
    fix,
    ultraFallback: false,
    unrecognizedLevel,
    reusedLastEffort: lastEffort,
  }
}

/**
 * densable 2.1.223 — persist last typed effort (only when user named a valid level).
 */
export function rememberCodeReviewEffort(level: EffortLevel): void {
  saveGlobalConfig(current => {
    if (current.codeReviewLastEffort === level) return current
    return { ...current, codeReviewLastEffort: level }
  })
}

/**
 * densable notice when reusing last effort / ignoring unrecognized level.
 */
export function formatCodeReviewEffortNotice(options: {
  level: EffortLevel
  reusedLastEffort?: EffortLevel
  unrecognizedLevel?: string
}): string {
  const { level, reusedLastEffort, unrecognizedLevel } = options
  if (unrecognizedLevel) {
    const reuseHint =
      reusedLastEffort !== undefined && reusedLastEffort === level
        ? ', the level the user typed last time'
        : ''
    return `(Ignoring unrecognized effort "${unrecognizedLevel}"; valid: ${EFFORT_LEVELS.join(', ')}. Using ${level}${reuseHint}.)\n`
  }
  if (reusedLastEffort !== undefined) {
    return `(No effort level given — reusing ${reusedLastEffort}, the level the user typed last time. Type a level like \`/code-review high\` to change it.)\n`
  }
  return ''
}

function buildPrompt(
  level: EffortLevel,
  target: string,
  comment: boolean,
  fix: boolean,
  ultraFallbackNote = '',
  unrecognizedNote = '',
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
    ultraFallbackNote,
    unrecognizedNote,
    header,
    targetInstr,
    phases,
    comment ? COMMENT_INSTRUCTIONS : '',
    fix ? FIX_INSTRUCTIONS : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * densable FBT — ultraFallback note when cloud path is not available or not
 * launched via subcommand redirect (e.g. model-invoked path / ultraFallback).
 *
 * densable branches:
 * - !$Z() (ultraEnabled false): environment / account access copy
 * - ultraEnabled + ultrareview command registered: tell user to type /code-review ultra
 * - ultraEnabled + command not registered: terminal `claude ultrareview` / silent local --fix
 */
export function formatCodeReviewUltraFallbackNote(options: {
  ultraEnabled: boolean
  fix: boolean
  level: EffortLevel
  isNonInteractive?: boolean
  /** densable: commands.some(name===ultrareview && enabled) */
  ultraCommandAvailable?: boolean
}): string {
  const {
    ultraEnabled,
    fix,
    level,
    isNonInteractive,
    ultraCommandAvailable = true,
  } = options
  if (!ultraEnabled) {
    if (fix) {
      return `(Running a local ${level}-effort review and applying its findings.)\n`
    }
    if (isNonInteractive) {
      return `(ultra (cloud review) requires claude.ai account access this session doesn't have — see https://code.claude.com/docs/en/ultrareview. Falling back to a local ${level}-effort review.)\n`
    }
    return `(ultra (cloud review) isn't available in this environment — see https://code.claude.com/docs/en/ultrareview. Falling back to a local ${level}-effort review.)\n`
  }
  if (fix) {
    return ultraCommandAvailable
      ? `(Claude can't launch the cloud review directly — type \`/code-review ultra --fix\` to review in the cloud and apply the findings locally when it completes. Running a local ${level}-effort review and applying its findings for now.)\n`
      : `(Running a local ${level}-effort review and applying its findings.)\n`
  }
  return ultraCommandAvailable
    ? `(Claude can't launch the cloud review directly — type \`/code-review ultra\` to run it. Falling back to a local ${level}-effort review for now.)\n`
    : `(Claude can't launch the cloud review directly — the user can run \`claude ultrareview\` from a terminal to start it. Falling back to a local ${level}-effort review for now.)\n`
}

const codeReview = {
  type: 'prompt',
  name: 'code-review',
  // densable 2.1.223: /review is an alias of /code-review
  aliases: ['review'],
  // densable WJf menuDescription / OBT description
  description:
    'Review the current diff for bugs and cleanups; use ultra for multi-agent cloud review',
  argumentHint:
    '[low|medium|high|xhigh|max|ultra] [--fix] [--comment] [<target>]',
  userInvocable: true,
  // densable 2.1.215: model must not auto-run /code-review; user slash only
  disableModelInvocation: true,
  // densable 2.1.218: fork by default → background subagent + task-notification
  context: 'fork' as const,
  // densable Cvo: background defaults true for fork
  background: true,
  // densable sdr: first-arg redirect /code-review ultra → /ultrareview
  subcommands: { ultra: 'ultrareview' },
  source: 'builtin' as const,
  progressMessage: 'Reviewing code...',
  contentLength: 2000,
  async getPromptForCommand(
    args: string,
    context: ToolUseContext,
  ): Promise<ContentBlockParam[]> {
    const storedLast = getGlobalConfig().codeReviewLastEffort
    const lastEffort =
      storedLast && (EFFORT_LEVELS as readonly string[]).includes(storedLast)
        ? (storedLast as EffortLevel)
        : undefined
    const {
      level,
      target,
      comment,
      fix,
      ultraFallback,
      unrecognizedLevel,
      explicit,
      reusedLastEffort,
    } = parseCodeReviewArgs(args, lastEffort)
    // densable onUserTypedArgs / uYT — only persist when user named a valid level
    if (explicit !== undefined) {
      rememberCodeReviewEffort(explicit)
    }
    const ultraEnabled = isUltrareviewEnabled()
    const ultraCommandAvailable =
      context.options?.commands?.some(
        c => c.name === 'ultrareview' && c.isEnabled?.() !== false,
      ) ?? false
    const ultraNote = ultraFallback
      ? formatCodeReviewUltraFallbackNote({
          ultraEnabled,
          fix,
          level,
          isNonInteractive: context.options?.isNonInteractiveSession,
          ultraCommandAvailable: ultraEnabled && ultraCommandAvailable,
        })
      : ''
    // densable 2.1.223 effort notice (reuse last / ignore unrecognized)
    const effortNote = !ultraFallback
      ? formatCodeReviewEffortNotice({
          level,
          reusedLastEffort,
          unrecognizedLevel,
        })
      : ''
    const prompt = buildPrompt(
      level,
      target,
      comment,
      fix,
      ultraNote,
      effortNote,
    )
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
  // densable: simplify also forks like code-review local path
  context: 'fork' as const,
  background: true,
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
