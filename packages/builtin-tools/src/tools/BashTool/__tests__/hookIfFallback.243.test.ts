import { describe, expect, test } from 'bun:test'

import { parseForSecurity } from 'src/utils/bash/ast.js'
import { getParserModule } from 'src/utils/bash/bashParser.js'
import { parseCommandRaw } from 'src/utils/bash/parser.js'

import {
  extractHookIfFallbackCommands,
  HOOK_IF_FALLBACK_NODE_TYPES,
  isTrustedHookIfFallbackPattern,
  matchBashHookIfPattern,
} from '../hookIfFallback.js'
import { permissionRuleExtractPrefix } from '../bashPermissions.js'

describe('hook if cmdsubst fallback 243', () => {
  test('C5s node types are the official three', () => {
    expect([...HOOK_IF_FALLBACK_NODE_TYPES].sort()).toEqual([
      'command_substitution',
      'simple_expansion',
      'string',
    ])
  })

  test('trusted fallback patterns are single-token * / prefix without space', () => {
    expect(isTrustedHookIfFallbackPattern('cat *', null)).toBe(true)
    expect(isTrustedHookIfFallbackPattern('cat*', null)).toBe(true)
    expect(
      isTrustedHookIfFallbackPattern(
        'git:*',
        permissionRuleExtractPrefix('git:*'),
      ),
    ).toBe(true)
    expect(isTrustedHookIfFallbackPattern('npm test *', null)).toBe(false)
    expect(
      isTrustedHookIfFallbackPattern(
        'git commit:*',
        permissionRuleExtractPrefix('git commit:*'),
      ),
    ).toBe(false)
  })

  test('Bash(cat *) does not match echo $(date) extra on fallback commands', () => {
    const commands = ['echo $(date) extra', 'date']
    expect(matchBashHookIfPattern('cat *', commands, true)).toBe(false)
    expect(matchBashHookIfPattern('echo *', commands, true)).toBe(true)
  })

  test('untrusted fallback pattern fail-opens', () => {
    expect(matchBashHookIfPattern('npm test *', ['echo hi'], true)).toBe(true)
  })

  test('echo $(date) extra is too-complex command_substitution then P7r skips cat *', async () => {
    const parsed = await parseForSecurity('echo $(date) extra')
    if (parsed.kind === 'parse-unavailable') return
    expect(parsed.kind).toBe('too-complex')
    if (parsed.kind !== 'too-complex') return
    expect(parsed.nodeType).toBe('command_substitution')
    expect(HOOK_IF_FALLBACK_NODE_TYPES.has(parsed.nodeType ?? '')).toBe(true)

    const root = await parseCommandRaw('echo $(date) extra')
    if (!root || typeof root === 'symbol') {
      if (!getParserModule()) return
      throw new Error('expected parse tree for cmdsubst fallback')
    }
    const extracted = extractHookIfFallbackCommands('echo $(date) extra', root)
    expect(extracted).not.toBeNull()
    expect(extracted!.some(c => c.startsWith('echo'))).toBe(true)
    expect(matchBashHookIfPattern('cat *', extracted!, true)).toBe(false)

    const ticks = await parseForSecurity('echo `date` extra')
    if (ticks.kind === 'parse-unavailable') return
    expect(ticks.kind).toBe('too-complex')
    if (ticks.kind === 'too-complex') {
      expect(ticks.nodeType).toBe('command_substitution')
    }
  })
})
