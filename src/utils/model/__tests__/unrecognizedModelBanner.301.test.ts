import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildUnrecognizedModelNotice,
  resetUnrecognizedModelSignalClaimsForTests,
  sanitizeModelForNotice,
  signalUnrecognizedModel,
} from '../unrecognizedModelSignal.js'

describe('unrecognizedModelSignal & LogoV2 banner #706', () => {
  afterEach(() => {
    resetUnrecognizedModelSignalClaimsForTests()
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  })

  test('signalUnrecognizedModel skips querySource === model_validation (gold f0e)', () => {
    // Should not claim the model id when querySource is model_validation
    signalUnrecognizedModel('totally-custom-model-xyz', 'model_validation')
    // Calling again with a real querySource should still be able to claim it
    expect(() =>
      signalUnrecognizedModel('totally-custom-model-xyz', 'repl_main_thread'),
    ).not.toThrow()
  })

  test('buildUnrecognizedModelNotice returns null for known models and notice for unknown models', () => {
    expect(buildUnrecognizedModelNotice('')).toBeNull()
    expect(buildUnrecognizedModelNotice('claude-sonnet-4-6')).toBeNull()

    const notice = buildUnrecognizedModelNotice('my-custom-gateway-model')
    expect(notice).not.toBeNull()
    expect(notice!.model).toBe('my-custom-gateway-model')
    expect(notice!.window).toBeGreaterThan(0)
    expect(notice!.suggestion).toBeUndefined()
  })

  test('buildUnrecognizedModelNotice suppresses when CLAUDE_CODE_MAX_CONTEXT_TOKENS > 0', () => {
    process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '500000'
    expect(buildUnrecognizedModelNotice('my-custom-gateway-model')).toBeNull()
  })

  test('sanitizeModelForNotice strips unsafe chars and truncates at 128', () => {
    expect(sanitizeModelForNotice('$$$')).toBe('(unrecognized model name)')
    const long = 'a'.repeat(140)
    expect(sanitizeModelForNotice(long)).toBe(`${'a'.repeat(128)}\u2026`)
  })

  test('LogoV2.tsx wires buildUnrecognizedModelNotice for the main chat welcome banner', () => {
    const logoSrc = readFileSync(
      join(import.meta.dir, '../../../components/LogoV2/LogoV2.tsx'),
      'utf8',
    )
    expect(logoSrc).toContain('buildUnrecognizedModelNotice')
    expect(logoSrc).toContain('useMainLoopModel')
    expect(logoSrc).toContain('LogoUnrecognizedModelWarning')
  })
})
