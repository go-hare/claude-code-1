/**
 * Memory type taxonomy.
 *
 * Memories are constrained to four types capturing context NOT derivable
 * from the current project state. Code patterns, architecture, git history,
 * and file structure are derivable (via grep/git/CLAUDE.md) and should NOT
 * be saved as memories.
 *
 * The two TYPES_SECTION_* exports below are intentionally duplicated rather
 * than generated from a shared spec — keeping them flat makes per-mode edits
 * trivial without reasoning through a helper's conditional rendering.
 */

export const MEMORY_TYPES = [
  'user',
  'feedback',
  'project',
  'reference',
] as const

export type MemoryType = (typeof MEMORY_TYPES)[number]

/**
 * Parse a raw frontmatter value into a MemoryType.
 * Invalid or missing values return undefined — legacy files without a
 * `type:` field keep working, files with unknown types degrade gracefully.
 */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined
  return MEMORY_TYPES.find(t => t === raw)
}

/**
 * `## Types of memory` section for COMBINED mode (private + team directories).
 * Includes <scope> tags and team/private qualifiers in examples.
 */
export const TYPES_SECTION_COMBINED: readonly string[] = [
  '## Types of memory',
  '',
  'There are several discrete types of memory that you can store in your memory system. Each type below declares a <scope> of `private`, `team`, or guidance for choosing between the two.',
  '',
  '<types>',
  '<type>',
  '    <name>user</name>',
  '    <scope>always private</scope>',
  "    <description>The user's role, goals, preferences, responsibilities, and knowledge. Use these to tailor your behavior to the user.</description>",
  '</type>',
  '<type>',
  '    <name>feedback</name>',
  '    <scope>default to private. Save as team only when the guidance is clearly a project-wide convention that every contributor should follow (e.g., a testing policy, a build invariant), not a personal style preference.</scope>',
  '    <description>Guidance from the user about how to approach work — what to avoid and what to keep doing. Record from failure AND success. Include *why* so you can judge edge cases later. Structure content as: rule/fact, then **Why:** and **How to apply:** lines.</description>',
  '</type>',
  '<type>',
  '    <name>project</name>',
  '    <scope>private or team, but strongly bias toward team</scope>',
  '    <description>Information about ongoing work, goals, initiatives, bugs, or incidents not derivable from code or git history. Convert relative dates to absolute dates when saving (e.g., "Thursday" → "2026-03-05").</description>',
  '</type>',
  '<type>',
  '    <name>reference</name>',
  '    <scope>usually team</scope>',
  '    <description>Pointers to external systems where information can be found (e.g., Linear projects, Slack channels, Grafana dashboards).</description>',
  '</type>',
  '</types>',
  '',
]

/**
 * `## Types of memory` section for INDIVIDUAL-ONLY mode (single directory).
 * No <scope> tags. Prose that only makes sense with a private/team split is reworded.
 */
export const TYPES_SECTION_INDIVIDUAL: readonly string[] = [
  '## Types of memory',
  '',
  '<types>',
  '<type>',
  '    <name>user</name>',
  "    <description>The user's role, goals, preferences, responsibilities, and knowledge. Use these to tailor your behavior to the user.</description>",
  '</type>',
  '<type>',
  '    <name>feedback</name>',
  '    <description>Guidance from the user about how to approach work — what to avoid and what to keep doing. Record from failure AND success. Include *why* so you can judge edge cases later. Structure content as: rule/fact, then **Why:** and **How to apply:** lines.</description>',
  '</type>',
  '<type>',
  '    <name>project</name>',
  '    <description>Information about ongoing work, goals, initiatives, bugs, or incidents not derivable from code or git history. Convert relative dates to absolute dates when saving (e.g., "Thursday" → "2026-03-05").</description>',
  '</type>',
  '<type>',
  '    <name>reference</name>',
  '    <description>Pointers to external systems where information can be found (e.g., Linear projects, Slack channels, Grafana dashboards).</description>',
  '</type>',
  '</types>',
  '',
]

/**
 * `## What NOT to save in memory` section. Identical across both modes.
 */
