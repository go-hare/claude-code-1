import type { StructuredPatchHunk } from 'diff'
import { useEffect, useMemo, useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import {
  emptyDiffHunks,
  fetchGitDiff,
  fetchGitDiffHunks,
  hunkRefForDiff,
  nextHunksOnVFf,
  type DiffHunksBundle,
  type DiffFetchMode,
  type DiffSource,
  type GitDiffResult,
  type GitDiffStats,
} from '../utils/gitDiff.js'
import { logError } from '../utils/log.js'

/** densable H_s `be`/`Ee` feature_name. */
const REPL_DIFF_READ =
  'repl_diff_read' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

function replDiffReadSad(
  code: 'git_diff_failed' | 'git_hunks_failed' | 'git_diff_threw',
): void {
  logEvent('tengu_feature_sad', {
    feature_name: REPL_DIFF_READ,
    error_code:
      code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

const MAX_LINES_PER_FILE = 400

export type DiffFile = {
  path: string
  linesAdded: number
  linesRemoved: number
  isBinary: boolean
  isLargeFile: boolean
  isTruncated: boolean
  isNewFile?: boolean
  isUntracked?: boolean
  preSession?: boolean
}

export type DiffData = {
  stats: GitDiffStats | null
  files: DiffFile[]
  hunks: Map<string, StructuredPatchHunk[]>
  loading: boolean
  source: DiffSource
  baseMode: DiffFetchMode
  /** densable H_s `noCommits` — Sil / empty-repo. */
  noCommits?: boolean
}

type DiffFetchState = {
  result: GitDiffResult
  hunks: DiffHunksBundle
  /** Official `s.baseMode` — pinned to the fetch that produced `result`. */
  baseMode: DiffFetchMode
}

/**
 * Hook to fetch current git diff data on demand.
 * densable `H_s(e=0, t=!0, r)` — `revision` is official first arg `e`
 * (`wt(rJA)` / fileHistory.snapshotSequence). Repl panel passes persisted
 * session/uncommitted/branch; DiffDialog keeps the default uncommitted tree.
 *
 * After the first read, later revision/mode fetches stay silent (official
 * never flips loading true again). leftover `uea`/`HR0` are call-sites only
 * (no body / no ms); extracted gold is `e` + first delay 0.
 *
 * Official keep-previous: PPi `null` or throw only clears loading (keeps `s`).
 * VFf `null` keeps hunks when `CJn` matches (`nextHunksOnVFf`).
 * `s` is `{result, baseMode, hunks}`; display `baseMode` is `s.baseMode`.
 */
export function useDiffData(
  mode: DiffFetchMode = 'uncommitted',
  revision = 0,
): DiffData {
  const [fetched, setFetched] = useState<DiffFetchState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const abort = new AbortController()

    async function loadDiffData() {
      try {
        const statsResult = await fetchGitDiff(mode, abort.signal)
        if (cancelled) return
        if (statsResult === null) {
          replDiffReadSad('git_diff_failed')
          setLoading(false)
          return
        }
        const nextRef = hunkRefForDiff(statsResult)
        const hunksResult =
          statsResult.stats.filesCount === 0
            ? emptyDiffHunks()
            : await fetchGitDiffHunks(nextRef, abort.signal)
        if (cancelled) return
        setFetched(prev => ({
          result: statsResult,
          baseMode: mode,
          hunks: nextHunksOnVFf(hunksResult, prev, nextRef),
        }))
        if (hunksResult === null) {
          replDiffReadSad('git_hunks_failed')
        } else {
          logEvent('tengu_feature_ok', { feature_name: REPL_DIFF_READ })
        }
        setLoading(false)
      } catch (error) {
        if (!cancelled) {
          logError(error)
          replDiffReadSad('git_diff_threw')
          setLoading(false)
        }
      }
    }

    // Official first fetch delay 0 (later `HR0` has no leftover value).
    const timer = setTimeout(() => {
      void loadDiffData()
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
      abort.abort()
    }
  }, [mode, revision])

  return useMemo(() => {
    if (!fetched) {
      return {
        stats: null,
        files: [],
        hunks: new Map(),
        loading,
        source: { kind: 'working-tree' as const },
        baseMode: mode,
      }
    }

    const {
      result: diffResult,
      hunks: hunksBundle,
      baseMode: fetchedMode,
    } = fetched
    const { stats, perFileStats } = diffResult
    const hunks = hunksBundle.hunks
    const files: DiffFile[] = []

    // Iterate over perFileStats to get all files including large/skipped ones
    for (const [path, fileStats] of perFileStats) {
      const isUntracked = fileStats.isUntracked ?? false

      // densable H_s `s.hunks.skippedLarge.has`
      const isLargeFile = hunksBundle.skippedLarge.has(path)

      // Detect truncated file (total > limit means we truncated)
      const totalLines = fileStats.added + fileStats.removed
      const isTruncated =
        !isLargeFile && !fileStats.isBinary && totalLines > MAX_LINES_PER_FILE

      files.push({
        path,
        linesAdded: fileStats.added,
        linesRemoved: fileStats.removed,
        isBinary: fileStats.isBinary,
        isLargeFile,
        isTruncated,
        isUntracked,
        ...(fileStats.preSession ? { preSession: true } : {}),
      })
    }

    files.sort((a, b) => a.path.localeCompare(b.path))

    return {
      stats,
      files,
      hunks,
      loading: false,
      source: diffResult.source,
      baseMode: fetchedMode,
      ...(diffResult.noCommits ? { noCommits: true } : {}),
    }
  }, [fetched, loading, mode])
}
