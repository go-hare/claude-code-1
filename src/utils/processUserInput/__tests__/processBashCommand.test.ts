import { afterEach, describe, expect, mock, test } from 'bun:test'

const getInitialSettingsMock = mock(() => ({
  respondToBashCommands: true as boolean | undefined,
}))

// Keep settings mock surface wide enough to avoid process-global mock pollution
// when this file runs in the same process as other settings consumers.
mock.module('src/utils/settings/settings.ts', () => ({
  loadManagedFileSettings: () => ({ settings: null, errors: [] }),
  getManagedFileSettingsPresence: () => ({
    hasBase: false,
    hasDropIns: false,
  }),
  parseSettingsFile: () => ({ settings: null, errors: [] }),
  getSettingsRootPathForSource: () => '',
  getSettingsFilePathForSource: () => undefined,
  getRelativeSettingsFilePathForSource: () => '',
  getInitialSettings: getInitialSettingsMock,
  getSettings_DEPRECATED: getInitialSettingsMock,
  getSettingsForSource: () => null,
  getPolicySettingsOrigin: () => null,
  getSettingsWithErrors: () => ({
    settings: getInitialSettingsMock(),
    errors: [],
  }),
  getSettingsWithSources: () => ({
    effective: getInitialSettingsMock(),
    sources: [],
  }),
  settingsMergeCustomizer: () => undefined,
  getManagedSettingsKeysForLogging: () => [],
  updateSettingsForSource: () => ({ error: null }),
  hasAutoModeOptIn: () => true,
  hasSkipDangerousModePermissionPrompt: () => false,
  getAutoModeConfig: () => undefined,
  getUseAutoModeDuringPlan: () => true,
  rawSettingsContainsKey: () => false,
}))

mock.module('src/utils/shell/resolveDefaultShell.js', () => ({
  resolveDefaultShell: () => 'bash',
}))

mock.module('src/utils/shell/shellToolUtils.js', () => ({
  SHELL_TOOL_NAMES: ['Bash', 'PowerShell'],
  isPowerShellToolEnabled: () => false,
}))

const bashCallMock = mock(async () => ({
  data: {
    stdout: 'hello',
    stderr: '',
    interrupted: false,
    backgroundTaskId: undefined as string | undefined,
  },
}))

// Full BashTool surface used by processBashCommand + processToolResultBlock.
mock.module('@claude-code/builtin-tools/tools/BashTool/BashTool.js', () => ({
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
}))

describe('processBashCommand respondToBashCommands', () => {
  afterEach(() => {
    getInitialSettingsMock.mockReset()
    getInitialSettingsMock.mockImplementation(() => ({
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
