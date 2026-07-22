import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const PROMPTS_DIR = join(import.meta.dir, '../yolo-classifier-prompts')

describe('getClassifierTemperature (CLAUDE_CODE_AUTO_MODE_TEMPERATURE)', () => {
  test('defaults to 0 and parses valid env', async () => {
    const { getClassifierTemperature } = await import('../yoloClassifier.js')
    expect(getClassifierTemperature({})).toBe(0)
    expect(
      getClassifierTemperature({ CLAUDE_CODE_AUTO_MODE_TEMPERATURE: '0.2' }),
    ).toBe(0.2)
    expect(
      getClassifierTemperature({ CLAUDE_CODE_AUTO_MODE_TEMPERATURE: '3' }),
    ).toBe(0)
    expect(
      getClassifierTemperature({ CLAUDE_CODE_AUTO_MODE_TEMPERATURE: 'nope' }),
    ).toBe(0)
  })
})

describe('hard_deny / soft_deny classifier prompts (2.1.205)', () => {
  test('external permissions template splits soft vs hard deny', () => {
    const external = readFileSync(
      join(PROMPTS_DIR, 'permissions_external.txt'),
      'utf8',
    )
    expect(external).toContain('## Soft Deny Rules')
    expect(external).toContain('## Hard Deny Rules')
    expect(external).toContain('<user_soft_deny_rules_to_replace>')
    expect(external).toContain('<user_hard_deny_rules_to_replace>')
    expect(external).toContain('Session Transcript Tampering')
    expect(external).toContain('user intent does not clear')
    // soft section must not still hold transcript tampering
    const softBlock = external.match(
      /<user_soft_deny_rules_to_replace>([\s\S]*?)<\/user_soft_deny_rules_to_replace>/,
    )?.[1]
    expect(softBlock).toBeDefined()
    expect(softBlock).not.toContain('Session Transcript Tampering')
    const hardBlock = external.match(
      /<user_hard_deny_rules_to_replace>([\s\S]*?)<\/user_hard_deny_rules_to_replace>/,
    )?.[1]
    expect(hardBlock).toBeDefined()
    expect(hardBlock).toContain('Session Transcript Tampering')
  })

  test('anthropic permissions template has hard_deny replace tags', () => {
    const anthropic = readFileSync(
      join(PROMPTS_DIR, 'permissions_anthropic.txt'),
      'utf8',
    )
    expect(anthropic).toContain('## Soft Deny Rules')
    expect(anthropic).toContain('## Hard Deny Rules')
    expect(anthropic).toContain('<user_soft_deny_rules_to_replace>')
    expect(anthropic).toContain('<user_hard_deny_rules_to_replace>')
    expect(anthropic).toContain('Session Transcript Tampering')
  })
})

// getAutoModeConfig hard_deny merge — mock settings sources only.
// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
import * as realSettings from 'src/utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

const getSettingsForSourceMock = mock(
  (_source?: string) =>
    null as ReturnType<typeof realSettings.getSettingsForSource>,
)
const settingsSnap = snapshotModuleExports(realSettings)

mock.module('bun:bundle', () => ({
  feature: (name: string) => name === 'TRANSCRIPT_CLASSIFIER',
}))

function mockGetAutoModeConfig() {
  const allow: string[] = []
  const soft_deny: string[] = []
  const hard_deny: string[] = []
  const environment: string[] = []
  for (const source of [
    'userSettings',
    'flagSettings',
    'policySettings',
  ] as const) {
    const settings = getSettingsForSourceMock(source) as {
      autoMode?: {
        allow?: string[]
        soft_deny?: string[]
        hard_deny?: string[]
        environment?: string[]
      }
    } | null
    const am = settings?.autoMode
    if (!am) continue
    if (am.allow) allow.push(...am.allow)
    if (am.soft_deny) soft_deny.push(...am.soft_deny)
    if (am.hard_deny) hard_deny.push(...am.hard_deny)
    if (am.environment) environment.push(...am.environment)
  }
  if (
    allow.length ||
    soft_deny.length ||
    hard_deny.length ||
    environment.length
  ) {
    return {
      ...(allow.length && { allow }),
      ...(soft_deny.length && { soft_deny }),
      ...(hard_deny.length && { hard_deny }),
      ...(environment.length && { environment }),
    }
  }
  return undefined
}

const settingsMock = createSettingsMock(settingsSnap, {
  getSettingsForSource:
    getSettingsForSourceMock as typeof realSettings.getSettingsForSource,
  getSettings_DEPRECATED: () => ({}),
  getInitialSettings: () => ({}),
  hasAutoModeOptIn: () => true,
  getAutoModeConfig: mockGetAutoModeConfig,
})
mock.module('src/utils/settings/settings.ts', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)

const { getAutoModeConfig } = await import('src/utils/settings/settings.js')

afterEach(() => {
  getSettingsForSourceMock.mockReset()
  getSettingsForSourceMock.mockImplementation(() => null)
})

afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap)
})

describe('getAutoModeConfig hard_deny merge', () => {
  test('returns undefined when no autoMode rules', () => {
    expect(getAutoModeConfig()).toBeUndefined()
  })

  test('merges hard_deny from userSettings', () => {
    getSettingsForSourceMock.mockImplementation((source?: string) =>
      source === 'userSettings'
        ? {
            autoMode: {
              hard_deny: ['Block transcript writes'],
              soft_deny: ['Ask before rm -rf'],
            },
          }
        : null,
    )
    const cfg = getAutoModeConfig()
    expect(cfg?.hard_deny).toEqual(['Block transcript writes'])
    expect(cfg?.soft_deny).toEqual(['Ask before rm -rf'])
  })
})
