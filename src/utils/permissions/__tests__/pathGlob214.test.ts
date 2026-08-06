/**
 * densable 2.1.214 Batch A #1+#44:
 * - o1d / adjustPermissionPatternForIgnore: allow single-segment `dir/**` → `/dir`
 * - matchingRuleForInput (zw): reverse-map + deny/ask any-depth
 * - matchesPathRule (hqe): hook if: always allow-style anchor
 */
import { describe, expect, test } from 'bun:test'
import {
  adjustPermissionPatternForIgnore,
  matchingRuleForInput,
  matchesPathRule,
} from '../filesystem.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import { join } from 'path'

function baseCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  } as ToolPermissionContext
}

function underCwd(...parts: string[]): string {
  return join(process.cwd(), ...parts)
}

describe('adjustPermissionPatternForIgnore densable o1d (#1)', () => {
  test('allow single-segment dir/** anchors at cwd root', () => {
    expect(adjustPermissionPatternForIgnore('src/**', true)).toBe('/src')
  })

  test('deny single-segment dir/** stays any-depth (no leading /)', () => {
    expect(adjustPermissionPatternForIgnore('src/**', false)).toBe('src')
  })

  test('ask mode same as deny for o1d second arg false', () => {
    expect(adjustPermissionPatternForIgnore('src/**', false)).toBe('src')
  })

  test('multi-segment foo/bar/** is never extra-anchored', () => {
    expect(adjustPermissionPatternForIgnore('foo/bar/**', true)).toBe('foo/bar')
    expect(adjustPermissionPatternForIgnore('foo/bar/**', false)).toBe(
      'foo/bar',
    )
  })

  test('bare /** stays /**', () => {
    expect(adjustPermissionPatternForIgnore('/**', true)).toBe('/**')
    expect(adjustPermissionPatternForIgnore('/**', false)).toBe('/**')
  })

  test('non-/** patterns pass through; **/src/** strips like multi-segment', () => {
    expect(adjustPermissionPatternForIgnore('src/*', true)).toBe('src/*')
    // ends with /** → strip; multi-segment (contains /) keeps any-depth prefix
    expect(adjustPermissionPatternForIgnore('**/src/**', true)).toBe('**/src')
    expect(adjustPermissionPatternForIgnore('**/src/**', false)).toBe('**/src')
  })

  test('gitignore negation/comment prefixes stay unanchored under allow', () => {
    expect(adjustPermissionPatternForIgnore('!src/**', true)).toBe('!src')
    expect(adjustPermissionPatternForIgnore('#src/**', true)).toBe('#src')
  })
})

describe('matchesPathRule densable hqe (#44)', () => {
  test('single-segment src/** matches only under cwd/src, not nested any-depth', () => {
    const cwdSrc = underCwd('src', 'a.ts')
    const nested = underCwd('packages', 'x', 'src', 'a.ts')
    expect(matchesPathRule('src/**', cwdSrc)).toBe(true)
    // any-depth would match nested/.../src/...; allow-style must not
    expect(matchesPathRule('src/**', nested)).toBe(false)
  })

  test('**/src/** still matches nested any-depth', () => {
    const nested = underCwd('packages', 'x', 'src', 'a.ts')
    expect(matchesPathRule('**/src/**', nested)).toBe(true)
  })

  test('literal path without * falls back to wildcard matcher', () => {
    const p = underCwd('README.md')
    expect(matchesPathRule('README.md', p)).toBe(true)
  })
})

describe('matchingRuleForInput densable zw (#1)', () => {
  test('allow Read(src/**) matches cwd/src file only', () => {
    const ctx = baseCtx({
      alwaysAllowRules: { session: ['Read(src/**)'] },
    })
    const hit = matchingRuleForInput(
      underCwd('src', 'index.ts'),
      ctx,
      'read',
      'allow',
    )
    expect(hit).not.toBeNull()
    expect(hit?.ruleValue.ruleContent).toBe('src/**')

    const miss = matchingRuleForInput(
      underCwd('packages', 'foo', 'src', 'index.ts'),
      ctx,
      'read',
      'allow',
    )
    expect(miss).toBeNull()
  })

  test('deny Read(src/**) still matches nested any-depth', () => {
    const ctx = baseCtx({
      alwaysDenyRules: { session: ['Read(src/**)'] },
    })
    const nested = matchingRuleForInput(
      underCwd('packages', 'foo', 'src', 'index.ts'),
      ctx,
      'read',
      'deny',
    )
    expect(nested).not.toBeNull()
    expect(nested?.ruleValue.ruleContent).toBe('src/**')
  })

  test('allow multi-segment packages/foo/** matches under that path', () => {
    const ctx = baseCtx({
      alwaysAllowRules: { session: ['Edit(packages/foo/**)'] },
    })
    const hit = matchingRuleForInput(
      underCwd('packages', 'foo', 'bar.ts'),
      ctx,
      'edit',
      'allow',
    )
    expect(hit).not.toBeNull()
    expect(hit?.ruleValue.ruleContent).toBe('packages/foo/**')
  })
})
