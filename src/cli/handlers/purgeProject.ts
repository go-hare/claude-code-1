/**
 * densable 2.1.289 `claude purge` / hidden `claude project purge`.
 * Plan + delete project-scoped Claude Code state using existing path helpers.
 */
import { closeSync, openSync } from 'fs'
import { readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { createInterface } from 'readline'
import type { Readable, Writable } from 'stream'
import { ReadStream as TtyReadStream, WriteStream as TtyWriteStream } from 'tty'
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

function printPlan(plan: PurgePlan, mirrorOutput?: Writable): void {
  const writeLine = (line = '') => {
    process.stdout.write(`${line}\n`)
    if (mirrorOutput && mirrorOutput !== process.stdout) {
      mirrorOutput.write(`${line}\n`)
    }
  }
  const title = plan.projectPath
    ? `Purge plan for ${plan.projectPath}:`
    : 'Purge plan for ALL projects:'
  writeLine(title)
  for (const item of plan.items) {
    writeLine(`  ${item.label}`)
  }
  if (plan.warnings.length) {
    writeLine()
    for (const w of plan.warnings) {
      writeLine(w)
    }
  }
  writeLine(
    '\nPurging deletes data only on this computer, not anything stored by Anthropic.',
  )
}

/**
 * Official 2.1.325 #2281 (`Xbe` + `re`) + 2.1.326 #34 (`M` / `ue` / `fe` / `le`):
 * resolve interactive keyboard input AND terminal output streams for `claude purge`.
 * When stdout is redirected (e.g. `claude purge > out.txt`), prompts and the
 * purge plan mirror to the terminal (`stderr` if TTY, or `/dev/tty` for writing)
 * so an unseen Enter can never delete data blindly.
 */
export type PurgeTerminalInput =
  | { kind: 'stdin'; stream: Readable; dispose: () => void }
  | { kind: 'override'; stream: Readable; dispose: () => void }
  | { kind: 'unavailable'; reason: 'tty_unavailable' }

export type PurgeTerminalOutput = {
  stream: Writable | undefined
  dispose: () => void
}

export type PurgeTerminalDeps = {
  stdin?: Readable & { isTTY?: boolean }
  stdout?: Writable & { isTTY?: boolean }
  stderr?: Writable & { isTTY?: boolean }
  stdoutIsTTY?: boolean
  stderrIsTTY?: boolean
  openTty?: () => Readable | null
  openTtyWrite?: () => Writable | null
}

function defaultOpenDevTtyWrite(): Writable | null {
  if (process.platform === 'win32') return null
  let fd: number | undefined
  try {
    fd = openSync('/dev/tty', 'w')
    const stream = new TtyWriteStream(fd)
    stream.on('error', () => {})
    return stream
  } catch {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore close error
      }
    }
    return null
  }
}

/**
 * Official 2.1.326 #34 (`M()`) — pick the terminal stream for showing purge
 * prompts: stdout if TTY, else stderr if TTY, else `/dev/tty` opened for write.
 */
export function resolvePurgeTerminalOutput(
  deps?: PurgeTerminalDeps,
): PurgeTerminalOutput {
  const stdout = deps?.stdout ?? process.stdout
  const stderr = deps?.stderr ?? process.stderr
  const stdoutIsTTY = deps?.stdoutIsTTY ?? Boolean(stdout.isTTY)
  const stderrIsTTY = deps?.stderrIsTTY ?? Boolean(stderr.isTTY)
  if (stdoutIsTTY) {
    return { stream: stdout, dispose: () => {} }
  }
  if (stderrIsTTY) {
    return { stream: stderr, dispose: () => {} }
  }
  const openWrite = deps?.openTtyWrite ?? defaultOpenDevTtyWrite
  const ttyOut = openWrite()
  if (ttyOut) {
    return {
      stream: ttyOut,
      dispose: () => {
        try {
          ttyOut.destroy()
        } catch {
          // ignore destroy error
        }
      },
    }
  }
  return { stream: undefined, dispose: () => {} }
}

function defaultOpenDevTty(): Readable | null {
  if (process.platform === 'win32') return null
  let fd: number | undefined
  try {
    fd = openSync('/dev/tty', 'r')
    const stream = new TtyReadStream(fd)
    stream.on('error', () => {})
    return stream
  } catch {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore close error
      }
    }
    return null
  }
}

export function resolvePurgeTerminalInput(
  deps?: PurgeTerminalDeps,
): PurgeTerminalInput {
  const stdin = deps?.stdin ?? process.stdin
  if (stdin.isTTY) {
    return { kind: 'stdin', stream: stdin, dispose: () => {} }
  }
  const openTty = deps?.openTty ?? defaultOpenDevTty
  const ttyStream = openTty()
  if (!ttyStream) {
    return { kind: 'unavailable', reason: 'tty_unavailable' }
  }
  return {
    kind: 'override',
    stream: ttyStream,
    dispose: () => {
      try {
        ttyStream.destroy()
      } catch {
        // ignore destroy error
      }
    },
  }
}