export const WHAT_NOT_TO_SAVE_SECTION: readonly string[] = [
  '## What NOT to save in memory',
  '',
  '- Code patterns, conventions, architecture, file paths, or project structure — these can be derived by reading the current project state.',
  '- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.',
  '- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.',
  '- Anything already documented in CLAUDE.md files.',
  '- Ephemeral task details: in-progress work, temporary state, current conversation context.',
  '',
  // H2: explicit-save gate. Eval-validated (memory-prompt-iteration case 3,
  // 0/2 → 3/3): prevents "save this week's PR list" → activity-log noise.
  'These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.',
]

/**
 * Recall-side drift caveat. Single bullet under `## When to access memories`.
 * Proactive: verify memory against current state before answering.
 */
export const MEMORY_DRIFT_CAVEAT =
  '- Memory records can become stale over time. Use memory as context for what was true at a given point in time. Before answering the user or building assumptions based solely on information in memory records, verify that the memory is still correct and up-to-date by reading the current state of the files or resources. If a recalled memory conflicts with current information, trust what you observe now — and update or remove the stale memory rather than acting on it.'

/**
 * `## When to access memories` section. Includes MEMORY_DRIFT_CAVEAT.
 *
 * H6 (branch-pollution evals #22856, case 5 1/3 on capy): the "ignore" bullet
 * is the delta. Failure mode: user says "ignore memory about X" → Claude reads
 * code correctly but adds "not Y as noted in memory" — treats "ignore" as
 * "acknowledge then override" rather than "don't reference at all." The bullet
 * names that anti-pattern explicitly.
 *
 * Token budget (H6a): merged old bullets 1+2, tightened both. Old 4 lines
 * were ~70 tokens; new 4 lines are ~73 tokens. Net ~+3.
 */
export const WHEN_TO_ACCESS_SECTION: readonly string[] = [
  '## When to access memories',
  '- When memories seem relevant, or the user references prior-conversation work.',
  '- You MUST access memory when the user explicitly asks you to check, recall, or remember.',
  '- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty. Do not apply remembered facts, cite, compare against, or mention memory content.',
  MEMORY_DRIFT_CAVEAT,
]

/**
 * `## Trusting what you recall` section. Heavier-weight guidance on HOW to
 * treat a memory once you've recalled it — separate from WHEN to access.
 *
 * Eval-validated (memory-prompt-iteration.eval.ts, 2026-03-17):
 *   H1 (verify function/file claims): 0/2 → 3/3 via appendSystemPrompt. When
 *      buried as a bullet under "When to access", dropped to 0/3 — position
 *      matters. The H1 cue is about what to DO with a memory, not when to
 *      look, so it needs its own section-level trigger context.
 *   H5 (read-side noise rejection): 0/2 → 3/3 via appendSystemPrompt, 2/3
 *      in-place as a bullet. Partial because "snapshot" is intuitively closer
 *      to "when to access" than H1 is.
 *
 * Known gap: H1 doesn't cover slash-command claims (0/3 on the /fork case —
 * slash commands aren't files or functions in the model's ontology).
 */
export const TRUSTING_RECALL_SECTION: readonly string[] = [
  // Header wording matters: "Before recommending" (action cue at the decision
  // point) tested better than "Trusting what you recall" (abstract). The
  // appendSystemPrompt variant with this header went 3/3; the abstract header
  // went 0/3 in-place. Same body text — only the header differed.
  '## Before recommending from memory',
  '',
  'A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. It may have been renamed, removed, or never merged. Before recommending it:',
  '',
  '- If the memory names a file path: check the file exists.',
  '- If the memory names a function or flag: grep for it.',
  '- If the user is about to act on your recommendation (not just asking about history), verify first.',
  '',
  '"The memory says X exists" is not the same as "X exists now."',
  '',
  'A memory that summarizes repo state (activity logs, architecture snapshots) is frozen in time. If the user asks about *recent* or *current* state, prefer `git log` or reading the code over recalling the snapshot.',
]

/**
 * densable yBh / X1i — Project skill upkeep (tengu_gorse_fathom).
 * Fold feedback memories that correct repeatable workflow steps into the
 * nearest project skill file.
 */
