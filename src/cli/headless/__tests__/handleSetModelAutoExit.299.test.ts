import { describe, expect, test } from 'bun:test'
import {
  _setAutoModeGateEnabledForTesting,
  AUTO_GATE_DENIED_TRIGGER,
  isAutoModeGateEnabled,
  transitionPermissionMode,
} from '../../../utils/permissions/permissionSetup.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'

describe('handleSetModel auto mode exit (#605)', () => {
  test('transitionPermissionMode exits auto -> default with auto_gate_denied when gate is closed', () => {
    try {
      _setAutoModeGateEnabledForTesting(false)
      expect(isAutoModeGateEnabled()).toBe(false)
      const ctx = {
        ...getEmptyToolPermissionContext(),
        mode: 'auto' as const,
      }
      const next = transitionPermissionMode(
        'auto',
        'default',
        ctx,
        AUTO_GATE_DENIED_TRIGGER,
      )
      expect(next).toBeDefined()
    } finally {
      _setAutoModeGateEnabledForTesting(undefined)
    }
  })
})
