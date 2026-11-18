import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { LocalCommandCall } from '../../types/command.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import * as settingsModule from '../../utils/settings/settings.js'
import provider from '../provider.js'

type ProviderCtx = Parameters<LocalCommandCall>[1]

const SAVED_ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_AUTH_MODE',
  'GEMINI_API_KEY',
  'GROK_API_KEY',
  'XAI_API_KEY',
] as const

describe('/provider command', () => {
  const prevEnv: Record<string, string | undefined> = {}
  for (const key of SAVED_ENV_KEYS) {
    prevEnv[key] = process.env[key]
  }
  let fakeSettings: Record<string, unknown> = {}
  const getSpy = spyOn(
    settingsModule,
    'getSettings_DEPRECATED',
  ).mockImplementation(
    () =>
      fakeSettings as ReturnType<typeof settingsModule.getSettings_DEPRECATED>,
  )
  const updateSpy = spyOn(
    settingsModule,
    'updateSettingsForSource',
  ).mockImplementation((_source, updates) => {
    const next = { ...fakeSettings, ...updates }
    if (updates.modelType === undefined && 'modelType' in updates) {
      delete next.modelType
    }
    fakeSettings = next
    return { error: null }
  })

  afterEach(() => {
    fakeSettings = {}
    for (const key of SAVED_ENV_KEYS) {
      if (prevEnv[key] === undefined) delete process.env[key]
      else process.env[key] = prevEnv[key]
    }
  })

  test('switching to openai with missing credentials still clears stale cloud env flags and avoids /login hint', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_AUTH_MODE

    const mod = await provider.load()
    const res = await mod.call('openai', {} as ProviderCtx)

    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(fakeSettings.modelType).toBe('openai')
    expect(
      getAPIProvider(
        fakeSettings as {
          modelType?: 'anthropic' | 'openai' | 'gemini' | 'grok'
        },
      ),
    ).toBe('openai')
    expect(res.type).toBe('text')
    if (res.type === 'text') {
      expect(res.value).toContain('Warning: Missing env vars')
      expect(res.value).not.toContain('/login')
    }
  })

  test('switching between cloud providers clears prior cloud flag, clears persisted modelType, and preserves OPENAI credentials', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-keep'
    process.env.OPENAI_BASE_URL = 'https://example.invalid/v1'

    const mod = await provider.load()
    await mod.call('openai', {} as ProviderCtx)
    expect(
      getAPIProvider(
        fakeSettings as {
          modelType?: 'anthropic' | 'openai' | 'gemini' | 'grok'
        },
      ),
    ).toBe('openai')

    await mod.call('bedrock', {} as ProviderCtx)
    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(fakeSettings.modelType).toBeUndefined()
    expect(
      getAPIProvider(
        fakeSettings as {
          modelType?: 'anthropic' | 'openai' | 'gemini' | 'grok'
        },
      ),
    ).toBe('bedrock')
    expect(process.env.OPENAI_API_KEY).toBe('sk-test-keep')
    expect(process.env.OPENAI_BASE_URL).toBe('https://example.invalid/v1')

    await mod.call('vertex', {} as ProviderCtx)
    expect(process.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(process.env.CLAUDE_CODE_USE_VERTEX).toBe('1')
    expect(
      getAPIProvider(
        fakeSettings as {
          modelType?: 'anthropic' | 'openai' | 'gemini' | 'grok'
        },
      ),
    ).toBe('vertex')
    expect(getSpy).toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalled()
  })
})
