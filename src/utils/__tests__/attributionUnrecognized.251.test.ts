import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  commitTrailerModelName,
  formatKnownModelTrailerName,
} from '../attribution.js'

describe('unrecognized model trailer (2.1.251 #59)', () => {
  test('known catalog ids use AVt, not the raw parsed id', () => {
    expect(formatKnownModelTrailerName('no-label-id')).toBe(
      'Claude (no-label-id)',
    )
    for (const id of [
      'claude-opus-4-6',
      'us.anthropic.claude-opus-5',
      'opus',
    ]) {
      const trailer = commitTrailerModelName(id)
      expect(trailer).toBe(formatKnownModelTrailerName(id))
      expect(trailer).not.toBe(id)
      expect(trailer.startsWith('Claude')).toBe(true)
      expect(trailer).not.toBe('Claude Code')
    }
  })

  test('anything else is Claude Code', () => {
    expect(commitTrailerModelName('gpt-4o')).toBe('Claude Code')
    expect(commitTrailerModelName('gemini-2.5-pro')).toBe('Claude Code')
    expect(commitTrailerModelName('custom-gateway-model')).toBe('Claude Code')
    expect(commitTrailerModelName('claude-not-a-catalog-id')).toBe(
      'Claude Code',
    )
  })

  test('ZO canonical-known leftovers are Claude, not AVt or Claude Code', () => {
    for (const id of [
      'claude-3-opus',
      'claude-3-sonnet',
      'claude-3-haiku',
      'claude-mythos-preview',
      'claude-3-opus[1m]',
    ]) {
      expect(commitTrailerModelName(id)).toBe('Claude')
      expect(commitTrailerModelName(id)).not.toBe(
        formatKnownModelTrailerName(id),
      )
    }
  })

  test('the commit trailer uses that name', () => {
    const src = readFileSync(join(import.meta.dir, '../attribution.ts'), 'utf8')
    expect(src).toContain(
      'Co-Authored-By: ${commitTrailerModelName(modelName)}',
    )
    expect(src).toContain('formatKnownModelTrailerName')
  })
})
