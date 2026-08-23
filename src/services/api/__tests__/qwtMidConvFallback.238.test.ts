/**
 * densable 2.1.238 qWT midConvFallback gate: e8 || fZ (mid-conv OR effort beta).
 * Does not invent c8m perTurnEffort.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const CLAUDE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../claude.ts'),
  'utf8',
)

describe('qWT midConvFallback gate (238)', () => {
  test('effort beta OR is in the midConvFallback predicate', () => {
    expect(CLAUDE_SRC).toContain('MID_CONVERSATION_SYSTEM_BETA_HEADER')
    expect(CLAUDE_SRC).toContain('EFFORT_BETA_HEADER')
    expect(CLAUDE_SRC).toMatch(
      /!midConvLatchedOff &&\s*\(\s*betas\.includes\(MID_CONVERSATION_SYSTEM_BETA_HEADER\) \|\|\s*betas\.includes\(EFFORT_BETA_HEADER\)\s*\)/,
    )
    const gate = CLAUDE_SRC.slice(
      CLAUDE_SRC.indexOf('let midConvFallback'),
      CLAUDE_SRC.indexOf("if (getAPIProvider() === 'openai')"),
    )
    expect(gate).toContain('EFFORT_BETA_HEADER')
    expect(gate).not.toMatch(/c8m\(/)
  })
})
