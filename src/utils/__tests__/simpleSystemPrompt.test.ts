import { describe, expect, test } from 'bun:test'
import {
  buildLeanSimpleSystemPrompt,
  getLeanActionCautionSection,
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
      shouldUseSimpleSystemPrompt({
        env: {},
        model: 'claude-opus-4-7',
        velvetCascadeModels: null,
        velvetTide: false,
      }),
    ).toBe(false)
    expect(
      shouldUseSimpleSystemPrompt({
        env: {},
        model: 'claude-sonnet-4-6',
        velvetCascadeModels: null,
        velvetTide: false,
      }),
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
  test('velvet cascade models list (reh)', () => {
    expect(
      shouldUseSimpleSystemPrompt({
        env: {},
        model: 'claude-opus-4-7',
        velvetCascadeModels: ['opus-4-7'],
        velvetTide: false,
      }),
    ).toBe(true)
    expect(
      isVelvetCascadeModelEligible('claude-sonnet-4-6', ['opus-4-7']),
    ).toBe(false)
  })
  test('densable velvet_tide forces simple on dense-default models', () => {
    expect(
      shouldUseSimpleSystemPrompt({
        env: {},
        model: 'claude-opus-4-7',
        velvetCascadeModels: null,
        velvetTide: true,
      }),
    ).toBe(true)
    expect(
      shouldUseSimpleSystemPrompt({
        env: {},
        model: 'claude-opus-4-7',
        velvetCascadeModels: null,
        velvetTide: false,
      }),
    ).toBe(false)
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
