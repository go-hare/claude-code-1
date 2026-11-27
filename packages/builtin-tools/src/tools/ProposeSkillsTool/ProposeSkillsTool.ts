/**
 * Official 2.1.331 ProposeSkillsTool (`En` / `See = 'propose_skills'`).
 *
 * Render-only review card of proposed skills (new or improvements) for the
 * user to review and save. Writes nothing to disk.
 */

import { z } from 'zod/v4'
import { logEvent } from 'src/services/analytics/index.js'
import {
  buildTool,
  type ToolDef,
  type ToolResultBlockParam,
  type ValidationResult,
} from 'src/Tool.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { isDisklessLaunch } from 'src/utils/sessionHost.js'
import { getBootstrapSession } from 'src/utils/sessionRoot.js'
import {
  PROPOSE_SKILLS_FORBIDDEN_NAME_SUBSTRINGS,
  PROPOSE_SKILLS_MAX_DESCRIPTION_CHARS,
  PROPOSE_SKILLS_MAX_NAME_CHARS,
  PROPOSE_SKILLS_MAX_PROPOSALS,
  PROPOSE_SKILLS_TOOL_NAME,
} from './constants.js'
import { DESCRIPTION, EMPTY_SKILL_MD_MESSAGE, PROMPT } from './prompt.js'

const ANGLE_OPEN_RE = /[<\uFE64\uFF1C]/
const ANGLE_CLOSE_RE = /[>\uFE65\uFF1E]/
const FRONTMATTER_HEAD_RE =
  /^(\uFEFF?(?:[ \t]*\r?\n)*---[ \t]*\r?\n)([\s\S]*?)(?=\r?\n---[ \t]*(?:\r?\n|$))/

/**
 * Official `Uti(text)` — rejects angle-bracket tags (`<...>`, including
 * fullwidth/small variants) in saved skill descriptions.
 */
export function hasAngleBracketTag(text: string): boolean {
  const idx = text.search(ANGLE_OPEN_RE)
  return idx !== -1 && ANGLE_CLOSE_RE.test(text.slice(idx + 2))
}

/**
 * Official `Pe(skillMd)` — ensures SKILL.md contains non-empty instructions
 * below its YAML frontmatter.
 */
export function hasSkillMdInstructions(skillMd: string): boolean {
  const match = FRONTMATTER_HEAD_RE.exec(skillMd)
  const afterFrontmatter = match
    ? skillMd.slice(match[0].length).replace(/^\r?\n---[^\n]*/, '')
    : skillMd
  return (
    afterFrontmatter.trim() !== '' &&
    skillMd.replace(/^---\n[\s\S]*?\n---\n+/, '').trim() !== ''
  )
}

const proposalEditSchema = lazySchema(() =>
  z.object({
    old_string: z
      .string()
      .min(1)
      .describe('Text to replace. It must occur exactly once in that SKILL.md'),
    new_string: z.string().describe('Text to put in its place'),
  }),
)

