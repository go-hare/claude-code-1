import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  enterpriseSeatOrBillingValue,
  enterpriseSeatTier,
  enterpriseTierPrefersOpus5,
  getAvailableModelsEnforcementState,
  type EnterpriseOpusDefaultInput,
} from '../enterpriseDefaultModel.js'

const base: EnterpriseOpusDefaultInput = {
  subscriptionType: 'enterprise',
  seatOrBilling: null,
  catalogHasSonnet: true,
  catalogHasOpus: true,
  enforceAvailableModels: false,
}

describe('enterprise default is opus5 (2.1.251 #60)', () => {
  test('other enterprise gets opus when the catalog has opus', () => {
    expect(enterpriseTierPrefersOpus5(base)).toBe(true)
  })

  test('usage-based enterprise gets opus even on a sonnet-only catalog', () => {
    expect(
      enterpriseTierPrefersOpus5({
        ...base,
        seatOrBilling: 'enterprise_usage_based',
        catalogHasOpus: false,
        enforceAvailableModels: false,
      }),
    ).toBe(true)
  })

  test('other enterprise stays on sonnet when rw() is true', () => {
    expect(
      enterpriseTierPrefersOpus5({
        ...base,
        seatOrBilling: 'stripe_subscription',
        catalogHasSonnet: true,
        catalogHasOpus: false,
        enforceAvailableModels: false,
      }),
    ).toBe(false)
  })

  test('enforcement on disables the sonnet-only fallback', () => {
    expect(
      enterpriseTierPrefersOpus5({
        ...base,
        catalogHasSonnet: true,
        catalogHasOpus: false,
        enforceAvailableModels: true,
      }),
    ).toBe(true)
  })

  test('a catalog without sonnet is not the sonnet-only fallback', () => {
    expect(
      enterpriseTierPrefersOpus5({
        ...base,
        catalogHasSonnet: false,
        catalogHasOpus: false,
        enforceAvailableModels: false,
      }),
    ).toBe(true)
  })

  test('max, team, and pro are not this enterprise arm', () => {
    for (const subscriptionType of ['max', 'team', 'pro', null]) {
      expect(
        enterpriseTierPrefersOpus5({
          ...base,
          subscriptionType,
          seatOrBilling: 'enterprise_usage_based',
        }),
      ).toBe(false)
    }
  })

  test('plain usage_based billing is not the enterprise usage split', () => {
    expect(
      enterpriseTierPrefersOpus5({
        ...base,
        seatOrBilling: 'usage_based',
        catalogHasOpus: false,
        enforceAvailableModels: false,
      }),
    ).toBe(false)
  })

  test('pbr is seatTier only', () => {
    expect(enterpriseSeatTier({ seatTier: 'enterprise_usage_based' })).toBe(
      'enterprise_usage_based',
    )
    expect(enterpriseSeatTier({ seatTier: null })).toBe(null)
    expect(enterpriseSeatTier(null)).toBe(null)
  })

  test('seatTier wins over billingType', () => {
    expect(
      enterpriseSeatOrBillingValue({
        seatTier: 'standard',
        billingType: 'enterprise_usage_based',
      }),
    ).toBe('standard')
    expect(
      enterpriseSeatOrBillingValue({
        billingType: 'enterprise_usage_based',
      }),
    ).toBe('enterprise_usage_based')
    expect(enterpriseSeatOrBillingValue(null)).toBe(null)
  })

  test('wo().state is refused, inactive, or active', () => {
    const state = getAvailableModelsEnforcementState()
    expect(['refused', 'inactive', 'active']).toContain(state.state)
  })

  test('the resolver calls the enterprise arm and does not say seat-based', () => {
    const modelSrc = readFileSync(join(import.meta.dir, '../model.ts'), 'utf8')
    const helperSrc = readFileSync(
      join(import.meta.dir, '../enterpriseDefaultModel.ts'),
      'utf8',
    )
    expect(modelSrc).toContain('isEnterpriseOpusDefault()')
    expect(modelSrc).toContain(
      "provider === 'bedrock' || provider === 'vertex'",
    )
    expect(modelSrc).toContain('isSonnetOnlyUnenforcedCatalog')
    expect(modelSrc).not.toContain('seat-based')
    expect(helperSrc).not.toContain('seat-based')
    expect(helperSrc).toContain("state: 'refused'")
    expect(helperSrc).toContain("state: 'inactive'")
    expect(helperSrc).toContain("state: 'active'")
    const setting = modelSrc.slice(
      modelSrc.indexOf('function getDefaultMainLoopModelSetting'),
      modelSrc.indexOf('function getDefaultMainLoopModel():'),
    )
    expect(setting).not.toContain("provider === 'foundry'")
    const enterprise = setting.indexOf('isEnterpriseOpusDefault()')
    const sonnet = setting.indexOf('return getDefaultSonnetModel()')
    expect(enterprise).toBeGreaterThan(-1)
    expect(sonnet).toBeGreaterThan(enterprise)
  })
})
