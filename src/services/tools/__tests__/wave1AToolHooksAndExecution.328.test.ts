import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import type { Tool } from '../../../Tool.js'
import { getBootstrapSessionHost } from '../../../utils/sessionHost.js'
import {
  applyPermissionUpdatedInput,
  checkMcpToolNotLoaded,
  classifyNotLoadedMcpToolFamily,
  validateUpdatedInputAgainstSchema,
} from '../toolExecution.js'
import {
  isPostToolUseOutputRewriteProtected,
  validateHookUpdatedInput,
  validatePermissionRequestUpdatedInput,
} from '../toolHooks.js'

const origDisklessEnv = process.env.CLAUDE_CODE_DISKLESS

afterEach(() => {
  getBootstrapSessionHost().launchOptions.replaceDiskless(false)
  if (origDisklessEnv === undefined) delete process.env.CLAUDE_CODE_DISKLESS
  else process.env.CLAUDE_CODE_DISKLESS = origDisklessEnv
})

function makeStrictTool(
  name: string,
  validateInput?: (input: Record<string, unknown>) => Promise<{
    result: boolean
    message?: string
    errorCode?: number
  }>,
): Tool {
  return {
    name,
    inputSchema: z.strictObject({
      command: z.string(),
    }),
    validateInput,
  } as unknown as Tool
}

