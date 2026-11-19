import { createHash, type UUID } from 'crypto'
import { diffLines } from 'diff'
import { constants as fsConstants, type Stats } from 'fs'
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  stat,
  unlink,
} from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'path'
import {
  getIsNonInteractiveSession,
  getOriginalCwd,
  getSessionId,
} from 'src/bootstrap/state.js'
import { logEvent } from 'src/services/analytics/index.js'
import { notifyVscodeFileUpdated } from 'src/services/mcp/vscodeSdkMcp.js'
import type { LogOption } from 'src/types/logs.js'
import { inspect } from 'util'
import { getGlobalConfig } from './config.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getErrnoCode, isENOENT } from './errors.js'
import { pathExists } from './file.js'
import { logError } from './log.js'
import { isUnsafeNetworkOrNtIncludePath } from './path.js'
import { recordFileHistorySnapshot } from './sessionStorage.js'

type BackupFileName = string | null // The null value means the file does not exist in this version

export type FileHistoryBackup = {
  backupFileName: BackupFileName
  version: number
  backupTime: Date
  /**
   * densable realParentDir — realpath of parent dir at backup create time.
   * Q3g/Z3g refuse restore when parent has moved since the checkpoint.
   */
  realParentDir?: string
}

export type FileHistorySnapshot = {
  messageId: UUID // The associated message ID for this snapshot
  trackedFileBackups: Record<string, FileHistoryBackup> // Map of file paths to backup versions
  timestamp: Date
}

export type FileHistoryState = {
  snapshots: FileHistorySnapshot[]
  trackedFiles: Set<string>
  // Monotonically-increasing counter incremented on every snapshot, even when
  // old snapshots are evicted. Used by useDiffData as the H_s `e` activity
  // signal (snapshots.length plateaus once the cap is reached).
  snapshotSequence: number
}

// Disabled: file checkpointing causes unbounded memory growth (100 snapshots × full file backups).
// See heap snapshot analysis — re-enable only after switching to incremental diffs.
const MAX_SNAPSHOTS = 20
export type DiffStats =
  | {
      filesChanged?: string[]
      insertions: number
      deletions: number
      hasUncheckedFiles?: boolean
    }
  | undefined

function isFileCheckpointingEnvDisabled(): boolean {
  // Official DISABLE_FILE_CHECKPOINTING densable.
  try {
    const { isFileCheckpointingDisabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    return isFileCheckpointingDisabled()
  } catch {
    return isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING)
  }
}

export function fileHistoryEnabled(): boolean {
  if (getIsNonInteractiveSession()) {
    return fileHistoryEnabledSdk()
  }
  return (
    getGlobalConfig().fileCheckpointingEnabled !== false &&
    !isFileCheckpointingEnvDisabled()
  )
}

