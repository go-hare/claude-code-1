import { spawn } from 'child_process'
import { mkdtemp, mkdir, rm, copyFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isEnvDefinedFalsy, isEnvTruthy } from 'src/utils/envUtils.js'
import { logForDebugging } from 'src/utils/debug.js'
import { parseForSecurityFromAst } from 'src/utils/bash/ast.js'
import { getParserModule } from 'src/utils/bash/bashParser.js'
import { splitCommand_DEPRECATED } from 'src/utils/bash/commands.js'
import { tryParseShellCommand } from 'src/utils/bash/shellQuote.js'
import type { PermissionMode } from 'src/utils/permissions/PermissionMode.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from 'src/utils/settings/settings.js'

/** densable dce — max files with hunks in the tool result */
const MAX_DIFF_FILES = 5
/** densable F2 — max changedFiles paths for hooks */
const MAX_CHANGED_FILES = 200
/** densable mer / ger — hunk size gate */
const MAX_HUNK_LINES = 400
const MAX_HUNK_CHARS = 64_000

const GIT_STATE_SWITCH_SUBCOMMANDS = [
  'checkout',
  'switch',
  'stash',
  'pull',
  'merge',
  'rebase',
  'reset',
  'restore',
  'clean',
  'cherry-pick',
  'revert',
]

const GIT_STATE_SWITCH = new RegExp(
  String.raw`^[ \t]*(?:sudo[ \t]+)?git[ \t]+(?:${GIT_STATE_SWITCH_SUBCOMMANDS.join('|')})(?:[ \t]+[A-Za-z0-9._/@~^][A-Za-z0-9._/@~^-]*){0,16}\s*$`,
)

export type BashEditDiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export type BashEditDiffFile = {
  filePath: string
  hunks: BashEditDiffHunk[]
  created?: boolean
  deleted?: boolean
}

export type BashEditDiff = {
  files: BashEditDiffFile[]
  moreFiles: number
  changedFiles?: string[]
  skipped?: boolean
  unavailable?: boolean
  shared?: boolean
}

export type BashEditDiffSnapshot = {
  repoRoot: string
  gitDirectory: string
  tree: string
}

/**
 * densable lMt env half — CLAUDE_CODE_THRIFTY_SONIC. Skip GrowthBook cohort.
 */
function isThriftySonic(): boolean {
  const raw = process.env.CLAUDE_CODE_THRIFTY_SONIC
  if (raw !== undefined) return isEnvTruthy(raw)
  return false
}

