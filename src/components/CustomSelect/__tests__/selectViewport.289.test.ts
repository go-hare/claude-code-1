/**
 * densable 2.1.289 `tl`. The hook's reset passes the live window back in
 * as currentViewport; these calls are that second pass.
 */
import { describe, expect, test } from 'bun:test'
import { createDefaultState } from '../use-select-navigation.js'

function optionsOf(count: number): Array<{ label: string; value: string }> {
  return Array.from({ length: count }, (_, index) => {
    const value = `o${index}`
    return { label: value, value }
  })
}

describe('densable 2.1.289 tl select viewport', () => {
  test('shrinking visibleOptionCount shrinks a window that still contains focus', () => {
    const options = optionsOf(8)
    const initial = createDefaultState({
      visibleOptionCount: 5,
      options,
      initialFocusValue: 'o0',
    })
    expect(initial.visibleFromIndex).toBe(0)
    expect(initial.visibleToIndex).toBe(5)

    const shrunk = createDefaultState({
      visibleOptionCount: 3,
      options,
      initialFocusValue: 'o0',
      currentViewport: {
        visibleFromIndex: initial.visibleFromIndex,
        visibleToIndex: initial.visibleToIndex,
      },
    })
    expect(shrunk.visibleFromIndex).toBe(0)
    expect(shrunk.visibleToIndex).toBe(3)
  })

  test('shrinking past the focused index scrolls it to the bottom edge', () => {
    const options = optionsOf(8)
    const initial = createDefaultState({
      visibleOptionCount: 5,
      options,
      initialFocusValue: 'o4',
    })
    expect(initial.visibleFromIndex).toBe(0)
    expect(initial.visibleToIndex).toBe(5)

    const shrunk = createDefaultState({
      visibleOptionCount: 3,
      options,
      initialFocusValue: 'o4',
      currentViewport: {
        visibleFromIndex: initial.visibleFromIndex,
        visibleToIndex: initial.visibleToIndex,
      },
    })
    expect(shrunk.focusedValue).toBe('o4')
    expect(shrunk.visibleFromIndex).toBe(2)
    expect(shrunk.visibleToIndex).toBe(5)
  })

  test('growing a short tail pulls visibleFromIndex back', () => {
    const options = optionsOf(8)
    const initial = createDefaultState({
      visibleOptionCount: 3,
      options,
      initialFocusValue: 'o7',
    })
    expect(initial.visibleFromIndex).toBe(5)
    expect(initial.visibleToIndex).toBe(8)

    const grown = createDefaultState({
      visibleOptionCount: 5,
      options,
      initialFocusValue: 'o7',
      currentViewport: {
        visibleFromIndex: initial.visibleFromIndex,
        visibleToIndex: initial.visibleToIndex,
      },
    })
    expect(grown.focusedValue).toBe('o7')
    expect(grown.visibleFromIndex).toBe(3)
    expect(grown.visibleToIndex).toBe(8)
  })

  test('focus above the window pulls a short tail back to a full window', () => {
    const options = optionsOf(10)
    const initial = createDefaultState({
      visibleOptionCount: 2,
      options,
      initialFocusValue: 'o9',
    })
    expect(initial.visibleFromIndex).toBe(8)
    expect(initial.visibleToIndex).toBe(10)

    const rotated = [
      ...options.slice(0, 7),
      options[9]!,
      options[7]!,
      options[8]!,
    ]
    const next = createDefaultState({
      visibleOptionCount: 4,
      options: rotated,
      initialFocusValue: 'o9',
      currentViewport: {
        visibleFromIndex: initial.visibleFromIndex,
        visibleToIndex: initial.visibleToIndex,
      },
    })
    expect(next.focusedValue).toBe('o9')
    expect(next.visibleFromIndex).toBe(6)
    expect(next.visibleToIndex).toBe(10)
  })
})
