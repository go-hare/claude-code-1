import { describe, expect, test } from 'bun:test'
import {
  firstPartyNameToCanonical,
  getPublicModelDisplayName,
  modelSupports1mSuffixEffect,
  normalizeDotVersionedModelName,
  renderModelName,
} from '../model.js'

describe('v2.1.311 #1291 & v2.1.314 #1394 model [1m] and dot normalization', () => {
  test('#1394 normalizes dot-spelled model IDs like claude-opus-4.8', () => {
    expect(normalizeDotVersionedModelName('claude-opus-4.8')).toBe(
      'claude-opus-4-8',
    )
    expect(firstPartyNameToCanonical('claude-opus-4.8')).toBe('claude-opus-4-8')
    expect(firstPartyNameToCanonical('claude-sonnet-4.6')).toBe(
      'claude-sonnet-4-6',
    )
    expect(firstPartyNameToCanonical('claude-opus-4.8-20260101')).toBe(
      'claude-opus-4-8',
    )
  })

  test('#1291 drops [1m] label on native-1M and 200k-only models while keeping it on opt-in 1M models', () => {
    expect(modelSupports1mSuffixEffect('claude-opus-4-7')).toBe(false)
    expect(modelSupports1mSuffixEffect('claude-opus-4-8')).toBe(false)
    expect(modelSupports1mSuffixEffect('claude-opus-5')).toBe(false)
    expect(modelSupports1mSuffixEffect('claude-haiku-4-5')).toBe(false)
    expect(modelSupports1mSuffixEffect('claude-haiku-5-5')).toBe(false)
    expect(modelSupports1mSuffixEffect('claude-sonnet-4-6')).toBe(true)
    expect(modelSupports1mSuffixEffect('claude-opus-4-6')).toBe(true)

    expect(getPublicModelDisplayName('claude-opus-4-7[1m]')).toBe('Opus 4.7')
    expect(getPublicModelDisplayName('claude-opus-4-8[1m]')).toBe('Opus 4.8')
    expect(getPublicModelDisplayName('claude-opus-5[1m]')).toBe('Opus 5')
    expect(getPublicModelDisplayName('claude-haiku-5-5[1m]')).toBe('Haiku 5.5')
    expect(getPublicModelDisplayName('claude-sonnet-4-6[1m]')).toBe(
      'Sonnet 4.6 (1M context)',
    )
    expect(getPublicModelDisplayName('claude-opus-4-6[1m]')).toBe(
      'Opus 4.6 (1M context)',
    )
    expect(renderModelName('claude-opus-4-7[1m]')).toBe('Opus 4.7')
  })
})