export function checkPurgeInteractiveTerminal(
  hint: string,
  terminal: PurgeTerminalInput,
  stdoutIsTTY: boolean = Boolean(process.stdout.isTTY),
  hasTerminalOutput?: boolean,
): string | null {
  if (terminal.kind === 'unavailable') {
    return `Claude Code can't prompt here: no interactive terminal is available.\n${hint}`
  }
  const canShowPrompt = hasTerminalOutput ?? stdoutIsTTY
  if (!canShowPrompt) {
    if (terminal.kind === 'override' && hasTerminalOutput === undefined) {
      return `Claude Code can't prompt here: stdin and stdout are both piped or redirected, so a key you press could answer a prompt you may not see.\nRun claude with its output going to the terminal.\n${hint}`
    }
    return `Claude Code can't show a prompt here: stdout and stderr are both piped or redirected.\nRun claude with at least one of them going to the terminal.\n${hint}`
  }
  return null
}

async function askYesNo(
  question: string,
  inputStream: Readable = process.stdin,
  outputStream: Writable = process.stdout,
): Promise<boolean> {
  // Official 2.1.325 `oYt` + 2.1.326 #34 `le`: `[y/N]` reads from stdin and
  // writes the prompt to the terminal output stream (never hidden in redirected stdout).
  const rl = createInterface({ input: inputStream, output: outputStream })
  return new Promise<boolean>(resolveAnswer => {
    let settled = false
    const done = (val: boolean) => {
      if (settled) return
      settled = true
      resolveAnswer(val)
    }
    rl.once('close', () => done(false))
    rl.question(`${question} [y/N] `, answer => {
      const t = answer.trim().toLowerCase()
      done(t === 'y' || t === 'yes')
      rl.close()
    })
  })
}

async function askInteractive(
  index: number,
  total: number,
  label: string,
  inputStream: Readable,
  outputStream: Writable = process.stdout,
): Promise<'delete' | 'skip' | 'all' | 'abort'> {
  const rl = createInterface({ input: inputStream, output: outputStream })
  return new Promise<'delete' | 'skip' | 'all' | 'abort'>(resolveAnswer => {
    let settled = false
    const done = (val: 'delete' | 'skip' | 'all' | 'abort') => {
      if (settled) return
      settled = true
      resolveAnswer(val)
    }
    rl.once('close', () => done('abort'))
    rl.question(
      `[${index}/${total}] ${label}\nDelete? [y=Delete / N=Skip / a=Delete all remaining / q=Abort] `,
      answer => {
        const t = answer.trim().toLowerCase()
        if (t === 'q' || t === 'abort') done('abort')
        else if (t === 'a' || t === 'all') done('all')
        else if (t === 'y' || t === 'yes' || t === 'delete') done('delete')
        else done('skip')
        rl.close()
      },
    )
  })
}

