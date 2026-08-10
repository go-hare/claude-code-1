/**
 * densable 2.1.214 Batch A residual:
 * #2 PS5.1 shadow helpers
 * #4 dual 10k (parse abort + F7u passthrough)
 * #5 zsh [[ ]] fnu/mnu
 * #6 help/man dangerous callbacks
 */
import { describe, expect, test } from 'bun:test'
import {
  detectZshSubscriptOrModifier,
  parseForSecurityFromAst,
  precheckTestCommand,
} from '../ast.js'
import { PARSE_ABORTED, type Node } from '../parser.js'
import {
  helpArgsAreDangerous,
  manArgsAreDangerous,
  READ_ONLY_ANALYSIS_MAX_LENGTH,
  checkReadOnlyConstraints,
} from '@claude-code/builtin-tools/tools/BashTool/readOnlyValidation.js'
import { checkSedConstraints } from '@claude-code/builtin-tools/tools/BashTool/sedValidation.js'
import {
  psCommandBaseAndStem,
  psShadowStem,
} from '@claude-code/builtin-tools/tools/PowerShellTool/powershellPermissions.js'
import {
  extractOutputRedirections,
  isUnsafeCompoundCommand_DEPRECATED,
  splitCommandWithOperators,
} from '../commands.js'

/** Minimal tree-sitter-like node for densable unit tests. */
function node(
  type: string,
  text: string,
  startIndex: number,
  endIndex: number,
  children: Node[] = [],
): Node {
  return {
    type,
    text,
    children,
    startIndex,
    endIndex,
    childCount: children.length,
    namedChildCount: children.length,
    parent: null,
    nextSibling: null,
    previousSibling: null,
    nextNamedSibling: null,
    previousNamedSibling: null,
    firstChild: children[0] ?? null,
    lastChild: children[children.length - 1] ?? null,
    firstNamedChild: children[0] ?? null,
    lastNamedChild: children[children.length - 1] ?? null,
  } as unknown as Node
}

describe('densable #2 PS5.1 shadow helpers', () => {
  test('psShadowStem strips path + last extension', () => {
    expect(psShadowStem('./evil.ps1')).toBe('evil')
    expect(psShadowStem('C:\\tmp\\foo.bar.ps1')).toBe('foo.bar')
    expect(psShadowStem('.hidden')).toBe('.hidden')
    expect(psShadowStem('')).toBe('')
  })

  test('psCommandBaseAndStem lowercases base and stem', () => {
    expect(psCommandBaseAndStem('Evil.ps1')).toEqual({
      base: 'evil.ps1',
      stem: 'evil',
    })
    expect(psCommandBaseAndStem('./tools/Get-Thing')).toEqual({
      base: 'get-thing',
      stem: 'get-thing',
    })
  })
})

describe('densable #4 dual 10k', () => {
  test('READ_ONLY_ANALYSIS_MAX_LENGTH is densable K0e=1e4', () => {
    expect(READ_ONLY_ANALYSIS_MAX_LENGTH).toBe(10000)
  })

  test('checkReadOnlyConstraints over-length → F7u passthrough', () => {
    const command = 'echo ' + 'x'.repeat(10001)
    const r = checkReadOnlyConstraints({ command } as never, false)
    expect(r.behavior).toBe('passthrough')
    if (r.behavior === 'passthrough') {
      expect(r.message).toBe('Command too long for read-only analysis')
    }
  })

  test('parseForSecurityFromAst(PARSE_ABORTED) is too-complex PARSE_ABORT', () => {
    const r = parseForSecurityFromAst('x'.repeat(10001), PARSE_ABORTED)
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toBe(
        'Parser aborted (timeout, resource limit, or over-length)',
      )
      expect(r.nodeType).toBe('PARSE_ABORT')
    }
  })
})

