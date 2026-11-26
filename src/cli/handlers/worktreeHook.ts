/**
 * Official 2.1.331 hidden `claude worktree-hook` handler (`chunk-mh88v5h9.js`).
 *
 * Runs WorktreeCreate or WorktreeRemove hooks for the current directory and
 * reports as JSON (used by Claude Desktop).
 */
import {
  type Command as CommanderCommand,
  Option,
} from '@commander-js/extra-typings'
import { access, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, parse, resolve } from 'node:path'
import { getCwd } from '../../utils/cwd.js'
import { errorMessage } from '../../utils/errors.js'
import {
  executeWorktreeCreateHook,
  executeWorktreeRemoveHook,
  hasWorktreeCreateHook,
  hasWorktreeRemoveHook,
} from '../../utils/hooks.js'
import { isChildSession } from '../../utils/sessionRoleEnv.js'
import { jsonStringify } from '../../utils/slowOperations.js'

export type WorktreeHookEvent = 'create' | 'remove'

export type WorktreeHookOptions = {
  json: true
  event: WorktreeHookEvent
  name?: string
  path?: string
  trustedFolder?: string
}

export type WorktreeHookTask =
  | { event: 'create'; name: string }
  | { event: 'remove'; path: string }

export type WorktreeHookOutput =
  | {
      event: 'create'
      outcome: 'ok'
      worktreePath: string
      mayBeCheckouts: boolean
    }
  | { event: 'remove'; outcome: 'removed' }
  | { event: WorktreeHookEvent; outcome: 'not_configured' }
  | { event: WorktreeHookEvent; outcome: 'started' }
  | { event: WorktreeHookEvent; outcome: 'refused'; reason: string }
  | { event: WorktreeHookEvent; outcome: 'failed'; message: string }

function isUnsafeWorktreeDirectory(dir: string): boolean {
  const normalized = resolve(dir)
  if (normalized === parse(normalized).root) return true
  try {
    if (normalized === resolve(homedir())) return true
  } catch {
    // ignore homedir errors
  }
  return false
}

export function validateWorktreeHookTask(
  opts: Pick<WorktreeHookOptions, 'event' | 'name' | 'path'>,
): WorktreeHookTask | undefined {
  if (opts.event === 'create' && opts.name !== undefined && !opts.path) {
    return { event: 'create', name: opts.name }
  }
  if (
    opts.event === 'remove' &&
    opts.path !== undefined &&
    opts.path.length > 0 &&
    isAbsolute(opts.path) &&
    !opts.name
  ) {
    return { event: 'remove', path: opts.path }
  }
  return undefined
}

export function checkWorktreeHookRefusal(opts: {
  event: WorktreeHookEvent
  trustedFolder?: string
  stdoutIsTTY?: boolean
  childSession?: boolean
  cwd?: string
}): string | undefined {
  const stdoutIsTTY = opts.stdoutIsTTY ?? Boolean(process.stdout.isTTY)
  if (stdoutIsTTY) return 'stdout_is_tty'
  const spawnedBySession = opts.childSession ?? isChildSession()
  if (spawnedBySession) return 'spawned_by_session'
  if (opts.event === 'create' && opts.trustedFolder === undefined) {
    return 'create_wants_a_trusted_folder'
  }
  if (process.env.CLAUDE_CODE_SYNC_PLUGIN_INSTALL) {
    return 'sync_plugin_install'
  }
  const cwd = opts.cwd ?? getCwd()
  if (opts.trustedFolder !== undefined && opts.trustedFolder !== cwd) {
    return 'trusted_folder_is_not_cwd'
  }
  if (isUnsafeWorktreeDirectory(cwd)) {
    return 'unsafe_path'
  }
  return undefined
}

function isSameOrAncestor(ancestor: string, candidate: string): boolean {
  const normA = resolve(ancestor).normalize('NFC')
  const normB = resolve(candidate).normalize('NFC')
  return (
    normA === normB ||
    normA.startsWith(`${normB}/`) ||
    normA.startsWith(`${normB}\\`)
  )
}

