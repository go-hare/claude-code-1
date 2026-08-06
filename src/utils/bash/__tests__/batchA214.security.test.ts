/**
 * densable 2.1.214 Batch A landed surfaces:
 * #3 fd redirect fail-closed (hnu) — pure precheck on synthetic nodes
 * #16 pkill self-guard (K2g)
 * #45 file -m/-f not in safeFlags
 */
import { describe, expect, test } from 'bun:test'
import { precheckFileRedirect } from '../ast.js'
import type { Node } from '../parser.js'
import { createPkillSelfGuardShellIntegration } from '../ShellSnapshot.js'
import { isCommandSafeViaFlagParsing } from '@claude-code/builtin-tools/tools/BashTool/readOnlyValidation.js'

/** Minimal tree-sitter-like node for densable hnu unit tests. */
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

describe('precheckFileRedirect densable hnu (#3)', () => {
  test('simple > word redirect is analyzable (null)', () => {
    // text: ">out.txt" spans 0..8
    const op = node('>', '>', 0, 1)
    const word = node('word', 'out.txt', 1, 8)
    const parent = node('file_redirect', '>out.txt', 0, 8, [op, word])
    expect(precheckFileRedirect(parent)).toBeNull()
  })

  test('variable_name on redirect is too-complex', () => {
    // contiguous children, no unparsed gap: "fd>out" with variable_name
    const vn = node('variable_name', 'fd', 0, 2)
    const op = node('>', '>', 2, 3)
    const word = node('word', 'out', 3, 6)
    const parent = node('file_redirect', 'fd>out', 0, 6, [vn, op, word])
    const r = precheckFileRedirect(parent)
    expect(r?.kind).toBe('too-complex')
    expect(r && r.kind === 'too-complex' ? r.reason : '').toMatch(
      /fd-variable assignment/i,
    )
  })

  test('close-fd followed by word is too-complex', () => {
    // ">&-bar" — space would be unparsed gap; densable also catches followed-by-word
    const op = node('>&-', '>&-', 0, 3)
    const word = node('word', 'bar', 3, 6)
    const parent = node('file_redirect', '>&-bar', 0, 6, [op, word])
    const r = precheckFileRedirect(parent)
    expect(r?.kind).toBe('too-complex')
    expect(r && r.kind === 'too-complex' ? r.reason : '').toMatch(
      /Close-fd redirect is followed by a word/i,
    )
  })

  test('>& target starting with - is too-complex', () => {
    const op = node('>&', '>&', 0, 2)
    const word = node('word', '-1', 2, 4)
    const parent = node('file_redirect', '>&-1', 0, 4, [op, word])
    const r = precheckFileRedirect(parent)
    expect(r?.kind).toBe('too-complex')
    expect(r && r.kind === 'too-complex' ? r.reason : '').toMatch(
      /starts with -/i,
    )
  })

  test('multiple targets is too-complex', () => {
    const op1 = node('>', '>', 0, 1)
    const w1 = node('word', 'a', 1, 2)
    const op2 = node('>', '>', 2, 3)
    const w2 = node('word', 'b', 3, 4)
    const parent = node('file_redirect', '>a>b', 0, 4, [op1, w1, op2, w2])
    const r = precheckFileRedirect(parent)
    expect(r?.kind).toBe('too-complex')
    expect(r && r.kind === 'too-complex' ? r.reason : '').toMatch(
      /multiple targets/i,
    )
  })

  test('unparsed gap between children is too-complex', () => {
    // children leave non-whitespace gap in parent text
    const op = node('>', '>', 0, 1)
    const word = node('word', 'out', 3, 6) // gap at index 1..3 is "xx"
    const parent = node('file_redirect', '>xxout', 0, 6, [op, word])
    const r = precheckFileRedirect(parent)
    expect(r?.kind).toBe('too-complex')
    expect(r && r.kind === 'too-complex' ? r.reason : '').toMatch(
      /unparsed bytes between children/i,
    )
  })
})

describe('createPkillSelfGuardShellIntegration densable K2g (#16)', () => {
  test('emits pkill function that checks CLAUDE_PID and /proc/comm', () => {
    const body = createPkillSelfGuardShellIntegration()
    expect(body).toContain('function pkill')
    expect(body).toContain('CLAUDE_PID')
    expect(body).toContain('/proc/${CLAUDE_PID}/comm')
    expect(body).toContain('command pgrep')
    expect(body).toContain('refusing to run')
    expect(body).toContain('command pkill')
  })

  test('skips --signal and -N signal forms in probe construction', () => {
    const body = createPkillSelfGuardShellIntegration()
    expect(body).toContain('--signal')
    expect(body).toContain('-[0-9]*')
  })
})

describe('file command safeFlags densable #45', () => {
  test('file -b is still flag-safe', () => {
    expect(isCommandSafeViaFlagParsing('file -b /etc/passwd')).toBe(true)
  })

  test('file -m / magic-file is not flag-safe', () => {
    expect(isCommandSafeViaFlagParsing('file -m /tmp/magic /etc/passwd')).toBe(
      false,
    )
    expect(
      isCommandSafeViaFlagParsing('file --magic-file /tmp/magic /etc/passwd'),
    ).toBe(false)
  })

  test('file -f / files-from is not flag-safe', () => {
    expect(isCommandSafeViaFlagParsing('file -f list.txt')).toBe(false)
    expect(isCommandSafeViaFlagParsing('file --files-from list.txt')).toBe(
      false,
    )
  })
})