const proposalItemSchema = lazySchema(() =>
  z
    .object({
      name: z
        .string()
        .min(1)
        .describe(
          'kebab-case skill slug; must not contain "claude" or "anthropic"; at most 64 characters for a new skill',
        ),
      kind: z.enum(['new', 'improvement']),
      target: z
        .string()
        .optional()
        .describe(
          "Name of the existing skill to update. Required when kind is 'improvement'; omit for 'new'.",
        ),
      description: z
        .string()
        .max(PROPOSE_SKILLS_MAX_DESCRIPTION_CHARS, {
          message: `description is longer than ${PROPOSE_SKILLS_MAX_DESCRIPTION_CHARS} characters, the most a saved skill's description can hold. Call again with one short sentence saying when to use the skill.`,
        })
        .refine(d => !hasAngleBracketTag(d), {
          message:
            "description contains angle brackets (less-than and greater-than signs), which a saved skill's description cannot include. Call again with the same sentence reworded without them.",
        })
        .describe(
          "One short sentence saying when to use this skill: aim for under 200 characters, never more than 1024, and no angle brackets. Shown on the review card and saved as the skill's description, which is what decides when the skill is used. For an improvement, reuse the existing skill's description unless the change alters when the skill applies.",
        ),
      evidence: z
        .array(z.string())
        .optional()
        .describe('memory file paths where this procedure was observed'),
      edits: z
        .array(proposalEditSchema())
        .min(1)
        .max(100)
        .optional()
        .describe(
          "For an improvement, in place of skillMd: your changes to the skill's SKILL.md, applied in order. They apply to that file as it is now, not to an earlier proposal of yours. The card shows the whole updated file. The name and description come from the fields above, not from the frontmatter.",
        ),
      skillMd: z
        .string()
        .refine(hasSkillMdInstructions, { message: EMPTY_SKILL_MD_MESSAGE })
        .optional()
        .describe(
          "For a new skill or a full rewrite. The complete SKILL.md exactly as it should be saved: frontmatter plus the full body. When the user saves, the body below the frontmatter becomes the skill's entire instructions and the name and description come from the fields above; other frontmatter keys are not kept. For an improvement this replaces the existing skill's SKILL.md entirely, so read that skill's current SKILL.md first and include everything worth keeping, not only the changes.",
        ),
    })
    .refine(
      item =>
        item.kind === 'improvement'
          ? item.edits !== undefined || item.skillMd !== undefined
          : item.edits === undefined && item.skillMd !== undefined,
      {
        message:
          'An improvement needs edits or skillMd. A new skill needs skillMd and takes no edits.',
      },
    )
    .refine(item => item.kind !== 'improvement' || Boolean(item.target), {
      message: "target is required when kind is 'improvement'",
      path: ['target'],
    })
    .superRefine((item, ctx) => {
      if (item.kind !== 'new') return
      if (Array.from(item.name).length > PROPOSE_SKILLS_MAX_NAME_CHARS) {
        ctx.addIssue({
          code: 'custom',
          path: ['name'],
          message: `name is longer than ${PROPOSE_SKILLS_MAX_NAME_CHARS} characters, the most a saved skill's name can hold. Call again with a shorter kebab-case slug.`,
        })
      }
      const lower = item.name.normalize('NFKC').toLowerCase()
      if (
        PROPOSE_SKILLS_FORBIDDEN_NAME_SUBSTRINGS.some(sub =>
          lower.includes(sub),
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['name'],
          message:
            'name contains "claude" or "anthropic", which a saved skill\'s name cannot include. Call again with a name that leaves those words out.',
        })
      }
    }),
)

