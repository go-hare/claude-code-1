/**
 * Pure mirror of official 2.1.207 GFy matchesPattern exact-list mode.
 * Avoids loading hooks.ts (heavy deps / process-global mock risk).
 */
import { describe, expect, test } from 'bun:test'

const HOOK_EXACT_LIST_MATCHER_RE = /^[a-zA-Z0-9_|, -]+$/
const HOOK_EXACT_LIST_SPLIT_RE = /[|, ]+/

function normalizeLegacyToolName(name: string): string {
  // Minimal stand-in: production maps Task→Agent etc. Exact list tests use
  // modern names so identity is enough here.
  return name
}

function matchesPattern(matchQuery: string, matcher: string): boolean {
  if (!matcher || matcher === '*') return true
  if (HOOK_EXACT_LIST_MATCHER_RE.test(matcher)) {
    const patterns = matcher
      .split(HOOK_EXACT_LIST_SPLIT_RE)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => normalizeLegacyToolName(p))
    return patterns.includes(matchQuery)
  }
  try {
    return new RegExp(matcher).test(matchQuery)
  } catch {
    return false
  }
}

function isMcpServerOnlyExactMatcherToken(token: string): boolean {
  return token.startsWith('mcp__') && !token.slice(5).includes('__')
}

function isMcpServerOnlyExactMatcher(matcher: string): boolean {
  if (!HOOK_EXACT_LIST_MATCHER_RE.test(matcher)) return false
  return matcher
    .split(HOOK_EXACT_LIST_SPLIT_RE)
    .map(t => t.trim())
    .filter(Boolean)
    .some(isMcpServerOnlyExactMatcherToken)
}

describe('hook matchesPattern exact-list (2.1.191/207)', () => {
  test('pipe-separated exact matches', () => {
    expect(matchesPattern('Edit', 'Edit|Write')).toBe(true)
    expect(matchesPattern('Bash', 'Edit|Write')).toBe(false)
  })

  test('comma-separated exact matches', () => {
    expect(matchesPattern('Write', 'Edit,Write')).toBe(true)
    expect(matchesPattern('Edit', 'Edit, Write')).toBe(true)
    expect(matchesPattern('Bash', 'Edit, Write')).toBe(false)
  })

  test('space-separated exact matches', () => {
    expect(matchesPattern('Write', 'Edit Write')).toBe(true)
  })

  test('hyphenated tool names stay exact (not regex)', () => {
    expect(matchesPattern('mcp__srv__my-tool', 'mcp__srv__my-tool')).toBe(true)
    expect(matchesPattern('mcp__srv__my-tool', 'mcp__srv__other-tool')).toBe(
      false,
    )
  })

  test('wildcard * matches all', () => {
    expect(matchesPattern('Anything', '*')).toBe(true)
  })

  test('regex path still works for non-list charset', () => {
    expect(matchesPattern('WriteFoo', '^Write.*')).toBe(true)
    expect(matchesPattern('mcp__srv__a', 'mcp__srv__.*')).toBe(true)
  })
})

describe('mcp server-only exact matcher warn predicate (2.1.195)', () => {
  test('detects mcp__server without tool segment', () => {
    expect(isMcpServerOnlyExactMatcher('mcp__myserver')).toBe(true)
    expect(isMcpServerOnlyExactMatcher('mcp__myserver|Bash')).toBe(true)
  })

  test('does not flag full tool names or regex', () => {
    expect(isMcpServerOnlyExactMatcher('mcp__myserver__tool')).toBe(false)
    expect(isMcpServerOnlyExactMatcher('mcp__myserver__.*')).toBe(false)
  })
})
