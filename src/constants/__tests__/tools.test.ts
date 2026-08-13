import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'
import { growthbookMock } from '../../../tests/mocks/growthbook'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'
import * as realSettings from 'src/utils/settings/settings.js'
import * as realForkSubagentGate from '../../utils/forkSubagentGate.js'

// Snapshot BEFORE mock.module — live namespace rebinds under Bun.
const settingsSnap = snapshotModuleExports(realSettings)
const forkGateSnap = snapshotModuleExports(realForkSubagentGate)

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)
// Mock growthbook to cut analytics dependency
mock.module('src/services/analytics/growthbook.js', growthbookMock)

// densable TX special cases — hermetic mocks for settings / fork gate.
// Incomplete settings stubs break /tui persist path
// (updateSettingsForSource must return { error } shape).
const settingsNonDeferrable: string[] = []
const settingsStub = {
  non_deferrable_builtins: settingsNonDeferrable as string[] | undefined,
}
mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => settingsStub as never,
    getSettings_DEPRECATED: () => settingsStub as never,
    getSettingsForSource: () => settingsStub as never,
    updateSettingsForSource: (() => ({
      error: null,
    })) as unknown as typeof realSettings.updateSettingsForSource,
  }),
)

let forkEnabled = false
mock.module('src/utils/forkSubagentGate.js', () => ({
  ...forkGateSnap,
  isForkSubagentEnabled: () => forkEnabled,
  resolveForkSubagentSource: () => (forkEnabled ? 'env' : 'disabled'),
}))
afterAll(() => {
  mock.module('src/utils/forkSubagentGate.js', () => ({ ...forkGateSnap }))
  restoreSettingsMockWith(mock.module, settingsSnap)
})

const { CORE_TOOLS } = await import('../tools.js')
const { isDeferredTool, getNonDeferrableBuiltins } = await import(
  '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
)

type MockTool = {
  name: string
  alwaysLoad?: boolean
  isMcp?: boolean
  shouldDefer?: boolean
}

function makeTool(overrides: Partial<MockTool> = {}): MockTool {
  return {
    name: 'TestTool',
    isMcp: false,
    shouldDefer: undefined,
    alwaysLoad: undefined,
    ...overrides,
  }
}

describe('CORE_TOOLS', () => {
  test('contains expected number of tools', () => {
    // 7 SHELL_TOOL_NAMES + 19 independent tool names
    expect(CORE_TOOLS.size).toBeGreaterThanOrEqual(26)
  })

  test('contains key core tool names', () => {
    const expected = [
      'Bash',
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Agent',
      'AskUserQuestion',
      'ToolSearch',
      'WebSearch',
      'WebFetch',
      'Sleep',
      'LSP',
      'Skill',
      'TaskCreate',
      'TaskGet',
      'TaskUpdate',
      'TaskList',
      'TaskOutput',
      'TaskStop',
      'TodoWrite',
      'EnterPlanMode',
      'ExitPlanMode',
      'VerifyPlanExecution',
      'NotebookEdit',
      'StructuredOutput',
    ]
    for (const name of expected) {
      expect(CORE_TOOLS.has(name), `CORE_TOOLS should contain ${name}`).toBe(
        true,
      )
    }
  })

  test('is a ReadonlySet', () => {
    // ReadonlySet is not directly distinguishable at runtime from Set,
    // but we verify the cast was applied by checking it's a Set
    expect(CORE_TOOLS).toBeInstanceOf(Set)
    // The `as ReadonlySet<string>` ensures type-level immutability
  })
})

describe('isDeferredTool (densable TX)', () => {
  const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  const prevSessionKind = process.env.CLAUDE_CODE_SESSION_KIND

  beforeEach(() => {
    settingsNonDeferrable.length = 0
    forkEnabled = false
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    delete process.env.CLAUDE_CODE_SESSION_KIND
  })

  afterEach(() => {
    if (prevEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
    else process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
    if (prevSessionKind === undefined)
      delete process.env.CLAUDE_CODE_SESSION_KIND
    else process.env.CLAUDE_CODE_SESSION_KIND = prevSessionKind
  })

  test('alwaysLoad: true never defers (even MCP)', () => {
    expect(
      isDeferredTool(
        makeTool({
          name: 'mcp__server__action',
          isMcp: true,
          alwaysLoad: true,
        }) as never,
      ),
    ).toBe(false)
  })

  test('eGu non_deferrable list never defers', () => {
    settingsNonDeferrable.push('Config')
    expect(getNonDeferrableBuiltins()).toContain('Config')
    expect(
      isDeferredTool(makeTool({ name: 'Config', shouldDefer: true }) as never),
    ).toBe(false)
  })

  test('MCP tools always defer unless alwaysLoad', () => {
    expect(
      isDeferredTool(
        makeTool({ name: 'mcp__server__action', isMcp: true }) as never,
      ),
    ).toBe(true)
  })

  test('ToolSearch never defers', () => {
    expect(
      isDeferredTool(
        makeTool({ name: 'ToolSearch', shouldDefer: true }) as never,
      ),
    ).toBe(false)
  })

  test('Agent defers only when shouldDefer and fork off; never when fork on', () => {
    // Agent has no shouldDefer in product → not deferred by default
    expect(isDeferredTool(makeTool({ name: 'Agent' }) as never)).toBe(false)
    expect(
      isDeferredTool(makeTool({ name: 'Agent', shouldDefer: true }) as never),
    ).toBe(true)
    forkEnabled = true
    expect(
      isDeferredTool(makeTool({ name: 'Agent', shouldDefer: true }) as never),
    ).toBe(false)
  })

  test('Brief/SendUserMessage and SendUserFile never defer', () => {
    expect(
      isDeferredTool(
        makeTool({ name: 'SendUserMessage', shouldDefer: true }) as never,
      ),
    ).toBe(false)
    expect(
      isDeferredTool(
        makeTool({ name: 'SendUserFile', shouldDefer: true }) as never,
      ),
    ).toBe(false)
  })

  test('PushNotification never defers on remote_trigger entrypoint', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_trigger'
    expect(
      isDeferredTool(
        makeTool({ name: 'PushNotification', shouldDefer: true }) as never,
      ),
    ).toBe(false)
  })

  test('EnterWorktree never defers when SESSION_KIND=bg', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(
      isDeferredTool(
        makeTool({ name: 'EnterWorktree', shouldDefer: true }) as never,
      ),
    ).toBe(false)
  })

  test('opt-in: shouldDefer true defers; undefined does not', () => {
    expect(isDeferredTool(makeTool({ name: 'Config' }) as never)).toBe(false)
    expect(
      isDeferredTool(makeTool({ name: 'Config', shouldDefer: true }) as never),
    ).toBe(true)
    // Built-ins without shouldDefer (Read/Bash/…) stay non-deferred
    for (const name of ['Read', 'Edit', 'Bash', 'Glob', 'Grep']) {
      expect(
        isDeferredTool(makeTool({ name }) as never),
        `${name} should not be deferred without shouldDefer`,
      ).toBe(false)
    }
  })

  test('team tools defer only with shouldDefer true', () => {
    for (const name of ['TeamCreate', 'TeamDelete', 'SendMessage']) {
      expect(
        isDeferredTool(makeTool({ name, shouldDefer: true }) as never),
        `${name} should be deferred when shouldDefer`,
      ).toBe(true)
      expect(
        isDeferredTool(makeTool({ name }) as never),
        `${name} should not defer without shouldDefer`,
      ).toBe(false)
    }
  })
})
