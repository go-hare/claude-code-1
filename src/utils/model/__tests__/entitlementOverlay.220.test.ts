import { describe, expect, test } from 'bun:test'
import {
  applyEntitlementBlindFallbackTarget,
  buildModelEntitlementDenySet,
  canonicalizeModelAccessApiName,
  getModelEntitlementDenySet,
  isEntitlementBlindOpus5Target,
  isEntitlementOverlayUnavailable,
  isModelDenied,
  type EntitlementOverlayDeps,
} from '../entitlementOverlay.js'

function deps(
  partial: Partial<EntitlementOverlayDeps> = {},
): EntitlementOverlayDeps {
  return {
    getProvider: () => 'firstParty',
    hasOAuthAccessToken: () => true,
    hasProfileScope: () => false,
    getAnthropicApiKey: () => null,
    getModelAccessCache: () => [],
    ...partial,
  }
}

describe('isEntitlementOverlayUnavailable densable zkt', () => {
  test('true when firstParty + oauth token + no profile + no api key + empty cache', () => {
    expect(isEntitlementOverlayUnavailable(deps())).toBe(true)
  })

  test('false when not firstParty', () => {
    expect(
      isEntitlementOverlayUnavailable(deps({ getProvider: () => 'bedrock' })),
    ).toBe(false)
    expect(
      isEntitlementOverlayUnavailable(deps({ getProvider: () => 'gateway' })),
    ).toBe(false)
  })

  test('false when no oauth access token (zv)', () => {
    expect(
      isEntitlementOverlayUnavailable(
        deps({ hasOAuthAccessToken: () => false }),
      ),
    ).toBe(false)
  })

  test('false when has profile scope (Sx)', () => {
    expect(
      isEntitlementOverlayUnavailable(deps({ hasProfileScope: () => true })),
    ).toBe(false)
  })

  test('false when anthropic api key present (nZ)', () => {
    expect(
      isEntitlementOverlayUnavailable(
        deps({ getAnthropicApiKey: () => 'sk-ant-x' }),
      ),
    ).toBe(false)
  })

  test('false when modelAccessCache non-empty (QXt)', () => {
    expect(
      isEntitlementOverlayUnavailable(
        deps({
          getModelAccessCache: () => [
            { apiName: 'claude-opus-4-8', entitled: true },
          ],
        }),
      ),
    ).toBe(false)
  })
})

describe('getModelEntitlementDenySet densable fq', () => {
  test('empty for non-firstParty/non-gateway', () => {
    expect(
      getModelEntitlementDenySet({
        getProvider: () => 'bedrock',
        getModelAccessCache: () => [
          { apiName: 'claude-opus-4-8', entitled: false },
        ],
      }).size,
    ).toBe(0)
  })

  test('firstParty builds deny set from entitled:false', () => {
    const set = getModelEntitlementDenySet({
      getProvider: () => 'firstParty',
      getModelAccessCache: () => [
        { apiName: 'claude-opus-4-8', entitled: false },
        { apiName: 'claude-sonnet-4-6', entitled: true },
      ],
    })
    expect(set.has(canonicalizeModelAccessApiName('claude-opus-4-8'))).toBe(
      true,
    )
    expect(set.has(canonicalizeModelAccessApiName('claude-sonnet-4-6'))).toBe(
      false,
    )
  })

  test('gateway also builds deny set', () => {
    const set = getModelEntitlementDenySet({
      getProvider: () => 'gateway',
      getModelAccessCache: () => [
        { apiName: 'claude-haiku-4-5', entitled: false },
      ],
    })
    expect(set.size).toBe(1)
  })
})

describe('isModelDenied densable XW', () => {
  test('empty deny set never denies', () => {
    expect(isModelDenied('claude-opus-4-8', new Set())).toBe(false)
  })

  test('membership on canonical name', () => {
    const deny = buildModelEntitlementDenySet([
      { apiName: 'claude-opus-4-8', entitled: false },
    ])
    expect(isModelDenied('claude-opus-4-8', deny)).toBe(true)
    expect(isModelDenied('claude-sonnet-4-6', deny)).toBe(false)
  })
})

describe('applyEntitlementBlindFallbackTarget densable _$c', () => {
  test('substitutes opus-5 → opus-4-8 when blind', () => {
    expect(applyEntitlementBlindFallbackTarget('claude-opus-5', deps())).toBe(
      'claude-opus-4-8',
    )
    expect(isEntitlementBlindOpus5Target('claude-opus-5', deps())).toBe(true)
    // densable Uoe/canonical strips [1m] / dated suffixes via getCanonicalName
    expect(
      applyEntitlementBlindFallbackTarget('claude-opus-5[1m]', deps()),
    ).toBe('claude-opus-4-8')
  })

  test('passthrough when not blind', () => {
    expect(
      applyEntitlementBlindFallbackTarget(
        'claude-opus-5',
        deps({ hasProfileScope: () => true }),
      ),
    ).toBe('claude-opus-5')
  })

  test('passthrough non-opus-5 when blind', () => {
    expect(applyEntitlementBlindFallbackTarget('claude-opus-4-8', deps())).toBe(
      'claude-opus-4-8',
    )
  })
})
