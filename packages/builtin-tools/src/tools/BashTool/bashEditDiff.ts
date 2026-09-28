import { spawn } from 'child_process'
import { mkdtemp, mkdir, rm, copyFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isEnvDefinedFalsy, isEnvTruthy } from 'src/utils/envUtils.js'
import { logForDebugging } from 'src/utils/debug.js'
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

const GIT_STATE_SWITCH =
  /^[ \t]*(?:sudo[ \t]+)?git[ \t]+(?:checkout|switch|stash|pull|merge|rebase|reset|restore|clean|cherry-pick|revert)(?:[ \t]+[A-Za-z0-9._/@~^][A-Za-z0-9._/@~^-]*){0,16}\s*$/

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

function runGit(
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number },
): Promise<{ stdout: string; code: number }> {
  return new Promise(resolve => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, GIT_OPTIONAL_LOCKS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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
      '[core]\n\trepositoryformatversion = 0\n\tbare = false\n',
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
    await runGit(['update-index', '--refresh'], {
      cwd: repoRoot,
      env,
      timeout: 10_000,
    })
    await runGit(['add', '-A', '--ignore-errors'], {
      cwd: repoRoot,
      env,
      timeout: 10_000,
    })
    const tree = await runGit(['write-tree'], {
      cwd: repoRoot,
      env,
      timeout: 10_000,
    })
    if (tree.code !== 0 || !/^[0-9a-f]{40,64}$/.test(tree.stdout.trim())) {
      await rm(privateDir, { recursive: true, force: true }).catch(() => {})
      return 'unavailable'
    }
    return { repoRoot, gitDirectory: privateDir, tree: tree.stdout.trim() }
  } catch (e) {
    logForDebugging(`bashEditDiff: snapshot failed: ${String(e)}`)
    return 'unavailable'
  }
}

/**
 * densable S5t — diff-tree -r --raw -p between snapshot tree and current tree.
 */
export async function diffBashEditDiffSnapshot(
  snapshot: BashEditDiffSnapshot,
): Promise<BashEditDiff> {
  const { repoRoot, gitDirectory, tree } = snapshot
  const env = { GIT_DIR: gitDirectory, GIT_WORK_TREE: repoRoot }
  try {
    await runGit(['update-index', '--refresh'], {
      cwd: repoRoot,
      env,
      timeout: 10_000,
    })
    await runGit(['add', '-A', '--ignore-errors'], {
      cwd: repoRoot,
      env,
      timeout: 10_000,
    })
    const next = await runGit(['write-tree'], {
      cwd: repoRoot,
      env,
      timeout: 10_000,
    })
    if (next.code !== 0) {
      return { files: [], moreFiles: 0, unavailable: true }
    }
    const nextTree = next.stdout.trim()
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
    for (const match of stdout.matchAll(
      /^:\d{6} \d{6} (\S+) (\S+) ([A-Z])\t(.+)$/gm,
    )) {
      const path = unescapeGitPath(match[4] ?? '')
      if (path) status.set(path, match[3] ?? 'M')
    }
    const hunkMap = parseDiffTreeHunks(stdout)
    const files: BashEditDiffFile[] = []
    for (const [rel, statusCode] of status) {
      if (files.length >= MAX_DIFF_FILES) break
      const hunks = hunkMap.get(rel) ?? []
      if (hunks.length > 0 && !hunksFit(hunks)) continue
      files.push({
        filePath: join(repoRoot, rel),
        hunks,
        ...(statusCode === 'A' ? { created: true } : {}),
        ...(statusCode === 'D' ? { deleted: true } : {}),
      })
    }
    const changedFiles = [...status.keys()]
      .slice(0, MAX_CHANGED_FILES)
      .map(rel => join(repoRoot, rel))
    return {
      files,
      moreFiles: Math.max(0, status.size - files.length),
      changedFiles,
    }
  } catch (e) {
    logForDebugging(`bashEditDiff: diff failed: ${String(e)}`)
    return { files: [], moreFiles: 0, unavailable: true }
  } finally {
    await rm(gitDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

export function formatBashEditDiffForToolResult(
  diff: BashEditDiff | undefined,
): string {
  if (!diff || diff.skipped || !diff.files?.length) return ''
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
  if (diff.moreFiles > 0) {
    parts.push(`… ${diff.moreFiles} more file(s) not shown`)
  }
  parts.push('</bash_edit_diff>')
  return parts.join('\n')
}
