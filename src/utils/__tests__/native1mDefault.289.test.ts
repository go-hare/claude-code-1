/**
 * densable 2.1.289 — Opus 4.7+ / Fable default 1M without [1m] suffix.
 * Gold cw(): catalog context.native_1m → 1e6 when DISABLE_1M off.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  catalogDeclaresNative1mWindow,
  getContextWindowForModel,
} from '../context.js'

const savedDisable = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
const providerEnv = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_GATEWAY',
] as const
const savedProvider: Record<string, string | undefined> = {}

afterEach(() => {
  if (savedDisable === undefined) delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  else process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable
  for (const key of providerEnv) {
    if (savedProvider[key] === undefined) delete process.env[key]
    else process.env[key] = savedProvider[key]
  }
})

describe('densable 2.1.289 native 1M default (no [1m] suffix)', () => {
  test('catalogDeclaresNative1mWindow for opus-4-7 / fable-5', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(catalogDeclaresNative1mWindow('claude-opus-4-7')).toBe(true)
    expect(catalogDeclaresNative1mWindow('claude-fable-5')).toBe(true)
    expect(catalogDeclaresNative1mWindow('claude-opus-4-5')).toBe(false)
  })

  test('getContextWindowForModel returns 1M without beta or [1m]', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(getContextWindowForModel('claude-opus-4-7')).toBe(1_000_000)
    expect(getContextWindowForModel('claude-opus-4-8')).toBe(1_000_000)
    expect(getContextWindowForModel('claude-fable-5')).toBe(1_000_000)
    expect(getContextWindowForModel('claude-fable-5-1')).toBe(1_000_000)
  })

  test('DISABLE_1M clamps native catalog models to 200K', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(getContextWindowForModel('claude-opus-4-7')).toBe(200_000)
    expect(getContextWindowForModel('claude-fable-5')).toBe(200_000)
  })
})
