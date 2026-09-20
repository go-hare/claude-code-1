/**
 * densable 2.1.247 `Yt` / `Cf` / `buildWorkspaceDiffResponse` (`_45.js`).
 * Official: `async function Yt(t,n,i=bt)` — host, permissionContext, budget.
 * Do not rewrite `src/utils/gitDiff.ts`; this is the RC reporter.
 */

import { structuredPatch } from 'diff'
import { open, realpath } from 'fs/promises'
import { basename, dirname, isAbsolute, join } from 'path'
import type { ToolPermissionContext } from '../Tool.js'
import { getCwd } from '../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../utils/execFileNoThrow.js'
import { fetchGitDiff, hunkRefForDiff } from '../utils/gitDiff.js'
import { gitExe } from '../utils/git.js'
import {
  matchingRuleForInput,
  pathInAllowedWorkingPath,
} from '../utils/permissions/filesystem.js'
import {
  DEFAULT_WORKSPACE_DIFF_COMPUTE_BUDGET,
  type WorkspaceDiffComputeBudget,
} from './workspaceDiffBudget.js'

const BLOB_MODE = new Set(['100644', '100755', '100664'])
const MAX_FILE_BYTES = 10_000_000
const MAX_EDIT_LENGTH = 10_000
const AGGREGATE_HUNK_BYTES = 2_000_000
const MAX_HUNK_LINE_BYTES = 1_000_000
const MAX_HUNK_LINES = 400
const GIT_TIMEOUT_MS = 5000
const OID_RE = /^[0-9a-f]{40,64}$/

export type WorkspaceDiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export type WorkspaceDiffFileHunks = {
  path: string
  hunks: WorkspaceDiffHunk[]
}

export type WorkspaceDiffPerFileStat = {
  path: string
  added: number
  removed: number
  isBinary: boolean
  isUntracked?: boolean
  preSession?: boolean
}

export type WorkspaceDiffSource =
  | { kind: 'working-tree' }
  | { kind: 'branch'; baseBranch: string; baseRef: string }

export type WorkspaceDiffPayload = {
  stats: {
    filesCount: number
    linesAdded: number
    linesRemoved: number
  }
  perFileStats: WorkspaceDiffPerFileStat[]
  hunks: WorkspaceDiffFileHunks[]
  skippedLarge: string[]
  restricted: string[]
  source: WorkspaceDiffSource
}

export type WorkspaceDiffResponse = { diff: WorkspaceDiffPayload | null }

type TreeEntry = { mode: string; oid: string; size: number }

function gitArgs(args: string[]): string[] {
  return ['--literal-pathspecs', ...args]
}

function gitOpts(cwd: string) {
  return {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    preserveOutputOnError: false,
    maxBuffer: 10_000_000,
  }
}

/** densable `Pt` — refuse quoted / control / absolute / copy-rename paths. */
function isSafeGitPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('"')) return false
  // Official `_45` `Pt`: reject C0 + DEL. Contract regex, not a lint sample.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: densable Pt
  if (/[\u0000-\u001f\u007f]/.test(path)) return false
  if (path.startsWith('-') || path.startsWith(':') || isAbsolute(path)) {
    return false
  }
  if (path.includes(' => ')) return false
  return path
    .split('/')
    .every(part => part !== '' && part !== '.' && part !== '..')
}

/** densable `$2a` / `gi` — `rev-parse --show-toplevel`. Yt calls `A()` with no abort. */
export async function showGitToplevel(): Promise<string | null> {
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    gitArgs(['--no-optional-locks', 'rev-parse', '--show-toplevel']),
    gitOpts(getCwd()),
  )
  if (code !== 0 || stdout.trim() === '') return null
  return stdout.trim()
}

async function lsTree(
  root: string,
  ref: string,
  paths: string[],
): Promise<Map<string, TreeEntry> | null> {
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    gitArgs(['ls-tree', '-r', '-l', '-z', '--full-tree', ref, '--', ...paths]),
    gitOpts(root),
  )
  if (code !== 0) return null
  const out = new Map<string, TreeEntry>()
  for (const row of stdout.split('\0')) {
    if (!row) continue
    const match = row.match(/^(\d{6}) (\S+) ([0-9a-f]{40,64}) +(\d+|-)\t(.+)$/s)
    if (!match) continue
    const mode = match[1] ?? ''
    const kind = match[2]
    const oid = match[3] ?? ''
    const sizeRaw = match[4]
    const path = match[5]
    if (path === undefined) continue
    out.set(path, {
      mode,
      oid,
      size: kind === 'blob' && sizeRaw !== '-' ? Number(sizeRaw) : -1,
    })
  }
  return out
}

