import { beforeAll, describe, expect, test } from 'bun:test'
import { parseForSecurityFromAst } from '../ast.js'
import { ensureParserInitialized, getParserModule } from '../bashParser.js'

beforeAll(async () => {
  await ensureParserInitialized()
})

async function parseSec(cmd: string) {
  const mod = getParserModule()
  if (!mod) throw new Error('bashParser unavailable')
  const root = mod.parse(cmd)
  if (!root) throw new Error('mod.parse returned null')
  return parseForSecurityFromAst(cmd, root)
}

describe('#1126 zsh arithmetic differential detection', () => {
  test('plain $((1+2)) remains simple', async () => {
    const res = await parseSec('echo $((1+2))')
    expect(res.kind).toBe('simple')
  })

  test('zsh $[1+2] arithmetic is flagged as too-complex', async () => {
    const res = await parseSec('echo $[1+2]')
    expect(res.kind).toBe('too-complex')
  })

  test('arithmetic with divergent quotes/backticks is flagged as too-complex', async () => {
    const res = await parseSec('echo $((1 + `id`))')
    expect(res.kind).toBe('too-complex')
  })

  test('((...)) arithmetic compound statement is flagged as too-complex', async () => {
    const res = await parseSec('(( x = 1 + 2 ))')
    expect(res.kind).toBe('too-complex')
  })
})

describe('#1122 AST uncertainWrite & usesAssignedValue', () => {
  test('redirected assignment marks uncertainWrite and usesAssignedValue on subsequent read', async () => {
    const res = await parseSec('X=/tmp/safe > /nonexistent/out; echo "$X"')
    expect(res.kind).toBe('simple')
    if (res.kind === 'simple') {
      expect(res.uncertainWrite).toBe(true)
      expect(res.usesAssignedValue).toBe(true)
    }
  })

  test('non-redirected assignment read sets usesAssignedValue', async () => {
    const res = await parseSec('X=/tmp/safe; echo "$X"')
    expect(res.kind).toBe('simple')
    if (res.kind === 'simple') {
      expect(res.uncertainWrite).toBeUndefined()
      expect(res.usesAssignedValue).toBe(true)
    }
  })
})
