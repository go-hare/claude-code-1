import { describe, expect, test } from 'bun:test'
import {
  addDirHelpMessage,
  validateDirectoryForWorkspace,
} from '../validation.js'
import type { ToolPermissionContext } from '../../../Tool.js'

const emptyContext = {
  additionalWorkingDirectories: new Map(),
} as ToolPermissionContext

describe('workspace directory validate (251 #34 mbe/gbe)', () => {
  test('a null-byte path is invalidPath with containsNullByte', async () => {
    const result = await validateDirectoryForWorkspace(
      '/tmp/bad\0dir',
      emptyContext,
    )
    expect(result).toEqual({
      resultType: 'invalidPath',
      directoryPath: '/tmp/bad\0dir',
      containsNullByte: true,
    })
    expect(addDirHelpMessage(result)).toContain('null character')
  })

  test('gbe names the null-character sentence', () => {
    const nullByte = addDirHelpMessage({
      resultType: 'invalidPath',
      directoryPath: '/tmp/x',
      containsNullByte: true,
    })
    expect(nullByte).toContain('null character')
    expect(nullByte).toContain('/tmp/x')
    const unresolved = addDirHelpMessage({
      resultType: 'invalidPath',
      directoryPath: '/tmp/x',
      containsNullByte: false,
    })
    expect(unresolved).toContain("couldn't be resolved")
    expect(unresolved).toContain('/tmp/x')
  })
})
