import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resetModelStringsForTestingOnly } from 'src/bootstrap/state.js'
import { queryModelGemini } from 'src/services/api/gemini/index.js'
import type { Options } from 'src/services/api/claude.js'
import type { Message } from 'src/types/message.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from 'src/utils/settings/settingsCache.js'
import {
  getContextWindowForModel,
  isRecognizedModelForWindowEnforcement,
} from '../../context.js'
import {
  getDefaultEffortForModel,
  getSupportedEffortLevels,
  modelSupportsEffort,
  resolveAppliedEffort,
} from '../../effort.js'
import { catalogHasEffort, lookupEffortCatalog } from '../effortCatalog.js'
import {
  GEMINI_1M_CONTEXT_WINDOW,
  GEMINI_MODEL_OPTIONS,
  getGeminiModelContextWindow,
} from '../geminiModels.js'
import {
  getDefaultHaikuModel,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getMainLoopModel,
  getSmallFastModel,
  parseUserSpecifiedModel,
} from '../model.js'
import { getDefaultOptionForUser, getModelOptions } from '../modelOptions.js'

const envKeys = [
  'USER_TYPE',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_GATEWAY',
  'GEMINI_MODEL',
  'GEMINI_MODEL_MAP',
  'GEMINI_SMALL_FAST_MODEL',
  'GEMINI_DEFAULT_SONNET_MODEL',
  'GEMINI_DEFAULT_OPUS_MODEL',
  'GEMINI_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const

const savedEnv: Record<string, string | undefined> = {}

function resetState(): void {
  resetSettingsCache()
  setSessionSettingsCache({ settings: {}, errors: [] })
  resetModelStringsForTestingOnly()
}

beforeEach(() => {
  for (const key of envKeys) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  resetState()
})

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  resetState()
})

describe('GEMINI_MODEL_OPTIONS', () => {
  test('lists current-spec chat/text ids with gemini-4-argon first', () => {
    expect(GEMINI_MODEL_OPTIONS.map(row => row.value)).toEqual([
      'gemini-4-argon',
      'gemini-3.8-flash',
    ])
  })
})

