/**
 * densable 2.1.218 #22 — QEt mainThread agent hooks origin trust.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
  stripProtoFields: <T>(v: T) => v,
}))

const { getMainThreadAgentHooks, setMainThreadAgentHooks } = await import(
  '../../../bootstrap/state.js'
)
const { applyMainThreadAgentHooks, hasNonEmptyAgentHooks } = await import(
  '../applyMainThreadAgentHooks.js'
)

afterEach(() => {
  setMainThreadAgentHooks(undefined)
})

describe('hasNonEmptyAgentHooks (densable gvo)', () => {
  test('empty / missing is false', () => {
    expect(hasNonEmptyAgentHooks(undefined)).toBe(false)
    expect(hasNonEmptyAgentHooks({})).toBe(false)
    expect(hasNonEmptyAgentHooks({ PreToolUse: [] })).toBe(false)
    expect(
      hasNonEmptyAgentHooks({ PreToolUse: [{ matcher: '*', hooks: [] }] }),
    ).toBe(false)
  })

  test('non-empty matcher hooks is true', () => {
    expect(
      hasNonEmptyAgentHooks({
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo hi' }],
          },
        ],
      }),
    ).toBe(true)
  })
})

describe('applyMainThreadAgentHooks (densable QEt)', () => {
  test('clears when agent missing or hooks empty', () => {
    setMainThreadAgentHooks({
      PreToolUse: [
        { matcher: '*', hooks: [{ type: 'command', command: 'x' }] },
      ],
    })
    applyMainThreadAgentHooks(undefined)
    expect(getMainThreadAgentHooks()).toBeUndefined()

    applyMainThreadAgentHooks({
      agentType: 'x',
      source: 'projectSettings',
      hooks: {},
    })
    expect(getMainThreadAgentHooks()).toBeUndefined()
  })

  test('admin-trusted source stores hooks', () => {
    const hooks = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command' as const, command: 'echo ok' }],
        },
      ],
    }
    applyMainThreadAgentHooks({
      agentType: 'plugin-agent',
      source: 'plugin',
      baseDir: '/untrusted',
      hooks,
    })
    expect(getMainThreadAgentHooks()).toEqual(hooks)
  })

  test('projectSettings untrusted origin does not store hooks', () => {
    const hooks = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command' as const, command: 'echo bad' }],
        },
      ],
    }
    applyMainThreadAgentHooks({
      agentType: 'sneaky',
      source: 'projectSettings',
      baseDir: `/tmp/untrusted-mainthread-hooks-${Date.now()}/.claude/agents`,
      hooks,
    })
    expect(getMainThreadAgentHooks()).toBeUndefined()
  })
})
