import type { StructuredPatchHunk } from 'diff'
import { access, lstat, readFile } from 'fs/promises'
import { dirname, join, relative, sep } from 'path'
import { getOriginalCwd, getSessionStartTime } from '../bootstrap/state.js'
import { getCwd } from './cwd.js'
import { getCachedRepository } from './detectRepository.js'
import { execFileNoThrow, execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { isFileWithinReadSizeLimit } from './file.js'
import {
  findGitRoot,
  getBranch,
  getDefaultBranch,
  getGitDir,
  getIsGit,
  gitExe,
  RAW_GIT_DIFF_FLAGS,
} from './git.js'
import type { DiffBaseMode } from './replDiffTab.js'

export type GitDiffStats = {
  filesCount: number
  linesAdded: number
  linesRemoved: number
}

export type PerFileStats = {
  added: number
  removed: number
  isBinary: boolean
  isUntracked?: boolean
  /** densable `_zS` / `AzS` — mtime/ctime older than `GZt`. */
  preSession?: boolean
}

/** densable PPi `source` — working tree vs merge-base branch. */
export type DiffSource =
  | { kind: 'working-tree' }
  | { kind: 'branch'; baseBranch: string; baseRef: string }

export type GitDiffResult = {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
  hunks: Map<string, StructuredPatchHunk[]>
  source: DiffSource
  noCommits?: boolean
}

export type DiffFetchMode = DiffBaseMode | 'auto'

/** densable VFf / vzS / r_g — hunks plus official skippedLarge. */
export type DiffHunksBundle = {
  hunks: Map<string, StructuredPatchHunk[]>
  skippedLarge: Set<string>
}

/** densable `r_g` — empty VFf payload. */
export function emptyDiffHunks(): DiffHunksBundle {
  return { hunks: new Map(), skippedLarge: new Set() }
}

type BranchBaseResolve =
  | { kind: 'none' }
  | { kind: 'head-is-base'; baseBranch: string }
  | { kind: 'merge-base'; mergeBase: string; baseBranch: string }
  | { kind: 'error'; reason: string }

const GIT_TIMEOUT_MS = 5000
const MAX_FILES = 50
const MAX_DIFF_SIZE_BYTES = 1_000_000 // 1 MB - skip files larger than this
const MAX_LINES_PER_FILE = 400 // GitHub's auto-load limit
const MAX_FILES_FOR_DETAILS = 500 // Skip per-file details if more files than this
/** densable `yzS` — lstat cap before AzS filter. */
const UNTRACKED_LSTAT_CAP = 200

function gitOpts(abort?: AbortSignal) {
  return {
    timeout: GIT_TIMEOUT_MS,
    preserveOutputOnError: false,
    abortSignal: abort,
  }
}

/** densable `_zS` / `AzS` clock compare. */
export function isPreSessionStat(
  mtimeMs: number,
  ctimeMs: number,
  sessionStart: number,
): boolean {
  return Math.max(mtimeMs, ctimeMs) < sessionStart
}

function diffRoot(): string {
  try {
    return getCwd()
  } catch {
    return getOriginalCwd()
  }
}

/**
 * densable `_zS` — mark tracked files older than `GZt`.
 */
export async function markPreSessionFiles(
  result: Pick<GitDiffResult, 'perFileStats'>,
): Promise<void> {
  if (result.perFileStats.size === 0) return
  const root = diffRoot()
  const sessionStart = getSessionStartTime()
  await Promise.all(
    Array.from(result.perFileStats, async ([filePath, stats]) => {
      try {
        const st = await lstat(join(root, filePath))
        if (isPreSessionStat(st.mtimeMs, st.ctimeMs, sessionStart)) {
          stats.preSession = true
        }
      } catch {
        /* densable: skip */
      }
    }),
  )
}

/**
 * densable `CJn` — hunk/stat ref for a PPi result.
 */
export function hunkRefForDiff(result: GitDiffResult): string {
  if (result.noCommits) return '--cached'
  return result.source.kind === 'branch' ? result.source.baseRef : 'HEAD'
}

/**
 * densable H_s `b??(S!==null&&CJn(S.result)===_?S.hunks:r_g)`.
 * VFf null keeps prior hunks when the CJn ref is unchanged.
 */
export function nextHunksOnVFf(
  fetched: DiffHunksBundle | null,
  prev: {
    result: GitDiffResult
    hunks: DiffHunksBundle
  } | null,
  nextRef: string,
): DiffHunksBundle {
  if (fetched !== null) return fetched
  if (prev !== null && hunkRefForDiff(prev.result) === nextRef) {
    return prev.hunks
  }
  return emptyDiffHunks()
}

/**
 * densable `IPi` — shortstat probe then numstat vs `ref`.
 */
async function fetchDiffAgainstRef(
  ref: string,
  abort?: AbortSignal,
): Promise<Omit<GitDiffResult, 'source' | 'hunks'> | null> {
  const { stdout: shortstatOut, code: shortstatCode } = await execFileNoThrow(
    gitExe(),
    [
      '--no-optional-locks',
      '-c',
      'diff.relative=false',
      'diff',
      ref,
      '--shortstat',
    ],
    gitOpts(abort),
  )

  if (shortstatCode === 0) {
    const quickStats = parseShortstat(shortstatOut)
    if (quickStats && quickStats.filesCount > MAX_FILES_FOR_DETAILS) {
      return { stats: quickStats, perFileStats: new Map() }
    }
  }

  const { stdout: numstatOut, code: numstatCode } = await execFileNoThrow(
    gitExe(),
    [
      '--no-optional-locks',
      '-c',
      'diff.relative=false',
      'diff',
      ...RAW_GIT_DIFF_FLAGS,
      ref,
      '--numstat',
    ],
    gitOpts(abort),
  )

  if (numstatCode !== 0) return null
  return parseGitNumstat(numstatOut)
}

function attachUntracked(
  result: Omit<GitDiffResult, 'hunks'> & {
    hunks?: Map<string, StructuredPatchHunk[]>
  },
  untracked: Map<string, PerFileStats> | null,
): void {
  if (!untracked) return
  for (const [path, fileStats] of untracked) {
    if (result.perFileStats.has(path)) continue
    result.perFileStats.set(path, fileStats)
    result.stats.filesCount += 1
  }
}

/**
 * densable `YFf` — merge-base of HEAD vs `origin/<base>` then `<base>`.
 */
async function resolveMergeBase(
  baseBranch: string,
  abort?: AbortSignal,
): Promise<string | null> {
  const hits: string[] = []
  for (const spec of [`origin/${baseBranch}`, baseBranch]) {
    const { stdout, code } = await execFileNoThrow(
      gitExe(),
      ['--no-optional-locks', 'merge-base', 'HEAD', spec],
      gitOpts(abort),
    )
    if (code === 0 && stdout.trim()) hits.push(stdout.trim())
  }
  const [first, second] = hits
  if (!first) return null
  if (!second || first === second) return first
  const { code: ancestorCode } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'merge-base', '--is-ancestor', first, second],
    gitOpts(abort),
  )
  return ancestorCode === 0 ? second : first
}