function trustedBashEditDiffSetting(): boolean | undefined {
  // densable _k — policy / flag / user only (not project/local)
  for (const source of [
    'policySettings',
    'flagSettings',
    'userSettings',
  ] as const) {
    const value = getSettingsForSource(source)?.bashEditDiffEnabled
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * densable y5t body — env, then trusted settings, then auto/bypass && thrifty.
 */
export function resolveBashEditDiffEnabled(
  mode: PermissionMode,
  env: string | undefined,
  trusted: boolean | undefined,
  merged: boolean | undefined,
  thrifty: boolean,
): boolean {
  if (env !== undefined) {
    if (isEnvTruthy(env)) return true
    if (isEnvDefinedFalsy(env)) return false
  }
  if (trusted === false || merged === false) return false
  if (trusted === true) return true
  return (mode === 'auto' || mode === 'bypassPermissions') && thrifty
}

export function isBashEditDiffEnabled(mode: PermissionMode): boolean {
  return resolveBashEditDiffEnabled(
    mode,
    process.env.CLAUDE_CODE_BASH_EDIT_DIFF,
    trustedBashEditDiffSetting(),
    getInitialSettings().bashEditDiffEnabled,
    isThriftySonic(),
  )
}

/** densable _5t — skip snapshot around git checkout/switch/stash/… */
export function isGitStateSwitchCommand(command: string): boolean {
  return GIT_STATE_SWITCH.test(command)
}

/** SEA `SIt` (@294057169) — extract git subcommand skipping leading flags. */
function getGitSubcommand(argv: string[]): string | undefined {
  if (argv[0] !== 'git') return undefined
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue
    if (arg.startsWith('-')) {
      if (arg === '-C' || arg === '-c') i++
      continue
    }
    return arg
  }
  return undefined
}

/**
 * SEA `Fxs` (@294112531) — true when any subcommand in a compound command
 * runs a git state-switching subcommand (`treeMoved` in BashToolResultMessage).
 */
export function commandHasGitStateSwitch(command: string): boolean {
  try {
    const tree =
      command.length <= 10_000 ? getParserModule()?.parse(command) : null
    const ast = tree ? parseForSecurityFromAst(command, tree) : undefined
    const argvs: string[][] =
      ast?.kind === 'simple'
        ? ast.commands.map(c => c.argv)
        : splitCommand_DEPRECATED(command).map(sub => {
            const parsed = tryParseShellCommand(sub)
            return parsed.success
              ? parsed.tokens.filter((t): t is string => typeof t === 'string')
              : []
          })
    return argvs.some(argv =>
      GIT_STATE_SWITCH_SUBCOMMANDS.includes(
        getGitSubcommand(argv[0] === 'sudo' ? argv.slice(1) : argv) ?? '',
      ),
    )
  } catch (err) {
    logForDebugging(`bashEditDiff: command parse failed: ${String(err)}`)
    return false
  }
}

function runGit(
  args: string[],
  opts: {
    cwd: string
    env?: NodeJS.ProcessEnv
    timeout?: number
    input?: string
  },
): Promise<{ stdout: string; code: number }> {
  return new Promise(resolve => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, GIT_OPTIONAL_LOCKS: '1' },
      stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    if (opts.input !== undefined && child.stdin) {
      child.stdin.end(opts.input)
    }
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, opts.timeout ?? 10_000)
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ stdout, code: code ?? 1 })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ stdout: '', code: 1 })
    })
  })
}

async function resolveRepoRoot(cwd: string): Promise<string | null> {
  const { stdout, code } = await runGit(['rev-parse', '--show-toplevel'], {
    cwd,
    timeout: 2000,
  })
  if (code !== 0) return null
  const root = stdout.trim()
  return root || null
}

function hunksFit(hunks: BashEditDiffHunk[]): boolean {
  let lines = 0
  let chars = 0
  for (const hunk of hunks) {
    lines += hunk.lines.length
    for (const line of hunk.lines) chars += line.length
  }
  return lines <= MAX_HUNK_LINES && chars <= MAX_HUNK_CHARS
}

function parseDiffTreeHunks(stdout: string): Map<string, BashEditDiffHunk[]> {
  const hunks = new Map<string, BashEditDiffHunk[]>()
  const parts = stdout.split(/^diff --git /m).filter(Boolean)
  for (const part of parts) {
    const nl = part.indexOf('\n')
    const header = nl === -1 ? part : part.slice(0, nl)
    const same = header.match(/^a\/(.+) b\/\1$/)
    const path = same
      ? same[1]
      : header
          .match(/ b\/(.+)$/)?.[1]
          ?.replace(/^"/, '')
          .replace(/"$/, '')
    if (!path) continue
    const fileHunks: BashEditDiffHunk[] = []
    let current: BashEditDiffHunk | null = null
    for (const line of part.split('\n').slice(1)) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (m) {
        if (current) fileHunks.push(current)
        current = {
          oldStart: Number.parseInt(m[1] ?? '0', 10),
          oldLines: Number.parseInt(m[2] ?? '1', 10),
          newStart: Number.parseInt(m[3] ?? '0', 10),
          newLines: Number.parseInt(m[4] ?? '1', 10),
          lines: [],
        }
        continue
      }
      if (
        current &&
        (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))
      ) {
        current.lines.push(line)
      }
    }
    if (current) fileHunks.push(current)
    if (fileHunks.length > 0) hunks.set(path, fileHunks)
  }
  return hunks
}

