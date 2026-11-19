/**
 * densable 2.1.289 `claude purge` / hidden `claude project purge`.
 * Plan + delete project-scoped Claude Code state using existing path helpers.
 */
import { createInterface } from 'readline'
import { readdir, rm, stat, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { removeDirectoryTreeWithRetry } from '../../utils/cleanup.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getProjectsDir, getProjectDir } from '../../utils/sessionPaths.js'
import { getTasksDir } from '../../utils/tasks.js'

export const PURGE_RENAME_NOTICE =
  '`claude project purge` is now `claude purge`'
export const PURGE_DESCRIPTION =
  'Delete all Claude Code state for a project (transcripts, tasks, file history, config entry)'

export type PurgeProjectOptions = {
  dryRun?: boolean
  yes?: boolean
  interactive?: boolean
  all?: boolean
}

export type PurgePlanItem = {
  path: string
  kind: 'dir' | 'file' | 'config' | 'history'
  label: string
}

export type PurgePlan = {
  items: PurgePlanItem[]
  warnings: string[]
  projectPath: string | null
}

function historyPath(): string {
  return join(getClaudeConfigHomeDir(), 'history.jsonl')
}

function debugDir(): string {
  return join(getClaudeConfigHomeDir(), 'debug')
}

function fileHistoryRoot(): string {
  return join(getClaudeConfigHomeDir(), 'file-history')
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function listSessionIds(projectDir: string): Promise<string[]> {
  try {
    const ents = await readdir(projectDir)
    return ents
      .filter(name => name.endsWith('.jsonl'))
      .map(name => name.slice(0, -'.jsonl'.length))
  } catch {
    return []
  }
}

function resolveTargetPath(pathArg: string | undefined): string {
  return resolve(pathArg ?? getOriginalCwd())
}

export async function buildPurgePlanForProject(
  absolutePath: string,
): Promise<PurgePlan> {
  const items: PurgePlanItem[] = []
  const warnings: string[] = []
  const projectDir = getProjectDir(absolutePath)

  if (await pathExists(projectDir)) {
    items.push({
      path: projectDir,
      kind: 'dir',
      label: 'project transcripts (.jsonl) and memory/',
    })
  }

  const sessionIds = await listSessionIds(projectDir)
  for (const sessionId of sessionIds) {
    const tasks = getTasksDir(sessionId)
    if (await pathExists(tasks)) {
      items.push({
        path: tasks,
        kind: 'dir',
        label: `tasks for session ${sessionId}`,
      })
    }
    const debugFile = join(debugDir(), `${sessionId}.txt`)
    if (await pathExists(debugFile)) {
      items.push({
        path: debugFile,
        kind: 'file',
        label: `debug log for session ${sessionId}`,
      })
    }
    const fh = join(fileHistoryRoot(), sessionId)
    if (await pathExists(fh)) {
      items.push({
        path: fh,
        kind: 'dir',
        label: `file edit history for session ${sessionId}`,
      })
    }
  }

  const config = getGlobalConfig()
  if (config.projects?.[absolutePath]) {
    items.push({
      path: `projects["${absolutePath}"]`,
      kind: 'config',
      label: 'project entry in ~/.claude.json (trust, history, MCP servers)',
    })
  }

  let historyLines = 0
  try {
    const raw = await readFile(historyPath(), 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line) as { project?: string }
        if (row.project === absolutePath) historyLines++
      } catch {
        // skip malformed
      }
    }
  } catch {
    // no history file
  }
  if (historyLines > 0) {
    items.push({
      path: historyPath(),
      kind: 'history',
      label: `${historyLines} prompt(s) typed in this project?`,
    })
  }

  warnings.push(
    'shell-snapshots/ are not project-scoped and will not be touched',
  )
  warnings.push(
    'backups/ may still contain this project entry in old .claude.json snapshots',
  )

  return { items, warnings, projectPath: absolutePath }
}