function fileHistoryEnabledSdk(): boolean {
  // Official ENABLE_SDK_FILE_CHECKPOINTING densable.
  let sdkCheckpointingEnabled = isEnvTruthy(
    process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING,
  )
  try {
    const { isSdkFileCheckpointingEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    sdkCheckpointingEnabled = isSdkFileCheckpointingEnabled()
  } catch {
    // keep raw env fallback
  }
  return sdkCheckpointingEnabled && !isFileCheckpointingEnvDisabled()
}

/**
 * Tracks a file edit (and add) by creating a backup of its current contents (if necessary).
 *
 * This must be called before the file is actually added or edited, so we can save
 * its contents before the edit.
 */
export async function fileHistoryTrackEdit(
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  filePath: string,
  messageId: UUID,
): Promise<void> {
  if (!fileHistoryEnabled()) {
    return
  }

  const trackingPath = maybeShortenFilePath(filePath)

  // Phase 1: check if backup is needed. Speculative writes would overwrite
  // the deterministic {hash}@v1 backup on every repeat call — a second
  // trackEdit after an edit would corrupt v1 with post-edit content.
  let captured: FileHistoryState | undefined
  updateFileHistoryState(state => {
    captured = state
    return state
  })
  if (!captured) return
  const mostRecent = captured.snapshots.at(-1)
  if (!mostRecent) {
    logError(new Error('FileHistory: Missing most recent snapshot'))
    logEvent('tengu_file_history_track_edit_failed', {})
    return
  }
  if (mostRecent.trackedFileBackups[trackingPath]) {
    // Already tracked in the most recent snapshot; next makeSnapshot will
    // re-check mtime and re-backup if changed. Do not touch v1 backup.
    return
  }

  // Phase 2: async backup.
  let backup: FileHistoryBackup
  try {
    backup = await createBackup(filePath, 1)
  } catch (error) {
    logError(error)
    logEvent('tengu_file_history_track_edit_failed', {})
    return
  }
  const isAddingFile = backup.backupFileName === null

  // Phase 3: commit. Re-check tracked (another trackEdit may have raced).
  updateFileHistoryState((state: FileHistoryState) => {
    try {
      const mostRecentSnapshot = state.snapshots.at(-1)
      if (
        !mostRecentSnapshot ||
        mostRecentSnapshot.trackedFileBackups[trackingPath]
      ) {
        return state
      }

      // This file has not already been tracked in the most recent snapshot, so we
      // need to retroactively track a backup there.
      const updatedTrackedFiles = state.trackedFiles.has(trackingPath)
        ? state.trackedFiles
        : new Set(state.trackedFiles).add(trackingPath)

      // Shallow-spread is sufficient: backup values are never mutated after
      // insertion, so we only need fresh top-level + trackedFileBackups refs
      // for React change detection. A deep clone would copy every existing
      // backup's Date/string fields — O(n) cost to add one entry.
      const updatedMostRecentSnapshot = {
        ...mostRecentSnapshot,
        trackedFileBackups: {
          ...mostRecentSnapshot.trackedFileBackups,
          [trackingPath]: backup,
        },
      }

      const updatedState = {
        ...state,
        snapshots: (() => {
          const copy = state.snapshots.slice()
          copy[copy.length - 1] = updatedMostRecentSnapshot
          return copy
        })(),
        trackedFiles: updatedTrackedFiles,
      }
      maybeDumpStateForDebug(updatedState)

      // Record a snapshot update since it has changed.
      void recordFileHistorySnapshot(
        messageId,
        updatedMostRecentSnapshot,
        true, // isSnapshotUpdate
      ).catch(error => {
        logError(new Error(`FileHistory: Failed to record snapshot: ${error}`))
      })

      logEvent('tengu_file_history_track_edit_success', {
        isNewFile: isAddingFile,
        version: backup.version,
      })
      logForDebugging(`FileHistory: Tracked file modification for ${filePath}`)

      return updatedState
    } catch (error) {
      logError(error)
      logEvent('tengu_file_history_track_edit_failed', {})
      return state
    }
  })
}

/**
 * Adds a snapshot in the file history and backs up any modified tracked files.
 */
export async function fileHistoryMakeSnapshot(
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  messageId: UUID,
): Promise<void> {
  if (!fileHistoryEnabled()) {
    return undefined
  }

  // Phase 1: capture current state with a no-op updater so we know which
  // files to back up. Returning the same reference keeps this a true no-op
  // for any wrapper that honors same-ref returns (src/CLAUDE.md wrapper
  // rule). Wrappers that unconditionally spread will trigger one extra
  // re-render; acceptable for a once-per-turn call.
  let captured: FileHistoryState | undefined
  updateFileHistoryState(state => {
    captured = state
    return state
  })
  if (!captured) return // updateFileHistoryState was a no-op stub (e.g. mcp.ts)

  // Phase 2: do all IO async, outside the updater.
  const trackedFileBackups: Record<string, FileHistoryBackup> = {}
  const mostRecentSnapshot = captured.snapshots.at(-1)
  if (mostRecentSnapshot) {
    logForDebugging(`FileHistory: Making snapshot for message ${messageId}`)
    await Promise.all(
      Array.from(captured.trackedFiles, async trackingPath => {
        try {
          const filePath = maybeExpandFilePath(trackingPath)
          const latestBackup =
            mostRecentSnapshot.trackedFileBackups[trackingPath]
          const nextVersion = latestBackup ? latestBackup.version + 1 : 1

          // Stat the file once; ENOENT means the tracked file was deleted.
          let fileStats: Stats | undefined
          try {
            fileStats = await stat(filePath)
          } catch (e: unknown) {
            if (!isENOENT(e)) throw e
          }

          if (!fileStats) {
            trackedFileBackups[trackingPath] = {
              backupFileName: null, // Use null to denote missing tracked file
              version: nextVersion,
              backupTime: new Date(),
            }
            logEvent('tengu_file_history_backup_deleted_file', {
              version: nextVersion,
            })
            logForDebugging(
              `FileHistory: Missing tracked file: ${trackingPath}`,
            )
            return
          }

          // File exists - check if it needs to be backed up
          if (
            latestBackup &&
            latestBackup.backupFileName !== null &&
            !(await checkOriginFileChanged(
              filePath,
              latestBackup.backupFileName,
              fileStats,
            ))
          ) {
            // File hasn't been modified since the latest version, reuse it
            trackedFileBackups[trackingPath] = latestBackup
            return
          }

          // File is newer than the latest backup, create a new backup
          trackedFileBackups[trackingPath] = await createBackup(
            filePath,
            nextVersion,
          )
        } catch (error) {
          logError(error)
          logEvent('tengu_file_history_backup_file_failed', {})
        }
      }),
    )
  }

  // Phase 3: commit the new snapshot to state. Read state.trackedFiles FRESH
  // — if fileHistoryTrackEdit added a file during phase 2's async window, it
  // wrote the backup to state.snapshots[-1].trackedFileBackups. Inherit those
  // so the new snapshot covers every currently-tracked file.
  updateFileHistoryState((state: FileHistoryState) => {
    try {
      const lastSnapshot = state.snapshots.at(-1)
      if (lastSnapshot) {
        for (const trackingPath of state.trackedFiles) {
          if (trackingPath in trackedFileBackups) continue
          const inherited = lastSnapshot.trackedFileBackups[trackingPath]
          if (inherited) trackedFileBackups[trackingPath] = inherited
        }
      }
      const now = new Date()
      const newSnapshot: FileHistorySnapshot = {
        messageId,
        trackedFileBackups,
        timestamp: now,
      }

      const allSnapshots = [...state.snapshots, newSnapshot]
      const updatedState: FileHistoryState = {
        ...state,
        snapshots:
          allSnapshots.length > MAX_SNAPSHOTS
            ? allSnapshots.slice(-MAX_SNAPSHOTS)
            : allSnapshots,
        snapshotSequence: (state.snapshotSequence ?? 0) + 1,
      }
      maybeDumpStateForDebug(updatedState)

      void notifyVscodeSnapshotFilesUpdated(state, updatedState).catch(logError)

      // Record the file history snapshot to session storage for resume support
      void recordFileHistorySnapshot(
        messageId,
        newSnapshot,
        false, // isSnapshotUpdate
      ).catch(error => {
        logError(new Error(`FileHistory: Failed to record snapshot: ${error}`))
      })

      logForDebugging(
        `FileHistory: Added snapshot for ${messageId}, tracking ${state.trackedFiles.size} files`,
      )
      logEvent('tengu_file_history_snapshot_success', {
        trackedFilesCount: state.trackedFiles.size,
        snapshotCount: updatedState.snapshots.length,
      })

      return updatedState
    } catch (error) {
      logError(error)
      logEvent('tengu_file_history_snapshot_failed', {})
      return state
    }
  })
}

/**
 * densable TYn — user-facing reason string for skippedLinks (MessageSelector / CLI).
 * Do not invent alternate wording; changelog #36 surface copy is fixed in SEA.
 */
export const REWIND_SKIPPED_LINKS_REASON =
  'the tracked path is (or became) a link or other non-regular file, its directory changed since the checkpoint, or its backup could not be safely read' as const

/**
 * densable MessageSelector partial-restore UX when skippedLinks > 0.
 */
export function formatRewindSkippedLinksMessage(skippedLinks: number): string {
  const unit = skippedLinks === 1 ? 'file' : 'files'
  return `Restored the code, but skipped ${skippedLinks} ${unit}: ${REWIND_SKIPPED_LINKS_REASON}. Skipped files were left untouched \u2014 run with --debug for the paths.`
}

/**
 * densable CLI --rewind-files stderr Warning when skippedLinks > 0.
 */
export function formatRewindSkippedLinksCliWarning(
  skippedLinks: number,
): string {
  const verb = skippedLinks === 1 ? 'path was' : 'paths were'
  return `Warning: ${skippedLinks} tracked ${verb} skipped: ${REWIND_SKIPPED_LINKS_REASON}. Run with --debug for the paths.`
}

/**
 * Rewinds the file system to a previous snapshot.
 * densable tVr — returns filesChanged + skippedLinks for SDK/CLI report.
 */
export async function fileHistoryRewind(
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  messageId: UUID,
): Promise<{ filesChanged: string[]; skippedLinks: number }> {
  if (!fileHistoryEnabled()) {
    return { filesChanged: [], skippedLinks: 0 }
  }

  // Rewind is a pure filesystem side-effect and does not mutate
  // FileHistoryState. Capture state with a no-op updater, then do IO async.
  let captured: FileHistoryState | undefined
  updateFileHistoryState(state => {
    captured = state
    return state
  })
  if (!captured) {
    return { filesChanged: [], skippedLinks: 0 }
  }

  const targetSnapshot = captured.snapshots.findLast(
    snapshot => snapshot.messageId === messageId,
  )
  if (!targetSnapshot) {
    logError(new Error(`FileHistory: Snapshot for ${messageId} not found`))
    logEvent('tengu_file_history_rewind_failed', {
      trackedFilesCount: captured.trackedFiles.size,
      snapshotFound: false,
    })
    throw new Error('The selected snapshot was not found')
  }

  try {
    logForDebugging(
      `FileHistory: [Rewind] Rewinding to snapshot for ${messageId}`,
    )
    const { filesChanged, skippedLinks } = await applySnapshot(
      captured,
      targetSnapshot,
    )

    logForDebugging(
      `FileHistory: [Rewind] Finished rewinding to ${messageId}` +
        (skippedLinks > 0
          ? ` (skipped ${skippedLinks} link-unsafe path(s))`
          : ''),
    )
    logEvent('tengu_file_history_rewind_success', {
      trackedFilesCount: captured.trackedFiles.size,
      filesChangedCount: filesChanged.length,
      skippedLinksCount: skippedLinks,
    })
    return { filesChanged, skippedLinks }
  } catch (error) {
    logError(error)
    logEvent('tengu_file_history_rewind_failed', {
      trackedFilesCount: captured.trackedFiles.size,
      snapshotFound: true,
    })
    throw error
  }
}

export function fileHistoryCanRestore(
  state: FileHistoryState,
  messageId: UUID,
): boolean {
  if (!fileHistoryEnabled()) {
    return false
  }

  return state.snapshots.some(snapshot => snapshot.messageId === messageId)
}

/** Official 2.1.323 (#2085): default budget for working-tree diff stat checks. */
const DEFAULT_DIFF_STATS_BUDGET_MS = 2000

const DIFF_BUDGET_EXCEEDED = Symbol('DIFF_BUDGET_EXCEEDED')

function isNetworkOrUncDiffPath(filePath: string): boolean {
  return (
    isUnsafeNetworkOrNtIncludePath(filePath) ||
    /^\/(?:net|Network\/Servers)(?:\/|$)/i.test(filePath)
  )
}

async function raceWithDeadline<T>(
  promise: Promise<T>,
  countUntil: number,
): Promise<T | typeof DIFF_BUDGET_EXCEEDED> {
  const remainingMs = countUntil - Date.now()
  if (remainingMs <= 0) {
    return DIFF_BUDGET_EXCEEDED
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<typeof DIFF_BUDGET_EXCEEDED>(resolve => {
        timer = setTimeout(() => resolve(DIFF_BUDGET_EXCEEDED), remainingMs)
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/**
 * Computes diff stats for a file snapshot by counting the number of files that would be changed
 * if reverting to that snapshot.
 */
export async function fileHistoryGetDiffStats(
  state: FileHistoryState,
  messageId: UUID,
  options?: { countUntil?: number },
): Promise<DiffStats> {
  if (!fileHistoryEnabled()) {
    return undefined
  }

  const targetSnapshot = state.snapshots.findLast(
    snapshot => snapshot.messageId === messageId,
  )

  if (!targetSnapshot) {
    return undefined
  }

  // Official 2.1.323 (#2085): bound diff-stat I/O with a `countUntil` deadline,
  // skip network/UNC paths, and degrade read failures to `hasUncheckedFiles`
  // rather than hanging `/rewind` or falsely marking every file as modified.
  const countUntil =
    options?.countUntil ?? Date.now() + DEFAULT_DIFF_STATS_BUDGET_MS
  let hasUncheckedFiles = false
  const results = await Promise.all(
    Array.from(state.trackedFiles, async trackingPath => {
      try {
        if (isNetworkOrUncDiffPath(trackingPath)) {
          hasUncheckedFiles = true
          return null
        }
        const filePath = maybeExpandFilePath(trackingPath)
        if (isNetworkOrUncDiffPath(filePath)) {
          hasUncheckedFiles = true
          return null
        }
        if (Date.now() >= countUntil) {
          hasUncheckedFiles = true
          return null
        }
        const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]

        const backupFileName: BackupFileName | undefined = targetBackup
          ? targetBackup.backupFileName
          : getBackupFileNameFirstVersion(trackingPath, state)

        if (backupFileName === undefined) {
          // Error resolving the backup, so don't touch the file
          hasUncheckedFiles = true
          logError(
            new Error('FileHistory: Error finding the backup file to apply'),
          )
          logEvent('tengu_file_history_rewind_restore_file_failed', {
            dryRun: true,
          })
          return null
        }

        const statsOrTimeout = await raceWithDeadline(
          computeDiffStatsForFile(
            filePath,
            backupFileName === null ? undefined : backupFileName,
          ),
          countUntil,
        )
        if (statsOrTimeout === DIFF_BUDGET_EXCEEDED) {
          hasUncheckedFiles = true
          return null
        }
        const stats = statsOrTimeout
        if (stats?.hasUncheckedFiles) {
          hasUncheckedFiles = true
          return null
        }
        if (stats?.insertions || stats?.deletions) {
          return { filePath, stats }
        }
        if (backupFileName === null) {
          const existsCheck = await raceWithDeadline(
            stat(filePath).then(
              () => 'exists' as const,
              err =>
                isENOENT(err) ? ('missing' as const) : ('error' as const),
            ),
            countUntil,
          )
          if (existsCheck === DIFF_BUDGET_EXCEEDED || existsCheck === 'error') {
            hasUncheckedFiles = true
            return null
          }
          if (existsCheck === 'exists') {
            // Zero-byte file created after snapshot: counts as changed even
            // though diffLines reports 0/0.
            return { filePath, stats }
          }
        }
        return null
      } catch (error) {
        hasUncheckedFiles = true
        logError(error)
        logEvent('tengu_file_history_rewind_restore_file_failed', {
          dryRun: true,
        })
        return null
      }
    }),
  )

  const filesChanged: string[] = []
  let insertions = 0
  let deletions = 0
  for (const r of results) {
    if (!r) continue
    filesChanged.push(r.filePath)
    insertions += r.stats?.insertions || 0
    deletions += r.stats?.deletions || 0
  }
  return {
    filesChanged,
    insertions,
    deletions,
    ...(hasUncheckedFiles ? { hasUncheckedFiles: true } : {}),
  }
}

/**
 * Lightweight boolean-only check: would rewinding to this message change any
 * file on disk? Uses the same stat/content comparison as the non-dry-run path
 * of applySnapshot (checkOriginFileChanged) instead of computeDiffStatsForFile,
 * so it never calls diffLines. Early-exits on the first changed file. Use when
 * the caller only needs a yes/no answer; fileHistoryGetDiffStats remains for
 * callers that display insertions/deletions.
 */
export async function fileHistoryHasAnyChanges(
  state: FileHistoryState,
  messageId: UUID,
): Promise<boolean> {
  if (!fileHistoryEnabled()) {
    return false
  }

  const targetSnapshot = state.snapshots.findLast(
    snapshot => snapshot.messageId === messageId,
  )
  if (!targetSnapshot) {
    return false
  }

  for (const trackingPath of state.trackedFiles) {
    try {
      const filePath = maybeExpandFilePath(trackingPath)
      const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]
      const backupFileName: BackupFileName | undefined = targetBackup
        ? targetBackup.backupFileName
        : getBackupFileNameFirstVersion(trackingPath, state)

      if (backupFileName === undefined) {
        continue
      }
      if (backupFileName === null) {
        // Backup says file did not exist; probe via stat (operate-then-catch).
        if (await pathExists(filePath)) return true
        continue
      }
      if (await checkOriginFileChanged(filePath, backupFileName)) return true
    } catch (error) {
      logError(error)
    }
  }
  return false
}

/**
 * densable Q3g — refuse restore/delete through symlink or hardlink destinations.
 * ENOENT is safe (restore may create). Optional expectedRealParentDir refuses
 * when the parent realpath drifted since the checkpoint. Exported for tests.
 */
/**
 * Official 2.1.319 #1775 (`H3`):
 * Resolve the canonical parent directory of `filePath`, walking up ancestors
 * when intermediate directories do not exist yet, and refusing if the parent
 * or any ancestor is a dangling symlink.
 */
export async function resolveRealParentDir(filePath: string): Promise<string> {
  const parent = dirname(filePath)
  try {
    return await realpath(parent)
  } catch (e: unknown) {
    if (!isENOENT(e)) throw e
  }
  // Parent does not exist (or is a dangling symlink). Walk upward checking
  // every component so a dangling symlink anywhere in the chain is refused.
  let walk = parent
  for (;;) {
    let st
    try {
      st = await lstat(walk)
    } catch (e: unknown) {
      if (!isENOENT(e)) throw e
      const up = dirname(walk)
      if (up === walk) return parent
      walk = up
      continue
    }
    if (st.isSymbolicLink()) {
      try {
        const resolved = await realpath(walk)
        return join(resolved, relative(walk, parent))
      } catch (e: unknown) {
        if (isENOENT(e)) {
          throw new Error(
            'FileHistory: parent directory of the tracked path is a dangling symlink',
          )
        }
        throw e
      }
    }
    const resolved = await realpath(walk)
    return walk === parent ? resolved : join(resolved, relative(walk, parent))
  }
}

/**
 * Official 2.1.319 #1775 (`jkn`):
 * Verify that the parent directory at `filePath` matches `expectedRealParentDir`
 * by `(dev, ino, isDirectory)` identity (using `bigint` stats).
 */
export async function verifyParentDirectoryIdentity(
  filePath: string,
  expectedRealParentDir: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (expectedRealParentDir === undefined) return { ok: true }
  const parent = dirname(filePath)
  let parentLstat
  try {
    parentLstat = await lstat(parent, { bigint: true })
  } catch (e: unknown) {
    if (isENOENT(e)) return { ok: true }
    throw e
  }
  if (parentLstat.ino === 0n) return { ok: true }
  let resolvedParentStat = parentLstat
  try {
    if (parentLstat.isSymbolicLink()) {
      resolvedParentStat = await lstat(await realpath(parent), { bigint: true })
    }
    const expectedStat = await lstat(expectedRealParentDir, { bigint: true })
    if (
      expectedStat.dev !== resolvedParentStat.dev ||
      expectedStat.ino !== resolvedParentStat.ino ||
      expectedStat.isDirectory() !== resolvedParentStat.isDirectory()
    ) {
      logEvent('tengu_file_history_first_backup_parent_changed', {})
      return {
        ok: false,
        reason:
          'the captured parent directory is not the one at the tracked path',
      }
    }
  } catch (e: unknown) {
    if (!isENOENT(e)) throw e
    return {
      ok: false,
      reason: 'parent directory identity could not be verified',
    }
  }
  return { ok: true }
}

/**
 * Official 2.1.319 #1775 (`GIr`):
 * Safely unlink `filePath` only after anchoring its parent directory with
 * `O_DIRECTORY | O_NOFOLLOW` and verifying `realpath` + `(dev, ino)` identity,
 * preventing `/rewind` from unlinking a file through a directory symlink.
 */
export async function safeUnlinkTrackedFile(
  filePath: string,
  expectedRealParentDir?: string,
): Promise<'deleted' | 'absent' | { refused: string }> {
  const parent = dirname(filePath)
  const dirFlags =
    fsConstants.O_RDONLY |
    (fsConstants.O_DIRECTORY ?? 0) |
    (fsConstants.O_NOFOLLOW ?? 0)
  let dirHandle
  try {
    dirHandle = await open(parent, dirFlags)
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') return 'absent'
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      return {
        refused: `its directory was replaced by a link or a non-directory since the checkpoint (${code})`,
      }
    }
    throw e
  }
  try {
    if (expectedRealParentDir !== undefined) {
      if (process.platform === 'linux') {
        const fdPath = await readlink(`/proc/self/fd/${dirHandle.fd}`).catch(
          e => (isENOENT(e) ? null : Promise.reject(e)),
        )
        if (fdPath !== null && fdPath !== expectedRealParentDir) {
          if (fdPath.endsWith(' (deleted)')) return 'absent'
          return {
            refused: `its directory moved since the checkpoint (now ${fdPath}, was ${expectedRealParentDir})`,
          }
        }
        if (fdPath !== null) {
          const procTarget = `/proc/self/fd/${dirHandle.fd}/${basename(filePath)}`
          try {
            const procTargetStat = await lstat(procTarget)
            if (procTargetStat.isSymbolicLink() || !procTargetStat.isFile()) {
              return { refused: 'destination is not a regular file' }
            }
            await unlink(procTarget)
            return 'deleted'
          } catch (e: unknown) {
            if (isENOENT(e)) return 'absent'
            // Fall through if procfs lstat/unlink is unsupported on this kernel
          }
        }
      }
      const fdStat = await dirHandle.stat({ bigint: true })
      const expectedStat = await lstat(expectedRealParentDir, {
        bigint: true,
      }).catch(e => (isENOENT(e) ? null : Promise.reject(e)))
      if (
        expectedStat === null ||
        (fdStat.ino !== 0n &&
          (fdStat.dev !== expectedStat.dev || fdStat.ino !== expectedStat.ino))
      ) {
        return {
          refused: `its directory moved since the checkpoint (expected ${expectedRealParentDir})`,
        }
      }
    }
    const targetStat = await lstat(filePath).catch(e =>
      isENOENT(e) ? null : Promise.reject(e),
    )
    if (targetStat === null) return 'absent'
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      return { refused: 'destination is not a regular file' }
    }
    await unlink(filePath)
    return 'deleted'
  } finally {
    await dirHandle.close().catch(() => {})
  }
}

export async function assertRewindDestinationSafe(
  destPath: string,
  expectedRealParentDir?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const st = await lstat(destPath)
    if (st.isSymbolicLink()) {
      return { ok: false, reason: 'destination is a symlink' }
    }
    if (!st.isFile()) {
      return { ok: false, reason: 'destination is not a regular file' }
    }
    if (st.nlink > 1) {
      return {
        ok: false,
        reason: `destination is hard-linked (nlink=${st.nlink})`,
      }
    }
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      const code = getErrnoCode(e)
      if (code === 'ELOOP' || code === 'ENOTDIR') {
        return {
          ok: false,
          reason: `destination path does not resolve (${code})`,
        }
      }
      throw e
    }
    // ENOENT: restore may create — densable still runs parent check below
  }
  if (expectedRealParentDir !== undefined) {
    const parent = dirname(destPath)
    let parentReal: string | undefined
    try {
      parentReal = await realpath(parent)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ELOOP' || code === 'ENOTDIR') {
        return {
          ok: false,
          reason: `parent path does not resolve (${code})`,
        }
      }
      if (!isENOENT(e)) throw e
      // densable + #1775: dangling parent symlink / walk up for realpath reconstruction
      try {
        const parentLstat = await lstat(parent)
        if (parentLstat.isSymbolicLink()) {
          return { ok: false, reason: 'parent directory is a dangling symlink' }
        }
      } catch (inner: unknown) {
        if (!isENOENT(inner)) throw inner
      }
      let walk = parent
      for (;;) {
        const up = dirname(walk)
        if (up === walk) break
        walk = up
        let walkLstat
        try {
          walkLstat = await lstat(walk)
        } catch (inner: unknown) {
          if (!isENOENT(inner)) throw inner
          continue
        }
        if (walkLstat.isSymbolicLink()) {
          try {
            const walkReal = await realpath(walk)
            parentReal = join(walkReal, relative(walk, parent))
          } catch (inner: unknown) {
            if (isENOENT(inner)) {
              return {
                ok: false,
                reason: 'parent directory is a dangling symlink',
              }
            }
            throw inner
          }
          break
        }
        try {
          const walkReal = await realpath(walk)
          parentReal = join(walkReal, relative(walk, parent))
        } catch (inner: unknown) {
          if (isENOENT(inner)) {
            parentReal = undefined
          } else {
            throw inner
          }
        }
        break
      }
    }
    if (parentReal !== expectedRealParentDir) {
      return {
        ok: false,
        reason: `parent directory moved (${parentReal} != ${expectedRealParentDir})`,
      }
    }
    const parentIdCheck = await verifyParentDirectoryIdentity(
      destPath,
      expectedRealParentDir,
    )
    if (!parentIdCheck.ok) {
      return parentIdCheck
    }
    try {
      const parentStat = await stat(parent)
      if (!parentStat.isDirectory()) {
        return { ok: false, reason: 'parent path is not a directory' }
      }
    } catch (e: unknown) {
      if (!isENOENT(e)) throw e
    }
  }
  return { ok: true }
}

