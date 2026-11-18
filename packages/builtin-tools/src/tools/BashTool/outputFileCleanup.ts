import {
  copyFile,
  link,
  stat as fsStat,
  truncate as fsTruncate,
  unlink,
} from 'fs/promises'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage, getErrnoCode } from 'src/utils/errors.js'
import {
  ensureToolResultsDir,
  getToolResultPath,
} from 'src/utils/toolResultStorage.js'

export const MAX_PERSISTED_OUTPUT_SIZE = 64 * 1024 * 1024

export type OutputFileCleanup = {
  track(result: {
    outputTaskId?: string
    backgroundTaskId?: string
    outputFileSize?: number
    outputFilePath?: string
  }): void
  copyFailed(err: unknown, dirErr?: unknown): void
  dispose(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

/**
 * SEA `ESo` (@292277975) — tracks a large command's temporary output file so
 * it is cleaned up on exit, EXCEPT when copying to tool-results fails for a
 * reason other than disk/quota full (ENOSPC/EDQUOT), in which case we keep it.
 */
export function createOutputFileCleanup(taskRegistry?: {
  get(id: string): unknown
}): OutputFileCleanup {
  let trackedPath: string | undefined

  async function dispose(): Promise<void> {
    if (trackedPath === undefined) return
    const pathToDelete = trackedPath
    trackedPath = undefined
    try {
      await unlink(pathToDelete)
    } catch (err) {
      if (getErrnoCode(err) !== 'ENOENT') {
        logForDebugging(
          `Could not delete the output file ${pathToDelete}: ${errorMessage(err)}`,
          {
            level: 'error',
          },
        )
      }
    }
  }

  return {
    track(result) {
      const taskId = result.outputTaskId
      const inRegistry =
        taskId !== undefined && taskRegistry?.get(taskId) !== undefined
      if (
        result.backgroundTaskId === undefined &&
        (result.outputFileSize ?? 0) > 0 &&
        !inRegistry
      ) {
        trackedPath = result.outputFilePath
      }
    },
    copyFailed(err, dirErr) {
      const actualErr =
        getErrnoCode(err) === 'ENOENT' && dirErr !== undefined ? dirErr : err
      const code = getErrnoCode(actualErr)
      const isDiskFull = code === 'ENOSPC' || code === 'EDQUOT'
      if (actualErr !== undefined && trackedPath !== undefined) {
        logForDebugging(
          `Could not copy ${trackedPath} to the session's tool-results folder (${errorMessage(actualErr)}). ${
            isDiskFull
              ? 'Deleting it because the disk or quota is full.'
              : 'Keeping it.'
          }`,
        )
      }
      if (!isDiskFull) {
        trackedPath = undefined
      }
    },
    dispose,
    [Symbol.asyncDispose]: dispose,
  }
}

/**
 * SEA `Rrn` (@292271732) core — persists a large command's output file to
 * tool-results/, notifying `cleanup.copyFailed(err, dirErr)` on failure.
 */
export async function persistLargeOutputFile(
  result: { outputFilePath?: string; outputTaskId?: string },
  cleanup?: OutputFileCleanup,
): Promise<{
  persistedOutputPath: string | undefined
  persistedOutputSize: number | undefined
}> {
  if (!result.outputFilePath || !result.outputTaskId) {
    return { persistedOutputPath: undefined, persistedOutputSize: undefined }
  }
  let dirErr: unknown
  try {
    const fileStat = await fsStat(result.outputFilePath)
    const persistedOutputSize = fileStat.size

    try {
      await ensureToolResultsDir()
    } catch (e) {
      dirErr = e
    }

    const dest = getToolResultPath(result.outputTaskId, false)
    if (fileStat.size > MAX_PERSISTED_OUTPUT_SIZE) {
      await fsTruncate(result.outputFilePath, MAX_PERSISTED_OUTPUT_SIZE)
    }
    try {
      await link(result.outputFilePath, dest)
    } catch {
      await copyFile(result.outputFilePath, dest)
    }
    return { persistedOutputPath: dest, persistedOutputSize }
  } catch (err) {
    cleanup?.copyFailed(err, dirErr)
    return { persistedOutputPath: undefined, persistedOutputSize: undefined }
  }
}
