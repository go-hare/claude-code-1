import { describe, expect, test } from 'bun:test'
import type { PromptCommand } from '../../../types/command.js'
import type { ToolUseContext } from '../../../Tool.js'
import {
  isForkCapableSkill,
  resolveSkillEffort,
  resolveSkillExecutionContext,
} from '../skillExecutionContext.js'

const ctx = {} as ToolUseContext

describe('densable 2.1.289 k_n skill execution context', () => {
  test('falls back to static context then inline', () => {
    expect(resolveSkillExecutionContext({ context: 'fork' }, '', ctx)).toBe(
      'fork',
    )
    expect(resolveSkillExecutionContext({}, '', ctx)).toBe('inline')
  })

  test('getContext overrides static context', () => {
    const command: Pick<PromptCommand, 'context' | 'getContext'> = {
      context: 'inline',
      getContext: (args: string) => (args === 'fork-me' ? 'fork' : 'inline'),
    }
    expect(resolveSkillExecutionContext(command, 'fork-me', ctx)).toBe('fork')
    expect(resolveSkillExecutionContext(command, 'stay', ctx)).toBe('inline')
  })

  test('Ywo fork-capable: context fork OR getContext defined', () => {
    expect(isForkCapableSkill({ context: 'fork' })).toBe(true)
    expect(isForkCapableSkill({ getContext: () => 'inline' })).toBe(true)
    expect(isForkCapableSkill({ context: 'inline' })).toBe(false)
    expect(isForkCapableSkill(undefined)).toBe(false)
  })

  test('getEffort ?? getDefaultEffort.value ?? effort', () => {
    expect(resolveSkillEffort({ effort: 'high' }, '', ctx)).toBe('high')
    expect(
      resolveSkillEffort(
        {
          effort: 'high',
          getDefaultEffort: () => ({ value: 'medium', notice: 'n' }),
        },
        '',
        ctx,
      ),
    ).toBe('medium')
    expect(
      resolveSkillEffort(
        {
          effort: 'high',
          getDefaultEffort: () => ({ value: 'medium' }),
          getEffort: () => 'low',
        },
        '',
        ctx,
      ),
    ).toBe('low')
  })
})