function unescapeGitPath(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  return raw
}

/**
 * Official 2.1.319 #1742 (`Tmi` + `_mi`):
 * Parse `git status --porcelain=v2 -z` output to collect changed, deleted, and
 * untracked-directory paths, then explicitly re-index via
 * `git update-index --add --remove -z --stdin` / `--force-remove -z --stdin`.
 * This prevents git's racy-clean optimization from missing files written in
 * the same second as the prior index update.
 */
export function parsePorcelainV2Status(stdout: string): {
  changed: string[]
  deleted: string[]
  untrackedDirectories: string[]
} {
  const changed: string[] = []
  const deleted: string[] = []
  const untrackedDirectories: string[] = []
  for (const entry of stdout.split('\0')) {
    if (!entry) continue
    if (entry.startsWith('? ')) {
      const p = entry.slice(2)
      if (!p) continue
      if (p.endsWith('/')) {
        untrackedDirectories.push(p)
      } else {
        changed.push(p)
      }
    } else if (entry.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const xy = entry.slice(2, 4)
      const parts = entry.split(' ')
      const p = parts.slice(8).join(' ')
      if (!p) continue
      if (xy[1] === 'D') {
        deleted.push(p)
      } else {
        changed.push(p)
      }
    } else if (entry.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const xy = entry.slice(2, 4)
      const parts = entry.split(' ')
      const p = parts.slice(10).join(' ')
      if (!p) continue
      if (xy[1] === 'D') {
        deleted.push(p)
      } else {
        changed.push(p)
      }
    }
  }
  return { changed, deleted, untrackedDirectories }
}

async function syncPrivateIndexAndWriteTree(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const statusRes = await runGit(
    [
      'status',
      '--porcelain=v2',
      '-z',
      '--untracked-files=normal',
      '--ignored=no',
      '--no-renames',
      '--ignore-submodules=all',
    ],
    { cwd: repoRoot, env, timeout: 10_000 },
  )
  if (statusRes.code !== 0) {
    return null
  }
  const { changed, deleted, untrackedDirectories } = parsePorcelainV2Status(
    statusRes.stdout,
  )
  if (untrackedDirectories.length > 0) {
    const lsRes = await runGit(
      [
        'ls-files',
        '-z',
        '--others',
        '--exclude-standard',
        '--',
        ...untrackedDirectories,
      ],
      { cwd: repoRoot, env, timeout: 10_000 },
    )
    if (lsRes.code !== 0) {
      return null
    }
    for (const f of lsRes.stdout.split('\0')) {
      if (f && !f.endsWith('/')) {
        changed.push(f)
      }
    }
  }
  if (deleted.length > 0) {
    const rmRes = await runGit(
      ['update-index', '--force-remove', '-z', '--stdin'],
      {
        cwd: repoRoot,
        env,
        timeout: 10_000,
        input: `${deleted.join('\0')}\0`,
      },
    )
    if (rmRes.code !== 0) return null
  }
  if (changed.length > 0) {
    const addRes = await runGit(
      ['update-index', '--add', '--remove', '-z', '--stdin'],
      {
        cwd: repoRoot,
        env,
        timeout: 10_000,
        input: `${changed.join('\0')}\0`,
      },
    )
    if (addRes.code !== 0) return null
  }
  const tree = await runGit(['write-tree'], {
    cwd: repoRoot,
    env,
    timeout: 10_000,
  })
  const sha = tree.stdout.trim()
  if (tree.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
    return null
  }
  return sha
}

/**
 * densable j2 — snapshot worktree as a tree via a private GIT_DIR + alternates.
 */
