import { describe, expect, test } from 'bun:test'
import {
  TeleportStashRefusalError,
  checkTrackedFilesReplacedByFolders,
} from './TeleportStash.js'

describe('#65 TeleportStash refuses when a folder replaces a tracked file', () => {
  test('throws TeleportStashRefusalError when lstat reports a directory', async () => {
    const runGit = async (args: string[]) => {
      if (args[0] === 'diff-index') {
        return {
          code: 0,
          stdout: ':100644 000000 abc 000000 D\0src/foo\0',
        }
      }
      return { code: 0, stdout: '' }
    }
    const lstatFn = (async () => ({
      isDirectory: () => true,
    })) as unknown as typeof import('fs/promises').lstat

    await expect(
      checkTrackedFilesReplacedByFolders('/repo', lstatFn, runGit),
    ).rejects.toThrow(TeleportStashRefusalError)

    await expect(
      checkTrackedFilesReplacedByFolders('/repo', lstatFn, runGit),
    ).rejects.toThrow('Nothing was stashed: "src/foo" is now a folder')
  })

  test('passes when deleted tracked file is not a directory on disk', async () => {
    const runGit = async (args: string[]) => {
      if (args[0] === 'diff-index') {
        return {
          code: 0,
          stdout: ':100644 000000 abc 000000 D\0src/foo\0',
        }
      }
      return { code: 0, stdout: '' }
    }
    const lstatFn = (async () => {
      throw new Error('ENOENT')
    }) as unknown as typeof import('fs/promises').lstat

    await expect(
      checkTrackedFilesReplacedByFolders('/repo', lstatFn, runGit),
    ).resolves.toBeUndefined()
  })
})
