/**
 * densable 2.1.228 #17 — unit runner (isolated via fileEditReadGate.228.test.ts).
 *
 * Pure helpers + skip-gate behavior. Permission layer / filesystem probes are
 * mocked. Loaded only in a dedicated bun:test subprocess so process-global
 * mock.module cannot poison the full suite.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import type { ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import { FILE_EDIT_TOOL_NAME } from '../../FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../FileReadTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../FileWriteTool/prompt.js'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireActual = (relFromSrc: string): Record<string, unknown> =>
  require(`../../../../../../${relFromSrc}`) as Record<string, unknown>

const permissionLayerActual = requireActual(
  'src/engine/permissionLayerReaders.js',
)
const filesystemActual = requireActual('src/utils/permissions/filesystem.js')
const permissionsActual = requireActual('src/utils/permissions/permissions.js')

const getMainLoopModelMock = mock(() => 'claude-sonnet-4-6')
const getToolPermissionContextMock = mock(
  (): ToolPermissionContext =>
    ({
      mode: 'default',
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    }) as ToolPermissionContext,
)
type MockReadDecision = {
  behavior: 'allow' | 'ask' | 'deny'
  decisionReason?: { type: string; reason?: string }
}
type MockPermissionRule = {
  source?: string
  ruleBehavior?: string
  ruleValue?: { toolName?: string; ruleContent?: string }
}

const checkReadPermissionForToolMock = mock(
  (): MockReadDecision => ({
    behavior: 'allow',
  }),
)
const matchingRuleForInputMock = mock(
  (
    _path: string,
    _toolName: string,
    _behavior: string,
    _ctx: ToolPermissionContext,
  ): MockPermissionRule | null => null,
)
// Signature must match getDenyRuleForTool(ctx, tool) so mock.calls[0] is typed
// and mockImplementation((ctx, tool) => ...) typechecks under strict tsc.
const getDenyRuleForToolMock = mock(
  (
    _ctx: ToolPermissionContext,
    _tool: { name: string },
  ): MockPermissionRule | null => null,
)
const getAskRuleForToolMock = mock(
  (
    _ctx: ToolPermissionContext,
    _tool: { name: string },
  ): MockPermissionRule | null => null,
)

mock.module('src/engine/permissionLayerReaders.js', () => ({
  ...permissionLayerActual,
  getMainLoopModelFromLayers: getMainLoopModelMock,
  getToolPermissionContextFromLayers: getToolPermissionContextMock,
}))

mock.module('src/utils/permissions/filesystem.js', () => ({
  ...filesystemActual,
  checkReadPermissionForTool: checkReadPermissionForToolMock,
  matchingRuleForInput: matchingRuleForInputMock,
}))

mock.module('src/utils/permissions/permissions.js', () => ({
  ...permissionsActual,
  getDenyRuleForTool: getDenyRuleForToolMock,
  getAskRuleForTool: getAskRuleForToolMock,
}))

const {
  FILE_READ_DENY_CANNOT_EDIT,
  FILE_READ_DENY_CANNOT_WRITE,
  isLegacyWriteReadGateModel,
  isNotebookPath,
  isPathCoveredByReadDenyRule,
  isReadAutoAllowedForEditGate,
  LEGACY_WRITE_READ_GATE_MODELS,
  shouldAllowCallDespiteMissingOrPartialRead,
  shouldSkipEditUnreadGate,
  shouldSkipWriteUnreadGate,
} = await import('../fileEditReadGate.js')

function makeCtx(tools: Array<{ name: string }>): ToolUseContext {
  return {
    options: { tools },
  } as unknown as ToolUseContext
}

const writeEditReadTools = [
  { name: FILE_WRITE_TOOL_NAME },
  { name: FILE_EDIT_TOOL_NAME },
  { name: FILE_READ_TOOL_NAME },
]

const writeOnlyTools = [{ name: FILE_WRITE_TOOL_NAME }]

beforeAll(() => {
  getMainLoopModelMock.mockReset()
  getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
  getToolPermissionContextMock.mockReset()
  getToolPermissionContextMock.mockImplementation(
    () =>
      ({
        mode: 'default',
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      }) as ToolPermissionContext,
  )
  checkReadPermissionForToolMock.mockReset()
  checkReadPermissionForToolMock.mockImplementation(() => ({
    behavior: 'allow',
  }))
  matchingRuleForInputMock.mockReset()
  matchingRuleForInputMock.mockImplementation(() => null)
  getDenyRuleForToolMock.mockReset()
  getDenyRuleForToolMock.mockImplementation(() => null)
  getAskRuleForToolMock.mockReset()
  getAskRuleForToolMock.mockImplementation(() => null)
})

afterAll(() => {
  // Subprocess-isolated runner: restore is belt-and-suspenders only.
  mock.module(
    'src/engine/permissionLayerReaders.js',
    () => permissionLayerActual,
  )
  mock.module('src/utils/permissions/filesystem.js', () => filesystemActual)
  mock.module('src/utils/permissions/permissions.js', () => permissionsActual)
  getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
  checkReadPermissionForToolMock.mockImplementation(() => ({
    behavior: 'allow',
  }))
  matchingRuleForInputMock.mockImplementation(() => null)
  getDenyRuleForToolMock.mockImplementation(() => null)
  getAskRuleForToolMock.mockImplementation(() => null)
})

describe('densable 2.1.228 #17 fileEditReadGate pure helpers', () => {
  test('Jqy legacy set includes densable gold models', () => {
    expect(LEGACY_WRITE_READ_GATE_MODELS.has('claude-opus-4-6')).toBe(true)
    expect(LEGACY_WRITE_READ_GATE_MODELS.has('claude-sonnet-4-5')).toBe(true)
    expect(LEGACY_WRITE_READ_GATE_MODELS.has('claude-haiku-4-5')).toBe(true)
    expect(LEGACY_WRITE_READ_GATE_MODELS.has('claude-3-5-sonnet')).toBe(true)
  })

  test('isLegacyWriteReadGateModel matches Jqy + [1m] suffix strip', () => {
    expect(isLegacyWriteReadGateModel('claude-opus-4-6')).toBe(true)
    expect(isLegacyWriteReadGateModel('claude-opus-4-6[1m]')).toBe(true)
    expect(isLegacyWriteReadGateModel('claude-sonnet-4-6')).toBe(false)
    expect(isLegacyWriteReadGateModel('claude-opus-4-7')).toBe(false)
  })

  test('isNotebookPath (ZYd) strips trailing dots/spaces then checks .ipynb', () => {
    expect(isNotebookPath('/tmp/a.ipynb')).toBe(true)
    expect(isNotebookPath('/tmp/a.ipynb...')).toBe(true)
    expect(isNotebookPath('/tmp/a.ipynb ')).toBe(true)
    expect(isNotebookPath('/tmp/a.py')).toBe(false)
    expect(isNotebookPath('/tmp/a.IPYNB')).toBe(true)
  })
})

describe('densable 2.1.228 #17 MCt / skip gates', () => {
  test('Write-without-Read tool set cannot skip (YqS → MCt false)', () => {
    expect(
      isReadAutoAllowedForEditGate(
        FILE_WRITE_TOOL_NAME,
        '/tmp/x.ts',
        makeCtx(writeOnlyTools),
      ),
    ).toBe(false)
  })

  test('Write+Read tool set + auto-allow Read → MCt true', () => {
    checkReadPermissionForToolMock.mockImplementation(() => ({
      behavior: 'allow',
    }))
    expect(
      isReadAutoAllowedForEditGate(
        FILE_WRITE_TOOL_NAME,
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
      ),
    ).toBe(true)
  })

  test('explicit Read deny rule blocks MCt', () => {
    getDenyRuleForToolMock.mockImplementationOnce(() => ({
      ruleBehavior: 'deny',
    }))
    expect(
      isReadAutoAllowedForEditGate(
        FILE_WRITE_TOOL_NAME,
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
      ),
    ).toBe(false)
  })

  test('bypassPermissions + ask without explicit ask-rule → MCt true', () => {
    getToolPermissionContextMock.mockImplementation(
      () =>
        ({
          mode: 'bypassPermissions',
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: true,
        }) as ToolPermissionContext,
    )
    checkReadPermissionForToolMock.mockImplementation(() => ({
      behavior: 'ask',
      decisionReason: { type: 'other', reason: 'default ask' },
    }))
    expect(
      isReadAutoAllowedForEditGate(
        FILE_WRITE_TOOL_NAME,
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        getToolPermissionContextMock(),
      ),
    ).toBe(true)
  })

  test('shouldSkipWriteUnreadGate: non-legacy + unread + MCt → true', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
    checkReadPermissionForToolMock.mockImplementation(() => ({
      behavior: 'allow',
    }))
    expect(
      shouldSkipWriteUnreadGate(
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        false,
        false,
      ),
    ).toBe(true)
  })

  test('shouldSkipWriteUnreadGate: legacy model never skips', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-opus-4-6')
    checkReadPermissionForToolMock.mockImplementation(() => ({
      behavior: 'allow',
    }))
    expect(
      shouldSkipWriteUnreadGate(
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        false,
        false,
      ),
    ).toBe(false)
  })

  test('shouldSkipWriteUnreadGate: partial view never skips (Write-only !c)', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
    expect(
      shouldSkipWriteUnreadGate(
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        false,
        true,
      ),
    ).toBe(false)
  })

  test('shouldSkipWriteUnreadGate: notebook path never skips', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
    expect(
      shouldSkipWriteUnreadGate(
        '/tmp/nb.ipynb',
        makeCtx(writeEditReadTools),
        false,
        false,
      ),
    ).toBe(false)
  })

  test('shouldSkipWriteUnreadGate: already-read state never skips', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
    expect(
      shouldSkipWriteUnreadGate(
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        true,
        false,
      ),
    ).toBe(false)
  })

  test('shouldSkipEditUnreadGate: non-legacy + MCt → true (partial allowed)', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
    checkReadPermissionForToolMock.mockImplementation(() => ({
      behavior: 'allow',
    }))
    // Edit densable b=!J4t&&MCt — no hasReadState/partial args
    expect(
      shouldSkipEditUnreadGate('/tmp/x.ts', makeCtx(writeEditReadTools)),
    ).toBe(true)
  })

  test('shouldSkipEditUnreadGate: legacy model still forces read', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-haiku-4-5')
    expect(
      shouldSkipEditUnreadGate('/tmp/x.ts', makeCtx(writeEditReadTools)),
    ).toBe(false)
  })
})

describe('densable l8t Read-deny early gate (errorCode 13)', () => {
  const emptyCtx = {
    mode: 'default',
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  } as ToolPermissionContext

  test('dedicated SEA copy strings', () => {
    expect(FILE_READ_DENY_CANNOT_EDIT).toBe(
      'File is covered by a Read deny rule in your permission settings and cannot be edited.',
    )
    expect(FILE_READ_DENY_CANNOT_WRITE).toBe(
      'File is covered by a Read deny rule in your permission settings and cannot be written.',
    )
  })

  test('tool-level Read deny (non-KqS source) → l8t true', () => {
    // Implementation-shaped mock: honor filtered alwaysDenyRules passed in
    // (locks densable KqS filter — blind mockReturn would not catch regressions).
    getDenyRuleForToolMock.mockImplementation(
      (
        ctx: ToolPermissionContext,
        _tool: { name: string },
      ): MockPermissionRule | null => {
        for (const [source, rules] of Object.entries(
          ctx.alwaysDenyRules ?? {},
        )) {
          if ((rules as string[] | undefined)?.includes('Read')) {
            return {
              source,
              ruleBehavior: 'deny',
              ruleValue: { toolName: 'Read' },
            }
          }
        }
        return null
      },
    )
    matchingRuleForInputMock.mockImplementation(() => null)
    const ctx = {
      ...emptyCtx,
      alwaysDenyRules: { userSettings: ['Read'] },
    } as ToolPermissionContext
    expect(isPathCoveredByReadDenyRule('/tmp/x.ts', ctx)).toBe(true)
    // Context passed to getDenyRuleForTool must still contain userSettings.
    const callCtx = getDenyRuleForToolMock.mock.calls.at(-1)?.[0] as
      | ToolPermissionContext
      | undefined
    expect(callCtx?.alwaysDenyRules?.userSettings).toEqual(['Read'])
  })

  test('cliArg tool-level Read deny is KqS-excluded → falls through to path check', () => {
    // densable filters toolsNarrowing/cliArg/command from hB; if only those
    // remain, tool-level match is ignored and path-level decides.
    getDenyRuleForToolMock.mockImplementation(
      (
        ctx: ToolPermissionContext,
        _tool: { name: string },
      ): MockPermissionRule | null => {
        for (const [source, rules] of Object.entries(
          ctx.alwaysDenyRules ?? {},
        )) {
          if ((rules as string[] | undefined)?.includes('Read')) {
            return {
              source,
              ruleBehavior: 'deny',
              ruleValue: { toolName: 'Read' },
            }
          }
        }
        return null
      },
    )
    matchingRuleForInputMock.mockImplementation(() => null)
    const ctx = {
      ...emptyCtx,
      alwaysDenyRules: { cliArg: ['Read'] },
    } as ToolPermissionContext
    expect(isPathCoveredByReadDenyRule('/tmp/x.ts', ctx)).toBe(false)
    // KqS lock: filtered context must NOT retain cliArg key.
    const callCtx = getDenyRuleForToolMock.mock.calls.at(-1)?.[0] as
      | ToolPermissionContext
      | undefined
    expect(callCtx?.alwaysDenyRules).toEqual({})
    expect(callCtx?.alwaysDenyRules).not.toHaveProperty('cliArg')
  })

  test('command tool-level Read deny is KqS-excluded (same as cliArg)', () => {
    getDenyRuleForToolMock.mockImplementation(
      (
        ctx: ToolPermissionContext,
        _tool: { name: string },
      ): MockPermissionRule | null => {
        for (const [source, rules] of Object.entries(
          ctx.alwaysDenyRules ?? {},
        )) {
          if ((rules as string[] | undefined)?.includes('Read')) {
            return {
              source,
              ruleBehavior: 'deny',
              ruleValue: { toolName: 'Read' },
            }
          }
        }
        return null
      },
    )
    matchingRuleForInputMock.mockImplementation(() => null)
    const ctx = {
      ...emptyCtx,
      alwaysDenyRules: {
        command: ['Read'],
        toolsNarrowing: ['Read'],
      },
    } as ToolPermissionContext
    expect(isPathCoveredByReadDenyRule('/tmp/x.ts', ctx)).toBe(false)
    const callCtx = getDenyRuleForToolMock.mock.calls.at(-1)?.[0] as
      | ToolPermissionContext
      | undefined
    expect(callCtx?.alwaysDenyRules).not.toHaveProperty('command')
    expect(callCtx?.alwaysDenyRules).not.toHaveProperty('toolsNarrowing')
  })

  test('mixed sources: keeps userSettings, strips cliArg', () => {
    getDenyRuleForToolMock.mockImplementation(
      (
        ctx: ToolPermissionContext,
        _tool: { name: string },
      ): MockPermissionRule | null => {
        for (const [source, rules] of Object.entries(
          ctx.alwaysDenyRules ?? {},
        )) {
          if ((rules as string[] | undefined)?.includes('Read')) {
            return {
              source,
              ruleBehavior: 'deny',
              ruleValue: { toolName: 'Read' },
            }
          }
        }
        return null
      },
    )
    matchingRuleForInputMock.mockImplementation(() => null)
    const ctx = {
      ...emptyCtx,
      alwaysDenyRules: {
        userSettings: ['Read'],
        cliArg: ['Read'],
      },
    } as ToolPermissionContext
    expect(isPathCoveredByReadDenyRule('/tmp/x.ts', ctx)).toBe(true)
    const callCtx = getDenyRuleForToolMock.mock.calls.at(-1)?.[0] as
      | ToolPermissionContext
      | undefined
    expect(callCtx?.alwaysDenyRules).toEqual({ userSettings: ['Read'] })
    expect(callCtx?.alwaysDenyRules).not.toHaveProperty('cliArg')
  })

  test('path-level Read deny via matchingRuleForInput → l8t true', () => {
    getDenyRuleForToolMock.mockImplementation(() => null)
    matchingRuleForInputMock.mockImplementationOnce(() => ({
      source: 'userSettings',
      ruleBehavior: 'deny',
      ruleValue: { toolName: 'Read', ruleContent: '/secrets/**' },
    }))
    expect(isPathCoveredByReadDenyRule('/secrets/x.ts', emptyCtx)).toBe(true)
  })

  test('no tool/path Read deny → l8t false', () => {
    getDenyRuleForToolMock.mockImplementation(() => null)
    matchingRuleForInputMock.mockImplementation(() => null)
    expect(isPathCoveredByReadDenyRule('/tmp/x.ts', emptyCtx)).toBe(false)
  })
})

describe('densable 2.1.228 #17 call-path shouldAllowCallDespiteMissingOrPartialRead', () => {
  test('Write: unread + non-legacy + MCt → allow (validate guardSkipped twin)', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
    checkReadPermissionForToolMock.mockImplementation(() => ({
      behavior: 'allow',
    }))
    expect(
      shouldAllowCallDespiteMissingOrPartialRead(
        'write',
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        null,
      ),
    ).toBe(true)
  })

  test('Write: partial view never allows via call helper (Write densable !c only)', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
    checkReadPermissionForToolMock.mockImplementation(() => ({
      behavior: 'allow',
    }))
    expect(
      shouldAllowCallDespiteMissingOrPartialRead(
        'write',
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        { isPartialView: true },
      ),
    ).toBe(false)
  })

  test('Write: legacy model never allows missing read on call', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-opus-4-6')
    checkReadPermissionForToolMock.mockImplementation(() => ({
      behavior: 'allow',
    }))
    expect(
      shouldAllowCallDespiteMissingOrPartialRead(
        'write',
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        null,
      ),
    ).toBe(false)
  })

  test('Edit: unread/partial + non-legacy + MCt → allow', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-sonnet-4-6')
    checkReadPermissionForToolMock.mockImplementation(() => ({
      behavior: 'allow',
    }))
    expect(
      shouldAllowCallDespiteMissingOrPartialRead(
        'edit',
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        null,
      ),
    ).toBe(true)
    expect(
      shouldAllowCallDespiteMissingOrPartialRead(
        'edit',
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        { isPartialView: true },
      ),
    ).toBe(true)
  })

  test('Edit: legacy model never allows missing read on call', () => {
    getMainLoopModelMock.mockImplementation(() => 'claude-haiku-4-5')
    expect(
      shouldAllowCallDespiteMissingOrPartialRead(
        'edit',
        '/tmp/x.ts',
        makeCtx(writeEditReadTools),
        null,
      ),
    ).toBe(false)
  })
})

describe('densable 2.1.228 #17 tool wiring', () => {
  test('FileWriteTool uses shouldSkipWriteUnreadGate + l8t + call-path allow helper', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(
      join(import.meta.dir, '../../FileWriteTool/FileWriteTool.ts'),
      'utf8',
    )
    expect(src).toContain('shouldSkipWriteUnreadGate')
    expect(src).toContain('guardSkipped')
    expect(src).toContain('isPathCoveredByReadDenyRule')
    expect(src).toContain('FILE_READ_DENY_CANNOT_WRITE')
    expect(src).toContain('errorCode: 13')
    // call() must re-check skip for missing/partial — not bare FILE_UNEXPECTEDLY throw
    expect(src).toContain('shouldAllowCallDespiteMissingOrPartialRead')
    expect(src).toMatch(
      /if \(!lastRead \|\| lastRead\.isPartialView\)[\s\S]*shouldAllowCallDespiteMissingOrPartialRead/,
    )
  })

  test('FileEditTool uses shouldSkipEditUnreadGate + l8t + call-path allow helper', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(
      join(import.meta.dir, '../../FileEditTool/FileEditTool.ts'),
      'utf8',
    )
    expect(src).toContain('shouldSkipEditUnreadGate')
    expect(src).toContain('guardSkipped')
    expect(src).toContain('isPathCoveredByReadDenyRule')
    expect(src).toContain('FILE_READ_DENY_CANNOT_EDIT')
    expect(src).toContain('errorCode: 13')
    expect(src).toContain('shouldAllowCallDespiteMissingOrPartialRead')
    expect(src).toMatch(
      /if \(!lastRead \|\| lastRead\.isPartialView\)[\s\S]*shouldAllowCallDespiteMissingOrPartialRead/,
    )
  })
})