const inputSchema = lazySchema(() =>
  z.object({
    proposals: z
      .array(proposalItemSchema())
      .min(1)
      .max(PROPOSE_SKILLS_MAX_PROPOSALS),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type ProposeSkillsInput = z.infer<InputSchema>
export type SkillProposal = ProposeSkillsInput['proposals'][number]

const outputSchema = lazySchema(() =>
  z.object({
    proposalCount: z
      .number()
      .describe('Number of proposals shown on the review card'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ProposeSkillsOutput = z.infer<OutputSchema>

/**
 * Official `En.isEnabled()` gate:
 * - Off in child sessions (`CLAUDE_CODE_CHILD_SESSION` / `CLAUDECODE`).
 * - Respects `CLAUDE_CODE_SKILL_PROPOSALS`, `CLAUDE_CODE_SYNC_SKILLS`,
 *   `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE`, `CLAUDE_CODE_ENVIRONMENT_KIND`,
 *   `remote_cowork` entrypoint, and `skillsSyncVetoed()`.
 * - Off by default in plain local CLI sessions so the default tool pool is unchanged.
 */
export function isProposeSkillsEnabled(opts?: {
  env?: NodeJS.ProcessEnv
  isDiskless?: boolean
  skillsSyncVetoed?: boolean
}): boolean {
  const env = opts?.env ?? process.env
  const isChildSession =
    isEnvTruthy(env.CLAUDE_CODE_CHILD_SESSION) || isEnvTruthy(env.CLAUDECODE)
  if (isChildSession) return false

  const diskless = opts?.isDiskless ?? isDisklessLaunch()
  const vetoed =
    opts?.skillsSyncVetoed ??
    getBootstrapSession().sessionFlags.skillsSyncVetoed()
  const isRemoteCowork = env.CLAUDE_CODE_ENTRYPOINT === 'remote_cowork'
  const syncSkills = isEnvTruthy(env.CLAUDE_CODE_SYNC_SKILLS)
  const skillProposals = isEnvTruthy(env.CLAUDE_CODE_SKILL_PROPOSALS)
  const hasRemoteEnvType = Boolean(env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE)

  if (diskless && isRemoteCowork) {
    return syncSkills && !vetoed
  }
  if (!isRemoteCowork && !skillProposals) {
    return false
  }
  if (!hasRemoteEnvType && !(diskless && skillProposals && syncSkills)) {
    return false
  }
  if (!skillProposals && env.CLAUDE_CODE_ENVIRONMENT_KIND !== undefined) {
    return false
  }
  if (skillProposals) {
    return !vetoed
  }
  return syncSkills && !vetoed
}

export const ProposeSkillsTool = buildTool({
  name: PROPOSE_SKILLS_TOOL_NAME,
  searchHint:
    'propose skills from recurring procedures for the user to review and save',
  backgrounding: 'never',
  shouldDefer: false,
  maxResultSizeChars: 1000,

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isEnabled() {
    return isProposeSkillsEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },

  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },

  toAutoClassifierInput(input: ProposeSkillsInput) {
    return (input.proposals ?? [])
      .map(p =>
        p.kind === 'improvement' && p.target
          ? `${p.name ?? ''} (improves ${p.target}): ${p.description ?? ''}`
          : `${p.name ?? ''}: ${p.description ?? ''}`,
      )
      .join('\n')
  },

  renderToolUseMessage(input: Partial<ProposeSkillsInput>) {
    const list = (input.proposals ?? []).filter(p => p?.name).slice(0, 3)
    if (list.length === 0) return ''
    const parts = list.map(p => {
      const name = (p.name ?? '').slice(0, 80)
      return p.kind === 'improvement' && p.target
        ? `${name} (improves ${p.target.slice(0, 80)})`
        : name
    })
    return `Propose ${list.length} ${list.length === 1 ? 'skill' : 'skills'}: ${parts.join(', ')}`
  },

  create() {
    return {
      async validateInput({
        proposals,
      }: ProposeSkillsInput): Promise<ValidationResult> {
        const problems: string[] = []
        for (const proposal of proposals) {
          if (
            proposal.kind === 'improvement' &&
            proposal.edits !== undefined &&
            proposal.skillMd !== undefined
          ) {
            const label = proposal.target ?? proposal.name
            problems.push(
              `${label} has both edits and skillMd. Call again with one of the two.`,
            )
          }
        }
        if (problems.length > 0) {
          return {
            result: false,
            message: problems.join(' '),
            errorCode: 2,
          }
        }
        return { result: true }
      },

      async call({ proposals }: ProposeSkillsInput) {
        const improvementCount = proposals.filter(
          p => p.kind === 'improvement',
        ).length
        logEvent('tengu_propose_skills', {
          proposal_count: proposals.length,
          improvement_count: improvementCount,
        })
        return {
          data: {
            proposalCount: proposals.length,
          },
        }
      },
    }
  },

  mapToolResultToToolResultBlockParam(
    { proposalCount }: ProposeSkillsOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Shown ${proposalCount} skill proposal(s) to the user for review. Continue with the next phase; do not wait for them to respond.`,
    }
  },
} satisfies ToolDef<InputSchema, ProposeSkillsOutput>)
