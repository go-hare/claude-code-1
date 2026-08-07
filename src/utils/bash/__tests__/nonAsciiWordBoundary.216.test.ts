/**
 * densable 2.1.216 #21 — Bash non-ASCII word boundaries match real shell
 * (`guu` treats code units >= \x80 as word chars).
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

function leaves(cmd: string): Array<{ type: string; text: string }> {
  const mod = getParserModule()
  if (!mod) throw new Error('parser unavailable')
  const root = mod.parse(cmd)!
  const out: Array<{ type: string; text: string }> = []
  const walk = (n: {
    type: string
    text: string
    children: Array<typeof n> | null
  }): void => {
    if (!n.children?.length) {
      out.push({ type: n.type, text: n.text })
      return
    }
    for (const c of n.children) walk(c)
  }
  walk(root)
  return out
}

describe('non-ASCII word boundaries densable guu (2.1.216 #21)', () => {
  test('CJK filename stays one word token', () => {
    const r = parse('echo 中文.txt')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands[0]!.argv).toEqual(['echo', '中文.txt'])
  })

  test('café/file stays one word (accented Latin + path punct)', () => {
    const r = parse('echo café/file')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands[0]!.argv).toEqual(['echo', 'café/file'])
  })

  test('ASCII letter glued to CJK is one word (a中文b)', () => {
    const r = parse('a中文b')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands[0]!.argv).toEqual(['a中文b'])
  })

  test('redirect after CJK word still splits at > (中文>out)', () => {
    // densable: 中文 is word, > is redirect, out is target — same as ASCII
    const toks = leaves('中文>out')
    expect(toks.some(t => t.type === '>' && t.text === '>')).toBe(true)
    expect(toks.some(t => t.type === 'word' && t.text === '中文')).toBe(true)
    expect(toks.some(t => t.type === 'word' && t.text === 'out')).toBe(true)
    const r = parse('echo 中文>out')
    expect(r.kind).toBe('simple')
    if (r.kind !== 'simple') return
    expect(r.commands[0]!.argv).toEqual(['echo', '中文'])
    expect(r.commands[0]!.redirects).toEqual([{ op: '>', target: 'out' }])
  })

  test('isWordChar includes high-bit (guu) in source', () => {
    const src = readFileSync(join(import.meta.dir, '../bashParser.ts'), 'utf8')
    expect(src).toContain("c >= '\\x80'")
    // densable guu ASCII punct list must remain
    expect(src).toMatch(/c === '\['/)
    expect(src).toMatch(/c === '\]'/)
  })
})
