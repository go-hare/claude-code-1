import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isEvalConfined, stripEvalConfinedHookAllow } from '../evalConfined.js'

describe('densable QLn confined hook allow strip', () => {
  afterEach(() => {
    delete process.env.CLAUDE_CODE_EVAL_CONFINED
  })

  test('passthrough when not confined', () => {
    const result = {
      permissionBehavior: 'allow' as const,
      permissionRequestResult: { behavior: 'allow' as const },
    }
    stripEvalConfinedHookAllow(result, 'Hook PreToolUse (plugin)')
    expect(result.permissionBehavior).toBe('allow')
    expect(result.permissionRequestResult?.behavior).toBe('allow')
  })

  test('voids allow grants when EVAL_CONFINED', () => {
    process.env.CLAUDE_CODE_EVAL_CONFINED = '1'
    expect(isEvalConfined()).toBe(true)
    const result = {
      permissionBehavior: 'allow' as const | undefined,
      permissionRequestResult: { behavior: 'allow' as const } as
        | { behavior: 'allow' }
        | undefined,
    }
    stripEvalConfinedHookAllow(result, 'Hook PreToolUse (plugin)')
    expect(result.permissionBehavior).toBeUndefined()
    expect(result.permissionRequestResult).toBeUndefined()
  })

  test('keeps deny and ask', () => {
    process.env.CLAUDE_CODE_EVAL_CONFINED = '1'
    const deny = { permissionBehavior: 'deny' as const }
    stripEvalConfinedHookAllow(deny, 'Hook PreToolUse (plugin)')
    expect(deny.permissionBehavior).toBe('deny')
    const ask = { permissionBehavior: 'ask' as const }
    stripEvalConfinedHookAllow(ask, 'Hook PreToolUse (plugin)')
    expect(ask.permissionBehavior).toBe('ask')
  })

  test('live hosts call QLn twin', () => {
    const hooks = readFileSync(join(import.meta.dir, '../../hooks.ts'), 'utf8')
    expect(hooks).toContain('stripEvalConfinedHookAllow')
    const toolHooks = readFileSync(
      join(import.meta.dir, '../../../services/tools/toolHooks.ts'),
      'utf8',
    )
    expect(toolHooks).toContain('stripEvalConfinedHookAllow')
    const permissions = readFileSync(
      join(import.meta.dir, '../permissions.ts'),
      'utf8',
    )
    expect(permissions).toContain('isEvalConfined() && decision.behavior ===')
  })

  test('gold Rze: PreToolUse function-hooks enter executeHooks chain', () => {
    const hooks = readFileSync(join(import.meta.dir, '../../hooks.ts'), 'utf8')
    expect(hooks).toContain("hasMatchingFunctionHook('PreToolUse')")
    expect(hooks).toContain(
      'if (!classicChainMember && hasMatchingFunctionHook(hookEvent))',
    )
    expect(hooks).not.toContain("hookEvent !== 'PreToolUse' &&")
  })
})