/**
 * densable `EzS` — current branch vs default branch.
 */
export async function resolveBranchDiffBase(
  abort?: AbortSignal,
): Promise<
  | Exclude<BranchBaseResolve, { kind: 'error' }>
  | { kind: 'error'; reason: string }
> {
  const [branch, defaultBranch] = await Promise.all([
    getBranch(),
    getDefaultBranch(),
  ])
  if (!branch || branch === 'HEAD') return { kind: 'none' }
  if (defaultBranch.startsWith('-')) return { kind: 'none' }
  if (branch === defaultBranch) {
    return { kind: 'head-is-base', baseBranch: defaultBranch }
  }
  const mergeBase = await resolveMergeBase(defaultBranch, abort)
  if (!mergeBase) return { kind: 'none' }
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'rev-parse', 'HEAD'],
    gitOpts(abort),
  )
  if (code !== 0) return { kind: 'error', reason: 'head_rev_parse_failed' }
  if (stdout.trim() === mergeBase) {
    return { kind: 'head-is-base', baseBranch: defaultBranch }
  }
  return { kind: 'merge-base', mergeBase, baseBranch: defaultBranch }
}

/**
 * densable `GFf` — working tree vs index (`git diff --numstat`, no ref).
 * Official does not spread `gnr` here.
 */