/**
 * Applies the given file snapshot state to the tracked files (writes/deletes
 * on disk), returning changed paths and densable skippedLinks count.
 */
async function applySnapshot(
  state: FileHistoryState,
  targetSnapshot: FileHistorySnapshot,
): Promise<{ filesChanged: string[]; skippedLinks: number }> {
  const filesChanged: string[] = []
  let skippedLinks = 0
  for (const trackingPath of state.trackedFiles) {
    try {
      const filePath = maybeExpandFilePath(trackingPath)
      const targetBackup = targetSnapshot.trackedFileBackups[trackingPath]
      const resolvedBackup =
        targetBackup ?? getFirstVersionBackup(trackingPath, state)

      const backupFileName: BackupFileName | undefined =
        resolvedBackup?.backupFileName

      if (backupFileName === undefined) {
        // Error resolving the backup, so don't touch the file
        logError(
          new Error('FileHistory: Error finding the backup file to apply'),
        )
        logEvent('tengu_file_history_rewind_restore_file_failed', {
          dryRun: false,
        })
        continue
      }

      // densable Q3g before any unlink/restore (optional realParentDir from backup)
      const expectedParent = resolvedBackup?.realParentDir
      const safety = await assertRewindDestinationSafe(filePath, expectedParent)
      if (!safety.ok) {
        skippedLinks++
        logEvent('tengu_file_history_rewind_restore_file_failed', {
          dryRun: false,
        })
        logForDebugging(
          `FileHistory: [Rewind] Refusing to touch ${filePath}: ${safety.reason}`,
          { level: 'error' },
        )
        continue
      }

      if (backupFileName === null) {
        // File did not exist at the target version; delete it safely via
        // O_DIRECTORY | O_NOFOLLOW parent anchor (#1775).
        try {
          const unlinkResult = await safeUnlinkTrackedFile(
            filePath,
            expectedParent,
          )
          if (typeof unlinkResult === 'object' && 'refused' in unlinkResult) {
            skippedLinks++
            logEvent('tengu_file_history_rewind_restore_file_failed', {
              dryRun: false,
            })
            logForDebugging(
              `FileHistory: [Rewind] Refusing to delete ${filePath}: ${unlinkResult.refused}`,
              { level: 'error' },
            )
            continue
          }
          if (unlinkResult === 'deleted') {
            logForDebugging(`FileHistory: [Rewind] Deleted ${filePath}`)
            filesChanged.push(filePath)
          }
        } catch (e: unknown) {
          const code = getErrnoCode(e)
          if (code === 'ENOTDIR' || code === 'ELOOP' || code === 'EISDIR') {
            skippedLinks++
            logEvent('tengu_file_history_rewind_restore_file_failed', {
              dryRun: false,
            })
            logForDebugging(
              `FileHistory: [Rewind] Refusing to delete ${filePath}: path does not resolve or is not a regular file (${code})`,
              { level: 'error' },
            )
            continue
          }
          if (code === 'EPERM') {
            const d = await lstat(filePath).catch(() => undefined)
            if (d !== undefined && !d.isFile()) {
              skippedLinks++
              logEvent('tengu_file_history_rewind_restore_file_failed', {
                dryRun: false,
              })
              logForDebugging(
                `FileHistory: [Rewind] Refusing to delete ${filePath}: destination is not a regular file (EPERM)`,
                { level: 'error' },
              )
              continue
            }
          }
          if (!isENOENT(e)) throw e
          // Already absent; nothing to do.
        }
        continue
      }

      // File should exist at a specific version. Restore only if it differs.
      if (await checkOriginFileChanged(filePath, backupFileName)) {
        // densable Z3g — O_NOFOLLOW restore; refused counts as skippedLinks
        const outcome = await restoreBackupNoFollow(
          filePath,
          backupFileName,
          expectedParent,
        )
        if (outcome === 'restored') {
          logForDebugging(
            `FileHistory: [Rewind] Restored ${filePath} from ${backupFileName}`,
          )
          filesChanged.push(filePath)
        } else if (outcome === 'refused') {
          skippedLinks++
        }
        // backup-missing: telemetry only (not skippedLinks)
      }
    } catch (error) {
      logError(error)
      logEvent('tengu_file_history_rewind_restore_file_failed', {
        dryRun: false,
      })
    }
  }
  return { filesChanged, skippedLinks }
}

