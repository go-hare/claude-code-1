/**
 * /code-review — Thorough code review covering bugs, security, performance,
 * and maintainability. Supports effort levels and --comment/--fix flags.
 *
 * densable 2.1.218 WJf / HBT / xol / sdr:
 * - context: fork by default (background subagent via shouldBackgroundForkedSkill)
 * - subcommands: { ultra: "ultrareview" } → `/code-review ultra` redirects to cloud
 * - densable 2.1.246 `ji()` omits disableModelInvocation (loader ?? false)
 * - /simplify is an alias for /code-review --fix
 *
 * densable 2.1.223:
 * - aliases: ['review'] — `/review` is `/code-review`
 * - codeReviewLastEffort — no-level reuses last typed effort
 *
 * densable 2.1.289:
 * - `--max-findings <n>|all|default` — persist as codeReviewLastMaxFindings
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../types/command.js'
import type { ToolUseContext } from '../Tool.js'
import { getPrintOutputFormat } from '../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { getCachedRepositoryHost } from '../utils/detectRepository.js'
import { isBundledSkillKillSwitchOn } from '../skills/bundledSkills.js'
import { isUltrareviewEnabled } from './review/ultrareviewEnabled.js'

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type EffortLevel = (typeof EFFORT_LEVELS)[number]

/** densable 2.1.289 — parsed `--max-findings` value (default clears persist). */
export type CodeReviewMaxFindings = number | 'all' | 'default'

const MAX_FINDINGS_FLAG_RE =
  /(^|\s)--max-findings(?:(?:\s*=\s*|\s+)(?!--)(\S+)|\s*=\S*)?(?=\s|$)/g

/**
 * densable 2.1.289 — strip `--max-findings` and parse its value.
 * Valid: whole number > 0, `all`, `default`. Anything else → ignored.
 */