async function fetchWorkingTreeNumstat(
  abort?: AbortSignal,
): Promise<NumstatResult | null> {
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', '-c', 'diff.relative=false', 'diff', '--numstat'],
    gitOpts(abort),
  )
  if (code !== 0) return null
  return parseGitNumstat(stdout)
}

/**
 * densable `bzS` — fold unstaged numstat into Sil's `--cached` rows.
 * Same-path only; binary → added 0; `removed` cleared on the file.
 */
export function foldEmptyRepoWorkingTreeStats(
  staged: Pick<GitDiffResult, 'stats' | 'perFileStats'>,
  workingTree: Pick<NumstatResult, 'perFileStats'>,
): void {
  for (const [path, wt] of workingTree.perFileStats) {
    const cached = staged.perFileStats.get(path)
    if (cached === undefined) continue
    const isBinary = cached.isBinary || wt.isBinary
    const added = isBinary
      ? 0
      : Math.max(0, cached.added + wt.added - wt.removed)
    staged.stats.linesAdded += added - cached.added
    staged.perFileStats.set(path, {
      added,
      removed: 0,
      isBinary,
      isUntracked: false,
    })
  }
}

/**
 * densable `Sil` — empty-repo / no-HEAD working tree.
 * `--cached` then `bzS` (when 0 < files ≤ kJn) then `RPi`.
 */
async function emptyRepoDiff(
  abort?: AbortSignal,
): Promise<GitDiffResult | null> {
  const { code } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'rev-parse', '--verify', '--quiet', 'HEAD'],
    gitOpts(abort),
  )
  if (code !== 1) return null
  const result: GitDiffResult = {
    stats: { filesCount: 0, linesAdded: 0, linesRemoved: 0 },
    perFileStats: new Map(),
    hunks: new Map(),
    source: { kind: 'working-tree' },
    noCommits: true,
  }
  const cached = await fetchDiffAgainstRef('--cached', abort)
  if (cached) {
    result.stats = cached.stats
    result.perFileStats = cached.perFileStats
    if (cached.stats.filesCount > MAX_FILES_FOR_DETAILS) return result
    if (cached.stats.filesCount > 0) {
      const working = await fetchWorkingTreeNumstat(abort)
      if (working) foldEmptyRepoWorkingTreeStats(result, working)
    }
  }
  if (result.stats.filesCount <= MAX_FILES_FOR_DETAILS) {
    const remaining = MAX_FILES - result.perFileStats.size
    attachUntracked(
      result,
      remaining > 0 ? await fetchUntrackedFiles(remaining, abort) : null,
    )
  }
  return result
}

/**
 * densable `WFf` — branch merge-base (or HEAD when already on the base).
 */
async function fetchBranchDiff(
  abort: AbortSignal | undefined,
  required: boolean,
  untracked?: Map<string, PerFileStats> | null,
): Promise<GitDiffResult | null> {
  const resolved = await resolveBranchDiffBase(abort)
  if (resolved.kind === 'error') {
    return required ? emptyRepoDiff(abort) : null
  }
  let against: Omit<GitDiffResult, 'source' | 'hunks'> | null
  let source: DiffSource
  if (resolved.kind !== 'merge-base') {
    if (!required) return null
    against = await fetchDiffAgainstRef('HEAD', abort)
    source =
      resolved.kind === 'head-is-base'
        ? { kind: 'branch', baseBranch: resolved.baseBranch, baseRef: 'HEAD' }
        : { kind: 'working-tree' }
  } else {
    against = await fetchDiffAgainstRef(resolved.mergeBase, abort)
    source = {
      kind: 'branch',
      baseBranch: resolved.baseBranch,
      baseRef: resolved.mergeBase,
    }
  }
  if (against === null) {
    return resolved.kind === 'merge-base' ? null : emptyRepoDiff(abort)
  }
  const result: GitDiffResult = {
    ...against,
    hunks: new Map(),
    source,
  }
  if (result.stats.filesCount <= MAX_FILES_FOR_DETAILS) {
    const remaining = MAX_FILES - result.perFileStats.size
    attachUntracked(
      result,
      untracked !== undefined
        ? untracked
        : remaining > 0
          ? await fetchUntrackedFiles(remaining, abort)
          : null,
    )
  }
  return result
}

