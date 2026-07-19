import { resolve } from 'path'
import { z } from 'zod/v4'
import { getSessionId, setOriginalCwd } from 'src/bootstrap/state.js'
import { clearSystemPromptSections } from 'src/constants/systemPromptSections.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { Tool } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { clearMemoryFileCaches } from 'src/utils/claudemd.js'
import { getCwd } from 'src/utils/cwd.js'
import { findCanonicalGitRoot } from 'src/utils/git.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getPlanSlug, getPlansDirectory } from 'src/utils/plans.js'
import { setCwd } from 'src/utils/Shell.js'
import { saveWorktreeState } from 'src/utils/sessionStorage.js'
import {
  classifyManagedClaudeWorktree,
  createWorktreeForSession,
  enterExistingWorktreeSession,
  getCurrentWorktreeSession,
  validateWorktreeSlug,
} from 'src/utils/worktree.js'
import { ENTER_WORKTREE_TOOL_NAME } from './constants.js'
import { getEnterWorktreeToolPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z
    .strictObject({
      name: z
        .string()
        .superRefine((s, ctx) => {
          try {
            validateWorktreeSlug(s)
          } catch (e) {
            ctx.addIssue({ code: 'custom', message: (e as Error).message })
          }
        })
        .optional()
        .describe(
          'Optional name for a new worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. Mutually exclusive with path. A random name is generated if neither name nor path is provided.',
        ),
      path: z
        .string()
        .optional()
        .describe(
          'Path to an existing worktree to enter instead of creating one — of the current repository, or (on first entry from the launch directory) of a repository nested inside it. Mutually exclusive with name.',
        ),
    })
    .refine(v => !(v.name !== undefined && v.path !== undefined), {
      message: '`name` and `path` are mutually exclusive',
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    worktreePath: z.string(),
    worktreeBranch: z.string().optional(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const EnterWorktreeTool: Tool<InputSchema, Output> = buildTool({
  name: ENTER_WORKTREE_TOOL_NAME,
  searchHint: 'create an isolated git worktree and switch into it',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Creates an isolated worktree (via git or configured hooks) and switches the session into it'
  },
  async prompt() {
    return getEnterWorktreeToolPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    return input?.path ? 'Entering worktree' : 'Creating worktree'
  },
  shouldDefer: true,
  toAutoClassifierInput(input) {
    return input.path ?? input.name ?? ''
  },
  async validateInput(input) {
    if (getCurrentWorktreeSession() && !input.path) {
      return {
        result: false,
        message:
          'Already in a worktree session. Pass `path` to switch into another existing worktree, or use ExitWorktree to leave this one before creating a new worktree.',
        errorCode: 2,
      }
    }
    return { result: true }
  },
  /**
   * Official 2.1.206/207: entering a model-supplied path outside
   * `.claude/worktrees/` relocates the permission root — force a confirm.
   * Managed Claude worktrees auto-allow.
   */
  async checkPermissions(input) {
    if (!input.path) {
      return { behavior: 'allow', updatedInput: input }
    }
    const classified = await classifyManagedClaudeWorktree(input.path)
    if (classified.managed) {
      return {
        behavior: 'allow',
        updatedInput: { ...input, path: classified.targetReal },
      }
    }
    const resolved = resolve(getCwd(), input.path)
    return {
      behavior: 'ask',
      message:
        `Enter the worktree at "${resolved}"? This moves the session's ` +
        `working directory and write access there, and loads project ` +
        `configuration (CLAUDE.md, settings) from that location.`,
      updatedInput: { ...input, path: resolved },
      decisionReason: {
        type: 'safetyCheck',
        reason: `permission-root relocation to "${resolved}" — a model-supplied worktree outside .claude/worktrees/`,
        classifierApprovable: false,
      },
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input) {
    if (input.path) {
      const classified = await classifyManagedClaudeWorktree(input.path)
      const target = classified.managed
        ? classified.targetReal
        : resolve(getCwd(), input.path)

      const worktreeSession = await enterExistingWorktreeSession(
        target,
        getSessionId(),
      )

      process.chdir(worktreeSession.worktreePath)
      setCwd(worktreeSession.worktreePath)
      setOriginalCwd(getCwd())
      saveWorktreeState(worktreeSession)
      clearSystemPromptSections()
      clearMemoryFileCaches()
      getPlansDirectory.cache.clear?.()

      logEvent('tengu_worktree_entered_existing', {
        mid_session: true,
      })

      const branchInfo = worktreeSession.worktreeBranch
        ? ` on branch ${worktreeSession.worktreeBranch}`
        : ''

      return {
        data: {
          worktreePath: worktreeSession.worktreePath,
          worktreeBranch: worktreeSession.worktreeBranch,
          message:
            `Entered worktree at ${worktreeSession.worktreePath}${branchInfo}. ` +
            `This agent's working directory and write access now point at the worktree; ` +
            `the previous directory was left untouched.`,
        },
        // densable contextLayers working_directory (behavior; no extra 埋点)
        contextLayers: [
          {
            kind: 'working_directory',
            directory: worktreeSession.worktreePath,
          },
        ],
      }
    }

    // Validate not already in a worktree created by this session
    if (getCurrentWorktreeSession()) {
      throw new Error('Already in a worktree session')
    }

    // Resolve to main repo root so worktree creation works from within a worktree
    const mainRepoRoot = findCanonicalGitRoot(getCwd())
    if (mainRepoRoot && mainRepoRoot !== getCwd()) {
      process.chdir(mainRepoRoot)
      setCwd(mainRepoRoot)
    }

    const slug = input.name ?? getPlanSlug()

    const worktreeSession = await createWorktreeForSession(getSessionId(), slug)

    process.chdir(worktreeSession.worktreePath)
    setCwd(worktreeSession.worktreePath)
    setOriginalCwd(getCwd())
    saveWorktreeState(worktreeSession)
    // Clear cached system prompt sections so env_info_simple recomputes with worktree context
    clearSystemPromptSections()
    // Clear memoized caches that depend on CWD
    clearMemoryFileCaches()
    getPlansDirectory.cache.clear?.()

    logEvent('tengu_worktree_created', {
      mid_session: true,
    })

    const branchInfo = worktreeSession.worktreeBranch
      ? ` on branch ${worktreeSession.worktreeBranch}`
      : ''

    return {
      data: {
        worktreePath: worktreeSession.worktreePath,
        worktreeBranch: worktreeSession.worktreeBranch,
        message: `Created worktree at ${worktreeSession.worktreePath}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.`,
      },
      // densable contextLayers working_directory (behavior; no extra 埋点)
      contextLayers: [
        {
          kind: 'working_directory',
          directory: worktreeSession.worktreePath,
        },
      ],
    }
  },
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    return {
      type: 'tool_result',
      content: message,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
