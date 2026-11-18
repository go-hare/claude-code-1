import { describe, expect, mock, test } from 'bun:test'
import { AbortError } from '../../../utils/errors.js'

describe('#991 PreToolUse deny reason preserved when subsequent SDK hook times out', () => {
  test('re-yields deniedPermissionResult instead of timeout stop', async () => {
    let callCount = 0
    const actualHooks = await import('../../../utils/hooks.js')
    mock.module('../../../utils/hooks.js', () => ({
      ...actualHooks,
      executePreToolHooks: async function* () {
        callCount++
        if (callCount === 1) {
          yield {
            outcome: 'success',
            permissionBehavior: 'deny',
            hookPermissionDecisionReason: 'Blocked by security policy',
            hookSource: 'settings',
          }
          throw new AbortError('Hook timed out')
        }
      },
      executePostToolHooks: async function* () {},
      executePostToolUseFailureHooks: async function* () {},
      getPreToolHookBlockingMessage: () => '',
    }))

    const { runPreToolUseHooks } = await import('../toolHooks.js')

    const tool = { name: 'Bash', isMcp: false } as never
    const context = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: { mode: 'ask' } }),
      options: {},
    } as never

    const events: Array<{
      type: string
      hookPermissionResult?: { behavior: string; message?: string }
    }> = []
    for await (const ev of runPreToolUseHooks(
      context,
      tool,
      { command: 'rm -rf /' },
      'toolu_1',
      'msg_1',
      undefined,
      'stdio',
      undefined,
    )) {
      events.push(ev as never)
    }

    const permResults = events.filter(e => e.type === 'hookPermissionResult')
    expect(permResults.length).toBeGreaterThanOrEqual(1)
    const lastPerm = permResults[permResults.length - 1]!
    expect(lastPerm.hookPermissionResult?.behavior).toBe('deny')
    expect(lastPerm.hookPermissionResult?.message).toBe(
      'Blocked by security policy',
    )
    expect(events.some(e => e.type === 'stop')).toBe(false)
  })
})
