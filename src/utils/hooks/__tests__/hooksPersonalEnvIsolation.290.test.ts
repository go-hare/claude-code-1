import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { execCommandHook } from '../../hooks.js'
import {
  clearPersonalPluginEnvSetKeysForReset,
  getPersonalPluginEnvSetKeys,
  handleHostOp,
  setLoadedFunctionHooksModules,
} from '../../plugins/functionHooksModules.js'
import * as settingsModule from '../../settings/settings.js'

const TEST_ENV_KEY = 'CLAUDE_TEST_PERSONAL_PLUGIN_HOOK_VAR_696'

describe('#696 managed command hooks isolate personal plugin $.env.set', () => {
  let settingsSpy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    settingsSpy?.mockRestore()
    settingsSpy = undefined
    clearPersonalPluginEnvSetKeysForReset()
    setLoadedFunctionHooksModules([])
    delete process.env[TEST_ENV_KEY]
  })

  test('execCommandHook isolates personal plugin $.env.set for policySettings hooks', async () => {
    const command = `node -e "process.stdout.write(String(process.env.${TEST_ENV_KEY} ?? 'UNSET'))"`
    const originalGetSettingsForSource = settingsModule.getSettingsForSource
    settingsSpy = spyOn(
      settingsModule,
      'getSettingsForSource',
    ).mockImplementation(source => {
      if (source === 'policySettings') {
        return {
          hooks: {
            SessionStart: [
              {
                hooks: [{ type: 'command', command }],
              },
            ],
          },
        }
      }
      return originalGetSettingsForSource(source)
    })

    process.env[TEST_ENV_KEY] = 'initial-before'
    setLoadedFunctionHooksModules([
      {
        name: 'personal-plugin',
        root: '/tmp/personal-plugin',
        pluginStorageId: 'personal-plugin@local',
        tier: 'user',
        patterns: [],
        hooks: [],
      },
    ])

    await handleHostOp(
      'env.set',
      [{ name: TEST_ENV_KEY, value: 'personal-override' }],
      'personal-plugin',
    )
    expect(getPersonalPluginEnvSetKeys()).toEqual([TEST_ENV_KEY])

    const managedResult = await execCommandHook(
      { type: 'command', command },
      'SessionStart',
      'SessionStart',
      '{}',
      new AbortController().signal,
      'hook-managed-696',
    )
    expect(managedResult.status).toBe(0)
    expect(managedResult.stdout).toBe('initial-before')
    // Host process.env is restored after managed hook env capture
    expect(process.env[TEST_ENV_KEY]).toBe('personal-override')

    // Non-managed hook (different command not in policySettings) still sees plugin override
    const userCommand = `node -e "process.stdout.write(String(process.env.${TEST_ENV_KEY} ?? 'UNSET'))"`
    const userResult = await execCommandHook(
      { type: 'command', command: userCommand, shell: 'bash' },
      'PreToolUse',
      'PreToolUse',
      '{}',
      new AbortController().signal,
      'hook-user-696',
    )
    expect(userResult.status).toBe(0)
    expect(userResult.stdout).toBe('personal-override')
  })
})