/**
 * densable `PPi` — session / uncommitted / branch / auto.
 * Session runs `_zS` + `RPi(..., includePreSession)` in parallel.
 */
export async function fetchGitDiff(
  mode: DiffFetchMode = 'uncommitted',
  abort?: AbortSignal,
): Promise<GitDiffResult | null> {
  const isGit = await getIsGit()
  if (!isGit) return null

  if (await isInTransientGitState()) {
    return null
  }

  if (mode === 'branch') {
    return fetchBranchDiff(abort, true)
  }

  const head = await fetchDiffAgainstRef('HEAD', abort)
  if (head === null) return emptyRepoDiff(abort)

  if (head.stats.filesCount > MAX_FILES_FOR_DETAILS) {
    return { ...head, hunks: new Map(), source: { kind: 'working-tree' } }
  }

  if (mode === 'session') {
    const working: GitDiffResult = {
      ...head,
      hunks: new Map(),
      source: { kind: 'working-tree' },
    }
    const remaining = MAX_FILES - working.perFileStats.size
    await Promise.all([
      markPreSessionFiles(working),
      remaining > 0
        ? fetchUntrackedFiles(remaining, abort, true).then(u =>
            attachUntracked(working, u),
          )
        : Promise.resolve(),
    ])
    return working
  }

  const remaining = MAX_FILES - head.perFileStats.size
  const untracked =
    remaining > 0 ? await fetchUntrackedFiles(remaining, abort, false) : null
  const working: GitDiffResult = {
    ...head,
    hunks: new Map(),
    source: { kind: 'working-tree' },
  }
  attachUntracked(working, untracked)

  if (mode === 'uncommitted' || working.stats.filesCount > 0) {
    return working
  }

  const branch = await fetchBranchDiff(abort, false, untracked)
  if (branch === null || branch.stats.filesCount === 0) return working
  return branch
}

/**
 * densable `VFf` / `CJn` — ref is HEAD, merge-base, or `--cached`.
 * null on fail so H_s can keep prior hunks. `> kJn` shortstat → empty r_g.
 */
export async function fetchGitDiffHunks(
  ref = 'HEAD',
  abort?: AbortSignal,
): Promise<DiffHunksBundle | null> {
  const isGit = await getIsGit()
  if (!isGit) return null

  if (await isInTransientGitState()) {
    return null
  }

  const { stdout: shortstatOut, code: shortstatCode } = await execFileNoThrow(
    gitExe(),
    [
      '--no-optional-locks',
      '-c',
      'diff.relative=false',
      'diff',
      ref,
      '--shortstat',
    ],
    gitOpts(abort),
  )
  if (shortstatCode === 0) {
    const quick = parseShortstat(shortstatOut)
    if (quick && quick.filesCount > MAX_FILES_FOR_DETAILS) {
      return emptyDiffHunks()
    }
  }

  const { stdout: diffOut, code: diffCode } = await execFileNoThrow(
    gitExe(),
    [
      '--no-optional-locks',
      '-c',
      'diff.relative=false',
      'diff',
      ...RAW_GIT_DIFF_FLAGS,
      ref,
    ],
    gitOpts(abort),
  )

  if (diffCode !== 0) {
    return null
  }

  const parsed = parseGitDiff(diffOut)
  if (ref === '--cached' && parsed.hunks.size > 0) {
    const working = await fetchWorkingTreeNumstat(abort)
    if (working === null) return null
    for (const path of working.perFileStats.keys()) {
      parsed.hunks.delete(path)
    }
  }
  return parsed
}

export type NumstatResult = {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
}

/**
 * Parse git diff --numstat output into stats.
 * Format: <added>\t<removed>\t<filename>
 * Binary files show '-' for counts.
 * Only stores first MAX_FILES entries in perFileStats.
 */
