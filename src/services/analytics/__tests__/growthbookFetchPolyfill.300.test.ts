import { describe, expect, test } from 'bun:test'
import { helpers } from '@growthbook/growthbook'
import {
  configureGrowthBookFetchPolyfill,
  growthbookFetch,
} from '../growthbook.js'

describe('#796 GrowthBook TLS/proxy fetch polyfill', () => {
  test('configureGrowthBookFetchPolyfill routes helpers.fetchRemoteEvalCall through growthbookFetch', () => {
    configureGrowthBookFetchPolyfill()
    expect(typeof growthbookFetch).toBe('function')
    expect(typeof helpers.fetchRemoteEvalCall).toBe('function')
  })
})
