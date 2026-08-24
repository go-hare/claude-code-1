import { describe, expect, test } from 'bun:test'
import { resolveTeammateModelWith } from '../teammateModel.js'

describe('resolveTeammateModelWith (densable 2.1.234 #47)', () => {
  test('omitted model follows explicit leader model', () => {
    expect(
      resolveTeammateModelWith(undefined, 'grok-4.5', {
        mainLoopModel: 'resolved-main-loop',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('grok-4.5')
  })

  test('null leader falls through to mainLoopModel (ANTHROPIC_MODEL path)', () => {
    expect(
      resolveTeammateModelWith(undefined, null, {
        mainLoopModel: 'grok-4.5',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('grok-4.5')
  })

  test('null leader uses hardcoded fallback when mainLoop unavailable', () => {
    expect(
      resolveTeammateModelWith(undefined, null, {
        // Cast through unknown: production always has a string, but the
        // nullish chain must still reach the last-resort Opus fallback.
        mainLoopModel: undefined as unknown as string,
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('hardcoded-opus-fallback')
  })

  test('inherit uses leader when present', () => {
    expect(
      resolveTeammateModelWith('inherit', 'grok-4.5', {
        mainLoopModel: 'resolved-main-loop',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('grok-4.5')
  })

  test('inherit with null leader uses main-loop resolution', () => {
    expect(
      resolveTeammateModelWith('inherit', null, {
        mainLoopModel: 'grok-4.5',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('grok-4.5')
  })

  test('explicit tool model wins over leader', () => {
    expect(
      resolveTeammateModelWith('haiku', 'grok-4.5', {
        mainLoopModel: 'resolved-main-loop',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('haiku')
  })
})
