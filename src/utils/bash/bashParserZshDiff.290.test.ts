import { beforeAll, describe, expect, test } from 'bun:test'
import { ensureParserInitialized, getParserModule } from './bashParser.js'

describe('bashParser v2.1.290 #78 zsh/bash differential guards', () => {
  beforeAll(async () => {
    await ensureParserInitialized()
  })
  const parse = (cmd: string) => getParserModule()?.parse(cmd)

  test('flags $\\\n (zshBraceDiff) as ERROR', () => {
    const tree = parse('echo $\\\nfoo')
    expect(tree?.type).toBe('ERROR')
  })

  test('flags $$[ / $${ / $$( (dollarOperandDiff) as ERROR', () => {
    expect(parse('echo $${foo}')?.type).toBe('ERROR')
    expect(parse('echo $$[1+1]')?.type).toBe('ERROR')
    expect(parse('echo $$(id)')?.type).toBe('ERROR')
  })

  test('flags [[( (zshCondParenDiff) as ERROR', () => {
    expect(parse('[[( -f foo )]]')?.type).toBe('ERROR')
  })

  test('flags $[...] and $(\\\n( (zshMathDiff) outside quotes/heredocs as ERROR', () => {
    expect(parse('echo $[1+2]')?.type).toBe('ERROR')
    expect(parse('echo $(\\\n(1+2))')?.type).toBe('ERROR')
    expect(parse("echo '$[1+2]'")?.type).toBe('program')
  })

  test('parses normal bash commands as program', () => {
    expect(parse('echo $((1 + 2))')?.type).toBe('program')
    expect(parse('[[ -f foo ]] && echo ok')?.type).toBe('program')
  })
})
