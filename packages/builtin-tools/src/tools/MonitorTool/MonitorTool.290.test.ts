import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from 'src/Tool.js'
import { MonitorTool } from './MonitorTool.js'

function makeContext(overrides?: {
  alwaysDenyRules?: Record<string, string[]>
  alwaysAskRules?: Record<string, string[]>
  alwaysAllowRules?: Record<string, string[]>
  mode?: string
  sandboxAutoAllowSuspended?: boolean
}): ToolUseContext {
  return {
    getAppState: () => ({
      toolPermissionContext: {
        mode: overrides?.mode ?? 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: overrides?.alwaysAllowRules ?? {},
        alwaysDenyRules: overrides?.alwaysDenyRules ?? {},
        alwaysAskRules: overrides?.alwaysAskRules ?? {},
        isBypassPermissionsModeAvailable: false,
        ...(overrides?.sandboxAutoAllowSuspended
          ? { sandboxAutoAllowSuspended: true }
          : {}),
      },
    }),
    options: {},
    abortController: new AbortController(),
    readFileState: new Map(),
  } as unknown as ToolUseContext
}

describe('MonitorTool v2.1.290 #84 checkPermissions & sandbox auto-allow suspension', () => {
  test('denies Monitor command when whole-tool Bash deny rule exists', async () => {
    const res = await MonitorTool.checkPermissions(
      { command: 'echo hello', description: 'watch', timeout_ms: 5000 },
      makeContext({ alwaysDenyRules: { userSettings: ['Bash'] } }),
    )
    expect(res.behavior).toBe('deny')
    if (res.behavior === 'deny') {
      expect(res.message).toContain('it runs code as Bash does')
    }
  })

  test('returns Bash ask rule verdict when Bash ask rule exists and command passes through', async () => {
    const res = await MonitorTool.checkPermissions(
      {
        command: 'curl https://example.com',
        description: 'watch endpoint',
        timeout_ms: 5000,
      },
      makeContext({ alwaysAskRules: { userSettings: ['Bash'] } }),
    )
    expect(res.behavior).toBe('ask')
    if (res.behavior === 'ask') {
      expect(res.decisionReason).toMatchObject({
        type: 'rule',
      })
      expect(res.message).toContain('runs code as Bash does')
    }
  })

  test('preserves MonitorInput fields in updatedInput when allowed (read-only command)', async () => {
    const res = await MonitorTool.checkPermissions(
      {
        command: 'pwd',
        description: 'watch pwd',
        timeout_ms: 12000,
        persistent: false,
      },
      makeContext(),
    )
    expect(res.behavior).toBe('allow')
    if (res.behavior === 'allow') {
      expect(res.updatedInput).toMatchObject({
        command: 'pwd',
        description: 'watch pwd',
        timeout_ms: 12000,
        persistent: false,
      })
    }
  })

  test('does not auto-allow arbitrary non-readonly Monitor command via sandbox', async () => {
    const res = await MonitorTool.checkPermissions(
      {
        command: 'python3 -c "print(1)"',
        description: 'watch py',
        timeout_ms: 5000,
      },
      makeContext(),
    )
    expect(res.behavior).not.toBe('allow')
  })
})