/**
 * Checks if the original file has been changed compared to the backup file.
 * Optionally reuses a pre-fetched stat for the original file (when the caller
 * already stat'd it to check existence, we avoid a second syscall).
 *
 * Exported for testing.
 */
export async function checkOriginFileChanged(
  originalFile: string,
  backupFileName: string,
  originalStatsHint?: Stats,
): Promise<boolean> {
  const backupPath = resolveBackupPath(backupFileName)

  let originalStats: Stats | null = originalStatsHint ?? null
  if (!originalStats) {
    try {
      originalStats = await stat(originalFile)
    } catch (e: unknown) {
      if (!isENOENT(e)) return true
    }
  }
  let backupStats: Stats | null = null
  try {
    backupStats = await stat(backupPath)
  } catch (e: unknown) {
    if (!isENOENT(e)) return true
  }

  return compareStatsAndContent(originalStats, backupStats, async () => {
    try {
      const [originalContent, backupContent] = await Promise.all([
        readFile(originalFile, 'utf-8'),
        readFile(backupPath, 'utf-8'),
      ])
      return originalContent !== backupContent
    } catch {
      // File deleted between stat and read -> treat as changed.
      return true
    }
  })
}

/**
 * Shared stat/content comparison logic for sync and async change checks.
 * Returns true if the file has changed relative to the backup.
 */
