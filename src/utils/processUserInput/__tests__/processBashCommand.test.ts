import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realBashToolMod from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

// Snapshot BEFORE mock.module — live namespace rebinds under Bun mock.module.
const settingsSnap = snapshotModuleExports(realSettings)
const realGetInitialSettings =
  settingsSnap.getInitialSettings as typeof realSettings.getInitialSettings

// Override only respondToBashCommands; spread snapshot so co-running
// suites (shellDefaults.windows, tui, etc.) keep defaultShell and full surface.
const getInitialSettingsMock = mock(() => ({
  ...realGetInitialSettings(),
  respondToBashCommands: true as boolean | undefined,
}))

const settingsMock = createSettingsMock(settingsSnap, {
  getInitialSettings: getInitialSettingsMock,
  getSettings_DEPRECATED: getInitialSettingsMock,
})
// Mock both .ts and .js specifiers — Bun process-global registry is per-specifier.
mock.module('src/utils/settings/settings.ts', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)
afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
})

// Do NOT mock resolveDefaultShell / shellToolUtils — Bun mock.module is
// process-global and would force bash for shellDefaults.windows co-suites.
// processBashCommand tests only need BashTool.call + settings.respondToBashCommands.

const bashCallMock = mock(async () => ({
  data: {
    stdout: 'hello',
    stderr: '',
    interrupted: false,
    backgroundTaskId: undefined as string | undefined,
  },
}))

// Snapshot real BashTool and restore in afterAll — permanent thin BashTool
// mock breaks coordinatorWriteValidation (BashTool.call never hits write guard).
const bashToolSnap = snapshotModuleExports(realBashToolMod)

// Full BashTool surface used by processBashCommand + processToolResultBlock.
function bashToolMock() {
  return {
    ...bashToolSnap,
    BashTool: {
      call: bashCallMock,
      name: 'Bash',
      maxResultSizeChars: 30_000,
      mapToolResultToToolResultBlockParam: (
        result: { stdout?: string },
        toolUseID: string,
      ) => ({
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: result.stdout ?? '',
      }),
    },
  }
}
mock.module(
  '@claude-code/builtin-tools/tools/BashTool/BashTool.js',
  bashToolMock,
)
// extend afterAll already registered for settings
afterAll(() => {
  mock.module('@claude-code/builtin-tools/tools/BashTool/BashTool.js', () => ({
    ...bashToolSnap,
  }))
})

describe('processBashCommand respondToBashCommands', () => {
  afterEach(() => {
    getInitialSettingsMock.mockReset()
    getInitialSettingsMock.mockImplementation(() => ({
      ...realGetInitialSettings(),
      respondToBashCommands: true,
    }))
    bashCallMock.mockReset()
    bashCallMock.mockImplementation(async () => ({
      data: {
        stdout: 'hello',
        stderr: '',
        interrupted: false,
        backgroundTaskId: undefined,
      },
    }))
  })

  test('defaults to shouldQuery true after successful ! command', async () => {
    getInitialSettingsMock.mockImplementation(() => ({
      ...realGetInitialSettings(),
      respondToBashCommands: undefined,
    }))
    const { processBashCommand } = await import('../processBashCommand.js')
    const abortController = new AbortController()
    const result = await processBashCommand(
      'echo hello',
      [],
      [],
      {
        options: { verbose: false },
        abortController,
        setToolJSX: () => {},
      } as never,
      () => {},
    )
    expect(result.shouldQuery).toBe(true)
  })

  test('respondToBashCommands false keeps output without querying', async () => {
    getInitialSettingsMock.mockImplementation(() => ({
      ...realGetInitialSettings(),
      respondToBashCommands: false,
    }))
    const { processBashCommand } = await import('../processBashCommand.js')
    const abortController = new AbortController()
    const result = await processBashCommand(
      'echo hello',
      [],
      [],
      {
        options: { verbose: false },
        abortController,
        setToolJSX: () => {},
      } as never,
      () => {},
    )
    expect(result.shouldQuery).toBe(false)
  })

  test('backgrounded commands do not auto-respond', async () => {
    getInitialSettingsMock.mockImplementation(() => ({
      ...realGetInitialSettings(),
      respondToBashCommands: true,
    }))
    bashCallMock.mockImplementation(async () => ({
      data: {
        stdout: '',
        stderr: '',
        interrupted: false,
        backgroundTaskId: 'bg-1',
      },
    }))
    const { processBashCommand } = await import('../processBashCommand.js')
    const abortController = new AbortController()
    const result = await processBashCommand(
      'sleep 100',
      [],
      [],
      {
        options: { verbose: false },
        abortController,
        setToolJSX: () => {},
      } as never,
      () => {},
    )
    expect(result.shouldQuery).toBe(false)
  })
})
