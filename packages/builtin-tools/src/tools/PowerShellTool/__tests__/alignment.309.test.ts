import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import type { ToolUseContext } from 'src/Tool.js'
import { powershellToolHasPermission } from '../powershellPermissions.js'

function makeContext(): ToolUseContext {
  return {
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode: 'default',
      },
    }),
  } as unknown as ToolUseContext
}

describe('#1158 Set-Location / cd targeting CWD with extra args prompts', () => {
  test('Set-Location . with extra non-safe arg prompts for approval', async () => {
    const result = await powershellToolHasPermission(
      {
        command:
          'Set-Location . -ErrorAction SilentlyContinue -OutVariable foo',
      },
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })

  test('cd . with extra positional arg prompts for approval', async () => {
    const result = await powershellToolHasPermission(
      { command: 'cd . extraArg' },
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
  })
})