export async function buildPurgePlanForAll(): Promise<PurgePlan> {
  const home = getClaudeConfigHomeDir()
  const items: PurgePlanItem[] = []
  const warnings: string[] = []
  const dirs: Array<[string, string]> = [
    [getProjectsDir(), 'all project transcripts (.jsonl) and memory/'],
    [join(home, 'tasks'), 'all session task lists'],
    [debugDir(), 'all session debug logs'],
    [fileHistoryRoot(), 'all session file edit history'],
  ]
  for (const [path, label] of dirs) {
    if (await pathExists(path)) {
      items.push({ path, kind: 'dir', label })
    }
  }
  if (await pathExists(historyPath())) {
    items.push({
      path: historyPath(),
      kind: 'history',
      label: 'prompt history across all projects',
    })
  }
  const projects = getGlobalConfig().projects ?? {}
  for (const key of Object.keys(projects)) {
    items.push({
      path: `projects["${key}"]`,
      kind: 'config',
      label: `project entry in ~/.claude.json for ${key}`,
    })
  }
  warnings.push(
    'shell-snapshots/ are not project-scoped and will not be touched',
  )
  warnings.push(
    'backups/ may still contain project entries in old .claude.json snapshots',
  )
  return { items, warnings, projectPath: null }
}

function printPlan(plan: PurgePlan): void {
  const title = plan.projectPath
    ? `Purge plan for ${plan.projectPath}:`
    : 'Purge plan for ALL projects:'
  process.stdout.write(`${title}\n`)
  for (const item of plan.items) {
    process.stdout.write(`  ${item.label}\n`)
  }
  if (plan.warnings.length) {
    process.stdout.write('\n')
    for (const w of plan.warnings) {
      process.stdout.write(`${w}\n`)
    }
  }
  process.stdout.write(
    '\nPurging deletes data only on this computer, not anything stored by Anthropic.\n',
  )
}

async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      `${question} [y/N]\n(non-interactive stdin; pass --yes to confirm)\n`,
    )
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>(resolve => {
      rl.question(`${question} [y/N] `, resolve)
    })
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

async function askInteractive(
  index: number,
  total: number,
  label: string,
): Promise<'delete' | 'skip' | 'all'> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      `[${index}/${total}] ${label}\n(non-interactive; pass --yes or omit -i)\n`,
    )
    return 'skip'
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>(resolve => {
      rl.question(
        `[${index}/${total}] ${label}\nDelete? [y/N/a=Delete this and all remaining] `,
        resolve,
      )
    })
    const t = answer.trim().toLowerCase()
    if (t === 'a' || t === 'all') return 'all'
    if (t === 'y' || t === 'yes') return 'delete'
    return 'skip'
  } finally {
    rl.close()
  }
}

export type PurgeFailure = {
  message: string
  code: string
}

async function deleteItem(
  item: PurgePlanItem,
  projectPath: string | null,
): Promise<PurgeFailure | null> {
  if (item.kind === 'dir' || item.kind === 'file') {
    try {
      if (item.kind === 'dir') {
        await removeDirectoryTreeWithRetry(item.path)
      } else {
        await rm(item.path, { recursive: true, force: true })
      }
      return null
    } catch (err) {
      const code =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof (err as { code?: unknown }).code === 'string'
          ? (err as { code: string }).code
          : undefined
      if (code === undefined) throw err
      const msg = err instanceof Error ? err.message : String(err)
      return {
        message: `Could not delete ${item.path} — ${msg}`,
        code: `delete_failed_${code}`,
      }
    }
  }
  if (item.kind === 'config') {
    try {
      saveGlobalConfig(current => {
        if (!current.projects) return current
        if (projectPath === null) {
          return { ...current, projects: {} }
        }
        const next = { ...current.projects }
        delete next[projectPath]
        return { ...current, projects: next }
      })
      return null
    } catch {
      return {
        message: `Failed to remove projects["${projectPath ?? ''}"] from .claude.json — is your config directory writable?`,
        code: 'config_write_failed',
      }
    }
  }
  if (item.kind === 'history') {
    const hp = historyPath()
    try {
      const raw = await readFile(hp, 'utf8')
      const kept: string[] = []
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        if (projectPath === null) continue
        try {
          const row = JSON.parse(line) as { project?: string }
          if (row.project === projectPath) continue
        } catch {
          kept.push(line)
          continue
        }
        kept.push(line)
      }
      await writeFile(hp, kept.length ? `${kept.join('\n')}\n` : '', 'utf8')
      return null
    } catch (err) {
      const code =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof (err as { code?: unknown }).code === 'string'
          ? (err as { code: string }).code
          : undefined
      if (code === 'ENOENT') return null
      const msg = err instanceof Error ? err.message : String(err)
      return {
        message: `Could not update ${hp} — ${msg}`,
        code: 'history_rewrite_refused',
      }
    }
  }
  return null
}

