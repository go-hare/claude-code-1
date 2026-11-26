import { statSync } from 'fs'
import ignore from 'ignore'
import * as path from 'path'
import {
  CLAUDE_CONFIG_DIRECTORIES,
  loadMarkdownFilesForSubdir,
} from 'src/utils/markdownConfigLoader.js'
import type { SuggestionItem } from '../components/PromptInput/PromptInputFooterSuggestions.js'
import {
  CHUNK_MS,
  FileIndex,
  yieldToEventLoop,
} from '../native-ts/file-index/index.js'
import { logEvent } from '../services/analytics/index.js'
import type { FileSuggestionCommandInput } from '../types/fileSuggestion.js'
import { getGlobalConfig } from '../utils/config.js'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { execFileNoThrowWithCwd } from '../utils/execFileNoThrow.js'
import { shouldSkipStartupFileIndexing } from '../utils/fileIndexing.js'
import { getFsImplementation } from '../utils/fsOperations.js'
import { findGitRoot, gitExe } from '../utils/git.js'
import {
  createBaseHookInput,
  executeFileSuggestionCommand,
} from '../utils/hooks.js'
import { logError } from '../utils/log.js'
import { expandPath } from '../utils/path.js'
import { ripGrep } from '../utils/ripgrep.js'
import {
  filterCompilableIgnorePatterns,
  splitIgnoreFileLines,
} from '../utils/ignorePatterns.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  RootSessionSlot,
  runWithSession,
  type Session,
} from '../utils/sessionRoot.js'
import { createSignal, type Signal } from '../utils/signal.js'

type FileSuggestionsSessionState = {
  // Lazily constructed per-session FileIndex
  fileIndex: FileIndex | null
  fileListRefreshPromise: Promise<FileIndex> | null
  // Signal fired when an in-progress index build completes. Lets the
  // typeahead UI re-run its last search so partial results upgrade to full.
  indexBuildComplete: Signal
  cacheGeneration: number
  // Background fetch for untracked files
  untrackedFetchPromise: Promise<void> | null
  // Store tracked files so we can rebuild index with untracked
  cachedTrackedFiles: string[]
  // Store config files so mergeUntrackedIntoNormalizedCache preserves them
  cachedConfigFiles: string[]
  // Store tracked directories so mergeUntrackedIntoNormalizedCache doesn't
  // recompute ~270k path.dirname() calls on each merge
  cachedTrackedDirs: string[]
  // Cache for .ignore/.rgignore patterns (keyed by repoRoot:cwd)
  ignorePatternsCache: ReturnType<typeof ignore> | null
  ignorePatternsCacheKey: string | null
  ignoreReincludeGlobs: string[]
  lastReincludedFiles: string[]
  reincludeRetryAtMs: number
  // Throttle state for background refresh. .git/index mtime triggers an
  // immediate refresh when tracked files change (add/checkout/commit/rm).
  // The time floor still refreshes every 5s to pick up untracked files,
  // which don't bump the index.
  lastRefreshMs: number
  lastGitIndexMtime: number | null
  // Signatures of the path lists loaded into the Rust index. Two separate
  // signatures because the two loadFromFileList call sites use differently
  // structured arrays — a shared signature would ping-pong and never match.
  // Skips nucleo.restart() when git ls-files returns an unchanged list
  // (e.g. `git add` of an already-tracked file bumps index mtime but not the list).
  loadedTrackedSignature: string | null
  loadedMergedSignature: string | null
}

const fileSuggestionsStateBySession =
  new RootSessionSlot<FileSuggestionsSessionState>(() => ({
    fileIndex: null,
    fileListRefreshPromise: null,
    indexBuildComplete: createSignal(),
    cacheGeneration: 0,
    untrackedFetchPromise: null,
    cachedTrackedFiles: [],
    cachedConfigFiles: [],
    cachedTrackedDirs: [],
    ignorePatternsCache: null,
    ignorePatternsCacheKey: null,
    ignoreReincludeGlobs: [],
    lastReincludedFiles: [],
    reincludeRetryAtMs: 0,
    lastRefreshMs: 0,
    lastGitIndexMtime: null,
    loadedTrackedSignature: null,
    loadedMergedSignature: null,
  }))

function getFileSuggestionsState(): FileSuggestionsSessionState {
  return fileSuggestionsStateBySession.of(getBootstrapSession())
}

function runInCapturedSession<T>(
  captured: Session | undefined,
  fn: () => T,
): T {
  if (captured !== undefined && getActiveSessionFromAls() !== captured) {
    return runWithSession(captured, fn)
  }
  return fn()
}

