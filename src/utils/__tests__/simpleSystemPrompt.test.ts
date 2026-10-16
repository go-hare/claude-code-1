import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  buildLeanSimpleSystemPrompt,
  getDelegationCostsFirstText,
  getLeanActionCautionSection,
  isDelegationCostsFirst,
  isDenseDefaultSystemPromptModel,
  isVelvetCascadeModelEligible,
  shouldUseSimpleSystemPrompt,
} from '../simpleSystemPrompt.js'

describe('shouldUseSimpleSystemPrompt', () => {
  test('env on', () => {
    expect(
      shouldUseSimpleSystemPrompt({
        env: { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1' },
        model: 'claude-opus-4-7',
      }),
    ).toBe(true)
  })
  test('env off', () => {
    expect(
      shouldUseSimpleSystemPrompt({
        env: { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '0' },
        model: 'claude-mythos-5',
      }),
    ).toBe(false)
  })
  test('official neh: opus 4.x denser default → simple off', () => {
    expect(
      shouldUseSimpleSystemPrompt({ env: {}, model: 'claude-opus-4-7' }),
    ).toBe(false)
    expect(
      shouldUseSimpleSystemPrompt({ env: {}, model: 'claude-sonnet-4-6' }),
    ).toBe(false)
  })
  test('mythos / lean capability → simple on', () => {
    expect(
      shouldUseSimpleSystemPrompt({ env: {}, model: 'claude-mythos-5' }),
    ).toBe(true)
    expect(
      shouldUseSimpleSystemPrompt({
        env: {},
        model: 'claude-opus-4-7',
        leanPromptCapability: true,
      }),
    ).toBe(true)
  })
  test('reh modelEligible forces on', () => {
    expect(
      shouldUseSimpleSystemPrompt({
        env: {},
        model: 'claude-opus-4-7',
        modelEligible: true,
      }),
    ).toBe(true)
  })
  test('tengu_velvet_tide is consulted after denser-default', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../simpleSystemPrompt.ts'),
      'utf-8',
    )
    expect(src).toContain(
      "getFeatureValue_CACHED_MAY_BE_STALE('tengu_velvet_tide', false)",
    )
  })

  test('velvet cascade models list (reh)', () => {
    expect(
      shouldUseSimpleSystemPrompt({
        env: {},
        model: 'claude-opus-4-7',
        velvetCascadeModels: ['opus-4-7'],
      }),
    ).toBe(true)
    expect(
      isVelvetCascadeModelEligible('claude-sonnet-4-6', ['opus-4-7']),
    ).toBe(false)
  })
})

describe('isDelegationCostsFirst', () => {
  test('undefined model is false', () => {
    expect(isDelegationCostsFirst(undefined)).toBe(false)
  })
  test('CLAUDE_CODE_MODEL_CAPABILITIES env on/off (gold cQr/fy)', () => {
    expect(
      isDelegationCostsFirst('claude-opus-4-7', {
        CLAUDE_CODE_MODEL_CAPABILITIES: 'lucky_cerf',
      }),
    ).toBe(true)
    expect(
      isDelegationCostsFirst('claude-opus-4-7', {
        CLAUDE_CODE_MODEL_CAPABILITIES: '-lucky_cerf',
      }),
    ).toBe(false)
    expect(
      isDelegationCostsFirst('claude-opus-4-7', {
        CLAUDE_CODE_MODEL_CAPABILITIES: 'claude-opus-4-7=lucky_cerf',
      }),
    ).toBe(true)
    expect(
      isDelegationCostsFirst('claude-sonnet-4-6', {
        CLAUDE_CODE_MODEL_CAPABILITIES: 'claude-opus-4-7=lucky_cerf',
      }),
    ).toBe(false)
  })
  test('source lock Co analog: env + catalog + II GB list', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../simpleSystemPrompt.ts'),
      'utf-8',
    )
    expect(src).toContain('CLAUDE_CODE_MODEL_CAPABILITIES')
    expect(src).toContain('modelHasCatalogCapability')
    expect(src).toContain("'lucky_cerf'")
    expect(src).toContain("'tengu_lucky_cerf'")
    expect(src).toContain('stripTrailingOneM')
    expect(src).toContain('getDelegationCostsFirstText')
    expect(src).toContain("'tengu_lucky_cerf_text'")
  })
})

describe('getDelegationCostsFirstText', () => {
  test('default is kyt unique English', () => {
    expect(getDelegationCostsFirstText()).toContain(
      'A fresh agent costs more than it looks.',
    )
  })
})

describe('isDenseDefaultSystemPromptModel', () => {
  test('opus/sonnet denser-default', () => {
    expect(isDenseDefaultSystemPromptModel('claude-opus-4-6')).toBe(true)
    expect(isDenseDefaultSystemPromptModel('claude-sonnet-4-6')).toBe(true)
  })
  test('mythos not denser-default', () => {
    expect(isDenseDefaultSystemPromptModel('claude-mythos-5')).toBe(false)
  })
})

describe('buildLeanSimpleSystemPrompt', () => {
  test('includes harness and cyber risk', () => {
    const body = buildLeanSimpleSystemPrompt({
      cyberRiskInstruction: 'CYBER_RISK_HERE',
      ownershipFrame: false,
      outputStyleActive: false,
    })
    expect(body).toContain('interactive agent')
    expect(body).toContain('# Harness')
    expect(body).toContain('CYBER_RISK_HERE')
    expect(body).toContain('file_path:line_number')
  })
  test('ownership frame intro', () => {
    const body = buildLeanSimpleSystemPrompt({
      cyberRiskInstruction: 'X',
      ownershipFrame: true,
      outputStyleActive: false,
    })
    expect(body).toContain('own the outcome')
  })
})

describe('getLeanActionCautionSection', () => {
  test('includes faithful reporting guidance', () => {
    const body = getLeanActionCautionSection({ ownershipFrame: false })
    expect(body).toContain('confirm first')
    expect(body).toContain("doesn't extend to the next")
    expect(body).toContain('Report outcomes faithfully')
  })
  test('ownership shortens confirm sentence', () => {
    const body = getLeanActionCautionSection({ ownershipFrame: true })
    expect(body).toContain('confirm first')
    expect(body).not.toContain("doesn't extend to the next")
  })
})