export async function takeBashEditDiffSnapshot(
  cwd: string,
): Promise<BashEditDiffSnapshot | 'unavailable' | null> {
  try {
    const repoRoot = await resolveRepoRoot(cwd)
    if (!repoRoot) return null
    const gitDirResult = await runGit(['rev-parse', '--absolute-git-dir'], {
      cwd: repoRoot,
      timeout: 2000,
    })
    if (gitDirResult.code !== 0) return 'unavailable'
    const realGitDir = gitDirResult.stdout.trim()
    const privateDir = await mkdtemp(join(tmpdir(), 'cc-bash-edit-diff-'))
    await mkdir(join(privateDir, 'objects', 'info'), { recursive: true })
    await mkdir(join(privateDir, 'refs', 'heads'), { recursive: true })
    await mkdir(join(privateDir, 'info'), { recursive: true })
    await writeFile(join(privateDir, 'HEAD'), 'ref: refs/heads/main\n', {
      flag: 'wx',
    })
    await writeFile(
      join(privateDir, 'config'),
      '[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tautocrlf = false\n',
      { flag: 'wx' },
    )
    await writeFile(
      join(privateDir, 'objects', 'info', 'alternates'),
      `${join(realGitDir, 'objects')}\n`,
      { flag: 'wx' },
    )
    try {
      await copyFile(join(realGitDir, 'index'), join(privateDir, 'index'))
    } catch {
      // empty index is fine
    }
    const env = { GIT_DIR: privateDir, GIT_WORK_TREE: repoRoot }
    const treeSha = await syncPrivateIndexAndWriteTree(repoRoot, env)
    if (!treeSha) {
      await rm(privateDir, { recursive: true, force: true }).catch(() => {})
      return 'unavailable'
    }
    return { repoRoot, gitDirectory: privateDir, tree: treeSha }
  } catch (e) {
    logForDebugging(`bashEditDiff: snapshot failed: ${String(e)}`)
    return 'unavailable'
  }
}

const EMPTY_BLOB_SHAS = new Set([
  'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
  '473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813',
])

const PREWARM_SNAPSHOT_TTL_MS = 15_000
type PrewarmedSnapshotEntry = {
  promise: Promise<BashEditDiffSnapshot | 'unavailable' | null>
  startedAt: number
  timer: ReturnType<typeof setTimeout>
}
const prewarmedSnapshots = new Map<string, PrewarmedSnapshotEntry>()

function cleanupPrewarmedSnapshotPromise(
  promise: Promise<BashEditDiffSnapshot | 'unavailable' | null>,
): void {
  void promise.then(snap => {
    if (snap && snap !== 'unavailable') {
      void rm(snap.gitDirectory, { recursive: true, force: true }).catch(
        () => {},
      )
    }
  })
}

function prewarmSnapshotKey(cwd: string, toolUseId?: string): string {
  return toolUseId ? `${toolUseId}\0${cwd}` : cwd
}

function sweepExpiredPrewarmedSnapshots(nowMs: number): void {
  for (const [key, entry] of prewarmedSnapshots) {
    if (nowMs - entry.startedAt >= PREWARM_SNAPSHOT_TTL_MS) {
      prewarmedSnapshots.delete(key)
      clearTimeout(entry.timer)
      cleanupPrewarmedSnapshotPromise(entry.promise)
    }
  }
}

/**
 * Official 2.1.327 #488: pre-warm the Bash edit diff snapshot early in auto
 * and bypass permissions modes so the diff is ready sooner when the command
 * finishes. Keyed by `toolUseId` (when provided) with TTL cleanup so denied
 * or abandoned commands never leak temp dirs or poison later commands.
 */