/**
 * Official Y() — report any per-item deletion failures, list what could not be
 * deleted, and set exitCode = 1; otherwise print the success message.
 */
function finishPurge(failures: PurgeFailure[], successMessage: string): void {
  if (failures.length > 0) {
    const hasDeleteFailed = failures.some(f =>
      f.code.startsWith('delete_failed_'),
    )
    const hint = hasDeleteFailed
      ? '\nWhat could not be deleted is still on disk: fix the cause and run the command again, or delete those paths by hand.'
      : ''
    process.stderr.write(
      `${failures.length} item(s) failed:\n  ${failures.map(f => f.message).join('\n  ')}${hint}\n`,
    )
    const codes = new Set(failures.map(f => f.code))
    logEvent('cli_purge_project', {
      result: (codes.size === 1
        ? failures[0]!.code
        : 'multiple_failures') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    process.exitCode = 1
    return
  }
  process.stdout.write(`${successMessage}\n`)
  logEvent('cli_purge_project', {
    result:
      'success' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

export function purgeStoppedByError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(
    `Purge stopped before it finished: ${msg}\nSome items may still be on disk. Run the command again; \`--dry-run\` lists what is left.\n`,
  )
  process.exitCode = 1
}

export async function purgeProjectHandler(
  options: PurgeProjectOptions,
  pathArg?: string,
  fromAlias = false,
): Promise<void> {
  if (fromAlias) {
    process.stderr.write(
      `${PURGE_RENAME_NOTICE}. The old name still works for now.\n`,
    )
    logEvent('tengu_dead_probe_project_purge_alias', {
      yes: Boolean(
        options.yes,
      ) as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  if (options.all && pathArg) {
    process.stderr.write('Cannot specify both a path and --all.\n')
    process.exitCode = 1
    return
  }
  if (options.all && options.interactive) {
    process.stderr.write('Cannot use -i/--interactive with --all.\n')
    process.exitCode = 1
    return
  }

  const plan = options.all
    ? await buildPurgePlanForAll()
    : await buildPurgePlanForProject(resolveTargetPath(pathArg))

  if (plan.items.length === 0) {
    if (options.all) {
      process.stderr.write(
        'No Claude Code project state found under all projects.\n',
      )
    } else {
      process.stderr.write(
        `No Claude Code project state found for ${plan.projectPath}.\n`,
      )
    }
    logEvent('cli_purge_project', {
      result:
        'cli_purge_project_nothing_found' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }

  printPlan(plan)

  if (options.dryRun) {
    process.stdout.write(
      `Dry run: ${plan.items.length} item(s) would be deleted.\n`,
    )
    logEvent('cli_purge_project_dry_run', {
      count: plan.items
        .length as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return
  }

  if (options.interactive) {
    let deleteRest = false
    let deleted = 0
    const failures: PurgeFailure[] = []
    for (const [i, item] of plan.items.entries()) {
      let action: 'delete' | 'skip' | 'all' = deleteRest
        ? 'delete'
        : await askInteractive(i + 1, plan.items.length, item.label)
      if (action === 'all') {
        deleteRest = true
        action = 'delete'
      }
      if (action === 'skip') continue
      const failure = await deleteItem(item, plan.projectPath)
      if (failure) {
        failures.push(failure)
        continue
      }
      deleted++
    }
    const summary = `Purged ${deleted}/${plan.items.length} item(s)${plan.projectPath ? ` for ${plan.projectPath}` : ''}.`
    if (deleted === 0 && failures.length === 0) {
      process.stdout.write(`${summary}\n`)
      logEvent('cli_purge_project', {
        count:
          0 as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return
    }
    finishPurge(failures, summary)
    return
  }

  if (!options.yes) {
    const q = options.all
      ? `Delete ${plan.items.length} item(s) for ALL projects? This cannot be undone.`
      : `Delete ${plan.items.length} item(s) for ${plan.projectPath}? This cannot be undone.`
    const ok = await askYesNo(q)
    if (!ok) {
      process.stderr.write('Aborted.\n')
      process.exitCode = 1
      return
    }
  }

  const failures: PurgeFailure[] = []
  for (const item of plan.items) {
    const failure = await deleteItem(item, plan.projectPath)
    if (failure) {
      failures.push(failure)
    }
  }
  finishPurge(
    failures,
    options.all
      ? `Purged ${plan.items.length} item(s) across all projects.`
      : `Purged ${plan.items.length} item(s) for ${plan.projectPath}.`,
  )
}