async function lsIndex(
  root: string,
  paths: string[],
): Promise<Map<string, TreeEntry> | null> {
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    gitArgs(['ls-files', '--stage', '-z', '--', ...paths]),
    gitOpts(root),
  )
  if (code !== 0) return null
  const out = new Map<string, TreeEntry>()
  const conflicted = new Set<string>()
  for (const row of stdout.split('\0')) {
    if (!row) continue
    const match = row.match(/^(\d{6}) ([0-9a-f]{40,64}) (\d+)\t(.+)$/s)
    if (!match) continue
    const mode = match[1] ?? ''
    const oid = match[2] ?? ''
    const stage = match[3]
    const path = match[4]
    if (path === undefined) continue
    if (stage !== '0') {
      conflicted.add(path)
      continue
    }
    out.set(path, { mode, oid, size: -1 })
  }
  for (const path of conflicted) out.delete(path)
  if (out.size === 0) return out
  const oids = [...new Set([...out.values()].map(entry => entry.oid))]
  const check = await execFileNoThrowWithCwd(
    gitExe(),
    gitArgs(['cat-file', '--batch-check=%(objectname) %(objectsize)']),
    { ...gitOpts(root), input: `${oids.join('\n')}\n` },
  )
  if (check.code !== 0) return null
  const sizes = new Map<string, number>()
  for (const line of check.stdout.split('\n')) {
    const match = line.match(/^([0-9a-f]{40,64}) (\d+)$/)
    if (match?.[1] !== undefined) sizes.set(match[1], Number(match[2]))
  }
  for (const [path, entry] of out) {
    const size = sizes.get(entry.oid)
    if (size === undefined) out.delete(path)
    else entry.size = size
  }
  return out
}

async function catBlob(root: string, oid: string): Promise<string | null> {
  if (!OID_RE.test(oid)) return null
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    gitArgs(['cat-file', 'blob', oid]),
    { ...gitOpts(root), maxBuffer: MAX_FILE_BYTES + 65536 },
  )
  return code === 0 ? stdout : null
}

function pathIsReadable(
  absPath: string,
  permissionContext: ToolPermissionContext,
): boolean {
  if (!pathInAllowedWorkingPath(absPath, permissionContext)) return false
  if (matchingRuleForInput(absPath, permissionContext, 'read', 'deny')) {
    return false
  }
  if (matchingRuleForInput(absPath, permissionContext, 'read', 'ask')) {
    return false
  }
  return true
}

type WorktreeFile =
  | { kind: 'missing' }
  | { kind: 'restricted' }
  | { kind: 'too-large' }
  | { kind: 'ok'; content: string }

/** densable `_45` `Ot` — regular file, nlink 1, identity, read gate. */
async function readWorktreeFile(
  absPath: string,
  permissionContext: ToolPermissionContext,
): Promise<WorktreeFile> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(absPath, 'r')
  } catch (err) {
    return (err as { code?: string })?.code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'restricted' }
  }
  try {
    const stat = await handle.stat({ bigint: true })
    if (
      !stat.isFile() ||
      stat.nlink !== 1n ||
      stat.dev === 0n ||
      stat.ino === 0n
    ) {
      return { kind: 'restricted' }
    }
    let resolved: string
    try {
      resolved = await realpath(absPath)
    } catch {
      return { kind: 'restricted' }
    }
    if (!pathIsReadable(resolved, permissionContext)) {
      return { kind: 'restricted' }
    }
    if (stat.size > BigInt(MAX_FILE_BYTES)) return { kind: 'too-large' }
    const content = await handle.readFile({ encoding: 'utf-8' })
    return { kind: 'ok', content }
  } catch {
    return { kind: 'restricted' }
  } finally {
    await handle.close().catch(() => {})
  }
}

async function pathIsReadableResolved(
  absPath: string,
  permissionContext: ToolPermissionContext,
): Promise<boolean> {
  try {
    const resolved = await realpath(absPath)
    return pathIsReadable(resolved, permissionContext)
  } catch (err) {
    if ((err as { code?: string })?.code !== 'ENOENT') return false
    let parent = dirname(absPath)
    const parts = [basename(absPath)]
    for (let i = 0; i < 64; i++) {
      try {
        const resolved = await realpath(parent)
        return pathIsReadable(join(resolved, ...parts), permissionContext)
      } catch (inner) {
        if ((inner as { code?: string })?.code !== 'ENOENT') return false
        const next = dirname(parent)
        if (next === parent) return false
        parts.unshift(basename(parent))
        parent = next
      }
    }
    return false
  }
}

function containsNul(text: string): boolean {
  return text.slice(0, 8000).includes('\0')
}

