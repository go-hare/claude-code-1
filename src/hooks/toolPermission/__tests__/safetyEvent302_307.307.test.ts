import { describe, expect, test } from 'bun:test'
import {
  mapReasonCodeToSafetyCategory,
  resolveSafetyEventCategory,
} from '../permissionLogging.js'

describe('permissionLogging safety_event (#1075)', () => {
  test('mapReasonCodeToSafetyCategory maps rule, mode, hook, classifier, and bashMiss codes', () => {
    expect(mapReasonCodeToSafetyCategory('rule:policySettings')).toBe(
      'managed_policy',
    )
    expect(mapReasonCodeToSafetyCategory('rule:userSettings')).toBe(
      'permission_rule',
    )
    expect(mapReasonCodeToSafetyCategory('mode')).toBe('permission_mode')
    expect(mapReasonCodeToSafetyCategory('hook:PreToolUse')).toBe('hook')
    expect(mapReasonCodeToSafetyCategory('classifier:auto-mode:block')).toBe(
      'auto_mode_block',
    )
    expect(
      mapReasonCodeToSafetyCategory('classifier:auto-mode:unavailable'),
    ).toBe('auto_mode_no_verdict')
    expect(mapReasonCodeToSafetyCategory('bashMiss:too-complex')).toBe(
      'static_analysis',
    )
    expect(mapReasonCodeToSafetyCategory('safetyCheck')).toBe('safety_check')
    expect(mapReasonCodeToSafetyCategory('sandboxOverride')).toBe(
      'sandbox_override',
    )
  })

  test('resolveSafetyEventCategory handles circuitBreaker, user_reject, and sandboxViolations', () => {
    expect(
      resolveSafetyEventCategory({
        decision: 'reject',
        circuitBreaker: 'dangerousRemoval',
        reasonCode: 'safetyCheck',
      }),
    ).toBe('safety_check')

    expect(
      resolveSafetyEventCategory({
        decision: 'reject',
        source: 'user_reject',
        reasonCode: 'unknownCode',
      }),
    ).toBe('user_rejected')

    expect(
      resolveSafetyEventCategory({ decision: 'accept' }, [{ kind: 'network' }]),
    ).toBe('sandbox_network')

    expect(
      resolveSafetyEventCategory({ decision: 'accept' }, [{ kind: 'fs' }]),
    ).toBe('sandbox_other')
  })
})