describe('densable #5 zsh [[ ]] fnu/mnu', () => {
  test('precheckTestCommand allows contiguous [[ -f x ]]', () => {
    // text: 0:[ 1:[ 2:  3:- 4:f 5:  6:x 7:  8:] 9:] — spaces are inert gaps
    const open = node('[[', '[[', 0, 2)
    const op = node('test_operator', '-f', 3, 5)
    const word = node('word', 'x', 6, 7)
    const close = node(']]', ']]', 8, 10)
    const parent = node('test_command', '[[ -f x ]]', 0, 10, [
      open,
      op,
      word,
      close,
    ])
    expect(precheckTestCommand(parent, true)).toBeNull()
  })

  test('precheckTestCommand fails closed on non-inert unparsed bytes', () => {
    // children skip over `;` between them
    const left = node('word', 'a', 0, 1)
    const right = node('word', 'b', 2, 3)
    // text "a;b" — gap ";" is not inert
    const parent = node('test_command', 'a;b', 0, 3, [left, right])
    const r = precheckTestCommand(parent, true)
    expect(r?.kind).toBe('too-complex')
    expect(r && r.kind === 'too-complex' ? r.reason : '').toMatch(
      /unparsed bytes between children/i,
    )
  })

  test('detectZshSubscriptOrModifier catches $name[expr]', () => {
    // synthetic: simple_expansion `$x` then word `[0]`
    const exp = node('simple_expansion', '$x', 0, 2, [
      node('variable_name', 'x', 1, 2),
    ])
    const sub = node('word', '[0]', 2, 5)
    const bin = node('binary_expression', '$x[0]', 0, 5, [exp, sub])
    const r = detectZshSubscriptOrModifier(bin)
    expect(r?.kind).toBe('too-complex')
    expect(r && r.kind === 'too-complex' ? r.reason : '').toMatch(
      /zsh \$name\[expr\]/,
    )
  })

  test('detectZshSubscriptOrModifier catches $name:mod', () => {
    const exp = node('simple_expansion', '$path', 0, 5, [
      node('variable_name', 'path', 1, 5),
    ])
    const mod = node('word', ':h', 5, 7)
    const bin = node('unary_expression', '$path:h', 0, 7, [exp, mod])
    const r = detectZshSubscriptOrModifier(bin)
    expect(r?.kind).toBe('too-complex')
    expect(r && r.kind === 'too-complex' ? r.reason : '').toMatch(/\$name:mod/)
  })

  test('densable 2.1.221: extglob_pattern unquoted & → too-complex', () => {
    // walkTestExpr path: [[ ]] with extglob_pattern containing unquoted &
    const open = node('[[', '[[', 0, 2)
    const pattern = node('extglob_pattern', 'foo&bar', 3, 10)
    const close = node(']]', ']]', 11, 13)
    const parent = node('test_command', '[[ foo&bar ]]', 0, 13, [
      open,
      pattern,
      close,
    ])
    const r = parseForSecurityFromAst('[[ foo&bar ]]', parent)
    expect(r.kind).toBe('too-complex')
    if (r.kind === 'too-complex') {
      expect(r.reason).toBe(
        '[[ ]] pattern contains unquoted & (zsh splits the word at & at any depth)',
      )
      expect(r.differential).toBe(true)
    }
  })

  test('densable 2.1.221: escaped & in extglob_pattern is allowed', () => {
    const open = node('[[', '[[', 0, 2)
    const pattern = node('extglob_pattern', 'foo\\&bar', 3, 11)
    const close = node(']]', ']]', 12, 14)
    const parent = node('test_command', '[[ foo\\&bar ]]', 0, 14, [
      open,
      pattern,
      close,
    ])
    const r = parseForSecurityFromAst('[[ foo\\&bar ]]', parent)
    // no expansion / no unquoted & → simple (or may still be simple with [[ argv)
    expect(r.kind).not.toBe('too-complex')
  })
})

describe('densable #4 secondary K0e sites', () => {
  test('splitCommandWithOperators over-length returns [command] (CE)', () => {
    const long = 'echo ' + 'x'.repeat(10001)
    const parts = splitCommandWithOperators(long)
    expect(parts).toEqual([long])
  })

  test('isUnsafeCompoundCommand_DEPRECATED over-length is true (Uto)', () => {
    expect(isUnsafeCompoundCommand_DEPRECATED('x'.repeat(10001))).toBe(true)
  })

  test('extractOutputRedirections over-length empty analysis (zOe)', () => {
    const long = 'echo hi > /tmp/out ' + 'x'.repeat(10000)
    const r = extractOutputRedirections(long)
    expect(r.redirections).toEqual([])
    expect(r.hasDangerousRedirection).toBe(false)
    expect(r.commandWithoutRedirections).toBe(long)
  })

  test('checkSedConstraints over-length ask with densable reason (Eys)', () => {
    const r = checkSedConstraints(
      { command: 'sed ' + 's/a/b/;'.repeat(2000) },
      { mode: 'default' } as never,
    )
    expect(r.behavior).toBe('ask')
    if (r.behavior === 'ask' && r.decisionReason?.type === 'other') {
      expect(r.decisionReason.reason).toMatch(/over-length/)
      expect(r.decisionReason.bashMissKind).toBe('sed-dangerous')
    }
  })
})

describe('densable #6 help/man', () => {
  test('man path-like operand is dangerous', () => {
    expect(manArgsAreDangerous(['/etc/passwd'])).toBe(true)
    expect(manArgsAreDangerous(['~/.bashrc'])).toBe(true)
  })

  test('man cmdsub operand is dangerous', () => {
    expect(manArgsAreDangerous(['$(id)'])).toBe(true)
    expect(manArgsAreDangerous(['`id`'])).toBe(true)
  })

  test('man plain page name is safe', () => {
    expect(manArgsAreDangerous(['ls'])).toBe(false)
    expect(manArgsAreDangerous(['-a', 'bash'])).toBe(false)
  })

  test('man apropos mode + dash operand after -- is dangerous', () => {
    // densable: flag-shaped args before `--` always `continue` (even unknown);
    // `o&&l.startsWith("-")` only runs once pastEndOfOptions (after `--`) or
    // for lone `-`. So `man -k -evil` is NOT callback-dangerous; `man -k -- -evil` is.
    expect(manArgsAreDangerous(['-k', '-evil'])).toBe(false)
    expect(manArgsAreDangerous(['-k', '--', '-evil'])).toBe(true)
    expect(manArgsAreDangerous(['-k', '-'])).toBe(true)
  })

  test('help path-like / cmdsub is dangerous', () => {
    expect(helpArgsAreDangerous(['/bin/ls'])).toBe(true)
    expect(helpArgsAreDangerous(['$(whoami)'])).toBe(true)
    expect(helpArgsAreDangerous(['echo'])).toBe(false)
  })
})