export function parseGitNumstat(stdout: string): NumstatResult {
  const lines = stdout.trim().split('\n').filter(Boolean)
  let added = 0
  let removed = 0
  let validFileCount = 0
  const perFileStats = new Map<string, PerFileStats>()

  for (const line of lines) {
    const parts = line.split('\t')
    // Valid numstat lines have exactly 3 tab-separated parts: added, removed, filename
    if (parts.length < 3) continue

    validFileCount++
    const addStr = parts[0]
    const remStr = parts[1]
    const filePath = parts.slice(2).join('\t') // filename may contain tabs
    const isBinary = addStr === '-' || remStr === '-'
    const fileAdded = isBinary ? 0 : parseInt(addStr ?? '0', 10) || 0
    const fileRemoved = isBinary ? 0 : parseInt(remStr ?? '0', 10) || 0

    added += fileAdded
    removed += fileRemoved

    // Only store first MAX_FILES entries
    if (perFileStats.size < MAX_FILES) {
      perFileStats.set(filePath, {
        added: fileAdded,
        removed: fileRemoved,
        isBinary,
      })
    }
  }

  return {
    stats: {
      filesCount: validFileCount,
      linesAdded: added,
      linesRemoved: removed,
    },
    perFileStats,
  }
}

/**
 * densable `vzS` — unified diff → hunks + skippedLarge.
 * Cap is hunks+skippedLarge >= Eil. Oversized file is named in skippedLarge.
 */
export function parseGitDiff(stdout: string): DiffHunksBundle {
  const hunks = new Map<string, StructuredPatchHunk[]>()
  const skippedLarge = new Set<string>()
  if (!stdout.trim()) return { hunks, skippedLarge }

  const fileDiffs = stdout.split(/^diff --git /m).filter(Boolean)

  for (const fileDiff of fileDiffs) {
    if (hunks.size + skippedLarge.size >= MAX_FILES) break

    const newline = fileDiff.indexOf('\n')
    const header = newline === -1 ? fileDiff : fileDiff.slice(0, newline)
    const headerMatch = header.match(/^a\/(.+?) b\/(.+)$/)
    if (!headerMatch) continue
    const filePath = headerMatch[2] ?? headerMatch[1] ?? ''

    if (fileDiff.length > MAX_DIFF_SIZE_BYTES) {
      skippedLarge.add(filePath)
      continue
    }

    const lines = fileDiff.split('\n')

    // Find and parse hunks
    const fileHunks: StructuredPatchHunk[] = []
    let currentHunk: StructuredPatchHunk | null = null
    let lineCount = 0

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? ''

      // StructuredPatchHunk header: @@ -oldStart,oldLines +newStart,newLines @@
      const hunkMatch = line.match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
      )
      if (hunkMatch) {
        if (currentHunk) {
          fileHunks.push(currentHunk)
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1] ?? '0', 10),
          oldLines: parseInt(hunkMatch[2] ?? '1', 10),
          newStart: parseInt(hunkMatch[3] ?? '0', 10),
          newLines: parseInt(hunkMatch[4] ?? '1', 10),
          lines: [],
        }
        continue
      }

      // Skip binary file markers and other metadata
      if (
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('Binary files')
      ) {
        continue
      }

      // Add diff lines to current hunk (with line limit)
      if (
        currentHunk &&
        (line.startsWith('+') ||
          line.startsWith('-') ||
          line.startsWith(' ') ||
          line === '')
      ) {
        // Stop adding lines once we hit the limit
        if (lineCount >= MAX_LINES_PER_FILE) {
          continue
        }
        // Force a flat string copy to break V8 sliced string references.
        // When split() creates lines, V8 creates "sliced strings" that reference
        // the parent. This keeps the entire parent string (~MBs) alive as long as
        // any line is retained. Using '' + line forces a new flat string allocation,
        // unlike slice(0) which V8 may optimize to return the same reference.
        currentHunk.lines.push('' + line)
        lineCount++
      }
    }

    // Don't forget the last hunk
    if (currentHunk) {
      fileHunks.push(currentHunk)
    }

    if (fileHunks.length > 0) {
      hunks.set(filePath, fileHunks)
    }
  }

  return { hunks, skippedLarge }
}

