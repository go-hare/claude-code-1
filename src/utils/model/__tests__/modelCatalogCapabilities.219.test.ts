/**
 * densable 2.1.219 — full EHl catalog SQ/Lqm/Aw/ON/Tig/AHl.
 * Extract: official-219 claude.exe baked EHl (scripts/extract-ehl-219.py).
 */
import { describe, expect, test } from 'bun:test'
import {
  DENSABLE_CATALOG_CAPABILITIES,
  DENSABLE_CATALOG_MODELS,
  DENSABLE_PRICING_TIERS_FROM_CATALOG,
  expandTigModelCosts,
  getDensableCatalogModel,
  getDensableModelCatalog,
  modelHasCatalogCapability,
  resolveCatalogAlias,
  resolveCatalogIdFromProviderId,
  resolveCatalogModelPricing,
} from '../modelCatalogCapabilities.js'
import {
  COST_HAIKU_35,
  COST_HAIKU_45,
  COST_TIER_10_50,
  COST_TIER_15_75,
  COST_TIER_3_15,
  COST_TIER_5_25,
  DENSABLE_PRICING_TIERS,
  TIG_MODEL_COSTS,
} from '../../modelCost.js'
import { DENSABLE_EHL_CATALOG } from '../densableEhlCatalog.219.js'

describe('densable 2.1.219 full EHl catalog', () => {
  test('SQ: schema_version 1, 17 models, 6 pricing tiers', () => {
    const sq = getDensableModelCatalog()
    expect(sq.schema_version).toBe(1)
    expect(sq.models).toHaveLength(17)
    expect(Object.keys(sq.pricing_tiers).sort()).toEqual(
      [
        'haiku_35',
        'haiku_45',
        'tier_10_50',
        'tier_15_75',
        'tier_3_15',
        'tier_5_25',
      ].sort(),
    )
    expect(sq.best).toBe('fable')
    expect(sq.latest_per_family).toEqual({
      fable: 'claude-fable-5',
      opus: 'claude-opus-5',
      sonnet: 'claude-sonnet-5',
      haiku: 'claude-haiku-4-5',
    })
    expect(Object.keys(sq.aliases).sort()).toEqual([
      'fable',
      'haiku',
      'opus',
      'sonnet',
    ])
  })

  test('bake matches densableEhlCatalog export', () => {
    expect(getDensableModelCatalog().models.map(m => m.id)).toEqual(
      DENSABLE_EHL_CATALOG.models.map(m => m.id),
    )
  })

  test('full model fields present on opus-5 (not just caps/pricing)', () => {
    const m = getDensableCatalogModel('claude-opus-5')
    expect(m).toBeDefined()
    expect(m!.family).toBe('opus')
    expect(m!.display_name).toBeTruthy()
    expect(m!.provider_ids.first_party).toContain('claude-opus-5')
    expect(m!.context?.window).toBeGreaterThan(0)
    expect(m!.max_output_tokens?.default).toBeGreaterThan(0)
    expect(m!.capabilities).toContain('fast_mode')
    expect(m!.pricing).toBe('tier_5_25')
    expect(m!.default_effort).toBeDefined()
  })

  test('fast_mode only on opus-4-7 / 4-8 / 5', () => {
    const withFast = getDensableModelCatalog()
      .models.filter(m => m.capabilities.includes('fast_mode'))
      .map(m => m.id)
      .sort()
    expect(withFast).toEqual([
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-5',
    ])
  })

  test('ON(fast_mode) true for positive set', () => {
    for (const id of [
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-5',
      'claude-opus-4-7-20250514',
      'us.anthropic.claude-opus-5',
      'claude-opus-5[1m]',
    ]) {
      expect(modelHasCatalogCapability(id, 'fast_mode')).toBe(true)
    }
  })

  test('ON(fast_mode) undefined for fable/mythos/sonnet/opus-4-6', () => {
    for (const id of [
      'claude-fable-5',
      'claude-mythos-5',
      'claude-sonnet-5',
      'claude-opus-4-6',
      'unknown-model',
    ]) {
      expect(modelHasCatalogCapability(id, 'fast_mode')).toBeUndefined()
    }
  })

  test('ON never returns false', () => {
    expect(modelHasCatalogCapability('claude-opus-5', 'nope')).toBeUndefined()
    expect(modelHasCatalogCapability('claude-opus-5', 'fast_mode')).toBe(true)
  })

  test('Oqm / RFr: provider id resolves to catalog id', () => {
    const m = getDensableCatalogModel('claude-haiku-4-5')!
    const fp = m.provider_ids.first_party
    expect(resolveCatalogIdFromProviderId(fp)).toBe('claude-haiku-4-5')
    expect(modelHasCatalogCapability(fp, 'context_management')).toBe(true)
  })

  test('AHl aliases', () => {
    expect(resolveCatalogAlias('opus')).toBe('claude-opus-5')
    expect(resolveCatalogAlias('sonnet')).toBe('claude-sonnet-5')
    expect(resolveCatalogAlias('haiku')).toBe('claude-haiku-4-5')
    expect(resolveCatalogAlias('fable')).toBe('claude-fable-5')
    expect(resolveCatalogAlias('opus', 'foundry')).toBe('claude-opus-4-6')
    expect(resolveCatalogAlias('sonnet', 'bedrock')).toBe('claude-sonnet-4-5')
    expect(resolveCatalogAlias('nope')).toBeUndefined()
  })

  test('Tig expands all 17 models', () => {
    const tig = expandTigModelCosts()
    expect(Object.keys(tig)).toHaveLength(17)
    expect(tig['claude-opus-5']).toEqual(COST_TIER_5_25)
    expect(tig['claude-opus-4-0']).toEqual(COST_TIER_15_75)
    expect(tig['claude-fable-5']).toEqual(COST_TIER_10_50)
    expect(tig['claude-mythos-5']).toEqual(COST_TIER_10_50)
    expect(tig['claude-3-5-haiku']).toEqual(COST_HAIKU_35)
    expect(tig['claude-haiku-4-5']).toEqual(COST_HAIKU_45)
    expect(tig['claude-sonnet-5']).toEqual(COST_TIER_3_15)
    expect(TIG_MODEL_COSTS['claude-opus-4-8']).toEqual(COST_TIER_5_25)
  })

  test('pricing_tiers NIc map matches DENSABLE_PRICING_TIERS export', () => {
    expect(DENSABLE_PRICING_TIERS.tier_5_25).toEqual(
      DENSABLE_PRICING_TIERS_FROM_CATALOG.tier_5_25,
    )
    expect(DENSABLE_PRICING_TIERS.tier_10_50).toEqual(COST_TIER_10_50)
  })

  test('$Ti resolves model pricing', () => {
    const m = getDensableCatalogModel('claude-opus-5')!
    const p = resolveCatalogModelPricing(m)
    expect(p?.input).toBe(5)
    expect(p?.output).toBe(25)
  })

  test('back-compat DENSABLE_CATALOG_MODELS / CAPABILITIES', () => {
    expect(Object.keys(DENSABLE_CATALOG_MODELS)).toHaveLength(17)
    expect(Object.keys(DENSABLE_CATALOG_CAPABILITIES)).toHaveLength(17)
    expect(DENSABLE_CATALOG_MODELS['claude-opus-5']!.pricing).toBe('tier_5_25')
  })
})
