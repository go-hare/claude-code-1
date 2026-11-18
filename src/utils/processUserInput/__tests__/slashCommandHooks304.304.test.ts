import { describe, expect, test } from 'bun:test'
import {
  MAX_SKILL_HOOKS_PER_SOURCE,
  registerSkillHooks,
} from '../../hooks/registerSkillHooks.js'
import type { HooksSettings } from '../../settings/types.js'

describe('skill hooks v2.1.304 (#1018)', () => {
  test('#1018: registerSkillHooks returns undefined when hooks fit and bounds failure when exceeded', () => {
    const okHooks: HooksSettings = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo ok' }],
        },
      ],
    }
    const resOk = registerSkillHooks(
      (() => {}) as never,
      'sess-1018-a',
      okHooks,
      'ok-skill',
      undefined,
      { sourceKind: 'userSettings', sourceId: 'user-a' },
    )
    expect(resOk).toBeUndefined()

    const tooManyHooks: HooksSettings = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: Array.from(
            { length: MAX_SKILL_HOOKS_PER_SOURCE + 1 },
            (_, i) => ({ type: 'command' as const, command: `echo ${i}` }),
          ),
        },
      ],
    }
    const resFail = registerSkillHooks(
      (() => {}) as never,
      'sess-1018-b',
      tooManyHooks,
      'big-skill',
      undefined,
      { sourceKind: 'userSettings', sourceId: 'user-b' },
    )
    expect(resFail).toBe('count')
  })
})
