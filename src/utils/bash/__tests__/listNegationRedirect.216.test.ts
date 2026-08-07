/**
 * densable 2.1.216 #13 — Bash permission checking for redirects on `&&` lists
 * and negations (densable `uxg` / `$uu` / post-A redirect scope).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getParserModule } from '../bashParser.js'
import { parseForSecurityFromAst } from '../ast.js'

function parse(cmd: string) {
  const mod = getParserModule()
  if (!mod) throw new Error('parser unavailable')
  return parseForSecurityFromAst(cmd, mod.parse(cmd)!)
}

describe('list/negation redirects densable uxg (2.1.216 #13)', () => {
  test('A && B > out attaches redirect to B only', () => {
    const r = parse('echo a && echo b > /tmp/out')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands).toHaveLength(2)
    expect(r.commands[0]!.argv).toEqual(['echo', 'a'])
    expect(r.commands[0]!.redirects).toEqual([])
    expect(r.commands[1]!.argv).toEqual(['echo', 'b'])
    expect(r.commands[1]!.redirects).toEqual([{ op: '>', target: '/tmp/out' }])
  })

  test('! cmd > out peels negation and attaches redirect', () => {
    const r = parse('! echo a > /tmp/out')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands).toHaveLength(1)
    expect(r.commands[0]!.argv).toEqual(['echo', 'a'])
    expect(r.commands[0]!.redirects).toEqual([{ op: '>', target: '/tmp/out' }])
  })

  test('! A && B > out attaches to B', () => {
    const r = parse('! true && echo b > /tmp/out')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands.map(c => c.argv)).toEqual([['true'], ['echo', 'b']])
    expect(r.commands[1]!.redirects[0]?.target).toBe('/tmp/out')
  })

  test('FOO=/tmp && echo > $FOO/out resolves post-A scope (densable uxg)', () => {
    const r = parse('FOO=/tmp && echo hi > $FOO/out')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands).toHaveLength(1)
    expect(r.commands[0]!.argv).toEqual(['echo', 'hi'])
    expect(r.commands[0]!.redirects).toEqual([{ op: '>', target: '/tmp/out' }])
  })

  test('FOO=/tmp && echo > "$FOO/out" string form resolves', () => {
    const r = parse('FOO=/tmp && echo hi > "$FOO/out"')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands[0]!.redirects[0]?.target).toBe('/tmp/out')
  })

  test('cd && echo > file keeps both commands + redirect on echo', () => {
    const r = parse('cd /tmp && echo hi > file')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands[0]!.argv).toEqual(['cd', '/tmp'])
    expect(r.commands[1]!.redirects[0]?.target).toBe('file')
  })

  test('list last leaf subshell under redirect → too-complex ($uu peel)', () => {
    const r = parse('echo a && (echo b) > /tmp/out')
    expect(r.kind).toBe('too-complex')
    if (r.kind !== 'too-complex') return
    expect(r.nodeType).toBe('subshell')
  })

  test('negated subshell under redirect → too-complex', () => {
    const r = parse('! (echo a) > /tmp/out')
    expect(r.kind).toBe('too-complex')
    if (r.kind !== 'too-complex') return
    expect(r.nodeType).toBe('subshell')
  })

  test('compound_statement under redirect → too-complex', () => {
    const r = parse('{ echo a && echo b; } > /tmp/out')
    expect(r.kind).toBe('too-complex')
    if (r.kind !== 'too-complex') return
    expect(r.nodeType).toBe('compound_statement')
  })

  test('true || echo > out still attaches to RHS command', () => {
    const r = parse('true || echo b > /tmp/x')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands[1]!.redirects[0]?.target).toBe('/tmp/x')
  })

  test('source contracts densable uxg/$uu', () => {
    const src = readFileSync(join(import.meta.dir, '../ast.ts'), 'utf8')
    expect(src).toContain('peelRedirectBodyLeaf')
    expect(src).toContain('REDIRECT_BODY_TYPES')
    expect(src).toContain("kids[1]?.type === '&&'")
    expect(src).toContain('redirectScope = new Map(varScope)')
  })
})
