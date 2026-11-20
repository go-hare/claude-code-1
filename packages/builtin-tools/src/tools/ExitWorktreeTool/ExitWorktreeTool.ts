import { isAbsolute, relative, resolve } from 'path'
import { z } from 'zod/v4'
import {
  getOriginalCwd,
  getProjectRoot,
  setOriginalCwd,
  setProjectRoot,
} from 'src/bootstrap/state.js'
import { clearSystemPromptSections } from 'src/constants/systemPromptSections.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import type { TaskStateBase } from 'src/Task.js'
import type { Tool } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { count } from 'src/utils/array.js'
import { clearMemoryFileCaches } from 'src/utils/claudemd.js'
import { execFileNoThrow } from 'src/utils/execFileNoThrow.js'
import { updateHooksConfigSnapshotUnderPrime } from 'src/utils/hooks/hooksConfigSnapshot.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getPlansDirectory } from 'src/utils/plans.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logError } from 'src/utils/log.js'
import { captureSandboxRootMoveHold } from 'src/utils/sandbox/sandbox-adapter.js'
import { setCwd } from 'src/utils/Shell.js'
import {
  relocateSessionTranscript,
  saveWorktreeState,
} from 'src/utils/sessionStorage.js'
import {
  cleanupWorktree,
  getCurrentWorktreeSession,
  keepWorktree,
  killTmuxSession,
  resolveWorktreeExitTargetDir,
} from 'src/utils/worktree.js'
import { EXIT_WORKTREE_TOOL_NAME } from './constants.js'
import { getExitWorktreeToolPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['keep', 'remove'])
      .describe(
        '"keep" leaves the worktree and branch on disk; "remove" deletes both.',
      ),
    discard_changes: z
      .boolean()
      .optional()
      .describe(
        'Required true when action is "remove" and the worktree has uncommitted files or unmerged commits. The tool will refuse and list them otherwise. It also removes the worktree under any task still running there, so set it only after the user has confirmed.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.enum(['keep', 'remove']),
    originalCwd: z.string(),
    worktreePath: z.string(),
    worktreeBranch: z.string().optional(),
    tmuxSessionName: z.string().optional(),
    discardedFiles: z.number().optional(),
    discardedCommits: z.number().optional(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

type ChangeSummary = {
  changedFiles: number
  commits: number
}

/**
 * Returns null when state cannot be reliably determined — callers that use
 * this as a safety gate must treat null as "unknown, assume unsafe"
 * (fail-closed). A silent 0/0 would let cleanupWorktree destroy real work.
 *
 * Null is returned when:
 * - git status or rev-list exit non-zero (lock file, corrupt index, bad ref)
 * - originalHeadCommit is undefined but git status succeeded — this is the
 *   hook-based-worktree-wrapping-git case (worktree.ts:525-532 doesn't set
 *   originalHeadCommit). We can see the working tree is git, but cannot count
 *   commits without a baseline, so we cannot prove the branch is clean.
 */
async function countWorktreeChanges(
  worktreePath: string,
  originalHeadCommit: string | undefined,
): Promise<ChangeSummary | null> {
  const status = await execFileNoThrow('git', [
    '-C',
    worktreePath,
    'status',
    '--porcelain',
  ])
  if (status.code !== 0) {
    return null
  }
  const changedFiles = count(status.stdout.split('\n'), l => l.trim() !== '')

  if (!originalHeadCommit) {
    // git status succeeded → this is a git repo, but without a baseline
    // commit we cannot count commits. Fail-closed rather than claim 0.
    return null
  }

  const revList = await execFileNoThrow('git', [
    '-C',
    worktreePath,
    'rev-list',
    '--count',
    `${originalHeadCommit}..HEAD`,
  ])
  if (revList.code !== 0) {
    return null
  }
  const commits = parseInt(revList.stdout.trim(), 10) || 0

  return { changedFiles, commits }
}

/**
 * Restore session state to reflect the original directory.
 * This is the inverse of the session-level mutations in EnterWorktreeTool.call().
 *
 * keepWorktree()/cleanupWorktree() handle process.chdir and currentWorktreeSession;
 * this handles everything above the worktree utility layer.
 */
async function restoreSessionToOriginalCwd(
  originalCwd: string,
  projectRootIsWorktree: boolean,
): Promise<void> {
  setCwd(originalCwd)
  // EnterWorktree sets originalCwd to the *worktree* path (intentional — see
  // state.ts getProjectRoot comment). Reset to the real original.
  setOriginalCwd(originalCwd)
  // densable tNt after mN — soft fail (Cin "ExitWorktree")
  try {
    await relocateSessionTranscript()
  } catch (e) {
    logForDebugging(`ExitWorktree: transcript relocation failed: ${e}`, {
      level: 'error',
    })
    logError(e)
  }
  // --worktree startup sets projectRoot to the worktree; mid-session
  // EnterWorktreeTool does not. Only restore when it was actually changed —
  // otherwise we'd move projectRoot to wherever the user had cd'd before
  // entering the worktree (session.originalCwd), breaking the "stable project
  // identity" contract.
  if (projectRootIsWorktree) {
    setProjectRoot(originalCwd)
    // Official ExitWorktree restore: D()&&g ? nHe(Gqe) : uP(Yl).
    // setup.ts --worktree used UnderPrime; restore symmetrically.
    const { getPinnedStorageV5 } = await import('src/utils/storageV5/index.js')
    await updateHooksConfigSnapshotUnderPrime(getPinnedStorageV5())
  }
  saveWorktreeState(null)
  clearSystemPromptSections()
  clearMemoryFileCaches()
  getPlansDirectory.cache.clear?.()
}

const WORKTREE_TASK_ACTIVE_STATUSES = new Set(['running', 'pending'])

function isPathInsideOrEqual(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Official 2.1.326 #314 (`ui` @303911500): Find active background subagents or
 * shell commands that may still be running inside `worktreePath` so
 * `ExitWorktree(action: "remove")` refuses deleting the worktree out from under
 * them unless `discard_changes: true` is explicitly passed.
 */
export function findActiveWorktreeTasks(
  tasks: Record<string, TaskStateBase> | undefined,
  worktreePath: string,
  excludeAgentId?: string,
): TaskStateBase[] {
  if (!tasks) return []
  const matches: TaskStateBase[] = []
  for (const task of Object.values(tasks)) {
    if (!WORKTREE_TASK_ACTIVE_STATUSES.has(task.status)) continue
    if (excludeAgentId && task.id === excludeAgentId) continue
    const taskRecord = task as unknown as {
      kind?: string
      stopsOnExit?: boolean
      cwd?: string
      worktreePath?: string
      startDir?: string
      workingDirectory?: string
    }
    if (taskRecord.kind === 'monitor' && taskRecord.stopsOnExit) continue
    if (
      task.type !== 'local_agent' &&
      task.type !== 'local_bash' &&
      task.type !== 'in_process_teammate'
    ) {
      continue
    }
    const candidatePath =
      taskRecord.worktreePath ??
      taskRecord.cwd ??
      taskRecord.workingDirectory ??
      taskRecord.startDir
    if (candidatePath !== undefined) {
      if (isPathInsideOrEqual(candidatePath, worktreePath)) {
        matches.push(task)
      }
      continue
    }
    // Fail-closed: active local subagent or shell command without an explicit
    // path outside the worktree may still be running inside it.
    matches.push(task)
  }
  return matches
}

type WorktreeUnsavedWorkFinding = {
  found: string
  next: string
  errorCode: number
}

const CONFIRM_DISCARD_NEXT =
  'Confirm with the user, then re-invoke with discard_changes: true — or use action: "keep" to preserve the worktree.'
const REFUSING_DISCARD_NEXT =
  'Refusing to remove without explicit confirmation. Confirm with the user, then re-invoke with discard_changes: true to proceed — or use action: "keep" to preserve the worktree.'
const WAIT_TASK_NEXT =
  'Wait for the task to finish, or ask the user before stopping it, then call this tool again — or use action: "keep" to preserve the worktree.'

/**
 * Official 2.1.327 (#498, SEA `ri`): inspect whether removing the worktree may
 * discard unsaved work (active tasks, unverifiable git state, uncommitted files,
 * or unmerged commits). Shared by `validateInput` and `checkPermissions`.
 */
async function inspectWorktreeUnsavedWork(
  session: NonNullable<ReturnType<typeof getCurrentWorktreeSession>>,
  context?: {
    getAppState: () => { tasks?: Record<string, TaskStateBase> }
    agentId?: string
  },
): Promise<WorktreeUnsavedWorkFinding | null> {
  const activeTasks = findActiveWorktreeTasks(
    context?.getAppState().tasks,
    session.worktreePath,
    context?.agentId,
  )
  if (activeTasks.length > 0) {
    const taskLabels = activeTasks
      .slice(0, 3)
      .map(t => t.description || t.id)
      .join(', ')
    const more =
      activeTasks.length > 3 ? ` (+${activeTasks.length - 3} more)` : ''
    return {
      found: `Cannot remove worktree at ${session.worktreePath} while ${activeTasks.length === 1 ? 'a background task' : `${activeTasks.length} background tasks`} (${taskLabels}${more}) may still be running in it.`,
      next: WAIT_TASK_NEXT,
      errorCode: 4,
    }
  }

  const summary = await countWorktreeChanges(
    session.worktreePath,
    session.originalHeadCommit,
  )
  if (summary === null) {
    return {
      found: `Could not verify worktree state at ${session.worktreePath}.`,
      next: REFUSING_DISCARD_NEXT,
      errorCode: 3,
    }
  }
  const { changedFiles, commits } = summary
  if (changedFiles > 0 || commits > 0) {
    const parts: string[] = []
    if (changedFiles > 0) {
      parts.push(
        `${changedFiles} uncommitted ${changedFiles === 1 ? 'file' : 'files'}`,
      )
    }
    if (commits > 0) {
      parts.push(
        `${commits} ${commits === 1 ? 'commit' : 'commits'} on ${session.worktreeBranch ?? 'the worktree branch'}`,
      )
    }
    return {
      found: `Worktree has ${parts.join(' and ')}. Removing will discard this work permanently.`,
      next: CONFIRM_DISCARD_NEXT,
      errorCode: 2,
    }
  }
  return null
}

export const ExitWorktreeTool: Tool<InputSchema, Output> = buildTool({
  name: EXIT_WORKTREE_TOOL_NAME,
  searchHint: 'exit a worktree session and return to the original directory',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Exits a worktree session created by EnterWorktree and restores the original working directory'
  },
  async prompt() {
    return getExitWorktreeToolPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Exiting worktree'
  },
  shouldDefer: true,
  isDestructive(input) {
    return input.action === 'remove'
  },
  toAutoClassifierInput(input) {
    return input.action
  },
  async validateInput(input, context) {
    // Scope guard: getCurrentWorktreeSession() is null unless EnterWorktree
    // (specifically createWorktreeForSession) ran in THIS session. Worktrees
    // created by `git worktree add`, or by EnterWorktree in a previous
    // session, do not populate it. This is the sole entry gate — everything
    // past this point operates on a path EnterWorktree created.
    const session = getCurrentWorktreeSession()
    if (!session) {
      return {
        result: false,
        message:
          'No-op: there is no active EnterWorktree session to exit. This tool only operates on worktrees created by EnterWorktree in the current session — it will not touch worktrees created manually or in a previous session. No filesystem changes were made.',
        errorCode: 1,
      }
    }

    if (input.action === 'remove' && !input.discard_changes) {
      const unsaved = await inspectWorktreeUnsavedWork(session, context)
      if (unsaved !== null) {
        return {
          result: false,
          message: `${unsaved.found} ${unsaved.next}`,
          errorCode: unsaved.errorCode,
        }
      }
    }

    return { result: true }
  },
  // Official 2.1.327 (#498): ask before removing a worktree that may hold
  // unsaved work, even when `discard_changes: true` was passed. Refused in
  // dontAsk mode or when nobody can answer, unless a whole-tool allow rule,
  // auto mode, or bypassPermissions allows it.
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const session = getCurrentWorktreeSession()
    if (!session && input.discard_changes) {
      const reason = 'The session left its worktree before this call ran.'
      return {
        behavior: 'deny',
        message: reason,
        decisionReason: { type: 'other', reason },
      }
    }
    const unsaved =
      session && input.action === 'remove' && input.discard_changes
        ? await inspectWorktreeUnsavedWork(session, context)
        : null
    if (unsaved === null) {
      return { behavior: 'allow', updatedInput: input }
    }
    const message = unsaved.found.replace('Nothing was removed: task', 'Task')
    return {
      behavior: 'ask',
      message,
      decisionReason: { type: 'other', reason: message },
      suppressAlwaysAllowRule: true,
    } as PermissionDecision
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input, context) {
    const session = getCurrentWorktreeSession()
    if (!session) {
      // validateInput guards this, but the session is module-level mutable
      // state — defend against a race between validation and execution.
      throw new Error('Not in a worktree session')
    }

    // Capture before keepWorktree/cleanupWorktree null out currentWorktreeSession.
    const {
      originalCwd: recordedOriginalCwd,
      worktreePath,
      worktreeBranch,
      tmuxSessionName,
      originalHeadCommit,
    } = session
    // 2.1.323 #1988: If the directory the shell was in before entering the
    // worktree has been deleted, resolve the nearest valid fallback directory
    // so ExitWorktree does not leave the session in a deleted/wrong folder.
    const { targetDir: originalCwd, fellBackFromDeletedOriginalCwd } =
      resolveWorktreeExitTargetDir(session)
    const deletedCwdNote = fellBackFromDeletedOriginalCwd
      ? ` (previous directory ${recordedOriginalCwd} no longer exists)`
      : ''

    // --worktree startup calls setOriginalCwd(getCwd()) and
    // setProjectRoot(getCwd()) back-to-back right after setCwd(worktreePath)
    // (setup.ts:235/239), so both hold the same realpath'd value and BashTool
    // cd never touches either. Mid-session EnterWorktreeTool sets originalCwd
    // but NOT projectRoot. (Can't use getCwd() — BashTool mutates it on every
    // cd. Can't use session.worktreePath — it's join()'d, not realpath'd.)
    const projectRootIsWorktree = getProjectRoot() === getOriginalCwd()

    // Re-count at execution time for accurate analytics and output — the
    // worktree state at validateInput time may not match now. Null (git
    // failure) falls back to 0/0; safety gating already happened in
    // validateInput, so this only affects analytics + messaging.
    const { changedFiles, commits } = (await countWorktreeChanges(
      worktreePath,
      originalHeadCommit,
    )) ?? { changedFiles: 0, commits: 0 }

    if (input.action === 'keep') {
      // Official 2.1.326 #299: hold sandbox across worktree exit root move.
      captureSandboxRootMoveHold()
      await keepWorktree()
      await restoreSessionToOriginalCwd(originalCwd, projectRootIsWorktree)

      logEvent('tengu_worktree_kept', {
        mid_session: true,
        commits,
        changed_files: changedFiles,
      })

      const tmuxNote = tmuxSessionName
        ? ` Tmux session ${tmuxSessionName} is still running; reattach with: tmux attach -t ${tmuxSessionName}`
        : ''
      return {
        data: {
          action: 'keep' as const,
          originalCwd,
          worktreePath,
          worktreeBranch,
          tmuxSessionName,
          message: `Exited worktree. Your work is preserved at ${worktreePath}${worktreeBranch ? ` on branch ${worktreeBranch}` : ''}. Session is now back in ${originalCwd}${deletedCwdNote}.${tmuxNote}`,
        },
      }
    }

    // action === 'remove'
    if (tmuxSessionName) {
      await killTmuxSession(tmuxSessionName)
    }
    // Official 2.1.326 #299: hold sandbox across worktree exit root move.
    captureSandboxRootMoveHold()
    const removed = await cleanupWorktree({
      storageV5: context.storageV5,
      credentials: context.credentials,
    })
    await restoreSessionToOriginalCwd(originalCwd, projectRootIsWorktree)

    if (!removed) {
      return {
        data: {
          action: 'remove' as const,
          originalCwd,
          worktreePath,
          worktreeBranch,
          discardedFiles: 0,
          discardedCommits: 0,
          message: `Exited worktree but could not remove it — kept at ${worktreePath}. Session is now back in ${originalCwd}.`,
        },
      }
    }

    logEvent('tengu_worktree_removed', {
      source:
        'exit_tool' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      mid_session: true,
      commits,
      changed_files: changedFiles,
    })

    const discardParts: string[] = []
    if (commits > 0) {
      discardParts.push(`${commits} ${commits === 1 ? 'commit' : 'commits'}`)
    }
    if (changedFiles > 0) {
      discardParts.push(
        `${changedFiles} uncommitted ${changedFiles === 1 ? 'file' : 'files'}`,
      )
    }
    const discardNote =
      discardParts.length > 0 ? ` Discarded ${discardParts.join(' and ')}.` : ''
    return {
      data: {
        action: 'remove' as const,
        originalCwd,
        worktreePath,
        worktreeBranch,
        discardedFiles: changedFiles,
        discardedCommits: commits,
        message: `Exited and removed worktree at ${worktreePath}.${discardNote} Session is now back in ${originalCwd}.`,
      },
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
