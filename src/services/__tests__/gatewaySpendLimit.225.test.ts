import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { debugMock } from '../../../tests/mocks/debug.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

mock.module('src/utils/debug.js', debugMock)
mock.module('src/utils/debug.ts', debugMock)

let provider: 'gateway' | 'firstParty' = 'firstParty'

const providersSnap = snapshotModuleExports(
  await import('../../utils/model/providers.js'),
)
mock.module('src/utils/model/providers.js', () => ({
  ...providersSnap,
  getAPIProvider: () => provider,
  isAnthropicStyleApiProvider: () =>
    provider === 'gateway' || provider === 'firstParty',
}))
mock.module('src/utils/model/providers.ts', () => ({
  ...providersSnap,
  getAPIProvider: () => provider,
  isAnthropicStyleApiProvider: () =>
    provider === 'gateway' || provider === 'firstParty',
}))

const authSnap = snapshotModuleExports(await import('../../utils/auth.js'))
mock.module('src/utils/auth.js', () => ({
  ...authSnap,
  isClaudeAISubscriber: () => false,
}))
mock.module('src/utils/auth.ts', () => ({
  ...authSnap,
  isClaudeAISubscriber: () => false,
}))

const mockLimitsSnap = snapshotModuleExports(
  await import('../mockRateLimits.js'),
)
mock.module('src/services/mockRateLimits.js', () => ({
  ...mockLimitsSnap,
  shouldProcessMockLimits: () => false,
  getMockHeaders: () => null,
  getMockHeaderless429Message: () => null,
  isMockFastModeRateLimitScenario: () => false,
}))

const bootstrapSnap = snapshotModuleExports(
  await import('../../bootstrap/state.js'),
)
const stateMock = () => ({
  ...bootstrapSnap,
  getIsNonInteractiveSession: () => false,
})
mock.module('src/bootstrap/state.ts', stateMock)
mock.module('src/bootstrap/state.js', stateMock)

afterAll(() => {
  mock.module('src/utils/model/providers.js', () => ({ ...providersSnap }))
  mock.module('src/utils/model/providers.ts', () => ({ ...providersSnap }))
  mock.module('src/utils/auth.js', () => ({ ...authSnap }))
  mock.module('src/utils/auth.ts', () => ({ ...authSnap }))
  mock.module('src/services/mockRateLimits.js', () => ({ ...mockLimitsSnap }))
  mock.module('src/bootstrap/state.ts', () => ({ ...bootstrapSnap }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
})

describe('gateway spend-limit 2.1.225', () => {
  beforeEach(() => {
    provider = 'firstParty'
  })

  afterEach(() => {
    provider = 'firstParty'
  })

  test('shouldProcessRateLimits is true for gateway even when not subscriber', async () => {
    provider = 'gateway'
    const { shouldProcessRateLimits } = await import('../rateLimitMocking.js')
    expect(shouldProcessRateLimits(false)).toBe(true)
  })

  test('shouldProcessRateLimits is false for non-subscriber non-gateway', async () => {
    provider = 'firstParty'
    const { shouldProcessRateLimits } = await import('../rateLimitMocking.js')
    expect(shouldProcessRateLimits(false)).toBe(false)
  })

  test('gateway spend body message is surfaced when only overage-disabled-reason is set', async () => {
    provider = 'gateway'
    const { getAssistantMessageFromError } = await import('../api/errors.js')

    const spendMsg =
      'spend limit reached (monthly; resets 2026-08-13 00:00 UTC) — contact your platform admin'
    const headers = new Headers({
      'anthropic-ratelimit-unified-status': 'rejected',
      'anthropic-ratelimit-unified-reset': '1786665600',
      'anthropic-ratelimit-unified-overage-disabled-reason':
        'org_spend_cap_reached',
    })
    const body = {
      type: 'error',
      error: { type: 'billing_error', message: spendMsg },
    }
    const err = new APIError(429, body, `429 ${JSON.stringify(body)}`, headers)

    const msg = getAssistantMessageFromError(err, 'claude-sonnet-4')
    const contentBlocks = msg.message?.content
    const textBlock = Array.isArray(contentBlocks)
      ? contentBlocks.find(
          (b): b is { type: 'text'; text: string } =>
            typeof b === 'object' &&
            b !== null &&
            (b as { type?: string }).type === 'text',
        )
      : undefined
    const content = textBlock?.text ?? ''
    expect(content).toContain('spend limit reached')
    expect(content).toContain('contact your platform admin')
    expect(content.startsWith('API Error:')).toBe(false)
  })
})
