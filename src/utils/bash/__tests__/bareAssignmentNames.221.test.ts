/**
 * densable 2.1.221 U5e/cle/jMy — bareAssignmentNames completeness.
 *
 * Gold push sites (SEA `cle` + `jMy` / local densableYPg):
 * - statement `VAR=val` → bare
 * - declaration_command `export/declare … NAME=val` → bare
 * - for-loop variable → bare
 * - YPg post-pass: read / printf -v / mapfile / declare-like argv / getopts / wait -p
 * - env-prefix `VAR=x cmd` is NOT bare (envVars only), except:
 *   - no command left after wrappers, or
 *   - command is omu builtin (`: break continue return exit shift times set export readonly unset`)
 *
 * ZRu reads this field natively via parseForSecurityFromAst — no rough-token approx.
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

function bareOf(cmd: string): string[] {
  const r = parse(cmd)
  expect(r.kind).toBe('simple')
  if (r.kind !== 'simple') return []
  return r.bareAssignmentNames
}

function envNamesOf(cmd: string): string[] {
  const r = parse(cmd)
  expect(r.kind).toBe('simple')
  if (r.kind !== 'simple') return []
  return r.commands.flatMap(c => c.envVars.map(e => e.name))
}

describe('densable U5e/cle bareAssignmentNames (statement/declaration/for)', () => {
  test('statement-level VAR=val is bare', () => {
    expect(bareOf('GIT_DIR=/x && git status')).toContain('GIT_DIR')
  })

  test('export NAME=val is bare (declaration_command)', () => {
    expect(bareOf('export GIT_DIR=/x && git status')).toContain('GIT_DIR')
  })

  test('declare NAME=val is bare', () => {
    expect(bareOf('declare GIT_WORK_TREE=/x && true')).toContain(
      'GIT_WORK_TREE',
    )
  })

  test('for-loop variable is bare', () => {
    expect(bareOf('for GIT_DIR in a b; do git status; done')).toContain(
      'GIT_DIR',
    )
  })

  test('NAME+=val word form strips trailing +', () => {
    // declaration word append form: densable /^[A-Za-z_][A-Za-z0-9_]*\+?$/
    const bare = bareOf('export FOO+=bar && true')
    expect(bare).toContain('FOO')
    expect(bare).not.toContain('FOO+')
  })
})

describe('densable WMy env-prefix is NOT bare', () => {
  test('GIT_DIR=x git status → envVars only', () => {
    const bare = bareOf('GIT_DIR=/x git status')
    const env = envNamesOf('GIT_DIR=/x git status')
    expect(env).toContain('GIT_DIR')
    expect(bare).not.toContain('GIT_DIR')
  })

  test('GIT_WORK_TREE=x git status → not bare', () => {
    expect(bareOf('GIT_WORK_TREE=/x git status')).not.toContain('GIT_WORK_TREE')
  })
})

describe('densable jMy / YPg post-pass bare writers', () => {
  test('read NAME contributes bare', () => {
    expect(bareOf('read GIT_DIR && git status')).toContain('GIT_DIR')
  })

  test('printf -v NAME contributes bare', () => {
    expect(bareOf('printf -v GIT_DIR /x && git status')).toContain('GIT_DIR')
  })

  test('printf -vNAME glued form contributes bare', () => {
    expect(bareOf('printf -vGIT_DIR /x && true')).toContain('GIT_DIR')
  })

  test('mapfile NAME contributes bare', () => {
    // densable eQi includes LINES/COLUMNS — use a non-special name
    expect(bareOf('mapfile ROWS && true')).toContain('ROWS')
  })

  test('readarray NAME contributes bare', () => {
    expect(bareOf('readarray ARR && true')).toContain('ARR')
  })

  test('getopts name contributes bare (OPTARG is written-only, not bare)', () => {
    const bare = bareOf('getopts ab OPTNAME && true')
    expect(bare).toContain('OPTNAME')
    expect(bare).not.toContain('OPTARG')
  })

  test('wait -p NAME contributes bare', () => {
    expect(bareOf('wait -p PIDVAR && true')).toContain('PIDVAR')
  })

  test('declare as plain command NAME=val (YPg tVu) contributes bare', () => {
    // When parser emits command+argv rather than declaration_command for some
    // wrapper forms; densable jMy tVu.has(u) still harvests NAME=val words.
    // `command declare FOO=bar` goes through walkCommand → densableYPg.
    const bare = bareOf('command declare FOO=bar')
    expect(bare).toContain('FOO')
  })
})

describe('densable jMy omu env-prefix → bare', () => {
  test('FOO=x :  (null command) env-prefix becomes bare', () => {
    // densable: u in rVu + envVars → s(name) into bare list
    expect(bareOf('FOO=x :')).toContain('FOO')
  })

  test('FOO=x true does NOT promote env-prefix to bare', () => {
    expect(bareOf('FOO=x true')).not.toContain('FOO')
  })
})

describe('parseForSecurity surface includes bareAssignmentNames', () => {
  test('simple result always has bareAssignmentNames array', () => {
    const r = parse('echo hi')
    expect(r.kind).toBe('simple')
    if (r.kind === 'simple') {
      expect(Array.isArray(r.bareAssignmentNames)).toBe(true)
      expect(r.bareAssignmentNames).toEqual([])
    }
  })
})