/**
 * Check if we're in a transient git state (merge, rebase, cherry-pick, or revert).
 * During these operations, we skip diff calculation since the working
 * tree contains incoming changes that weren't intentionally made.
 *
 * Uses fs.access to check for transient ref files, avoiding process spawns.
 */
async function isInTransientGitState(): Promise<boolean> {
  const gitDir = await getGitDir(getCwd())
  if (!gitDir) return false

  const transientFiles = [
    'MERGE_HEAD',
    'REBASE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
  ]

  const results = await Promise.all(
    transientFiles.map(file =>
      access(join(gitDir, file))
        .then(() => true)
        .catch(() => false),
    ),
  )
  return results.some(Boolean)
}

/**
 * Fetch untracked file names (no content reading).
 * Returns file paths only - they'll be displayed with a note to stage them.
 *
 * @param maxFiles Maximum number of untracked files to include
 * @param includePreSession densable AzS `r` — session mode keeps pre-session files
 */
async function fetchUntrackedFiles(
  maxFiles: number,
  abort?: AbortSignal,
  includePreSession = false,
): Promise<Map<string, PerFileStats> | null> {
  // Get list of untracked files (excludes gitignored)
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    [
      '--no-optional-locks',
      'ls-files',
      '--others',
      '--exclude-standard',
      '--full-name',
    ],
    gitOpts(abort),
  )

  if (code !== 0 || !stdout.trim()) return null

  const untrackedPaths = stdout.trim().split('\n').filter(Boolean)
  if (untrackedPaths.length === 0) return null

  const root = diffRoot()
  const sessionStart = getSessionStartTime()
  const probed = await Promise.all(
    untrackedPaths.slice(0, UNTRACKED_LSTAT_CAP).map(async filePath => {
      try {
        const st = await lstat(join(root, filePath))
        return {
          filePath,
          preSession: isPreSessionStat(st.mtimeMs, st.ctimeMs, sessionStart),
        }
      } catch {
        return { filePath, preSession: false }
      }
    }),
  )
  const kept = probed.filter(row => !row.preSession)
  if (includePreSession) {
    kept.push(...probed.filter(row => row.preSession))
  }
  if (kept.length === 0) return null

  const perFileStats = new Map<string, PerFileStats>()
  for (const { filePath, preSession } of kept.slice(0, maxFiles)) {
    perFileStats.set(filePath, {
      added: 0,
      removed: 0,
      isBinary: false,
      isUntracked: true,
      ...(preSession ? { preSession: true } : {}),
    })
  }

  return perFileStats
}

/**
 * Parse git diff --shortstat output into stats.
 * Format: " 1648 files changed, 52341 insertions(+), 8123 deletions(-)"
 *
 * This is O(1) memory regardless of diff size - git computes totals without
 * loading all content. Used as a quick probe before expensive operations.
 */
export function parseShortstat(stdout: string): GitDiffStats | null {
  // Match: "N files changed" with optional ", N insertions(+)" and ", N deletions(-)"
  const match = stdout.match(
    /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
  )
  if (!match) return null
  return {
    filesCount: parseInt(match[1] ?? '0', 10),
    linesAdded: parseInt(match[2] ?? '0', 10),
    linesRemoved: parseInt(match[3] ?? '0', 10),
  }
}

const SINGLE_FILE_DIFF_TIMEOUT_MS = 3000

export type ToolUseDiff = {
  filename: string
  status: 'modified' | 'added'
  additions: number
  deletions: number
  changes: number
  patch: string
  /** GitHub "owner/repo" when available (null for non-github.com or unknown repos) */
  repository: string | null
}

/**
 * Fetch a structured diff for a single file against the merge base with the
 * default branch. This produces a PR-like diff showing all changes since
 * the branch diverged. Falls back to diffing against HEAD if the merge base
 * cannot be determined (e.g., on the default branch itself).
 * For untracked files, generates a synthetic diff showing all additions.
 * Returns null if not in a git repo or if git commands fail.
 */
