import { describe, expect, test } from 'bun:test'
import {
  type GitBashDiscoveryDeps,
  findGitBashPathOrNullWithDeps,
} from '../windowsPaths.js'

describe('findGitBashPathOrNullWithDeps Windows launcher regression', () => {
  test.each([
    'C:\\Windows\\System32\\bash.exe',
    'C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe',
  ])('rejects non-Git Windows bash launcher: %s', launcherPath => {
    const gitPath = 'D:\\app\\Git\\cmd\\git.exe'
    const gitBashPath = 'D:\\app\\Git\\bin\\bash.exe'
    const existingPaths = new Set([launcherPath, gitBashPath])
    const deps: GitBashDiscoveryDeps = {
      checkExists: path => existingPaths.has(path),
      execCommand: command => {
        if (command.includes('where.exe bash')) return launcherPath
        if (command.includes('where.exe git')) return gitPath
        return ''
      },
      cwdFn: () => 'D:\\work\\project',
      envOverride: '',
    }

    expect(findGitBashPathOrNullWithDeps(deps)).toBe(gitBashPath)
  })
})