export function parseCodeReviewMaxFindingsFlag(args: string): {
  rest: string
  /** Parsed value when the flag was present and valid (includes `default`). */
  maxFindings?: CodeReviewMaxFindings
  /** Flag present but value not valid. */
  maxFindingsIgnored: boolean
} {
  let captured: string | undefined
  let sawFlag = false
  const rest = args
    .replace(MAX_FINDINGS_FLAG_RE, (_m, _lead: string, value?: string) => {
      sawFlag = true
      if (value !== undefined) captured = value
      return ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
  if (!sawFlag) {
    return { rest: args.trim(), maxFindingsIgnored: false }
  }
  if (captured === undefined) {
    return { rest, maxFindingsIgnored: true }
  }
  const v = captured.trim().toLowerCase()
  if (v === 'all' || v === 'default') {
    return { rest, maxFindings: v, maxFindingsIgnored: false }
  }
  if (/^\d+$/.test(captured.trim())) {
    const n = Number(captured.trim())
    if (Number.isSafeInteger(n) && n > 0) {
      return { rest, maxFindings: n, maxFindingsIgnored: false }
    }
  }
  return { rest, maxFindingsIgnored: true }
}

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
  flagNames: readonly string[] = ['comment', 'fix', 'post', 'no-post'],
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
 * densable xol — parse effort / ultra / --comment / --fix / --max-findings / target.
 * First token `ultra` → ultraFallback (subcommand redirect handles real launch;
 * this is for getPrompt when ultra is not redirected).
 *
 * densable 2.1.223: when no explicit level, prefer `lastEffort` (codeReviewLastEffort)
 * over hard-coded medium.
 *
 * densable 2.1.289: `--max-findings` parsed before effort tokens; invalid values
 * set `maxFindingsIgnored` and leave the flag out of `rest`.
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
  /**
   * densable 2.1.289 — flag value when present and valid (`default` included).
   * Absent when the flag was omitted.
   */
  maxFindings?: CodeReviewMaxFindings
  /** densable 2.1.289 — flag present but value not valid. */
  maxFindingsIgnored: boolean
  /** densable He — `--post` stripped so it is not a review target. */
  post: boolean
  /** densable He — `--no-post` stripped so it is not a review target. */
  noPost: boolean
} {
  const maxFlag = parseCodeReviewMaxFindingsFlag(args)
  const { rawFirstToken, flags, rest } = parseCodeReviewFlagArgs(maxFlag.rest)
  const comment = flags.has('comment')
  const fix = flags.has('fix')
  const post = flags.has('post')
  const noPost = flags.has('no-post')
  const tokens = rest.split(/\s+/).filter(Boolean)
  const first = tokens[0] ?? ''
  const maxFields = {
    maxFindings: maxFlag.maxFindings,
    maxFindingsIgnored: maxFlag.maxFindingsIgnored,
    post,
    noPost,
  }

  // densable: ultra is detected on raw first token (before flag strip)
  if (rawFirstToken.toLowerCase() === 'ultra') {
    return {
      level: 'max',
      target: tokens.slice(1).join(' '),
      comment,
      fix,
      ultraFallback: true,
      ...maxFields,
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
      ...maxFields,
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
    ...maxFields,
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
 * densable 2.1.289 — persist last `--max-findings`. `default` clears the field.
 */
export function rememberCodeReviewMaxFindings(
  value: CodeReviewMaxFindings,
): void {
  const next = value === 'default' ? undefined : value
  saveGlobalConfig(current => {
    if (current.codeReviewLastMaxFindings === next) return current
    return { ...current, codeReviewLastMaxFindings: next }
  })
}

/**
 * densable `Et` — ReportFindings path is on only for a truthy env, a loaded
 * tool, and a print format other than text/json. Skill preload never uses it.
 */
function codeReviewUsesReportFindings(context: ToolUseContext): boolean {
  if (context.options.isSkillPreload) return false
  const format = getPrintOutputFormat()
  if (format === 'text' || format === 'json') return false
  if (!process.env.CLAUDE_CODE_REPORT_FINDINGS) return false
  return context.options.tools.some(tool => tool.name === 'ReportFindings')
}

/** densable `We` — ReportFindings / o5-bmin ceiling. */
export const CODE_REVIEW_FINDINGS_CAP = 32

type CodeReviewModelFamily =
  | 'default'
  | 'claude-sonnet-5'
  | 'claude-opus-4-8'
  | 'claude-opus-5'

/**
 * densable `me` cell names. Only the names that change the findings ceiling
 * matter here: `low-sonnet5` has no maximum; `o5-bmin` clamps all / >32 to 32.
 */
const CODE_REVIEW_CELLS: Record<
  CodeReviewModelFamily,
  Record<EffortLevel, string>
> = {
  default: {
    low: 'low',
    medium: 'o5-bmin',
    high: 'o48-high-v1',
    xhigh: 'o48-xhigh-v1',
    max: 'max',
  },
  'claude-sonnet-5': {
    low: 'low-sonnet5',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  'claude-opus-4-8': {
    low: 'o48-low-v1',
    medium: 'o48-med-v1',
    high: 'o48-high-v1',
    xhigh: 'o48-xhigh-v1',
    max: 'max',
  },
  'claude-opus-5': {
    low: 'low',
    medium: 'o5-bmin',
    high: 'o5-bmin',
    xhigh: 'o48-xhigh-v1',
    max: 'max',
  },
}

/** densable `Ge` — family key in `me`, else `default`. */
export function codeReviewModelFamily(
  model: string | undefined,
): CodeReviewModelFamily {
  if (!model) return 'default'
  const lower = model.toLowerCase()
  if (lower.includes('claude-opus-4-8')) return 'claude-opus-4-8'
  if (/claude-sonnet-5(?![-.0-9])/.test(lower)) return 'claude-sonnet-5'
  if (/claude-opus-5(?![-.0-9])/.test(lower)) return 'claude-opus-5'
  return 'default'
}

export function codeReviewEffortCell(
  model: string | undefined,
  level: EffortLevel,
): string {
  return CODE_REVIEW_CELLS[codeReviewModelFamily(model)][level]
}

/**
 * densable `on` — resolve asked/stated/reused max-findings for this review.
 * Reuses stored last when the flag was omitted (not on low-sonnet5 or skill preload).
 * ReportFindings or cell `o5-bmin` clamps `all` and values above 32 to 32.
 * `low-sonnet5` leaves stated unset.
 */
export function resolveCodeReviewMaxFindings(options: {
  maxFindings?: CodeReviewMaxFindings
  maxFindingsIgnored: boolean
  lastMaxFindings?: number | 'all'
  cell?: string
  isSkillPreload?: boolean
  usesReportFindings?: boolean
}): {
  asked?: number | 'all'
  stated?: number | 'all'
  reused: boolean
  ignored: boolean
} {
  const {
    maxFindings,
    maxFindingsIgnored,
    lastMaxFindings,
    cell = 'low',
    isSkillPreload = false,
    usesReportFindings = false,
  } = options
  const lastValid =
    lastMaxFindings === 'all' ||
    (typeof lastMaxFindings === 'number' &&
      Number.isSafeInteger(lastMaxFindings) &&
      lastMaxFindings > 0)
  const canReuse =
    maxFindings === undefined &&
    cell !== 'low-sonnet5' &&
    !isSkillPreload &&
    lastValid
  const asked = canReuse
    ? lastMaxFindings
    : maxFindings === 'default'
      ? undefined
      : maxFindings
  const stated =
    cell === 'low-sonnet5'
      ? undefined
      : (usesReportFindings || cell === 'o5-bmin') &&
          (asked === 'all' ||
            (typeof asked === 'number' && asked > CODE_REVIEW_FINDINGS_CAP))
        ? CODE_REVIEW_FINDINGS_CAP
        : asked
  return {
    asked,
    stated,
    reused: canReuse,
    ignored: maxFindingsIgnored,
  }
}

/** densable `nn` plus the fork/local wrapper around a non-empty notice. */
export function formatCodeReviewMaxFindingsNotice(options: {
  asked?: number | 'all'
  stated?: number | 'all'
  reused: boolean
  ignored: boolean
  /** densable `D` — local fork report, not the ReportFindings path. */
  willRunAsFork?: boolean
  /** densable `r` — prompt copy says "the user". */
  voice?: 'the user' | 'you'
}): string {
  const {
    asked,
    stated,
    reused,
    ignored,
    willRunAsFork = true,
    voice = 'the user',
  } = options
  const parts: string[] = []
  if (ignored) {
    parts.push(
      `\`--max-findings\` was ignored: type a whole number above zero, \`all\`, or \`default\` after it.${
        reused ? '' : ' Using the usual limit.'
      }`,
    )
  }
  const capSentence = `This review reports at most ${CODE_REVIEW_FINDINGS_CAP} findings, so the limit is ${CODE_REVIEW_FINDINGS_CAP} here.`
  if (asked !== undefined && stated === undefined) {
    parts.push(
      '`--max-findings` does not change this review: low effort here has no maximum.',
    )
  } else if (stated !== asked) {
    parts.push(
      reused
        ? `${voice === 'you' ? 'You' : 'The user'} set \`--max-findings ${asked}\` last time. ${capSentence}`
        : capSentence,
    )
  } else if (reused && asked !== undefined) {
    parts.push(
      asked === 'all'
        ? `Reporting every finding, as ${voice} chose last time with \`--max-findings all\`.`
        : `Reporting up to ${asked} ${asked === 1 ? 'finding' : 'findings'}, the limit ${voice} set last time with \`--max-findings\`.`,
    )
  }
  const notice = parts.join(' ')
  if (!notice) return ''
  const reuseHint = reused
    ? 'passing `--max-findings default` goes back to the usual limit'
    : undefined
  if (willRunAsFork) {
    return `(${notice} Open your report with one short line telling the user this${
      reuseHint ? `, and that ${reuseHint}` : ''
    }; that opening line reaches them with the findings.)\n`
  }
  return `(${notice} Tell the user this in one short line as you begin${
    reuseHint ? `, including that ${reuseHint}` : ''
  }.)\n`
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

function defaultMaxFindingsForLevel(level: EffortLevel): number {
  if (level === 'low') return 5
  if (level === 'medium') return 8
  if (level === 'high') return 10
  return 15
}

function buildPrompt(
  level: EffortLevel,
  target: string,
  comment: boolean,
  fix: boolean,
  ultraFallbackNote = '',
  unrecognizedNote = '',
  maxFindingsNote = '',
  maxFindingsCap?: number | 'all',
  cell?: string,
): string {
  const header = `You are performing a thorough code review at **${level}** effort level.`

  const targetInstr = target
    ? `Review target: \`${target}\`\n\nIf this is a PR number, run \`gh pr diff ${target}\` to get the diff. If it's a file path, read the file. If empty, review the current git diff (\`git diff HEAD\`).`
    : 'Review the current changes: run `git diff HEAD` (or `git diff --cached` if staged).'

  const cap =
    maxFindingsCap === 'all'
      ? 'every confirmed finding (no cap)'
      : typeof maxFindingsCap === 'number'
        ? String(maxFindingsCap)
        : cell === 'low-sonnet5'
          ? 'no maximum'
          : String(defaultMaxFindingsForLevel(level))

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

Cap at ${cap} findings. Prioritize bugs over style.
If no issues found, say so clearly.`

  return [
    ultraFallbackNote,
    unrecognizedNote,
    maxFindingsNote,
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
 * densable `hve` + `yGe` + `hR` — port stripped, www-stripped, then
 * github.com / gitlab.com / bitbucket.org plus ssh aliases. No self-hosted
 * hostname table (gold `n` is only `ssh.github.com` / `altssh.gitlab.com` /
 * `altssh.bitbucket.org`).
 */
function gitRemoteHostKind(
  host: string,
): 'github' | 'gitlab' | 'bitbucket' | 'other' {
  let h = host
    .replace(/:\d+$/, '')
    .replace(/[\t\n\r]/g, '')
    .toLowerCase()
  while (h.endsWith('.')) h = h.slice(0, -1)
  while (h.startsWith('www.')) h = h.slice(4)
  if (h === 'github.com' || h === 'ssh.github.com') return 'github'
  if (h === 'gitlab.com' || h === 'altssh.gitlab.com') return 'gitlab'
  if (h === 'bitbucket.org' || h === 'altssh.bitbucket.org') return 'bitbucket'
  return 'other'
}

/**
 * densable `oto` / `Tee` — GitLab MR target (`/-/merge_requests/N`, `!N`, or
 * a non-URL target while the cached origin host is GitLab).
 */
export function isGitLabCodeReviewTarget(target: string): boolean {
  if (/\/-\/merge_requests\/\d/.test(target) || /^!\d+$/.test(target)) {
    return true
  }
  if (/^https?:\/\//i.test(target)) return false
  const host = getCachedRepositoryHost()
  return host !== null && gitRemoteHostKind(host) === 'gitlab'
}

/**
 * densable `Oa` / `x(T)` — `--post` is ultra-only. Local review strips it from
 * the target; only `post===true` prefixes the ignored sentence onto the local
 * notice. `--no-post` strips with no sentence. `gitlabTarget` is gold `oto`.
 */
export function wrapCodeReviewPostIgnored(
  note: string,
  options: {
    post: boolean
    comment: boolean
    gitlabTarget?: boolean
  },
): string {
  if (!options.post) return note
  const gitlab = options.gitlabTarget === true
  const clause = options.comment
    ? gitlab
      ? 'when the target is a GitLab merge request, your `--comment` is what posts the findings as one general MR note via glab'
      : 'when the target is a GitHub PR, your `--comment` is what posts the findings as inline PR comments'
    : gitlab
      ? 'this local review will not post to GitLab; `--comment` is the flag that posts local findings as a general MR note'
      : 'this local review will not post to GitHub; `--comment` is the flag that posts local findings as inline PR comments'
  return `${note}(The typed \`--post\` applies only to the \`/code-review ultra\` cloud review and was ignored — ${clause}. Tell the user this in one short line.)\n`
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

/** densable `Ea` — effort bands, remembered --max-findings, ultra --post. */
function codeReviewCommandDescription(): string {
  const ultra = isUltrareviewEnabled()
  const effortTail = ultra
    ? '; ultra: deep multi-agent review in the cloud (requires claude.ai account access)'
    : ''
  const postTail = ultra
    ? ' For ultra on a GitHub.com PR target, --post asks to post the finished review’s findings to the PR as a single comment from the user’s GitHub account (not a review; the launch dialog still confirms in interactive sessions, while non-interactive mode posts on the flag alone) and --no-post hides that option.'
    : ''
  return `Review the current diff, or a PR number/branch/path target, for correctness bugs (plus reuse/simplification/efficiency cleanups where the model's review recipe covers them) at the given effort level (low/medium: fewer, high-confidence findings; high→max: broader coverage, may include uncertain findings${effortTail}); with no level given, it reuses the level you typed last. Pass --comment to post findings as inline PR comments, or --fix to apply the findings to the working tree after the review. Pass --max-findings <n> to report up to n findings, or --max-findings all for every finding. The choice stays until you pass --max-findings default.${postTail}`
}

/** densable `Ra`. */
function codeReviewArgumentHint(): string {
  const levels = isUltrareviewEnabled()
    ? `${EFFORT_LEVELS.join('|')}|ultra`
    : EFFORT_LEVELS.join('|')
  return `[${levels}] [--fix] [--comment] [<pr#>|<branch>|<path>] [--max-findings <n>|all]`
}

const codeReview = {
  type: 'prompt',
  name: 'code-review',
  // densable 2.1.223: /review is an alias of /code-review
  aliases: ['review'],
  // densable WJf menuDescription / Ea description
  menuDescription: 'Review the current diff or a PR for bugs and cleanups',
  description: codeReviewCommandDescription(),
  argumentHint: codeReviewArgumentHint(),
  userInvocable: true,
  // densable 2.1.218: fork by default → background subagent + task-notification
  context: 'fork' as const,
  // densable Cvo: background defaults true for fork
  background: true,
  // densable sdr: first-arg redirect /code-review ultra → /ultrareview
  subcommands: { ultra: 'ultrareview' },
  // densable registers /code-review as a bundled skill (`ks`), so a user
  // skill of the same name shadows it in the slash menu (`xLt`).
  source: 'bundled' as const,
  loadedFrom: 'bundled' as const,
  isEnabled: () => !isBundledSkillKillSwitchOn(),
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
      maxFindings,
      maxFindingsIgnored,
      post,
    } = parseCodeReviewArgs(args, lastEffort)
    // densable onUserTypedArgs / uYT — only persist when user named a valid level
    if (explicit !== undefined) {
      rememberCodeReviewEffort(explicit)
    }
    // densable 2.1.289 — persist --max-findings when present and valid (default clears)
    if (maxFindings !== undefined) {
      rememberCodeReviewMaxFindings(maxFindings)
    }
    const cell = codeReviewEffortCell(context.options.mainLoopModel, level)
    const usesReportFindings = codeReviewUsesReportFindings(context)
    const maxResolved = resolveCodeReviewMaxFindings({
      maxFindings,
      maxFindingsIgnored,
      lastMaxFindings: getGlobalConfig().codeReviewLastMaxFindings,
      cell,
      isSkillPreload: context.options.isSkillPreload === true,
      usesReportFindings,
    })
    const maxFindingsNote = formatCodeReviewMaxFindingsNotice({
      ...maxResolved,
      willRunAsFork: !usesReportFindings,
    })
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
      wrapCodeReviewPostIgnored(ultraNote || effortNote, {
        post,
        comment,
        gitlabTarget: isGitLabCodeReviewTarget(target),
      }),
      '',
      maxFindingsNote,
      maxResolved.stated,
      cell,
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
