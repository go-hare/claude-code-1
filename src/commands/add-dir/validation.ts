import chalk from 'chalk'
import { stat } from 'fs/promises'
import { dirname, resolve } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import { getErrnoCode, hasExactErrorMessage } from '../../utils/errors.js'
import { expandPath } from '../../utils/path.js'
import {
  allWorkingDirectories,
  pathInWorkingPath,
} from '../../utils/permissions/filesystem.js'

export type AddDirectoryResult =
  | {
      resultType: 'success'
      absolutePath: string
    }
  | {
      resultType: 'emptyPath'
    }
  | {
      resultType: 'invalidPath'
      directoryPath: string
      containsNullByte: boolean
    }
  | {
      resultType: 'pathNotFound' | 'notADirectory'
      directoryPath: string
      absolutePath: string
    }
  | {
      resultType: 'alreadyInWorkingDirectory'
      directoryPath: string
      workingDir: string
    }

export async function validateDirectoryForWorkspace(
  directoryPath: string,
  permissionContext: ToolPermissionContext,
): Promise<AddDirectoryResult> {
  if (!directoryPath) {
    return {
      resultType: 'emptyPath',
    }
  }

  // resolve() strips the trailing slash expandPath can leave on absolute
  // inputs, so /foo and /foo/ map to the same storage key (CC-33).
  // densable mbe: expandPath \0 is zk(..., "Path contains null bytes").
  let absolutePath: string
  try {
    absolutePath = resolve(expandPath(directoryPath))
  } catch (err) {
    return {
      resultType: 'invalidPath',
      directoryPath,
      containsNullByte: hasExactErrorMessage(err, 'Path contains null bytes'),
    }
  }

  // Check if path exists and is a directory (single syscall)
  try {
    const stats = await stat(absolutePath)
    if (!stats.isDirectory()) {
      return {
        resultType: 'notADirectory',
        directoryPath,
        absolutePath,
      }
    }
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    // Match prior existsSync() semantics: treat any of these as "not found"
    // rather than re-throwing. EACCES/EPERM in particular must not crash
    // startup when a settings-configured additional directory is inaccessible.
    if (
      code === 'ENOENT' ||
      code === 'ENOTDIR' ||
      code === 'EACCES' ||
      code === 'EPERM'
    ) {
      return {
        resultType: 'pathNotFound',
        directoryPath,
        absolutePath,
      }
    }
    throw e
  }

  // Get current permission context
  const currentWorkingDirs = allWorkingDirectories(permissionContext)

  // Check if already within an existing working directory
  for (const workingDir of currentWorkingDirs) {
    if (pathInWorkingPath(absolutePath, workingDir)) {
      return {
        resultType: 'alreadyInWorkingDirectory',
        directoryPath,
        workingDir,
      }
    }
  }

  return {
    resultType: 'success',
    absolutePath,
  }
}

export function addDirHelpMessage(result: AddDirectoryResult): string {
  switch (result.resultType) {
    case 'emptyPath':
      return 'Please provide a directory path.'
    case 'invalidPath': {
      const path = chalk.bold(result.directoryPath)
      return result.containsNullByte
        ? `Path ${path} contains a null character, so it can't be used as a working directory. Remove the null character from the path or from the settings entry that lists it.`
        : `Path ${path} couldn't be resolved, so it can't be used as a working directory. Check the path or the settings entry that lists it.`
    }
    case 'pathNotFound':
      return `Path ${chalk.bold(result.absolutePath)} was not found.`
    case 'notADirectory': {
      const parentDir = dirname(result.absolutePath)
      return `${chalk.bold(result.directoryPath)} is not a directory. Did you mean to add the parent directory ${chalk.bold(parentDir)}?`
    }
    case 'alreadyInWorkingDirectory':
      return `${chalk.bold(result.directoryPath)} is already accessible within the existing working directory ${chalk.bold(result.workingDir)}.`
    case 'success':
      return `Added ${chalk.bold(result.absolutePath)} as a working directory.`
  }
}
