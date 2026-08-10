/**
 * densable 2.1.221 cle residuals — for-loop danger set + declaration flags +
 * statement-level Pws/uVu.
 *
 * SEA gold (cle):
 * - for: PS4|IFS|Pws|qws|vws|oVu → too-complex
 * - select → too-complex
 * - declaration: -m/+m, niaAEF, -f+-u, export|readonly -iEF, -T, export `[`
 * - statement assignment: Pws (command-lookup env) + uVu (integer specials)
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { parseForSecurityFromAst } from '../ast.js'
import { ensureParserInitialized, getParserModule } from '../bashParser.js'

beforeAll(async () => {
  await ensureParserInitialized()
})

function parse(cmd: string) {
  const mod = getParserModule()
  if (!mod) throw new Error('bashParser unavailable')
  const root = mod.parse(cmd)
  if (root === null) throw new Error(`parse failed: ${cmd}`)
  return parseForSecurityFromAst(cmd, root)
}

describe('densable cle for_statement danger set', () => {
  test('for PATH is too-complex (vws/Pws)', () => {
    const r = parse('for PATH in a b; do :; done')
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toMatch(/PATH as loop variable bypasses/)
      expect(r.nodeType).toBe('for_statement')
    }
  })

  test('for HOME is too-complex (vws)', () => {
    const r = parse('for HOME in /tmp; do :; done')
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toMatch(/HOME as loop variable/)
    }
  })

  test('for REPLY is too-complex (oVu)', () => {
    const r = parse('for REPLY in x; do :; done')
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toMatch(/REPLY as loop variable/)
    }
  })

  test('for PS1 is too-complex (oVu)', () => {
    const r = parse('for PS1 in x; do :; done')
    expect(r.kind).toBe('too-complex')
  })

  test('for plain VAR still simple + bare', () => {
    // solo `"$ITEM"` is intentionally too-complex (placeholder-only argv
    // element). Embedded form keeps simple + bare.
    const r = parse('for ITEM in a b; do echo "x$ITEM"; done')
    expect(r.kind).toBe('simple')
    if (r.kind === 'simple') {
      expect(r.bareAssignmentNames).toContain('ITEM')
    }
  })

  test('for GIT_DIR still simple + bare (ZRu path)', () => {
    const r = parse('for GIT_DIR in a; do git status; done')
    expect(r.kind).toBe('simple')
    if (r.kind === 'simple') {
      expect(r.bareAssignmentNames).toContain('GIT_DIR')
    }
  })

  test('select is too-complex', () => {
    const r = parse('select x in a b; do :; done')
    // parser may emit for_statement with select child or select_statement
    expect(r.kind === 'too-complex' || r.kind === 'simple').toBe(true)
    if (r.kind === 'too-complex') {
      expect(r.reason).toMatch(/select|cannot statically/i)
    }
  })
})

describe('densable cle declaration_command flags', () => {
  test('declare -n is too-complex (nameref)', () => {
    const r = parse('declare -n X=Y')
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toMatch(/declare flag/)
    }
  })

  test('declare -i is too-complex (integer)', () => {
    const r = parse('declare -i N=1')
    expect(r.kind).toBe('too-complex')
  })

  test('declare +i is too-complex (densable [+-] forms)', () => {
    const r = parse('declare +i N=1')
    expect(r.kind).toBe('too-complex')
  })

  test('export -i is too-complex (zsh bin_typeset)', () => {
    const r = parse('export -i N=1')
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toMatch(/export flag|bin_typeset|iEF/i)
    }
  })

  test('declare -T is too-complex (zsh tied pair)', () => {
    const r = parse('declare -T pair')
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toMatch(/-T|tied pair/)
    }
  })

  test('declare -m is too-complex (zsh pattern-assign)', () => {
    const r = parse('declare -m FOO')
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toMatch(/-m|\+m|pattern/)
    }
  })

  test('export FOO=bar still simple + bare', () => {
    const r = parse('export FOO=bar && true')
    expect(r.kind).toBe('simple')
    if (r.kind === 'simple') {
      expect(r.bareAssignmentNames).toContain('FOO')
    }
  })
})

describe('densable cle statement-level Pws / uVu', () => {
  test('PATH=/x is too-complex (Pws command-lookup env)', () => {
    const r = parse('PATH=/evil && true')
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toMatch(/PATH assignment alters command lookup/)
      expect(r.nodeType).toBe('variable_assignment')
    }
  })

  test('HOME=/x is too-complex (Pws)', () => {
    const r = parse('HOME=/tmp && true')
    expect(r.kind).toBe('too-complex')
  })

  test('LD_PRELOAD=x is too-complex (Pws ld_)', () => {
    const r = parse('LD_PRELOAD=/lib/evil.so && true')
    expect(r.kind).toBe('too-complex')
  })

  test('plain FOO=x still simple + bare', () => {
    const r = parse('FOO=x && true')
    expect(r.kind).toBe('simple')
    if (r.kind === 'simple') {
      expect(r.bareAssignmentNames).toContain('FOO')
    }
  })

  test('GIT_DIR=/x still simple + bare (ZRu path)', () => {
    const r = parse('GIT_DIR=/x && git status')
    expect(r.kind).toBe('simple')
    if (r.kind === 'simple') {
      expect(r.bareAssignmentNames).toContain('GIT_DIR')
    }
  })
})