export async function fetchSingleFileGitDiff(
  absoluteFilePath: string,
): Promise<ToolUseDiff | null> {
  const gitRoot = findGitRoot(dirname(absoluteFilePath))
  if (!gitRoot) return null

  const gitPath = relative(gitRoot, absoluteFilePath).split(sep).join('/')
  const repository = getCachedRepository()

  // Check if the file is tracked by git
  const { code: lsFilesCode } = await execFileNoThrowWithCwd(
    gitExe(),
    ['--no-optional-locks', 'ls-files', '--error-unmatch', gitPath],
    { cwd: gitRoot, timeout: SINGLE_FILE_DIFF_TIMEOUT_MS },
  )

  if (lsFilesCode === 0) {
    // File is tracked - diff against merge base for PR-like view
    // densable jRo: ["--no-optional-locks","diff",...gnr,s,"--",r]
    const diffRef = await getDiffRef(gitRoot)
    const { stdout, code } = await execFileNoThrowWithCwd(
      gitExe(),
      [
        '--no-optional-locks',
        'diff',
        ...RAW_GIT_DIFF_FLAGS,
        diffRef,
        '--',
        gitPath,
      ],
      { cwd: gitRoot, timeout: SINGLE_FILE_DIFF_TIMEOUT_MS },
    )
    if (code !== 0) return null
    if (!stdout) return null
    return {
      ...parseRawDiffToToolUseDiff(gitPath, stdout, 'modified'),
      repository,
    }
  }

  // File is untracked - generate synthetic diff
  const syntheticDiff = await generateSyntheticDiff(gitPath, absoluteFilePath)
  if (!syntheticDiff) return null
  return { ...syntheticDiff, repository }
}

/**
 * Parse raw unified diff output into the structured ToolUseDiff format.
 * Extracts only the hunk content (starting from @@) as the patch,
 * and counts additions/deletions.
 */
function parseRawDiffToToolUseDiff(
  filename: string,
  rawDiff: string,
  status: 'modified' | 'added',
): Omit<ToolUseDiff, 'repository'> {
  const lines = rawDiff.split('\n')
  const patchLines: string[] = []
  let inHunks = false
  let additions = 0
  let deletions = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunks = true
    }
    if (inHunks) {
      patchLines.push(line)
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      }
    }
  }

  return {
    filename,
    status,
    additions,
    deletions,
    changes: additions + deletions,
    patch: patchLines.join('\n'),
  }
}

/**
 * Determine the best ref to diff against for a PR-like diff.
 * Priority:
 * 1. CLAUDE_CODE_BASE_REF env var (set externally, e.g. by CCR managed containers)
 * 2. Merge base with the default branch (best guess)
 * 3. HEAD (fallback if merge-base fails)
 */
async function getDiffRef(gitRoot: string): Promise<string> {
  const baseBranch =
    process.env.CLAUDE_CODE_BASE_REF || (await getDefaultBranch())
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    ['--no-optional-locks', 'merge-base', 'HEAD', baseBranch],
    { cwd: gitRoot, timeout: SINGLE_FILE_DIFF_TIMEOUT_MS },
  )
  if (code === 0 && stdout.trim()) {
    return stdout.trim()
  }
  return 'HEAD'
}

async function generateSyntheticDiff(
  gitPath: string,
  absoluteFilePath: string,
): Promise<Omit<ToolUseDiff, 'repository'> | null> {
  try {
    if (
      !(await isFileWithinReadSizeLimit(absoluteFilePath, MAX_DIFF_SIZE_BYTES))
    ) {
      return null
    }
    const content = await readFile(absoluteFilePath, 'utf-8')
    const lines = content.split('\n')
    // Remove trailing empty line from split if file ends with newline
    if (lines.length > 0 && lines.at(-1) === '') {
      lines.pop()
    }
    const lineCount = lines.length
    const addedLines = lines.map(line => `+${line}`).join('\n')
    const patch = `@@ -0,0 +1,${lineCount} @@\n${addedLines}`
    return {
      filename: gitPath,
      status: 'added',
      additions: lineCount,
      deletions: 0,
      changes: lineCount,
      patch,
    }
  } catch {
    return null
  }
}
