/**
 * densable 2.1.246 #42 — dangling `&&` / `||` is an ERROR node (official
 * parseAndOr: empty ve() RHS → type ERROR → too-complex / Parse error → ask).
 * No string endsWith("&&") helper.
 */
import { describe, expect, test } from 'bun:test'
import { getParserModule } from '../bashParser.js'
import { parseForSecurityFromAst } from '../ast.js'

function parse(cmd: string) {
  const mod = getParserModule()
  if (!mod) throw new Error('parser unavailable')
  const root = mod.parse(cmd)
  if (!root) throw new Error(`parse returned null: ${cmd}`)
  return { root, security: parseForSecurityFromAst(cmd, root) }
}

function hasErrorNode(node: { type: string; children: unknown[] }): boolean {
  if (node.type === 'ERROR') return true
  for (const child of node.children) {
    if (
      child &&
      typeof child === 'object' &&
      hasErrorNode(child as { type: string; children: unknown[] })
    ) {
      return true
    }
  }
  return false
}

describe('dangling && / || (densable 2.1.246 #42)', () => {
  test('echo hi && → ERROR → too-complex Parse error', () => {
    const { root, security } = parse('echo hi &&')
    expect(hasErrorNode(root)).toBe(true)
    expect(security.kind).toBe('too-complex')
    if (security.kind !== 'too-complex') return
    expect(security.reason).toBe('Parse error')
    expect(security.nodeType).toBe('ERROR')
  })

  test('echo hi || → ERROR → too-complex Parse error', () => {
    const { root, security } = parse('echo hi ||')
    expect(hasErrorNode(root)).toBe(true)
    expect(security.kind).toBe('too-complex')
    if (security.kind !== 'too-complex') return
    expect(security.reason).toBe('Parse error')
    expect(security.nodeType).toBe('ERROR')
  })

  test('trailing whitespace after && is still empty RHS', () => {
    const { security } = parse('git status &&  ')
    expect(security.kind).toBe('too-complex')
    if (security.kind !== 'too-complex') return
    expect(security.nodeType).toBe('ERROR')
  })

  test('complete && / || lists stay simple', () => {
    expect(parse('echo hi && echo bye').security.kind).toBe('simple')
    expect(parse('false || echo bye').security.kind).toBe('simple')
  })

  test('echo hi | → ERROR → too-complex Parse error', () => {
    const { root, security } = parse('echo hi |')
    expect(hasErrorNode(root)).toBe(true)
    expect(security.kind).toBe('too-complex')
    if (security.kind !== 'too-complex') return
    expect(security.reason).toBe('Parse error')
    expect(security.nodeType).toBe('ERROR')
  })
})
