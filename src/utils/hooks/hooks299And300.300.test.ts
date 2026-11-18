import { describe, expect, test } from 'bun:test'
import {
  applyOnFailureBlockToHookResult,
  shouldBlockNoBashGuard,
  shouldBlockOnFailureForEvent,
} from '../hooks.js'
import type { HookResult } from '../hooks.js'

describe('v2.1.299-300 hooks alignment (#698)', () => {
  test('#698: shouldBlockNoBashGuard blocks PreToolUse and PermissionRequest command hooks without shell when Git Bash is absent on Windows', () => {
    const hook = { type: 'command' as const, command: 'check.sh' }
    expect(shouldBlockNoBashGuard(hook, 'PreToolUse', true, false)).toBe(true)
    expect(shouldBlockNoBashGuard(hook, 'PermissionRequest', true, false)).toBe(
      true,
    )
    // Not when Git Bash is present
    expect(shouldBlockNoBashGuard(hook, 'PreToolUse', true, true)).toBe(false)
    // Not on non-Windows
    expect(shouldBlockNoBashGuard(hook, 'PreToolUse', false, false)).toBe(false)
    // Not when shell is explicitly set
    expect(
      shouldBlockNoBashGuard(
        { ...hook, shell: 'powershell' },
        'PreToolUse',
        true,
        false,
      ),
    ).toBe(false)
    // Not when onFailure is continue
    expect(
      shouldBlockNoBashGuard(
        { ...hook, onFailure: 'continue' },
        'PreToolUse',
        true,
        false,
      ),
    ).toBe(false)
    // Not for non-guard events like Stop
    expect(shouldBlockNoBashGuard(hook, 'Stop', true, false)).toBe(false)
  })

  test('#698: applyOnFailureBlockToHookResult converts onFailure:block failed PreToolUse to blocking', () => {
    const failedResult: HookResult = {
      hook: {
        type: 'command',
        command: 'guard.sh',
        onFailure: 'block',
      },
      outcome: 'non_blocking_error',
    }
    expect(
      shouldBlockOnFailureForEvent(failedResult.hook as never, 'PreToolUse'),
    ).toBe(true)
    const blocked = applyOnFailureBlockToHookResult(failedResult, 'PreToolUse')
    expect(blocked.outcome).toBe('blocking')
    expect(blocked.blockingError?.blockingError).toContain(
      'blocking because onFailure is "block"',
    )
  })
})