function compareStatsAndContent<T extends boolean | Promise<boolean>>(
  originalStats: Stats | null,
  backupStats: Stats | null,
  compareContent: () => T,
): T | boolean {
  // One exists, one missing -> changed
  if ((originalStats === null) !== (backupStats === null)) {
    return true
  }
  // Both missing -> no change
  if (originalStats === null || backupStats === null) {
    return false
  }

  // Check file stats like permission and file size
  if (
    originalStats.mode !== backupStats.mode ||
    originalStats.size !== backupStats.size
  ) {
    return true
  }

  // This is an optimization that depends on the correct setting of the modified
  // time. If the original file's modified time was before the backup time, then
  // we can skip the file content comparison.
  if (originalStats.mtimeMs < backupStats.mtimeMs) {
    return false
  }

  // Use the more expensive file content comparison. The callback handles its
  // own read errors — a try/catch here is dead for async callbacks anyway.
  return compareContent()
}

/**
 * Read a file for diff stats, distinguishing ENOENT (genuinely absent) from
 * read failures (EACCES, EIO, EISDIR, etc.) so unreadable files degrade to
 * `hasUncheckedFiles` instead of falsely diffing against empty content (#2085).
 */
async function readFileForDiffStats(
  path: string,
): Promise<
  { ok: true; content: string | null } | { ok: false; error: unknown }
