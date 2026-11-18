import { describe, expect, test } from 'bun:test'
import {
  isSafetyEventEnabled,
  logToolSafetyEvent,
} from '../permissionLogging.js'

describe('#1339 safety_event OTel gating (2.1.312)', () => {
  test('isSafetyEventEnabled defaults to false and logToolSafetyEvent returns false without emitting', () => {
    expect(isSafetyEventEnabled()).toBe(false)
    const emitted = logToolSafetyEvent({
      toolName: 'Bash',
      toolUseId: 'tu_312_test',
      record: {
        decision: 'reject',
        source: 'classifier',
        reasonCode: 'classifier:auto-mode',
      },
      permissionMode: 'auto',
    })
    expect(emitted).toBe(false)
  })
})