export function prewarmBashEditDiffSnapshot(
  cwd: string,
  toolUseId?: string,
  now: () => number = Date.now,
): Promise<BashEditDiffSnapshot | 'unavailable' | null> {
  const nowMs = now()
  sweepExpiredPrewarmedSnapshots(nowMs)
  const key = prewarmSnapshotKey(cwd, toolUseId)
  const existing = prewarmedSnapshots.get(key)
  if (existing) {
    if (nowMs - existing.startedAt < PREWARM_SNAPSHOT_TTL_MS) {
      return existing.promise
    }
    prewarmedSnapshots.delete(key)
    clearTimeout(existing.timer)
    cleanupPrewarmedSnapshotPromise(existing.promise)
  }
  const promise = takeBashEditDiffSnapshot(cwd)
  const timer = setTimeout(() => {
    const current = prewarmedSnapshots.get(key)
    if (current?.promise === promise) {
      prewarmedSnapshots.delete(key)
      cleanupPrewarmedSnapshotPromise(promise)
    }
  }, PREWARM_SNAPSHOT_TTL_MS)
  timer.unref()
  prewarmedSnapshots.set(key, { promise, startedAt: nowMs, timer })
  return promise
}

export function consumePrewarmedBashEditDiffSnapshot(
  cwd: string,
  toolUseId?: string,
  now: () => number = Date.now,
): Promise<BashEditDiffSnapshot | 'unavailable' | null> {
  const nowMs = now()
  const key = prewarmSnapshotKey(cwd, toolUseId)
  const existing = prewarmedSnapshots.get(key)
  if (existing) {
    prewarmedSnapshots.delete(key)
    clearTimeout(existing.timer)
    if (nowMs - existing.startedAt < PREWARM_SNAPSHOT_TTL_MS) {
      return existing.promise
    }
    cleanupPrewarmedSnapshotPromise(existing.promise)
  }
  return takeBashEditDiffSnapshot(cwd)
}

export function discardPrewarmedBashEditDiffSnapshot(
  cwd: string,
  toolUseId?: string,
): void {
  const key = prewarmSnapshotKey(cwd, toolUseId)
  const existing = prewarmedSnapshots.get(key)
  if (!existing) return
  prewarmedSnapshots.delete(key)
  clearTimeout(existing.timer)
  cleanupPrewarmedSnapshotPromise(existing.promise)
}

export function _resetPrewarmedBashEditDiffSnapshotsForTesting(): void {
  for (const entry of prewarmedSnapshots.values()) {
    clearTimeout(entry.timer)
    cleanupPrewarmedSnapshotPromise(entry.promise)
  }
  prewarmedSnapshots.clear()
}

/**
 * densable S5t + Official 2.1.327 #418 — diff-tree -r --raw -p between
 * snapshot tree and current tree.
 * Binary files (no text hunks, non-empty), too-large files (failing hunksFit),
 * and files past MAX_DIFF_FILES are omitted from `files`, counted in
 * `moreFiles`, and named in `changedFiles` (up to MAX_CHANGED_FILES).
 */
