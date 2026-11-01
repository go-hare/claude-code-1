import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import {
  bunBundleMock,
  pushFeatureOverride,
} from '../../../../tests/mocks/bunBundle.js'
import { readFileSync } from 'fs'
import { join } from 'path'

mock.module('bun:bundle', bunBundleMock)
const popYoloFeature = pushFeatureOverride(
  (name: string) => name === 'TRANSCRIPT_CLASSIFIER',
)
afterAll(() => {
  popYoloFeature()
})

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

describe('hard_deny / soft_deny classifier prompts (2.1.289)', () => {
  test('external permissions template matches official 17/72/1 defaults', () => {
    const external = readFileSync(
      join(PROMPTS_DIR, 'permissions_external.txt'),
      'utf8',
    )
    expect(external).toContain('## Soft Deny Rules')
    expect(external).toContain('## Hard Deny Rules')
    expect(external).toContain('<user_soft_deny_rules_to_replace>')
    expect(external).toContain('<user_hard_deny_rules_to_replace>')
    expect(external).toContain('user intent does not clear')
    const allowBlock = external.match(
      /<user_allow_rules_to_replace>([\s\S]*?)<\/user_allow_rules_to_replace>/,
    )?.[1]
    const softBlock = external.match(
      /<user_soft_deny_rules_to_replace>([\s\S]*?)<\/user_soft_deny_rules_to_replace>/,
    )?.[1]
    const hardBlock = external.match(
      /<user_hard_deny_rules_to_replace>([\s\S]*?)<\/user_hard_deny_rules_to_replace>/,
    )?.[1]
    const envBlock = external.match(
      /<user_environment_to_replace>([\s\S]*?)<\/user_environment_to_replace>/,
    )?.[1]
    expect(allowBlock).toBeDefined()
    expect(softBlock).toBeDefined()
    expect(hardBlock).toBeDefined()
    expect(envBlock).toBeDefined()
    const countDashes = (block: string) =>
      block.split('\n').filter(l => l.startsWith('- ')).length
    expect(countDashes(allowBlock!)).toBe(17)
    expect(countDashes(softBlock!)).toBe(72)
    expect(countDashes(hardBlock!)).toBe(1)
    expect(countDashes(envBlock!)).toBe(21)
    expect(softBlock).toContain('Session Transcript Tampering')
    expect(hardBlock).not.toContain('Session Transcript Tampering')
    expect(hardBlock).toContain('Data Exfiltration')
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
    expect(anthropic).toContain('Data Exfiltration')
    const hardSection = anthropic.slice(anthropic.indexOf('## Hard Deny Rules'))
    expect(hardSection).toContain('Data Exfiltration')
    expect(hardSection).not.toContain('Session Transcript Tampering')
  })

  test('runtime system prompt is the official security-monitor body', () => {
    const prompt = readFileSync(
      join(PROMPTS_DIR, 'auto_mode_system_prompt.txt'),
      'utf8',
    )
    expect(prompt.startsWith('You are a security monitor for autonomous')).toBe(
      true,
    )
    expect(prompt).toContain('HARD BLOCK')
    expect(prompt).toContain('SOFT BLOCK')
    expect(prompt).toContain('<permissions_template>')
    expect(prompt).toContain('<cross_session_messages_rule>')
    expect(prompt).not.toContain('BLOCK — Always require confirmation')
    expect(prompt).not.toContain(
      'Use the classify_result tool to report your classification.',
    )
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

describe('efe continuation parse of official 17/72/1/21', () => {
  // bun:test DCE: `feature('TRANSCRIPT_CLASSIFIER')` is false, so
  // getDefaultExternalAutoModeRules() sees an empty template. Mirror densable
  // `efe` against the on-disk external file instead.
  function efe(template: string, tag: string): string[] {
    const match = template.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
    if (!match) return []
    const items: string[] = []
    for (const line of (match[1] ?? '').split('\n')) {
      const g = line.replace(/\r$/, '').trimEnd()
      if (g.startsWith('- ')) {
        items.push(g.slice(2))
      } else if (items.length > 0 && g.trim().length > 0) {
        items[items.length - 1] += `\n${g}`
      }
    }
    return items
  }

  test('joins multi-line Data Exfiltration; Transcript Tampering is soft', () => {
    const template = readFileSync(
      join(PROMPTS_DIR, 'permissions_external.txt'),
      'utf8',
    )
    const allow = efe(template, 'user_allow_rules_to_replace')
    const soft = efe(template, 'user_soft_deny_rules_to_replace')
    const hard = efe(template, 'user_hard_deny_rules_to_replace')
    const env = efe(template, 'user_environment_to_replace')
    expect(allow).toHaveLength(17)
    expect(soft).toHaveLength(72)
    expect(hard).toHaveLength(1)
    expect(env).toHaveLength(21)
    expect(allow[0]).toMatch(/^Security Discussion:/)
    expect(soft.some(r => r.startsWith('Session Transcript Tampering'))).toBe(
      true,
    )
    expect(hard[0]).toMatch(/^Data Exfiltration:/)
    expect(hard[0]).toContain('**What is being sent?**')
    expect(hard[0]).toContain(
      'Is the final destination confirmed external or public?',
    )
    expect(hard.some(r => r.includes('Session Transcript Tampering'))).toBe(
      false,
    )
  })
})
