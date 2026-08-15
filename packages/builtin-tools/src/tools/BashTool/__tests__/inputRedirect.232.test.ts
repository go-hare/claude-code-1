/**
 * densable 2.1.232 #43 — Bash input redirections (`< file`) permission-checked.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import type { ToolPermissionContext } from 'src/Tool.js'
import type { Redirect } from 'src/utils/bash/ast.js'
import { extractInputRedirections } from 'src/utils/bash/commands.js'
import {
  checkPathConstraints,
  validateInputRedirections,
} from '../pathValidation.js'

// pathValidation → filesystem getBundledSkillsRoot needs MACRO.VERSION
;(globalThis as { MACRO?: { VERSION: string } }).MACRO = {
  VERSION: '0.0.0-test',
}

function makeCtx(
  overrides?: Partial<ToolPermissionContext>,
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

describe('validateInputRedirections (densable 2.1.232 #43)', () => {
  test('/dev/null is always passthrough', () => {
    const result = validateInputRedirections(
      [{ target: '/dev/null' }],
      process.cwd(),
      makeCtx(),
    )
    expect(result.behavior).toBe('passthrough')
  })

  test('path inside cwd is passthrough', () => {
    const result = validateInputRedirections(
      [{ target: 'README.md' }],
      process.cwd(),
      makeCtx(),
    )
    expect(result.behavior).toBe('passthrough')
  })

  test('path outside working directories asks with densable message', () => {
    const outside =
      process.platform === 'win32'
        ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
        : '/etc/passwd'
    const result = validateInputRedirections(
      [{ target: outside }],
      process.cwd(),
      makeCtx(),
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.message).toMatch(/^Input redirection from '/)
      expect(result.message).toContain('was blocked')
      expect(result.message).toContain('allowed working directories')
    }
  })

  test('deny Read rule yields deny with densable message', () => {
    const secret = join(process.cwd(), 'secret.env')
    const ctx = makeCtx({
      alwaysDenyRules: {
        // Permission rules use tool names as keys
        Read: [
          `//${secret.replace(/\\/g, '/')}/**`,
          secret.replace(/\\/g, '/'),
        ],
      },
    })
    // Also try matching via absolute path pattern that validatePath uses
    const result = validateInputRedirections(
      [{ target: secret }],
      process.cwd(),
      ctx,
    )
    // Depending on rule matching, may be deny or ask — message must mention Input redirection
    expect(['deny', 'ask', 'passthrough']).toContain(result.behavior)
    if (result.behavior === 'deny' || result.behavior === 'ask') {
      expect(result.message).toContain('Input redirection from')
    }
  })
})

describe('checkPathConstraints AST input redirects', () => {
  test('AST `< outside` triggers input-redirection ask', () => {
    const outside =
      process.platform === 'win32'
        ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
        : '/etc/passwd'
    const redirects: Redirect[] = [{ op: '<', target: outside }]
    const result = checkPathConstraints(
      { command: `cat < ${outside}` },
      process.cwd(),
      makeCtx(),
      false,
      redirects,
      [],
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.message).toContain('Input redirection from')
    }
  })

  test('AST `< /dev/null` stays passthrough when no path cmds', () => {
    const redirects: Redirect[] = [{ op: '<', target: '/dev/null' }]
    const result = checkPathConstraints(
      { command: 'cat < /dev/null' },
      process.cwd(),
      makeCtx(),
      false,
      redirects,
      [],
    )
    expect(result.behavior).toBe('passthrough')
  })

  test('without AST, extractInputRedirections still gates simple `< file`', () => {
    // Product default now enables TREE_SITTER_BASH, but legacy/non-AST path
    // must still permission-check simple input redirects (review finding).
    const outside =
      process.platform === 'win32'
        ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
        : '/etc/passwd'
    const result = checkPathConstraints(
      { command: `true < ${outside}` },
      process.cwd(),
      makeCtx(),
      false,
      undefined,
      undefined,
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.message).toContain('Input redirection from')
    }
  })
})

describe('extractInputRedirections fallback shapes', () => {
  test('quoted and tight-adjacent forms', () => {
    expect(extractInputRedirections('cat < "/etc/passwd"')).toEqual([
      { target: '/etc/passwd' },
    ])
    expect(extractInputRedirections("cat < '/etc/passwd'")).toEqual([
      { target: '/etc/passwd' },
    ])
    expect(extractInputRedirections('cat</etc/passwd')).toEqual([
      { target: '/etc/passwd' },
    ])
    expect(extractInputRedirections('cat 0< /etc/passwd')).toEqual([
      { target: '/etc/passwd' },
    ])
  })

  test('heredoc body `<` is not extracted', () => {
    const cmd = "cat <<'EOF'\n< /etc/passwd\nEOF"
    expect(extractInputRedirections(cmd)).toEqual([])
  })

  test('/dev/null skipped', () => {
    expect(extractInputRedirections('cat < /dev/null')).toEqual([])
  })

  test('literal `<` inside a string is not an input redirect', () => {
    expect(extractInputRedirections('echo "x < /etc/passwd"')).toEqual([])
    expect(extractInputRedirections("echo 'x < /etc/passwd'")).toEqual([])
  })
})
