import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realProviders from 'src/utils/model/providers.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

const providersSnap = snapshotModuleExports(realProviders)
let providerOverride: ReturnType<typeof realProviders.getAPIProvider> | null =
  null

mock.module('src/utils/model/providers.js', () => ({
  ...providersSnap,
  getAPIProvider: (...args: Parameters<typeof realProviders.getAPIProvider>) =>
    providerOverride ??
    (providersSnap.getAPIProvider as typeof realProviders.getAPIProvider)(
      ...args,
    ),
}))

const {
  getBuddyReactionModel,
  installCompanionObserver,
  parseBuddyReactionResponse,
  triggerCompanionReaction,
} = await import('../companionReact.js')

const ORIGINAL_ENV = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_SMALL_FAST_MODEL: process.env.OPENAI_SMALL_FAST_MODEL,
  OPENAI_DEFAULT_HAIKU_MODEL: process.env.OPENAI_DEFAULT_HAIKU_MODEL,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

beforeAll(() => {
  // ensure dynamic import resolved under the mock
  expect(typeof getBuddyReactionModel).toBe('function')
})

afterEach(() => {
  providerOverride = null
  restoreEnv()
  delete (
    globalThis as typeof globalThis & {
      fireCompanionObserver?: unknown
    }
  ).fireCompanionObserver
})

afterAll(() => {
  mock.module('src/utils/model/providers.js', () => ({ ...providersSnap }))
})

describe('companionReact', () => {
  test('registers global companion observer', () => {
    installCompanionObserver()

    expect(
      (
        globalThis as typeof globalThis & {
          fireCompanionObserver?: unknown
        }
      ).fireCompanionObserver,
    ).toBe(triggerCompanionReaction)
  })

  test('uses OPENAI_MODEL for reactions when no haiku override is configured', () => {
    // Pin provider — host settings often have modelType=anthropic which
    // short-circuits CLAUDE_CODE_USE_OPENAI via getAPIProvider().
    providerOverride = 'openai'
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-5.4'
    delete process.env.OPENAI_SMALL_FAST_MODEL
    delete process.env.OPENAI_DEFAULT_HAIKU_MODEL
    delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL

    expect(getBuddyReactionModel()).toBe('gpt-5.4')
  })

  test('prefers OPENAI_SMALL_FAST_MODEL when configured', () => {
    providerOverride = 'openai'
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_MODEL = 'gpt-5.4'
    process.env.OPENAI_SMALL_FAST_MODEL = 'gpt-4.1-mini'

    expect(getBuddyReactionModel()).toBe('gpt-4.1-mini')
  })

  test('parses structured and plain reaction responses', () => {
    expect(
      parseBuddyReactionResponse('{"reaction":"小家伙先围观一下。"}'),
    ).toBe('小家伙先围观一下。')
    expect(parseBuddyReactionResponse('Nice recovery.')).toBe('Nice recovery.')
    expect(parseBuddyReactionResponse('{"reaction":42}')).toBeNull()
  })
})