export async function diffBashEditDiffSnapshot(
  snapshot: BashEditDiffSnapshot,
): Promise<BashEditDiff> {
  const { repoRoot, gitDirectory, tree } = snapshot
  const env = { GIT_DIR: gitDirectory, GIT_WORK_TREE: repoRoot }
  try {
    const nextTree = await syncPrivateIndexAndWriteTree(repoRoot, env)
    if (!nextTree) {
      return { files: [], moreFiles: 0, unavailable: true }
    }
    if (nextTree === tree) {
      return { files: [], moreFiles: 0 }
    }
    const { stdout, code } = await runGit(
      [
        'diff-tree',
        '-r',
        '--raw',
        '-p',
        '--no-color',
        '--no-renames',
        tree,
        nextTree,
      ],
      { cwd: repoRoot, env, timeout: 10_000 },
    )
    if (code !== 0) {
      return { files: [], moreFiles: 0, unavailable: true }
    }
    const status = new Map<string, string>()
    const emptyByPath = new Set<string>()
    for (const match of stdout.matchAll(
      /^:\d{6} \d{6} (\S+) (\S+) ([A-Z])\t(.+)$/gm,
    )) {
      const oldOid = match[1] ?? ''
      const newOid = match[2] ?? ''
      const statusCode = match[3] ?? 'M'
      const path = unescapeGitPath(match[4] ?? '')
      if (!path) continue
      status.set(path, statusCode)
      if (
        (statusCode === 'A' && EMPTY_BLOB_SHAS.has(newOid)) ||
        (statusCode === 'D' && EMPTY_BLOB_SHAS.has(oldOid))
      ) {
        emptyByPath.add(path)
      }
    }
    const hunkMap = parseDiffTreeHunks(stdout)
    const files: BashEditDiffFile[] = []
    for (const rel of emptyByPath) {
      if (files.length >= MAX_DIFF_FILES) break
      const statusCode = status.get(rel)
      files.push({
        filePath: join(repoRoot, rel),
        hunks: [],
        ...(statusCode === 'A' ? { created: true } : { deleted: true }),
      })
    }
    for (const [rel, hunks] of hunkMap) {
      if (files.length >= MAX_DIFF_FILES) break
      if (emptyByPath.has(rel)) continue
      if (!hunksFit(hunks)) continue
      const statusCode = status.get(rel)
      if (statusCode === undefined) continue
      files.push({
        filePath: join(repoRoot, rel),
        hunks: hunks.map(h => ({
          ...h,
          lines: h.lines.filter(line => line !== ''),
        })),
        ...(statusCode === 'A' ? { created: true } : {}),
        ...(statusCode === 'D' ? { deleted: true } : {}),
      })
    }
    const changedFiles = [...status.keys()]
      .slice(0, MAX_CHANGED_FILES)
      .map(rel => join(repoRoot, rel))
    return {
      files,
      moreFiles: Math.max(
        0,
        Math.max(status.size, hunkMap.size) - files.length,
      ),
      changedFiles,
    }
  } catch (e) {
    logForDebugging(`bashEditDiff: diff failed: ${String(e)}`)
    return { files: [], moreFiles: 0, unavailable: true }
  } finally {
    await rm(gitDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

export function getOmittedBashEditDiffPaths(
  diff: BashEditDiff,
  maxNames?: number,
): string[] {
  const shown = new Set(diff.files.map(f => f.filePath))
  const omitted = (diff.changedFiles ?? []).filter(p => !shown.has(p))
  return maxNames === undefined ? omitted : omitted.slice(0, maxNames)
}

export function formatBashEditDiffForToolResult(
  diff: BashEditDiff | undefined,
): string {
  if (!diff || diff.skipped) return ''
  const hasShown = (diff.files?.length ?? 0) > 0
  const hasMore = diff.moreFiles > 0
  if (!hasShown && !hasMore) return ''
  const parts: string[] = ['<bash_edit_diff>']
  for (const file of diff.files) {
    const flag = file.created ? ' created' : file.deleted ? ' deleted' : ''
    parts.push(`File${flag}: ${file.filePath}`)
    for (const hunk of file.hunks) {
      parts.push(
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      )
      parts.push(...hunk.lines.filter(line => line !== ''))
    }
  }
  if (hasMore) {
    const omittedPaths = getOmittedBashEditDiffPaths(diff)
    if (hasShown) {
      parts.push(`… ${diff.moreFiles} more file(s) not shown`)
    } else {
      parts.push(
        `${diff.moreFiles} ${diff.moreFiles === 1 ? 'file' : 'files'} changed (binary, mode only or too large to show)`,
      )
    }
    for (const omitted of omittedPaths) {
      parts.push(`  ${omitted}`)
    }
    const unshownCount = diff.moreFiles - omittedPaths.length
    if (omittedPaths.length > 0 && unshownCount > 0) {
      parts.push(
        `… ${unshownCount} more ${unshownCount === 1 ? 'file' : 'files'}`,
      )
    }
  }
  parts.push('</bash_edit_diff>')
  return parts.join('\n')
}
