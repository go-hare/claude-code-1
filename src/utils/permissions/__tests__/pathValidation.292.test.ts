import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import { z } from 'zod'

;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { isDangerousRemovalPath } from '../pathValidation.js'
import { checkReadPermissionForTool } from '../filesystem.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { hasPermissionsToUseTool } from '../permissions.js'

describe('2.1.292 #204 isDangerousRemovalPath Windows 8.3 & normalization', () => {
  test('treats standard dangerous paths as dangerous', () => {
    expect(isDangerousRemovalPath('*')).toBe(true)
    expect(isDangerousRemovalPath('/tmp/*')).toBe(true)
    expect(isDangerousRemovalPath('/')).toBe(true)
    expect(isDangerousRemovalPath('/usr')).toBe(true)
    expect(isDangerousRemovalPath(homedir())).toBe(true)
    expect(isDangerousRemovalPath('C:\\')).toBe(true)
    expect(isDangerousRemovalPath('C:\\Windows')).toBe(true)
    expect(isDangerousRemovalPath('C:\\Users\\alice\\project')).toBe(false)
  })

  test('normalizes NT device prefixes, localhost admin shares, and trailing dots/spaces', () => {
    expect(isDangerousRemovalPath('\\\\?\\C:\\')).toBe(true)
    expect(isDangerousRemovalPath('//./C:/Windows')).toBe(true)
    expect(isDangerousRemovalPath('\\\\localhost\\c$\\')).toBe(true)
    expect(isDangerousRemovalPath('\\\\127.0.0.1\\c$\\Users')).toBe(true)
    expect(isDangerousRemovalPath('C:\\Windows. .')).toBe(true)
    expect(isDangerousRemovalPath('\\\\192.168.1.10\\c$\\foo')).toBe(true)
    expect(isDangerousRemovalPath('\\\\server\\admin$\\foo')).toBe(true)
  })

  test('detects Windows 8.3 / case / dot-segment variants of home directory', () => {
    const home = homedir()
    const withDot = join(home, '.')
    expect(isDangerousRemovalPath(withDot)).toBe(true)
    expect(isDangerousRemovalPath(`${home}/`)).toBe(true)
  })
})

describe('2.1.292 #205 UNC / network read safetyCheck blocks hook allow and bypass', () => {
  test('checkReadPermissionForTool returns non-classifier-approvable safetyCheck for UNC path', () => {
    const tool = {
      name: FILE_READ_TOOL_NAME,
      getPath: (input: { file_path?: string }) => input.file_path ?? '',
    }
    const result = checkReadPermissionForTool(
      tool as never,
      { file_path: '//fileserver/share/secret.txt' },
      getEmptyToolPermissionContext(),
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.decisionReason).toEqual({
        type: 'safetyCheck',
        classifierApprovable: false,
        reason: 'UNC path detected (defense-in-depth check)',
      })
    }
  })

  test('bypassPermissions mode cannot bypass UNC read safetyCheck', async () => {
    const tool = {
      name: FILE_READ_TOOL_NAME,
      inputSchema: z.object({ file_path: z.string() }),
      isConcurrencySafe: () => true,
      isReadOnly: () => true,
      getPath: (input: { file_path?: string }) => input.file_path ?? '',
      checkPermissions: async (
        input: { file_path?: string },
        toolUseCtx: {
          getAppState: () => {
            toolPermissionContext: ReturnType<
              typeof getEmptyToolPermissionContext
            >
          }
        },
      ) =>
        checkReadPermissionForTool(
          tool as never,
          input,
          toolUseCtx.getAppState().toolPermissionContext,
        ),
    }
    const ctx = {
      abortController: new AbortController(),
      options: { tools: [tool] },
      getAppState: () => ({
        toolPermissionContext: {
          ...getEmptyToolPermissionContext(),
          mode: 'bypassPermissions' as const,
          isBypassPermissionsModeAvailable: true,
        },
      }),
    }
    const decision = await hasPermissionsToUseTool(
      tool as never,
      { file_path: '//fileserver/share/secret.txt' },
      ctx as never,
      {} as never,
      'test-tool-use-id',
    )
    expect(decision.behavior).toBe('ask')
    if (decision.behavior === 'ask') {
      expect(decision.decisionReason?.type).toBe('safetyCheck')
    }
  })
})