describe('Wave 1A ToolHooks & ToolExecution Parity (P1-#31, P1-#32, P1-#27)', () => {
  test('[P1-#31] permission-handler updatedInput preserves trusted internal keys like _simulatedSedEdit (G3s/XUo)', () => {
    const bashTool = makeStrictTool('Bash')
    const updatedWithInternalKey = {
      command: 'sed -i "s/a/b/" foo.txt',
      _simulatedSedEdit: { filePath: '/tmp/foo.txt', newContent: 'b' },
    }
    const schemaCheck = validateUpdatedInputAgainstSchema(
      bashTool,
      updatedWithInternalKey,
    )
    expect(schemaCheck.ok).toBe(true)

    const applied = applyPermissionUpdatedInput(
      'Bash',
      updatedWithInternalKey,
      { command: 'sed -i "s/a/b/" foo.txt' },
    )
    expect(applied._simulatedSedEdit).toEqual({
      filePath: '/tmp/foo.txt',
      newContent: 'b',
    })

    // ExitPlanMode strips unchanged plan/planFilePath per official XUo
    const exitApplied = applyPermissionUpdatedInput(
      'ExitPlanMode',
      { plan: 'my plan', planFilePath: '/tmp/plan.md', allowedPrompts: [] },
      { plan: 'my plan', planFilePath: '/tmp/plan.md' },
    )
    expect(exitApplied).toEqual({ allowedPrompts: [] })

    // Invalid types still fail schema validation
    const invalidCheck = validateUpdatedInputAgainstSchema(bashTool, {
      command: 123,
    })
    expect(invalidCheck.ok).toBe(false)
  })

  test('[P1-#31] validateHookUpdatedInput & validatePermissionRequestUpdatedInput reject __artifact* keys, strip unrecognized keys, and re-run tool.validateInput()', async () => {
    let validatedWith: Record<string, unknown> | undefined
    const tool = makeStrictTool('Bash', async parsed => {
      validatedWith = parsed
      if (parsed.command === 'bad-cmd') {
        return { result: false, message: 'forbidden command', errorCode: 42 }
      }
      return { result: true }
    })

    // 1. Reject __artifact* reserved keys (any case) on PreToolUse
    const reservedPre = await validateHookUpdatedInput(
      tool,
      { command: 'ls', __ArtifactMint: true },
      {
        event: 'PreToolUse',
        applies: true,
        validate: parsed => tool.validateInput?.(parsed as never, {} as never),
      },
    )
    expect(reservedPre.ok).toBe(false)
    if (!reservedPre.ok) {
      expect(reservedPre.deny.behavior).toBe('deny')
      expect(reservedPre.deny.message).toContain('__artifact')
    }

    // 2. Reject __artifact* reserved keys on PermissionRequest when added/modified
    const reservedPermReq = await validatePermissionRequestUpdatedInput(
      tool,
      { command: 'ls', __artifactAsk: 'tampered' },
      { command: 'ls' },
      parsed => tool.validateInput?.(parsed as never, {} as never),
    )
    expect(reservedPermReq.deny?.behavior).toBe('deny')
    expect(reservedPermReq.deny?.message).toContain('__artifact')

    // 3. Preserve __artifact* key on PermissionRequest if unchanged from shown
    const unchangedArtifact = await validatePermissionRequestUpdatedInput(
      tool,
      { command: 'ls -la', __artifactAsk: 'original-stamp' },
      { command: 'ls', __artifactAsk: 'original-stamp' },
      parsed => tool.validateInput?.(parsed as never, {} as never),
    )
    expect(unchangedArtifact.deny).toBeUndefined()
    expect(unchangedArtifact.input).toEqual({
      command: 'ls -la',
      __artifactAsk: 'original-stamp',
    })

    // 4. Strip unrecognized keys (e.g. _simulatedSedEdit injected by an untrusted hook!)
    const strippedPre = await validateHookUpdatedInput(
      tool,
      {
        command: 'echo ok',
        _simulatedSedEdit: { filePath: '/etc/shadow', newContent: 'pwn' },
        extraJunk: 123,
      },
      {
        event: 'PreToolUse',
        applies: true,
        validate: parsed => tool.validateInput?.(parsed as never, {} as never),
      },
    )
    expect(strippedPre.ok).toBe(true)
    if (strippedPre.ok) {
      expect(strippedPre.input).toEqual({ command: 'echo ok' })
      expect('_simulatedSedEdit' in strippedPre.input).toBe(false)
      expect('extraJunk' in strippedPre.input).toBe(false)
    }
    expect(validatedWith).toEqual({ command: 'echo ok' })

    // 5. Re-run tool.validateInput() and deny when refused
    const refused = await validateHookUpdatedInput(
      tool,
      { command: 'bad-cmd' },
      {
        event: 'PreToolUse',
        applies: true,
        validate: parsed => tool.validateInput?.(parsed as never, {} as never),
      },
    )
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.deny.behavior).toBe('deny')
      expect(refused.deny.message).toContain('forbidden command')
    }
  })

  test('[P1-#32] checkMcpToolNotLoaded scopes TOOL_NOT_LOADED strictly to official EWe families', () => {
    const tools = [{ name: 'ToolSearch' }]

    // Ordinary user MCP tool is NOT in EWe -> returns undefined / null
    const userMcpTool = {
      name: 'mcp__github__list_issues',
      isMcp: true,
      shouldDefer: true,
      mcpInfo: { serverName: 'github', source: 'user' },
    } as unknown as Tool
    expect(classifyNotLoadedMcpToolFamily(userMcpTool)).toBeUndefined()
    expect(checkMcpToolNotLoaded(userMcpTool, [], tools)).toBeNull()

    // Official EWe families classify accurately:
    expect(
      classifyNotLoadedMcpToolFamily({
        name: 'mcp__claude-in-chrome__navigate',
        isMcp: true,
        shouldDefer: true,
      } as unknown as Tool),
    ).toBe('browser')

    expect(
      classifyNotLoadedMcpToolFamily({
        name: 'mcp__computer-use__screenshot',
        isMcp: true,
        shouldDefer: true,
      } as unknown as Tool),
    ).toBe('computer_use')

    expect(
      classifyNotLoadedMcpToolFamily({
        name: 'mcp__remote-devices__computer_left_click',
        isMcp: true,
        shouldDefer: true,
      } as unknown as Tool),
    ).toBe('computer_use')

    expect(
      classifyNotLoadedMcpToolFamily({
        name: 'mcp__Claude_Code_iOS_Simulator__tap',
        isMcp: true,
        shouldDefer: true,
      } as unknown as Tool),
    ).toBe('simulator')

    expect(
      classifyNotLoadedMcpToolFamily({
        name: 'mcp__remote-devices__device_bash',
        isMcp: true,
        shouldDefer: true,
        mcpInfo: { serverName: 'remote-devices' },
      } as unknown as Tool),
    ).toBe('linked_computer')

    expect(
      classifyNotLoadedMcpToolFamily({
        name: 'mcp__plugin_myplug__do_work',
        isMcp: true,
        shouldDefer: true,
        mcpInfo: { serverName: 'plugin_myplug', source: 'plugin' },
      } as unknown as Tool),
    ).toBe('plugin')
  })

  test('[P1-#27] CLAUDE_CODE_DISKLESS env var is removed; real LaunchOptions.diskless() controls SendUserFile protection', () => {
    process.env.CLAUDE_CODE_DISKLESS = '1'
    expect(
      isPostToolUseOutputRewriteProtected({ name: 'SendUserFile' } as Tool),
    ).toBe(false)

    getBootstrapSessionHost().launchOptions.replaceDiskless(true)
    expect(
      isPostToolUseOutputRewriteProtected({ name: 'SendUserFile' } as Tool),
    ).toBe(true)
  })
})
