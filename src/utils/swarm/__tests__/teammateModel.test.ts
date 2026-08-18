import { describe, expect, test } from 'bun:test'
import { parseUserSpecifiedModel } from '../../model/model.js'
import { resolveTeammateModelWith } from '../teammateModel.js'

describe('resolveTeammateModelWith', () => {
  test('unset teammateDefaultModel follows explicit leader model', () => {
    expect(
      resolveTeammateModelWith(undefined, 'grok-4.5', {
        configured: undefined,
        mainLoopModel: 'resolved-main-loop',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('grok-4.5')
  })

  test('explicit Default (null) follows leader model', () => {
    expect(
      resolveTeammateModelWith(undefined, 'grok-4.5', {
        configured: null,
        mainLoopModel: 'resolved-main-loop',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('grok-4.5')
  })

  test('unset + null leader falls through to mainLoopModel (ANTHROPIC_MODEL path)', () => {
    expect(
      resolveTeammateModelWith(undefined, null, {
        configured: undefined,
        mainLoopModel: 'grok-4.5',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('grok-4.5')
  })

  test('unset + null leader uses hardcoded fallback when mainLoop unavailable', () => {
    expect(
      resolveTeammateModelWith(undefined, null, {
        configured: undefined,
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
        configured: 'sonnet',
        mainLoopModel: 'resolved-main-loop',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('grok-4.5')
  })

  test('inherit with null leader uses main-loop resolution', () => {
    expect(
      resolveTeammateModelWith('inherit', null, {
        configured: null,
        mainLoopModel: 'grok-4.5',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('grok-4.5')
  })

  test('configured teammateDefaultModel wins over leader', () => {
    expect(
      resolveTeammateModelWith(undefined, 'grok-4.5', {
        configured: 'sonnet',
        mainLoopModel: 'resolved-main-loop',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe(parseUserSpecifiedModel('sonnet'))
  })

  test('explicit tool model wins over config/leader', () => {
    expect(
      resolveTeammateModelWith('haiku', 'grok-4.5', {
        configured: 'sonnet',
        mainLoopModel: 'resolved-main-loop',
        hardcodedFallback: 'hardcoded-opus-fallback',
      }),
    ).toBe('haiku')
  })
})
