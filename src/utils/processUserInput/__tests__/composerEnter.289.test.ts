import { describe, expect, test } from 'bun:test'
import { isComposerEnter, mintComposerEnter } from '../composerEnter.js'

describe('densable 2.1.289 Vwr composerEnter', () => {
  test('minted token is a frozen empty object recognized by v3e', () => {
    const token = mintComposerEnter()
    expect(Object.isFrozen(token)).toBe(true)
    expect(token).toEqual({})
    expect(isComposerEnter(token)).toBe(true)
  })

  test('plain objects and null are not composerEnter', () => {
    expect(isComposerEnter({})).toBe(false)
    expect(isComposerEnter(null)).toBe(false)
    expect(isComposerEnter(undefined)).toBe(false)
  })
})
