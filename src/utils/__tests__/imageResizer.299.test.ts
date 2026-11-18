import { describe, expect, test } from 'bun:test'
import {
  computeTargetDimensions,
  estimateImageTokens,
  fitImageToMaxTokens,
} from '../imageResizer.js'

describe('2.1.299 #633 imageResizer tmn / j6n token-budget dimension scaling', () => {
  test('estimateImageTokens counts 28x28 patches', () => {
    expect(estimateImageTokens(0, 100)).toBe(0)
    expect(estimateImageTokens(28, 28)).toBe(1)
    expect(estimateImageTokens(29, 28)).toBe(2)
    expect(estimateImageTokens(1568, 1568)).toBe(56 * 56) // 3136
  })

  test('fitImageToMaxTokens keeps near-square large images within maxImageTokens', () => {
    // 2576x2576 with maxImageTokens=4784 (ceil(w/28)*ceil(h/28) <= 4784)
    const [w, h] = fitImageToMaxTokens(2576, 2576, Infinity, 4784)
    expect(estimateImageTokens(w, h)).toBeLessThanOrEqual(4784)
    expect(w).toBe(h)
    expect(w).toBe(1932) // 69 * 28 = 1932, 69*69 = 4761 <= 4784 (70*70 = 4900 > 4784)
  })

  test('computeTargetDimensions applies maxWidth/maxHeight then maxImageTokens', () => {
    const [w, h] = computeTargetDimensions(3000, 2900, {
      maxWidth: 2576,
      maxHeight: 2576,
      maxImageTokens: 4784,
    })
    expect(w).toBeLessThanOrEqual(2576)
    expect(h).toBeLessThanOrEqual(2576)
    expect(estimateImageTokens(w, h)).toBeLessThanOrEqual(4784)
  })
})