function getFileIndex(
  state: FileSuggestionsSessionState = getFileSuggestionsState(),
): FileIndex {
  if (!state.fileIndex) {
    state.fileIndex = new FileIndex()
  }
  return state.fileIndex
}

export function onIndexBuildComplete(listener: () => void): () => void {
  const state = getFileSuggestionsState()
  const captured = getActiveSessionFromAls()
  const wrapped =
    captured !== undefined
      ? () => {
          runInCapturedSession(captured, listener)
        }
      : listener
  return state.indexBuildComplete.subscribe(wrapped)
}

const REINCLUDE_RETRY_BACKOFF_MS = 60_000
const VCS_EXCLUDE_GLOBS = [
  '--glob',
  '!.git/',
  '--glob',
  '!.svn/',
  '--glob',
  '!.hg/',
  '--glob',
  '!.bzr/',
  '--glob',
  '!.jj/',
  '--glob',
  '!.sl/',
]

/**
 * Clear all file suggestion caches.
 * Call this when resuming a session to ensure fresh file discovery.
 */
export function clearFileSuggestionCaches(): void {
  const state = getFileSuggestionsState()
  state.fileIndex = null
  state.fileListRefreshPromise = null
  state.cacheGeneration++
  state.untrackedFetchPromise = null
  state.cachedTrackedFiles = []
  state.cachedConfigFiles = []
  state.cachedTrackedDirs = []
  state.indexBuildComplete.clear()
  state.ignorePatternsCache = null
  state.ignorePatternsCacheKey = null
  state.ignoreReincludeGlobs = []
  state.lastReincludedFiles = []
  state.reincludeRetryAtMs = 0
  state.lastRefreshMs = 0
  state.lastGitIndexMtime = null
  state.loadedTrackedSignature = null
  state.loadedMergedSignature = null
}

/**
 * Content hash of a path list. A length|first|last sample misses renames of
 * middle files (same length, same endpoints → stale entry stuck in nucleo).
 *
 * Samples every Nth path (plus length). On a 346k-path list this hashes ~700
 * paths instead of 14MB — enough to catch git operations (checkout, rebase,
 * add/rm) while running in <1ms. A single mid-list rename that happens to
 * fall between samples will miss the rebuild, but the 5s refresh floor picks
 * it up on the next cycle.
 */
export function pathListSignature(paths: string[]): string {
  const n = paths.length
  const stride = Math.max(1, Math.floor(n / 500))
  let h = 0x811c9dc5 | 0
  for (let i = 0; i < n; i += stride) {
    const p = paths[i]!
    for (let j = 0; j < p.length; j++) {
      h = ((h ^ p.charCodeAt(j)) * 0x01000193) | 0
    }
    h = (h * 0x01000193) | 0
  }
  // Stride starts at 0 (first path always hashed); explicitly include last
  // so single-file add/rm at the tail is caught
  if (n > 0) {
    const last = paths[n - 1]!
    for (let j = 0; j < last.length; j++) {
      h = ((h ^ last.charCodeAt(j)) * 0x01000193) | 0
    }
  }
  return `${n}:${(h >>> 0).toString(16)}`
}

/**
 * Stat .git/index to detect git state changes without spawning git ls-files.
 * Returns null for worktrees (.git is a file → ENOTDIR), fresh repos with no
 * index yet (ENOENT), and non-git dirs — caller falls back to time throttle.
 */
function getGitIndexMtime(): number | null {
  const repoRoot = findGitRoot(getCwd())
  if (!repoRoot) return null
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- mtimeMs is the operation here, not a pre-check. findGitRoot above already stat-walks synchronously; one more stat is marginal vs spawning git ls-files on every keystroke. Async would force startBackgroundCacheRefresh to become async, breaking the synchronous fileListRefreshPromise contract at the cold-start await site.
    return statSync(path.join(repoRoot, '.git', 'index')).mtimeMs
  } catch {
    return null
  }
}

/**
 * Normalize git paths relative to originalCwd
 */
function normalizeGitPaths(
  files: string[],
  repoRoot: string,
  originalCwd: string,
): string[] {
  if (originalCwd === repoRoot) {
    return files
  }
  return files.map(f => {
    const absolutePath = path.join(repoRoot, f)
    return path.relative(originalCwd, absolutePath)
  })
}

/**
 * Merge already-normalized untracked files into the cache
 */
