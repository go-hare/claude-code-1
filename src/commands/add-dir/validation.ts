import chalk from 'chalk'
import { stat } from 'fs/promises'
import { dirname, resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import type { ToolPermissionContext } from '../../Tool.js'
import { getErrnoCode, isENOENT } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
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
      isExactMatch: boolean
      isOriginalCwd: boolean
    }

/** densable zk — mbe callee: exact Error.message, not a substring. */
export function zk(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message
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

  // densable mbe: r=Lat(gt(e)); expandPath \0 is zk(..., "Path contains null bytes")
  let absolutePath: string
  try {
    absolutePath = resolve(expandPath(directoryPath))
  } catch (err) {
    const containsNullByte = zk(err, 'Path contains null bytes')
    if (!containsNullByte) {
      logError(Error('validateDirectoryForWorkspace: expandPath threw'))
    }
    return {
      resultType: 'invalidPath',
      directoryPath,
      containsNullByte,
    }
  }

  try {
    if (!(await stat(absolutePath)).isDirectory()) {
      return {
        resultType: 'notADirectory',
        directoryPath,
        absolutePath,
      }
    }
  } catch (err: unknown) {
    // densable mbe: if(!Rt(d)) h(...unexpected stat errno); always pathNotFound
    if (!isENOENT(err)) {
      logError(
        Object.assign(
          Error('validateDirectoryForWorkspace: unexpected stat errno'),
          { code: getErrnoCode(err) },
        ),
      )
    }
    return {
      resultType: 'pathNotFound',
      directoryPath,
      absolutePath,
    }
  }

  // densable mbe: o=EE(t), u=be(); local EE seeds getOriginalCwd (not getCwd).
  // Gold np(r,d,{caseFold:!1}) body is ABSENT — keep pathInWorkingPath as-is.
  const currentWorkingDirs = allWorkingDirectories(permissionContext)
  const originalCwd = getOriginalCwd()
  for (const workingDir of currentWorkingDirs) {
    if (pathInWorkingPath(absolutePath, workingDir)) {
      return {
        resultType: 'alreadyInWorkingDirectory',
        directoryPath,
        workingDir,
        isExactMatch: resolve(workingDir) === absolutePath,
        isOriginalCwd: workingDir === originalCwd,
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
    case 'alreadyInWorkingDirectory': {
      const path = chalk.bold(result.directoryPath)
      if (result.isExactMatch) {
        return result.isOriginalCwd
          ? `${path} is already the current working directory.`
          : `${path} is already added as a working directory.`
      }
      const within = result.isOriginalCwd
        ? 'the current working directory'
        : 'the additional working directory'
      return `${path} is already accessible within ${within} ${chalk.bold(result.workingDir)}.`
    }
    case 'success':
      return `Added ${chalk.bold(result.absolutePath)} as a working directory.`
  }
}
