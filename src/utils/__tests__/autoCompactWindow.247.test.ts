/**
 * densable 2.1.247 #27 — Sonnet 5 model-default window 1e6 → ~967K threshold.
 * Gold: y3n default 1e6 (246 LYn 967000), E3n=20000, xWe e-13000.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  AUTOCOMPACT_BUFFER_TOKENS,
  getAutocompactBufferTokens,
} from '../../services/compact/autoCompact.js'
import {
  MODEL_AUTO_COMPACT_WINDOW_DEFAULTS,
  resolveAutoCompactWindow,
  resolveModelAutoCompactWindowEntry,
} from '../autoCompactWindow.js'

describe('densable 2.1.247 #27 y3n / xWe / CL', () => {
  const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  const prevEnvWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW

  afterEach(() => {
    if (prevEntrypoint === undefined) {
      delete process.env.CLAUDE_CODE_ENTRYPOINT
    } else {
      process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
    }
    if (prevEnvWindow === undefined) {
      delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    } else {
      process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = prevEnvWindow
    }
  })

  test('y3n sonnet-5 default is 1e6, not 967000', () => {
    expect(MODEL_AUTO_COMPACT_WINDOW_DEFAULTS['claude-sonnet-5']?.default).toBe(
      1_000_000,
    )
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    expect(
      resolveModelAutoCompactWindowEntry(
        MODEL_AUTO_COMPACT_WINDOW_DEFAULTS['claude-sonnet-5']!,
      ),
    ).toBe(1_000_000)
  })

  test('y3n remote_cowork / local-agent surfaces stay 500000', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'remote_cowork'
    expect(
      resolveModelAutoCompactWindowEntry(
        MODEL_AUTO_COMPACT_WINDOW_DEFAULTS['claude-sonnet-5']!,
      ),
    ).toBe(500_000)
    process.env.CLAUDE_CODE_ENTRYPOINT = 'local-agent'
    expect(
      resolveModelAutoCompactWindowEntry(
        MODEL_AUTO_COMPACT_WINDOW_DEFAULTS['claude-sonnet-5']!,
      ),
    ).toBe(500_000)
  })

  test('xWe buffer is always 13000 (not 50k/30k)', () => {
    expect(AUTOCOMPACT_BUFFER_TOKENS).toBe(13_000)
    expect(getAutocompactBufferTokens('claude-sonnet-5[1m]')).toBe(13_000)
    expect(getAutocompactBufferTokens('claude-haiku-4-5')).toBe(13_000)
  })

  test('full 1M window - 20k - 13k is 967000 (not 934000)', () => {
    expect(1_000_000 - 20_000 - 13_000).toBe(967_000)
    expect(967_000 - 20_000 - 13_000).toBe(934_000)
  })

  test('resolveAutoCompactWindow sonnet-5 is model-default 1e6 when no env/settings', () => {
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    const resolved = resolveAutoCompactWindow('claude-sonnet-5[1m]', undefined)
    expect(resolved.source).toBe('model-default')
    expect(resolved.configured).toBe(1_000_000)
  })
})