async function mergeUntrackedIntoNormalizedCache(
  state: FileSuggestionsSessionState,
  normalizedUntracked: string[],
): Promise<void> {
  if (normalizedUntracked.length === 0) return
  if (!state.fileIndex || state.cachedTrackedFiles.length === 0) return

  const untrackedDirs = await getDirectoryNamesAsync(normalizedUntracked)
  const allPaths = [
    ...state.cachedTrackedFiles,
    ...state.cachedConfigFiles,
    ...state.cachedTrackedDirs,
    ...normalizedUntracked,
    ...untrackedDirs,
  ]
  const sig = pathListSignature(allPaths)
  if (sig === state.loadedMergedSignature) {
    logForDebugging(
      `[FileIndex] skipped index rebuild — merged paths unchanged`,
    )
    return
  }
  await state.fileIndex.loadFromFileListAsync(allPaths).done
  state.loadedMergedSignature = sig
  logForDebugging(
    `[FileIndex] rebuilt index with ${state.cachedTrackedFiles.length} tracked + ${normalizedUntracked.length} untracked files`,
  )
}

function isUnanchoredBasenamePattern(pattern: string): boolean {
  return !pattern.startsWith('/') && !pattern.replace(/\/+$/, '').includes('/')
}

function escapeIgnoreDirPrefix(dir: string): string {
  return dir.replace(/[[\]{}*?\\]/g, '\\$&').replace(/^[!#]/, '\\$&')
}

function anchorIgnorePatternToDir(pattern: string, escapedDir: string): string {
  if (escapedDir === '') return pattern
  if (pattern.startsWith('/')) return `${escapedDir}${pattern}`
  return isUnanchoredBasenamePattern(pattern)
    ? `${escapedDir}/**/${pattern}`
    : `${escapedDir}/${pattern}`
}

/**
 * Gold `W(e, i)` (#1233): extract `.ignore`/`.rgignore` negation (`!pattern`)
 * re-inclusion globs so git-ignored files explicitly un-ignored by `.ignore`
 * or `.rgignore` are re-included in `@` file suggestions.
 */
export function extractIgnoreReincludeRules(
  patterns: string[],
  relDir: string,
): { hasNegation: boolean; augmentations: string[]; rules: string[] } {
  const augmentations: string[] = []
  const rules: string[] = []
  let hasNegation = false
  const escapedDir = escapeIgnoreDirPrefix(relDir)
  for (const line of patterns) {
    const trimmed = line.endsWith('\\ ') ? line : line.trimEnd()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const isNegated = trimmed.startsWith('!')
    const pattern = isNegated ? trimmed.slice(1) : trimmed
    if (pattern === '') continue
    const anchored = anchorIgnorePatternToDir(pattern, escapedDir)
    if (isNegated) {
      hasNegation = true
      rules.push(anchored)
      if (!anchored.endsWith('**')) {
        const noTrailingSlash = anchored.replace(/\/+$/, '')
        augmentations.push(
          isUnanchoredBasenamePattern(noTrailingSlash)
            ? `**/${noTrailingSlash}/**`
            : `${noTrailingSlash}/**`,
        )
      }
    } else {
      rules.push(`!${anchored}`)
    }
  }
  return { hasNegation, augmentations, rules }
}

/**
 * Load ripgrep-specific ignore patterns from .ignore or .rgignore files
 * Returns an ignore instance if patterns were found, null otherwise
 * Results are cached per repoRoot:cwd combination
 */
async function loadRipgrepIgnorePatterns(
  state: FileSuggestionsSessionState,
  repoRoot: string,
  cwd: string,
): Promise<ReturnType<typeof ignore> | null> {
  const cacheKey = `${repoRoot}:${cwd}`

  // Return cached result if available
  if (state.ignorePatternsCacheKey === cacheKey) {
    return state.ignorePatternsCache
  }

  const fs = getFsImplementation()
  const ignoreFiles = ['.ignore', '.rgignore']
  const directories = [...new Set([repoRoot, cwd])]

  const ig = ignore()
  let hasPatterns = false
  let hasNegation = false
  const augmentations: string[] = []
  const rules: string[] = []

  const paths = directories.flatMap(dir =>
    ignoreFiles.map(f => path.join(dir, f)),
  )
  const contents = await Promise.all(
    paths.map(p => fs.readFile(p, { encoding: 'utf8' }).catch(() => null)),
  )
  for (const [i, content] of contents.entries()) {
    if (content === null) continue
    // Official 2.1.207: drop uncompilable lines (bad bracket globs) with warn.
    const patterns = filterCompilableIgnorePatterns(
      splitIgnoreFileLines(content),
      'file_suggestions_ignore',
    )
    if (patterns.length === 0) continue
    ig.add(patterns)
    hasPatterns = true
    const filePath = paths[i]!
    const relDir = path
      .relative(repoRoot, path.dirname(filePath))
      .replaceAll(path.sep, '/')
    const extracted = extractIgnoreReincludeRules(patterns, relDir)
    hasNegation = hasNegation || extracted.hasNegation
    augmentations.push(...extracted.augmentations)
    rules.push(...extracted.rules)
    logForDebugging(`[FileIndex] loaded ignore patterns from ${filePath}`)
  }

  const result = hasPatterns ? ig : null
  state.ignorePatternsCache = result
  state.ignorePatternsCacheKey = cacheKey
  state.ignoreReincludeGlobs = hasNegation ? [...augmentations, ...rules] : []

  return result
}

/**
 * Get files using git ls-files (much faster than ripgrep for git repos)
 * Returns tracked files immediately, fetches untracked in background
 * @param respectGitignore If true, excludes gitignored files from untracked results
 *
 * Note: Unlike ripgrep --follow, git ls-files doesn't follow symlinks.
 * This is intentional as git tracks symlinks as symlinks.
 */
async function getFilesUsingGit(
  state: FileSuggestionsSessionState,
  abortSignal: AbortSignal,
  respectGitignore: boolean,
): Promise<string[] | null> {
  const startTime = Date.now()
  logForDebugging(`[FileIndex] getFilesUsingGit called`)

  // Check if we're in a git repo. findGitRoot is LRU-memoized per path.
  const cwd = getCwd()
  const repoRoot = findGitRoot(cwd)
  if (!repoRoot) {
    logForDebugging(`[FileIndex] not a git repo, returning null`)
    return null
  }

  try {
    // Get tracked files (fast - reads from git index)
    // Run from repoRoot so paths are relative to repo root, not CWD
    const lsFilesStart = Date.now()
    const trackedResult = await execFileNoThrowWithCwd(
      gitExe(),
      ['-c', 'core.quotepath=false', 'ls-files', '--recurse-submodules'],
      { timeout: 5000, abortSignal, cwd: repoRoot },
    )
    logForDebugging(
      `[FileIndex] git ls-files (tracked) took ${Date.now() - lsFilesStart}ms`,
    )

    if (trackedResult.code !== 0) {
      logForDebugging(
        `[FileIndex] git ls-files failed (code=${trackedResult.code}, stderr=${trackedResult.stderr}), falling back to ripgrep`,
      )
      return null
    }

    const trackedFiles = trackedResult.stdout.trim().split('\n').filter(Boolean)

    // Normalize paths relative to the current working directory
    let normalizedTracked = normalizeGitPaths(trackedFiles, repoRoot, cwd)

    // Apply .ignore/.rgignore patterns if present (faster than falling back to ripgrep)
    const ignorePatterns = await loadRipgrepIgnorePatterns(state, repoRoot, cwd)
    if (ignorePatterns) {
      const beforeCount = normalizedTracked.length
      normalizedTracked = ignorePatterns.filter(normalizedTracked)
      logForDebugging(
        `[FileIndex] applied ignore patterns: ${beforeCount} -> ${normalizedTracked.length} files`,
      )
    }

    // Cache tracked files for later merge with untracked
    state.cachedTrackedFiles = normalizedTracked

    const duration = Date.now() - startTime
    logForDebugging(
      `[FileIndex] git ls-files: ${normalizedTracked.length} tracked files in ${duration}ms`,
    )

    logEvent('tengu_file_suggestions_git_ls_files', {
      file_count: normalizedTracked.length,
      tracked_count: normalizedTracked.length,
      untracked_count: 0,
      duration_ms: duration,
    })

    // Start background fetch for untracked files (don't await)
    if (!state.untrackedFetchPromise) {
      const untrackedArgs = respectGitignore
        ? [
            '-c',
            'core.quotepath=false',
            'ls-files',
            '--others',
            '--exclude-standard',
          ]
        : ['-c', 'core.quotepath=false', 'ls-files', '--others']

      const generation = state.cacheGeneration
      const captured = getActiveSessionFromAls()
      const untrackedPromise = runInCapturedSession(captured, () =>
        (async () => {
          const ignorePatterns = await loadRipgrepIgnorePatterns(
            state,
            repoRoot,
            cwd,
          )
          const shouldReinclude =
            respectGitignore && state.ignoreReincludeGlobs.length > 0
          const reincludedPromise =
            shouldReinclude && Date.now() >= state.reincludeRetryAtMs
              ? ripGrep(
                  [
                    '--files',
                    '--hidden',
                    ...state.ignoreReincludeGlobs.flatMap(g => ['--glob', g]),
                    ...VCS_EXCLUDE_GLOBS,
                  ],
                  '.',
                  AbortSignal.timeout(10_000),
                  { cwd: repoRoot },
                )
                  .then(files => {
                    if (generation === state.cacheGeneration) {
                      state.lastReincludedFiles = files
                    }
                    return files
                  })
                  .catch(err => {
                    logForDebugging(
                      `[FileIndex] .ignore re-include listing failed: ${errorMessage(err)}`,
                    )
                    if (generation === state.cacheGeneration) {
                      state.reincludeRetryAtMs =
                        Date.now() + REINCLUDE_RETRY_BACKOFF_MS
                    }
                    return state.lastReincludedFiles
                  })
              : Promise.resolve(
                  shouldReinclude ? state.lastReincludedFiles : [],
                )

          const [untrackedResult, reincludedFiles] = await Promise.all([
            execFileNoThrowWithCwd(gitExe(), untrackedArgs, {
              timeout: 10000,
              cwd: repoRoot,
            }),
            reincludedPromise,
          ])
          if (generation !== state.cacheGeneration) {
            return // Cache was cleared; don't merge stale untracked files
          }
          if (untrackedResult.code === 0) {
            const rawUntrackedFiles = untrackedResult.stdout
              .trim()
              .split('\n')
              .filter(Boolean)
            for (const f of reincludedFiles
              .map(p => path.normalize(p).replaceAll(path.sep, '/'))
              .sort()) {
              rawUntrackedFiles.push(f)
            }

            // Normalize paths BEFORE applying ignore patterns (consistent with tracked files)
            let normalizedUntracked = normalizeGitPaths(
              rawUntrackedFiles,
              repoRoot,
              cwd,
            )

            // Apply .ignore/.rgignore patterns to normalized untracked files
            if (ignorePatterns && normalizedUntracked.length > 0) {
              const beforeCount = normalizedUntracked.length
              normalizedUntracked = ignorePatterns.filter(normalizedUntracked)
              logForDebugging(
                `[FileIndex] applied ignore patterns to untracked: ${beforeCount} -> ${normalizedUntracked.length} files`,
              )
            }

            logForDebugging(
              `[FileIndex] background untracked fetch: ${normalizedUntracked.length} files (${reincludedFiles.length} re-included by .ignore)`,
            )
            // Pass already-normalized files directly to merge function
            void mergeUntrackedIntoNormalizedCache(state, normalizedUntracked)
          }
        })(),
      )
        .catch(error => {
          logForDebugging(
            `[FileIndex] background untracked fetch failed: ${error}`,
          )
        })
        .finally(() => {
          if (state.untrackedFetchPromise === untrackedPromise) {
            state.untrackedFetchPromise = null
          }
        })
      state.untrackedFetchPromise = untrackedPromise
    }

    return normalizedTracked
  } catch (error) {
    logForDebugging(`[FileIndex] git ls-files error: ${errorMessage(error)}`)
    return null
  }
}

/**
 * This function collects all parent directories for each file path
 * and returns a list of unique directory names with a trailing separator.
 * For example, if the input is ['src/index.js', 'src/utils/helpers.js'],
 * the output will be ['src/', 'src/utils/'].
 * @param files An array of file paths
 */

/**
 * Async variant: yields every ~10k files so 270k+ file lists don't block
 * the main thread for >10ms at a time.
 */
export async function getDirectoryNamesAsync(
  files: string[],
): Promise<string[]> {
  const directoryNames = new Set<string>()
  // Time-based chunking: yield after CHUNK_MS of work so slow machines get
  // smaller chunks and stay responsive.
  let chunkStart = performance.now()
  for (let i = 0; i < files.length; i++) {
    collectDirectoryNames(files, i, i + 1, directoryNames)
    if ((i & 0xff) === 0xff && performance.now() - chunkStart > CHUNK_MS) {
      await yieldToEventLoop()
      chunkStart = performance.now()
    }
  }
  return [...directoryNames].map(d => d + path.sep)
}

function collectDirectoryNames(
  files: string[],
  start: number,
  end: number,
  out: Set<string>,
): void {
  for (let i = start; i < end; i++) {
    let currentDir = path.dirname(files[i]!)
    // Early exit if we've already processed this directory and all its parents.
    // Root detection: path.dirname returns its input at the root (fixed point),
    // so we stop when dirname stops changing. Checking this before add() keeps
    // the root out of the result set (matching the old path.parse().root guard).
    // This avoids path.parse() which allocates a 5-field object per file.
    while (currentDir !== '.' && !out.has(currentDir)) {
      const parent = path.dirname(currentDir)
      if (parent === currentDir) break
      out.add(currentDir)
      currentDir = parent
    }
  }
}

/**
 * Gets additional files from Claude config directories
 */
async function getClaudeConfigFiles(cwd: string): Promise<string[]> {
  const markdownFileArrays = await Promise.all(
    CLAUDE_CONFIG_DIRECTORIES.map(subdir =>
      loadMarkdownFilesForSubdir(subdir, cwd),
    ),
  )
  return markdownFileArrays.flatMap(markdownFiles =>
    markdownFiles.map(f => f.filePath),
  )
}

/**
 * Gets project files using git ls-files (fast) or ripgrep (fallback)
 */
async function getProjectFiles(
  abortSignal: AbortSignal,
  respectGitignore: boolean,
  state: FileSuggestionsSessionState = getFileSuggestionsState(),
): Promise<string[]> {
  logForDebugging(
    `[FileIndex] getProjectFiles called, respectGitignore=${respectGitignore}`,
  )

  // Try git ls-files first (much faster for git repos)
  const gitFiles = await getFilesUsingGit(state, abortSignal, respectGitignore)
  if (gitFiles !== null) {
    logForDebugging(
      `[FileIndex] using git ls-files result (${gitFiles.length} files)`,
    )
    return gitFiles
  }

  // Fall back to ripgrep
  logForDebugging(
    `[FileIndex] git ls-files returned null, falling back to ripgrep`,
  )
  const startTime = Date.now()
  const rgArgs = [
    '--files',
    '--follow',
    '--hidden',
    '--glob',
    '!.git/',
    '--glob',
    '!.svn/',
    '--glob',
    '!.hg/',
    '--glob',
    '!.bzr/',
    '--glob',
    '!.jj/',
    '--glob',
    '!.sl/',
  ]
  if (!respectGitignore) {
    rgArgs.push('--no-ignore-vcs')
  }

  const cwd = getCwd()
  const files = await ripGrep(rgArgs, '.', abortSignal, { cwd })
  const relativePaths = files.map(f => path.relative(cwd, path.resolve(cwd, f)))

  const duration = Date.now() - startTime
  logForDebugging(
    `[FileIndex] ripgrep: ${relativePaths.length} files in ${duration}ms`,
  )

  logEvent('tengu_file_suggestions_ripgrep', {
    file_count: relativePaths.length,
    duration_ms: duration,
  })

  return relativePaths
}

/**
 * Gets both files and their directory paths for providing path suggestions
 * Uses git ls-files for git repos (fast) or ripgrep as fallback
 * Returns a FileIndex populated for fast fuzzy search
 */
export async function getPathsForSuggestions(): Promise<FileIndex> {
  const state = getFileSuggestionsState()
  const signal = AbortSignal.timeout(10_000)
  const index = getFileIndex(state)

  try {
    // Check project settings first, then fall back to global config
    const projectSettings = getInitialSettings()
    const globalConfig = getGlobalConfig()
    const respectGitignore =
      projectSettings.respectGitignore ?? globalConfig.respectGitignore ?? true

    const cwd = getCwd()
    // Official 2.1.319 (#1725): skip full project file indexing on network
    // filesystems (NFS, SMB/CIFS, Lustre, GPFS, etc.) on Linux/WSL.
    if (await shouldSkipStartupFileIndexing(cwd)) {
      logForDebugging(
        `[FileIndex] skipping full project file indexing on network filesystem: ${cwd}`,
      )
      return index
    }
    const [projectFiles, configFiles] = await Promise.all([
      getProjectFiles(signal, respectGitignore),
      getClaudeConfigFiles(cwd),
    ])

    // Cache for mergeUntrackedIntoNormalizedCache
    state.cachedConfigFiles = configFiles

    const allFiles = [...projectFiles, ...configFiles]
    const directories = await getDirectoryNamesAsync(allFiles)
    state.cachedTrackedDirs = directories
    const allPathsList = [...directories, ...allFiles]

    // Skip rebuild when the list is unchanged. This is the common case
    // during a typing session — git ls-files returns the same output.
    const sig = pathListSignature(allPathsList)
    if (sig !== state.loadedTrackedSignature) {
      // Await the full build so cold-start returns complete results. The
      // build yields every ~4ms so the UI stays responsive — user can keep
      // typing during the ~120ms wait without input lag.
      await index.loadFromFileListAsync(allPathsList).done
      state.loadedTrackedSignature = sig
      // We just replaced the merged index with tracked-only data. Force
      // the next untracked merge to rebuild even if its own sig matches.
      state.loadedMergedSignature = null
    } else {
      logForDebugging(
        `[FileIndex] skipped index rebuild — tracked paths unchanged`,
      )
    }
  } catch (error) {
    logError(error)
  }

  return index
}

/**
 * Finds the common prefix between two strings
 */
function findCommonPrefix(a: string, b: string): string {
  const minLength = Math.min(a.length, b.length)
  let i = 0
  while (i < minLength && a[i] === b[i]) {
    i++
  }
  return a.substring(0, i)
}

/**
 * Finds the longest common prefix among an array of suggestion items
 */
export function findLongestCommonPrefix(suggestions: SuggestionItem[]): string {
  if (suggestions.length === 0) return ''

  const strings = suggestions.map(item => item.displayText)
  let prefix = strings[0]!
  for (let i = 1; i < strings.length; i++) {
    const currentString = strings[i]!
    prefix = findCommonPrefix(prefix, currentString)
    if (prefix === '') return ''
  }
  return prefix
}

/**
 * Creates a file suggestion item
 */
function createFileSuggestionItem(
  filePath: string,
  score?: number,
): SuggestionItem {
  return {
    id: `file-${filePath}`,
    displayText: filePath,
    metadata: score !== undefined ? { score } : undefined,
  }
}

/**
 * Find matching files and folders for a given query using the TS file index
 */
const MAX_SUGGESTIONS = 15
function findMatchingFiles(
  fileIndex: FileIndex,
  partialPath: string,
): SuggestionItem[] {
  const results = fileIndex.search(partialPath, MAX_SUGGESTIONS)
  return results.map(result =>
    createFileSuggestionItem(result.path, result.score),
  )
}

/**
 * Starts a background refresh of the file index cache if not already in progress.
 *
 * Throttled: when a cache already exists, we skip the refresh unless git state
 * has actually changed. This prevents every keystroke from spawning git ls-files
 * and rebuilding the nucleo index.
 */
const REFRESH_THROTTLE_MS = 5_000
export function startBackgroundCacheRefresh(): void {
  const state = getFileSuggestionsState()
  if (state.fileListRefreshPromise) {
    return
  }

  // Throttle only when a cache exists — cold start must always populate.
  // Refresh immediately when .git/index mtime changed (tracked files).
  // Otherwise refresh at most once per 5s — this floor picks up new UNTRACKED
  // files, which don't bump .git/index. The signature checks downstream skip
  // the rebuild when the 5s refresh finds nothing actually changed.
  const indexMtime = getGitIndexMtime()
  if (state.fileIndex) {
    const gitStateChanged =
      indexMtime !== null && indexMtime !== state.lastGitIndexMtime
    if (
      !gitStateChanged &&
      Date.now() - state.lastRefreshMs < REFRESH_THROTTLE_MS
    ) {
      return
    }
  }

  const generation = state.cacheGeneration
  const refreshStart = Date.now()
  const captured = getActiveSessionFromAls()
  // Ensure the FileIndex singleton exists — it's progressively queryable
  // via readyCount while the build runs. Callers searching early get partial
  // results; indexBuildComplete fires after .done so they can re-search.
  getFileIndex(state)
  const refreshPromise = runInCapturedSession(captured, () =>
    getPathsForSuggestions(),
  )
    .then(result => {
      if (generation !== state.cacheGeneration) {
        return result // Cache was cleared; don't overwrite with stale data
      }
      if (state.fileListRefreshPromise === refreshPromise) {
        state.fileListRefreshPromise = null
      }
      runInCapturedSession(captured, () => {
        state.indexBuildComplete.emit()
      })
      // Commit the start-time mtime observation on success. If git state
      // changed mid-refresh, the next call will see the newer mtime and
      // correctly refresh again.
      state.lastGitIndexMtime = indexMtime
      state.lastRefreshMs = Date.now()
      logForDebugging(
        `[FileIndex] cache refresh completed in ${Date.now() - refreshStart}ms`,
      )
      return result
    })
    .catch(error => {
      logForDebugging(
        `[FileIndex] Cache refresh failed: ${errorMessage(error)}`,
      )
      logError(error)
      if (
        generation === state.cacheGeneration &&
        state.fileListRefreshPromise === refreshPromise
      ) {
        state.fileListRefreshPromise = null // Allow retry on next call
      }
      return getFileIndex(state)
    })
  state.fileListRefreshPromise = refreshPromise
}

/**
 * Gets the top-level files and directories in the current working directory
 * @returns Array of file/directory paths in the current directory
 */
async function getTopLevelPaths(): Promise<string[]> {
  const fs = getFsImplementation()
  const cwd = getCwd()

  try {
    const entries = await fs.readdir(cwd)
    return entries.map(entry => {
      const fullPath = path.join(cwd, entry.name)
      const relativePath = path.relative(cwd, fullPath)
      // Add trailing separator for directories
      return entry.isDirectory() ? relativePath + path.sep : relativePath
    })
  } catch (error) {
    logError(error as Error)
    return []
  }
}

/**
 * Generate file suggestions for the current input and cursor position
 * @param partialPath The partial file path to match
 * @param showOnEmpty Whether to show suggestions even if partialPath is empty (used for @ symbol)
 */
export async function generateFileSuggestions(
  partialPath: string,
  showOnEmpty = false,
): Promise<SuggestionItem[]> {
  // If input is empty and we don't want to show suggestions on empty, return nothing
  if (!partialPath && !showOnEmpty) {
    return []
  }

  // Use custom command directly if configured. We don't mix in our config files
  // because the command returns pre-ranked results using its own search logic.
  if (getInitialSettings().fileSuggestion?.type === 'command') {
    const input: FileSuggestionCommandInput = {
      ...createBaseHookInput(),
      query: partialPath,
    }
    const results = await executeFileSuggestionCommand(input)
    return results.slice(0, MAX_SUGGESTIONS).map(createFileSuggestionItem)
  }

  // If the partial path is empty or just a dot, return current directory suggestions
  if (partialPath === '' || partialPath === '.' || partialPath === './') {
    const topLevelPaths = await getTopLevelPaths()
    startBackgroundCacheRefresh()
    return topLevelPaths.slice(0, MAX_SUGGESTIONS).map(createFileSuggestionItem)
  }

  const startTime = Date.now()

  try {
    // Kick a background refresh. The index is progressively queryable —
    // searches during build return partial results from ready chunks, and
    // the typeahead callback (setOnIndexBuildComplete) re-fires the search
    // when the build finishes to upgrade partial → full.
    const state = getFileSuggestionsState()
    const wasBuilding = state.fileListRefreshPromise !== null
    startBackgroundCacheRefresh()

    // Handle both './' and '.\'
    let normalizedPath = partialPath
    const currentDirPrefix = '.' + path.sep
    if (partialPath.startsWith(currentDirPrefix)) {
      normalizedPath = partialPath.substring(2)
    }

    // Handle tilde expansion for home directory
    if (normalizedPath.startsWith('~')) {
      normalizedPath = expandPath(normalizedPath)
    }

    const matches = state.fileIndex
      ? findMatchingFiles(state.fileIndex, normalizedPath)
      : []

    const duration = Date.now() - startTime
    logForDebugging(
      `[FileIndex] generateFileSuggestions: ${matches.length} results in ${duration}ms (${wasBuilding ? 'partial' : 'full'} index)`,
    )
    logEvent('tengu_file_suggestions_query', {
      duration_ms: duration,
      cache_hit: !wasBuilding,
      result_count: matches.length,
      query_length: partialPath.length,
    })

    return matches
  } catch (error) {
    logError(error)
    return []
  }
}

/**
 * Apply a file suggestion to the input
 */
export function applyFileSuggestion(
  suggestion: string | SuggestionItem,
  input: string,
  partialPath: string,
  startPos: number,
  onInputChange: (value: string) => void,
  setCursorOffset: (offset: number) => void,
): void {
  // Extract suggestion text from string or SuggestionItem
  const suggestionText =
    typeof suggestion === 'string' ? suggestion : suggestion.displayText

  // Replace the partial path with the selected file path
  const newInput =
    input.substring(0, startPos) +
    suggestionText +
    input.substring(startPos + partialPath.length)
  onInputChange(newInput)

  // Move cursor to end of the file path
  const newCursorPos = startPos + suggestionText.length
  setCursorOffset(newCursorPos)
}