> {
  try {
    return { ok: true, content: await readFile(path, 'utf-8') }
  } catch (error) {
    if (isENOENT(error)) {
      return { ok: true, content: null }
    }
    return { ok: false, error }
  }
}

/**
 * Computes the number of lines changed in the diff.
 */
async function computeDiffStatsForFile(
  originalFile: string,
  backupFileName?: string,
): Promise<DiffStats> {
  const filesChanged: string[] = []
  let insertions = 0
  let deletions = 0
  try {
    const backupPath = backupFileName
      ? resolveBackupPath(backupFileName)
      : undefined

    const [originalRead, backupRead] = await Promise.all([
      readFileForDiffStats(originalFile),
      backupPath
        ? readFileForDiffStats(backupPath)
        : Promise.resolve({ ok: true as const, content: null }),
    ])

    if (!originalRead.ok || !backupRead.ok) {
      return {
        filesChanged,
        insertions,
        deletions,
        hasUncheckedFiles: true,
      }
    }

    const originalContent = originalRead.content
    const backupContent = backupRead.content

    if (originalContent === backupContent) {
      return {
        filesChanged,
        insertions,
        deletions,
      }
    }

    filesChanged.push(originalFile)

    // Compute the diff
    const changes = diffLines(originalContent ?? '', backupContent ?? '')
    changes.forEach(c => {
      if (c.added) {
        insertions += c.count || 0
      }
      if (c.removed) {
        deletions += c.count || 0
      }
    })
  } catch (error) {
    logError(new Error(`FileHistory: Error generating diffStats: ${error}`))
    return {
      filesChanged,
      insertions,
      deletions,
      hasUncheckedFiles: true,
    }
  }

  return {
    filesChanged,
    insertions,
    deletions,
  }
}

function getBackupFileName(filePath: string, version: number): string {
  const fileNameHash = createHash('sha256')
    .update(filePath)
    .digest('hex')
    .slice(0, 16)
  return `${fileNameHash}@v${version}`
}

function resolveBackupPath(backupFileName: string, sessionId?: string): string {
  const configDir = getClaudeConfigHomeDir()
  return join(
    configDir,
    'file-history',
    sessionId || getSessionId(),
    backupFileName,
  )
}

/**
 * Creates a backup of the file at filePath. If the file does not exist
 * (ENOENT), records a null backup (file-did-not-exist marker). All IO is
 * async. Lazy mkdir: tries copyFile first, creates the directory on ENOENT.
 */
async function createBackup(
  filePath: string | null,
  version: number,
): Promise<FileHistoryBackup> {
  if (filePath === null) {
    return { backupFileName: null, version, backupTime: new Date() }
  }

  const backupFileName = getBackupFileName(filePath, version)
  const backupPath = resolveBackupPath(backupFileName)

  // Stat first: if the source is missing, record a null backup and skip the
  // copy. Separates "source missing" from "backup dir missing" cleanly —
  // sharing a catch for both meant a file deleted between copyFile-success
  // and stat would leave an orphaned backup with a null state record.
  let srcStats: Stats
  try {
    srcStats = await stat(filePath)
  } catch (e: unknown) {
    if (isENOENT(e)) {
      const realParentDir = await resolveRealParentDir(filePath)
      return {
        backupFileName: null,
        version,
        backupTime: new Date(),
        realParentDir,
      }
    }
    throw e
  }

  // copyFile preserves content and avoids reading the whole file into the JS
  // heap (which the previous readFileSync+writeFileSync pipeline did, OOMing
  // on large tracked files). Lazy mkdir: 99% of calls hit the fast path
  // (directory already exists); on ENOENT, mkdir then retry.
  try {
    await copyFile(filePath, backupPath)
  } catch (e: unknown) {
    if (!isENOENT(e)) throw e
    await mkdir(dirname(backupPath), { recursive: true })
    await copyFile(filePath, backupPath)
  }

  // Preserve file permissions on the backup.
  await chmod(backupPath, srcStats.mode)

  logEvent('tengu_file_history_backup_file_created', {
    version: version,
    fileSize: srcStats.size,
  })

  // densable + #1775 realParentDir — canonical ancestor-resolved parent dir
  const realParentDir = await resolveRealParentDir(filePath)

  return {
    backupFileName,
    version,
    backupTime: new Date(),
    realParentDir,
  }
}

/**
 * densable Z3g — restore backup with O_NOFOLLOW open flags so restore never
 * writes through a symlink/hardlink race. Returns:
 * - restored: content written
 * - refused: link-safety refuse (counts as skippedLinks)
 * - backup-missing: telemetry only (not skippedLinks)
 */