describe('getGeminiModelContextWindow', () => {
  test('gemini-4-argon is 1M', () => {
    expect(getGeminiModelContextWindow('gemini-4-argon')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
    expect(getGeminiModelContextWindow('gemini-4-argon-preview')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
  })

  test('gemini-3.8-flash is 1M', () => {
    expect(getGeminiModelContextWindow('gemini-3.8-flash')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
  })

  test('provider-prefixed ids use the last path segment', () => {
    expect(getGeminiModelContextWindow('models/gemini-4-argon')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
    expect(getGeminiModelContextWindow('google/gemini-3.8-flash')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
    expect(
      getGeminiModelContextWindow('openrouter/google/gemini-4-argon'),
    ).toBe(GEMINI_1M_CONTEXT_WINDOW)
  })

  test('strips [1m] suffix before lookup', () => {
    expect(getGeminiModelContextWindow('gemini-4-argon[1m]')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
  })

  test('version-boundary: gemini-4-argon2 and gemini-3.8-flash2 do not match', () => {
    expect(getGeminiModelContextWindow('gemini-4-argon2')).toBeUndefined()
    expect(getGeminiModelContextWindow('gemini-3.8-flash2')).toBeUndefined()
  })

  test('realtime/speech ids stay undefined (no invented window)', () => {
    expect(getGeminiModelContextWindow('gemini-3.8-live')).toBeUndefined()
    expect(
      getGeminiModelContextWindow('gemini-3.8-live-extended-thinking'),
    ).toBeUndefined()
    expect(getGeminiModelContextWindow('gemini-3.8-flash-tts')).toBeUndefined()
    expect(
      getGeminiModelContextWindow('gemini-3.8-flash-lite-tts'),
    ).toBeUndefined()
  })

  test('unlisted gemini ids stay undefined (no invented window)', () => {
    expect(getGeminiModelContextWindow('gemini-3.7-flash')).toBeUndefined()
    expect(getGeminiModelContextWindow('gemini-3.6-flash')).toBeUndefined()
    expect(getGeminiModelContextWindow('gemini-2.5-flash')).toBeUndefined()
    expect(getGeminiModelContextWindow('gemini-custom')).toBeUndefined()
  })

  test('non-gemini ids are undefined', () => {
    expect(getGeminiModelContextWindow('claude-opus-5')).toBeUndefined()
    expect(getGeminiModelContextWindow('grok-4.7')).toBeUndefined()
  })
})

describe('Gemini window wiring through getContextWindowForModel', () => {
  test('gemini-4-argon is recognized at 1M', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(isRecognizedModelForWindowEnforcement('gemini-4-argon')).toBe(true)
    expect(getContextWindowForModel('gemini-4-argon')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
  })

  test('gemini-3.8-flash is recognized at 1M', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(isRecognizedModelForWindowEnforcement('gemini-3.8-flash')).toBe(true)
    expect(getContextWindowForModel('gemini-3.8-flash')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
  })

  test('unlisted gemini-3.7-flash stays unknown 200k', () => {
    expect(isRecognizedModelForWindowEnforcement('gemini-3.7-flash')).toBe(
      false,
    )
    expect(getContextWindowForModel('gemini-3.7-flash')).toBe(200_000)
  })

  test('DISABLE_1M clamps gemini-4-argon 1M to 200k', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(getContextWindowForModel('gemini-4-argon')).toBe(200_000)
  })

  test('gemini-4-argon[1m] preserves exact 1,048,576 window', () => {
    expect(getContextWindowForModel('gemini-4-argon[1m]')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
    expect(getContextWindowForModel('gemini-3.8-flash[1m]')).toBe(
      GEMINI_1M_CONTEXT_WINDOW,
    )
  })
})

describe('Gemini effortCatalog boundaries and realtime/tts exclusions', () => {
  test('-tts and -live Gemini ids return effort: false', () => {
    for (const id of [
      'gemini-3.8-flash-tts',
      'gemini-3.8-flash-lite-tts',
      'gemini-3.8-live',
      'gemini-3.8-live-extended-thinking',
      'gemini-4-argon-tts',
      'models/gemini-3.8-flash-tts',
    ]) {
      expect(lookupEffortCatalog(id)?.effort).toBe(false)
      expect(catalogHasEffort(id)).toBe(false)
      expect(modelSupportsEffort(id)).toBe(false)
      expect(getSupportedEffortLevels(id)).toEqual([])
      expect(resolveAppliedEffort(id, 'high')).toBeUndefined()
    }
  })

  test('version boundary excludes gemini-4-argon2 and gemini-3.8-flash2', () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    expect(lookupEffortCatalog('gemini-4-argon2')).toBeUndefined()
    expect(lookupEffortCatalog('gemini-3.8-flash2')).toBeUndefined()
    expect(modelSupportsEffort('gemini-4-argon2')).toBe(false)
    expect(modelSupportsEffort('gemini-3.8-flash2')).toBe(false)

    expect(lookupEffortCatalog('gemini-4-argon-preview')?.effort).toBe(true)
    expect(lookupEffortCatalog('models/gemini-3.8-flash')?.effort).toBe(true)
  })
})

describe('Zero-config Gemini provider defaults', () => {
  test('resolves default family models, mainLoopModel, 1M window, effort, and /model Default row', () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'

    expect(getDefaultSonnetModel()).toBe('gemini-3.8-flash')
    expect(getDefaultOpusModel()).toBe('gemini-4-argon')
    expect(getDefaultHaikuModel()).toBe('gemini-3.8-flash')
    expect(getSmallFastModel()).toBe('gemini-3.8-flash')
    expect(parseUserSpecifiedModel('sonnet')).toBe('gemini-3.8-flash')
    expect(parseUserSpecifiedModel('opus')).toBe('gemini-4-argon')
    expect(parseUserSpecifiedModel('haiku')).toBe('gemini-3.8-flash')

    const mainModel = getMainLoopModel()
    expect(mainModel).toBe('gemini-3.8-flash')
    expect(getContextWindowForModel(mainModel)).toBe(GEMINI_1M_CONTEXT_WINDOW)
    expect(modelSupportsEffort(mainModel)).toBe(true)
    expect(getSupportedEffortLevels(mainModel)).toEqual([
      'low',
      'medium',
      'high',
    ])
    expect(getDefaultEffortForModel(mainModel)).toBe('medium')

    const defaultOpt = getDefaultOptionForUser()
    expect(defaultOpt.value).toBeNull()
    expect(defaultOpt.description).toContain('gemini-3.8-flash')
    expect(getModelOptions()[0]?.description).toContain('gemini-3.8-flash')
  })

  test('respects GEMINI_MODEL, GEMINI_DEFAULT_*_MODEL, and GEMINI_SMALL_FAST_MODEL', () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-custom-sonnet'
    process.env.GEMINI_DEFAULT_OPUS_MODEL = 'gemini-custom-opus'
    process.env.GEMINI_DEFAULT_HAIKU_MODEL = 'gemini-custom-haiku'

    expect(getDefaultSonnetModel()).toBe('gemini-custom-sonnet')
    expect(getDefaultOpusModel()).toBe('gemini-custom-opus')
    expect(getDefaultHaikuModel()).toBe('gemini-custom-haiku')

    process.env.GEMINI_MODEL = 'gemini-4-argon'
    process.env.GEMINI_SMALL_FAST_MODEL = 'gemini-fast-lite'

    expect(getDefaultSonnetModel()).toBe('gemini-4-argon')
    expect(getDefaultOpusModel()).toBe('gemini-4-argon')
    expect(getDefaultHaikuModel()).toBe('gemini-fast-lite')
    expect(getMainLoopModel()).toBe('gemini-4-argon')
    expect(getDefaultOptionForUser().description).toContain('gemini-4-argon')
  })
})

describe('queryModelGemini thinkingConfig mutual exclusivity', () => {
  async function captureGeminiRequestBody(args: {
    model: string
    effortValue?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    thinkingConfig:
      | { type: 'enabled'; budgetTokens: number }
      | { type: 'adaptive' }
      | { type: 'disabled' }
  }): Promise<Record<string, unknown>> {
    let capturedBody: Record<string, unknown> = {}
    const ssePayload = `data: ${JSON.stringify({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'ok' }] },
          finishReason: 'STOP',
        },
      ],
    })}\n\n`

    const fetchOverride = (async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >
      return new Response(ssePayload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch

    const messages: Message[] = [
      {
        type: 'user',
        uuid: '00000000-0000-0000-0000-000000000001',
        timestamp: '2026-11-05T00:00:00.000Z',
        message: { role: 'user', content: 'hi' },
      } as unknown as Message,
    ]

    const options = {
      model: args.model,
      effortValue: args.effortValue,
      fetchOverride,
      getToolPermissionContext: async () => ({
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      }),
    } as unknown as Options

    for await (const _event of queryModelGemini(
      messages,
      asSystemPrompt([]),
      [],
      new AbortController().signal,
      options,
      args.thinkingConfig,
    )) {
      // drain generator
    }

    return capturedBody
  }

  test('emits thinkingLevel without thinkingBudget for Gemini 3.8 / 4 models', async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    const body = await captureGeminiRequestBody({
      model: 'gemini-3.8-flash',
      thinkingConfig: { type: 'enabled', budgetTokens: 31_999 },
    })
    const genConfig = body.generationConfig as Record<string, unknown>
    expect(genConfig.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: 'medium',
    })
  })

  test('emits thinkingBudget without thinkingLevel for legacy Gemini 2.5 models', async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    const body = await captureGeminiRequestBody({
      model: 'gemini-2.5-flash',
      thinkingConfig: { type: 'enabled', budgetTokens: 8_192 },
    })
    const genConfig = body.generationConfig as Record<string, unknown>
    expect(genConfig.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: 8_192,
    })
  })

  test('omits thinkingConfig when thinking is disabled', async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    const body = await captureGeminiRequestBody({
      model: 'gemini-4-argon',
      thinkingConfig: { type: 'disabled' },
    })
    const genConfig = body.generationConfig as Record<string, unknown>
    expect(genConfig.thinkingConfig).toBeUndefined()
  })
})