function applyEol(
  content: string,
  attrs:
    | {
        text: string
        eol: string
        filter: string
        workingTreeEncoding: string
      }
    | undefined,
  autocrlf: 'true' | 'input' | false,
  blob: string,
): string | 'unsupported' {
  if (!attrs) return content
  if (
    attrs.filter !== 'unspecified' ||
    attrs.workingTreeEncoding !== 'unspecified'
  ) {
    return 'unsupported'
  }
  if (attrs.text === 'unset') return content
  let normalize: boolean
  if (attrs.text === 'set') normalize = false
  else if (attrs.text === 'auto') normalize = true
  else if (attrs.text === 'unspecified') {
    if (autocrlf === 'true' || autocrlf === 'input') normalize = true
    else if (attrs.eol === 'crlf' || attrs.eol === 'lf') normalize = true
    else return content
  } else return content
  if (!content.includes('\r\n')) return content
  if (normalize && (containsNul(content) || blob.includes('\r\n')))
    return content
  return content.replaceAll('\r\n', '\n')
}

async function loadCheckAttr(
  root: string,
  paths: string[],
): Promise<Map<
  string,
  {
    text: string
    eol: string
    filter: string
    workingTreeEncoding: string
  }
> | null> {
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    gitArgs([
      'check-attr',
      '-z',
      'text',
      'eol',
      'filter',
      'working-tree-encoding',
      '--',
      ...paths,
    ]),
    gitOpts(root),
  )
  if (code !== 0) return null
  const out = new Map<
    string,
    {
      text: string
      eol: string
      filter: string
      workingTreeEncoding: string
    }
  >()
  const parts = stdout.split('\0')
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const path = parts[i]
    const attr = parts[i + 1]
    const value = parts[i + 2]
    if (path === undefined || attr === undefined || value === undefined)
      continue
    let row = out.get(path)
    if (!row) {
      row = {
        text: 'unspecified',
        eol: 'unspecified',
        filter: 'unspecified',
        workingTreeEncoding: 'unspecified',
      }
      out.set(path, row)
    }
    if (attr === 'text') row.text = value
    else if (attr === 'eol') row.eol = value
    else if (attr === 'filter') row.filter = value
    else if (attr === 'working-tree-encoding') row.workingTreeEncoding = value
  }
  return out
}

async function loadAutocrlf(root: string): Promise<'true' | 'input' | false> {
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    gitArgs(['config', '--get', 'core.autocrlf']),
    gitOpts(root),
  )
  if (code !== 0) return false
  const value = stdout.trim().toLowerCase()
  if (value === 'true') return 'true'
  if (value === 'input') return 'input'
  return false
}

/** densable `Bt` — structuredPatch; null when the per-file budget expires. */
function diffHunks(
  oldText: string,
  newText: string,
  timeoutMs: number,
): WorkspaceDiffHunk[] | null {
  const started = Date.now()
  try {
    const patch = structuredPatch('a', 'b', oldText, newText, '', '', {
      context: 3,
      maxEditLength: MAX_EDIT_LENGTH,
    })
    if (Date.now() - started > timeoutMs) return null
    if (!patch) return null
    return patch.hunks
      .map(hunk => ({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: hunk.lines.filter(line => !line.startsWith('\\')),
      }))
      .filter(hunk => hunk.lines.length > 0)
  } catch {
    return null
  }
}

/** densable `xt` — cap remaining hunk lines. */
function capHunkLines(hunks: WorkspaceDiffHunk[]): WorkspaceDiffHunk[] {
  let remaining = MAX_HUNK_LINES
  const out: WorkspaceDiffHunk[] = []
  for (const hunk of hunks) {
    if (remaining <= 0) break
    const lines = hunk.lines.slice(0, remaining)
    remaining -= lines.length
    out.push({ ...hunk, lines })
  }
  return out
}

/**
 * densable 2.1.247 `Yt(t,n,i=bt)`.
 * `host` is official `ns().host` (WeakMap key on `hi`); local fetchGitDiff
 * does not take it. Keep the argument so `/remote-control` can pass a host
 * and register `onGetWorkspaceDiff`.
 */