export async function restoreBackupNoFollow(
  filePath: string,
  backupFileName: string,
  expectedRealParentDir?: string,
): Promise<'restored' | 'refused' | 'backup-missing'> {
  const backupPath = resolveBackupPath(backupFileName)
  const refuse = (detail: string): 'refused' => {
    logEvent('tengu_file_history_rewind_restore_file_failed', {
      dryRun: false,
    })
    logForDebugging(
      `FileHistory: [Rewind] Refusing to restore ${filePath}: ${detail}`,
      { level: 'error' },
    )
    return 'refused'
  }

  let backupStats: Stats
  try {
    backupStats = await stat(backupPath)
  } catch (e: unknown) {
    if (isENOENT(e)) {
      logEvent('tengu_file_history_rewind_restore_file_failed', {
        dryRun: false,
      })
      logForDebugging(
        `FileHistory: [Rewind] Backup file not found: ${backupPath}`,
        { level: 'error' },
      )
      return 'backup-missing'
    }
    throw e
  }
  if (!backupStats.isFile()) {
    return refuse('backup source is not a regular file')
  }

  const O_NONBLOCK = fsConstants.O_NONBLOCK ?? 0
  const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
  let backupFd: Awaited<ReturnType<typeof open>>
  try {
    backupFd = await open(
      backupPath,
      fsConstants.O_RDONLY | O_NONBLOCK | O_NOFOLLOW,
    )
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ELOOP' || code === 'EMLINK') {
      return refuse('backup source became a symlink (O_NOFOLLOW)')
    }
    throw e
  }

  try {
    if (!(await backupFd.stat()).isFile()) {
      return refuse('backup source is not a regular file')
    }

    const destFlags =
      fsConstants.O_WRONLY | fsConstants.O_CREAT | O_NOFOLLOW | O_NONBLOCK
    const isNofollowError = (err: unknown): boolean => {
      const code = getErrnoCode(err)
      return code === 'ELOOP' || code === 'EMLINK'
    }
    const isFifoError = (err: unknown): boolean => getErrnoCode(err) === 'ENXIO'
    const isPathTypeError = (err: unknown): boolean => {
      const code = getErrnoCode(err)
      return code === 'EISDIR' || code === 'ENOTDIR'
    }
    const mode = backupStats.mode & 0o777

    let destFd: Awaited<ReturnType<typeof open>>
    try {
      destFd = await open(filePath, destFlags, mode)
    } catch (e: unknown) {
      if (isNofollowError(e)) {
        return refuse('destination became a symlink (O_NOFOLLOW)')
      }
      if (isFifoError(e)) {
        return refuse('destination became a FIFO (ENXIO)')
      }
      if (isPathTypeError(e)) {
        return refuse(
          `destination path was changed during restore (${getErrnoCode(e)})`,
        )
      }
      if (!isENOENT(e)) throw e
      if (expectedRealParentDir !== undefined) {
        const parentNow = await realpath(dirname(filePath)).catch(
          () => undefined,
        )
        // densable eVr parent-chain check before mkdir
        if (parentNow !== undefined && parentNow !== expectedRealParentDir) {
          return refuse('parent chain changed before directory creation')
        }
      }
      try {
        await mkdir(dirname(filePath), { recursive: true })
      } catch (mkdirErr: unknown) {
        if (isPathTypeError(mkdirErr) || getErrnoCode(mkdirErr) === 'EEXIST') {
          return refuse(
            `destination path was changed during restore (${getErrnoCode(mkdirErr)})`,
          )
        }
        throw mkdirErr
      }
      try {
        destFd = await open(filePath, destFlags, mode)
      } catch (e2: unknown) {
        if (isNofollowError(e2)) {
          return refuse('destination became a symlink (O_NOFOLLOW)')
        }
        if (isFifoError(e2)) {
          return refuse('destination became a FIFO (ENXIO)')
        }
        if (isPathTypeError(e2)) {
          return refuse(
            `destination path was changed during restore (${getErrnoCode(e2)})`,
          )
        }
        throw e2
      }
    }

    try {
      const destStat = await destFd.stat({ bigint: true })
      if (!destStat.isFile()) {
        return refuse('destination is not a regular file')
      }
      if (destStat.nlink > 1n) {
        return refuse(
          `destination is hard-linked (nlink=${destStat.nlink.toString()})`,
        )
      }
      if (expectedRealParentDir !== undefined) {
        const parentNow = await realpath(dirname(filePath)).catch(
          () => undefined,
        )
        if (parentNow !== expectedRealParentDir) {
          return refuse('parent directory changed during restore')
        }
      }
      const pathLstat = await lstat(filePath, { bigint: true }).catch(
        () => undefined,
      )
      if (
        pathLstat === undefined ||
        !pathLstat.isFile() ||
        pathLstat.dev !== destStat.dev ||
        (destStat.ino !== 0n && pathLstat.ino !== destStat.ino)
      ) {
        return refuse(
          'destination changed identity during restore (fd/path mismatch)',
        )
      }

      await destFd.truncate(0)
      const buf = Buffer.allocUnsafe(65536)
      for (;;) {
        const { bytesRead } = await backupFd.read(buf, 0, buf.length, null)
        if (bytesRead === 0) break
        let offset = 0
        while (offset < bytesRead) {
          const { bytesWritten } = await destFd.write(
            buf,
            offset,
            bytesRead - offset,
          )
          if (bytesWritten === 0) {
            throw new Error('write returned 0 bytes with data remaining')
          }
          offset += bytesWritten
        }
      }
      await destFd.chmod(backupStats.mode)
    } finally {
      await destFd.close()
    }
  } finally {
    await backupFd.close()
  }
  return 'restored'
}

/**
 * Gets the full first (earliest) backup record for a file (including
 * `realParentDir`), used when rewinding to a target snapshot where the file
 * was not yet tracked (#1775).
 */
function getFirstVersionBackup(
  trackingPath: string,
  state: FileHistoryState,
): FileHistoryBackup | undefined {
  for (const snapshot of state.snapshots) {
    const backup = snapshot.trackedFileBackups[trackingPath]
    if (backup !== undefined && backup.version === 1) {
      return backup
    }
  }
  return undefined
}

/**
 * Gets the first (earliest) backup version for a file, used when rewinding
 * to a target backup point where the file has not been tracked yet.
 *
 * @returns The backup file name for the first version, or null if the file
 * did not exist in the first version, or undefined if we cannot find a
 * first version at all
 */
function getBackupFileNameFirstVersion(
  trackingPath: string,
  state: FileHistoryState,
): BackupFileName | undefined {
  // This can be either a file name or null, with null meaning the file
  // did not exist in the first version, or undefined if we cannot find a
  // first version at all.
  return getFirstVersionBackup(trackingPath, state)?.backupFileName
}

/**
 * Use the relative path as the key to reduce session storage space for tracking.
 */
function maybeShortenFilePath(filePath: string): string {
  if (!isAbsolute(filePath)) {
    return filePath
  }
  const cwd = getOriginalCwd()
  if (filePath.startsWith(cwd)) {
    return relative(cwd, filePath)
  }
  return filePath
}

