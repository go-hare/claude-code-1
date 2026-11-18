import { beforeAll, describe, expect, test } from 'bun:test'
import { parseForSecurityFromAst } from './ast.js'
import { ensureParserInitialized, getParserModule } from './bashParser.js'

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

describe('Bash AST v2.1.295-296 alignment (#386, #516)', () => {
  test('#516: rejects BASH_ARGV0 as for-loop variable', () => {
    const res = parse('for BASH_ARGV0 in foo bar; do echo "$BASH_ARGV0"; done')
    expect(res.kind).toBe('too-complex')
    if (res.kind === 'too-complex') {
      expect(res.reason).toContain(
        'BASH_ARGV0 as loop variable bypasses assignment validation',
      )
      expect(res.nodeType).toBe('for_statement')
    }
  })

  test('#386: for-loop over unquoted glob with no-op body emits body command', () => {
    const res = parse('for f in *.txt; do :; done')
    expect(res.kind).toBe('simple')
    if (res.kind === 'simple') {
      expect(res.commands.length).toBeGreaterThanOrEqual(1)
      const last = res.commands.at(-1)
      expect(last?.argv[0]).toBe(':')
    }
  })

  test('#386: for-loop over unquoted glob with empty-cmd body emits true placeholder with hasUnquotedGlob', () => {
    const res = parse('for f in *.txt; do x=1; done')
    expect(res.kind).toBe('simple')
    if (res.kind === 'simple') {
      expect(res.commands).toHaveLength(1)
      expect(res.commands[0]?.argv).toEqual(['true'])
      expect(res.commands[0]?.hasUnquotedGlob).toBe(true)
    }
  })

  test('#386: for-loop over quoted glob with empty-cmd body does not emit placeholder', () => {
    const res = parse('for f in "*.txt"; do x=1; done')
    expect(res.kind).toBe('simple')
    if (res.kind === 'simple') {
      expect(res.commands).toHaveLength(0)
    }
  })
})