async function pickProjectToPurge(
  inputStream: Readable,
  outputStream: Writable = process.stdout,
): Promise<string | null> {
  const current = resolve(getOriginalCwd())
  const known = Object.keys(getGlobalConfig().projects ?? {})
  const seen = new Set<string>([current])
  const choices: string[] = [current]
  for (const p of known) {
    if (!seen.has(p)) {
      seen.add(p)
      choices.push(p)
    }
  }
  outputStream.write('Select a project to purge:\n')
  for (const [idx, p] of choices.entries()) {
    const suffix = idx === 0 ? ' (current directory)' : ''
    outputStream.write(`  ${idx + 1}. ${p}${suffix}\n`)
  }
  const rl = createInterface({ input: inputStream, output: outputStream })
  return new Promise<string | null>(resolveChoice => {
    let settled = false
    const done = (val: string | null) => {
      if (settled) return
      settled = true
      resolveChoice(val)
    }
    rl.once('close', () => done(null))
    rl.question(
      `Enter number [1-${choices.length}] (or q to abort): `,
      answer => {
        const trimmed = answer.trim().toLowerCase()
        if (!trimmed || trimmed === 'q' || trimmed === 'abort') {
          done(null)
        } else {
          const num = Number.parseInt(trimmed, 10)
          if (Number.isInteger(num) && num >= 1 && num <= choices.length) {
            done(choices[num - 1]!)
          } else {
            done(null)
          }
        }
        rl.close()
      },
    )
  })
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
function finishPurge(
  failures: PurgeFailure[],
  successMessage: string,
  mirrorOutput?: Writable,
): void {
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
  if (mirrorOutput && mirrorOutput !== process.stdout) {
    mirrorOutput.write(`${successMessage}\n`)
  }
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
  terminalDeps?: PurgeTerminalDeps,
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

  const stdoutIsTTY = terminalDeps?.stdoutIsTTY ?? Boolean(process.stdout.isTTY)
  const ttyOut = resolvePurgeTerminalOutput(terminalDeps)
  const shouldMirrorToTerminal =
    !options.dryRun && (options.interactive === true || !options.yes)
  const mirrorOutput =
    shouldMirrorToTerminal &&
    ttyOut.stream !== undefined &&
    ttyOut.stream !== (terminalDeps?.stdout ?? process.stdout)
      ? ttyOut.stream
      : undefined
  const promptOutput = ttyOut.stream ?? terminalDeps?.stdout ?? process.stdout

  try {
    let targetPath: string | undefined
    if (!options.all) {
      if (pathArg) {
        targetPath = resolveTargetPath(pathArg)
      } else {
        // Official 2.1.325 #2281 + 2.1.326 #34: project picker reads `/dev/tty`
        // when stdin is piped and renders prompts on the terminal when stdout is redirected.
        const terminal = resolvePurgeTerminalInput(terminalDeps)
        try {
          const err = checkPurgeInteractiveTerminal(
            'Or name a project path, without -i: claude purge <path>. Add --dry-run to see what it would delete.',
            terminal,
            stdoutIsTTY,
            ttyOut.stream !== undefined,
          )
          if (err) {
            process.stderr.write(`${err}\n`)
            logEvent('cli_purge_project', {
              result:
                'no_terminal' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            process.exitCode = 1
            return
          }
          if (terminal.kind === 'unavailable') {
            process.exitCode = 1
            return
          }
          const picked = await pickProjectToPurge(terminal.stream, promptOutput)
          if (picked === null) {
            process.stderr.write('Stopped. Nothing was deleted.\n')
            logEvent('cli_purge_project', {
              result:
                'cancelled' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            process.exitCode = 1
            return
          }
          targetPath = picked
        } finally {
          if (terminal.kind !== 'unavailable') {
            terminal.dispose()
          }
        }
      }
    }

    const plan = options.all
      ? await buildPurgePlanForAll()
      : await buildPurgePlanForProject(targetPath!)

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

    printPlan(plan, mirrorOutput)

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
      // Official 2.1.325 #2281 + 2.1.326 #34: `-i` prompts open `/dev/tty` when
      // stdin is piped and write prompts to the terminal when stdout is redirected.
      const terminal = resolvePurgeTerminalInput(terminalDeps)
      try {
        const err = checkPurgeInteractiveTerminal(
          'Or run without -i to confirm the whole list once; that [y/N] prompt reads stdin.',
          terminal,
          stdoutIsTTY,
          ttyOut.stream !== undefined,
        )
        if (err || terminal.kind === 'unavailable') {
          process.stderr.write(
            `${err ?? "Claude Code can't prompt here."}\nStopped. Nothing was deleted.\n`,
          )
          logEvent('cli_purge_project', {
            result:
              'no_terminal' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          process.exitCode = 1
          return
        }
        let deleteRest = false
        let deleted = 0
        const failures: PurgeFailure[] = []
        for (const [i, item] of plan.items.entries()) {
          let action: 'delete' | 'skip' | 'all' | 'abort' = deleteRest
            ? 'delete'
            : await askInteractive(
                i + 1,
                plan.items.length,
                item.label,
                terminal.stream,
                promptOutput,
              )
          if (action === 'abort') {
            process.stderr.write(`Stopped. ${deleted} item(s) deleted.\n`)
            logEvent('cli_purge_project', {
              result:
                'aborted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            process.exitCode = 1
            return
          }
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
          mirrorOutput?.write(`${summary}\n`)
          logEvent('cli_purge_project', {
            count:
              0 as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          return
        }
        finishPurge(failures, summary, mirrorOutput)
        return
      } finally {
        if (terminal.kind !== 'unavailable') {
          terminal.dispose()
        }
      }
    }

    if (!options.yes) {
      const q = options.all
        ? `Delete ${plan.items.length} item(s) for ALL projects? This cannot be undone.`
        : `Delete ${plan.items.length} item(s) for ${plan.projectPath}? This cannot be undone.`
      const ok = await askYesNo(
        q,
        terminalDeps?.stdin ?? process.stdin,
        promptOutput,
      )
      if (!ok) {
        process.stderr.write('Stopped. Nothing was deleted.\n')
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
      mirrorOutput,
    )
  } finally {
    ttyOut.dispose()
  }
}
