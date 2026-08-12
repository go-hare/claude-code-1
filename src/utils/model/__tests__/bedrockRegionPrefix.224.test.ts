/**
 * densable 2.1.224 #4 — ANTHROPIC_BEDROCK_REGION_PREFIX
 * SEA: Qcr / Upt / warn gold strings
 */
import { describe, expect, test } from 'bun:test'
import {
  applyBedrockRegionPrefix,
  deriveBedrockRegionPrefixFromAwsRegion,
  formatBedrockRegionPrefixMismatchWarn,
  formatBedrockRegionPrefixNoDiscoveryWarn,
  resolveBedrockRegionPrefix,
} from '../bedrock.js'

describe('densable 2.1.224 #4 deriveBedrockRegionPrefixFromAwsRegion (Upt)', () => {
  test('us-gov-* → us-gov', () => {
    expect(deriveBedrockRegionPrefixFromAwsRegion('us-gov-west-1')).toBe(
      'us-gov',
    )
  })
  test('us-* → us', () => {
    expect(deriveBedrockRegionPrefixFromAwsRegion('us-east-1')).toBe('us')
  })
  test('eu-* → eu', () => {
    expect(deriveBedrockRegionPrefixFromAwsRegion('eu-central-1')).toBe('eu')
  })
  test('ap-* → apac', () => {
    expect(deriveBedrockRegionPrefixFromAwsRegion('ap-northeast-1')).toBe(
      'apac',
    )
  })
  test('other → global', () => {
    expect(deriveBedrockRegionPrefixFromAwsRegion('sa-east-1')).toBe('global')
    expect(deriveBedrockRegionPrefixFromAwsRegion('')).toBe('global')
    expect(deriveBedrockRegionPrefixFromAwsRegion(undefined)).toBe('global')
  })
})

describe('densable 2.1.224 #4 resolveBedrockRegionPrefix (Qcr)', () => {
  test('env overrides AWS_REGION-derived prefix', () => {
    expect(
      resolveBedrockRegionPrefix('us-east-1', {
        ANTHROPIC_BEDROCK_REGION_PREFIX: 'eu',
      }),
    ).toBe('eu')
    expect(
      resolveBedrockRegionPrefix('eu-west-1', {
        ANTHROPIC_BEDROCK_REGION_PREFIX: 'global',
      }),
    ).toBe('global')
  })

  test('us-gov AWS region always us-gov (env cannot override residency)', () => {
    expect(
      resolveBedrockRegionPrefix('us-gov-east-1', {
        ANTHROPIC_BEDROCK_REGION_PREFIX: 'eu',
      }),
    ).toBe('us-gov')
  })

  test('unset env → Upt(AWS_REGION)', () => {
    expect(resolveBedrockRegionPrefix('ap-southeast-1', {})).toBe('apac')
    expect(resolveBedrockRegionPrefix('us-west-2', {})).toBe('us')
  })

  test('unknown env value falls through to Upt', () => {
    expect(
      resolveBedrockRegionPrefix('us-east-1', {
        ANTHROPIC_BEDROCK_REGION_PREFIX: 'not-a-prefix',
      }),
    ).toBe('us')
  })
})

describe('densable 2.1.224 #4 apply + warn gold', () => {
  test('applyBedrockRegionPrefix rewrites us→eu', () => {
    expect(
      applyBedrockRegionPrefix(
        'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        'eu',
      ),
    ).toBe('eu.anthropic.claude-sonnet-4-5-20250929-v1:0')
  })

  test('no-discovery warn gold', () => {
    const msg = formatBedrockRegionPrefixNoDiscoveryWarn('eu', 'us')
    expect(msg).toContain('ANTHROPIC_BEDROCK_REGION_PREFIX=eu')
    expect(msg).toContain('without an availability check')
    expect(msg).toContain('eu.*')
    expect(msg).toContain('us.*.')
  })

  test('mismatch warn gold', () => {
    const msg = formatBedrockRegionPrefixMismatchWarn('eu', [
      'claude-sonnet-4-5',
    ])
    expect(msg).toContain('ANTHROPIC_BEDROCK_REGION_PREFIX=eu')
    expect(msg).toContain('1 model(s) resolved to a different prefix')
    expect(msg).toContain('claude-sonnet-4-5')
    expect(msg).toContain('not a residency guarantee')
  })
})