export const PROJECT_SKILL_UPKEEP_BODY =
  'When you save a `feedback` memory because the user corrected how you ran a repeatable step — how you verified, committed, opened a PR, or used a project skill — fold the same correction into the project skill that drives that step (`.claude/skills/<name>/SKILL.md`): a terse, general edit, so the next session gets it right unprompted. Edit existing skill files only; never create one — a new project skill silently shadows a same-named built-in skill. The single exception is verify, because how a project verifies changes is project-specific: put a verify correction in the `.claude/skills/verify/SKILL.md` closest to the code it covers — the repo root for repo-wide corrections, a subproject directory (e.g. `ios/.claude/skills/verify/SKILL.md`) for corrections that only apply to that subtree — and if that file does not exist, create it. Each correction lives in exactly one skill file: the closest-scoped one, never duplicated at broader scopes.'

export const PROJECT_SKILL_UPKEEP_SECTION: readonly string[] = [
  '## Project skill upkeep',
  '',
  PROJECT_SKILL_UPKEEP_BODY,
  '',
]

/**
 * densable sFr / aFr — tengu_gorse_fathom gate (default false).
 * When on, inject PROJECT_SKILL_UPKEEP_SECTION into the memory prompt.
 */
export function isGorseFathomSkillUpkeepEnabled(gbValue?: boolean): boolean {
  if (gbValue !== undefined) return gbValue
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_gorse_fathom', false)
  } catch {
    return false
  }
}

/** densable aFr — section lines or empty. */
export function getProjectSkillUpkeepSection(
  gbValue?: boolean,
): readonly string[] {
  return isGorseFathomSkillUpkeepEnabled(gbValue)
    ? PROJECT_SKILL_UPKEEP_SECTION
    : []
}

/**
 * densable hBh — short type blurbs for ochre_finch compact types section.
 * Wording matches densable 2.1.211 (shorter than TYPES_SECTION_*).
 */
export const OCHRE_FINCH_TYPE_BLURBS: Record<MemoryType, string> = {
  user: "the user's role, expertise, or working preferences",
  feedback:
    "a correction or confirmation of how you should approach work. Confirmations ('yes, good call') are quieter than corrections — watch for them",
  project:
    'ongoing work, deadlines, or decisions not derivable from code or git history',
  reference:
    'where to find information in an external system (issue tracker, dashboard, channel)',
}

/** densable Y1i — skill name referenced by short types section. */
export const MEMORY_TYPES_SKILL_NAME = 'memory-types'

/**
 * densable J1i / tengu_ochre_finch — compact types section gate (default false).
 */
export function isOchreFinchTypesEnabled(gbValue?: boolean): boolean {
  if (gbValue !== undefined) return gbValue
  try {
    const { getFeatureValue_CACHED_MAY_BE_STALE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/analytics/growthbook.js') as typeof import('../services/analytics/growthbook.js')
    return getFeatureValue_CACHED_MAY_BE_STALE('tengu_ochre_finch', false)
  } catch {
    return false
  }
}

/**
 * densable gBh — compact bullet types section (when ochre_finch on).
 */
export function buildOchreFinchTypesSection(
  types: readonly MemoryType[] = MEMORY_TYPES,
): string[] {
  return [
    '## Types of memory',
    '',
    'Save a memory when you learn one of the following — pick the matching `type:`:',
    '',
    ...types.map(t => `- **${t}** — ${OCHRE_FINCH_TYPE_BLURBS[t]}`),
    '',
    `Invoke the \`${MEMORY_TYPES_SKILL_NAME}\` skill for scope, body structure and examples once you've decided to save.`,
    '',
  ]
}

/**
 * densable nFr(e,t=K1i) — when ochre_finch on, replace long types section with
 * compact gBh(types); otherwise keep `fallback`.
 */
export function selectTypesOfMemorySection(
  fallback: readonly string[],
  input: { ochreFinch?: boolean; types?: readonly MemoryType[] } = {},
): readonly string[] {
  const on =
    input.ochreFinch !== undefined
      ? input.ochreFinch
      : isOchreFinchTypesEnabled()
  if (!on) return fallback
  return buildOchreFinchTypesSection(input.types ?? MEMORY_TYPES)
}

/**
 * Frontmatter format example with the `type` field.
 */
export const MEMORY_FRONTMATTER_EXAMPLE: readonly string[] = [
  '```markdown',
  '---',
  'name: {{memory name}}',
  'description: {{one-line description — used to decide relevance in future conversations, so be specific}}',
  `type: {{${MEMORY_TYPES.join(', ')}}}`,
  '---',
  '',
  '{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}',
  '```',
]