export async function buildWorkspaceDiffResponse(
  _host: object,
  permissionContext: ToolPermissionContext,
  budget: WorkspaceDiffComputeBudget = DEFAULT_WORKSPACE_DIFF_COMPUTE_BUDGET,
): Promise<WorkspaceDiffResponse> {
  const rootBefore = await showGitToplevel()
  if (rootBefore === null) return { diff: null }
  const stats = await fetchGitDiff('auto')
  if (stats === null) return { diff: null }
  const rootAfter = await showGitToplevel()
  if (rootAfter === null || rootAfter !== rootBefore) return { diff: null }

  const ref = hunkRefForDiff(stats)
  const wrap = (bundle: {
    hunks: WorkspaceDiffFileHunks[]
    skippedLarge: string[]
    restricted: string[]
  }): WorkspaceDiffResponse => ({
    diff: {
      stats: stats.stats,
      perFileStats: Array.from(stats.perFileStats, ([path, file]) => ({
        path,
        ...file,
      })),
      hunks: bundle.hunks,
      skippedLarge: bundle.skippedLarge,
      restricted: bundle.restricted,
      source: stats.source,
    },
  })

  const files: string[] = []
  for (const [path, file] of stats.perFileStats) {
    if (file.isUntracked || file.isBinary || !isSafeGitPath(path)) continue
    files.push(path)
  }
  if (files.length === 0) {
    return wrap({ hunks: [], skippedLarge: [], restricted: [] })
  }

  const cached = ref === '--cached'
  if (!cached && ref !== 'HEAD' && !OID_RE.test(ref)) {
    return wrap({ hunks: [], skippedLarge: [], restricted: [] })
  }

  const tree = cached
    ? await lsIndex(rootAfter, files)
    : await lsTree(rootAfter, ref, files)
  if (tree === null) {
    return wrap({ hunks: [], skippedLarge: [], restricted: [] })
  }

  let dirtyCached: Set<string> | null = null
  if (cached) {
    const numstat = await execFileNoThrowWithCwd(
      gitExe(),
      gitArgs([
        '--no-optional-locks',
        '-c',
        'diff.relative=false',
        'diff',
        '--numstat',
      ]),
      gitOpts(rootAfter),
    )
    if (numstat.code !== 0) {
      return wrap({ hunks: [], skippedLarge: [], restricted: [] })
    }
    dirtyCached = new Set(
      numstat.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => line.split('\t').slice(2).join('\t'))
        .filter(path => path.length > 0),
    )
  }

  const attrs = cached ? null : await loadCheckAttr(rootAfter, files)
  const autocrlf = cached ? false : await loadAutocrlf(rootAfter)
  const skippedLarge: string[] = []
  const restricted: string[] = []
  const hunks: WorkspaceDiffFileHunks[] = []
  let remainingBytes = AGGREGATE_HUNK_BYTES
  let remainingMs = budget.totalMs

  for (const path of files) {
    await new Promise<void>(resolve => setImmediate(resolve))
    const abs = join(rootAfter, path)
    if (!pathIsReadable(abs, permissionContext)) {
      restricted.push(path)
      continue
    }
    const entry = tree.get(path)
    if (entry && !BLOB_MODE.has(entry.mode)) continue
    if (entry && (entry.size < 0 || entry.size > MAX_FILE_BYTES)) {
      skippedLarge.push(path)
      continue
    }

    let oldText = ''
    let newText: string
    if (cached) {
      if (!entry || dirtyCached?.has(path)) continue
      if (!(await pathIsReadableResolved(abs, permissionContext))) {
        restricted.push(path)
        continue
      }
      const blob = await catBlob(rootAfter, entry.oid)
      if (blob === null) continue
      newText = blob
    } else {
      const worktree = await readWorktreeFile(abs, permissionContext)
      if (worktree.kind === 'restricted') {
        restricted.push(path)
        continue
      }
      if (worktree.kind === 'too-large') {
        skippedLarge.push(path)
        continue
      }
      if (worktree.kind === 'missing') {
        if (!entry) continue
        if (!(await pathIsReadableResolved(abs, permissionContext))) {
          restricted.push(path)
          continue
        }
      }
      if (entry) {
        const blob = await catBlob(rootAfter, entry.oid)
        if (blob === null) continue
        oldText = blob
      }
      if (worktree.kind === 'missing') newText = ''
      else {
        const normalized = applyEol(
          worktree.content,
          attrs?.get(path),
          autocrlf,
          oldText,
        )
        if (normalized === 'unsupported') continue
        newText = normalized
      }
    }

    if (remainingMs <= 0) {
      skippedLarge.push(path)
      continue
    }
    const started = Date.now()
    const computed = diffHunks(
      oldText,
      newText,
      Math.min(budget.perFileMs, remainingMs),
    )
    remainingMs -= Date.now() - started
    if (computed === null) {
      skippedLarge.push(path)
      continue
    }
    const capped = capHunkLines(computed)
    if (capped.length === 0) continue
    const bytes = capped.reduce(
      (sum, hunk) =>
        sum + hunk.lines.reduce((inner, line) => inner + line.length + 1, 0),
      0,
    )
    if (bytes > MAX_HUNK_LINE_BYTES || bytes > remainingBytes) {
      skippedLarge.push(path)
      continue
    }
    remainingBytes -= bytes
    hunks.push({ path, hunks: capped })
  }

  return wrap({ hunks, skippedLarge, restricted })
}
