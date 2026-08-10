/**
 * densable 2.1.221 Ion/Y4 — ENABLE_TOOL_SEARCH official name + local
 * ENABLE_SEARCH_EXTRA_TOOLS alias (prefer local when defined).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  getSearchExtraToolsMode,
  resolveToolSearchEnvValue,
} from '../searchExtraTools.js'

const KEYS = [
  'ENABLE_SEARCH_EXTRA_TOOLS',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
] as const

const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}

function clearKeys(): void {
  for (const k of KEYS) {
    if (!(k in saved)) saved[k] = process.env[k]
    delete process.env[k]
  }
}

afterEach(() => {
  for (const k of KEYS) {
    const v = saved[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete saved[k]
  }
})

describe('resolveToolSearchEnvValue densable ENABLE_TOOL_SEARCH alias', () => {
  test('prefers ENABLE_SEARCH_EXTRA_TOOLS when defined', () => {
    clearKeys()
    process.env.ENABLE_SEARCH_EXTRA_TOOLS = 'true'
    process.env.ENABLE_TOOL_SEARCH = 'false'
    expect(resolveToolSearchEnvValue()).toBe('true')
  })

  test('falls back to ENABLE_TOOL_SEARCH when local unset', () => {
    clearKeys()
    process.env.ENABLE_TOOL_SEARCH = 'auto:25'
    expect(resolveToolSearchEnvValue()).toBe('auto:25')
  })

  test('empty local string is defined (does not fall through)', () => {
    clearKeys()
    process.env.ENABLE_SEARCH_EXTRA_TOOLS = ''
    process.env.ENABLE_TOOL_SEARCH = 'true'
    expect(resolveToolSearchEnvValue()).toBe('')
  })
})

describe('getSearchExtraToolsMode via ENABLE_TOOL_SEARCH', () => {
  test('ENABLE_TOOL_SEARCH=false → standard', () => {
    clearKeys()
    process.env.ENABLE_TOOL_SEARCH = 'false'
    expect(getSearchExtraToolsMode()).toBe('standard')
  })

  test('ENABLE_TOOL_SEARCH=true → tst', () => {
    clearKeys()
    process.env.ENABLE_TOOL_SEARCH = 'true'
    expect(getSearchExtraToolsMode()).toBe('tst')
  })

  test('ENABLE_TOOL_SEARCH=auto → tst-auto', () => {
    clearKeys()
    process.env.ENABLE_TOOL_SEARCH = 'auto'
    expect(getSearchExtraToolsMode()).toBe('tst-auto')
  })

  test('local name wins over official when both set', () => {
    clearKeys()
    process.env.ENABLE_SEARCH_EXTRA_TOOLS = 'false'
    process.env.ENABLE_TOOL_SEARCH = 'true'
    expect(getSearchExtraToolsMode()).toBe('standard')
  })
})