function maybeExpandFilePath(filePath: string): string {
  if (isAbsolute(filePath)) {
    return filePath
  }
  return join(getOriginalCwd(), filePath)
}

/**
 * Restores file history snapshot state for a given log option.
 */
export function fileHistoryRestoreStateFromLog(
  fileHistorySnapshots: FileHistorySnapshot[],
  onUpdateState: (newState: FileHistoryState) => void,
): void {
  if (!fileHistoryEnabled()) {
    return
  }
  // Make a copy of the snapshots as we migrate from absolute path to
  // shortened relative tracking path.
  const snapshots: FileHistorySnapshot[] = []
  // Rebuild the tracked files from the snapshots
  const trackedFiles = new Set<string>()
  for (const snapshot of fileHistorySnapshots) {
    const trackedFileBackups: Record<string, FileHistoryBackup> = {}
    for (const [path, backup] of Object.entries(snapshot.trackedFileBackups)) {
      const trackingPath = maybeShortenFilePath(path)
      trackedFiles.add(trackingPath)
      trackedFileBackups[trackingPath] = backup
    }
    snapshots.push({
      ...snapshot,
      trackedFileBackups: trackedFileBackups,
    })
  }
  onUpdateState({
    snapshots: snapshots,
    trackedFiles: trackedFiles,
    snapshotSequence: snapshots.length,
  })
}

/**
 * Copy file history snapshots for a given log option.
 */
export async function copyFileHistoryForResume(log: LogOption): Promise<void> {
  if (!fileHistoryEnabled()) {
    return
  }

  const fileHistorySnapshots = log.fileHistorySnapshots
  if (!fileHistorySnapshots || log.messages.length === 0) {
    return
  }
  const lastMessage = log.messages[log.messages.length - 1]
  const previousSessionId = log.forkedFromSessionId ?? lastMessage?.sessionId
  if (!previousSessionId) {
    logError(
      new Error(
        `FileHistory: Failed to copy backups on restore (no previous session id)`,
      ),
    )
    return
  }

  const sessionId = getSessionId()
  if (previousSessionId === sessionId) {
    logForDebugging(
      `FileHistory: No need to copy file history for resuming with same session id: ${sessionId}`,
    )
    return
  }

  try {
    // All backups share the same directory: {configDir}/file-history/{sessionId}/
    // Create it once upfront instead of once per backup file
    const newBackupDir = join(
      getClaudeConfigHomeDir(),
      'file-history',
      sessionId,
    )
    await mkdir(newBackupDir, { recursive: true })

    // Migrate all backup files from the previous session to current session.
    // Process all snapshots in parallel; within each snapshot, links also run in parallel.
    let failedSnapshots = 0
    await Promise.allSettled(
      fileHistorySnapshots.map(async snapshot => {
        const backupEntries = Object.values(snapshot.trackedFileBackups).filter(
          (backup): backup is typeof backup & { backupFileName: string } =>
            backup.backupFileName !== null,
        )

        const results = await Promise.allSettled(
          backupEntries.map(async ({ backupFileName }) => {
            const oldBackupPath = resolveBackupPath(
              backupFileName,
              previousSessionId,
            )
            const newBackupPath = join(newBackupDir, backupFileName)

            try {
              await link(oldBackupPath, newBackupPath)
            } catch (e: unknown) {
              const code = getErrnoCode(e)
              if (code === 'EEXIST') {
                // Already migrated, skip
                return
              }
              if (code === 'ENOENT') {
                logError(
                  new Error(
                    `FileHistory: Failed to copy backup ${backupFileName} on restore (backup file does not exist in ${previousSessionId})`,
                  ),
                )
                throw e
              }
              logError(
                new Error(
                  `FileHistory: Error hard linking backup file from previous session`,
                ),
              )
              // Fallback to copy if hard link fails
              try {
                await copyFile(oldBackupPath, newBackupPath)
              } catch (copyErr) {
                logError(
                  new Error(
                    `FileHistory: Error copying over backup from previous session`,
                  ),
                )
                throw copyErr
              }
            }

            logForDebugging(
              `FileHistory: Copied backup ${backupFileName} from session ${previousSessionId} to ${sessionId}`,
            )
          }),
        )

        const copyFailed = results.some(r => r.status === 'rejected')

        // Record the snapshot only if we have successfully migrated the backup files
        if (!copyFailed) {
          void recordFileHistorySnapshot(
            snapshot.messageId,
            snapshot,
            false, // isSnapshotUpdate
          ).catch(_ => {
            logError(
              new Error(`FileHistory: Failed to record copy backup snapshot`),
            )
          })
        } else {
          failedSnapshots++
        }
      }),
    )

    if (failedSnapshots > 0) {
      logEvent('tengu_file_history_resume_copy_failed', {
        numSnapshots: fileHistorySnapshots.length,
        failedSnapshots,
      })
    }
  } catch (error) {
    logError(error)
  }
}

/**
 * Notifies VSCode about files that have changed between snapshots.
 * Compares the previous snapshot with the new snapshot and sends file_updated
 * notifications for any files whose content has changed.
 * Fire-and-forget (void-dispatched from fileHistoryMakeSnapshot).
 */
async function notifyVscodeSnapshotFilesUpdated(
  oldState: FileHistoryState,
  newState: FileHistoryState,
): Promise<void> {
  const oldSnapshot = oldState.snapshots.at(-1)
  const newSnapshot = newState.snapshots.at(-1)

  if (!newSnapshot) {
    return
  }

  for (const trackingPath of newState.trackedFiles) {
    const filePath = maybeExpandFilePath(trackingPath)
    const oldBackup = oldSnapshot?.trackedFileBackups[trackingPath]
    const newBackup = newSnapshot.trackedFileBackups[trackingPath]

    // Skip if both backups reference the same version (no change)
    if (
      oldBackup?.backupFileName === newBackup?.backupFileName &&
      oldBackup?.version === newBackup?.version
    ) {
      continue
    }

    // Get old content from the previous backup
    let oldContent: string | null = null
    if (oldBackup?.backupFileName) {
      const backupPath = resolveBackupPath(oldBackup.backupFileName)
      oldContent = await readFileAsyncOrNull(backupPath)
    }

    // Get new content from the new backup or current file
    let newContent: string | null = null
    if (newBackup?.backupFileName) {
      const backupPath = resolveBackupPath(newBackup.backupFileName)
      newContent = await readFileAsyncOrNull(backupPath)
    }
    // If newBackup?.backupFileName === null, the file was deleted; newContent stays null.

    // Only notify if content actually changed
    if (oldContent !== newContent) {
      notifyVscodeFileUpdated(filePath, oldContent, newContent)
    }
  }
}

/** Async read that swallows all errors and returns null (best-effort). */
async function readFileAsyncOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

const ENABLE_DUMP_STATE = false
function maybeDumpStateForDebug(state: FileHistoryState): void {
  if (ENABLE_DUMP_STATE) {
    console.error(inspect(state, false, 5))
  }
}