export async function runWorktreeHookTask(
  task: WorktreeHookTask,
  onStarted?: () => void,
): Promise<WorktreeHookOutput> {
  if (task.event === 'create') {
    if (!hasWorktreeCreateHook()) {
      return { event: 'create', outcome: 'not_configured' }
    }
    onStarted?.()
    const created = await executeWorktreeCreateHook(task.name)
    if (!created) {
      return { event: 'create', outcome: 'not_configured' }
    }
    const realWorktreePath = await realpath(created.worktreePath).catch(
      () => created.worktreePath,
    )
    return {
      event: 'create',
      outcome: 'ok',
      worktreePath: realWorktreePath,
      mayBeCheckouts: false,
    }
  }

  if (!hasWorktreeRemoveHook()) {
    return { event: 'remove', outcome: 'not_configured' }
  }
  const cwd = getCwd()
  const protectedDirs = [cwd, homedir()]
  for (const dir of protectedDirs) {
    const resolvedDir = await realpath(dir).catch(() => dir)
    if (isSameOrAncestor(resolvedDir, task.path)) {
      return {
        event: 'remove',
        outcome: 'failed',
        message:
          'Worktree not removed: the path is or holds the project, its repository or the home directory',
      }
    }
  }
  onStarted?.()
  const removal = await executeWorktreeRemoveHook(task.path)
  if (removal.kind === 'not_configured') {
    return { event: 'remove', outcome: 'not_configured' }
  }
  if (removal.kind === 'removed') {
    const stillExists = await access(task.path)
      .then(() => true)
      .catch(() => false)
    if (!stillExists) {
      return { event: 'remove', outcome: 'removed' }
    }
  }
  return {
    event: 'remove',
    outcome: 'failed',
    message: `Worktree not removed: ${removal.kind === 'failed' ? removal.summary : 'it is still there'}`,
  }
}

export async function worktreeHookHandler(
  options: WorktreeHookOptions,
): Promise<void> {
  const emit = (payload: WorktreeHookOutput): void => {
    process.stdout.write(`${jsonStringify(payload)}\n`)
  }

  const task = validateWorktreeHookTask(options)
  const refusal = checkWorktreeHookRefusal({
    event: options.event,
    trustedFolder: options.trustedFolder,
  })

  let result: WorktreeHookOutput
  if (refusal !== undefined || task === undefined) {
    result = {
      event: options.event,
      outcome: 'refused',
      reason: refusal ?? 'bad_usage',
    }
  } else {
    try {
      result = await runWorktreeHookTask(task, () =>
        emit({ event: options.event, outcome: 'started' }),
      )
    } catch (err) {
      result = {
        event: options.event,
        outcome: 'failed',
        message: errorMessage(err).slice(0, 2000),
      }
    }
  }

  emit(result)
  const exitCode =
    result.outcome === 'failed' || result.outcome === 'refused' ? 1 : 0
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(exitCode)
}

export function registerWorktreeHookCommand(
  program: CommanderCommand,
): CommanderCommand {
  return program
    .command('worktree-hook', { hidden: true })
    .allowExcessArguments(false)
    .description(
      'Run the WorktreeCreate or WorktreeRemove hooks for the current directory and report as JSON (used by Claude Desktop)',
    )
    .requiredOption(
      '--json',
      'Write one JSON object as the last line of stdout',
    )
    .addOption(
      new Option('--event <event>', 'Which hooks to run')
        .choices(['create', 'remove'] as const)
        .makeOptionMandatory(),
    )
    .option('--name <slug>', 'create: the name the hook is given')
    .option('--path <absolute>', 'remove: the real path of the worktree')
    .option(
      '--trusted-folder <absolute>',
      'The current directory, which the host says a person trusted',
    )
    .action(async (options: WorktreeHookOptions) => {
      await worktreeHookHandler(options)
    })
}
