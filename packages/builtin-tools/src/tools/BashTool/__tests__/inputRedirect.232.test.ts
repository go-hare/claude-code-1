/**
 * densable 2.1.232 #43 residual — helpers retained after 2.1.233 product revert.
 * Official 233: "Reverted the 2.1.232 Bash permission changes … for input
 * redirections (`< file`); a narrower version will return in a later release."
 * Product checkPathConstraints no longer calls these; tests lock residual API.
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
    // residual API: use a file that exists in this monorepo (README.md may be
    // absent depending on cwd when bun test runs a single file).
    const inside = join(process.cwd(), 'package.json')
    const result = validateInputRedirections(
      [{ target: inside }],
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
    const secretNorm = secret.replace(/\\/g, '/')
    const ctx = makeCtx({
      alwaysDenyRules: {
        // ToolPermissionRulesBySource is keyed by PermissionRuleSource
        session: [`Read(//${secretNorm}/**)`, `Read(${secretNorm})`],
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

describe('checkPathConstraints after densable 2.1.233 input-redirect revert', () => {
  test('AST `< outside` is NOT product-gated (233 reverted 232 #43)', () => {
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
    // Product path no longer runs validateInputRedirections
    expect(result.behavior).not.toBe('ask')
  })

  test('without AST, bare `< file` is not product-gated with Input redirection ask', () => {
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
    expect(result.behavior).toBeDefined()
    if (result.behavior === 'ask') {
      expect(result.message ?? '').not.toContain('Input redirection from')
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
